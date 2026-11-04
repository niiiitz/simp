use crate::library::db::LibraryDatabase;
use crate::library::indexer::scan_all_storage;
use crate::library::mounts::read_power_state;
use crate::library::vdf::{load_session_state, save_session_state};
use crate::mpris::{initialize_mpris, update_mpris_metadata, update_mpris_playback, MprisHandle};
use crate::sinks::apple::AppleMusicSink;
use crate::sinks::local::LocalAudioEngine;
use crate::sinks::AudioSink;
use simp_protocol::{
    ActiveEngine, AudioCommand, PlaybackEvent, RepeatMode, ServerEnvelope, SessionState,
    SimpSettings, TrackMetadata,
};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};

pub struct OrchestratorSnapshot {
    pub active_engine: ActiveEngine,
    pub is_playing: bool,
    pub position_ms: u32,
    pub volume: f64,
    pub shuffle: bool,
    pub repeat_mode: RepeatMode,
    pub current_track: Option<TrackMetadata>,
    pub queue: Vec<TrackMetadata>,
    pub queue_index: usize,
    pub apple_authenticated: bool,
}

pub struct AudioOrchestrator {
    pub db: LibraryDatabase,
    pub settings: Arc<Mutex<SimpSettings>>,
    pub state: Arc<Mutex<OrchestratorSnapshot>>,
    local_engine: LocalAudioEngine,
    apple_sink: AppleMusicSink,
    mpris_controls: Option<MprisHandle>,
    transition_epoch: u64,
    consecutive_failures: u32,
    internal_event_tx: mpsc::UnboundedSender<PlaybackEvent>,
    broadcast_tx: broadcast::Sender<PlaybackEvent>,
}

impl AudioOrchestrator {
    pub fn new(
        db: LibraryDatabase,
        settings: Arc<Mutex<SimpSettings>>,
        cmd_tx: mpsc::UnboundedSender<AudioCommand>,
        internal_event_tx: mpsc::UnboundedSender<PlaybackEvent>,
        broadcast_tx: broadcast::Sender<PlaybackEvent>,
    ) -> Self {
        let initial_vol = settings.lock().unwrap().audio.master_volume;
        let mut local_engine = LocalAudioEngine::new();
        local_engine.set_volume(initial_vol);

        let mut apple_sink = AppleMusicSink::new();
        apple_sink.set_volume(initial_vol);
        let initial_apple_auth = {
            let cfg = settings.lock().unwrap();
            AppleMusicSink::resolve_credentials(&cfg)
                .music_user_token
                .is_some()
        };
        apple_sink.is_authenticated = initial_apple_auth;

        let state = Arc::new(Mutex::new(OrchestratorSnapshot {
            active_engine: ActiveEngine::None,
            is_playing: false,
            position_ms: 0,
            volume: initial_vol,
            shuffle: false,
            repeat_mode: RepeatMode::Off,
            current_track: None,
            queue: Vec::new(),
            queue_index: 0,
            apple_authenticated: initial_apple_auth,
        }));

        let mpris_controls = initialize_mpris(state.clone(), cmd_tx);

        let mut orchestrator = Self {
            db,
            settings,
            state,
            local_engine,
            apple_sink,
            mpris_controls,
            transition_epoch: 0,
            consecutive_failures: 0,
            internal_event_tx,
            broadcast_tx,
        };

        orchestrator.restore_session_from_vdf();
        orchestrator
    }

    pub async fn run_loop(
        mut self,
        mut cmd_rx: mpsc::UnboundedReceiver<AudioCommand>,
        mut internal_event_rx: mpsc::UnboundedReceiver<PlaybackEvent>,
    ) {
        let mut idle_check_interval = tokio::time::interval(Duration::from_secs(15));

        loop {
            tokio::select! {
                Some(cmd) = cmd_rx.recv() => {
                    self.handle_command(cmd);
                }
                Some(evt) = internal_event_rx.recv() => {
                    self.handle_internal_event(evt);
                }
                _ = idle_check_interval.tick() => {
                    self.local_engine.check_idle_suspend();
                    self.apple_sink.check_idle_suspend();
                    if self.state.lock().unwrap().is_playing {
                        self.persist_session_to_vdf();
                    }
                }
            }
        }
    }

    fn handle_command(&mut self, cmd: AudioCommand) {
        match cmd {
            AudioCommand::Load { uri } => {
                let track = self.resolve_track_from_uri(&uri);
                {
                    let mut st = self.state.lock().unwrap();
                    st.queue = vec![track];
                    st.queue_index = 0;
                }
                self.transition_to_index(0);
            }
            AudioCommand::LoadQueue {
                uris,
                start_index,
                tracks,
            } => {
                // If full `TrackMetadata` objects were supplied (e.g., pure streaming of an unpinned
                // Apple Music catalog album, cloud playlist, or search result), upsert their metadata
                // into the `tracks` table (without creating an AlbumRecord or PlaylistRecord) and
                // use them directly in the queue so artwork, title, and artist display immediately.
                let mut provided_map = std::collections::HashMap::new();
                for t in tracks {
                    let mut clean = t.clone();
                    if clean.source == "apple_music" {
                        // Do not attach unpinned streaming tracks to an album_id unless already pinned
                        if self.db.get_track_by_uri(&clean.uri).ok().flatten().is_none() {
                            clean.album_id = None;
                            let _ = self.db.upsert_track(&clean, None, None);
                        }
                    }
                    provided_map.insert(t.uri.clone(), t);
                }

                let queue: Vec<TrackMetadata> = uris
                    .iter()
                    .map(|u| {
                        provided_map
                            .remove(u)
                            .unwrap_or_else(|| self.resolve_track_from_uri(u))
                    })
                    .collect();
                if queue.is_empty() {
                    return;
                }
                let idx = start_index.min(queue.len() - 1);
                {
                    let mut st = self.state.lock().unwrap();
                    st.queue = queue;
                    st.queue_index = idx;
                }
                self.emit_queue_updated();
                self.transition_to_index(idx);
            }
            AudioCommand::PlayAlbum { album_id, shuffle } => {
                if let Ok(tracks) = self.db.get_album_tracks(&album_id) {
                    if !tracks.is_empty() {
                        {
                            let mut st = self.state.lock().unwrap();
                            st.queue = tracks;
                            st.queue_index = 0;
                            st.shuffle = shuffle;
                        }
                        self.emit_queue_updated();
                        self.transition_to_index(0);
                    }
                }
            }
            AudioCommand::PlayPlaylist { playlist_id, shuffle } => {
                if let Ok(tracks) = self.db.get_playlist_items(&playlist_id, 5000, 0) {
                    if !tracks.is_empty() {
                        {
                            let mut st = self.state.lock().unwrap();
                            st.queue = tracks;
                            st.queue_index = 0;
                            st.shuffle = shuffle;
                        }
                        self.emit_queue_updated();
                        self.transition_to_index(0);
                    }
                }
            }
            AudioCommand::Play => {
                let engine = self.state.lock().unwrap().active_engine;
                if let Some((sink, internal_tx, broadcast_tx, epoch)) =
                    self.sink_and_channels_mut(engine)
                {
                    let _ = sink.resume_playback(epoch, internal_tx, broadcast_tx);
                    let pos = self.get_live_position_ms();
                    self.set_playing_state(true, pos);
                } else {
                    let has_queue = !self.state.lock().unwrap().queue.is_empty();
                    if has_queue {
                        let idx = self.state.lock().unwrap().queue_index;
                        self.transition_to_index(idx);
                    }
                }
            }
            AudioCommand::Pause => {
                self.pause_active_engine();
            }
            AudioCommand::TogglePlayPause => {
                let is_playing = self.state.lock().unwrap().is_playing;
                if is_playing {
                    self.pause_active_engine();
                } else {
                    self.handle_command(AudioCommand::Play);
                }
            }
            AudioCommand::Next => {
                self.advance_queue(true);
            }
            AudioCommand::Previous => {
                let current_pos = self.get_live_position_ms();
                if current_pos > 3000 {
                    self.handle_command(AudioCommand::Seek { position_ms: 0 });
                } else {
                    let prev_idx = {
                        let st = self.state.lock().unwrap();
                        if st.queue.is_empty() {
                            return;
                        }
                        if st.queue_index > 0 {
                            st.queue_index - 1
                        } else {
                            st.queue.len() - 1
                        }
                    };
                    self.transition_to_index(prev_idx);
                }
            }
            AudioCommand::Seek { position_ms } => {
                let (engine, duration_ms) = {
                    let st = self.state.lock().unwrap();
                    let dur = st.current_track.as_ref().map(|t| t.duration_ms).unwrap_or(0);
                    (st.active_engine, dur)
                };
                let clamped_pos = if duration_ms > 0 {
                    position_ms.min(duration_ms.saturating_sub(250))
                } else {
                    position_ms
                };
                if let Some((sink, internal_tx, broadcast_tx, epoch)) =
                    self.sink_and_channels_mut(engine)
                {
                    let _ = sink.seek_playback(clamped_pos, epoch, internal_tx, broadcast_tx);
                }
                let is_playing = self.state.lock().unwrap().is_playing;
                self.state.lock().unwrap().position_ms = clamped_pos;
                update_mpris_playback(&mut self.mpris_controls, is_playing, clamped_pos);
                let _ = self
                    .broadcast_tx
                    .send(PlaybackEvent::ProgressTick { position_ms: clamped_pos });
                self.persist_session_to_vdf();
            }
            AudioCommand::SeekRelative { delta_ms } => {
                let current = self.get_live_position_ms() as i64;
                let target = (current + delta_ms as i64).max(0) as u32;
                self.handle_command(AudioCommand::Seek { position_ms: target });
            }
            AudioCommand::SetVolume { volume } => {
                let clamped = volume.clamp(0.0, 1.0);
                // Simultaneous bidirectional volume normalization across all AudioSink implementations
                self.local_engine
                    .sync_volume(clamped as f32, &self.broadcast_tx);
                self.apple_sink
                    .sync_volume(clamped as f32, &self.broadcast_tx);
                self.state.lock().unwrap().volume = clamped;
                self.settings.lock().unwrap().audio.master_volume = clamped;
                let _ = self
                    .broadcast_tx
                    .send(PlaybackEvent::VolumeSynced { volume: clamped });
            }
            AudioCommand::SetShuffle { enabled } => {
                self.state.lock().unwrap().shuffle = enabled;
                self.emit_queue_updated();
                self.persist_session_to_vdf();
            }
            AudioCommand::SetRepeat { mode } => {
                self.state.lock().unwrap().repeat_mode = mode;
                self.emit_queue_updated();
                self.persist_session_to_vdf();
            }
            AudioCommand::CycleRepeat => {
                let next_mode = {
                    let st = self.state.lock().unwrap();
                    match st.repeat_mode {
                        RepeatMode::Off => RepeatMode::Queue,
                        RepeatMode::Queue => RepeatMode::Track,
                        RepeatMode::Track => RepeatMode::Off,
                    }
                };
                self.handle_command(AudioCommand::SetRepeat { mode: next_mode });
            }
            AudioCommand::AddLibraryPath { path } => {
                let normalized = crate::library::vdf::normalize_platform_path(&path)
                    .to_string_lossy()
                    .to_string();
                if !normalized.is_empty() {
                    let mut cfg = self.settings.lock().unwrap();
                    let mut unique_paths: Vec<String> = Vec::new();
                    for existing in cfg.library.custom_paths.values() {
                        let norm_existing = crate::library::vdf::normalize_platform_path(existing)
                            .to_string_lossy()
                            .to_string();
                        if !norm_existing.is_empty() && !unique_paths.contains(&norm_existing) {
                            unique_paths.push(norm_existing);
                        }
                    }
                    if !unique_paths.contains(&normalized) {
                        unique_paths.push(normalized);
                    }
                    cfg.library.custom_paths.clear();
                    for (idx, p) in unique_paths.into_iter().enumerate() {
                        cfg.library.custom_paths.insert(idx.to_string(), p);
                    }
                }
                self.handle_command(AudioCommand::RescanStorage);
            }
            AudioCommand::RemoveLibraryPath { path } => {
                let target_norm = crate::library::vdf::normalize_platform_path(&path)
                    .to_string_lossy()
                    .to_string();
                {
                    let mut cfg = self.settings.lock().unwrap();
                    let mut remaining: Vec<String> = Vec::new();
                    for existing in cfg.library.custom_paths.values() {
                        let norm_existing = crate::library::vdf::normalize_platform_path(existing)
                            .to_string_lossy()
                            .to_string();
                        if existing != &path
                            && norm_existing != target_norm
                            && !remaining.contains(&norm_existing)
                        {
                            remaining.push(norm_existing);
                        }
                    }
                    cfg.library.custom_paths.clear();
                    for (idx, p) in remaining.into_iter().enumerate() {
                        cfg.library.custom_paths.insert(idx.to_string(), p);
                    }
                }
                let _ = self.db.remove_mount(&path);
                let _ = self.db.remove_mount(&target_norm);
                let (total_albums, total_tracks) = self.db.get_library_counts().unwrap_or((0, 0));
                let _ = self.broadcast_tx.send(PlaybackEvent::LibraryUpdated {
                    total_albums,
                    total_tracks,
                });
                if let Ok(mounts) = self.db.get_mounts() {
                    let _ = self
                        .broadcast_tx
                        .send(PlaybackEvent::StorageMountsChanged { mounts });
                }
            }
            AudioCommand::RescanStorage => {
                let db = self.db.clone();
                let cfg = self.settings.lock().unwrap().clone();
                let bcast = self.broadcast_tx.clone();
                let state_ref = self.state.clone();
                tokio::task::spawn_blocking(move || {
                    let (total_albums, total_tracks) = scan_all_storage(&db, &cfg);
                    // Refresh current_track metadata (e.g., if cover.jpg was just added to the album folder)
                    let cur_uri = state_ref
                        .lock()
                        .unwrap()
                        .current_track
                        .as_ref()
                        .map(|t| t.uri.clone());
                    if let Some(uri) = cur_uri {
                        if let Ok(Some(updated_track)) = db.get_track_by_uri(&uri) {
                            let mut st = state_ref.lock().unwrap();
                            st.current_track = Some(updated_track.clone());
                            for q_item in &mut st.queue {
                                if q_item.uri == uri {
                                    *q_item = updated_track.clone();
                                }
                            }
                        }
                    }
                    let _ = bcast.send(PlaybackEvent::LibraryUpdated {
                        total_albums,
                        total_tracks,
                    });
                    if let Ok(mounts) = db.get_mounts() {
                        let _ = bcast.send(PlaybackEvent::StorageMountsChanged { mounts });
                    }
                });
            }
            AudioCommand::ConfigureAppleMusic {
                team_id,
                key_id,
                private_key_path,
                developer_token,
            } => {
                let norm_path = if private_key_path.trim().is_empty() {
                    String::new()
                } else {
                    crate::library::vdf::normalize_platform_path(&private_key_path)
                        .to_string_lossy()
                        .to_string()
                };
                {
                    let mut cfg = self.settings.lock().unwrap();
                    cfg.services.apple_team_id = team_id.trim().to_string();
                    cfg.services.apple_key_id = key_id.trim().to_string();
                    cfg.services.apple_private_key_path = norm_path;
                    if let Some(tok) = developer_token {
                        cfg.services.apple_developer_token = tok.trim().to_string();
                    }
                    cfg.services.apple_music_enabled = true;
                }
                let (total_albums, total_tracks) = self.db.get_library_counts().unwrap_or((0, 0));
                let _ = self.broadcast_tx.send(PlaybackEvent::LibraryUpdated {
                    total_albums,
                    total_tracks,
                });
            }
            AudioCommand::SetAppleMusicUserToken { music_user_token } => {
                let trimmed = music_user_token.trim().to_string();
                let is_auth = !trimmed.is_empty();
                {
                    let mut cfg = self.settings.lock().unwrap();
                    cfg.services.apple_music_user_token = trimmed;
                    cfg.services.apple_music_enabled = is_auth;
                }
                self.apple_sink.is_authenticated = is_auth;
                self.state.lock().unwrap().apple_authenticated = is_auth;
                if is_auth {
                    AppleMusicSink::ensure_headless_widevine_worker();
                }
                let (total_albums, total_tracks) = self.db.get_library_counts().unwrap_or((0, 0));
                let _ = self.broadcast_tx.send(PlaybackEvent::LibraryUpdated {
                    total_albums,
                    total_tracks,
                });
            }
            AudioCommand::DisconnectAppleMusic => {
                if self.state.lock().unwrap().active_engine == ActiveEngine::AppleMusic {
                    self.pause_active_engine();
                }
                {
                    let mut cfg = self.settings.lock().unwrap();
                    cfg.services.apple_music_user_token.clear();
                    cfg.services.apple_music_enabled = false;
                }
                self.apple_sink.is_authenticated = false;
                self.state.lock().unwrap().apple_authenticated = false;
                // Broadcast `unauthorize` to any connected UI window so it clears MusicKit session & localStorage
                let _ = self.broadcast_tx.send(PlaybackEvent::AppleSinkCommand {
                    action: "unauthorize".to_string(),
                    uri: None,
                    position_ms: None,
                    volume: None,
                });
                AppleMusicSink::purge_worker_auth_storage();
                let _ = self
                    .db
                    .remove_streaming_source("apple_music", "apple_remote");
                let (total_albums, total_tracks) = self.db.get_library_counts().unwrap_or((0, 0));
                let _ = self.broadcast_tx.send(PlaybackEvent::LibraryUpdated {
                    total_albums,
                    total_tracks,
                });
            }
            AudioCommand::ImportCatalogTracks {
                source,
                album,
                playlist,
                tracks,
            } => {
                if let Err(e) = self.db.import_catalog_bundle(
                    &source,
                    album.as_ref(),
                    playlist.as_ref(),
                    &tracks,
                ) {
                    tracing::warn!("Failed to import catalog tracks for {source}: {e}");
                }
                let (total_albums, total_tracks) = self.db.get_library_counts().unwrap_or((0, 0));
                let _ = self.broadcast_tx.send(PlaybackEvent::LibraryUpdated {
                    total_albums,
                    total_tracks,
                });
            }
            AudioCommand::AppleWorkerReport {
                state,
                track,
                position_ms,
                duration_ms,
            } => {
                let is_apple_active =
                    self.state.lock().unwrap().active_engine == ActiveEngine::AppleMusic;
                if !is_apple_active && state != "authorized" {
                    return;
                }

                if let Some(meta) = track {
                    {
                        let mut st = self.state.lock().unwrap();
                        st.current_track = Some(meta.clone());
                        let q_idx = st.queue_index;
                        if q_idx < st.queue.len() {
                            st.queue[q_idx] = meta.clone();
                        }
                    }
                    let mut clean = meta.clone();
                    clean.album_id = None;
                    let _ = self.db.upsert_track(&clean, None, None);
                    update_mpris_metadata(&mut self.mpris_controls, &meta);
                    let _ = self.broadcast_tx.send(PlaybackEvent::TrackChanged {
                        metadata: meta,
                        position_ms,
                    });
                } else if let Some(dur) = duration_ms {
                    if dur > 0 {
                        let mut updated_meta = None;
                        {
                            let mut st = self.state.lock().unwrap();
                            if let Some(ref mut cur) = st.current_track {
                                if cur.duration_ms == 0 {
                                    cur.duration_ms = dur;
                                    updated_meta = Some(cur.clone());
                                }
                            }
                        }
                        if let Some(meta) = updated_meta {
                            update_mpris_metadata(&mut self.mpris_controls, &meta);
                            let _ = self.broadcast_tx.send(PlaybackEvent::TrackChanged {
                                metadata: meta,
                                position_ms,
                            });
                        }
                    }
                }

                match state.as_str() {
                    "playing" => {
                        self.set_playing_state(true, position_ms);
                    }
                    "paused" => {
                        self.set_playing_state(false, position_ms);
                    }
                    "ended" | "completed" => {
                        self.advance_queue(false);
                    }
                    "time_update" => {
                        self.state.lock().unwrap().position_ms = position_ms;
                        let _ = self
                            .broadcast_tx
                            .send(PlaybackEvent::ProgressTick { position_ms });
                    }
                    "worker_ready" => {
                        let (should_replay, cur_uri, cur_pos) = {
                            let st = self.state.lock().unwrap();
                            (
                                st.active_engine == ActiveEngine::AppleMusic && st.is_playing,
                                st.current_track.as_ref().map(|t| t.uri.clone()),
                                st.position_ms,
                            )
                        };
                        if should_replay {
                            if let Some(uri) = cur_uri {
                                self.apple_sink
                                    .emit_load_and_play(&self.broadcast_tx, &uri, cur_pos);
                            }
                        }
                    }
                    _ => {}
                }
            }
            AudioCommand::SuspendForSleep => {
                tracing::info!("System entering sleep — safe-pausing audio & suspending sinks");
                self.pause_active_engine();
                self.suspend_all_sinks();
            }
            AudioCommand::RestartDaemon => {
                tracing::info!("Restarting SIMP daemon & shutting down all audio sinks...");
                self.pause_active_engine();
                self.shutdown_all_sinks();
                if let Ok(exe) = std::env::current_exe() {
                    let args: Vec<String> = std::env::args().skip(1).collect();
                    let _ = std::process::Command::new("sh")
                        .arg("-c")
                        .arg("sleep 0.35 && exec \"$0\" \"$@\"")
                        .arg(exe)
                        .args(args)
                        .stdin(std::process::Stdio::null())
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .spawn();
                }
                std::process::exit(0);
            }
            AudioCommand::ResetDatabaseCache => {
                tracing::info!("Clearing offline SQLite library cache & rescanning local mounts...");
                self.pause_active_engine();
                {
                    let mut st = self.state.lock().unwrap();
                    st.queue.clear();
                    st.queue_index = 0;
                    st.current_track = None;
                    st.active_engine = ActiveEngine::None;
                }
                let _ = self.db.clear_all_library_cache();
                self.emit_queue_updated();
                let (total_albums, total_tracks) = self.db.get_library_counts().unwrap_or((0, 0));
                let _ = self.broadcast_tx.send(PlaybackEvent::LibraryUpdated {
                    total_albums,
                    total_tracks,
                });
                self.handle_command(AudioCommand::RescanStorage);
            }
            AudioCommand::FactoryReset => {
                tracing::info!("Performing Factory Reset (de-auth, clear DB, reset settings)...");
                self.pause_active_engine();
                self.local_engine.release_pipewire_stream();
                let _ = self.broadcast_tx.send(PlaybackEvent::AppleSinkCommand {
                    action: "unauthorize".to_string(),
                    uri: None,
                    position_ms: None,
                    volume: None,
                });
                AppleMusicSink::purge_worker_auth_storage();
                {
                    let mut cfg = self.settings.lock().unwrap();
                    *cfg = SimpSettings::default();
                }
                self.apple_sink.is_authenticated = false;
                {
                    let mut st = self.state.lock().unwrap();
                    st.apple_authenticated = false;
                    st.queue.clear();
                    st.queue_index = 0;
                    st.current_track = None;
                    st.active_engine = ActiveEngine::None;
                    st.position_ms = 0;
                    st.is_playing = false;
                }
                let _ = self.db.clear_all_library_cache();
                self.persist_session_to_vdf();
                self.emit_queue_updated();
                let (total_albums, total_tracks) = self.db.get_library_counts().unwrap_or((0, 0));
                let _ = self.broadcast_tx.send(PlaybackEvent::LibraryUpdated {
                    total_albums,
                    total_tracks,
                });
                self.handle_command(AudioCommand::RescanStorage);
            }
            AudioCommand::EjectOpticalDisc { device_path } => {
                let is_playing_cd = self
                    .state
                    .lock()
                    .unwrap()
                    .current_track
                    .as_ref()
                    .map(|t| t.uri.starts_with("cdda://") || t.source == "cdda")
                    .unwrap_or(false);
                if is_playing_cd {
                    self.pause_active_engine();
                    self.local_engine.release_pipewire_stream();
                }
                let _ = crate::sinks::cdda::eject_optical_disc(device_path.as_deref());
            }
            AudioCommand::ShutdownDaemon => {
                self.pause_active_engine();
                self.shutdown_all_sinks();
                // Also stop the systemd user service if running under systemd so `Restart=always` doesn't respawn
                let _ = std::process::Command::new("systemctl")
                    .args(["--user", "stop", "simp.service"])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn();
                std::process::exit(0);
            }
        }
    }

    /// Polymorphic `AudioSink` lookup by `ActiveEngine`.
    fn sink_by_engine(&self, engine: ActiveEngine) -> Option<&dyn AudioSink> {
        match engine {
            ActiveEngine::Local => Some(&self.local_engine),
            ActiveEngine::AppleMusic => Some(&self.apple_sink),
            ActiveEngine::None => None,
        }
    }

    /// Polymorphic mutable `AudioSink` lookup bundled with event channels & epoch to satisfy split borrows.
    fn sink_and_channels_mut(
        &mut self,
        engine: ActiveEngine,
    ) -> Option<(
        &mut dyn AudioSink,
        &mpsc::UnboundedSender<PlaybackEvent>,
        &broadcast::Sender<PlaybackEvent>,
        u64,
    )> {
        let epoch = self.transition_epoch;
        let internal_tx = &self.internal_event_tx;
        let broadcast_tx = &self.broadcast_tx;
        match engine {
            ActiveEngine::Local => Some((&mut self.local_engine, internal_tx, broadcast_tx, epoch)),
            ActiveEngine::AppleMusic => {
                Some((&mut self.apple_sink, internal_tx, broadcast_tx, epoch))
            }
            ActiveEngine::None => None,
        }
    }

    fn suspend_all_sinks(&mut self) {
        let broadcast_tx = &self.broadcast_tx;
        let sinks: [&mut dyn AudioSink; 2] = [&mut self.local_engine, &mut self.apple_sink];
        for sink in sinks {
            sink.suspend_sink(broadcast_tx);
        }
    }

    fn shutdown_all_sinks(&mut self) {
        let broadcast_tx = &self.broadcast_tx;
        let sinks: [&mut dyn AudioSink; 2] = [&mut self.local_engine, &mut self.apple_sink];
        for sink in sinks {
            sink.shutdown_sink(broadcast_tx);
        }
    }

    fn handle_internal_event(&mut self, evt: PlaybackEvent) {
        match evt {
            PlaybackEvent::EndOfTrack { epoch } => {
                // Race condition guard: ignore stale EndOfTrack from a previous epoch!
                if epoch == self.transition_epoch {
                    self.advance_queue(false);
                }
            }
            PlaybackEvent::ProgressTick { position_ms } => {
                self.state.lock().unwrap().position_ms = position_ms;
                let _ = self.broadcast_tx.send(PlaybackEvent::ProgressTick { position_ms });
            }
            other => {
                let _ = self.broadcast_tx.send(other);
            }
        }
    }

    fn pause_active_engine(&mut self) {
        let engine = self.state.lock().unwrap().active_engine;
        if let Some((sink, _internal_tx, broadcast_tx, _epoch)) = self.sink_and_channels_mut(engine)
        {
            sink.pause_playback(broadcast_tx);
        }
        let pos = self.get_live_position_ms();
        self.set_playing_state(false, pos);
        self.persist_session_to_vdf();
    }

    fn transition_to_index(&mut self, index: usize) {
        // 1. Bump transition_epoch to invalidate any in-flight monitor events
        self.transition_epoch = self.transition_epoch.wrapping_add(1);

        let mut track = {
            let mut st = self.state.lock().unwrap();
            if index >= st.queue.len() {
                return;
            }
            st.queue_index = index;
            st.queue[index].clone()
        };

        let target_engine = if self.apple_sink.supports_uri(&track.uri) {
            self.apple_sink.engine_kind()
        } else {
            self.local_engine.engine_kind()
        };

        // 2. Suspend outgoing sink if switching engines
        let prev_engine = self.state.lock().unwrap().active_engine;
        if prev_engine != target_engine {
            if let Some((prev_sink, _internal_tx, broadcast_tx, _epoch)) =
                self.sink_and_channels_mut(prev_engine)
            {
                prev_sink.suspend_sink(broadcast_tx);
            }
        }

        // If the track URI is a library song (`applemusic:song:i.xxxx`), pre-resolve its canonical
        // catalog ID in Rust so re-linked cloud playlist tracks play without round-trip delay.
        if track.uri.starts_with("applemusic:song:i.") {
            let cfg = self.settings.lock().unwrap().clone();
            let artist = track.artists.first().map(|s| s.as_str());
            if let Ok(Some(cat_id)) =
                crate::sinks::apple_api::resolve_replacement_catalog_song_id(
                    &cfg,
                    &track.uri,
                    Some(&track.title),
                    artist,
                )
            {
                track.uri = format!("applemusic:song:{cat_id}");
            }
        }

        // 3. Dispatch to target AudioSink with Anti-Runaway-Skip Circuit Breaker
        let load_res = if let Some((sink, internal_tx, broadcast_tx, epoch)) =
            self.sink_and_channels_mut(target_engine)
        {
            sink.load_and_play_track(&track.uri, 0, epoch, internal_tx, broadcast_tx)
        } else {
            Ok(())
        };

        match load_res {
            Ok(()) => {
                self.consecutive_failures = 0;
            }
            Err(e) => {
                tracing::warn!("AudioSink failed to load track {}: {e}", track.uri);
                self.handle_track_load_failure(&e.to_string());
                return;
            }
        }

        // 4. Update state, MPRIS2, and broadcast TrackChanged
        {
            let mut st = self.state.lock().unwrap();
            st.active_engine = target_engine;
            st.current_track = Some(track.clone());
            st.is_playing = true;
            st.position_ms = 0;
        }

        update_mpris_metadata(&mut self.mpris_controls, &track);
        update_mpris_playback(&mut self.mpris_controls, true, 0);

        let _ = self.broadcast_tx.send(PlaybackEvent::TrackChanged {
            metadata: track,
            position_ms: 0,
        });
        let _ = self.broadcast_tx.send(PlaybackEvent::PlaybackStateChanged {
            is_playing: true,
            position_ms: 0,
        });
        self.emit_queue_updated();
        self.persist_session_to_vdf();
    }

    /// Implements the Anti-Runaway-Skip Circuit Breaker (Section 13.5 of SPEC.md).
    fn handle_track_load_failure(&mut self, reason: &str) {
        self.consecutive_failures += 1;
        if self.consecutive_failures >= 3 {
            tracing::warn!("Circuit breaker tripped after 3 consecutive failures: {reason}");
            self.consecutive_failures = 0;
            self.pause_active_engine();
            let _ = self.broadcast_tx.send(PlaybackEvent::NetworkCircuitBroken {
                message: format!("Playback paused — {reason}"),
            });
            return;
        }
        self.advance_queue(true);
    }

    fn advance_queue(&mut self, manual_skip: bool) {
        let (queue_len, current_idx, repeat_mode, shuffle) = {
            let st = self.state.lock().unwrap();
            (st.queue.len(), st.queue_index, st.repeat_mode, st.shuffle)
        };
        if queue_len == 0 {
            return;
        }

        if !manual_skip && repeat_mode == RepeatMode::Track {
            self.transition_to_index(current_idx);
            return;
        }

        if shuffle && queue_len > 1 {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos() as usize)
                .unwrap_or(1);
            let step = (nanos % (queue_len - 1)) + 1;
            let next_idx = (current_idx + step) % queue_len;
            self.transition_to_index(next_idx);
            return;
        }

        if current_idx + 1 < queue_len {
            self.transition_to_index(current_idx + 1);
        } else if repeat_mode == RepeatMode::Queue || manual_skip {
            self.transition_to_index(0);
        } else {
            self.pause_active_engine();
            self.handle_command(AudioCommand::Seek { position_ms: 0 });
        }
    }

    fn set_playing_state(&mut self, is_playing: bool, position_ms: u32) {
        {
            let mut st = self.state.lock().unwrap();
            st.is_playing = is_playing;
            st.position_ms = position_ms;
        }
        update_mpris_playback(&mut self.mpris_controls, is_playing, position_ms);
        let _ = self.broadcast_tx.send(PlaybackEvent::PlaybackStateChanged {
            is_playing,
            position_ms,
        });
    }

    fn emit_queue_updated(&self) {
        let st = self.state.lock().unwrap();
        let _ = self.broadcast_tx.send(PlaybackEvent::QueueUpdated {
            queue: st.queue.clone(),
            current_index: st.queue_index,
            shuffle: st.shuffle,
            repeat_mode: st.repeat_mode,
        });
    }

    fn get_live_position_ms(&self) -> u32 {
        let st = self.state.lock().unwrap();
        if let Some(sink) = self.sink_by_engine(st.active_engine) {
            if let Some(live_ms) = sink.live_position_ms() {
                return live_ms;
            }
        }
        st.position_ms
    }

    fn resolve_track_from_uri(&self, uri: &str) -> TrackMetadata {
        if let Ok(Some(meta)) = self.db.get_track_by_uri(uri) {
            return meta;
        }
        let fallback_title = uri
            .rsplit('/')
            .next()
            .unwrap_or(uri)
            .to_string();
        TrackMetadata {
            uri: uri.to_string(),
            title: fallback_title,
            artists: vec!["Unknown Artist".to_string()],
            album: "Single Track".to_string(),
            album_id: None,
            track_number: None,
            disc_number: Some(1),
            art_url: None,
            duration_ms: 0,
            source: if uri.starts_with("applemusic:") {
                "apple_music".to_string()
            } else if uri.starts_with("cdda://") {
                "cdda".to_string()
            } else {
                "local".to_string()
            },
            mount_root: None,
        }
    }

    /// Restores the last active queue, current track, and paused playback position from
    /// `~/.local/share/simp/session_state.vdf` when `simp --daemon` starts up.
    fn restore_session_from_vdf(&mut self) {
        let Some(session) = load_session_state() else {
            return;
        };

        let mut uris = session.ordered_queue_uris();
        if uris.is_empty() {
            if let Some(ref cur) = session.current_uri {
                uris.push(cur.clone());
            }
        }
        if uris.is_empty() {
            return;
        }

        let queue: Vec<TrackMetadata> = uris
            .iter()
            .map(|u| self.resolve_track_from_uri(u))
            .collect();
        let idx = session.queue_index.min(queue.len().saturating_sub(1));
        let current_track = queue.get(idx).cloned();

        let Some(track) = current_track else {
            return;
        };

        let engine = if track.uri.starts_with("applemusic:") {
            ActiveEngine::AppleMusic
        } else {
            ActiveEngine::Local
        };

        let clamped_pos = if track.duration_ms > 0 {
            session.position_ms.min(track.duration_ms.saturating_sub(250))
        } else {
            session.position_ms
        };

        if engine == ActiveEngine::Local {
            self.local_engine
                .prime_restored_session(track.uri.clone(), clamped_pos);
        } else if engine == ActiveEngine::AppleMusic {
            self.apple_sink
                .prime_restored_session(track.uri.clone(), clamped_pos);
        }

        {
            let mut st = self.state.lock().unwrap();
            st.active_engine = engine;
            st.is_playing = false;
            st.position_ms = clamped_pos;
            st.shuffle = session.shuffle;
            st.repeat_mode = session.repeat_mode;
            st.current_track = Some(track.clone());
            st.queue = queue;
            st.queue_index = idx;
        }

        update_mpris_metadata(&mut self.mpris_controls, &track);
        update_mpris_playback(&mut self.mpris_controls, false, clamped_pos);

        tracing::info!(
            "Restored session from session_state.vdf: '{}' at {}ms (queue: {} tracks)",
            track.title,
            clamped_pos,
            uris.len()
        );
    }

    /// Snapshots the live queue, current track, shuffle/repeat mode, and millisecond position
    /// and writes them atomically to `~/.local/share/simp/session_state.vdf`.
    fn persist_session_to_vdf(&self) {
        let live_pos = self.get_live_position_ms();
        let session = {
            let st = self.state.lock().unwrap();
            if st.queue.is_empty() && st.current_track.is_none() {
                return;
            }
            let mut queue_uris = BTreeMap::new();
            for (i, t) in st.queue.iter().enumerate() {
                queue_uris.insert(i.to_string(), t.uri.clone());
            }
            SessionState {
                current_uri: st.current_track.as_ref().map(|t| t.uri.clone()),
                position_ms: live_pos,
                queue_index: st.queue_index,
                shuffle: st.shuffle,
                repeat_mode: st.repeat_mode,
                queue_uris,
            }
        };

        let _ = save_session_state(&session);
    }
}

/// Builds a live `ServerEnvelope::StateSnapshot` for immediate 1-frame WebSocket UI hydration.
pub fn build_state_snapshot(
    state: &Arc<Mutex<OrchestratorSnapshot>>,
    db: &LibraryDatabase,
) -> ServerEnvelope {
    let st = state.lock().unwrap();
    let mut up_next: Vec<TrackMetadata> = st
        .queue
        .iter()
        .skip(st.queue_index + 1)
        .take(5)
        .cloned()
        .collect();
    if st.repeat_mode == RepeatMode::Queue && st.queue.len() > 1 && up_next.len() < 5 {
        let needed = (5 - up_next.len()).min(st.queue_index);
        up_next.extend(st.queue.iter().take(needed).cloned());
    }
    let mounts = db.get_mounts().unwrap_or_default();
    let power = read_power_state();

    ServerEnvelope::StateSnapshot {
        active_engine: st.active_engine,
        is_playing: st.is_playing,
        position_ms: st.position_ms,
        volume: st.volume,
        shuffle: st.shuffle,
        repeat_mode: st.repeat_mode,
        current_track: st.current_track.clone(),
        up_next,
        queue_length: st.queue.len(),
        queue_index: st.queue_index,
        mounts,
        power,
        apple_authenticated: st.apple_authenticated,
    }
}

