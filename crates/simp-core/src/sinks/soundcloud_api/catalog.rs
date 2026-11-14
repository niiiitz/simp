use super::*;
use anyhow::{anyhow, Result};
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::HashMap;

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
        gated_track_count: 0,
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

