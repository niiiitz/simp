use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// Registered public LRCLIB App ID for SIMP (`https://lrclib.net/docs`).
pub const LRCLIB_APP_ID: &str = "kryw9SKiYEUW54S7gCwM3-SLp4McSiBzeIcJRdUN-2w";
pub const LRCLIB_USER_AGENT: &str = "SIMP/0.1.0 (https://github.com/niiiitz/simp)";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncedLyricLine {
    pub timestamp_ms: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TrackLyricsResponse {
    pub found: bool,
    pub instrumental: bool,
    /// `"local_lrc"` | `"lrclib_v2"` | `"lrclib_v1"` | `"none"`
    pub source: String,
    pub track_name: Option<String>,
    pub artist_name: Option<String>,
    pub album_name: Option<String>,
    pub synced_lines: Vec<SyncedLyricLine>,
    pub plain_lyrics: Option<String>,
    pub lrclib_id: Option<u64>,
}

static LYRICS_MEM_CACHE: OnceLock<Mutex<HashMap<String, TrackLyricsResponse>>> = OnceLock::new();

fn lyrics_cache() -> &'static Mutex<HashMap<String, TrackLyricsResponse>> {
    LYRICS_MEM_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Cleans common streaming/uploader noise (`(Official Audio)`, `[feat. ...]`, `"Artist - Title"`, etc.)
/// so LRCLIB lookups succeed on SoundCloud, Local, Internet Archive, and Apple Music tracks alike.
pub fn clean_metadata_for_lyrics(raw_title: &str, raw_artist: &str) -> (String, String) {
    let mut title = raw_title.trim().to_string();
    let mut artist = raw_artist
        .trim()
        .trim_end_matches(" - Topic")
        .trim()
        .to_string();

    // If title is formatted as "Artist - Song Title" (common on SoundCloud & Local MP3s), split it
    if let Some((left, right)) = title.split_once(" - ").or_else(|| title.split_once(" – ")) {
        let left_trim = left.trim();
        let right_trim = right.trim();
        if !left_trim.is_empty() && !right_trim.is_empty() {
            if artist.is_empty()
                || artist.eq_ignore_ascii_case("unknown artist")
                || artist.eq_ignore_ascii_case(left_trim)
                || left_trim.to_lowercase().contains(&artist.to_lowercase())
            {
                artist = left_trim.to_string();
                title = right_trim.to_string();
            }
        }
    }

    // Strip bracketed/parenthetical noise tags at the end of the title
    let noise_keywords = [
        "official audio",
        "official video",
        "official music video",
        "official lyric",
        "lyric video",
        "lyrics",
        "visualizer",
        "remastered",
        "remaster",
        "hd",
        "hq",
        "4k",
        "free dl",
        "free download",
        "out now",
        "premiere",
        "explicit",
        "clean",
        "feat.",
        "feat ",
        "ft.",
        "ft ",
        "prod.",
        "prod ",
        "produced by",
    ];

    loop {
        let trimmed = title.trim();
        let mut changed = false;
        for (open_ch, close_ch) in [('(', ')'), ('[', ']')] {
            if trimmed.ends_with(close_ch) {
                if let Some(open_idx) = trimmed.rfind(open_ch) {
                    let inside = trimmed[open_idx + 1..trimmed.len() - 1].to_lowercase();
                    if noise_keywords.iter().any(|kw| inside.contains(kw)) {
                        title = trimmed[..open_idx].trim().to_string();
                        changed = true;
                        break;
                    }
                }
            }
        }
        if !changed {
            break;
        }
    }

    // Also strip trailing " feat. X" or " ft. X" outside parentheses
    let lower_title = title.to_lowercase();
    for marker in [" feat. ", " feat ", " ft. ", " ft ", " (feat", " [feat"] {
        if let Some(idx) = lower_title.find(marker) {
            if idx > 1 {
                title = title[..idx].trim().to_string();
                break;
            }
        }
    }

    // If artist has multiple comma/ampersand-separated names, keep the primary artist for cleaner search
    if let Some((first_artist, _)) = artist.split_once(", ") {
        if !first_artist.trim().is_empty() {
            artist = first_artist.trim().to_string();
        }
    }

    (title.trim().to_string(), artist.trim().to_string())
}

/// Parses standard & enhanced `.lrc` timestamped lyrics (`[mm:ss.xx]`, `[mm:ss.xxx]`, `[mm:ss]`)
/// into sorted `SyncedLyricLine` entries.
pub fn parse_synced_lrc(lrc_text: &str) -> Vec<SyncedLyricLine> {
    let mut lines = Vec::new();
    let mut global_offset_ms: i64 = 0;

    for raw_line in lrc_text.lines() {
        let mut rest = raw_line.trim();
        if rest.is_empty() {
            continue;
        }

        // Check for `[offset:+/-ms]` header tag
        if let Some(after_offset) = rest
            .strip_prefix("[offset:")
            .or_else(|| rest.strip_prefix("[OFFSET:"))
        {
            if let Some(end_idx) = after_offset.find(']') {
                if let Ok(off) = after_offset[..end_idx].trim().parse::<i64>() {
                    global_offset_ms = off;
                }
            }
            continue;
        }

        let mut timestamps_ms = Vec::new();
        while rest.starts_with('[') {
            let Some(close_idx) = rest.find(']') else {
                break;
            };
            let tag = &rest[1..close_idx];
            if let Some(ts) = parse_lrc_timestamp_tag(tag) {
                timestamps_ms.push(ts);
                rest = &rest[close_idx + 1..];
            } else {
                break;
            }
        }

        if timestamps_ms.is_empty() {
            continue;
        }

        // Strip inline word-level `<mm:ss.xx>` Enhanced LRC tags if present
        let cleaned_text = strip_inline_angle_timestamps(rest.trim());
        for raw_ts in timestamps_ms {
            let adjusted = (raw_ts as i64 - global_offset_ms).max(0) as u32;
            lines.push(SyncedLyricLine {
                timestamp_ms: adjusted,
                text: cleaned_text.clone(),
            });
        }
    }

    lines.sort_by_key(|l| l.timestamp_ms);
    lines
}

fn parse_lrc_timestamp_tag(tag: &str) -> Option<u32> {
    let trimmed = tag.trim();
    let (mins_str, secs_part) = trimmed.split_once(':')?;
    let mins: u32 = mins_str.trim().parse().ok()?;

    let (secs_str, frac_str) = if let Some((s, f)) = secs_part.split_once('.') {
        (s, Some(f))
    } else if let Some((s, f)) = secs_part.split_once(':') {
        (s, Some(f))
    } else {
        (secs_part, None)
    };

    let secs: u32 = secs_str.trim().parse().ok()?;
    if secs >= 60 || mins > 600 {
        return None;
    }

    let frac_ms: u32 = match frac_str {
        Some(f) => {
            let digits: String = f.chars().take_while(|c| c.is_ascii_digit()).collect();
            match digits.len() {
                0 => 0,
                1 => digits.parse::<u32>().ok()? * 100,
                2 => digits.parse::<u32>().ok()? * 10,
                3 => digits.parse::<u32>().ok()?,
                _ => digits[..3].parse::<u32>().ok()?,
            }
        }
        None => 0,
    };

    Some((mins * 60 + secs) * 1000 + frac_ms)
}

fn strip_inline_angle_timestamps(text: &str) -> String {
    if !text.contains('<') || !text.contains('>') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '<' {
            let mut inside = String::new();
            let mut closed = false;
            for next_ch in chars.by_ref() {
                if next_ch == '>' {
                    closed = true;
                    break;
                }
                inside.push(next_ch);
            }
            if !closed || parse_lrc_timestamp_tag(&inside).is_none() {
                out.push('<');
                out.push_str(&inside);
                if closed {
                    out.push('>');
                }
            }
        } else {
            out.push(ch);
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn try_load_local_sidecar_lrc(uri: &str) -> Option<TrackLyricsResponse> {
    let raw_path = if let Some(stripped) = uri.strip_prefix("file://") {
        stripped
    } else if uri.starts_with('/') || (uri.len() > 2 && uri.as_bytes()[1] == b':') {
        uri
    } else {
        return None;
    };

    let audio_path = Path::new(raw_path);
    let lrc_path = audio_path.with_extension("lrc");
    if lrc_path.is_file() {
        if let Ok(raw_lrc) = std::fs::read_to_string(&lrc_path) {
            let synced_lines = parse_synced_lrc(&raw_lrc);
            if !synced_lines.is_empty() {
                let plain = synced_lines
                    .iter()
                    .map(|l| l.text.as_str())
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n");
                return Some(TrackLyricsResponse {
                    found: true,
                    instrumental: false,
                    source: "local_lrc".to_string(),
                    track_name: None,
                    artist_name: None,
                    album_name: None,
                    synced_lines,
                    plain_lyrics: if plain.is_empty() { None } else { Some(plain) },
                    lrclib_id: None,
                });
            }
        }
    }
    None
}

fn lrclib_get_json(url: &str) -> Result<Value> {
    let headers = [
        ("Lrclib-App-Id", LRCLIB_APP_ID),
        ("User-Agent", LRCLIB_USER_AGENT),
        ("Accept", "application/json"),
    ];
    let bytes = crate::http_pool::http_get_bytes(url, &headers, None, 7)?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn parse_lrclib_record(item: &Value, source_label: &str) -> Option<TrackLyricsResponse> {
    let id = item.get("id").and_then(|v| v.as_u64());
    let instrumental = item
        .get("instrumental")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let track_name = item
        .get("trackName")
        .or_else(|| item.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let artist_name = item
        .get("artistName")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let album_name = item
        .get("albumName")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let synced_raw = item
        .get("syncedLyrics")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let plain_raw = item
        .get("plainLyrics")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let synced_lines = synced_raw.map(parse_synced_lrc).unwrap_or_default();

    if !instrumental && synced_lines.is_empty() && plain_raw.is_none() {
        return None;
    }

    let plain_lyrics = plain_raw.or_else(|| {
        if !synced_lines.is_empty() {
            Some(
                synced_lines
                    .iter()
                    .map(|l| l.text.as_str())
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n"),
            )
        } else {
            None
        }
    });

    Some(TrackLyricsResponse {
        found: true,
        instrumental,
        source: source_label.to_string(),
        track_name,
        artist_name,
        album_name,
        synced_lines,
        plain_lyrics,
        lrclib_id: id,
    })
}

fn score_lrclib_candidate(
    item: &Value,
    target_title_lower: &str,
    target_artist_lower: &str,
    target_dur_sec: u32,
) -> i32 {
    let cand_title = item
        .get("trackName")
        .or_else(|| item.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let cand_artist = item
        .get("artistName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let cand_dur = item
        .get("duration")
        .and_then(|v| v.as_f64())
        .map(|d| d.round() as u32)
        .unwrap_or(0);

    let mut score: i32 = 0;

    // Title similarity
    if cand_title == target_title_lower {
        score += 60;
    } else if cand_title.starts_with(target_title_lower)
        || target_title_lower.starts_with(&cand_title)
    {
        score += 40;
    } else if cand_title.contains(target_title_lower)
        || target_title_lower.contains(&cand_title)
    {
        score += 20;
    } else {
        score -= 40;
    }

    // Artist similarity
    if !target_artist_lower.is_empty() {
        if cand_artist == target_artist_lower {
            score += 55;
        } else if cand_artist.contains(target_artist_lower)
            || target_artist_lower.contains(&cand_artist)
        {
            score += 35;
        } else {
            score -= 25;
        }
    }

    // Prefer synced lyrics strongly
    let has_synced = item
        .get("syncedLyrics")
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .or_else(|| item.get("hasSyncedLyrics").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    let has_plain = item
        .get("plainLyrics")
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .or_else(|| item.get("hasPlainLyrics").and_then(|v| v.as_bool()))
        .unwrap_or(false);

    if has_synced {
        score += 50;
    } else if has_plain {
        score += 15;
    }

    // Duration proximity
    if target_dur_sec > 15 && cand_dur > 15 {
        let diff = target_dur_sec.abs_diff(cand_dur);
        if diff <= 2 {
            score += 35;
        } else if diff <= 5 {
            score += 22;
        } else if diff <= 12 {
            score += 8;
        } else if diff > 35 {
            score -= 30;
        }
    }

    score
}

/// Resolves synchronized (or plain) lyrics for a track using:
/// 1. In-memory cache & local `.lrc` sidecar file (if local track)
/// 2. `GET https://lrclib.net/api/get` exact match
/// 3. `GET https://lrclib.net/api/v2/search` (LRCLIB v2 Beta with `Lrclib-App-Id` header) + `/api/get/{id}` hydration
/// 4. `GET https://lrclib.net/api/search` v1 fallback
pub fn fetch_track_lyrics(
    uri: Option<&str>,
    raw_title: &str,
    raw_artist: &str,
    raw_album: Option<&str>,
    duration_ms: u32,
) -> TrackLyricsResponse {
    let (clean_title, clean_artist) = clean_metadata_for_lyrics(raw_title, raw_artist);
    if clean_title.is_empty() {
        return TrackLyricsResponse {
            found: false,
            source: "none".to_string(),
            ..Default::default()
        };
    }

    let dur_sec = (duration_ms / 1000).max(0);
    let cache_key = format!(
        "{}|{}|{}|{}",
        uri.unwrap_or(""),
        clean_artist.to_lowercase(),
        clean_title.to_lowercase(),
        dur_sec
    );

    if let Ok(guard) = lyrics_cache().lock() {
        if let Some(cached) = guard.get(&cache_key) {
            return cached.clone();
        }
    }

    // 1. Check for local `.lrc` sidecar file next to audio file
    if let Some(u) = uri {
        if let Some(local_hit) = try_load_local_sidecar_lrc(u) {
            if let Ok(mut guard) = lyrics_cache().lock() {
                guard.insert(cache_key, local_hit.clone());
            }
            return local_hit;
        }
    }

    let clean_album = raw_album
        .map(|a| a.trim().trim_start_matches("☁️ ").trim())
        .filter(|a| {
            !a.is_empty()
                && !a.eq_ignore_ascii_case("unknown album")
                && !a.eq_ignore_ascii_case("soundcloud")
                && !a.eq_ignore_ascii_case("apple music")
        });

    // 2. Try exact match via `/api/get` when artist + title + duration are known
    if !clean_artist.is_empty() && dur_sec >= 15 && dur_sec <= 3600 {
        let mut get_url = format!(
            "https://lrclib.net/api/get?track_name={}&artist_name={}&duration={}",
            urlencode(&clean_title),
            urlencode(&clean_artist),
            dur_sec
        );
        if let Some(alb) = clean_album {
            get_url.push_str(&format!("&album_name={}", urlencode(alb)));
        }
        if let Ok(json) = lrclib_get_json(&get_url) {
            if let Some(parsed) = parse_lrclib_record(&json, "lrclib_v1") {
                if !parsed.synced_lines.is_empty() {
                    if let Ok(mut guard) = lyrics_cache().lock() {
                        guard.insert(cache_key, parsed.clone());
                    }
                    return parsed;
                }
            }
        }
    }

    let target_title_lower = clean_title.to_lowercase();
    let target_artist_lower = clean_artist.to_lowercase();

    // 3. Query LRCLIB v2 Beta (`GET /api/v2/search`) with `Lrclib-App-Id` header
    let v2_url = if !clean_artist.is_empty() {
        format!(
            "https://lrclib.net/api/v2/search?track_name={}&artist_name={}",
            urlencode(&clean_title),
            urlencode(&clean_artist)
        )
    } else {
        format!(
            "https://lrclib.net/api/v2/search?q={}",
            urlencode(&clean_title)
        )
    };

    if let Ok(v2_json) = lrclib_get_json(&v2_url) {
        let candidates = v2_json
            .as_array()
            .cloned()
            .or_else(|| v2_json.get("data").and_then(|v| v.as_array()).cloned())
            .unwrap_or_default();

        let mut best_cand: Option<(i32, Value)> = None;
        for item in candidates {
            let sc = score_lrclib_candidate(&item, &target_title_lower, &target_artist_lower, dur_sec);
            if sc >= 35 {
                if best_cand.as_ref().map(|(b, _)| sc > *b).unwrap_or(true) {
                    best_cand = Some((sc, item));
                }
            }
        }

        if let Some((_, winner)) = best_cand {
            if let Some(inline_parsed) = parse_lrclib_record(&winner, "lrclib_v2") {
                if let Ok(mut guard) = lyrics_cache().lock() {
                    guard.insert(cache_key, inline_parsed.clone());
                }
                return inline_parsed;
            }
            if let Some(id) = winner.get("id").and_then(|v| v.as_u64()) {
                let get_by_id_url = format!("https://lrclib.net/api/get/{id}");
                if let Ok(hydrated) = lrclib_get_json(&get_by_id_url) {
                    if let Some(parsed) = parse_lrclib_record(&hydrated, "lrclib_v2") {
                        if let Ok(mut guard) = lyrics_cache().lock() {
                            guard.insert(cache_key, parsed.clone());
                        }
                        return parsed;
                    }
                }
            }
        }
    }

    // 4. Fallback to `/api/search?q=...` (LRCLIB v1 search)
    let q_str = if !clean_artist.is_empty() {
        format!("{clean_artist} {clean_title}")
    } else {
        clean_title.clone()
    };
    let v1_search_url = format!("https://lrclib.net/api/search?q={}", urlencode(&q_str));
    if let Ok(v1_json) = lrclib_get_json(&v1_search_url) {
        if let Some(arr) = v1_json.as_array() {
            let mut best_cand: Option<(i32, &Value)> = None;
            for item in arr {
                let sc = score_lrclib_candidate(item, &target_title_lower, &target_artist_lower, dur_sec);
                if sc >= 35 {
                    if best_cand.as_ref().map(|(b, _)| sc > *b).unwrap_or(true) {
                        best_cand = Some((sc, item));
                    }
                }
            }
            if let Some((_, winner)) = best_cand {
                if let Some(parsed) = parse_lrclib_record(winner, "lrclib_v1") {
                    if let Ok(mut guard) = lyrics_cache().lock() {
                        if guard.len() > 256 {
                            guard.clear();
                        }
                        guard.insert(cache_key, parsed.clone());
                    }
                    return parsed;
                }
            }
        }
    }

    let empty = TrackLyricsResponse {
        found: false,
        source: "none".to_string(),
        ..Default::default()
    };
    if let Ok(mut guard) = lyrics_cache().lock() {
        if guard.len() > 256 {
            guard.clear();
        }
        guard.insert(cache_key, empty.clone());
    }
    empty
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_synced_lrc_timestamps_and_sorting() {
        let sample = r#"
[ti: Harder, Better, Faster, Stronger]
[ar: Daft Punk]
[00:04.50]Work it, make it
[00:06.125]Do it, makes us
[00:10.00][00:20.00]Harder, better, faster, stronger
"#;
        let parsed = parse_synced_lrc(sample);
        assert_eq!(parsed.len(), 4);
        assert_eq!(parsed[0].timestamp_ms, 4500);
        assert_eq!(parsed[0].text, "Work it, make it");
        assert_eq!(parsed[1].timestamp_ms, 6125);
        assert_eq!(parsed[2].timestamp_ms, 10_000);
        assert_eq!(parsed[3].timestamp_ms, 20_000);
        assert_eq!(parsed[3].text, "Harder, better, faster, stronger");
    }

    #[test]
    fn test_clean_metadata_for_lyrics() {
        let (title, artist) = clean_metadata_for_lyrics(
            "Bicep - Glue (Official Music Video) [HD]",
            "Bicep - Topic",
        );
        assert_eq!(title, "Glue");
        assert_eq!(artist, "Bicep");

        let (t2, a2) = clean_metadata_for_lyrics(
            "Nightcall (feat. Lovefoxxx) (Official Audio)",
            "Kavinsky, Lovefoxxx",
        );
        assert_eq!(t2, "Nightcall");
        assert_eq!(a2, "Kavinsky");
    }
}

