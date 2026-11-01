use crate::models::{AlbumRecord, PlaylistRecord, RepeatMode, TrackMetadata};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "cmd", content = "payload", rename_all = "snake_case")]
pub enum AudioCommand {
    Play,
    Pause,
    TogglePlayPause,
    Next,
    Previous,
    Load { uri: String },
    LoadQueue { uris: Vec<String>, start_index: usize },
    PlayAlbum { album_id: String, shuffle: bool },
    PlayPlaylist { playlist_id: String, shuffle: bool },
    Seek { position_ms: u32 },
    SeekRelative { delta_ms: i32 },
    SetVolume { volume: f64 },
    SetShuffle { enabled: bool },
    SetRepeat { mode: RepeatMode },
    CycleRepeat,
    AddLibraryPath { path: String },
    RemoveLibraryPath { path: String },
    RescanStorage,
    ConfigureAppleMusic {
        team_id: String,
        key_id: String,
        private_key_path: String,
        developer_token: Option<String>,
    },
    SetAppleMusicUserToken {
        music_user_token: String,
    },
    DisconnectAppleMusic,
    ImportCatalogTracks {
        source: String,
        album: Option<AlbumRecord>,
        playlist: Option<PlaylistRecord>,
        tracks: Vec<TrackMetadata>,
    },
    AppleWorkerReport {
        state: String,
        track: Option<TrackMetadata>,
        position_ms: u32,
        duration_ms: Option<u32>,
    },
    SuspendForSleep,
    ShutdownDaemon,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "query", content = "params", rename_all = "snake_case")]
pub enum LibraryQuery {
    GetStateSnapshot,
    GetAlbums {
        source: Option<String>,
        search: Option<String>,
        limit: usize,
        offset: usize,
    },
    GetAlbumTracks {
        album_id: String,
    },
    GetTracks {
        source: Option<String>,
        search: Option<String>,
        limit: usize,
        offset: usize,
    },
    GetPlaylists,
    GetPlaylistItems {
        playlist_id: String,
        limit: usize,
        offset: usize,
    },
    CreatePlaylist {
        name: String,
        description: String,
    },
    AddTracksToPlaylist {
        playlist_id: String,
        uris: Vec<String>,
    },
    GetMountRoots,
    GetSettings,
    GetAppleMusicAuthConfig,
    StartSpotifyAuth,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ClientEnvelope {
    Command {
        #[serde(flatten)]
        command: AudioCommand,
    },
    Query {
        req_id: u64,
        #[serde(flatten)]
        query: LibraryQuery,
    },
    AppleWorkerEvent {
        state: String,
        track: Option<TrackMetadata>,
        position_ms: u32,
        #[serde(default)]
        duration_ms: Option<u32>,
    },
}

