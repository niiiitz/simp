use std::time::{Duration, Instant};

/// Tracks elapsed playback position across play, pause, and seek operations
/// for synchronous audio decoders (`rodio`).
#[derive(Debug, Clone)]
pub struct LocalTimeTracker {
    start_instant: Option<Instant>,
    accumulated_time: Duration,
    last_paused_at: Option<Instant>,
}

impl Default for LocalTimeTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalTimeTracker {
    pub fn new() -> Self {
        Self {
            start_instant: None,
            accumulated_time: Duration::ZERO,
            last_paused_at: Some(Instant::now()),
        }
    }

    pub fn play(&mut self) {
        if self.start_instant.is_none() {
            self.start_instant = Some(Instant::now());
        }
        self.last_paused_at = None;
    }

    pub fn pause(&mut self) {
        if let Some(start) = self.start_instant.take() {
            self.accumulated_time += start.elapsed();
        }
        if self.last_paused_at.is_none() {
            self.last_paused_at = Some(Instant::now());
        }
    }

    pub fn reset(&mut self) {
        self.start_instant = None;
        self.accumulated_time = Duration::ZERO;
        self.last_paused_at = Some(Instant::now());
    }

    pub fn seek(&mut self, position_ms: u32) {
        self.accumulated_time = Duration::from_millis(position_ms as u64);
        if self.start_instant.is_some() {
            self.start_instant = Some(Instant::now());
        }
    }

    pub fn get_position_ms(&self) -> u32 {
        let mut total = self.accumulated_time;
        if let Some(start) = self.start_instant {
            total += start.elapsed();
        }
        total.as_millis() as u32
    }

    pub fn is_playing(&self) -> bool {
        self.start_instant.is_some()
    }

    /// Returns how long the tracker has been continuously paused (used for 60s PipeWire DSP idle suspend).
    pub fn paused_duration(&self) -> Option<Duration> {
        self.last_paused_at.map(|t| t.elapsed())
    }
}

