use super::*;
use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

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

pub(crate) fn hydrate_v2_tracks_by_ids(track_ids: &[String], signed_in: bool) -> Vec<TrackMetadata> {
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

pub(crate) fn extract_next_href(json: &Value) -> Option<String> {
    json.get("next_href")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub(crate) fn soundcloud_get_json(url: &str, access_token: &str) -> Result<Value> {
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

pub(crate) fn extract_collection_items(json: &Value) -> Vec<&Value> {
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

