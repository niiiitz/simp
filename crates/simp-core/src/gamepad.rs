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
const JSIOCGBTNMAP: libc::Ioctl = 0x84006a34u32 as libc::Ioctl;
#[cfg(target_os = "linux")]
const JSIOCGBTNMAP_LEGACY: libc::Ioctl = 0x80406a34u32 as libc::Ioctl;

/// Linux `evdev` ioctl `EVIOCGABS(axis)` (`_IOR('E', 0x40 + axis, struct input_absinfo)`)
#[cfg(target_os = "linux")]
const fn eviocgabs(axis: u8) -> libc::Ioctl {
    (0x80184540u32 + (axis as u32)) as libc::Ioctl
}

#[cfg(any(target_os = "linux", test))]
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
    // If this input device already exposes a `js*` joydev node that is readable by our process,
    // let `read_joystick_loop` handle it so we never emit duplicate events for the same controller.
    // (If `/dev/input/js*` exists but lacks user ACL read permission while `/dev/input/event*` has `uaccess`,
    // do not skip `event*`!)
    if let Ok(entries) = std::fs::read_dir(&dev_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name();
            let s = fname.to_string_lossy();
            if s.starts_with("js") && File::open(format!("/dev/input/{s}")).is_ok() {
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

/// Spawns a lightweight Linux `/dev/input/js*` + `/dev/input/event*` (`evdev`) + Steam Deck `/dev/hidraw*`
/// gamepad reader thread so standalone windows, Firefox, KDE Plasma Desktop Mode, and SteamVR Desktop views
/// on Steam Deck and Steam Frame (`aarch64`) receive controller navigation and transport actions over the
/// local WebSocket (`PlaybackEvent::GamepadInput`).
pub fn spawn_linux_gamepad_reader(broadcast_tx: broadcast::Sender<PlaybackEvent>) {
    #[cfg(target_os = "macos")]
    {
        macos_iokit::spawn_macos_iokit_gamepad_reader(broadcast_tx);
        return;
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let _ = broadcast_tx;
    #[cfg(target_os = "linux")]
    {
        let active_js: Arc<Mutex<HashSet<usize>>> = Arc::new(Mutex::new(HashSet::new()));
        let active_ev: Arc<Mutex<HashSet<usize>>> = Arc::new(Mutex::new(HashSet::new()));
        let active_hidraw: Arc<Mutex<HashSet<usize>>> = Arc::new(Mutex::new(HashSet::new()));
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

                // 3. Scan `/dev/hidraw0`..`hidraw15` for Valve Steam Deck / Steam Controller (`28DE:1205`)
                // when Steam's desktop client holds `client_hdev` open in KDE Plasma Desktop Mode
                // (where `hid-steam.c` unregisters `evdev` and Steam Input's Desktop Action Set swallows `BTN_START`).
                for idx in 0..16usize {
                    let dev_path = format!("/dev/hidraw{idx}");
                    if !Path::new(&dev_path).exists() || !is_steam_deck_hidraw_candidate(idx) {
                        continue;
                    }

                    {
                        let mut guard = match active_hidraw.lock() {
                            Ok(g) => g,
                            Err(_) => continue,
                        };
                        if guard.contains(&idx) {
                            continue;
                        }
                        guard.insert(idx);
                    }

                    let bcast = broadcast_tx.clone();
                    let active_clone = active_hidraw.clone();
                    let _ = std::thread::Builder::new()
                        .name(format!("simp-hidraw{idx}"))
                        .spawn(move || {
                            read_steam_deck_hidraw_loop(idx, &dev_path, bcast);
                            if let Ok(mut g) = active_clone.lock() {
                                g.remove(&idx);
                            }
                        });
                }

                std::thread::sleep(Duration::from_secs(3));
            });
    }
}

#[cfg(any(target_os = "linux", test))]
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
            || libc::ioctl(file.as_raw_fd(), JSIOCGBTNMAP_LEGACY, raw_btn_map.as_mut_ptr()) >= 0
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

#[cfg(any(target_os = "linux", test))]
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

/// Checks whether `/dev/hidraw{idx}` is a Valve Steam Deck (`28DE:1205`) or Steam Controller
/// (`28DE:1102` / `28DE:1142`) `client_hdev` node that is ALREADY opened by another process (such as
/// the Steam client in KDE Plasma Desktop Mode).
///
/// Safety invariant: We only attach to `/dev/hidraw{idx}` when another process already holds it open
/// (`steam->client_opened > 0`), so SIMP never causes `hid-steam.c` to unregister the kernel `evdev`
/// gamepad when Steam is closed.
#[cfg(target_os = "linux")]
fn is_steam_deck_hidraw_candidate(idx: usize) -> bool {
    let uevent_path = format!("/sys/class/hidraw/hidraw{idx}/device/uevent");
    let uevent = match std::fs::read_to_string(&uevent_path) {
        Ok(s) => s.to_uppercase(),
        Err(_) => return false,
    };
    let is_valve_deck_or_sc = uevent.contains("28DE:00001205")
        || uevent.contains("28DE:00001102")
        || uevent.contains("28DE:00001142");
    if !is_valve_deck_or_sc {
        return false;
    }
    is_hidraw_opened_by_other_process(idx)
}

#[cfg(target_os = "linux")]
fn is_hidraw_opened_by_other_process(idx: usize) -> bool {
    let target = format!("/dev/hidraw{idx}");
    let self_pid = std::process::id().to_string();
    let proc_entries = match std::fs::read_dir("/proc") {
        Ok(e) => e,
        Err(_) => return false,
    };
    for entry in proc_entries.flatten() {
        let fname = entry.file_name();
        let pid_str = fname.to_string_lossy();
        if pid_str == self_pid || !pid_str.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let fd_dir = format!("/proc/{pid_str}/fd");
        if let Ok(fds) = std::fs::read_dir(&fd_dir) {
            for fd in fds.flatten() {
                if let Ok(link) = std::fs::read_link(fd.path()) {
                    if link.to_string_lossy() == target {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// Extracts the physical `BTN_START` (`Menu ☰`, byte 9 bit 6 = `0x40`) state from a 64-byte
/// Valve Steam Deck (`ID_CONTROLLER_DECK_STATE = 0x09`) or Steam Controller (`ID_CONTROLLER_STATE = 0x01`)
/// raw HID input report (`drivers/hid/hid-steam.c` `steam_do_deck_input_event`).
#[cfg(any(target_os = "linux", test))]
pub fn extract_steam_deck_hidraw_start_pressed(report: &[u8]) -> Option<bool> {
    if report.len() < 16 || report[0] != 0x01 || report[1] != 0x00 {
        return None;
    }
    // `0x09` = `ID_CONTROLLER_DECK_STATE`, `0x01` = `ID_CONTROLLER_STATE`
    if report[2] != 0x09 && report[2] != 0x01 {
        return None;
    }
    let b9 = report[9];
    Some((b9 & 0x40) != 0)
}

#[cfg(target_os = "linux")]
fn read_steam_deck_hidraw_loop(
    idx: usize,
    dev_path: &str,
    broadcast_tx: broadcast::Sender<PlaybackEvent>,
) {
    let mut file = match File::open(dev_path) {
        Ok(f) => f,
        Err(_) => return,
    };

    tracing::info!(
        "Linux Steam Deck hidraw reader attached to {dev_path} (hidraw{idx}) for KDE Desktop Mode BTN_START"
    );

    let mut buf = [0u8; 64];
    let mut prev_start = false;
    let mut last_client_check = Instant::now();

    while let Ok(n) = file.read(&mut buf) {
        if n == 0 {
            break;
        }
        if last_client_check.elapsed() >= Duration::from_secs(3) {
            last_client_check = Instant::now();
            if !is_hidraw_opened_by_other_process(idx) {
                tracing::info!(
                    "Steam client closed {dev_path}; releasing SIMP hidraw handle so kernel evdev can resume"
                );
                break;
            }
        }
        if let Some(start_pressed) = extract_steam_deck_hidraw_start_pressed(&buf[..n]) {
            if start_pressed && !prev_start {
                let _ = broadcast_tx.send(PlaybackEvent::GamepadInput {
                    action: "power".to_string(),
                });
            }
            prev_start = start_pressed;
        }
    }
}

#[cfg(any(target_os = "macos", test))]
pub fn map_hid_button_usage_to_action(usage_page: u32, usage: u32) -> Option<&'static str> {
    match usage_page {
        0x09 => match usage {
            1 => Some("activate"),   // A / Cross
            2 => Some("back"),       // B / Circle
            3 => Some("shuffle"),    // X / Square
            4 => Some("repeat"),     // Y / Triangle
            5 => Some("l1"),         // L1 / LB
            6 => Some("r1"),         // R1 / RB
            7 => Some("l2"),         // L2 / LT (digital)
            8 => Some("r2"),         // R2 / RT (digital)
            9 | 11 => Some("sources"), // Select / View / Share
            10 | 12 => Some("power"),  // Start / Menu / Options (leave 13/14 Home/Guide unbound for OS)
            _ => None,
        },
        0x01 => match usage {
            0x90 => Some("up"),             // D-pad Up
            0x91 => Some("down"),           // D-pad Down
            0x92 => Some("right"),          // D-pad Right
            0x93 => Some("left"),           // D-pad Left
            _ => None,
        },
        0x0C => match usage {
            0x0040 | 0x0041 => Some("power"),   // Consumer Menu (Xbox Series Bluetooth Start)
            0x0224 | 0x00B2 => Some("sources"), // Consumer AC Back / Record (Xbox View/Share)
            _ => None,
        },
        _ => None,
    }
}

/// Maps an 8-way HID Hat Switch integer value (`0..=7` or `1..=8` within `logical_min..=logical_max`)
/// to `(dx, dy)` in `-1..=1`. Returns `(0, 0)` when centered/neutral.
#[cfg(any(target_os = "macos", test))]
pub fn map_hid_hat_switch_to_dir(val: isize, min: isize, max: isize) -> (i8, i8) {
    if max <= min || val < min || val > max {
        return (0, 0);
    }
    let idx = val - min;
    match idx {
        0 => (0, -1),  // N  (Up)
        1 => (1, -1),  // NE (Up-Right)
        2 => (1, 0),   // E  (Right)
        3 => (1, 1),   // SE (Down-Right)
        4 => (0, 1),   // S  (Down)
        5 => (-1, 1),  // SW (Down-Left)
        6 => (-1, 0),  // W  (Left)
        7 => (-1, -1), // NW (Up-Left)
        _ => (0, 0),
    }
}

#[cfg(target_os = "macos")]
mod macos_iokit {
    use super::*;
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::runloop::{kCFRunLoopDefaultMode, CFRunLoop};
    use core_foundation::string::CFString;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::sync::Mutex;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOHIDManagerCreate(allocator: *const c_void, options: u32) -> *mut c_void;
        fn IOHIDManagerSetDeviceMatchingMultiple(manager: *mut c_void, multiple: *const c_void);
        fn IOHIDManagerRegisterInputValueCallback(
            manager: *mut c_void,
            callback: extern "C" fn(*mut c_void, i32, *mut c_void, *mut c_void),
            context: *mut c_void,
        );
        fn IOHIDManagerScheduleWithRunLoop(
            manager: *mut c_void,
            run_loop: *mut c_void,
            run_loop_mode: *const c_void,
        );
        fn IOHIDManagerOpen(manager: *mut c_void, options: u32) -> i32;

        fn IOHIDValueGetElement(value: *mut c_void) -> *mut c_void;
        fn IOHIDValueGetIntegerValue(value: *mut c_void) -> isize;
        fn IOHIDElementGetUsagePage(element: *mut c_void) -> u32;
        fn IOHIDElementGetUsage(element: *mut c_void) -> u32;
        fn IOHIDElementGetLogicalMin(element: *mut c_void) -> isize;
        fn IOHIDElementGetLogicalMax(element: *mut c_void) -> isize;
    }

    struct MacGamepadState {
        broadcast_tx: broadcast::Sender<PlaybackEvent>,
        button_states: HashMap<(u32, u32), bool>,
        hat_dir: (i8, i8),
        stick_x_dir: i8,
        stick_y_dir: i8,
        lt_pressed: bool,
        rt_pressed: bool,
    }

    extern "C" fn hid_input_value_callback(
        context: *mut c_void,
        _result: i32,
        _sender: *mut c_void,
        value: *mut c_void,
    ) {
        if context.is_null() || value.is_null() {
            return;
        }
        unsafe {
            let elem = IOHIDValueGetElement(value);
            if elem.is_null() {
                return;
            }
            let usage_page = IOHIDElementGetUsagePage(elem);
            let usage = IOHIDElementGetUsage(elem);
            let raw_val = IOHIDValueGetIntegerValue(value);
            let min_val = IOHIDElementGetLogicalMin(elem);
            let max_val = IOHIDElementGetLogicalMax(elem);

            let state_mutex = &*(context as *const Mutex<MacGamepadState>);
            let Ok(mut st) = state_mutex.lock() else {
                return;
            };

            // 1. Digital buttons (`kHIDPage_Button = 0x09`, `kHIDPage_Consumer = 0x0C`, or D-Pad discrete usages)
            if let Some(action) = map_hid_button_usage_to_action(usage_page, usage) {
                let pressed = raw_val > 0;
                let prev = st.button_states.insert((usage_page, usage), pressed).unwrap_or(false);
                if pressed && !prev {
                    let _ = st.broadcast_tx.send(PlaybackEvent::GamepadInput {
                        action: action.to_string(),
                    });
                }
                return;
            }

            if usage_page != 0x01 && usage_page != 0x02 {
                return;
            }

            // 2. 8-Way Hat Switch D-Pad (`kHIDUsage_GD_Hatswitch = 0x39`)
            if usage_page == 0x01 && usage == 0x39 {
                let (nx, ny) = map_hid_hat_switch_to_dir(raw_val, min_val, max_val);
                let (px, py) = st.hat_dir;
                st.hat_dir = (nx, ny);
                if nx != px && nx != 0 {
                    let act = if nx < 0 { "left" } else { "right" };
                    let _ = st.broadcast_tx.send(PlaybackEvent::GamepadInput {
                        action: act.to_string(),
                    });
                }
                if ny != py && ny != 0 {
                    let act = if ny < 0 { "up" } else { "down" };
                    let _ = st.broadcast_tx.send(PlaybackEvent::GamepadInput {
                        action: act.to_string(),
                    });
                }
                return;
            }

            // 3. Left Thumbstick X (`0x30`) and Y (`0x31`) with deadzone hysteresis
            if usage_page == 0x01 && (usage == 0x30 || usage == 0x31) && max_val > min_val {
                let span = (max_val - min_val) as f64;
                let norm = (((raw_val - min_val) as f64 / span) * 2.0) - 1.0; // -1.0 .. 1.0
                if usage == 0x30 {
                    let next_dir = if norm <= -0.52 {
                        -1
                    } else if norm >= 0.52 {
                        1
                    } else if norm.abs() < 0.28 {
                        0
                    } else {
                        st.stick_x_dir
                    };
                    if next_dir != st.stick_x_dir {
                        st.stick_x_dir = next_dir;
                        if next_dir < 0 {
                            let _ = st.broadcast_tx.send(PlaybackEvent::GamepadInput {
                                action: "left".to_string(),
                            });
                        } else if next_dir > 0 {
                            let _ = st.broadcast_tx.send(PlaybackEvent::GamepadInput {
                                action: "right".to_string(),
                            });
                        }
                    }
                } else {
                    let next_dir = if norm <= -0.52 {
                        -1
                    } else if norm >= 0.52 {
                        1
                    } else if norm.abs() < 0.28 {
                        0
                    } else {
                        st.stick_y_dir
                    };
                    if next_dir != st.stick_y_dir {
                        st.stick_y_dir = next_dir;
                        if next_dir < 0 {
                            let _ = st.broadcast_tx.send(PlaybackEvent::GamepadInput {
                                action: "up".to_string(),
                            });
                        } else if next_dir > 0 {
                            let _ = st.broadcast_tx.send(PlaybackEvent::GamepadInput {
                                action: "down".to_string(),
                            });
                        }
                    }
                }
                return;
            }

            // 4. Analog Triggers (`Z = 0x32` / `Brake = 0xC5` for L2/LT, `Rz = 0x35` / `Accelerator = 0xC4` for R2/RT)
            if max_val > min_val {
                let ratio = (raw_val - min_val) as f64 / (max_val - min_val) as f64;
                if (usage_page == 0x01 && usage == 0x32) || (usage_page == 0x02 && usage == 0xC5) {
                    if ratio > 0.65 && !st.lt_pressed {
                        st.lt_pressed = true;
                        let _ = st.broadcast_tx.send(PlaybackEvent::GamepadInput {
                            action: "l2".to_string(),
                        });
                    } else if ratio < 0.30 {
                        st.lt_pressed = false;
                    }
                } else if (usage_page == 0x01 && usage == 0x35)
                    || (usage_page == 0x02 && usage == 0xC4)
                {
                    if ratio > 0.65 && !st.rt_pressed {
                        st.rt_pressed = true;
                        let _ = st.broadcast_tx.send(PlaybackEvent::GamepadInput {
                            action: "r2".to_string(),
                        });
                    } else if ratio < 0.30 {
                        st.rt_pressed = false;
                    }
                }
            }
        }
    }

    fn make_matching_dict(usage_page: i32, usage: i32) -> CFDictionary<CFString, CFType> {
        let k_page = CFString::from_static_string("DeviceUsagePage");
        let k_usage = CFString::from_static_string("DeviceUsage");
        let v_page = CFNumber::from(usage_page).as_CFType();
        let v_usage = CFNumber::from(usage).as_CFType();
        CFDictionary::from_CFType_pairs(&[(k_page, v_page), (k_usage, v_usage)])
    }

    pub fn spawn_macos_iokit_gamepad_reader(broadcast_tx: broadcast::Sender<PlaybackEvent>) {
        let _ = std::thread::Builder::new()
            .name("simp-macos-iokit-gamepad".to_string())
            .spawn(move || unsafe {
                let mgr = IOHIDManagerCreate(std::ptr::null(), 0);
                if mgr.is_null() {
                    return;
                }

                // Match GenericDesktop (0x01): Joystick (0x04), GamePad (0x05), MultiAxisController (0x08)
                let d_gamepad = make_matching_dict(0x01, 0x05);
                let d_joystick = make_matching_dict(0x01, 0x04);
                let d_multiaxis = make_matching_dict(0x01, 0x08);
                let criteria = CFArray::from_CFTypes(&[
                    d_gamepad.as_CFType(),
                    d_joystick.as_CFType(),
                    d_multiaxis.as_CFType(),
                ]);

                IOHIDManagerSetDeviceMatchingMultiple(mgr, criteria.as_concrete_TypeRef() as *const c_void);

                let ctx = Box::into_raw(Box::new(Mutex::new(MacGamepadState {
                    broadcast_tx,
                    button_states: HashMap::new(),
                    hat_dir: (0, 0),
                    stick_x_dir: 0,
                    stick_y_dir: 0,
                    lt_pressed: false,
                    rt_pressed: false,
                })));

                IOHIDManagerRegisterInputValueCallback(
                    mgr,
                    hid_input_value_callback,
                    ctx as *mut c_void,
                );
                let rl = CFRunLoop::get_current();
                IOHIDManagerScheduleWithRunLoop(
                    mgr,
                    rl.as_concrete_TypeRef() as *mut c_void,
                    kCFRunLoopDefaultMode as *const c_void,
                );

                if IOHIDManagerOpen(mgr, 0) == 0 {
                    tracing::info!("macOS IOKit IOHIDManager gamepad reader active (Xbox / DualSense / 8BitDo)");
                    CFRunLoop::run_current();
                }
            });
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

        let mut report = [0u8; 64];
        report[0] = 0x01;
        report[1] = 0x00;
        report[2] = 0x09; // ID_CONTROLLER_DECK_STATE
        assert_eq!(extract_steam_deck_hidraw_start_pressed(&report), Some(false));
        report[9] = 0x40; // BIT(6) = BTN_START
        assert_eq!(extract_steam_deck_hidraw_start_pressed(&report), Some(true));

        // Verify macOS IOKit HID button & hat-switch normalization
        assert_eq!(map_hid_button_usage_to_action(0x09, 1), Some("activate"));
        assert_eq!(map_hid_button_usage_to_action(0x09, 2), Some("back"));
        assert_eq!(map_hid_button_usage_to_action(0x09, 3), Some("shuffle"));
        assert_eq!(map_hid_button_usage_to_action(0x09, 4), Some("repeat"));
        assert_eq!(map_hid_button_usage_to_action(0x09, 5), Some("l1"));
        assert_eq!(map_hid_button_usage_to_action(0x09, 6), Some("r1"));
        assert_eq!(map_hid_button_usage_to_action(0x09, 10), Some("power"));
        assert_eq!(map_hid_button_usage_to_action(0x09, 13), None);
        assert_eq!(map_hid_button_usage_to_action(0x0C, 0x0040), Some("power"));
        assert_eq!(map_hid_hat_switch_to_dir(0, 0, 7), (0, -1));
        assert_eq!(map_hid_hat_switch_to_dir(2, 0, 7), (1, 0));
        assert_eq!(map_hid_hat_switch_to_dir(4, 0, 7), (0, 1));
        assert_eq!(map_hid_hat_switch_to_dir(6, 0, 7), (-1, 0));
        assert_eq!(map_hid_hat_switch_to_dir(8, 0, 7), (0, 0));
    }
}
