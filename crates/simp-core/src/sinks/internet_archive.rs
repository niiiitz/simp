//! Native Rust Internet Archive (`ia:audio:{identifier}/{filename}`) Audio Sink.
//!
//! Streams unencrypted Internet Archive audio derivatives (`VBR MP3`, `Flac`, `Ogg Vorbis`)
//! through SIMP's in-process `http_pool` (`libcurl`) and `LocalAudioEngine` (`Symphonia + Rodio -> PipeWire`).
//! See `ATTRIBUTIONS.md` for credits to `@jjjake/internetarchive` and `archive.org`.

use crate::sinks::apple_native::source::{DecryptedFmp4RodioSource, StreamingPcmState};
use crate::sinks::internet_archive_api::{resolve_internet_archive_credentials, IA_USER_AGENT};
use crate::sinks::local::LocalAudioEngine;
use crate::sinks::soundcloud::decode_clear_audio_bytes_to_pcm;
use crate::time_tracker::LocalTimeTracker;
use anyhow::{anyhow, Result};
use simp_protocol::{PlaybackEvent, SimpSettings};
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use tokio::sync::{broadcast, mpsc};

#[derive(Clone, Default)]
pub struct InternetArchiveSink {
    pub volume: f64,
    pub is_authenticated: bool,
    pub native_engine: Arc<Mutex<Option<LocalAudioEngine>>>,
}

impl InternetArchiveSink {
    pub fn new() -> Self {
        Self {
            volume: 0.80,
            is_authenticated: false,
            native_engine: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_volume(&mut self, normalized_vol: f64) {
        self.volume = normalized_vol.clamp(0.0, 1.0);
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                eng.set_volume(self.volume);
            }
        }
    }

    pub fn prime_restored_session(&mut self, uri: String, position_ms: u32) {
        if let Ok(mut guard) = self.native_engine.lock() {
            let eng = guard.get_or_insert_with(LocalAudioEngine::new);
            eng.set_volume(self.volume);
            eng.prime_restored_session(uri, position_ms);
        }
    }

    pub fn check_idle_suspend(&mut self) {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                eng.check_idle_suspend();
            }
        }
    }
}

impl crate::sinks::AudioSink for InternetArchiveSink {
    fn engine_kind(&self) -> simp_protocol::ActiveEngine {
        simp_protocol::ActiveEngine::InternetArchive
    }

    fn supports_uri(&self, uri: &str) -> bool {
        uri.starts_with("ia:audio:") || uri.starts_with("ia://audio/")
    }

    fn load_and_play_track(
        &mut self,
        uri: &str,
        start_pos_ms: u32,
        epoch: u64,
        internal_event_tx: &mpsc::UnboundedSender<PlaybackEvent>,
        _broadcast_tx: &broadcast::Sender<PlaybackEvent>,
    ) -> Result<()> {
        let mut guard = self
            .native_engine
            .lock()
            .map_err(|_| anyhow!("InternetArchive native_engine mutex poisoned"))?;
        let eng = guard.get_or_insert_with(LocalAudioEngine::new);
        eng.set_volume(self.volume);
        eng.load_and_play(uri, start_pos_ms, epoch, internal_event_tx.clone())
    }

    fn resume_playback(
        &mut self,
        epoch: u64,
        internal_event_tx: &mpsc::UnboundedSender<PlaybackEvent>,
        _broadcast_tx: &broadcast::Sender<PlaybackEvent>,
    ) -> Result<()> {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                return eng.play(epoch, internal_event_tx.clone());
            }
        }
        Ok(())
    }

    fn pause_playback(&mut self, _broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                eng.pause();
            }
        }
    }

    fn suspend_sink(&mut self, _broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                eng.release_pipewire_stream();
            }
        }
    }

    fn seek_playback(
        &mut self,
        position_ms: u32,
        epoch: u64,
        internal_event_tx: &mpsc::UnboundedSender<PlaybackEvent>,
        _broadcast_tx: &broadcast::Sender<PlaybackEvent>,
    ) -> Result<()> {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                return eng.seek(position_ms, epoch, internal_event_tx.clone());
            }
        }
        Ok(())
    }

    fn sync_volume(&mut self, volume: f32, _broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        self.set_volume(volume as f64);
    }

    fn live_position_ms(&self) -> Option<u32> {
        if let Ok(guard) = self.native_engine.lock() {
            if let Some(ref eng) = *guard {
                return Some(eng.get_position_ms());
            }
        }
        None
    }
}

pub fn resolve_ia_audio_download_url(uri: &str) -> Option<(String, String)> {
    let rest = uri
        .strip_prefix("ia:audio:")
        .or_else(|| uri.strip_prefix("ia://audio/"))?;
    let (id, file_part) = rest.split_once('/')?;
    if id.is_empty() || file_part.is_empty() {
        return None;
    }
    let ext = Path::new(file_part)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("mp3")
        .to_lowercase();
    let url = format!("https://archive.org/download/{id}/{file_part}");
    Some((url, ext))
}

pub fn spawn_progressive_internet_archive_rodio_source(
    settings: SimpSettings,
    track_uri: String,
    start_pos_ms: u32,
    epoch: u64,
    active_epoch: Arc<AtomicU64>,
    tracker: Arc<Mutex<LocalTimeTracker>>,
    user_paused_flag: Arc<AtomicBool>,
) -> Result<DecryptedFmp4RodioSource> {
    let (download_url, ext_hint) = resolve_ia_audio_download_url(&track_uri)
        .ok_or_else(|| anyhow!("Invalid Internet Archive audio URI: {track_uri}"))?;

    let state = Arc::new(Mutex::new(StreamingPcmState {
        samples: Vec::new(),
        total_expected_samples: 0,
        is_complete: false,
        aborted: false,
    }));
    let source = DecryptedFmp4RodioSource::new_progressive(
        state.clone(),
        start_pos_ms,
        epoch,
        active_epoch.clone(),
    );

    std::thread::Builder::new()
        .name("simp-ia-audio".to_string())
        .spawn(move || {
            let mark_aborted = |st: &Arc<Mutex<StreamingPcmState>>| {
                if let Ok(mut g) = st.lock() {
                    g.aborted = true;
                    g.is_complete = true;
                }
            };

            if active_epoch.load(Ordering::SeqCst) != epoch {
                mark_aborted(&state);
                return;
            }

            let creds = resolve_internet_archive_credentials(&settings);
            let auth_val = format!("LOW {}:{}", creds.access_key, creds.secret_key);
            let mut headers: Vec<(&str, &str)> = vec![("User-Agent", IA_USER_AGENT)];
            if !creds.access_key.is_empty() && !creds.secret_key.is_empty() {
                headers.push(("Authorization", &auth_val));
            }

            // For MP3 streams starting at 0ms, fetch an initial 384 KB byte-range chunk for fast start (<350ms),
            // then stream remaining 1.5 MB chunks in the background.
            if ext_hint == "mp3" && start_pos_ms == 0 {
                const INITIAL_BYTES: u64 = 384 * 1024;
                const CHUNK_BYTES: u64 = 1536 * 1024;
                if let Ok(initial_buf) = crate::http_pool::http_get_bytes(
                    &download_url,
                    &headers,
                    Some((0, INITIAL_BYTES - 1)),
                    20,
                ) {
                    let got_len = initial_buf.len() as u64;
                    if let Ok((pcm, _, _)) =
                        decode_clear_audio_bytes_to_pcm(initial_buf.clone(), Some("mp3"))
                    {
                        let is_eof = got_len < INITIAL_BYTES;
                        if let Ok(mut g) = state.lock() {
                            g.total_expected_samples = if is_eof {
                                pcm.len()
                            } else {
                                pcm.len() * 12
                            };
                            g.samples = pcm;
                            g.is_complete = is_eof;
                        }

                        if active_epoch.load(Ordering::SeqCst) == epoch {
                            if let Ok(mut tr) = tracker.lock() {
                                tr.reset();
                                tr.seek(start_pos_ms);
                                if !user_paused_flag.load(Ordering::SeqCst) {
                                    tr.play();
                                }
                            }
                        }

                        if is_eof {
                            return;
                        }

                        let mut all_bytes = initial_buf;
                        let mut decoded_pcm_len = state.lock().map(|g| g.samples.len()).unwrap_or(0);
                        let mut offset = got_len;

                        loop {
                            if active_epoch.load(Ordering::SeqCst) != epoch {
                                mark_aborted(&state);
                                return;
                            }
                            match crate::http_pool::http_get_bytes(
                                &download_url,
                                &headers,
                                Some((offset, offset + CHUNK_BYTES - 1)),
                                30,
                            ) {
                                Ok(chunk) if !chunk.is_empty() => {
                                    let chunk_len = chunk.len() as u64;
                                    all_bytes.extend_from_slice(&chunk);
                                    offset += chunk_len;
                                    if let Ok((full_pcm, _, _)) =
                                        decode_clear_audio_bytes_to_pcm(all_bytes.clone(), Some("mp3"))
                                    {
                                        if full_pcm.len() > decoded_pcm_len {
                                            if let Ok(mut g) = state.lock() {
                                                g.samples
                                                    .extend_from_slice(&full_pcm[decoded_pcm_len..]);
                                                g.total_expected_samples =
                                                    g.total_expected_samples.max(full_pcm.len());
                                            }
                                            decoded_pcm_len = full_pcm.len();
                                        }
                                    }
                                    if chunk_len < CHUNK_BYTES {
                                        break;
                                    }
                                }
                                _ => break,
                            }
                        }

                        if let Ok(mut g) = state.lock() {
                            g.total_expected_samples = g.samples.len();
                            g.is_complete = true;
                        }
                        return;
                    }
                }
            }

            // Full download & decode fallback (FLAC / OGG / M4A or seeked MP3)
            match crate::http_pool::http_get_bytes(&download_url, &headers, None, 60) {
                Ok(bytes) => {
                    match decode_clear_audio_bytes_to_pcm(bytes, Some(&ext_hint))
                        .or_else(|_| decode_clear_audio_bytes_to_pcm(Vec::new(), None))
                    {
                        Ok((pcm, _, _)) => {
                            if let Ok(mut g) = state.lock() {
                                g.total_expected_samples = pcm.len();
                                g.samples = pcm;
                                g.is_complete = true;
                            }
                            if active_epoch.load(Ordering::SeqCst) == epoch {
                                if let Ok(mut tr) = tracker.lock() {
                                    tr.reset();
                                    tr.seek(start_pos_ms);
                                    if !user_paused_flag.load(Ordering::SeqCst) {
                                        tr.play();
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            tracing::warn!(
                                "Failed to decode Internet Archive audio stream {download_url}: {e}"
                            );
                            mark_aborted(&state);
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "Failed to download Internet Archive audio stream {download_url}: {e}"
                    );
                    mark_aborted(&state);
                }
            }
        })
        .map_err(|e| anyhow!("Failed to spawn Internet Archive audio worker: {e}"))?;

    Ok(source)
}
