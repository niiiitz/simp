use moka::future::Cache;
use simp_protocol::TrackMetadata;
use std::time::Duration;

/// Pillar 3: Spotify Engine state & `moka` async metadata cache.
/// Full `librespot` + `rspotify` PKCE OAuth trap connects in Phase 3.
#[derive(Clone)]
pub struct SpotifyEngine {
    pub metadata_cache: Cache<String, TrackMetadata>,
    pub volume_u16: u16,
    pub is_authenticated: bool,
}

impl Default for SpotifyEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SpotifyEngine {
    pub fn new() -> Self {
        let metadata_cache = Cache::builder()
            .max_capacity(2000)
            .time_to_idle(Duration::from_secs(60 * 60))
            .build();
        Self {
            metadata_cache,
            volume_u16: (0.80 * 65535.0) as u16,
            is_authenticated: false,
        }
    }

    pub fn set_volume(&mut self, normalized_vol: f64) {
        self.volume_u16 = (normalized_vol.clamp(0.0, 1.0) * 65535.0) as u16;
    }

    pub fn pause(&mut self) {
        // Phase 3: forwards to librespot player.pause()
    }
}

