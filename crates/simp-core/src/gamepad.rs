use simp_protocol::PlaybackEvent;
#[cfg(target_os = "linux")]
use std::collections::HashSet;
#[cfg(target_os = "linux")]
use std::fs::File;
#[cfg(target_os = "linux")]
use std::io::Read;
#[cfg(target_os = "linux")]
use std::os::unix::io::AsRawFd;
#[cfg(target_os = "linux")]
use std::path::Path;
#[cfg(target_os = "linux")]
use std::sync::{Arc, Mutex};
#[cfg(target_os = "linux")]
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

/// Linux `joydev` ioctl `JSIOCGBTNMAP` (`_IOR('j', 0x34, __u16[KEY_MAX - BTN_MISC + 1])`)
/// Queries the exact kernel `BTN_*` keycode mapped to each `js_event.number` button index.
#[cfg(target_os = "linux")]
const JSIOCGBTNMAP: libc::Ioctl = 0x80406a34u32 as libc::Ioctl;

/// Spawns a lightweight Linux `/dev/input/js*` gamepad reader thread so standalone KDE Plasma
/// windows (including Flatpak browsers whose sandbox hides `/dev/input`) receive controller
/// navigation and transport actions over the local WebSocket (`PlaybackEvent::GamepadInput`).
pub fn spawn_linux_gamepad_reader(broadcast_tx: broadcast::Sender<PlaybackEvent>) {
    #[cfg(not(target_os = "linux"))]
    let _ = broadcast_tx;
    #[cfg(target_os = "linux")]
    {
        let active_devices: Arc<Mutex<HashSet<usize>>> = Arc::new(Mutex::new(HashSet::new()));
        let _ = std::thread::Builder::new()
            .name("simp-linux-gamepad-discovery".to_string())
            .spawn(move || loop {
                for idx in 0..4usize {
                    let dev_path = format!("/dev/input/js{idx}");
                    if !Path::new(&dev_path).exists() {
                        continue;
                    }

                    // Filter out motion sensors, accelerometers, gyros, and touchpads
                    // (keep VR "Motion Controller" nodes intact on Steam Frame)
                    let sys_name_path = format!("/sys/class/input/js{idx}/device/name");
                    if let Ok(name) = std::fs::read_to_string(&sys_name_path) {
                        let lower = name.to_lowercase();
                        if lower.contains("motion sensor")
                            || lower.contains("sensor")
                            || lower.contains("imu")
                            || lower.contains("accel")
                            || lower.contains("gyro")
                            || lower.contains("touchpad")
                            || lower.contains("trackpad")
                            || lower.contains("mouse")
                            || lower.contains("keyboard")
                        {
                            continue;
                        }
                    }

                    {
                        let mut guard = match active_devices.lock() {
                            Ok(g) => g,
                            Err(_) => continue,
                        };
                        if guard.contains(&idx) {
                            continue;
                        }
                        guard.insert(idx);
                    }

                    let bcast = broadcast_tx.clone();
                    let active_clone = active_devices.clone();
                    let _ = std::thread::Builder::new()
                        .name(format!("simp-js{idx}"))
                        .spawn(move || {
                            read_joystick_loop(idx, &dev_path, bcast);
                            if let Ok(mut g) = active_clone.lock() {
                                g.remove(&idx);
                            }
                        });
                }

                std::thread::sleep(Duration::from_secs(3));
            });
    }
}

#[cfg(target_os = "linux")]
fn map_button_index_to_action(number: u8, btn_map: Option<&[u16; 640]>) -> Option<&'static str> {
    if let Some(map) = btn_map {
        let code = map.get(number as usize).copied().unwrap_or(0);
        match code {
            0x130 => return Some("activate"), // BTN_SOUTH (A / Cross)
            0x131 => return Some("back"),     // BTN_EAST (B / Circle)
            0x133 => return Some("shuffle"),  // BTN_NORTH (X / Square)
            0x134 => return Some("repeat"),   // BTN_WEST (Y / Triangle)
            0x136 => return Some("l1"),       // BTN_TL (L1 / LB)
            0x137 => return Some("r1"),       // BTN_TR (R1 / RB)
            0x138 => return Some("l2"),       // BTN_TL2 (Digital L2)
            0x139 => return Some("r2"),       // BTN_TR2 (Digital R2)
            0x13a => return Some("sources"),  // BTN_SELECT (Select / View)
            0x13b => return Some("power"),    // BTN_START (Start / Menu)
            0x220 => return Some("up"),       // BTN_DPAD_UP
            0x221 => return Some("down"),     // BTN_DPAD_DOWN
            0x222 => return Some("left"),     // BTN_DPAD_LEFT
            0x223 => return Some("right"),    // BTN_DPAD_RIGHT
            _ => {}
        }
    }

    // Fallback positional mapping if `JSIOCGBTNMAP` is unavailable
    match number {
        0 => Some("activate"), // A / Cross
        1 => Some("back"),     // B / Circle
        2 => Some("shuffle"),  // X / Square
        3 => Some("repeat"),   // Y / Triangle
        4 => Some("l1"),       // L1 / LB
        5 => Some("r1"),       // R1 / RB
        6 => Some("sources"),  // Select / View
        7 => Some("power"),    // Start / Menu
        11 => Some("left"),    // D-Pad Left
        12 => Some("right"),   // D-Pad Right
        13 => Some("up"),      // D-Pad Up
        14 => Some("down"),    // D-Pad Down
        _ => None,
    }
}

#[cfg(target_os = "linux")]
fn read_joystick_loop(idx: usize, dev_path: &str, broadcast_tx: broadcast::Sender<PlaybackEvent>) {
    let mut file = match File::open(dev_path) {
        Ok(f) => f,
        Err(_) => return,
    };

    // Query exact kernel `BTN_*` button mapping (`JSIOCGBTNMAP`) so controllers that register
    // `BTN_C` / `BTN_Z` (Bluetooth Xbox, DualSense, 8BitDo, Switch Pro) still map L1/R1/Select/Start accurately.
    let mut raw_btn_map = [0u16; 640];
    let has_btn_map = unsafe {
        libc::ioctl(file.as_raw_fd(), JSIOCGBTNMAP, raw_btn_map.as_mut_ptr()) >= 0
    };
    let btn_map_ref = if has_btn_map {
        Some(&raw_btn_map)
    } else {
        None
    };

    tracing::info!(
        "Linux gamepad reader attached to {dev_path} (js{idx}, kernel_btn_map={has_btn_map})"
    );

    let mut buf = [0u8; 8];
    let mut stick_x_dir: i8 = 0;
    let mut stick_y_dir: i8 = 0;
    let mut hat_x_dir: i8 = 0;
    let mut hat_y_dir: i8 = 0;
    let mut l2_pressed = false;
    let mut r2_pressed = false;
    let mut last_vol_tick = Instant::now() - Duration::from_secs(1);

    let emit = |action: &str| {
        let _ = broadcast_tx.send(PlaybackEvent::GamepadInput {
            action: action.to_string(),
        });
    };

    while file.read_exact(&mut buf).is_ok() {
        let value = i16::from_ne_bytes([buf[4], buf[5]]);
        let type_ = buf[6];
        let number = buf[7];

        // Skip initial state dump (`JS_EVENT_INIT` = 0x80)
        if (type_ & 0x80) != 0 {
            continue;
        }

        let ev_type = type_ & 0x7f;
        if ev_type == 0x01 {
            // JS_EVENT_BUTTON (value == 1 on press)
            if value == 1 {
                if let Some(act) = map_button_index_to_action(number, btn_map_ref) {
                    emit(act);
                }
            }
        } else if ev_type == 0x02 {
            // JS_EVENT_AXIS
            match number {
                // Left Stick X (`ABS_X`)
                0 => {
                    let dir = if value < -18000 {
                        -1
                    } else if value > 18000 {
                        1
                    } else if value.abs() < 10000 {
                        0
                    } else {
                        stick_x_dir
                    };
                    if dir != stick_x_dir {
                        stick_x_dir = dir;
                        if dir == -1 {
                            emit("left");
                        } else if dir == 1 {
                            emit("right");
                        }
                    }
                }
                // Left Stick Y (`ABS_Y`)
                1 => {
                    let dir = if value < -18000 {
                        -1
                    } else if value > 18000 {
                        1
                    } else if value.abs() < 10000 {
                        0
                    } else {
                        stick_y_dir
                    };
                    if dir != stick_y_dir {
                        stick_y_dir = dir;
                        if dir == -1 {
                            emit("up");
                        } else if dir == 1 {
                            emit("down");
                        }
                    }
                }
                // Left Trigger (`ABS_Z`)
                2 => {
                    if value > 16000 && !l2_pressed {
                        l2_pressed = true;
                        emit("l2");
                    } else if value < 4000 {
                        l2_pressed = false;
                    }
                }
                // Right Stick Y (`ABS_RY` = 4)
                4 => {
                    if value.abs() > 22000 && last_vol_tick.elapsed() >= Duration::from_millis(140)
                    {
                        last_vol_tick = Instant::now();
                        if value < 0 {
                            emit("vol_up");
                        } else {
                            emit("vol_down");
                        }
                    }
                }
                // Right Trigger (`ABS_RZ` = 5)
                5 => {
                    if value > 16000 && !r2_pressed {
                        r2_pressed = true;
                        emit("r2");
                    } else if value < 4000 {
                        r2_pressed = false;
                    }
                }
                // D-Pad Hat0X (`ABS_HAT0X` = 6)
                6 => {
                    let dir = if value < -10000 {
                        -1
                    } else if value > 10000 {
                        1
                    } else {
                        0
                    };
                    if dir != hat_x_dir {
                        hat_x_dir = dir;
                        if dir == -1 {
                            emit("left");
                        } else if dir == 1 {
                            emit("right");
                        }
                    }
                }
                // D-Pad Hat0Y (`ABS_HAT0Y` = 7)
                7 => {
                    let dir = if value < -10000 {
                        -1
                    } else if value > 10000 {
                        1
                    } else {
                        0
                    };
                    if dir != hat_y_dir {
                        hat_y_dir = dir;
                        if dir == -1 {
                            emit("up");
                        } else if dir == 1 {
                            emit("down");
                        }
                    }
                }
                _ => {}
            }
        }
    }
}
