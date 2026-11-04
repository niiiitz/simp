use crate::orchestrator::OrchestratorSnapshot;
use simp_protocol::AudioCommand;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

/// Spawns a background KDE Plasma / FreeDesktop `StatusNotifierItem` (`org.kde.StatusNotifierItem`
/// + `com.canonical.dbusmenu`) system tray service over D-Bus on Linux.
///
/// Features in KDE Plasma / Bazzite Desktop Mode:
/// - **Left-Click (`Activate`)**: Opens or raises the SIMP Console window (`simp`).
/// - **Middle-Click (`SecondaryActivate`)**: Toggles Play / Pause (Silence).
/// - **Mouse Wheel (`Scroll`)**: Steps volume up or down by ±5%.
/// - **Hover Tooltip (`ToolTip`)**: Displays current track title, artist, album, and play/volume status.
/// - **Right-Click Context Menu (`/MenuBar`)**: Live Now Playing label, Play/Pause, Next, Previous,
///   Open SIMP Window, Restart Daemon, and Quit SIMP.
/// - **Dynamic Game Mode ↔ Desktop Mode Re-Registration**: If `simp --daemon` starts in `gamescope`
///   where `org.kde.StatusNotifierWatcher` is not running, the tray loop periodically checks and
///   registers as soon as KDE Plasma's `StatusNotifierWatcher` appears.
pub fn spawn_system_tray(
    state: Arc<Mutex<OrchestratorSnapshot>>,
    cmd_tx: mpsc::UnboundedSender<AudioCommand>,
) {
    // By default, SIMP unifies on KDE Plasma's native MPRIS2 Media Player widget (`org.mpris.MediaPlayer2.simp`,
    // which exposes `DesktopEntry = "org.simp.player"`, `Raise`, `Quit`, `Shuffle`, `LoopStatus`, and `Volume`)
    // so there is only 1 system tray icon instead of duplicate MPRIS + custom SNI icons.
    // Set `SIMP_ENABLE_LEGACY_TRAY=1` to also spawn the standalone StatusNotifierItem tray icon.
    if std::env::var("SIMP_ENABLE_LEGACY_TRAY").ok().as_deref() != Some("1") {
        let _ = (state, cmd_tx);
        return;
    }

    #[cfg(target_os = "linux")]
    {
        let _ = std::thread::Builder::new()
            .name("simp-kde-tray".to_string())
            .spawn(move || {
                linux_sni::run_sni_tray_loop(state, cmd_tx);
            });
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (state, cmd_tx);
    }
}

#[cfg(target_os = "linux")]
mod linux_sni {
    use super::*;
    use dbus::arg::{RefArg, Variant};
    use dbus::blocking::Connection;
    use dbus::channel::{MatchingReceiver, Sender};
    use dbus::message::MatchRule;
    use dbus::Message;
    use dbus_crossroads::{Crossroads, IfaceBuilder};
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    struct TrayContext {
        state: Arc<Mutex<OrchestratorSnapshot>>,
        cmd_tx: mpsc::UnboundedSender<AudioCommand>,
        icon_theme_path: String,
    }

    fn launch_simp_window() {
        crate::mpris::launch_simp_desktop_window();
    }

    fn build_tooltip(state: &Arc<Mutex<OrchestratorSnapshot>>) -> (String, Vec<(i32, i32, Vec<u8>)>, String, String) {
        let st = state.lock().unwrap();
        let vol_pct = (st.volume * 100.0).round() as i32;
        let status_line = if st.is_playing {
            format!("🔊 Playing • Volume {}%", vol_pct)
        } else {
            format!("🔇 Paused (Silenced) • Volume {}%", vol_pct)
        };

        if let Some(ref track) = st.current_track {
            let artists = if track.artists.is_empty() {
                "Unknown Artist".to_string()
            } else {
                track.artists.join(", ")
            };
            let title = format!("SIMP — {}", track.title);
            let body = if track.album.is_empty() {
                format!("{}\n{}", artists, status_line)
            } else {
                format!("{} • {}\n{}", artists, track.album, status_line)
            };
            ("org.simp.player".to_string(), Vec::new(), title, body)
        } else {
            (
                "org.simp.player".to_string(),
                Vec::new(),
                "SIMP — Simple Integrated Media Player".to_string(),
                status_line,
            )
        }
    }

    fn build_now_playing_label(state: &Arc<Mutex<OrchestratorSnapshot>>) -> (String, bool) {
        let st = state.lock().unwrap();
        let is_playing = st.is_playing;
        if let Some(ref track) = st.current_track {
            let artist = track.artists.first().map(|s| s.as_str()).unwrap_or("Unknown");
            let prefix = if is_playing { "🎵" } else { "🔇" };
            (format!("{} {} — {}", prefix, track.title, artist), is_playing)
        } else {
            ("🎵 SIMP Ready (Idle)".to_string(), is_playing)
        }
    }

    fn make_menu_item(
        id: i32,
        label: &str,
        enabled: bool,
        is_separator: bool,
    ) -> Variant<Box<dyn RefArg>> {
        let mut props: HashMap<String, Variant<Box<dyn RefArg>>> = HashMap::new();
        if is_separator {
            props.insert(
                "type".to_string(),
                Variant(Box::new("separator".to_string()) as Box<dyn RefArg>),
            );
        } else {
            props.insert(
                "label".to_string(),
                Variant(Box::new(label.to_string()) as Box<dyn RefArg>),
            );
            props.insert(
                "enabled".to_string(),
                Variant(Box::new(enabled) as Box<dyn RefArg>),
            );
            props.insert(
                "visible".to_string(),
                Variant(Box::new(true) as Box<dyn RefArg>),
            );
        }
        let children: Vec<Variant<Box<dyn RefArg>>> = Vec::new();
        Variant(Box::new((id, props, children)) as Box<dyn RefArg>)
    }

    /// Generates a 24x24 ARGB32 (network byte order: A, R, G, B) fallback icon pixmap
    /// featuring SIMP's signature OLED black background, orange portal ring (#ff6a00), and cyan core (#2aa3c4).
    fn build_fallback_icon_pixmap() -> Vec<(i32, i32, Vec<u8>)> {
        let w = 24i32;
        let h = 24i32;
        let mut argb = Vec::with_capacity((w * h * 4) as usize);
        let cx = 11.5f32;
        let cy = 11.5f32;
        for y in 0..h {
            for x in 0..w {
                let dx = x as f32 - cx;
                let dy = y as f32 - cy;
                let dist = (dx * dx + dy * dy).sqrt();
                if dist > 11.0 {
                    // Transparent outside circle
                    argb.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
                } else if dist >= 7.2 && dist <= 9.8 {
                    // Orange portal ring (#ff6a00)
                    argb.extend_from_slice(&[0xFF, 0xFF, 0x6A, 0x00]);
                } else if dist <= 3.6 {
                    // Sonic cyan core (#2aa3c4)
                    argb.extend_from_slice(&[0xFF, 0x2A, 0xA3, 0xC4]);
                } else {
                    // Deep OLED black (#08080c)
                    argb.extend_from_slice(&[0xFF, 0x08, 0x08, 0x0C]);
                }
            }
        }
        vec![(w, h, argb)]
    }

    fn register_sni_interface(cr: &mut Crossroads) -> dbus_crossroads::IfaceToken<TrayContext> {
        cr.register("org.kde.StatusNotifierItem", |b: &mut IfaceBuilder<TrayContext>| {
            b.property("Category")
                .get(|_, _| Ok("ApplicationStatus".to_string()));
            b.property("Id")
                .get(|_, _| Ok("org.simp.player".to_string()));
            b.property("Title").get(|_, ctx| {
                let (label, _) = build_now_playing_label(&ctx.state);
                Ok(label)
            });
            b.property("Status").get(|_, _| Ok("Active".to_string()));
            b.property("WindowId").get(|_, _| Ok(0i32));
            b.property("IconName")
                .get(|_, _| Ok("org.simp.player".to_string()));
            b.property("IconThemePath")
                .get(|_, ctx| Ok(ctx.icon_theme_path.clone()));
            b.property("IconPixmap")
                .get(|_, _| Ok(build_fallback_icon_pixmap()));
            b.property("ItemIsMenu").get(|_, _| Ok(false));
            b.property("Menu")
                .get(|_, _| Ok(dbus::Path::new("/MenuBar").unwrap()));
            b.property("ToolTip")
                .get(|_, ctx| Ok(build_tooltip(&ctx.state)));

            b.method("Activate", ("x", "y"), (), |_, _, (_x, _y): (i32, i32)| {
                launch_simp_window();
                Ok(())
            });

            b.method(
                "SecondaryActivate",
                ("x", "y"),
                (),
                |_, ctx, (_x, _y): (i32, i32)| {
                    let _ = ctx.cmd_tx.send(AudioCommand::TogglePlayPause);
                    Ok(())
                },
            );

            b.method("ContextMenu", ("x", "y"), (), |_, _, (_x, _y): (i32, i32)| {
                Ok(())
            });

            b.method(
                "Scroll",
                ("delta", "orientation"),
                (),
                |_, ctx, (delta, _orientation): (i32, String)| {
                    if delta != 0 {
                        let cur_vol = ctx.state.lock().unwrap().volume;
                        let step = if delta > 0 { 0.05 } else { -0.05 };
                        let next_vol = (cur_vol + step).clamp(0.05, 1.0);
                        let _ = ctx.cmd_tx.send(AudioCommand::SetVolume { volume: next_vol });
                    }
                    Ok(())
                },
            );
        })
    }

    fn register_dbusmenu_interface(
        cr: &mut Crossroads,
    ) -> dbus_crossroads::IfaceToken<TrayContext> {
        cr.register("com.canonical.dbusmenu", |b: &mut IfaceBuilder<TrayContext>| {
            b.property("Version").get(|_, _| Ok(3u32));
            b.property("Status").get(|_, _| Ok("normal".to_string()));

            b.method("AboutToShow", ("id",), ("needUpdate",), |_, _, (_id,): (i32,)| {
                Ok((true,))
            });

            b.method(
                "GetGroupProperties",
                ("ids", "propertyNames"),
                ("properties",),
                |_, ctx, (ids, _prop_names): (Vec<i32>, Vec<String>)| {
                    let (now_label, is_playing) = build_now_playing_label(&ctx.state);
                    let play_label = if is_playing {
                        "⏸ Pause (Silence Audio)"
                    } else {
                        "▶ Play / Resume Audio"
                    };
                    let mut out: Vec<(i32, HashMap<String, Variant<Box<dyn RefArg>>>)> = Vec::new();
                    for id in ids {
                        let mut map: HashMap<String, Variant<Box<dyn RefArg>>> = HashMap::new();
                        match id {
                            0 => {
                                map.insert(
                                    "children-display".to_string(),
                                    Variant(Box::new("submenu".to_string()) as Box<dyn RefArg>),
                                );
                            }
                            1 => {
                                map.insert(
                                    "label".to_string(),
                                    Variant(Box::new(now_label.clone()) as Box<dyn RefArg>),
                                );
                                map.insert(
                                    "enabled".to_string(),
                                    Variant(Box::new(false) as Box<dyn RefArg>),
                                );
                            }
                            2 => {
                                map.insert(
                                    "label".to_string(),
                                    Variant(Box::new(play_label.to_string()) as Box<dyn RefArg>),
                                );
                                map.insert(
                                    "enabled".to_string(),
                                    Variant(Box::new(true) as Box<dyn RefArg>),
                                );
                            }
                            3 => {
                                map.insert(
                                    "label".to_string(),
                                    Variant(Box::new("⏭ Next Track".to_string()) as Box<dyn RefArg>),
                                );
                                map.insert(
                                    "enabled".to_string(),
                                    Variant(Box::new(true) as Box<dyn RefArg>),
                                );
                            }
                            4 => {
                                map.insert(
                                    "label".to_string(),
                                    Variant(Box::new("⏮ Previous Track".to_string()) as Box<dyn RefArg>),
                                );
                                map.insert(
                                    "enabled".to_string(),
                                    Variant(Box::new(true) as Box<dyn RefArg>),
                                );
                            }
                            5 => {
                                map.insert(
                                    "type".to_string(),
                                    Variant(Box::new("separator".to_string()) as Box<dyn RefArg>),
                                );
                            }
                            6 => {
                                map.insert(
                                    "label".to_string(),
                                    Variant(Box::new("↗ Open SIMP Window".to_string()) as Box<dyn RefArg>),
                                );
                                map.insert(
                                    "enabled".to_string(),
                                    Variant(Box::new(true) as Box<dyn RefArg>),
                                );
                            }
                            7 => {
                                map.insert(
                                    "label".to_string(),
                                    Variant(Box::new("🔄 Restart Background Daemon".to_string()) as Box<dyn RefArg>),
                                );
                                map.insert(
                                    "enabled".to_string(),
                                    Variant(Box::new(true) as Box<dyn RefArg>),
                                );
                            }
                            8 => {
                                map.insert(
                                    "label".to_string(),
                                    Variant(Box::new("⏻ Quit SIMP".to_string()) as Box<dyn RefArg>),
                                );
                                map.insert(
                                    "enabled".to_string(),
                                    Variant(Box::new(true) as Box<dyn RefArg>),
                                );
                            }
                            _ => {}
                        }
                        out.push((id, map));
                    }
                    Ok((out,))
                },
            );

            b.method(
                "GetLayout",
                ("parentId", "recursionDepth", "propertyNames"),
                ("revision", "layout"),
                |_, ctx, (parent_id, _depth, _props): (i32, i32, Vec<String>)| {
                    let (now_label, is_playing) = build_now_playing_label(&ctx.state);
                    let play_label = if is_playing {
                        "⏸ Pause (Silence Audio)"
                    } else {
                        "▶ Play / Resume Audio"
                    };

                    let mut root_props: HashMap<String, Variant<Box<dyn RefArg>>> = HashMap::new();
                    root_props.insert(
                        "children-display".to_string(),
                        Variant(Box::new("submenu".to_string()) as Box<dyn RefArg>),
                    );

                    let children = if parent_id == 0 {
                        vec![
                            make_menu_item(1, &now_label, false, false),
                            make_menu_item(2, play_label, true, false),
                            make_menu_item(3, "⏭ Next Track", true, false),
                            make_menu_item(4, "⏮ Previous Track", true, false),
                            make_menu_item(5, "", true, true),
                            make_menu_item(6, "↗ Open SIMP Window", true, false),
                            make_menu_item(7, "🔄 Restart Background Daemon", true, false),
                            make_menu_item(8, "⏻ Quit SIMP", true, false),
                        ]
                    } else {
                        Vec::new()
                    };

                    Ok((1u32, (parent_id, root_props, children)))
                },
            );

            b.method(
                "Event",
                ("id", "eventId", "data", "timestamp"),
                (),
                |_, ctx, (id, event_id, _data, _ts): (i32, String, Variant<Box<dyn RefArg>>, u32)| {
                    if event_id == "clicked" {
                        match id {
                            2 => {
                                let _ = ctx.cmd_tx.send(AudioCommand::TogglePlayPause);
                            }
                            3 => {
                                let _ = ctx.cmd_tx.send(AudioCommand::Next);
                            }
                            4 => {
                                let _ = ctx.cmd_tx.send(AudioCommand::Previous);
                            }
                            6 => {
                                launch_simp_window();
                            }
                            7 => {
                                let _ = ctx.cmd_tx.send(AudioCommand::RestartDaemon);
                            }
                            8 => {
                                let _ = ctx.cmd_tx.send(AudioCommand::ShutdownDaemon);
                            }
                            _ => {}
                        }
                    }
                    Ok(())
                },
            );
        })
    }

    fn try_register_with_watcher(conn: &Connection, service_name: &str) -> bool {
        let proxy = conn.with_proxy(
            "org.kde.StatusNotifierWatcher",
            "/StatusNotifierWatcher",
            Duration::from_millis(400),
        );
        let res: Result<(), dbus::Error> = proxy.method_call(
            "org.kde.StatusNotifierWatcher",
            "RegisterStatusNotifierItem",
            (service_name,),
        );
        res.is_ok()
    }

    pub fn run_sni_tray_loop(
        state: Arc<Mutex<OrchestratorSnapshot>>,
        cmd_tx: mpsc::UnboundedSender<AudioCommand>,
    ) {
        let Ok(conn) = Connection::new_session() else {
            return;
        };

        let pid = std::process::id();
        let service_name = format!("org.kde.StatusNotifierItem-{}-1", pid);
        if conn
            .request_name(&service_name, false, true, false)
            .is_err()
        {
            return;
        }

        let icon_theme_path = dirs::home_dir()
            .map(|h| h.join(".local/share/icons").to_string_lossy().to_string())
            .unwrap_or_else(|| "/usr/share/icons".to_string());

        let mut cr = Crossroads::new();
        let sni_token = register_sni_interface(&mut cr);
        let menu_token = register_dbusmenu_interface(&mut cr);

        cr.insert(
            "/StatusNotifierItem",
            &[sni_token],
            TrayContext {
                state: state.clone(),
                cmd_tx: cmd_tx.clone(),
                icon_theme_path: icon_theme_path.clone(),
            },
        );
        cr.insert(
            "/MenuBar",
            &[menu_token],
            TrayContext {
                state: state.clone(),
                cmd_tx: cmd_tx.clone(),
                icon_theme_path,
            },
        );

        conn.start_receive(
            MatchRule::new_method_call(),
            Box::new(move |msg, conn| {
                cr.handle_message(msg, conn).unwrap();
                true
            }),
        );

        let mut registered = try_register_with_watcher(&conn, &service_name);
        if registered {
            tracing::info!("Registered SIMP system tray icon with org.kde.StatusNotifierWatcher");
        }

        let mut last_check = Instant::now();
        let mut last_sig_state = String::new();

        loop {
            let _ = conn.process(Duration::from_millis(500));

            if last_check.elapsed() >= Duration::from_millis(1500) {
                last_check = Instant::now();

                if !registered {
                    registered = try_register_with_watcher(&conn, &service_name);
                    if registered {
                        tracing::info!("Registered SIMP system tray icon with org.kde.StatusNotifierWatcher");
                    }
                }

                if registered {
                    let (label, is_playing) = build_now_playing_label(&state);
                    let vol_pct = (state.lock().unwrap().volume * 100.0).round() as i32;
                    let cur_sig = format!("{}|{}|{}", label, is_playing, vol_pct);
                    if cur_sig != last_sig_state {
                        last_sig_state = cur_sig;
                        if let Ok(sig) = Message::new_signal(
                            "/StatusNotifierItem",
                            "org.kde.StatusNotifierItem",
                            "NewToolTip",
                        ) {
                            let _ = conn.send(sig);
                        }
                        if let Ok(sig) = Message::new_signal(
                            "/StatusNotifierItem",
                            "org.kde.StatusNotifierItem",
                            "NewTitle",
                        ) {
                            let _ = conn.send(sig);
                        }
                    }
                }
            }
        }
    }
}
