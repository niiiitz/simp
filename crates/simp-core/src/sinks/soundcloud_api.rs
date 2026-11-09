use anyhow::{anyhow, Context, Result};
use base64::{
    engine::general_purpose::{STANDARD as BASE64_STD, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const SOUNDCLOUD_DEFAULT_REDIRECT_URI: &str = "http://127.0.0.1:18888/api/soundcloud/callback";
pub const SOUNDCLOUD_DEFAULT_TOKEN_PROXY_URL: &str = "https://simp-tap-67.niiiitz.workers.dev";
pub const SOUNDCLOUD_DEFAULT_CLIENT_ID: &str = "WU0IbI5NwABTi60QuSLPgIeTZZmwNznQ";

/// Hard-locked to `false` so `api-v2` code remains in the repository for future reactivation
/// if SoundCloud support grants clearance, while being 100% unreachable at runtime.
#[inline]
const fn is_soundcloud_v2_enabled(_settings: &SimpSettings) -> bool {
    false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudPlaylistSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub creator: String,
    pub art_url: Option<String>,
    pub track_count: usize,
    pub duration_ms: u32,
    pub kind: String, // "likes" | "user_set" | "liked_set" | "catalog_set"
    #[serde(default)]
    pub permalink_url: Option<String>,
    #[serde(default)]
    pub tracks: Vec<TrackMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudStationSummary {
    pub id: String,
    pub name: String,
    pub subtitle: String,
    pub seed_track_id: String,
    pub art_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudPlaylistsResponse {
    pub playlists: Vec<SoundCloudPlaylistSummary>,
    pub liked_tracks_preview: Vec<TrackMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudStreamResponse {
    pub stream_tracks: Vec<TrackMetadata>,
    #[serde(default)]
    pub stream_playlists: Vec<SoundCloudPlaylistSummary>,
    pub stations: Vec<SoundCloudStationSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SoundCloudMixChapter {
    pub label: String,
    pub timestamp_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudUserSummary {
    pub id: String,
    pub urn: String,
    pub username: String,
    pub avatar_url: Option<String>,
    pub track_count: usize,
    pub followers_count: u64,
    pub description: String,
    #[serde(default)]
    pub permalink_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudUserProfileResponse {
    pub user: Option<SoundCloudUserSummary>,
    pub tracks: Vec<TrackMetadata>,
    pub playlists: Vec<SoundCloudPlaylistSummary>,
    #[serde(default)]
    pub liked_tracks: Vec<TrackMetadata>,
    #[serde(default)]
    pub followings: Vec<SoundCloudUserSummary>,
    #[serde(default)]
    pub next_tracks_href: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudDiscoverResponse {
    pub tracks: Vec<TrackMetadata>,
    pub mixes: Vec<TrackMetadata>,
    pub playlists: Vec<SoundCloudPlaylistSummary>,
    #[serde(default)]
    pub more_of_what_you_like: Vec<TrackMetadata>,
    #[serde(default)]
    pub fresh_uploads: Vec<TrackMetadata>,
    #[serde(default)]
    pub recommended_artists: Vec<SoundCloudUserSummary>,
    #[serde(default)]
    pub next_tracks_href: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudSearchResults {
    pub tracks: Vec<TrackMetadata>,
    pub mixes: Vec<TrackMetadata>,
    pub playlists: Vec<SoundCloudPlaylistSummary>,
    pub stations: Vec<SoundCloudStationSummary>,
    #[serde(default)]
    pub users: Vec<SoundCloudUserSummary>,
    #[serde(default)]
    pub next_tracks_href: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudPaginateResponse {
    pub tracks: Vec<TrackMetadata>,
    pub playlists: Vec<SoundCloudPlaylistSummary>,
    pub next_href: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudComment {
    pub id: String,
    pub body: String,
    pub timestamp_ms: u32,
    pub username: String,
    pub avatar_url: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudWaveform {
    pub track_id: String,
    pub bars: Vec<f32>,
    pub waveform_url: Option<String>,
    #[serde(default)]
    pub permalink_url: Option<String>,
    #[serde(default)]
    pub bpm: Option<u32>,
    #[serde(default)]
    pub favoritings_count: Option<u64>,
    #[serde(default)]
    pub playback_count: Option<u64>,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub chapters: Vec<SoundCloudMixChapter>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SoundCloudStreamUrls {
    pub track_id: String,
    pub hls_aac_160_url: Option<String>,
    pub hls_aac_96_url: Option<String>,
    pub hls_mp3_128_url: Option<String>,
    pub http_mp3_128_url: Option<String>,
    pub preview_mp3_128_url: Option<String>,
    #[serde(default)]
    pub drm_hls_url: Option<String>,
    #[serde(default)]
    pub drm_license_auth_token: Option<String>,
}

impl SoundCloudStreamUrls {
    /// Selects the highest-fidelity full-length stream URL in priority order:
    /// 1. `hls_aac_160_url` (160 kbps AAC HLS — superior acoustic transparency)
    /// 2. `hls_mp3_128_url` (128 kbps MP3 HLS)
    /// 3. `http_mp3_128_url` (128 kbps progressive HTTP MP3)
    /// 4. `hls_aac_96_url`
    /// 5. `drm_hls_url` (160 kbps AAC `cenc` encrypted HLS via API v2 + Widevine CDM)
    /// 6. `preview_mp3_128_url` (last-resort fallback when unsigned)
    pub fn preferred_stream(&self) -> Option<(&str, bool)> {
        if let Some(ref u) = self.hls_aac_160_url {
            if !u.trim().is_empty() {
                return Some((u.as_str(), true));
            }
        }
        if let Some(ref u) = self.hls_mp3_128_url {
            if !u.trim().is_empty() {
                return Some((u.as_str(), true));
            }
        }
        if let Some(ref u) = self.http_mp3_128_url {
            if !u.trim().is_empty() {
                return Some((u.as_str(), false));
            }
        }
        if let Some(ref u) = self.hls_aac_96_url {
            if !u.trim().is_empty() {
                return Some((u.as_str(), true));
            }
        }
        if let Some(ref u) = self.drm_hls_url {
            if !u.trim().is_empty() {
                return Some((u.as_str(), true));
            }
        }
        if let Some(ref u) = self.preview_mp3_128_url {
            if !u.trim().is_empty() {
                return Some((u.as_str(), false));
            }
        }
        None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SoundCloudTokenBundle {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub auth_mode: String, // "user" | "client_credentials"
    pub username: String,
}

#[derive(Debug, Clone, Default)]
pub struct ResolvedSoundCloudCredentials {
    pub client_id: String,
    pub client_secret: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub auth_mode: String,
    pub username: String,
}

#[derive(Debug, Clone)]
struct PendingPkceFlow {
    pub state: String,
    pub code_verifier: String,
    pub redirect_uri: String,
    pub created_at: Instant,
}

#[derive(Debug, Clone)]
struct TrackHintEntry {
    pub meta: TrackMetadata,
    pub waveform_url: Option<String>,
    pub permalink_url: Option<String>,
    pub bpm: Option<u32>,
    pub favoritings_count: Option<u64>,
    pub playback_count: Option<u64>,
    pub user_id: Option<String>,
    pub chapters: Vec<SoundCloudMixChapter>,
}

static TOKEN_CACHE: OnceLock<Mutex<Option<SoundCloudTokenBundle>>> = OnceLock::new();
static TOKEN_REFRESH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static PKCE_FLOWS: OnceLock<Mutex<VecDeque<PendingPkceFlow>>> = OnceLock::new();
static TRACK_HINTS: OnceLock<Mutex<HashMap<String, TrackHintEntry>>> = OnceLock::new();
static WAVEFORM_CACHE: OnceLock<Mutex<HashMap<String, SoundCloudWaveform>>> = OnceLock::new();
static COMMENTS_CACHE: OnceLock<Mutex<HashMap<String, (Instant, Vec<SoundCloudComment>)>>> =
    OnceLock::new();

fn token_cache() -> &'static Mutex<Option<SoundCloudTokenBundle>> {
    TOKEN_CACHE.get_or_init(|| Mutex::new(None))
}

fn token_refresh_lock() -> &'static Mutex<()> {
    TOKEN_REFRESH_LOCK.get_or_init(|| Mutex::new(()))
}

fn pkce_flows() -> &'static Mutex<VecDeque<PendingPkceFlow>> {
    PKCE_FLOWS.get_or_init(|| Mutex::new(VecDeque::with_capacity(8)))
}

fn track_hints() -> &'static Mutex<HashMap<String, TrackHintEntry>> {
    TRACK_HINTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn waveform_cache() -> &'static Mutex<HashMap<String, SoundCloudWaveform>> {
    WAVEFORM_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn comments_cache() -> &'static Mutex<HashMap<String, (Instant, Vec<SoundCloudComment>)>> {
    COMMENTS_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn clear_cached_soundcloud_state() {
    if let Ok(mut g) = token_cache().lock() {
        *g = None;
    }
    if let Ok(mut g) = comments_cache().lock() {
        g.clear();
    }
    if let Ok(mut g) = track_hints().lock() {
        g.clear();
    }
}

pub fn clear_soundcloud_track_hints() {
    if let Ok(mut g) = track_hints().lock() {
        g.clear();
    }
}

pub fn update_cached_soundcloud_tokens(bundle: SoundCloudTokenBundle) {
    if let Ok(mut g) = token_cache().lock() {
        // Never overwrite an active personal user session (`refresh_token` present) with a `client_credentials` token
        if bundle.auth_mode == "client_credentials" {
            if let Some(ref existing) = *g {
                if !existing.refresh_token.trim().is_empty() {
                    return;
                }
            }
        }
        *g = Some(bundle);
    }
}

pub fn get_cached_soundcloud_tokens() -> Option<SoundCloudTokenBundle> {
    token_cache().lock().ok().and_then(|g| g.clone())
}

/// Synchronizes the most recent SoundCloud OAuth token bundle (from `TOKEN_CACHE` or disk `settings.vdf`)
/// into `settings` before saving to disk or updating daemon state, preventing stale `SimpSettings`
/// clones (e.g. during volume/brightness updates) from overwriting a rotated single-use `refresh_token`.
pub fn sync_latest_soundcloud_tokens_into_settings(settings: &mut SimpSettings) {
    if !settings.services.soundcloud_enabled {
        return;
    }

    if let Some(cached) = get_cached_soundcloud_tokens() {
        let cached_is_newer_or_user = !cached.access_token.trim().is_empty()
            && (cached.expires_at >= settings.services.soundcloud_token_expires_at
                || (cached.auth_mode == "user"
                    && settings.services.soundcloud_auth_mode.trim() != "user")
                || (!cached.refresh_token.trim().is_empty()
                    && settings.services.soundcloud_refresh_token.trim().is_empty()));
        if cached_is_newer_or_user {
            settings.services.soundcloud_access_token = cached.access_token;
            if !cached.refresh_token.trim().is_empty() {
                settings.services.soundcloud_refresh_token = cached.refresh_token;
            }
            settings.services.soundcloud_token_expires_at = cached.expires_at;
            if !cached.auth_mode.trim().is_empty() {
                settings.services.soundcloud_auth_mode = cached.auth_mode;
            }
            if !cached.username.trim().is_empty() {
                settings.services.soundcloud_username = cached.username;
            }
        }
    }
}

pub fn clean_soundcloud_id(raw: &str) -> String {
    let trimmed = raw.trim();
    for prefix in [
        "soundcloud:station:track:",
        "soundcloud:system-playlists:",
        "soundcloud:selections:",
        "soundcloud:track:",
        "soundcloud:tracks:",
        "soundcloud:playlist:",
        "soundcloud:playlists:",
        "soundcloud:",
    ] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return rest.trim().to_string();
        }
    }
    trimmed.to_string()
}

/// Upscales SoundCloud artwork URLs from default `-large.jpg` (100x100) to `-t500x500.jpg` (500x500).
pub fn format_soundcloud_art_url(raw_url: Option<&str>) -> Option<String> {
    let raw = raw_url?.trim();
    if raw.is_empty() || raw.contains("default_avatar") {
        return None;
    }
    if raw.contains("-large.") {
        Some(raw.replace("-large.", "-t500x500."))
    } else if raw.contains("-t300x300.") {
        Some(raw.replace("-t300x300.", "-t500x500."))
    } else {
        Some(raw.to_string())
    }
}

/// Formats compact social/play counts (e.g., `1420` -> `"1.4K"`, `2500000` -> `"2.5M"`).
pub fn format_compact_count(count: u64) -> String {
    if count >= 1_000_000 {
        format!("{:.1}M", count as f64 / 1_000_000.0)
    } else if count >= 1_000 {
        format!("{:.1}K", count as f64 / 1_000.0)
    } else {
        count.to_string()
    }
}

/// Parses timestamped tracklist chapters (`MM:SS` or `HH:MM:SS`) from a SoundCloud DJ Mix description.
pub fn parse_description_chapters(description: &str, duration_ms: u32) -> Vec<SoundCloudMixChapter> {
    let mut chapters = Vec::new();
    for raw_line in description.lines() {
        let line = raw_line.trim();
        if line.len() < 4 || line.len() > 200 {
            continue;
        }
        if let Some((ts_ms, label)) = extract_line_timestamp_and_label(line) {
            if duration_ms > 0 && ts_ms >= duration_ms {
                continue;
            }
            if !label.is_empty() && !chapters.iter().any(|c: &SoundCloudMixChapter| c.timestamp_ms == ts_ms) {
                chapters.push(SoundCloudMixChapter {
                    label,
                    timestamp_ms: ts_ms,
                });
            }
        }
    }
    chapters.sort_by_key(|c| c.timestamp_ms);
    if chapters.len() >= 2 {
        chapters
    } else {
        Vec::new()
    }
}

fn extract_line_timestamp_and_label(line: &str) -> Option<(u32, String)> {
    // Strip optional leading bullet or track number like "01.", "1)", "- ", "[01]"
    let trimmed = line
        .trim_start_matches(|c: char| c == '-' || c == '•' || c == '*' || c.is_whitespace());

    // Find first `[` or digit sequence containing `:`
    let bytes = trimmed.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b':') {
                i += 1;
            }
            let candidate = &trimmed[start..i];
            if candidate.contains(':') {
                if let Some(ms) = parse_colon_timestamp_ms(candidate) {
                    let before = trimmed[..start]
                        .trim()
                        .trim_matches(|c: char| c == '[' || c == '(' || c == '-' || c == '.' || c == ')')
                        .trim();
                    let after = trimmed[i..]
                        .trim()
                        .trim_start_matches(|c: char| {
                            c == ']' || c == ')' || c == '-' || c == '–' || c == '—' || c == ':' || c.is_whitespace()
                        })
                        .trim();
                    let label = if !after.is_empty() {
                        after.to_string()
                    } else if !before.is_empty() && !before.chars().all(|c| c.is_ascii_digit()) {
                        before.to_string()
                    } else {
                        String::new()
                    };
                    if !label.is_empty() {
                        return Some((ms, label));
                    }
                }
            }
        } else {
            i += 1;
        }
    }
    None
}

fn parse_colon_timestamp_ms(token: &str) -> Option<u32> {
    let parts: Vec<&str> = token.split(':').collect();
    match parts.len() {
        2 => {
            let mins = parts[0].parse::<u32>().ok()?;
            let secs = parts[1].parse::<u32>().ok()?;
            if secs >= 60 || mins > 600 {
                return None;
            }
            Some((mins * 60 + secs) * 1000)
        }
        3 => {
            let hours = parts[0].parse::<u32>().ok()?;
            let mins = parts[1].parse::<u32>().ok()?;
            let secs = parts[2].parse::<u32>().ok()?;
            if mins >= 60 || secs >= 60 || hours > 24 {
                return None;
            }
            Some((hours * 3600 + mins * 60 + secs) * 1000)
        }
        _ => None,
    }
}

/// Maps a SoundCloud API track JSON object to SIMP's `TrackMetadata`.
pub fn map_soundcloud_item_to_track(item: &Value) -> Option<TrackMetadata> {
    // Handle activity stream wrapper (`{"origin": { ...track... }}`) if present
    let obj = item.get("origin").unwrap_or(item);

    // Filter out non-tracks if inside a mixed collection
    if let Some(kind) = obj.get("kind").and_then(|v| v.as_str()) {
        if kind != "track" {
            return None;
        }
    }

    // Respect `access` tier (API v1) and `media.transcodings` / `policy` (API v2):
    // - On API v2 (`media.transcodings` array present), a track with `policy: "BLOCK"` or empty
    //   `transcodings` has no streams; a track with at least one `snipped: false` transcoding is
    //   full-length (`is_preview = false`), whereas a track where all transcodings are `snipped: true`
    //   (or `policy == "SNIP"`) is a 30s preview (`is_preview = true`).
    // - On API v1, skip `access == "blocked"` and mark `access == "preview"` as `is_preview = true`.
    let is_preview = if let Some(transcodings) =
        obj.pointer("/media/transcodings").and_then(|v| v.as_array())
    {
        let policy = obj
            .get("policy")
            .and_then(|v| v.as_str())
            .unwrap_or("ALLOW");
        if policy == "BLOCK" || transcodings.is_empty() {
            return None;
        }
        let has_full_transcoding = transcodings
            .iter()
            .any(|t| !t.get("snipped").and_then(|v| v.as_bool()).unwrap_or(false));
        policy == "SNIP" || !has_full_transcoding
    } else {
        let access_tier = obj
            .get("access")
            .and_then(|v| v.as_str())
            .unwrap_or("playable");
        if access_tier == "blocked" {
            return None;
        }
        access_tier == "preview"
    };

    let raw_id = if let Some(urn) = obj.get("urn").and_then(|v| v.as_str()) {
        clean_soundcloud_id(urn)
    } else if let Some(id_num) = obj.get("id").and_then(|v| v.as_u64()) {
        id_num.to_string()
    } else if let Some(id_str) = obj.get("id").and_then(|v| v.as_str()) {
        clean_soundcloud_id(id_str)
    } else {
        return None;
    };

    if raw_id.is_empty() {
        return None;
    }

    // Skip unhydrated playlist track stubs (`{"id": 12345, "kind": "track"}` with no `"title"` field)
    let title = obj
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())?
        .to_string();

    let artist = obj
        .pointer("/user/username")
        .or_else(|| obj.pointer("/metadata_artist"))
        .and_then(|v| v.as_str())
        .unwrap_or("SoundCloud Artist")
        .trim()
        .to_string();

    let user_id = obj
        .pointer("/user/urn")
        .and_then(|v| v.as_str())
        .map(clean_soundcloud_id)
        .or_else(|| {
            obj.pointer("/user/id")
                .and_then(|v| v.as_u64())
                .map(|n| n.to_string())
        })
        .or_else(|| {
            obj.pointer("/user/id")
                .and_then(|v| v.as_str())
                .map(clean_soundcloud_id)
        })
        .filter(|s| !s.is_empty());

    let genre = obj
        .get("genre")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let duration_ms = obj
        .get("duration")
        .or_else(|| obj.get("full_duration"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    let bpm = obj
        .get("bpm")
        .and_then(|v| v.as_f64())
        .map(|b| b.round() as u32)
        .filter(|&b| (40..=260).contains(&b));

    let favoritings_count = obj
        .get("favoritings_count")
        .or_else(|| obj.get("likes_count"))
        .and_then(|v| v.as_u64())
        .filter(|&c| c > 0);

    let playback_count = obj
        .get("playback_count")
        .and_then(|v| v.as_u64())
        .filter(|&c| c > 0);

    let mut album_label = if duration_ms >= 20 * 60 * 1000 {
        match genre {
            Some(g) => format!("SoundCloud Mix • {g}"),
            None => "SoundCloud DJ Mix".to_string(),
        }
    } else {
        match genre {
            Some(g) => format!("SoundCloud • {g}"),
            None => "SoundCloud".to_string(),
        }
    };
    if is_preview {
        album_label.push_str(" • Preview");
    }
    if let Some(b) = bpm {
        album_label.push_str(&format!(" • {b} BPM"));
    }
    if let Some(favs) = favoritings_count {
        album_label.push_str(&format!(" • ♥ {}", format_compact_count(favs)));
    }

    let raw_art = obj
        .get("artwork_url")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .or_else(|| obj.pointer("/user/avatar_url").and_then(|v| v.as_str()));
    let art_url = format_soundcloud_art_url(raw_art);

    let waveform_url = obj
        .get("waveform_url")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let permalink_url = obj
        .get("permalink_url")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
        .or_else(|| {
            obj.pointer("/user/permalink_url")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
        });

    let description = obj
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let chapters = match description {
        Some(desc) => parse_description_chapters(desc, duration_ms),
        None => Vec::new(),
    };

    let meta = TrackMetadata {
        uri: format!("soundcloud:track:{raw_id}"),
        title,
        artists: vec![artist],
        album: album_label,
        album_id: None,
        track_number: None,
        disc_number: Some(1),
        art_url,
        duration_ms,
        source: "soundcloud".to_string(),
        mount_root: None,
    };

    if let Ok(mut guard) = track_hints().lock() {
        if guard.len() > 4000 {
            guard.clear();
        }
        guard.insert(
            raw_id,
            TrackHintEntry {
                meta: meta.clone(),
                waveform_url,
                permalink_url,
                bpm,
                favoritings_count,
                playback_count,
                user_id,
                chapters,
            },
        );
    }

    Some(meta)
}

pub fn map_soundcloud_item_to_playlist(item: &Value, default_kind: &str) -> Option<SoundCloudPlaylistSummary> {
    let obj = item.get("playlist").or_else(|| item.get("origin")).unwrap_or(item);
    let raw_id = if let Some(urn) = obj.get("urn").and_then(|v| v.as_str()) {
        clean_soundcloud_id(urn)
    } else if let Some(id_num) = obj.get("id").and_then(|v| v.as_u64()) {
        id_num.to_string()
    } else if let Some(id_str) = obj.get("id").and_then(|v| v.as_str()) {
        clean_soundcloud_id(id_str)
    } else {
        return None;
    };
    if raw_id.is_empty() {
        return None;
    }

    let name = obj
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("SoundCloud Set")
        .trim()
        .to_string();
    let creator = obj
        .pointer("/user/username")
        .and_then(|v| v.as_str())
        .unwrap_or("SoundCloud")
        .trim()
        .to_string();
    let raw_desc = obj
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let description = if raw_desc.is_empty() {
        format!("Set by {creator}")
    } else {
        raw_desc.lines().next().unwrap_or("").to_string()
    };

    let mut embedded_tracks = Vec::new();
    let mut non_blocked_in_array = 0usize;
    let has_tracks_array = if let Some(arr) = obj.get("tracks").and_then(|v| v.as_array()) {
        for t_val in arr {
            let t_obj = t_val.get("origin").unwrap_or(t_val);
            let acc = t_obj.get("access").and_then(|v| v.as_str());
            let pol = t_obj.get("policy").and_then(|v| v.as_str());
            if acc != Some("blocked") && pol != Some("BLOCK") && pol != Some("SNIP") {
                non_blocked_in_array += 1;
            }
            if let Some(t) = map_soundcloud_item_to_track(t_val) {
                embedded_tracks.push(t);
            }
        }
        // If `tracks` is present as an array on the playlist object and has 0 non-blocked tracks
        // (either `arr` is empty after SoundCloud's server-side filter, or every item in `arr`
        // is `blocked`), skip this playlist so unstreamable sets do not appear as cards that open to "0 tracks".
        if non_blocked_in_array == 0 {
            return None;
        }
        true
    } else {
        false
    };

    let reported_count = obj
        .get("track_count")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(0);

    let track_count = if has_tracks_array {
        non_blocked_in_array.max(embedded_tracks.len())
    } else {
        reported_count
    };

    if track_count == 0 && embedded_tracks.is_empty() {
        return None;
    }

    let duration_ms = obj
        .get("duration")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    let raw_art = obj
        .get("artwork_url")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            obj.pointer("/tracks/0/artwork_url")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
        })
        .or_else(|| obj.pointer("/user/avatar_url").and_then(|v| v.as_str()));

    let permalink_url = obj
        .get("permalink_url")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
        .or_else(|| {
            obj.pointer("/user/permalink_url")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
        });

    Some(SoundCloudPlaylistSummary {
        id: raw_id,
        name,
        description,
        creator,
        art_url: format_soundcloud_art_url(raw_art),
        track_count,
        duration_ms,
        kind: default_kind.to_string(),
        permalink_url,
        tracks: embedded_tracks,
    })
}

/// Resolves SoundCloud credentials from `SimpSettings`, in-memory cache, environment variables,
/// `.env` files (`./.env`, parent git repo `.env` if in a worktree, or `~/.config/simp/.env`),
/// and compile-time public `SIMP_EMBEDDED_SOUNDCLOUD_CLIENT_ID` (never embedding `client_secret`).
pub fn resolve_soundcloud_credentials(settings: &SimpSettings) -> ResolvedSoundCloudCredentials {
    let dotenv_map = load_dotenv_candidates();
    let get_val = |setting_val: &str, env_key: &str| -> String {
        if !setting_val.trim().is_empty() {
            return setting_val.trim().to_string();
        }
        if let Ok(v) = std::env::var(env_key) {
            if !v.trim().is_empty() {
                return v.trim().to_string();
            }
        }
        if let Some(v) = dotenv_map.get(env_key) {
            if !v.trim().is_empty() {
                return v.trim().to_string();
            }
        }
        String::new()
    };

    let mut client_id = get_val(
        &settings.services.soundcloud_client_id,
        "SOUNDCLOUD_CLIENT_ID",
    );
    if client_id.is_empty() {
        if let Some(embedded) = option_env!("SIMP_EMBEDDED_SOUNDCLOUD_CLIENT_ID") {
            if !embedded.trim().is_empty() {
                client_id = embedded.trim().to_string();
            }
        }
    }
    if client_id.is_empty() {
        client_id = SOUNDCLOUD_DEFAULT_CLIENT_ID.to_string();
    }

    // Optional local BYO override only; distributed binaries never embed `client_secret`
    // and route token exchanges through `SOUNDCLOUD_DEFAULT_TOKEN_PROXY_URL` (`https://simp-tap-67.niiiitz.workers.dev`).
    let client_secret = get_val(
        &settings.services.soundcloud_client_secret,
        "SOUNDCLOUD_CLIENT_SECRET",
    );

    let mut access_token = settings.services.soundcloud_access_token.trim().to_string();
    let mut refresh_token = settings
        .services
        .soundcloud_refresh_token
        .trim()
        .to_string();
    let mut expires_at = settings.services.soundcloud_token_expires_at;
    let mut auth_mode = settings.services.soundcloud_auth_mode.trim().to_string();
    let mut username = settings.services.soundcloud_username.trim().to_string();

    // Check persisted `settings.vdf` on disk in case an earlier background refresh updated it
    // while the caller's in-memory `SimpSettings` clone still holds an older token/refresh_token.
    let disk_vdf = crate::library::vdf::load_or_create_settings();
    let disk_srv = &disk_vdf.services;
    if !disk_srv.soundcloud_access_token.trim().is_empty()
        && (access_token.is_empty()
            || disk_srv.soundcloud_token_expires_at >= expires_at
            || (disk_srv.soundcloud_auth_mode.trim() == "user" && auth_mode != "user"))
    {
        access_token = disk_srv.soundcloud_access_token.trim().to_string();
        expires_at = disk_srv.soundcloud_token_expires_at;
        auth_mode = disk_srv.soundcloud_auth_mode.trim().to_string();
        if !disk_srv.soundcloud_username.trim().is_empty() {
            username = disk_srv.soundcloud_username.trim().to_string();
        }
    }
    if disk_srv.soundcloud_refresh_token.trim().is_empty()
        && disk_srv.soundcloud_auth_mode.trim() == "client_credentials"
    {
        refresh_token.clear();
    } else if !disk_srv.soundcloud_refresh_token.trim().is_empty()
        && (refresh_token.is_empty() || disk_srv.soundcloud_token_expires_at >= expires_at)
    {
        refresh_token = disk_srv.soundcloud_refresh_token.trim().to_string();
    }

    if let Some(cached) = get_cached_soundcloud_tokens() {
        // Prefer the in-memory token if settings hasn't been reloaded yet or if cached is newer
        let use_cached = access_token.is_empty()
            || (cached.auth_mode == "user" && auth_mode != "user")
            || (!cached.refresh_token.is_empty() && refresh_token.is_empty())
            || (cached.expires_at >= expires_at && cached.auth_mode == auth_mode);
        if use_cached {
            access_token = cached.access_token;
            if !cached.refresh_token.is_empty() {
                refresh_token = cached.refresh_token;
            }
            expires_at = cached.expires_at;
            auth_mode = cached.auth_mode;
            if !cached.username.is_empty() {
                username = cached.username;
            }
        }
    } else if !access_token.is_empty() {
        // Seed TOKEN_CACHE from disk/settings on startup so `save_settings` always knows the latest token
        update_cached_soundcloud_tokens(SoundCloudTokenBundle {
            access_token: access_token.clone(),
            refresh_token: refresh_token.clone(),
            expires_at,
            auth_mode: auth_mode.clone(),
            username: username.clone(),
        });
    }

    ResolvedSoundCloudCredentials {
        client_id,
        client_secret,
        access_token,
        refresh_token,
        expires_at,
        auth_mode,
        username,
    }
}

fn load_dotenv_candidates() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut paths: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        paths.push(cwd.join(".env"));
        // If running inside a git worktree (`gitdir: /path/to/repo/.git/worktrees/...`), also check main repo `.env`
        let dot_git = cwd.join(".git");
        if dot_git.is_file() {
            if let Ok(git_ref) = std::fs::read_to_string(&dot_git) {
                if let Some(gitdir_str) = git_ref.trim().strip_prefix("gitdir:") {
                    let gitdir_path = PathBuf::from(gitdir_str.trim());
                    if let Some(repo_root) = gitdir_path
                        .parent()
                        .and_then(|p| p.parent())
                        .and_then(|p| p.parent())
                    {
                        paths.push(repo_root.join(".env"));
                    }
                }
            }
        }
    }
    if let Some(cfg_dir) = dirs::config_dir() {
        paths.push(cfg_dir.join("simp").join(".env"));
    }

    for path in paths {
        if let Ok(content) = std::fs::read_to_string(&path) {
            for raw_line in content.lines() {
                let line = raw_line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = line.split_once('=') {
                    let key = k.trim().to_string();
                    let val = v
                        .trim()
                        .trim_matches('\'')
                        .trim_matches('"')
                        .to_string();
                    map.entry(key).or_insert(val);
                }
            }
        }
    }
    map
}

/// Pure-Rust RFC 6234 SHA-256 implementation for OAuth 2.1 PKCE `S256` code challenge generation.
pub fn sha256_digest(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (data.len() as u64) * 8;
    let mut padded = Vec::with_capacity(data.len() + 72);
    padded.extend_from_slice(data);
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0x00);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

/// Computes the RFC 7636 PKCE `S256` `code_challenge` (`BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))`).
pub fn pkce_code_challenge_s256(code_verifier: &str) -> String {
    let digest = sha256_digest(code_verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn generate_random_url_safe_token(byte_len: usize) -> String {
    let mut buf = vec![0u8; byte_len];
    #[allow(unused_mut)]
    let mut filled = false;
    #[cfg(unix)]
    {
        if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
            use std::io::Read;
            if f.read_exact(&mut buf).is_ok() {
                filled = true;
            }
        }
    }
    if !filled {
        let now_nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let seed = format!("simp-pkce-{now_nanos}-{}", std::process::id());
        let h1 = blake3::hash(seed.as_bytes());
        let h2 = blake3::hash(h1.as_bytes());
        for (i, b) in buf.iter_mut().enumerate() {
            *b = if i < 32 {
                h1.as_bytes()[i]
            } else {
                h2.as_bytes()[i % 32]
            };
        }
    }
    URL_SAFE_NO_PAD.encode(&buf)
}

pub fn url_encode_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 16);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{b:02X}"));
            }
        }
    }
    out
}

/// Initiates an OAuth 2.1 Authorization Code + PKCE (`S256`) flow and returns `(authorize_url, state)`.
pub fn start_oauth_pkce_flow(
    settings: &SimpSettings,
    redirect_uri_override: Option<&str>,
) -> Result<(String, String)> {
    let creds = resolve_soundcloud_credentials(settings);
    if creds.client_id.is_empty() {
        return Err(anyhow!(
            "Missing SOUNDCLOUD_CLIENT_ID in settings or .env"
        ));
    }

    let redirect_uri = redirect_uri_override
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(SOUNDCLOUD_DEFAULT_REDIRECT_URI)
        .to_string();

    let code_verifier = generate_random_url_safe_token(48);
    let code_challenge = pkce_code_challenge_s256(&code_verifier);
    let state = generate_random_url_safe_token(18);

    if let Ok(mut guard) = pkce_flows().lock() {
        guard.retain(|f| f.created_at.elapsed() < Duration::from_secs(1800));
        while guard.len() >= 8 {
            guard.pop_front();
        }
        guard.push_back(PendingPkceFlow {
            state: state.clone(),
            code_verifier,
            redirect_uri: redirect_uri.clone(),
            created_at: Instant::now(),
        });
    }

    let authorize_url = format!(
        "https://secure.soundcloud.com/authorize?client_id={}&redirect_uri={}&response_type=code&code_challenge={}&code_challenge_method=S256&state={}",
        url_encode_component(&creds.client_id),
        url_encode_component(&redirect_uri),
        url_encode_component(&code_challenge),
        url_encode_component(&state),
    );

    Ok((authorize_url, state))
}

fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn resolve_token_proxy_url() -> String {
    if let Ok(v) = std::env::var("SOUNDCLOUD_TOKEN_PROXY_URL") {
        if !v.trim().is_empty() {
            return v.trim().to_string();
        }
    }
    let dotenv_map = load_dotenv_candidates();
    if let Some(v) = dotenv_map.get("SOUNDCLOUD_TOKEN_PROXY_URL") {
        if !v.trim().is_empty() {
            return v.trim().to_string();
        }
    }
    SOUNDCLOUD_DEFAULT_TOKEN_PROXY_URL.to_string()
}

/// Exchanges an OAuth 2.1 `code` + PKCE `code_verifier` for a SoundCloud user `access_token` and `refresh_token`.
pub fn exchange_oauth_code(
    settings: &SimpSettings,
    code: &str,
    state: Option<&str>,
    redirect_uri_override: Option<&str>,
) -> Result<SoundCloudTokenBundle> {
    let creds = resolve_soundcloud_credentials(settings);
    if creds.client_id.is_empty() {
        return Err(anyhow!("Missing SOUNDCLOUD_CLIENT_ID"));
    }

    let mut matched_flow: Option<PendingPkceFlow> = None;
    if let Ok(mut guard) = pkce_flows().lock() {
        guard.retain(|f| f.created_at.elapsed() < Duration::from_secs(1800));
        if let Some(st) = state.map(|s| s.trim()).filter(|s| !s.is_empty()) {
            if let Some(pos) = guard.iter().position(|f| f.state == st) {
                matched_flow = guard.remove(pos);
            }
        }
        if matched_flow.is_none() {
            matched_flow = guard.pop_back();
        }
    }

    let flow = matched_flow.ok_or_else(|| {
        anyhow!("No pending SoundCloud PKCE login session found — please click Sign In again")
    })?;
    let redirect_uri = redirect_uri_override
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(&flow.redirect_uri);

    let proxy_body = format!(
        "grant_type=authorization_code&client_id={}&redirect_uri={}&code_verifier={}&code={}",
        url_encode_component(&creds.client_id),
        url_encode_component(redirect_uri),
        url_encode_component(&flow.code_verifier),
        url_encode_component(code.trim()),
    );

    let mut bundle = if creds.client_secret.is_empty()
        || creds.client_id == SOUNDCLOUD_DEFAULT_CLIENT_ID
    {
        post_oauth_token_request_via_proxy(&proxy_body, "user").or_else(|proxy_err| {
            if !creds.client_secret.is_empty() {
                let direct_body = format!(
                    "{proxy_body}&client_secret={}",
                    url_encode_component(&creds.client_secret)
                );
                post_oauth_token_request(&direct_body, None, "user")
            } else {
                Err(proxy_err)
            }
        })?
    } else {
        let direct_body = format!(
            "{proxy_body}&client_secret={}",
            url_encode_component(&creds.client_secret)
        );
        post_oauth_token_request(&direct_body, None, "user")?
    };

    if let Ok(me) = soundcloud_get_json("/me", &bundle.access_token) {
        if let Some(uname) = me.get("username").and_then(|v| v.as_str()) {
            bundle.username = uname.trim().to_string();
        }
    }
    update_cached_soundcloud_tokens(bundle.clone());
    persist_soundcloud_tokens_to_settings_vdf(&bundle);
    Ok(bundle)
}

/// Obtains a `client_credentials` token via the stateless Cloudflare Worker proxy
/// (or directly using `SOUNDCLOUD_CLIENT_SECRET` if a custom BYO secret is configured locally).
pub fn obtain_client_credentials_token(settings: &SimpSettings) -> Result<SoundCloudTokenBundle> {
    let creds = resolve_soundcloud_credentials(settings);
    if creds.client_id.is_empty() {
        return Err(anyhow!(
            "Missing SOUNDCLOUD_CLIENT_ID in settings or .env"
        ));
    }

    let proxy_body = format!(
        "grant_type=client_credentials&client_id={}",
        url_encode_component(&creds.client_id),
    );

    let mut bundle = if creds.client_secret.is_empty()
        || creds.client_id == SOUNDCLOUD_DEFAULT_CLIENT_ID
    {
        post_oauth_token_request_via_proxy(&proxy_body, "client_credentials").or_else(
            |proxy_err| {
                if !creds.client_secret.is_empty() {
                    let basic_b64 =
                        BASE64_STD.encode(format!("{}:{}", creds.client_id, creds.client_secret));
                    let basic_header = format!("Basic {basic_b64}");
                    let direct_body = format!(
                        "{proxy_body}&client_secret={}",
                        url_encode_component(&creds.client_secret),
                    );
                    post_oauth_token_request(
                        &direct_body,
                        Some(&basic_header),
                        "client_credentials",
                    )
                } else {
                    Err(proxy_err)
                }
            },
        )?
    } else {
        let basic_b64 = BASE64_STD.encode(format!("{}:{}", creds.client_id, creds.client_secret));
        let basic_header = format!("Basic {basic_b64}");
        let direct_body = format!(
            "{proxy_body}&client_secret={}",
            url_encode_component(&creds.client_secret),
        );
        post_oauth_token_request(&direct_body, Some(&basic_header), "client_credentials")?
    };

    bundle.username = "Public Discovery (Client Credentials)".to_string();
    update_cached_soundcloud_tokens(bundle.clone());
    persist_soundcloud_tokens_to_settings_vdf(&bundle);
    Ok(bundle)
}

/// Refreshes an expired user OAuth token using its single-use `refresh_token`.
pub fn refresh_user_oauth_token(
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
    existing_username: &str,
) -> Result<SoundCloudTokenBundle> {
    let proxy_body = format!(
        "grant_type=refresh_token&client_id={}&refresh_token={}",
        url_encode_component(client_id),
        url_encode_component(refresh_token),
    );

    let mut bundle = if client_secret.trim().is_empty()
        || client_id.trim() == SOUNDCLOUD_DEFAULT_CLIENT_ID
    {
        post_oauth_token_request_via_proxy(&proxy_body, "user")?
    } else {
        let basic_b64 = BASE64_STD.encode(format!("{client_id}:{client_secret}"));
        let basic_header = format!("Basic {basic_b64}");
        let direct_body = format!(
            "{proxy_body}&client_secret={}",
            url_encode_component(client_secret),
        );
        post_oauth_token_request(&direct_body, None, "user")
            .or_else(|_| post_oauth_token_request(&direct_body, Some(&basic_header), "user"))?
    };

    if bundle.refresh_token.is_empty() {
        bundle.refresh_token = refresh_token.trim().to_string();
    }
    bundle.username = if existing_username == "Public Discovery (Client Credentials)" {
        String::new()
    } else {
        existing_username.to_string()
    };
    if bundle.username.is_empty() {
        if let Ok(me) = soundcloud_get_json("/me", &bundle.access_token) {
            if let Some(uname) = me.get("username").and_then(|v| v.as_str()) {
                bundle.username = uname.trim().to_string();
            }
        }
    }
    update_cached_soundcloud_tokens(bundle.clone());
    persist_soundcloud_tokens_to_settings_vdf(&bundle);
    Ok(bundle)
}

fn post_oauth_token_request_via_proxy(
    form_body: &str,
    auth_mode: &str,
) -> Result<SoundCloudTokenBundle> {
    let proxy_url = resolve_token_proxy_url();
    let headers = [
        ("Accept", "application/json; charset=utf-8"),
        ("Content-Type", "application/x-www-form-urlencoded"),
    ];
    let bytes = crate::http_pool::http_post_bytes(&proxy_url, &headers, form_body.as_bytes(), 15)
        .context("SoundCloud OAuth token proxy request failed")?;
    parse_oauth_token_response_bytes(&bytes, auth_mode)
}

fn post_oauth_token_request(
    form_body: &str,
    basic_auth: Option<&str>,
    auth_mode: &str,
) -> Result<SoundCloudTokenBundle> {
    let mut headers = vec![
        ("Accept", "application/json; charset=utf-8"),
        ("Content-Type", "application/x-www-form-urlencoded"),
    ];
    if let Some(basic) = basic_auth {
        headers.push(("Authorization", basic));
    }

    let bytes = crate::http_pool::http_post_bytes(
        "https://secure.soundcloud.com/oauth/token",
        &headers,
        form_body.as_bytes(),
        15,
    )
    .or_else(|_| {
        crate::http_pool::http_post_bytes(
            "https://api.soundcloud.com/oauth2/token",
            &headers,
            form_body.as_bytes(),
            15,
        )
    })
    .context("SoundCloud OAuth token request failed")?;

    parse_oauth_token_response_bytes(&bytes, auth_mode)
}

fn parse_oauth_token_response_bytes(
    bytes: &[u8],
    auth_mode: &str,
) -> Result<SoundCloudTokenBundle> {
    let json: Value =
        serde_json::from_slice(bytes).context("Invalid JSON from SoundCloud OAuth endpoint")?;
    if let Some(err_code) = json.get("error").and_then(|v| v.as_str()) {
        let desc = json
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        return Err(anyhow!(
            "SoundCloud OAuth error: {err_code}{}",
            if desc.is_empty() {
                String::new()
            } else {
                format!(" ({desc})")
            }
        ));
    }
    let access_token = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("SoundCloud token response did not include access_token"))?;
    let refresh_token = json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let expires_in = json
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .unwrap_or(3599);

    Ok(SoundCloudTokenBundle {
        access_token,
        refresh_token,
        expires_at: now_unix_secs() + expires_in,
        auth_mode: auth_mode.to_string(),
        username: String::new(),
    })
}

fn persist_soundcloud_tokens_to_settings_vdf(bundle: &SoundCloudTokenBundle) {
    let mut settings = crate::library::vdf::load_or_create_settings();
    // Never overwrite a personal user OAuth session (`refresh_token` present) with a `client_credentials` fallback token!
    if bundle.auth_mode == "client_credentials"
        && !settings.services.soundcloud_refresh_token.trim().is_empty()
    {
        return;
    }
    settings.services.soundcloud_enabled = true;
    settings.services.soundcloud_access_token = bundle.access_token.clone();
    if !bundle.refresh_token.is_empty() {
        settings.services.soundcloud_refresh_token = bundle.refresh_token.clone();
    }
    settings.services.soundcloud_token_expires_at = bundle.expires_at;
    settings.services.soundcloud_auth_mode = bundle.auth_mode.clone();
    if !bundle.username.is_empty() {
        settings.services.soundcloud_username = bundle.username.clone();
    }
    let _ = crate::library::vdf::save_settings(&settings);
}

fn clear_consumed_user_refresh_token(failed_refresh_token: &str) {
    let failed_trimmed = failed_refresh_token.trim();
    let mut settings = crate::library::vdf::load_or_create_settings();
    // Only clear if the token on disk is still the exact refresh_token that failed with `invalid_grant`
    // (never wipe a newly rotated refresh_token written by another thread).
    if !settings.services.soundcloud_refresh_token.trim().is_empty()
        && (failed_trimmed.is_empty()
            || settings.services.soundcloud_refresh_token.trim() == failed_trimmed)
    {
        settings.services.soundcloud_refresh_token.clear();
        if settings.services.soundcloud_auth_mode != "client_credentials" {
            settings.services.soundcloud_auth_mode = "client_credentials".to_string();
        }
        let _ = crate::library::vdf::save_settings_raw(&settings);
    }
    if let Ok(mut guard) = token_cache().lock() {
        if let Some(ref mut cached) = *guard {
            if failed_trimmed.is_empty() || cached.refresh_token.trim() == failed_trimmed {
                cached.refresh_token.clear();
            }
        }
    }
}

fn is_clobbered_user_token(creds: &ResolvedSoundCloudCredentials) -> bool {
    !creds.refresh_token.is_empty()
        && (creds.username == "Public Discovery (Client Credentials)" || creds.auth_mode != "user")
}

/// Resolves a valid SoundCloud OAuth access token, transparently refreshing user tokens
/// up to 10 minutes (`600s`) before expiry or minting a `client_credentials` token when
/// `SOUNDCLOUD_CLIENT_ID` & `SOUNDCLOUD_CLIENT_SECRET` are available.
pub fn ensure_valid_access_token(settings: &SimpSettings) -> Result<String> {
    let creds = resolve_soundcloud_credentials(settings);
    let now = now_unix_secs();

    if !creds.access_token.is_empty()
        && !is_clobbered_user_token(&creds)
        && (creds.expires_at == 0 || now + 600 < creds.expires_at)
    {
        return Ok(creds.access_token);
    }

    // Serialize token refreshes so concurrent requests never race on SoundCloud's single-use refresh_token
    let _guard = token_refresh_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let creds = resolve_soundcloud_credentials(settings);
    let now = now_unix_secs();

    if !creds.access_token.is_empty()
        && !is_clobbered_user_token(&creds)
        && (creds.expires_at == 0 || now + 600 < creds.expires_at)
    {
        return Ok(creds.access_token);
    }

    if !creds.refresh_token.is_empty() && !creds.client_id.is_empty() {
        match refresh_user_oauth_token(
            &creds.client_id,
            &creds.client_secret,
            &creds.refresh_token,
            &creds.username,
        ) {
            Ok(refreshed) => return Ok(refreshed.access_token),
            Err(refresh_err) => {
                let msg = format!("{refresh_err:#}");
                tracing::warn!("SoundCloud user OAuth refresh attempt failed: {msg}");
                if msg.contains("invalid_grant") {
                    clear_consumed_user_refresh_token(&creds.refresh_token);
                } else if !creds.access_token.is_empty() && now + 30 < creds.expires_at {
                    // Transient network failure during early (10m pre-expiry) refresh window:
                    // keep using the still-valid access_token and preserve refresh_token for next retry!
                    return Ok(creds.access_token);
                }
            }
        }
    }

    if !creds.access_token.is_empty() && (creds.expires_at == 0 || now + 30 < creds.expires_at) {
        return Ok(creds.access_token);
    }

    if !creds.client_id.is_empty() {
        let bundle = obtain_client_credentials_token(settings)?;
        return Ok(bundle.access_token);
    }

    if !creds.access_token.is_empty() {
        return Ok(creds.access_token);
    }

    Err(anyhow!(
        "SoundCloud is not authenticated — sign in via Sources (Select)"
    ))
}

/// Revokes the active SoundCloud token and clears in-memory and on-disk state.
pub fn disconnect_soundcloud_session(settings: &SimpSettings) {
    let creds = resolve_soundcloud_credentials(settings);
    if !creds.access_token.is_empty() {
        let auth_header = format!("OAuth {}", creds.access_token.trim());
        let body = serde_json::json!({ "access_token": creds.access_token }).to_string();
        let _ = crate::http_pool::http_post_bytes(
            "https://api.soundcloud.com/disconnect",
            &[
                ("Authorization", auth_header.as_str()),
                ("Content-Type", "application/json"),
            ],
            body.as_bytes(),
            6,
        );
    }
    clear_cached_soundcloud_state();
    let mut disk = crate::library::vdf::load_or_create_settings();
    disk.services.soundcloud_access_token.clear();
    disk.services.soundcloud_refresh_token.clear();
    disk.services.soundcloud_token_expires_at = 0;
    disk.services.soundcloud_auth_mode = "client_credentials".to_string();
    disk.services.soundcloud_username.clear();
    disk.services.soundcloud_enabled = true;
    let _ = crate::library::vdf::save_settings_raw(&disk);
}

pub fn is_soundcloud_ready(settings: &SimpSettings) -> bool {
    let creds = resolve_soundcloud_credentials(settings);
    !creds.access_token.is_empty() || !creds.client_id.is_empty()
}

/// Returns `true` when the user is signed in with a personal SoundCloud OAuth account (`auth_mode == "user"`),
/// as opposed to anonymous `client_credentials` Public Discovery mode.
pub fn is_soundcloud_user_signed_in(settings: &SimpSettings) -> bool {
    let creds = resolve_soundcloud_credentials(settings);
    !creds.refresh_token.trim().is_empty()
        || (creds.auth_mode.trim() == "user"
            && !creds.access_token.trim().is_empty()
            && creds.username != "Public Discovery (Client Credentials)")
}

fn access_param_for_session(settings: &SimpSettings) -> &'static str {
    if is_soundcloud_user_signed_in(settings) {
        "playable"
    } else {
        "playable,preview"
    }
}

fn is_preview_track_meta(t: &TrackMetadata) -> bool {
    t.album.contains("• Preview") || t.album.ends_with("Preview")
}

fn should_keep_track_for_session(t: &TrackMetadata, signed_in: bool) -> bool {
    if signed_in && is_preview_track_meta(t) {
        return false;
    }
    true
}

fn should_keep_playlist_for_session(pl: &mut SoundCloudPlaylistSummary, signed_in: bool) -> bool {
    if signed_in && !pl.tracks.is_empty() {
        pl.tracks.retain(|t| !is_preview_track_meta(t));
        if pl.tracks.is_empty() {
            return false;
        }
        pl.track_count = pl.tracks.len();
    }
    pl.track_count > 0 || !pl.tracks.is_empty()
}

const DEFAULT_SOUNDCLOUD_V2_CLIENT_ID: &str = "39AVoiZVrdvJEMFLH8T0c5WGshQaAPRJ";
static V2_CLIENT_ID_CACHE: OnceLock<Mutex<String>> = OnceLock::new();

fn v2_client_id_cache() -> &'static Mutex<String> {
    V2_CLIENT_ID_CACHE.get_or_init(|| Mutex::new(DEFAULT_SOUNDCLOUD_V2_CLIENT_ID.to_string()))
}

pub fn resolve_soundcloud_v2_client_id() -> String {
    v2_client_id_cache()
        .lock()
        .ok()
        .map(|g| g.clone())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_SOUNDCLOUD_V2_CLIENT_ID.to_string())
}

fn refresh_soundcloud_v2_client_id() -> Option<String> {
    let html_bytes = crate::http_pool::http_get_bytes("https://soundcloud.com", &[], None, 10).ok()?;
    let html = String::from_utf8_lossy(&html_bytes);
    let mut script_urls = Vec::new();
    for part in html.split("https://a-v2.sndcdn.com/assets/") {
        if let Some(end) = part.find(".js") {
            let asset = &part[..end + 3];
            if !asset.is_empty() && asset.len() < 80 {
                script_urls.push(format!("https://a-v2.sndcdn.com/assets/{asset}"));
            }
        }
    }
    for url in script_urls.into_iter().rev().take(6) {
        let Ok(js_bytes) = crate::http_pool::http_get_bytes(&url, &[], None, 10) else {
            continue;
        };
        let js = String::from_utf8_lossy(&js_bytes);
        for needle in ["client_id:\"", "client_id: \"", "\"client_id\":\""] {
            if let Some(idx) = js.find(needle) {
                let rest = &js[idx + needle.len()..];
                if let Some(end_q) = rest.find('"') {
                    let candidate = &rest[..end_q];
                    if candidate.len() == 32 && candidate.chars().all(|c| c.is_ascii_alphanumeric()) {
                        if let Ok(mut guard) = v2_client_id_cache().lock() {
                            *guard = candidate.to_string();
                        }
                        return Some(candidate.to_string());
                    }
                }
            }
        }
    }
    None
}

fn build_v2_url_with_client_id(path_or_url: &str, client_id: &str) -> String {
    let base = if path_or_url.starts_with("https://") || path_or_url.starts_with("http://") {
        path_or_url.to_string()
    } else if path_or_url.starts_with('/') {
        format!("https://api-v2.soundcloud.com{path_or_url}")
    } else {
        format!("https://api-v2.soundcloud.com/{path_or_url}")
    };
    let sep = if base.contains('?') { '&' } else { '?' };
    format!("{base}{sep}client_id={}", url_encode_component(client_id))
}

pub fn soundcloud_v2_get_json(path_or_url: &str) -> Result<Value> {
    let cid = resolve_soundcloud_v2_client_id();
    let url = build_v2_url_with_client_id(path_or_url, &cid);
    let headers = [
        ("Accept", "application/json; charset=utf-8"),
        ("Origin", "https://soundcloud.com"),
        ("Referer", "https://soundcloud.com/"),
    ];
    match crate::http_pool::http_get_bytes(&url, &headers, None, 15) {
        Ok(bytes) => {
            let parsed: Value =
                serde_json::from_slice(&bytes).context("Invalid JSON from SoundCloud API v2")?;
            Ok(parsed)
        }
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("HTTP 401") || msg.contains("HTTP 403") {
                if let Some(new_cid) = refresh_soundcloud_v2_client_id() {
                    let retry_url = build_v2_url_with_client_id(path_or_url, &new_cid);
                    let bytes = crate::http_pool::http_get_bytes(&retry_url, &headers, None, 15)?;
                    let parsed: Value = serde_json::from_slice(&bytes)
                        .context("Invalid JSON from SoundCloud API v2")?;
                    return Ok(parsed);
                }
            }
            Err(e)
        }
    }
}

fn hydrate_v2_tracks_by_ids(track_ids: &[String], signed_in: bool) -> Vec<TrackMetadata> {
    if track_ids.is_empty() {
        return Vec::new();
    }
    let mut by_id: HashMap<String, TrackMetadata> = HashMap::new();
    for chunk in track_ids.chunks(50) {
        let ids_str = chunk.join(",");
        let path = format!("/tracks?ids={}", url_encode_component(&ids_str));
        if let Ok(json) = soundcloud_v2_get_json(&path) {
            for item in extract_collection_items(&json) {
                if let Some(t) = map_soundcloud_item_to_track(item) {
                    if should_keep_track_for_session(&t, signed_in) {
                        let cid = clean_soundcloud_id(&t.uri);
                        by_id.insert(cid, t);
                    }
                }
            }
        }
    }
    let mut ordered = Vec::with_capacity(by_id.len());
    let mut seen = std::collections::HashSet::new();
    for id in track_ids {
        if seen.insert(id.clone()) {
            if let Some(t) = by_id.remove(id) {
                ordered.push(t);
            }
        }
    }
    ordered
}

fn extract_next_href(json: &Value) -> Option<String> {
    json.get("next_href")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn soundcloud_get_json(url: &str, access_token: &str) -> Result<Value> {
    let full_url = if url.starts_with("https://") || url.starts_with("http://") {
        url.to_string()
    } else if url.starts_with('/') {
        format!("https://api.soundcloud.com{url}")
    } else {
        format!("https://api.soundcloud.com/{url}")
    };

    let auth_header = format!("OAuth {}", access_token.trim());
    let headers = [
        ("Authorization", auth_header.as_str()),
        ("Accept", "application/json; charset=utf-8"),
    ];

    let bytes = crate::http_pool::http_get_bytes(&full_url, &headers, None, 15)?;
    let parsed: Value =
        serde_json::from_slice(&bytes).context("Invalid JSON from SoundCloud API")?;
    Ok(parsed)
}

/// Executes an authenticated `GET` against `api.soundcloud.com`, automatically refreshing or re-minting
/// the token once if SoundCloud returns `HTTP 401`.
pub fn soundcloud_authed_get(settings: &SimpSettings, url: &str) -> Result<Value> {
    let is_user_endpoint = url.starts_with("/me") || url.contains("api.soundcloud.com/me");
    let token = ensure_valid_access_token(settings)?;
    match soundcloud_get_json(url, &token) {
        Ok(v) => Ok(v),
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains("HTTP 401") {
                let _guard = token_refresh_lock()
                    .lock()
                    .unwrap_or_else(|err| err.into_inner());
                let latest_creds = resolve_soundcloud_credentials(settings);
                // If another thread already refreshed the token while we waited for the lock, try it first!
                if !latest_creds.access_token.is_empty() && latest_creds.access_token != token {
                    if let Ok(v) = soundcloud_get_json(url, &latest_creds.access_token) {
                        return Ok(v);
                    }
                }
                let creds = resolve_soundcloud_credentials(settings);
                if let Ok(mut guard) = token_cache().lock() {
                    if let Some(ref mut cached) = *guard {
                        cached.access_token.clear();
                    }
                }
                if !creds.refresh_token.is_empty()
                    && !creds.client_id.is_empty()
                    && !creds.client_secret.is_empty()
                {
                    match refresh_user_oauth_token(
                        &creds.client_id,
                        &creds.client_secret,
                        &creds.refresh_token,
                        &creds.username,
                    ) {
                        Ok(b) => return soundcloud_get_json(url, &b.access_token),
                        Err(refresh_err) => {
                            let msg = format!("{refresh_err:#}");
                            tracing::warn!("SoundCloud 401 refresh attempt failed: {msg}");
                            if msg.contains("invalid_grant") {
                                clear_consumed_user_refresh_token(&creds.refresh_token);
                            }
                        }
                    }
                }
                // Only fall back to client_credentials for public endpoints (never `/me/*` user endpoints)
                if !is_user_endpoint
                    && !creds.client_id.is_empty()
                    && !creds.client_secret.is_empty()
                {
                    if let Ok(b) = obtain_client_credentials_token(settings) {
                        return soundcloud_get_json(url, &b.access_token);
                    }
                }
                if is_user_endpoint {
                    return Err(anyhow!(
                        "SoundCloud personal session expired (streaming works via Public Discovery, but Likes & Sets require signing in again under ☰ Settings → Folders & Accounts → SoundCloud → Sign In)"
                    ));
                }
            }
            Err(e)
        }
    }
}

fn extract_collection_items(json: &Value) -> Vec<&Value> {
    if let Some(arr) = json.get("collection").and_then(|v| v.as_array()) {
        arr.iter().collect()
    } else if let Some(arr) = json.as_array() {
        arr.iter().collect()
    } else {
        Vec::new()
    }
}

/// Resolves `TrackMetadata` for a `soundcloud:track:<id>` URI from the in-memory hint map or `GET /tracks/{id}`.
pub fn resolve_track_metadata_by_uri(
    settings: &SimpSettings,
    uri: &str,
) -> Option<TrackMetadata> {
    let track_id = clean_soundcloud_id(uri);
    if track_id.is_empty() {
        return None;
    }
    if let Ok(guard) = track_hints().lock() {
        if let Some(entry) = guard.get(&track_id) {
            return Some(entry.meta.clone());
        }
    }
    let encoded_id = url_encode_component(&track_id);
    if is_soundcloud_v2_enabled(settings) {
        if let Ok(v2_json) = soundcloud_v2_get_json(&format!("/tracks/{encoded_id}")) {
            if let Some(t) = map_soundcloud_item_to_track(&v2_json) {
                return Some(t);
            }
        }
    }
    let json = soundcloud_authed_get(settings, &format!("/tracks/{encoded_id}")).ok()?;
    map_soundcloud_item_to_track(&json)
}

#[allow(dead_code)]
fn populate_v2_track_stream_urls(track_id: &str, urls: &mut SoundCloudStreamUrls) {
    let encoded_id = url_encode_component(track_id);
    let Ok(track_json) = soundcloud_v2_get_json(&format!("/tracks/{encoded_id}")) else {
        return;
    };
    let Some(transcodings) = track_json
        .pointer("/media/transcodings")
        .and_then(|v| v.as_array())
    else {
        return;
    };

    // 1. Prefer clear (unencrypted) full-length transcodings if available
    let mut clear_candidates: Vec<(&str, &str, &str)> = Vec::new();
    let mut drm_candidates: Vec<(&str, &str)> = Vec::new();

    for tr in transcodings {
        let snipped = tr.get("snipped").and_then(|v| v.as_bool()).unwrap_or(false);
        if snipped {
            continue;
        }
        let Some(tr_url) = tr
            .get("url")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let protocol = tr
            .pointer("/format/protocol")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let preset = tr.get("preset").and_then(|v| v.as_str()).unwrap_or("");

        if protocol == "ctr-encrypted-hls" || protocol == "cbc-encrypted-hls" || tr_url.contains("encrypted") {
            drm_candidates.push((tr_url, preset));
        } else {
            clear_candidates.push((tr_url, protocol, preset));
        }
    }

    for (tr_url, protocol, preset) in clear_candidates {
        if let Ok(res_json) = soundcloud_v2_get_json(tr_url) {
            if let Some(stream_u) = res_json
                .get("url")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
            {
                if protocol.contains("hls") {
                    if preset.contains("aac_160") && urls.hls_aac_160_url.is_none() {
                        urls.hls_aac_160_url = Some(stream_u);
                    } else if preset.contains("mp3") && urls.hls_mp3_128_url.is_none() {
                        urls.hls_mp3_128_url = Some(stream_u);
                    } else if urls.hls_aac_96_url.is_none() {
                        urls.hls_aac_96_url = Some(stream_u);
                    }
                } else if urls.http_mp3_128_url.is_none() {
                    urls.http_mp3_128_url = Some(stream_u);
                }
            }
        }
    }

    if urls.hls_aac_160_url.is_some()
        || urls.hls_mp3_128_url.is_some()
        || urls.http_mp3_128_url.is_some()
        || urls.hls_aac_96_url.is_some()
    {
        urls.preview_mp3_128_url = None;
        return;
    }

    // 2. Resolve Widevine-encrypted `ctr-encrypted-hls` transcoding (`160 kbps AAC` preferred)
    drm_candidates.sort_by_key(|(_, preset)| if preset.contains("aac_160") { 0 } else { 1 });
    for (tr_url, _) in drm_candidates {
        if let Ok(res_json) = soundcloud_v2_get_json(tr_url) {
            let stream_u = res_json
                .get("url")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let lic_token = res_json
                .get("licenseAuthToken")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            if let (Some(u), Some(tok)) = (stream_u, lic_token) {
                urls.drm_hls_url = Some(u);
                urls.drm_license_auth_token = Some(tok);
                urls.preview_mp3_128_url = None;
                return;
            }
        }
    }
}

/// Fetches the streaming URLs (`hls_aac_160_url`, `hls_mp3_128_url`, `http_mp3_128_url`, or v2 `drm_hls_url`) for a SoundCloud track.
pub fn fetch_track_streams(
    settings: &SimpSettings,
    track_uri_or_id: &str,
) -> Result<SoundCloudStreamUrls> {
    let track_id = clean_soundcloud_id(track_uri_or_id);
    if track_id.is_empty() {
        return Err(anyhow!("Empty SoundCloud track ID"));
    }

    let signed_in = is_soundcloud_user_signed_in(settings);
    let path = format!("/tracks/{}/streams", url_encode_component(&track_id));
    let mut urls = SoundCloudStreamUrls {
        track_id: track_id.clone(),
        ..Default::default()
    };

    if let Ok(json) = soundcloud_authed_get(settings, &path) {
        let get_str = |key: &str| -> Option<String> {
            json.get(key)
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        urls.hls_aac_160_url = get_str("hls_aac_160_url");
        urls.hls_aac_96_url = get_str("hls_aac_96_url");
        urls.hls_mp3_128_url = get_str("hls_mp3_128_url");
        urls.http_mp3_128_url = get_str("http_mp3_128_url");
        urls.preview_mp3_128_url = get_str("preview_mp3_128_url");
    }

    let has_full_v1_stream = urls.hls_aac_160_url.is_some()
        || urls.hls_mp3_128_url.is_some()
        || urls.http_mp3_128_url.is_some()
        || urls.hls_aac_96_url.is_some();

    if !has_full_v1_stream && is_soundcloud_v2_enabled(settings) {
        populate_v2_track_stream_urls(&track_id, &mut urls);
    }

    // Never play 30-second preview snips when signed into a user account
    if signed_in {
        urls.preview_mp3_128_url = None;
    }

    if urls.preferred_stream().is_none() {
        return Err(anyhow!(
            "SoundCloud track has no playable full-length HLS or HTTP stream URLs available"
        ));
    }

    Ok(urls)
}

/// Fetches the user's `❤️ Liked Tracks` virtual playlist, created sets (`/me/playlists`), and liked sets (`/me/likes/playlists`).
pub fn fetch_user_playlists_and_likes(
    settings: &SimpSettings,
) -> Result<SoundCloudPlaylistsResponse> {
    let signed_in = is_soundcloud_user_signed_in(settings);
    let access_q = access_param_for_session(settings);
    let mut playlists = Vec::new();
    let mut liked_tracks_preview = Vec::new();
    let mut likes_authed = false;

    if let Ok(likes_json) = soundcloud_authed_get(
        settings,
        &format!("/me/likes/tracks?limit=100&access={access_q}&linked_partitioning=true"),
    ) {
        likes_authed = true;
        for item in extract_collection_items(&likes_json) {
            if let Some(track) = map_soundcloud_item_to_track(item) {
                if should_keep_track_for_session(&track, signed_in) {
                    liked_tracks_preview.push(track);
                }
            }
        }
    }

    let likes_art = liked_tracks_preview
        .first()
        .and_then(|t| t.art_url.clone());
    let likes_dur: u32 = liked_tracks_preview.iter().map(|t| t.duration_ms).sum();
    playlists.push(SoundCloudPlaylistSummary {
        id: "likes".to_string(),
        name: "❤️ Liked Tracks".to_string(),
        description: if !liked_tracks_preview.is_empty() {
            format!("{} liked SoundCloud tracks", liked_tracks_preview.len())
        } else if likes_authed {
            "Your liked SoundCloud tracks".to_string()
        } else {
            "Personal session expired — click Sign In under ☰ Settings → Folders & Accounts → SoundCloud".to_string()
        },
        creator: "You".to_string(),
        art_url: likes_art,
        track_count: liked_tracks_preview.len(),
        duration_ms: likes_dur,
        kind: "likes".to_string(),
        permalink_url: Some("https://soundcloud.com/you/likes".to_string()),
        tracks: liked_tracks_preview.clone(),
    });

    if let Ok(my_sets_json) = soundcloud_authed_get(
        settings,
        &format!("/me/playlists?limit=50&show_tracks=true&access={access_q}&linked_partitioning=true"),
    ) {
        for item in extract_collection_items(&my_sets_json) {
            if let Some(mut pl) = map_soundcloud_item_to_playlist(item, "user_set") {
                if should_keep_playlist_for_session(&mut pl, signed_in) {
                    playlists.push(pl);
                }
            }
        }
    }

    if let Ok(liked_sets_json) = soundcloud_authed_get(
        settings,
        &format!("/me/likes/playlists?limit=50&show_tracks=true&access={access_q}&linked_partitioning=true"),
    ) {
        for item in extract_collection_items(&liked_sets_json) {
            if let Some(mut pl) = map_soundcloud_item_to_playlist(item, "liked_set") {
                if should_keep_playlist_for_session(&mut pl, signed_in)
                    && !playlists.iter().any(|existing| existing.id == pl.id)
                {
                    playlists.push(pl);
                }
            }
        }
    }

    Ok(SoundCloudPlaylistsResponse {
        playlists,
        liked_tracks_preview,
    })
}

/// Fetches the playable tracks for a SoundCloud playlist (`id = "likes"` or a playlist ID/URN).
pub fn fetch_playlist_tracks(
    settings: &SimpSettings,
    playlist_id: &str,
) -> Result<Vec<TrackMetadata>> {
    let signed_in = is_soundcloud_user_signed_in(settings);
    let access_q = access_param_for_session(settings);
    let clean_id = clean_soundcloud_id(playlist_id);
    if clean_id.eq_ignore_ascii_case("likes") {
        let mut tracks = Vec::new();
        let mut next_url = Some(format!(
            "/me/likes/tracks?limit=150&access={access_q}&linked_partitioning=true"
        ));
        for _ in 0..3 {
            let Some(ref u) = next_url else { break };
            let Ok(json) = soundcloud_authed_get(settings, u) else {
                break;
            };
            for item in extract_collection_items(&json) {
                if let Some(t) = map_soundcloud_item_to_track(item) {
                    if should_keep_track_for_session(&t, signed_in) {
                        tracks.push(t);
                    }
                }
            }
            next_url = extract_next_href(&json);
        }
        return Ok(tracks);
    }

    let mut tracks = Vec::new();
    let mut seen_uris = std::collections::HashSet::new();
    let encoded_id = url_encode_component(&clean_id);

    // When API v2 mode is enabled, resolve the playlist and batch-hydrate its track stubs via `api-v2.soundcloud.com`
    // so monetized/distributor albums & sets return their full tracklists (`snipped: false`).
    if is_soundcloud_v2_enabled(settings) {
        if let Ok(v2_pl) = soundcloud_v2_get_json(&format!("/playlists/{encoded_id}?representation=full")) {
            if let Some(arr) = v2_pl.get("tracks").and_then(|v| v.as_array()) {
                let mut ordered_ids: Vec<String> = Vec::with_capacity(arr.len());
                let mut hydrated_map: HashMap<String, TrackMetadata> = HashMap::new();
                let mut stub_ids: Vec<String> = Vec::new();
                for item in arr {
                    let obj = item.get("origin").unwrap_or(item);
                    let pol = obj.get("policy").and_then(|v| v.as_str()).unwrap_or("ALLOW");
                    if pol == "BLOCK" {
                        continue;
                    }
                    let tid = obj
                        .get("urn")
                        .and_then(|v| v.as_str())
                        .map(clean_soundcloud_id)
                        .or_else(|| obj.get("id").and_then(|v| v.as_u64()).map(|n| n.to_string()))
                        .or_else(|| obj.get("id").and_then(|v| v.as_str()).map(clean_soundcloud_id))
                        .unwrap_or_default();
                    if tid.is_empty() {
                        continue;
                    }
                    ordered_ids.push(tid.clone());
                    if let Some(t) = map_soundcloud_item_to_track(item) {
                        if should_keep_track_for_session(&t, signed_in) {
                            hydrated_map.insert(tid, t);
                        }
                    } else {
                        stub_ids.push(tid);
                    }
                }
                if !stub_ids.is_empty() {
                    for t in hydrate_v2_tracks_by_ids(&stub_ids, signed_in) {
                        let cid = clean_soundcloud_id(&t.uri);
                        hydrated_map.insert(cid, t);
                    }
                }
                for tid in ordered_ids {
                    if let Some(t) = hydrated_map.remove(&tid) {
                        if seen_uris.insert(t.uri.clone()) {
                            tracks.push(t);
                        }
                    }
                }
                if !tracks.is_empty() {
                    return Ok(tracks);
                }
            }
        }
    }

    let mut next_url = Some(format!(
        "/playlists/{encoded_id}/tracks?limit=200&access={access_q}&linked_partitioning=true"
    ));
    for _ in 0..3 {
        let Some(ref u) = next_url else { break };
        if let Ok(json) = soundcloud_authed_get(settings, u) {
            for item in extract_collection_items(&json) {
                if let Some(t) = map_soundcloud_item_to_track(item) {
                    if should_keep_track_for_session(&t, signed_in)
                        && seen_uris.insert(t.uri.clone())
                    {
                        tracks.push(t);
                    }
                }
            }
            next_url = extract_next_href(&json);
        } else {
            break;
        }
    }

    if tracks.is_empty() {
        let pl_url = format!("/playlists/{encoded_id}?show_tracks=true&access={access_q}");
        let pl_json = soundcloud_authed_get(settings, &pl_url)
            .or_else(|_| soundcloud_authed_get(settings, &format!("/playlists/{encoded_id}")));
        if let Ok(json) = pl_json {
            let mut stub_ids = Vec::new();
            if let Some(arr) = json.get("tracks").and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(t) = map_soundcloud_item_to_track(item) {
                        if should_keep_track_for_session(&t, signed_in)
                            && seen_uris.insert(t.uri.clone())
                        {
                            tracks.push(t);
                        }
                    } else {
                        let obj = item.get("origin").unwrap_or(item);
                        let acc = obj.get("access").and_then(|v| v.as_str()).unwrap_or("playable");
                        if acc == "blocked" {
                            continue;
                        }
                        let sid = obj
                            .get("urn")
                            .and_then(|v| v.as_str())
                            .map(clean_soundcloud_id)
                            .or_else(|| {
                                obj.get("id")
                                    .and_then(|v| v.as_u64())
                                    .map(|n| n.to_string())
                            })
                            .or_else(|| {
                                obj.get("id")
                                    .and_then(|v| v.as_str())
                                    .map(clean_soundcloud_id)
                            })
                            .unwrap_or_default();
                        if !sid.is_empty() && stub_ids.len() < 50 {
                            stub_ids.push(sid);
                        }
                    }
                }
            }
            if tracks.is_empty() && !stub_ids.is_empty() {
                let ids_param = url_encode_component(&stub_ids.join(","));
                if let Ok(batch_json) = soundcloud_authed_get(
                    settings,
                    &format!("/tracks?ids={ids_param}&access={access_q}&linked_partitioning=true"),
                ) {
                    for item in extract_collection_items(&batch_json) {
                        if let Some(t) = map_soundcloud_item_to_track(item) {
                            if should_keep_track_for_session(&t, signed_in)
                                && seen_uris.insert(t.uri.clone())
                            {
                                tracks.push(t);
                            }
                        }
                    }
                }
                if tracks.is_empty() {
                    for sid in stub_ids.into_iter().take(20) {
                        if let Some(t) = resolve_track_metadata_by_uri(settings, &sid) {
                            if should_keep_track_for_session(&t, signed_in)
                                && seen_uris.insert(t.uri.clone())
                            {
                                tracks.push(t);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(tracks)
}

/// Fetches the user's chronological Activity Stream (`/me/activities`) and followed-artists feed (`/me/followings/tracks`),
/// extracting both tracks and reposted/uploaded sets (`stream_playlists`), and builds dynamic Track Radio Stations.
pub fn fetch_stream_and_stations(settings: &SimpSettings) -> Result<SoundCloudStreamResponse> {
    let mut stream_tracks = Vec::new();
    let mut stream_playlists = Vec::new();
    let mut seen_uris = std::collections::HashSet::new();
    let mut seen_pl_ids = std::collections::HashSet::new();

    // 1. Dedicated followed-artists recent tracks feed (`GET /me/followings/tracks`)
    if let Ok(follow_tracks_json) = soundcloud_authed_get(
        settings,
        "/me/followings/tracks?limit=40&access=playable&linked_partitioning=true",
    ) {
        for item in extract_collection_items(&follow_tracks_json) {
            if let Some(t) = map_soundcloud_item_to_track(item) {
                if seen_uris.insert(t.uri.clone()) {
                    stream_tracks.push(t);
                }
            }
        }
    }

    // 2. Chronological activity stream (`GET /me/activities` & `/me/activities/tracks`) for reposts & sets
    if let Ok(act_json) = soundcloud_authed_get(
        settings,
        "/me/activities?limit=50&access=playable&linked_partitioning=true",
    )
    .or_else(|_| {
        soundcloud_authed_get(
            settings,
            "/me/activities/tracks?limit=50&access=playable&linked_partitioning=true",
        )
    }) {
        for item in extract_collection_items(&act_json) {
            let origin = item.get("origin").unwrap_or(item);
            let kind = origin.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            if kind == "playlist" {
                if let Some(pl) = map_soundcloud_item_to_playlist(origin, "reposted_set") {
                    if seen_pl_ids.insert(pl.id.clone()) {
                        stream_playlists.push(pl);
                    }
                }
            } else if let Some(t) = map_soundcloud_item_to_track(item) {
                if seen_uris.insert(t.uri.clone()) {
                    stream_tracks.push(t);
                }
            }
        }
    }

    // If user stream is empty (e.g. Public Mode or new account), seed with fresh Electronic / Underground tracks
    if stream_tracks.is_empty() {
        if let Ok(fallback_json) = soundcloud_authed_get(
            settings,
            "/tracks?genres=electronic&access=playable&linked_partitioning=true&limit=30",
        ) {
            for item in extract_collection_items(&fallback_json) {
                if let Some(t) = map_soundcloud_item_to_track(item) {
                    if seen_uris.insert(t.uri.clone()) {
                        stream_tracks.push(t);
                    }
                }
            }
        }
    }

    let mut stations = Vec::new();
    for seed in stream_tracks.iter().take(8) {
        let seed_id = clean_soundcloud_id(&seed.uri);
        stations.push(SoundCloudStationSummary {
            id: format!("soundcloud:station:track:{seed_id}"),
            name: format!("{} Radio", seed.title),
            subtitle: format!("Seeded by {}", seed.artists.first().cloned().unwrap_or_default()),
            seed_track_id: seed_id,
            art_url: seed.art_url.clone(),
        });
    }

    Ok(SoundCloudStreamResponse {
        stream_tracks,
        stream_playlists,
        stations,
    })
}

/// Fetches Trending tracks, long-form DJ Mixes (`20m+`), sets, and personalized discovery shelves for a genre/vibe filter.
pub fn fetch_trending_and_mixes(
    settings: &SimpSettings,
    genre: Option<&str>,
    mixes_only: bool,
) -> Result<SoundCloudDiscoverResponse> {
    fetch_trending_and_mixes_with_seeds(settings, genre, mixes_only, &[])
}

pub fn fetch_trending_and_mixes_with_seeds(
    settings: &SimpSettings,
    genre: Option<&str>,
    mixes_only: bool,
    seed_track_ids: &[String],
) -> Result<SoundCloudDiscoverResponse> {
    let signed_in = is_soundcloud_user_signed_in(settings);
    let access_q = access_param_for_session(settings);
    let clean_genre = genre
        .map(|g| g.trim())
        .filter(|g| !g.is_empty() && !g.eq_ignore_ascii_case("all"));

    let mut tracks_url = format!("/tracks?access={access_q}&linked_partitioning=true&limit=45");
    if let Some(g) = clean_genre {
        tracks_url.push_str(&format!(
            "&genres={}&q={}",
            url_encode_component(g),
            url_encode_component(g)
        ));
    }
    if mixes_only {
        tracks_url.push_str("&duration%5Bfrom%5D=1200000");
    }

    let mut tracks = Vec::new();
    let mut mixes = Vec::new();
    let mut recommended_artists = Vec::new();
    let mut seen_artist_ids = std::collections::HashSet::new();
    let mut next_tracks_href = None;

    if let Ok(json) = soundcloud_authed_get(settings, &tracks_url) {
        next_tracks_href = extract_next_href(&json);
        for item in extract_collection_items(&json) {
            if let Some(u) = item.get("user").and_then(map_soundcloud_item_to_user) {
                if seen_artist_ids.insert(u.id.clone()) && recommended_artists.len() < 16 {
                    recommended_artists.push(u);
                }
            }
            if let Some(t) = map_soundcloud_item_to_track(item) {
                if !should_keep_track_for_session(&t, signed_in) {
                    continue;
                }
                if t.duration_ms >= 20 * 60 * 1000 {
                    mixes.push(t.clone());
                }
                tracks.push(t);
            }
        }
    }

    // Also fetch dedicated 20m+ DJ Mixes if `mixes` is sparse
    if mixes.len() < 6 {
        let mut mix_url = format!(
            "/tracks?access={access_q}&linked_partitioning=true&duration%5Bfrom%5D=1200000&limit=20",
        );
        if let Some(g) = clean_genre {
            mix_url.push_str(&format!("&q={}%20mix", url_encode_component(g)));
        } else {
            mix_url.push_str("&q=dj%20mix%20set");
        }
        if let Ok(mix_json) = soundcloud_authed_get(settings, &mix_url) {
            for item in extract_collection_items(&mix_json) {
                if let Some(t) = map_soundcloud_item_to_track(item) {
                    if should_keep_track_for_session(&t, signed_in)
                        && !mixes.iter().any(|m| m.uri == t.uri)
                    {
                        mixes.push(t);
                    }
                }
            }
        }
    }

    let mut playlists = Vec::new();
    let pl_query = clean_genre.unwrap_or("electronic underground");
    let pl_url = format!(
        "/playlists?q={}&show_tracks=true&access={access_q}&linked_partitioning=true&limit=20",
        url_encode_component(pl_query)
    );
    if let Ok(pl_json) = soundcloud_authed_get(settings, &pl_url) {
        for item in extract_collection_items(&pl_json) {
            if let Some(mut pl) = map_soundcloud_item_to_playlist(item, "catalog_set") {
                if should_keep_playlist_for_session(&mut pl, signed_in) {
                    playlists.push(pl);
                }
            }
        }
    }

    // Build "More of What You Like" shelf seeded from recent SIMP history or user Likes
    let mut more_of_what_you_like = Vec::new();
    let mut seed_ids: Vec<String> = seed_track_ids
        .iter()
        .map(|s| clean_soundcloud_id(s))
        .filter(|s| !s.is_empty())
        .take(2)
        .collect();
    if seed_ids.is_empty() && signed_in {
        if let Ok(likes_json) = soundcloud_authed_get(
            settings,
            &format!("/me/likes/tracks?limit=4&access={access_q}&linked_partitioning=true"),
        ) {
            for item in extract_collection_items(&likes_json).into_iter().take(2) {
                if let Some(t) = map_soundcloud_item_to_track(item) {
                    let cid = clean_soundcloud_id(&t.uri);
                    if !cid.is_empty() && !seed_ids.contains(&cid) {
                        seed_ids.push(cid);
                    }
                }
            }
        }
    }
    if seed_ids.is_empty() {
        if let Some(first_t) = tracks.first() {
            let cid = clean_soundcloud_id(&first_t.uri);
            if !cid.is_empty() {
                seed_ids.push(cid);
            }
        }
    }
    for sid in seed_ids.iter().take(2) {
        let rel_url = format!(
            "/tracks/{}/related?access={access_q}&linked_partitioning=true&limit=12",
            url_encode_component(sid)
        );
        if let Ok(rel_json) = soundcloud_authed_get(settings, &rel_url) {
            for item in extract_collection_items(&rel_json) {
                if let Some(u) = item.get("user").and_then(map_soundcloud_item_to_user) {
                    if seen_artist_ids.insert(u.id.clone()) && recommended_artists.len() < 16 {
                        recommended_artists.push(u);
                    }
                }
                if let Some(t) = map_soundcloud_item_to_track(item) {
                    if should_keep_track_for_session(&t, signed_in)
                        && !more_of_what_you_like.iter().any(|m: &TrackMetadata| m.uri == t.uri)
                    {
                        more_of_what_you_like.push(t);
                    }
                }
            }
        }
    }

    // Build "Fresh Uploads" shelf (shorter tracks < 12m that aren't already in mixes)
    let fresh_uploads: Vec<TrackMetadata> = tracks
        .iter()
        .filter(|t| t.duration_ms > 0 && t.duration_ms < 12 * 60 * 1000)
        .take(16)
        .cloned()
        .collect();

    Ok(SoundCloudDiscoverResponse {
        tracks,
        mixes,
        playlists,
        more_of_what_you_like,
        fresh_uploads,
        recommended_artists,
        next_tracks_href,
    })
}

/// Expands a `soundcloud:station:track:<id>` URI into a continuous queue of related underground tracks
/// via `GET /tracks/{id}/related`.
pub fn fetch_related_station_tracks(
    settings: &SimpSettings,
    station_or_track_id: &str,
    limit: usize,
) -> Result<Vec<TrackMetadata>> {
    let seed_id = clean_soundcloud_id(station_or_track_id);
    if seed_id.is_empty() {
        return Err(anyhow!("Empty seed track ID for SoundCloud Track Radio"));
    }

    let mut out = Vec::new();
    if let Some(seed_meta) = resolve_track_metadata_by_uri(settings, &seed_id) {
        out.push(seed_meta);
    }

    let url = format!(
        "/tracks/{}/related?access=playable&linked_partitioning=true&limit={}",
        url_encode_component(&seed_id),
        limit.clamp(5, 50)
    );
    let json = soundcloud_authed_get(settings, &url)?;
    for item in extract_collection_items(&json) {
        if let Some(t) = map_soundcloud_item_to_track(item) {
            if !out.iter().any(|existing| existing.uri == t.uri) {
                out.push(t);
            }
        }
    }

    if out.is_empty() {
        return Err(anyhow!(
            "SoundCloud returned no playable related tracks for seed {seed_id}"
        ));
    }

    Ok(out)
}

/// Searches the SoundCloud catalog across tracks, 20m+ DJ mixes, playlists/sets, creators/artists (`users`), and track radio seeds.
/// If `query` is a `soundcloud.com` / `on.soundcloud.com` URL, resolves the exact resource first via `GET /resolve?url=...`.
pub fn search_catalog(settings: &SimpSettings, query: &str) -> Result<SoundCloudSearchResults> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(SoundCloudSearchResults {
            tracks: Vec::new(),
            mixes: Vec::new(),
            playlists: Vec::new(),
            stations: Vec::new(),
            users: Vec::new(),
            next_tracks_href: None,
        });
    }

    let signed_in = is_soundcloud_user_signed_in(settings);
    let access_q = access_param_for_session(settings);

    let mut tracks = Vec::new();
    let mut mixes = Vec::new();
    let mut playlists = Vec::new();
    let mut users = Vec::new();
    let mut next_tracks_href = None;

    // 1. Check if the user pasted a SoundCloud link (`https://soundcloud.com/...` or `soundcloud.com/...`)
    if q.starts_with("https://soundcloud.com/")
        || q.starts_with("http://soundcloud.com/")
        || q.starts_with("https://on.soundcloud.com/")
        || q.starts_with("soundcloud.com/")
    {
        let full_sc_url = if q.starts_with("http") {
            q.to_string()
        } else {
            format!("https://{q}")
        };
        let resolve_path = format!(
            "/resolve?url={}",
            url_encode_component(&full_sc_url)
        );
        let resolved_opt = if is_soundcloud_v2_enabled(settings) {
            soundcloud_v2_get_json(&resolve_path)
                .or_else(|_| soundcloud_authed_get(settings, &resolve_path))
                .ok()
        } else {
            soundcloud_authed_get(settings, &resolve_path).ok()
        };
        if let Some(resolved) = resolved_opt {
            let kind = resolved.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            if kind == "track" {
                if let Some(t) = map_soundcloud_item_to_track(&resolved) {
                    if should_keep_track_for_session(&t, signed_in) {
                        if t.duration_ms >= 20 * 60 * 1000 {
                            mixes.push(t.clone());
                        }
                        tracks.push(t);
                    }
                }
            } else if kind == "playlist" {
                if let Some(mut pl) = map_soundcloud_item_to_playlist(&resolved, "catalog_set") {
                    if is_soundcloud_v2_enabled(settings) && pl.tracks.len() < pl.track_count {
                        if let Ok(hydrated) = fetch_playlist_tracks(settings, &pl.id) {
                            if !hydrated.is_empty() {
                                pl.track_count = hydrated.len();
                                pl.tracks = hydrated.clone();
                            }
                        }
                    }
                    if should_keep_playlist_for_session(&mut pl, signed_in) {
                        for t in &pl.tracks {
                            if !tracks.iter().any(|existing: &TrackMetadata| existing.uri == t.uri) {
                                tracks.push(t.clone());
                            }
                        }
                        playlists.push(pl);
                    }
                }
            } else if kind == "user" {
                if let Some(u) = map_soundcloud_item_to_user(&resolved) {
                    users.push(u.clone());
                    if let Ok(profile) = fetch_user_profile_tracks(settings, &u.id) {
                        for t in profile.tracks {
                            if t.duration_ms >= 20 * 60 * 1000 {
                                mixes.push(t.clone());
                            }
                            tracks.push(t);
                        }
                        playlists.extend(profile.playlists);
                    }
                }
            }
        }
    }

    let encoded_q = url_encode_component(q);
    let tracks_url = format!(
        "/tracks?q={encoded_q}&access={access_q}&linked_partitioning=true&limit=40"
    );
    let playlists_url = format!(
        "/playlists?q={encoded_q}&show_tracks=true&access={access_q}&linked_partitioning=true&limit=20"
    );
    let users_url = format!(
        "/users?q={encoded_q}&linked_partitioning=true&limit=12"
    );

    if let Ok(t_json) = soundcloud_authed_get(settings, &tracks_url) {
        next_tracks_href = extract_next_href(&t_json);
        for item in extract_collection_items(&t_json) {
            if let Some(t) = map_soundcloud_item_to_track(item) {
                if should_keep_track_for_session(&t, signed_in)
                    && !tracks.iter().any(|existing| existing.uri == t.uri)
                {
                    if t.duration_ms >= 20 * 60 * 1000 {
                        mixes.push(t.clone());
                    }
                    tracks.push(t);
                }
            }
        }
    }

    if let Ok(p_json) = soundcloud_authed_get(settings, &playlists_url) {
        for item in extract_collection_items(&p_json) {
            if let Some(mut pl) = map_soundcloud_item_to_playlist(item, "catalog_set") {
                if should_keep_playlist_for_session(&mut pl, signed_in)
                    && !playlists.iter().any(|existing| existing.id == pl.id)
                {
                    playlists.push(pl);
                }
            }
        }
    }

    if let Ok(u_json) = soundcloud_authed_get(settings, &users_url) {
        for item in extract_collection_items(&u_json) {
            if let Some(u) = map_soundcloud_item_to_user(item) {
                if !users.iter().any(|existing| existing.id == u.id) {
                    users.push(u);
                }
            }
        }
    }

    if is_soundcloud_v2_enabled(settings) {
        if let Ok(v2_t_json) =
            soundcloud_v2_get_json(&format!("/search/tracks?q={encoded_q}&limit=30"))
        {
            for item in extract_collection_items(&v2_t_json) {
                if let Some(t) = map_soundcloud_item_to_track(item) {
                    if should_keep_track_for_session(&t, signed_in)
                        && !tracks.iter().any(|existing| existing.uri == t.uri)
                    {
                        if t.duration_ms >= 20 * 60 * 1000 {
                            mixes.push(t.clone());
                        }
                        tracks.push(t);
                    }
                }
            }
        }
        if let Ok(v2_p_json) =
            soundcloud_v2_get_json(&format!("/search/playlists?q={encoded_q}&limit=20"))
        {
            for item in extract_collection_items(&v2_p_json) {
                if let Some(mut pl) = map_soundcloud_item_to_playlist(item, "catalog_set") {
                    if should_keep_playlist_for_session(&mut pl, signed_in)
                        && !playlists.iter().any(|existing| existing.id == pl.id)
                    {
                        playlists.push(pl);
                    }
                }
            }
        }
    }

    let stations: Vec<SoundCloudStationSummary> = tracks
        .iter()
        .take(4)
        .map(|t| {
            let sid = clean_soundcloud_id(&t.uri);
            SoundCloudStationSummary {
                id: format!("soundcloud:station:track:{sid}"),
                name: format!("{} Radio", t.title),
                subtitle: format!("Related to {}", t.artists.first().cloned().unwrap_or_default()),
                seed_track_id: sid,
                art_url: t.art_url.clone(),
            }
        })
        .collect();

    Ok(SoundCloudSearchResults {
        tracks,
        mixes,
        playlists,
        stations,
        users,
        next_tracks_href,
    })
}

/// Fetches timestamped timed comments (`GET /tracks/{id}/comments`) for the ephemeral speech bubbles on `PlayerView`!
pub fn fetch_track_comments(
    settings: &SimpSettings,
    track_uri_or_id: &str,
) -> Result<Vec<SoundCloudComment>> {
    let track_id = clean_soundcloud_id(track_uri_or_id);
    if track_id.is_empty() {
        return Ok(Vec::new());
    }

    if let Ok(guard) = comments_cache().lock() {
        if let Some((fetched_at, cached)) = guard.get(&track_id) {
            if fetched_at.elapsed() < Duration::from_secs(600) {
                return Ok(cached.clone());
            }
        }
    }

    let url = format!(
        "/tracks/{}/comments?linked_partitioning=true&limit=200",
        url_encode_component(&track_id)
    );
    let json = soundcloud_authed_get(settings, &url)?;
    let mut comments = Vec::new();

    for item in extract_collection_items(&json) {
        let body = item
            .get("body")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if body.is_empty() || body.len() > 220 {
            continue;
        }
        let Some(ts) = item.get("timestamp").and_then(|v| v.as_u64()) else {
            continue;
        };
        let id = item
            .get("id")
            .and_then(|v| {
                v.as_u64()
                    .map(|n| n.to_string())
                    .or_else(|| v.as_str().map(|s| s.to_string()))
            })
            .unwrap_or_else(|| format!("{ts}-{}", comments.len()));
        let username = item
            .pointer("/user/username")
            .and_then(|v| v.as_str())
            .unwrap_or("listener")
            .trim()
            .to_string();
        let avatar_url = item
            .pointer("/user/avatar_url")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && !s.contains("default_avatar"));
        let created_at = item
            .get("created_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        comments.push(SoundCloudComment {
            id,
            body,
            timestamp_ms: ts as u32,
            username,
            avatar_url,
            created_at,
        });
    }

    comments.sort_by_key(|c| c.timestamp_ms);

    if let Ok(mut guard) = comments_cache().lock() {
        if guard.len() > 64 {
            guard.clear();
        }
        guard.insert(track_id, (Instant::now(), comments.clone()));
    }

    Ok(comments)
}

/// Fetches and normalizes a SoundCloud track's amplitude waveform (`waveform_url`) into 96 normalized `0.0..=1.0` bars
/// for rendering inside `ProgressBarRaf`.
pub fn fetch_track_waveform(
    settings: &SimpSettings,
    track_uri_or_id: &str,
) -> Result<SoundCloudWaveform> {
    let track_id = clean_soundcloud_id(track_uri_or_id);
    if track_id.is_empty() {
        return Err(anyhow!("Empty track ID"));
    }

    if let Ok(guard) = waveform_cache().lock() {
        if let Some(cached) = guard.get(&track_id) {
            return Ok(cached.clone());
        }
    }

    let (
        mut wf_url,
        mut permalink_url,
        mut bpm,
        mut favoritings_count,
        mut playback_count,
        mut user_id,
        mut chapters,
    ) = track_hints()
        .lock()
        .ok()
        .and_then(|g| {
            g.get(&track_id).map(|e| {
                (
                    e.waveform_url.clone(),
                    e.permalink_url.clone(),
                    e.bpm,
                    e.favoritings_count,
                    e.playback_count,
                    e.user_id.clone(),
                    e.chapters.clone(),
                )
            })
        })
        .unwrap_or((None, None, None, None, None, None, Vec::new()));

    if wf_url.is_none() || permalink_url.is_none() || (chapters.is_empty() && user_id.is_none()) {
        if let Ok(json) = soundcloud_authed_get(
            settings,
            &format!("/tracks/{}", url_encode_component(&track_id)),
        ) {
            let _ = map_soundcloud_item_to_track(&json);
            if let Ok(g) = track_hints().lock() {
                if let Some(e) = g.get(&track_id) {
                    wf_url = e.waveform_url.clone();
                    permalink_url = e.permalink_url.clone();
                    bpm = e.bpm;
                    favoritings_count = e.favoritings_count;
                    playback_count = e.playback_count;
                    user_id = e.user_id.clone();
                    chapters = e.chapters.clone();
                }
            }
        }
    }

    let mut bars = Vec::new();
    if let Some(ref raw_url) = wf_url {
        let json_url = if raw_url.ends_with(".png") {
            format!("{}.json", &raw_url[..raw_url.len() - 4])
        } else {
            raw_url.clone()
        };
        if let Ok(bytes) = crate::http_pool::http_get_bytes(&json_url, &[], None, 8) {
            if let Ok(val) = serde_json::from_slice::<Value>(&bytes) {
                if let Some(samples) = val.get("samples").and_then(|v| v.as_array()) {
                    bars = downsample_waveform_samples(samples, crate::viz::DEFAULT_WAVEFORM_BARS);
                }
            }
        }
    }

    // Deterministic fallback silhouette if `wis.sndcdn.com` returned a PNG-only asset
    if bars.is_empty() {
        bars = crate::viz::synthesize_seeded_waveform_bars(
            &track_id,
            crate::viz::DEFAULT_WAVEFORM_BARS,
        );
    }

    let waveform = SoundCloudWaveform {
        track_id: track_id.clone(),
        bars,
        waveform_url: wf_url,
        permalink_url,
        bpm,
        favoritings_count,
        playback_count,
        user_id,
        chapters,
    };

    if let Ok(mut guard) = waveform_cache().lock() {
        if guard.len() > 128 {
            guard.clear();
        }
        guard.insert(track_id, waveform.clone());
    }

    Ok(waveform)
}

fn downsample_waveform_samples(raw_samples: &[Value], target_bars: usize) -> Vec<f32> {
    let vals: Vec<f32> = raw_samples
        .iter()
        .filter_map(|v| v.as_f64().map(|n| n as f32))
        .collect();
    crate::viz::downsample_peak_weighted_rms_f32(&vals, target_bars)
}

/// Likes (`POST /likes/tracks/{id}`) a SoundCloud track on the user's account.
pub fn like_soundcloud_track(settings: &SimpSettings, track_uri_or_id: &str) -> Result<()> {
    let track_id = clean_soundcloud_id(track_uri_or_id);
    if track_id.is_empty() {
        return Err(anyhow!("Invalid SoundCloud track ID"));
    }
    let token = ensure_valid_access_token(settings)?;
    let auth_header = format!("OAuth {}", token.trim());
    let url = format!(
        "https://api.soundcloud.com/likes/tracks/{}",
        url_encode_component(&track_id)
    );
    let _ = crate::http_pool::http_post_bytes(
        &url,
        &[
            ("Authorization", auth_header.as_str()),
            ("Accept", "application/json; charset=utf-8"),
        ],
        b"",
        10,
    )?;
    Ok(())
}

/// Unlikes (`DELETE /likes/tracks/{id}`) a SoundCloud track on the user's account.
pub fn unlike_soundcloud_track(settings: &SimpSettings, track_uri_or_id: &str) -> Result<()> {
    let track_id = clean_soundcloud_id(track_uri_or_id);
    if track_id.is_empty() {
        return Err(anyhow!("Invalid SoundCloud track ID"));
    }
    let token = ensure_valid_access_token(settings)?;
    let auth_header = format!("OAuth {}", token.trim());
    let url = format!(
        "https://api.soundcloud.com/likes/tracks/{}",
        url_encode_component(&track_id)
    );
    let _ = crate::http_pool::http_custom_bytes(
        "DELETE",
        &url,
        &[
            ("Authorization", auth_header.as_str()),
            ("Accept", "application/json; charset=utf-8"),
        ],
        None,
        10,
    )?;
    Ok(())
}

/// Likes (`POST /likes/playlists/{id}`) or unlikes (`DELETE /likes/playlists/{id}`) a SoundCloud Set/Playlist.
pub fn set_soundcloud_playlist_liked(
    settings: &SimpSettings,
    playlist_uri_or_id: &str,
    liked: bool,
) -> Result<()> {
    let playlist_id = clean_soundcloud_id(playlist_uri_or_id);
    if playlist_id.is_empty() || playlist_id.eq_ignore_ascii_case("likes") {
        return Ok(());
    }
    let token = ensure_valid_access_token(settings)?;
    let auth_header = format!("OAuth {}", token.trim());
    let url = format!(
        "https://api.soundcloud.com/likes/playlists/{}",
        url_encode_component(&playlist_id)
    );
    if liked {
        let _ = crate::http_pool::http_post_bytes(
            &url,
            &[
                ("Authorization", auth_header.as_str()),
                ("Accept", "application/json; charset=utf-8"),
            ],
            b"",
            10,
        )?;
    } else {
        let _ = crate::http_pool::http_custom_bytes(
            "DELETE",
            &url,
            &[
                ("Authorization", auth_header.as_str()),
                ("Accept", "application/json; charset=utf-8"),
            ],
            None,
            10,
        )?;
    }
    Ok(())
}

pub fn map_soundcloud_item_to_user(item: &Value) -> Option<SoundCloudUserSummary> {
    let obj = item.get("user").or_else(|| item.get("origin")).unwrap_or(item);
    let raw_id = if let Some(urn) = obj.get("urn").and_then(|v| v.as_str()) {
        clean_soundcloud_id(urn).trim_start_matches("users:").to_string()
    } else if let Some(id_num) = obj.get("id").and_then(|v| v.as_u64()) {
        id_num.to_string()
    } else if let Some(id_str) = obj.get("id").and_then(|v| v.as_str()) {
        clean_soundcloud_id(id_str).trim_start_matches("users:").to_string()
    } else {
        return None;
    };
    if raw_id.is_empty() {
        return None;
    }

    let username = obj
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("SoundCloud Creator")
        .trim()
        .to_string();
    let urn = obj
        .get("urn")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("soundcloud:users:{raw_id}"));
    let avatar_url = format_soundcloud_art_url(
        obj.get("avatar_url").and_then(|v| v.as_str()),
    );
    let track_count = obj
        .get("track_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;
    let followers_count = obj
        .get("followers_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let raw_desc = obj
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let description = if raw_desc.is_empty() {
        format!(
            "{} tracks • {} followers",
            track_count,
            format_compact_count(followers_count)
        )
    } else {
        raw_desc.lines().next().unwrap_or("").to_string()
    };

    let permalink_url = obj
        .get("permalink_url")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| s.starts_with("http://") || s.starts_with("https://"))
        .or_else(|| {
            obj.get("permalink")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|slug| format!("https://soundcloud.com/{slug}"))
        });

    Some(SoundCloudUserSummary {
        id: raw_id,
        urn,
        username,
        avatar_url,
        track_count,
        followers_count,
        description,
        permalink_url,
    })
}

/// Resolves the canonical `https://soundcloud.com/...` `permalink_url` for a SoundCloud track,
/// playlist/set, or user profile, checking `TRACK_HINTS` first before querying SoundCloud API v1.
pub fn resolve_soundcloud_permalink_url(
    settings: &SimpSettings,
    kind: &str,
    raw_id: &str,
) -> String {
    let cleaned = clean_soundcloud_id(raw_id)
        .trim_start_matches("users:")
        .to_string();
    if cleaned.starts_with("https://soundcloud.com/") || cleaned.starts_with("http://soundcloud.com/") {
        return cleaned;
    }
    if cleaned.is_empty() {
        return "https://soundcloud.com".to_string();
    }

    let kind_norm = kind.trim().to_ascii_lowercase();
    if kind_norm == "track" || kind_norm.is_empty() {
        if let Ok(guard) = track_hints().lock() {
            if let Some(entry) = guard.get(&cleaned) {
                if let Some(ref url) = entry.permalink_url {
                    if !url.is_empty() {
                        return url.clone();
                    }
                }
            }
        }
        if let Ok(json) = soundcloud_authed_get(
            settings,
            &format!("/tracks/{}", url_encode_component(&cleaned)),
        ) {
            let _ = map_soundcloud_item_to_track(&json);
            if let Some(u) = json
                .get("permalink_url")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| s.starts_with("http"))
            {
                return u.to_string();
            }
        }
    } else if kind_norm == "playlist" || kind_norm == "set" {
        if cleaned.eq_ignore_ascii_case("likes") {
            return "https://soundcloud.com/you/likes".to_string();
        }
        if let Ok(json) = soundcloud_authed_get(
            settings,
            &format!("/playlists/{}", url_encode_component(&cleaned)),
        ) {
            if let Some(u) = json
                .get("permalink_url")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| s.starts_with("http"))
            {
                return u.to_string();
            }
        }
    } else if kind_norm == "user" || kind_norm == "artist" || kind_norm == "creator" {
        if !cleaned.chars().all(|c| c.is_ascii_digit()) {
            return format!("https://soundcloud.com/{}", url_encode_component(&cleaned));
        }
        if let Ok(json) = soundcloud_authed_get(
            settings,
            &format!("/users/{}", url_encode_component(&cleaned)),
        ) {
            if let Some(u) = json
                .get("permalink_url")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| s.starts_with("http"))
            {
                return u.to_string();
            }
        }
    }

    "https://soundcloud.com".to_string()
}

/// Fetches the creators/DJs followed by the authenticated SoundCloud user (`GET /me/followings`).
pub fn fetch_user_followings(settings: &SimpSettings) -> Result<Vec<SoundCloudUserSummary>> {
    let json = soundcloud_authed_get(
        settings,
        "/me/followings?limit=100&linked_partitioning=true",
    )?;
    let mut users = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for item in extract_collection_items(&json) {
        if let Some(u) = map_soundcloud_item_to_user(item) {
            if seen.insert(u.id.clone()) {
                users.push(u);
            }
        }
    }
    Ok(users)
}

/// Fetches a SoundCloud creator's uploaded tracks (`GET /users/{id}/tracks` with pagination),
/// sets/albums (`GET /users/{id}/playlists`), liked tracks (`GET /users/{id}/likes/tracks`),
/// and followed artists (`GET /users/{id}/followings`).
/// Also supports resolving by artist name if `user_id_or_urn` is non-numeric or prefixed with `name:`.
pub fn fetch_user_profile_tracks(
    settings: &SimpSettings,
    user_id_or_urn: &str,
) -> Result<SoundCloudUserProfileResponse> {
    let signed_in = is_soundcloud_user_signed_in(settings);
    let access_q = access_param_for_session(settings);

    let mut clean_uid = clean_soundcloud_id(user_id_or_urn)
        .trim_start_matches("users:")
        .trim()
        .to_string();
    if clean_uid.is_empty() {
        return Err(anyhow!("Empty SoundCloud user ID"));
    }

    let mut user: Option<SoundCloudUserSummary> = None;

    // If caller passed a username / artist name instead of a numeric SoundCloud user ID, resolve via `/users?q=...`
    let is_name_lookup = clean_uid.starts_with("name:")
        || !clean_uid.chars().all(|c| c.is_ascii_digit());
    if is_name_lookup {
        let name_q = clean_uid.trim_start_matches("name:").trim();
        let search_u = format!(
            "/users?q={}&limit=5&linked_partitioning=true",
            url_encode_component(name_q)
        );
        if let Ok(u_json) = soundcloud_authed_get(settings, &search_u) {
            let candidates: Vec<SoundCloudUserSummary> = extract_collection_items(&u_json)
                .into_iter()
                .filter_map(map_soundcloud_item_to_user)
                .collect();
            if let Some(matched) = candidates
                .iter()
                .find(|u| u.username.eq_ignore_ascii_case(name_q))
                .or_else(|| candidates.first())
            {
                clean_uid = matched.id.clone();
                user = Some(matched.clone());
            }
        }
    }

    let encoded_uid = url_encode_component(&clean_uid);
    if user.is_none() {
        user = soundcloud_authed_get(settings, &format!("/users/{encoded_uid}"))
            .ok()
            .and_then(|v| map_soundcloud_item_to_user(&v));
    }

    // Fetch up to 2 pages of `/users/{id}/tracks` initially (up to 200 tracks instead of 20!) and retain `next_tracks_href`
    let mut tracks = Vec::new();
    let mut seen_track_uris = std::collections::HashSet::new();
    let mut next_tracks_href = Some(format!(
        "/users/{encoded_uid}/tracks?limit=100&access={access_q}&linked_partitioning=true"
    ));
    for _ in 0..2 {
        let Some(ref page_url) = next_tracks_href else {
            break;
        };
        let Ok(t_json) = soundcloud_authed_get(settings, page_url) else {
            next_tracks_href = None;
            break;
        };
        for item in extract_collection_items(&t_json) {
            if let Some(t) = map_soundcloud_item_to_track(item) {
                if should_keep_track_for_session(&t, signed_in)
                    && seen_track_uris.insert(t.uri.clone())
                {
                    tracks.push(t);
                }
            }
        }
        next_tracks_href = extract_next_href(&t_json);
    }

    let mut playlists = Vec::new();
    let mut seen_playlist_ids = std::collections::HashSet::new();
    if let Ok(p_json) = soundcloud_authed_get(
        settings,
        &format!(
            "/users/{encoded_uid}/playlists?limit=50&show_tracks=true&access={access_q}&linked_partitioning=true"
        ),
    ) {
        for item in extract_collection_items(&p_json) {
            if let Some(mut pl) = map_soundcloud_item_to_playlist(item, "catalog_set") {
                if should_keep_playlist_for_session(&mut pl, signed_in)
                    && seen_playlist_ids.insert(pl.id.clone())
                {
                    playlists.push(pl);
                }
            }
        }
    }

    // When API v2 mode is enabled, also fetch the creator's full v2 tracks, albums, and sets so
    // distributor-monetized releases (`policy: MONETIZE` / `AD_SUPPORTED`) appear with full track counts.
    if is_soundcloud_v2_enabled(settings) {
        if let Ok(v2_tracks) = soundcloud_v2_get_json(&format!(
            "/users/{encoded_uid}/tracks?representation=full&limit=100"
        )) {
            for item in extract_collection_items(&v2_tracks) {
                if let Some(t) = map_soundcloud_item_to_track(item) {
                    if should_keep_track_for_session(&t, signed_in)
                        && seen_track_uris.insert(t.uri.clone())
                    {
                        tracks.push(t);
                    }
                }
            }
        }
        for v2_pl_endpoint in [
            format!("/users/{encoded_uid}/albums?representation=full&limit=50"),
            format!("/users/{encoded_uid}/playlists_without_albums?representation=full&limit=50"),
        ] {
            if let Ok(v2_pl_json) = soundcloud_v2_get_json(&v2_pl_endpoint) {
                for item in extract_collection_items(&v2_pl_json) {
                    if let Some(mut pl) = map_soundcloud_item_to_playlist(item, "catalog_set") {
                        if should_keep_playlist_for_session(&mut pl, signed_in) {
                            if let Some(existing) = playlists.iter_mut().find(|e| e.id == pl.id) {
                                if pl.track_count > existing.track_count {
                                    *existing = pl;
                                }
                            } else if seen_playlist_ids.insert(pl.id.clone()) {
                                playlists.push(pl);
                            }
                        }
                    }
                }
            }
        }
    }

    // Fetch what this artist likes (`GET /users/{id}/likes/tracks`) for rabbit-hole discovery
    let mut liked_tracks = Vec::new();
    if let Ok(l_json) = soundcloud_authed_get(
        settings,
        &format!(
            "/users/{encoded_uid}/likes/tracks?limit=40&access={access_q}&linked_partitioning=true"
        ),
    ) {
        for item in extract_collection_items(&l_json) {
            if let Some(t) = map_soundcloud_item_to_track(item) {
                if should_keep_track_for_session(&t, signed_in) {
                    liked_tracks.push(t);
                }
            }
        }
    }

    // Fetch who this artist follows (`GET /users/{id}/followings`) to step artist-to-artist
    let mut followings = Vec::new();
    let mut seen_f = std::collections::HashSet::new();
    if let Ok(f_json) = soundcloud_authed_get(
        settings,
        &format!("/users/{encoded_uid}/followings?limit=40&linked_partitioning=true"),
    ) {
        for item in extract_collection_items(&f_json) {
            if let Some(u) = map_soundcloud_item_to_user(item) {
                if seen_f.insert(u.id.clone()) {
                    followings.push(u);
                }
            }
        }
    }

    Ok(SoundCloudUserProfileResponse {
        user,
        tracks,
        playlists,
        liked_tracks,
        followings,
        next_tracks_href,
    })
}

/// Follows a SoundCloud `next_href` pagination cursor and maps the next page of tracks or playlists.
pub fn fetch_soundcloud_next_page(
    settings: &SimpSettings,
    next_href: &str,
) -> Result<SoundCloudPaginateResponse> {
    let trimmed = next_href.trim();
    if trimmed.is_empty() {
        return Ok(SoundCloudPaginateResponse {
            tracks: Vec::new(),
            playlists: Vec::new(),
            next_href: None,
        });
    }
    let signed_in = is_soundcloud_user_signed_in(settings);
    let json = soundcloud_authed_get(settings, trimmed)?;
    let next_cursor = extract_next_href(&json);
    let mut tracks = Vec::new();
    let mut playlists = Vec::new();
    for item in extract_collection_items(&json) {
        let origin = item.get("origin").unwrap_or(item);
        let kind = origin.get("kind").and_then(|v| v.as_str()).unwrap_or("track");
        if kind == "playlist" {
            if let Some(mut pl) = map_soundcloud_item_to_playlist(origin, "catalog_set") {
                if should_keep_playlist_for_session(&mut pl, signed_in) {
                    playlists.push(pl);
                }
            }
        } else if let Some(t) = map_soundcloud_item_to_track(item) {
            if should_keep_track_for_session(&t, signed_in) {
                tracks.push(t);
            }
        }
    }
    Ok(SoundCloudPaginateResponse {
        tracks,
        playlists,
        next_href: next_cursor,
    })
}

/// Follows (`PUT /me/followings/{user_id}`) or unfollows (`DELETE /me/followings/{user_id}`) a SoundCloud creator.
pub fn set_soundcloud_user_followed(
    settings: &SimpSettings,
    user_id_or_urn: &str,
    follow: bool,
) -> Result<()> {
    let clean_uid = clean_soundcloud_id(user_id_or_urn)
        .trim_start_matches("users:")
        .trim()
        .to_string();
    if clean_uid.is_empty() {
        return Err(anyhow!("Invalid SoundCloud user ID"));
    }
    let token = ensure_valid_access_token(settings)?;
    let auth_header = format!("OAuth {}", token.trim());
    let url = format!(
        "https://api.soundcloud.com/me/followings/{}",
        url_encode_component(&clean_uid)
    );
    let method = if follow { "PUT" } else { "DELETE" };
    let _ = crate::http_pool::http_custom_bytes(
        method,
        &url,
        &[
            ("Authorization", auth_header.as_str()),
            ("Accept", "application/json; charset=utf-8"),
        ],
        if follow { Some(b"") } else { None },
        10,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rfc7636_pkce_s256_challenge_vector() {
        // Official RFC 7636 Appendix B test vector:
        // code_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        // expected S256 challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = pkce_code_challenge_s256(verifier);
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn test_map_soundcloud_item_to_track_and_artwork_upscaling() {
        let sample = serde_json::json!({
            "id": 987654321u64,
            "urn": "soundcloud:tracks:987654321",
            "kind": "track",
            "access": "playable",
            "title": "Midnight Synthwave Session",
            "duration": 245000,
            "genre": "Synthwave",
            "artwork_url": "https://i1.sndcdn.com/artworks-00012345-abcdef-large.jpg",
            "waveform_url": "https://wis.sndcdn.com/abcdef12345_m.png",
            "user": {
                "username": "NeonRunner"
            }
        });

        let track = map_soundcloud_item_to_track(&sample).expect("should map playable track");
        assert_eq!(track.uri, "soundcloud:track:987654321");
        assert_eq!(track.title, "Midnight Synthwave Session");
        assert_eq!(track.artists, vec!["NeonRunner".to_string()]);
        assert_eq!(track.album, "SoundCloud • Synthwave");
        assert_eq!(track.duration_ms, 245000);
        assert_eq!(track.source, "soundcloud");
        assert_eq!(
            track.art_url.as_deref(),
            Some("https://i1.sndcdn.com/artworks-00012345-abcdef-t500x500.jpg")
        );

        // Verify preview tracks (e.g. Go+ / major-label album sets) are mapped and tagged
        let preview_item = serde_json::json!({
            "id": 111222,
            "kind": "track",
            "access": "preview",
            "title": "God Save The Three",
            "duration": 30000
        });
        let preview_track =
            map_soundcloud_item_to_track(&preview_item).expect("should map preview track");
        assert!(preview_track.album.contains("Preview"));

        // Verify blocked tracks and unhydrated track stubs are filtered out
        let blocked_item = serde_json::json!({
            "id": 333444,
            "kind": "track",
            "access": "blocked",
            "title": "Geo-Blocked Track"
        });
        assert!(map_soundcloud_item_to_track(&blocked_item).is_none());

        let stub_item = serde_json::json!({
            "id": 555666,
            "kind": "track"
        });
        assert!(map_soundcloud_item_to_track(&stub_item).is_none());

        // Verify playlists whose `tracks` array was emptied by SoundCloud's `access=playable,preview`
        // filter (meaning 100% of tracks are `access: "blocked"`) return `None` instead of reporting
        // a phantom `track_count` that opens to "No streamable tracks available".
        let empty_filtered_set = serde_json::json!({
            "id": 1912676703u64,
            "kind": "playlist",
            "title": "Blocked Distributor Set",
            "track_count": 5,
            "tracks": []
        });
        assert!(map_soundcloud_item_to_playlist(&empty_filtered_set, "catalog_set").is_none());

        // Verify sets containing only `access: "preview"` tracks on v1 are filtered out when signed in
        // (Strict v1 mode), and kept when in anonymous Public Discovery mode.
        let preview_set = serde_json::json!({
            "id": 2269108565u64,
            "kind": "playlist",
            "title": "Label Preview Set",
            "track_count": 2,
            "tracks": [
                {
                    "id": 1001,
                    "kind": "track",
                    "access": "preview",
                    "title": "Track One",
                    "duration": 149000
                },
                {
                    "id": 1002,
                    "kind": "track",
                    "access": "preview",
                    "title": "Track Two",
                    "duration": 162000
                }
            ]
        });
        let mut mapped_set_anon =
            map_soundcloud_item_to_playlist(&preview_set, "catalog_set").expect("map preview set");
        assert!(should_keep_playlist_for_session(&mut mapped_set_anon, false));
        let mut mapped_set_signed_in =
            map_soundcloud_item_to_playlist(&preview_set, "catalog_set").expect("map preview set");
        assert!(!should_keep_playlist_for_session(&mut mapped_set_signed_in, true));

        // Verify API v2 tracks with `snipped: false` transcodings map as full-length playable tracks
        let v2_track_item = serde_json::json!({
            "id": 2268829622u64,
            "kind": "track",
            "policy": "MONETIZE",
            "monetization_model": "AD_SUPPORTED",
            "title": "Full Length Monetized Track",
            "duration": 149107,
            "media": {
                "transcodings": [
                    {
                        "url": "https://api-v2.soundcloud.com/media/soundcloud:tracks:2268829622/uuid/stream/ctr-encrypted-hls",
                        "preset": "aac_160k",
                        "duration": 149107,
                        "snipped": false,
                        "format": {
                            "protocol": "ctr-encrypted-hls",
                            "mime_type": "audio/mp4; codecs=\"mp4a.40.2\""
                        }
                    }
                ]
            }
        });
        let mapped_v2_track =
            map_soundcloud_item_to_track(&v2_track_item).expect("should map v2 full track");
        assert!(!mapped_v2_track.album.contains("Preview"));
        assert!(should_keep_track_for_session(&mapped_v2_track, true));
    }

    #[test]
    fn test_stream_url_priority_selection() {
        let urls = SoundCloudStreamUrls {
            track_id: "123".to_string(),
            hls_aac_160_url: Some("https://cf-hls-media.sndcdn.com/playlist_aac160.m3u8".to_string()),
            hls_aac_96_url: None,
            hls_mp3_128_url: Some("https://cf-hls-media.sndcdn.com/playlist_mp3128.m3u8".to_string()),
            http_mp3_128_url: Some("https://cf-media.sndcdn.com/stream.128.mp3".to_string()),
            preview_mp3_128_url: None,
            drm_hls_url: None,
            drm_license_auth_token: None,
        };
        assert_eq!(
            urls.preferred_stream(),
            Some(("https://cf-hls-media.sndcdn.com/playlist_aac160.m3u8", true))
        );
    }

    #[test]
    fn test_parse_description_chapters_and_bpm_metadata() {
        let desc = "Recorded live at Club 99.\n\
                    00:00 Intro - Atmospheric Pad\n\
                    [04:15] Example Artist - Track 01 (Original Mix)\n\
                    12:30 - Sample Producer — Track 02\n\
                    1:02:45 Closing Track (VIP)\n\
                    Follow on SoundCloud!";
        let chapters = parse_description_chapters(desc, 4_000_000);
        assert_eq!(chapters.len(), 4);
        assert_eq!(
            chapters[0],
            SoundCloudMixChapter {
                label: "Intro - Atmospheric Pad".to_string(),
                timestamp_ms: 0
            }
        );
        assert_eq!(
            chapters[1],
            SoundCloudMixChapter {
                label: "Example Artist - Track 01 (Original Mix)".to_string(),
                timestamp_ms: (4 * 60 + 15) * 1000
            }
        );
        assert_eq!(
            chapters[2],
            SoundCloudMixChapter {
                label: "Sample Producer — Track 02".to_string(),
                timestamp_ms: (12 * 60 + 30) * 1000
            }
        );
        assert_eq!(
            chapters[3],
            SoundCloudMixChapter {
                label: "Closing Track (VIP)".to_string(),
                timestamp_ms: (3600 + 2 * 60 + 45) * 1000
            }
        );

        let mix_json = serde_json::json!({
            "id": 555666777u64,
            "kind": "track",
            "access": "playable",
            "title": "Late Night Session 042",
            "duration": 3600000,
            "genre": "Techno",
            "bpm": 128.0,
            "favoritings_count": 3420,
            "description": desc,
            "user": {
                "id": 998877u64,
                "username": "ExampleDJ"
            }
        });
        let mapped = map_soundcloud_item_to_track(&mix_json).expect("map DJ mix");
        assert_eq!(
            mapped.album,
            "SoundCloud Mix • Techno • 128 BPM • ♥ 3.4K"
        );
    }

    #[test]
    fn test_soundcloud_token_rotation_cache_and_settings_sync() {
        clear_cached_soundcloud_state();

        // 1. Seed a user OAuth session with an initial refresh_token
        update_cached_soundcloud_tokens(SoundCloudTokenBundle {
            access_token: "access_v1".to_string(),
            refresh_token: "refresh_v1".to_string(),
            expires_at: 2_000_000_000,
            auth_mode: "user".to_string(),
            username: "dj_tester".to_string(),
        });

        // 2. Verify a client_credentials fallback never overwrites an active user refresh_token
        update_cached_soundcloud_tokens(SoundCloudTokenBundle {
            access_token: "cc_access".to_string(),
            refresh_token: String::new(),
            expires_at: 2_000_003_600,
            auth_mode: "client_credentials".to_string(),
            username: "Public Discovery (Client Credentials)".to_string(),
        });

        let mut stale_settings = SimpSettings::default();
        stale_settings.services.soundcloud_enabled = true;
        stale_settings.services.soundcloud_access_token = "old_access_v0".to_string();
        stale_settings.services.soundcloud_refresh_token = "old_refresh_v0".to_string();
        stale_settings.services.soundcloud_token_expires_at = 1_700_000_000;
        stale_settings.services.soundcloud_auth_mode = "user".to_string();

        // 3. Rotate the user token in TOKEN_CACHE (simulating hourly grant_type=refresh_token rotation)
        update_cached_soundcloud_tokens(SoundCloudTokenBundle {
            access_token: "access_v2".to_string(),
            refresh_token: "refresh_v2_rotated".to_string(),
            expires_at: 2_000_007_200,
            auth_mode: "user".to_string(),
            username: "dj_tester".to_string(),
        });

        // 4. Syncing into a stale SimpSettings (e.g. before save_settings on SetVolume) must preserve
        //    the newly rotated `refresh_v2_rotated` instead of overwriting disk with `old_refresh_v0`!
        sync_latest_soundcloud_tokens_into_settings(&mut stale_settings);
        assert_eq!(stale_settings.services.soundcloud_access_token, "access_v2");
        assert_eq!(
            stale_settings.services.soundcloud_refresh_token,
            "refresh_v2_rotated"
        );
        assert_eq!(
            stale_settings.services.soundcloud_token_expires_at,
            2_000_007_200
        );
        assert_eq!(stale_settings.services.soundcloud_auth_mode, "user");
        assert_eq!(stale_settings.services.soundcloud_username, "dj_tester");

        clear_cached_soundcloud_state();
    }
}
