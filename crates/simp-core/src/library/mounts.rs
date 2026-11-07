use simp_protocol::PowerState;
#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "linux")]
use std::path::Path;
use std::path::PathBuf;

/// Discovers mounted removable USB / MicroSD drives under `/run/media/$USER/`,
/// `/run/media/mmcblk0p1` (SteamOS / Bazzite / Linux), and `D:\`..`Z:\` (`DRIVE_REMOVABLE` on Windows).
/// On macOS, `/Volumes` is intentionally not auto-scanned during onboarding because `/Volumes`
/// includes Time Machine local snapshots (`.timemachine` / `com.apple.TimeMachine.localsnapshots`),
/// backup drives, and mounted `.dmg` installer images; macOS users start with `~/Music` by default
/// and can add any additional folders explicitly.
pub fn discover_removable_mounts() -> Vec<(PathBuf, String)> {
    #[allow(unused_mut)]
    let mut mounts = Vec::new();

    #[cfg(target_os = "linux")]
    {
        // Check /run/media/$USER/<label>
        if let Ok(user) = std::env::var("USER") {
            let user_media = PathBuf::from("/run/media").join(user);
            collect_subdirs(&user_media, &mut mounts);
        }

        // Also check /run/media/deck/<label> for SteamOS standard user
        let deck_media = PathBuf::from("/run/media/deck");
        collect_subdirs(&deck_media, &mut mounts);

        // Check legacy SteamOS MicroSD direct mount
        let sd_direct = PathBuf::from("/run/media/mmcblk0p1");
        if sd_direct.is_dir() && !mounts.iter().any(|(p, _)| p == &sd_direct) {
            mounts.push((sd_direct, "MicroSD Card".to_string()));
        }
    }

    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn GetDriveTypeW(lp_root_path_name: *const u16) -> u32;
            fn GetVolumeInformationW(
                lp_root_path_name: *const u16,
                lp_volume_name_buffer: *mut u16,
                n_volume_name_size: u32,
                lp_volume_serial_number: *mut u32,
                lp_maximum_component_length: *mut u32,
                lp_file_system_flags: *mut u32,
                lp_file_system_name_buffer: *mut u16,
                n_file_system_name_size: u32,
            ) -> i32;
        }
        const DRIVE_REMOVABLE: u32 = 2;

        for letter in b'D'..=b'Z' {
            let ch = letter as char;
            let root_wide: [u16; 4] = [ch as u16, b':' as u16, b'\\' as u16, 0];
            let dtype = unsafe { GetDriveTypeW(root_wide.as_ptr()) };
            // Only auto-mount genuine removable USB / SD card media (DRIVE_REMOVABLE = 2).
            // Never auto-index fixed internal drives (DRIVE_FIXED = 3, e.g. D:\) or optical drives (DRIVE_CDROM = 5).
            if dtype != DRIVE_REMOVABLE {
                continue;
            }
            let drive = format!("{ch}:\\");
            let path = PathBuf::from(&drive);
            if path.is_dir() {
                let mut vol_buf = [0u16; 128];
                let ok = unsafe {
                    GetVolumeInformationW(
                        root_wide.as_ptr(),
                        vol_buf.as_mut_ptr(),
                        vol_buf.len() as u32,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        0,
                    )
                };
                let vol_name = if ok != 0 {
                    let len = vol_buf.iter().position(|&c| c == 0).unwrap_or(0);
                    String::from_utf16_lossy(&vol_buf[..len]).trim().to_string()
                } else {
                    String::new()
                };
                let label = if vol_name.is_empty() {
                    format!("Removable Drive ({ch}:)")
                } else {
                    format!("{vol_name} ({ch}:)")
                };
                mounts.push((path, label));
            }
        }
    }

    mounts
}

/// Returns `true` on Windows if `mount_root` is a bare drive root (`D:\`..`Z:\`) whose
/// Win32 drive type is NOT `DRIVE_REMOVABLE` (e.g. a fixed internal drive `DRIVE_FIXED` or optical drive `DRIVE_CDROM`).
#[cfg(target_os = "windows")]
pub fn is_windows_non_removable_drive_root(mount_root: &str) -> bool {
    extern "system" {
        fn GetDriveTypeW(lp_root_path_name: *const u16) -> u32;
    }
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_NO_ROOT_DIR: u32 = 1;

    let trimmed = mount_root.trim();
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes.len() == 2 || (bytes.len() == 3 && (bytes[2] == b'\\' || bytes[2] == b'/')))
    {
        let ch = (bytes[0] as char).to_ascii_uppercase();
        let root_wide: [u16; 4] = [ch as u16, b':' as u16, b'\\' as u16, 0];
        let dtype = unsafe { GetDriveTypeW(root_wide.as_ptr()) };
        return dtype != DRIVE_REMOVABLE && dtype != DRIVE_NO_ROOT_DIR;
    }
    false
}

#[cfg(target_os = "linux")]
fn collect_subdirs(base: &Path, out: &mut Vec<(PathBuf, String)>) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && !out.iter().any(|(p, _)| p == &path) {
            let label = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Removable Drive".to_string());
            if label.starts_with('.') {
                continue;
            }
            out.push((path, label));
        }
    }
}

/// Reads Linux `/sys/class/power_supply` (or `pmset -g batt` on macOS) to determine battery state.
pub fn read_power_state() -> PowerState {
    let mut on_battery = false;
    let mut battery_pct = None;

    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("pmset").args(["-g", "batt"]).output() {
            let text = String::from_utf8_lossy(&out.stdout);
            if text.contains("Battery Power") || text.contains("discharging") {
                on_battery = true;
            }
            for token in text.split(|c: char| c.is_whitespace() || c == ';') {
                if let Some(num_str) = token.strip_suffix('%') {
                    if let Ok(pct) = num_str.trim().parse::<u8>() {
                        battery_pct = Some(pct.min(100));
                        break;
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let power_dir = Path::new("/sys/class/power_supply");
        if let Ok(entries) = fs::read_dir(power_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let status_path = path.join("status");
                if let Ok(status) = fs::read_to_string(&status_path) {
                    if status.trim().eq_ignore_ascii_case("Discharging") {
                        on_battery = true;
                    }
                }
                let cap_path = path.join("capacity");
                if let Ok(cap_str) = fs::read_to_string(&cap_path) {
                    if let Ok(pct) = cap_str.trim().parse::<u8>() {
                        battery_pct = Some(pct);
                    }
                }
            }
        }
    }

    PowerState {
        on_battery,
        battery_pct,
    }
}

