use super::*;
use anyhow::{anyhow, Result};
use serde_json::Value;
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::HashSet;

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
    for base_host in [
        "https://amp-api.music.apple.com",
        "https://api.music.apple.com",
    ] {
        let next_tracks_url = format!(
            "{base_host}/v1/me/stations/next-tracks/{}?limit={}",
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
                let tracks: Vec<TrackMetadata> =
                    arr.iter().filter_map(map_apple_item_to_track).collect();
                if !tracks.is_empty() {
                    return Ok(tracks);
                }
            }
        }
    }

    let storefront = get_storefront(&dev_token, &user_token);
    let raw_hint = station_title_hint
        .unwrap_or("")
        .trim_start_matches('📻')
        .trim();
    let lower_hint = raw_hint.to_lowercase();

    // Check if this is a Personal User Station (e.g. `ra.u-...`, `"[My Name]'s Station"`, `"Discovery Station"`).
    // Never search the public catalog for the user's literal name! Instead, synthesize a personalized
    // station queue from their personal mixes (`Favorites Mix`, `Get Up! Mix`, `New Music Mix`, `Chill Mix`),
    // recently played tracks, and personal Cloud Library songs.
    let is_personal_station = station_id.contains("u-")
        || lower_hint.contains("'s station")
        || lower_hint.contains("’s station")
        || lower_hint.contains("discovery station")
        || lower_hint.contains("personal station")
        || lower_hint.contains("my station");

    if is_personal_station {
        let mut personal_pool: Vec<TrackMetadata> = Vec::new();
        let mut seen_uris = HashSet::new();

        // 1. Pull tracks from the user's "Made For You" personal mix playlists (`Favorites Mix`, `Get Up! Mix`, etc.)
        if let Ok(rec_json) =
            apple_get_json("/v1/me/recommendations?limit=8", &dev_token, &user_token)
        {
            if let Some(arr) = rec_json.get("data").and_then(|v| v.as_array()) {
                let mut mix_playlist_ids = Vec::new();
                for rec in arr {
                    if let Some(contents) = rec
                        .pointer("/relationships/contents/data")
                        .and_then(|v| v.as_array())
                    {
                        for item in contents {
                            let item_type =
                                item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            if item_type == "playlists" || item_type == "library-playlists" {
                                if let Some(pid) = item.get("id").and_then(|v| v.as_str()) {
                                    mix_playlist_ids.push(pid.to_string());
                                }
                            }
                        }
                    }
                }
                for pid in mix_playlist_ids.into_iter().take(2) {
                    if let Ok(pl_tracks) = fetch_playlist_tracks(settings, &pid, Some("catalog")) {
                        for tr in pl_tracks.into_iter().take(20) {
                            if seen_uris.insert(tr.uri.clone()) {
                                personal_pool.push(tr);
                            }
                        }
                    }
                }
            }
        }

        // 2. Pull the user's Recently Played Apple Music tracks
        if let Ok(recent_json) = apple_get_json(
            "/v1/me/recent/played/tracks?limit=25",
            &dev_token,
            &user_token,
        ) {
            if let Some(arr) = recent_json.get("data").and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(tr) = map_apple_item_to_track(item) {
                        if seen_uris.insert(tr.uri.clone()) {
                            personal_pool.push(tr);
                        }
                    }
                }
            }
        }

        // 3. Pull songs from the user's personal Apple Music Cloud Library
        if let Ok(lib_json) = apple_get_json(
            "/v1/me/library/songs?include=catalog&limit=35",
            &dev_token,
            &user_token,
        ) {
            if let Some(arr) = lib_json.get("data").and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(tr) = map_apple_item_to_track(item) {
                        if seen_uris.insert(tr.uri.clone()) {
                            personal_pool.push(tr);
                        }
                    }
                }
            }
        }

        if !personal_pool.is_empty() {
            // Deterministic pseudo-random rotation seeded from wall-clock time so each tune-in feels fresh
            let seed = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as usize)
                .unwrap_or(7);
            let len = personal_pool.len();
            let mut rotated = Vec::with_capacity(len.min(safe_limit));
            let step = if len > 3 { (seed % (len - 1)).max(1) } else { 1 };
            for i in 0..len {
                let idx = (seed + i * step) % len;
                let candidate = &personal_pool[idx];
                if !rotated.iter().any(|t: &TrackMetadata| t.uri == candidate.uri) {
                    rotated.push(candidate.clone());
                    if rotated.len() >= safe_limit {
                        break;
                    }
                }
            }
            for tr in personal_pool {
                if rotated.len() >= safe_limit {
                    break;
                }
                if !rotated.iter().any(|t| t.uri == tr.uri) {
                    rotated.push(tr);
                }
            }
            if !rotated.is_empty() {
                return Ok(rotated);
            }
        }
    }

    // Fallback for global live broadcast stations (`isLive: true`, e.g. `ra.978194965` Apple Music 1,
    // Apple Music Hits, Apple Music Country, Apple Music Club, Apple Musica Uno, Apple Music Chill)
    // where `/v1/me/stations/next-tracks` returns empty `data: []`:
    // If it's "Apple Music 1" or no specific genre hint, try storefront Top Songs chart first
    if lower_hint.is_empty() || lower_hint.contains("apple music 1") || is_personal_station {
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
            // Yield 150ms so any immediate foreground request starts first before background queue resolution.
            std::thread::sleep(std::time::Duration::from_millis(150));
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

pub(crate) fn has_playable_cloud_or_widevine_asset(json: &Value) -> bool {
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

