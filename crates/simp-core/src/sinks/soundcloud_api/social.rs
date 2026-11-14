use super::*;
use anyhow::{anyhow, Result};
use serde_json::Value;
use simp_protocol::SimpSettings;
use std::time::{Duration, Instant};

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
            .or_else(|| item.pointer("/user/full_name").and_then(|v| v.as_str()))
            .or_else(|| item.pointer("/user/permalink").and_then(|v| v.as_str()))
            .unwrap_or("")
            .trim()
            .to_string();
        if username.is_empty()
            || username.eq_ignore_ascii_case("listener")
            || username.eq_ignore_ascii_case("anonymous")
            || username.eq_ignore_ascii_case("unknown")
            || username.eq_ignore_ascii_case("deleted")
        {
            continue;
        }
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
    let mut gated_track_count: usize = 0;
    let mut gated_playlist_count: usize = 0;
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
                if should_keep_track_for_session(&t, signed_in) {
                    if seen_track_uris.insert(t.uri.clone()) {
                        tracks.push(t);
                    }
                } else {
                    gated_track_count = gated_track_count.saturating_add(1);
                }
            } else {
                gated_track_count = gated_track_count.saturating_add(1);
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
            let obj = item.get("playlist").or_else(|| item.get("origin")).unwrap_or(item);
            let reported_pl_tracks = obj
                .get("track_count")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize)
                .unwrap_or(0);
            if let Some(mut pl) = map_soundcloud_item_to_playlist(item, "catalog_set") {
                if should_keep_playlist_for_session(&mut pl, signed_in) {
                    if seen_playlist_ids.insert(pl.id.clone()) {
                        gated_track_count = gated_track_count.saturating_add(pl.gated_track_count);
                        playlists.push(pl);
                    }
                } else {
                    gated_playlist_count = gated_playlist_count.saturating_add(1);
                    gated_track_count = gated_track_count.saturating_add(reported_pl_tracks.max(1));
                }
            } else if reported_pl_tracks > 0 {
                gated_playlist_count = gated_playlist_count.saturating_add(1);
                gated_track_count = gated_track_count.saturating_add(reported_pl_tracks);
            }
        }
    }

    // Also compare against `user.track_count` when all pages of `/users/{id}/tracks` were loaded
    if next_tracks_href.is_none() {
        if let Some(ref u) = user {
            if u.track_count > tracks.len() {
                let missing_from_profile = u.track_count.saturating_sub(tracks.len());
                if missing_from_profile > gated_track_count {
                    gated_track_count = missing_from_profile;
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
        gated_track_count,
        gated_playlist_count,
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

