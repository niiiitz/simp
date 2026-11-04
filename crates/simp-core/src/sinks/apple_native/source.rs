use crate::sinks::apple::AppleMusicSink;
use crate::sinks::apple_api::fetch_web_playback_manifest;
use crate::sinks::apple_native::{
    cdm_host::{discover_widevine_cdm_library, DiscoveredWidevineCdm, WidevineCdmSession},
    hls::{fetch_and_parse_apple_hls, fetch_hls_bytes, AppleHlsMediaPlaylist, HlsByteRange},
    mp4_cbcs::{
        decrypt_fmp4_media_segment_in_place, find_widevine_pssh_in_mp4, parse_init_segment_tenc,
        rewrite_init_segment_enca_to_clear, TrackEncryptionInfo,
    },
};
use anyhow::{anyhow, Context, Result};
use rodio::{source::SeekError as RodioSeekError, Source};
use serde::{Deserialize, Serialize};
use simp_protocol::SimpSettings;
use std::io::Cursor;
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

/// Decodes a decrypted fMP4 stream (`clear_init_segment` + one or more decrypted `moof+mdat` segments)
/// into interleaved `f32` PCM samples using `Symphonia` (`IsoMp4Reader` + `AacDecoder`), wrapped as a `rodio::Source`.
pub struct DecryptedFmp4RodioSource {
    samples: Vec<f32>,
    cursor: usize,
    channels: u16,
    sample_rate: u32,
}

impl DecryptedFmp4RodioSource {
    /// Concatenates the rewritten clear init segment (`enca` -> `mp4a`) with decrypted media segments
    /// and decodes the audio frames in memory via Symphonia.
    pub fn from_clear_init_and_decrypted_segments(
        clear_init_bytes: &[u8],
        decrypted_segments: &[Vec<u8>],
    ) -> Result<Self> {
        let total_len: usize =
            clear_init_bytes.len() + decrypted_segments.iter().map(|s| s.len()).sum::<usize>();
        let mut combined = Vec::with_capacity(total_len);
        combined.extend_from_slice(clear_init_bytes);
        for seg in decrypted_segments {
            combined.extend_from_slice(seg);
        }

        Self::from_fmp4_bytes(combined)
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

        Ok(Self {
            samples,
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
        let frames = self.samples.len() / (self.channels.max(1) as usize);
        frames as f64 / (self.sample_rate.max(1) as f64)
    }
}

impl Iterator for DecryptedFmp4RodioSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.cursor < self.samples.len() {
            let s = self.samples[self.cursor];
            self.cursor += 1;
            Some(s)
        } else {
            None
        }
    }
}

impl Source for DecryptedFmp4RodioSource {
    fn current_frame_len(&self) -> Option<usize> {
        Some(self.samples.len().saturating_sub(self.cursor))
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        let frames = self.samples.len() / (self.channels.max(1) as usize);
        Some(Duration::from_secs_f64(
            frames as f64 / (self.sample_rate.max(1) as f64),
        ))
    }

    fn try_seek(&mut self, pos: Duration) -> std::result::Result<(), RodioSeekError> {
        let ch = self.channels.max(1) as usize;
        let target_frame = (pos.as_secs_f64() * (self.sample_rate.max(1) as f64)).round() as usize;
        let target_sample_idx = (target_frame * ch).min(self.samples.len());
        self.cursor = target_sample_idx - (target_sample_idx % ch);
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

/// Stage 3 + Stage 4 End-to-End Native Rust Apple Music Stream Loader:
/// 1. Resolves Developer JWT + `Music-User-Token`
/// 2. Queries `webPlayback` for the `28:ctrp256` HLS playlist and Widevine license server URL
/// 3. Fetches the `.m3u8` media playlist and `EXT-X-MAP` initialization segment
/// 4. Opens `libwidevinecdm.so` via `WidevineCdmSession`, negotiates the CKC license for the track's PSSH
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
        .as_deref()
        .unwrap_or("https://play.itunes.apple.com/WebObjects/MZPlay.woa/wa/acquireWebPlaybackLicense");

    let playlist = fetch_and_parse_apple_hls(&manifest.hls_playlist_url)?;
    let (init_bytes, tenc) = fetch_hls_init_and_tenc(&playlist)?;

    let pssh_bytes = if !playlist.widevine_pssh_bytes.is_empty() {
        playlist.widevine_pssh_bytes.clone()
    } else {
        find_widevine_pssh_in_mp4(&init_bytes)
            .ok_or_else(|| anyhow!("No Widevine PSSH box found in HLS playlist or init segment"))?
    };

    let mut cdm = WidevineCdmSession::open(&cdm_lib.library_path)?;
    cdm.negotiate_apple_license(
        license_url,
        &dev_token,
        &user_token,
        &manifest.song_id,
        &playlist,
        &pssh_bytes,
    )?;

    let clear_init = rewrite_init_segment_enca_to_clear(&init_bytes);
    let limit = max_segments
        .unwrap_or(playlist.segments.len())
        .min(playlist.segments.len());
    let target_segments = &playlist.segments[..limit];
    let mut decrypted_segments = Vec::with_capacity(limit);

    // Optimization: Apple's `28:ctrp256` HLS playlists store all segments as contiguous
    // `#EXT-X-BYTERANGE` slices within a single `.mp4` asset. Coalescing them into a single
    // HTTP Range request avoids 15-25 separate TLS/curl round-trips and cuts load latency to < 1s!
    let mut bulk_downloaded: Option<(u64, Vec<u8>)> = None;
    if target_segments.len() > 1 {
        if let Some(first_seg) = target_segments.first() {
            let first_url = &first_seg.url;
            let all_same_url_with_br = target_segments
                .iter()
                .all(|s| s.url == *first_url && s.byte_range.map(|b| b.length > 0).unwrap_or(false));
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

    for seg in target_segments {
        let mut seg_bytes = if let (Some((base_offset, ref bulk)), Some(br)) =
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
        cdm.decrypt_fmp4_media_segment_in_place(&mut seg_bytes, &tenc)?;
        decrypted_segments.push(seg_bytes);
    }

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


