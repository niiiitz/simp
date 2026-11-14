use crate::sinks::apple_native::{
    cdm_host::{
        decrypt_segments_for_epoch, discover_widevine_cdm_library,
        negotiate_soundcloud_license_for_epoch,
    },
    hls::{
        extract_variant_from_master_m3u8, fetch_hls_bytes, parse_apple_media_m3u8,
        AppleHlsMediaPlaylist,
    },
    mp4_cbcs::{
        find_widevine_pssh_in_mp4, parse_init_segment_tenc, rewrite_init_segment_enca_to_clear,
        TrackEncryptionInfo,
    },
    source::{
        download_hls_segment_slice, DecryptedFmp4RodioSource, StreamCompletionGuard,
        StreamingPcmState,
    },
};
use crate::sinks::local::LocalAudioEngine;
use crate::sinks::soundcloud_api::{
    clean_soundcloud_id, ensure_valid_access_token, fetch_track_streams, SoundCloudStreamUrls,
};
use crate::time_tracker::LocalTimeTracker;
use anyhow::{anyhow, Context, Result};
use simp_protocol::{PlaybackEvent, SimpSettings};
use std::collections::{HashSet, VecDeque};
use std::io::Cursor;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};
use symphonia::{
    core::{
        audio::SampleBuffer,
        codecs::{DecoderOptions, CODEC_TYPE_NULL},
        errors::Error as SymphError,
        formats::FormatOptions,
        io::MediaSourceStream,
        meta::MetadataOptions,
        probe::Hint,
    },
    default::{get_codecs, get_probe},
};
use tokio::sync::{broadcast, mpsc};

/// Native Rust SoundCloud Audio Sink (`ActiveEngine::SoundCloud`).
/// Streams DRM-free HLS (`hls_aac_160_url`, `hls_mp3_128_url`) and progressive HTTP MP3 (`http_mp3_128_url`)
/// directly through SIMP's in-process `http_pool` (`libcurl`) and `LocalAudioEngine` (`Symphonia + Rodio -> PipeWire`).
#[derive(Clone, Default)]
pub struct SoundCloudSink {
    pub volume: f64,
    pub is_authenticated: bool,
    pub native_engine: Arc<Mutex<Option<LocalAudioEngine>>>,
}

impl SoundCloudSink {
    pub fn new() -> Self {
        Self {
            volume: 0.80,
            is_authenticated: false,
            native_engine: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_volume(&mut self, normalized_vol: f64) {
        self.volume = normalized_vol.clamp(0.0, 1.0);
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                eng.set_volume(self.volume);
            }
        }
    }

    pub fn prime_restored_session(&mut self, uri: String, position_ms: u32) {
        if let Ok(mut guard) = self.native_engine.lock() {
            let eng = guard.get_or_insert_with(LocalAudioEngine::new);
            eng.set_volume(self.volume);
            eng.prime_restored_session(uri, position_ms);
        }
    }

    pub fn check_idle_suspend(&mut self) {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                eng.check_idle_suspend();
            }
        }
    }
}

impl crate::sinks::AudioSink for SoundCloudSink {
    fn engine_kind(&self) -> simp_protocol::ActiveEngine {
        simp_protocol::ActiveEngine::SoundCloud
    }

    fn supports_uri(&self, uri: &str) -> bool {
        uri.starts_with("soundcloud:")
    }

    fn load_and_play_track(
        &mut self,
        uri: &str,
        start_pos_ms: u32,
        epoch: u64,
        internal_event_tx: &mpsc::UnboundedSender<PlaybackEvent>,
        _broadcast_tx: &broadcast::Sender<PlaybackEvent>,
    ) -> Result<()> {
        let mut guard = self
            .native_engine
            .lock()
            .map_err(|_| anyhow!("SoundCloud native_engine mutex poisoned"))?;
        let eng = guard.get_or_insert_with(LocalAudioEngine::new);
        eng.set_volume(self.volume);
        eng.load_and_play(uri, start_pos_ms, epoch, internal_event_tx.clone())
    }

    fn resume_playback(
        &mut self,
        epoch: u64,
        internal_event_tx: &mpsc::UnboundedSender<PlaybackEvent>,
        _broadcast_tx: &broadcast::Sender<PlaybackEvent>,
    ) -> Result<()> {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                return eng.play(epoch, internal_event_tx.clone());
            }
        }
        Ok(())
    }

    fn pause_playback(&mut self, _broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                eng.pause();
            }
        }
    }

    fn suspend_sink(&mut self, _broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                eng.release_pipewire_stream();
            }
        }
    }

    fn seek_playback(
        &mut self,
        position_ms: u32,
        epoch: u64,
        internal_event_tx: &mpsc::UnboundedSender<PlaybackEvent>,
        _broadcast_tx: &broadcast::Sender<PlaybackEvent>,
    ) -> Result<()> {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                return eng.seek(position_ms, epoch, internal_event_tx.clone());
            }
        }
        Ok(())
    }

    fn sync_volume(&mut self, volume: f32, _broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        self.set_volume(volume as f64);
    }

    fn live_position_ms(&self) -> Option<u32> {
        if let Ok(guard) = self.native_engine.lock() {
            if let Some(ref eng) = *guard {
                return Some(eng.get_position_ms());
            }
        }
        None
    }

    fn shutdown_sink(&mut self, _broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                eng.release_pipewire_stream();
            }
        }
    }
}

#[derive(Clone)]
struct SoundCloudDrmContext {
    song_key: String,
    tenc: TrackEncryptionInfo,
    cdm_lib_path: std::path::PathBuf,
    license_auth_token: String,
    pssh_bytes: Vec<u8>,
}

#[derive(Clone)]
struct PrefetchedSoundCloudTrack {
    track_id: String,
    playlist: Option<AppleHlsMediaPlaylist>,
    init_bytes: Vec<u8>,
    initial_segments: Vec<Vec<u8>>,
    initial_pcm: Vec<f32>,
    initial_segment_count: usize,
    is_complete: bool,
    drm_ctx: Option<SoundCloudDrmContext>,
    fetched_at: Instant,
}

static SC_PREFETCH_CACHE: OnceLock<Mutex<VecDeque<PrefetchedSoundCloudTrack>>> = OnceLock::new();
static SC_PREFETCH_IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn sc_prefetch_cache() -> &'static Mutex<VecDeque<PrefetchedSoundCloudTrack>> {
    SC_PREFETCH_CACHE.get_or_init(|| Mutex::new(VecDeque::with_capacity(6)))
}

pub fn clear_soundcloud_prefetch_cache() {
    if let Ok(mut guard) = sc_prefetch_cache().lock() {
        guard.clear();
    }
}

fn sc_prefetch_in_flight() -> &'static Mutex<HashSet<String>> {
    SC_PREFETCH_IN_FLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

fn take_prefetched_sc_track(track_id: &str) -> Option<PrefetchedSoundCloudTrack> {
    let mut guard = sc_prefetch_cache().lock().ok()?;
    guard.retain(|e| e.fetched_at.elapsed() < Duration::from_secs(600));
    let pos = guard.iter().position(|e| e.track_id == track_id)?;
    guard.remove(pos)
}

/// Prefetches the next SoundCloud track's stream URLs, HLS `.m3u8` playlist, and decodes Segment #0
/// into PCM in the background so advancing to the next track starts audio in `< 5ms`!
pub fn prefetch_soundcloud_track(settings: SimpSettings, track_uri: String) {
    if !track_uri.starts_with("soundcloud:") || track_uri.starts_with("soundcloud:station:") {
        return;
    }
    let track_id = clean_soundcloud_id(&track_uri);
    if track_id.is_empty() {
        return;
    }
    if let Ok(guard) = sc_prefetch_cache().lock() {
        if guard
            .iter()
            .any(|e| e.track_id == track_id && e.fetched_at.elapsed() < Duration::from_secs(600))
        {
            return;
        }
    }
    if let Ok(mut set) = sc_prefetch_in_flight().lock() {
        if !set.insert(track_id.clone()) {
            return;
        }
    }

    let _ = std::thread::Builder::new()
        .name("simp-sc-prefetch".to_string())
        .spawn(move || {
            struct Guard(String);
            impl Drop for Guard {
                fn drop(&mut self) {
                    if let Ok(mut set) = sc_prefetch_in_flight().lock() {
                        set.remove(&self.0);
                    }
                }
            }
            let _g = Guard(track_id.clone());

            let Ok(token) = ensure_valid_access_token(&settings) else {
                return;
            };
            let Ok(streams) = fetch_track_streams(&settings, &track_id) else {
                return;
            };
            let dummy_epoch = AtomicU64::new(0);
            if let Ok(prepared) =
                prepare_initial_soundcloud_stream(&streams, &token, 0, 0, &dummy_epoch)
            {
                if let Ok(mut guard) = sc_prefetch_cache().lock() {
                    guard.retain(|e| {
                        e.track_id != track_id && e.fetched_at.elapsed() < Duration::from_secs(600)
                    });
                    while guard.len() >= 5 {
                        guard.pop_front();
                    }
                    guard.push_back(PrefetchedSoundCloudTrack {
                        track_id,
                        playlist: prepared.playlist,
                        init_bytes: prepared.init_bytes,
                        initial_segments: prepared.initial_segments,
                        initial_pcm: prepared.initial_pcm,
                        initial_segment_count: prepared.initial_segment_count,
                        is_complete: prepared.is_complete,
                        drm_ctx: prepared.drm_ctx,
                        fetched_at: Instant::now(),
                    });
                }
            }
        });
}

struct PreparedSoundCloudStream {
    playlist: Option<AppleHlsMediaPlaylist>,
    init_bytes: Vec<u8>,
    initial_segments: Vec<Vec<u8>>,
    initial_pcm: Vec<f32>,
    initial_segment_count: usize,
    is_complete: bool,
    drm_ctx: Option<SoundCloudDrmContext>,
}

fn fetch_soundcloud_url_bytes(url: &str, access_token: &str) -> Result<Vec<u8>> {
    let needs_auth = url.contains("api.soundcloud.com");
    let auth_header = format!("OAuth {}", access_token.trim());
    let headers: Vec<(&str, &str)> = if needs_auth {
        vec![("Authorization", auth_header.as_str())]
    } else {
        Vec::new()
    };

    let bytes = crate::http_pool::http_get_bytes(url, &headers, None, 15)?;

    // SoundCloud stream endpoints sometimes return `{"url": "https://cf-hls-media.sndcdn.com/..."}`
    let trimmed = bytes.as_slice();
    if trimmed.starts_with(b"{") && trimmed.len() < 4096 {
        if let Ok(val) = serde_json::from_slice::<serde_json::Value>(trimmed) {
            if let Some(redirect_url) = val.get("url").and_then(|v| v.as_str()) {
                return crate::http_pool::http_get_bytes(redirect_url.trim(), &[], None, 15);
            }
        }
    }

    Ok(bytes)
}

fn fetch_and_parse_soundcloud_hls(
    stream_url: &str,
    access_token: &str,
) -> Result<AppleHlsMediaPlaylist> {
    let raw_bytes = fetch_soundcloud_url_bytes(stream_url, access_token)?;
    let text = String::from_utf8(raw_bytes).context("HLS playlist is not UTF-8")?;
    if !text.contains("#EXTM3U") {
        return Err(anyhow!("Not an #EXTM3U HLS playlist"));
    }

    if let Some(variant_url) = extract_variant_from_master_m3u8(stream_url, &text) {
        let var_bytes = fetch_soundcloud_url_bytes(&variant_url, access_token)?;
        let var_text = String::from_utf8(var_bytes).context("HLS variant is not UTF-8")?;
        return parse_apple_media_m3u8(&variant_url, &var_text);
    }

    parse_apple_media_m3u8(stream_url, &text)
}

/// Decodes an unencrypted audio buffer (`.mp3`, `.m4a` fMP4, `.aac` ADTS, `.wav`, `.ogg`) into stereo 44,100 Hz `f32` PCM.
pub fn decode_clear_audio_bytes_to_pcm(
    audio_bytes: Vec<u8>,
    ext_hint: Option<&str>,
) -> Result<(Vec<f32>, u16, u32)> {
    let mss = MediaSourceStream::new(Box::new(Cursor::new(audio_bytes)), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = ext_hint {
        hint.with_extension(ext);
    }

    let probed = get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .context("Symphonia failed to probe SoundCloud audio stream")?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("No supported audio track in SoundCloud stream"))?;

    let track_id = track.id;
    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .context("Symphonia failed to initialize audio decoder for SoundCloud stream")?;

    let mut samples: Vec<f32> = Vec::new();
    let mut channels: u16 = 2;
    let mut sample_rate: u32 = 44_100;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphError::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphError::ResetRequired) => break,
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        if let Ok(decoded) = decoder.decode(&packet) {
            let spec = *decoded.spec();
            let pkt_channels = spec.channels.count().max(1) as u16;
            sample_rate = spec.rate;
            let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
            buf.copy_interleaved_ref(decoded);
            if pkt_channels == 1 {
                // Up-mix mono SoundCloud uploads to stereo so Rodio's 2-channel sink plays at normal speed
                channels = 2;
                for &s in buf.samples() {
                    samples.push(s);
                    samples.push(s);
                }
            } else {
                channels = pkt_channels;
                samples.extend_from_slice(buf.samples());
            }
        }
    }

    if samples.is_empty() {
        return Err(anyhow!("Decoded 0 PCM samples from SoundCloud stream"));
    }

    // Resample to 44,100 Hz stereo if the stream uses a different sample rate (e.g. 48,000 Hz)
    // so `DecryptedFmp4RodioSource` (fixed 44,100 Hz stereo) plays at exact speed without drift or underrun.
    if sample_rate > 0 && sample_rate != 44_100 && channels == 2 && samples.len() >= 4 {
        let in_frames = samples.len() / 2;
        let ratio = sample_rate as f64 / 44_100.0;
        let out_frames = ((in_frames as f64) / ratio).round() as usize;
        if out_frames > 0 {
            let mut resampled = Vec::with_capacity(out_frames * 2);
            for out_idx in 0..out_frames {
                let src_pos = (out_idx as f64) * ratio;
                let idx0 = (src_pos.floor() as usize).min(in_frames - 1);
                let idx1 = (idx0 + 1).min(in_frames - 1);
                let frac = (src_pos - (idx0 as f64)) as f32;
                let l0 = samples[idx0 * 2];
                let r0 = samples[idx0 * 2 + 1];
                let l1 = samples[idx1 * 2];
                let r1 = samples[idx1 * 2 + 1];
                resampled.push(l0 + (l1 - l0) * frac);
                resampled.push(r0 + (r1 - r0) * frac);
            }
            samples = resampled;
            sample_rate = 44_100;
        }
    }

    Ok((samples, channels, sample_rate))
}

fn decode_soundcloud_segments(
    init_bytes: &[u8],
    segments: &[Vec<u8>],
    ext_hint: Option<&str>,
) -> Result<Vec<f32>> {
    let total_len: usize = init_bytes.len() + segments.iter().map(|s| s.len()).sum::<usize>();
    let mut combined = Vec::with_capacity(total_len);
    combined.extend_from_slice(init_bytes);
    for seg in segments {
        combined.extend_from_slice(seg);
    }
    let (pcm, _, _) = decode_clear_audio_bytes_to_pcm(combined, ext_hint)?;
    Ok(pcm)
}

fn prepare_initial_soundcloud_stream(
    streams: &SoundCloudStreamUrls,
    access_token: &str,
    start_pos_ms: u32,
    epoch: u64,
    active_epoch: &AtomicU64,
) -> Result<PreparedSoundCloudStream> {
    let candidates: Vec<(&str, bool, Option<&str>)> = [
        (
            streams.hls_aac_160_url.as_deref(),
            true,
            Some("m4a"),
        ),
        (
            streams.hls_mp3_128_url.as_deref(),
            true,
            Some("mp3"),
        ),
        (
            streams.http_mp3_128_url.as_deref(),
            false,
            Some("mp3"),
        ),
        (
            streams.hls_aac_96_url.as_deref(),
            true,
            Some("m4a"),
        ),
        (
            streams.preview_mp3_128_url.as_deref(),
            false,
            Some("mp3"),
        ),
    ]
    .into_iter()
    .filter_map(|(u, is_hls, hint)| u.filter(|s| !s.trim().is_empty()).map(|s| (s, is_hls, hint)))
    .collect();

    let mut last_err = anyhow!("No playable SoundCloud stream candidates");

    for (url, is_hls, hint) in candidates {
        if is_hls {
            match fetch_and_parse_soundcloud_hls(url, access_token) {
                Ok(playlist) if !playlist.segments.is_empty() => {
                    let init_bytes = if let Some(ref init_url) = playlist.init_segment_url {
                        fetch_hls_bytes(init_url, playlist.init_byte_range).unwrap_or_default()
                    } else {
                        Vec::new()
                    };

                    // Pre-buffer 2 segments (~6-8s of audio) so startup comment/waveform fetches never starve Segment #1
                    let mut initial_count = 2usize.min(playlist.segments.len());
                    if start_pos_ms > 0 {
                        initial_count = playlist.segments.len();
                        let target_sec = (start_pos_ms as f64 / 1000.0) + 6.0;
                        let mut accum = 0.0;
                        for (i, seg) in playlist.segments.iter().enumerate() {
                            accum += seg.duration_secs.max(4.0);
                            if accum >= target_sec {
                                initial_count = (i + 1).max(2).min(playlist.segments.len());
                                break;
                            }
                        }
                    }

                    if let Ok(initial_segs) =
                        download_hls_segment_slice(&playlist.segments[..initial_count])
                    {
                        if let Ok(pcm) = decode_soundcloud_segments(&init_bytes, &initial_segs, hint)
                            .or_else(|_| decode_soundcloud_segments(&init_bytes, &initial_segs, None))
                        {
                            let is_complete = initial_count >= playlist.segments.len();
                            return Ok(PreparedSoundCloudStream {
                                playlist: Some(playlist),
                                init_bytes,
                                initial_segments: initial_segs,
                                initial_pcm: pcm,
                                initial_segment_count: initial_count,
                                is_complete,
                                drm_ctx: None,
                            });
                        }
                    }
                    last_err = anyhow!("Failed to decode initial HLS segments for {url}");
                }
                Ok(_) => {
                    last_err = anyhow!("Empty HLS playlist at {url}");
                }
                Err(e) => {
                    last_err = e;
                }
            }
        } else {
            // Direct progressive HTTP MP3 stream
            match fetch_soundcloud_url_bytes(url, access_token) {
                Ok(bytes) => {
                    match decode_clear_audio_bytes_to_pcm(bytes, hint) {
                        Ok((pcm, _, _)) => {
                            return Ok(PreparedSoundCloudStream {
                                playlist: None,
                                init_bytes: Vec::new(),
                                initial_segments: Vec::new(),
                                initial_pcm: pcm,
                                initial_segment_count: 1,
                                is_complete: true,
                                drm_ctx: None,
                            });
                        }
                        Err(e) => {
                            last_err = e;
                        }
                    }
                }
                Err(e) => {
                    last_err = e;
                }
            }
        }
    }

    // API v2 Widevine-encrypted `ctr-encrypted-hls` (`cenc` fMP4) path
    if let (Some(ref drm_url), Some(ref lic_token)) =
        (&streams.drm_hls_url, &streams.drm_license_auth_token)
    {
        if !drm_url.trim().is_empty() && !lic_token.trim().is_empty() {
            let cdm = discover_widevine_cdm_library().ok_or_else(|| {
                anyhow!(
                    "SoundCloud API v2 encrypted track requires Widevine CDM (libwidevinecdm.so)"
                )
            })?;
            let playlist = fetch_and_parse_soundcloud_hls(drm_url, access_token)?;
            if playlist.segments.is_empty() {
                return Err(anyhow!("Empty SoundCloud DRM HLS playlist at {drm_url}"));
            }
            let init_url = playlist
                .init_segment_url
                .as_ref()
                .ok_or_else(|| anyhow!("Missing #EXT-X-MAP init.mp4 in SoundCloud DRM HLS"))?;
            let raw_init_bytes = fetch_hls_bytes(init_url, playlist.init_byte_range)?;
            let mut tenc = parse_init_segment_tenc(&raw_init_bytes).unwrap_or_default();
            if &tenc.scheme_type != b"cenc" && &tenc.scheme_type != b"cbcs" {
                tenc.scheme_type = *b"cenc";
            }
            let pssh_bytes = if !playlist.widevine_pssh_bytes.is_empty() {
                Some(playlist.widevine_pssh_bytes.clone())
            } else {
                find_widevine_pssh_in_mp4(&raw_init_bytes)
            }
            .ok_or_else(|| anyhow!("Missing Widevine PSSH in SoundCloud DRM HLS stream"))?;
            let clear_init_bytes = rewrite_init_segment_enca_to_clear(&raw_init_bytes);

            let mut initial_count = 2usize.min(playlist.segments.len());
            if start_pos_ms > 0 {
                initial_count = playlist.segments.len();
                let target_sec = (start_pos_ms as f64 / 1000.0) + 6.0;
                let mut accum = 0.0;
                for (i, seg) in playlist.segments.iter().enumerate() {
                    accum += seg.duration_secs.max(4.0);
                    if accum >= target_sec {
                        initial_count = (i + 1).max(2).min(playlist.segments.len());
                        break;
                    }
                }
            }

            let song_key = format!("sc:{}", streams.track_id);
            negotiate_soundcloud_license_for_epoch(
                &cdm.library_path,
                epoch,
                active_epoch,
                lic_token,
                &song_key,
                &pssh_bytes,
            )?;

            let encrypted_initial = download_hls_segment_slice(&playlist.segments[..initial_count])?;
            let decrypted_initial = decrypt_segments_for_epoch(
                epoch,
                &song_key,
                encrypted_initial,
                tenc.clone(),
            )?;

            let pcm = decode_soundcloud_segments(&clear_init_bytes, &decrypted_initial, Some("m4a"))
                .or_else(|_| decode_soundcloud_segments(&clear_init_bytes, &decrypted_initial, None))?;
            let is_complete = initial_count >= playlist.segments.len();
            return Ok(PreparedSoundCloudStream {
                playlist: Some(playlist),
                init_bytes: clear_init_bytes,
                initial_segments: decrypted_initial,
                initial_pcm: pcm,
                initial_segment_count: initial_count,
                is_complete,
                drm_ctx: Some(SoundCloudDrmContext {
                    song_key,
                    tenc,
                    cdm_lib_path: cdm.library_path,
                    license_auth_token: lic_token.clone(),
                    pssh_bytes,
                }),
            });
        }
    }

    Err(last_err)
}

/// Non-blocking progressive SoundCloud stream loader for `LocalAudioEngine`:
/// Returns a `DecryptedFmp4RodioSource` immediately and spawns a background worker that:
/// 1. Uses prefetched PCM when available (`< 5ms` start!) or fetches `/tracks/{id}/streams` + Segment #0
/// 2. Starts `rodio` playback immediately once Segment #0 is decoded into `StreamingPcmState`
/// 3. Streams & decodes remaining HLS segments in batches in volatile RAM (never writing audio files to disk)
pub fn spawn_progressive_soundcloud_rodio_source(
    settings: SimpSettings,
    track_uri: String,
    next_track_uri: Option<String>,
    start_pos_ms: u32,
    epoch: u64,
    active_epoch: Arc<AtomicU64>,
    tracker: Arc<Mutex<LocalTimeTracker>>,
    user_paused_flag: Arc<AtomicBool>,
) -> Result<DecryptedFmp4RodioSource> {
    let track_id = clean_soundcloud_id(&track_uri);
    if track_id.is_empty() {
        return Err(anyhow!("Invalid SoundCloud track URI: {track_uri}"));
    }

    let state = Arc::new(Mutex::new(StreamingPcmState::default()));
    let source = DecryptedFmp4RodioSource::new_progressive(
        state.clone(),
        start_pos_ms,
        epoch,
        active_epoch.clone(),
    )
    .with_tracker(tracker.clone(), user_paused_flag.clone());

    let mark_aborted = |st: &Arc<Mutex<StreamingPcmState>>| {
        if let Ok(mut g) = st.lock() {
            g.aborted = true;
            g.is_complete = true;
        }
    };

    std::thread::Builder::new()
        .name("simp-sc-stream".to_string())
        .spawn(move || {
            let _completion_guard = StreamCompletionGuard(state.clone());
            if active_epoch.load(Ordering::SeqCst) != epoch {
                mark_aborted(&state);
                return;
            }

            let target_initial_sample =
                (((start_pos_ms as f64 / 1000.0) * 44_100.0).round() as usize) * 2;
            if let Some(pf) = take_prefetched_sc_track(&track_id) {
                if start_pos_ms == 0
                    || pf.is_complete
                    || pf.initial_pcm.len() > target_initial_sample
                {
                    let total_expected = if let Some(ref pl) = pf.playlist {
                        let dur: f64 = pl.segments.iter().map(|s| s.duration_secs).sum();
                        ((dur * 44_100.0).round() as usize) * 2
                    } else {
                        pf.initial_pcm.len()
                    };

                    if let Ok(mut g) = state.lock() {
                        g.total_expected_samples = total_expected.max(pf.initial_pcm.len());
                        g.samples = pf.initial_pcm;
                        if pf.is_complete {
                            g.is_complete = true;
                        }
                    }

                    if active_epoch.load(Ordering::SeqCst) == epoch {
                        if let Ok(mut tr) = tracker.lock() {
                            tr.reset();
                            tr.seek(start_pos_ms);
                            if !user_paused_flag.load(Ordering::SeqCst) {
                                tr.play();
                            }
                        }
                    }

                    if pf.is_complete {
                        if active_epoch.load(Ordering::SeqCst) == epoch {
                            if let Some(next_uri) = next_track_uri {
                                prefetch_soundcloud_track(settings.clone(), next_uri);
                            }
                        }
                        return;
                    }

                    if let Some(playlist) = pf.playlist {
                        stream_remaining_sc_hls_segments(
                            playlist,
                            pf.init_bytes,
                            pf.initial_segments,
                            pf.initial_segment_count,
                            pf.drm_ctx,
                            epoch,
                            active_epoch.clone(),
                            state,
                            settings,
                            next_track_uri,
                        );
                    }
                    return;
                }
            }

            let token = match ensure_valid_access_token(&settings).or_else(|_| {
                std::thread::sleep(Duration::from_millis(120));
                ensure_valid_access_token(&settings)
            }) {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!("SoundCloud auth failed for {track_uri}: {e}");
                    mark_aborted(&state);
                    return;
                }
            };

            let streams = match fetch_track_streams(&settings, &track_id).or_else(|_| {
                std::thread::sleep(Duration::from_millis(120));
                fetch_track_streams(&settings, &track_id)
            }) {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!("SoundCloud streams lookup failed for {track_uri}: {e}");
                    mark_aborted(&state);
                    return;
                }
            };

            if active_epoch.load(Ordering::SeqCst) != epoch {
                mark_aborted(&state);
                return;
            }

            let prepared = match prepare_initial_soundcloud_stream(
                &streams,
                &token,
                start_pos_ms,
                epoch,
                &active_epoch,
            )
            .or_else(|_| {
                std::thread::sleep(Duration::from_millis(120));
                prepare_initial_soundcloud_stream(&streams, &token, start_pos_ms, epoch, &active_epoch)
            }) {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!("SoundCloud initial stream decode failed for {track_uri}: {e}");
                    mark_aborted(&state);
                    return;
                }
            };

            let total_expected = if let Some(ref pl) = prepared.playlist {
                let dur: f64 = pl.segments.iter().map(|s| s.duration_secs).sum();
                ((dur * 44_100.0).round() as usize) * 2
            } else {
                prepared.initial_pcm.len()
            };

            if let Ok(mut g) = state.lock() {
                g.total_expected_samples = total_expected.max(prepared.initial_pcm.len());
                g.samples = prepared.initial_pcm;
                if prepared.is_complete {
                    g.is_complete = true;
                }
            }

            if active_epoch.load(Ordering::SeqCst) == epoch {
                if let Ok(mut tr) = tracker.lock() {
                    tr.reset();
                    tr.seek(start_pos_ms);
                    if !user_paused_flag.load(Ordering::SeqCst) {
                        tr.play();
                    }
                }
            }

            if prepared.is_complete {
                if active_epoch.load(Ordering::SeqCst) == epoch {
                    if let Some(next_uri) = next_track_uri {
                        prefetch_soundcloud_track(settings.clone(), next_uri);
                    }
                }
                return;
            }

            if let Some(playlist) = prepared.playlist {
                stream_remaining_sc_hls_segments(
                    playlist,
                    prepared.init_bytes,
                    prepared.initial_segments,
                    prepared.initial_segment_count,
                    prepared.drm_ctx,
                    epoch,
                    active_epoch,
                    state,
                    settings,
                    next_track_uri,
                );
            }
        })
        .context("Failed to spawn SoundCloud stream thread")?;

    Ok(source)
}

#[allow(clippy::too_many_arguments)]
fn stream_remaining_sc_hls_segments(
    playlist: AppleHlsMediaPlaylist,
    init_bytes: Vec<u8>,
    mut all_fmp4_segments: Vec<Vec<u8>>,
    start_idx: usize,
    drm_ctx: Option<SoundCloudDrmContext>,
    epoch: u64,
    active_epoch: Arc<AtomicU64>,
    state: Arc<Mutex<StreamingPcmState>>,
    settings: SimpSettings,
    mut next_track_uri: Option<String>,
) {
    let has_fmp4_init = !init_bytes.is_empty();
    let mut decoded_pcm_len = state.lock().map(|g| g.samples.len()).unwrap_or(0);
    let mut idx = start_idx;
    let mut batches_completed = 0usize;

    while idx < playlist.segments.len() {
        if active_epoch.load(Ordering::SeqCst) != epoch {
            if let Ok(mut g) = state.lock() {
                g.aborted = true;
                g.is_complete = true;
            }
            return;
        }

        let requested_sample = state.lock().map(|g| g.requested_seek_sample).unwrap_or(0);
        let mut step = if idx == start_idx { 3usize } else { 5usize };
        if requested_sample > decoded_pcm_len {
            let missing_secs = ((requested_sample - decoded_pcm_len) as f64) / (44_100.0 * 2.0);
            let mut accum_secs = 0.0;
            let mut needed_segs = 0usize;
            for seg in &playlist.segments[idx..] {
                accum_secs += seg.duration_secs.max(4.0);
                needed_segs += 1;
                if accum_secs >= missing_secs + 6.0 {
                    break;
                }
            }
            step = step.max(needed_segs);
        }
        let end_idx = (idx + step).min(playlist.segments.len());

        // Retry transient CDN errors up to 3 times before falling back to single-segment download
        let mut batch_segs_opt = None;
        for attempt in 0..3 {
            if active_epoch.load(Ordering::SeqCst) != epoch {
                if let Ok(mut g) = state.lock() {
                    g.aborted = true;
                    g.is_complete = true;
                }
                return;
            }
            match download_hls_segment_slice(&playlist.segments[idx..end_idx]) {
                Ok(s) => {
                    batch_segs_opt = Some(s);
                    break;
                }
                Err(e) => {
                    if attempt == 2 {
                        tracing::warn!("SoundCloud HLS segment batch {idx}..{end_idx} failed after 3 attempts: {e}");
                    } else {
                        std::thread::sleep(Duration::from_millis(150 * (attempt as u64 + 1)));
                    }
                }
            }
        }

        let raw_batch_segs = match batch_segs_opt {
            Some(s) => s,
            None => {
                // Try downloading just the single next segment before giving up
                if end_idx > idx + 1 {
                    if let Ok(single) = download_hls_segment_slice(&playlist.segments[idx..idx + 1]) {
                        single
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
        };
        let actual_end_idx = idx + raw_batch_segs.len();

        if active_epoch.load(Ordering::SeqCst) != epoch {
            if let Ok(mut g) = state.lock() {
                g.aborted = true;
                g.is_complete = true;
            }
            return;
        }

        let batch_segs = if let Some(ref drm) = drm_ctx {
            match decrypt_segments_for_epoch(
                epoch,
                &drm.song_key,
                raw_batch_segs.clone(),
                drm.tenc.clone(),
            ) {
                Ok(dec) => dec,
                Err(_) => {
                    let _ = negotiate_soundcloud_license_for_epoch(
                        &drm.cdm_lib_path,
                        epoch,
                        &active_epoch,
                        &drm.license_auth_token,
                        &drm.song_key,
                        &drm.pssh_bytes,
                    );
                    match decrypt_segments_for_epoch(
                        epoch,
                        &drm.song_key,
                        raw_batch_segs,
                        drm.tenc.clone(),
                    ) {
                        Ok(dec) => dec,
                        Err(e) => {
                            tracing::warn!(
                                "SoundCloud Widevine segment batch decrypt failed for {}: {e}",
                                drm.song_key
                            );
                            break;
                        }
                    }
                }
            }
        } else {
            raw_batch_segs
        };

        if has_fmp4_init {
            // Try O(1) batch decode first (`init_bytes + batch_segs`); fall back to full contiguous decode if needed
            let direct_batch_ok = if let Ok(batch_pcm) =
                decode_soundcloud_segments(&init_bytes, &batch_segs, Some("m4a"))
                    .or_else(|_| decode_soundcloud_segments(&init_bytes, &batch_segs, None))
            {
                if !batch_pcm.is_empty() {
                    if let Ok(mut g) = state.lock() {
                        g.samples.extend_from_slice(&batch_pcm);
                    }
                    decoded_pcm_len += batch_pcm.len();
                    true
                } else {
                    false
                }
            } else {
                false
            };

            all_fmp4_segments.extend(batch_segs);
            if !direct_batch_ok {
                if let Ok(full_pcm) =
                    decode_soundcloud_segments(&init_bytes, &all_fmp4_segments, Some("m4a"))
                        .or_else(|_| decode_soundcloud_segments(&init_bytes, &all_fmp4_segments, None))
                {
                    if full_pcm.len() > decoded_pcm_len {
                        if let Ok(mut g) = state.lock() {
                            g.samples.extend_from_slice(&full_pcm[decoded_pcm_len..]);
                        }
                        decoded_pcm_len = full_pcm.len();
                    }
                }
            }
        } else {
            // Standalone MP3 / ADTS segments: decode just the new batch in O(1) and append!
            if let Ok(batch_pcm) = decode_soundcloud_segments(&[], &batch_segs, Some("mp3"))
                .or_else(|_| decode_soundcloud_segments(&[], &batch_segs, None))
            {
                if let Ok(mut g) = state.lock() {
                    g.samples.extend_from_slice(&batch_pcm);
                }
            }
        }

        idx = actual_end_idx;
        batches_completed += 1;

        // Only trigger next-track prefetch after we have buffered at least 2 batches (~20-30s) of the active track
        if batches_completed >= 2 {
            if let Some(next_uri) = next_track_uri.take() {
                if active_epoch.load(Ordering::SeqCst) == epoch {
                    prefetch_soundcloud_track(settings.clone(), next_uri);
                }
            }
        }
    }

    if let Some(next_uri) = next_track_uri.take() {
        if active_epoch.load(Ordering::SeqCst) == epoch {
            prefetch_soundcloud_track(settings, next_uri);
        }
    }

    if let Ok(mut g) = state.lock() {
        g.is_complete = true;
    }
}
