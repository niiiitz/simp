use super::{sync_soundcloud_tokens_into_daemon_state, DaemonIpcState};
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use simp_protocol::AudioCommand;

pub(super) async fn soundcloud_auth_start_handler(
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

pub(super) async fn soundcloud_callback_handler(
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

pub(super) async fn soundcloud_client_auth_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
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

pub(super) async fn soundcloud_playlists_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
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

pub(super) async fn soundcloud_playlist_tracks_handler(
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

pub(super) async fn soundcloud_stream_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
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

pub(super) async fn soundcloud_discover_handler(
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

pub(super) async fn soundcloud_paginate_handler(
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

pub(super) async fn soundcloud_search_handler(
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

pub(super) async fn soundcloud_comments_handler(
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

pub(super) async fn soundcloud_waveform_handler(
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

pub(super) async fn audio_waveform_handler(
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

pub(super) async fn soundcloud_like_handler(
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

pub(super) async fn soundcloud_like_playlist_handler(
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

pub(super) async fn soundcloud_followings_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
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

pub(super) async fn soundcloud_user_tracks_handler(
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

pub(super) async fn soundcloud_follow_handler(
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

pub(super) async fn soundcloud_open_handler(
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

pub(super) async fn apple_open_handler(
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

