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

pub async fn run_ipc_server(ipc_state: DaemonIpcState) -> anyhow::Result<()> {
    let art_cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("simp")
        .join("art");
    let _ = std::fs::create_dir_all(&art_cache_dir);

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/ws", get(ws_handler))
        .nest_service("/art", ServeDir::new(art_cache_dir))
        .layer(CorsLayer::permissive())
        .with_state(ipc_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 18888));
    tracing::info!("SIMP Daemon IPC & Art Server listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health_handler() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "simp-daemon",
        "pid": std::process::id()
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
                            AudioCommand::SetVolume { .. } | AudioCommand::AddLibraryPath { .. }
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
                    ClientEnvelope::AppleWorkerEvent { .. } => {
                        // Phase 4 Apple Music relay
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
        _ => ServerEnvelope::QueryResponse {
            req_id,
            ok: true,
            data: serde_json::json!({"status": "queued"}),
            error: None,
        },
    }
}

