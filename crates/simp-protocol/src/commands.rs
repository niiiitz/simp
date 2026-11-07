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
    LoadQueue {
        uris: Vec<String>,
        start_index: usize,
        #[serde(default)]
        tracks: Vec<TrackMetadata>,
    },
    PlayAlbum { album_id: String, shuffle: bool },
    PlayPlaylist { playlist_id: String, shuffle: bool },
    Seek { position_ms: u32 },
    SeekRelative { delta_ms: i32 },
    SetVolume { volume: f64 },
    SetBrightness { brightness_pct: u8 },
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
    #[serde(rename = "configure_soundcloud")]
    ConfigureSoundCloud {
        client_id: String,
        client_secret: String,
    },
    #[serde(rename = "set_soundcloud_tokens")]
    SetSoundCloudTokens {
        access_token: String,
        #[serde(default)]
        refresh_token: String,
        #[serde(default)]
        expires_at: i64,
        #[serde(default)]
        auth_mode: String,
        #[serde(default)]
        username: String,
    },
    #[serde(rename = "disconnect_soundcloud")]
    DisconnectSoundCloud,
    #[serde(rename = "configure_internet_archive")]
    ConfigureInternetArchive {
        enabled: bool,
        #[serde(default)]
        username: String,
        #[serde(default)]
        access_key: String,
        #[serde(default)]
        secret_key: String,
        #[serde(default)]
        safe_search: Option<bool>,
    },
    #[serde(rename = "disconnect_internet_archive")]
    DisconnectInternetArchive,
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
    RestartDaemon,
    ResetDatabaseCache,
    FactoryReset,
    EjectOpticalDisc {
        #[serde(default)]
        device_path: Option<String>,
    },
    ShutdownDaemon,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "query", content = "params", rename_all = "snake_case")]
pub enum LibraryQuery {
    GetStateSnapshot,
    GetAlbums {
        source: Option<String>,
        #[serde(default)]
        mount_root: Option<String>,
        search: Option<String>,
        limit: usize,
        offset: usize,
    },
    GetAlbumTracks {
        album_id: String,
    },
    GetTracks {
        source: Option<String>,
        #[serde(default)]
        mount_root: Option<String>,
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
    RemoveTrackFromPlaylist {
        playlist_id: String,
        track_uri: String,
    },
    DeletePlaylist {
        playlist_id: String,
    },
    DeleteAlbum {
        album_id: String,
    },
    GetMountRoots,
    GetSettings,
    GetAppleMusicAuthConfig,
    #[serde(rename = "get_soundcloud_auth_config")]
    GetSoundCloudAuthConfig,
    #[serde(rename = "get_internet_archive_config")]
    GetInternetArchiveConfig,
    ScanOpticalDisc {
        #[serde(default)]
        device_path: Option<String>,
        #[serde(default)]
        force_refresh: bool,
    },
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

