use super::DaemonIpcState;
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use tokio::sync::mpsc;

pub(super) async fn fs_roots_handler() -> impl IntoResponse {
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

pub(super) async fn fs_list_handler(
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
pub(super) struct FsResolveDropPayload {
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

pub(super) async fn fs_resolve_drop_handler(
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

pub(super) async fn dvd_stream_handler(
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

pub(super) async fn local_artist_handler(
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

pub(super) async fn history_get_handler(
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

pub(super) async fn history_post_handler(
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

pub(super) async fn favorites_get_handler(State(state): State<DaemonIpcState>) -> impl IntoResponse {
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

pub(super) async fn favorites_post_handler(
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

pub(super) async fn ia_discover_handler(
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

pub(super) async fn ia_item_handler(
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

pub(super) async fn ia_search_handler(
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

pub(super) async fn ia_video_stream_handler(
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

pub(super) async fn local_video_handler(
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

pub(super) async fn video_subtitles_handler(
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

