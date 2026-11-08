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
        codecs::{DecoderOptions, CODEC_TYPE_NULL},
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

pub trait TapSample: rodio::Sample {
    fn to_norm_f32(self) -> f32;
}

impl TapSample for f32 {
    #[inline]
    fn to_norm_f32(self) -> f32 {
        self
    }
}

impl TapSample for i16 {
    #[inline]
    fn to_norm_f32(self) -> f32 {
        (self as f32) / 32768.0
    }
}

impl TapSample for u16 {
    #[inline]
    fn to_norm_f32(self) -> f32 {
        ((self as f32) - 32768.0) / 32768.0
    }
}

/// Zero-allocation `rodio::Source` wrapper that taps mono-mixed PCM samples into an `AudioTapBuffer`.
pub struct AudioTapSource<S> {
    inner: S,
    tap: Arc<AudioTapBuffer>,
    channels: u16,
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
        tap.set_sample_rate(inner.sample_rate());
        Self {
            inner,
            tap,
            channels,
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
        let sample = self.inner.next()?;
        self.ch_accum += sample.to_norm_f32();
        self.ch_counter += 1;
        if self.ch_counter >= self.channels {
            let mono = self.ch_accum / (self.channels as f32);
            self.tap.push_mono_sample(mono);
            self.ch_counter = 0;
            self.ch_accum = 0.0;
        }
        Some(sample)
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
        self.ch_counter = 0;
        self.ch_accum = 0.0;
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

/// Fast-scans a local audio file (`FLAC`, `MP3`, `M4A`, `OGG`, `WAV`) at up to `target_bars`
/// stride positions using Symphonia to extract a real 180-tick Peak-Weighted RMS waveform silhouette.
pub fn compute_local_file_waveform_bars(uri: &str, target_bars: usize) -> Option<Vec<f32>> {
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

    let mut bucket_vals = Vec::with_capacity(target_bars);

    // If total duration is known and >= 8 seconds, seek-stride across `target_bars` positions
    // (decoding 1 packet per position takes ~15–30ms total for an entire album track!).
    if total_secs >= 8.0 {
        let mut seek_succeeded = true;
        for i in 0..target_bars {
            let frac = (i as f64 + 0.5) / (target_bars as f64);
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
                seek_succeeded = false;
                break;
            }
            decoder.reset();

            // Read up to 4 packets until we get a packet for `track_id`
            let mut got_energy = None;
            for _ in 0..4 {
                let Ok(packet) = reader.next_packet() else {
                    break;
                };
                if packet.track_id() != track_id {
                    continue;
                }
                if let Ok(decoded) = decoder.decode(&packet) {
                    let spec = *decoded.spec();
                    let frames = decoded.frames();
                    if frames > 0 {
                        let mut sample_buf = SampleBuffer::<f32>::new(frames as u64, spec);
                        sample_buf.copy_interleaved_ref(decoded);
                        let samples = sample_buf.samples();
                        let mut peak = 0.0f32;
                        let mut sum_sq = 0.0f32;
                        let step = (samples.len() / 256).max(1);
                        let mut count = 0usize;
                        for idx in (0..samples.len()).step_by(step) {
                            let a = samples[idx].abs();
                            if a > peak {
                                peak = a;
                            }
                            sum_sq += a * a;
                            count += 1;
                        }
                        if count > 0 {
                            let rms = (sum_sq / (count as f32)).sqrt();
                            got_energy = Some(0.65 * peak + 0.35 * rms);
                            break;
                        }
                    }
                }
            }
            bucket_vals.push(got_energy.unwrap_or(0.08));
        }

        if seek_succeeded && bucket_vals.len() == target_bars {
            return Some(downsample_peak_weighted_rms_f32(&bucket_vals, target_bars));
        }
        bucket_vals.clear();
    }

    // Fallback for short files or unseekable streams: linear packet scan (capped at 600 packets)
    for _ in 0..600 {
        let Ok(packet) = reader.next_packet() else {
            break;
        };
        if packet.track_id() != track_id {
            continue;
        }
        if let Ok(decoded) = decoder.decode(&packet) {
            let spec = *decoded.spec();
            let frames = decoded.frames();
            if frames > 0 {
                let mut sample_buf = SampleBuffer::<f32>::new(frames as u64, spec);
                sample_buf.copy_interleaved_ref(decoded);
                let samples = sample_buf.samples();
                let mut peak = 0.0f32;
                let mut sum_sq = 0.0f32;
                let step = (samples.len() / 128).max(1);
                let mut count = 0usize;
                for idx in (0..samples.len()).step_by(step) {
                    let a = samples[idx].abs();
                    if a > peak {
                        peak = a;
                    }
                    sum_sq += a * a;
                    count += 1;
                }
                if count > 0 {
                    let rms = (sum_sq / (count as f32)).sqrt();
                    bucket_vals.push(0.65 * peak + 0.35 * rms);
                }
            }
        }
    }

    if bucket_vals.is_empty() {
        None
    } else {
        Some(downsample_peak_weighted_rms_f32(&bucket_vals, target_bars))
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
}
