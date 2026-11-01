use crate::library::artwork::resolve_and_cache_artwork;
use simp_protocol::{AudioCommand, TrackMetadata};
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
};
use std::path::Path;
use std::time::Duration;
use tokio::sync::mpsc;

/// Initializes Linux D-Bus `MPRIS2` (`org.mpris.MediaPlayer2.org.simp.player`) via `souvlaki`.
/// Captures synchronous hardware button interrupts and forwards them into the async Orchestrator.
pub fn initialize_mpris(
    cmd_tx: mpsc::UnboundedSender<AudioCommand>,
) -> Option<MediaControls> {
    let config = PlatformConfig {
        dbus_name: "org.simp.player",
        display_name: "SIMP",
        hwnd: None,
    };

    let mut controls = match MediaControls::new(config) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Could not register MPRIS2 on D-Bus (headless/WSL session?): {e:?}");
            return None;
        }
    };

    if let Err(e) = controls.attach(move |event: MediaControlEvent| {
        match event {
            MediaControlEvent::Play => {
                let _ = cmd_tx.send(AudioCommand::Play);
            }
            MediaControlEvent::Pause | MediaControlEvent::Stop => {
                let _ = cmd_tx.send(AudioCommand::Pause);
            }
            MediaControlEvent::Toggle => {
                let _ = cmd_tx.send(AudioCommand::TogglePlayPause);
            }
            MediaControlEvent::Next => {
                let _ = cmd_tx.send(AudioCommand::Next);
            }
            MediaControlEvent::Previous => {
                let _ = cmd_tx.send(AudioCommand::Previous);
            }
            MediaControlEvent::SetVolume(vol) => {
                let _ = cmd_tx.send(AudioCommand::SetVolume { volume: vol });
            }
            MediaControlEvent::SetPosition(MediaPosition(pos)) => {
                let _ = cmd_tx.send(AudioCommand::Seek {
                    position_ms: pos.as_millis() as u32,
                });
            }
            _ => {}
        }
    }) {
        tracing::warn!("Failed to attach MPRIS2 event listener: {e:?}");
    }

    let _ = controls.set_playback(MediaPlayback::Stopped);
    Some(controls)
}

pub fn update_mpris_metadata(controls: &mut Option<MediaControls>, meta: &TrackMetadata) {
    let Some(ctrl) = controls.as_mut() else {
        return;
    };

    // For local files, ensure we pass a `file:///tmp/simp_art_{hash}` URI to souvlaki
    let mpris_cover_uri = if let Some(path_str) = meta.uri.strip_prefix("file://") {
        resolve_and_cache_artwork(Path::new(path_str))
            .map(|a| a.mpris_file_uri)
            .or_else(|| meta.art_url.clone())
    } else {
        meta.art_url.clone()
    };

    let artist_joined = meta.artists.join(", ");
    let _ = ctrl.set_metadata(MediaMetadata {
        title: Some(&meta.title),
        album: Some(&meta.album),
        artist: Some(&artist_joined),
        cover_url: mpris_cover_uri.as_deref(),
        duration: if meta.duration_ms > 0 {
            Some(Duration::from_millis(meta.duration_ms as u64))
        } else {
            None
        },
    });
}

pub fn update_mpris_playback(
    controls: &mut Option<MediaControls>,
    is_playing: bool,
    position_ms: u32,
) {
    let Some(ctrl) = controls.as_mut() else {
        return;
    };
    let progress = Some(MediaPosition(Duration::from_millis(position_ms as u64)));
    let state = if is_playing {
        MediaPlayback::Playing { progress }
    } else {
        MediaPlayback::Paused { progress }
    };
    let _ = ctrl.set_playback(state);
}

