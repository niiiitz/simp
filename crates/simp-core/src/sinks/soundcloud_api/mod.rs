pub mod auth;
pub mod catalog;
pub mod social;
pub mod stream;

pub use auth::*;
pub use catalog::*;
pub use social::*;
pub use stream::*;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

pub const SOUNDCLOUD_DEFAULT_REDIRECT_URI: &str = "http://127.0.0.1:18888/api/soundcloud/callback";
pub const SOUNDCLOUD_DEFAULT_TOKEN_PROXY_URL: &str = "https://simp-tap-67.niiiitz.workers.dev";
pub const SOUNDCLOUD_DEFAULT_CLIENT_ID: &str = "WU0IbI5NwABTi60QuSLPgIeTZZmwNznQ";
pub(crate) const REVOKED_SOUNDCLOUD_CLIENT_ID: &str = "8OHEYL2oWiDNXkoa3NG9GqMmcHjzuETj";

/// Hard-locked to `false` so `api-v2` code remains in the repository for future reactivation
/// if SoundCloud support grants clearance, while being 100% unreachable at runtime.
#[inline]
pub(crate) const fn is_soundcloud_v2_enabled(_settings: &SimpSettings) -> bool {
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
    #[serde(default)]
    pub gated_track_count: usize,
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
    #[serde(default)]
    pub gated_track_count: usize,
    #[serde(default)]
    pub gated_playlist_count: usize,
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
pub(crate) struct PendingPkceFlow {
    pub state: String,
    pub code_verifier: String,
    pub redirect_uri: String,
    pub created_at: Instant,
}

#[derive(Debug, Clone)]
pub(crate) struct TrackHintEntry {
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

pub(crate) fn token_cache() -> &'static Mutex<Option<SoundCloudTokenBundle>> {
    TOKEN_CACHE.get_or_init(|| Mutex::new(None))
}

pub(crate) fn token_refresh_lock() -> &'static Mutex<()> {
    TOKEN_REFRESH_LOCK.get_or_init(|| Mutex::new(()))
}

pub(crate) fn pkce_flows() -> &'static Mutex<VecDeque<PendingPkceFlow>> {
    PKCE_FLOWS.get_or_init(|| Mutex::new(VecDeque::with_capacity(8)))
}

pub(crate) fn track_hints() -> &'static Mutex<HashMap<String, TrackHintEntry>> {
    TRACK_HINTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn waveform_cache() -> &'static Mutex<HashMap<String, SoundCloudWaveform>> {
    WAVEFORM_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn comments_cache() -> &'static Mutex<HashMap<String, (Instant, Vec<SoundCloudComment>)>> {
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
        let cached_is_genuine_user = cached.auth_mode == "user"
            && (!cached.refresh_token.trim().is_empty()
                || (!cached.username.trim().is_empty()
                    && cached.username != "Public Discovery (Client Credentials)"));
        let cached_is_newer_or_user = !cached.access_token.trim().is_empty()
            && (cached.expires_at >= settings.services.soundcloud_token_expires_at
                || (cached_is_genuine_user
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
                settings.services.soundcloud_auth_mode = if cached_is_genuine_user {
                    "user".to_string()
                } else {
                    "client_credentials".to_string()
                };
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

    let is_explicit = obj
        .pointer("/publisher_metadata/explicit")
        .and_then(|v| v.as_bool())
        .or_else(|| obj.get("explicit").and_then(|v| v.as_bool()))
        .unwrap_or(false);

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
        content_rating: if is_explicit {
            Some("explicit".to_string())
        } else {
            None
        },
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

    let gated_track_count = if has_tracks_array {
        reported_count.saturating_sub(track_count)
    } else {
        0
    };

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
        gated_track_count,
    })
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
