use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, PictureType};
use lofty::probe::Probe;
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

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

    // 1. Write to system temp directory (/tmp RAM disk on Linux, %TEMP% on Windows) for MPRIS2 / SMTC
    let tmp_path = std::env::temp_dir().join(&filename);
    if !tmp_path.exists() {
        if let Ok(mut f) = File::create(&tmp_path) {
            let _ = f.write_all(bytes);
        }
    }

    // 2. Write to SIMP art cache directory for local HTTP server (:18888/art/...)
    let cache_dir = crate::simp_art_cache_dir();
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
                '+' | '-' | '_' | '&' | '|' | '!' | '(' | ')' | '{' | '}' | '[' | ']' | '^'
                    | '"' | '~' | '*' | '?' | ':' | '\\' | '/'
            ) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let mut out = String::with_capacity(cleaned.len() * 2);
    let mut prev_space = false;
    for b in cleaned.trim().bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' => {
                out.push(b as char);
                prev_space = false;
            }
            b' ' => {
                if !prev_space {
                    out.push_str("%20");
                    prev_space = true;
                }
            }
            _ => {
                out.push_str(&format!("%{:02X}", b));
                prev_space = false;
            }
        }
    }
    out
}

fn extract_primary_artist(artist: &str) -> &str {
    let mut primary = artist.trim();
    for sep in [
        " & ",
        " feat. ",
        " feat ",
        " ft. ",
        " ft ",
        " featuring ",
        " vs. ",
        " vs ",
        ", ",
    ] {
        if let Some(idx) = primary.to_lowercase().find(sep) {
            let candidate = primary[..idx].trim();
            if !candidate.is_empty() {
                primary = candidate;
            }
        }
    }
    primary
}

/// Outcome of a MusicBrainz + Cover Art Archive lookup.
pub enum MusicBrainzArtOutcome {
    /// Successfully matched and downloaded cover art (`http://127.0.0.1:18888/art/mb_{id}.jpg`).
    Found(String),
    /// MusicBrainz responded cleanly, and no matching release with cover art exists.
    NotFound,
    /// Transient network or rate-limit (HTTP 503) error; caller should not negative-cache.
    TransientError,
}

/// Queries MusicBrainz Release Search API + Cover Art Archive (`release-group` and `release` `front-500`)
/// for a local album missing embedded/folder artwork.
/// Only accepts high-confidence title/artist matches so non-MusicBrainz folders never receive false-positive art.
pub fn fetch_musicbrainz_cover_for_album(
    album_id: &str,
    album_title: &str,
    album_artist: &str,
) -> MusicBrainzArtOutcome {
    let clean_title = album_title.trim();
    if clean_title.len() < 2 || clean_title.eq_ignore_ascii_case("Unknown Album") {
        return MusicBrainzArtOutcome::NotFound;
    }
    let norm_target_title = normalize_title_for_match(clean_title);
    if norm_target_title.is_empty() {
        return MusicBrainzArtOutcome::NotFound;
    }

    let safe_id: String = album_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let filename = format!("mb_{safe_id}.jpg");
    let cache_dir = crate::simp_art_cache_dir();
    let _ = fs::create_dir_all(&cache_dir);
    let dest_path = cache_dir.join(&filename);

    if dest_path.is_file() && dest_path.metadata().map(|m| m.len() > 512).unwrap_or(false) {
        return MusicBrainzArtOutcome::Found(format!("http://127.0.0.1:18888/art/{filename}"));
    }

    let clean_artist = album_artist.trim();
    let primary_artist = extract_primary_artist(clean_artist);
    let has_specific_artist = !primary_artist.is_empty()
        && !primary_artist.eq_ignore_ascii_case("Unknown Artist")
        && !primary_artist.eq_ignore_ascii_case("Steam Soundtrack")
        && !primary_artist.eq_ignore_ascii_case("Various Artists");

    let enc_title = urlencode_lucene(clean_title);
    // Single combined Lucene query per album: matches both exact and compound titles (e.g. `Synth_Wave` -> `SYNTHWAVE`)
    // and artist prefixes/aliases or `Various Artists` compilations in 1 request.
    let query_url = if has_specific_artist {
        let enc_artist = urlencode_lucene(primary_artist);
        format!(
            "https://musicbrainz.org/ws/2/release/?query={enc_title}%20AND%20%28artist:{enc_artist}*%20OR%20artist:%22Various%20Artists%22%29&fmt=json&limit=5"
        )
    } else {
        format!(
            "https://musicbrainz.org/ws/2/release/?query={enc_title}&fmt=json&limit=5"
        )
    };

    let norm_target_artist = normalize_title_for_match(clean_artist);
    let norm_primary_artist = normalize_title_for_match(primary_artist);

    let Some(releases) = query_mb_releases(&query_url) else {
        return MusicBrainzArtOutcome::TransientError;
    };

    for rel in releases {
        let score = rel.get("score").and_then(|v| v.as_u64()).unwrap_or(0);
        if score < 85 {
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
        if has_specific_artist && !norm_primary_artist.is_empty() {
            let mut artist_matched = false;
            if let Some(ac_arr) = rel.get("artist-credit").and_then(|ac| ac.as_array()) {
                for credit in ac_arr {
                    let mb_artist = credit
                        .get("name")
                        .and_then(|v| v.as_str())
                        .or_else(|| credit.pointer("/artist/name").and_then(|v| v.as_str()))
                        .unwrap_or("");
                    if mb_artist.eq_ignore_ascii_case("Various Artists") {
                        artist_matched = true;
                        break;
                    }
                    let norm_mb = normalize_title_for_match(mb_artist);
                    if !norm_mb.is_empty()
                        && (norm_mb == norm_target_artist
                            || norm_mb == norm_primary_artist
                            || (norm_primary_artist.len() >= 3
                                && (norm_mb.contains(&norm_primary_artist)
                                    || norm_primary_artist.contains(&norm_mb)))
                            || (norm_target_artist.len() >= 3
                                && (norm_mb.contains(&norm_target_artist)
                                    || norm_target_artist.contains(&norm_mb))))
                    {
                        artist_matched = true;
                        break;
                    }
                }
            }
            if !artist_matched {
                continue;
            }
        }

        // 1. Try Cover Art Archive by release-group ID first (succeeds if ANY edition of the album has front cover art)
        if let Some(rg_id) = rel.pointer("/release-group/id").and_then(|v| v.as_str()) {
            let rg_url = format!("https://coverartarchive.org/release-group/{rg_id}/front-500");
            if download_cover_art_to(&rg_url, &dest_path) {
                let tmp_path = std::env::temp_dir().join(&filename);
                let _ = fs::copy(&dest_path, &tmp_path);
                return MusicBrainzArtOutcome::Found(format!("http://127.0.0.1:18888/art/{filename}"));
            }
        }

        // 2. Fallback to specific release ID on Cover Art Archive
        if let Some(rel_id) = rel.get("id").and_then(|v| v.as_str()) {
            let rel_url = format!("https://coverartarchive.org/release/{rel_id}/front-500");
            if download_cover_art_to(&rel_url, &dest_path) {
                let tmp_path = std::env::temp_dir().join(&filename);
                let _ = fs::copy(&dest_path, &tmp_path);
                return MusicBrainzArtOutcome::Found(format!("http://127.0.0.1:18888/art/{filename}"));
            }
        }
    }

    MusicBrainzArtOutcome::NotFound
}

fn query_mb_releases(url: &str) -> Option<Vec<serde_json::Value>> {
    if let Ok(bytes) = crate::http_pool::http_get_bytes(
        url,
        &[
            ("User-Agent", "SIMP/0.1.0-alpha (https://github.com/niiiitz/simp)"),
            ("Accept", "application/json"),
        ],
        None,
        15,
    ) {
        if !bytes.is_empty() {
            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if let Some(arr) = json.get("releases").and_then(|v| v.as_array()) {
                    return Some(arr.clone());
                }
            }
        }
    }

    let mut cmd = std::process::Command::new("curl");
    cmd.args([
        "-4",
        "--http1.1",
        "-sL",
        "--fail",
        "--retry",
        "3",
        "--retry-delay",
        "2",
        "--max-time",
        "15",
        "-H",
        "User-Agent: SIMP/0.1.0-alpha (https://github.com/niiiitz/simp)",
        "-H",
        "Accept: application/json",
        url,
    ]);
    crate::configure_background_command(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() || out.stdout.is_empty() {
        return None;
    }
    let json = serde_json::from_slice::<serde_json::Value>(&out.stdout).ok()?;
    json.get("releases")
        .and_then(|v| v.as_array())
        .cloned()
}

fn download_cover_art_to(url: &str, dest_path: &Path) -> bool {
    if let Ok(bytes) = crate::http_pool::http_get_bytes(
        url,
        &[("User-Agent", "SIMP/0.1.0-alpha (https://github.com/niiiitz/simp)")],
        None,
        10,
    ) {
        if bytes.len() > 512 && fs::write(dest_path, &bytes).is_ok() {
            return true;
        }
    }

    let mut cmd = std::process::Command::new("curl");
    cmd.args([
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
    ]);
    crate::configure_background_command(&mut cmd);
    let status = cmd.status();
    if status.map(|s| s.success()).unwrap_or(false)
        && dest_path.metadata().map(|m| m.len() > 512).unwrap_or(false)
    {
        true
    } else {
        let _ = fs::remove_file(dest_path);
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_musicbrainz_title_and_artist_normalization() {
        assert_eq!(
            urlencode_lucene("Synth_Wave_On_the_Horizon"),
            "Synth%20Wave%20On%20the%20Horizon"
        );
        assert_eq!(
            normalize_title_for_match("Synth_Wave_On_the_Horizon"),
            normalize_title_for_match("SYNTHWAVE ON THE HORIZON")
        );
        assert_eq!(extract_primary_artist("Nova & Guest Vocalist"), "Nova");
        let norm_primary =
            normalize_title_for_match(extract_primary_artist("Nova & Guest Vocalist"));
        let norm_mb = normalize_title_for_match("NOVAPOP");
        assert!(norm_mb.contains(&norm_primary));
    }
}
