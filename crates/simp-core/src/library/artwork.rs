use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, PictureType};
use lofty::probe::Probe;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Artwork Fallback Cascade:
/// 1. Embedded ID3v2 APIC / Vorbis PICTURE (`lofty`)
/// 2. Parent directory scan (`album_art.png`, `cover.jpg`, `cover.png`, `AlbumArt.jpg`, `folder.jpg`, or any `.jpg`/`.png` in the album directory)
///
/// Writes to `/tmp/simp_art_{hash}.{ext}` (for `souvlaki` MPRIS2 QAM cache-busting)
/// and `~/.cache/simp/art/{hash}.{ext}` (served over `http://127.0.0.1:18888/art/{hash}.{ext}`).
pub struct ExtractedArtwork {
    pub mpris_file_uri: String,
    pub http_art_url: String,
    pub cache_file_path: String,
}

pub fn resolve_and_cache_artwork(audio_file_path: &Path) -> Option<ExtractedArtwork> {
    if let Some((bytes, ext)) = extract_embedded_bytes(audio_file_path) {
        return write_art_bytes(&bytes, ext);
    }

    if let Some(parent) = audio_file_path.parent() {
        let priority_candidates = [
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
        for name in priority_candidates {
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
                    return write_art_bytes(&bytes, ext);
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
                                return write_art_bytes(&bytes, ext);
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

fn write_art_bytes(bytes: &[u8], ext: &str) -> Option<ExtractedArtwork> {
    let hash = blake3::hash(bytes).to_hex();
    let short_hash = &hash.as_str()[..16];
    let filename = format!("simp_art_{short_hash}.{ext}");

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
