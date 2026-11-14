pub mod catalog;
pub mod discover;
pub mod playback;
pub mod social;

pub use catalog::*;
pub use discover::*;
pub use playback::*;
pub use social::*;

use crate::sinks::apple::AppleMusicSink;
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use simp_protocol::{SimpSettings, TrackMetadata};
use std::sync::{Mutex, OnceLock};

static CACHED_STOREFRONT: OnceLock<Mutex<Option<String>>> = OnceLock::new();

pub(crate) fn storefront_cache() -> &'static Mutex<Option<String>> {
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
    #[serde(default)]
    pub content_rating: Option<String>,
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
    #[serde(default)]
    pub genre: Option<String>,
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
    pub is_social: bool,
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
    #[serde(default)]
    pub personal_stations: Vec<AppleRadioStationSummary>,
    #[serde(default)]
    pub live_stations: Vec<AppleRadioStationSummary>,
    #[serde(default)]
    pub genre_stations: Vec<AppleRadioStationSummary>,
    #[serde(default)]
    pub artist_shows: Vec<AppleCloudPlaylistSummary>,
    #[serde(default)]
    pub club_mixes: Vec<AppleCloudPlaylistSummary>,
    pub playlists: Vec<AppleCloudPlaylistSummary>,
    pub albums: Vec<AppleCloudAlbumSummary>,
    #[serde(default)]
    pub new_releases: Vec<AppleCloudAlbumSummary>,
    #[serde(default)]
    pub shelves: Vec<AppleRecommendationShelf>,
    #[serde(default)]
    pub recently_played: Vec<TrackMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleNewFeedResponse {
    #[serde(default)]
    pub recent_releases: Vec<AppleCloudAlbumSummary>,
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

pub(crate) fn extract_apple_content_rating(item: &Value) -> Option<String> {
    let attrs = item.get("attributes").unwrap_or(item);
    let raw = attrs
        .get("contentRating")
        .or_else(|| item.pointer("/relationships/catalog/data/0/attributes/contentRating"))
        .or_else(|| item.get("contentRating"))
        .and_then(|v| v.as_str())?
        .trim()
        .to_ascii_lowercase();
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
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

    let content_rating = extract_apple_content_rating(item);

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
        content_rating,
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

pub(crate) fn resolve_tokens(settings: &SimpSettings) -> Result<(String, String)> {
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
pub(crate) fn apple_get_json(url: &str, dev_token: &str, user_token: &str) -> Result<Value> {
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
pub(crate) fn apple_post_json(url: &str, dev_token: &str, user_token: &str, body: &Value) -> Result<Value> {
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

/// Pre-warms the Apple Music Developer JWT, User Token, and Storefront ID (`GET /v1/me/storefront`)
/// so the TLS connection pool and storefront cache are hot before the first track is played.
pub fn prewarm_apple_auth_and_storefront(settings: &SimpSettings) {
    if let Ok((dev_token, user_token)) = resolve_tokens(settings) {
        let _ = get_storefront(&dev_token, &user_token);
    }
}

pub(crate) fn urlencode(s: &str) -> String {
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
pub(crate) fn with_limit_100(url: &str) -> String {
    if url.contains("limit=") {
        url.to_string()
    } else if url.contains('?') {
        format!("{url}&limit=100")
    } else {
        format!("{url}?limit=100")
    }
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

    #[test]
    fn test_apple_content_rating_distinguishes_explicit_and_clean_editions() {
        let explicit_album = serde_json::json!({
            "id": "1700000001",
            "type": "albums",
            "attributes": {
                "name": "Sample Double Edition Album",
                "artistName": "Example Artist",
                "trackCount": 12,
                "releaseDate": "2023-09-15",
                "contentRating": "explicit"
            }
        });
        let clean_album = serde_json::json!({
            "id": "1700000002",
            "type": "albums",
            "attributes": {
                "name": "Sample Double Edition Album",
                "artistName": "Example Artist",
                "trackCount": 12,
                "releaseDate": "2023-09-15",
                "contentRating": "clean"
            }
        });

        let exp_summary =
            parse_apple_album_summary(&explicit_album, "catalog").expect("explicit album");
        let clean_summary =
            parse_apple_album_summary(&clean_album, "catalog").expect("clean album");
        assert_eq!(exp_summary.content_rating.as_deref(), Some("explicit"));
        assert_eq!(clean_summary.content_rating.as_deref(), Some("clean"));

        let explicit_track = serde_json::json!({
            "id": "i.lib001",
            "type": "library-songs",
            "attributes": {
                "name": "Track 01",
                "artistName": "Example Artist",
                "albumName": "Sample Double Edition Album",
                "durationInMillis": 185000
            },
            "relationships": {
                "catalog": {
                    "data": [{
                        "id": "900000111",
                        "type": "songs",
                        "attributes": {
                            "contentRating": "explicit"
                        }
                    }]
                }
            }
        });
        let mapped_track = map_apple_item_to_track(&explicit_track).expect("track with rating");
        assert_eq!(mapped_track.content_rating.as_deref(), Some("explicit"));
    }
}
