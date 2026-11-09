use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(PartialEq, Eq, Clone, Copy, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ActiveEngine {
    Local,
    AppleMusic,
    #[serde(rename = "soundcloud")]
    SoundCloud,
    #[serde(rename = "internet_archive")]
    InternetArchive,
    #[default]
    None,
}

#[derive(PartialEq, Eq, Clone, Copy, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RepeatMode {
    #[default]
    Off,
    Queue,
    Track,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrackMetadata {
    pub uri: String,
    pub title: String,
    pub artists: Vec<String>,
    pub album: String,
    pub album_id: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub art_url: Option<String>,
    pub duration_ms: u32,
    pub source: String, // "local" | "steam_ost" | "apple_music" | "cdda"
    pub mount_root: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AlbumRecord {
    pub id: String,
    pub title: String,
    pub album_artist: String,
    pub release_year: Option<i32>,
    pub steam_app_id: Option<u32>,
    pub art_url: Option<String>,
    pub track_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlaylistRecord {
    pub id: String,
    pub name: String,
    pub description: String,
    pub origin: String, // "simp_mixed" | "apple_remote" | "soundcloud_remote" | "archive_remote"
    pub cover_art_url: Option<String>,
    pub track_count: usize,
    pub updated_at: i64,
    #[serde(default)]
    pub has_local: bool,
    #[serde(default)]
    pub has_apple: bool,
    #[serde(default)]
    pub has_soundcloud: bool,
    #[serde(default)]
    pub has_archive: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MountStatus {
    pub mount_root: String,
    pub label: String,
    pub mount_kind: String, // "user_custom" | "steam_vdf" | "removable_media"
    pub is_online: bool,
    pub track_count: usize,
    pub last_scanned_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct PowerState {
    pub on_battery: bool,
    pub battery_pct: Option<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct DvdAudioTrack {
    pub stream_index: u8,
    pub lang_code: String,
    pub lang_name: String,
    pub codec: String,
    pub channels: u8,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct DvdSubtitleTrack {
    pub stream_index: u8,
    pub lang_code: String,
    pub lang_name: String,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct DvdChapterInfo {
    pub chapter_number: u16,
    pub start_ms: u32,
    pub duration_ms: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct DvdTitleInfo {
    pub title_number: u16,
    pub vts_number: u8,
    pub vts_ttn: u8,
    pub label: String,
    pub duration_ms: u32,
    pub aspect_ratio: String,
    pub angles: u8,
    pub chapters: Vec<DvdChapterInfo>,
    pub audio_tracks: Vec<DvdAudioTrack>,
    pub subtitle_tracks: Vec<DvdSubtitleTrack>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct VideoQualityVariant {
    pub label: String,
    pub format: String,
    pub stream_url: String,
    #[serde(default)]
    pub size_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct VideoSubtitleVariant {
    pub id: String,
    pub lang_code: String,
    pub label: String,
    pub vtt_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct VideoEpisodeItem {
    pub episode_number: u16,
    pub label: String,
    pub duration_ms: u32,
    pub qualities: Vec<VideoQualityVariant>,
    pub subtitles: Vec<VideoSubtitleVariant>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct ArchiveItemSummary {
    pub identifier: String,
    pub title: String,
    pub creator: String,
    pub mediatype: String, // "movies" | "audio" | "etree"
    #[serde(default)]
    pub year: Option<i32>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub art_url: Option<String>,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub views_7d: u64,
    #[serde(default)]
    pub views_30d: u64,
    #[serde(default)]
    pub runtime_label: Option<String>,
    #[serde(default)]
    pub item_count: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct ArchiveItemDetail {
    pub summary: ArchiveItemSummary,
    #[serde(default)]
    pub episodes: Vec<VideoEpisodeItem>,
    #[serde(default)]
    pub tracks: Vec<TrackMetadata>,
}

/// Ephemeral Optical Disc (`cdda://` Audio CD or `dvd://` DVD-Video) status & resolved metadata
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct OpticalDiscStatus {
    pub drive_present: bool,
    pub device_path: String,
    pub disc_present: bool,
    pub is_audio_cd: bool,
    pub disc_id: Option<String>,
    pub album_title: String,
    pub artist_name: String,
    pub release_year: Option<i32>,
    pub art_url: Option<String>,
    pub tracks: Vec<TrackMetadata>,
    pub status_message: String,
    #[serde(default)]
    pub is_dvd_video: bool,
    #[serde(default)]
    pub dvd_css_available: bool,
    #[serde(default)]
    pub dvd_ffmpeg_available: bool,
    #[serde(default)]
    pub dvd_titles: Vec<DvdTitleInfo>,
}

/// Valve Data Format (`~/.config/simp/settings.vdf`) schema
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SimpSettings {
    pub audio: AudioSettings,
    pub ui: UiSettings,
    pub library: LibrarySettings,
    pub services: ServiceSettings,
    #[serde(default)]
    pub provisioning: ProvisioningSettings,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProvisioningSettings {
    #[serde(default = "default_widevine_version")]
    pub widevine_cdm_version: String,
    #[serde(default = "default_widevine_url_x86_64_linux")]
    pub widevine_cdm_url_x86_64_linux: String,
    #[serde(default = "default_widevine_url_aarch64_linux")]
    pub widevine_cdm_url_aarch64_linux: String,
    #[serde(default = "default_widevine_url_aarch64_macos")]
    pub widevine_cdm_url_aarch64_macos: String,
    #[serde(default = "default_widevine_url_x86_64_macos")]
    pub widevine_cdm_url_x86_64_macos: String,
    #[serde(default)]
    pub widevine_cdm_custom_path: String,
    #[serde(default = "default_github_releases_api_url")]
    pub github_releases_api_url: String,
    #[serde(default = "default_release_asset_template")]
    pub release_asset_template: String,
    #[serde(default = "default_update_channel")]
    pub update_channel: String,
}

fn default_widevine_version() -> String {
    "4.10.3112.0".to_string()
}

fn default_widevine_url_x86_64_linux() -> String {
    "https://edgedl.me.gvt1.com/edgedl/release2/chrome_component/acqexsh26ysyu3zxeotqtsp63idq_4.10.3112.0/oimompecagnajdejgnnjijobebaeigek_4.10.3112.0_linux64_ad7kyx4q7wx7xknykmkbonbbmnwq.crx3".to_string()
}

pub fn default_widevine_url_aarch64_linux() -> String {
    "https://archive.raspberrypi.com/debian/pool/main/w/widevine/libwidevinecdm0_4.10.2662.3+1_arm64.deb".to_string()
}

pub fn default_widevine_url_aarch64_macos() -> String {
    "https://dl.google.com/widevine-cdm/4.10.2710.0-mac-arm64.zip".to_string()
}

pub fn default_widevine_url_x86_64_macos() -> String {
    "https://dl.google.com/widevine-cdm/4.10.2710.0-mac-x64.zip".to_string()
}

fn default_github_releases_api_url() -> String {
    "https://api.github.com/repos/niiiitz/simp/releases?per_page=8".to_string()
}

fn default_release_asset_template() -> String {
    "https://github.com/niiiitz/simp/releases/download/{tag}/simp-steamos-userland-{arch}.tar.gz".to_string()
}

pub fn default_update_channel() -> String {
    if env!("CARGO_PKG_VERSION").contains('-') {
        "alpha".to_string()
    } else {
        "stable".to_string()
    }
}

impl Default for ProvisioningSettings {
    fn default() -> Self {
        Self {
            widevine_cdm_version: default_widevine_version(),
            widevine_cdm_url_x86_64_linux: default_widevine_url_x86_64_linux(),
            widevine_cdm_url_aarch64_linux: default_widevine_url_aarch64_linux(),
            widevine_cdm_url_aarch64_macos: default_widevine_url_aarch64_macos(),
            widevine_cdm_url_x86_64_macos: default_widevine_url_x86_64_macos(),
            widevine_cdm_custom_path: String::new(),
            github_releases_api_url: default_github_releases_api_url(),
            release_asset_template: default_release_asset_template(),
            update_channel: default_update_channel(),
        }
    }
}

fn default_master_volume() -> f64 {
    0.80
}

fn default_true() -> bool {
    true
}

fn default_modality() -> String {
    "oled_console".to_string()
}

fn default_burn_in_cycle_seconds() -> u32 {
    180
}

fn default_battery_dim_timeout_sec() -> u32 {
    30
}

fn default_battery_dim_opacity() -> f64 {
    0.15
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AudioSettings {
    #[serde(default = "default_master_volume")]
    pub master_volume: f64,
    #[serde(default = "default_true")]
    pub normalize_volume: bool,
    #[serde(default = "default_true")]
    pub steam_ost_arbitration: bool,
    #[serde(default = "default_true")]
    pub pause_on_headphone_disconnect: bool,
}

fn default_brightness_pct() -> u8 {
    80
}

fn default_soundcloud_auth_mode() -> String {
    "client_credentials".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UiSettings {
    #[serde(default = "default_modality")]
    pub modality: String,
    #[serde(default = "default_true")]
    pub oled_pixel_shift: bool,
    #[serde(default = "default_burn_in_cycle_seconds")]
    pub burn_in_cycle_seconds: u32,
    #[serde(default = "default_true")]
    pub battery_auto_dim: bool,
    #[serde(default = "default_battery_dim_timeout_sec")]
    pub battery_dim_timeout_sec: u32,
    #[serde(default = "default_battery_dim_opacity")]
    pub battery_dim_opacity: f64,
    #[serde(default = "default_brightness_pct")]
    pub brightness_pct: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LibrarySettings {
    #[serde(default = "default_true")]
    pub scan_steam_osts: bool,
    #[serde(default)]
    pub auto_mount_removable: bool,
    #[serde(default)]
    pub custom_paths: BTreeMap<String, String>,
    #[serde(default)]
    pub ignored_paths: BTreeMap<String, String>,
    #[serde(default)]
    pub initial_scan_completed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServiceSettings {
    #[serde(default)]
    pub apple_music_enabled: bool,
    #[serde(default)]
    pub apple_team_id: String,
    #[serde(default)]
    pub apple_key_id: String,
    #[serde(default)]
    pub apple_private_key_path: String,
    #[serde(default)]
    pub apple_developer_token: String,
    #[serde(default)]
    pub apple_music_user_token: String,
    #[serde(default = "default_true")]
    pub soundcloud_enabled: bool,
    #[serde(default)]
    pub soundcloud_client_id: String,
    #[serde(default)]
    pub soundcloud_client_secret: String,
    #[serde(default)]
    pub soundcloud_access_token: String,
    #[serde(default)]
    pub soundcloud_refresh_token: String,
    #[serde(default)]
    pub soundcloud_token_expires_at: i64,
    #[serde(default = "default_soundcloud_auth_mode")]
    pub soundcloud_auth_mode: String,
    #[serde(default)]
    pub soundcloud_username: String,
    #[serde(default)]
    pub soundcloud_api_v2: bool,
    #[serde(default = "default_true")]
    pub internet_archive_enabled: bool,
    #[serde(default)]
    pub internet_archive_username: String,
    #[serde(default)]
    pub internet_archive_access_key: String,
    #[serde(default)]
    pub internet_archive_secret_key: String,
    #[serde(default = "default_true")]
    pub internet_archive_safe_search: bool,
}

impl Default for SimpSettings {
    fn default() -> Self {
        let mut custom_paths = BTreeMap::new();
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            let music_dir = std::path::PathBuf::from(home).join("Music");
            custom_paths.insert("0".to_string(), music_dir.to_string_lossy().to_string());
        }
        Self {
            audio: AudioSettings {
                master_volume: 0.80,
                normalize_volume: true,
                steam_ost_arbitration: true,
                pause_on_headphone_disconnect: true,
            },
            ui: UiSettings {
                modality: "oled_console".to_string(),
                oled_pixel_shift: true,
                burn_in_cycle_seconds: 180,
                battery_auto_dim: true,
                battery_dim_timeout_sec: 30,
                battery_dim_opacity: 0.15,
                brightness_pct: 80,
            },
            library: LibrarySettings {
                scan_steam_osts: true,
                auto_mount_removable: false,
                custom_paths,
                ignored_paths: BTreeMap::new(),
                initial_scan_completed: false,
            },
            services: ServiceSettings {
                apple_music_enabled: false,
                apple_team_id: String::new(),
                apple_key_id: String::new(),
                apple_private_key_path: String::new(),
                apple_developer_token: String::new(),
                apple_music_user_token: String::new(),
                soundcloud_enabled: true,
                soundcloud_client_id: String::new(),
                soundcloud_client_secret: String::new(),
                soundcloud_access_token: String::new(),
                soundcloud_refresh_token: String::new(),
                soundcloud_token_expires_at: 0,
                soundcloud_auth_mode: "client_credentials".to_string(),
                soundcloud_username: String::new(),
                soundcloud_api_v2: false,
                internet_archive_enabled: true,
                internet_archive_username: String::new(),
                internet_archive_access_key: String::new(),
                internet_archive_secret_key: String::new(),
                internet_archive_safe_search: true,
            },
            provisioning: ProvisioningSettings::default(),
        }
    }
}

/// Cross-reboot & sleep session state (`~/.local/share/simp/session_state.vdf`)
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct SessionState {
    #[serde(default)]
    pub current_uri: Option<String>,
    #[serde(default)]
    pub position_ms: u32,
    #[serde(default)]
    pub queue_index: usize,
    #[serde(default)]
    pub shuffle: bool,
    #[serde(default)]
    pub repeat_mode: RepeatMode,
    #[serde(default)]
    pub queue_uris: BTreeMap<String, String>,
}

impl SessionState {
    /// Returns `queue_uris` sorted by numeric index (`0, 1, 2, ..., 10, 11...`)
    /// rather than lexicographical string key order (`"0", "1", "10", "2"`).
    pub fn ordered_queue_uris(&self) -> Vec<String> {
        let mut pairs: Vec<(usize, &String)> = self
            .queue_uris
            .iter()
            .map(|(k, v)| (k.parse::<usize>().unwrap_or(usize::MAX), v))
            .collect();
        pairs.sort_by_key(|(idx, _)| *idx);
        pairs.into_iter().map(|(_, v)| v.clone()).collect()
    }
}


