use crate::sinks::local::resolve_local_file_path;
use rodio::{source::SeekError, Source};
use simp_protocol::SimpSettings;
use std::collections::HashMap;
use std::fs::File;
use std::sync::{
    atomic::{AtomicU32, AtomicUsize, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::Duration;
use symphonia::{
    core::{
        audio::SampleBuffer,
        codecs::{
            CodecType, DecoderOptions, CODEC_TYPE_MP1, CODEC_TYPE_MP2, CODEC_TYPE_MP3,
            CODEC_TYPE_NULL,
        },
        formats::{FormatOptions, SeekMode, SeekTo},
        io::MediaSourceStream,
        meta::MetadataOptions,
        probe::Hint,
        units::Time,
    },
    default::{get_codecs, get_probe},
};

pub const DEFAULT_WAVEFORM_BARS: usize = 180;
const TAP_RING_LEN: usize = 512;

/// 16 logarithmically spaced center frequencies (Hz) from Sub-Bass (45 Hz) to Brilliance (14 kHz).
const BAND_CENTER_HZ: [f32; 16] = [
    45.0, 70.0, 105.0, 160.0, 240.0, 350.0, 520.0, 770.0, 1150.0, 1700.0, 2500.0, 3600.0, 5200.0,
    7500.0, 10500.0, 14000.0,
];

/// Lock-free 512-sample mono PCM ring buffer shared between the `rodio` audio callback thread
/// and the `LocalAudioEngine` / `AppleNativeEngine` monitor task.
pub struct AudioTapBuffer {
    samples: [AtomicU32; TAP_RING_LEN],
    write_idx: AtomicUsize,
    sample_rate: AtomicU32,
    prev_bands: Mutex<[f32; 16]>,
}

impl Default for AudioTapBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioTapBuffer {
    pub fn new() -> Self {
        Self {
            samples: std::array::from_fn(|_| AtomicU32::new(0.0f32.to_bits())),
            write_idx: AtomicUsize::new(0),
            sample_rate: AtomicU32::new(44_100),
            prev_bands: Mutex::new([0.0; 16]),
        }
    }

    pub fn clear(&self) {
        for slot in &self.samples {
            slot.store(0.0f32.to_bits(), Ordering::Relaxed);
        }
        self.write_idx.store(0, Ordering::Relaxed);
        if let Ok(mut prev) = self.prev_bands.lock() {
            *prev = [0.0; 16];
        }
    }

    #[inline]
    pub fn push_mono_sample(&self, sample: f32) {
        let idx = self.write_idx.fetch_add(1, Ordering::Relaxed) & (TAP_RING_LEN - 1);
        self.samples[idx].store(sample.to_bits(), Ordering::Relaxed);
    }

    #[inline]
    pub fn set_sample_rate(&self, sr: u32) {
        if sr > 0 {
            self.sample_rate.store(sr, Ordering::Relaxed);
        }
    }

    /// Computes `(rms, peak, onset, bands_16)` over the most recent 512 mono samples using
    /// a Hann-windowed Goertzel resonator bank with pink-noise tilt compensation (`+3 dB/octave`).
    pub fn compute_spectrum_tick(&self) -> (f32, f32, f32, [u8; 16]) {
        let sr = (self.sample_rate.load(Ordering::Relaxed) as f32).clamp(8_000.0, 192_000.0);
        let head = self.write_idx.load(Ordering::Relaxed);

        let mut window = [0.0f32; TAP_RING_LEN];
        let mut sum_sq = 0.0f32;
        let mut peak = 0.0f32;

        for (i, slot) in window.iter_mut().enumerate() {
            let ring_pos = head.wrapping_sub(TAP_RING_LEN - i) & (TAP_RING_LEN - 1);
            let raw = f32::from_bits(self.samples[ring_pos].load(Ordering::Relaxed));
            let s = if raw.is_finite() {
                raw.clamp(-1.5, 1.5)
            } else {
                0.0
            };
            let abs_s = s.abs();
            if abs_s > peak {
                peak = abs_s;
            }
            sum_sq += s * s;

            // Hann window: 0.5 * (1 - cos(2*pi*i / (N-1)))
            let phase = (2.0 * std::f32::consts::PI * (i as f32)) / ((TAP_RING_LEN - 1) as f32);
            let hann = 0.5 * (1.0 - phase.cos());
            *slot = s * hann;
        }

        let rms = ((sum_sq / (TAP_RING_LEN as f32)).sqrt() * 2.2).clamp(0.0, 1.0);
        let norm_peak = (peak * 1.35).clamp(0.0, 1.0);

        let mut raw_bands = [0.0f32; 16];
        for (b_idx, &freq_hz) in BAND_CENTER_HZ.iter().enumerate() {
            if freq_hz >= sr * 0.48 {
                continue;
            }
            // Use shorter effective window for high frequencies so transients stay snappy
            let n_samples = if freq_hz >= 2500.0 {
                128
            } else if freq_hz >= 500.0 {
                256
            } else {
                TAP_RING_LEN
            };
            let start_offset = TAP_RING_LEN - n_samples;
            let omega = (2.0 * std::f32::consts::PI * freq_hz) / sr;
            let coeff = 2.0 * omega.cos();
            let mut q1 = 0.0f32;
            let mut q2 = 0.0f32;
            for &x in &window[start_offset..] {
                let q0 = coeff * q1 - q2 + x;
                q2 = q1;
                q1 = q0;
            }
            let mag_sq = (q1 * q1 + q2 * q2 - q1 * q2 * coeff).max(0.0);
            let mag = mag_sq.sqrt() / (n_samples as f32 * 0.22);
            // Pink-noise perceptual tilt (+3dB/octave compensation)
            let tilt = 1.0 + (b_idx as f32) * 0.24;
            let compressed = (mag * tilt).powf(0.62).clamp(0.0, 1.0);
            raw_bands[b_idx] = compressed;
        }

        let mut onset_flux = 0.0f32;
        let mut out_bands = [0u8; 16];
        if let Ok(mut prev) = self.prev_bands.lock() {
            for i in 0..16 {
                let prev_val = prev[i];
                let cur_val = raw_bands[i];
                let diff = (cur_val - prev_val).max(0.0);
                // Weight low-frequency and low-mid kick/snare bands higher for beat onset detection
                let weight = if i < 5 { 1.45 } else { 0.75 };
                onset_flux += diff * weight;
                // Smooth attack/release in the band state
                let smoothed = if cur_val > prev_val {
                    prev_val * 0.25 + cur_val * 0.75
                } else {
                    prev_val * 0.62 + cur_val * 0.38
                };
                prev[i] = smoothed;
                out_bands[i] = (smoothed.clamp(0.0, 1.0) * 255.0).round() as u8;
            }
        } else {
            for i in 0..16 {
                out_bands[i] = (raw_bands[i].clamp(0.0, 1.0) * 255.0).round() as u8;
            }
        }

        let onset = (onset_flux * 0.55).clamp(0.0, 1.0);
        (rms, norm_peak, onset, out_bands)
    }
}

pub trait TapSample: rodio::Sample + Copy {
    fn to_norm_f32(self) -> f32;
    fn from_norm_f32(val: f32) -> Self;
}

impl TapSample for f32 {
    #[inline]
    fn to_norm_f32(self) -> f32 {
        self
    }

    #[inline]
    fn from_norm_f32(val: f32) -> Self {
        val
    }
}

impl TapSample for i16 {
    #[inline]
    fn to_norm_f32(self) -> f32 {
        (self as f32) / 32768.0
    }

    #[inline]
    fn from_norm_f32(val: f32) -> Self {
        (val.clamp(-1.0, 0.9999695) * 32768.0).round() as i16
    }
}

impl TapSample for u16 {
    #[inline]
    fn to_norm_f32(self) -> f32 {
        ((self as f32) - 32768.0) / 32768.0
    }

    #[inline]
    fn from_norm_f32(val: f32) -> Self {
        ((val.clamp(-1.0, 0.9999695) * 32768.0) + 32768.0).round() as u16
    }
}

/// Zero-allocation `rodio::Source` wrapper that applies SIMP's real-time 10-band Stereo Biquad EQ
/// + Band-Limited Mid/Side Vocal Isolation (`StreamDspProcessor`) and taps post-DSP mono-mixed PCM
/// samples into `AudioTapBuffer`.
pub struct AudioTapSource<S>
where
    S: Source,
    S::Item: TapSample,
{
    inner: S,
    tap: Arc<AudioTapBuffer>,
    dsp: crate::dsp::StreamDspProcessor,
    channels: u16,
    sample_rate: u32,
    pending_right: Option<S::Item>,
    ch_counter: u16,
    ch_accum: f32,
}

impl<S> AudioTapSource<S>
where
    S: Source,
    S::Item: TapSample,
{
    pub fn new(inner: S, tap: Arc<AudioTapBuffer>) -> Self {
        let channels = inner.channels().max(1);
        let sample_rate = inner.sample_rate().max(8_000);
        tap.set_sample_rate(sample_rate);
        let dsp = crate::dsp::StreamDspProcessor::new(crate::dsp::global_dsp_state(), sample_rate);
        Self {
            inner,
            tap,
            dsp,
            channels,
            sample_rate,
            pending_right: None,
            ch_counter: 0,
            ch_accum: 0.0,
        }
    }
}

impl<S> Iterator for AudioTapSource<S>
where
    S: Source,
    S::Item: TapSample,
{
    type Item = S::Item;

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        if self.channels == 2 {
            if let Some(right_item) = self.pending_right.take() {
                return Some(right_item);
            }
            let left_raw = self.inner.next()?;
            let right_raw = match self.inner.next() {
                Some(r) => r,
                None => {
                    let s = self.dsp.process_mono(left_raw.to_norm_f32(), self.sample_rate);
                    self.tap.push_mono_sample(s);
                    return Some(S::Item::from_norm_f32(s));
                }
            };
            let (l_out, r_out) = self.dsp.process_stereo(
                left_raw.to_norm_f32(),
                right_raw.to_norm_f32(),
                self.sample_rate,
            );
            let mono = 0.5 * (l_out + r_out);
            self.tap.push_mono_sample(mono);
            self.pending_right = Some(S::Item::from_norm_f32(r_out));
            return Some(S::Item::from_norm_f32(l_out));
        }

        let sample = self.inner.next()?;
        let norm = sample.to_norm_f32();
        let processed = if self.channels == 1 {
            self.dsp.process_mono(norm, self.sample_rate)
        } else {
            norm
        };
        self.ch_accum += processed;
        self.ch_counter += 1;
        if self.ch_counter >= self.channels {
            let mono = self.ch_accum / (self.channels as f32);
            self.tap.push_mono_sample(mono);
            self.ch_counter = 0;
            self.ch_accum = 0.0;
        }
        Some(S::Item::from_norm_f32(processed))
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl<S> Source for AudioTapSource<S>
where
    S: Source,
    S::Item: TapSample,
{
    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    #[inline]
    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    #[inline]
    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    #[inline]
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.pending_right = None;
        self.ch_counter = 0;
        self.ch_accum = 0.0;
        self.dsp.reset_filter_states();
        self.inner.try_seek(pos)
    }
}

/// Downsamples an arbitrary slice of amplitude values into `target_bars` (`180`) using
/// Peak-Weighted RMS (`0.65 * max_peak + 0.35 * rms`) so drum transients and beat drops stay crisp.
pub fn downsample_peak_weighted_rms_f32(vals: &[f32], target_bars: usize) -> Vec<f32> {
    if vals.is_empty() || target_bars == 0 {
        return Vec::new();
    }

    let mut raw_bars = Vec::with_capacity(target_bars);
    let mut max_bar = 0.0001f32;

    for i in 0..target_bars {
        let start = (i * vals.len()) / target_bars;
        let end = (((i + 1) * vals.len()) / target_bars)
            .max(start + 1)
            .min(vals.len());
        let slice = &vals[start..end];
        let mut peak = 0.0f32;
        let mut sum_sq = 0.0f32;
        for &v in slice {
            let a = v.abs();
            if a > peak {
                peak = a;
            }
            sum_sq += a * a;
        }
        let rms = (sum_sq / (slice.len() as f32)).sqrt();
        let hybrid = 0.65 * peak + 0.35 * rms;
        if hybrid > max_bar {
            max_bar = hybrid;
        }
        raw_bars.push(hybrid);
    }

    // Use 96th-percentile normalization so a single loud pop doesn't flatten the rest of the waveform
    let mut sorted = raw_bars.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let p96_idx = ((sorted.len() as f32) * 0.96) as usize;
    let norm_denom = sorted
        .get(p96_idx.min(sorted.len().saturating_sub(1)))
        .copied()
        .unwrap_or(max_bar)
        .max(max_bar * 0.72)
        .max(0.0001);

    raw_bars
        .into_iter()
        .map(|v| (v / norm_denom).powf(0.85).clamp(0.10, 1.0))
        .collect()
}

/// Deterministic 180-bar musical waveform silhouette seeded by a track's URI (used for progressive
/// streams or unseekable tracks where full-file local Symphonia seek-striding isn't applicable).
pub fn synthesize_seeded_waveform_bars(seed_uri: &str, target_bars: usize) -> Vec<f32> {
    let count = target_bars.max(16);
    let hash = blake3::hash(seed_uri.as_bytes());
    let hb = hash.as_bytes();
    (0..count)
        .map(|i| {
            let t = i as f32 / (count as f32);
            let b1 = hb[i % 32] as f32 / 255.0;
            let b2 = hb[(i * 7 + 5) % 32] as f32 / 255.0;
            let b3 = hb[(i * 13 + 11) % 32] as f32 / 255.0;
            // Macro song structure: intro ramp, mid-song breakdown dip, main drop plateaus, outro fade
            let intro_outro = (t * std::f32::consts::PI).sin().powf(0.32);
            let phrase_wave = 0.78 + 0.22 * ((t * 6.0 * std::f32::consts::PI + b1 * 3.0).sin());
            let transient = 0.20 + 0.80 * (0.50 * b1 + 0.30 * b2 + 0.20 * b3);
            (transient * phrase_wave * intro_outro).clamp(0.12, 1.0)
        })
        .collect()
}

fn local_waveform_cache() -> &'static Mutex<HashMap<String, Vec<f32>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Vec<f32>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

const PACKET_NOISE_FLOOR_PEAK: f32 = 1e-5;

#[inline]
fn measure_slice_rms_and_peak(slice: &[f32]) -> (f32, f32) {
    if slice.is_empty() {
        return (0.0, 0.0);
    }
    let step = (slice.len() / 512).max(1);
    let mut peak = 0.0f32;
    let mut sum_sq = 0.0f32;
    let mut count = 0usize;
    for &sample in slice.iter().step_by(step) {
        let a = sample.abs();
        if a.is_finite() {
            if a > peak {
                peak = a;
            }
            sum_sq += a * a;
            count += 1;
        }
    }
    if count == 0 {
        (0.0, 0.0)
    } else {
        ((sum_sq / (count as f32)).sqrt(), peak)
    }
}

/// Extracts `(rms, peak)` from an interleaved decoded PCM packet.
///
/// Symphonia's MP3 Layer III decoder empties its `BitResevoir` on `decoder.reset()` after a seek.
/// On the first packet(s) following a seek, underflowed granules are explicitly zeroed via
/// `requantize::zero` while the reservoir refills. Returning `None` for all-zero packets and
/// skipping a zeroed first granule when the second granule decoded audio prevents ~90% of seek
/// buckets on MP3s from collapsing into flat baseline dots.
fn extract_packet_rms_and_peak(samples: &[f32]) -> Option<(f32, f32)> {
    if samples.is_empty() {
        return None;
    }
    if samples.len() >= 64 {
        let half = samples.len() / 2;
        let (rms0, peak0) = measure_slice_rms_and_peak(&samples[..half]);
        let (rms1, peak1) = measure_slice_rms_and_peak(&samples[half..]);
        if peak0 <= PACKET_NOISE_FLOOR_PEAK && peak1 <= PACKET_NOISE_FLOOR_PEAK {
            return None;
        }
        if peak0 <= PACKET_NOISE_FLOOR_PEAK && peak1 > PACKET_NOISE_FLOOR_PEAK {
            return Some((rms1, peak1));
        }
        let rms = ((rms0 * rms0 + rms1 * rms1) * 0.5).sqrt();
        return Some((rms, peak0.max(peak1)));
    }
    let (rms, peak) = measure_slice_rms_and_peak(samples);
    if peak <= PACKET_NOISE_FLOOR_PEAK {
        None
    } else {
        Some((rms, peak))
    }
}

/// Normalizes local raw per-bucket energy values into display bars (`0.10..=1.00`) while
/// preserving quiet-to-loud dynamic contrast on both dynamic and loudness-maximized releases.
fn normalize_local_waveform_bars(raw_bars: &[f32]) -> Vec<f32> {
    if raw_bars.is_empty() {
        return Vec::new();
    }
    let max_bar = raw_bars
        .iter()
        .copied()
        .filter(|v| v.is_finite())
        .fold(0.0f32, f32::max);
    if max_bar <= 1e-4 {
        return vec![0.10; raw_bars.len()];
    }

    let mut sorted: Vec<f32> = raw_bars
        .iter()
        .copied()
        .map(|v| if v.is_finite() { v.max(0.0) } else { 0.0 })
        .collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let p95_idx = ((sorted.len() as f32) * 0.95) as usize;
    let norm_denom = sorted
        .get(p95_idx.min(sorted.len().saturating_sub(1)))
        .copied()
        .unwrap_or(max_bar)
        .max(max_bar * 0.72)
        .max(1e-4);

    raw_bars
        .iter()
        .map(|&v| {
            let norm = if v.is_finite() {
                (v.max(0.0) / norm_denom).clamp(0.0, 1.0)
            } else {
                0.0
            };
            (0.10 + 0.90 * norm.powf(1.22)).clamp(0.10, 1.0)
        })
        .collect()
}

#[inline]
fn is_mpeg_audio_codec(codec: CodecType) -> bool {
    codec == CODEC_TYPE_MP3 || codec == CODEC_TYPE_MP2 || codec == CODEC_TYPE_MP1
}

#[derive(Clone, Copy, Debug)]
struct PacketEnergySample {
    frames: usize,
    rms: f32,
    peak: f32,
}

fn bucket_packet_energies(samples: &[PacketEnergySample], target_bars: usize) -> Vec<f32> {
    if samples.is_empty() || target_bars == 0 {
        return Vec::new();
    }

    let total_frames: u64 = samples.iter().map(|s| s.frames as u64).sum();
    if total_frames == 0 {
        return vec![0.10; target_bars];
    }

    let mut raw_bars = Vec::with_capacity(target_bars);
    let mut pkt_idx = 0usize;
    let mut pkt_start = 0u64;

    for i in 0..target_bars {
        let bucket_start = ((i as u64) * total_frames) / (target_bars as u64);
        let bucket_end = ((((i + 1) as u64) * total_frames) / (target_bars as u64))
            .max(bucket_start + 1)
            .min(total_frames);

        while pkt_idx + 1 < samples.len()
            && pkt_start + (samples[pkt_idx].frames as u64) <= bucket_start
        {
            pkt_start += samples[pkt_idx].frames as u64;
            pkt_idx += 1;
        }

        let mut scan_idx = pkt_idx;
        let mut scan_start = pkt_start;
        let mut sum_rms_sq_w = 0.0f64;
        let mut sum_peak_w = 0.0f64;
        let mut sum_w = 0.0f64;

        while scan_idx < samples.len() && scan_start < bucket_end {
            let s = samples[scan_idx];
            let scan_end = scan_start + (s.frames as u64);
            let overlap_start = bucket_start.max(scan_start);
            let overlap_end = bucket_end.min(scan_end);
            if overlap_end > overlap_start {
                let w = (overlap_end - overlap_start) as f64;
                let rms = f64::from(s.rms);
                sum_rms_sq_w += rms * rms * w;
                sum_peak_w += f64::from(s.peak) * w;
                sum_w += w;
            }
            if scan_end >= bucket_end {
                break;
            }
            scan_start = scan_end;
            scan_idx += 1;
        }

        if sum_w > 0.0 {
            let combined_rms = ((sum_rms_sq_w / sum_w).sqrt()) as f32;
            let mean_peak = (sum_peak_w / sum_w) as f32;
            raw_bars.push(0.72 * combined_rms + 0.28 * mean_peak);
        } else {
            raw_bars.push(0.0);
        }
    }

    normalize_local_waveform_bars(&raw_bars)
}

/// Fast-scans a local audio file (`FLAC`, `MP3`, `M4A`, `OGG`, `WAV`) using Symphonia to extract
/// a 180-tick Peak-Weighted RMS waveform silhouette.
///
/// Standard-length MP3s (`<= 12 min`) are scanned sequentially so VBR frame timestamps stay
/// sample-accurate and Symphonia's `BitResevoir` never underflows on seeks; lossless/seek-tabled
/// containers (`FLAC`, `M4A`, `OGG`, `WAV`) and long mixes use seek-striding across `target_bars`.
pub fn compute_local_file_waveform_bars(uri: &str, target_bars: usize) -> Option<Vec<f32>> {
    if target_bars == 0 {
        return None;
    }
    let path = resolve_local_file_path(uri);
    if !path.is_file() {
        return None;
    }

    let file = File::open(&path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions {
                enable_gapless: true,
                ..Default::default()
            },
            &MetadataOptions::default(),
        )
        .ok()?;
    let mut reader = probed.format;

    let track = reader
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)?;
    let track_id = track.id;
    let is_mpeg = is_mpeg_audio_codec(track.codec_params.codec);
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44_100);
    let total_frames = track.codec_params.n_frames.unwrap_or(0);
    let total_secs = if total_frames > 0 && sample_rate > 0 {
        (total_frames as f64) / (sample_rate as f64)
    } else {
        0.0
    };

    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .ok()?;

    // Use seek-stride for container formats with exact seek tables (>= 8s), or very long MP3 mixes (> 12 min).
    if total_secs >= 8.0 && (!is_mpeg || total_secs > 720.0) {
        let mut bucket_vals = Vec::with_capacity(target_bars);
        let mut seek_succeeded = true;
        let max_track_pkts = if is_mpeg { 16 } else { 6 };
        let silence_abort_pkts = if is_mpeg { 12 } else { 2 };

        for i in 0..target_bars {
            let frac = ((i as f64 + 0.5) / (target_bars as f64)).min(0.995);
            let target_sec = frac * total_secs;
            let whole_secs = target_sec.floor() as u64;
            let frac_secs = target_sec - (whole_secs as f64);
            if reader
                .seek(
                    SeekMode::Coarse,
                    SeekTo::Time {
                        time: Time::new(whole_secs, frac_secs),
                        track_id: Some(track_id),
                    },
                )
                .is_err()
            {
                if i >= (target_bars * 4) / 5 {
                    bucket_vals.resize(target_bars, 0.0);
                    break;
                }
                seek_succeeded = false;
                break;
            }
            decoder.reset();

            let mut sum_rms_sq = 0.0f32;
            let mut sum_peak = 0.0f32;
            let mut saw_mpeg_transition = false;
            let mut valid_packets = 0usize;
            let mut valid_frames = 0usize;
            let mut track_packets = 0usize;
            let mut total_reads = 0usize;

            while track_packets < max_track_pkts && total_reads < 48 {
                total_reads += 1;
                let Ok(packet) = reader.next_packet() else {
                    break;
                };
                if packet.track_id() != track_id {
                    continue;
                }
                track_packets += 1;
                if let Ok(decoded) = decoder.decode(&packet) {
                    let spec = *decoded.spec();
                    let frames = decoded.frames();
                    if frames > 0 {
                        let mut sample_buf = SampleBuffer::<f32>::new(frames as u64, spec);
                        sample_buf.copy_interleaved_ref(decoded);
                        if let Some((rms, peak)) = extract_packet_rms_and_peak(sample_buf.samples())
                        {
                            if is_mpeg && !saw_mpeg_transition {
                                // Skip the first partial IMDCT overlap transition frame after MP3 reservoir refill.
                                saw_mpeg_transition = true;
                                continue;
                            }
                            sum_rms_sq += rms * rms;
                            sum_peak += peak;
                            valid_packets += 1;
                            valid_frames += frames;
                            if valid_packets >= 4 || (valid_packets >= 2 && valid_frames >= 4096) {
                                break;
                            }
                        } else if valid_packets == 0 && track_packets >= silence_abort_pkts {
                            break;
                        }
                    }
                }
            }

            let bucket_energy = if valid_packets > 0 {
                let combined_rms = (sum_rms_sq / (valid_packets as f32)).sqrt();
                let mean_peak = sum_peak / (valid_packets as f32);
                0.72 * combined_rms + 0.28 * mean_peak
            } else {
                0.0
            };
            bucket_vals.push(bucket_energy);
        }

        if seek_succeeded && bucket_vals.len() == target_bars {
            return Some(normalize_local_waveform_bars(&bucket_vals));
        }
        let _ = reader.seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time: Time::new(0, 0.0),
                track_id: Some(track_id),
            },
        );
        decoder.reset();
    }

    // Sequential frame-accurate scan (standard-length MP3s <= 12 min, short files < 8s, or unseekable streams).
    let mut seq_samples: Vec<PacketEnergySample> = Vec::with_capacity(
        (total_frames / 1024).min(32_000) as usize,
    );
    let mut warmed_up = !is_mpeg;
    let mut warmup_skipped = 0usize;
    let mut track_packets = 0usize;
    let mut total_reads = 0usize;

    while track_packets < 32_000 && total_reads < 64_000 {
        total_reads += 1;
        let Ok(packet) = reader.next_packet() else {
            break;
        };
        if packet.track_id() != track_id {
            continue;
        }
        track_packets += 1;
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                let frames = decoded.frames();
                if frames > 0 {
                    let mut sample_buf = SampleBuffer::<f32>::new(frames as u64, spec);
                    sample_buf.copy_interleaved_ref(decoded);
                    if let Some((rms, peak)) = extract_packet_rms_and_peak(sample_buf.samples()) {
                        warmed_up = true;
                        seq_samples.push(PacketEnergySample { frames, rms, peak });
                    } else if !warmed_up && warmup_skipped < 6 {
                        warmup_skipped += 1;
                    } else {
                        seq_samples.push(PacketEnergySample {
                            frames,
                            rms: 0.0,
                            peak: 0.0,
                        });
                    }
                }
            }
            Err(_) if is_mpeg => {
                // Reservoir was cleared by Symphonia on decode error; allow brief warmup without zero gaps.
                warmed_up = false;
                warmup_skipped = 0;
            }
            Err(_) => {}
        }
    }

    if seq_samples.is_empty() {
        None
    } else {
        Some(bucket_packet_energies(&seq_samples, target_bars))
    }
}

/// Resolves a 180-tick waveform envelope for any audio URI (`soundcloud:`, `file://`, `ia:audio:`, `cdda://`, `applemusic:`).
pub fn resolve_waveform_envelope_180(settings: &SimpSettings, uri: &str) -> Vec<f32> {
    let trimmed = uri.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    if let Ok(guard) = local_waveform_cache().lock() {
        if let Some(cached) = guard.get(trimmed) {
            return cached.clone();
        }
    }

    let bars = if trimmed.starts_with("soundcloud:") {
        crate::sinks::soundcloud_api::fetch_track_waveform(settings, trimmed)
            .map(|wf| wf.bars)
            .unwrap_or_else(|_| synthesize_seeded_waveform_bars(trimmed, DEFAULT_WAVEFORM_BARS))
    } else if !trimmed.starts_with("applemusic:")
        && !trimmed.starts_with("ia:audio:")
        && !trimmed.starts_with("ia://audio/")
        && !trimmed.starts_with("cdda://")
        && !trimmed.starts_with("dvd://")
        && !trimmed.starts_with("ia:video:")
    {
        compute_local_file_waveform_bars(trimmed, DEFAULT_WAVEFORM_BARS)
            .unwrap_or_else(|| synthesize_seeded_waveform_bars(trimmed, DEFAULT_WAVEFORM_BARS))
    } else {
        synthesize_seeded_waveform_bars(trimmed, DEFAULT_WAVEFORM_BARS)
    };

    if let Ok(mut guard) = local_waveform_cache().lock() {
        if guard.len() > 256 {
            guard.clear();
        }
        guard.insert(trimmed.to_string(), bars.clone());
    }

    bars
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_16_band_spectrum_and_onset_detection() {
        let tap = AudioTapBuffer::new();
        tap.set_sample_rate(44_100);

        // 1. Silence produces near-zero RMS and bands
        let (rms0, peak0, _onset0, bands0) = tap.compute_spectrum_tick();
        assert_eq!(rms0, 0.0);
        assert_eq!(peak0, 0.0);
        assert!(bands0.iter().all(|&b| b == 0));

        // 2. Inject a 100 Hz bass sine wave + 2500 Hz upper-mid harmonic burst
        for i in 0..TAP_RING_LEN {
            let t = (i as f32) / 44_100.0;
            let s = 0.65 * (2.0 * std::f32::consts::PI * 100.0 * t).sin()
                + 0.35 * (2.0 * std::f32::consts::PI * 2500.0 * t).sin();
            tap.push_mono_sample(s);
        }

        let (rms1, peak1, onset1, bands1) = tap.compute_spectrum_tick();
        assert!(rms1 > 0.3, "expected positive RMS for sine signal, got {rms1}");
        assert!(peak1 > 0.5, "expected positive peak for sine signal, got {peak1}");
        assert!(onset1 > 0.05, "expected positive beat onset on sudden signal, got {onset1}");
        // Band 2 (105 Hz) and Band 10 (2500 Hz) should be strongly energized
        assert!(bands1[2] > 60, "expected 105Hz band > 60, got {}", bands1[2]);
        assert!(bands1[10] > 60, "expected 2500Hz band > 60, got {}", bands1[10]);
    }

    #[test]
    fn test_180_bar_peak_weighted_rms_downsampling() {
        // Simulate 1,800 SoundCloud waveform samples with quiet intro and sharp beat drops
        let samples: Vec<f32> = (0..1800)
            .map(|i| {
                if i < 200 {
                    15.0
                } else if i % 40 < 4 {
                    100.0 // sharp transient kick peak
                } else {
                    42.0
                }
            })
            .collect();

        let bars = downsample_peak_weighted_rms_f32(&samples, DEFAULT_WAVEFORM_BARS);
        assert_eq!(bars.len(), DEFAULT_WAVEFORM_BARS);
        assert!(bars[0] < bars[30], "intro bar should be lower than beat-drop bar");
        assert!(bars.iter().all(|&b| (0.10..=1.0).contains(&b)));
    }

    #[test]
    fn test_extract_packet_rms_and_peak_skips_mp3_reservoir_underflow() {
        // 1. All-zero reservoir warmup packet returns None so seek loops continue to next frame.
        let zero_pkt = vec![0.0f32; 2304];
        assert!(extract_packet_rms_and_peak(&zero_pkt).is_none());

        // 2. Granule 0 zeroed by partial reservoir underflow, Granule 1 decoded at 0.5 amplitude:
        // must measure Granule 1 directly without halving energy with Granule 0's zeros.
        let mut partial_pkt = vec![0.0f32; 2304];
        for s in &mut partial_pkt[1152..] {
            *s = 0.5;
        }
        let (rms_partial, peak_partial) =
            extract_packet_rms_and_peak(&partial_pkt).expect("expected valid granule 1 energy");
        assert!((rms_partial - 0.5).abs() < 0.01, "got {rms_partial}");
        assert!((peak_partial - 0.5).abs() < 0.01, "got {peak_partial}");

        // 3. Full active stereo packet combines both halves cleanly.
        let full_pkt = vec![0.4f32; 2304];
        let (rms_full, peak_full) =
            extract_packet_rms_and_peak(&full_pkt).expect("expected valid full packet");
        assert!((rms_full - 0.4).abs() < 0.01, "got {rms_full}");
        assert!((peak_full - 0.4).abs() < 0.01, "got {peak_full}");
    }

    #[test]
    fn test_normalize_local_waveform_bars_preserves_contrast_and_silence() {
        let silent = normalize_local_waveform_bars(&vec![0.0; 180]);
        assert!(silent.iter().all(|&b| (b - 0.10).abs() < 1e-5));

        let mut raw = Vec::with_capacity(180);
        for i in 0..180 {
            if i < 20 {
                raw.push(0.0); // digital silence intro
            } else if i < 90 {
                raw.push(0.28); // verse
            } else if i < 160 {
                raw.push(0.56); // loud drop
            } else {
                raw.push(0.14); // quiet outro
            }
        }
        let bars = normalize_local_waveform_bars(&raw);
        assert_eq!(bars.len(), 180);
        assert!((bars[5] - 0.10).abs() < 1e-5, "silent bar should stay at baseline 0.10");
        assert!(
            bars[50] > bars[170] && bars[50] < bars[120],
            "expected outro ({}) < verse ({}) < drop ({})",
            bars[170],
            bars[50],
            bars[120]
        );
        assert!(bars[120] > 0.90, "expected chorus bar > 0.90, got {}", bars[120]);
    }

    #[test]
    fn test_compute_local_file_waveform_bars_seek_stride_wav() {
        use std::io::Write;
        use std::time::{SystemTime, UNIX_EPOCH};

        let sample_rate: u32 = 8_000;
        let total_secs: u32 = 10; // >= 8s exercises the 180-position seek-stride pipeline
        let total_samples = (sample_rate * total_secs) as usize;
        let data_bytes = (total_samples * 2) as u32;
        let mut wav = Vec::with_capacity(44 + data_bytes as usize);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data_bytes).to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
        wav.extend_from_slice(&1u16.to_le_bytes()); // mono
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_bytes.to_le_bytes());

        for idx in 0..total_samples {
            let sec = idx as f32 / (sample_rate as f32);
            let amp = if sec < 2.0 {
                0.0 // silent intro (bars 0..36)
            } else if sec < 6.0 {
                0.42 // moderate verse (bars 36..108)
            } else if sec < 9.0 {
                0.90 // loud drop (bars 108..162)
            } else {
                0.0 // silent outro (bars 162..180)
            };
            let s = ((2.0 * std::f32::consts::PI * 220.0 * sec).sin() * amp * 32767.0) as i16;
            wav.extend_from_slice(&s.to_le_bytes());
        }

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let tmp_path = std::env::temp_dir().join(format!(
            "simp_test_waveform_{}_{}.wav",
            std::process::id(),
            stamp
        ));
        {
            let mut f = File::create(&tmp_path).expect("create temp wav");
            f.write_all(&wav).expect("write temp wav");
        }

        let uri = format!("file://{}", tmp_path.to_string_lossy());
        let bars = compute_local_file_waveform_bars(&uri, DEFAULT_WAVEFORM_BARS);
        let _ = std::fs::remove_file(&tmp_path);

        let bars = bars.expect("expected 180 computed bars");
        assert_eq!(bars.len(), DEFAULT_WAVEFORM_BARS);
        assert!(bars[10] <= 0.12, "silent intro bar[10] should be ~0.10, got {}", bars[10]);
        assert!(
            bars[70] > 0.30 && bars[70] < bars[135],
            "expected verse bar[70] ({}) lower than chorus drop bar[135] ({})",
            bars[70],
            bars[135]
        );
        assert!(bars[135] > 0.85, "drop bar[135] should be > 0.85, got {}", bars[135]);
        assert!(bars[172] <= 0.12, "silent outro bar[172] should be ~0.10, got {}", bars[172]);
    }
}
