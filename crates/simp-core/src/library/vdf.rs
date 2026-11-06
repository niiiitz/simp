use anyhow::Result;
use keyvalues_parser::Value;
use simp_protocol::SessionState;
use std::fs;
#[cfg(not(target_os = "windows"))]
use std::path::Path;
use std::path::PathBuf;

/// Discovers all active Steam soundtrack directories across:
/// - SteamOS / Linux (`~/.local/share/Steam`, `~/.steam/steam`, Flatpak Steam)
/// - WSL2 Windows Host (`/mnt/c/Program Files (x86)/Steam/steamapps/libraryfolders.vdf`)
///
/// Checks both `<library>/steamapps/music` and `<library>/steamapps/common/*Soundtrack*`.
pub fn discover_steam_music_directories() -> Vec<PathBuf> {
    let mut music_dirs = Vec::new();
    let mut candidate_vdfs = Vec::new();

    if let Some(home) = dirs::home_dir() {
        candidate_vdfs.push(home.join(".local/share/Steam/steamapps/libraryfolders.vdf"));
        candidate_vdfs.push(home.join(".steam/steam/steamapps/libraryfolders.vdf"));
        candidate_vdfs.push(
            home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/libraryfolders.vdf"),
        );
    }

    // WSL2 / Windows Host Steam installation fallback
    candidate_vdfs.push(PathBuf::from(
        "/mnt/c/Program Files (x86)/Steam/steamapps/libraryfolders.vdf",
    ));
    candidate_vdfs.push(PathBuf::from(
        "/mnt/c/Program Files/Steam/steamapps/libraryfolders.vdf",
    ));
    #[cfg(target_os = "windows")]
    {
        candidate_vdfs.push(PathBuf::from(
            r"C:\Program Files (x86)\Steam\steamapps\libraryfolders.vdf",
        ));
        candidate_vdfs.push(PathBuf::from(
            r"C:\Program Files\Steam\steamapps\libraryfolders.vdf",
        ));
    }

    for vdf_path in candidate_vdfs {
        let Ok(vdf_text) = fs::read_to_string(&vdf_path) else {
            continue;
        };
        for lib_root in parse_library_roots_from_vdf(&vdf_text) {
            // 1. Standard standalone Steam Soundtracks directory (`steamapps/music`)
            let music_dir = lib_root.join("steamapps").join("music");
            if music_dir.is_dir() && !music_dirs.contains(&music_dir) {
                tracing::info!("Discovered Steam OST directory: {}", music_dir.display());
                music_dirs.push(music_dir);
            }

            // 2. Legacy/DLC Soundtracks inside `steamapps/common/*Soundtrack*` or `*OST*`
            let common_dir = lib_root.join("steamapps").join("common");
            if let Ok(entries) = fs::read_dir(&common_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let name_lower = path
                            .file_name()
                            .map(|n| n.to_string_lossy().to_lowercase())
                            .unwrap_or_default();
                        if (name_lower.contains("soundtrack") || name_lower.ends_with(" ost"))
                            && !music_dirs.contains(&path)
                        {
                            tracing::info!("Discovered Steam common OST directory: {}", path.display());
                            music_dirs.push(path);
                        }
                    }
                }
            }
        }
    }

    // Explicit direct fallback for standard WSL2 / SteamOS / Windows music paths
    let direct_fallbacks = [
        PathBuf::from("/mnt/c/Program Files (x86)/Steam/steamapps/music"),
        PathBuf::from("/mnt/c/Program Files/Steam/steamapps/music"),
        PathBuf::from(r"C:\Program Files (x86)\Steam\steamapps\music"),
        PathBuf::from(r"C:\Program Files\Steam\steamapps\music"),
    ];
    for fallback in direct_fallbacks {
        if fallback.is_dir() && !music_dirs.contains(&fallback) {
            tracing::info!("Discovered Steam OST fallback directory: {}", fallback.display());
            music_dirs.push(fallback);
        }
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
            let wsl_path = PathBuf::from(format!("/mnt/{drive_letter}/{rest_clean}"));
            if Path::new("/mnt").is_dir() {
                return wsl_path;
            }
        }
    }

    PathBuf::from(unescaped)
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
