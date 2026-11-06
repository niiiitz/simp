//! Native Rust Internet Archive (`archive.org`) API Client & Derivative Resolver.
//!
//! ### Attribution & Provenance
//! This module's design — including session header conventions, Lucene query construction for
//! `advancedsearch.php` and `/services/search/v1/scrape`, item metadata resolution via `/metadata/{id}`,
//! derivative format selection (`h.264 IA`, `512Kb MPEG4`, `VBR MP3`, `Flac`, `SubRip`), `cnt=0`
//! automated request hygiene, and `LOW` IAS3 key authorization — is modeled with gratitude after:
//! - **Jake Johnson (`@jjjake`)** and contributors to [`jjjake/internetarchive`](https://github.com/jjjake/internetarchive)
//! - **Internet Archive Developer Documentation**:
//!   - <https://archive.org/developers/bots.html>
//!   - <https://archive.org/developers/metadata.html>
//!   - <https://archive.org/developers/md-read.html>
//!   - <https://archive.org/developers/views_api.html>
//!
//! See `ATTRIBUTIONS.md` in the repository root for complete provenance details.

use anyhow::{anyhow, Result};
use serde_json::Value;
use simp_protocol::{
    ArchiveItemDetail, ArchiveItemSummary, SimpSettings, TrackMetadata, VideoEpisodeItem,
    VideoQualityVariant, VideoSubtitleVariant,
};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

pub const IA_USER_AGENT: &str = concat!(
    "SIMP-Media-Player/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/niiiitz/simp; inspired-by-jjjake-internetarchive)"
);

#[derive(Clone, Debug, Default)]
pub struct InternetArchiveCredentials {
    pub enabled: bool,
    pub username: String,
    pub access_key: String,
    pub secret_key: String,
}

pub fn resolve_internet_archive_credentials(
    settings: &SimpSettings,
) -> InternetArchiveCredentials {
    let mut enabled = settings.services.internet_archive_enabled;
    let mut username = settings.services.internet_archive_username.trim().to_string();
    let mut access_key = settings
        .services
        .internet_archive_access_key
        .trim()
        .to_string();
    let mut secret_key = settings
        .services
        .internet_archive_secret_key
        .trim()
        .to_string();

    if let Ok(v) = std::env::var("IA_USERNAME") {
        if username.is_empty() && !v.trim().is_empty() {
            username = v.trim().trim_start_matches('@').to_string();
        }
    }
    if let Ok(v) = std::env::var("IA_ACCESS_KEY") {
        if access_key.is_empty() && !v.trim().is_empty() {
            access_key = v.trim().to_string();
        }
    }
    if let Ok(v) = std::env::var("IA_SECRET_KEY") {
        if secret_key.is_empty() && !v.trim().is_empty() {
            secret_key = v.trim().to_string();
        }
    }
    if !access_key.is_empty() && !secret_key.is_empty() {
        enabled = true;
    }

    InternetArchiveCredentials {
        enabled,
        username: username.trim_start_matches('@').to_string(),
        access_key,
        secret_key,
    }
}

pub fn resolve_ia_config(settings: &SimpSettings) -> InternetArchiveCredentials {
    resolve_internet_archive_credentials(settings)
}

pub fn is_internet_archive_ready(settings: &SimpSettings) -> bool {
    resolve_internet_archive_credentials(settings).enabled
}

pub fn url_encode_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 8);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

pub fn url_encode_path_preserve_slashes(input: &str) -> String {
    input
        .split('/')
        .map(url_encode_component)
        .collect::<Vec<_>>()
        .join("/")
}

pub fn ia_http_get_json(creds: &InternetArchiveCredentials, url: &str) -> Result<Value> {
    let auth_val = format!("LOW {}:{}", creds.access_key, creds.secret_key);
    let mut headers: Vec<(&str, &str)> = vec![
        ("User-Agent", IA_USER_AGENT),
        ("Accept", "application/json"),
    ];
    if !creds.access_key.is_empty() && !creds.secret_key.is_empty() {
        headers.push(("Authorization", &auth_val));
    }
    let bytes = crate::http_pool::http_get_bytes(url, &headers, None, 20)?;
    let parsed: Value = serde_json::from_slice(&bytes)
        .map_err(|e| anyhow!("Failed to parse Internet Archive JSON from {url}: {e}"))?;
    Ok(parsed)
}

pub fn ia_http_get_text(creds: &InternetArchiveCredentials, url: &str) -> Result<String> {
    let auth_val = format!("LOW {}:{}", creds.access_key, creds.secret_key);
    let mut headers: Vec<(&str, &str)> = vec![("User-Agent", IA_USER_AGENT)];
    if !creds.access_key.is_empty() && !creds.secret_key.is_empty() {
        headers.push(("Authorization", &auth_val));
    }
    let bytes = crate::http_pool::http_get_bytes(url, &headers, None, 20)?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

/// Queries the Internet Archive Views Data Service API (`https://be-api.us.archive.org/views/v1/short/{ids}`)
/// to enrich item cards with 7-day, 30-day, and all-time human (`non_robots`) view metrics.
pub fn fetch_views_metrics(
    creds: &InternetArchiveCredentials,
    identifiers: &[String],
) -> HashMap<String, (u64, u64, u64)> {
    let mut out = HashMap::new();
    if identifiers.is_empty() {
        return out;
    }
    let batch: Vec<String> = identifiers
        .iter()
        .take(36)
        .map(|s| url_encode_component(s))
        .collect();
    let url = format!(
        "https://be-api.us.archive.org/views/v1/short/{}",
        batch.join(",")
    );
    let Ok(val) = ia_http_get_json(creds, &url) else {
        return out;
    };
    let Some(obj) = val.as_object() else {
        return out;
    };
    for (id, entry) in obj {
        let d7 = entry.get("last_7day").and_then(|v| v.as_u64()).unwrap_or(0);
        let d30 = entry
            .get("last_30day")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let all = entry.get("all_time").and_then(|v| v.as_u64()).unwrap_or(0);
        out.insert(id.clone(), (d7, d30, all));
    }
    out
}

fn value_as_first_string(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Array(arr)) => arr
            .first()
            .and_then(|first| first.as_str())
            .map(|s| s.trim().to_string())
            .unwrap_or_default(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn strip_html_tags(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len().min(320));
    let mut in_tag = false;
    for ch in raw.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
        if out.len() >= 300 {
            break;
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_year_field(v: Option<&Value>) -> Option<i32> {
    let s = value_as_first_string(v);
    if s.len() >= 4 {
        if let Ok(y) = s[..4].parse::<i32>() {
            if (1880..=2100).contains(&y) {
                return Some(y);
            }
        }
    }
    None
}

pub fn build_advancedsearch_url(query: &str, sort: &str, rows: usize, page: usize) -> String {
    let encoded_q = url_encode_component(query);
    let encoded_sort = url_encode_component(sort);
    format!(
        "https://archive.org/advancedsearch.php?q={encoded_q}\
         &fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=mediatype&fl%5B%5D=description\
         &fl%5B%5D=year&fl%5B%5D=date&fl%5B%5D=downloads&fl%5B%5D=week&fl%5B%5D=month&fl%5B%5D=runtime\
         &sort%5B%5D={encoded_sort}&rows={rows}&page={page}&output=json"
    )
}

fn parse_search_doc(doc: &Value) -> Option<ArchiveItemSummary> {
    let identifier = doc.get("identifier")?.as_str()?.trim().to_string();
    if identifier.is_empty() {
        return None;
    }
    let mediatype = {
        let m = value_as_first_string(doc.get("mediatype")).to_lowercase();
        if m.is_empty() {
            "movies".to_string()
        } else {
            m
        }
    };
    if mediatype == "collection"
        || mediatype == "account"
        || mediatype == "web"
        || mediatype == "texts"
        || mediatype == "software"
        || mediatype == "data"
        || mediatype == "image"
    {
        return None;
    }
    let title = {
        let t = value_as_first_string(doc.get("title"));
        if t.is_empty() {
            identifier.clone()
        } else {
            t
        }
    };
    let creator = {
        let c = value_as_first_string(doc.get("creator"));
        if c.is_empty() {
            "Internet Archive".to_string()
        } else {
            c
        }
    };
    let year = parse_year_field(doc.get("year")).or_else(|| parse_year_field(doc.get("date")));
    let description = strip_html_tags(&value_as_first_string(doc.get("description")));
    let downloads = doc.get("downloads").and_then(|v| v.as_u64()).unwrap_or(0);
    let views_7d = doc.get("week").and_then(|v| v.as_u64()).unwrap_or(0);
    let views_30d = doc.get("month").and_then(|v| v.as_u64()).unwrap_or(0);
    let runtime_raw = value_as_first_string(doc.get("runtime"));
    let runtime_label = if runtime_raw.is_empty() {
        None
    } else {
        Some(runtime_raw)
    };

    Some(ArchiveItemSummary {
        art_url: Some(format!(
            "https://archive.org/services/img/{}",
            url_encode_component(&identifier)
        )),
        identifier,
        title,
        creator,
        mediatype,
        year,
        description,
        downloads,
        views_7d,
        views_30d,
        runtime_label,
    })
}

pub fn execute_archive_search(
    creds: &InternetArchiveCredentials,
    lucene_query: &str,
    sort: &str,
    rows: usize,
) -> Result<Vec<ArchiveItemSummary>> {
    let url = build_advancedsearch_url(lucene_query, sort, rows.clamp(1, 80), 1);
    let json = ia_http_get_json(creds, &url)?;
    let docs = json
        .get("response")
        .and_then(|r| r.get("docs"))
        .and_then(|d| d.as_array())
        .or_else(|| json.get("items").and_then(|d| d.as_array()))
        .ok_or_else(|| anyhow!("Unexpected Internet Archive search response payload"))?;

    let mut items: Vec<ArchiveItemSummary> = docs.iter().filter_map(parse_search_doc).collect();

    // Enrich with Views Data Service API (`be-api.us.archive.org/views/v1/short`) when week/month are missing
    if !items.is_empty() && items.iter().all(|i| i.views_7d == 0) {
        let ids: Vec<String> = items.iter().map(|i| i.identifier.clone()).collect();
        let views_map = fetch_views_metrics(creds, &ids);
        for item in &mut items {
            if let Some((d7, d30, all)) = views_map.get(&item.identifier) {
                if item.views_7d == 0 {
                    item.views_7d = *d7;
                }
                if item.views_30d == 0 {
                    item.views_30d = *d30;
                }
                if item.downloads == 0 {
                    item.downloads = *all;
                }
            }
        }
    }

    Ok(items)
}

/// Fetches curated discovery hubs for the PS3 XMB `Internet Archive` Places menu.
pub fn fetch_discover_hub(
    settings: &SimpSettings,
    hub: &str,
    sub_filter: Option<&str>,
) -> Result<Vec<ArchiveItemSummary>> {
    let creds = resolve_internet_archive_credentials(settings);
    let sub = sub_filter.unwrap_or("all").trim().to_lowercase();

    if sub == "favorites" {
        return fetch_user_favorites(&creds);
    }

    let (query, sort) = match hub {
        "trending" => match sub.as_str() {
            "movies" => (
                "mediatype:movies AND -collection:inlibrary AND -collection:printdisabled AND -collection:television",
                "week desc",
            ),
            "audio" => (
                "(mediatype:etree OR mediatype:audio) AND -collection:inlibrary AND -collection:printdisabled",
                "week desc",
            ),
            "all_time" => (
                "(collection:feature_films OR collection:classic_tv OR collection:animationandcartoons OR collection:computerchronicles OR collection:etree) AND (mediatype:movies OR mediatype:etree OR mediatype:audio) AND -collection:inlibrary AND -collection:television",
                "downloads desc",
            ),
            _ => (
                "(collection:feature_films OR collection:classic_tv OR collection:animationandcartoons OR collection:computerchronicles OR collection:etree) AND (mediatype:movies OR mediatype:etree OR mediatype:audio) AND -collection:inlibrary AND -collection:television",
                "week desc",
            ),
        },
        "films" => match sub.as_str() {
            "noir" => (
                "collection:Film_Noir AND mediatype:movies AND -collection:inlibrary",
                "week desc",
            ),
            "scifi_horror" => (
                "collection:SciFi_Horror AND mediatype:movies AND -collection:inlibrary",
                "week desc",
            ),
            "comedy" => (
                "collection:comedy_films AND mediatype:movies AND -collection:inlibrary",
                "week desc",
            ),
            "silent" => (
                "collection:silent_films AND mediatype:movies AND -collection:inlibrary",
                "week desc",
            ),
            _ => (
                "(collection:feature_films OR collection:Film_Noir OR collection:SciFi_Horror OR collection:comedy_films) AND mediatype:movies AND -collection:inlibrary",
                "week desc",
            ),
        },
        "tv" => match sub.as_str() {
            "cartoons" => (
                "collection:animationandcartoons AND mediatype:movies AND -collection:inlibrary",
                "week desc",
            ),
            "chronicles" => (
                "collection:computerchronicles AND mediatype:movies AND -collection:inlibrary",
                "week desc",
            ),
            "classic_tv" => (
                "collection:classic_tv AND mediatype:movies AND -collection:inlibrary",
                "week desc",
            ),
            "prelinger" => (
                "collection:prelinger AND mediatype:movies AND -collection:inlibrary",
                "week desc",
            ),
            _ => (
                "(collection:animationandcartoons OR collection:computerchronicles OR collection:classic_tv) AND mediatype:movies AND -collection:inlibrary",
                "week desc",
            ),
        },
        "audio" => match sub.as_str() {
            "etree" => (
                "collection:etree AND (mediatype:etree OR mediatype:audio)",
                "week desc",
            ),
            "netlabels" => (
                "collection:netlabels AND mediatype:audio",
                "week desc",
            ),
            "radio" => (
                "collection:oldtimeradio AND mediatype:audio",
                "week desc",
            ),
            "librivox" => (
                "collection:librivoxaudio AND mediatype:audio",
                "week desc",
            ),
            _ => (
                "(collection:etree OR collection:netlabels OR collection:oldtimeradio OR collection:librivoxaudio) AND (mediatype:etree OR mediatype:audio) AND -collection:inlibrary",
                "week desc",
            ),
        },
        _ => (
            "(collection:feature_films OR collection:computerchronicles OR collection:etree) AND (mediatype:movies OR mediatype:etree OR mediatype:audio) AND -collection:inlibrary AND -collection:television",
            "week desc",
        ),
    };

    execute_archive_search(&creds, query, sort, 40)
}

/// Fetches a user's public/account Internet Archive Favorites (`fav-{username}`).
pub fn fetch_user_favorites(
    creds: &InternetArchiveCredentials,
) -> Result<Vec<ArchiveItemSummary>> {
    let uname = creds.username.trim().trim_start_matches('@');
    if uname.is_empty() {
        return Ok(Vec::new());
    }
    let fav_id = format!("fav-{uname}");
    // First try Advanced Search on `collection:fav-{username}`
    let query = format!("collection:{fav_id} AND (mediatype:movies OR mediatype:audio OR mediatype:etree)");
    if let Ok(items) = execute_archive_search(creds, &query, "downloads desc", 48) {
        if !items.is_empty() {
            return Ok(items);
        }
    }

    // Fallback to `/metadata/fav-{username}` `members` array
    let meta_url = format!(
        "https://archive.org/metadata/{}?cnt=0",
        url_encode_component(&fav_id)
    );
    let Ok(val) = ia_http_get_json(creds, &meta_url) else {
        return Ok(Vec::new());
    };
    let Some(members) = val.get("members").and_then(|m| m.as_array()) else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for m in members {
        let Some(id) = m.get("identifier").and_then(|v| v.as_str()) else {
            continue;
        };
        let mediatype = m
            .get("mediatype")
            .and_then(|v| v.as_str())
            .unwrap_or("movies")
            .to_lowercase();
        if mediatype != "movies" && mediatype != "audio" && mediatype != "etree" {
            continue;
        }
        let title = m
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(id)
            .to_string();
        out.push(ArchiveItemSummary {
            art_url: Some(format!(
                "https://archive.org/services/img/{}",
                url_encode_component(id)
            )),
            identifier: id.to_string(),
            title,
            creator: format!("@{uname} Favorite"),
            mediatype,
            year: None,
            description: String::new(),
            downloads: 0,
            views_7d: 0,
            views_30d: 0,
            runtime_label: None,
        });
    }
    Ok(out)
}

/// Searches Internet Archive across movies, concerts (`etree`), and audio collections.
pub fn search_catalog(
    settings: &SimpSettings,
    term: &str,
    media_filter: Option<&str>,
) -> Result<Vec<ArchiveItemSummary>> {
    let trimmed = term.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let creds = resolve_internet_archive_credentials(settings);
    let escaped = trimmed.replace('"', " ");
    let type_clause = match media_filter.unwrap_or("all") {
        "video" | "movies" => "mediatype:movies AND -collection:television",
        "audio" => "(mediatype:etree OR mediatype:audio)",
        _ => "(mediatype:movies OR mediatype:etree OR mediatype:audio) AND -collection:television",
    };
    let query = format!(
        "({escaped}) AND {type_clause} AND -collection:inlibrary AND -collection:printdisabled"
    );
    execute_archive_search(&creds, &query, "downloads desc", 36)
}

fn parse_duration_seconds_str(raw: &str) -> u32 {
    let s = raw.trim();
    if s.is_empty() {
        return 0;
    }
    if let Ok(secs) = s.parse::<f64>() {
        if secs > 0.0 {
            return (secs * 1000.0).round() as u32;
        }
    }
    // Parse HH:MM:SS or MM:SS
    let parts: Vec<&str> = s.split(':').collect();
    match parts.len() {
        2 => {
            let mins = parts[0].trim().parse::<u32>().unwrap_or(0);
            let secs = parts[1].trim().parse::<f64>().unwrap_or(0.0);
            mins * 60_000 + (secs * 1000.0).round() as u32
        }
        3 => {
            let hrs = parts[0].trim().parse::<u32>().unwrap_or(0);
            let mins = parts[1].trim().parse::<u32>().unwrap_or(0);
            let secs = parts[2].trim().parse::<f64>().unwrap_or(0.0);
            hrs * 3_600_000 + mins * 60_000 + (secs * 1000.0).round() as u32
        }
        _ => 0,
    }
}

fn clean_stem_for_grouping(filename: &str) -> String {
    let base = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let mut lower = base.to_lowercase();
    loop {
        let mut changed = false;
        for suffix in [
            "_512kb", "_256kb", "_128kb", "_64kb", ".ia", "_ia", "_h264", "_x264", "_vbr",
            "_edit", "_hi", "_low", "_hq", "_lq", ".asr", "_asr", ".en", "_en",
        ] {
            if let Some(stripped) = lower.strip_suffix(suffix) {
                if !stripped.is_empty() {
                    lower = stripped.to_string();
                    changed = true;
                    break;
                }
            }
        }
        if !changed {
            break;
        }
    }
    lower
}

fn humanize_episode_stem(stem: &str, fallback_title: &str, index: usize, total: usize) -> String {
    let cleaned = stem
        .replace('_', " ")
        .replace('-', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if total <= 1 {
        return fallback_title.to_string();
    }
    if cleaned.is_empty() {
        format!("Part {}", index + 1)
    } else {
        cleaned
    }
}

/// Parses an Internet Archive Metadata Read API (`https://archive.org/metadata/{identifier}`) JSON
/// payload into a structured `ArchiveItemDetail` containing:
/// - Grouped `VideoEpisodeItem`s (with prioritized `HD MP4` -> `SD 512Kb MP4` -> `WebM/OGV` -> `Compatibility MP4 (ffmpeg)`
///   quality variants and matched `.srt`/`.vtt` subtitles) for video items, and
/// - Deduplicated `TrackMetadata` items for audio / `etree` live concert items.
pub fn parse_ia_metadata_json(identifier: &str, root: &Value) -> Result<ArchiveItemDetail> {
    let meta = root.get("metadata").unwrap_or(&Value::Null);
    let title = {
        let t = value_as_first_string(meta.get("title"));
        if t.is_empty() {
            identifier.to_string()
        } else {
            t
        }
    };
    let creator = {
        let c = value_as_first_string(meta.get("creator"));
        if c.is_empty() {
            "Internet Archive".to_string()
        } else {
            c
        }
    };
    let mediatype = {
        let m = value_as_first_string(meta.get("mediatype")).to_lowercase();
        if m.is_empty() {
            "movies".to_string()
        } else {
            m
        }
    };
    let year = parse_year_field(meta.get("year")).or_else(|| parse_year_field(meta.get("date")));
    let description = strip_html_tags(&value_as_first_string(meta.get("description")));
    let runtime_raw = value_as_first_string(meta.get("runtime"));
    let art_url = Some(format!(
        "https://archive.org/services/img/{}",
        url_encode_component(identifier)
    ));

    let files = root
        .get("files")
        .and_then(|f| f.as_array())
        .cloned()
        .unwrap_or_default();

    // 1. Collect subtitle files (`.srt` / `.vtt`)
    let mut item_subtitles: Vec<(String, VideoSubtitleVariant)> = Vec::new();
    for f in &files {
        let Some(name) = f.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        let is_private = f
            .get("private")
            .and_then(|v| v.as_str().map(|s| s == "true" || s == "1").or_else(|| v.as_bool()))
            .unwrap_or(false);
        if is_private {
            continue;
        }
        let lower = name.to_lowercase();
        let fmt = f
            .get("format")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        if lower.ends_with(".srt")
            || lower.ends_with(".vtt")
            || fmt.contains("subrip")
            || fmt.contains("webvtt")
            || fmt.contains("text tracks")
        {
            let stem = clean_stem_for_grouping(name);
            let label = f
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| {
                    if lower.contains(".asr.") || lower.contains("_asr.") {
                        "English (Auto)".to_string()
                    } else if lower.contains(".en.") || lower.contains("_en.") {
                        "English".to_string()
                    } else {
                        Path::new(name)
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Captions")
                            .to_string()
                    }
                });
            let vtt_url = format!(
                "/api/video/subtitles?source=ia&id={}&file={}",
                url_encode_component(identifier),
                url_encode_component(name)
            );
            // Deduplicate `.vtt` vs `.srt` for the same stem + label (prefer `.vtt`)
            if let Some(existing) = item_subtitles
                .iter_mut()
                .find(|(s_stem, sub)| *s_stem == stem && sub.label.eq_ignore_ascii_case(&label))
            {
                if lower.ends_with(".vtt") && !existing.1.id.to_lowercase().ends_with(".vtt") {
                    existing.1 = VideoSubtitleVariant {
                        id: name.to_string(),
                        lang_code: "en".to_string(),
                        label,
                        vtt_url,
                    };
                }
            } else {
                item_subtitles.push((
                    stem,
                    VideoSubtitleVariant {
                        id: name.to_string(),
                        lang_code: "en".to_string(),
                        label,
                        vtt_url,
                    },
                ));
            }
        }
    }

    // 2. Group video derivative files (`.mp4`, `.webm`, `.ogv`, `.m4v`, `.mkv`, `.avi`, `.mpeg`) by canonical stem
    struct RawVideoCandidate {
        stem: String,
        raw_filename: String,
        display_title: Option<String>,
        duration_ms: u32,
        rank: u8,
        variant: VideoQualityVariant,
    }

    let mut video_candidates: Vec<RawVideoCandidate> = Vec::new();
    for f in &files {
        let Some(name) = f.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        let is_private = f
            .get("private")
            .and_then(|v| v.as_str().map(|s| s == "true" || s == "1").or_else(|| v.as_bool()))
            .unwrap_or(false);
        if is_private {
            continue;
        }
        let lower = name.to_lowercase();
        if lower.ends_with(".thumbs.mp4")
            || lower.contains("__ia_thumb")
            || lower.contains(".thumbs/")
        {
            continue;
        }
        let fmt = f.get("format").and_then(|v| v.as_str()).unwrap_or("");
        let fmt_lower = fmt.to_lowercase();

        let is_browser_video = lower.ends_with(".mp4")
            || lower.ends_with(".m4v")
            || lower.ends_with(".webm")
            || lower.ends_with(".ogv")
            || fmt_lower.contains("h.264")
            || fmt_lower.contains("mpeg4")
            || fmt_lower.contains("ogg video")
            || fmt_lower.contains("webm");

        let is_legacy_container = lower.ends_with(".mkv")
            || lower.ends_with(".avi")
            || lower.ends_with(".mov")
            || lower.ends_with(".mpg")
            || lower.ends_with(".mpeg")
            || fmt_lower.contains("matroska")
            || fmt_lower.contains("mpeg2");

        if !is_browser_video && !is_legacy_container {
            continue;
        }

        let original_ref = f
            .get("original")
            .and_then(|v| v.as_str())
            .unwrap_or(name);
        let stem = clean_stem_for_grouping(original_ref);
        let size_bytes = f
            .get("size")
            .and_then(|v| v.as_str().and_then(|s| s.parse::<u64>().ok()).or_else(|| v.as_u64()));
        let duration_ms = f
            .get("length")
            .and_then(|v| v.as_str())
            .map(parse_duration_seconds_str)
            .unwrap_or(0);
        let height = f
            .get("height")
            .and_then(|v| {
                v.as_str()
                    .and_then(|s| s.parse::<u32>().ok())
                    .or_else(|| v.as_u64().map(|n| n as u32))
            })
            .unwrap_or(0);
        let display_title = f
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let (rank, label, format_tag) = if lower.ends_with("_512kb.mp4")
            || fmt_lower.contains("512kb")
        {
            (2u8, "SD MP4 (512Kb)".to_string(), "mp4".to_string())
        } else if lower.ends_with("_256kb.mp4") || fmt_lower.contains("256kb") {
            (6u8, "Low MP4 (256Kb)".to_string(), "mp4".to_string())
        } else if lower.ends_with("_64kb.mp4") || fmt_lower.contains("64kb") {
            (7u8, "Low MP4 (64Kb)".to_string(), "mp4".to_string())
        } else if fmt_lower.contains("h.264") || lower.ends_with(".ia.mp4") {
            if lower.ends_with(".ia.mp4") || fmt_lower.contains("hd") || height >= 720 {
                (0u8, "HD MP4 (H.264)".to_string(), "mp4".to_string())
            } else {
                (1u8, "MP4 (H.264)".to_string(), "mp4".to_string())
            }
        } else if lower.ends_with(".webm") || fmt_lower.contains("webm") {
            (3u8, "WebM".to_string(), "webm".to_string())
        } else if lower.ends_with(".mp4")
            || lower.ends_with(".m4v")
            || fmt_lower.contains("mpeg4")
        {
            let tag = if lower.ends_with(".m4v") { "m4v" } else { "mp4" };
            let lbl = if lower.ends_with("_edit.mp4") || fmt_lower.contains("hires") {
                "MP4 (HiRes)".to_string()
            } else if lower.ends_with(".m4v") {
                "M4V (Original)".to_string()
            } else {
                "MP4 (Original)".to_string()
            };
            (4u8, lbl, tag.to_string())
        } else if lower.ends_with(".ogv") || fmt_lower.contains("ogg video") {
            (5u8, "OGV (Ogg Video)".to_string(), "ogv".to_string())
        } else {
            let ext = Path::new(name)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("video")
                .to_lowercase();
            (8u8, format!("Original ({})", ext.to_uppercase()), ext)
        };

        let stream_url = format!(
            "https://archive.org/download/{}/{}",
            url_encode_component(identifier),
            url_encode_path_preserve_slashes(name)
        );

        video_candidates.push(RawVideoCandidate {
            stem,
            raw_filename: name.to_string(),
            display_title,
            duration_ms,
            rank,
            variant: VideoQualityVariant {
                label,
                format: format_tag,
                stream_url,
                size_bytes,
            },
        });
    }

    let mut grouped_videos: BTreeMap<String, Vec<RawVideoCandidate>> = BTreeMap::new();
    for cand in video_candidates {
        grouped_videos
            .entry(cand.stem.clone())
            .or_default()
            .push(cand);
    }

    let total_video_groups = grouped_videos.len();
    let mut episodes: Vec<VideoEpisodeItem> = Vec::new();
    for (idx, (stem, mut group)) in grouped_videos.into_iter().enumerate() {
        group.sort_by_key(|c| c.rank);
        let duration_ms = group
            .iter()
            .map(|c| c.duration_ms)
            .max()
            .unwrap_or_else(|| parse_duration_seconds_str(&runtime_raw));
        let ep_label = group
            .iter()
            .find_map(|c| c.display_title.clone())
            .unwrap_or_else(|| humanize_episode_stem(&stem, &title, idx, total_video_groups));

        let best_source_file = group
            .first()
            .map(|c| c.raw_filename.clone())
            .unwrap_or_default();

        let mut qualities: Vec<VideoQualityVariant> = Vec::new();
        for c in group {
            // Skip raw `.mpeg`/`.avi`/`.mkv` direct URLs if we already have browser-native `.mp4`/`.webm`/`.ogv` variants
            if c.rank >= 8 && !qualities.is_empty() {
                continue;
            }
            if !qualities.iter().any(|q| q.stream_url == c.variant.stream_url) {
                let mut variant = c.variant;
                if qualities.iter().any(|q| q.label == variant.label) {
                    variant.label = format!("{} ({})", variant.label, variant.format.to_uppercase());
                }
                qualities.push(variant);
            }
        }

        // Always append a daemon-assisted `Compatibility MP4 (ffmpeg)` stream option so every item
        // has at least 2 switchable qualities (`X`) and a guaranteed H.264+AAC fallback for legacy codecs
        if !best_source_file.is_empty() {
            qualities.push(VideoQualityVariant {
                label: "Compatibility MP4 (ffmpeg)".to_string(),
                format: "mp4".to_string(),
                stream_url: format!(
                    "/api/video/ia_stream?id={}&file={}",
                    url_encode_component(identifier),
                    url_encode_component(&best_source_file)
                ),
                size_bytes: None,
            });
        }

        let mut subs: Vec<VideoSubtitleVariant> = item_subtitles
            .iter()
            .filter(|(s_stem, _)| *s_stem == stem || total_video_groups == 1)
            .map(|(_, sub)| sub.clone())
            .collect();
        if subs.is_empty() && !item_subtitles.is_empty() {
            subs = item_subtitles.iter().map(|(_, sub)| sub.clone()).collect();
        }

        episodes.push(VideoEpisodeItem {
            episode_number: (idx + 1) as u16,
            label: ep_label,
            duration_ms,
            qualities,
            subtitles: subs,
        });
    }

    // 3. Deduplicate Audio files (`.mp3`, `.flac`, `.ogg`, `.m4a`) when item is `audio` / `etree` (or has audio tracks)
    struct RawAudioCandidate {
        stem: String,
        rank: u8,
        track_num: Option<u32>,
        track: TrackMetadata,
    }

    let mut audio_candidates: Vec<RawAudioCandidate> = Vec::new();
    for f in &files {
        let Some(name) = f.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        let lower = name.to_lowercase();
        let fmt = f
            .get("format")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();

        let rank = if lower.ends_with(".mp3") || fmt.contains("mp3") {
            0u8 // Fast progressive streaming in Symphonia
        } else if lower.ends_with(".flac") || fmt.contains("flac") {
            1u8
        } else if lower.ends_with(".ogg") || fmt.contains("ogg vorbis") {
            2u8
        } else if lower.ends_with(".m4a") {
            3u8
        } else {
            continue;
        };

        // If this is primarily a movie item and this audio file is just an extracted audio derivative of the movie, skip it
        if mediatype == "movies" && !episodes.is_empty() {
            continue;
        }

        let original_ref = f
            .get("original")
            .and_then(|v| v.as_str())
            .unwrap_or(name);
        let stem = clean_stem_for_grouping(original_ref);
        let track_title = f
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                Path::new(name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(name)
                    .replace('_', " ")
            });
        let artist = f
            .get("creator")
            .or_else(|| f.get("artist"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| creator.clone());
        let album_name = f
            .get("album")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| title.clone());
        let track_num = f
            .get("track")
            .and_then(|v| v.as_str())
            .and_then(|s| s.split('/').next())
            .and_then(|s| s.trim().parse::<u32>().ok());
        let duration_ms = f
            .get("length")
            .and_then(|v| v.as_str())
            .map(parse_duration_seconds_str)
            .unwrap_or(0);

        let uri = format!(
            "ia:audio:{}/{}",
            url_encode_component(identifier),
            url_encode_path_preserve_slashes(name)
        );

        audio_candidates.push(RawAudioCandidate {
            stem,
            rank,
            track_num,
            track: TrackMetadata {
                uri,
                title: track_title,
                artists: vec![artist],
                album: album_name,
                album_id: Some(format!("ia:{identifier}")),
                track_number: track_num,
                disc_number: Some(1),
                art_url: art_url.clone(),
                duration_ms,
                source: "internet_archive".to_string(),
                mount_root: None,
            },
        });
    }

    let mut grouped_audio: BTreeMap<String, Vec<RawAudioCandidate>> = BTreeMap::new();
    for cand in audio_candidates {
        grouped_audio
            .entry(cand.stem.clone())
            .or_default()
            .push(cand);
    }

    let mut chosen_audio: Vec<(Option<u32>, String, TrackMetadata)> = Vec::new();
    for (stem, mut group) in grouped_audio {
        group.sort_by_key(|c| c.rank);
        if let Some(best) = group.into_iter().next() {
            chosen_audio.push((best.track_num, stem, best.track));
        }
    }
    chosen_audio.sort_by(|a, b| {
        let num_cmp = a.0.unwrap_or(u32::MAX).cmp(&b.0.unwrap_or(u32::MAX));
        if num_cmp == std::cmp::Ordering::Equal {
            a.1.cmp(&b.1)
        } else {
            num_cmp
        }
    });

    let tracks: Vec<TrackMetadata> = chosen_audio
        .into_iter()
        .enumerate()
        .map(|(idx, (_, _, mut t))| {
            if t.track_number.is_none() {
                t.track_number = Some((idx + 1) as u32);
            }
            t
        })
        .collect();

    Ok(ArchiveItemDetail {
        summary: ArchiveItemSummary {
            identifier: identifier.to_string(),
            title,
            creator,
            mediatype,
            year,
            description,
            art_url,
            downloads: 0,
            views_7d: 0,
            views_30d: 0,
            runtime_label: if runtime_raw.is_empty() {
                None
            } else {
                Some(runtime_raw)
            },
        },
        episodes,
        tracks,
    })
}

/// Fetches full item metadata & derivative streams via `https://archive.org/metadata/{identifier}`.
pub fn fetch_item_detail(settings: &SimpSettings, identifier: &str) -> Result<ArchiveItemDetail> {
    let creds = resolve_internet_archive_credentials(settings);
    let clean_id = identifier.trim().strip_prefix("ia:").unwrap_or(identifier.trim());
    let url = format!(
        "https://archive.org/metadata/{}?cnt=0",
        url_encode_component(clean_id)
    );
    let json = ia_http_get_json(&creds, &url)?;
    parse_ia_metadata_json(clean_id, &json)
}

/// Converts a SubRip (`.srt`) or WebVTT (`.vtt`) subtitle text into valid `WEBVTT` format
/// for native HTML5 `<track kind="subtitles">` rendering.
pub fn convert_srt_to_webvtt(raw: &str) -> String {
    let trimmed = raw.trim_start_matches('\u{feff}').trim();
    if trimmed.starts_with("WEBVTT") {
        return format!("{trimmed}\n");
    }

    let mut out = String::with_capacity(trimmed.len() + 32);
    out.push_str("WEBVTT\n\n");

    for line in trimmed.lines() {
        let l = line.trim_end_matches('\r');
        if l.contains("-->") {
            // Convert `00:01:23,450 --> 00:01:25,800` to `00:01:23.450 --> 00:01:25.800`
            out.push_str(&l.replace(',', "."));
            out.push('\n');
        } else {
            out.push_str(l);
            out.push('\n');
        }
    }
    out
}

/// Builds a `VideoEpisodeItem` (including any sidecar `.srt` / `.vtt` subtitle files in the same folder)
/// for a local unencrypted video file (`file:///.../*.mp4`, `.webm`, `.mkv`, etc.).
pub fn build_local_video_episode(file_path: &Path, episode_number: u16) -> VideoEpisodeItem {
    let file_str = file_path.to_string_lossy().to_string();
    let stem = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Video");
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp4")
        .to_lowercase();
    let size_bytes = std::fs::metadata(file_path).ok().map(|m| m.len());

    let stream_url = format!("/api/video/local?path={}", url_encode_component(&file_str));
    let transcode_url = format!(
        "/api/video/local?path={}&transcode=1",
        url_encode_component(&file_str)
    );
    let qualities = vec![
        VideoQualityVariant {
            label: format!("Local {}", ext.to_uppercase()),
            format: ext,
            stream_url,
            size_bytes,
        },
        VideoQualityVariant {
            label: "Compatibility MP4 (ffmpeg)".to_string(),
            format: "mp4".to_string(),
            stream_url: transcode_url,
            size_bytes: None,
        },
    ];

    let mut subtitles = Vec::new();
    if let Some(parent) = file_path.parent() {
        if let Ok(entries) = std::fs::read_dir(parent) {
            let stem_lower = stem.to_lowercase();
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_file() {
                    continue;
                }
                let p_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                let p_lower = p_name.to_lowercase();
                if !(p_lower.ends_with(".srt") || p_lower.ends_with(".vtt")) {
                    continue;
                }
                if p_lower.starts_with(&stem_lower) {
                    let sub_path_str = p.to_string_lossy().to_string();
                    let vtt_url = format!(
                        "/api/video/subtitles?source=local&file={}",
                        url_encode_component(&sub_path_str)
                    );
                    let suffix = p_name
                        .get(stem.len()..)
                        .unwrap_or("")
                        .trim_start_matches(['.', '_', '-'])
                        .trim_end_matches(".srt")
                        .trim_end_matches(".vtt")
                        .trim_end_matches(".SRT")
                        .trim_end_matches(".VTT");
                    let label = if suffix.is_empty() || suffix.eq_ignore_ascii_case("en") {
                        "English / Default".to_string()
                    } else {
                        suffix.to_uppercase()
                    };
                    subtitles.push(VideoSubtitleVariant {
                        id: sub_path_str,
                        lang_code: "en".to_string(),
                        label,
                        vtt_url,
                    });
                }
            }
        }
    }

    VideoEpisodeItem {
        episode_number,
        label: stem.replace('_', " "),
        duration_ms: 0,
        qualities,
        subtitles,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_ia_metadata_groups_video_derivatives_and_subtitles() {
        let sample = json!({
            "metadata": {
                "identifier": "sample_archive_film",
                "title": "Sample Classic Film",
                "creator": "Public Domain Studio",
                "mediatype": "movies",
                "year": "1959",
                "runtime": "01:15:00"
            },
            "files": [
                {
                    "name": "reel1.mp4",
                    "format": "h.264",
                    "size": "450000000",
                    "length": "4500.0"
                },
                {
                    "name": "reel1_512kb.mp4",
                    "original": "reel1.mp4",
                    "format": "512Kb MPEG4",
                    "size": "120000000",
                    "length": "4500.0"
                },
                {
                    "name": "reel1.ogv",
                    "original": "reel1.mp4",
                    "format": "Ogg Video",
                    "size": "210000000",
                    "length": "4500.0"
                },
                {
                    "name": "reel1.en.srt",
                    "format": "SubRip"
                }
            ]
        });

        let detail =
            parse_ia_metadata_json("sample_archive_film", &sample).expect("parse IA film metadata");
        assert_eq!(detail.summary.title, "Sample Classic Film");
        assert_eq!(detail.summary.year, Some(1959));
        assert_eq!(detail.episodes.len(), 1);
        let ep = &detail.episodes[0];
        assert_eq!(ep.duration_ms, 4_500_000);
        assert_eq!(ep.qualities.len(), 4);
        assert_eq!(ep.qualities[0].label, "MP4 (H.264)");
        assert_eq!(ep.qualities[1].label, "SD MP4 (512Kb)");
        assert_eq!(ep.qualities[2].label, "OGV (Ogg Video)");
        assert_eq!(ep.qualities[3].label, "Compatibility MP4 (ffmpeg)");
        assert_eq!(ep.subtitles.len(), 1);
        assert_eq!(ep.subtitles[0].label, "English");
    }

    #[test]
    fn test_parse_ia_metadata_deduplicates_audio_stems() {
        let sample = json!({
            "metadata": {
                "identifier": "sample_live_concert_1997",
                "title": "Sample Live Concert",
                "creator": "Example Ensemble",
                "mediatype": "etree",
                "date": "1997-06-14"
            },
            "files": [
                {
                    "name": "d1t01.flac",
                    "format": "Flac",
                    "title": "Opening Jam",
                    "track": "01",
                    "length": "312.4"
                },
                {
                    "name": "d1t01.mp3",
                    "original": "d1t01.flac",
                    "format": "VBR MP3",
                    "title": "Opening Jam",
                    "track": "01",
                    "length": "312.4"
                },
                {
                    "name": "d1t02.flac",
                    "format": "Flac",
                    "title": "Second Movement",
                    "track": "02",
                    "length": "420.0"
                }
            ]
        });

        let detail = parse_ia_metadata_json("sample_live_concert_1997", &sample)
            .expect("parse IA concert metadata");
        assert_eq!(detail.tracks.len(), 2);
        assert_eq!(detail.tracks[0].title, "Opening Jam");
        assert!(detail.tracks[0].uri.ends_with("d1t01.mp3"));
        assert_eq!(detail.tracks[0].duration_ms, 312_400);
        assert_eq!(detail.tracks[1].title, "Second Movement");
        assert!(detail.tracks[1].uri.ends_with("d1t02.flac"));
    }

    #[test]
    fn test_srt_to_webvtt_conversion() {
        let srt = "1\r\n00:00:01,250 --> 00:00:04,500\r\nHello from Internet Archive!\r\n\r\n2\r\n00:00:05,000 --> 00:00:08,125\r\nSecond subtitle line.\r\n";
        let vtt = convert_srt_to_webvtt(srt);
        assert!(vtt.starts_with("WEBVTT\n\n"));
        assert!(vtt.contains("00:00:01.250 --> 00:00:04.500"));
        assert!(vtt.contains("00:00:05.000 --> 00:00:08.125"));
    }
}
