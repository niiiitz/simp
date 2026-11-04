use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STD, Engine as _};
use serde::{Deserialize, Serialize};
use std::process::Command;

/// Widevine UUID in ISO-BMFF `pssh` boxes (`edef8ba9-79d6-4ace-a3c8-27dcd51d21ed`).
pub const WIDEVINE_SYSTEM_ID: [u8; 16] = [
    0xed, 0xef, 0x8b, 0xa9, 0x79, 0xd6, 0x4a, 0xce, 0xa3, 0xc8, 0x27, 0xdc, 0xd5, 0x1d, 0x21, 0xed,
];

/// Represents a byte-range slice (`length@offset`) inside a single-file fMP4 HLS stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct HlsByteRange {
    pub offset: u64,
    pub length: u64,
}

/// Represents a single encrypted fMP4 media segment (`#EXTINF`) in an Apple Music HLS playlist.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HlsMediaSegment {
    pub url: String,
    pub duration_secs: f64,
    pub byte_range: Option<HlsByteRange>,
}

/// Parsed representation of an Apple Music HLS Media Playlist (`.m3u8`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppleHlsMediaPlaylist {
    /// URL of the media `.m3u8` itself (used to resolve relative segment/map URIs).
    pub playlist_url: String,
    /// Initialization segment (`#EXT-X-MAP:URI="..."`) containing the `moov` box.
    pub init_segment_url: Option<String>,
    pub init_byte_range: Option<HlsByteRange>,
    /// Encryption method reported in `#EXT-X-KEY` (e.g., `SAMPLE-AES-CTR` or `ISO-23001-7`).
    pub encryption_method: Option<String>,
    /// Raw Widevine `pssh` box (or init data payload) decoded from `data:text/plain;base64,...`.
    pub widevine_pssh_b64: Option<String>,
    pub widevine_pssh_bytes: Vec<u8>,
    /// Ordered list of media segments (`#EXTINF`).
    pub segments: Vec<HlsMediaSegment>,
}

/// Resolves a possibly-relative URI against a base URL.
pub fn resolve_relative_url(base_url: &str, target: &str) -> String {
    let trimmed = target.trim();
    if trimmed.starts_with("https://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("data:")
    {
        return trimmed.to_string();
    }
    if trimmed.starts_with('/') {
        if let Some(scheme_idx) = base_url.find("://") {
            let after_scheme = &base_url[scheme_idx + 3..];
            if let Some(slash_idx) = after_scheme.find('/') {
                let origin = &base_url[..scheme_idx + 3 + slash_idx];
                return format!("{origin}{trimmed}");
            }
        }
    }
    match base_url.rfind('/') {
        Some(idx) => format!("{}/{}", &base_url[..idx], trimmed),
        None => trimmed.to_string(),
    }
}

/// Parses an HLS attribute list like `METHOD=SAMPLE-AES-CTR,URI="data:text/plain;base64,...",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"`
fn parse_hls_attributes(attr_line: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = attr_line.trim();
    while !rest.is_empty() {
        let Some(eq_idx) = rest.find('=') else { break };
        let key = rest[..eq_idx].trim().to_uppercase();
        rest = rest[eq_idx + 1..].trim_start();
        if let Some(stripped) = rest.strip_prefix('"') {
            if let Some(end_quote) = stripped.find('"') {
                let val = stripped[..end_quote].to_string();
                out.push((key, val));
                rest = stripped[end_quote + 1..].trim_start();
                if let Some(after_comma) = rest.strip_prefix(',') {
                    rest = after_comma.trim_start();
                }
            } else {
                out.push((key, stripped.to_string()));
                break;
            }
        } else if let Some(comma_idx) = rest.find(',') {
            let val = rest[..comma_idx].trim().to_string();
            out.push((key, val));
            rest = rest[comma_idx + 1..].trim_start();
        } else {
            out.push((key, rest.trim().to_string()));
            break;
        }
    }
    out
}

fn parse_byte_range_spec(spec: &str, prev_end: u64) -> Option<HlsByteRange> {
    let clean = spec.trim().trim_matches('"');
    if let Some((len_str, off_str)) = clean.split_once('@') {
        let length = len_str.trim().parse::<u64>().ok()?;
        let offset = off_str.trim().parse::<u64>().ok()?;
        Some(HlsByteRange { offset, length })
    } else {
        let length = clean.parse::<u64>().ok()?;
        Some(HlsByteRange {
            offset: prev_end,
            length,
        })
    }
}

/// Ensures raw Widevine init data is wrapped in a complete ISO-BMFF `pssh` box (`[size][pssh][0x00000000][system_id][data_len][data]`)
/// if Apple's `#EXT-X-KEY` URI only base64-encoded the inner Widevine protobuf payload.
pub fn ensure_full_widevine_pssh_box(raw_bytes: &[u8]) -> Vec<u8> {
    if raw_bytes.len() >= 12 && &raw_bytes[4..8] == b"pssh" {
        return raw_bytes.to_vec();
    }
    let total_len = (32 + raw_bytes.len()) as u32;
    let mut box_bytes = Vec::with_capacity(total_len as usize);
    box_bytes.extend_from_slice(&total_len.to_be_bytes());
    box_bytes.extend_from_slice(b"pssh");
    box_bytes.extend_from_slice(&0u32.to_be_bytes()); // version 0, flags 0
    box_bytes.extend_from_slice(&WIDEVINE_SYSTEM_ID);
    box_bytes.extend_from_slice(&(raw_bytes.len() as u32).to_be_bytes());
    box_bytes.extend_from_slice(raw_bytes);
    box_bytes
}

/// If `m3u8_text` is a Master Playlist (`#EXT-X-STREAM-INF`), selects the preferred audio variant URL.
/// Otherwise returns `None` (indicating `m3u8_text` is already a Media Playlist).
pub fn extract_variant_from_master_m3u8(base_url: &str, m3u8_text: &str) -> Option<String> {
    if !m3u8_text.contains("#EXT-X-STREAM-INF") {
        return None;
    }

    let mut candidates: Vec<(u64, String)> = Vec::new();
    let mut pending_bw: Option<u64> = None;

    for raw_line in m3u8_text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(attrs_str) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            let attrs = parse_hls_attributes(attrs_str);
            let mut bw = 128_000u64;
            for (k, v) in &attrs {
                if k == "AVERAGE-BANDWIDTH" || k == "BANDWIDTH" {
                    if let Ok(parsed) = v.parse::<u64>() {
                        bw = parsed;
                    }
                }
            }
            pending_bw = Some(bw);
        } else if !line.starts_with('#') {
            if let Some(bw) = pending_bw.take() {
                candidates.push((bw, resolve_relative_url(base_url, line)));
            }
        }
    }

    // Prefer ~256kbps AAC-LC variant (or highest bandwidth AAC variant)
    candidates.sort_by_key(|(bw, _)| *bw);
    candidates.pop().map(|(_, url)| url)
}

/// Parses an Apple Music HLS Media Playlist (`.m3u8`) into structured init segment, Widevine PSSH,
/// and media segment descriptors.
pub fn parse_apple_media_m3u8(playlist_url: &str, m3u8_text: &str) -> Result<AppleHlsMediaPlaylist> {
    let mut init_segment_url: Option<String> = None;
    let mut init_byte_range: Option<HlsByteRange> = None;
    let mut encryption_method: Option<String> = None;
    let mut widevine_pssh_b64: Option<String> = None;
    let mut widevine_pssh_bytes: Vec<u8> = Vec::new();
    let mut segments: Vec<HlsMediaSegment> = Vec::new();

    let mut pending_duration: Option<f64> = None;
    let mut pending_byte_range: Option<HlsByteRange> = None;
    let mut last_byte_range_end: u64 = 0;

    for raw_line in m3u8_text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(map_attrs_str) = line.strip_prefix("#EXT-X-MAP:") {
            let attrs = parse_hls_attributes(map_attrs_str);
            for (k, v) in attrs {
                if k == "URI" {
                    init_segment_url = Some(resolve_relative_url(playlist_url, &v));
                } else if k == "BYTERANGE" {
                    init_byte_range = parse_byte_range_spec(&v, 0);
                    if let Some(br) = init_byte_range {
                        last_byte_range_end = br.offset + br.length;
                    }
                }
            }
        } else if let Some(key_attrs_str) = line.strip_prefix("#EXT-X-KEY:") {
            let attrs = parse_hls_attributes(key_attrs_str);
            let mut keyformat = String::new();
            let mut uri = String::new();
            let mut method = String::new();
            for (k, v) in attrs {
                match k.as_str() {
                    "KEYFORMAT" => keyformat = v.to_lowercase(),
                    "URI" => uri = v,
                    "METHOD" => method = v,
                    _ => {}
                }
            }
            if !method.is_empty() && method != "NONE" {
                encryption_method = Some(method);
            }
            // Match Widevine UUID (`edef8ba9-79d6-4ace-a3c8-27dcd51d21ed`) or default data URI key
            let is_widevine = keyformat.contains("edef8ba9-79d6-4ace-a3c8-27dcd51d21ed")
                || (keyformat.is_empty() && uri.starts_with("data:"));
            if is_widevine {
                if let Some(idx) = uri.find(";base64,") {
                    let b64 = uri[idx + 8..].trim();
                    if let Ok(decoded) = BASE64_STD.decode(b64) {
                        let full_pssh = ensure_full_widevine_pssh_box(&decoded);
                        widevine_pssh_b64 = Some(BASE64_STD.encode(&full_pssh));
                        widevine_pssh_bytes = full_pssh;
                    }
                }
            }
        } else if let Some(br_str) = line.strip_prefix("#EXT-X-BYTERANGE:") {
            pending_byte_range = parse_byte_range_spec(br_str, last_byte_range_end);
        } else if let Some(inf_str) = line.strip_prefix("#EXTINF:") {
            let dur_part = inf_str.split(',').next().unwrap_or("0").trim();
            pending_duration = dur_part.parse::<f64>().ok();
        } else if !line.starts_with('#') {
            let seg_url = resolve_relative_url(playlist_url, line);
            let duration_secs = pending_duration.take().unwrap_or(0.0);
            let byte_range = pending_byte_range.take();
            if let Some(br) = byte_range {
                last_byte_range_end = br.offset + br.length;
            }
            segments.push(HlsMediaSegment {
                url: seg_url,
                duration_secs,
                byte_range,
            });
        }
    }

    if segments.is_empty() {
        return Err(anyhow!("No media segments found in HLS playlist ({playlist_url})"));
    }

    Ok(AppleHlsMediaPlaylist {
        playlist_url: playlist_url.to_string(),
        init_segment_url,
        init_byte_range,
        encryption_method,
        widevine_pssh_b64,
        widevine_pssh_bytes,
        segments,
    })
}

/// Fetches raw bytes (with optional HTTP `Range: bytes=start-end`) from an Apple CDN URL.
pub fn fetch_hls_bytes(url: &str, byte_range: Option<HlsByteRange>) -> Result<Vec<u8>> {
    let mut cmd = Command::new("curl");
    cmd.args(["-fsSL", "--max-time", "20"]);
    if let Some(br) = byte_range {
        if br.length > 0 {
            let end = br.offset + br.length - 1;
            cmd.args(["-H", &format!("Range: bytes={}-{}", br.offset, end)]);
        }
    }
    cmd.arg(url);
    let out = cmd
        .output()
        .with_context(|| format!("Failed to invoke curl for {url}"))?;
    if !out.status.success() {
        return Err(anyhow!(
            "HTTP GET failed for {}: {}",
            url,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(out.stdout)
}

/// Downloads and parses an Apple Music HLS playlist URL (automatically following a Master Playlist
/// to its best audio Media Playlist if needed).
pub fn fetch_and_parse_apple_hls(playlist_url: &str) -> Result<AppleHlsMediaPlaylist> {
    let raw_bytes = fetch_hls_bytes(playlist_url, None)?;
    let text = String::from_utf8(raw_bytes).context("HLS playlist was not valid UTF-8")?;
    if let Some(variant_url) = extract_variant_from_master_m3u8(playlist_url, &text) {
        let media_bytes = fetch_hls_bytes(&variant_url, None)?;
        let media_text =
            String::from_utf8(media_bytes).context("HLS variant playlist was not valid UTF-8")?;
        parse_apple_media_m3u8(&variant_url, &media_text)
    } else {
        parse_apple_media_m3u8(playlist_url, &text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_apple_media_m3u8_extracts_widevine_pssh_map_and_byteranges() {
        let sample_m3u8 = r#"#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="data:text/plain;base64,AAAANHBzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAABQIARIQ1234567890abcdef1234",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",KEYFORMATVERSIONS="1"
#EXT-X-MAP:URI="aod_stream_256.mp4",BYTERANGE="942@0"
#EXTINF:5.99075,
#EXT-X-BYTERANGE:192480@942
aod_stream_256.mp4
#EXTINF:5.99075,
#EXT-X-BYTERANGE:191120
aod_stream_256.mp4
#EXT-X-ENDLIST
"#;

        let parsed = parse_apple_media_m3u8(
            "https://aod-ssl.itunes.apple.com/itunes-assets/Audio/v4/12/34/prog_index.m3u8",
            sample_m3u8,
        )
        .expect("should parse m3u8");

        assert_eq!(
            parsed.init_segment_url.as_deref(),
            Some("https://aod-ssl.itunes.apple.com/itunes-assets/Audio/v4/12/34/aod_stream_256.mp4")
        );
        assert_eq!(
            parsed.init_byte_range,
            Some(HlsByteRange {
                offset: 0,
                length: 942
            })
        );
        assert_eq!(parsed.encryption_method.as_deref(), Some("SAMPLE-AES-CTR"));
        assert!(!parsed.widevine_pssh_bytes.is_empty());
        assert_eq!(&parsed.widevine_pssh_bytes[4..8], b"pssh");
        assert_eq!(parsed.segments.len(), 2);
        assert_eq!(
            parsed.segments[0].byte_range,
            Some(HlsByteRange {
                offset: 942,
                length: 192480
            })
        );
        assert_eq!(
            parsed.segments[1].byte_range,
            Some(HlsByteRange {
                offset: 942 + 192480,
                length: 191120
            })
        );
    }
}

