use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, PictureType};
use lofty::probe::Probe;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Artwork Fallback Cascade:
/// 1. Embedded ID3v2 APIC / Vorbis PICTURE (`lofty`) -> `simp_art_emb_{hash}.{ext}`
/// 2. Parent directory scan (`album_art.png`, `cover.jpg`, `cover.png`, `AlbumArt.jpg`, `folder.jpg`, or any `.jpg`/`.png` in the album directory) -> `simp_art_dir_{hash}.{ext}`
/// 3. Polite MusicBrainz + Cover Art Archive lookup (paced at 1 req / 1.1s, cached in SQLite) -> `mb_{album_id}.jpg`
///
/// Writes to `/tmp/simp_art_{kind}_{hash}.{ext}` (for `souvlaki` MPRIS2 QAM cache-busting)
/// and `~/.cache/simp/art/simp_art_{kind}_{hash}.{ext}` (served over `http://127.0.0.1:18888/art/...`).
pub struct ExtractedArtwork {
    pub mpris_file_uri: String,
    pub http_art_url: String,
    pub cache_file_path: String,
}

const PRIORITY_FOLDER_IMAGES: &[&str] = &[
    "album_art.png",
    "album_art.jpg",
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "cover.webp",
    "Cover.jpg",
    "Cover.png",
    "AlbumArt.jpg",
    "AlbumArt.png",
    "folder.jpg",
    "folder.png",
];

/// Returns `true` if `dir` currently contains any local cover image file (`.png`, `.jpg`, `.jpeg`, `.webp`).
pub fn folder_has_local_artwork_file(dir: &Path) -> bool {
    for name in PRIORITY_FOLDER_IMAGES {
        if dir.join(name).is_file() {
            return true;
        }
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext_os) = path.extension().and_then(|e| e.to_str()) {
                    let ext_lower = ext_os.to_lowercase();
                    if ext_lower == "png"
                        || ext_lower == "jpg"
                        || ext_lower == "jpeg"
                        || ext_lower == "webp"
                    {
                        return true;
                    }
                }
            }
        }
    }
    false
}

pub fn resolve_and_cache_artwork(audio_file_path: &Path) -> Option<ExtractedArtwork> {
    if let Some((bytes, ext)) = extract_embedded_bytes(audio_file_path) {
        return write_art_bytes(&bytes, ext, "emb");
    }

    if let Some(parent) = audio_file_path.parent() {
        for name in PRIORITY_FOLDER_IMAGES {
            let candidate_path = parent.join(name);
            if candidate_path.is_file() {
                if let Ok(bytes) = fs::read(&candidate_path) {
                    let lower = name.to_lowercase();
                    let ext = if lower.ends_with(".png") {
                        "png"
                    } else if lower.ends_with(".webp") {
                        "webp"
                    } else {
                        "jpg"
                    };
                    return write_art_bytes(&bytes, ext, "dir");
                }
            }
        }

        // Fallback: check any image file in the parent folder
        if let Ok(entries) = fs::read_dir(parent) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext_os) = path.extension().and_then(|e| e.to_str()) {
                        let ext_lower = ext_os.to_lowercase();
                        if ext_lower == "png"
                            || ext_lower == "jpg"
                            || ext_lower == "jpeg"
                            || ext_lower == "webp"
                        {
                            if let Ok(bytes) = fs::read(&path) {
                                let ext = if ext_lower == "png" {
                                    "png"
                                } else if ext_lower == "webp" {
                                    "webp"
                                } else {
                                    "jpg"
                                };
                                return write_art_bytes(&bytes, ext, "dir");
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

fn extract_embedded_bytes(file_path: &Path) -> Option<(Vec<u8>, &'static str)> {
    let tagged_file = Probe::open(file_path).ok()?.read().ok()?;
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())?;
    let picture = tag
        .pictures()
        .iter()
        .find(|pic| pic.pic_type() == PictureType::CoverFront)
        .or_else(|| tag.pictures().first())?;

    let ext = match picture.mime_type() {
        Some(MimeType::Png) => "png",
        Some(MimeType::Gif) => "gif",
        _ => "jpg",
    };

    Some((picture.data().to_vec(), ext))
}

fn write_art_bytes(bytes: &[u8], ext: &str, kind: &str) -> Option<ExtractedArtwork> {
    let hash = blake3::hash(bytes).to_hex();
    let short_hash = &hash.as_str()[..16];
    let filename = format!("simp_art_{kind}_{short_hash}.{ext}");

    // 1. Write to /tmp RAM disk for SteamOS MPRIS2 QAM (cache-busted by content hash)
    let tmp_path = PathBuf::from("/tmp").join(&filename);
    if !tmp_path.exists() {
        if let Ok(mut f) = File::create(&tmp_path) {
            let _ = f.write_all(bytes);
        }
    }

    // 2. Write to ~/.cache/simp/art/ for local HTTP server (:18888/art/...)
    let cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("simp")
        .join("art");
    let _ = fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join(&filename);
    if !cache_path.exists() {
        if let Ok(mut f) = File::create(&cache_path) {
            let _ = f.write_all(bytes);
        }
    }

    Some(ExtractedArtwork {
        mpris_file_uri: format!("file://{}", tmp_path.to_string_lossy()),
        http_art_url: format!("http://127.0.0.1:18888/art/{filename}"),
        cache_file_path: cache_path.to_string_lossy().to_string(),
    })
}

fn normalize_title_for_match(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn urlencode_lucene(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| {
            if matches!(
                c,
                '+' | '-' | '&' | '|' | '!' | '(' | ')' | '{' | '}' | '[' | ']' | '^' | '"' | '~'
                    | '*' | '?' | ':' | '\\' | '/'
            ) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let mut out = String::with_capacity(cleaned.len() * 2);
    for b in cleaned.trim().bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => out.push(b as char),
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Queries MusicBrainz Release Search API + Cover Art Archive (`release-group` and `release` `front-500`)
/// for a local album missing embedded/folder artwork.
/// Only accepts high-confidence title/artist matches so non-MusicBrainz folders never receive false-positive art.
pub fn fetch_musicbrainz_cover_for_album(
    album_id: &str,
    album_title: &str,
    album_artist: &str,
) -> Option<String> {
    let clean_title = album_title.trim();
    if clean_title.len() < 2 || clean_title.eq_ignore_ascii_case("Unknown Album") {
        return None;
    }
    let norm_target_title = normalize_title_for_match(clean_title);
    if norm_target_title.is_empty() {
        return None;
    }

    let safe_id: String = album_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let filename = format!("mb_{safe_id}.jpg");
    let cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("simp")
        .join("art");
    let _ = fs::create_dir_all(&cache_dir);
    let dest_path = cache_dir.join(&filename);

    if dest_path.is_file() && dest_path.metadata().map(|m| m.len() > 512).unwrap_or(false) {
        return Some(format!("http://127.0.0.1:18888/art/{filename}"));
    }

    let clean_artist = album_artist.trim();
    let has_specific_artist = !clean_artist.is_empty()
        && !clean_artist.eq_ignore_ascii_case("Unknown Artist")
        && !clean_artist.eq_ignore_ascii_case("Steam Soundtrack")
        && !clean_artist.eq_ignore_ascii_case("Various Artists");

    let enc_title = urlencode_lucene(clean_title);
    let query_url = if has_specific_artist {
        let enc_artist = urlencode_lucene(clean_artist);
        format!(
            "https://musicbrainz.org/ws/2/release/?query=release:%22{enc_title}%22%20AND%20artist:%22{enc_artist}%22&fmt=json&limit=5"
        )
    } else {
        format!(
            "https://musicbrainz.org/ws/2/release/?query=release:%22{enc_title}%22&fmt=json&limit=5"
        )
    };

    let mut releases = query_mb_releases(&query_url);
    // If track-1 artist didn't match because it's a multi-artist soundtrack/compilation on MusicBrainz,
    // fall back to searching by exact release title.
    if releases.is_empty() && has_specific_artist {
        let fallback_url = format!(
            "https://musicbrainz.org/ws/2/release/?query=release:%22{enc_title}%22&fmt=json&limit=5"
        );
        releases = query_mb_releases(&fallback_url);
    }

    let norm_target_artist = normalize_title_for_match(clean_artist);

    for rel in releases {
        let score = rel.get("score").and_then(|v| v.as_u64()).unwrap_or(0);
        if score < 90 {
            continue;
        }
        let rel_title = rel.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let norm_rel_title = normalize_title_for_match(rel_title);
        if norm_rel_title != norm_target_title
            && !norm_rel_title.starts_with(&norm_target_title)
            && !norm_target_title.starts_with(&norm_rel_title)
        {
            continue;
        }

        // Verify artist match if we have a specific artist (unless MusicBrainz credits Various Artists / Soundtrack)
        if has_specific_artist && !norm_target_artist.is_empty() {
            let mb_artist = rel
                .get("artist-credit")
                .and_then(|ac| ac.as_array())
                .and_then(|arr| arr.first())
                .and_then(|first| {
                    first
                        .get("name")
                        .and_then(|v| v.as_str())
                        .or_else(|| first.pointer("/artist/name").and_then(|v| v.as_str()))
                })
                .unwrap_or("");
            let norm_mb_artist = normalize_title_for_match(mb_artist);
            let is_various = mb_artist.eq_ignore_ascii_case("Various Artists");
            if !is_various
                && !norm_mb_artist.is_empty()
                && norm_mb_artist != norm_target_artist
                && !norm_mb_artist.contains(&norm_target_artist)
                && !norm_target_artist.contains(&norm_mb_artist)
            {
                continue;
            }
        }

        // 1. Try Cover Art Archive by release-group ID first (succeeds if ANY edition of the album has front cover art)
        if let Some(rg_id) = rel.pointer("/release-group/id").and_then(|v| v.as_str()) {
            let rg_url = format!("https://coverartarchive.org/release-group/{rg_id}/front-500");
            if download_cover_art_to(&rg_url, &dest_path) {
                let tmp_path = PathBuf::from("/tmp").join(&filename);
                let _ = fs::copy(&dest_path, &tmp_path);
                return Some(format!("http://127.0.0.1:18888/art/{filename}"));
            }
        }

        // 2. Fallback to specific release ID on Cover Art Archive
        if let Some(rel_id) = rel.get("id").and_then(|v| v.as_str()) {
            let rel_url = format!("https://coverartarchive.org/release/{rel_id}/front-500");
            if download_cover_art_to(&rel_url, &dest_path) {
                let tmp_path = PathBuf::from("/tmp").join(&filename);
                let _ = fs::copy(&dest_path, &tmp_path);
                return Some(format!("http://127.0.0.1:18888/art/{filename}"));
            }
        }
    }

    None
}

fn query_mb_releases(url: &str) -> Vec<serde_json::Value> {
    let out = std::process::Command::new("curl")
        .args([
            "-4",
            "--http1.1",
            "-sL",
            "--max-time",
            "8",
            "-H",
            "User-Agent: SIMP/0.1.0-alpha (https://github.com/niiiitz/simp)",
            "-H",
            "Accept: application/json",
            url,
        ])
        .output()
        .ok();
    let Some(out) = out else {
        return Vec::new();
    };
    if !out.status.success() || out.stdout.is_empty() {
        return Vec::new();
    }
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&out.stdout) else {
        return Vec::new();
    };
    json.get("releases")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
}

fn download_cover_art_to(url: &str, dest_path: &Path) -> bool {
    let status = std::process::Command::new("curl")
        .args([
            "-4",
            "--http1.1",
            "-sL",
            "--fail",
            "--max-time",
            "10",
            "-H",
            "User-Agent: SIMP/0.1.0-alpha (https://github.com/niiiitz/simp)",
            "-o",
            &dest_path.to_string_lossy(),
            url,
        ])
        .status();
    if status.map(|s| s.success()).unwrap_or(false)
        && dest_path.metadata().map(|m| m.len() > 512).unwrap_or(false)
    {
        true
    } else {
        let _ = fs::remove_file(dest_path);
        false
    }
}
