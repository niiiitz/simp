use super::DaemonIpcState;
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};

pub(super) async fn lyrics_handler(
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
pub(super) struct LyricsRefetchBody {
    uri: Option<String>,
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: Option<u32>,
}

pub(super) async fn lyrics_refetch_handler(
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

pub(super) async fn factoids_handler(
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
pub(super) struct FactoidsRefetchBody {
    uri: Option<String>,
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: Option<u32>,
}

pub(super) async fn factoids_refetch_handler(
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

pub(super) async fn track_properties_get_handler(
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
pub(super) struct TrackPropertiesPostBody {
    uri: String,
    #[serde(flatten)]
    patch: simp_core::library::db::TrackPropertiesPatch,
}

pub(super) async fn track_properties_post_handler(
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

pub(super) async fn library_facets_handler(
    State(state): State<DaemonIpcState>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let facet = params.get("facet").cloned().unwrap_or_default();
    let uris = state.db.get_facet_matching_uris(&facet).unwrap_or_default();
    let tracks = state.db.get_facet_matching_tracks(&facet).unwrap_or_default();
    let (synced_uris, all_lyrics_uris) = if facet == "synced_lyrics" || facet == "has_lyrics" {
        state.db.get_lyrics_uri_sets().unwrap_or_default()
    } else {
        (Vec::new(), Vec::new())
    };
    Json(serde_json::json!({
        "ok": true,
        "facet": facet,
        "uris": uris,
        "tracks": tracks,
        "synced_uris": synced_uris,
        "all_lyrics_uris": all_lyrics_uris,
    }))
}

pub(super) async fn library_lyrics_status_handler(
    State(state): State<DaemonIpcState>,
) -> impl IntoResponse {
    let (synced_uris, all_lyrics_uris) = state.db.get_lyrics_uri_sets().unwrap_or_default();
    Json(serde_json::json!({
        "ok": true,
        "synced_uris": synced_uris,
        "all_lyrics_uris": all_lyrics_uris,
    }))
}

pub(super) async fn dsp_get_handler() -> impl IntoResponse {
    let snap = simp_core::dsp::global_dsp_state().snapshot();
    Json(serde_json::json!({
        "ok": true,
        "data": snap,
        "presets": simp_core::dsp::BUILTIN_EQ_PRESETS,
        "band_freqs_hz": simp_core::dsp::EQ_BAND_FREQS_HZ,
        "band_labels": simp_core::dsp::EQ_BAND_LABELS,
    }))
}

#[derive(serde::Deserialize, Default)]
pub(super) struct DspPostBody {
    eq_enabled: Option<bool>,
    eq_preset: Option<String>,
    preamp_db: Option<f32>,
    bands_db: Option<Vec<f32>>,
    vocal_mode: Option<String>,
    vocal_strength: Option<f32>,
}

pub(super) async fn dsp_post_handler(
    State(state): State<DaemonIpcState>,
    Json(body): Json<DspPostBody>,
) -> impl IntoResponse {
    let dsp_state = simp_core::dsp::global_dsp_state();
    let mut next = dsp_state.snapshot();

    if let Some(en) = body.eq_enabled {
        next.eq_enabled = en;
    }
    if let Some(ref preset_id) = body.eq_preset {
        let norm = preset_id.trim().to_ascii_lowercase();
        next.eq_preset = norm.clone();
        if let Some(preset) = simp_core::dsp::lookup_eq_preset(&norm) {
            next.bands_db = preset.bands_db;
            if body.preamp_db.is_none() {
                next.preamp_db = preset.preamp_db;
            }
        }
    }
    if let Some(preamp) = body.preamp_db {
        if preamp.is_finite() {
            next.preamp_db = preamp.clamp(-12.0, 12.0);
        }
    }
    if let Some(ref bands) = body.bands_db {
        for (i, &v) in bands.iter().take(10).enumerate() {
            if v.is_finite() {
                next.bands_db[i] = v.clamp(-12.0, 12.0);
            }
        }
        if body.eq_preset.is_none() {
            next.eq_preset = "custom".to_string();
        }
    }
    if let Some(ref v_mode) = body.vocal_mode {
        next.vocal_mode = simp_core::dsp::VocalDspMode::from_str_id(v_mode)
            .as_str_id()
            .to_string();
    }
    if let Some(v_str) = body.vocal_strength {
        if v_str.is_finite() {
            next.vocal_strength = v_str.clamp(0.0, 1.0);
        }
    }

    dsp_state.apply_snapshot(&next);

    // Persist DSP state to `~/.config/simp/settings.vdf`
    {
        let mut cfg = state.settings.lock().unwrap();
        cfg.audio.eq_enabled = next.eq_enabled;
        cfg.audio.eq_preset = next.eq_preset.clone();
        cfg.audio.eq_preamp_db = next.preamp_db as f64;
        cfg.audio.eq_bands_csv = simp_core::dsp::format_eq_bands_csv(&next.bands_db);
        cfg.audio.vocal_mode = next.vocal_mode.clone();
        cfg.audio.vocal_strength = next.vocal_strength as f64;
        let _ = crate::config::save_settings(&cfg);
    }

    Json(serde_json::json!({
        "ok": true,
        "data": next,
    }))
}

#[derive(serde::Deserialize)]
pub(super) struct ConvertToHybridBody {
    playlist_id: String,
}

pub(super) async fn convert_playlist_to_hybrid_handler(
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
pub(super) struct PurgeSourceBody {
    source: String,
}

pub(super) async fn purge_source_handler(
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

pub(super) async fn auth_probe_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
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

