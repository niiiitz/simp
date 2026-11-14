use super::DaemonIpcState;
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};

pub(super) async fn apple_playlists_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let db = state.db.clone();
    let res = tokio::task::spawn_blocking(move || {
        let mut playlists = simp_core::sinks::apple_api::fetch_cloud_playlists(&cfg)?;
        let cached_art = db.get_all_cached_apple_playlist_art();
        for pl in &mut playlists {
            let needs_heal = pl
                .art_url
                .as_deref()
                .map(|u| u.is_empty() || u.contains("blobstore.apple.com"))
                .unwrap_or(true);
            if needs_heal {
                if let Some(cached) = cached_art.get(&pl.id) {
                    pl.art_url = Some(cached.clone());
                }
            } else if let Some(ref valid_url) = pl.art_url {
                let _ = db.set_cached_apple_playlist_art(&pl.id, valid_url);
            }
        }
        Ok::<_, anyhow::Error>(playlists)
    })
    .await;
    match res {
        Ok(Ok(playlists)) => Json(serde_json::json!({ "ok": true, "data": playlists })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

pub(super) async fn apple_playlist_tracks_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let db = state.db.clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let kind = params.get("kind").cloned();
    let res = tokio::task::spawn_blocking(move || {
        let tracks =
            simp_core::sinks::apple_api::fetch_playlist_tracks(&cfg, &id, kind.as_deref())?;
        if let Some(first_art) = tracks
            .iter()
            .find_map(|t| t.art_url.as_deref())
            .filter(|u| !u.is_empty() && !u.contains("blobstore.apple.com"))
        {
            let _ = db.set_cached_apple_playlist_art(&id, first_art);
        }
        Ok::<_, anyhow::Error>(tracks)
    })
    .await;
    match res {
        Ok(Ok(tracks)) => Json(serde_json::json!({ "ok": true, "data": tracks })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

pub(super) async fn apple_playlist_cover_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let db = state.db.clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let kind = params.get("kind").cloned();
    let force = params.get("force").map(|v| v == "1").unwrap_or(false);
    let res = tokio::task::spawn_blocking(move || {
        if !force {
            if let Some(cached) = db
                .get_cached_apple_playlist_art(&id)
                .filter(|u| !u.is_empty() && !u.contains("blobstore.apple.com"))
            {
                return Some(cached);
            }
        }
        let fetched =
            simp_core::sinks::apple_api::fetch_playlist_cover_art(&cfg, &id, kind.as_deref());
        if let Some(ref url) = fetched {
            let _ = db.set_cached_apple_playlist_art(&id, url);
        }
        fetched
    })
    .await;
    match res {
        Ok(Some(art_url)) => Json(serde_json::json!({ "ok": true, "art_url": art_url })),
        _ => Json(serde_json::json!({ "ok": false, "art_url": serde_json::Value::Null })),
    }
}

pub(super) async fn apple_full_album_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let album_id = params.get("album_id").cloned();
    let song_uri = params.get("song_uri").cloned();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::fetch_full_album(
            &cfg,
            album_id.as_deref(),
            song_uri.as_deref(),
        )
    })
    .await;
    match res {
        Ok(Ok(bundle)) => Json(serde_json::json!({ "ok": true, "data": bundle })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

pub(super) async fn apple_radio_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::fetch_radio_and_for_you(&cfg)
    })
    .await;
    match res {
        Ok(Ok(feed)) => Json(serde_json::json!({ "ok": true, "data": feed })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

pub(super) async fn apple_library_recent_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::fetch_library_recently_added(&cfg)
    })
    .await;
    match res {
        Ok(Ok(albums)) => Json(serde_json::json!({ "ok": true, "data": albums })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

pub(super) async fn apple_new_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::fetch_new_feed(&cfg)
    })
    .await;
    match res {
        Ok(Ok(feed)) => Json(serde_json::json!({ "ok": true, "data": feed })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

pub(super) async fn apple_search_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let term = params.get("term").or_else(|| params.get("q")).cloned().unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::search_catalog(&cfg, &term)
    })
    .await;
    match res {
        Ok(Ok(results)) => Json(serde_json::json!({ "ok": true, "data": results })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

pub(super) async fn apple_artist_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id_or_name = params
        .get("id")
        .or_else(|| params.get("name"))
        .cloned()
        .unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::fetch_apple_artist_profile(&cfg, &id_or_name)
    })
    .await;
    match res {
        Ok(Ok(profile)) => Json(serde_json::json!({ "ok": true, "data": profile })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

pub(super) async fn apple_rate_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let kind = params
        .get("kind")
        .cloned()
        .unwrap_or_else(|| "songs".to_string());
    let favorited = params
        .get("favorited")
        .map(|v| v != "0" && v != "false")
        .unwrap_or(true);
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::set_apple_item_rating(&cfg, &id, &kind, favorited)
    })
    .await;
    match res {
        Ok(Ok(())) => Json(serde_json::json!({ "ok": true })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

pub(super) async fn apple_library_add_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let kind = params
        .get("kind")
        .cloned()
        .unwrap_or_else(|| "songs".to_string());
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::add_to_apple_cloud_library(&cfg, &id, &kind)
    })
    .await;
    match res {
        Ok(Ok(())) => Json(serde_json::json!({ "ok": true })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

pub(super) async fn apple_resolve_track_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let title = params.get("title").cloned();
    let artist = params.get("artist").cloned();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::resolve_replacement_catalog_song_id(
            &cfg,
            &id,
            title.as_deref(),
            artist.as_deref(),
        )
    })
    .await;
    match res {
        Ok(Ok(catalog_id)) => Json(serde_json::json!({ "ok": true, "catalog_id": catalog_id })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

pub(super) async fn apple_web_playback_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::fetch_web_playback_manifest(&cfg, &id)
    })
    .await;
    match res {
        Ok(Ok(asset)) => Json(serde_json::json!({ "ok": true, "data": asset })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

pub(super) async fn apple_native_probe_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_native::source::probe_apple_native_pipeline(&cfg, &id)
    })
    .await;
    match res {
        Ok(Ok(report)) => Json(serde_json::json!({ "ok": true, "data": report })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

