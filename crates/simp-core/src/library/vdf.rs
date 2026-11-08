use anyhow::Result;
use keyvalues_parser::Value;
use simp_protocol::{SessionState, SimpSettings};
use std::fs;
use std::path::PathBuf;

#[cfg(target_os = "windows")]
fn query_windows_registry_steam_roots() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let queries = [
        (r"HKCU\Software\Valve\Steam", "SteamPath"),
        (r"HKLM\SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
        (r"HKLM\SOFTWARE\Valve\Steam", "InstallPath"),
    ];
    for (key, val_name) in queries {
        let mut cmd = std::process::Command::new("reg");
        cmd.args(["query", key, "/v", val_name]);
        crate::configure_background_command(&mut cmd);
        if let Ok(output) = cmd.output() {
            if let Ok(text) = String::from_utf8(output.stdout) {
                for line in text.lines() {
                    if let Some(pos) = line.find("REG_SZ") {
                        let raw = line[pos + "REG_SZ".len()..].trim();
                        if !raw.is_empty() {
                            let norm = normalize_platform_path(raw);
                            if norm.is_dir() && !out.contains(&norm) {
                                out.push(norm);
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

fn collect_ost_dirs_under_library_root(lib_root: & std::path::Path, music_dirs: &mut Vec<PathBuf>) {
    // 1. Standard standalone Steam Soundtracks directory (`steamapps/music`)
    let music_dir = lib_root.join("steamapps").join("music");
    if music_dir.is_dir() && !music_dirs.contains(&music_dir) {
        tracing::info!("Discovered Steam OST directory: {}", music_dir.display());
        music_dirs.push(music_dir);
    }

    // 2. Legacy/DLC Soundtracks inside `steamapps/common/*Soundtrack*` / `*OST*` or `<Game>/Soundtrack`
    let common_dir = lib_root.join("steamapps").join("common");
    if let Ok(entries) = fs::read_dir(&common_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name_lower = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                let is_ost_folder = name_lower.contains("soundtrack")
                    || name_lower.ends_with(" ost")
                    || name_lower.contains(" ost ")
                    || name_lower.ends_with("-ost")
                    || name_lower.ends_with("_ost");
                if is_ost_folder {
                    if !music_dirs.contains(&path) {
                        tracing::info!("Discovered Steam common OST directory: {}", path.display());
                        music_dirs.push(path);
                    }
                } else {
                    for sub in ["Soundtrack", "Soundtracks", "OST", "Original Soundtrack"] {
                        let sub_dir = path.join(sub);
                        if sub_dir.is_dir() && !music_dirs.contains(&sub_dir) {
                            tracing::info!(
                                "Discovered nested Steam game OST directory: {}",
                                sub_dir.display()
                            );
                            music_dirs.push(sub_dir);
                        }
                    }
                }
            }
        }
    }
}

/// Discovers all active Steam soundtrack directories across:
/// - SteamOS / Linux (`~/.local/share/Steam`, `~/.steam/steam`, Flatpak Steam)
/// - macOS (`~/Library/Application Support/Steam`)
/// - WSL2 / Windows Host (`/mnt/c/Program Files (x86)/Steam/steamapps/libraryfolders.vdf`, Registry `SteamPath`, or `<Drive>:\SteamLibrary`)
///
/// Checks `<library>/steamapps/music`, `<library>/steamapps/common/*Soundtrack*`, and `<library>/steamapps/common/<Game>/Soundtrack`.
pub fn discover_steam_music_directories() -> Vec<PathBuf> {
    let mut music_dirs = Vec::new();
    let mut candidate_vdfs = Vec::new();
    let mut candidate_roots = Vec::new();

    if let Some(home) = dirs::home_dir() {
        for rel in [
            ".local/share/Steam",
            ".steam/steam",
            ".var/app/com.valvesoftware.Steam/.local/share/Steam",
            "Library/Application Support/Steam",
        ] {
            let root = home.join(rel);
            candidate_vdfs.push(root.join("steamapps/libraryfolders.vdf"));
            candidate_vdfs.push(root.join("config/libraryfolders.vdf"));
            if root.is_dir() {
                candidate_roots.push(root);
            }
        }
    }

    // WSL2 / Windows Host Steam installation fallback
    for wsl_root in [
        "/mnt/c/Program Files (x86)/Steam",
        "/mnt/c/Program Files/Steam",
        "/mnt/c/SteamLibrary",
        "/mnt/d/SteamLibrary",
        "/mnt/d/Steam",
        "/mnt/e/SteamLibrary",
        "/mnt/e/Steam",
    ] {
        let root = PathBuf::from(wsl_root);
        candidate_vdfs.push(root.join("steamapps/libraryfolders.vdf"));
        candidate_vdfs.push(root.join("config/libraryfolders.vdf"));
        if root.is_dir() && !candidate_roots.contains(&root) {
            candidate_roots.push(root);
        }
    }

    #[cfg(target_os = "windows")]
    {
        for reg_root in query_windows_registry_steam_roots() {
            candidate_vdfs.push(reg_root.join(r"steamapps\libraryfolders.vdf"));
            candidate_vdfs.push(reg_root.join(r"config\libraryfolders.vdf"));
            if !candidate_roots.contains(&reg_root) {
                candidate_roots.push(reg_root);
            }
        }
        for env_key in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Ok(pf) = std::env::var(env_key) {
                let root = PathBuf::from(pf).join("Steam");
                candidate_vdfs.push(root.join(r"steamapps\libraryfolders.vdf"));
                candidate_vdfs.push(root.join(r"config\libraryfolders.vdf"));
                if root.is_dir() && !candidate_roots.contains(&root) {
                    candidate_roots.push(root);
                }
            }
        }
        for drive in b'C'..=b'Z' {
            let d = drive as char;
            for suffix in [
                r"Program Files (x86)\Steam",
                r"Program Files\Steam",
                r"Steam",
                r"SteamLibrary",
                r"Games\Steam",
                r"Games\SteamLibrary",
            ] {
                let root = PathBuf::from(format!(r"{d}:\{suffix}"));
                if root.is_dir() {
                    candidate_vdfs.push(root.join(r"steamapps\libraryfolders.vdf"));
                    candidate_vdfs.push(root.join(r"config\libraryfolders.vdf"));
                    if !candidate_roots.contains(&root) {
                        candidate_roots.push(root);
                    }
                }
            }
        }
    }

    for vdf_path in candidate_vdfs {
        let Ok(vdf_text) = fs::read_to_string(&vdf_path) else {
            continue;
        };
        for lib_root in parse_library_roots_from_vdf(&vdf_text) {
            if !candidate_roots.contains(&lib_root) {
                candidate_roots.push(lib_root);
            }
        }
    }

    for lib_root in candidate_roots {
        collect_ost_dirs_under_library_root(&lib_root, &mut music_dirs);
    }

    music_dirs
}

pub fn parse_library_roots_from_vdf(vdf_text: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let Ok(vdf) = keyvalues_parser::parse(vdf_text) else {
        return roots;
    };

    if let Value::Obj(root_obj) = vdf.value {
        for (_index_key, values) in root_obj.iter() {
            if let Some(Value::Obj(folder_obj)) = values.first() {
                if let Some(path_values) = folder_obj.get("path") {
                    if let Some(Value::Str(path_str)) = path_values.first() {
                        let normalized = normalize_platform_path(path_str.as_ref());
                        if !roots.contains(&normalized) {
                            roots.push(normalized);
                        }
                    }
                }
            }
        }
    }

    roots
}

/// Converts Windows VDF/Explorer paths (`"C:\\Users\\...\\Music"` or `"D:\\SteamLibrary"`),
/// bash-escaped paths (`"/mnt/c/Users/.../Apple\\ Music/"`), and `~/...` paths into clean
/// canonical platform paths on Linux/WSL2.
pub fn normalize_platform_path(raw_path: &str) -> PathBuf {
    let trimmed = raw_path.trim().trim_matches('"').trim_matches('\'').trim();

    // 1. Expand leading `~/` to the user's home directory
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest.replace("\\ ", " ").trim_end_matches('/'));
        }
    }

    // 2. If it starts with `/` (POSIX / WSL `/mnt/c/...` path), unescape shell `\ ` spaces
    if trimmed.starts_with('/') {
        let unescaped_spaces = trimmed.replace("\\\\ ", " ").replace("\\ ", " ");
        let clean = if unescaped_spaces.len() > 1 {
            unescaped_spaces.trim_end_matches('/')
        } else {
            &unescaped_spaces
        };
        return PathBuf::from(clean);
    }

    // 3. Detect Windows drive letter prefix like `C:\` or `D:/`
    let unescaped = trimmed.replace("\\\\", "\\");
    let bytes = unescaped.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
    {
        #[cfg(not(target_os = "windows"))]
        {
            let drive_letter = (bytes[0] as char).to_ascii_lowercase();
            let rest = unescaped[3..].replace('\\', "/");
            let rest_clean = rest.trim_end_matches('/');
            return PathBuf::from(format!("/mnt/{drive_letter}/{rest_clean}"));
        }
    }

    PathBuf::from(unescaped)
}

/// Path to `~/.config/simp/settings.vdf` (or `<exe_dir>/data/settings.vdf` in Portable Mode).
pub fn settings_vdf_path() -> PathBuf {
    crate::simp_config_dir().join("settings.vdf")
}

/// Loads `SimpSettings` from `settings.vdf` or returns default settings.
pub fn load_or_create_settings() -> SimpSettings {
    let path = settings_vdf_path();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(settings) = keyvalues_serde::from_str::<SimpSettings>(&content) {
            return settings;
        }
    }
    SimpSettings::default()
}

/// Saves `SimpSettings` to `settings.vdf`, first merging any newer rotated SoundCloud tokens
/// from `TOKEN_CACHE` so saving volume/brightness/etc. never overwrites a rotated `refresh_token`.
pub fn save_settings(settings: &SimpSettings) -> Result<()> {
    let mut merged = settings.clone();
    crate::sinks::soundcloud_api::sync_latest_soundcloud_tokens_into_settings(&mut merged);
    save_settings_raw(&merged)
}

/// Writes `SimpSettings` directly to `settings.vdf` without merging cached tokens (used on disconnect/reset).
pub fn save_settings_raw(settings: &SimpSettings) -> Result<()> {
    let path = settings_vdf_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let serialized = keyvalues_serde::to_string_with_key(settings, "SimpSettings")?;
    let tmp_path = path.with_extension("vdf.tmp");
    fs::write(&tmp_path, serialized)?;
    fs::rename(&tmp_path, &path)?;
    Ok(())
}

/// Path to `~/.local/share/simp/session_state.vdf` (or `<exe_dir>/data/session_state.vdf` in Portable Mode).
pub fn session_state_vdf_path() -> PathBuf {
    crate::simp_data_dir().join("session_state.vdf")
}

/// Loads persisted session state (`~/.local/share/simp/session_state.vdf`) if present.
pub fn load_session_state() -> Option<SessionState> {
    let path = session_state_vdf_path();
    let text = fs::read_to_string(path).ok()?;
    keyvalues_serde::from_str::<SessionState>(&text).ok()
}

/// Atomically writes `SessionState` to `~/.local/share/simp/session_state.vdf` via `.vdf.tmp` rename.
pub fn save_session_state(session: &SessionState) -> Result<()> {
    let path = session_state_vdf_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let vdf_str = keyvalues_serde::to_string_with_key(session, "SimpSession")?;
    let tmp_path = path.with_extension("vdf.tmp");
    fs::write(&tmp_path, vdf_str)?;
    fs::rename(&tmp_path, &path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use simp_protocol::RepeatMode;
    use std::collections::BTreeMap;

    #[test]
    fn test_windows_to_wsl_vdf_path_normalization() {
        let win_path = r"C:\\Program Files (x86)\\Steam";
        let normalized = normalize_platform_path(win_path);
        assert_eq!(
            normalized,
            PathBuf::from("/mnt/c/Program Files (x86)/Steam")
        );

        let linux_path = "/home/deck/.local/share/Steam";
        assert_eq!(
            normalize_platform_path(linux_path),
            PathBuf::from("/home/deck/.local/share/Steam")
        );

        let escaped_wsl_path = r"/mnt/c/Users/niiii/Music/Apple\ Music/Media/Music/";
        assert_eq!(
            normalize_platform_path(escaped_wsl_path),
            PathBuf::from("/mnt/c/Users/niiii/Music/Apple Music/Media/Music")
        );

        let win_apple_path = r"C:\Users\niiii\Music\Apple Music\Media\Music";
        assert_eq!(
            normalize_platform_path(win_apple_path),
            PathBuf::from("/mnt/c/Users/niiii/Music/Apple Music/Media/Music")
        );
    }

    #[test]
    fn test_session_state_vdf_numeric_queue_order() {
        let mut queue_uris = BTreeMap::new();
        for i in 0..12 {
            queue_uris.insert(i.to_string(), format!("file:///music/track_{i:02}.mp3"));
        }
        let session = SessionState {
            current_uri: Some("file:///music/track_03.mp3".to_string()),
            position_ms: 42_500,
            queue_index: 3,
            shuffle: true,
            repeat_mode: RepeatMode::Queue,
            queue_uris,
        };
        let vdf_str = keyvalues_serde::to_string_with_key(&session, "SimpSession")
            .expect("serialize session_state.vdf");
        let parsed: SessionState =
            keyvalues_serde::from_str(&vdf_str).expect("deserialize session_state.vdf");
        assert_eq!(parsed.position_ms, 42_500);
        assert_eq!(parsed.queue_index, 3);
        assert!(parsed.shuffle);
        assert_eq!(parsed.repeat_mode, RepeatMode::Queue);

        let ordered = parsed.ordered_queue_uris();
        assert_eq!(ordered.len(), 12);
        assert_eq!(ordered[2], "file:///music/track_02.mp3");
        assert_eq!(ordered[10], "file:///music/track_10.mp3");
    }
}
