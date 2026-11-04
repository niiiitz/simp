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

/// Linux `evdev` ioctl `EVIOCGABS(axis)` (`_IOR('E', 0x40 + axis, struct input_absinfo)`)
#[cfg(target_os = "linux")]
const fn eviocgabs(axis: u8) -> libc::Ioctl {
    (0x80184540u32 + (axis as u32)) as libc::Ioctl
}

#[cfg(target_os = "linux")]
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct InputAbsInfo {
    value: i32,
    minimum: i32,
    maximum: i32,
    fuzz: i32,
    flat: i32,
    resolution: i32,
}

#[cfg(target_os = "linux")]
fn is_ignored_sensor_or_keyboard_name(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    lower.contains("motion sensor")
        || lower.contains("sensor")
        || lower.contains("imu")
        || lower.contains("accel")
        || lower.contains("gyro")
        || lower.contains("touchpad")
        || lower.contains("trackpad")
        || lower.contains("mouse")
        || lower.contains("keyboard")
        || lower.contains("power button")
        || lower.contains("sleep button")
        || lower.contains("video bus")
        || lower.contains("hdmi")
        || lower.contains("headphone")
        || lower.contains("microphone")
        || lower.contains("alsa")
        || lower.contains("speaker")
}

/// Checks `/sys/class/input/event{idx}/device/capabilities/key` or device name to determine
/// whether an `evdev` node is a gamepad / Steam Input virtual controller / VR controller in Gamepad mode.
#[cfg(target_os = "linux")]
fn is_evdev_gamepad_candidate(idx: usize) -> bool {
    let dev_dir = format!("/sys/class/input/event{idx}/device");
    // If this input device already exposes a `js*` joydev node that is readable, let `read_joystick_loop` handle it
    // so we never emit duplicate events for the same physical/virtual controller.
    if let Ok(entries) = std::fs::read_dir(&dev_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name();
            let s = fname.to_string_lossy();
            if s.starts_with("js") && Path::new(&format!("/dev/input/{s}")).exists() {
                return false;
            }
        }
    }

    let name = std::fs::read_to_string(format!("{dev_dir}/name")).unwrap_or_default();
    if is_ignored_sensor_or_keyboard_name(&name) {
        return false;
    }

    let lower = name.to_lowercase();
    if lower.contains("gamepad")
        || lower.contains("controller")
        || lower.contains("x-box")
        || lower.contains("xbox")
        || lower.contains("steam")
        || lower.contains("deck")
        || lower.contains("dualsense")
        || lower.contains("dualshock")
        || lower.contains("8bitdo")
    {
        return true;
    }

    // Also inspect the hex key capability bitmap for `BTN_SOUTH` (`0x130` = bit 304) or `BTN_DPAD_UP` (`0x220` = bit 544)
    if let Ok(key_caps) = std::fs::read_to_string(format!("{dev_dir}/capabilities/key")) {
        let words: Vec<u64> = key_caps
            .split_whitespace()
            .rev()
            .filter_map(|w| u64::from_str_radix(w, 16).ok())
            .collect();
        let has_bit = |bit: usize| -> bool {
            let word_idx = bit / 64;
            let bit_idx = bit % 64;
            words
                .get(word_idx)
                .map(|w| (w & (1u64 << bit_idx)) != 0)
                .unwrap_or(false)
        };
        // BTN_SOUTH = 0x130 (304), BTN_GAMEPAD = 0x130, BTN_DPAD_UP = 0x220 (544), BTN_TRIGGER = 0x120 (288)
        if has_bit(0x130) || has_bit(0x220) || has_bit(0x120) {
            return true;
        }
    }

    false
}

/// Spawns a lightweight Linux `/dev/input/js*` + `/dev/input/event*` (`evdev`) gamepad reader thread
/// so standalone windows, Firefox, and SteamVR Desktop views on Steam Deck and Steam Frame (`aarch64`)
/// receive controller navigation and transport actions over the local WebSocket (`PlaybackEvent::GamepadInput`).
pub fn spawn_linux_gamepad_reader(broadcast_tx: broadcast::Sender<PlaybackEvent>) {
    #[cfg(not(target_os = "linux"))]
    let _ = broadcast_tx;
    #[cfg(target_os = "linux")]
    {
        let active_js: Arc<Mutex<HashSet<usize>>> = Arc::new(Mutex::new(HashSet::new()));
        let active_ev: Arc<Mutex<HashSet<usize>>> = Arc::new(Mutex::new(HashSet::new()));
        let _ = std::thread::Builder::new()
            .name("simp-linux-gamepad-discovery".to_string())
            .spawn(move || loop {
                // 1. Scan `/dev/input/js0`..`js15` (`joydev` nodes)
                for idx in 0..16usize {
                    let dev_path = format!("/dev/input/js{idx}");
                    if !Path::new(&dev_path).exists() {
                        continue;
                    }

                    let sys_name_path = format!("/sys/class/input/js{idx}/device/name");
                    if let Ok(name) = std::fs::read_to_string(&sys_name_path) {
                        if is_ignored_sensor_or_keyboard_name(&name) {
                            continue;
                        }
                    }

                    {
                        let mut guard = match active_js.lock() {
                            Ok(g) => g,
                            Err(_) => continue,
                        };
                        if guard.contains(&idx) {
                            continue;
                        }
                        guard.insert(idx);
                    }

                    let bcast = broadcast_tx.clone();
                    let active_clone = active_js.clone();
                    let _ = std::thread::Builder::new()
                        .name(format!("simp-js{idx}"))
                        .spawn(move || {
                            read_joystick_loop(idx, &dev_path, bcast);
                            if let Ok(mut g) = active_clone.lock() {
                                g.remove(&idx);
                            }
                        });
                }

                // 2. Scan `/dev/input/event0`..`event31` (`evdev` nodes for kernels/SteamVR without `joydev`)
                for idx in 0..32usize {
                    let dev_path = format!("/dev/input/event{idx}");
                    if !Path::new(&dev_path).exists() || !is_evdev_gamepad_candidate(idx) {
                        continue;
                    }

                    {
                        let mut guard = match active_ev.lock() {
                            Ok(g) => g,
                            Err(_) => continue,
                        };
                        if guard.contains(&idx) {
                            continue;
                        }
                        guard.insert(idx);
                    }

                    let bcast = broadcast_tx.clone();
                    let active_clone = active_ev.clone();
                    let _ = std::thread::Builder::new()
                        .name(format!("simp-ev{idx}"))
                        .spawn(move || {
                            read_evdev_loop(idx, &dev_path, bcast);
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
pub fn map_linux_keycode_to_action(code: u16) -> Option<&'static str> {
    match code {
        0x130 | 0x120 => Some("activate"), // BTN_SOUTH (A / Cross) or BTN_TRIGGER
        0x131 | 0x121 => Some("back"),     // BTN_EAST (B / Circle) or BTN_THUMB
        0x132 => Some("shuffle"),          // BTN_C
        0x133 => Some("shuffle"),          // BTN_NORTH (X / Square)
        0x134 => Some("repeat"),           // BTN_WEST (Y / Triangle)
        0x136 => Some("l1"),               // BTN_TL (L1 / LB)
        0x137 => Some("r1"),               // BTN_TR (R1 / RB)
        0x138 => Some("l2"),               // BTN_TL2 (Digital L2)
        0x139 => Some("r2"),               // BTN_TR2 (Digital R2)
        0x13a => Some("sources"),          // BTN_SELECT (Select / View)
        0x13b => Some("power"),            // BTN_START (Start / Menu)
        0x13c => Some("power"),            // BTN_MODE (Guide / Steam)
        0x220 => Some("up"),               // BTN_DPAD_UP
        0x221 => Some("down"),             // BTN_DPAD_DOWN
        0x222 => Some("left"),             // BTN_DPAD_LEFT
        0x223 => Some("right"),            // BTN_DPAD_RIGHT
        _ => None,
    }
}

#[cfg(target_os = "linux")]
fn map_button_index_to_action(number: u8, btn_map: Option<&[u16; 640]>) -> Option<&'static str> {
    if let Some(map) = btn_map {
        let code = map.get(number as usize).copied().unwrap_or(0);
        if let Some(act) = map_linux_keycode_to_action(code) {
            return Some(act);
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
        "Linux joydev reader attached to {dev_path} (js{idx}, kernel_btn_map={has_btn_map})"
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

        if (type_ & 0x80) != 0 {
            continue;
        }

        let ev_type = type_ & 0x7f;
        if ev_type == 0x01 {
            if value == 1 {
                if let Some(act) = map_button_index_to_action(number, btn_map_ref) {
                    emit(act);
                }
            }
        } else if ev_type == 0x02 {
            match number {
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
                2 => {
                    if value > 16000 && !l2_pressed {
                        l2_pressed = true;
                        emit("l2");
                    } else if value < 4000 {
                        l2_pressed = false;
                    }
                }
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
                5 => {
                    if value > 16000 && !r2_pressed {
                        r2_pressed = true;
                        emit("r2");
                    } else if value < 4000 {
                        r2_pressed = false;
                    }
                }
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

#[cfg(target_os = "linux")]
fn normalize_evdev_axis(raw: i32, info: Option<InputAbsInfo>) -> i32 {
    if let Some(ai) = info {
        let span = (ai.maximum as i64) - (ai.minimum as i64);
        if span > 0 {
            let centered = ((raw as i64) - (ai.minimum as i64)) * 65534 / span - 32767;
            return centered.clamp(-32767, 32767) as i32;
        }
    }
    raw
}

#[cfg(target_os = "linux")]
fn read_evdev_loop(idx: usize, dev_path: &str, broadcast_tx: broadcast::Sender<PlaybackEvent>) {
    let mut file = match File::open(dev_path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let fd = file.as_raw_fd();
    let mut abs_info = [None::<InputAbsInfo>; 32];
    for axis in [0u8, 1, 2, 3, 4, 5, 16, 17] {
        let mut info = InputAbsInfo::default();
        let ok = unsafe { libc::ioctl(fd, eviocgabs(axis), &mut info as *mut InputAbsInfo) >= 0 };
        if ok && info.maximum > info.minimum {
            abs_info[axis as usize] = Some(info);
        }
    }

    tracing::info!("Linux evdev gamepad reader attached to {dev_path} (event{idx})");

    // 64-bit Linux `struct input_event` is 24 bytes: `tv_sec: i64, tv_usec: i64, type: u16, code: u16, value: i32`
    let mut buf = [0u8; 24];
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
        let ev_type = u16::from_ne_bytes([buf[16], buf[17]]);
        let code = u16::from_ne_bytes([buf[18], buf[19]]);
        let value = i32::from_ne_bytes([buf[20], buf[21], buf[22], buf[23]]);

        if ev_type == 0x01 {
            // EV_KEY (value == 1 on button press)
            if value == 1 {
                if let Some(act) = map_linux_keycode_to_action(code) {
                    emit(act);
                }
            }
        } else if ev_type == 0x03 {
            // EV_ABS
            match code {
                // ABS_X (0x00)
                0x00 => {
                    let norm = normalize_evdev_axis(value, abs_info[0]);
                    let dir = if norm < -18000 {
                        -1
                    } else if norm > 18000 {
                        1
                    } else if norm.abs() < 10000 {
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
                // ABS_Y (0x01)
                0x01 => {
                    let norm = normalize_evdev_axis(value, abs_info[1]);
                    let dir = if norm < -18000 {
                        -1
                    } else if norm > 18000 {
                        1
                    } else if norm.abs() < 10000 {
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
                // ABS_Z (0x02) — Left Trigger
                0x02 => {
                    let norm = normalize_evdev_axis(value, abs_info[2]);
                    if norm > 8000 && !l2_pressed {
                        l2_pressed = true;
                        emit("l2");
                    } else if norm < -10000 {
                        l2_pressed = false;
                    }
                }
                // ABS_RY (0x04) — Right Stick Y
                0x04 => {
                    let norm = normalize_evdev_axis(value, abs_info[4]);
                    if norm.abs() > 22000 && last_vol_tick.elapsed() >= Duration::from_millis(140) {
                        last_vol_tick = Instant::now();
                        if norm < 0 {
                            emit("vol_up");
                        } else {
                            emit("vol_down");
                        }
                    }
                }
                // ABS_RZ (0x05) — Right Trigger
                0x05 => {
                    let norm = normalize_evdev_axis(value, abs_info[5]);
                    if norm > 8000 && !r2_pressed {
                        r2_pressed = true;
                        emit("r2");
                    } else if norm < -10000 {
                        r2_pressed = false;
                    }
                }
                // ABS_HAT0X (0x10 = 16) — D-Pad Left/Right
                0x10 => {
                    let dir = if value < 0 {
                        -1
                    } else if value > 0 {
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
                // ABS_HAT0Y (0x11 = 17) — D-Pad Up/Down
                0x11 => {
                    let dir = if value < 0 {
                        -1
                    } else if value > 0 {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_evdev_keycode_and_axis_normalization() {
        assert_eq!(map_linux_keycode_to_action(0x130), Some("activate"));
        assert_eq!(map_linux_keycode_to_action(0x131), Some("back"));
        assert_eq!(map_linux_keycode_to_action(0x220), Some("up"));
        assert_eq!(map_linux_keycode_to_action(0x223), Some("right"));

        let info = InputAbsInfo {
            value: 0,
            minimum: 0,
            maximum: 255,
            fuzz: 0,
            flat: 0,
            resolution: 0,
        };
        assert!(normalize_evdev_axis(0, Some(info)) <= -32760);
        assert!(normalize_evdev_axis(255, Some(info)) >= 32760);
        assert!(normalize_evdev_axis(128, Some(info)).abs() < 300);
    }
}
