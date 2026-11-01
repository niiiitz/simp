use keyvalues_parser::Value;
use std::fs;
use std::path::{Path, PathBuf};

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

    // Explicit direct fallback for standard WSL2 / SteamOS music paths
    let direct_fallbacks = [
        PathBuf::from("/mnt/c/Program Files (x86)/Steam/steamapps/music"),
        PathBuf::from("/mnt/c/Program Files/Steam/steamapps/music"),
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

/// Converts Windows VDF paths (`"C:\\Program Files (x86)\\Steam"` or `"D:\\SteamLibrary"`)
/// into WSL2 mount paths (`"/mnt/c/Program Files (x86)/Steam"`) when running on Linux/WSL,
/// while leaving native Linux paths (`"/home/deck/.local/share/Steam"`) untouched.
pub fn normalize_platform_path(raw_path: &str) -> PathBuf {
    let unescaped = raw_path.replace("\\\\", "\\");
    let bytes = unescaped.as_bytes();

    // Detect Windows drive letter prefix like `C:\` or `D:/`
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/') {
        let drive_letter = (bytes[0] as char).to_ascii_lowercase();
        let rest = unescaped[3..].replace('\\', "/");
        let wsl_path = PathBuf::from(format!("/mnt/{drive_letter}/{rest}"));
        if Path::new("/mnt").is_dir() {
            return wsl_path;
        }
    }

    PathBuf::from(unescaped)
}

#[cfg(test)]
mod tests {
    use super::*;

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
    }
}
