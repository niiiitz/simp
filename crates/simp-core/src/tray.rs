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
    #[cfg(target_os = "windows")]
    {
        let _ = std::thread::Builder::new()
            .name("simp-win32-tray".to_string())
            .spawn(move || {
                win32_tray::run_win32_tray_and_smtc_loop(state, cmd_tx);
            });
        return;
    }

    #[cfg(target_os = "linux")]
    {
        // By default on Linux, SIMP unifies on KDE Plasma's native MPRIS2 Media Player widget (`org.mpris.MediaPlayer2.simp`,
        // which exposes `DesktopEntry = "org.simp.player"`, `Raise`, `Quit`, `Shuffle`, `LoopStatus`, and `Volume`)
        // so there is only 1 system tray icon instead of duplicate MPRIS + custom SNI icons.
        // Set `SIMP_ENABLE_LEGACY_TRAY=1` to also spawn the standalone StatusNotifierItem tray icon.
        if std::env::var("SIMP_ENABLE_LEGACY_TRAY").ok().as_deref() != Some("1") {
            let _ = (state, cmd_tx);
            return;
        }
        let _ = std::thread::Builder::new()
            .name("simp-kde-tray".to_string())
            .spawn(move || {
                linux_sni::run_sni_tray_loop(state, cmd_tx);
            });
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
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

#[cfg(target_os = "windows")]
mod win32_tray {
    use super::*;
    use souvlaki::{
        MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition,
        PlatformConfig, SeekDirection,
    };
    use std::ffi::c_void;
    use std::mem::zeroed;
    use std::ptr::{null, null_mut};
    use std::sync::OnceLock;
    use std::time::Duration;

    type Hwnd = *mut c_void;
    type Hinstance = *mut c_void;
    type Hicon = *mut c_void;
    type Hmenu = *mut c_void;
    type Hbitmap = *mut c_void;
    type Lresult = isize;
    type Wparam = usize;
    type Lparam = isize;

    const WM_DESTROY: u32 = 0x0002;
    const WM_COMMAND: u32 = 0x0111;
    const WM_TIMER: u32 = 0x0113;
    const WM_USER: u32 = 0x0400;
    const WM_TRAYICON: u32 = WM_USER + 1;

    const WM_LBUTTONUP: u32 = 0x0202;
    const WM_LBUTTONDBLCLK: u32 = 0x0203;
    const WM_RBUTTONUP: u32 = 0x0205;
    const WM_MBUTTONUP: u32 = 0x0208;
    const WM_CONTEXTMENU: u32 = 0x007B;

    const NIM_ADD: u32 = 0x00000000;
    const NIM_MODIFY: u32 = 0x00000001;
    const NIM_DELETE: u32 = 0x00000002;

    const NIF_MESSAGE: u32 = 0x00000001;
    const NIF_ICON: u32 = 0x00000002;
    const NIF_TIP: u32 = 0x00000004;

    const MF_STRING: u32 = 0x00000000;
    const MF_GRAYED: u32 = 0x00000001;
    const MF_SEPARATOR: u32 = 0x00000800;
    const TPM_BOTTOMALIGN: u32 = 0x0020;
    const TPM_LEFTALIGN: u32 = 0x0000;
    const TPM_RIGHTBUTTON: u32 = 0x0002;

    const ID_TRAY_PLAY_PAUSE: usize = 1001;
    const ID_TRAY_NEXT: usize = 1002;
    const ID_TRAY_PREV: usize = 1003;
    const ID_TRAY_OPEN_UI: usize = 1004;
    const ID_TRAY_QUIT: usize = 1005;

    #[repr(C)]
    struct WndClassExW {
        cb_size: u32,
        style: u32,
        lpfn_wnd_proc: unsafe extern "system" fn(Hwnd, u32, Wparam, Lparam) -> Lresult,
        cb_cls_extra: i32,
        cb_wnd_extra: i32,
        h_instance: Hinstance,
        h_icon: Hicon,
        h_cursor: *mut c_void,
        hbr_background: *mut c_void,
        lpsz_menu_name: *const u16,
        lpsz_class_name: *const u16,
        h_icon_sm: Hicon,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct Msg {
        hwnd: Hwnd,
        message: u32,
        w_param: Wparam,
        l_param: Lparam,
        time: u32,
        pt: Point,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Guid {
        data1: u32,
        data2: u16,
        data3: u16,
        data4: [u8; 8],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NotifyIconDataW {
        cb_size: u32,
        h_wnd: Hwnd,
        u_id: u32,
        u_flags: u32,
        u_callback_message: u32,
        h_icon: Hicon,
        sz_tip: [u16; 128],
        dw_state: u32,
        dw_state_mask: u32,
        sz_info: [u16; 256],
        u_version_or_timeout: u32,
        sz_info_title: [u16; 64],
        dw_info_flags: u32,
        guid_item: Guid,
        h_balloon_icon: Hicon,
    }

    #[repr(C)]
    struct IconInfo {
        f_icon: i32,
        x_hotspot: u32,
        y_hotspot: u32,
        hbm_mask: Hbitmap,
        hbm_color: Hbitmap,
    }

    #[link(name = "user32")]
    extern "system" {
        fn RegisterClassExW(lpwcx: *const WndClassExW) -> u16;
        fn CreateWindowExW(
            dw_ex_style: u32,
            lp_class_name: *const u16,
            lp_window_name: *const u16,
            dw_style: u32,
            x: i32,
            y: i32,
            n_width: i32,
            n_height: i32,
            h_wnd_parent: Hwnd,
            h_menu: Hmenu,
            h_instance: Hinstance,
            lp_param: *mut c_void,
        ) -> Hwnd;
        fn DefWindowProcW(h_wnd: Hwnd, msg: u32, w_param: Wparam, l_param: Lparam) -> Lresult;
        fn GetMessageW(lp_msg: *mut Msg, h_wnd: Hwnd, min: u32, max: u32) -> i32;
        fn TranslateMessage(lp_msg: *const Msg) -> i32;
        fn DispatchMessageW(lp_msg: *const Msg) -> Lresult;
        fn SetTimer(h_wnd: Hwnd, n_id_event: usize, u_elapse: u32, lp_timer_func: *mut c_void) -> usize;
        fn CreatePopupMenu() -> Hmenu;
        fn AppendMenuW(h_menu: Hmenu, u_flags: u32, u_id_new_item: usize, lp_new_item: *const u16) -> i32;
        fn DestroyMenu(h_menu: Hmenu) -> i32;
        fn GetCursorPos(lp_point: *mut Point) -> i32;
        fn SetForegroundWindow(h_wnd: Hwnd) -> i32;
        fn TrackPopupMenu(
            h_menu: Hmenu,
            u_flags: u32,
            x: i32,
            y: i32,
            n_reserved: i32,
            h_wnd: Hwnd,
            prc_rect: *const c_void,
        ) -> i32;
        fn PostMessageW(h_wnd: Hwnd, msg: u32, w_param: Wparam, l_param: Lparam) -> i32;
        fn PostQuitMessage(n_exit_code: i32);
        fn CreateIconIndirect(piconinfo: *const IconInfo) -> Hicon;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn CreateBitmap(
            n_width: i32,
            n_height: i32,
            n_planes: u32,
            n_bit_count: u32,
            lp_bits: *const c_void,
        ) -> Hbitmap;
        fn DeleteObject(ho: *mut c_void) -> i32;
    }

    #[link(name = "shell32")]
    extern "system" {
        fn Shell_NotifyIconW(dw_message: u32, lp_data: *const NotifyIconDataW) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(lp_module_name: *const u16) -> Hinstance;
    }

    struct Win32TrayGlobal {
        state: Arc<Mutex<OrchestratorSnapshot>>,
        cmd_tx: mpsc::UnboundedSender<AudioCommand>,
        nid: Mutex<NotifyIconDataW>,
    }

    unsafe impl Send for Win32TrayGlobal {}
    unsafe impl Sync for Win32TrayGlobal {}

    static TRAY_GLOBAL: OnceLock<Win32TrayGlobal> = OnceLock::new();

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn copy_wide_fixed<const N: usize>(dest: &mut [u16; N], text: &str) {
        dest.fill(0);
        for (i, ch) in text.encode_utf16().take(N.saturating_sub(1)).enumerate() {
            dest[i] = ch;
        }
    }

    /// Creates a 32x32 ARGB SIMP Portal icon (glowing cyan + warm orange ring on dark slate circle)
    /// so the Windows 10/11 Notification Area displays a crisp custom SIMP icon with zero external `.ico` file required.
    unsafe fn create_simp_portal_hicon() -> Hicon {
        const W: i32 = 32;
        const H: i32 = 32;
        let mut pixels = vec![0u32; (W * H) as usize];
        let cx = 15.5_f32;
        let cy = 15.5_f32;

        for y in 0..H {
            for x in 0..W {
                let dx = (x as f32) - cx;
                let dy = (y as f32) - cy;
                let dist = (dx * dx + dy * dy).sqrt();
                let idx = (y * W + x) as usize;

                if dist <= 14.8 {
                    // Dark obsidian background disc (#0E1017)
                    let mut r = 14u32;
                    let mut g = 16u32;
                    let mut b = 23u32;
                    let a = if dist > 13.8 {
                        (((14.8 - dist).clamp(0.0, 1.0)) * 255.0) as u32
                    } else {
                        255u32
                    };

                    // Portal outer ring (radius 9.5..12.8): left half warm orange (#FF6A00), right half cyan (#22D3EE)
                    if (9.2..=12.8).contains(&dist) {
                        if dx < 0.0 {
                            r = 255;
                            g = 106;
                            b = 0;
                        } else {
                            r = 34;
                            g = 211;
                            b = 238;
                        }
                    } else if dist <= 4.2 {
                        // Center play core (#E0F2FE)
                        r = 224;
                        g = 242;
                        b = 254;
                    }

                    // BGRA in little-endian u32 = 0xAARRGGBB
                    pixels[idx] = (a << 24) | (r << 16) | (g << 8) | b;
                }
            }
        }

        let mask_bytes = vec![0u8; ((W * H) / 8) as usize];
        let hbm_color = CreateBitmap(W, H, 1, 32, pixels.as_ptr() as *const c_void);
        let hbm_mask = CreateBitmap(W, H, 1, 1, mask_bytes.as_ptr() as *const c_void);
        let ii = IconInfo {
            f_icon: 1,
            x_hotspot: 0,
            y_hotspot: 0,
            hbm_mask,
            hbm_color,
        };
        let hicon = CreateIconIndirect(&ii);
        if !hbm_color.is_null() {
            DeleteObject(hbm_color);
        }
        if !hbm_mask.is_null() {
            DeleteObject(hbm_mask);
        }
        hicon
    }

    fn format_tray_tooltip(state: &Arc<Mutex<OrchestratorSnapshot>>) -> String {
        let st = state.lock().unwrap();
        let vol_pct = (st.volume * 100.0).round() as i32;
        let state_str = if st.is_playing { "Playing" } else { "Paused" };
        if let Some(ref track) = st.current_track {
            let artist = if track.artists.is_empty() {
                "Unknown Artist".to_string()
            } else {
                track.artists.join(", ")
            };
            format!("SIMP — {}\n{} ({} • {}%)", track.title, artist, state_str, vol_pct)
        } else {
            format!("SIMP Media Player ({} • Vol {}%)", state_str, vol_pct)
        }
    }

    unsafe fn show_context_menu(hwnd: Hwnd, global: &Win32TrayGlobal) {
        let hmenu = CreatePopupMenu();
        if hmenu.is_null() {
            return;
        }

        let (header_label, is_playing) = {
            let st = global.state.lock().unwrap();
            if let Some(ref t) = st.current_track {
                let artist = t.artists.first().cloned().unwrap_or_else(|| "SIMP".to_string());
                (format!("🎵 {} — {}", t.title, artist), st.is_playing)
            } else {
                ("🎵 SIMP — Idle".to_string(), st.is_playing)
            }
        };

        let header_w = to_wide(&header_label);
        let play_w = to_wide(if is_playing {
            "⏸ Pause (Silence)"
        } else {
            "▶ Play / Resume"
        });
        let next_w = to_wide("⏭ Next Track");
        let prev_w = to_wide("⏮ Previous Track");
        let open_w = to_wide("🖥 Open SIMP Console");
        let quit_w = to_wide("⏻ Quit SIMP");

        AppendMenuW(hmenu, MF_STRING | MF_GRAYED, 0, header_w.as_ptr());
        AppendMenuW(hmenu, MF_SEPARATOR, 0, null());
        AppendMenuW(hmenu, MF_STRING, ID_TRAY_PLAY_PAUSE, play_w.as_ptr());
        AppendMenuW(hmenu, MF_STRING, ID_TRAY_NEXT, next_w.as_ptr());
        AppendMenuW(hmenu, MF_STRING, ID_TRAY_PREV, prev_w.as_ptr());
        AppendMenuW(hmenu, MF_SEPARATOR, 0, null());
        AppendMenuW(hmenu, MF_STRING, ID_TRAY_OPEN_UI, open_w.as_ptr());
        AppendMenuW(hmenu, MF_STRING, ID_TRAY_QUIT, quit_w.as_ptr());

        let mut pt = Point { x: 0, y: 0 };
        GetCursorPos(&mut pt);
        SetForegroundWindow(hwnd);
        TrackPopupMenu(
            hmenu,
            TPM_LEFTALIGN | TPM_BOTTOMALIGN | TPM_RIGHTBUTTON,
            pt.x,
            pt.y,
            0,
            hwnd,
            null(),
        );
        PostMessageW(hwnd, 0, 0, 0);
        DestroyMenu(hmenu);
    }

    unsafe extern "system" fn tray_wnd_proc(
        hwnd: Hwnd,
        msg: u32,
        w_param: Wparam,
        l_param: Lparam,
    ) -> Lresult {
        match msg {
            WM_TRAYICON => {
                let mouse_msg = (l_param as u32) & 0xFFFF;
                if mouse_msg == WM_LBUTTONUP {
                    crate::mpris::launch_simp_desktop_window();
                } else if mouse_msg == WM_MBUTTONUP {
                    if let Some(g) = TRAY_GLOBAL.get() {
                        let _ = g.cmd_tx.send(AudioCommand::TogglePlayPause);
                    }
                } else if mouse_msg == WM_RBUTTONUP || mouse_msg == WM_CONTEXTMENU {
                    if let Some(g) = TRAY_GLOBAL.get() {
                        show_context_menu(hwnd, g);
                    }
                }
                0
            }
            WM_COMMAND => {
                let cmd_id = w_param & 0xFFFF;
                if let Some(g) = TRAY_GLOBAL.get() {
                    match cmd_id {
                        ID_TRAY_PLAY_PAUSE => {
                            let _ = g.cmd_tx.send(AudioCommand::TogglePlayPause);
                        }
                        ID_TRAY_NEXT => {
                            let _ = g.cmd_tx.send(AudioCommand::Next);
                        }
                        ID_TRAY_PREV => {
                            let _ = g.cmd_tx.send(AudioCommand::Previous);
                        }
                        ID_TRAY_OPEN_UI => {
                            crate::mpris::launch_simp_desktop_window();
                        }
                        ID_TRAY_QUIT => {
                            let _ = g.cmd_tx.send(AudioCommand::ShutdownDaemon);
                            crate::sinks::apple::AppleMusicSink::kill_headless_widevine_worker();
                            if let Ok(nid) = g.nid.lock() {
                                Shell_NotifyIconW(NIM_DELETE, &*nid);
                            }
                            PostQuitMessage(0);
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                }
                0
            }
            WM_DESTROY => {
                if let Some(g) = TRAY_GLOBAL.get() {
                    if let Ok(nid) = g.nid.lock() {
                        Shell_NotifyIconW(NIM_DELETE, &*nid);
                    }
                }
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, msg, w_param, l_param),
        }
    }

    pub fn run_win32_tray_and_smtc_loop(
        state: Arc<Mutex<OrchestratorSnapshot>>,
        cmd_tx: mpsc::UnboundedSender<AudioCommand>,
    ) {
        unsafe {
            let h_instance = GetModuleHandleW(null());
            let class_name = to_wide("SimpWin32TrayWindowClass");
            let wnd_class = WndClassExW {
                cb_size: std::mem::size_of::<WndClassExW>() as u32,
                style: 0,
                lpfn_wnd_proc: tray_wnd_proc,
                cb_cls_extra: 0,
                cb_wnd_extra: 0,
                h_instance,
                h_icon: null_mut(),
                h_cursor: null_mut(),
                hbr_background: null_mut(),
                lpsz_menu_name: null(),
                lpsz_class_name: class_name.as_ptr(),
                h_icon_sm: null_mut(),
            };
            RegisterClassExW(&wnd_class);

            let win_title = to_wide("SIMP Background Audio Service");
            let hwnd = CreateWindowExW(
                0,
                class_name.as_ptr(),
                win_title.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                null_mut(),
                null_mut(),
                h_instance,
                null_mut(),
            );
            if hwnd.is_null() {
                return;
            }

            let hicon = create_simp_portal_hicon();
            let mut nid: NotifyIconDataW = zeroed();
            nid.cb_size = std::mem::size_of::<NotifyIconDataW>() as u32;
            nid.h_wnd = hwnd;
            nid.u_id = 1;
            nid.u_flags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
            nid.u_callback_message = WM_TRAYICON;
            nid.h_icon = hicon;

            let initial_tip = format_tray_tooltip(&state);
            copy_wide_fixed(&mut nid.sz_tip, &initial_tip);

            let _ = TRAY_GLOBAL.set(Win32TrayGlobal {
                state: state.clone(),
                cmd_tx: cmd_tx.clone(),
                nid: Mutex::new(nid),
            });

            Shell_NotifyIconW(NIM_ADD, &nid);

            // Attach Windows 10/11 System Media Transport Controls (SMTC) via `souvlaki` using our hidden `hwnd`
            let mut smtc_controls = MediaControls::new(PlatformConfig {
                dbus_name: "org.simp.player",
                display_name: "SIMP Media Player",
                hwnd: Some(hwnd),
            })
            .ok();

            if let Some(ref mut controls) = smtc_controls {
                let tx = cmd_tx.clone();
                let _ = controls.attach(move |event: MediaControlEvent| match event {
                    MediaControlEvent::Play => {
                        let _ = tx.send(AudioCommand::Play);
                    }
                    MediaControlEvent::Pause | MediaControlEvent::Stop => {
                        let _ = tx.send(AudioCommand::Pause);
                    }
                    MediaControlEvent::Toggle => {
                        let _ = tx.send(AudioCommand::TogglePlayPause);
                    }
                    MediaControlEvent::Next => {
                        let _ = tx.send(AudioCommand::Next);
                    }
                    MediaControlEvent::Previous => {
                        let _ = tx.send(AudioCommand::Previous);
                    }
                    MediaControlEvent::SetPosition(MediaPosition(pos)) => {
                        let _ = tx.send(AudioCommand::Seek {
                            position_ms: pos.as_millis() as u32,
                        });
                    }
                    MediaControlEvent::Seek(dir) => {
                        let offset = match dir {
                            SeekDirection::Forward => 10_000,
                            SeekDirection::Backward => -10_000,
                        };
                        let _ = offset;
                    }
                    MediaControlEvent::Raise => {
                        crate::mpris::launch_simp_desktop_window();
                    }
                    _ => {}
                });
            }

            // Set 500ms timer to keep System Tray tooltip and Windows SMTC metadata/playback state in sync
            SetTimer(hwnd, 1, 500, null_mut());
            let mut last_tip = initial_tip;
            let mut last_smtc_sig = String::new();

            let mut msg: Msg = zeroed();
            while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
                if msg.message == WM_TIMER {
                    let _ = crate::hide_windows_headless_worker_windows();
                    let next_tip = format_tray_tooltip(&state);
                    if next_tip != last_tip {
                        last_tip = next_tip.clone();
                        if let Some(g) = TRAY_GLOBAL.get() {
                            if let Ok(mut nid_guard) = g.nid.lock() {
                                copy_wide_fixed(&mut nid_guard.sz_tip, &next_tip);
                                Shell_NotifyIconW(NIM_MODIFY, &*nid_guard);
                            }
                        }
                    }

                    if let Some(ref mut controls) = smtc_controls {
                        let (current_track, is_playing, position_ms) = {
                            let st = state.lock().unwrap();
                            (
                                st.current_track.clone(),
                                st.is_playing,
                                st.position_ms,
                            )
                        };
                        let track_uri = current_track
                            .as_ref()
                            .map(|t| t.uri.as_str())
                            .unwrap_or("");
                        let sig = format!("{}|{}", track_uri, is_playing);
                        if sig != last_smtc_sig {
                            last_smtc_sig = sig;
                            if let Some(ref track) = current_track {
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
                                    cover_url: track.art_url.as_deref(),
                                });
                            }
                            let progress = Some(MediaPosition(Duration::from_millis(
                                position_ms as u64,
                            )));
                            let pb = if is_playing {
                                MediaPlayback::Playing { progress }
                            } else {
                                MediaPlayback::Paused { progress }
                            };
                            let _ = controls.set_playback(pb);
                        }
                    }
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}
