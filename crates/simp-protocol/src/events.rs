use crate::models::{ActiveEngine, MountStatus, PowerState, RepeatMode, TrackMetadata};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub enum PlaybackEvent {
    // Low-Frequency Events
    TrackChanged {
        metadata: TrackMetadata,
        position_ms: u32,
    },
    PlaybackStateChanged {
        is_playing: bool,
        position_ms: u32,
    },
    VolumeSynced {
        volume: f64,
    },
    QueueUpdated {
        queue: Vec<TrackMetadata>,
        current_index: usize,
        shuffle: bool,
        repeat_mode: RepeatMode,
    },
    LibraryUpdated {
        total_albums: usize,
        total_tracks: usize,
    },
    StorageMountsChanged {
        mounts: Vec<MountStatus>,
    },
    PowerStateChanged {
        power: PowerState,
    },
    NetworkCircuitBroken {
        message: String,
    },
    EndOfTrack {
        epoch: u64,
    },
    /// Emitted by `AudioOrchestrator` to drive the `<AppleMusicDriver />` MusicKit JS worker
    AppleSinkCommand {
        action: String,
        uri: Option<String>,
        position_ms: Option<u32>,
        volume: Option<f64>,
    },
    /// Emitted by the native Linux `/dev/input/js*` gamepad reader for standalone KDE windows
    GamepadInput {
        action: String,
    },

    // High-Frequency Event (500ms tick — suppressed when 0 WebSocket clients connected)
    ProgressTick {
        position_ms: u32,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ServerEnvelope {
    StateSnapshot {
        active_engine: ActiveEngine,
        is_playing: bool,
        position_ms: u32,
        volume: f64,
        shuffle: bool,
        repeat_mode: RepeatMode,
        current_track: Option<TrackMetadata>,
        up_next: Vec<TrackMetadata>,
        queue_length: usize,
        queue_index: usize,
        mounts: Vec<MountStatus>,
        power: PowerState,
        apple_authenticated: bool,
        #[serde(default)]
        soundcloud_authenticated: bool,
        #[serde(default)]
        internet_archive_authenticated: bool,
        #[serde(default)]
        brightness_pct: u8,
        #[serde(default)]
        daemon_version: String,
    },
    QueryResponse {
        req_id: u64,
        ok: bool,
        data: serde_json::Value,
        error: Option<String>,
    },
    Event {
        #[serde(flatten)]
        event: PlaybackEvent,
    },
}

