use super::{detect_lan_ips, DaemonIpcState};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use simp_core::orchestrator::build_state_snapshot;
use simp_protocol::{
    AudioCommand, ClientEnvelope, LibraryQuery, ServerEnvelope,
};
use std::sync::atomic::Ordering;
use tokio::sync::mpsc;

pub(super) async fn ws_handler(
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

