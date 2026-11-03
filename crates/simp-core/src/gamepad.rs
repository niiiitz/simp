use simp_protocol::PlaybackEvent;
use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

/// Spawns a lightweight Linux `/dev/input/js*` gamepad reader thread so standalone KDE Plasma
/// windows (including Flatpak browsers whose sandbox hides `/dev/input`) receive controller
/// navigation and transport actions over the local WebSocket (`PlaybackEvent::GamepadInput`).
pub fn spawn_linux_gamepad_reader(broadcast_tx: broadcast::Sender<PlaybackEvent>) {
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
                    let sys_name_path = format!("/sys/class/input/js{idx}/device/name");
                    if let Ok(name) = std::fs::read_to_string(&sys_name_path) {
                        let lower = name.to_lowercase();
                        if lower.contains("motion")
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
fn read_joystick_loop(idx: usize, dev_path: &str, broadcast_tx: broadcast::Sender<PlaybackEvent>) {
    let mut file = match File::open(dev_path) {
        Ok(f) => f,
        Err(_) => return,
    };

    tracing::info!("Linux gamepad reader attached to {dev_path} (js{idx})");

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
                let action = match number {
                    0 => Some("activate"), // A / Cross
                    1 => Some("back"),     // B / Circle
                    2 => Some("shuffle"),  // X / Square
                    3 => Some("repeat"),   // Y / Triangle
                    4 => Some("l1"),       // L1 / LB
                    5 => Some("r1"),       // R1 / RB
                    6 => Some("sources"),  // Select / View
                    7 => Some("power"),    // Start / Menu
                    11 => Some("left"),    // D-Pad Left (button-mapped)
                    12 => Some("right"),   // D-Pad Right (button-mapped)
                    13 => Some("up"),      // D-Pad Up (button-mapped)
                    14 => Some("down"),    // D-Pad Down (button-mapped)
                    _ => None,
                };
                if let Some(act) = action {
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

