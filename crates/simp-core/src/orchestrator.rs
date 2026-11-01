use crate::library::db::LibraryDatabase;
use crate::library::indexer::scan_all_storage;
use crate::library::mounts::read_power_state;
use crate::library::vdf::{load_session_state, save_session_state};
use crate::mpris::{initialize_mpris, update_mpris_metadata, update_mpris_playback};
use crate::sinks::apple::AppleMusicSink;
use crate::sinks::local::LocalAudioEngine;
use crate::sinks::spotify::SpotifyEngine;
use simp_protocol::{
    ActiveEngine, AudioCommand, PlaybackEvent, RepeatMode, ServerEnvelope, SessionState,
    SimpSettings, TrackMetadata,
};
use souvlaki::MediaControls;
use std::collections::BTreeMap;
use std::path::Path;
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
    pub spotify_authenticated: bool,
    pub apple_authenticated: bool,
}

pub struct AudioOrchestrator {
    pub db: LibraryDatabase,
    pub settings: Arc<Mutex<SimpSettings>>,
    pub state: Arc<Mutex<OrchestratorSnapshot>>,
    local_engine: LocalAudioEngine,
    spotify_engine: SpotifyEngine,
    apple_sink: AppleMusicSink,
    mpris_controls: Option<MediaControls>,
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

        let mut spotify_engine = SpotifyEngine::new();
        spotify_engine.set_volume(initial_vol);

        let mut apple_sink = AppleMusicSink::new();
        apple_sink.set_volume(initial_vol);

        let mpris_controls = initialize_mpris(cmd_tx);

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
            spotify_authenticated: false,
            apple_authenticated: false,
        }));

        let mut orchestrator = Self {
            db,
            settings,
            state,
            local_engine,
            spotify_engine,
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
            AudioCommand::LoadQueue { uris, start_index } => {
                let queue: Vec<TrackMetadata> = uris
                    .iter()
                    .map(|u| self.resolve_track_from_uri(u))
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
                match engine {
                    ActiveEngine::Local => {
                        let _ = self
                            .local_engine
                            .play(self.transition_epoch, self.internal_event_tx.clone());
                        let pos = self.local_engine.get_position_ms();
                        self.set_playing_state(true, pos);
                    }
                    ActiveEngine::Spotify | ActiveEngine::AppleMusic => {
                        let pos = self.state.lock().unwrap().position_ms;
                        self.set_playing_state(true, pos);
                    }
                    ActiveEngine::None => {
                        let has_queue = !self.state.lock().unwrap().queue.is_empty();
                        if has_queue {
                            let idx = self.state.lock().unwrap().queue_index;
                            self.transition_to_index(idx);
                        }
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
                if engine == ActiveEngine::Local {
                    let _ = self.local_engine.seek(
                        clamped_pos,
                        self.transition_epoch,
                        self.internal_event_tx.clone(),
                    );
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
                // Simultaneous bidirectional volume normalization across all sinks
                self.local_engine.set_volume(clamped);
                self.spotify_engine.set_volume(clamped);
                self.apple_sink.set_volume(clamped);
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
                tokio::task::spawn_blocking(move || {
                    let (total_albums, total_tracks) = scan_all_storage(&db, &cfg);
                    let _ = bcast.send(PlaybackEvent::LibraryUpdated {
                        total_albums,
                        total_tracks,
                    });
                    if let Ok(mounts) = db.get_mounts() {
                        let _ = bcast.send(PlaybackEvent::StorageMountsChanged { mounts });
                    }
                });
            }
            AudioCommand::SuspendForSleep => {
                tracing::info!("System entering sleep — safe-pausing audio & releasing PipeWire");
                self.pause_active_engine();
                self.local_engine.release_pipewire_stream();
            }
            AudioCommand::ShutdownDaemon => {
                self.pause_active_engine();
                self.local_engine.release_pipewire_stream();
                std::process::exit(0);
            }
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
        match engine {
            ActiveEngine::Local => self.local_engine.pause(),
            ActiveEngine::Spotify => self.spotify_engine.pause(),
            ActiveEngine::AppleMusic => self.apple_sink.pause(),
            ActiveEngine::None => {}
        }
        let pos = self.get_live_position_ms();
        self.set_playing_state(false, pos);
        self.persist_session_to_vdf();
    }

    fn transition_to_index(&mut self, index: usize) {
        // 1. Bump transition_epoch to invalidate any in-flight monitor events
        self.transition_epoch = self.transition_epoch.wrapping_add(1);
        let epoch = self.transition_epoch;

        let track = {
            let mut st = self.state.lock().unwrap();
            if index >= st.queue.len() {
                return;
            }
            st.queue_index = index;
            st.queue[index].clone()
        };

        let target_engine = if track.uri.starts_with("spotify:") {
            ActiveEngine::Spotify
        } else if track.uri.starts_with("applemusic:") {
            ActiveEngine::AppleMusic
        } else {
            ActiveEngine::Local
        };

        // 2. Hard-pause outgoing engine if switching engines
        let prev_engine = self.state.lock().unwrap().active_engine;
        if prev_engine != target_engine {
            match prev_engine {
                ActiveEngine::Local => self.local_engine.release_pipewire_stream(),
                ActiveEngine::Spotify => self.spotify_engine.pause(),
                ActiveEngine::AppleMusic => self.apple_sink.pause(),
                ActiveEngine::None => {}
            }
        }

        // 3. Dispatch to target engine with Anti-Runaway-Skip Circuit Breaker
        match target_engine {
            ActiveEngine::Local => {
                let file_path = track.uri.strip_prefix("file://").unwrap_or(&track.uri);
                if !Path::new(file_path).exists() {
                    self.handle_track_load_failure("Offline/unplugged storage mount");
                    return;
                }
                match self.local_engine.load_and_play(
                    &track.uri,
                    0,
                    epoch,
                    self.internal_event_tx.clone(),
                ) {
                    Ok(()) => {
                        self.consecutive_failures = 0;
                    }
                    Err(e) => {
                        tracing::warn!("Failed to load local track {}: {e}", track.uri);
                        self.handle_track_load_failure(&e.to_string());
                        return;
                    }
                }
            }
            ActiveEngine::Spotify | ActiveEngine::AppleMusic => {
                // Phase 3/4 streaming activation
                self.consecutive_failures = 0;
            }
            ActiveEngine::None => {}
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
        let (queue_len, current_idx, repeat_mode) = {
            let st = self.state.lock().unwrap();
            (st.queue.len(), st.queue_index, st.repeat_mode)
        };
        if queue_len == 0 {
            return;
        }

        if !manual_skip && repeat_mode == RepeatMode::Track {
            self.transition_to_index(current_idx);
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
        if st.active_engine == ActiveEngine::Local {
            self.local_engine.get_position_ms()
        } else {
            st.position_ms
        }
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
            source: if uri.starts_with("spotify:") {
                "spotify".to_string()
            } else if uri.starts_with("applemusic:") {
                "apple_music".to_string()
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

        let engine = if track.uri.starts_with("spotify:") {
            ActiveEngine::Spotify
        } else if track.uri.starts_with("applemusic:") {
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
    let up_next: Vec<TrackMetadata> = st
        .queue
        .iter()
        .skip(st.queue_index + 1)
        .take(5)
        .cloned()
        .collect();
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
        spotify_authenticated: st.spotify_authenticated,
        apple_authenticated: st.apple_authenticated,
    }
}

