use crate::http_pool::http_get_bytes;
use crate::lyrics::with_lyrics_db;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

fn http_get_text(url: &str, headers: &[(&str, &str)], timeout_secs: u64) -> anyhow::Result<String> {
    let bytes = http_get_bytes(url, headers, None, timeout_secs)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactoidBubble {
    pub category: String,
    pub headline: String,
    pub body: String,
    pub source: String,
    pub start_sec: u32,
    pub duration_sec: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackFactoidsResponse {
    pub found: bool,
    pub provider: String,
    pub bubbles: Vec<FactoidBubble>,
}

fn normalize_key(title: &str, artist: &str, album: Option<&str>) -> String {
    format!(
        "{}::{}::{}",
        artist.trim().to_lowercase(),
        title.trim().to_lowercase(),
        album.unwrap_or("").trim().to_lowercase()
    )
}

fn load_factoids_from_db(
    track_key: &str,
    track_uri: Option<&str>,
) -> Option<TrackFactoidsResponse> {
    with_lyrics_db(|conn| {
        conn.query_row(
            "SELECT factoids_json, provider
             FROM factoid_entries
             WHERE track_key = ?1
                OR (?2 != '' AND track_uri = ?2)
             ORDER BY CASE WHEN track_key = ?1 THEN 0 ELSE 1 END
             LIMIT 1",
            params![track_key, track_uri.unwrap_or("")],
            |row| {
                let json_str: String = row.get(0)?;
                let provider: String = row.get(1)?;
                let bubbles: Vec<FactoidBubble> =
                    serde_json::from_str(&json_str).unwrap_or_default();
                Ok(TrackFactoidsResponse {
                    found: !bubbles.is_empty(),
                    provider,
                    bubbles,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
    })
}

fn save_factoids_to_db(
    track_key: &str,
    track_uri: Option<&str>,
    title: &str,
    artist: &str,
    album: Option<&str>,
    resp: &TrackFactoidsResponse,
) {
    if !resp.found || resp.bubbles.is_empty() {
        return;
    }
    let Ok(json_str) = serde_json::to_string(&resp.bubbles) else {
        return;
    };
    let now_sec = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let _ = with_lyrics_db(|conn| {
        let _ = conn.execute(
            "INSERT INTO factoid_entries (
                track_key, track_uri, title, artist, album, factoids_json, provider, fetched_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(track_key) DO UPDATE SET
                track_uri = CASE WHEN excluded.track_uri != '' THEN excluded.track_uri ELSE factoid_entries.track_uri END,
                factoids_json = excluded.factoids_json,
                provider = excluded.provider,
                fetched_at = excluded.fetched_at",
            params![
                track_key,
                track_uri.unwrap_or(""),
                title,
                artist,
                album.unwrap_or(""),
                json_str,
                resp.provider,
                now_sec,
            ],
        );
        Some(())
    });
}

pub fn clear_cached_factoids_for_track(
    track_uri: Option<&str>,
    title: &str,
    artist: &str,
    album: Option<&str>,
) {
    let key = normalize_key(title, artist, album);
    let _ = with_lyrics_db(|conn| {
        let _ = conn.execute(
            "DELETE FROM factoid_entries WHERE track_key = ?1 OR (?2 != '' AND track_uri = ?2)",
            params![key, track_uri.unwrap_or("")],
        );
        Some(())
    });
}

/// Strict music/media disambiguation filter so generic nouns (e.g. "Home", "Low", "Rush")
/// never match unrelated Wikipedia articles.
pub fn is_music_related_wikipedia_summary(
    page_type: &str,
    description: &str,
    extract: &str,
) -> bool {
    if page_type.eq_ignore_ascii_case("disambiguation") {
        return false;
    }
    let combined = format!(
        "{} {}",
        description.to_lowercase(),
        extract.to_lowercase()
    );
    let keywords = [
        "album",
        "song",
        "single",
        "band",
        "musician",
        "singer",
        "rapper",
        "composer",
        "producer",
        "record",
        "studio",
        "soundtrack",
        "discography",
        "track",
        "vocalist",
        "guitarist",
        "dj",
        "electronic",
        "orchestra",
        "symphony",
        "rock",
        "jazz",
        "hip hop",
        "hip-hop",
        "pop",
        "metal",
        "folk",
        "punk",
        "chart",
        "billboard",
        "grammy",
        "released in",
        "debut",
        "film",
        "cinema",
    ];
    keywords.iter().any(|kw| combined.contains(kw))
}

fn truncate_factoid_sentence(text: &str, max_chars: usize) -> String {
    let cleaned = text
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if cleaned.chars().count() <= max_chars {
        return cleaned;
    }
    let mut out = String::new();
    for word in cleaned.split_whitespace() {
        if out.chars().count() + word.chars().count() + 2 > max_chars {
            break;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(word);
    }
    out.push('…');
    out
}

fn split_extract_into_sentences(extract: &str, max_sentences: usize) -> Vec<String> {
    let mut results = Vec::new();
    for raw in extract.split(". ") {
        let trimmed = raw.trim();
        if trimmed.len() < 24 {
            continue;
        }
        let with_dot = if trimmed.ends_with('.') {
            trimmed.to_string()
        } else {
            format!("{trimmed}.")
        };
        results.push(truncate_factoid_sentence(&with_dot, 145));
        if results.len() >= max_sentences {
            break;
        }
    }
    results
}

fn url_encode_component(input: &str) -> String {
    let mut out = String::new();
    for b in input.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn query_wikipedia_summary(page_title: &str) -> Option<(String, String)> {
    let slug = page_title.trim().replace(' ', "_");
    if slug.is_empty() {
        return None;
    }
    let url = format!(
        "https://en.wikipedia.org/api/rest_v1/page/summary/{}",
        url_encode_component(&slug)
    );
    let body = http_get_text(
        &url,
        &[
            ("User-Agent", "SIMP-MediaPlayer/0.3 (https://github.com/niiiitz/simp)"),
            ("Accept", "application/json"),
        ],
        4,
    )
    .ok()?;
    let json: serde_json::Value = serde_json::from_str(&body).ok()?;
    let page_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let description = json
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let extract = json.get("extract").and_then(|v| v.as_str()).unwrap_or("");
    let canonical_title = json
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or(page_title)
        .to_string();
    if extract.trim().is_empty()
        || !is_music_related_wikipedia_summary(page_type, description, extract)
    {
        return None;
    }
    Some((canonical_title, extract.to_string()))
}

fn query_musicbrainz_recording_factoid(title: &str, artist: &str) -> Option<String> {
    if title.trim().is_empty() || artist.trim().is_empty() {
        return None;
    }
    let query = format!(
        "recording:\"{}\" AND artist:\"{}\"",
        title.replace('"', ""),
        artist.replace('"', "")
    );
    let url = format!(
        "https://musicbrainz.org/ws/2/recording/?query={}&limit=1&fmt=json",
        url_encode_component(&query)
    );
    let body = http_get_text(
        &url,
        &[
            ("User-Agent", "SIMP-MediaPlayer/0.3 (https://github.com/niiiitz/simp)"),
            ("Accept", "application/json"),
        ],
        4,
    )
    .ok()?;
    let json: serde_json::Value = serde_json::from_str(&body).ok()?;
    let rec = json
        .get("recordings")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())?;
    let score = rec.get("score").and_then(|v| v.as_u64()).unwrap_or(0);
    if score < 85 {
        return None;
    }
    let first_release = rec
        .get("first-release-date")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let release_info = rec
        .get("releases")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first());
    let release_title = release_info
        .and_then(|r| r.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let country = release_info
        .and_then(|r| r.get("country"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let disambig = rec
        .get("disambiguation")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let tags: Vec<String> = rec
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t.get("name").and_then(|n| n.as_str()).map(String::from))
                .take(4)
                .collect()
        })
        .unwrap_or_default();

    let mut parts = Vec::new();
    if !first_release.is_empty() {
        if !release_title.is_empty() {
            parts.push(format!(
                "First cataloged on \"{release_title}\" ({first_release})"
            ));
        } else {
            parts.push(format!("First release date recorded as {first_release}"));
        }
    }
    if !country.is_empty() {
        parts.push(format!("Region: {country}"));
    }
    if !disambig.is_empty() {
        parts.push(disambig.to_string());
    }
    if !tags.is_empty() {
        parts.push(format!("Genres/Tags: {}", tags.join(", ")));
    }
    if parts.is_empty() {
        None
    } else {
        Some(truncate_factoid_sentence(&parts.join(" • "), 145))
    }
}

/// Schedules 2–4 VH1-style "Pop-Up Video" bubbles cleanly between `18s` and `duration_sec - 20s`
/// so they never collide with the `0s–8s` MTV Track Intro Chyron or the `T-15s` Up Next Flyover.
pub fn schedule_factoid_bubbles(
    raw_items: Vec<(String, String, String, String)>,
    duration_ms: u32,
) -> Vec<FactoidBubble> {
    if raw_items.is_empty() {
        return Vec::new();
    }
    let total_sec = (duration_ms / 1000).max(90);
    let safe_start = 18u32;
    let safe_end = total_sec.saturating_sub(22).max(safe_start + 15);
    let count = raw_items.len().min(4);
    let span = safe_end.saturating_sub(safe_start);
    let step = if count > 1 {
        (span / (count as u32)).max(16)
    } else {
        0
    };

    raw_items
        .into_iter()
        .take(4)
        .enumerate()
        .map(|(idx, (category, headline, body, source))| {
            let start_sec = (safe_start + (idx as u32) * step).min(safe_end);
            FactoidBubble {
                category,
                headline,
                body,
                source,
                start_sec,
                duration_sec: 9,
            }
        })
        .collect()
}

pub fn fetch_track_factoids(
    track_uri: Option<&str>,
    title: &str,
    artist: &str,
    album: Option<&str>,
    duration_ms: u32,
) -> TrackFactoidsResponse {
    let clean_title = title.trim();
    let clean_artist = artist.trim();
    let clean_album = album.map(str::trim).filter(|s| !s.is_empty() && *s != "Unknown Album");
    let key = normalize_key(clean_title, clean_artist, clean_album);

    if let Some(cached) = load_factoids_from_db(&key, track_uri) {
        return cached;
    }

    let mut raw_items: Vec<(String, String, String, String)> = Vec::new();
    let mut providers: Vec<&str> = Vec::new();

    // 1. MusicBrainz Recording / Release Metadata
    if let Some(mb_fact) = query_musicbrainz_recording_factoid(clean_title, clean_artist) {
        raw_items.push((
            "RELEASE ARCHIVE".to_string(),
            clean_title.to_string(),
            mb_fact,
            "MusicBrainz".to_string(),
        ));
        providers.push("musicbrainz");
    }

    // 2. Wikipedia REST v1 Summary — Album or Song first
    if let Some(alb) = clean_album {
        let album_candidates = [
            format!("{alb} ({clean_artist} album)"),
            format!("{alb} (album)"),
        ];
        for cand in &album_candidates {
            if let Some((canon, extract)) = query_wikipedia_summary(cand) {
                for sentence in split_extract_into_sentences(&extract, 1) {
                    raw_items.push((
                        "ALBUM LORE".to_string(),
                        canon.clone(),
                        sentence,
                        "Wikipedia".to_string(),
                    ));
                }
                if !providers.contains(&"wikipedia") {
                    providers.push("wikipedia");
                }
                break;
            }
        }
    }

    // 3. Wikipedia REST v1 Summary — Artist Bio
    if !clean_artist.is_empty() && !clean_artist.eq_ignore_ascii_case("Unknown Artist") && raw_items.len() < 4 {
        let artist_candidates = [
            format!("{clean_artist} (band)"),
            format!("{clean_artist} (musician)"),
            clean_artist.to_string(),
        ];
        for cand in &artist_candidates {
            if let Some((canon, extract)) = query_wikipedia_summary(cand) {
                let needed = (4usize).saturating_sub(raw_items.len()).min(2);
                for sentence in split_extract_into_sentences(&extract, needed) {
                    raw_items.push((
                        "ARTIST PROFILE".to_string(),
                        canon.clone(),
                        sentence,
                        "Wikipedia".to_string(),
                    ));
                }
                if !providers.contains(&"wikipedia") {
                    providers.push("wikipedia");
                }
                break;
            }
        }
    }

    let bubbles = schedule_factoid_bubbles(raw_items, duration_ms);
    let provider_str = if providers.is_empty() {
        "none".to_string()
    } else {
        providers.join("+")
    };
    let resp = TrackFactoidsResponse {
        found: !bubbles.is_empty(),
        provider: provider_str,
        bubbles,
    };

    if resp.found {
        save_factoids_to_db(&key, track_uri, clean_title, clean_artist, clean_album, &resp);
    }

    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_music_wikipedia_filter_rejects_non_music_articles() {
        assert!(!is_music_related_wikipedia_summary(
            "standard",
            "Place used as a permanent or semi-permanent residence",
            "A home, or domicile, is a space used as a permanent or semi-permanent residence for one or more human occupants."
        ));
        assert!(!is_music_related_wikipedia_summary(
            "disambiguation",
            "Topics referred to by the same term",
            "Home may refer to an album or a song."
        ));
        assert!(is_music_related_wikipedia_summary(
            "standard",
            "2001 studio album by Electronic Duo",
            "Sample Album is the second studio album by French electronic music duo Example Artist, released in March 2001."
        ));
    }

    #[test]
    fn test_factoid_bubble_scheduling_avoids_intro_and_outro() {
        let raw = vec![
            ("RELEASE".into(), "Track 01".into(), "Fact 1.".into(), "MusicBrainz".into()),
            ("ALBUM".into(), "Sample Album".into(), "Fact 2.".into(), "Wikipedia".into()),
            ("ARTIST".into(), "Example Artist".into(), "Fact 3.".into(), "Wikipedia".into()),
        ];
        let bubbles = schedule_factoid_bubbles(raw, 200_000);
        assert_eq!(bubbles.len(), 3);
        assert!(bubbles[0].start_sec >= 18);
        assert!(bubbles[2].start_sec + bubbles[2].duration_sec <= 188);
    }
}
