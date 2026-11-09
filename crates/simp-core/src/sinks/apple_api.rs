use crate::sinks::apple::AppleMusicSink;
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

static CACHED_STOREFRONT: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn storefront_cache() -> &'static Mutex<Option<String>> {
    CACHED_STOREFRONT.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleCloudPlaylistSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub art_url: Option<String>,
    pub kind: String, // "library" | "catalog"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleCloudAlbumSummary {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub art_url: Option<String>,
    pub track_count: usize,
    pub release_year: Option<u32>,
    pub kind: String, // "catalog" | "library"
    #[serde(default)]
    pub date_added: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AppleAssetEncryptionKind {
    /// Encrypted fMP4 HLS stream (`28:ctrp256` / `28:ctrp64`) requiring a Widevine CDM license.
    #[default]
    WidevineCenc,
    /// Unencrypted fMP4 HLS `.m3u8` stream (e.g., user-uploaded / iTunes Match Cloud Locker track without `#EXT-X-KEY`).
    ClearHlsFmp4,
    /// Direct unencrypted audio file URL (`.m4a` / `.mp3` / `plus256` / `itemDownload`) from the user's Cloud Locker.
    ClearDirectAudio,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleRadioStationSummary {
    pub id: String,
    pub name: String,
    pub subtitle: String,
    pub art_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleFullAlbumResponse {
    pub album: AppleCloudAlbumSummary,
    pub tracks: Vec<TrackMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleRecommendationShelf {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub playlists: Vec<AppleCloudPlaylistSummary>,
    #[serde(default)]
    pub albums: Vec<AppleCloudAlbumSummary>,
    #[serde(default)]
    pub stations: Vec<AppleRadioStationSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleArtistSummary {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub genre: String,
    pub art_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleArtistProfileResponse {
    pub artist: AppleArtistSummary,
    #[serde(default)]
    pub top_tracks: Vec<TrackMetadata>,
    #[serde(default)]
    pub albums: Vec<AppleCloudAlbumSummary>,
    #[serde(default)]
    pub singles: Vec<AppleCloudAlbumSummary>,
    #[serde(default)]
    pub related_artists: Vec<AppleArtistSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleRadioAndForYouResponse {
    pub stations: Vec<AppleRadioStationSummary>,
    pub playlists: Vec<AppleCloudPlaylistSummary>,
    pub albums: Vec<AppleCloudAlbumSummary>,
    #[serde(default)]
    pub shelves: Vec<AppleRecommendationShelf>,
    #[serde(default)]
    pub recently_played: Vec<TrackMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleNewFeedResponse {
    pub albums: Vec<AppleCloudAlbumSummary>,
    pub playlists: Vec<AppleCloudPlaylistSummary>,
    pub songs: Vec<TrackMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleCatalogSearchResults {
    pub songs: Vec<TrackMetadata>,
    pub albums: Vec<AppleCloudAlbumSummary>,
    pub playlists: Vec<AppleCloudPlaylistSummary>,
    pub stations: Vec<AppleRadioStationSummary>,
    #[serde(default)]
    pub artists: Vec<AppleArtistSummary>,
}

/// Stage C Browserless Foundation: Metadata returned by Apple's `webPlayback` endpoint
/// (`https://play.music.apple.com/WebObjects/MZPlay.woa/wa/webPlayback`) for native Rust HLS + Widevine CDM
/// as well as DRM-free uploaded / iTunes Match Cloud Locker streams.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleWebPlaybackAsset {
    pub song_id: String,
    pub flavor: String,
    pub hls_playlist_url: String,
    pub key_server_url: Option<String>,
    pub key_cert_url: Option<String>,
    #[serde(default)]
    pub encryption_kind: AppleAssetEncryptionKind,
}

pub fn format_apple_art_url(raw_url: Option<&str>, size: u32) -> Option<String> {
    let raw = raw_url?.trim();
    if raw.is_empty() {
        return None;
    }
    Some(
        raw.replace("{w}", &size.to_string())
            .replace("{h}", &size.to_string())
            .replace("{f}", "jpg"),
    )
}

/// Maps an Apple Music API song/library-song JSON object to SIMP's `TrackMetadata`.
/// Automatically prioritizes `relationships.catalog.data[0].id` (from `?include=catalog`)
/// over potentially tombstoned/re-linked `playParams.catalogId`.
pub fn map_apple_item_to_track(item: &Value) -> Option<TrackMetadata> {
    let attrs = item.get("attributes").unwrap_or(item);
    let play_params = attrs
        .get("playParams")
        .or_else(|| item.get("playParams"));

    let rel_catalog_id = item
        .pointer("/relationships/catalog/data/0/id")
        .and_then(|v| v.as_str());
    let param_catalog_id = play_params
        .and_then(|p| p.get("catalogId"))
        .and_then(|v| v.as_str());
    let param_id = play_params
        .and_then(|p| p.get("id"))
        .and_then(|v| v.as_str());
    let item_id = item
        .get("id")
        .or_else(|| attrs.get("id"))
        .and_then(|v| v.as_str());

    let track_id = rel_catalog_id
        .or(param_catalog_id)
        .or(param_id)
        .or(item_id)?
        .trim();
    if track_id.is_empty() {
        return None;
    }

    let title = attrs
        .get("name")
        .or_else(|| attrs.get("title"))
        .or_else(|| item.get("title"))
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown Track")
        .to_string();
    let artist_name = attrs
        .get("artistName")
        .or_else(|| item.get("artistName"))
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown Artist")
        .to_string();
    let album_name = attrs
        .get("albumName")
        .or_else(|| item.get("albumName"))
        .and_then(|v| v.as_str())
        .unwrap_or("Apple Music")
        .to_string();

    let duration_ms = attrs
        .get("durationInMillis")
        .or_else(|| item.get("durationInMillis"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    let rel_catalog_art = item
        .pointer("/relationships/catalog/data/0/attributes/artwork/url")
        .and_then(|v| v.as_str());
    let attr_art = attrs
        .pointer("/artwork/url")
        .or_else(|| item.pointer("/artwork/url"))
        .and_then(|v| v.as_str());
    let raw_art = match (attr_art, rel_catalog_art) {
        (Some(a), Some(c)) if a.contains("blobstore.apple.com") => Some(c),
        (Some(a), _) => Some(a),
        (None, Some(c)) => Some(c),
        (None, None) => None,
    };
    let art_url = format_apple_art_url(raw_art, 400);

    let track_number = attrs
        .get("trackNumber")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    let disc_number = attrs
        .get("discNumber")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .or(Some(1));

    let meta = TrackMetadata {
        uri: format!("applemusic:song:{track_id}"),
        title,
        artists: vec![artist_name],
        album: album_name,
        album_id: None,
        track_number,
        disc_number,
        art_url,
        duration_ms,
        source: "apple_music".to_string(),
        mount_root: None,
    };
    remember_track_metadata_hint(&meta);
    if let Some(raw_item_id) = item_id {
        if raw_item_id != track_id {
            remember_raw_id_metadata_hint(
                raw_item_id,
                &meta.title,
                meta.artists.first().map(|s| s.as_str()).unwrap_or(""),
                meta.art_url.clone(),
            );
        }
    }
    Some(meta)
}

fn resolve_tokens(settings: &SimpSettings) -> Result<(String, String)> {
    let creds = AppleMusicSink::resolve_credentials(settings);
    let dev_token = AppleMusicSink::get_or_sign_developer_token(settings)?;
    let user_token = creds
        .music_user_token
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| anyhow!("Please authorize with your Apple ID first"))?;
    Ok((dev_token, user_token))
}

/// Executes an authenticated `GET` request against `api.music.apple.com` using the in-process
/// `http_pool` (`libcurl.so.4` HTTP/2 connection pool, with `curl --config -` fallback)
/// so TLS/HTTP2 connections are reused across calls and tokens never appear in `/proc/<pid>/cmdline`.
fn apple_get_json(url: &str, dev_token: &str, user_token: &str) -> Result<Value> {
    let full_url = if url.starts_with("https://") {
        url.to_string()
    } else if url.starts_with('/') {
        format!("https://api.music.apple.com{url}")
    } else {
        format!("https://api.music.apple.com/{url}")
    };

    let auth_header = format!("Bearer {}", dev_token.trim());
    let headers = [
        ("Authorization", auth_header.as_str()),
        ("Music-User-Token", user_token.trim()),
        ("X-Apple-Music-User-Token", user_token.trim()),
        ("Origin", "https://music.apple.com"),
        ("Referer", "https://music.apple.com/"),
    ];

    let bytes = crate::http_pool::http_get_bytes(&full_url, &headers, None, 12)
        .with_context(|| format!("Apple Music API GET failed ({full_url})"))?;

    serde_json::from_slice(&bytes).context("Invalid JSON from Apple Music API")
}

/// Executes an authenticated `POST` request with JSON body against Apple Music endpoints
/// using the in-process `http_pool` (`libcurl.so.4` HTTP/2 connection pool).
fn apple_post_json(url: &str, dev_token: &str, user_token: &str, body: &Value) -> Result<Value> {
    let body_bytes = serde_json::to_vec(body)?;
    let auth_header = format!("Bearer {}", dev_token.trim());
    let headers = [
        ("Authorization", auth_header.as_str()),
        ("Music-User-Token", user_token.trim()),
        ("X-Apple-Music-User-Token", user_token.trim()),
        ("Content-Type", "application/json"),
        ("Origin", "https://music.apple.com"),
        ("Referer", "https://music.apple.com/"),
    ];

    let bytes = crate::http_pool::http_post_bytes(url, &headers, &body_bytes, 15)
        .with_context(|| format!("Apple Music API POST failed ({url})"))?;

    serde_json::from_slice(&bytes).context("Invalid JSON from Apple Music POST")
}

pub fn get_storefront(dev_token: &str, user_token: &str) -> String {
    if let Some(cached) = storefront_cache().lock().unwrap().clone() {
        return cached;
    }
    let sf = apple_get_json("/v1/me/storefront", dev_token, user_token)
        .ok()
        .and_then(|j| {
            j.pointer("/data/0/id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "us".to_string());
    *storefront_cache().lock().unwrap() = Some(sf.clone());
    sf
}

pub fn clear_cached_storefront() {
    *storefront_cache().lock().unwrap() = None;
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Ensures Apple Music pagination `next` cursor URLs retain `limit=100` (Apple strips `limit` on page 2+
/// and falls back to `limit=25`, which previously capped 3-page fetches at `100 + 25 + 25 = 150`).
fn with_limit_100(url: &str) -> String {
    if url.contains("limit=") {
        url.to_string()
    } else if url.contains('?') {
        format!("{url}&limit=100")
    } else {
        format!("{url}?limit=100")
    }
}

/// Fetches the user's Apple Music Cloud Playlists in native Rust (up to 2,500 playlists).
/// Requests `?include=catalog` so catalog playlists in the user's library use permanent `mzstatic.com` CDN artwork
/// instead of throttled/expiring `blobstore.apple.com` URLs.
pub fn fetch_cloud_playlists(settings: &SimpSettings) -> Result<Vec<AppleCloudPlaylistSummary>> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let mut next_url: Option<String> =
        Some("/v1/me/library/playlists?include=catalog&limit=100".to_string());
    let mut items = Vec::new();
    let mut seen_ids = HashSet::new();

    for page_idx in 0..25 {
        let Some(ref url) = next_url else { break };
        let json = match apple_get_json(url, &dev_token, &user_token) {
            Ok(j) => j,
            Err(_) if page_idx == 0 && url.contains("include=catalog") => {
                match apple_get_json("/v1/me/library/playlists?limit=100", &dev_token, &user_token)
                {
                    Ok(j) => j,
                    Err(_) => break,
                }
            }
            Err(_) => break,
        };
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for pl in arr {
                let Some(id) = pl.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                if !seen_ids.insert(id.to_string()) {
                    continue;
                }
                let attrs = pl.get("attributes").unwrap_or(pl);
                let name = attrs
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Apple Playlist")
                    .to_string();
                let description = attrs
                    .pointer("/description/standard")
                    .or_else(|| {
                        pl.pointer("/relationships/catalog/data/0/attributes/description/standard")
                    })
                    .and_then(|v| v.as_str())
                    .unwrap_or("iCloud Music Library Playlist")
                    .to_string();
                let rel_catalog_art = pl
                    .pointer("/relationships/catalog/data/0/attributes/artwork/url")
                    .and_then(|v| v.as_str());
                let attr_art = attrs.pointer("/artwork/url").and_then(|v| v.as_str());
                let raw_art = match (attr_art, rel_catalog_art) {
                    (Some(a), Some(c)) if a.contains("blobstore.apple.com") => Some(c),
                    (Some(a), _) => Some(a),
                    (None, Some(c)) => Some(c),
                    (None, None) => None,
                };
                let art_url = format_apple_art_url(raw_art, 300);
                let kind = if id.starts_with("pl.") {
                    "catalog"
                } else {
                    "library"
                }
                .to_string();
                items.push(AppleCloudPlaylistSummary {
                    id: id.to_string(),
                    name,
                    description,
                    art_url,
                    kind,
                });
            }
        }
        next_url = json
            .get("next")
            .and_then(|v| v.as_str())
            .map(with_limit_100);
    }

    Ok(items)
}

/// Resolves a permanent `mzstatic.com` cover artwork URL for an Apple Music playlist that has no playlist-level cover
/// (or whose `blobstore.apple.com` cover was rate-limited/expired) by fetching its first track with `?include=catalog&limit=1`.
pub fn fetch_playlist_cover_art(
    settings: &SimpSettings,
    playlist_id: &str,
    kind: Option<&str>,
) -> Option<String> {
    let (dev_token, user_token) = resolve_tokens(settings).ok()?;
    let storefront = get_storefront(&dev_token, &user_token);
    let clean_id = playlist_id
        .strip_prefix("applemusic:playlist:")
        .unwrap_or(playlist_id)
        .trim();
    if clean_id.is_empty() {
        return None;
    }
    let is_catalog = kind == Some("catalog") || clean_id.starts_with("pl.");
    let url = if is_catalog {
        format!(
            "/v1/catalog/{}/playlists/{}/tracks?limit=1",
            storefront,
            urlencode(clean_id)
        )
    } else {
        format!(
            "/v1/me/library/playlists/{}/tracks?include=catalog&limit=1",
            urlencode(clean_id)
        )
    };
    let json = apple_get_json(&url, &dev_token, &user_token).ok()?;
    let first_item = json.pointer("/data/0")?;
    let track = map_apple_item_to_track(first_item)?;
    track.art_url
}

/// Fetches all tracks for a library (`p.xxxx`) or catalog (`pl.xxxx`) playlist in native Rust,
/// automatically requesting `?include=catalog` so re-linked/moved cloud tracks resolve to their active catalog ID.
pub fn fetch_playlist_tracks(
    settings: &SimpSettings,
    playlist_id: &str,
    kind: Option<&str>,
) -> Result<Vec<TrackMetadata>> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);
    let clean_id = playlist_id
        .strip_prefix("applemusic:playlist:")
        .unwrap_or(playlist_id);
    let is_catalog = kind == Some("catalog") || clean_id.starts_with("pl.");

    let mut next_url: Option<String> = Some(if is_catalog {
        format!(
            "/v1/catalog/{}/playlists/{}/tracks?limit=100",
            storefront,
            urlencode(clean_id)
        )
    } else {
        format!(
            "/v1/me/library/playlists/{}/tracks?include=catalog&limit=100",
            urlencode(clean_id)
        )
    });

    let mut tracks = Vec::new();
    for _ in 0..10 {
        let Some(ref url) = next_url else { break };
        let Ok(json) = apple_get_json(url, &dev_token, &user_token) else {
            break;
        };
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(tr) = map_apple_item_to_track(item) {
                    tracks.push(tr);
                }
            }
        }
        next_url = json
            .get("next")
            .and_then(|v| v.as_str())
            .map(with_limit_100);
    }

    Ok(tracks)
}

/// Helper to parse a `library-albums` or `albums` JSON item into `AppleCloudAlbumSummary`,
/// automatically healing `blobstore.apple.com` artwork with `relationships.catalog.data[0]` when present.
fn parse_apple_album_summary(alb: &Value, default_kind: &str) -> Option<AppleCloudAlbumSummary> {
    let id = alb.get("id")?.as_str()?.trim();
    if id.is_empty() {
        return None;
    }
    let attrs = alb.get("attributes").unwrap_or(alb);
    let rel_catalog_art = alb
        .pointer("/relationships/catalog/data/0/attributes/artwork/url")
        .and_then(|v| v.as_str());
    let attr_art = attrs.pointer("/artwork/url").and_then(|v| v.as_str());
    let raw_art = match (attr_art, rel_catalog_art) {
        (Some(a), Some(c)) if a.contains("blobstore.apple.com") => Some(c),
        (Some(a), _) => Some(a),
        (None, Some(c)) => Some(c),
        (None, None) => None,
    };
    let release_year = attrs
        .get("releaseDate")
        .or_else(|| {
            alb.pointer("/relationships/catalog/data/0/attributes/releaseDate")
        })
        .and_then(|v| v.as_str())
        .and_then(|s| s.get(0..4))
        .and_then(|y| y.parse::<u32>().ok());
    let date_added = attrs
        .get("dateAdded")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let kind = if id.starts_with("l.") {
        "library"
    } else if id.chars().all(|c| c.is_ascii_digit()) {
        "catalog"
    } else {
        default_kind
    }
    .to_string();

    Some(AppleCloudAlbumSummary {
        id: id.to_string(),
        title: attrs
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Album")
            .to_string(),
        artist: attrs
            .get("artistName")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Artist")
            .to_string(),
        art_url: format_apple_art_url(raw_art, 300),
        track_count: attrs
            .get("trackCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize,
        release_year,
        kind,
        date_added,
    })
}

/// Fetches a personal Cloud Library Album (`l.xxxx`) and all of its tracks from `/v1/me/library/albums/{id}`.
fn fetch_library_album_with_tracks(
    dev_token: &str,
    user_token: &str,
    lib_album_id: &str,
) -> Result<AppleFullAlbumResponse> {
    let alb_json = apple_get_json(
        &format!(
            "/v1/me/library/albums/{}?include=tracks,catalog",
            urlencode(lib_album_id)
        ),
        dev_token,
        user_token,
    )
    .or_else(|_| {
        apple_get_json(
            &format!("/v1/me/library/albums/{}?include=tracks", urlencode(lib_album_id)),
            dev_token,
            user_token,
        )
    })?;

    let alb_data = alb_json
        .pointer("/data/0")
        .ok_or_else(|| anyhow!("Library album {lib_album_id} not found in Your Library"))?;
    let mut summary = parse_apple_album_summary(alb_data, "library")
        .ok_or_else(|| anyhow!("Invalid library album payload for {lib_album_id}"))?;
    if let Some(ref art) = summary.art_url {
        summary.art_url = Some(art.replace("300x300bb", "400x400bb"));
    }

    let mut tracks: Vec<TrackMetadata> = alb_data
        .pointer("/relationships/tracks/data")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(map_apple_item_to_track).collect())
        .unwrap_or_default();

    let has_more_tracks = alb_data
        .pointer("/relationships/tracks/next")
        .and_then(|v| v.as_str())
        .is_some()
        || (summary.track_count > tracks.len() && summary.track_count > 0);

    if tracks.is_empty() || has_more_tracks {
        let mut next_url: Option<String> = Some(format!(
            "/v1/me/library/albums/{}/tracks?include=catalog&limit=100",
            urlencode(lib_album_id)
        ));
        let mut paginated = Vec::new();
        for page_idx in 0..6 {
            let Some(ref url) = next_url else { break };
            let page_json = match apple_get_json(url, dev_token, user_token) {
                Ok(j) => j,
                Err(_) if page_idx == 0 && url.contains("include=catalog") => {
                    match apple_get_json(
                        &format!("/v1/me/library/albums/{}/tracks?limit=100", urlencode(lib_album_id)),
                        dev_token,
                        user_token,
                    ) {
                        Ok(j) => j,
                        Err(_) => break,
                    }
                }
                Err(_) => break,
            };
            if let Some(arr) = page_json.get("data").and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(tr) = map_apple_item_to_track(item) {
                        paginated.push(tr);
                    }
                }
            }
            next_url = page_json
                .get("next")
                .and_then(|v| v.as_str())
                .map(with_limit_100);
        }
        if paginated.len() >= tracks.len() {
            tracks = paginated;
        }
    }

    // Heal any missing or expiring blobstore track artwork with the album's cover art
    if summary.art_url.is_none()
        || summary
            .art_url
            .as_deref()
            .map(|u| u.contains("blobstore.apple.com"))
            .unwrap_or(false)
    {
        if let Some(track_mz_art) = tracks
            .iter()
            .find_map(|t| t.art_url.as_ref().filter(|u| u.contains("mzstatic.com")))
            .cloned()
        {
            summary.art_url = Some(track_mz_art);
        } else if summary.art_url.is_none() {
            summary.art_url = tracks.first().and_then(|t| t.art_url.clone());
        }
    }
    if let Some(ref album_art) = summary.art_url {
        for tr in &mut tracks {
            let needs_art = tr
                .art_url
                .as_deref()
                .map(|u| u.is_empty() || (u.contains("blobstore.apple.com") && album_art.contains("mzstatic.com")))
                .unwrap_or(true);
            if needs_art {
                tr.art_url = Some(album_art.clone());
                remember_track_metadata_hint(tr);
            }
        }
    }
    if !tracks.is_empty() {
        summary.track_count = tracks.len();
    }

    Ok(AppleFullAlbumResponse {
        album: summary,
        tracks,
    })
}

/// Resolves a full Apple Music Catalog Album or Personal Cloud Library Album (`l.xxxx`)
/// from a catalog album ID, library album ID (`l.xxxx`), or song URI.
pub fn fetch_full_album(
    settings: &SimpSettings,
    album_id: Option<&str>,
    song_uri: Option<&str>,
) -> Result<AppleFullAlbumResponse> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);

    let mut catalog_album_id: Option<String> = None;
    let mut library_album_id: Option<String> = None;

    if let Some(raw_alb) = album_id.filter(|s| !s.trim().is_empty()) {
        let clean_alb = raw_alb
            .strip_prefix("applemusic:album:")
            .unwrap_or(raw_alb)
            .trim();
        if clean_alb.starts_with("l.") {
            library_album_id = Some(clean_alb.to_string());
            if let Ok(json) = apple_get_json(
                &format!("/v1/me/library/albums/{}/catalog", urlencode(clean_alb)),
                &dev_token,
                &user_token,
            ) {
                catalog_album_id = json
                    .pointer("/data/0/id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        } else {
            catalog_album_id = Some(clean_alb.to_string());
        }
    }

    if catalog_album_id.is_none() && library_album_id.is_none() {
        if let Some(raw_song) = song_uri.filter(|s| !s.trim().is_empty()) {
            let clean_song = raw_song
                .strip_prefix("applemusic:song:")
                .or_else(|| raw_song.strip_prefix("applemusic:track:"))
                .or_else(|| raw_song.strip_prefix("applemusic:"))
                .unwrap_or(raw_song)
                .trim();
            if clean_song.starts_with("i.") {
                if let Ok(json) = apple_get_json(
                    &format!(
                        "/v1/me/library/songs/{}/catalog?include=albums",
                        urlencode(clean_song)
                    ),
                    &dev_token,
                    &user_token,
                ) {
                    catalog_album_id = json
                        .pointer("/data/0/relationships/albums/data/0/id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
                if catalog_album_id.is_none() {
                    if let Ok(json) = apple_get_json(
                        &format!("/v1/me/library/songs/{}/albums", urlencode(clean_song)),
                        &dev_token,
                        &user_token,
                    ) {
                        library_album_id = json
                            .pointer("/data/0/id")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                    }
                }
            } else if let Ok(json) = apple_get_json(
                &format!(
                    "/v1/catalog/{}/songs/{}?include=albums",
                    storefront,
                    urlencode(clean_song)
                ),
                &dev_token,
                &user_token,
            ) {
                catalog_album_id = json
                    .pointer("/data/0/relationships/albums/data/0/id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }
    }

    // If this is a personal Cloud Library album (`l.xxxx`) that is NOT in the public streaming catalog
    // (e.g., an uploaded vinyl download, Bandcamp purchase, or delisted release), resolve directly from `/v1/me/library/albums/{id}`!
    if let Some(ref lib_id) = library_album_id {
        if catalog_album_id.is_none() {
            return fetch_library_album_with_tracks(&dev_token, &user_token, lib_id);
        }
    }

    let Some(cat_id) = catalog_album_id else {
        return Err(anyhow!(
            "Could not resolve full album on Apple Music Catalog or Your Library"
        ));
    };

    let alb_json = match apple_get_json(
        &format!(
            "/v1/catalog/{}/albums/{}?include=tracks",
            storefront,
            urlencode(&cat_id)
        ),
        &dev_token,
        &user_token,
    ) {
        Ok(j) => j,
        Err(e) => {
            if let Some(ref lib_id) = library_album_id {
                return fetch_library_album_with_tracks(&dev_token, &user_token, lib_id);
            }
            return Err(e);
        }
    };

    let alb_data = alb_json
        .pointer("/data/0")
        .ok_or_else(|| anyhow!("Catalog album not found"))?;
    let attrs = alb_data.get("attributes").unwrap_or(alb_data);
    let tracks: Vec<TrackMetadata> = alb_data
        .pointer("/relationships/tracks/data")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(map_apple_item_to_track).collect())
        .unwrap_or_default();

    let release_year = attrs
        .get("releaseDate")
        .and_then(|v| v.as_str())
        .and_then(|s| s.get(0..4))
        .and_then(|y| y.parse::<u32>().ok());

    let art_url = format_apple_art_url(
        attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
        400,
    )
    .or_else(|| tracks.first().and_then(|t| t.art_url.clone()));

    let track_count = if !tracks.is_empty() {
        tracks.len()
    } else {
        attrs
            .get("trackCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize
    };

    let album = AppleCloudAlbumSummary {
        id: alb_data
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or(&cat_id)
            .to_string(),
        title: attrs
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Apple Music Album")
            .to_string(),
        artist: attrs
            .get("artistName")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Artist")
            .to_string(),
        art_url,
        track_count,
        release_year,
        kind: "catalog".to_string(),
        date_added: None,
    };

    Ok(AppleFullAlbumResponse { album, tracks })
}

/// Live Apple Music Dual-Scope Search (`"Your Library"` `/v1/me/library/search` + `"Apple Music Catalog"` `/v1/catalog/{storefront}/search`).
/// Personal Cloud Library matches (`library-albums`, `library-playlists`, `library-songs`) are placed first so uploaded/matched
/// releases (such as vinyl companion digital downloads not in the streaming catalog) are immediately discoverable.
pub fn search_catalog(settings: &SimpSettings, term: &str) -> Result<AppleCatalogSearchResults> {
    let cleaned = term.trim();
    if cleaned.is_empty() {
        return Ok(AppleCatalogSearchResults {
            songs: Vec::new(),
            albums: Vec::new(),
            playlists: Vec::new(),
            stations: Vec::new(),
            artists: Vec::new(),
        });
    }

    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);
    let encoded_term = urlencode(cleaned);

    let catalog_url = format!(
        "/v1/catalog/{}/search?term={}&types=songs,albums,playlists,stations,artists&limit=15",
        storefront, encoded_term
    );
    let library_url = format!(
        "/v1/me/library/search?term={}&types=library-albums,library-songs,library-playlists&limit=20",
        encoded_term
    );

    let (lib_res, cat_res) = std::thread::scope(|s| {
        let d1 = &dev_token;
        let u1 = &user_token;
        let l_url = &library_url;
        let lib_handle = s.spawn(move || apple_get_json(l_url, d1, u1));

        let d2 = &dev_token;
        let u2 = &user_token;
        let c_url = &catalog_url;
        let cat_handle = s.spawn(move || apple_get_json(c_url, d2, u2));

        (lib_handle.join().ok(), cat_handle.join().ok())
    });

    let mut songs: Vec<TrackMetadata> = Vec::new();
    let mut albums: Vec<AppleCloudAlbumSummary> = Vec::new();
    let mut playlists: Vec<AppleCloudPlaylistSummary> = Vec::new();
    let mut stations: Vec<AppleRadioStationSummary> = Vec::new();
    let mut artists: Vec<AppleArtistSummary> = Vec::new();

    let mut seen_song_uris = HashSet::new();
    let mut seen_album_ids = HashSet::new();
    let mut seen_playlist_ids = HashSet::new();
    let mut seen_artist_ids = HashSet::new();

    // 1. Parse Personal Cloud Library ("Your Library") matches first
    if let Some(Ok(lib_json)) = lib_res {
        let lib_results = lib_json.get("results").unwrap_or(&lib_json);

        if let Some(arr) = lib_results
            .pointer("/library-albums/data")
            .and_then(|v| v.as_array())
        {
            for alb in arr {
                if let Some(summary) = parse_apple_album_summary(alb, "library") {
                    if seen_album_ids.insert(summary.id.clone()) {
                        albums.push(summary);
                    }
                }
            }
        }

        if let Some(arr) = lib_results
            .pointer("/library-playlists/data")
            .and_then(|v| v.as_array())
        {
            for pl in arr {
                let Some(id) = pl.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                if !seen_playlist_ids.insert(id.to_string()) {
                    continue;
                }
                let attrs = pl.get("attributes").unwrap_or(pl);
                playlists.push(AppleCloudPlaylistSummary {
                    id: id.to_string(),
                    name: attrs
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Library Playlist")
                        .to_string(),
                    description: attrs
                        .pointer("/description/standard")
                        .and_then(|v| v.as_str())
                        .unwrap_or("☁️ In Your Library")
                        .to_string(),
                    art_url: format_apple_art_url(
                        attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                        300,
                    ),
                    kind: "library".to_string(),
                });
            }
        }

        if let Some(arr) = lib_results
            .pointer("/library-songs/data")
            .and_then(|v| v.as_array())
        {
            for item in arr {
                if let Some(mut tr) = map_apple_item_to_track(item) {
                    if !tr.album.starts_with("☁️ ") && tr.uri.contains(":i.") {
                        tr.album = format!("☁️ {}", tr.album);
                    }
                    if seen_song_uris.insert(tr.uri.clone()) {
                        songs.push(tr);
                    }
                }
            }
        }
    }

    // 2. Parse Public Storefront Catalog matches & heal any blobstore artwork on matching Library Albums
    if let Some(Ok(json)) = cat_res {
        let results = json.get("results").unwrap_or(&json);

        if let Some(arr) = results.pointer("/artists/data").and_then(|v| v.as_array()) {
            for art_item in arr {
                let Some(id) = art_item.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                if !seen_artist_ids.insert(id.to_string()) {
                    continue;
                }
                let attrs = art_item.get("attributes").unwrap_or(art_item);
                let name = attrs
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Artist")
                    .to_string();
                let genre = attrs
                    .pointer("/genreNames/0")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Apple Music Artist")
                    .to_string();
                let art_url = format_apple_art_url(
                    attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                    300,
                );
                artists.push(AppleArtistSummary {
                    id: id.to_string(),
                    name,
                    genre,
                    art_url,
                });
            }
        }

        if let Some(arr) = results.pointer("/albums/data").and_then(|v| v.as_array()) {
            for alb in arr {
                let Some(cat_alb) = parse_apple_album_summary(alb, "catalog") else {
                    continue;
                };
                let cat_title_lower = cat_alb.title.trim().to_lowercase();
                let cat_artist_lower = cat_alb.artist.trim().to_lowercase();

                if let Some(existing_lib) = albums.iter_mut().find(|a| {
                    a.kind == "library"
                        && a.title.trim().to_lowercase() == cat_title_lower
                        && a.artist.trim().to_lowercase() == cat_artist_lower
                }) {
                    let lib_needs_art = existing_lib
                        .art_url
                        .as_deref()
                        .map(|u| u.is_empty() || u.contains("blobstore.apple.com"))
                        .unwrap_or(true);
                    if lib_needs_art && cat_alb.art_url.is_some() {
                        existing_lib.art_url = cat_alb.art_url.clone();
                    }
                    if existing_lib.release_year.is_none() {
                        existing_lib.release_year = cat_alb.release_year;
                    }
                    // If the user's library album is only a partial stub (fewer tracks than the full catalog album),
                    // also include the full catalog album so the user can open either!
                    if existing_lib.track_count >= cat_alb.track_count && existing_lib.track_count > 0 {
                        continue;
                    }
                }

                if seen_album_ids.insert(cat_alb.id.clone()) {
                    albums.push(cat_alb);
                }
            }
        }

        if let Some(arr) = results
            .pointer("/playlists/data")
            .and_then(|v| v.as_array())
        {
            for pl in arr {
                let Some(id) = pl.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                if !seen_playlist_ids.insert(id.to_string()) {
                    continue;
                }
                let attrs = pl.get("attributes").unwrap_or(pl);
                playlists.push(AppleCloudPlaylistSummary {
                    id: id.to_string(),
                    name: attrs
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Playlist")
                        .to_string(),
                    description: attrs
                        .get("curatorName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Apple Music Playlist")
                        .to_string(),
                    art_url: format_apple_art_url(
                        attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                        300,
                    ),
                    kind: "catalog".to_string(),
                });
            }
        }

        if let Some(arr) = results.pointer("/stations/data").and_then(|v| v.as_array()) {
            for st in arr {
                let Some(id) = st.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                let attrs = st.get("attributes").unwrap_or(st);
                stations.push(AppleRadioStationSummary {
                    id: id.to_string(),
                    name: attrs
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Station")
                        .to_string(),
                    subtitle: attrs
                        .pointer("/editorialNotes/short")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Apple Music Radio")
                        .to_string(),
                    art_url: format_apple_art_url(
                        attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                        300,
                    ),
                });
            }
        }

        if let Some(arr) = results.pointer("/songs/data").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(tr) = map_apple_item_to_track(item) {
                    if seen_song_uris.insert(tr.uri.clone()) {
                        songs.push(tr);
                    }
                }
            }
        }
    }

    Ok(AppleCatalogSearchResults {
        songs,
        albums,
        playlists,
        stations,
        artists,
    })
}

/// Fetches the user's "Recently Added" personal Cloud Library albums (`/v1/me/library/recently-added?include=catalog&limit=25`
/// + `/v1/me/library/albums?include=catalog&limit=50`), automatically filtering out 1-track single-song playlist stubs
/// when full (`2+` track) albums are present.
pub fn fetch_library_recently_added(settings: &SimpSettings) -> Result<Vec<AppleCloudAlbumSummary>> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let mut raw_albums = Vec::new();
    let mut seen_ids = HashSet::new();

    for url in [
        "/v1/me/library/recently-added?include=catalog&limit=25",
        "/v1/me/library/recently-added?include=catalog&offset=25&limit=25",
    ] {
        let json = match apple_get_json(url, &dev_token, &user_token) {
            Ok(j) => j,
            Err(_) => {
                let fallback = url.replace("include=catalog&", "");
                match apple_get_json(&fallback, &dev_token, &user_token) {
                    Ok(j) => j,
                    Err(_) => break,
                }
            }
        };
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            if arr.is_empty() {
                break;
            }
            for item in arr {
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if item_type == "library-albums" || item_type == "albums" {
                    if let Some(alb) = parse_apple_album_summary(item, "library") {
                        if seen_ids.insert(alb.id.clone()) {
                            raw_albums.push(alb);
                        }
                    }
                }
            }
        }
    }

    let full_albums: Vec<AppleCloudAlbumSummary> = raw_albums
        .iter()
        .filter(|a| a.track_count >= 2)
        .cloned()
        .collect();

    if !full_albums.is_empty() {
        Ok(full_albums)
    } else {
        Ok(raw_albums)
    }
}

/// Fetches Radio & For You recommendations in native Rust.
pub fn fetch_radio_and_for_you(settings: &SimpSettings) -> Result<AppleRadioAndForYouResponse> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);

    let mut stations = Vec::new();
    let mut playlists = Vec::new();
    let mut albums = Vec::new();
    let mut seen_stations = HashSet::new();
    let mut seen_playlists = HashSet::new();
    let mut seen_albums = HashSet::new();

    fn push_station_to(
        stations: &mut Vec<AppleRadioStationSummary>,
        seen_stations: &mut HashSet<String>,
        st: &Value,
        fallback_sub: &str,
    ) {
        let Some(id) = st.get("id").and_then(|v| v.as_str()) else {
            return;
        };
        if !seen_stations.insert(id.to_string()) {
            return;
        }
        let attrs = st.get("attributes").unwrap_or(st);
        stations.push(AppleRadioStationSummary {
            id: id.to_string(),
            name: attrs
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Radio Station")
                .to_string(),
            subtitle: attrs
                .pointer("/editorialNotes/short")
                .and_then(|v| v.as_str())
                .unwrap_or(fallback_sub)
                .to_string(),
            art_url: format_apple_art_url(
                attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                300,
            ),
        });
    }

    let mut push_item = |item: &Value,
                         group_title: &str,
                         stations: &mut Vec<AppleRadioStationSummary>,
                         seen_stations: &mut HashSet<String>| {
        let Some(id) = item.get("id").and_then(|v| v.as_str()) else {
            return;
        };
        let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let attrs = item.get("attributes").unwrap_or(item);
        match item_type {
            "stations" => push_station_to(
                stations,
                seen_stations,
                item,
                if group_title.is_empty() {
                    "Personal Station"
                } else {
                    group_title
                },
            ),
            "playlists" | "library-playlists" => {
                if !seen_playlists.insert(id.to_string()) {
                    return;
                }
                playlists.push(AppleCloudPlaylistSummary {
                    id: id.to_string(),
                    name: attrs
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Mix")
                        .to_string(),
                    description: attrs
                        .get("curatorName")
                        .and_then(|v| v.as_str())
                        .unwrap_or(if group_title.is_empty() { "Made For You" } else { group_title })
                        .to_string(),
                    art_url: format_apple_art_url(
                        attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                        300,
                    ),
                    kind: if id.starts_with("pl.") { "catalog" } else { "library" }.to_string(),
                });
            }
            "albums" | "library-albums" => {
                if !seen_albums.insert(id.to_string()) {
                    return;
                }
                if let Some(alb) = parse_apple_album_summary(
                    item,
                    if id.starts_with("l.") { "library" } else { "catalog" },
                ) {
                    albums.push(alb);
                }
            }
            _ => {}
        }
    };

    let mut shelves: Vec<AppleRecommendationShelf> = Vec::new();
    let mut recently_played: Vec<TrackMetadata> = Vec::new();

    if let Ok(json) = apple_get_json("/v1/me/recent/radio-stations?limit=12", &dev_token, &user_token) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for st in arr {
                push_station_to(&mut stations, &mut seen_stations, st, "Recent Radio Station");
            }
        }
    }
    if let Ok(json) = apple_get_json("/v1/me/history/heavy-rotation?limit=15", &dev_token, &user_token) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            let mut heavy_shelf = AppleRecommendationShelf {
                id: "heavy-rotation".to_string(),
                title: "Heavy Rotation".to_string(),
                playlists: Vec::new(),
                albums: Vec::new(),
                stations: Vec::new(),
            };
            let mut shelf_seen_stations = HashSet::new();
            for item in arr {
                push_item(item, "Heavy Rotation", &mut stations, &mut seen_stations);
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let attrs = item.get("attributes").unwrap_or(item);
                let Some(id) = item.get("id").and_then(|v| v.as_str()) else { continue };
                match item_type {
                    "stations" => push_station_to(
                        &mut heavy_shelf.stations,
                        &mut shelf_seen_stations,
                        item,
                        "Heavy Rotation",
                    ),
                    "playlists" | "library-playlists" => {
                        heavy_shelf.playlists.push(AppleCloudPlaylistSummary {
                            id: id.to_string(),
                            name: attrs.get("name").and_then(|v| v.as_str()).unwrap_or("Mix").to_string(),
                            description: attrs.get("curatorName").and_then(|v| v.as_str()).unwrap_or("Heavy Rotation").to_string(),
                            art_url: format_apple_art_url(attrs.pointer("/artwork/url").and_then(|v| v.as_str()), 300),
                            kind: if id.starts_with("pl.") { "catalog" } else { "library" }.to_string(),
                        });
                    }
                    "albums" | "library-albums" => {
                        if let Some(alb) = parse_apple_album_summary(
                            item,
                            if id.starts_with("l.") { "library" } else { "catalog" },
                        ) {
                            heavy_shelf.albums.push(alb);
                        }
                    }
                    _ => {}
                }
            }
            if !heavy_shelf.playlists.is_empty()
                || !heavy_shelf.albums.is_empty()
                || !heavy_shelf.stations.is_empty()
            {
                shelves.push(heavy_shelf);
            }
        }
    }
    if let Ok(json) = apple_get_json("/v1/me/recommendations?limit=10", &dev_token, &user_token) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for (idx, rec) in arr.iter().enumerate() {
                let rec_id = rec
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("rec-{idx}"));
                let title = rec
                    .pointer("/attributes/title/stringForDisplay")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Made For You");
                let mut shelf = AppleRecommendationShelf {
                    id: rec_id,
                    title: title.to_string(),
                    playlists: Vec::new(),
                    albums: Vec::new(),
                    stations: Vec::new(),
                };
                let mut shelf_seen_stations = HashSet::new();
                if let Some(contents) = rec
                    .pointer("/relationships/contents/data")
                    .and_then(|v| v.as_array())
                {
                    for item in contents {
                        push_item(item, title, &mut stations, &mut seen_stations);
                        let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        let attrs = item.get("attributes").unwrap_or(item);
                        let Some(id) = item.get("id").and_then(|v| v.as_str()) else { continue };
                        match item_type {
                            "stations" => push_station_to(
                                &mut shelf.stations,
                                &mut shelf_seen_stations,
                                item,
                                title,
                            ),
                            "playlists" | "library-playlists" => {
                                shelf.playlists.push(AppleCloudPlaylistSummary {
                                    id: id.to_string(),
                                    name: attrs.get("name").and_then(|v| v.as_str()).unwrap_or("Mix").to_string(),
                                    description: attrs.get("curatorName").and_then(|v| v.as_str()).unwrap_or(title).to_string(),
                                    art_url: format_apple_art_url(attrs.pointer("/artwork/url").and_then(|v| v.as_str()), 300),
                                    kind: if id.starts_with("pl.") { "catalog" } else { "library" }.to_string(),
                                });
                            }
                            "albums" | "library-albums" => {
                                if let Some(alb) = parse_apple_album_summary(
                                    item,
                                    if id.starts_with("l.") { "library" } else { "catalog" },
                                ) {
                                    shelf.albums.push(alb);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                if !shelf.playlists.is_empty()
                    || !shelf.albums.is_empty()
                    || !shelf.stations.is_empty()
                {
                    shelves.push(shelf);
                }
            }
        }
    }
    if let Ok(json) = apple_get_json("/v1/me/recent/played/tracks?limit=20", &dev_token, &user_token) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            let mut seen_recent = HashSet::new();
            for item in arr {
                if let Some(tr) = map_apple_item_to_track(item) {
                    if seen_recent.insert(tr.uri.clone()) {
                        recently_played.push(tr);
                    }
                }
            }
        }
    }
    if let Ok(json) = apple_get_json(
        &format!("/v1/catalog/{storefront}/stations?filter[featured]=apple-music-live-radio"),
        &dev_token,
        &user_token,
    ) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for st in arr {
                push_station_to(&mut stations, &mut seen_stations, st, "Live Global Radio");
            }
        }
    }

    Ok(AppleRadioAndForYouResponse {
        stations,
        playlists,
        albums,
        shelves,
        recently_played,
    })
}

/// Sets or clears a user's Apple Music Favorite/Love rating (`PUT` or `DELETE` `/v1/me/ratings/{kind}/{id}`).
/// Kept strictly separate from `add_to_apple_cloud_library` per Item #4.
pub fn set_apple_item_rating(
    settings: &SimpSettings,
    item_id_or_uri: &str,
    item_kind: &str,
    favorited: bool,
) -> Result<()> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let clean_id = item_id_or_uri
        .strip_prefix("applemusic:song:")
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:track:"))
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:album:"))
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:playlist:"))
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:"))
        .unwrap_or(item_id_or_uri)
        .trim();
    if clean_id.is_empty() {
        return Err(anyhow!("Missing Apple Music item ID for rating"));
    }

    let endpoint_kind = match item_kind.trim().to_ascii_lowercase().as_str() {
        "album" | "albums" => {
            if clean_id.starts_with("l.") {
                "library-albums"
            } else {
                "albums"
            }
        }
        "playlist" | "playlists" => {
            if clean_id.starts_with("p.") {
                "library-playlists"
            } else {
                "playlists"
            }
        }
        _ => {
            if clean_id.starts_with("i.") {
                "library-songs"
            } else {
                "songs"
            }
        }
    };

    let url = format!(
        "https://api.music.apple.com/v1/me/ratings/{}/{}",
        endpoint_kind,
        urlencode(clean_id)
    );
    let auth_header = format!("Bearer {}", dev_token.trim());
    let headers = [
        ("Authorization", auth_header.as_str()),
        ("Music-User-Token", user_token.trim()),
        ("X-Apple-Music-User-Token", user_token.trim()),
        ("Content-Type", "application/json"),
        ("Origin", "https://music.apple.com"),
        ("Referer", "https://music.apple.com/"),
    ];

    if favorited {
        let body = serde_json::json!({
            "type": "ratings",
            "attributes": {
                "value": 1
            }
        });
        let body_bytes = serde_json::to_vec(&body)?;
        crate::http_pool::http_custom_bytes("PUT", &url, &headers, Some(&body_bytes), 12)
            .with_context(|| format!("Failed to favorite Apple Music item {clean_id}"))?;
    } else {
        crate::http_pool::http_custom_bytes("DELETE", &url, &headers, None, 12)
            .with_context(|| format!("Failed to remove Apple Music rating for {clean_id}"))?;
    }
    Ok(())
}

/// Adds a catalog song, album, or playlist to the user's personal Apple Music Cloud Library
/// (`POST /v1/me/library?ids[{songs|albums|playlists}]={id}`).
/// Kept strictly separate from `set_apple_item_rating` (`♥ Favorite`) per Item #4.
pub fn add_to_apple_cloud_library(
    settings: &SimpSettings,
    item_id_or_uri: &str,
    item_kind: &str,
) -> Result<()> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let clean_id = item_id_or_uri
        .strip_prefix("applemusic:song:")
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:track:"))
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:album:"))
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:playlist:"))
        .or_else(|| item_id_or_uri.strip_prefix("applemusic:"))
        .unwrap_or(item_id_or_uri)
        .trim();
    if clean_id.is_empty() {
        return Err(anyhow!("Missing Apple Music catalog ID to add to library"));
    }

    let query_type = match item_kind.trim().to_ascii_lowercase().as_str() {
        "album" | "albums" => "albums",
        "playlist" | "playlists" => "playlists",
        _ => "songs",
    };

    let url = format!(
        "https://api.music.apple.com/v1/me/library?ids[{}]={}",
        query_type,
        urlencode(clean_id)
    );
    let auth_header = format!("Bearer {}", dev_token.trim());
    let headers = [
        ("Authorization", auth_header.as_str()),
        ("Music-User-Token", user_token.trim()),
        ("X-Apple-Music-User-Token", user_token.trim()),
        ("Origin", "https://music.apple.com"),
        ("Referer", "https://music.apple.com/"),
    ];

    crate::http_pool::http_custom_bytes("POST", &url, &headers, Some(b""), 15)
        .with_context(|| format!("Failed to add {clean_id} to Apple Music Cloud Library"))?;
    Ok(())
}

/// Resolves an Apple Music Artist Profile (`Top Tracks`, `Albums`, `Singles & EPs`, and `Related Artists`)
/// by catalog artist ID or artist name (`name:<artist>`).
pub fn fetch_apple_artist_profile(
    settings: &SimpSettings,
    artist_id_or_name: &str,
) -> Result<AppleArtistProfileResponse> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);
    let raw = artist_id_or_name
        .strip_prefix("applemusic:artist:")
        .unwrap_or(artist_id_or_name)
        .trim();
    if raw.is_empty() {
        return Err(anyhow!("Missing Apple Music artist ID or name"));
    }

    let resolved_id = if let Some(name_query) = raw.strip_prefix("name:") {
        let q = name_query.trim();
        let search_json = apple_get_json(
            &format!(
                "/v1/catalog/{storefront}/search?term={}&types=artists&limit=5",
                urlencode(q)
            ),
            &dev_token,
            &user_token,
        )?;
        let q_lower = q.to_lowercase();
        let arr = search_json
            .pointer("/results/artists/data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow!("No Apple Music artist found matching '{q}'"))?;
        arr.iter()
            .find(|a| {
                a.pointer("/attributes/name")
                    .and_then(|v| v.as_str())
                    .map(|n| n.trim().to_lowercase() == q_lower)
                    .unwrap_or(false)
            })
            .or_else(|| arr.first())
            .and_then(|a| a.get("id").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("No Apple Music artist found matching '{q}'"))?
    } else if raw.chars().all(|c| c.is_ascii_digit()) {
        raw.to_string()
    } else {
        let search_json = apple_get_json(
            &format!(
                "/v1/catalog/{storefront}/search?term={}&types=artists&limit=5",
                urlencode(raw)
            ),
            &dev_token,
            &user_token,
        )?;
        let raw_lower = raw.to_lowercase();
        let arr = search_json
            .pointer("/results/artists/data")
            .and_then(|v| v.as_array())
            .ok_or_else(|| anyhow!("No Apple Music artist found matching '{raw}'"))?;
        arr.iter()
            .find(|a| {
                a.pointer("/attributes/name")
                    .and_then(|v| v.as_str())
                    .map(|n| n.trim().to_lowercase() == raw_lower)
                    .unwrap_or(false)
            })
            .or_else(|| arr.first())
            .and_then(|a| a.get("id").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("No Apple Music artist found matching '{raw}'"))?
    };

    let artist_json = apple_get_json(
        &format!(
            "/v1/catalog/{storefront}/artists/{}?views=top-songs,full-albums,singles,similar-artists&include=albums",
            urlencode(&resolved_id)
        ),
        &dev_token,
        &user_token,
    )
    .or_else(|_| {
        apple_get_json(
            &format!(
                "/v1/catalog/{storefront}/artists/{}?include=albums",
                urlencode(&resolved_id)
            ),
            &dev_token,
            &user_token,
        )
    })?;

    let artist_node = artist_json
        .pointer("/data/0")
        .ok_or_else(|| anyhow!("Artist {resolved_id} not found in Apple Music catalog"))?;
    let attrs = artist_node.get("attributes").unwrap_or(artist_node);
    let artist_summary = AppleArtistSummary {
        id: resolved_id.clone(),
        name: attrs
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Artist")
            .to_string(),
        genre: attrs
            .pointer("/genreNames/0")
            .and_then(|v| v.as_str())
            .unwrap_or("Apple Music Artist")
            .to_string(),
        art_url: format_apple_art_url(
            attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
            400,
        ),
    };

    let mut top_tracks: Vec<TrackMetadata> = Vec::new();
    let mut seen_tracks = HashSet::new();
    if let Some(arr) = artist_node
        .pointer("/views/top-songs/data")
        .and_then(|v| v.as_array())
    {
        for item in arr {
            if let Some(tr) = map_apple_item_to_track(item) {
                if seen_tracks.insert(tr.uri.clone()) {
                    top_tracks.push(tr);
                }
            }
        }
    }
    if top_tracks.is_empty() {
        if let Ok(songs_json) = apple_get_json(
            &format!(
                "/v1/catalog/{storefront}/artists/{}/songs?limit=25",
                urlencode(&resolved_id)
            ),
            &dev_token,
            &user_token,
        ) {
            if let Some(arr) = songs_json.get("data").and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(tr) = map_apple_item_to_track(item) {
                        if seen_tracks.insert(tr.uri.clone()) {
                            top_tracks.push(tr);
                        }
                    }
                }
            }
        }
    }

    let mut albums: Vec<AppleCloudAlbumSummary> = Vec::new();
    let mut singles: Vec<AppleCloudAlbumSummary> = Vec::new();
    let mut seen_albums = HashSet::new();

    if let Some(arr) = artist_node
        .pointer("/views/full-albums/data")
        .and_then(|v| v.as_array())
    {
        for alb in arr {
            if let Some(summary) = parse_apple_album_summary(alb, "catalog") {
                if seen_albums.insert(summary.id.clone()) {
                    albums.push(summary);
                }
            }
        }
    }
    if let Some(arr) = artist_node
        .pointer("/views/singles/data")
        .and_then(|v| v.as_array())
    {
        for alb in arr {
            if let Some(summary) = parse_apple_album_summary(alb, "catalog") {
                if seen_albums.insert(summary.id.clone()) {
                    singles.push(summary);
                }
            }
        }
    }
    if let Some(arr) = artist_node
        .pointer("/relationships/albums/data")
        .and_then(|v| v.as_array())
    {
        for alb in arr {
            let is_single = alb
                .pointer("/attributes/isSingle")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if let Some(summary) = parse_apple_album_summary(alb, "catalog") {
                if !seen_albums.insert(summary.id.clone()) {
                    continue;
                }
                let title_lower = summary.title.to_lowercase();
                if is_single
                    || summary.track_count <= 3
                    || title_lower.contains("- single")
                    || title_lower.contains("- ep")
                {
                    singles.push(summary);
                } else {
                    albums.push(summary);
                }
            }
        }
    }

    let mut related_artists: Vec<AppleArtistSummary> = Vec::new();
    let mut seen_related = HashSet::new();
    if let Some(arr) = artist_node
        .pointer("/views/similar-artists/data")
        .and_then(|v| v.as_array())
    {
        for rel in arr {
            let Some(id) = rel.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            if !seen_related.insert(id.to_string()) {
                continue;
            };
            let rel_attrs = rel.get("attributes").unwrap_or(rel);
            related_artists.push(AppleArtistSummary {
                id: id.to_string(),
                name: rel_attrs
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Artist")
                    .to_string(),
                genre: rel_attrs
                    .pointer("/genreNames/0")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Similar Artist")
                    .to_string(),
                art_url: format_apple_art_url(
                    rel_attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                    300,
                ),
            });
        }
    }

    let mut final_artist = artist_summary;
    if final_artist.art_url.is_none() {
        final_artist.art_url = top_tracks
            .first()
            .and_then(|t| t.art_url.clone())
            .or_else(|| albums.first().and_then(|a| a.art_url.clone()));
    }

    Ok(AppleArtistProfileResponse {
        artist: final_artist,
        top_tracks,
        albums,
        singles,
        related_artists,
    })
}

/// Fetches the Apple Music "New" / Top Charts feed in native Rust.
pub fn fetch_new_feed(settings: &SimpSettings) -> Result<AppleNewFeedResponse> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);

    let mut albums = Vec::new();
    let mut playlists = Vec::new();
    let mut songs = Vec::new();
    let mut seen_albums = HashSet::new();
    let mut seen_playlists = HashSet::new();
    let mut seen_songs = HashSet::new();

    if let Ok(json) = apple_get_json(
        &format!("/v1/catalog/{storefront}/charts?types=albums,playlists,songs&limit=15"),
        &dev_token,
        &user_token,
    ) {
        if let Some(alb_charts) = json.pointer("/results/albums").and_then(|v| v.as_array()) {
            for chart in alb_charts {
                if let Some(arr) = chart.get("data").and_then(|v| v.as_array()) {
                    for alb in arr {
                        let Some(id) = alb.get("id").and_then(|v| v.as_str()) else { continue };
                        if !seen_albums.insert(id.to_string()) { continue; }
                        let attrs = alb.get("attributes").unwrap_or(alb);
                        albums.push(AppleCloudAlbumSummary {
                            id: id.to_string(),
                            title: attrs.get("name").and_then(|v| v.as_str()).unwrap_or("New Album").to_string(),
                            artist: attrs.get("artistName").and_then(|v| v.as_str()).unwrap_or("Apple Music").to_string(),
                            art_url: format_apple_art_url(attrs.pointer("/artwork/url").and_then(|v| v.as_str()), 300),
                            track_count: attrs.get("trackCount").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
                            release_year: attrs.get("releaseDate").and_then(|v| v.as_str()).and_then(|s| s.get(0..4)).and_then(|y| y.parse::<u32>().ok()),
                            kind: "catalog".to_string(),
                            date_added: None,
                        });
                    }
                }
            }
        }
        if let Some(pl_charts) = json.pointer("/results/playlists").and_then(|v| v.as_array()) {
            for chart in pl_charts {
                if let Some(arr) = chart.get("data").and_then(|v| v.as_array()) {
                    for pl in arr {
                        let Some(id) = pl.get("id").and_then(|v| v.as_str()) else { continue };
                        if !seen_playlists.insert(id.to_string()) { continue; }
                        let attrs = pl.get("attributes").unwrap_or(pl);
                        playlists.push(AppleCloudPlaylistSummary {
                            id: id.to_string(),
                            name: attrs.get("name").and_then(|v| v.as_str()).unwrap_or("Featured Playlist").to_string(),
                            description: attrs.get("curatorName").or_else(|| attrs.pointer("/editorialNotes/short")).and_then(|v| v.as_str()).unwrap_or("Apple Music New & Featured").to_string(),
                            art_url: format_apple_art_url(attrs.pointer("/artwork/url").and_then(|v| v.as_str()), 300),
                            kind: "catalog".to_string(),
                        });
                    }
                }
            }
        }
        if let Some(song_charts) = json.pointer("/results/songs").and_then(|v| v.as_array()) {
            for chart in song_charts {
                if let Some(arr) = chart.get("data").and_then(|v| v.as_array()) {
                    for item in arr {
                        if let Some(tr) = map_apple_item_to_track(item) {
                            if seen_songs.insert(tr.uri.clone()) {
                                songs.push(tr);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(AppleNewFeedResponse {
        albums,
        playlists,
        songs,
    })
}

static SHARED_APPLE_DB: std::sync::OnceLock<
    std::sync::Mutex<Option<crate::library::db::LibraryDatabase>>,
> = std::sync::OnceLock::new();

fn shared_db_slot() -> &'static std::sync::Mutex<Option<crate::library::db::LibraryDatabase>> {
    SHARED_APPLE_DB.get_or_init(|| std::sync::Mutex::new(None))
}

/// Registers the daemon's main `LibraryDatabase` handle so `apple_api` shares the exact same
/// `Arc<Mutex<Connection>>` without opening a second SQLite connection or risking `SQLITE_BUSY`.
pub fn set_shared_library_db(db: crate::library::db::LibraryDatabase) {
    if let Ok(mut guard) = shared_db_slot().lock() {
        *guard = Some(db.clone());
    }
    if let Ok(persisted) = db.get_all_apple_catalog_mappings() {
        if let Ok(mut cache) = catalog_id_cache().lock() {
            for (k, v) in persisted {
                cache.entry(k).or_insert(v);
            }
        }
    }
}

fn shared_library_db() -> Option<crate::library::db::LibraryDatabase> {
    if let Ok(mut guard) = shared_db_slot().lock() {
        if let Some(ref db) = *guard {
            return Some(db.clone());
        }
        let data_dir = dirs::data_local_dir()?;
        let db_path = data_dir.join("simp").join("library.db");
        if let Ok(opened) = crate::library::db::LibraryDatabase::open(&db_path) {
            *guard = Some(opened.clone());
            return Some(opened);
        }
    }
    None
}

static TRACK_META_HINTS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, (String, String, Option<String>)>>,
> = std::sync::OnceLock::new();

fn track_meta_hints(
) -> &'static std::sync::Mutex<std::collections::HashMap<String, (String, String, Option<String>)>>
{
    TRACK_META_HINTS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

pub fn remember_raw_id_metadata_hint(
    raw_id_or_uri: &str,
    title: &str,
    artist: &str,
    art_url: Option<String>,
) {
    let clean_id = raw_id_or_uri
        .strip_prefix("applemusic:song:")
        .or_else(|| raw_id_or_uri.strip_prefix("applemusic:track:"))
        .or_else(|| raw_id_or_uri.strip_prefix("applemusic:"))
        .unwrap_or(raw_id_or_uri)
        .trim();
    if clean_id.is_empty() || title.trim().is_empty() || title == "Unknown Track" {
        return;
    }
    if let Ok(mut guard) = track_meta_hints().lock() {
        let valid_art = art_url.filter(|u| !u.is_empty() && !u.contains("blobstore.apple.com"));
        let prev_art = guard.get(clean_id).and_then(|(_, _, a)| a.clone());
        guard.insert(
            clean_id.to_string(),
            (
                title.trim().to_string(),
                artist.trim().to_string(),
                valid_art.or(prev_art),
            ),
        );
    }
}

pub fn remember_track_metadata_hint(track: &TrackMetadata) {
    if !track.uri.starts_with("applemusic:") {
        return;
    }
    let artist = track.artists.first().map(|s| s.as_str()).unwrap_or("");
    remember_raw_id_metadata_hint(&track.uri, &track.title, artist, track.art_url.clone());
}

static RESOLVED_CATALOG_ID_CACHE: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, (String, Option<String>)>>,
> = std::sync::OnceLock::new();

fn catalog_id_cache(
) -> &'static std::sync::Mutex<std::collections::HashMap<String, (String, Option<String>)>> {
    RESOLVED_CATALOG_ID_CACHE.get_or_init(|| {
        let mut initial = std::collections::HashMap::new();
        if let Some(db) = shared_library_db() {
            if let Ok(persisted) = db.get_all_apple_catalog_mappings() {
                initial = persisted;
            }
        }
        std::sync::Mutex::new(initial)
    })
}

fn save_resolved_catalog_mapping(clean_id: &str, catalog_id: &str, art_url: Option<String>) {
    if let Ok(mut guard) = catalog_id_cache().lock() {
        let existing_art = guard.get(clean_id).and_then(|(_, a)| a.clone());
        guard.insert(
            clean_id.to_string(),
            (catalog_id.to_string(), art_url.clone().or(existing_art)),
        );
    }
    if let Some(db) = shared_library_db() {
        let _ = db.upsert_apple_catalog_mapping(clean_id, catalog_id, art_url.as_deref());
    }
}

/// Returns a healed permanent `mzstatic.com` catalog artwork URL for `song_uri_or_id` if known.
pub fn get_healed_track_art_url(song_uri_or_id: &str) -> Option<String> {
    let clean_id = song_uri_or_id
        .strip_prefix("applemusic:song:")
        .or_else(|| song_uri_or_id.strip_prefix("applemusic:track:"))
        .or_else(|| song_uri_or_id.strip_prefix("applemusic:"))
        .unwrap_or(song_uri_or_id)
        .trim();
    if let Ok(guard) = catalog_id_cache().lock() {
        if let Some((_, Some(art))) = guard.get(clean_id) {
            return Some(art.clone());
        }
    }
    if let Ok(guard) = track_meta_hints().lock() {
        if let Some((_, _, Some(art))) = guard.get(clean_id) {
            if art.contains("mzstatic.com") {
                return Some(art.clone());
            }
        }
    }
    if let Some(db) = shared_library_db() {
        for prefix in ["applemusic:song:", "applemusic:track:"] {
            let lookup_uri = format!("{prefix}{clean_id}");
            if let Ok(Some(meta)) = db.get_track_by_uri(&lookup_uri) {
                if let Some(art) = meta.art_url.filter(|u| u.contains("mzstatic.com")) {
                    return Some(art);
                }
            }
        }
    }
    None
}

fn lookup_track_title_artist_in_db(clean_id: &str) -> (Option<String>, Option<String>) {
    if let Ok(guard) = track_meta_hints().lock() {
        if let Some((t, a, _)) = guard.get(clean_id) {
            if !t.is_empty() && t != "Unknown Track" {
                let a_opt = if a.is_empty() || a == "Unknown Artist" {
                    None
                } else {
                    Some(a.clone())
                };
                return (Some(t.clone()), a_opt);
            }
        }
    }
    if let Some(db) = shared_library_db() {
        for prefix in ["applemusic:song:", "applemusic:track:"] {
            let lookup_uri = format!("{prefix}{clean_id}");
            if let Ok(Some(meta)) = db.get_track_by_uri(&lookup_uri) {
                if !meta.title.is_empty() && meta.title != "Unknown Track" {
                    return (Some(meta.title), meta.artists.first().cloned());
                }
            }
        }
    }
    (None, None)
}

/// Resolves an Apple Music Radio Station (`applemusic:station:ra.xxxx`) into a batch of playable
/// catalog songs (`TrackMetadata`) in native Rust so radio stations stream 100% natively through
/// SIMP's Zero-Browser Widevine CDM + PipeWire engine on SteamOS, Steam Frame, and Linux.
pub fn fetch_radio_station_tracks(
    settings: &SimpSettings,
    station_uri_or_id: &str,
    station_title_hint: Option<&str>,
    limit: usize,
) -> Result<Vec<TrackMetadata>> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let station_id = station_uri_or_id
        .strip_prefix("applemusic:station:")
        .or_else(|| station_uri_or_id.strip_prefix("applemusic:"))
        .unwrap_or(station_uri_or_id)
        .trim();
    if station_id.is_empty() {
        return Err(anyhow!("Empty Apple Music radio station ID"));
    }

    let safe_limit = limit.clamp(5, 25);
    let next_tracks_url = format!(
        "https://api.music.apple.com/v1/me/stations/next-tracks/{}?limit={}",
        urlencode(station_id),
        safe_limit
    );

    if let Ok(json) = apple_post_json(
        &next_tracks_url,
        &dev_token,
        &user_token,
        &serde_json::json!({}),
    ) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            let tracks: Vec<TrackMetadata> = arr
                .iter()
                .filter_map(map_apple_item_to_track)
                .collect();
            if !tracks.is_empty() {
                return Ok(tracks);
            }
        }
    }

    // Fallback for global live broadcast stations (`isLive: true`, e.g. `ra.978194965` Apple Music 1,
    // Apple Music Hits, Apple Music Country, Apple Music Club, Apple Musica Uno, Apple Music Chill)
    // where `/v1/me/stations/next-tracks` returns empty `data: []`:
    let storefront = get_storefront(&dev_token, &user_token);
    let raw_hint = station_title_hint
        .unwrap_or("")
        .trim_start_matches('📻')
        .trim();
    let lower_hint = raw_hint.to_lowercase();

    // If it's "Apple Music 1" or no specific genre hint, try storefront Top Songs chart first
    if lower_hint.is_empty() || lower_hint.contains("apple music 1") {
        let chart_url = format!("/v1/catalog/{storefront}/charts?types=songs&limit=25");
        if let Ok(json) = apple_get_json(&chart_url, &dev_token, &user_token) {
            if let Some(arr) = json
                .pointer("/results/songs/0/data")
                .and_then(|v| v.as_array())
            {
                let tracks: Vec<TrackMetadata> = arr
                    .iter()
                    .filter_map(map_apple_item_to_track)
                    .collect();
                if !tracks.is_empty() {
                    return Ok(tracks);
                }
            }
        }
    }

    let search_term = if lower_hint.contains("country") {
        "Country Hits"
    } else if lower_hint.contains("club") {
        "Dance Electronic Club"
    } else if lower_hint.contains("uno") || lower_hint.contains("latino") {
        "Musica Latina Hits"
    } else if lower_hint.contains("chill") {
        "Chill Ambient Lo-Fi"
    } else if lower_hint.contains("hits") {
        "Today's Hits"
    } else if !raw_hint.is_empty() && !lower_hint.starts_with("apple music") {
        raw_hint
    } else {
        "Top Hits"
    };

    let search_url = format!(
        "/v1/catalog/{}/search?term={}&types=songs&limit=25",
        storefront,
        urlencode(search_term)
    );
    if let Ok(json) = apple_get_json(&search_url, &dev_token, &user_token) {
        if let Some(arr) = json
            .pointer("/results/songs/data")
            .and_then(|v| v.as_array())
        {
            let tracks: Vec<TrackMetadata> = arr
                .iter()
                .filter_map(map_apple_item_to_track)
                .collect();
            if !tracks.is_empty() {
                return Ok(tracks);
            }
        }
    }

    Err(anyhow!(
        "Could not resolve tracks for Apple Music station {station_id}"
    ))
}

fn search_storefront_catalog_song_id(
    dev_token: &str,
    user_token: &str,
    storefront: &str,
    clean_id: &str,
    title: Option<&str>,
    artist: Option<&str>,
) -> Option<(String, Option<String>)> {
    let t = title.filter(|s| !s.trim().is_empty() && *s != "Unknown Track")?;
    let a = artist.unwrap_or("").trim();
    let term = format!("{t} {a}").trim().to_string();
    let url = format!(
        "/v1/catalog/{}/search?term={}&types=songs&limit=5",
        storefront,
        urlencode(&term)
    );
    let json = apple_get_json(&url, dev_token, user_token).ok()?;
    let candidates = json.pointer("/results/songs/data")?.as_array()?;
    let t_lower = t.trim().to_lowercase();
    let a_lower = a.trim().to_lowercase();
    let chosen = candidates.iter().find(|c| {
        let n = c
            .pointer("/attributes/name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_lowercase();
        let ar = c
            .pointer("/attributes/artistName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_lowercase();
        n == t_lower && (a_lower.is_empty() || ar.contains(&a_lower) || a_lower.contains(&ar))
    })?;

    let id = chosen.get("id")?.as_str()?;
    let art_url = format_apple_art_url(
        chosen
            .pointer("/attributes/artwork/url")
            .and_then(|v| v.as_str()),
        400,
    );
    if id != clean_id {
        Some((id.to_string(), art_url))
    } else {
        None
    }
}

/// Resolves a re-linked or tombstoned playlist track ID (`i.xxxx` library song ID or stale catalog ID)
/// to its active storefront catalog song ID in native Rust, with persistent SQLite + in-memory caching.
/// Note: For uploaded Cloud Library tracks (`i.xxxx`) that have no catalog equivalent, returns `Ok(None)`
/// so `fetch_web_playback_manifest` preserves the user's `universalLibraryId` (`i.xxxx`).
pub fn resolve_replacement_catalog_song_id(
    settings: &SimpSettings,
    raw_id: &str,
    title: Option<&str>,
    artist: Option<&str>,
) -> Result<Option<String>> {
    let clean_id = raw_id
        .strip_prefix("applemusic:song:")
        .or_else(|| raw_id.strip_prefix("applemusic:track:"))
        .or_else(|| raw_id.strip_prefix("applemusic:"))
        .unwrap_or(raw_id)
        .trim();

    if let Ok(guard) = catalog_id_cache().lock() {
        if let Some((cached_id, _)) = guard.get(clean_id) {
            return Ok(Some(cached_id.clone()));
        }
    }

    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);

    // If `title` + `artist` have an exact storefront catalog match, resolve to the active licensed `salableAdamId`.
    // Because `search_storefront_catalog_song_id` requires an exact title+artist match (no fuzzy `candidates.first()`),
    // uploaded tracks that aren't in the streaming catalog safely fall through without being overwritten!
    if let Some((resolved, art_url)) =
        search_storefront_catalog_song_id(&dev_token, &user_token, &storefront, clean_id, title, artist)
    {
        save_resolved_catalog_mapping(clean_id, &resolved, art_url);
        return Ok(Some(resolved));
    }

    if clean_id.starts_with("i.") {
        if let Ok(json) = apple_get_json(
            &format!("/v1/me/library/songs/{}/catalog", urlencode(clean_id)),
            &dev_token,
            &user_token,
        ) {
            if let Some(cat_id) = json.pointer("/data/0/id").and_then(|v| v.as_str()) {
                let resolved = cat_id.to_string();
                let art_url = format_apple_art_url(
                    json.pointer("/data/0/attributes/artwork/url")
                        .and_then(|v| v.as_str()),
                    400,
                );
                save_resolved_catalog_mapping(clean_id, &resolved, art_url);
                return Ok(Some(resolved));
            }
        }
    }

    Ok(None)
}

/// Forces a storefront catalog search by `title + artist` from `library.db` when a library song's
/// linked catalog ID fails `acquireWebPlaybackLicense` (e.g. `status: -1003` delisted pressing).
pub fn force_resolve_catalog_song_by_search(
    settings: &SimpSettings,
    song_uri_or_id: &str,
) -> Result<Option<String>> {
    let clean_id = song_uri_or_id
        .strip_prefix("applemusic:song:")
        .or_else(|| song_uri_or_id.strip_prefix("applemusic:track:"))
        .or_else(|| song_uri_or_id.strip_prefix("applemusic:"))
        .unwrap_or(song_uri_or_id)
        .trim();
    let (title_opt, artist_opt) = lookup_track_title_artist_in_db(clean_id);
    if title_opt.is_none() {
        return Ok(None);
    }
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);
    if let Some((resolved, art_url)) = search_storefront_catalog_song_id(
        &dev_token,
        &user_token,
        &storefront,
        clean_id,
        title_opt.as_deref(),
        artist_opt.as_deref(),
    ) {
        save_resolved_catalog_mapping(clean_id, &resolved, art_url);
        return Ok(Some(resolved));
    }
    Ok(None)
}

/// Pre-resolves uncached `applemusic:song:i.xxxx` library tracks in the active queue in the background
/// and persists their catalog IDs + permanent `mzstatic.com` artwork into SQLite (`apple_catalog_map`).
pub fn spawn_queue_catalog_prewarmer(settings: SimpSettings, tracks: Vec<TrackMetadata>) {
    let uncached: Vec<TrackMetadata> = tracks
        .into_iter()
        .filter(|t| {
            let clean = t
                .uri
                .strip_prefix("applemusic:song:")
                .or_else(|| t.uri.strip_prefix("applemusic:track:"))
                .unwrap_or(&t.uri)
                .trim();
            if !clean.starts_with("i.") {
                return false;
            }
            if let Ok(guard) = catalog_id_cache().lock() {
                !guard.contains_key(clean)
            } else {
                true
            }
        })
        .collect();

    if uncached.is_empty() {
        return;
    }

    let _ = std::thread::Builder::new()
        .name("simp-catalog-prewarm".to_string())
        .spawn(move || {
            // Yield 750ms so the active track's manifest + HLS + Widevine license handshake
            // gets 100% network & CPU priority before background queue resolution begins.
            std::thread::sleep(std::time::Duration::from_millis(750));
            for t in uncached {
                let artist = t.artists.first().map(|s| s.as_str());
                let _ = resolve_replacement_catalog_song_id(
                    &settings,
                    &t.uri,
                    Some(&t.title),
                    artist,
                );
            }
        });
}

fn has_playable_cloud_or_widevine_asset(json: &Value) -> bool {
    json.pointer("/songList/0/assets")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter().any(|a| {
                let has_url = a
                    .get("URL")
                    .and_then(|v| v.as_str())
                    .map(|u| !u.trim().is_empty())
                    .unwrap_or(false);
                if !has_url {
                    return false;
                }
                let flavor = a.get("flavor").and_then(|v| v.as_str()).unwrap_or("");
                flavor.contains("ctrp")
                    || flavor.contains("plus")
                    || flavor.contains("itemDownload")
                    || json.pointer("/songList/0/hls-key-server-url").is_none()
            })
        })
        .unwrap_or(false)
}

/// Stage C Browserless Foundation: Queries Apple's `webPlayback` endpoint directly from Rust
/// to retrieve the encrypted HLS `.m3u8` asset stream URL and Widevine license server URLs
/// (or DRM-free `plus256` / `itemDownload` / clear HLS assets for uploaded & iTunes Match Cloud Locker tracks).
pub fn fetch_web_playback_manifest(
    settings: &SimpSettings,
    song_id: &str,
) -> Result<AppleWebPlaybackAsset> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let clean_id = song_id
        .strip_prefix("applemusic:song:")
        .or_else(|| song_id.strip_prefix("applemusic:track:"))
        .or_else(|| song_id.strip_prefix("applemusic:"))
        .unwrap_or(song_id)
        .trim();

    let mut active_id = if let Ok(guard) = catalog_id_cache().lock() {
        guard
            .get(clean_id)
            .map(|(id, _)| id.clone())
            .unwrap_or_else(|| clean_id.to_string())
    } else {
        clean_id.to_string()
    };

    // Always pass `title` and `artist` from `library.db` when resolving `i.xxxx` library tracks
    // so re-linked pinned playlists resolve to their active catalog `salableAdamId`, while uploaded
    // tracks without a catalog match preserve their `universalLibraryId` (`i.xxxx`).
    let mut db_meta_cache: Option<(Option<String>, Option<String>)> = None;
    if active_id.starts_with("i.") {
        let (t_opt, a_opt) = lookup_track_title_artist_in_db(clean_id);
        db_meta_cache = Some((t_opt.clone(), a_opt.clone()));
        if let Ok(Some(cat_id)) = resolve_replacement_catalog_song_id(
            settings,
            &active_id,
            t_opt.as_deref(),
            a_opt.as_deref(),
        ) {
            active_id = cat_id;
        }
    }

    let make_payload = |id: &str| {
        if id.starts_with("i.") {
            serde_json::json!({ "universalLibraryId": id })
        } else {
            serde_json::json!({ "salableAdamId": id })
        }
    };

    let mut json = apple_post_json(
        "https://play.music.apple.com/WebObjects/MZPlay.woa/wa/webPlayback",
        &dev_token,
        &user_token,
        &make_payload(&active_id),
    )?;

    if (json.pointer("/songList/0").is_none() || !has_playable_cloud_or_widevine_asset(&json))
        && clean_id.starts_with("i.")
        && active_id != clean_id
    {
        // Some user library songs require both `universalLibraryId` and `subscriptionAdamId`
        // (or just `universalLibraryId` directly) in the `webPlayback` request body.
        for fallback_payload in [
            serde_json::json!({
                "universalLibraryId": clean_id,
                "subscriptionAdamId": active_id,
            }),
            serde_json::json!({
                "universalLibraryId": clean_id,
            }),
        ] {
            if let Ok(candidate) = apple_post_json(
                "https://play.music.apple.com/WebObjects/MZPlay.woa/wa/webPlayback",
                &dev_token,
                &user_token,
                &fallback_payload,
            ) {
                if candidate.pointer("/songList/0").is_some()
                    && has_playable_cloud_or_widevine_asset(&candidate)
                {
                    json = candidate;
                    break;
                }
            }
        }
    }

    if json.pointer("/songList/0").is_none() || !has_playable_cloud_or_widevine_asset(&json) {
        let (title_opt, artist_opt) =
            db_meta_cache.unwrap_or_else(|| lookup_track_title_artist_in_db(clean_id));
        let storefront = get_storefront(&dev_token, &user_token);
        if let Some((replacement_id, art_url)) = search_storefront_catalog_song_id(
            &dev_token,
            &user_token,
            &storefront,
            &active_id,
            title_opt.as_deref(),
            artist_opt.as_deref(),
        ) {
            if replacement_id != active_id {
                save_resolved_catalog_mapping(clean_id, &replacement_id, art_url);
                active_id = replacement_id;
                json = apple_post_json(
                    "https://play.music.apple.com/WebObjects/MZPlay.woa/wa/webPlayback",
                    &dev_token,
                    &user_token,
                    &make_payload(&active_id),
                )?;
            }
        }
    }

    let song_obj = json
        .pointer("/songList/0")
        .ok_or_else(|| anyhow!("No songList entry returned by Apple webPlayback endpoint (raw response: {json})"))?;

    let canonical_song_id = song_obj
        .get("songId")
        .and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_u64().map(|n| n.to_string()))
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        })
        .unwrap_or_else(|| active_id.clone());

    let key_server_url = song_obj
        .get("hls-key-server-url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let key_cert_url = song_obj
        .get("hls-key-cert-url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let assets = song_obj
        .get("assets")
        .and_then(|v| v.as_array())
        .ok_or_else(|| anyhow!("No HLS assets in webPlayback response"))?;

    // Prefer:
    // 1. DRM-free `plus256` / `itemDownload` assets when playing user-uploaded / iTunes Match Cloud Locker tracks without `hls-key-server-url`
    // 2. 256kbps Widevine CTR (`28:ctrp256`) or 64kbps Widevine CTR (`28:ctrp64`) ahead of FairPlay-only (`30:cbcp256`)
    let chosen = assets
        .iter()
        .find(|a| {
            a.get("flavor")
                .and_then(|v| v.as_str())
                .map(|f| f == "28:ctrp256" || f.contains("ctrp256"))
                .unwrap_or(false)
        })
        .or_else(|| {
            assets.iter().find(|a| {
                a.get("flavor")
                    .and_then(|v| v.as_str())
                    .map(|f| f.contains("ctrp"))
                    .unwrap_or(false)
            })
        })
        .or_else(|| {
            assets.iter().find(|a| {
                a.get("flavor")
                    .and_then(|v| v.as_str())
                    .map(|f| f.contains("plus") || f.contains("itemDownload"))
                    .unwrap_or(false)
            })
        })
        .or_else(|| {
            assets.iter().find(|a| {
                a.get("flavor")
                    .and_then(|v| v.as_str())
                    .map(|f| f.contains("256"))
                    .unwrap_or(false)
            })
        })
        .or_else(|| assets.first())
        .ok_or_else(|| anyhow!("Empty assets list in webPlayback response"))?;

    let hls_playlist_url = chosen
        .get("URL")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("Missing URL in webPlayback asset"))?
        .to_string();
    let flavor = chosen
        .get("flavor")
        .and_then(|v| v.as_str())
        .unwrap_or("default")
        .to_string();

    let url_path_lower = hls_playlist_url
        .split('?')
        .next()
        .unwrap_or(&hls_playlist_url)
        .to_lowercase();
    let is_direct_audio_file = !url_path_lower.ends_with(".m3u8")
        && (url_path_lower.ends_with(".m4a")
            || url_path_lower.ends_with(".mp3")
            || url_path_lower.ends_with(".aac")
            || url_path_lower.ends_with(".flac")
            || url_path_lower.ends_with(".wav")
            || flavor.contains("itemDownload"));

    let encryption_kind = if is_direct_audio_file {
        AppleAssetEncryptionKind::ClearDirectAudio
    } else if flavor.contains("plus") || (key_server_url.is_none() && !flavor.contains("ctrp") && !flavor.contains("cbcp")) {
        AppleAssetEncryptionKind::ClearHlsFmp4
    } else {
        AppleAssetEncryptionKind::WidevineCenc
    };

    Ok(AppleWebPlaybackAsset {
        song_id: canonical_song_id,
        flavor,
        hls_playlist_url,
        key_server_url,
        key_cert_url,
        encryption_kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_apple_item_prefers_included_catalog_relationship_id() {
        let raw_item = serde_json::json!({
            "id": "i.relinked123",
            "type": "library-songs",
            "attributes": {
                "name": "Broke Your Cover",
                "artistName": "Dev Lemons",
                "albumName": "SURFACE TENSION",
                "durationInMillis": 172000,
                "trackNumber": 3,
                "playParams": {
                    "id": "i.relinked123",
                    "isLibrary": true,
                    "catalogId": "1111111111"
                }
            },
            "relationships": {
                "catalog": {
                    "data": [
                        {
                            "id": "2222222222",
                            "type": "songs"
                        }
                    ]
                }
            }
        });

        let track = map_apple_item_to_track(&raw_item).expect("should map track");
        assert_eq!(
            track.uri, "applemusic:song:2222222222",
            "Must prefer live relationships.catalog.data[0].id over stale playParams.catalogId"
        );
        assert_eq!(track.title, "Broke Your Cover");
        assert_eq!(track.artists, vec!["Dev Lemons".to_string()]);
        assert_eq!(track.album, "SURFACE TENSION");
        assert_eq!(track.duration_ms, 172000);
    }

    #[test]
    fn test_map_apple_item_heals_expiring_blobstore_artwork_with_catalog_artwork() {
        let raw_item = serde_json::json!({
            "id": "i.KNRzN5Qh3b7lQ",
            "type": "library-songs",
            "attributes": {
                "name": "The Grid",
                "artistName": "Daft Punk",
                "albumName": "TRON: Legacy",
                "durationInMillis": 96000,
                "trackNumber": 2,
                "artwork": {
                    "url": "https://store-037.blobstore.apple.com/itms6-assets-massilia-037001/Purple113/v4/1b/1f/dc/image?X-Amz-Expires=86400"
                }
            },
            "relationships": {
                "catalog": {
                    "data": [
                        {
                            "id": "1440617977",
                            "type": "songs",
                            "attributes": {
                                "artwork": {
                                    "url": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/38/4b/5c/mzi.cfikjxuv.jpg/{w}x{h}bb.jpg"
                                }
                            }
                        }
                    ]
                }
            }
        });

        let track = map_apple_item_to_track(&raw_item).expect("should map track");
        assert_eq!(track.uri, "applemusic:song:1440617977");
        assert_eq!(
            track.art_url.as_deref(),
            Some("https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/38/4b/5c/mzi.cfikjxuv.jpg/400x400bb.jpg"),
            "Must replace 24-hour expiring blobstore.apple.com URL with permanent mzstatic.com catalog artwork"
        );
    }

    #[test]
    fn test_with_limit_100_preserves_pagination_page_size() {
        assert_eq!(
            with_limit_100("/v1/me/library/playlists?offset=100"),
            "/v1/me/library/playlists?offset=100&limit=100"
        );
        assert_eq!(
            with_limit_100("/v1/me/library/playlists?offset=200&limit=100"),
            "/v1/me/library/playlists?offset=200&limit=100"
        );
        assert_eq!(
            with_limit_100("/v1/me/library/playlists"),
            "/v1/me/library/playlists?limit=100"
        );
    }

    #[test]
    fn test_parse_apple_album_summary_handles_personal_cloud_library_album() {
        let lib_album = serde_json::json!({
            "id": "l.abc98765",
            "type": "library-albums",
            "attributes": {
                "name": "Sample Uploaded Vinyl Companion",
                "artistName": "Example Artist",
                "trackCount": 37,
                "releaseDate": "2017-12-22",
                "dateAdded": "2024-05-10T14:20:00Z",
                "artwork": {
                    "url": "https://is1-ssl.mzstatic.com/image/thumb/Music118/v4/aa/bb/cc/cover.jpg/{w}x{h}bb.jpg"
                }
            }
        });

        let summary = parse_apple_album_summary(&lib_album, "library").expect("should parse library album");
        assert_eq!(summary.id, "l.abc98765");
        assert_eq!(summary.kind, "library");
        assert_eq!(summary.title, "Sample Uploaded Vinyl Companion");
        assert_eq!(summary.artist, "Example Artist");
        assert_eq!(summary.track_count, 37);
        assert_eq!(summary.release_year, Some(2017));
        assert_eq!(summary.date_added.as_deref(), Some("2024-05-10T14:20:00Z"));

        let cloud_locker_manifest = serde_json::json!({
            "songList": [{
                "songId": "i.uploadedTrack01",
                "assets": [{
                    "flavor": "28:plus256",
                    "URL": "https://audio-ssl.itunes.apple.com/itunes-assets/clear_stream.m3u8"
                }]
            }]
        });
        assert!(has_playable_cloud_or_widevine_asset(&cloud_locker_manifest));
    }
}
