use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use simp_core::{
    library::db::LibraryDatabase,
    orchestrator::{build_state_snapshot, OrchestratorSnapshot},
};
use simp_protocol::{
    AudioCommand, ClientEnvelope, LibraryQuery, PlaybackEvent, ServerEnvelope, SimpSettings,
};
use std::{
    net::SocketAddr,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::{broadcast, mpsc};
use tower_http::{cors::CorsLayer, services::ServeDir};

#[derive(Clone)]
pub struct DaemonIpcState {
    pub db: LibraryDatabase,
    pub settings: Arc<Mutex<SimpSettings>>,
    pub orchestrator_state: Arc<Mutex<OrchestratorSnapshot>>,
    pub cmd_tx: mpsc::UnboundedSender<AudioCommand>,
    pub broadcast_tx: broadcast::Sender<PlaybackEvent>,
    pub connected_clients: Arc<AtomicUsize>,
}

pub fn resolve_ui_dir() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(env_dir) = std::env::var("SIMP_UI_DIR") {
        candidates.push(PathBuf::from(env_dir));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("ui").join("dist"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("ui"));
            candidates.push(exe_dir.join("../ui"));
            candidates.push(exe_dir.join("../Resources/ui"));
            candidates.push(exe_dir.join("../../ui/dist"));
        }
    }
    if let Some(data_dir) = dirs::data_local_dir() {
        candidates.push(data_dir.join("simp").join("ui"));
    }

    candidates
        .into_iter()
        .find(|dir| dir.join("index.html").is_file())
}

pub fn detect_lan_ips() -> Vec<String> {
    let mut ips = Vec::new();

    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(local_addr) = sock.local_addr() {
                let ip = local_addr.ip().to_string();
                if !ip.starts_with("127.") && ip != "0.0.0.0" {
                    ips.push(ip);
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    if let Ok(out) = std::process::Command::new("hostname").arg("-I").output() {
        let text = String::from_utf8_lossy(&out.stdout);
        for token in text.split_whitespace() {
            if token.contains('.')
                && !token.starts_with("127.")
                && !token.starts_with("169.254.")
                && !ips.contains(&token.to_string())
            {
                ips.push(token.to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    for iface in ["en0", "en1"] {
        if let Ok(out) = std::process::Command::new("ipconfig")
            .args(["getifaddr", iface])
            .output()
        {
            let ip = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if ip.contains('.')
                && !ip.starts_with("127.")
                && !ip.starts_with("169.254.")
                && !ips.contains(&ip)
            {
                ips.push(ip);
            }
        }
    }

    ips
}

async fn no_cache_headers_middleware(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let is_art = req.uri().path().starts_with("/art/");
    let mut res = next.run(req).await;
    if !is_art {
        let headers = res.headers_mut();
        headers.insert(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("no-store, no-cache, must-revalidate, max-age=0"),
        );
        headers.insert(
            axum::http::header::PRAGMA,
            axum::http::HeaderValue::from_static("no-cache"),
        );
    }
    res
}

fn sync_soundcloud_tokens_into_daemon_state(state: &DaemonIpcState) {
    if let Ok(mut cfg) = state.settings.lock() {
        simp_core::sinks::soundcloud_api::sync_latest_soundcloud_tokens_into_settings(&mut cfg);
    }
}

pub async fn run_ipc_server(ipc_state: DaemonIpcState) -> anyhow::Result<()> {
    let sc_bg_state = ipc_state.clone();
    tokio::spawn(async move {
        // Wait 2s after startup to bootstrap SoundCloud Public Mode (or rotate OAuth token), then check every 10 minutes
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        loop {
            let cfg_snapshot = sc_bg_state.settings.lock().unwrap().clone();
            let creds = simp_core::sinks::soundcloud_api::resolve_soundcloud_credentials(&cfg_snapshot);
            if cfg_snapshot.services.soundcloud_enabled && !creds.client_id.is_empty() {
                let _ = tokio::task::spawn_blocking(move || {
                    let _ = simp_core::sinks::soundcloud_api::ensure_valid_access_token(&cfg_snapshot);
                })
                .await;
                sync_soundcloud_tokens_into_daemon_state(&sc_bg_state);
            }
            tokio::time::sleep(std::time::Duration::from_secs(600)).await;
        }
    });

    let art_cache_dir = simp_core::simp_art_cache_dir();
    let _ = std::fs::create_dir_all(&art_cache_dir);

    let mut app = Router::new()
        .route("/health", get(health_handler))
        .route("/api/v1/system/perf", get(system_perf_handler))
        .route("/api/system/perf", get(system_perf_handler))
        .route("/api/update/check", get(update_check_handler))
        .route("/api/update/channel", post(update_channel_handler))
        .route("/api/update/apply", post(update_apply_handler))
        .route("/api/v1/transport", post(transport_handler))
        .route("/api/apple/playlists", get(apple_playlists_handler))
        .route("/api/apple/library-recent", get(apple_library_recent_handler))
        .route("/api/apple/playlist-tracks", get(apple_playlist_tracks_handler))
        .route("/api/apple/playlist-cover", get(apple_playlist_cover_handler))
        .route("/api/apple/full-album", get(apple_full_album_handler))
        .route("/api/apple/radio", get(apple_radio_handler))
        .route("/api/apple/new", get(apple_new_handler))
        .route("/api/apple/search", get(apple_search_handler))
        .route("/api/apple/artist", get(apple_artist_handler))
        .route("/api/apple/rate", post(apple_rate_handler))
        .route("/api/apple/library-add", post(apple_library_add_handler))
        .route("/api/apple/resolve-track", get(apple_resolve_track_handler))
        .route("/api/apple/web-playback", get(apple_web_playback_handler))
        .route("/api/apple/native-probe", get(apple_native_probe_handler))
        .route("/api/apple/open", get(apple_open_handler))
        .route("/api/lyrics", get(lyrics_handler))
        .route("/api/lyrics/refetch", post(lyrics_refetch_handler))
        .route("/api/factoids", get(factoids_handler))
        .route("/api/factoids/refetch", post(factoids_refetch_handler))
        .route(
            "/api/library/track-properties",
            get(track_properties_get_handler).post(track_properties_post_handler),
        )
        .route("/api/library/facets", get(library_facets_handler))
        .route(
            "/api/library/playlists/convert-to-hybrid",
            post(convert_playlist_to_hybrid_handler),
        )
        .route("/api/library/purge-source", post(purge_source_handler))
        .route("/api/auth/probe", get(auth_probe_handler))
        .route("/api/fs/roots", get(fs_roots_handler))
        .route("/api/fs/list", get(fs_list_handler))
        .route("/api/fs/resolve-drop", post(fs_resolve_drop_handler))
        .route("/api/soundcloud/auth/start", get(soundcloud_auth_start_handler))
        .route("/api/soundcloud/callback", get(soundcloud_callback_handler))
        .route("/api/soundcloud/client-auth", post(soundcloud_client_auth_handler))
        .route("/api/soundcloud/playlists", get(soundcloud_playlists_handler))
        .route("/api/soundcloud/playlist-tracks", get(soundcloud_playlist_tracks_handler))
        .route("/api/soundcloud/stream", get(soundcloud_stream_handler))
        .route("/api/soundcloud/discover", get(soundcloud_discover_handler))
        .route("/api/soundcloud/paginate", get(soundcloud_paginate_handler))
        .route("/api/soundcloud/search", get(soundcloud_search_handler))
        .route("/api/soundcloud/comments", get(soundcloud_comments_handler))
        .route("/api/soundcloud/waveform", get(soundcloud_waveform_handler))
        .route("/api/audio/waveform", get(audio_waveform_handler))
        .route("/api/soundcloud/like", post(soundcloud_like_handler))
        .route("/api/soundcloud/like-playlist", post(soundcloud_like_playlist_handler))
        .route("/api/soundcloud/followings", get(soundcloud_followings_handler))
        .route("/api/soundcloud/user-tracks", get(soundcloud_user_tracks_handler))
        .route("/api/soundcloud/follow", post(soundcloud_follow_handler))
        .route("/api/soundcloud/open", get(soundcloud_open_handler))
        .route("/api/local/artist", get(local_artist_handler))
        .route("/api/history", get(history_get_handler).post(history_post_handler))
        .route("/api/favorites", get(favorites_get_handler).post(favorites_post_handler))
        .route("/api/ia/discover", get(ia_discover_handler))
        .route("/api/ia/item", get(ia_item_handler))
        .route("/api/ia/search", get(ia_search_handler))
        .route("/api/video/local", get(local_video_handler))
        .route("/api/video/ia_stream", get(ia_video_stream_handler))
        .route("/api/video/subtitles", get(video_subtitles_handler))
        .route("/api/dvd/stream", get(dvd_stream_handler))
        .route("/apple-worker", get(apple_worker_html_handler))
        .route("/ws", get(ws_handler))
        .nest_service("/art", ServeDir::new(art_cache_dir));

    if let Some(ui_dir) = resolve_ui_dir() {
        tracing::info!("Serving SIMP Console UI from {}", ui_dir.display());
        let index_file = ui_dir.join("index.html");
        app = app
            .route_service("/pair", tower_http::services::ServeFile::new(&index_file))
            .fallback_service(
                ServeDir::new(ui_dir)
                    .append_index_html_on_directories(true)
                    .not_found_service(tower_http::services::ServeFile::new(index_file)),
            );
    } else {
        tracing::warn!(
            "No production UI bundle (index.html) found; run `npm run build:ui` or set SIMP_UI_DIR"
        );
    }

    let initial_apple_auth = ipc_state
        .orchestrator_state
        .lock()
        .unwrap()
        .apple_authenticated;
    let app = app
        .layer(axum::middleware::from_fn(no_cache_headers_middleware))
        .layer(CorsLayer::permissive())
        .with_state(ipc_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 18888));
    let lan_ips = detect_lan_ips();
    if let Some(primary_ip) = lan_ips.first() {
        tracing::info!(
            "SIMP Daemon listening on http://127.0.0.1:18888 and LAN Companion http://{primary_ip}:18888/pair"
        );
    } else {
        tracing::info!("SIMP Daemon IPC, Art & UI Server listening on http://{addr}");
    }
    let mut bind_err = None;
    let mut listener_opt = None;
    for attempt in 0..25 {
        match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => {
                listener_opt = Some(l);
                break;
            }
            Err(e) => {
                bind_err = Some(e);
                if attempt < 24 {
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                }
            }
        }
    }
    let listener = match listener_opt {
        Some(l) => l,
        None => return Err(bind_err.unwrap().into()),
    };
    if initial_apple_auth {
        tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            if simp_core::sinks::apple::is_native_apple_cdm_preferred() {
                // Stage libwidevinecdm.so into ~/.local/share/simp/lib/ if present on disk
                let _ = simp_core::sinks::apple_native::cdm_host::discover_widevine_cdm_library();
            }
            simp_core::sinks::apple::AppleMusicSink::ensure_headless_widevine_worker();
        });
    }
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health_handler() -> impl IntoResponse {
    let ui_dir = resolve_ui_dir().map(|p| p.to_string_lossy().to_string());
    Json(serde_json::json!({
        "status": "ok",
        "service": "simp-daemon",
        "version": env!("CARGO_PKG_VERSION"),
        "pid": std::process::id(),
        "ui_served": ui_dir.is_some(),
        "ui_dir": ui_dir,
    }))
}

async fn apple_worker_html_handler() -> impl IntoResponse {
    if let Some(ui_dir) = resolve_ui_dir() {
        let index_path = ui_dir.join("index.html");
        if let Ok(raw) = std::fs::read_to_string(&index_path) {
            let worker_html = raw
                .replace(
                    "<title>IMP — Interactive Media Player</title>",
                    "<title>IMP Headless Audio Worker</title>",
                )
                .replace(
                    "<title>SIMP — Simple Integrated Media Player</title>",
                    "<title>IMP Headless Audio Worker</title>",
                );
            return axum::response::Html(worker_html);
        }
    }
    axum::response::Html(
        "<!DOCTYPE html><html><head><title>IMP Headless Audio Worker</title></head><body></body></html>"
            .to_string(),
    )
}

async fn system_perf_handler() -> impl IntoResponse {
    let snap = simp_core::sample_daemon_perf();
    Json(snap)
}

async fn update_check_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
    let channel = state
        .settings
        .lock()
        .unwrap()
        .provisioning
        .update_channel
        .clone();
    let res = tokio::task::spawn_blocking(simp_core::updater::check_for_updates).await;
    match res {
        Ok(Ok(status)) => Json(serde_json::json!({
            "ok": true,
            "current_version": status.current_version,
            "latest_version": status.latest_version,
            "latest_tag": status.latest_tag,
            "update_available": status.update_available,
            "release_url": status.release_url,
            "published_at": status.published_at,
            "target_arch": status.target_arch,
            "channel": status.channel,
        })),
        Ok(Err(e)) => Json(serde_json::json!({
            "ok": false,
            "current_version": env!("CARGO_PKG_VERSION"),
            "target_arch": std::env::consts::ARCH,
            "channel": channel,
            "error": e.to_string(),
        })),
        Err(e) => Json(serde_json::json!({
            "ok": false,
            "current_version": env!("CARGO_PKG_VERSION"),
            "target_arch": std::env::consts::ARCH,
            "channel": channel,
            "error": e.to_string(),
        })),
    }
}

#[derive(serde::Deserialize)]
struct UpdateChannelPayload {
    channel: String,
}

async fn update_channel_handler(
    State(state): State<DaemonIpcState>,
    Json(payload): Json<UpdateChannelPayload>,
) -> impl IntoResponse {
    let channel = if payload.channel.trim().eq_ignore_ascii_case("alpha") {
        "alpha".to_string()
    } else {
        "stable".to_string()
    };
    {
        let mut cfg = state.settings.lock().unwrap();
        cfg.provisioning.update_channel = channel.clone();
        let _ = crate::config::save_settings(&cfg);
    }
    Json(serde_json::json!({
        "ok": true,
        "channel": channel,
        "current_version": env!("CARGO_PKG_VERSION"),
        "target_arch": std::env::consts::ARCH,
    }))
}

#[derive(serde::Deserialize)]
struct TransportCommandPayload {
    command: String,
}

async fn transport_handler(
    State(state): State<DaemonIpcState>,
    Json(payload): Json<TransportCommandPayload>,
) -> impl IntoResponse {
    let cmd = match payload.command.as_str() {
        "toggle_play_pause" => Some(AudioCommand::TogglePlayPause),
        "play" => Some(AudioCommand::Play),
        "pause" => Some(AudioCommand::Pause),
        "next" => Some(AudioCommand::Next),
        "previous" => Some(AudioCommand::Previous),
        _ => None,
    };
    if let Some(c) = cmd {
        let _ = state.cmd_tx.send(c);
        Json(serde_json::json!({ "ok": true }))
    } else {
        Json(serde_json::json!({ "ok": false, "error": "Unknown transport command" }))
    }
}

async fn update_apply_handler() -> impl IntoResponse {
    let res = tokio::task::spawn_blocking(|| {
        simp_core::updater::apply_self_update(None, true, false)
    })
    .await;
    match res {
        Ok(Ok(applied)) => {
            // Schedule the daemon restart 450ms after returning the HTTP 200 OK response
            simp_core::updater::spawn_delayed_daemon_restart();
            Json(serde_json::json!({
                "ok": true,
                "status": "ok",
                "previous_version": applied.previous_version,
                "updated_version": applied.updated_version,
                "installed_version": applied.updated_version,
                "decky_updated": applied.decky_updated,
                "message": applied.message,
            }))
        }
        Ok(Err(e)) => Json(serde_json::json!({
            "ok": false,
            "status": "error",
            "error": e.to_string(),
        })),
        Err(e) => Json(serde_json::json!({
            "ok": false,
            "status": "error",
            "error": e.to_string(),
        })),
    }
}

async fn apple_playlists_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
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

async fn apple_playlist_tracks_handler(
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

async fn apple_playlist_cover_handler(
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

async fn apple_full_album_handler(
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

async fn apple_radio_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
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

async fn apple_library_recent_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
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

async fn apple_new_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
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

async fn apple_search_handler(
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

async fn apple_artist_handler(
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

async fn apple_rate_handler(
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

async fn apple_library_add_handler(
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

async fn apple_resolve_track_handler(
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

async fn apple_web_playback_handler(
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

async fn apple_native_probe_handler(
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

async fn soundcloud_auth_start_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
    let cfg = state.settings.lock().unwrap().clone();
    let redirect_override = params.get("redirect_uri").cloned();
    let wants_json = params.get("json").map(|v| v == "1").unwrap_or(false);

    match simp_core::sinks::soundcloud_api::start_oauth_pkce_flow(
        &cfg,
        redirect_override.as_deref(),
    ) {
        Ok((authorize_url, csrf_state)) => {
            if wants_json {
                Json(serde_json::json!({
                    "ok": true,
                    "authorize_url": authorize_url,
                    "state": csrf_state,
                }))
                .into_response()
            } else {
                axum::response::Redirect::temporary(&authorize_url).into_response()
            }
        }
        Err(e) => {
            if wants_json {
                Json(serde_json::json!({
                    "ok": false,
                    "error": e.to_string(),
                }))
                .into_response()
            } else {
                let html = format!(
                    "<!doctype html><html><head><meta charset='utf-8'><title>SIMP SoundCloud Auth Error</title></head>\
                     <body style='background:#050507;color:#fca5a5;font-family:system-ui,sans-serif;padding:40px;text-align:center'>\
                     <h2>☁️ SoundCloud Configuration Needed</h2><p>{}</p></body></html>",
                    e
                );
                axum::response::Html(html).into_response()
            }
        }
    }
}

async fn soundcloud_callback_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
    let cfg = state.settings.lock().unwrap().clone();
    let code = params.get("code").cloned().unwrap_or_default();
    let csrf_state = params.get("state").cloned();
    let redirect_override = params.get("redirect_uri").cloned();
    let wants_json = params.get("json").map(|v| v == "1").unwrap_or(false);

    if code.trim().is_empty() {
        let err_desc = params
            .get("error_description")
            .or_else(|| params.get("error"))
            .cloned()
            .unwrap_or_else(|| "Missing authorization code from SoundCloud callback".to_string());
        if wants_json {
            return Json(serde_json::json!({ "ok": false, "error": err_desc })).into_response();
        }
        let html = format!(
            "<!doctype html><html><head><meta charset='utf-8'><title>SoundCloud Sign-In Failed</title></head>\
             <body style='background:#050507;color:#fca5a5;font-family:system-ui,sans-serif;padding:40px;text-align:center'>\
             <h2>☁️ SoundCloud Sign-In Cancelled or Failed</h2><p>{err_desc}</p>\
             <p><a href='/' style='color:#ff5500'>Return to SIMP</a></p></body></html>"
        );
        return axum::response::Html(html).into_response();
    }

    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::exchange_oauth_code(
            &cfg,
            &code,
            csrf_state.as_deref(),
            redirect_override.as_deref(),
        )
    })
    .await;

    match res {
        Ok(Ok(bundle)) => {
            let _ = state.cmd_tx.send(AudioCommand::SetSoundCloudTokens {
                access_token: bundle.access_token.clone(),
                refresh_token: bundle.refresh_token.clone(),
                expires_at: bundle.expires_at,
                auth_mode: bundle.auth_mode.clone(),
                username: bundle.username.clone(),
            });
            let settings_clone = state.settings.clone();
            tokio::task::spawn_blocking(move || {
                std::thread::sleep(std::time::Duration::from_millis(30));
                let updated = settings_clone.lock().unwrap().clone();
                let _ = crate::config::save_settings(&updated);
            });

            if wants_json {
                return Json(serde_json::json!({
                    "ok": true,
                    "username": bundle.username,
                    "auth_mode": bundle.auth_mode,
                }))
                .into_response();
            }

            let uname_label = if bundle.username.is_empty() {
                "SoundCloud Account".to_string()
            } else {
                format!("@{}", bundle.username)
            };
            let html = format!(
                "<!doctype html><html><head><meta charset='utf-8'><title>SIMP SoundCloud Connected</title></head>\
                 <body style='background:#050507;color:#f4f4f6;font-family:system-ui,sans-serif;padding:48px 24px;text-align:center'>\
                 <div style='max-width:440px;margin:0 auto;padding:28px;border-radius:18px;background:#0d0d14;border:1px solid #ff5500'>\
                 <div style='font-size:42px;margin-bottom:12px'>☁️</div>\
                 <h2 style='margin:0 0 8px;color:#ff7733'>SoundCloud Connected!</h2>\
                 <p style='color:#a1a1aa;font-size:14px;margin:0 0 20px'>Signed in as <strong style='color:#f4f4f6'>{uname_label}</strong>. Your Likes, Sets, Stream &amp; Native 160kbps AAC playback are now active in SIMP.</p>\
                 <button onclick=\"if(window.opener){{window.close();}}else{{window.location.href='/';}}\" \
                   style='padding:12px 24px;border-radius:10px;background:#ff5500;color:#fff;border:none;font-weight:800;cursor:pointer;font-size:14px'>\
                   Return to SIMP Console\
                 </button>\
                 </div>\
                 <script>setTimeout(()=>{{if(window.opener){{window.close();}}else{{window.location.href='/';}}}}, 1800);</script>\
                 </body></html>"
            );
            axum::response::Html(html).into_response()
        }
        Ok(Err(e)) => {
            if wants_json {
                return Json(serde_json::json!({ "ok": false, "error": e.to_string() }))
                    .into_response();
            }
            let html = format!(
                "<!doctype html><html><head><meta charset='utf-8'><title>SoundCloud OAuth Error</title></head>\
                 <body style='background:#050507;color:#fca5a5;font-family:system-ui,sans-serif;padding:40px;text-align:center'>\
                 <h2>☁️ SoundCloud Token Exchange Failed</h2><p>{e}</p>\
                 <p><a href='/' style='color:#ff5500'>Return to SIMP</a></p></body></html>"
            );
            axum::response::Html(html).into_response()
        }
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })).into_response(),
    }
}

async fn soundcloud_client_auth_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let existing_creds = simp_core::sinks::soundcloud_api::resolve_soundcloud_credentials(&cfg);
    if !existing_creds.refresh_token.is_empty() {
        let cfg_for_refresh = cfg.clone();
        let _ = tokio::task::spawn_blocking(move || {
            let _ = simp_core::sinks::soundcloud_api::ensure_valid_access_token(&cfg_for_refresh);
        })
        .await;
        sync_soundcloud_tokens_into_daemon_state(&state);
        let refreshed = simp_core::sinks::soundcloud_api::resolve_soundcloud_credentials(
            &state.settings.lock().unwrap(),
        );
        return Json(serde_json::json!({
            "ok": true,
            "auth_mode": refreshed.auth_mode,
            "username": refreshed.username,
            "expires_at": refreshed.expires_at,
        }));
    }

    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::obtain_client_credentials_token(&cfg)
    })
    .await;
    match res {
        Ok(Ok(bundle)) => {
            let _ = state.cmd_tx.send(AudioCommand::SetSoundCloudTokens {
                access_token: bundle.access_token.clone(),
                refresh_token: bundle.refresh_token.clone(),
                expires_at: bundle.expires_at,
                auth_mode: bundle.auth_mode.clone(),
                username: bundle.username.clone(),
            });
            let settings_clone = state.settings.clone();
            tokio::task::spawn_blocking(move || {
                std::thread::sleep(std::time::Duration::from_millis(30));
                let updated = settings_clone.lock().unwrap().clone();
                let _ = crate::config::save_settings(&updated);
            });
            Json(serde_json::json!({
                "ok": true,
                "auth_mode": bundle.auth_mode,
                "username": bundle.username,
                "expires_at": bundle.expires_at,
            }))
        }
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_playlists_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::fetch_user_playlists_and_likes(&cfg)
    })
    .await;
    sync_soundcloud_tokens_into_daemon_state(&state);
    match res {
        Ok(Ok(data)) => Json(serde_json::json!({ "ok": true, "data": data })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_playlist_tracks_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::fetch_playlist_tracks(&cfg, &id)
    })
    .await;
    sync_soundcloud_tokens_into_daemon_state(&state);
    match res {
        Ok(Ok(tracks)) => Json(serde_json::json!({ "ok": true, "data": tracks })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_stream_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::fetch_stream_and_stations(&cfg)
    })
    .await;
    sync_soundcloud_tokens_into_daemon_state(&state);
    match res {
        Ok(Ok(feed)) => Json(serde_json::json!({ "ok": true, "data": feed })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_discover_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let genre = params.get("genre").cloned();
    let mixes_only = params
        .get("mixes_only")
        .map(|v| v == "1" || v == "true")
        .unwrap_or(false);
    let seed_uris: Vec<String> = state
        .db
        .get_play_history(Some("soundcloud"), 6)
        .unwrap_or_default()
        .into_iter()
        .map(|t| t.uri)
        .collect();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::fetch_trending_and_mixes_with_seeds(
            &cfg,
            genre.as_deref(),
            mixes_only,
            &seed_uris,
        )
    })
    .await;
    match res {
        Ok(Ok(feed)) => Json(serde_json::json!({ "ok": true, "data": feed })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_paginate_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let next_href = params.get("next_href").cloned().unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::fetch_soundcloud_next_page(&cfg, &next_href)
    })
    .await;
    match res {
        Ok(Ok(page)) => Json(serde_json::json!({ "ok": true, "data": page })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_search_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let term = params
        .get("term")
        .or_else(|| params.get("q"))
        .cloned()
        .unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::search_catalog(&cfg, &term)
    })
    .await;
    match res {
        Ok(Ok(results)) => Json(serde_json::json!({ "ok": true, "data": results })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_comments_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let db = state.db.clone();
    let id_for_db = id.clone();
    let res = tokio::task::spawn_blocking(move || {
        let res = simp_core::sinks::soundcloud_api::fetch_track_comments(&cfg, &id);
        if let Ok(ref list) = res {
            let uri_key = if id_for_db.starts_with("soundcloud://") {
                id_for_db
            } else {
                format!("soundcloud://track/{}", id_for_db.trim())
            };
            let _ = db.upsert_track_properties_patch(
                &uri_key,
                &simp_core::library::db::TrackPropertiesPatch {
                    has_comments: Some(!list.is_empty()),
                    ..Default::default()
                },
            );
        }
        res
    })
    .await;
    match res {
        Ok(Ok(comments)) => Json(serde_json::json!({ "ok": true, "data": comments })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string(), "data": [] })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string(), "data": [] })),
    }
}

async fn soundcloud_waveform_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::fetch_track_waveform(&cfg, &id)
    })
    .await;
    match res {
        Ok(Ok(wf)) => Json(serde_json::json!({ "ok": true, "data": wf })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn audio_waveform_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let uri = params
        .get("uri")
        .or_else(|| params.get("id"))
        .cloned()
        .unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::viz::resolve_waveform_envelope_180(&cfg, &uri)
    })
    .await;
    match res {
        Ok(bars) => Json(serde_json::json!({
            "ok": true,
            "data": {
                "uri": params.get("uri").cloned().unwrap_or_default(),
                "bars": bars,
            }
        })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_like_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let unlike = params
        .get("unlike")
        .or_else(|| params.get("action"))
        .map(|v| v == "1" || v == "true" || v == "unlike")
        .unwrap_or(false);
    let res = tokio::task::spawn_blocking(move || {
        if unlike {
            simp_core::sinks::soundcloud_api::unlike_soundcloud_track(&cfg, &id)
        } else {
            simp_core::sinks::soundcloud_api::like_soundcloud_track(&cfg, &id)
        }
    })
    .await;
    match res {
        Ok(Ok(())) => Json(serde_json::json!({ "ok": true })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_like_playlist_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let liked = params
        .get("liked")
        .map(|v| v != "0" && v != "false")
        .unwrap_or(true);
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::set_soundcloud_playlist_liked(&cfg, &id, liked)
    })
    .await;
    match res {
        Ok(Ok(())) => Json(serde_json::json!({ "ok": true })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_followings_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::fetch_user_followings(&cfg)
    })
    .await;
    match res {
        Ok(Ok(users)) => Json(serde_json::json!({ "ok": true, "data": users })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_user_tracks_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::fetch_user_profile_tracks(&cfg, &id)
    })
    .await;
    match res {
        Ok(Ok(profile)) => Json(serde_json::json!({ "ok": true, "data": profile })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_follow_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let follow = params
        .get("follow")
        .map(|v| v != "0" && v != "false")
        .unwrap_or(true);
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::set_soundcloud_user_followed(&cfg, &id, follow)
    })
    .await;
    match res {
        Ok(Ok(())) => Json(serde_json::json!({ "ok": true })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn soundcloud_open_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let kind = params
        .get("kind")
        .cloned()
        .unwrap_or_else(|| "track".to_string());
    let id = params.get("id").cloned().unwrap_or_default();
    let target_url = tokio::task::spawn_blocking(move || {
        simp_core::sinks::soundcloud_api::resolve_soundcloud_permalink_url(&cfg, &kind, &id)
    })
    .await
    .unwrap_or_else(|_| "https://soundcloud.com".to_string());
    axum::response::Redirect::temporary(&target_url)
}

async fn apple_open_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let kind = params
        .get("kind")
        .cloned()
        .unwrap_or_else(|| "song".to_string());
    let id = params.get("id").cloned().unwrap_or_default();
    let target_url = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::resolve_apple_canonical_url(&cfg, &kind, &id)
    })
    .await
    .unwrap_or_else(|_| "https://music.apple.com".to_string());
    axum::response::Redirect::temporary(&target_url)
}

async fn lyrics_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let uri = params.get("uri").cloned();
    let title = params.get("title").cloned().unwrap_or_default();
    let artist = params.get("artist").cloned().unwrap_or_default();
    let album = params.get("album").cloned();
    let duration_ms = params
        .get("duration_ms")
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);

    let db = state.db.clone();
    let res = tokio::task::spawn_blocking(move || {
        let props = uri
            .as_deref()
            .and_then(|u| db.get_track_properties(u).ok())
            .unwrap_or_default();
        if props.suppress_lyrics {
            let suppressed = simp_core::lyrics::TrackLyricsResponse {
                found: false,
                source: "suppressed".to_string(),
                ..Default::default()
            };
            return (suppressed, props);
        }

        let mut lyrics = simp_core::lyrics::fetch_track_lyrics(
            uri.as_deref(),
            &title,
            &artist,
            album.as_deref(),
            duration_ms,
        );
        if lyrics.found {
            if let Some(u) = uri.as_deref().filter(|s| !s.trim().is_empty()) {
                let has_synced = !lyrics.synced_lines.is_empty();
                let _ = db.record_indexed_track_capabilities(u, props.has_art, true, has_synced);
            }
            if props.lyrics_offset_ms != 0 && !lyrics.synced_lines.is_empty() {
                for line in &mut lyrics.synced_lines {
                    let shifted = (line.timestamp_ms as i64 + props.lyrics_offset_ms).max(0);
                    line.timestamp_ms = shifted as u32;
                }
            }
        }
        let updated_props = uri
            .as_deref()
            .and_then(|u| db.get_track_properties(u).ok())
            .unwrap_or(props);
        (lyrics, updated_props)
    })
    .await;

    match res {
        Ok((lyrics, props)) => Json(serde_json::json!({
            "ok": true,
            "data": lyrics,
            "properties": props,
        })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

#[derive(serde::Deserialize)]
struct LyricsRefetchBody {
    uri: Option<String>,
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: Option<u32>,
}

async fn lyrics_refetch_handler(
    State(state): State<DaemonIpcState>,
    Json(body): Json<LyricsRefetchBody>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let res = tokio::task::spawn_blocking(move || {
        let uri_ref = body.uri.as_deref().filter(|s| !s.trim().is_empty());
        let duration_ms = body.duration_ms.unwrap_or(0);
        // Clear any suppression flag when the user explicitly clicks [Refetch Lyrics]
        if let Some(u) = uri_ref {
            let _ = db.upsert_track_properties_patch(
                u,
                &simp_core::library::db::TrackPropertiesPatch {
                    suppress_lyrics: Some(false),
                    has_lyrics: Some(false),
                    has_synced_lyrics: Some(false),
                    ..Default::default()
                },
            );
        }
        let mut lyrics = simp_core::lyrics::refetch_track_lyrics(
            uri_ref,
            &body.title,
            &body.artist,
            body.album.as_deref(),
            duration_ms,
        );
        let props = if let Some(u) = uri_ref {
            let has_synced = !lyrics.synced_lines.is_empty();
            let patched = db
                .upsert_track_properties_patch(
                    u,
                    &simp_core::library::db::TrackPropertiesPatch {
                        has_lyrics: Some(lyrics.found),
                        has_synced_lyrics: Some(lyrics.found && has_synced),
                        suppress_lyrics: Some(false),
                        ..Default::default()
                    },
                )
                .unwrap_or_default();
            if patched.lyrics_offset_ms != 0 && !lyrics.synced_lines.is_empty() {
                for line in &mut lyrics.synced_lines {
                    let shifted = (line.timestamp_ms as i64 + patched.lyrics_offset_ms).max(0);
                    line.timestamp_ms = shifted as u32;
                }
            }
            patched
        } else {
            Default::default()
        };
        (lyrics, props)
    })
    .await;

    match res {
        Ok((lyrics, props)) => Json(serde_json::json!({
            "ok": true,
            "data": lyrics,
            "properties": props,
        })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn factoids_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let uri = params.get("uri").cloned().unwrap_or_default();
    let title = params.get("title").cloned().unwrap_or_default();
    let artist = params.get("artist").cloned().unwrap_or_default();
    let album = params.get("album").cloned().filter(|s| !s.trim().is_empty());
    let duration_ms: u32 = params
        .get("duration_ms")
        .and_then(|s| s.parse().ok())
        .unwrap_or(180_000);
    let db = state.db.clone();

    let res = tokio::task::spawn_blocking(move || {
        let uri_ref = if uri.trim().is_empty() {
            None
        } else {
            Some(uri.as_str())
        };
        if let Some(u) = uri_ref {
            if let Ok(props) = db.get_track_properties(u) {
                if props.suppress_factoids {
                    return simp_core::factoids::TrackFactoidsResponse {
                        found: false,
                        provider: "suppressed".to_string(),
                        bubbles: Vec::new(),
                    };
                }
            }
        }
        let factoids = simp_core::factoids::fetch_track_factoids(
            uri_ref,
            &title,
            &artist,
            album.as_deref(),
            duration_ms,
        );
        if let Some(u) = uri_ref {
            let _ = db.upsert_track_properties_patch(
                u,
                &simp_core::library::db::TrackPropertiesPatch {
                    has_factoids: Some(factoids.found),
                    ..Default::default()
                },
            );
        }
        factoids
    })
    .await;

    match res {
        Ok(data) => Json(serde_json::json!({ "ok": true, "data": data })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

#[derive(serde::Deserialize)]
struct FactoidsRefetchBody {
    uri: Option<String>,
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: Option<u32>,
}

async fn factoids_refetch_handler(
    State(state): State<DaemonIpcState>,
    Json(body): Json<FactoidsRefetchBody>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let res = tokio::task::spawn_blocking(move || {
        let uri_ref = body.uri.as_deref().filter(|s| !s.trim().is_empty());
        simp_core::factoids::clear_cached_factoids_for_track(
            uri_ref,
            &body.title,
            &body.artist,
            body.album.as_deref(),
        );
        let factoids = simp_core::factoids::fetch_track_factoids(
            uri_ref,
            &body.title,
            &body.artist,
            body.album.as_deref(),
            body.duration_ms.unwrap_or(180_000),
        );
        if let Some(u) = uri_ref {
            let _ = db.upsert_track_properties_patch(
                u,
                &simp_core::library::db::TrackPropertiesPatch {
                    has_factoids: Some(factoids.found),
                    suppress_factoids: Some(false),
                    ..Default::default()
                },
            );
        }
        factoids
    })
    .await;

    match res {
        Ok(data) => Json(serde_json::json!({ "ok": true, "data": data })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn track_properties_get_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let uri = params.get("uri").cloned().unwrap_or_default();
    if uri.trim().is_empty() {
        return Json(serde_json::json!({ "ok": false, "error": "Missing uri parameter" }));
    }
    match state.db.get_track_properties(&uri) {
        Ok(props) => Json(serde_json::json!({ "ok": true, "data": props })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

#[derive(serde::Deserialize)]
struct TrackPropertiesPostBody {
    uri: String,
    #[serde(flatten)]
    patch: simp_core::library::db::TrackPropertiesPatch,
}

async fn track_properties_post_handler(
    State(state): State<DaemonIpcState>,
    Json(body): Json<TrackPropertiesPostBody>,
) -> impl IntoResponse {
    if body.uri.trim().is_empty() {
        return Json(serde_json::json!({ "ok": false, "error": "Missing uri" }));
    }
    match state.db.upsert_track_properties_patch(&body.uri, &body.patch) {
        Ok(props) => Json(serde_json::json!({ "ok": true, "data": props })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn library_facets_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let facet = params.get("facet").cloned().unwrap_or_default();
    let uris = state.db.get_facet_matching_uris(&facet).unwrap_or_default();
    let tracks = state.db.get_facet_matching_tracks(&facet).unwrap_or_default();
    Json(serde_json::json!({
        "ok": true,
        "facet": facet,
        "uris": uris,
        "tracks": tracks,
    }))
}

#[derive(serde::Deserialize)]
struct ConvertToHybridBody {
    playlist_id: String,
}

async fn convert_playlist_to_hybrid_handler(
    State(state): State<DaemonIpcState>,
    Json(body): Json<ConvertToHybridBody>,
) -> impl IntoResponse {
    match state.db.convert_playlist_to_hybrid(&body.playlist_id) {
        Ok(converted) => {
            let (total_albums, total_tracks) = state.db.get_library_counts().unwrap_or((0, 0));
            let _ = state
                .broadcast_tx
                .send(simp_protocol::PlaybackEvent::LibraryUpdated {
                    total_albums,
                    total_tracks,
                });
            Json(serde_json::json!({ "ok": true, "converted": converted }))
        }
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

#[derive(serde::Deserialize)]
struct PurgeSourceBody {
    source: String,
}

async fn purge_source_handler(
    State(state): State<DaemonIpcState>,
    Json(body): Json<PurgeSourceBody>,
) -> impl IntoResponse {
    match state.db.purge_source_data(&body.source) {
        Ok(removed) => {
            let (total_albums, total_tracks) = state.db.get_library_counts().unwrap_or((0, 0));
            let _ = state
                .broadcast_tx
                .send(simp_protocol::PlaybackEvent::LibraryUpdated {
                    total_albums,
                    total_tracks,
                });
            Json(serde_json::json!({ "ok": true, "removed": removed }))
        }
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn auth_probe_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let res = tokio::task::spawn_blocking(move || {
        // 1. Apple Music check: only probe if user previously connected an Apple Music account
        let creds = simp_core::sinks::apple::AppleMusicSink::resolve_credentials(&cfg);
        let apple_configured = cfg.services.apple_music_enabled && creds.music_user_token.is_some();
        let mut apple_expired = false;
        let mut apple_reason: Option<String> = None;
        if apple_configured {
            let dev_tok = simp_core::sinks::apple::AppleMusicSink::get_or_sign_developer_token(&cfg)
                .unwrap_or_default();
            let mut_tok = creds.music_user_token.as_deref().unwrap_or("");
            if dev_tok.is_empty() {
                apple_expired = true;
                apple_reason = Some("Missing Apple Music developer token".to_string());
            } else {
                let auth_header = format!("Bearer {}", dev_tok);
                let headers = [
                    ("Authorization", auth_header.as_str()),
                    ("Music-User-Token", mut_tok),
                    ("Origin", "https://music.apple.com"),
                ];
                if let Err(e) = simp_core::http_pool::http_get_bytes(
                    "https://api.music.apple.com/v1/me/storefront",
                    &headers,
                    None,
                    6,
                ) {
                    let msg = e.to_string();
                    if msg.contains("401") || msg.contains("403") {
                        apple_expired = true;
                        apple_reason = Some(
                            "Apple Music user session token expired (HTTP 401/403)".to_string(),
                        );
                    }
                }
            }
        }

        // 2. SoundCloud check: if user had an OAuth session (`auth_mode == "user"` or non-empty refresh/access token),
        // `ensure_valid_access_token` attempts silent refresh first before reporting failure.
        let sc_user_mode = cfg.services.soundcloud_auth_mode == "user"
            || !cfg.services.soundcloud_username.trim().is_empty();
        let mut sc_expired = false;
        let mut sc_reason: Option<String> = None;
        if sc_user_mode {
            match simp_core::sinks::soundcloud_api::ensure_valid_access_token(&cfg) {
                Ok(_) => {}
                Err(e) => {
                    sc_expired = true;
                    sc_reason = Some(format!("SoundCloud session expired: {e}"));
                }
            }
        }

        // 3. Internet Archive check
        let ia_configured = cfg.services.internet_archive_enabled
            && !cfg.services.internet_archive_access_key.trim().is_empty()
            && !cfg.services.internet_archive_secret_key.trim().is_empty();
        let ia_expired = false;

        serde_json::json!({
            "apple": {
                "was_connected": apple_configured,
                "expired": apple_expired,
                "reason": apple_reason,
            },
            "soundcloud": {
                "was_connected": sc_user_mode,
                "expired": sc_expired,
                "reason": sc_reason,
                "username": cfg.services.soundcloud_username,
            },
            "ia": {
                "was_connected": ia_configured,
                "expired": ia_expired,
                "username": cfg.services.internet_archive_username,
            }
        })
    })
    .await;

    match res {
        Ok(data) => Json(serde_json::json!({ "ok": true, "data": data })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn fs_roots_handler() -> impl IntoResponse {
    let roots = tokio::task::spawn_blocking(|| {
        let mut list = Vec::new();
        if let Some(home) = dirs::home_dir() {
            list.push(serde_json::json!({
                "label": "Home Directory",
                "path": home.to_string_lossy().to_string(),
                "kind": "home"
            }));
            for (sub, label) in [("Music", "Music"), ("Downloads", "Downloads"), ("Videos", "Videos")] {
                let candidate = home.join(sub);
                if candidate.is_dir() {
                    list.push(serde_json::json!({
                        "label": label,
                        "path": candidate.to_string_lossy().to_string(),
                        "kind": "shortcut"
                    }));
                }
            }
        }

        #[cfg(target_os = "windows")]
        {
            for letter in b'C'..=b'Z' {
                let drive = format!("{}:\\", letter as char);
                if std::path::Path::new(&drive).is_dir() {
                    list.push(serde_json::json!({
                        "label": format!("Local Disk ({}:)", letter as char),
                        "path": drive,
                        "kind": "drive"
                    }));
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            if std::path::Path::new("/Volumes").is_dir() {
                list.push(serde_json::json!({
                    "label": "Volumes (/Volumes)",
                    "path": "/Volumes",
                    "kind": "drive"
                }));
            }
        }

        #[cfg(target_os = "linux")]
        {
            for mount_base in ["/run/media", "/media", "/mnt"] {
                let p = std::path::Path::new(mount_base);
                if p.is_dir() {
                    list.push(serde_json::json!({
                        "label": format!("Removable / Mounts ({mount_base})"),
                        "path": mount_base,
                        "kind": "drive"
                    }));
                }
            }
            list.push(serde_json::json!({
                "label": "Filesystem Root (/)",
                "path": "/",
                "kind": "root"
            }));
        }

        list
    })
    .await
    .unwrap_or_default();

    Json(serde_json::json!({ "ok": true, "roots": roots }))
}

fn clean_fs_path(p: &std::path::Path) -> std::path::PathBuf {
    let raw = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let cleaned = simp_core::library::vdf::strip_windows_verbatim_prefix(&raw.to_string_lossy());
    std::path::PathBuf::from(cleaned)
}

async fn fs_list_handler(
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let requested = params.get("path").cloned().unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || -> anyhow::Result<serde_json::Value> {
        let cleaned_req = simp_core::library::vdf::strip_windows_verbatim_prefix(&requested);
        let target_path = if cleaned_req.trim().is_empty() {
            dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/"))
        } else {
            std::path::PathBuf::from(cleaned_req.trim())
        };
        if !target_path.is_dir() {
            anyhow::bail!("Directory does not exist: {}", target_path.display());
        }
        let canonical = clean_fs_path(&target_path);
        let parent_path = canonical.parent().and_then(|p| {
            let s = simp_core::library::vdf::strip_windows_verbatim_prefix(&p.to_string_lossy());
            if s.is_empty() || s == canonical.to_string_lossy() {
                None
            } else {
                Some(s)
            }
        });

        let audio_exts = [
            "flac", "mp3", "wav", "m4a", "aac", "ogg", "opus", "aiff", "aif", "wma", "alac",
        ];
        let video_exts = ["mp4", "mkv", "webm", "mov", "avi", "m4v"];

        let mut directories = Vec::new();
        let mut media_file_count = 0usize;

        if let Ok(entries) = std::fs::read_dir(&canonical) {
            for entry in entries.flatten() {
                let path = clean_fs_path(&entry.path());
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                if path.is_dir() {
                    // Quick shallow count of media files directly inside the child directory
                    let mut child_media_count = 0usize;
                    if let Ok(sub_entries) = std::fs::read_dir(&path) {
                        for sub in sub_entries.flatten().take(250) {
                            if let Some(ext) = sub.path().extension().and_then(|e| e.to_str()) {
                                let lower = ext.to_ascii_lowercase();
                                if audio_exts.contains(&lower.as_str())
                                    || video_exts.contains(&lower.as_str())
                                {
                                    child_media_count += 1;
                                }
                            }
                        }
                    }
                    directories.push(serde_json::json!({
                        "name": name,
                        "path": path.to_string_lossy().to_string(),
                        "media_count": child_media_count,
                    }));
                } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    let lower = ext.to_ascii_lowercase();
                    if audio_exts.contains(&lower.as_str()) || video_exts.contains(&lower.as_str()) {
                        media_file_count += 1;
                    }
                }
            }
        }

        directories.sort_by(|a, b| {
            let na = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let nb = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
            na.to_lowercase().cmp(&nb.to_lowercase())
        });

        Ok(serde_json::json!({
            "current_path": canonical.to_string_lossy().to_string(),
            "parent_path": parent_path,
            "media_file_count": media_file_count,
            "directories": directories,
        }))
    })
    .await;

    match res {
        Ok(Ok(data)) => Json(serde_json::json!({ "ok": true, "data": data })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

#[derive(serde::Deserialize)]
struct FsResolveDropPayload {
    #[serde(default)]
    folder_name: Option<String>,
    #[serde(default)]
    child_name: Option<String>,
    #[serde(default)]
    file_name: Option<String>,
    #[serde(default)]
    file_size: Option<u64>,
    #[serde(default)]
    uri_hint: Option<String>,
}

async fn fs_resolve_drop_handler(
    State(state): State<DaemonIpcState>,
    Json(payload): Json<FsResolveDropPayload>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let res = tokio::task::spawn_blocking(move || -> Option<String> {
        let mounted_paths: Vec<std::path::PathBuf> = db
            .get_mounts()
            .unwrap_or_default()
            .into_iter()
            .map(|m| clean_fs_path(std::path::Path::new(&m.mount_root)))
            .collect();
        // 1. Check direct uri_hint first
        if let Some(hint) = payload
            .uri_hint
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let stripped_uri = hint
                .strip_prefix("file:///")
                .or_else(|| hint.strip_prefix("file://"))
                .unwrap_or(hint);
            let cleaned = simp_core::library::vdf::strip_windows_verbatim_prefix(stripped_uri);
            let p = std::path::Path::new(&cleaned);
            if p.is_dir() {
                return Some(clean_fs_path(p).to_string_lossy().to_string());
            } else if p.is_file() {
                if let Some(parent) = p.parent() {
                    return Some(clean_fs_path(parent).to_string_lossy().to_string());
                }
            }
        }

        // 2. Build candidate search roots
        let mut roots = Vec::new();
        if let Some(home) = dirs::home_dir() {
            for sub in ["Music", "Downloads", "Videos", "Desktop", "Documents"] {
                let p = clean_fs_path(&home.join(sub));
                if p.is_dir() && !roots.contains(&p) {
                    roots.push(p);
                }
            }
            let clean_home = clean_fs_path(&home);
            if clean_home.is_dir() && !roots.contains(&clean_home) {
                roots.push(clean_home);
            }
        }
        for mp in mounted_paths {
            if mp.is_dir() && !roots.contains(&mp) {
                roots.push(mp);
            }
        }
        for extra in ["/run/media", "/media", "/Volumes"] {
            let p = std::path::PathBuf::from(extra);
            if p.is_dir() {
                roots.push(p);
            }
        }

        let target_folder = payload
            .folder_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let target_child = payload
            .child_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let target_file = payload
            .file_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let target_size = payload.file_size;

        fn search_dir(
            dir: &std::path::Path,
            depth: usize,
            max_depth: usize,
            target_folder: Option<&str>,
            target_child: Option<&str>,
            target_file: Option<&str>,
            target_size: Option<u64>,
        ) -> Option<std::path::PathBuf> {
            if depth > max_depth {
                return None;
            }
            let entries = std::fs::read_dir(dir).ok()?;
            for entry in entries.flatten().take(400) {
                let path = entry.path();
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with('.') {
                    continue;
                }
                if path.is_dir() {
                    if let Some(tf) = target_folder {
                        if name_str.eq_ignore_ascii_case(tf) {
                            let child_ok = target_child
                                .map(|tc| path.join(tc).exists())
                                .unwrap_or(true);
                            let file_ok = target_file
                                .map(|sf| path.join(sf).exists())
                                .unwrap_or(true);
                            if child_ok && file_ok {
                                return Some(path);
                            }
                        }
                    }
                    if let Some(found) = search_dir(
                        &path,
                        depth + 1,
                        max_depth,
                        target_folder,
                        target_child,
                        target_file,
                        target_size,
                    ) {
                        return Some(found);
                    }
                } else if target_folder.is_none() {
                    if let Some(tfile) = target_file {
                        if name_str.eq_ignore_ascii_case(tfile) {
                            let size_ok = match target_size {
                                Some(sz) if sz > 0 => entry
                                    .metadata()
                                    .map(|m| m.len() == sz)
                                    .unwrap_or(true),
                                _ => true,
                            };
                            if size_ok {
                                if let Some(parent) = path.parent() {
                                    return Some(parent.to_path_buf());
                                }
                            }
                        }
                    }
                }
            }
            None
        }

        // First pass: strict match with child_name / file_name verification
        for root in &roots {
            if let Some(found) = search_dir(
                root,
                0,
                6,
                target_folder,
                target_child,
                target_file,
                target_size,
            ) {
                return Some(clean_fs_path(&found).to_string_lossy().to_string());
            }
        }
        // Second pass fallback if child_name was not matched directly
        if target_child.is_some() && target_folder.is_some() {
            for root in &roots {
                if let Some(found) = search_dir(root, 0, 6, target_folder, None, None, None) {
                    return Some(clean_fs_path(&found).to_string_lossy().to_string());
                }
            }
        }

        None
    })
    .await
    .ok()
    .flatten();

    Json(serde_json::json!({
        "ok": res.is_some(),
        "resolved_folder": res,
    }))
}

async fn dvd_stream_handler(
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
    let device = params
        .get("device")
        .cloned()
        .or_else(|| simp_core::sinks::cdda::find_optical_device(None))
        .unwrap_or_else(|| "/dev/sr0".to_string());
    let title = params
        .get("title")
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(1);
    let chapter = params
        .get("chapter")
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(1);
    let audio = params
        .get("audio")
        .and_then(|v| v.parse::<u8>().ok())
        .unwrap_or(0);
    let sub = params
        .get("sub")
        .filter(|v| !v.is_empty() && *v != "off")
        .and_then(|v| v.parse::<u8>().ok());
    let seek_ms = params
        .get("seek_ms")
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|&ms| ms > 0);

    let mut child = match simp_core::sinks::dvd::spawn_dvd_title_mp4_stream(
        &device, title, chapter, audio, sub, seek_ms,
    ) {
        Ok(c) => c,
        Err(e) => {
            return axum::response::Response::builder()
                .status(axum::http::StatusCode::SERVICE_UNAVAILABLE)
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({ "ok": false, "error": e.to_string() }).to_string(),
                ))
                .unwrap();
        }
    };

    let Some(mut stdout) = child.stdout.take() else {
        let _ = child.kill();
        return axum::response::Response::builder()
            .status(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
            .body(axum::body::Body::from("Missing ffmpeg stdout pipe"))
            .unwrap();
    };

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, std::io::Error>>(24);
    std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = vec![0u8; 32 * 1024];
        loop {
            match stdout.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.blocking_send(Ok(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.blocking_send(Err(e));
                    break;
                }
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    });

    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    });

    axum::response::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, "video/mp4")
        .body(axum::body::Body::from_stream(stream))
        .unwrap()
}

async fn local_artist_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let name = params
        .get("name")
        .or_else(|| params.get("id"))
        .cloned()
        .unwrap_or_default();
    let db = state.db.clone();
    let res = tokio::task::spawn_blocking(move || db.get_local_artist_profile(&name)).await;
    match res {
        Ok(Ok(profile)) => Json(serde_json::json!({ "ok": true, "data": profile })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn history_get_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let source = params
        .get("source")
        .cloned()
        .filter(|s| !s.trim().is_empty() && s != "all");
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(50);
    let db = state.db.clone();
    let res = tokio::task::spawn_blocking(move || {
        db.get_play_history(source.as_deref(), limit)
    })
    .await;
    match res {
        Ok(Ok(tracks)) => Json(serde_json::json!({ "ok": true, "data": tracks })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string(), "data": [] })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string(), "data": [] })),
    }
}

async fn history_post_handler(
    State(state): State<DaemonIpcState>,
    Json(track): Json<simp_protocol::TrackMetadata>,
) -> impl IntoResponse {
    let db = state.db.clone();
    let res = tokio::task::spawn_blocking(move || db.record_play_history(&track)).await;
    match res {
        Ok(Ok(())) => Json(serde_json::json!({ "ok": true })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn favorites_get_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
    let db = state.db.clone();
    let res = tokio::task::spawn_blocking(move || {
        let uris = db.get_favorited_uris().unwrap_or_default();
        let tracks = db.get_favorited_tracks(None).unwrap_or_default();
        (uris, tracks)
    })
    .await;
    match res {
        Ok((uris, tracks)) => Json(serde_json::json!({
            "ok": true,
            "uris": uris,
            "tracks": tracks,
        })),
        Err(e) => Json(serde_json::json!({
            "ok": false,
            "error": e.to_string(),
            "uris": [],
            "tracks": [],
        })),
    }
}

async fn favorites_post_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
    Json(track): Json<simp_protocol::TrackMetadata>,
) -> impl IntoResponse {
    let favorited = params
        .get("favorited")
        .map(|v| v != "0" && v != "false")
        .unwrap_or(true);
    let db = state.db.clone();
    let res = tokio::task::spawn_blocking(move || db.set_track_favorited(&track, favorited)).await;
    match res {
        Ok(Ok(is_fav)) => Json(serde_json::json!({ "ok": true, "favorited": is_fav })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn ia_discover_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let hub = params
        .get("hub")
        .cloned()
        .unwrap_or_else(|| "trending".to_string());
    let sub = params.get("sub").cloned();
    let page = params
        .get("page")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::internet_archive_api::fetch_discover_hub_paged(
            &cfg,
            &hub,
            sub.as_deref(),
            page,
        )
    })
    .await;
    match res {
        Ok(Ok((items, has_more))) => Json(serde_json::json!({
            "ok": true,
            "items": items,
            "data": items,
            "page": page,
            "has_more": has_more
        })),
        Ok(Err(e)) => Json(serde_json::json!({
            "ok": false,
            "error": e.to_string(),
            "items": [],
            "data": [],
            "page": page,
            "has_more": false
        })),
        Err(e) => Json(serde_json::json!({
            "ok": false,
            "error": e.to_string(),
            "items": [],
            "data": [],
            "page": page,
            "has_more": false
        })),
    }
}

async fn ia_item_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let id = params.get("id").cloned().unwrap_or_default();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::internet_archive_api::fetch_item_detail(&cfg, &id)
    })
    .await;
    match res {
        Ok(Ok(detail)) => Json(serde_json::json!({ "ok": true, "detail": detail, "data": detail })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
    }
}

async fn ia_search_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let cfg = state.settings.lock().unwrap().clone();
    let q = params.get("q").cloned().unwrap_or_default();
    let mediatype = params.get("mediatype").cloned();
    let page = params
        .get("page")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(1)
        .max(1);
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::internet_archive_api::search_catalog_paged(
            &cfg,
            &q,
            mediatype.as_deref(),
            page,
        )
    })
    .await;
    match res {
        Ok(Ok((items, has_more))) => Json(serde_json::json!({
            "ok": true,
            "items": items,
            "data": items,
            "page": page,
            "has_more": has_more
        })),
        Ok(Err(e)) => Json(serde_json::json!({
            "ok": false,
            "error": e.to_string(),
            "items": [],
            "data": [],
            "page": page,
            "has_more": false
        })),
        Err(e) => Json(serde_json::json!({
            "ok": false,
            "error": e.to_string(),
            "items": [],
            "data": [],
            "page": page,
            "has_more": false
        })),
    }
}

fn stream_ffmpeg_child_response(mut child: std::process::Child) -> axum::response::Response {
    let Some(mut stdout) = child.stdout.take() else {
        let _ = child.kill();
        return axum::response::Response::builder()
            .status(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
            .body(axum::body::Body::from("Missing ffmpeg stdout pipe"))
            .unwrap();
    };

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, std::io::Error>>(24);
    std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = vec![0u8; 32 * 1024];
        loop {
            match stdout.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.blocking_send(Ok(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.blocking_send(Err(e));
                    break;
                }
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    });

    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    });

    axum::response::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, "video/mp4")
        .body(axum::body::Body::from_stream(stream))
        .unwrap()
}

async fn ia_video_stream_handler(
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
    let id = params.get("id").cloned().unwrap_or_default();
    let file = params.get("file").cloned().unwrap_or_default();
    let direct_url = params.get("url").cloned();
    let seek_ms = params
        .get("seek_ms")
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|&ms| ms > 0);

    let target_url = if let Some(u) = direct_url.filter(|u| u.starts_with("http://") || u.starts_with("https://")) {
        u
    } else if !id.is_empty() && !file.is_empty() {
        format!(
            "https://archive.org/download/{}/{}",
            simp_core::sinks::internet_archive_api::url_encode_component(&id),
            simp_core::sinks::internet_archive_api::url_encode_path_preserve_slashes(&file)
        )
    } else {
        return axum::response::Response::builder()
            .status(axum::http::StatusCode::BAD_REQUEST)
            .body(axum::body::Body::from("Missing id/file or url"))
            .unwrap();
    };

    match simp_core::sinks::dvd::spawn_generic_video_mp4_stream(&target_url, seek_ms) {
        Ok(child) => stream_ffmpeg_child_response(child),
        Err(e) => axum::response::Response::builder()
            .status(axum::http::StatusCode::SERVICE_UNAVAILABLE)
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(
                serde_json::json!({ "ok": false, "error": e.to_string() }).to_string(),
            ))
            .unwrap(),
    }
}

async fn local_video_handler(
    Query(params): Query<std::collections::HashMap<String, String>>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let raw_path = params.get("path").cloned().unwrap_or_default();
    let clean_path = raw_path
        .strip_prefix("video://local/")
        .or_else(|| raw_path.strip_prefix("file://"))
        .unwrap_or(&raw_path)
        .to_string();
    let want_meta = params.get("meta").map(|v| v == "1").unwrap_or(false);
    let want_transcode = params.get("transcode").map(|v| v == "1" || v == "true").unwrap_or(false);
    let seek_ms = params
        .get("seek_ms")
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|&ms| ms > 0);
    let path_buf = simp_core::library::vdf::normalize_platform_path(&clean_path);

    if want_meta {
        let ep = simp_core::sinks::internet_archive_api::build_local_video_episode(&path_buf, 1);
        return Json(serde_json::json!({ "ok": true, "episodes": [ep], "data": ep })).into_response();
    }

    if !path_buf.is_file() {
        return axum::response::Response::builder()
            .status(axum::http::StatusCode::NOT_FOUND)
            .body(axum::body::Body::from("Video file not found"))
            .unwrap();
    }

    if want_transcode {
        let input_str = path_buf.to_string_lossy().to_string();
        return match simp_core::sinks::dvd::spawn_generic_video_mp4_stream(&input_str, seek_ms) {
            Ok(child) => stream_ffmpeg_child_response(child),
            Err(e) => axum::response::Response::builder()
                .status(axum::http::StatusCode::SERVICE_UNAVAILABLE)
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    serde_json::json!({ "ok": false, "error": e.to_string() }).to_string(),
                ))
                .unwrap(),
        };
    }

    match tower_http::services::ServeFile::new(path_buf)
        .try_call(req)
        .await
    {
        Ok(resp) => resp.into_response(),
        Err(e) => axum::response::Response::builder()
            .status(axum::http::StatusCode::INTERNAL_SERVER_ERROR)
            .body(axum::body::Body::from(e.to_string()))
            .unwrap(),
    }
}

async fn video_subtitles_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
    let cfg = state.settings.lock().unwrap().clone();
    let source = params.get("source").cloned().unwrap_or_default();
    let id = params.get("id").cloned().unwrap_or_default();
    let file = params.get("file").cloned().unwrap_or_default();
    let src_url = params.get("url").cloned();
    let src_path = params.get("path").cloned();
    let res = tokio::task::spawn_blocking(move || -> anyhow::Result<String> {
        let raw_text = if source == "local" && !file.is_empty() {
            let norm = simp_core::library::vdf::normalize_platform_path(&file);
            std::fs::read_to_string(norm)?
        } else if let Some(p) = src_path {
            let norm = simp_core::library::vdf::normalize_platform_path(&p);
            std::fs::read_to_string(norm)?
        } else if source == "ia" && !id.is_empty() && !file.is_empty() {
            let creds =
                simp_core::sinks::internet_archive_api::resolve_internet_archive_credentials(&cfg);
            let dl_url = format!(
                "https://archive.org/download/{}/{}",
                simp_core::sinks::internet_archive_api::url_encode_component(&id),
                simp_core::sinks::internet_archive_api::url_encode_path_preserve_slashes(&file)
            );
            simp_core::sinks::internet_archive_api::ia_http_get_text(&creds, &dl_url)?
        } else if let Some(u) = src_url {
            let creds =
                simp_core::sinks::internet_archive_api::resolve_internet_archive_credentials(&cfg);
            simp_core::sinks::internet_archive_api::ia_http_get_text(&creds, &u)?
        } else {
            anyhow::bail!("Missing subtitle url or path");
        };
        Ok(simp_core::sinks::internet_archive_api::convert_srt_to_webvtt(&raw_text))
    })
    .await;

    match res {
        Ok(Ok(vtt)) => axum::response::Response::builder()
            .status(axum::http::StatusCode::OK)
            .header(axum::http::header::CONTENT_TYPE, "text/vtt; charset=utf-8")
            .body(axum::body::Body::from(vtt))
            .unwrap(),
        _ => axum::response::Response::builder()
            .status(axum::http::StatusCode::NOT_FOUND)
            .header(axum::http::header::CONTENT_TYPE, "text/vtt; charset=utf-8")
            .body(axum::body::Body::from("WEBVTT\n\n"))
            .unwrap(),
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<DaemonIpcState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_client(socket, state))
}

async fn handle_ws_client(socket: WebSocket, state: DaemonIpcState) {
    state.connected_clients.fetch_add(1, Ordering::SeqCst);

    let (mut ws_tx, mut ws_rx) = socket.split();
    let mut bcast_rx = state.broadcast_tx.subscribe();

    // 1. Immediately hydrate the newly connected client with a single-frame StateSnapshot
    let snapshot = build_state_snapshot(&state.orchestrator_state, &state.db);
    if let Ok(json) = serde_json::to_string(&snapshot) {
        let _ = ws_tx.send(Message::Text(json)).await;
    }

    let (direct_tx, mut direct_rx) = mpsc::unbounded_channel::<String>();

    // Outbound task: forwards both broadcast PlaybackEvents and targeted QueryResponses
    let outbound_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(json) = direct_rx.recv() => {
                    if ws_tx.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                }
                Ok(evt) = bcast_rx.recv() => {
                    let env = ServerEnvelope::Event { event: evt };
                    if let Ok(json) = serde_json::to_string(&env) {
                        if ws_tx.send(Message::Text(json)).await.is_err() {
                            break;
                        }
                    }
                }
                else => break,
            }
        }
    });

    // Inbound loop: processes ClientEnvelope Commands and Queries
    while let Some(Ok(msg)) = ws_rx.next().await {
        if let Message::Text(text) = msg {
            if let Ok(envelope) = serde_json::from_str::<ClientEnvelope>(&text) {
                match envelope {
                    ClientEnvelope::Command { command } => {
                        let persist = matches!(
                            command,
                            AudioCommand::SetVolume { .. }
                                | AudioCommand::SetBrightness { .. }
                                | AudioCommand::AddLibraryPath { .. }
                                | AudioCommand::RemoveLibraryPath { .. }
                                | AudioCommand::ConfigureAppleMusic { .. }
                                | AudioCommand::SetAppleMusicUserToken { .. }
                                | AudioCommand::DisconnectAppleMusic
                                | AudioCommand::ConfigureSoundCloud { .. }
                                | AudioCommand::SetSoundCloudTokens { .. }
                                | AudioCommand::DisconnectSoundCloud
                                | AudioCommand::ConfigureInternetArchive { .. }
                                | AudioCommand::DisconnectInternetArchive
                                | AudioCommand::FactoryReset
                        );
                        let _ = state.cmd_tx.send(command);
                        if persist {
                            let settings_clone = state.settings.clone();
                            tokio::task::spawn_blocking(move || {
                                std::thread::sleep(std::time::Duration::from_millis(25));
                                let cfg = settings_clone.lock().unwrap().clone();
                                let _ = crate::config::save_settings(&cfg);
                            });
                        }
                    }
                    ClientEnvelope::Query { req_id, query } => {
                        let state_clone = state.clone();
                        let direct_tx_clone = direct_tx.clone();
                        if matches!(query, LibraryQuery::ScanOpticalDisc { .. }) {
                            tokio::task::spawn_blocking(move || {
                                let resp = execute_query(req_id, query, &state_clone);
                                if let Ok(json) = serde_json::to_string(&resp) {
                                    let _ = direct_tx_clone.send(json);
                                }
                            });
                        } else {
                            let resp = execute_query(req_id, query, &state);
                            if let Ok(json) = serde_json::to_string(&resp) {
                                let _ = direct_tx.send(json);
                            }
                        }
                    }
                    ClientEnvelope::AppleWorkerEvent {
                        state: worker_state,
                        track,
                        position_ms,
                        duration_ms,
                    } => {
                        let _ = state.cmd_tx.send(AudioCommand::AppleWorkerReport {
                            state: worker_state,
                            track,
                            position_ms,
                            duration_ms,
                        });
                    }
                }
            }
        }
    }

    outbound_task.abort();
    state.connected_clients.fetch_sub(1, Ordering::SeqCst);
}

fn execute_query(req_id: u64, query: LibraryQuery, state: &DaemonIpcState) -> ServerEnvelope {
    match query {
        LibraryQuery::GetStateSnapshot => {
            build_state_snapshot(&state.orchestrator_state, &state.db)
        }
        LibraryQuery::GetAlbums {
            source,
            mount_root,
            search,
            limit,
            offset,
        } => match state.db.get_albums_filtered(
            source.as_deref(),
            mount_root.as_deref(),
            search.as_deref(),
            limit.max(1).min(2000),
            offset,
        ) {
            Ok(albums) => ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::to_value(albums).unwrap_or_default(),
                error: None,
            },
            Err(e) => ServerEnvelope::QueryResponse {
                req_id,
                ok: false,
                data: serde_json::Value::Null,
                error: Some(e.to_string()),
            },
        },
        LibraryQuery::GetAlbumTracks { album_id } => match state.db.get_album_tracks(&album_id) {
            Ok(tracks) => ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::to_value(tracks).unwrap_or_default(),
                error: None,
            },
            Err(e) => ServerEnvelope::QueryResponse {
                req_id,
                ok: false,
                data: serde_json::Value::Null,
                error: Some(e.to_string()),
            },
        },
        LibraryQuery::GetTracks {
            source,
            mount_root,
            search,
            limit,
            offset,
        } => match state.db.get_tracks_filtered(
            source.as_deref(),
            mount_root.as_deref(),
            search.as_deref(),
            limit.max(1).min(5000),
            offset,
        ) {
            Ok(tracks) => ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::to_value(tracks).unwrap_or_default(),
                error: None,
            },
            Err(e) => ServerEnvelope::QueryResponse {
                req_id,
                ok: false,
                data: serde_json::Value::Null,
                error: Some(e.to_string()),
            },
        },
        LibraryQuery::GetPlaylists => match state.db.get_playlists() {
            Ok(playlists) => ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::to_value(playlists).unwrap_or_default(),
                error: None,
            },
            Err(e) => ServerEnvelope::QueryResponse {
                req_id,
                ok: false,
                data: serde_json::Value::Null,
                error: Some(e.to_string()),
            },
        },
        LibraryQuery::GetPlaylistItems {
            playlist_id,
            limit,
            offset,
        } => match state
            .db
            .get_playlist_items(&playlist_id, limit.max(1).min(500), offset)
        {
            Ok(items) => ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::to_value(items).unwrap_or_default(),
                error: None,
            },
            Err(e) => ServerEnvelope::QueryResponse {
                req_id,
                ok: false,
                data: serde_json::Value::Null,
                error: Some(e.to_string()),
            },
        },
        LibraryQuery::CreatePlaylist { name, description } => {
            match state.db.create_playlist(&name, &description) {
                Ok(playlist) => ServerEnvelope::QueryResponse {
                    req_id,
                    ok: true,
                    data: serde_json::to_value(playlist).unwrap_or_default(),
                    error: None,
                },
                Err(e) => ServerEnvelope::QueryResponse {
                    req_id,
                    ok: false,
                    data: serde_json::Value::Null,
                    error: Some(e.to_string()),
                },
            }
        }
        LibraryQuery::AddTracksToPlaylist { playlist_id, uris } => {
            match state.db.add_tracks_to_playlist(&playlist_id, &uris) {
                Ok(new_count) => ServerEnvelope::QueryResponse {
                    req_id,
                    ok: true,
                    data: serde_json::json!({ "playlist_id": playlist_id, "track_count": new_count }),
                    error: None,
                },
                Err(e) => ServerEnvelope::QueryResponse {
                    req_id,
                    ok: false,
                    data: serde_json::Value::Null,
                    error: Some(e.to_string()),
                },
            }
        }
        LibraryQuery::RemoveTrackFromPlaylist {
            playlist_id,
            track_uri,
        } => match state.db.remove_track_from_playlist(&playlist_id, &track_uri) {
            Ok(new_count) => ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::json!({ "playlist_id": playlist_id, "track_count": new_count }),
                error: None,
            },
            Err(e) => ServerEnvelope::QueryResponse {
                req_id,
                ok: false,
                data: serde_json::Value::Null,
                error: Some(e.to_string()),
            },
        },
        LibraryQuery::DeletePlaylist { playlist_id } => {
            match state.db.delete_playlist(&playlist_id) {
                Ok(()) => ServerEnvelope::QueryResponse {
                    req_id,
                    ok: true,
                    data: serde_json::json!({ "deleted": playlist_id }),
                    error: None,
                },
                Err(e) => ServerEnvelope::QueryResponse {
                    req_id,
                    ok: false,
                    data: serde_json::Value::Null,
                    error: Some(e.to_string()),
                },
            }
        }
        LibraryQuery::DeleteAlbum { album_id } => match state.db.delete_album(&album_id) {
            Ok(()) => ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::json!({ "deleted": album_id }),
                error: None,
            },
            Err(e) => ServerEnvelope::QueryResponse {
                req_id,
                ok: false,
                data: serde_json::Value::Null,
                error: Some(e.to_string()),
            },
        },
        LibraryQuery::GetMountRoots => match state.db.get_mounts() {
            Ok(mounts) => ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::to_value(mounts).unwrap_or_default(),
                error: None,
            },
            Err(e) => ServerEnvelope::QueryResponse {
                req_id,
                ok: false,
                data: serde_json::Value::Null,
                error: Some(e.to_string()),
            },
        },
        LibraryQuery::GetSettings => {
            let cfg = state.settings.lock().unwrap().clone();
            ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::to_value(cfg).unwrap_or_default(),
                error: None,
            }
        }
        LibraryQuery::GetAppleMusicAuthConfig => {
            let cfg = state.settings.lock().unwrap().clone();
            let creds = simp_core::sinks::apple::AppleMusicSink::resolve_credentials(&cfg);
            let has_private_key = creds.private_key_pem.is_some();
            let (dev_token, status_error) =
                match simp_core::sinks::apple::AppleMusicSink::get_or_sign_developer_token(&cfg) {
                    Ok(tok) => (Some(tok), None),
                    Err(e) => (None, Some(e.to_string())),
                };
            let apple_authenticated = creds.music_user_token.is_some();
            let headless_worker_active = if apple_authenticated {
                simp_core::sinks::apple::AppleMusicSink::ensure_headless_widevine_worker()
            } else {
                simp_core::sinks::apple::AppleMusicSink::is_headless_worker_active()
            };

            let lan_ips = detect_lan_ips();
            let lan_ip = lan_ips.first().cloned();
            let pair_url = lan_ip
                .as_ref()
                .map(|ip| format!("http://{ip}:18888/pair"))
                .unwrap_or_else(|| "http://steamdeck.local:18888/pair".to_string());

            ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::json!({
                    "configured": dev_token.is_some(),
                    "team_id": creds.team_id,
                    "key_id": creds.key_id,
                    "private_key_path": creds.private_key_path,
                    "has_private_key": has_private_key,
                    "developer_token": dev_token,
                    "music_user_token": creds.music_user_token,
                    "apple_authenticated": apple_authenticated,
                    "headless_worker_active": headless_worker_active,
                    "lan_ip": lan_ip,
                    "lan_ips": lan_ips,
                    "pair_url": pair_url,
                    "status_error": status_error,
                }),
                error: None,
            }
        }
        LibraryQuery::GetSoundCloudAuthConfig => {
            let cfg = state.settings.lock().unwrap().clone();
            let creds = simp_core::sinks::soundcloud_api::resolve_soundcloud_credentials(&cfg);
            let configured = !creds.client_id.is_empty();
            let has_token = !creds.access_token.is_empty();
            let soundcloud_authenticated = has_token || configured;
            let is_personal_user = creds.auth_mode == "user"
                && !creds.username.is_empty()
                && creds.username != "Public Discovery (Client Credentials)";
            let auth_mode = if is_personal_user {
                "user".to_string()
            } else if !creds.auth_mode.is_empty() && creds.auth_mode != "user" {
                creds.auth_mode.clone()
            } else if configured || has_token {
                "client_credentials".to_string()
            } else {
                String::new()
            };

            let lan_ips = detect_lan_ips();
            let lan_ip = lan_ips.first().cloned();
            let pair_url = lan_ip
                .as_ref()
                .map(|ip| format!("http://{ip}:18888/pair"))
                .unwrap_or_else(|| "http://steamdeck.local:18888/pair".to_string());

            let status_error = if !configured && !has_token {
                Some("SoundCloud is not configured".to_string())
            } else {
                None
            };

            ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::json!({
                    "configured": configured,
                    "client_id": creds.client_id,
                    "has_client_secret": configured,
                    "soundcloud_authenticated": soundcloud_authenticated,
                    "auth_mode": auth_mode,
                    "username": creds.username,
                    "api_v2": false,
                    "redirect_uri": simp_core::sinks::soundcloud_api::SOUNDCLOUD_DEFAULT_REDIRECT_URI,
                    "lan_ip": lan_ip,
                    "lan_ips": lan_ips,
                    "pair_url": pair_url,
                    "status_error": status_error,
                }),
                error: None,
            }
        }
        LibraryQuery::GetInternetArchiveConfig => {
            let cfg = state.settings.lock().unwrap().clone();
            let ia = simp_core::sinks::internet_archive_api::resolve_ia_config(&cfg);
            ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::json!({
                    "enabled": ia.enabled,
                    "internet_archive_authenticated": ia.enabled,
                    "username": ia.username,
                    "has_access_key": !ia.access_key.is_empty(),
                    "has_secret_key": !ia.secret_key.is_empty(),
                    "safe_search": ia.safe_search,
                }),
                error: None,
            }
        }
        LibraryQuery::ScanOpticalDisc {
            device_path,
            force_refresh,
        } => {
            let status = simp_core::sinks::cdda::scan_optical_disc(
                &state.db,
                device_path.as_deref(),
                force_refresh,
            );
            ServerEnvelope::QueryResponse {
                req_id,
                ok: true,
                data: serde_json::to_value(status).unwrap_or_default(),
                error: None,
            }
        }
    }
}

