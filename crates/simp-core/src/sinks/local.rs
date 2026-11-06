use crate::time_tracker::LocalTimeTracker;
use anyhow::{anyhow, Context, Result};
use rodio::{
    source::{SeekError as RodioSeekError},
    OutputStream, OutputStreamHandle, Sink, Source,
};
use simp_protocol::PlaybackEvent;
use std::fs::File;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use symphonia::{
    core::{
        audio::{AudioBufferRef, SampleBuffer, SignalSpec},
        codecs::{Decoder as SymphDecoder, DecoderOptions, CODEC_TYPE_NULL},
        errors::Error as SymphError,
        formats::{FormatOptions, FormatReader, SeekMode, SeekTo},
        io::{MediaSource, MediaSourceStream},
        meta::MetadataOptions,
        probe::Hint,
        units::{self, Time},
    },
    default::{get_codecs, get_probe},
};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

/// Manages the `rodio` local audio output stream, seekable Symphonia decoder,
/// abortable 500ms progress monitor, and 60-second PipeWire DSP idle suspend.
pub struct LocalAudioEngine {
    _stream: Option<OutputStream>,
    stream_handle: Option<OutputStreamHandle>,
    sink: Option<Arc<Sink>>,
    current_uri: Option<String>,
    volume: f32,
    tracker: Arc<Mutex<LocalTimeTracker>>,
    active_epoch: Arc<AtomicU64>,
    user_paused: Arc<AtomicBool>,
    monitor_handle: Option<JoinHandle<()>>,
}

/// Maps a normalized linear UI volume (`0.0..=1.0`) to a perceptual PCM amplitude gain (`v³`)
/// matching the PipeWire / PulseAudio cubic audio taper (`-60 * log10(v)` dB).
#[inline]
pub fn perceptual_cubic_gain(normalized_vol: f64) -> f32 {
    let v = normalized_vol.clamp(0.0, 1.0) as f32;
    v * v * v
}

impl LocalAudioEngine {
    pub fn new() -> Self {
        Self {
            _stream: None,
            stream_handle: None,
            sink: None,
            current_uri: None,
            volume: perceptual_cubic_gain(0.80),
            tracker: Arc::new(Mutex::new(LocalTimeTracker::new())),
            active_epoch: Arc::new(AtomicU64::new(0)),
            user_paused: Arc::new(AtomicBool::new(false)),
            monitor_handle: None,
        }
    }

    fn ensure_stream(&mut self) -> Result<()> {
        if self._stream.is_some() && self.sink.is_some() {
            #[cfg(unix)]
            {
                // If WSLg PulseServer socket died while `_stream` was cached, drop stale stream and revive
                let wslg_pulse = Path::new("/mnt/wslg/PulseServer");
                if wslg_pulse.exists()
                    && std::os::unix::net::UnixStream::connect(wslg_pulse).is_err()
                {
                    tracing::warn!(
                        "WSLg PulseServer socket disconnected — releasing stale OutputStream and reviving PulseAudio"
                    );
                    self.sink = None;
                    self.stream_handle = None;
                    self._stream = None;
                }
            }
        }

        if self._stream.is_none() || self.sink.is_none() {
            ensure_wslg_alsa_pulse_bridge();
            let open_attempt = || -> Result<(OutputStream, OutputStreamHandle, Sink)> {
                let (stream, handle) = OutputStream::try_default().map_err(|e| {
                    anyhow!("Failed to open PipeWire/ALSA OutputStream: {e}")
                })?;
                let sink = Sink::try_new(&handle).context("Failed to create rodio Sink")?;
                Ok((stream, handle, sink))
            };

            let (stream, handle, sink) = match open_attempt() {
                Ok(v) => v,
                Err(_first_err) => {
                    // Retry once after forcing a WSLg / PipeWire / PulseAudio bridge check
                    ensure_wslg_alsa_pulse_bridge();
                    open_attempt().map_err(|e| {
                        tracing::error!("{e}");
                        e
                    })?
                }
            };

            sink.set_volume(self.volume);
            self._stream = Some(stream);
            self.stream_handle = Some(handle);
            self.sink = Some(Arc::new(sink));
            tracing::info!("Opened native PipeWire/ALSA audio OutputStream");
        }
        Ok(())
    }

    /// Releases the PipeWire OutputStream handle (used during sleep or after 60s paused
    /// so the Steam Deck audio DSP can enter deep sleep with 0.00% CPU usage).
    pub fn release_pipewire_stream(&mut self) {
        self.active_epoch.fetch_add(1, Ordering::SeqCst);
        self.abort_monitor();
        self.tracker.lock().unwrap().pause();
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.stream_handle = None;
        self._stream = None;
    }

    pub fn abort_monitor(&mut self) {
        if let Some(handle) = self.monitor_handle.take() {
            handle.abort();
        }
    }

    pub fn load_and_play(
        &mut self,
        uri: &str,
        start_pos_ms: u32,
        epoch: u64,
        event_tx: mpsc::UnboundedSender<PlaybackEvent>,
    ) -> Result<()> {
        self.active_epoch.store(epoch, Ordering::SeqCst);
        self.user_paused.store(false, Ordering::SeqCst);
        self.abort_monitor();
        self.ensure_stream()?;

        let sink = self.sink.as_ref().unwrap();
        sink.stop();

        let is_progressive_stream =
            uri.starts_with("applemusic:") || uri.starts_with("soundcloud:");
        if uri.starts_with("cdda://") {
            let source = crate::sinks::cdda::CddaTrackSource::open_uri(uri)
                .with_context(|| format!("Failed to open Audio CD track: {uri}"))?;
            sink.append(source);
        } else if uri.starts_with("applemusic:") {
            let settings = load_local_settings_vdf();
            let source =
                crate::sinks::apple_native::source::spawn_progressive_apple_music_rodio_source(
                    settings,
                    uri.to_string(),
                    None,
                    start_pos_ms,
                    epoch,
                    self.active_epoch.clone(),
                    self.tracker.clone(),
                    self.user_paused.clone(),
                )
                .with_context(|| format!("Failed to load native Apple Music stream: {uri}"))?;
            sink.append(source);
        } else if uri.starts_with("soundcloud:") {
            let settings = load_local_settings_vdf();
            let source =
                crate::sinks::soundcloud::spawn_progressive_soundcloud_rodio_source(
                    settings,
                    uri.to_string(),
                    None,
                    start_pos_ms,
                    epoch,
                    self.active_epoch.clone(),
                    self.tracker.clone(),
                    self.user_paused.clone(),
                )
                .with_context(|| format!("Failed to load native SoundCloud stream: {uri}"))?;
            sink.append(source);
        } else {
            let file_path_str = uri.strip_prefix("file://").unwrap_or(uri);
            let path = Path::new(file_path_str);
            let file = File::open(path)
                .with_context(|| format!("Failed to open audio file: {}", path.display()))?;

            // Build seekable Symphonia decoder directly over `std::fs::File` (so `byte_len()` returns
            // `Some(file_len)` for `.m4a` ISOMP4 files with trailing `moov` atoms and never panics)
            let source = SymphoniaFileSource::from_file(file, path)
                .with_context(|| format!("Failed to decode audio file: {}", path.display()))?;

            sink.append(source);
        }
        sink.set_volume(self.volume);

        {
            let mut tracker = self.tracker.lock().unwrap();
            tracker.reset();
            if start_pos_ms > 0 {
                if !is_progressive_stream {
                    let target = Duration::from_millis(start_pos_ms as u64);
                    let _ = sink.try_seek(target);
                }
                tracker.seek(start_pos_ms);
            }
            if !is_progressive_stream {
                tracker.play();
            }
        }

        sink.play();
        self.current_uri = Some(uri.to_string());

        self.monitor_handle = Some(spawn_rodio_monitor(
            sink.clone(),
            self.tracker.clone(),
            epoch,
            event_tx,
        ));

        Ok(())
    }

    pub fn play(
        &mut self,
        epoch: u64,
        event_tx: mpsc::UnboundedSender<PlaybackEvent>,
    ) -> Result<()> {
        self.user_paused.store(false, Ordering::SeqCst);
        // If PipeWire stream was idle-suspended while paused, transparently reload at saved position
        if self.sink.is_none() {
            if let Some(uri) = self.current_uri.clone() {
                let saved_pos = self.tracker.lock().unwrap().get_position_ms();
                return self.load_and_play(&uri, saved_pos, epoch, event_tx);
            }
        }
        if let Some(sink) = &self.sink {
            self.tracker.lock().unwrap().play();
            sink.play();
        }
        Ok(())
    }

    pub fn pause(&mut self) {
        self.user_paused.store(true, Ordering::SeqCst);
        self.tracker.lock().unwrap().pause();
        if let Some(sink) = &self.sink {
            sink.pause();
        }
    }

    /// Primes the local audio engine with a restored URI and millisecond position on daemon startup
    /// without opening a PipeWire/ALSA stream until `play()` is invoked.
    pub fn prime_restored_session(&mut self, uri: String, position_ms: u32) {
        self.current_uri = Some(uri);
        let mut tracker = self.tracker.lock().unwrap();
        tracker.reset();
        tracker.seek(position_ms);
        tracker.pause();
    }

    pub fn seek(
        &mut self,
        position_ms: u32,
        epoch: u64,
        event_tx: mpsc::UnboundedSender<PlaybackEvent>,
    ) -> Result<()> {
        // If stream is idle-suspended / restored-paused, just update the saved position
        if self.sink.is_none() && !self.tracker.lock().unwrap().is_playing() {
            self.tracker.lock().unwrap().seek(position_ms);
            return Ok(());
        }

        let target = Duration::from_millis(position_ms as u64);

        if let Some(sink) = &self.sink {
            // Approach 1: Native byte-level seek via Symphonia
            if sink.try_seek(target).is_ok() {
                self.tracker.lock().unwrap().seek(position_ms);
                return Ok(());
            }
        }

        // Approach 2: Rebuild source with .skip_duration() fallback
        if let Some(uri) = self.current_uri.clone() {
            self.abort_monitor();
            self.ensure_stream()?;
            let sink = self.sink.as_ref().unwrap();
            let was_playing = self.tracker.lock().unwrap().is_playing();
            sink.stop();

            if uri.starts_with("cdda://") {
                let mut source = crate::sinks::cdda::CddaTrackSource::open_uri(&uri)?;
                let _ = source.try_seek(target);
                sink.append(source);
            } else if uri.starts_with("applemusic:") {
                let settings = load_local_settings_vdf();
                let source =
                    crate::sinks::apple_native::source::spawn_progressive_apple_music_rodio_source(
                        settings,
                        uri.to_string(),
                        None,
                        position_ms,
                        epoch,
                        self.active_epoch.clone(),
                        self.tracker.clone(),
                        self.user_paused.clone(),
                    )?;
                sink.append(source);
            } else if uri.starts_with("soundcloud:") {
                let settings = load_local_settings_vdf();
                let source =
                    crate::sinks::soundcloud::spawn_progressive_soundcloud_rodio_source(
                        settings,
                        uri.to_string(),
                        None,
                        position_ms,
                        epoch,
                        self.active_epoch.clone(),
                        self.tracker.clone(),
                        self.user_paused.clone(),
                    )?;
                sink.append(source);
            } else {
                let file_path_str = uri.strip_prefix("file://").unwrap_or(&uri);
                let path = Path::new(file_path_str);
                let file = File::open(path)?;
                let source = SymphoniaFileSource::from_file(file, path)?;
                let skipped = source.skip_duration(target);
                sink.append(skipped);
            }
            if was_playing {
                sink.play();
            } else {
                sink.pause();
            }
            self.tracker.lock().unwrap().seek(position_ms);

            self.monitor_handle = Some(spawn_rodio_monitor(
                sink.clone(),
                self.tracker.clone(),
                epoch,
                event_tx,
            ));
        }

        Ok(())
    }

    pub fn set_volume(&mut self, normalized_vol: f64) {
        self.volume = perceptual_cubic_gain(normalized_vol);
        if let Some(sink) = &self.sink {
            sink.set_volume(self.volume);
        }
    }

    pub fn get_position_ms(&self) -> u32 {
        self.tracker.lock().unwrap().get_position_ms()
    }

    pub fn is_playing(&self) -> bool {
        self.tracker.lock().unwrap().is_playing()
    }

    /// Checks if the sink has been paused for > 60 seconds and releases the PipeWire handle if so.
    pub fn check_idle_suspend(&mut self) {
        let should_suspend = self
            .tracker
            .lock()
            .unwrap()
            .paused_duration()
            .map(|d| d >= Duration::from_secs(60))
            .unwrap_or(false);
        if should_suspend && self._stream.is_some() {
            tracing::info!("Local sink paused > 60s — releasing PipeWire stream for 0% CPU idle");
            self.release_pipewire_stream();
        }
    }
}

impl crate::sinks::AudioSink for LocalAudioEngine {
    fn engine_kind(&self) -> simp_protocol::ActiveEngine {
        simp_protocol::ActiveEngine::Local
    }

    fn supports_uri(&self, uri: &str) -> bool {
        !uri.starts_with("applemusic:") && !uri.starts_with("soundcloud:")
    }

    fn load_and_play_track(
        &mut self,
        uri: &str,
        start_pos_ms: u32,
        epoch: u64,
        internal_event_tx: &mpsc::UnboundedSender<PlaybackEvent>,
        _broadcast_tx: &tokio::sync::broadcast::Sender<PlaybackEvent>,
    ) -> Result<()> {
        if !uri.starts_with("cdda://") {
            let file_path = uri.strip_prefix("file://").unwrap_or(uri);
            if !Path::new(file_path).exists() {
                return Err(anyhow!("Offline/unplugged storage mount"));
            }
        }
        self.load_and_play(uri, start_pos_ms, epoch, internal_event_tx.clone())
    }

    fn resume_playback(
        &mut self,
        epoch: u64,
        internal_event_tx: &mpsc::UnboundedSender<PlaybackEvent>,
        _broadcast_tx: &tokio::sync::broadcast::Sender<PlaybackEvent>,
    ) -> Result<()> {
        self.play(epoch, internal_event_tx.clone())
    }

    fn pause_playback(&mut self, _broadcast_tx: &tokio::sync::broadcast::Sender<PlaybackEvent>) {
        self.pause();
    }

    fn suspend_sink(&mut self, _broadcast_tx: &tokio::sync::broadcast::Sender<PlaybackEvent>) {
        self.release_pipewire_stream();
    }

    fn seek_playback(
        &mut self,
        position_ms: u32,
        epoch: u64,
        internal_event_tx: &mpsc::UnboundedSender<PlaybackEvent>,
        _broadcast_tx: &tokio::sync::broadcast::Sender<PlaybackEvent>,
    ) -> Result<()> {
        self.seek(position_ms, epoch, internal_event_tx.clone())
    }

    fn sync_volume(
        &mut self,
        volume: f32,
        _broadcast_tx: &tokio::sync::broadcast::Sender<PlaybackEvent>,
    ) {
        self.set_volume(volume as f64);
    }

    fn live_position_ms(&self) -> Option<u32> {
        Some(self.get_position_ms())
    }
}

fn spawn_rodio_monitor(
    sink: Arc<Sink>,
    tracker: Arc<Mutex<LocalTimeTracker>>,
    epoch: u64,
    tx: mpsc::UnboundedSender<PlaybackEvent>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(500));
        loop {
            ticker.tick().await;

            if sink.empty() {
                let _ = tx.send(PlaybackEvent::EndOfTrack { epoch });
                break;
            }

            let (is_playing, position_ms) = {
                let guard = tracker.lock().unwrap();
                (guard.is_playing(), guard.get_position_ms())
            };

            if is_playing {
                let _ = tx.send(PlaybackEvent::ProgressTick { position_ms });
            }
        }
    })
}

/// Ensures PipeWire / PulseAudio / WSLg runtime environment variables are populated before opening ALSA,
/// and automatically revives WSLg's internal PulseAudio daemon if `/mnt/wslg/PulseServer` has crashed.
fn ensure_wslg_alsa_pulse_bridge() {
    #[cfg(unix)]
    {
        let wslg_pulse = Path::new("/mnt/wslg/PulseServer");
        let wslg_dir = Path::new("/mnt/wslg");
        if wslg_dir.is_dir() {
            let socket_alive = wslg_pulse.exists()
                && std::os::unix::net::UnixStream::connect(wslg_pulse).is_ok();
            if !socket_alive {
                revive_wslg_pulseaudio_daemon();
            }
        }

        let uid = unsafe { libc::getuid() };
        let run_user = format!("/run/user/{uid}");
        if Path::new(&run_user).is_dir() {
            if std::env::var_os("XDG_RUNTIME_DIR").is_none() {
                unsafe {
                    std::env::set_var("XDG_RUNTIME_DIR", &run_user);
                }
            }
            if std::env::var_os("PIPEWIRE_RUNTIME_DIR").is_none()
                && Path::new(&format!("{run_user}/pipewire-0")).exists()
            {
                unsafe {
                    std::env::set_var("PIPEWIRE_RUNTIME_DIR", &run_user);
                }
            }
            let user_pulse = format!("{run_user}/pulse/native");
            if Path::new(&user_pulse).exists()
                && std::os::unix::net::UnixStream::connect(&user_pulse).is_ok()
            {
                unsafe {
                    std::env::set_var("PULSE_SERVER", format!("unix:{user_pulse}"));
                }
            }
        }

        if wslg_pulse.exists() && std::os::unix::net::UnixStream::connect(wslg_pulse).is_ok() {
            unsafe {
                std::env::set_var("PULSE_SERVER", "unix:/mnt/wslg/PulseServer");
            }
            if let Some(home) = dirs::home_dir() {
                let asoundrc = home.join(".asoundrc");
                if !asoundrc.exists() {
                    let config =
                        "pcm.!default {\n    type pulse\n}\nctl.!default {\n    type pulse\n}\n";
                    let _ = std::fs::write(&asoundrc, config);
                }
            }
        }
    }
}

#[cfg(unix)]
fn revive_wslg_pulseaudio_daemon() {
    let wsl_exe = Path::new("/mnt/c/Windows/System32/wsl.exe");
    if !wsl_exe.is_file() {
        return;
    }
    tracing::warn!(
        "WSLg /mnt/wslg/PulseServer is not responding (Connection refused) — attempting automatic WSLg PulseAudio recovery..."
    );
    let script = "rm -f /mnt/wslg/PulseServer /mnt/wslg/runtime-dir/pulse/native /mnt/wslg/runtime-dir/pulse/pid; \
                  PULSE_AUDIO_RDP_SINK=/mnt/wslg/RDSink \
                  PULSE_AUDIO_RDP_SOURCE=/mnt/wslg/RDSource \
                  PULSE_RUNTIME_PATH=/mnt/wslg/runtime-dir/pulse \
                  /usr/bin/pulseaudio -D --exit-idle-time=-1 \
                  --load='module-rdp-sink sink_name=RDPSink' \
                  --load='module-rdp-source source_name=RDPSource' \
                  --load='module-native-protocol-unix socket=/mnt/wslg/PulseServer auth-anonymous=1' \
                  --log-target=file:/mnt/wslg/pulseaudio.log || true";
    let _ = std::process::Command::new(wsl_exe)
        .args(["--system", "-u", "wslg", "--", "sh", "-c", script])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    for _ in 0..10 {
        if std::os::unix::net::UnixStream::connect("/mnt/wslg/PulseServer").is_ok() {
            tracing::info!("WSLg PulseAudio server successfully revived at /mnt/wslg/PulseServer!");
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

const MAX_DECODE_RETRIES: usize = 5;

/// Panic-free Symphonia audio source backed directly by `std::fs::File` (which implements
/// `symphonia::core::io::MediaSource` with `byte_len() -> Some(file_len)`).
///
/// Unlike `rodio::Decoder::new(BufReader<File>)`—whose internal `ReadSeekSource` returns
/// `byte_len() -> None` and triggers a panic (`unreachable!("Seek errors should not occur during initialization")`)
/// whenever an `.m4a` (`isomp4`) file has its `moov` atom after `mdat`—`SymphoniaFileSource`
/// provides the exact file length to Symphonia's ISO/MP4 demuxer and filters packets by `track_id`.
pub struct SymphoniaFileSource {
    decoder: Box<dyn SymphDecoder>,
    current_frame_offset: usize,
    format: Box<dyn FormatReader>,
    track_id: u32,
    total_duration: Option<Time>,
    buffer: SampleBuffer<i16>,
    spec: SignalSpec,
}

impl SymphoniaFileSource {
    pub fn from_file(file: File, path: &Path) -> Result<Self> {
        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        // `std::fs::File` implements `MediaSource` with `is_seekable() == true` and `byte_len() == Some(len)`!
        let mss = MediaSourceStream::new(Box::new(file) as Box<dyn MediaSource>, Default::default());
        let format_opts = FormatOptions {
            enable_gapless: true,
            ..Default::default()
        };
        let metadata_opts = MetadataOptions::default();

        let mut probed = get_probe()
            .format(&hint, mss, &format_opts, &metadata_opts)
            .map_err(|e| anyhow!("Symphonia probe failed: {e}"))?;

        let track = probed
            .format
            .default_track()
            .filter(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .or_else(|| {
                probed
                    .format
                    .tracks()
                    .iter()
                    .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            })
            .ok_or_else(|| anyhow!("No supported audio track in container"))?;

        let track_id = track.id;
        let total_duration = track
            .codec_params
            .time_base
            .zip(track.codec_params.n_frames)
            .map(|(base, frames)| base.calc_time(frames));

        let mut decoder = get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| anyhow!("Unsupported audio codec: {e}"))?;

        let mut decode_errors = 0usize;
        let decoded = loop {
            let packet = match probed.format.next_packet() {
                Ok(p) => p,
                Err(SymphError::IoError(_)) => break decoder.last_decoded(),
                Err(e) => return Err(anyhow!("Failed reading initial audio packet: {e}")),
            };

            if packet.track_id() != track_id {
                continue;
            }

            match decoder.decode(&packet) {
                Ok(decoded) => break decoded,
                Err(SymphError::DecodeError(_)) if decode_errors < MAX_DECODE_RETRIES => {
                    decode_errors += 1;
                    continue;
                }
                Err(e) => return Err(anyhow!("Audio decode error on initial frame: {e}")),
            }
        };

        let spec = decoded.spec().to_owned();
        let buffer = Self::to_sample_buffer(decoded, &spec);

        Ok(Self {
            decoder,
            current_frame_offset: 0,
            format: probed.format,
            track_id,
            total_duration,
            buffer,
            spec,
        })
    }

    #[inline]
    fn to_sample_buffer(decoded: AudioBufferRef<'_>, spec: &SignalSpec) -> SampleBuffer<i16> {
        let duration = units::Duration::from(decoded.capacity() as u64);
        let mut buffer = SampleBuffer::<i16>::new(duration, *spec);
        buffer.copy_interleaved_ref(decoded);
        buffer
    }
}

impl Iterator for SymphoniaFileSource {
    type Item = i16;

    #[inline]
    fn next(&mut self) -> Option<i16> {
        while self.current_frame_offset >= self.buffer.len() {
            let mut decode_errors = 0usize;
            let decoded = loop {
                let packet = self.format.next_packet().ok()?;
                if packet.track_id() != self.track_id {
                    continue;
                }
                match self.decoder.decode(&packet) {
                    Ok(d) => break d,
                    Err(_) if decode_errors < MAX_DECODE_RETRIES => {
                        decode_errors += 1;
                        continue;
                    }
                    Err(_) => return None,
                }
            };
            decoded.spec().clone_into(&mut self.spec);
            self.buffer = Self::to_sample_buffer(decoded, &self.spec);
            self.current_frame_offset = 0;
        }

        let sample = *self.buffer.samples().get(self.current_frame_offset)?;
        self.current_frame_offset += 1;
        Some(sample)
    }
}

impl Source for SymphoniaFileSource {
    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        Some(self.buffer.samples().len())
    }

    #[inline]
    fn channels(&self) -> u16 {
        self.spec.channels.count() as u16
    }

    #[inline]
    fn sample_rate(&self) -> u32 {
        self.spec.rate
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        self.total_duration
            .map(|Time { seconds, frac }| Duration::from_secs_f64(seconds as f64 + frac))
    }

    fn try_seek(&mut self, pos: Duration) -> std::result::Result<(), RodioSeekError> {
        let channels = self.channels().max(1) as usize;
        let to_skip = self.current_frame_offset % channels;

        let target_time: Time = pos.as_secs_f64().into();
        let seek_res = self
            .format
            .seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    time: target_time,
                    track_id: Some(self.track_id),
                },
            )
            .map_err(|e| RodioSeekError::Other(Box::new(e)))?;

        let mut samples_to_pass = seek_res.required_ts.saturating_sub(seek_res.actual_ts);
        let packet = loop {
            let candidate = self
                .format
                .next_packet()
                .map_err(|e| RodioSeekError::Other(Box::new(e)))?;
            if candidate.track_id() != self.track_id {
                continue;
            }
            if candidate.dur() > samples_to_pass {
                break candidate;
            } else {
                samples_to_pass -= candidate.dur();
            }
        };

        let decoded = self
            .decoder
            .decode(&packet)
            .map_err(|e| RodioSeekError::Other(Box::new(e)))?;
        decoded.spec().clone_into(&mut self.spec);
        self.buffer = Self::to_sample_buffer(decoded, &self.spec);
        self.current_frame_offset = (samples_to_pass as usize * channels) + to_skip;
        Ok(())
    }
}

fn load_local_settings_vdf() -> simp_protocol::SimpSettings {
    let path = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("simp")
        .join("settings.vdf");
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(parsed) = keyvalues_serde::from_str::<simp_protocol::SimpSettings>(&text) {
            return parsed;
        }
    }
    simp_protocol::SimpSettings::default()
}



