use simp_protocol::PowerState;
use std::fs;
use std::path::{Path, PathBuf};

/// Discovers mounted removable USB / MicroSD drives under `/run/media/$USER/`
/// and `/run/media/mmcblk0p1` on SteamOS / Bazzite.
pub fn discover_removable_mounts() -> Vec<(PathBuf, String)> {
    let mut mounts = Vec::new();

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

    mounts
}

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
            out.push((path, label));
        }
    }
}

/// Reads Linux `/sys/class/power_supply` to determine if the Steam Deck / Frame is running on battery.
pub fn read_power_state() -> PowerState {
    let mut on_battery = false;
    let mut battery_pct = None;

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

    PowerState {
        on_battery,
        battery_pct,
    }
}

