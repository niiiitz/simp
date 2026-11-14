use serde::{Deserialize, Serialize};
use std::f32::consts::PI;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering},
    Arc, OnceLock,
};

/// Standard 10-band ISO octave center frequencies (Hz):
/// `32Hz, 64Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz`.
pub const EQ_BAND_FREQS_HZ: [f32; 10] = [
    32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

pub const EQ_BAND_LABELS: [&str; 10] = [
    "32", "64", "125", "250", "500", "1k", "2k", "4k", "8k", "16k",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VocalDspMode {
    #[default]
    Off = 0,
    /// Attenuates center-panned vocals in the `130 Hz – 4.5 kHz` vocal band while preserving
    /// `< 130 Hz` center sub-bass/kick and stereo sides (Karaoke / Instrumental mode).
    VocalRemover = 1,
    /// Emphasizes center-panned vocals in the `130 Hz – 4.5 kHz` vocal band while attenuating
    /// sub-bass and stereo accompaniment (Vocal Focus / Acapella study mode).
    VocalIsolate = 2,
}

impl VocalDspMode {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::VocalRemover,
            2 => Self::VocalIsolate,
            _ => Self::Off,
        }
    }

    pub fn from_str_id(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "vocal_remover" | "karaoke" | "instrumental" | "remove" => Self::VocalRemover,
            "vocal_isolate" | "isolate" | "acapella" | "vocals" => Self::VocalIsolate,
            _ => Self::Off,
        }
    }

    pub fn as_str_id(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::VocalRemover => "vocal_remover",
            Self::VocalIsolate => "vocal_isolate",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EqPresetDescriptor {
    pub id: &'static str,
    pub label: &'static str,
    pub preamp_db: f32,
    pub bands_db: [f32; 10],
}

pub const BUILTIN_EQ_PRESETS: [EqPresetDescriptor; 8] = [
    EqPresetDescriptor {
        id: "flat",
        label: "Flat",
        preamp_db: 0.0,
        bands_db: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    },
    EqPresetDescriptor {
        id: "bass_boost",
        label: "Bass Boost",
        preamp_db: -2.5,
        bands_db: [6.0, 5.0, 3.5, 1.5, 0.0, 0.0, 0.0, 0.5, 1.0, 1.0],
    },
    EqPresetDescriptor {
        id: "vocal_presence",
        label: "Vocal Presence",
        preamp_db: -1.5,
        bands_db: [-2.0, -1.5, -0.5, 1.5, 3.5, 4.5, 4.0, 2.0, 0.5, 0.0],
    },
    EqPresetDescriptor {
        id: "treble_sparkle",
        label: "Treble Sparkle",
        preamp_db: -2.0,
        bands_db: [0.0, 0.0, 0.0, 0.0, 0.5, 1.5, 3.0, 4.5, 5.5, 6.0],
    },
    EqPresetDescriptor {
        id: "late_night",
        label: "Late Night",
        preamp_db: -2.0,
        bands_db: [4.5, 3.5, 1.5, -0.5, -1.5, -1.0, 0.5, 2.5, 4.0, 4.5],
    },
    EqPresetDescriptor {
        id: "v_shape",
        label: "V-Shape",
        preamp_db: -2.5,
        bands_db: [5.5, 4.5, 2.0, -1.5, -2.5, -1.5, 1.5, 3.5, 5.0, 5.5],
    },
    EqPresetDescriptor {
        id: "handheld_speakers",
        label: "Handheld Deck",
        preamp_db: -1.5,
        bands_db: [3.5, 4.5, 3.0, 1.0, -0.5, 1.0, 2.5, 3.0, 2.5, 2.0],
    },
    EqPresetDescriptor {
        id: "custom",
        label: "Custom",
        preamp_db: 0.0,
        bands_db: [0.0; 10],
    },
];

pub fn lookup_eq_preset(preset_id: &str) -> Option<&'static EqPresetDescriptor> {
    let norm = preset_id.trim().to_ascii_lowercase();
    BUILTIN_EQ_PRESETS
        .iter()
        .find(|p| p.id == norm && p.id != "custom")
}

pub fn parse_eq_bands_csv(csv: &str) -> [f32; 10] {
    let mut out = [0.0f32; 10];
    for (idx, part) in csv.split(',').take(10).enumerate() {
        if let Ok(v) = part.trim().parse::<f32>() {
            if v.is_finite() {
                out[idx] = v.clamp(-12.0, 12.0);
            }
        }
    }
    out
}

pub fn format_eq_bands_csv(bands: &[f32; 10]) -> String {
    bands
        .iter()
        .map(|v| format!("{:.1}", v.clamp(-12.0, 12.0)))
        .collect::<Vec<_>>()
        .join(",")
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DspConfigSnapshot {
    pub eq_enabled: bool,
    pub eq_preset: String,
    pub preamp_db: f32,
    pub bands_db: [f32; 10],
    pub vocal_mode: String,
    pub vocal_strength: f32,
}

impl Default for DspConfigSnapshot {
    fn default() -> Self {
        Self {
            eq_enabled: false,
            eq_preset: "flat".to_string(),
            preamp_db: 0.0,
            bands_db: [0.0; 10],
            vocal_mode: "off".to_string(),
            vocal_strength: 0.90,
        }
    }
}

/// Lock-free atomic DSP configuration shared between the IPC/Orchestrator threads and the
/// real-time `rodio` audio callback thread.
pub struct DspSharedState {
    config_epoch: AtomicU64,
    eq_enabled: AtomicBool,
    preamp_db_bits: AtomicU32,
    band_gains_db_bits: [AtomicU32; 10],
    vocal_mode: AtomicU8,
    vocal_strength_bits: AtomicU32,
    preset_id: std::sync::Mutex<String>,
}

impl Default for DspSharedState {
    fn default() -> Self {
        Self::new()
    }
}

impl DspSharedState {
    pub fn new() -> Self {
        Self {
            config_epoch: AtomicU64::new(1),
            eq_enabled: AtomicBool::new(false),
            preamp_db_bits: AtomicU32::new(0.0f32.to_bits()),
            band_gains_db_bits: std::array::from_fn(|_| AtomicU32::new(0.0f32.to_bits())),
            vocal_mode: AtomicU8::new(VocalDspMode::Off as u8),
            vocal_strength_bits: AtomicU32::new(0.90f32.to_bits()),
            preset_id: std::sync::Mutex::new("flat".to_string()),
        }
    }

    #[inline]
    pub fn epoch(&self) -> u64 {
        self.config_epoch.load(Ordering::Relaxed)
    }

    #[inline]
    pub fn is_bypassed(&self) -> bool {
        let eq_on = self.eq_enabled.load(Ordering::Relaxed);
        let v_mode = VocalDspMode::from_u8(self.vocal_mode.load(Ordering::Relaxed));
        !eq_on && v_mode == VocalDspMode::Off
    }

    pub fn snapshot(&self) -> DspConfigSnapshot {
        let mut bands_db = [0.0f32; 10];
        for (i, slot) in self.band_gains_db_bits.iter().enumerate() {
            let v = f32::from_bits(slot.load(Ordering::Relaxed));
            bands_db[i] = if v.is_finite() {
                v.clamp(-12.0, 12.0)
            } else {
                0.0
            };
        }
        let preamp_raw = f32::from_bits(self.preamp_db_bits.load(Ordering::Relaxed));
        let strength_raw = f32::from_bits(self.vocal_strength_bits.load(Ordering::Relaxed));
        let preset = self
            .preset_id
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "flat".to_string());
        DspConfigSnapshot {
            eq_enabled: self.eq_enabled.load(Ordering::Relaxed),
            eq_preset: preset,
            preamp_db: if preamp_raw.is_finite() {
                preamp_raw.clamp(-12.0, 12.0)
            } else {
                0.0
            },
            bands_db,
            vocal_mode: VocalDspMode::from_u8(self.vocal_mode.load(Ordering::Relaxed))
                .as_str_id()
                .to_string(),
            vocal_strength: if strength_raw.is_finite() {
                strength_raw.clamp(0.0, 1.0)
            } else {
                0.90
            },
        }
    }

    pub fn apply_snapshot(&self, snap: &DspConfigSnapshot) {
        self.eq_enabled.store(snap.eq_enabled, Ordering::Relaxed);
        let preamp = snap.preamp_db.clamp(-12.0, 12.0);
        self.preamp_db_bits
            .store(preamp.to_bits(), Ordering::Relaxed);
        for (i, &gain) in snap.bands_db.iter().enumerate() {
            let g = gain.clamp(-12.0, 12.0);
            self.band_gains_db_bits[i].store(g.to_bits(), Ordering::Relaxed);
        }
        let v_mode = VocalDspMode::from_str_id(&snap.vocal_mode);
        self.vocal_mode.store(v_mode as u8, Ordering::Relaxed);
        let strength = snap.vocal_strength.clamp(0.0, 1.0);
        self.vocal_strength_bits
            .store(strength.to_bits(), Ordering::Relaxed);
        if let Ok(mut guard) = self.preset_id.lock() {
            *guard = snap.eq_preset.trim().to_ascii_lowercase();
        }
        self.config_epoch.fetch_add(1, Ordering::Release);
    }

    pub fn load_from_audio_settings(&self, audio: &simp_protocol::AudioSettings) {
        let mut snap = DspConfigSnapshot {
            eq_enabled: audio.eq_enabled,
            eq_preset: if audio.eq_preset.trim().is_empty() {
                "flat".to_string()
            } else {
                audio.eq_preset.trim().to_ascii_lowercase()
            },
            preamp_db: (audio.eq_preamp_db as f32).clamp(-12.0, 12.0),
            bands_db: parse_eq_bands_csv(&audio.eq_bands_csv),
            vocal_mode: audio.vocal_mode.clone(),
            vocal_strength: (audio.vocal_strength as f32).clamp(0.0, 1.0),
        };
        if let Some(preset) = lookup_eq_preset(&snap.eq_preset) {
            if snap.bands_db == [0.0; 10] && snap.eq_preset != "flat" {
                snap.bands_db = preset.bands_db;
                snap.preamp_db = preset.preamp_db;
            }
        }
        self.apply_snapshot(&snap);
    }
}

static GLOBAL_DSP_STATE: OnceLock<Arc<DspSharedState>> = OnceLock::new();

pub fn global_dsp_state() -> Arc<DspSharedState> {
    GLOBAL_DSP_STATE
        .get_or_init(|| Arc::new(DspSharedState::new()))
        .clone()
}

/// Normalized Direct Form II Transposed biquad filter coefficients & stereo delay lines.
#[derive(Clone, Copy, Debug)]
struct StereoBiquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    active: bool,
    z1_l: f32,
    z2_l: f32,
    z1_r: f32,
    z2_r: f32,
}

impl Default for StereoBiquad {
    fn default() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            active: false,
            z1_l: 0.0,
            z2_l: 0.0,
            z1_r: 0.0,
            z2_r: 0.0,
        }
    }
}

impl StereoBiquad {
    #[inline]
    fn reset_state(&mut self) {
        self.z1_l = 0.0;
        self.z2_l = 0.0;
        self.z1_r = 0.0;
        self.z2_r = 0.0;
    }

    #[inline]
    fn process_left(&mut self, x: f32) -> f32 {
        if !self.active {
            return x;
        }
        let y = self.b0 * x + self.z1_l;
        self.z1_l = self.b1 * x - self.a1 * y + self.z2_l;
        self.z2_l = self.b2 * x - self.a2 * y;
        y
    }

    #[inline]
    fn process_right(&mut self, x: f32) -> f32 {
        if !self.active {
            return x;
        }
        let y = self.b0 * x + self.z1_r;
        self.z1_r = self.b1 * x - self.a1 * y + self.z2_r;
        self.z2_r = self.b2 * x - self.a2 * y;
        y
    }

    fn set_peaking(&mut self, freq_hz: f32, sample_rate: f32, q: f32, gain_db: f32) {
        if gain_db.abs() < 0.05 || freq_hz >= sample_rate * 0.47 {
            self.b0 = 1.0;
            self.b1 = 0.0;
            self.b2 = 0.0;
            self.a1 = 0.0;
            self.a2 = 0.0;
            self.active = false;
            return;
        }
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq_hz / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * q.max(0.2));

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;

        let inv_a0 = 1.0 / a0;
        self.b0 = b0 * inv_a0;
        self.b1 = b1 * inv_a0;
        self.b2 = b2 * inv_a0;
        self.a1 = a1 * inv_a0;
        self.a2 = a2 * inv_a0;
        self.active = true;
    }

    fn set_low_shelf(&mut self, freq_hz: f32, sample_rate: f32, gain_db: f32) {
        if gain_db.abs() < 0.05 || freq_hz >= sample_rate * 0.47 {
            self.b0 = 1.0;
            self.b1 = 0.0;
            self.b2 = 0.0;
            self.a1 = 0.0;
            self.a2 = 0.0;
            self.active = false;
            return;
        }
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq_hz / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let sqrt_a = a.sqrt();
        let alpha = sin_w0 * 0.5 * std::f32::consts::SQRT_2;

        let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha);
        let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha);
        let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha;
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha;

        let inv_a0 = 1.0 / a0;
        self.b0 = b0 * inv_a0;
        self.b1 = b1 * inv_a0;
        self.b2 = b2 * inv_a0;
        self.a1 = a1 * inv_a0;
        self.a2 = a2 * inv_a0;
        self.active = true;
    }

    fn set_high_shelf(&mut self, freq_hz: f32, sample_rate: f32, gain_db: f32) {
        if gain_db.abs() < 0.05 || freq_hz >= sample_rate * 0.47 {
            self.b0 = 1.0;
            self.b1 = 0.0;
            self.b2 = 0.0;
            self.a1 = 0.0;
            self.a2 = 0.0;
            self.active = false;
            return;
        }
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * freq_hz / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let sqrt_a = a.sqrt();
        let alpha = sin_w0 * 0.5 * std::f32::consts::SQRT_2;

        let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha);
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha);
        let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha;
        let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha;

        let inv_a0 = 1.0 / a0;
        self.b0 = b0 * inv_a0;
        self.b1 = b1 * inv_a0;
        self.b2 = b2 * inv_a0;
        self.a1 = a1 * inv_a0;
        self.a2 = a2 * inv_a0;
        self.active = true;
    }

    fn set_highpass(&mut self, freq_hz: f32, sample_rate: f32, q: f32) {
        let w0 = 2.0 * PI * (freq_hz.min(sample_rate * 0.45)) / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * q.max(0.2));

        let b0 = (1.0 + cos_w0) * 0.5;
        let b1 = -(1.0 + cos_w0);
        let b2 = (1.0 + cos_w0) * 0.5;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        let inv_a0 = 1.0 / a0;
        self.b0 = b0 * inv_a0;
        self.b1 = b1 * inv_a0;
        self.b2 = b2 * inv_a0;
        self.a1 = a1 * inv_a0;
        self.a2 = a2 * inv_a0;
        self.active = true;
    }

    fn set_lowpass(&mut self, freq_hz: f32, sample_rate: f32, q: f32) {
        let w0 = 2.0 * PI * (freq_hz.min(sample_rate * 0.45)) / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * q.max(0.2));

        let b0 = (1.0 - cos_w0) * 0.5;
        let b1 = 1.0 - cos_w0;
        let b2 = (1.0 - cos_w0) * 0.5;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        let inv_a0 = 1.0 / a0;
        self.b0 = b0 * inv_a0;
        self.b1 = b1 * inv_a0;
        self.b2 = b2 * inv_a0;
        self.a1 = a1 * inv_a0;
        self.a2 = a2 * inv_a0;
        self.active = true;
    }
}

/// Transparent soft-clip limiter (`|x| <= 0.85` is 100% linear; smooth rational knee up to `±1.0`).
#[inline]
pub fn soft_clip_sample(x: f32) -> f32 {
    if !x.is_finite() {
        return 0.0;
    }
    let abs_x = x.abs();
    if abs_x <= 0.85 {
        x
    } else {
        let excess = abs_x - 0.85;
        let compressed = 0.85 + 0.15 * (excess / (0.15 + excess));
        compressed.copysign(x)
    }
}

/// Per-stream real-time DSP processor instance owned by `AudioTapSource`.
pub struct StreamDspProcessor {
    shared: Arc<DspSharedState>,
    applied_epoch: u64,
    sample_rate: u32,
    eq_enabled: bool,
    preamp_linear: f32,
    eq_bands: [StereoBiquad; 10],
    vocal_mode: VocalDspMode,
    vocal_strength: f32,
    vocal_hpf_130hz: StereoBiquad,
    vocal_lpf_4500hz: StereoBiquad,
}

impl StreamDspProcessor {
    pub fn new(shared: Arc<DspSharedState>, sample_rate: u32) -> Self {
        let sr = sample_rate.clamp(8_000, 192_000);
        let mut proc = Self {
            shared,
            applied_epoch: 0,
            sample_rate: sr,
            eq_enabled: false,
            preamp_linear: 1.0,
            eq_bands: [StereoBiquad::default(); 10],
            vocal_mode: VocalDspMode::Off,
            vocal_strength: 0.90,
            vocal_hpf_130hz: StereoBiquad::default(),
            vocal_lpf_4500hz: StereoBiquad::default(),
        };
        proc.recompute_coefficients();
        proc
    }

    pub fn reset_filter_states(&mut self) {
        for b in &mut self.eq_bands {
            b.reset_state();
        }
        self.vocal_hpf_130hz.reset_state();
        self.vocal_lpf_4500hz.reset_state();
    }

    #[inline]
    pub fn sync_if_needed(&mut self, sample_rate: u32) {
        let sr = sample_rate.clamp(8_000, 192_000);
        let cur_epoch = self.shared.epoch();
        if cur_epoch != self.applied_epoch || sr != self.sample_rate {
            self.sample_rate = sr;
            self.recompute_coefficients();
            self.applied_epoch = cur_epoch;
        }
    }

    fn recompute_coefficients(&mut self) {
        let sr = self.sample_rate as f32;
        self.eq_enabled = self.shared.eq_enabled.load(Ordering::Relaxed);
        let preamp_db = f32::from_bits(self.shared.preamp_db_bits.load(Ordering::Relaxed));
        let clean_preamp = if preamp_db.is_finite() {
            preamp_db.clamp(-12.0, 12.0)
        } else {
            0.0
        };
        self.preamp_linear = if self.eq_enabled {
            10.0f32.powf(clean_preamp / 20.0)
        } else {
            1.0
        };

        for (i, b) in self.eq_bands.iter_mut().enumerate() {
            let raw_gain =
                f32::from_bits(self.shared.band_gains_db_bits[i].load(Ordering::Relaxed));
            let gain_db = if self.eq_enabled && raw_gain.is_finite() {
                raw_gain.clamp(-12.0, 12.0)
            } else {
                0.0
            };
            let freq = EQ_BAND_FREQS_HZ[i];
            if i == 0 {
                b.set_low_shelf(freq, sr, gain_db);
            } else if i == 9 {
                b.set_high_shelf(freq, sr, gain_db);
            } else {
                b.set_peaking(freq, sr, std::f32::consts::SQRT_2, gain_db);
            }
        }

        self.vocal_mode = VocalDspMode::from_u8(self.shared.vocal_mode.load(Ordering::Relaxed));
        let raw_strength = f32::from_bits(self.shared.vocal_strength_bits.load(Ordering::Relaxed));
        self.vocal_strength = if raw_strength.is_finite() {
            raw_strength.clamp(0.0, 1.0)
        } else {
            0.90
        };
        self.vocal_hpf_130hz
            .set_highpass(130.0, sr, std::f32::consts::FRAC_1_SQRT_2);
        self.vocal_lpf_4500hz
            .set_lowpass(4500.0, sr, std::f32::consts::FRAC_1_SQRT_2);
    }

    #[inline]
    pub fn is_active(&self) -> bool {
        self.eq_enabled || self.vocal_mode != VocalDspMode::Off
    }

    /// Processes a stereo sample frame `(left, right)` in place with Band-Limited Mid/Side Vocal
    /// Isolation (`130 Hz – 4.5 kHz`) and the 10-band Stereo Biquad Equalizer + Soft-Clip Limiter.
    #[inline]
    pub fn process_stereo(&mut self, left: f32, right: f32, sample_rate: u32) -> (f32, f32) {
        self.sync_if_needed(sample_rate);
        if !self.is_active() {
            return (left, right);
        }

        let mut l = if left.is_finite() { left } else { 0.0 };
        let mut r = if right.is_finite() { right } else { 0.0 };

        // Stage 1: Frequency-Selective Mid/Side Vocal Isolation (130 Hz - 4.5 kHz)
        if self.vocal_mode != VocalDspMode::Off {
            let mid = 0.5 * (l + r);
            let side = 0.5 * (l - r);

            // Isolate center vocal fundamentals + formants (130 Hz .. 4500 Hz)
            let mid_hp = self.vocal_hpf_130hz.process_left(mid);
            let mid_vocal = self.vocal_lpf_4500hz.process_left(mid_hp);
            // Residual Mid (< 130 Hz sub-bass/kick + > 4.5 kHz air/hi-hat transients)
            let mid_non_vocal = mid - mid_vocal;
            let s = self.vocal_strength;

            match self.vocal_mode {
                VocalDspMode::VocalRemover => {
                    // Attenuate center vocals while keeping center sub-bass/kick & stereo stage full
                    let new_mid = mid_non_vocal + mid_vocal * (1.0 - s);
                    let new_side = side * (1.0 + 0.14 * s);
                    l = new_mid + new_side;
                    r = new_mid - new_side;
                }
                VocalDspMode::VocalIsolate => {
                    // Focus on center vocal band while attenuating sub-bass and stereo sides
                    let new_mid = mid_vocal * (1.0 + 0.28 * s) + mid_non_vocal * (1.0 - 0.82 * s);
                    let new_side = side * (1.0 - 0.85 * s);
                    l = new_mid + new_side;
                    r = new_mid - new_side;
                }
                VocalDspMode::Off => {}
            }
        }

        // Stage 2: 10-Band Stereo Biquad Equalizer + Preamp Gain
        if self.eq_enabled {
            l *= self.preamp_linear;
            r *= self.preamp_linear;
            for band in &mut self.eq_bands {
                if band.active {
                    l = band.process_left(l);
                    r = band.process_right(r);
                }
            }
        }

        // Stage 3: Transparent Soft-Clip Mastering Limiter
        (soft_clip_sample(l), soft_clip_sample(r))
    }

    #[inline]
    pub fn process_mono(&mut self, sample: f32, sample_rate: u32) -> f32 {
        self.sync_if_needed(sample_rate);
        if !self.eq_enabled {
            return sample;
        }
        let mut s = (if sample.is_finite() { sample } else { 0.0 }) * self.preamp_linear;
        for band in &mut self.eq_bands {
            if band.active {
                s = band.process_left(s);
            }
        }
        soft_clip_sample(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_eq_bands_csv_roundtrip_and_presets() {
        let preset = lookup_eq_preset("bass_boost").expect("bass_boost preset exists");
        let csv = format_eq_bands_csv(&preset.bands_db);
        let parsed = parse_eq_bands_csv(&csv);
        assert_eq!(parsed, preset.bands_db);
    }

    #[test]
    fn test_biquad_eq_boosts_target_frequency_and_soft_clips() {
        let state = Arc::new(DspSharedState::new());
        let mut snap = DspConfigSnapshot::default();
        snap.eq_enabled = true;
        snap.preamp_db = 0.0;
        snap.bands_db[5] = 9.0; // +9 dB at 1 kHz
        state.apply_snapshot(&snap);

        let mut proc = StreamDspProcessor::new(state, 48_000);
        let mut rms_accum = 0.0f32;
        let n = 4800;
        for i in 0..n {
            let t = (i as f32) / 48_000.0;
            let x = 0.25 * (2.0 * PI * 1000.0 * t).sin();
            let (yl, yr) = proc.process_stereo(x, x, 48_000);
            assert!(yl.abs() <= 1.0 && yr.abs() <= 1.0);
            if i > 480 {
                rms_accum += yl * yl;
            }
        }
        let out_rms = (rms_accum / ((n - 480) as f32)).sqrt();
        let in_rms = 0.25 / std::f32::consts::SQRT_2;
        assert!(
            out_rms > in_rms * 1.8,
            "Expected +9dB 1kHz boost to increase RMS from {in_rms:.3} to > {:.3}, got {out_rms:.3}",
            in_rms * 1.8
        );
    }

    #[test]
    fn test_band_limited_mid_side_vocal_remover_preserves_sub_bass_and_attenuates_center_vocals() {
        let state = Arc::new(DspSharedState::new());
        let mut snap = DspConfigSnapshot::default();
        snap.vocal_mode = "vocal_remover".to_string();
        snap.vocal_strength = 0.95;
        state.apply_snapshot(&snap);

        let sr = 48_000;
        let mut proc = StreamDspProcessor::new(state, sr);
        let mut sub_energy_out = 0.0f32;
        let mut vocal_energy_out = 0.0f32;
        let n = 9600;

        // Pass 1: 55 Hz center-panned sub-bass sine wave (should be preserved!)
        for i in 0..n {
            let t = (i as f32) / (sr as f32);
            let sub = 0.4 * (2.0 * PI * 55.0 * t).sin();
            let (yl, _) = proc.process_stereo(sub, sub, sr);
            if i > 1200 {
                sub_energy_out += yl * yl;
            }
        }

        // Pass 2: 1000 Hz center-panned vocal sine wave (should be strongly attenuated!)
        proc.reset_filter_states();
        for i in 0..n {
            let t = (i as f32) / (sr as f32);
            let vox = 0.4 * (2.0 * PI * 1000.0 * t).sin();
            let (yl, _) = proc.process_stereo(vox, vox, sr);
            if i > 1200 {
                vocal_energy_out += yl * yl;
            }
        }

        let sub_rms = (sub_energy_out / ((n - 1200) as f32)).sqrt();
        let vocal_rms = (vocal_energy_out / ((n - 1200) as f32)).sqrt();
        assert!(
            sub_rms > vocal_rms * 3.5,
            "Sub-bass RMS ({sub_rms:.4}) should be > 3.5x center vocal RMS ({vocal_rms:.4}) in Karaoke Vocal Remover mode"
        );
    }
}
