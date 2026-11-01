use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
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
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health_handler() -> impl IntoResponse {
    let ui_dir = resolve_ui_dir().map(|p| p.to_string_lossy().to_string());
    Json(serde_json::json!({
        "status": "ok",
        "service": "simp-daemon",
        "pid": std::process::id(),
        "ui_served": ui_dir.is_some(),
        "ui_dir": ui_dir,
    }))
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
                                | AudioCommand::AddLibraryPath { .. }
                                | AudioCommand::RemoveLibraryPath { .. }
                                | AudioCommand::ConfigureAppleMusic { .. }
                                | AudioCommand::SetAppleMusicUserToken { .. }
                                | AudioCommand::DisconnectAppleMusic
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
                        let resp = execute_query(req_id, query, &state);
                        if let Ok(json) = serde_json::to_string(&resp) {
                            let _ = direct_tx.send(json);
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
            search,
            limit,
            offset,
        } => match state.db.get_albums(
            source.as_deref(),
            search.as_deref(),
            limit.max(1).min(500),
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
            search,
            limit,
            offset,
        } => match state.db.get_tracks(
            source.as_deref(),
            search.as_deref(),
            limit.max(1).min(500),
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
    }
}

