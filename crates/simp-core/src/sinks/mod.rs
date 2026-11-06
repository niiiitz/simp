pub mod apple;
pub mod apple_api;
pub mod apple_native;
pub mod cdda;
#[cfg(feature = "experimental-dvd")]
pub mod dvd;
pub mod local;
pub mod soundcloud;
pub mod soundcloud_api;

use anyhow::Result;
use simp_protocol::{ActiveEngine, PlaybackEvent};
use tokio::sync::{broadcast, mpsc};

/// Unified abstraction for any audio playback backend in SIMP:
/// - `LocalAudioEngine`: Native Rust `Symphonia + Rodio` for local files (`FLAC`/`MP3`/`OGG`/`WAV`/`M4A`) and Optical CDs (`cdda://`)
/// - `AppleMusicSink`: Apple Music streaming sink (and drop-in boundary for future native Rust Widevine CDM / SoundCloud sinks)
pub trait AudioSink {
    /// Returns the protocol engine identifier for state snapshots.
    fn engine_kind(&self) -> ActiveEngine;

    /// Returns true if this sink handles the given track URI scheme.
    fn supports_uri(&self, uri: &str) -> bool;

    /// Loads and starts playing the specified URI at `start_pos_ms`.
    fn load_and_play_track(
        &mut self,
        uri: &str,
        start_pos_ms: u32,
        epoch: u64,
        internal_event_tx: &mpsc::UnboundedSender<PlaybackEvent>,
        broadcast_tx: &broadcast::Sender<PlaybackEvent>,
    ) -> Result<()>;

    /// Resumes playback on the currently loaded track.
    fn resume_playback(
        &mut self,
        epoch: u64,
        internal_event_tx: &mpsc::UnboundedSender<PlaybackEvent>,
        broadcast_tx: &broadcast::Sender<PlaybackEvent>,
    ) -> Result<()>;

    /// Pauses playback without tearing down the current track position.
    fn pause_playback(&mut self, broadcast_tx: &broadcast::Sender<PlaybackEvent>);

    /// Releases hardware audio resources (e.g., PipeWire `OutputStream`) when switching away or sleeping.
    fn suspend_sink(&mut self, broadcast_tx: &broadcast::Sender<PlaybackEvent>);

    /// Seeks to `position_ms` in the active track.
    fn seek_playback(
        &mut self,
        position_ms: u32,
        epoch: u64,
        internal_event_tx: &mpsc::UnboundedSender<PlaybackEvent>,
        broadcast_tx: &broadcast::Sender<PlaybackEvent>,
    ) -> Result<()>;

    /// Updates output volume (`0.0..=1.0`).
    fn sync_volume(&mut self, volume: f32, broadcast_tx: &broadcast::Sender<PlaybackEvent>);

    /// Returns the sink's live playback position if tracked natively in Rust (`Some(ms)`),
    /// or `None` if position is reported asynchronously via worker events.
    fn live_position_ms(&self) -> Option<u32> {
        None
    }

    /// Terminates any background worker processes and releases hardware audio streams on daemon shutdown/restart.
    fn shutdown_sink(&mut self, broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        self.suspend_sink(broadcast_tx);
    }
}
