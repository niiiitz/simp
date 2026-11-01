/// Pillar 4: Apple Music Virtual Sink Facade.
/// Emits commands over IPC to the lazy-loaded WebView `<AppleMusicDriver />` in Phase 4.
#[derive(Clone, Default)]
pub struct AppleMusicSink {
    pub volume: f64,
    pub is_authenticated: bool,
}

impl AppleMusicSink {
    pub fn new() -> Self {
        Self {
            volume: 0.80,
            is_authenticated: false,
        }
    }

    pub fn set_volume(&mut self, normalized_vol: f64) {
        self.volume = normalized_vol.clamp(0.0, 1.0);
    }

    pub fn pause(&mut self) {
        // Phase 4: emits apple_cmd = pause
    }
}

