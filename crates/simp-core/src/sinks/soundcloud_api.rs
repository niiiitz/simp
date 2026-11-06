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
    pub stations: Vec<SoundCloudStationSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudDiscoverResponse {
    pub tracks: Vec<TrackMetadata>,
    pub mixes: Vec<TrackMetadata>,
    pub playlists: Vec<SoundCloudPlaylistSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundCloudSearchResults {
    pub tracks: Vec<TrackMetadata>,
    pub mixes: Vec<TrackMetadata>,
    pub playlists: Vec<SoundCloudPlaylistSummary>,
    pub stations: Vec<SoundCloudStationSummary>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SoundCloudStreamUrls {
    pub track_id: String,
    pub hls_aac_160_url: Option<String>,
    pub hls_aac_96_url: Option<String>,
    pub hls_mp3_128_url: Option<String>,
    pub http_mp3_128_url: Option<String>,
    pub preview_mp3_128_url: Option<String>,
}

impl SoundCloudStreamUrls {
    /// Selects the highest-fidelity full-length stream URL in priority order:
    /// 1. `hls_aac_160_url` (160 kbps AAC HLS — superior acoustic transparency)
    /// 2. `hls_mp3_128_url` (128 kbps MP3 HLS)
    /// 3. `http_mp3_128_url` (128 kbps progressive HTTP MP3)
    /// 4. `hls_aac_96_url`
    /// 5. `preview_mp3_128_url` (last-resort fallback)
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
}

static TOKEN_CACHE: OnceLock<Mutex<Option<SoundCloudTokenBundle>>> = OnceLock::new();
static PKCE_FLOWS: OnceLock<Mutex<VecDeque<PendingPkceFlow>>> = OnceLock::new();
static TRACK_HINTS: OnceLock<Mutex<HashMap<String, TrackHintEntry>>> = OnceLock::new();
static WAVEFORM_CACHE: OnceLock<Mutex<HashMap<String, SoundCloudWaveform>>> = OnceLock::new();
static COMMENTS_CACHE: OnceLock<Mutex<HashMap<String, (Instant, Vec<SoundCloudComment>)>>> =
    OnceLock::new();

fn token_cache() -> &'static Mutex<Option<SoundCloudTokenBundle>> {
    TOKEN_CACHE.get_or_init(|| Mutex::new(None))
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
}

pub fn update_cached_soundcloud_tokens(bundle: SoundCloudTokenBundle) {
    if let Ok(mut g) = token_cache().lock() {
        *g = Some(bundle);
    }
}

pub fn get_cached_soundcloud_tokens() -> Option<SoundCloudTokenBundle> {
    token_cache().lock().ok().and_then(|g| g.clone())
}

pub fn clean_soundcloud_id(raw: &str) -> String {
    let trimmed = raw.trim();
    for prefix in [
        "soundcloud:station:track:",
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

    // Respect `access` tier: skip tracks marked `blocked` or `preview` (30s Go+ paywall)
    if let Some(access) = obj.get("access").and_then(|v| v.as_str()) {
        if access == "blocked" || access == "preview" {
            return None;
        }
    }

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

    let title = obj
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown Track")
        .trim()
        .to_string();

    let artist = obj
        .pointer("/user/username")
        .or_else(|| obj.pointer("/metadata_artist"))
        .and_then(|v| v.as_str())
        .unwrap_or("SoundCloud Artist")
        .trim()
        .to_string();

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

    let album_label = if duration_ms >= 20 * 60 * 1000 {
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

    let track_count = obj
        .get("track_count")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .or_else(|| {
            obj.get("tracks")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
        })
        .unwrap_or(0);

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

    Some(SoundCloudPlaylistSummary {
        id: raw_id,
        name,
        description,
        creator,
        art_url: format_soundcloud_art_url(raw_art),
        track_count,
        duration_ms,
        kind: default_kind.to_string(),
    })
}

/// Resolves SoundCloud credentials from `SimpSettings`, in-memory cache, environment variables,
/// `.env` files (`./.env`, parent git repo `.env` if in a worktree, or `~/.config/simp/.env`),
/// and compile-time embedded variables.
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

    let mut client_secret = get_val(
        &settings.services.soundcloud_client_secret,
        "SOUNDCLOUD_CLIENT_SECRET",
    );
    if client_secret.is_empty() {
        if let Some(embedded) = option_env!("SIMP_EMBEDDED_SOUNDCLOUD_CLIENT_SECRET") {
            if !embedded.trim().is_empty() {
                client_secret = embedded.trim().to_string();
            }
        }
    }

    let mut access_token = settings.services.soundcloud_access_token.trim().to_string();
    let mut refresh_token = settings
        .services
        .soundcloud_refresh_token
        .trim()
        .to_string();
    let mut expires_at = settings.services.soundcloud_token_expires_at;
    let mut auth_mode = settings.services.soundcloud_auth_mode.trim().to_string();
    let mut username = settings.services.soundcloud_username.trim().to_string();

    if let Some(cached) = get_cached_soundcloud_tokens() {
        // Prefer the in-memory token if settings hasn't been reloaded yet or if cached is newer
        let use_cached = access_token.is_empty()
            || (cached.auth_mode == "user" && auth_mode != "user")
            || (cached.expires_at > expires_at && cached.auth_mode == auth_mode);
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

/// Exchanges an OAuth 2.1 `code` + PKCE `code_verifier` for a SoundCloud user `access_token` and `refresh_token`.
pub fn exchange_oauth_code(
    settings: &SimpSettings,
    code: &str,
    state: Option<&str>,
    redirect_uri_override: Option<&str>,
) -> Result<SoundCloudTokenBundle> {
    let creds = resolve_soundcloud_credentials(settings);
    if creds.client_id.is_empty() || creds.client_secret.is_empty() {
        return Err(anyhow!(
            "Missing SOUNDCLOUD_CLIENT_ID or SOUNDCLOUD_CLIENT_SECRET"
        ));
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

    let form_body = format!(
        "grant_type=authorization_code&client_id={}&client_secret={}&redirect_uri={}&code_verifier={}&code={}",
        url_encode_component(&creds.client_id),
        url_encode_component(&creds.client_secret),
        url_encode_component(redirect_uri),
        url_encode_component(&flow.code_verifier),
        url_encode_component(code.trim()),
    );

    let mut bundle = post_oauth_token_request(&form_body, None, "user")?;
    if let Ok(me) = soundcloud_get_json("/me", &bundle.access_token) {
        if let Some(uname) = me.get("username").and_then(|v| v.as_str()) {
            bundle.username = uname.trim().to_string();
        }
    }
    update_cached_soundcloud_tokens(bundle.clone());
    persist_soundcloud_tokens_to_settings_vdf(&bundle);
    Ok(bundle)
}

/// Obtains a server-to-server `client_credentials` token using `SOUNDCLOUD_CLIENT_ID` and `SOUNDCLOUD_CLIENT_SECRET`.
pub fn obtain_client_credentials_token(settings: &SimpSettings) -> Result<SoundCloudTokenBundle> {
    let creds = resolve_soundcloud_credentials(settings);
    if creds.client_id.is_empty() || creds.client_secret.is_empty() {
        return Err(anyhow!(
            "Missing SOUNDCLOUD_CLIENT_ID or SOUNDCLOUD_CLIENT_SECRET in settings or .env"
        ));
    }

    let basic_b64 = BASE64_STD.encode(format!("{}:{}", creds.client_id, creds.client_secret));
    let basic_header = format!("Basic {basic_b64}");
    let form_body = format!(
        "grant_type=client_credentials&client_id={}&client_secret={}",
        url_encode_component(&creds.client_id),
        url_encode_component(&creds.client_secret),
    );

    let mut bundle = post_oauth_token_request(&form_body, Some(&basic_header), "client_credentials")?;
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
    let form_body = format!(
        "grant_type=refresh_token&client_id={}&client_secret={}&refresh_token={}",
        url_encode_component(client_id),
        url_encode_component(client_secret),
        url_encode_component(refresh_token),
    );
    let mut bundle = post_oauth_token_request(&form_body, None, "user")?;
    bundle.username = existing_username.to_string();
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

    let json: Value =
        serde_json::from_slice(&bytes).context("Invalid JSON from SoundCloud OAuth endpoint")?;
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

/// Resolves a valid SoundCloud OAuth access token, transparently refreshing expired user tokens
/// or minting a `client_credentials` token when `SOUNDCLOUD_CLIENT_ID` & `SOUNDCLOUD_CLIENT_SECRET` are available.
pub fn ensure_valid_access_token(settings: &SimpSettings) -> Result<String> {
    let creds = resolve_soundcloud_credentials(settings);
    let now = now_unix_secs();

    if !creds.access_token.is_empty() && (creds.expires_at == 0 || now + 60 < creds.expires_at) {
        return Ok(creds.access_token);
    }

    if !creds.refresh_token.is_empty()
        && !creds.client_id.is_empty()
        && !creds.client_secret.is_empty()
    {
        if let Ok(refreshed) = refresh_user_oauth_token(
            &creds.client_id,
            &creds.client_secret,
            &creds.refresh_token,
            &creds.username,
        ) {
            return Ok(refreshed.access_token);
        }
    }

    if !creds.client_id.is_empty() && !creds.client_secret.is_empty() {
        let bundle = obtain_client_credentials_token(settings)?;
        return Ok(bundle.access_token);
    }

    if !creds.access_token.is_empty() {
        return Ok(creds.access_token);
    }

    Err(anyhow!(
        "SoundCloud is not authenticated — configure SOUNDCLOUD_CLIENT_ID & SOUNDCLOUD_CLIENT_SECRET or sign in via Sources (Select)"
    ))
}

/// Revokes the active SoundCloud token and clears in-memory state.
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
}

pub fn is_soundcloud_ready(settings: &SimpSettings) -> bool {
    let creds = resolve_soundcloud_credentials(settings);
    !creds.access_token.is_empty()
        || (!creds.client_id.is_empty() && !creds.client_secret.is_empty())
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
    let token = ensure_valid_access_token(settings)?;
    match soundcloud_get_json(url, &token) {
        Ok(v) => Ok(v),
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains("HTTP 401") {
                clear_cached_soundcloud_state();
                let creds = resolve_soundcloud_credentials(settings);
                if !creds.refresh_token.is_empty()
                    && !creds.client_id.is_empty()
                    && !creds.client_secret.is_empty()
                {
                    if let Ok(b) = refresh_user_oauth_token(
                        &creds.client_id,
                        &creds.client_secret,
                        &creds.refresh_token,
                        &creds.username,
                    ) {
                        return soundcloud_get_json(url, &b.access_token);
                    }
                }
                if !creds.client_id.is_empty() && !creds.client_secret.is_empty() {
                    if let Ok(b) = obtain_client_credentials_token(settings) {
                        return soundcloud_get_json(url, &b.access_token);
                    }
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
    let json = soundcloud_authed_get(
        settings,
        &format!("/tracks/{}", url_encode_component(&track_id)),
    )
    .ok()?;
    map_soundcloud_item_to_track(&json)
}

/// Fetches the streaming URLs (`hls_aac_160_url`, `hls_mp3_128_url`, `http_mp3_128_url`) for a SoundCloud track.
pub fn fetch_track_streams(
    settings: &SimpSettings,
    track_uri_or_id: &str,
) -> Result<SoundCloudStreamUrls> {
    let track_id = clean_soundcloud_id(track_uri_or_id);
    if track_id.is_empty() {
        return Err(anyhow!("Empty SoundCloud track ID"));
    }

    let path = format!("/tracks/{}/streams", url_encode_component(&track_id));
    let json = soundcloud_authed_get(settings, &path)
        .with_context(|| format!("Failed to fetch SoundCloud streams for track {track_id}"))?;

    let get_str = |key: &str| -> Option<String> {
        json.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };

    let urls = SoundCloudStreamUrls {
        track_id,
        hls_aac_160_url: get_str("hls_aac_160_url"),
        hls_aac_96_url: get_str("hls_aac_96_url"),
        hls_mp3_128_url: get_str("hls_mp3_128_url"),
        http_mp3_128_url: get_str("http_mp3_128_url"),
        preview_mp3_128_url: get_str("preview_mp3_128_url"),
    };

    if urls.preferred_stream().is_none() {
        return Err(anyhow!(
            "SoundCloud track has no playable HLS or HTTP stream URLs available"
        ));
    }

    Ok(urls)
}

/// Fetches the user's `❤️ Liked Tracks` virtual playlist, created sets (`/me/playlists`), and liked sets (`/me/likes/playlists`).
pub fn fetch_user_playlists_and_likes(
    settings: &SimpSettings,
) -> Result<SoundCloudPlaylistsResponse> {
    let mut playlists = Vec::new();
    let mut liked_tracks_preview = Vec::new();

    if let Ok(likes_json) = soundcloud_authed_get(
        settings,
        "/me/likes/tracks?limit=100&access=playable&linked_partitioning=true",
    ) {
        for item in extract_collection_items(&likes_json) {
            if let Some(track) = map_soundcloud_item_to_track(item) {
                liked_tracks_preview.push(track);
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
        description: if liked_tracks_preview.is_empty() {
            "Sign in with your SoundCloud account to sync your Liked tracks".to_string()
        } else {
            format!("{} liked SoundCloud tracks", liked_tracks_preview.len())
        },
        creator: "You".to_string(),
        art_url: likes_art,
        track_count: liked_tracks_preview.len(),
        duration_ms: likes_dur,
        kind: "likes".to_string(),
    });

    if let Ok(my_sets_json) =
        soundcloud_authed_get(settings, "/me/playlists?limit=50&linked_partitioning=true")
    {
        for item in extract_collection_items(&my_sets_json) {
            if let Some(pl) = map_soundcloud_item_to_playlist(item, "user_set") {
                playlists.push(pl);
            }
        }
    }

    if let Ok(liked_sets_json) = soundcloud_authed_get(
        settings,
        "/me/likes/playlists?limit=50&linked_partitioning=true",
    ) {
        for item in extract_collection_items(&liked_sets_json) {
            if let Some(pl) = map_soundcloud_item_to_playlist(item, "liked_set") {
                if !playlists.iter().any(|existing| existing.id == pl.id) {
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
    let clean_id = clean_soundcloud_id(playlist_id);
    if clean_id.eq_ignore_ascii_case("likes") {
        let json = soundcloud_authed_get(
            settings,
            "/me/likes/tracks?limit=150&access=playable&linked_partitioning=true",
        )?;
        let tracks: Vec<TrackMetadata> = extract_collection_items(&json)
            .into_iter()
            .filter_map(map_soundcloud_item_to_track)
            .collect();
        return Ok(tracks);
    }

    let mut tracks = Vec::new();
    let tracks_url = format!(
        "/playlists/{}/tracks?limit=200&access=playable&linked_partitioning=true",
        url_encode_component(&clean_id)
    );
    if let Ok(json) = soundcloud_authed_get(settings, &tracks_url) {
        for item in extract_collection_items(&json) {
            if let Some(t) = map_soundcloud_item_to_track(item) {
                tracks.push(t);
            }
        }
    }

    if tracks.is_empty() {
        let pl_url = format!(
            "/playlists/{}?access=playable",
            url_encode_component(&clean_id)
        );
        if let Ok(json) = soundcloud_authed_get(settings, &pl_url) {
            if let Some(arr) = json.get("tracks").and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(t) = map_soundcloud_item_to_track(item) {
                        tracks.push(t);
                    }
                }
            }
        }
    }

    Ok(tracks)
}

/// Fetches the user's chronological Activity Stream (`/me/activities`) and builds dynamic Track Radio Stations.
pub fn fetch_stream_and_stations(settings: &SimpSettings) -> Result<SoundCloudStreamResponse> {
    let mut stream_tracks = Vec::new();
    let mut seen_uris = std::collections::HashSet::new();

    if let Ok(act_json) = soundcloud_authed_get(
        settings,
        "/me/activities/tracks?limit=50&access=playable&linked_partitioning=true",
    )
    .or_else(|_| {
        soundcloud_authed_get(
            settings,
            "/me/activities?limit=50&access=playable&linked_partitioning=true",
        )
    }) {
        for item in extract_collection_items(&act_json) {
            if let Some(t) = map_soundcloud_item_to_track(item) {
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
        stations,
    })
}

/// Fetches Trending tracks, long-form DJ Mixes (`20m+`), and sets for a genre/vibe filter.
pub fn fetch_trending_and_mixes(
    settings: &SimpSettings,
    genre: Option<&str>,
    mixes_only: bool,
) -> Result<SoundCloudDiscoverResponse> {
    let clean_genre = genre
        .map(|g| g.trim())
        .filter(|g| !g.is_empty() && !g.eq_ignore_ascii_case("all"));

    let mut tracks_url =
        String::from("/tracks?access=playable&linked_partitioning=true&limit=45");
    if let Some(g) = clean_genre {
        tracks_url.push_str(&format!("&genres={}&q={}", url_encode_component(g), url_encode_component(g)));
    }
    if mixes_only {
        tracks_url.push_str("&duration%5Bfrom%5D=1200000");
    }

    let mut tracks = Vec::new();
    let mut mixes = Vec::new();
    if let Ok(json) = soundcloud_authed_get(settings, &tracks_url) {
        for item in extract_collection_items(&json) {
            if let Some(t) = map_soundcloud_item_to_track(item) {
                if t.duration_ms >= 20 * 60 * 1000 {
                    mixes.push(t.clone());
                }
                tracks.push(t);
            }
        }
    }

    // Also fetch dedicated 20m+ DJ Mixes if `mixes` is sparse
    if mixes.len() < 6 {
        let mut mix_url = String::from(
            "/tracks?access=playable&linked_partitioning=true&duration%5Bfrom%5D=1200000&limit=20",
        );
        if let Some(g) = clean_genre {
            mix_url.push_str(&format!("&q={}%20mix", url_encode_component(g)));
        } else {
            mix_url.push_str("&q=dj%20mix%20set");
        }
        if let Ok(mix_json) = soundcloud_authed_get(settings, &mix_url) {
            for item in extract_collection_items(&mix_json) {
                if let Some(t) = map_soundcloud_item_to_track(item) {
                    if !mixes.iter().any(|m| m.uri == t.uri) {
                        mixes.push(t);
                    }
                }
            }
        }
    }

    let mut playlists = Vec::new();
    let pl_query = clean_genre.unwrap_or("electronic underground");
    let pl_url = format!(
        "/playlists?q={}&access=playable&linked_partitioning=true&limit=20",
        url_encode_component(pl_query)
    );
    if let Ok(pl_json) = soundcloud_authed_get(settings, &pl_url) {
        for item in extract_collection_items(&pl_json) {
            if let Some(pl) = map_soundcloud_item_to_playlist(item, "catalog_set") {
                playlists.push(pl);
            }
        }
    }

    Ok(SoundCloudDiscoverResponse {
        tracks,
        mixes,
        playlists,
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

/// Searches the SoundCloud catalog across tracks, 20m+ DJ mixes, playlists/sets, and track radio seeds.
pub fn search_catalog(settings: &SimpSettings, query: &str) -> Result<SoundCloudSearchResults> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(SoundCloudSearchResults {
            tracks: Vec::new(),
            mixes: Vec::new(),
            playlists: Vec::new(),
            stations: Vec::new(),
        });
    }

    let encoded_q = url_encode_component(q);
    let tracks_url = format!(
        "/tracks?q={encoded_q}&access=playable&linked_partitioning=true&limit=40"
    );
    let playlists_url = format!(
        "/playlists?q={encoded_q}&access=playable&linked_partitioning=true&limit=20"
    );

    let mut tracks = Vec::new();
    let mut mixes = Vec::new();
    if let Ok(t_json) = soundcloud_authed_get(settings, &tracks_url) {
        for item in extract_collection_items(&t_json) {
            if let Some(t) = map_soundcloud_item_to_track(item) {
                if t.duration_ms >= 20 * 60 * 1000 {
                    mixes.push(t.clone());
                }
                tracks.push(t);
            }
        }
    }

    let mut playlists = Vec::new();
    if let Ok(p_json) = soundcloud_authed_get(settings, &playlists_url) {
        for item in extract_collection_items(&p_json) {
            if let Some(pl) = map_soundcloud_item_to_playlist(item, "catalog_set") {
                playlists.push(pl);
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

    let mut wf_url = track_hints()
        .lock()
        .ok()
        .and_then(|g| g.get(&track_id).and_then(|e| e.waveform_url.clone()));

    if wf_url.is_none() {
        if let Ok(json) = soundcloud_authed_get(
            settings,
            &format!("/tracks/{}", url_encode_component(&track_id)),
        ) {
            let _ = map_soundcloud_item_to_track(&json);
            wf_url = json
                .get("waveform_url")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string());
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
                    bars = downsample_waveform_samples(samples, 96);
                }
            }
        }
    }

    // Deterministic fallback silhouette if `wis.sndcdn.com` returned a PNG-only asset
    if bars.is_empty() {
        let hash = blake3::hash(track_id.as_bytes());
        let hb = hash.as_bytes();
        bars = (0..96)
            .map(|i| {
                let b1 = hb[i % 32] as f32 / 255.0;
                let b2 = hb[(i * 7 + 3) % 32] as f32 / 255.0;
                let env = ((i as f32 / 96.0) * std::f32::consts::PI).sin().powf(0.35);
                ((0.25 + 0.75 * (0.6 * b1 + 0.4 * b2)) * env).clamp(0.12, 1.0)
            })
            .collect();
    }

    let waveform = SoundCloudWaveform {
        track_id: track_id.clone(),
        bars,
        waveform_url: wf_url,
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
    if vals.is_empty() || target_bars == 0 {
        return Vec::new();
    }
    let max_val = vals
        .iter()
        .copied()
        .fold(1.0f32, |acc, x| if x > acc { x } else { acc })
        .max(1.0);

    let mut out = Vec::with_capacity(target_bars);
    for i in 0..target_bars {
        let start = (i * vals.len()) / target_bars;
        let end = (((i + 1) * vals.len()) / target_bars).max(start + 1).min(vals.len());
        let slice = &vals[start..end];
        let avg = slice.iter().copied().sum::<f32>() / (slice.len() as f32);
        out.push((avg / max_val).clamp(0.08, 1.0));
    }
    out
}

/// Likes (`POST /likes/tracks/{id}`) or unlikes a SoundCloud track on the user's account.
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

        // Verify blocked / preview tracks are filtered out per `access=playable` compliance
        let preview_item = serde_json::json!({
            "id": 111222,
            "kind": "track",
            "access": "preview",
            "title": "Paywalled Preview"
        });
        assert!(map_soundcloud_item_to_track(&preview_item).is_none());
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
        };
        assert_eq!(
            urls.preferred_stream(),
            Some(("https://cf-hls-media.sndcdn.com/playlist_aac160.m3u8", true))
        );
    }
}
