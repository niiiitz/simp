use crate::library::artwork::{
    fetch_musicbrainz_cover_for_album, folder_has_local_artwork_file, resolve_and_cache_artwork,
    MusicBrainzArtOutcome,
};
use crate::library::db::LibraryDatabase;
use crate::library::mounts::discover_removable_mounts;
use crate::library::vdf::{discover_steam_music_directories, normalize_platform_path};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "flac", "mp3", "wav", "m4a", "aac", "ogg", "opus", "aiff", "aif",
];

const SUPPORTED_VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "m4v", "mov", "mkv", "ogv"];

/// Lightweight startup check that removes any SQLite mounts/tracks whose root was removed
/// from `custom_paths` or added to `ignored_paths`, without crawling the filesystem.
pub fn prune_ignored_and_stale_mounts(db: &LibraryDatabase, settings: &SimpSettings) {
    let ignored_roots: HashSet<String> = settings
        .library
        .ignored_paths
        .values()
        .map(|s| normalize_platform_path(s).to_string_lossy().to_string())
        .collect();

    let active_custom_roots: HashSet<String> = settings
        .library
        .custom_paths
        .values()
        .map(|s| normalize_platform_path(s).to_string_lossy().to_string())
        .filter(|norm_str| !ignored_roots.contains(norm_str))
        .collect();

    if let Ok(existing_mounts) = db.get_mounts() {
        for m in existing_mounts {
            let norm_mount = normalize_platform_path(&m.mount_root)
                .to_string_lossy()
                .to_string();
            let is_ignored =
                ignored_roots.contains(&m.mount_root) || ignored_roots.contains(&norm_mount);
            #[cfg(target_os = "windows")]
            let is_misclassified_fixed = m.mount_kind == "removable_media"
                && crate::library::mounts::is_windows_non_removable_drive_root(&m.mount_root);
            #[cfg(target_os = "macos")]
            let is_misclassified_fixed = m.mount_kind == "removable_media";
            #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
            let is_misclassified_fixed = false;

            let is_shadow_timemachine = m.mount_root.contains(".timemachine")
                || m.mount_root.contains("TimeMachine")
                || m.mount_root.contains("Backups.backupdb");

            if is_ignored
                || (m.mount_kind == "user_custom"
                    && !active_custom_roots.contains(&m.mount_root)
                    && !active_custom_roots.contains(&norm_mount))
                || (m.mount_kind == "removable_media" && !settings.library.auto_mount_removable)
                || (m.mount_kind == "steam_vdf" && !settings.library.scan_steam_osts)
                || is_misclassified_fixed
                || is_shadow_timemachine
            {
                let _ = db.remove_mount(&m.mount_root);
                if norm_mount != m.mount_root {
                    let _ = db.remove_mount(&norm_mount);
                }
            }
        }
    }
}

/// Crawls configured local directories, Steam OST directories (`libraryfolders.vdf`),
/// and removable USB/MicroSD mounts (`/run/media`), incrementally indexing tracks into SQLite.
pub fn scan_all_storage(db: &LibraryDatabase, settings: &SimpSettings) -> (usize, usize) {
    crate::prefer_efficiency_core_for_current_thread();
    let ignored_roots: HashSet<String> = settings
        .library
        .ignored_paths
        .values()
        .map(|s| normalize_platform_path(s).to_string_lossy().to_string())
        .collect();

    // 1. User-configured custom paths (normalized for Windows C:\ and bash-escaped spaces)
    let mut active_custom_roots = HashSet::new();
    for (_key, raw_path_str) in &settings.library.custom_paths {
        let norm_path = normalize_platform_path(raw_path_str);
        let norm_str = norm_path.to_string_lossy().to_string();
        if ignored_roots.contains(&norm_str) || ignored_roots.contains(raw_path_str) {
            continue;
        }
        if !active_custom_roots.insert(norm_str.clone()) {
            continue;
        }
        let online = norm_path.is_dir();
        let label = norm_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| norm_str.clone());
        let _ = db.upsert_mount(&norm_str, &label, "user_custom", online);
        if online {
            scan_mount_directory(db, &norm_path, &norm_str, "local");
        }
    }

    // Prune any stale `user_custom` mounts in SQLite that are no longer in `custom_paths`,
    // or any mounts explicitly added to `ignored_paths`, or any fixed/optical Windows drive roots
    // or macOS `/Volumes` Time Machine shadow mounts that were previously misclassified as `removable_media`.
    prune_ignored_and_stale_mounts(db, settings);

    // 2. Steam Soundtracks (`libraryfolders.vdf`)
    if settings.library.scan_steam_osts {
        for ost_dir in discover_steam_music_directories() {
            let root_str = ost_dir.to_string_lossy().to_string();
            if ignored_roots.contains(&root_str) {
                continue;
            }
            let _ = db.upsert_mount(&root_str, "Steam Soundtracks", "steam_vdf", true);
            scan_mount_directory(db, &ost_dir, &root_str, "steam_ost");
        }
    }

    // 3. Removable USB / MicroSD Drives (`/run/media/...` on Linux, `DRIVE_REMOVABLE` on Windows)
    if settings.library.auto_mount_removable {
        let discovered: Vec<(PathBuf, String)> = discover_removable_mounts()
            .into_iter()
            .filter(|(p, _)| !ignored_roots.contains(&p.to_string_lossy().to_string()))
            .collect();
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

    // 4. Polite MusicBrainz + Cover Art Archive lookup for any local albums still missing cover art
    resolve_missing_local_album_artwork_via_musicbrainz(db);

    let (albums, tracks) = db.get_library_counts().unwrap_or((0, 0));
    tracing::info!(
        "Storage scan complete: {} albums, {} tracks indexed in SQLite",
        albums,
        tracks
    );
    (albums, tracks)
}

fn resolve_missing_local_album_artwork_via_musicbrainz(db: &LibraryDatabase) {
    let Ok(missing_albums) = db.get_local_albums_missing_artwork() else {
        return;
    };
    if missing_albums.is_empty() {
        return;
    }

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let mut made_network_call = false;

    for (album_id, title, album_artist) in missing_albums {
        if let Some((status, cached_art, checked_at)) = db.get_musicbrainz_art_cache(&album_id) {
            if status == "found" {
                if let Some(url) = cached_art {
                    let _ = db.set_album_and_tracks_artwork(&album_id, &url);
                    continue;
                }
            } else if status == "not_found" && (now_secs - checked_at) < 600 {
                // Negative cache valid for 10 minutes so unmatched local folders don't spam MusicBrainz
                continue;
            }
        }

        if made_network_call {
            // Respect MusicBrainz's 1 req/sec rate limit policy with safety margin
            std::thread::sleep(Duration::from_millis(1500));
        }
        made_network_call = true;

        match fetch_musicbrainz_cover_for_album(&album_id, &title, &album_artist) {
            MusicBrainzArtOutcome::Found(art_url) => {
                tracing::info!(
                    "Resolved missing local album artwork via MusicBrainz + Cover Art Archive: '{}' ({})",
                    title,
                    album_artist
                );
                let _ = db.set_album_and_tracks_artwork(&album_id, &art_url);
                let _ = db.set_musicbrainz_art_cache(&album_id, "found", Some(&art_url));
            }
            MusicBrainzArtOutcome::NotFound => {
                let _ = db.set_musicbrainz_art_cache(&album_id, "not_found", None);
            }
            MusicBrainzArtOutcome::TransientError => {
                tracing::warn!(
                    "Transient MusicBrainz/network error while looking up '{}' ({}); will retry on next scan",
                    title,
                    album_artist
                );
            }
        }
    }
}

fn is_ignored_walk_entry(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    // Skip hidden dot-files/folders (`.timemachine`, `.Spotlight-V100`, `.Trashes`, `.git`, AppleDouble `._*`)
    // and Time Machine backup bundles
    if name.starts_with('.')
        || name.eq_ignore_ascii_case("Backups.backupdb")
        || name.ends_with(".backupbundle")
        || name.ends_with(".sparsebundle")
    {
        return true;
    }
    false
}

fn scan_mount_directory(db: &LibraryDatabase, dir: &Path, mount_root: &str, source: &str) {
    let fingerprints = db.get_mount_file_fingerprints(mount_root).unwrap_or_default();

    // Collect candidate files and deduplicate dual-format Steam OSTs (e.g., identical `.mp3` and `.wav` stems in the same folder)
    let mut audio_files: Vec<PathBuf> = WalkDir::new(dir)
        .follow_links(false)
        .max_depth(10)
        .into_iter()
        .filter_entry(|e| !is_ignored_walk_entry(e))
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
    let mut folder_art_present: HashMap<PathBuf, bool> = HashMap::new();

    for path in audio_files {
        let parent_dir = path.parent().unwrap_or(dir).to_path_buf();
        let has_local_dir_art = *folder_art_present
            .entry(parent_dir.clone())
            .or_insert_with(|| folder_has_local_artwork_file(&parent_dir));
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

        let has_local_lrc = path.with_extension("lrc").is_file();

        if let Some((cached_mtime, cached_size, cached_art)) = fingerprints.get(&uri) {
            if *cached_mtime == file_mtime && *cached_size == file_size {
                let art_str = cached_art.as_deref().unwrap_or("");
                let is_emb = art_str.contains("/simp_art_emb_");
                let is_mb = art_str.contains("/mb_");
                // Only reuse cached fingerprint if:
                // - Artwork came from embedded audio tags (`simp_art_emb_`), OR
                // - Folder still has a local cover image (`has_local_dir_art == true`), OR
                // - Artwork came from MusicBrainz (`mb_`) and no local folder cover image was added.
                // This ensures deleting or adding `cover.png`/`cover.jpg` in a folder is immediately detected!
                if is_emb || (is_mb && !has_local_dir_art) || (!is_mb && has_local_dir_art) {
                    if has_local_lrc || !art_str.is_empty() {
                        let _ = db.record_indexed_track_capabilities(
                            &uri,
                            !art_str.is_empty(),
                            has_local_lrc,
                            has_local_lrc,
                        );
                    }
                    continue;
                }
            }
        }

        if let Some(track_meta) = parse_audio_file(db, &path, &uri, mount_root, source) {
            let has_art = track_meta
                .art_url
                .as_deref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            let _ = db.upsert_track(&track_meta, Some(file_mtime), Some(file_size));
            let _ = db.record_indexed_track_capabilities(
                &uri,
                has_art,
                has_local_lrc,
                has_local_lrc,
            );
        }
    }

    if source == "local" {
        let video_files: Vec<PathBuf> = WalkDir::new(dir)
            .follow_links(false)
            .max_depth(10)
            .into_iter()
            .filter_entry(|e| !is_ignored_walk_entry(e))
            .filter_map(Result::ok)
            .map(|e| e.into_path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|e| e.to_str())
                        .map(|ext| {
                            SUPPORTED_VIDEO_EXTENSIONS
                                .iter()
                                .any(|s| s.eq_ignore_ascii_case(ext))
                        })
                        .unwrap_or(false)
            })
            .collect();

        for path in video_files {
            let uri = format!("video://local/{}", path.to_string_lossy());
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

            if let Some((cached_mtime, cached_size, _)) = fingerprints.get(&uri) {
                if *cached_mtime == file_mtime && *cached_size == file_size {
                    continue;
                }
            }

            if let Some(video_meta) = parse_local_video_file(db, &path, &uri, mount_root) {
                let _ = db.upsert_track(&video_meta, Some(file_mtime), Some(file_size));
            }
        }
    }
}

fn parse_local_video_file(
    db: &LibraryDatabase,
    path: &Path,
    uri: &str,
    mount_root: &str,
) -> Option<TrackMetadata> {
    let raw_stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Video".to_string());
    let folder_album = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Local Videos".to_string());
    let (parsed_track_no, parsed_artist, parsed_title) = parse_stem_metadata(&raw_stem);
    let art = resolve_and_cache_artwork(path);
    let art_http = art.as_ref().map(|a| a.http_art_url.clone());

    let parent_folder_key = path
        .parent()
        .map(|p| p.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let album_id_input = format!(
        "{}::{}::local_video",
        folder_album.to_lowercase(),
        parent_folder_key
    );
    let album_id = blake3::hash(album_id_input.as_bytes()).to_hex()[..16].to_string();
    let artist_label = parsed_artist.unwrap_or_else(|| "Local Video".to_string());

    let _ = db.upsert_album(
        &album_id,
        &folder_album,
        "Local Video",
        None,
        None,
        art_http.as_deref(),
    );

    Some(TrackMetadata {
        uri: uri.to_string(),
        title: parsed_title,
        artists: vec![artist_label],
        album: folder_album,
        album_id: Some(album_id),
        track_number: parsed_track_no,
        disc_number: Some(1),
        art_url: art_http,
        duration_ms: 0,
        source: "local_video".to_string(),
        mount_root: Some(mount_root.to_string()),
        content_rating: None,
    })
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
    let grandparent_artist = path
        .parent()
        .and_then(|p| p.parent())
        .and_then(|gp| gp.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("music") && !s.eq_ignore_ascii_case("media"));

    // Parse filename patterns like "01 - kidkanevil - Big City Life" or "01 Death&Pleasure"
    let (parsed_track_no, parsed_artist, parsed_title) = parse_stem_metadata(&raw_stem);

    let mut title = parsed_title;
    let mut artist = parsed_artist
        .or_else(|| grandparent_artist.clone())
        .unwrap_or_else(|| "Unknown Artist".to_string());
    let mut tag_album_artist: Option<String> = None;
    let mut album = folder_album.clone();
    let mut track_number = parsed_track_no;
    let mut disc_number = Some(1);
    let mut year = None;
    let mut duration_ms = 0u32;
    let mut content_rating: Option<String> = None;

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
                if let Some(aa) = tag.get_string(&lofty::tag::ItemKey::AlbumArtist) {
                    if !aa.trim().is_empty() {
                        tag_album_artist = Some(aa.trim().to_string());
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
                if let Some(adv) = tag.get_string(&lofty::tag::ItemKey::ParentalAdvisory) {
                    let norm = adv.trim().to_ascii_lowercase();
                    if matches!(norm.as_str(), "1" | "4" | "explicit" | "yes" | "true") {
                        content_rating = Some("explicit".to_string());
                    } else if matches!(norm.as_str(), "2" | "clean") {
                        content_rating = Some("clean".to_string());
                    }
                }
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

    let album_artist_owned = if source == "steam_ost" {
        "Steam Soundtrack".to_string()
    } else if let Some(aa) = tag_album_artist {
        aa
    } else if let Some(gp) = &grandparent_artist {
        gp.clone()
    } else {
        artist.clone()
    };

    let _ = db.upsert_album(
        &album_id,
        &album,
        &album_artist_owned,
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
        content_rating,
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

    // Also handle space-prefixed track numbers like "01 Death&Pleasure" or "02. Face the Music"
    if let Some((first_word, rest)) = stem.trim().split_once(' ') {
        let clean_num = first_word.trim_end_matches('.');
        if clean_num.len() <= 3 && clean_num.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(num) = clean_num.parse::<u32>() {
                let rest_trimmed = rest.trim_start_matches(['-', '.', ' ']);
                if !rest_trimmed.is_empty() {
                    return (Some(num), None, rest_trimmed.to_string());
                }
            }
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
