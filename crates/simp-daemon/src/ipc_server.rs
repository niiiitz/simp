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
            candidates.push(exe_dir.join("../ui"));
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

    ips
}

pub async fn run_ipc_server(ipc_state: DaemonIpcState) -> anyhow::Result<()> {
    let art_cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("simp")
        .join("art");
    let _ = std::fs::create_dir_all(&art_cache_dir);

    let mut app = Router::new()
        .route("/health", get(health_handler))
        .route("/api/update/check", get(update_check_handler))
        .route("/api/update/apply", post(update_apply_handler))
        .route("/api/apple/playlists", get(apple_playlists_handler))
        .route("/api/apple/playlist-tracks", get(apple_playlist_tracks_handler))
        .route("/api/apple/full-album", get(apple_full_album_handler))
        .route("/api/apple/radio", get(apple_radio_handler))
        .route("/api/apple/new", get(apple_new_handler))
        .route("/api/apple/search", get(apple_search_handler))
        .route("/api/apple/resolve-track", get(apple_resolve_track_handler))
        .route("/api/apple/web-playback", get(apple_web_playback_handler))
        .route("/api/apple/native-probe", get(apple_native_probe_handler))
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
    let app = app.layer(CorsLayer::permissive()).with_state(ipc_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 18888));
    let lan_ips = detect_lan_ips();
    if let Some(primary_ip) = lan_ips.first() {
        tracing::info!(
            "SIMP Daemon listening on http://127.0.0.1:18888 and LAN Companion http://{primary_ip}:18888/pair"
        );
    } else {
        tracing::info!("SIMP Daemon IPC, Art & UI Server listening on http://{addr}");
    }
    let listener = tokio::net::TcpListener::bind(addr).await?;
    if initial_apple_auth {
        tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            // Stage libwidevinecdm.so into ~/.local/share/simp/lib/ if present on disk
            let _ = simp_core::sinks::apple_native::cdm_host::discover_widevine_cdm_library();
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

async fn update_check_handler() -> impl IntoResponse {
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
        })),
        Ok(Err(e)) => Json(serde_json::json!({
            "ok": false,
            "current_version": env!("CARGO_PKG_VERSION"),
            "target_arch": std::env::consts::ARCH,
            "error": e.to_string(),
        })),
        Err(e) => Json(serde_json::json!({
            "ok": false,
            "current_version": env!("CARGO_PKG_VERSION"),
            "target_arch": std::env::consts::ARCH,
            "error": e.to_string(),
        })),
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
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::fetch_cloud_playlists(&cfg)
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
    let id = params.get("id").cloned().unwrap_or_default();
    let kind = params.get("kind").cloned();
    let res = tokio::task::spawn_blocking(move || {
        simp_core::sinks::apple_api::fetch_playlist_tracks(&cfg, &id, kind.as_deref())
    })
    .await;
    match res {
        Ok(Ok(tracks)) => Json(serde_json::json!({ "ok": true, "data": tracks })),
        Ok(Err(e)) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
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

