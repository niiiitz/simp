use crate::sinks::apple::AppleMusicSink;
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::HashSet;
use std::io::Write;
use std::process::{Command, Stdio};
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
pub struct AppleRadioAndForYouResponse {
    pub stations: Vec<AppleRadioStationSummary>,
    pub playlists: Vec<AppleCloudPlaylistSummary>,
    pub albums: Vec<AppleCloudAlbumSummary>,
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
}

/// Stage C Browserless Foundation: Metadata returned by Apple's `webPlayback` endpoint
/// (`https://play.music.apple.com/WebObjects/MZPlay.woa/wa/webPlayback`) for native Rust HLS + Widevine CDM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleWebPlaybackAsset {
    pub song_id: String,
    pub flavor: String,
    pub hls_playlist_url: String,
    pub key_server_url: Option<String>,
    pub key_cert_url: Option<String>,
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

    let raw_art = attrs
        .pointer("/artwork/url")
        .or_else(|| item.pointer("/artwork/url"))
        .and_then(|v| v.as_str());
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

    Some(TrackMetadata {
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
    })
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

/// Executes an authenticated `GET` request against `api.music.apple.com` using `curl --config -`
/// so neither the Developer JWT nor the `Music-User-Token` is exposed in `/proc/<pid>/cmdline`.
fn apple_get_json(url: &str, dev_token: &str, user_token: &str) -> Result<Value> {
    let full_url = if url.starts_with("https://") {
        url.to_string()
    } else if url.starts_with('/') {
        format!("https://api.music.apple.com{url}")
    } else {
        format!("https://api.music.apple.com/{url}")
    };

    let curl_cfg = format!(
        "url = \"{}\"\nheader = \"Authorization: Bearer {}\"\nheader = \"Music-User-Token: {}\"\nheader = \"Origin: https://music.apple.com\"\nheader = \"Referer: https://music.apple.com/\"\n",
        full_url.replace('"', "\\\""),
        dev_token.trim(),
        user_token.trim()
    );

    let mut child = Command::new("curl")
        .args(["-fsSL", "--max-time", "12", "--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Failed to spawn curl for Apple Music API request")?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(curl_cfg.as_bytes());
    }

    let out = child.wait_with_output()?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(anyhow!("Apple Music API GET failed ({}): {}", full_url, err.trim()));
    }

    serde_json::from_slice(&out.stdout).context("Invalid JSON from Apple Music API")
}

/// Executes an authenticated `POST` request with JSON body against Apple Music endpoints.
fn apple_post_json(url: &str, dev_token: &str, user_token: &str, body: &Value) -> Result<Value> {
    let body_str = serde_json::to_string(body)?;
    let curl_cfg = format!(
        "url = \"{}\"\nrequest = \"POST\"\nheader = \"Authorization: Bearer {}\"\nheader = \"Music-User-Token: {}\"\nheader = \"Content-Type: application/json\"\nheader = \"Origin: https://music.apple.com\"\nheader = \"Referer: https://music.apple.com/\"\ndata = \"{}\"\n",
        url.replace('"', "\\\""),
        dev_token.trim(),
        user_token.trim(),
        body_str.replace('\\', "\\\\").replace('"', "\\\"")
    );

    let mut child = Command::new("curl")
        .args(["-fsSL", "--max-time", "15", "--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Failed to spawn curl for Apple Music POST request")?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(curl_cfg.as_bytes());
    }

    let out = child.wait_with_output()?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(anyhow!("Apple Music API POST failed ({}): {}", url, err.trim()));
    }

    serde_json::from_slice(&out.stdout).context("Invalid JSON from Apple Music POST")
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

/// Fetches the user's Apple Music Cloud Playlists in native Rust.
pub fn fetch_cloud_playlists(settings: &SimpSettings) -> Result<Vec<AppleCloudPlaylistSummary>> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let mut next_url: Option<String> =
        Some("/v1/me/library/playlists?limit=100".to_string());
    let mut items = Vec::new();

    for _ in 0..3 {
        let Some(ref url) = next_url else { break };
        let Ok(json) = apple_get_json(url, &dev_token, &user_token) else {
            break;
        };
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for pl in arr {
                let Some(id) = pl.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                let attrs = pl.get("attributes").unwrap_or(pl);
                let name = attrs
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Apple Playlist")
                    .to_string();
                let description = attrs
                    .pointer("/description/standard")
                    .and_then(|v| v.as_str())
                    .unwrap_or("iCloud Music Library Playlist")
                    .to_string();
                let art_url = format_apple_art_url(
                    attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                    300,
                );
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
            .map(|s| s.to_string());
    }

    Ok(items)
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
    for _ in 0..5 {
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
            .map(|s| s.to_string());
    }

    Ok(tracks)
}

/// Resolves a full Apple Music Catalog Album from a catalog album ID, library album ID (`l.xxxx`), or song URI.
pub fn fetch_full_album(
    settings: &SimpSettings,
    album_id: Option<&str>,
    song_uri: Option<&str>,
) -> Result<AppleFullAlbumResponse> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);

    let mut catalog_album_id: Option<String> = None;

    if let Some(raw_alb) = album_id.filter(|s| !s.trim().is_empty()) {
        let clean_alb = raw_alb
            .strip_prefix("applemusic:album:")
            .unwrap_or(raw_alb)
            .trim();
        if clean_alb.starts_with("l.") {
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

    if catalog_album_id.is_none() {
        if let Some(raw_song) = song_uri.filter(|s| !s.trim().is_empty()) {
            let clean_song = raw_song
                .strip_prefix("applemusic:song:")
                .or_else(|| raw_song.strip_prefix("applemusic:track:"))
                .or_else(|| raw_song.strip_prefix("applemusic:"))
                .unwrap_or(raw_song)
                .trim();
            let path = if clean_song.starts_with("i.") {
                format!(
                    "/v1/me/library/songs/{}/catalog?include=albums",
                    urlencode(clean_song)
                )
            } else {
                format!(
                    "/v1/catalog/{}/songs/{}?include=albums",
                    storefront,
                    urlencode(clean_song)
                )
            };
            if let Ok(json) = apple_get_json(&path, &dev_token, &user_token) {
                catalog_album_id = json
                    .pointer("/data/0/relationships/albums/data/0/id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }
    }

    let cat_id = catalog_album_id
        .ok_or_else(|| anyhow!("Could not resolve full catalog album on Apple Music"))?;

    let alb_json = apple_get_json(
        &format!(
            "/v1/catalog/{}/albums/{}?include=tracks",
            storefront,
            urlencode(&cat_id)
        ),
        &dev_token,
        &user_token,
    )?;

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
    };

    Ok(AppleFullAlbumResponse { album, tracks })
}

/// Live Apple Music Catalog Search in native Rust.
pub fn search_catalog(settings: &SimpSettings, term: &str) -> Result<AppleCatalogSearchResults> {
    let cleaned = term.trim();
    if cleaned.is_empty() {
        return Ok(AppleCatalogSearchResults {
            songs: Vec::new(),
            albums: Vec::new(),
            playlists: Vec::new(),
            stations: Vec::new(),
        });
    }

    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);
    let url = format!(
        "/v1/catalog/{}/search?term={}&types=songs,albums,playlists,stations&limit=15",
        storefront,
        urlencode(cleaned)
    );
    let json = apple_get_json(&url, &dev_token, &user_token)?;
    let results = json.get("results").unwrap_or(&json);

    let songs: Vec<TrackMetadata> = results
        .pointer("/songs/data")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(map_apple_item_to_track).collect())
        .unwrap_or_default();

    let albums: Vec<AppleCloudAlbumSummary> = results
        .pointer("/albums/data")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|alb| {
                    let id = alb.get("id")?.as_str()?.to_string();
                    let attrs = alb.get("attributes").unwrap_or(alb);
                    Some(AppleCloudAlbumSummary {
                        id,
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
                        art_url: format_apple_art_url(
                            attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                            300,
                        ),
                        track_count: attrs
                            .get("trackCount")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as usize,
                        release_year: attrs
                            .get("releaseDate")
                            .and_then(|v| v.as_str())
                            .and_then(|s| s.get(0..4))
                            .and_then(|y| y.parse::<u32>().ok()),
                        kind: "catalog".to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let playlists: Vec<AppleCloudPlaylistSummary> = results
        .pointer("/playlists/data")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|pl| {
                    let id = pl.get("id")?.as_str()?.to_string();
                    let attrs = pl.get("attributes").unwrap_or(pl);
                    Some(AppleCloudPlaylistSummary {
                        id,
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
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let stations: Vec<AppleRadioStationSummary> = results
        .pointer("/stations/data")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|st| {
                    let id = st.get("id")?.as_str()?.to_string();
                    let attrs = st.get("attributes").unwrap_or(st);
                    Some(AppleRadioStationSummary {
                        id,
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
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(AppleCatalogSearchResults {
        songs,
        albums,
        playlists,
        stations,
    })
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
                albums.push(AppleCloudAlbumSummary {
                    id: id.to_string(),
                    title: attrs
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Album")
                        .to_string(),
                    artist: attrs
                        .get("artistName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Apple Music")
                        .to_string(),
                    art_url: format_apple_art_url(
                        attrs.pointer("/artwork/url").and_then(|v| v.as_str()),
                        300,
                    ),
                    track_count: attrs
                        .get("trackCount")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as usize,
                    release_year: attrs
                        .get("releaseDate")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.get(0..4))
                        .and_then(|y| y.parse::<u32>().ok()),
                    kind: if id.starts_with("l.") { "library" } else { "catalog" }.to_string(),
                });
            }
            _ => {}
        }
    };

    if let Ok(json) = apple_get_json("/v1/me/recent/radio-stations?limit=12", &dev_token, &user_token) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for st in arr {
                push_station_to(&mut stations, &mut seen_stations, st, "Recent Radio Station");
            }
        }
    }
    if let Ok(json) = apple_get_json("/v1/me/history/heavy-rotation?limit=15", &dev_token, &user_token) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for item in arr {
                push_item(item, "Heavy Rotation", &mut stations, &mut seen_stations);
            }
        }
    }
    if let Ok(json) = apple_get_json("/v1/me/recommendations?limit=10", &dev_token, &user_token) {
        if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
            for rec in arr {
                let title = rec
                    .pointer("/attributes/title/stringForDisplay")
                    .and_then(|v| v.as_str())
                    .unwrap_or("For You");
                if let Some(contents) = rec
                    .pointer("/relationships/contents/data")
                    .and_then(|v| v.as_array())
                {
                    for item in contents {
                        push_item(item, title, &mut stations, &mut seen_stations);
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

/// Resolves a re-linked or tombstoned playlist track ID (`i.xxxx` library song ID or stale catalog ID)
/// to its active storefront catalog song ID in native Rust.
pub fn resolve_replacement_catalog_song_id(
    settings: &SimpSettings,
    raw_id: &str,
    title: Option<&str>,
    artist: Option<&str>,
) -> Result<Option<String>> {
    let (dev_token, user_token) = resolve_tokens(settings)?;
    let storefront = get_storefront(&dev_token, &user_token);
    let clean_id = raw_id
        .strip_prefix("applemusic:song:")
        .or_else(|| raw_id.strip_prefix("applemusic:track:"))
        .or_else(|| raw_id.strip_prefix("applemusic:"))
        .unwrap_or(raw_id)
        .trim();

    if clean_id.starts_with("i.") {
        if let Ok(json) = apple_get_json(
            &format!("/v1/me/library/songs/{}/catalog", urlencode(clean_id)),
            &dev_token,
            &user_token,
        ) {
            if let Some(cat_id) = json.pointer("/data/0/id").and_then(|v| v.as_str()) {
                return Ok(Some(cat_id.to_string()));
            }
        }
    }

    if let Some(t) = title.filter(|s| !s.trim().is_empty() && *s != "Unknown Track") {
        let a = artist.unwrap_or("").trim();
        let term = format!("{t} {a}").trim().to_string();
        let url = format!(
            "/v1/catalog/{}/search?term={}&types=songs&limit=5",
            storefront,
            urlencode(&term)
        );
        if let Ok(json) = apple_get_json(&url, &dev_token, &user_token) {
            if let Some(candidates) = json.pointer("/results/songs/data").and_then(|v| v.as_array())
            {
                let t_lower = t.to_lowercase();
                let a_lower = a.to_lowercase();
                let chosen = candidates
                    .iter()
                    .find(|c| {
                        let n = c
                            .pointer("/attributes/name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_lowercase();
                        let ar = c
                            .pointer("/attributes/artistName")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_lowercase();
                        n == t_lower && (a_lower.is_empty() || ar.contains(&a_lower))
                    })
                    .or_else(|| candidates.first());

                if let Some(id) = chosen.and_then(|c| c.get("id")).and_then(|v| v.as_str()) {
                    if id != clean_id {
                        return Ok(Some(id.to_string()));
                    }
                }
            }
        }
    }

    Ok(None)
}

/// Stage C Browserless Foundation: Queries Apple's `webPlayback` endpoint directly from Rust
/// to retrieve the encrypted HLS `.m3u8` asset stream URL and Widevine license server URLs.
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

    let payload = if clean_id.starts_with("i.") {
        serde_json::json!({ "universalLibraryId": clean_id })
    } else {
        serde_json::json!({ "salableAdamId": clean_id })
    };

    let json = apple_post_json(
        "https://play.music.apple.com/WebObjects/MZPlay.woa/wa/webPlayback",
        &dev_token,
        &user_token,
        &payload,
    )?;

    let song_obj = json
        .pointer("/songList/0")
        .ok_or_else(|| anyhow!("No songList entry returned by Apple webPlayback endpoint"))?;

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

    // Prefer 256kbps AAC-LC (`28:ctrp256`) or first available streamable asset
    let chosen = assets
        .iter()
        .find(|a| {
            a.get("flavor")
                .and_then(|v| v.as_str())
                .map(|f| f.contains("256"))
                .unwrap_or(false)
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

    Ok(AppleWebPlaybackAsset {
        song_id: clean_id.to_string(),
        flavor,
        hls_playlist_url,
        key_server_url,
        key_cert_url,
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
}
