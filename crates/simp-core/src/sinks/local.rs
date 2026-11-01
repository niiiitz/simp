use crate::time_tracker::LocalTimeTracker;
use anyhow::{Context, Result};
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use simp_protocol::PlaybackEvent;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
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
    monitor_handle: Option<JoinHandle<()>>,
}

impl LocalAudioEngine {
    pub fn new() -> Self {
        Self {
            _stream: None,
            stream_handle: None,
            sink: None,
            current_uri: None,
            volume: 0.80,
            tracker: Arc::new(Mutex::new(LocalTimeTracker::new())),
            monitor_handle: None,
        }
    }

    fn ensure_stream(&mut self) -> Result<()> {
        if self._stream.is_none() || self.sink.is_none() {
            ensure_wslg_alsa_pulse_bridge();
            let (stream, handle) =
                OutputStream::try_default().context("Failed to open PipeWire/ALSA OutputStream")?;
            let sink = Sink::try_new(&handle).context("Failed to create rodio Sink")?;
            sink.set_volume(self.volume);
            self._stream = Some(stream);
            self.stream_handle = Some(handle);
            self.sink = Some(Arc::new(sink));
        }
        Ok(())
    }

    /// Releases the PipeWire OutputStream handle (used during sleep or after 60s paused
    /// so the Steam Deck audio DSP can enter deep sleep with 0.00% CPU usage).
    pub fn release_pipewire_stream(&mut self) {
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
        self.abort_monitor();
        self.ensure_stream()?;

        let file_path_str = uri.strip_prefix("file://").unwrap_or(uri);
        let path = Path::new(file_path_str);
        let file = File::open(path)
            .with_context(|| format!("Failed to open audio file: {}", path.display()))?;

        let sink = self.sink.as_ref().unwrap();
        sink.stop();

        // Build seekable Symphonia-backed decoder (`BufReader<File>` implements `Read + Seek`)
        let source = Decoder::new(BufReader::new(file))
            .context("Failed to decode audio file via rodio/Symphonia")?;

        sink.append(source);
        sink.set_volume(self.volume);

        {
            let mut tracker = self.tracker.lock().unwrap();
            tracker.reset();
            if start_pos_ms > 0 {
                let target = Duration::from_millis(start_pos_ms as u64);
                let _ = sink.try_seek(target);
                tracker.seek(start_pos_ms);
            }
            tracker.play();
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
        self.tracker.lock().unwrap().pause();
        if let Some(sink) = &self.sink {
            sink.pause();
        }
    }

    pub fn seek(
        &mut self,
        position_ms: u32,
        epoch: u64,
        event_tx: mpsc::UnboundedSender<PlaybackEvent>,
    ) -> Result<()> {
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
            let file_path_str = uri.strip_prefix("file://").unwrap_or(&uri);
            let file = File::open(file_path_str)?;
            let source = Decoder::new(BufReader::new(file))?;
            let skipped = source.skip_duration(target);

            let sink = self.sink.as_ref().unwrap();
            let was_playing = self.tracker.lock().unwrap().is_playing();
            sink.stop();
            sink.append(skipped);
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
        self.volume = normalized_vol.clamp(0.0, 1.0) as f32;
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

/// When running inside WSL2 with WSLg (`/mnt/wslg/PulseServer`), routes ALSA's `default` PCM
/// to WSLg's PulseAudio bridge so `rodio` / `cpal` plays directly through the Windows soundcard.
fn ensure_wslg_alsa_pulse_bridge() {
    let wslg_pulse = Path::new("/mnt/wslg/PulseServer");
    if !wslg_pulse.exists() {
        return;
    }

    if std::env::var_os("PULSE_SERVER").is_none() {
        // SAFETY: Called on the single-threaded audio orchestrator thread before opening ALSA
        unsafe {
            std::env::set_var("PULSE_SERVER", "unix:/mnt/wslg/PulseServer");
        }
    }

    if let Some(home) = dirs::home_dir() {
        let asoundrc = home.join(".asoundrc");
        if !asoundrc.exists() {
            let config = "pcm.!default {\n    type pulse\n}\nctl.!default {\n    type pulse\n}\n";
            let _ = std::fs::write(&asoundrc, config);
        }
    }
}


