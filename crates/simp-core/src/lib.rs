pub mod gamepad;
pub mod http_pool;
pub mod library;
pub mod mpris;
pub mod orchestrator;
pub mod sinks;
pub mod time_tracker;
pub mod tray;
pub mod updater;
pub mod vr_overlay;

pub use orchestrator::AudioOrchestrator;
pub use time_tracker::LocalTimeTracker;

use std::path::PathBuf;

/// Returns `Some(<exe_dir>/data)` when SIMP is running in Portable Mode
/// (i.e. `portable.txt` exists next to `simp` / `simp.exe`, or `SIMP_PORTABLE_DIR` is set).
pub fn portable_data_dir() -> Option<PathBuf> {
    if let Ok(env_dir) = std::env::var("SIMP_PORTABLE_DIR") {
        let trimmed = env_dir.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    if exe_dir.join("portable.txt").is_file() {
        return Some(exe_dir.join("data"));
    }
    if let Some(parent_dir) = exe_dir.parent() {
        if parent_dir.join("portable.txt").is_file() {
            return Some(parent_dir.join("data"));
        }
    }
    None
}

/// Canonical SIMP local data directory (`<exe_dir>/data` in Portable Mode,
/// or `~/.local/share/simp` / `%LOCALAPPDATA%\simp` in standard installs).
pub fn simp_data_dir() -> PathBuf {
    portable_data_dir().unwrap_or_else(|| {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("simp")
    })
}

/// Canonical SIMP config directory (`<exe_dir>/data` in Portable Mode,
/// or `~/.config/simp` / `%APPDATA%\simp` in standard installs).
pub fn simp_config_dir() -> PathBuf {
    portable_data_dir().unwrap_or_else(|| {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("simp")
    })
}

/// Canonical SIMP artwork cache directory (`<exe_dir>/data/art` in Portable Mode,
/// or `~/.cache/simp/art` / `%LOCALAPPDATA%\simp\art` in standard installs).
pub fn simp_art_cache_dir() -> PathBuf {
    if let Some(portable) = portable_data_dir() {
        return portable.join("art");
    }
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("simp")
        .join("art")
}

/// Configures a child `std::process::Command` so it never flashes a black `cmd.exe` console window on Windows (`CREATE_NO_WINDOW`).
pub fn configure_background_command(cmd: &mut std::process::Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = cmd;
    }
}

/// Pre-seeds an isolated Chromium/Brave/Edge `--user-data-dir` profile on Windows with the user's
/// installed `WidevineCdm` component and Brave's `widevine_opted_in: true` preferences so Widevine EME
/// works immediately on launch without prompting or requiring a browser restart.
pub fn seed_windows_browser_widevine_profile(profile_dir: &std::path::Path) {
    #[cfg(target_os = "windows")]
    {
        fn copy_dir_recursive_win(src: &std::path::Path, dst: &std::path::Path) {
            let _ = std::fs::create_dir_all(dst);
            if let Ok(entries) = std::fs::read_dir(src) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    let dest_p = dst.join(entry.file_name());
                    if p.is_dir() {
                        copy_dir_recursive_win(&p, &dest_p);
                    } else if !dest_p.is_file() {
                        let _ = std::fs::copy(&p, &dest_p);
                    }
                }
            }
        }

        let target_wv = profile_dir.join("WidevineCdm");
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            let local_root = PathBuf::from(local_app);
            for rel in [
                r"BraveSoftware\Brave-Browser\User Data\WidevineCdm",
                r"Google\Chrome\User Data\WidevineCdm",
                r"Microsoft\Edge\User Data\WidevineCdm",
            ] {
                let src_wv = local_root.join(rel);
                if src_wv.is_dir() {
                    copy_dir_recursive_win(&src_wv, &target_wv);
                    break;
                }
            }
        }

        for rel_json in ["Local State", r"Default\Preferences"] {
            let json_path = profile_dir.join(rel_json);
            if let Some(parent) = json_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let mut root_val: serde_json::Value = std::fs::read_to_string(&json_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_else(|| serde_json::json!({}));

            if let Some(obj) = root_val.as_object_mut() {
                let brave_entry = obj
                    .entry("brave".to_string())
                    .or_insert_with(|| serde_json::json!({}));
                if let Some(brave_obj) = brave_entry.as_object_mut() {
                    brave_obj.insert("widevine_opted_in".to_string(), serde_json::Value::Bool(true));
                }
                let wv_entry = obj
                    .entry("widevine".to_string())
                    .or_insert_with(|| serde_json::json!({}));
                if let Some(wv_obj) = wv_entry.as_object_mut() {
                    wv_obj.insert("opted_in".to_string(), serde_json::Value::Bool(true));
                }
                if let Ok(serialized) = serde_json::to_string(&root_val) {
                    let _ = std::fs::write(&json_path, serialized);
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = profile_dir;
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DaemonPerfSnapshot {
    pub cpu_percent: f64,
    pub rss_mb: f64,
    pub platform: String,
    pub audio_backend: String,
    pub portable_mode: bool,
}

/// Samples the SIMP background daemon's own process CPU usage (%) and Resident Set Size (MB).
pub fn sample_daemon_perf() -> DaemonPerfSnapshot {
    use std::sync::{Mutex, OnceLock};
    use std::time::Instant;

    static LAST_SAMPLE: OnceLock<Mutex<(Instant, u64, f64)>> = OnceLock::new();

    let (raw_ticks, ticks_per_sec, rss_mb) = read_process_ticks_and_rss();
    let now = Instant::now();
    let mutex = LAST_SAMPLE.get_or_init(|| Mutex::new((now, raw_ticks, 0.1)));
    let cpu_percent = if let Ok(mut guard) = mutex.lock() {
        let elapsed = now.duration_since(guard.0).as_secs_f64();
        if elapsed >= 0.4 && ticks_per_sec > 0.0 {
            let delta_ticks = raw_ticks.saturating_sub(guard.1) as f64;
            let pct = ((delta_ticks / ticks_per_sec) / elapsed) * 100.0;
            let clamped = (pct * 10.0).round() / 10.0;
            *guard = (now, raw_ticks, clamped);
            clamped
        } else {
            guard.2
        }
    } else {
        0.1
    };

    let (platform, audio_backend) = if cfg!(target_os = "windows") {
        (
            format!("windows-{}", std::env::consts::ARCH),
            "WASAPI (Rodio)".to_string(),
        )
    } else {
        (
            format!("linux-{}", std::env::consts::ARCH),
            "PipeWire / ALSA (Rodio)".to_string(),
        )
    };

    DaemonPerfSnapshot {
        cpu_percent,
        rss_mb: (rss_mb * 10.0).round() / 10.0,
        platform,
        audio_backend,
        portable_mode: portable_data_dir().is_some(),
    }
}

#[cfg(target_os = "linux")]
fn read_process_ticks_and_rss() -> (u64, f64, f64) {
    let mut total_ticks = 0u64;
    if let Ok(stat) = std::fs::read_to_string("/proc/self/stat") {
        if let Some(rparen) = stat.rfind(')') {
            let after = stat[rparen + 1..].trim();
            let fields: Vec<&str> = after.split_whitespace().collect();
            // After `(comm)`: index 11 is utime, index 12 is stime
            if fields.len() > 12 {
                let utime = fields[11].parse::<u64>().unwrap_or(0);
                let stime = fields[12].parse::<u64>().unwrap_or(0);
                total_ticks = utime.saturating_add(stime);
            }
        }
    }
    let mut rss_mb = 0.0;
    if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
        for line in status.lines() {
            if let Some(rest) = line.strip_prefix("VmRSS:") {
                let kb_str = rest
                    .trim()
                    .split_whitespace()
                    .next()
                    .unwrap_or("0");
                if let Ok(kb) = kb_str.parse::<f64>() {
                    rss_mb = kb / 1024.0;
                }
                break;
            }
        }
    }
    (total_ticks, 100.0, rss_mb)
}

#[cfg(target_os = "windows")]
fn read_process_ticks_and_rss() -> (u64, f64, f64) {
    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct ProcessMemoryCounters {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
    }
    extern "system" {
        fn GetCurrentProcess() -> *mut std::ffi::c_void;
        fn GetProcessTimes(
            process: *mut std::ffi::c_void,
            creation: *mut FileTime,
            exit: *mut FileTime,
            kernel: *mut FileTime,
            user: *mut FileTime,
        ) -> i32;
        fn K32GetProcessMemoryInfo(
            process: *mut std::ffi::c_void,
            ppsmem_counters: *mut ProcessMemoryCounters,
            cb: u32,
        ) -> i32;
    }

    unsafe {
        let proc_handle = GetCurrentProcess();
        let mut creation = FileTime::default();
        let mut exit = FileTime::default();
        let mut kernel = FileTime::default();
        let mut user = FileTime::default();
        let mut total_100ns = 0u64;
        if GetProcessTimes(proc_handle, &mut creation, &mut exit, &mut kernel, &mut user) != 0 {
            let k = ((kernel.high as u64) << 32) | (kernel.low as u64);
            let u = ((user.high as u64) << 32) | (user.low as u64);
            total_100ns = k.saturating_add(u);
        }
        let mut pmc = ProcessMemoryCounters {
            cb: std::mem::size_of::<ProcessMemoryCounters>() as u32,
            ..Default::default()
        };
        let rss_mb = if K32GetProcessMemoryInfo(proc_handle, &mut pmc, pmc.cb) != 0 {
            (pmc.working_set_size as f64) / (1024.0 * 1024.0)
        } else {
            0.0
        };
        (total_100ns, 10_000_000.0, rss_mb)
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn read_process_ticks_and_rss() -> (u64, f64, f64) {
    (0, 100.0, 0.0)
}

#[cfg(test)]
mod tests {
    use crate::library::db::LibraryDatabase;
    use crate::time_tracker::LocalTimeTracker;
    use simp_protocol::TrackMetadata;
    use std::path::PathBuf;

    #[test]
    fn test_time_tracker_seek_and_pause() {
        let mut tracker = LocalTimeTracker::new();
        assert!(!tracker.is_playing());
        assert_eq!(tracker.get_position_ms(), 0);

        tracker.seek(45_000);
        assert_eq!(tracker.get_position_ms(), 45_000);

        tracker.play();
        assert!(tracker.is_playing());
        tracker.pause();
        assert!(!tracker.is_playing());
        assert!(tracker.get_position_ms() >= 45_000);
    }

    #[test]
    fn test_sqlite_non_destructive_mount_hotplug() {
        let tmp_db = PathBuf::from("/tmp/simp_test_library.db");
        let _ = std::fs::remove_file(&tmp_db);
        let db = LibraryDatabase::open(&tmp_db).expect("open sqlite db");

        let usb_root = "/run/media/deck/USB_MUSIC";
        db.upsert_mount(usb_root, "USB_MUSIC", "removable_media", true)
            .unwrap();
        db.upsert_album(
            "alb_doom",
            "DOOM (Original Game Soundtrack)",
            "Mick Gordon",
            Some(2016),
            Some(379720),
            None,
        )
        .unwrap();

        let track = TrackMetadata {
            uri: "file:///run/media/deck/USB_MUSIC/03_BFG_Division.flac".to_string(),
            title: "BFG Division".to_string(),
            artists: vec!["Mick Gordon".to_string()],
            album: "DOOM (Original Game Soundtrack)".to_string(),
            album_id: Some("alb_doom".to_string()),
            track_number: Some(3),
            disc_number: Some(1),
            art_url: None,
            duration_ms: 506_000,
            source: "local".to_string(),
            mount_root: Some(usb_root.to_string()),
        };

        db.upsert_track(&track, Some(1700000000), Some(42_000_000))
            .unwrap();

        // While online, track and album appear in queries
        let albums_online = db.get_albums(None, None, 50, 0).unwrap();
        assert_eq!(albums_online.len(), 1);

        // Unplug USB drive (non-destructive!)
        db.set_mount_online(usb_root, false).unwrap();
        let albums_offline = db.get_albums(None, None, 50, 0).unwrap();
        assert_eq!(albums_offline.len(), 0);

        // Plug USB drive back in -> metadata is immediately restored without re-indexing!
        db.set_mount_online(usb_root, true).unwrap();
        let albums_restored = db.get_albums(None, None, 50, 0).unwrap();
        assert_eq!(albums_restored.len(), 1);
        assert_eq!(albums_restored[0].title, "DOOM (Original Game Soundtrack)");

        let _ = std::fs::remove_file(&tmp_db);
    }

    #[test]
    fn test_perceptual_cubic_volume_taper() {
        use crate::sinks::local::perceptual_cubic_gain;
        assert_eq!(perceptual_cubic_gain(0.0), 0.0);
        assert!((perceptual_cubic_gain(0.05) - 0.000125).abs() < 1e-6);
        assert!((perceptual_cubic_gain(0.30) - 0.027).abs() < 1e-6);
        assert!((perceptual_cubic_gain(0.50) - 0.125).abs() < 1e-6);
        assert!((perceptual_cubic_gain(0.70) - 0.343).abs() < 1e-6);
        assert_eq!(perceptual_cubic_gain(1.0), 1.0);
    }
}


