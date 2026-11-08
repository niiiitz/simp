#[cfg(target_os = "linux")]
use crate::library::artwork::resolve_and_cache_artwork;
use crate::orchestrator::OrchestratorSnapshot;
#[cfg(target_os = "linux")]
use simp_protocol::RepeatMode;
use simp_protocol::{AudioCommand, TrackMetadata};
#[cfg(not(target_os = "windows"))]
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

pub struct MprisHandle;

/// Discovers `DISPLAY`, `WAYLAND_DISPLAY`, and `XAUTHORITY` from `systemctl --user show-environment`
/// if the background daemon was started before the KDE Plasma desktop session initialized them.
pub fn apply_desktop_display_env(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        let _ = cmd;
        return;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut has_display = std::env::var("DISPLAY").map(|v| !v.is_empty()).unwrap_or(false);
        let mut has_wayland = std::env::var("WAYLAND_DISPLAY")
            .map(|v| !v.is_empty())
            .unwrap_or(false);

        if let Ok(out) = Command::new("systemctl")
            .args(["--user", "show-environment"])
            .output()
        {
            if let Ok(text) = String::from_utf8(out.stdout) {
                for line in text.lines() {
                    if let Some((k, v)) = line.split_once('=') {
                        match k {
                            "DISPLAY" | "WAYLAND_DISPLAY" | "XAUTHORITY" | "XDG_CURRENT_DESKTOP"
                            | "XDG_SESSION_TYPE" | "KDE_FULL_SESSION" => {
                                if k == "DISPLAY" && !v.is_empty() {
                                    has_display = true;
                                }
                                if k == "WAYLAND_DISPLAY" && !v.is_empty() {
                                    has_wayland = true;
                                }
                                cmd.env(k, v);
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        if !has_display && Path::new("/tmp/.X11-unix/X0").exists() {
            cmd.env("DISPLAY", ":0");
        }
        if !has_wayland {
            let runtime_dir =
                std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/run/user/1000".to_string());
            if Path::new(&format!("{runtime_dir}/wayland-0")).exists() {
                cmd.env("WAYLAND_DISPLAY", "wayland-0");
            }
        }
    }
}

static NATIVE_WINDOW_RAISER: std::sync::OnceLock<Box<dyn Fn() + Send + Sync + 'static>> =
    std::sync::OnceLock::new();
static INPROCESS_CMD_TX: std::sync::OnceLock<mpsc::UnboundedSender<AudioCommand>> =
    std::sync::OnceLock::new();
static INPROCESS_STATE: std::sync::OnceLock<Arc<Mutex<OrchestratorSnapshot>>> =
    std::sync::OnceLock::new();

/// Registers an in-process callback to raise/show the native desktop window (used by `SIMP.app` on macOS).
pub fn set_native_window_raiser<F: Fn() + Send + Sync + 'static>(f: F) {
    let _ = NATIVE_WINDOW_RAISER.set(Box::new(f));
}

/// Sends an `AudioCommand` directly to the in-process `AudioOrchestrator` if running in the same process.
pub fn send_inprocess_audio_command(cmd: AudioCommand) -> bool {
    if let Some(tx) = INPROCESS_CMD_TX.get() {
        return tx.send(cmd).is_ok();
    }
    false
}

/// Returns a formatted `"🎵 Title — Artist"` summary and `is_playing` flag from the in-process `OrchestratorSnapshot`.
pub fn current_now_playing_summary() -> Option<(String, bool)> {
    let state = INPROCESS_STATE.get()?;
    let st = state.lock().ok()?;
    if let Some(ref t) = st.current_track {
        let artist = t
            .artists
            .first()
            .map(|s| s.as_str())
            .unwrap_or("Unknown Artist");
        let icon = if st.is_playing { "🎵" } else { "⏸" };
        Some((format!("{icon} {} — {artist}", t.title), st.is_playing))
    } else {
        Some(("🎵 SIMP — Idle".to_string(), st.is_playing))
    }
}

/// Raises an existing `org.simp.player` window or launches the SIMP Desktop Application via
/// `org.simp.player.desktop` (Linux) or `simp` / `simp.exe` (macOS / Windows).
pub fn launch_simp_desktop_window() {
    if let Some(raiser) = NATIVE_WINDOW_RAISER.get() {
        raiser();
        return;
    }

    #[cfg(target_os = "windows")]
    {
        if crate::focus_existing_windows_ui_window() {
            return;
        }
        static LAST_LAUNCH: std::sync::OnceLock<std::sync::Mutex<std::time::Instant>> =
            std::sync::OnceLock::new();
        let now = std::time::Instant::now();
        let mutex = LAST_LAUNCH.get_or_init(|| {
            std::sync::Mutex::new(now - std::time::Duration::from_secs(10))
        });
        if let Ok(mut last) = mutex.lock() {
            if now.duration_since(*last) < std::time::Duration::from_millis(2000) {
                return;
            }
            *last = now;
        }
        if let Ok(exe) = std::env::current_exe() {
            let mut cmd = Command::new(exe);
            cmd.stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            crate::configure_background_command(&mut cmd);
            let _ = cmd.spawn();
        }
        return;
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(exe) = std::env::current_exe() {
            let mut cmd = Command::new(exe);
            cmd.stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            crate::configure_background_command(&mut cmd);
            let _ = cmd.spawn();
        }
        return;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        // 1. If an `org.simp.player` window is already open on X11/XWayland, raise/activate it immediately
        let mut wmctrl = Command::new("wmctrl");
        wmctrl
            .args(["-xa", "org.simp.player"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        apply_desktop_display_env(&mut wmctrl);
        if wmctrl.status().map(|s| s.success()).unwrap_or(false) {
            return;
        }

        // 2. Prefer `gtk-launch org.simp.player.desktop` so KDE Plasma / KWin tags the application scope
        // with `org.simp.player.desktop` (preserving the SIMP Portal Icon on the taskbar in Wayland & X11).
        let mut gtk_cmd = Command::new("gtk-launch");
        gtk_cmd
            .arg("org.simp.player.desktop")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        apply_desktop_display_env(&mut gtk_cmd);
        if gtk_cmd.spawn().is_ok() {
            return;
        }

        // 3. Fallback: invoke `simp` binary directly with desktop display env
        if let Ok(exe) = std::env::current_exe() {
            let mut cmd = Command::new(exe);
            cmd.stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            apply_desktop_display_env(&mut cmd);
            let _ = cmd.spawn();
        }
    }
}

/// Initializes the OS media controls bridge (`MPRIS2` D-Bus on Linux, `MPNowPlayingInfoCenter` via `souvlaki` on macOS).
pub fn initialize_mpris(
    state: Arc<Mutex<OrchestratorSnapshot>>,
    cmd_tx: mpsc::UnboundedSender<AudioCommand>,
) -> Option<MprisHandle> {
    let _ = INPROCESS_STATE.set(state.clone());
    let _ = INPROCESS_CMD_TX.set(cmd_tx.clone());

    #[cfg(target_os = "linux")]
    {
        let _ = std::thread::Builder::new()
            .name("simp-mpris2-dbus".to_string())
            .spawn(move || {
                linux_mpris::run_mpris_loop(state, cmd_tx);
            });
        Some(MprisHandle)
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::thread::Builder::new()
            .name("simp-macos-nowplaying".to_string())
            .spawn(move || {
                macos_mpris::run_macos_now_playing_loop(state, cmd_tx);
            });
        Some(MprisHandle)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = (state, cmd_tx);
        None
    }
}

#[cfg(target_os = "macos")]
mod macos_mpris {
    use super::*;
    use souvlaki::{
        MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition,
        PlatformConfig, SeekDirection,
    };
    use std::time::Duration;

    fn normalize_cover_url(raw: Option<&str>) -> Option<String> {
        let s = raw?.trim();
        if s.is_empty() {
            return None;
        }
        if s.starts_with('/') {
            Some(format!("http://127.0.0.1:18888{s}"))
        } else {
            Some(s.to_string())
        }
    }

    pub fn run_macos_now_playing_loop(
        state: Arc<Mutex<OrchestratorSnapshot>>,
        cmd_tx: mpsc::UnboundedSender<AudioCommand>,
    ) {
        // Attach MPRemoteCommandCenter on the main dispatch queue so macOS registers media keys cleanly
        let tx_attach = cmd_tx.clone();
        dispatch::Queue::main().exec_async(move || {
            if let Ok(mut controls) = MediaControls::new(PlatformConfig {
                dbus_name: "org.simp.player",
                display_name: "SIMP",
                hwnd: None,
            }) {
                let _ = controls.attach(move |event: MediaControlEvent| match event {
                    MediaControlEvent::Play => {
                        let _ = tx_attach.send(AudioCommand::Play);
                    }
                    MediaControlEvent::Pause | MediaControlEvent::Stop => {
                        let _ = tx_attach.send(AudioCommand::Pause);
                    }
                    MediaControlEvent::Toggle => {
                        let _ = tx_attach.send(AudioCommand::TogglePlayPause);
                    }
                    MediaControlEvent::Next => {
                        let _ = tx_attach.send(AudioCommand::Next);
                    }
                    MediaControlEvent::Previous => {
                        let _ = tx_attach.send(AudioCommand::Previous);
                    }
                    MediaControlEvent::SetPosition(MediaPosition(pos)) => {
                        let _ = tx_attach.send(AudioCommand::Seek {
                            position_ms: pos.as_millis() as u32,
                        });
                    }
                    MediaControlEvent::Seek(dir) => {
                        if let Some(st) = INPROCESS_STATE.get().and_then(|s| s.lock().ok()) {
                            let cur = st.position_ms as i64;
                            let next_pos = match dir {
                                SeekDirection::Forward => (cur + 10_000).max(0) as u32,
                                SeekDirection::Backward => (cur - 10_000).max(0) as u32,
                            };
                            let _ = tx_attach.send(AudioCommand::Seek {
                                position_ms: next_pos,
                            });
                        }
                    }
                    MediaControlEvent::Raise => {
                        launch_simp_desktop_window();
                    }
                    _ => {}
                });
                // Keep `controls` alive for the lifetime of the process
                std::mem::forget(controls);
            }
        });

        let mut last_meta_sig = String::new();
        let mut last_play_sig = String::new();

        loop {
            std::thread::sleep(Duration::from_millis(450));

            let (current_track, is_playing, position_ms) = {
                let Ok(st) = state.lock() else {
                    continue;
                };
                (st.current_track.clone(), st.is_playing, st.position_ms)
            };

            let meta_sig = if let Some(ref t) = current_track {
                format!(
                    "{}|{}|{}|{}|{}",
                    t.uri,
                    t.title,
                    t.artists.join(","),
                    t.album,
                    t.art_url.as_deref().unwrap_or("")
                )
            } else {
                String::new()
            };

            let play_bucket = position_ms / 2000;
            let play_sig = format!("{}|{}|{}", meta_sig, is_playing, play_bucket);

            if meta_sig != last_meta_sig {
                last_meta_sig = meta_sig.clone();
                if let Some(track) = current_track.clone() {
                    let cover = normalize_cover_url(track.art_url.as_deref());
                    dispatch::Queue::main().exec_async(move || {
                        if let Ok(mut controls) = MediaControls::new(PlatformConfig {
                            dbus_name: "org.simp.player",
                            display_name: "SIMP",
                            hwnd: None,
                        }) {
                            let artist = if track.artists.is_empty() {
                                None
                            } else {
                                Some(track.artists.join(", "))
                            };
                            let album = if track.album.is_empty() {
                                None
                            } else {
                                Some(track.album.as_str())
                            };
                            let duration = if track.duration_ms > 0 {
                                Some(Duration::from_millis(track.duration_ms as u64))
                            } else {
                                None
                            };
                            let _ = controls.set_metadata(MediaMetadata {
                                title: Some(track.title.as_str()),
                                artist: artist.as_deref(),
                                album,
                                duration,
                                cover_url: cover.as_deref(),
                            });
                        }
                    });
                }
            }

            if play_sig != last_play_sig {
                last_play_sig = play_sig;
                let has_track = current_track.is_some();
                dispatch::Queue::main().exec_async(move || {
                    if let Ok(mut controls) = MediaControls::new(PlatformConfig {
                        dbus_name: "org.simp.player",
                        display_name: "SIMP",
                        hwnd: None,
                    }) {
                        let progress = Some(MediaPosition(Duration::from_millis(position_ms as u64)));
                        let pb = if !has_track {
                            MediaPlayback::Stopped
                        } else if is_playing {
                            MediaPlayback::Playing { progress }
                        } else {
                            MediaPlayback::Paused { progress }
                        };
                        let _ = controls.set_playback(pb);
                    }
                });
            }
        }
    }
}

pub fn update_mpris_metadata(_controls: &mut Option<MprisHandle>, _meta: &TrackMetadata) {
    // State updates are observed directly from `OrchestratorSnapshot` by `simp-mpris2-dbus`
}

pub fn update_mpris_playback(
    _controls: &mut Option<MprisHandle>,
    _is_playing: bool,
    _position_ms: u32,
) {
    // State updates are observed directly from `OrchestratorSnapshot` by `simp-mpris2-dbus`
}

#[cfg(target_os = "linux")]
mod linux_mpris {
    use super::*;
    use dbus::arg::{RefArg, Variant};
    use dbus::blocking::Connection;
    use dbus::channel::{MatchingReceiver, Sender};
    use dbus::Message;
    use dbus_crossroads::{Crossroads, IfaceBuilder};
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    struct MprisContext {
        state: Arc<Mutex<OrchestratorSnapshot>>,
        cmd_tx: mpsc::UnboundedSender<AudioCommand>,
        default_icon_uri: String,
    }

    fn resolve_default_icon_uri() -> String {
        if let Ok(home) = std::env::var("HOME") {
            let candidates = [
                format!("{home}/.local/share/simp/ui/simp-icon-dark.png"),
                format!("{home}/.local/share/icons/hicolor/256x256/apps/org.simp.player.png"),
                format!("{home}/.local/share/icons/org.simp.player.png"),
            ];
            for c in candidates {
                if Path::new(&c).is_file() {
                    return format!("file://{c}");
                }
            }
        }
        "http://127.0.0.1:18888/simp-icon-dark.png".to_string()
    }

    fn build_metadata_map(
        st: &OrchestratorSnapshot,
        default_icon_uri: &str,
    ) -> HashMap<String, Variant<Box<dyn RefArg>>> {
        let mut map: HashMap<String, Variant<Box<dyn RefArg>>> = HashMap::new();
        map.insert(
            "mpris:trackid".to_string(),
            Variant(Box::new(dbus::Path::new("/org/simp/player/track/current").unwrap())
                as Box<dyn RefArg>),
        );

        if let Some(ref track) = st.current_track {
            let title = if track.title.is_empty() {
                "Unknown Track".to_string()
            } else {
                track.title.clone()
            };
            let album = track.album.clone();
            let artists = if track.artists.is_empty() {
                vec!["SIMP".to_string()]
            } else {
                track.artists.clone()
            };

            let cover_uri = if let Some(path_str) = track.uri.strip_prefix("file://") {
                resolve_and_cache_artwork(Path::new(path_str))
                    .map(|a| a.mpris_file_uri)
                    .or_else(|| track.art_url.clone())
            } else if let Some(ref url) = track.art_url {
                if url.starts_with('/') {
                    Some(format!("http://127.0.0.1:18888{url}"))
                } else {
                    Some(url.clone())
                }
            } else {
                None
            }
            .unwrap_or_else(|| default_icon_uri.to_string());

            map.insert(
                "xesam:title".to_string(),
                Variant(Box::new(title) as Box<dyn RefArg>),
            );
            map.insert(
                "xesam:album".to_string(),
                Variant(Box::new(album) as Box<dyn RefArg>),
            );
            map.insert(
                "xesam:artist".to_string(),
                Variant(Box::new(artists) as Box<dyn RefArg>),
            );
            map.insert(
                "mpris:artUrl".to_string(),
                Variant(Box::new(cover_uri) as Box<dyn RefArg>),
            );
            if track.duration_ms > 0 {
                let len_us = (track.duration_ms as i64) * 1000;
                map.insert(
                    "mpris:length".to_string(),
                    Variant(Box::new(len_us) as Box<dyn RefArg>),
                );
            }
        } else {
            map.insert(
                "xesam:title".to_string(),
                Variant(Box::new("SIMP Ready".to_string()) as Box<dyn RefArg>),
            );
            map.insert(
                "xesam:album".to_string(),
                Variant(
                    Box::new("Simple Integrated Media Player".to_string()) as Box<dyn RefArg>
                ),
            );
            map.insert(
                "xesam:artist".to_string(),
                Variant(
                    Box::new(vec!["Click to Open SIMP Window".to_string()]) as Box<dyn RefArg>
                ),
            );
            map.insert(
                "mpris:artUrl".to_string(),
                Variant(Box::new(default_icon_uri.to_string()) as Box<dyn RefArg>),
            );
        }

        map
    }

    fn playback_status_str(st: &OrchestratorSnapshot) -> String {
        if st.is_playing {
            "Playing".to_string()
        } else {
            // Keep "Paused" even when idle so KDE Plasma's Media Player system tray widget stays visible
            // and allows the user to click it (`Raise`) to open the SIMP window at any time.
            "Paused".to_string()
        }
    }

    fn loop_status_str(mode: RepeatMode) -> String {
        match mode {
            RepeatMode::Off => "None".to_string(),
            RepeatMode::Track => "Track".to_string(),
            RepeatMode::Queue => "Playlist".to_string(),
        }
    }

    fn parse_loop_status(val: &str) -> RepeatMode {
        match val {
            "Track" => RepeatMode::Track,
            "Playlist" => RepeatMode::Queue,
            _ => RepeatMode::Off,
        }
    }

    fn register_mpris_root(cr: &mut Crossroads) -> dbus_crossroads::IfaceToken<MprisContext> {
        cr.register("org.mpris.MediaPlayer2", |b: &mut IfaceBuilder<MprisContext>| {
            b.method("Raise", (), (), |_, _, ()| {
                launch_simp_desktop_window();
                Ok(())
            });
            b.method("Quit", (), (), |_, ctx, ()| {
                let _ = ctx.cmd_tx.send(AudioCommand::ShutdownDaemon);
                Ok(())
            });

            b.property("CanQuit").get(|_, _| Ok(true));
            b.property("Fullscreen").get(|_, _| Ok(false));
            b.property("CanSetFullscreen").get(|_, _| Ok(false));
            b.property("CanRaise").get(|_, _| Ok(true));
            b.property("HasTrackList").get(|_, _| Ok(false));
            b.property("Identity")
                .get(|_, _| Ok("SIMP".to_string()));
            b.property("DesktopEntry")
                .get(|_, _| Ok("org.simp.player".to_string()));
            b.property("SupportedUriSchemes").get(|_, _| {
                Ok(vec![
                    "file".to_string(),
                    "cdda".to_string(),
                    "applemusic".to_string(),
                    "http".to_string(),
                    "https".to_string(),
                ])
            });
            b.property("SupportedMimeTypes").get(|_, _| {
                Ok(vec![
                    "audio/mpeg".to_string(),
                    "audio/flac".to_string(),
                    "audio/ogg".to_string(),
                    "audio/wav".to_string(),
                    "audio/mp4".to_string(),
                ])
            });
        })
    }

    fn register_mpris_player(cr: &mut Crossroads) -> dbus_crossroads::IfaceToken<MprisContext> {
        cr.register(
            "org.mpris.MediaPlayer2.Player",
            |b: &mut IfaceBuilder<MprisContext>| {
                b.method("Next", (), (), |_, ctx, ()| {
                    let _ = ctx.cmd_tx.send(AudioCommand::Next);
                    Ok(())
                });
                b.method("Previous", (), (), |_, ctx, ()| {
                    let _ = ctx.cmd_tx.send(AudioCommand::Previous);
                    Ok(())
                });
                b.method("Pause", (), (), |_, ctx, ()| {
                    let _ = ctx.cmd_tx.send(AudioCommand::Pause);
                    Ok(())
                });
                b.method("PlayPause", (), (), |_, ctx, ()| {
                    let _ = ctx.cmd_tx.send(AudioCommand::TogglePlayPause);
                    Ok(())
                });
                b.method("Stop", (), (), |_, ctx, ()| {
                    let _ = ctx.cmd_tx.send(AudioCommand::Pause);
                    Ok(())
                });
                b.method("Play", (), (), |_, ctx, ()| {
                    let _ = ctx.cmd_tx.send(AudioCommand::Play);
                    Ok(())
                });
                b.method("Seek", ("Offset",), (), |_, ctx, (offset_us,): (i64,)| {
                    let delta_ms = (offset_us / 1000).clamp(i32::MIN as i64, i32::MAX as i64) as i32;
                    let _ = ctx.cmd_tx.send(AudioCommand::SeekRelative { delta_ms });
                    Ok(())
                });
                b.method(
                    "SetPosition",
                    ("TrackId", "Position"),
                    (),
                    |_, ctx, (_track_id, pos_us): (dbus::Path<'static>, i64)| {
                        let position_ms = (pos_us.max(0) / 1000) as u32;
                        let _ = ctx.cmd_tx.send(AudioCommand::Seek { position_ms });
                        Ok(())
                    },
                );
                b.method("OpenUri", ("Uri",), (), |_, ctx, (uri,): (String,)| {
                    if !uri.trim().is_empty() {
                        let _ = ctx.cmd_tx.send(AudioCommand::Load { uri });
                    }
                    Ok(())
                });

                b.property("PlaybackStatus").get(|_, ctx| {
                    let st = ctx.state.lock().unwrap();
                    Ok(playback_status_str(&st))
                });

                b.property("LoopStatus")
                    .get(|_, ctx| {
                        let st = ctx.state.lock().unwrap();
                        Ok(loop_status_str(st.repeat_mode))
                    })
                    .set(|_, ctx, val: String| {
                        let mode = parse_loop_status(&val);
                        let _ = ctx.cmd_tx.send(AudioCommand::SetRepeat { mode });
                        Ok(Some(val))
                    });

                b.property("Rate")
                    .get(|_, _| Ok(1.0f64))
                    .set(|_, _, _val: f64| Ok(Some(1.0f64)));

                b.property("Shuffle")
                    .get(|_, ctx| {
                        let st = ctx.state.lock().unwrap();
                        Ok(st.shuffle)
                    })
                    .set(|_, ctx, enabled: bool| {
                        let _ = ctx.cmd_tx.send(AudioCommand::SetShuffle { enabled });
                        Ok(Some(enabled))
                    });

                b.property("Metadata").get(|_, ctx| {
                    let st = ctx.state.lock().unwrap();
                    Ok(build_metadata_map(&st, &ctx.default_icon_uri))
                });

                b.property("Volume")
                    .get(|_, ctx| {
                        let st = ctx.state.lock().unwrap();
                        Ok(st.volume)
                    })
                    .set(|_, ctx, vol: f64| {
                        let clamped = vol.clamp(0.0, 1.0);
                        let _ = ctx.cmd_tx.send(AudioCommand::SetVolume { volume: clamped });
                        Ok(Some(clamped))
                    });

                b.property("Position").get(|_, ctx| {
                    let st = ctx.state.lock().unwrap();
                    Ok((st.position_ms as i64) * 1000)
                });

                b.property("MinimumRate").get(|_, _| Ok(1.0f64));
                b.property("MaximumRate").get(|_, _| Ok(1.0f64));
                b.property("CanGoNext").get(|_, _| Ok(true));
                b.property("CanGoPrevious").get(|_, _| Ok(true));
                b.property("CanPlay").get(|_, _| Ok(true));
                b.property("CanPause").get(|_, _| Ok(true));
                b.property("CanSeek").get(|_, _| Ok(true));
                b.property("CanControl").get(|_, _| Ok(true));
            },
        )
    }

    pub fn run_mpris_loop(
        state: Arc<Mutex<OrchestratorSnapshot>>,
        cmd_tx: mpsc::UnboundedSender<AudioCommand>,
    ) {
        let default_icon_uri = resolve_default_icon_uri();

        loop {
            let uid = unsafe { libc::getuid() };
            let bus_sock = format!("/run/user/{uid}/bus");
            if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none()
                && Path::new(&bus_sock).exists()
            {
                unsafe {
                    std::env::set_var("XDG_RUNTIME_DIR", format!("/run/user/{uid}"));
                    std::env::set_var(
                        "DBUS_SESSION_BUS_ADDRESS",
                        format!("unix:path={bus_sock}"),
                    );
                }
            }

            let conn = match Connection::new_session() {
                Ok(c) => c,
                Err(_) => {
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
            };

            let bus_name = "org.mpris.MediaPlayer2.simp";
            if conn.request_name(bus_name, false, true, false).is_err() {
                let fallback_name = format!("org.mpris.MediaPlayer2.simp.instance{}", std::process::id());
                if conn.request_name(&fallback_name, false, true, false).is_err() {
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
            }
            tracing::info!("MPRIS2 D-Bus service registered as {bus_name}");

            let mut cr = Crossroads::new();
            let root_token = register_mpris_root(&mut cr);
            let player_token = register_mpris_player(&mut cr);

            cr.insert(
                "/org/mpris/MediaPlayer2",
                &[root_token, player_token],
                MprisContext {
                    state: state.clone(),
                    cmd_tx: cmd_tx.clone(),
                    default_icon_uri: default_icon_uri.clone(),
                },
            );

            let cr_mutex = Arc::new(Mutex::new(cr));
            let cr_cb = cr_mutex.clone();
            conn.start_receive(
                dbus::message::MatchRule::new_method_call(),
                Box::new(move |msg, conn| {
                    if let Ok(mut guard) = cr_cb.lock() {
                        let _ = guard.handle_message(msg, conn);
                    }
                    true
                }),
            );

            let mut last_sig = String::new();
            let mut last_pos_ms: u32 = 0;
            let mut last_check = Instant::now();

            loop {
                if conn.process(Duration::from_millis(200)).is_err() {
                    break;
                }

                if last_check.elapsed() >= Duration::from_millis(250) {
                    last_check = Instant::now();
                    let (sig, pos_ms, props_changed) = {
                        let st = state.lock().unwrap();
                        let track_sig = st
                            .current_track
                            .as_ref()
                            .map(|t| {
                                format!(
                                    "{}|{}|{}|{}|{}",
                                    t.uri,
                                    t.title,
                                    t.album,
                                    t.duration_ms,
                                    t.art_url.as_deref().unwrap_or("")
                                )
                            })
                            .unwrap_or_default();
                        let sig = format!(
                            "{}|{}|{:.2}|{}|{:?}",
                            track_sig, st.is_playing, st.volume, st.shuffle, st.repeat_mode
                        );

                        let changed = if sig != last_sig {
                            let mut changed_props: HashMap<String, Variant<Box<dyn RefArg>>> =
                                HashMap::new();
                            changed_props.insert(
                                "PlaybackStatus".to_string(),
                                Variant(Box::new(playback_status_str(&st)) as Box<dyn RefArg>),
                            );
                            changed_props.insert(
                                "LoopStatus".to_string(),
                                Variant(
                                    Box::new(loop_status_str(st.repeat_mode)) as Box<dyn RefArg>
                                ),
                            );
                            changed_props.insert(
                                "Shuffle".to_string(),
                                Variant(Box::new(st.shuffle) as Box<dyn RefArg>),
                            );
                            changed_props.insert(
                                "Volume".to_string(),
                                Variant(Box::new(st.volume as f64) as Box<dyn RefArg>),
                            );
                            changed_props.insert(
                                "Metadata".to_string(),
                                Variant(
                                    Box::new(build_metadata_map(&st, &default_icon_uri))
                                        as Box<dyn RefArg>,
                                ),
                            );
                            Some(changed_props)
                        } else {
                            None
                        };
                        (sig, st.position_ms, changed)
                    };

                    if let Some(changed_props) = props_changed {
                        last_sig = sig;
                        let invalidated: Vec<String> = Vec::new();
                        let msg = Message::new_signal(
                            "/org/mpris/MediaPlayer2",
                            "org.freedesktop.DBus.Properties",
                            "PropertiesChanged",
                        )
                        .unwrap()
                        .append3(
                            "org.mpris.MediaPlayer2.Player",
                            changed_props,
                            invalidated,
                        );
                        let _ = conn.send(msg);
                    }

                    // Emit `Seeked` signal if position jumped significantly (e.g., user scrubbed or restarted track)
                    if pos_ms.abs_diff(last_pos_ms) > 2000 {
                        if let Ok(msg) = Message::new_signal(
                            "/org/mpris/MediaPlayer2",
                            "org.mpris.MediaPlayer2.Player",
                            "Seeked",
                        ) {
                            let _ = conn.send(msg.append1((pos_ms as i64) * 1000));
                        }
                    }
                    last_pos_ms = pos_ms;
                }
            }

            std::thread::sleep(Duration::from_secs(3));
        }
    }
}
