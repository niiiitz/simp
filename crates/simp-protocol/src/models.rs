use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(PartialEq, Eq, Clone, Copy, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ActiveEngine {
    Local,
    AppleMusic,
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
    pub origin: String, // "simp_mixed" | "apple_remote"
    pub cover_art_url: Option<String>,
    pub track_count: usize,
    pub updated_at: i64,
    #[serde(default)]
    pub has_local: bool,
    #[serde(default)]
    pub has_apple: bool,
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

/// Ephemeral Optical Audio CD (`cdda://`) status & resolved MusicBrainz metadata
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
    #[serde(default)]
    pub widevine_cdm_custom_path: String,
    #[serde(default = "default_github_releases_api_url")]
    pub github_releases_api_url: String,
    #[serde(default = "default_release_asset_template")]
    pub release_asset_template: String,
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

fn default_github_releases_api_url() -> String {
    "https://api.github.com/repos/niiiitz/simp/releases?per_page=8".to_string()
}

fn default_release_asset_template() -> String {
    "https://github.com/niiiitz/simp/releases/download/{tag}/simp-steamos-userland-{arch}.tar.gz".to_string()
}

impl Default for ProvisioningSettings {
    fn default() -> Self {
        Self {
            widevine_cdm_version: default_widevine_version(),
            widevine_cdm_url_x86_64_linux: default_widevine_url_x86_64_linux(),
            widevine_cdm_url_aarch64_linux: default_widevine_url_aarch64_linux(),
            widevine_cdm_custom_path: String::new(),
            github_releases_api_url: default_github_releases_api_url(),
            release_asset_template: default_release_asset_template(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AudioSettings {
    pub master_volume: f64,
    pub normalize_volume: bool,
    pub steam_ost_arbitration: bool,
    pub pause_on_headphone_disconnect: bool,
}

fn default_brightness_pct() -> u8 {
    100
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UiSettings {
    pub modality: String,
    pub oled_pixel_shift: bool,
    pub burn_in_cycle_seconds: u32,
    pub battery_auto_dim: bool,
    pub battery_dim_timeout_sec: u32,
    pub battery_dim_opacity: f64,
    #[serde(default = "default_brightness_pct")]
    pub brightness_pct: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LibrarySettings {
    pub scan_steam_osts: bool,
    pub auto_mount_removable: bool,
    pub custom_paths: BTreeMap<String, String>,
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
}

impl Default for SimpSettings {
    fn default() -> Self {
        let mut custom_paths = BTreeMap::new();
        if let Some(home) = std::env::var_os("HOME") {
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
                brightness_pct: 100,
            },
            library: LibrarySettings {
                scan_steam_osts: true,
                auto_mount_removable: true,
                custom_paths,
            },
            services: ServiceSettings {
                apple_music_enabled: false,
                apple_team_id: String::new(),
                apple_key_id: String::new(),
                apple_private_key_path: String::new(),
                apple_developer_token: String::new(),
                apple_music_user_token: String::new(),
            },
            provisioning: ProvisioningSettings::default(),
        }
    }
}

/// Cross-reboot & sleep session state (`~/.local/share/simp/session_state.vdf`)
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct SessionState {
    pub current_uri: Option<String>,
    pub position_ms: u32,
    pub queue_index: usize,
    pub shuffle: bool,
    pub repeat_mode: RepeatMode,
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


