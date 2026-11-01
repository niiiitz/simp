use crate::library::artwork::resolve_and_cache_artwork;
use crate::library::db::LibraryDatabase;
use crate::library::mounts::discover_removable_mounts;
use crate::library::vdf::discover_steam_music_directories;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &["flac", "mp3", "wav", "m4a", "ogg", "opus"];

/// Crawls configured local directories, Steam OST directories (`libraryfolders.vdf`),
/// and removable USB/MicroSD mounts (`/run/media`), incrementally indexing tracks into SQLite.
pub fn scan_all_storage(db: &LibraryDatabase, settings: &SimpSettings) -> (usize, usize) {
    // 1. User-configured custom paths
    for (_key, path_str) in &settings.library.custom_paths {
        let path = Path::new(path_str);
        let online = path.is_dir();
        let label = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone());
        let _ = db.upsert_mount(path_str, &label, "user_custom", online);
        if online {
            scan_mount_directory(db, path, path_str, "local");
        }
    }

    // 2. Steam Soundtracks (`libraryfolders.vdf`)
    if settings.library.scan_steam_osts {
        for ost_dir in discover_steam_music_directories() {
            let root_str = ost_dir.to_string_lossy().to_string();
            let _ = db.upsert_mount(&root_str, "Steam Soundtracks", "steam_vdf", true);
            scan_mount_directory(db, &ost_dir, &root_str, "steam_ost");
        }
    }

    // 3. Removable USB / MicroSD Drives (`/run/media/...`)
    if settings.library.auto_mount_removable {
        let discovered = discover_removable_mounts();
        if let Ok(existing_mounts) = db.get_mounts() {
            for m in existing_mounts {
                if m.mount_kind == "removable_media"
                    && !discovered
                        .iter()
                        .any(|(p, _)| p.to_string_lossy() == m.mount_root)
                {
                    let _ = db.set_mount_online(&m.mount_root, false);
                }
            }
        }
        for (mount_path, label) in discovered {
            let root_str = mount_path.to_string_lossy().to_string();
            let _ = db.upsert_mount(&root_str, &label, "removable_media", true);
            scan_mount_directory(db, &mount_path, &root_str, "local");
        }
    }

    let (albums, tracks) = db.get_library_counts().unwrap_or((0, 0));
    tracing::info!(
        "Storage scan complete: {} albums, {} tracks indexed in SQLite",
        albums,
        tracks
    );
    (albums, tracks)
}

fn scan_mount_directory(db: &LibraryDatabase, dir: &Path, mount_root: &str, source: &str) {
    let fingerprints = db.get_mount_file_fingerprints(mount_root).unwrap_or_default();

    // Collect candidate files and deduplicate dual-format Steam OSTs (e.g., identical `.mp3` and `.wav` stems in the same folder)
    let mut audio_files: Vec<PathBuf> = WalkDir::new(dir)
        .follow_links(false)
        .max_depth(6)
        .into_iter()
        .filter_map(Result::ok)
        .map(|e| e.into_path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .and_then(|e| e.to_str())
                    .map(|ext| SUPPORTED_EXTENSIONS.iter().any(|s| s.eq_ignore_ascii_case(ext)))
                    .unwrap_or(false)
        })
        .collect();

    // Sort so preferred tagged formats (`flac`, `mp3`, `m4a`, `ogg`) come before raw `wav` when deduplicating identical stems
    audio_files.sort_by_key(|p| {
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let rank = match ext.as_str() {
            "flac" => 0,
            "mp3" => 1,
            "m4a" | "ogg" | "opus" => 2,
            "wav" => 3,
            _ => 4,
        };
        (p.parent().map(|d| d.to_path_buf()), p.file_stem().map(|s| s.to_os_string()), rank)
    });

    let mut seen_stems: HashSet<(PathBuf, String)> = HashSet::new();

    for path in audio_files {
        let parent_dir = path.parent().unwrap_or(dir).to_path_buf();
        let stem_key = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        if !seen_stems.insert((parent_dir, stem_key)) {
            // Skip duplicate format (e.g., `.wav` twin of an already-indexed `.mp3`/`.flac` in the same folder)
            continue;
        }

        let uri = format!("file://{}", path.to_string_lossy());
        let Ok(fs_meta) = std::fs::metadata(&path) else {
            continue;
        };
        let file_size = fs_meta.len() as i64;
        let file_mtime = fs_meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        if let Some(&(cached_mtime, cached_size)) = fingerprints.get(&uri) {
            if cached_mtime == file_mtime && cached_size == file_size {
                continue;
            }
        }

        if let Some(track_meta) = parse_audio_file(db, &path, &uri, mount_root, source) {
            let _ = db.upsert_track(&track_meta, Some(file_mtime), Some(file_size));
        }
    }
}

fn parse_audio_file(
    db: &LibraryDatabase,
    path: &Path,
    uri: &str,
    mount_root: &str,
    source: &str,
) -> Option<TrackMetadata> {
    let raw_stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown Track".to_string());
    let folder_album = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown Album".to_string());

    // Parse filename patterns like "01 - kidkanevil - Big City Life" or "11 - Hideki Naganuma - JACK DA FUNK"
    let (parsed_track_no, parsed_artist, parsed_title) = parse_stem_metadata(&raw_stem);

    let mut title = parsed_title;
    let mut artist = parsed_artist.unwrap_or_else(|| "Unknown Artist".to_string());
    let mut album = folder_album.clone();
    let mut track_number = parsed_track_no;
    let mut disc_number = Some(1);
    let mut year = None;
    let mut duration_ms = 0u32;

    if let Ok(probe) = Probe::open(path) {
        if let Ok(tagged) = probe.read() {
            duration_ms = tagged.properties().duration().as_millis() as u32;
            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                if let Some(t) = tag.title() {
                    if !t.trim().is_empty() {
                        title = t.into_owned();
                    }
                }
                if let Some(a) = tag.artist() {
                    if !a.trim().is_empty() {
                        artist = a.into_owned();
                    }
                }
                if let Some(al) = tag.album() {
                    if !al.trim().is_empty() {
                        album = al.into_owned();
                    }
                }
                if tag.track().is_some() {
                    track_number = tag.track();
                }
                disc_number = tag.disk().or(Some(1));
                year = tag.year().map(|y| y as i32);
            }
        }
    }

    let art = resolve_and_cache_artwork(path);
    let art_http = art.as_ref().map(|a| a.http_art_url.clone());

    // Group compilation / OST albums by `(album_title, parent_folder)` so multi-artist soundtracks
    // (like Bomb Rush Cyberfunk) stay together as a single album instead of splitting per track artist!
    let parent_folder_key = path
        .parent()
        .map(|p| p.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let album_id_input = format!("{}::{}::{}", album.to_lowercase(), parent_folder_key, source);
    let album_id = blake3::hash(album_id_input.as_bytes()).to_hex()[..16].to_string();

    let album_artist = if source == "steam_ost" {
        "Steam Soundtrack"
    } else {
        &artist
    };

    let _ = db.upsert_album(
        &album_id,
        &album,
        album_artist,
        year,
        None,
        art_http.as_deref(),
    );

    Some(TrackMetadata {
        uri: uri.to_string(),
        title,
        artists: vec![artist],
        album,
        album_id: Some(album_id),
        track_number,
        disc_number,
        art_url: art_http,
        duration_ms,
        source: source.to_string(),
        mount_root: Some(mount_root.to_string()),
    })
}

/// Parses Steam OST filename stems like `"11 - Hideki Naganuma - JACK DA FUNK"`
/// or `"02 - 2 Mello - I Wanna Kno"` into `(Some(11), Some("Hideki Naganuma"), "JACK DA FUNK")`.
pub fn parse_stem_metadata(stem: &str) -> (Option<u32>, Option<String>, String) {
    let parts: Vec<&str> = stem.splitn(3, " - ").map(str::trim).collect();
    if parts.len() == 3 {
        if let Ok(num) = parts[0].parse::<u32>() {
            return (
                Some(num),
                Some(parts[1].to_string()),
                parts[2].to_string(),
            );
        }
    } else if parts.len() == 2 {
        if let Ok(num) = parts[0].parse::<u32>() {
            return (Some(num), None, parts[1].to_string());
        }
    }
    (None, None, stem.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_steam_ost_filename_stem() {
        let (no, artist, title) = parse_stem_metadata("11 - Hideki Naganuma - JACK DA FUNK");
        assert_eq!(no, Some(11));
        assert_eq!(artist.as_deref(), Some("Hideki Naganuma"));
        assert_eq!(title, "JACK DA FUNK");
    }
}
