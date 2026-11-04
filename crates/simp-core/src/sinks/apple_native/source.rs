use crate::sinks::apple::AppleMusicSink;
use crate::sinks::apple_api::fetch_web_playback_manifest;
use crate::sinks::apple_native::{
    cdm_host::{
        discover_widevine_cdm_library, with_persistent_cdm_session, DiscoveredWidevineCdm,
    },
    hls::{
        fetch_and_parse_apple_hls, fetch_hls_bytes, AppleHlsMediaPlaylist, HlsByteRange,
        HlsMediaSegment,
    },
    mp4_cbcs::{
        decrypt_fmp4_media_segment_in_place, find_widevine_pssh_in_mp4, parse_init_segment_tenc,
        rewrite_init_segment_enca_to_clear, TrackEncryptionInfo,
    },
};
use crate::time_tracker::LocalTimeTracker;
use anyhow::{anyhow, Context, Result};
use rodio::{source::SeekError as RodioSeekError, Source};
use serde::{Deserialize, Serialize};
use simp_protocol::SimpSettings;
use std::io::Cursor;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
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

/// Diagnostic report produced by `probe_apple_native_pipeline()` to verify Stage 1 + Stage 2
/// (`webPlayback` -> `.m3u8` -> `EXT-X-MAP` init segment -> `pssh` & `tenc` box extraction -> CDM library discovery).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppleNativeProbeReport {
    pub song_id: String,
    pub flavor: String,
    pub hls_playlist_url: String,
    pub key_server_url: Option<String>,
    pub encryption_method: Option<String>,
    pub segment_count: usize,
    pub total_duration_secs: f64,
    pub init_segment_bytes: usize,
    pub scheme_type: String,
    pub per_sample_iv_size: u8,
    pub default_kid_hex: String,
    pub widevine_pssh_len: usize,
    pub discovered_cdm: Option<DiscoveredWidevineCdm>,
    pub cdm_session_test: Option<String>,
}

/// Runs a complete non-destructive Stage 1 + Stage 2 probe for an Apple Music `song_id`:
/// 1. Calls `webPlayback` with the user's Developer JWT + `Music-User-Token`
/// 2. Downloads and parses the HLS Master & Media `.m3u8` playlists
/// 3. Downloads the `EXT-X-MAP` fMP4 initialization segment (`moov`)
/// 4. Extracts the `tenc` (`default_KID`, `per_sample_iv_size`, `constant_iv`) and Widevine `pssh` boxes
/// 5. Checks for a local `libwidevinecdm.so` binary
pub fn probe_apple_native_pipeline(
    settings: &SimpSettings,
    song_id: &str,
) -> Result<AppleNativeProbeReport> {
    let manifest = fetch_web_playback_manifest(settings, song_id)?;
    let playlist = fetch_and_parse_apple_hls(&manifest.hls_playlist_url)?;

    let init_url = playlist
        .init_segment_url
        .as_deref()
        .ok_or_else(|| anyhow!("HLS playlist did not specify #EXT-X-MAP init segment"))?;
    let init_bytes = fetch_hls_bytes(init_url, playlist.init_byte_range)?;

    let tenc = parse_init_segment_tenc(&init_bytes).unwrap_or_default();
    let pssh_bytes = if !playlist.widevine_pssh_bytes.is_empty() {
        playlist.widevine_pssh_bytes.clone()
    } else {
        find_widevine_pssh_in_mp4(&init_bytes).unwrap_or_default()
    };

    let kid_hex: String = tenc
        .default_kid
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let total_duration_secs: f64 = playlist.segments.iter().map(|s| s.duration_secs).sum();
    let discovered_cdm = discover_widevine_cdm_library();
    let cdm_session_test = if let Some(ref cdm_info) = discovered_cdm {
        Some(run_isolated_cdm_probe_subprocess(
            &cdm_info.library_path,
            &cdm_info.source_label,
            &song_id,
        ))
    } else {
        None
    };

    Ok(AppleNativeProbeReport {
        song_id: manifest.song_id,
        flavor: manifest.flavor,
        hls_playlist_url: playlist.playlist_url,
        key_server_url: manifest.key_server_url,
        encryption_method: playlist.encryption_method,
        segment_count: playlist.segments.len(),
        total_duration_secs,
        init_segment_bytes: init_bytes.len(),
        scheme_type: String::from_utf8_lossy(&tenc.scheme_type).to_string(),
        per_sample_iv_size: tenc.per_sample_iv_size,
        default_kid_hex: kid_hex,
        widevine_pssh_len: pssh_bytes.len(),
        discovered_cdm,
        cdm_session_test,
    })
}

/// Shared progressive PCM buffer populated by the background HLS + Widevine decryption worker
/// while `DecryptedFmp4RodioSource` streams audio to `rodio::Sink`.
pub struct StreamingPcmState {
    pub samples: Vec<f32>,
    pub total_expected_samples: usize,
    pub is_complete: bool,
    pub aborted: bool,
}

/// Decodes a decrypted fMP4 stream (`clear_init_segment` + one or more decrypted `moof+mdat` segments)
/// into interleaved `f32` PCM samples using `Symphonia` (`IsoMp4Reader` + `AacDecoder`), wrapped as a
/// progressive lock-free-chunked `rodio::Source`.
pub struct DecryptedFmp4RodioSource {
    state: Arc<Mutex<StreamingPcmState>>,
    local_chunk: Vec<f32>,
    local_chunk_start: usize,
    cursor: usize,
    channels: u16,
    sample_rate: u32,
}

impl DecryptedFmp4RodioSource {
    /// Creates an immediately-appendable progressive `DecryptedFmp4RodioSource` (44,100 Hz stereo)
    /// whose `StreamingPcmState` is populated asynchronously by the background Widevine worker.
    pub fn new_progressive(state: Arc<Mutex<StreamingPcmState>>, initial_pos_ms: u32) -> Self {
        let sample_rate = 44_100u32;
        let channels = 2u16;
        let initial_frame = ((initial_pos_ms as f64 / 1000.0) * (sample_rate as f64)).round() as usize;
        let initial_cursor = initial_frame * (channels as usize);
        Self {
            state,
            local_chunk: Vec::with_capacity(16_384),
            local_chunk_start: 0,
            cursor: initial_cursor,
            channels,
            sample_rate,
        }
    }

    /// Concatenates the rewritten clear init segment (`enca` -> `mp4a`) with decrypted media segments
    /// and decodes the audio frames in memory via Symphonia.
    pub fn from_clear_init_and_decrypted_segments(
        clear_init_bytes: &[u8],
        decrypted_segments: &[Vec<u8>],
    ) -> Result<Self> {
        let (samples, channels, sample_rate) =
            decode_clear_init_and_segments_to_pcm(clear_init_bytes, decrypted_segments)?;
        let len = samples.len();
        Ok(Self {
            state: Arc::new(Mutex::new(StreamingPcmState {
                samples,
                total_expected_samples: len,
                is_complete: true,
                aborted: false,
            })),
            local_chunk: Vec::with_capacity(16_384),
            local_chunk_start: 0,
            cursor: 0,
            channels,
            sample_rate,
        })
    }

    /// Decrypts encrypted `moof+mdat` media segments with `content_key`, rewrites the `init_segment`
    /// (`enca` -> `mp4a`), and decodes the resulting fMP4 stream via Symphonia.
    pub fn from_encrypted_fmp4_parts(
        encrypted_init_bytes: &[u8],
        mut encrypted_segments: Vec<Vec<u8>>,
        content_key: &[u8; 16],
        tenc: &TrackEncryptionInfo,
    ) -> Result<Self> {
        let clear_init = rewrite_init_segment_enca_to_clear(encrypted_init_bytes);
        for seg in &mut encrypted_segments {
            decrypt_fmp4_media_segment_in_place(seg, content_key, tenc)?;
        }
        Self::from_clear_init_and_decrypted_segments(&clear_init, &encrypted_segments)
    }

    pub fn from_fmp4_bytes(fmp4_bytes: Vec<u8>) -> Result<Self> {
        let (samples, channels, sample_rate) = decode_fmp4_bytes_to_pcm(fmp4_bytes)?;
        let len = samples.len();
        Ok(Self {
            state: Arc::new(Mutex::new(StreamingPcmState {
                samples,
                total_expected_samples: len,
                is_complete: true,
                aborted: false,
            })),
            local_chunk: Vec::with_capacity(16_384),
            local_chunk_start: 0,
            cursor: 0,
            channels,
            sample_rate,
        })
    }

    pub fn pcm_sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn pcm_channels(&self) -> u16 {
        self.channels
    }

    pub fn pcm_duration_secs(&self) -> f64 {
        let len = self
            .state
            .lock()
            .map(|g| g.samples.len().max(g.total_expected_samples))
            .unwrap_or(0);
        let frames = len / (self.channels.max(1) as usize);
        frames as f64 / (self.sample_rate.max(1) as f64)
    }
}

pub fn decode_clear_init_and_segments_to_pcm(
    clear_init_bytes: &[u8],
    decrypted_segments: &[Vec<u8>],
) -> Result<(Vec<f32>, u16, u32)> {
    let total_len: usize =
        clear_init_bytes.len() + decrypted_segments.iter().map(|s| s.len()).sum::<usize>();
    let mut combined = Vec::with_capacity(total_len);
    combined.extend_from_slice(clear_init_bytes);
    for seg in decrypted_segments {
        combined.extend_from_slice(seg);
    }
    decode_fmp4_bytes_to_pcm(combined)
}

pub fn decode_fmp4_bytes_to_pcm(fmp4_bytes: Vec<u8>) -> Result<(Vec<f32>, u16, u32)> {
    let mss = MediaSourceStream::new(Box::new(Cursor::new(fmp4_bytes)), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("m4a");

    let probed = get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .context("Symphonia failed to probe decrypted fMP4 stream")?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("No supported audio track in decrypted fMP4 stream"))?;

    let track_id = track.id;
    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .context("Symphonia failed to initialize AAC/ALAC decoder for fMP4 stream")?;

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
            channels = spec.channels.count().max(1) as u16;
            sample_rate = spec.rate;
            let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
            buf.copy_interleaved_ref(decoded);
            samples.extend_from_slice(buf.samples());
        }
    }

    if samples.is_empty() {
        return Err(anyhow!("Decoded 0 PCM samples from fMP4 stream"));
    }

    Ok((samples, channels, sample_rate))
}

impl Iterator for DecryptedFmp4RodioSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        // Fast path: serve from local 16K sample chunk without locking the shared Mutex!
        if self.cursor >= self.local_chunk_start
            && self.cursor < self.local_chunk_start + self.local_chunk.len()
        {
            let s = self.local_chunk[self.cursor - self.local_chunk_start];
            self.cursor += 1;
            return Some(s);
        }

        // Slow path: refill 16,384 samples (~185ms of stereo audio) from StreamingPcmState
        if let Ok(guard) = self.state.lock() {
            if guard.aborted {
                return None;
            }
            if self.cursor < guard.samples.len() {
                let end = (self.cursor + 16_384).min(guard.samples.len());
                self.local_chunk.clear();
                self.local_chunk.extend_from_slice(&guard.samples[self.cursor..end]);
                self.local_chunk_start = self.cursor;
                let s = self.local_chunk[0];
                self.cursor += 1;
                return Some(s);
            }
            if !guard.is_complete {
                // Initial or mid-track segments still downloading in background; yield silence sample
                return Some(0.0);
            }
        }
        None
    }
}

impl Source for DecryptedFmp4RodioSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        let len = self
            .state
            .lock()
            .map(|g| g.samples.len().max(g.total_expected_samples))
            .unwrap_or(0);
        if len == 0 {
            return None;
        }
        let frames = len / (self.channels.max(1) as usize);
        Some(Duration::from_secs_f64(
            frames as f64 / (self.sample_rate.max(1) as f64),
        ))
    }

    fn try_seek(&mut self, pos: Duration) -> std::result::Result<(), RodioSeekError> {
        let ch = self.channels.max(1) as usize;
        let target_frame = (pos.as_secs_f64() * (self.sample_rate.max(1) as f64)).round() as usize;
        let mut target_sample_idx = target_frame * ch;
        if let Ok(guard) = self.state.lock() {
            if guard.is_complete && !guard.samples.is_empty() {
                target_sample_idx = target_sample_idx.min(guard.samples.len());
            }
        }
        self.cursor = target_sample_idx - (target_sample_idx % ch);
        self.local_chunk.clear();
        Ok(())
    }
}

/// Fetches and prepares the initialization segment and encryption metadata for an `AppleHlsMediaPlaylist`.
pub fn fetch_hls_init_and_tenc(
    playlist: &AppleHlsMediaPlaylist,
) -> Result<(Vec<u8>, TrackEncryptionInfo)> {
    let init_url = playlist
        .init_segment_url
        .as_deref()
        .ok_or_else(|| anyhow!("Missing #EXT-X-MAP init segment URL"))?;
    let init_bytes = fetch_hls_bytes(init_url, playlist.init_byte_range)?;
    let tenc = parse_init_segment_tenc(&init_bytes).unwrap_or_default();
    Ok((init_bytes, tenc))
}

/// Downloads a slice of `HlsMediaSegment`s, coalescing contiguous byte-range segments that share
/// the same `.mp4` URL into a single HTTP Range request to minimize TLS/curl round-trips.
pub fn download_hls_segment_slice(target_segments: &[HlsMediaSegment]) -> Result<Vec<Vec<u8>>> {
    if target_segments.is_empty() {
        return Ok(Vec::new());
    }

    let mut bulk_downloaded: Option<(u64, Vec<u8>)> = None;
    if target_segments.len() > 1 {
        if let Some(first_seg) = target_segments.first() {
            let first_url = &first_seg.url;
            let all_same_url_with_br = target_segments.iter().all(|s| {
                s.url == *first_url && s.byte_range.map(|b| b.length > 0).unwrap_or(false)
            });
            if all_same_url_with_br {
                let min_offset = target_segments
                    .iter()
                    .filter_map(|s| s.byte_range.map(|b| b.offset))
                    .min()
                    .unwrap_or(0);
                let max_end = target_segments
                    .iter()
                    .filter_map(|s| s.byte_range.map(|b| b.offset + b.length))
                    .max()
                    .unwrap_or(0);
                if max_end > min_offset && (max_end - min_offset) <= 64 * 1024 * 1024 {
                    if let Ok(bytes) = fetch_hls_bytes(
                        first_url,
                        Some(HlsByteRange {
                            offset: min_offset,
                            length: max_end - min_offset,
                        }),
                    ) {
                        if bytes.len() as u64 == max_end - min_offset {
                            bulk_downloaded = Some((min_offset, bytes));
                        }
                    }
                }
            }
        }
    }

    let mut out = Vec::with_capacity(target_segments.len());
    for seg in target_segments {
        let seg_bytes = if let (Some((base_offset, ref bulk)), Some(br)) =
            (&bulk_downloaded, seg.byte_range)
        {
            let start = (br.offset.saturating_sub(*base_offset)) as usize;
            let end = start + (br.length as usize);
            if end <= bulk.len() {
                bulk[start..end].to_vec()
            } else {
                fetch_hls_bytes(&seg.url, seg.byte_range)?
            }
        } else {
            fetch_hls_bytes(&seg.url, seg.byte_range)?
        };
        out.push(seg_bytes);
    }
    Ok(out)
}

/// Non-blocking progressive Apple Music stream loader for `LocalAudioEngine`:
/// Returns a `DecryptedFmp4RodioSource` in < 0.1ms and spawns a background worker that:
/// 1. Negotiates the Widevine CKC license on the persistent `"simp-widevine-cdm"` thread
///    **in parallel** with downloading the init segment + first 2 media segments (~20s of audio)
/// 2. Starts audio playback as soon as the first 2 segments are decrypted & decoded (~0.6-0.8s)
/// 3. Streams & decrypts the remaining segments in batches in the background, aborting immediately
///    if `active_epoch` advances (e.g. when the user presses Next/Previous).
pub fn spawn_progressive_apple_music_rodio_source(
    settings: SimpSettings,
    song_uri: String,
    start_pos_ms: u32,
    epoch: u64,
    active_epoch: Arc<AtomicU64>,
    tracker: Arc<Mutex<LocalTimeTracker>>,
    user_paused_flag: Arc< std::sync::atomic::AtomicBool>,
) -> Result<DecryptedFmp4RodioSource> {
    let cdm_lib = discover_widevine_cdm_library().ok_or_else(|| {
        anyhow!("No local libwidevinecdm.so found for zero-browser native playback")
    })?;

    let creds = AppleMusicSink::resolve_credentials(&settings);
    let dev_token = AppleMusicSink::get_or_sign_developer_token(&settings)?;
    let user_token = creds
        .music_user_token
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| anyhow!("Apple Music user token is not configured"))?;

    let state = Arc::new(Mutex::new(StreamingPcmState {
        samples: Vec::new(),
        total_expected_samples: 0,
        is_complete: false,
        aborted: false,
    }));
    let source = DecryptedFmp4RodioSource::new_progressive(state.clone(), start_pos_ms);

    let mark_aborted = |st: &Arc<Mutex<StreamingPcmState>>| {
        if let Ok(mut g) = st.lock() {
            g.aborted = true;
            g.is_complete = true;
        }
    };

    std::thread::Builder::new()
        .name("simp-apple-stream".to_string())
        .spawn(move || {
            if active_epoch.load(Ordering::SeqCst) != epoch {
                mark_aborted(&state);
                return;
            }

            let manifest = match fetch_web_playback_manifest(&settings, &song_uri) {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!("Apple webPlayback manifest failed for {song_uri}: {e}");
                    mark_aborted(&state);
                    return;
                }
            };
            if active_epoch.load(Ordering::SeqCst) != epoch {
                mark_aborted(&state);
                return;
            }

            let playlist = match fetch_and_parse_apple_hls(&manifest.hls_playlist_url) {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!("Apple HLS playlist fetch failed for {song_uri}: {e}");
                    mark_aborted(&state);
                    return;
                }
            };
            if active_epoch.load(Ordering::SeqCst) != epoch {
                mark_aborted(&state);
                return;
            }

            let total_dur_secs: f64 = playlist.segments.iter().map(|s| s.duration_secs).sum();
            if let Ok(mut g) = state.lock() {
                g.total_expected_samples = ((total_dur_secs * 44_100.0).round() as usize) * 2;
            }

            // Calculate how many segments are needed before starting audio playback:
            // Default to first 2 segments (~20s of audio, ~350 KB) so playback begins in < 0.8s!
            let mut initial_count = 2usize.min(playlist.segments.len());
            if start_pos_ms > 0 {
                let target_sec = (start_pos_ms as f64 / 1000.0) + 8.0;
                let mut accum = 0.0;
                for (i, seg) in playlist.segments.iter().enumerate() {
                    accum += seg.duration_secs.max(5.0);
                    if accum >= target_sec {
                        initial_count = (i + 1).max(2).min(playlist.segments.len());
                        break;
                    }
                }
            }

            let license_url = manifest
                .key_server_url
                .clone()
                .unwrap_or_else(|| {
                    "https://play.itunes.apple.com/WebObjects/MZPlay.woa/wa/acquireWebPlaybackLicense"
                        .to_string()
                });

            // Run Widevine license negotiation concurrently with downloading init + initial segments!
            let has_inline_pssh = !playlist.widevine_pssh_bytes.is_empty();
            let (dl_res, lic_res) = std::thread::scope(|s| {
                let playlist_ref = &playlist;
                let dl_handle = s.spawn(move || -> Result<((Vec<u8>, TrackEncryptionInfo), Vec<Vec<u8>>)> {
                    let init_and_tenc = fetch_hls_init_and_tenc(playlist_ref)?;
                    let segs = download_hls_segment_slice(&playlist_ref.segments[..initial_count])?;
                    Ok((init_and_tenc, segs))
                });

                let lic_handle = if has_inline_pssh {
                    let lib_path = cdm_lib.library_path.clone();
                    let lic_url = license_url.clone();
                    let d_tok = dev_token.clone();
                    let u_tok = user_token.clone();
                    let s_id = manifest.song_id.clone();
                    let pl_clone = playlist.clone();
                    let pssh_clone = playlist.widevine_pssh_bytes.clone();
                    Some(s.spawn(move || -> Result<()> {
                        with_persistent_cdm_session(&lib_path, move |cdm| {
                            cdm.negotiate_apple_license(
                                &lic_url,
                                &d_tok,
                                &u_tok,
                                &s_id,
                                &pl_clone,
                                &pssh_clone,
                            )
                        })
                    }))
                } else {
                    None
                };

                let dl = dl_handle
                    .join()
                    .map_err(|_| anyhow!("Segment download thread panicked"))?;
                let lic = match lic_handle {
                    Some(h) => Some(
                        h.join()
                            .map_err(|_| anyhow!("License negotiation thread panicked"))?,
                    ),
                    None => None,
                };
                Ok::<_, anyhow::Error>((dl, lic))
            })
            .unwrap_or_else(|e| (Err(e), None));

            if active_epoch.load(Ordering::SeqCst) != epoch {
                mark_aborted(&state);
                return;
            }

            let ((init_bytes, tenc), mut initial_segs) = match dl_res {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!("Initial segment download failed for {song_uri}: {e}");
                    mark_aborted(&state);
                    return;
                }
            };

            if let Some(lic_r) = lic_res {
                if let Err(e) = lic_r {
                    tracing::warn!("Widevine license negotiation failed for {song_uri}: {e}");
                    mark_aborted(&state);
                    return;
                }
            } else {
                let Some(pssh_bytes) = find_widevine_pssh_in_mp4(&init_bytes) else {
                    tracing::warn!("No Widevine PSSH found for {song_uri}");
                    mark_aborted(&state);
                    return;
                };
                let lib_path = cdm_lib.library_path.clone();
                let lic_url = license_url.clone();
                let d_tok = dev_token.clone();
                let u_tok = user_token.clone();
                let s_id = manifest.song_id.clone();
                let pl_clone = playlist.clone();
                if let Err(e) = with_persistent_cdm_session(&lib_path, move |cdm| {
                    cdm.negotiate_apple_license(&lic_url, &d_tok, &u_tok, &s_id, &pl_clone, &pssh_bytes)
                }) {
                    tracing::warn!("Widevine license negotiation failed for {song_uri}: {e}");
                    mark_aborted(&state);
                    return;
                }
            }

            if active_epoch.load(Ordering::SeqCst) != epoch {
                mark_aborted(&state);
                return;
            }

            // Decrypt initial segments on the dedicated CDM thread
            let tenc_clone = tenc.clone();
            let decrypted_initial = match with_persistent_cdm_session(
                &cdm_lib.library_path,
                move |cdm| {
                    for seg in &mut initial_segs {
                        cdm.decrypt_fmp4_media_segment_in_place(seg, &tenc_clone)?;
                    }
                    Ok(initial_segs)
                },
            ) {
                Ok(segs) => segs,
                Err(e) => {
                    tracing::warn!("Failed to decrypt initial segments for {song_uri}: {e}");
                    mark_aborted(&state);
                    return;
                }
            };

            let clear_init = rewrite_init_segment_enca_to_clear(&init_bytes);
            let mut all_decrypted_segs = Vec::with_capacity(playlist.segments.len());
            all_decrypted_segs.extend(decrypted_initial);

            let (initial_pcm, _, _) =
                match decode_clear_init_and_segments_to_pcm(&clear_init, &all_decrypted_segs) {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!("Failed to decode initial fMP4 segments for {song_uri}: {e}");
                        mark_aborted(&state);
                        return;
                    }
                };

            let mut decoded_pcm_len = initial_pcm.len();
            let is_already_complete = initial_count >= playlist.segments.len();
            if let Ok(mut g) = state.lock() {
                g.samples = initial_pcm;
                if is_already_complete {
                    g.is_complete = true;
                }
            }

            // Start the progress clock at the exact instant the first audio samples begin playing!
            if active_epoch.load(Ordering::SeqCst) == epoch {
                if let Ok(mut tr) = tracker.lock() {
                    tr.reset();
                    tr.seek(start_pos_ms);
                    if !user_paused_flag.load(Ordering::SeqCst) {
                        tr.play();
                    }
                }
            }

            if is_already_complete {
                return;
            }

            // Phase 2: Stream & decrypt remaining segments in batches of 5 (~50s of audio per batch)
            let mut idx = initial_count;
            let batch_size = 5usize;
            while idx < playlist.segments.len() {
                if active_epoch.load(Ordering::SeqCst) != epoch {
                    mark_aborted(&state);
                    return;
                }

                let end_idx = (idx + batch_size).min(playlist.segments.len());
                let mut batch_segs =
                    match download_hls_segment_slice(&playlist.segments[idx..end_idx]) {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::warn!(
                                "Background segment batch {idx}..{end_idx} download failed: {e}"
                            );
                            break;
                        }
                    };

                if active_epoch.load(Ordering::SeqCst) != epoch {
                    mark_aborted(&state);
                    return;
                }

                let tenc_batch = tenc.clone();
                let dec_batch = match with_persistent_cdm_session(
                    &cdm_lib.library_path,
                    move |cdm| {
                        for seg in &mut batch_segs {
                            cdm.decrypt_fmp4_media_segment_in_place(seg, &tenc_batch)?;
                        }
                        Ok(batch_segs)
                    },
                ) {
                    Ok(s) => s,
                    Err(e) => {
                        tracing::warn!("Background segment batch decrypt failed: {e}");
                        break;
                    }
                };

                all_decrypted_segs.extend(dec_batch);
                if let Ok((full_pcm, _, _)) =
                    decode_clear_init_and_segments_to_pcm(&clear_init, &all_decrypted_segs)
                {
                    if full_pcm.len() > decoded_pcm_len {
                        if let Ok(mut g) = state.lock() {
                            g.samples.extend_from_slice(&full_pcm[decoded_pcm_len..]);
                        }
                        decoded_pcm_len = full_pcm.len();
                    }
                }

                idx = end_idx;
            }

            if let Ok(mut g) = state.lock() {
                g.is_complete = true;
            }
        })
        .context("Failed to spawn progressive Apple Music stream worker")?;

    Ok(source)
}

/// Stage 3 + Stage 4 End-to-End Native Rust Apple Music Stream Loader:
/// 1. Resolves Developer JWT + `Music-User-Token`
/// 2. Queries `webPlayback` for the `28:ctrp256` HLS playlist and Widevine license server URL
/// 3. Fetches the `.m3u8` media playlist and `EXT-X-MAP` initialization segment
/// 4. Uses the persistent `WidevineCdmSession` on `"simp-widevine-cdm"` to negotiate the CKC license
/// 5. Downloads and decrypts the HLS media segments in memory, returning a `DecryptedFmp4RodioSource`
///    ready to append directly into `LocalAudioEngine`'s `rodio::Sink`!
pub fn load_native_apple_music_rodio_source(
    settings: &SimpSettings,
    song_uri: &str,
    max_segments: Option<usize>,
) -> Result<DecryptedFmp4RodioSource> {
    let cdm_lib = discover_widevine_cdm_library().ok_or_else(|| {
        anyhow!("No local libwidevinecdm.so found for zero-browser native playback")
    })?;

    let creds = AppleMusicSink::resolve_credentials(settings);
    let dev_token = AppleMusicSink::get_or_sign_developer_token(settings)?;
    let user_token = creds
        .music_user_token
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| anyhow!("Apple Music user token is not configured"))?;

    let manifest = fetch_web_playback_manifest(settings, song_uri)?;
    let license_url = manifest
        .key_server_url
        .clone()
        .unwrap_or_else(|| {
            "https://play.itunes.apple.com/WebObjects/MZPlay.woa/wa/acquireWebPlaybackLicense"
                .to_string()
        });

    let playlist = fetch_and_parse_apple_hls(&manifest.hls_playlist_url)?;
    let (init_bytes, tenc) = fetch_hls_init_and_tenc(&playlist)?;

    let pssh_bytes = if !playlist.widevine_pssh_bytes.is_empty() {
        playlist.widevine_pssh_bytes.clone()
    } else {
        find_widevine_pssh_in_mp4(&init_bytes)
            .ok_or_else(|| anyhow!("No Widevine PSSH box found in HLS playlist or init segment"))?
    };

    let limit = max_segments
        .unwrap_or(playlist.segments.len())
        .min(playlist.segments.len());
    let mut raw_segments = download_hls_segment_slice(&playlist.segments[..limit])?;

    let song_id = manifest.song_id.clone();
    let playlist_clone = playlist.clone();
    let tenc_clone = tenc.clone();
    let decrypted_segments = with_persistent_cdm_session(&cdm_lib.library_path, move |cdm| {
        cdm.negotiate_apple_license(
            &license_url,
            &dev_token,
            &user_token,
            &song_id,
            &playlist_clone,
            &pssh_bytes,
        )?;
        for seg in &mut raw_segments {
            cdm.decrypt_fmp4_media_segment_in_place(seg, &tenc_clone)?;
        }
        Ok(raw_segments)
    })?;

    let clear_init = rewrite_init_segment_enca_to_clear(&init_bytes);
    DecryptedFmp4RodioSource::from_clear_init_and_decrypted_segments(
        &clear_init,
        &decrypted_segments,
    )
}

/// Runs the `libwidevinecdm.so` FFI handshake in an isolated child process (`simp --cdm-worker-test <song_id>`)
/// so that if a closed-source `libwidevinecdm.so` triggers `SIGILL` or `SIGSEGV` due to VMP host checks,
/// the parent `simp` / `simp --daemon` process never crashes and captures the exact step where it stopped!
pub fn run_isolated_cdm_probe_subprocess(
    lib_path: &std::path::Path,
    source_label: &str,
    song_id: &str,
) -> String {
    let Ok(exe) = std::env::current_exe() else {
        return "ERR: Could not determine current_exe for isolated CDM worker".to_string();
    };
    let out = std::process::Command::new(exe)
        .arg("--cdm-worker-test")
        .arg(song_id)
        .env("SIMP_WIDEVINE_CDM_PATH", lib_path)
        .env("SIMP_CDM_TRACE", "1")
        .output();

    match out {
        Ok(res) => {
            let stdout = String::from_utf8_lossy(&res.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&res.stderr).trim().to_string();
            if res.status.success() {
                stdout
            } else {
                format!(
                    "ERR (source={source_label}, exit={:?}): stdout=[{stdout}] stderr=[{stderr}]",
                    res.status.code()
                )
            }
        }
        Err(e) => format!("ERR spawning isolated CDM worker: {e}"),
    }
}


