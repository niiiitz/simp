mod apple_routes;
mod library_routes;
mod media_routes;
mod soundcloud_routes;
mod ws_routes;

use apple_routes::*;
use library_routes::*;
use media_routes::*;
use soundcloud_routes::*;
use ws_routes::*;

use axum::{
    extract::State,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use simp_core::{
    library::db::LibraryDatabase,
    orchestrator::OrchestratorSnapshot,
};
use simp_protocol::{
    AudioCommand, PlaybackEvent, SimpSettings,
};
use std::{
    net::SocketAddr,
    path::PathBuf,
    sync::{
        atomic::AtomicUsize,
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

pub(super) fn sync_soundcloud_tokens_into_daemon_state(state: &DaemonIpcState) {
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
            "/api/library/lyrics-status",
            get(library_lyrics_status_handler),
        )
        .route("/api/dsp", get(dsp_get_handler).post(dsp_post_handler))
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

