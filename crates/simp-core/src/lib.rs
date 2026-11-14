pub mod dsp;
pub mod factoids;
pub mod gamepad;
pub mod http_pool;
pub mod library;
pub mod lyrics;
pub mod mpris;
pub mod orchestrator;
pub mod sinks;
pub mod time_tracker;
pub mod tray;
pub mod updater;
pub mod viz;
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

/// Returns candidate Chromium-based browser executables installed on Windows (`Brave`, `Chrome`, `Edge`).
pub fn windows_browser_candidates() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let env_roots = [
        std::env::var("ProgramFiles").ok(),
        std::env::var("ProgramFiles(x86)").ok(),
        std::env::var("LOCALAPPDATA").ok(),
    ];
    let rel_paths = [
        r"BraveSoftware\Brave-Browser\Application\brave.exe",
        r"Google\Chrome\Application\chrome.exe",
        r"Microsoft\Edge\Application\msedge.exe",
    ];
    for rel in rel_paths {
        for root in env_roots.iter().flatten() {
            let p = PathBuf::from(root).join(rel);
            if p.is_file() && !candidates.contains(&p) {
                candidates.push(p);
            }
        }
    }
    candidates
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

        // If preparing the background `simp-widevine-worker` profile, seed `Local Storage` from `window-profile`
        // so any MusicKit JS v3 origin storage is immediately available without an interactive prompt.
        if profile_dir
            .file_name()
            .map(|n| n.to_string_lossy() == "simp-widevine-worker")
            .unwrap_or(false)
        {
            if let Some(parent) = profile_dir.parent() {
                let win_prof_ls = parent
                    .join("window-profile")
                    .join("Default")
                    .join("Local Storage");
                let worker_ls = profile_dir.join("Default").join("Local Storage");
                if win_prof_ls.is_dir() && !worker_ls.is_dir() {
                    copy_dir_recursive_win(&win_prof_ls, &worker_ls);
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

/// Raises/focuses an existing `"SIMP — Simple Integrated Media Player"` window on Windows if one is already open,
/// preventing duplicate console windows when clicking the System Tray icon or launching `simp.exe`.
pub fn focus_existing_windows_ui_window() -> bool {
    #[cfg(target_os = "windows")]
    {
        return win32_window_mgr::focus_existing_ui_window();
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Hides any `"SIMP Headless Audio Worker"` (`?worker=apple`) window from the Windows screen, taskbar, and `Alt+Tab`
/// (`WS_EX_TOOLWINDOW` + `SW_HIDE`) while keeping its Chromium Widevine EME + WASAPI audio pipeline running.
pub fn hide_windows_headless_worker_windows() -> bool {
    #[cfg(target_os = "windows")]
    {
        return win32_window_mgr::hide_headless_worker_windows();
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Returns `true` if a `"SIMP Headless Audio Worker"` window currently exists on Windows.
pub fn has_windows_headless_worker_window() -> bool {
    #[cfg(target_os = "windows")]
    {
        return win32_window_mgr::has_headless_worker_window();
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// Closes any running `"SIMP Headless Audio Worker"` windows on Windows when shutting down or disconnecting.
pub fn close_windows_headless_worker_windows() {
    #[cfg(target_os = "windows")]
    {
        win32_window_mgr::close_headless_worker_windows();
    }
}

#[cfg(target_os = "windows")]
mod win32_window_mgr {
    use std::ffi::c_void;

    type Hwnd = *mut c_void;
    type Lparam = isize;
    type Wparam = usize;

    #[repr(C)]
    #[derive(Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    const SW_HIDE: i32 = 0;
    const SW_SHOW: i32 = 5;
    const SW_RESTORE: i32 = 9;
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: isize = 0x00000080;
    const WS_EX_APPWINDOW: isize = 0x00040000;
    const WM_CLOSE: u32 = 0x0010;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(
            lp_enum_func: unsafe extern "system" fn(Hwnd, Lparam) -> i32,
            l_param: Lparam,
        ) -> i32;
        fn GetWindowTextW(h_wnd: Hwnd, lp_string: *mut u16, n_max_count: i32) -> i32;
        fn GetWindowRect(h_wnd: Hwnd, lp_rect: *mut Rect) -> i32;
        fn IsWindowVisible(h_wnd: Hwnd) -> i32;
        fn IsIconic(h_wnd: Hwnd) -> i32;
        fn ShowWindow(h_wnd: Hwnd, n_cmd_show: i32) -> i32;
        fn BringWindowToTop(h_wnd: Hwnd) -> i32;
        fn SetForegroundWindow(h_wnd: Hwnd) -> i32;
        fn GetWindowLongPtrW(h_wnd: Hwnd, n_index: i32) -> isize;
        fn SetWindowLongPtrW(h_wnd: Hwnd, n_index: i32, dw_new_long: isize) -> isize;
        fn PostMessageW(h_wnd: Hwnd, msg: u32, w_param: Wparam, l_param: Lparam) -> i32;
        fn keybd_event(b_vk: u8, b_scan: u8, dw_flags: u32, dw_extra_info: usize);
    }

    unsafe fn read_window_title(hwnd: Hwnd) -> String {
        let mut buf = [0u16; 256];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if len <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..len as usize])
    }

    unsafe fn is_ui_window_title(title: &str) -> bool {
        title.starts_with("IMP — Interactive Media Player")
            || title.starts_with("IMP - Interactive Media Player")
            || title.starts_with("SIMP — Simple Integrated Media Player")
            || title.starts_with("SIMP - Simple Integrated Media Player")
    }

    unsafe fn is_worker_hwnd(hwnd: Hwnd, title: &str) -> bool {
        if title.starts_with("IMP Headless Audio Worker")
            || title.starts_with("SIMP Headless Audio Worker")
            || title.contains("apple-worker")
            || title.contains("worker=apple")
        {
            return true;
        }
        // Also catch any 320x240 worker window whose title is still the default index.html title
        if is_ui_window_title(title) && IsIconic(hwnd) == 0 {
            let mut rect = Rect::default();
            if GetWindowRect(hwnd, &mut rect) != 0 {
                let w = rect.right - rect.left;
                let h = rect.bottom - rect.top;
                if (w > 0 && w <= 450 && h > 0 && h <= 350) || rect.left < -10000 {
                    return true;
                }
            }
        }
        false
    }

    unsafe fn is_main_ui_hwnd(hwnd: Hwnd, title: &str) -> bool {
        if IsWindowVisible(hwnd) == 0 {
            return false;
        }
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if (ex_style & WS_EX_TOOLWINDOW) != 0 {
            return false;
        }
        if is_worker_hwnd(hwnd, title) {
            return false;
        }
        if is_ui_window_title(title) {
            if IsIconic(hwnd) == 0 {
                let mut rect = Rect::default();
                if GetWindowRect(hwnd, &mut rect) != 0 {
                    let w = rect.right - rect.left;
                    if w <= 450 || rect.left < -10000 {
                        return false;
                    }
                }
            }
            return true;
        }
        false
    }

    unsafe extern "system" fn enum_focus_ui_cb(hwnd: Hwnd, l_param: Lparam) -> i32 {
        let title = read_window_title(hwnd);
        if is_main_ui_hwnd(hwnd, &title) {
            let found_ptr = l_param as *mut bool;
            if !found_ptr.is_null() {
                *found_ptr = true;
            }
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            } else {
                ShowWindow(hwnd, SW_SHOW);
            }
            // Send a zero virtual-key event so Windows allows our background tray thread to transfer foreground focus
            keybd_event(0, 0, 0, 0);
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);
            return 0; // Stop enumeration once we focused the main SIMP window
        }
        1
    }

    pub fn focus_existing_ui_window() -> bool {
        let mut found = false;
        unsafe {
            EnumWindows(enum_focus_ui_cb, (&mut found as *mut bool) as Lparam);
        }
        found
    }

    unsafe extern "system" fn enum_hide_worker_cb(hwnd: Hwnd, l_param: Lparam) -> i32 {
        let title = read_window_title(hwnd);
        if is_worker_hwnd(hwnd, &title) {
            let found_ptr = l_param as *mut bool;
            if !found_ptr.is_null() {
                *found_ptr = true;
            }
            // Hide BEFORE changing GWL_EXSTYLE so Windows Taskbar (ITaskbarList) immediately removes the taskbar button
            if IsWindowVisible(hwnd) != 0 {
                ShowWindow(hwnd, SW_HIDE);
            }
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let next_style = (ex_style | WS_EX_TOOLWINDOW) & !WS_EX_APPWINDOW;
            if next_style != ex_style {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_style);
                ShowWindow(hwnd, SW_HIDE);
            }
        }
        1
    }

    pub fn hide_headless_worker_windows() -> bool {
        let mut found = false;
        unsafe {
            EnumWindows(enum_hide_worker_cb, (&mut found as *mut bool) as Lparam);
        }
        found
    }

    unsafe extern "system" fn enum_check_worker_cb(hwnd: Hwnd, l_param: Lparam) -> i32 {
        let title = read_window_title(hwnd);
        if is_worker_hwnd(hwnd, &title) {
            let found_ptr = l_param as *mut bool;
            if !found_ptr.is_null() {
                *found_ptr = true;
            }
            return 0;
        }
        1
    }

    pub fn has_headless_worker_window() -> bool {
        let mut found = false;
        unsafe {
            EnumWindows(enum_check_worker_cb, (&mut found as *mut bool) as Lparam);
        }
        found
    }

    unsafe extern "system" fn enum_close_worker_cb(hwnd: Hwnd, _l_param: Lparam) -> i32 {
        let title = read_window_title(hwnd);
        if is_worker_hwnd(hwnd, &title) {
            PostMessageW(hwnd, WM_CLOSE, 0, 0);
        }
        1
    }

    pub fn close_headless_worker_windows() {
        unsafe {
            EnumWindows(enum_close_worker_cb, 0);
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DaemonPerfSnapshot {
    pub cpu_percent: f64,
    pub rss_mb: f64,
    pub ram_percent: f64,
    pub platform: String,
    pub audio_backend: String,
    pub portable_mode: bool,
}

/// Signals the OS kernel scheduler that the **current thread** prefers **Efficiency Cores (E-cores / little cores)**
/// and power-throttled execution (`EcoQoS` on Windows 11, `QOS_CLASS_UTILITY` on Apple Silicon macOS,
/// per-TID nice `+5` for EAS on Linux/SteamOS/Steam Frame).
///
/// > **Audio Safety**: This is intentionally applied per-thread on background workers (Tokio IPC/HTTP pool,
/// > system tray/SMTC loop, storage indexer, OpenVR bridge, gamepad readers) rather than process-wide,
/// > so the dedicated real-time audio output thread (`WASAPI` / `CoreAudio` / `PipeWire`) is never throttled.
pub fn prefer_efficiency_core_for_current_thread() {
    #[cfg(target_os = "windows")]
    unsafe {
        #[repr(C)]
        struct ThreadPowerThrottlingState {
            version: u32,
            control_mask: u32,
            state_mask: u32,
        }
        const THREAD_POWER_THROTTLING: u32 = 0;
        const THREAD_POWER_THROTTLING_CURRENT_VERSION: u32 = 1;
        const THREAD_POWER_THROTTLING_EXECUTION_SPEED: u32 = 0x1;
        const THREAD_PRIORITY_BELOW_NORMAL: i32 = -1;

        extern "system" {
            fn GetCurrentThread() -> *mut std::ffi::c_void;
            fn SetThreadInformation(
                h_thread: *mut std::ffi::c_void,
                thread_information_class: u32,
                thread_information: *const std::ffi::c_void,
                thread_information_size: u32,
            ) -> i32;
            fn SetThreadPriority(h_thread: *mut std::ffi::c_void, n_priority: i32) -> i32;
        }

        let h_thread = GetCurrentThread();
        let state = ThreadPowerThrottlingState {
            version: THREAD_POWER_THROTTLING_CURRENT_VERSION,
            control_mask: THREAD_POWER_THROTTLING_EXECUTION_SPEED,
            state_mask: THREAD_POWER_THROTTLING_EXECUTION_SPEED,
        };
        let _ = SetThreadInformation(
            h_thread,
            THREAD_POWER_THROTTLING,
            &state as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<ThreadPowerThrottlingState>() as u32,
        );
        let _ = SetThreadPriority(h_thread, THREAD_PRIORITY_BELOW_NORMAL);
    }

    #[cfg(target_os = "macos")]
    unsafe {
        // QOS_CLASS_UTILITY (0x11) steers threads onto Apple Silicon Efficiency (Icestorm/Sawtooth) cores
        const QOS_CLASS_UTILITY: u32 = 0x11;
        extern "C" {
            fn pthread_set_qos_class_self_np(qos_class: u32, relative_priority: libc::c_int) -> libc::c_int;
        }
        let _ = pthread_set_qos_class_self_np(QOS_CLASS_UTILITY, 0);
    }

    #[cfg(target_os = "linux")]
    unsafe {
        // On Linux NPTL, `setpriority(PRIO_PROCESS, 0, nice)` applies only to the calling thread (TID),
        // signaling EAS (ARM64 big.LITTLE on Steam Frame & Intel Thread Director) to prefer efficiency cores.
        let _ = libc::setpriority(libc::PRIO_PROCESS, 0, 5);
    }
}

/// Samples the SIMP background daemon's own process CPU usage (% over a 10-second rolling window,
/// normalized by logical CPU cores to match Task Manager) and Resident Set Size (MB & % of total RAM).
pub fn sample_daemon_perf() -> DaemonPerfSnapshot {
    use std::collections::VecDeque;
    use std::sync::{Mutex, OnceLock};
    use std::time::Instant;

    struct PerfRollingWindow {
        samples: VecDeque<(Instant, u64)>,
        last_cpu_percent: f64,
    }

    static PERF_WINDOW: OnceLock<Mutex<PerfRollingWindow>> = OnceLock::new();
    static TOTAL_RAM_MB: OnceLock<f64> = OnceLock::new();
    static LOGICAL_CPUS: OnceLock<f64> = OnceLock::new();

    let (raw_ticks, ticks_per_sec, rss_mb) = read_process_ticks_and_rss();
    let total_ram_mb = *TOTAL_RAM_MB.get_or_init(read_total_system_ram_mb);
    let logical_cpus = *LOGICAL_CPUS.get_or_init(|| {
        std::thread::available_parallelism()
            .map(|n| n.get() as f64)
            .unwrap_or(1.0)
            .max(1.0)
    });
    let ram_percent = if total_ram_mb > 0.0 {
        ((rss_mb / total_ram_mb) * 1000.0).round() / 10.0
    } else {
        0.0
    };

    let now = Instant::now();
    let mutex = PERF_WINDOW.get_or_init(|| {
        let mut samples = VecDeque::with_capacity(12);
        samples.push_back((now, raw_ticks));
        Mutex::new(PerfRollingWindow {
            samples,
            last_cpu_percent: 0.1,
        })
    });

    let cpu_percent = if let Ok(mut win) = mutex.lock() {
        // Record a new checkpoint at most once every 1.0s so rapid right-click menu polls
        // never create sub-second 15.6ms Windows timer quantum spikes.
        let should_push = win
            .samples
            .back()
            .map(|(t, _)| now.duration_since(*t).as_secs_f64() >= 1.0)
            .unwrap_or(true);
        if should_push {
            win.samples.push_back((now, raw_ticks));
            // Keep checkpoints spanning up to the last ~10 seconds (always retaining at least 2 points)
            while win.samples.len() > 2 {
                if let Some((oldest_t, _)) = win.samples.front() {
                    if now.duration_since(*oldest_t).as_secs_f64() > 10.0 {
                        win.samples.pop_front();
                    } else {
                        break;
                    }
                }
            }
        }

        if let Some((anchor_t, anchor_ticks)) = win.samples.front().copied() {
            let elapsed = now.duration_since(anchor_t).as_secs_f64();
            // Require at least a 1.0s baseline window before updating the displayed 10s rolling average
            if elapsed >= 1.0 && ticks_per_sec > 0.0 {
                let delta_ticks = raw_ticks.saturating_sub(anchor_ticks) as f64;
                let cpu_cores_used = (delta_ticks / ticks_per_sec) / elapsed;
                let pct = (cpu_cores_used / logical_cpus) * 100.0;
                let clamped = ((pct * 10.0).round() / 10.0).clamp(0.0, 100.0);
                win.last_cpu_percent = clamped;
            }
        }
        win.last_cpu_percent
    } else {
        0.1
    };

    let (platform, audio_backend) = if cfg!(target_os = "windows") {
        (
            format!("windows-{}", std::env::consts::ARCH),
            "WASAPI (Rodio)".to_string(),
        )
    } else if cfg!(target_os = "macos") {
        (
            format!("macos-{}", std::env::consts::ARCH),
            "CoreAudio (Rodio)".to_string(),
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
        ram_percent,
        platform,
        audio_backend,
        portable_mode: portable_data_dir().is_some(),
    }
}

fn read_total_system_ram_mb() -> f64 {
    #[cfg(target_os = "linux")]
    {
        if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
            for line in meminfo.lines() {
                if let Some(rest) = line.strip_prefix("MemTotal:") {
                    let kb_str = rest.trim().split_whitespace().next().unwrap_or("0");
                    if let Ok(kb) = kb_str.parse::<f64>() {
                        return kb / 1024.0;
                    }
                }
            }
        }
        0.0
    }
    #[cfg(target_os = "windows")]
    {
        #[repr(C)]
        #[derive(Default)]
        struct MemoryStatusEx {
            dw_length: u32,
            dw_memory_load: u32,
            ull_total_phys: u64,
            ull_avail_phys: u64,
            ull_total_page_file: u64,
            ull_avail_page_file: u64,
            ull_total_virtual: u64,
            ull_avail_virtual: u64,
            ull_avail_extended_virtual: u64,
        }
        extern "system" {
            fn GlobalMemoryStatusEx(lp_buffer: *mut MemoryStatusEx) -> i32;
        }
        unsafe {
            let mut ms = MemoryStatusEx {
                dw_length: std::mem::size_of::<MemoryStatusEx>() as u32,
                ..Default::default()
            };
            if GlobalMemoryStatusEx(&mut ms) != 0 {
                (ms.ull_total_phys as f64) / (1024.0 * 1024.0)
            } else {
                0.0
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        unsafe {
            let mut memsize: u64 = 0;
            let mut size = std::mem::size_of::<u64>();
            let mut mib = [libc::CTL_HW, libc::HW_MEMSIZE];
            if libc::sysctl(
                mib.as_mut_ptr(),
                2,
                &mut memsize as *mut _ as *mut libc::c_void,
                &mut size,
                std::ptr::null_mut(),
                0,
            ) == 0
            {
                (memsize as f64) / (1024.0 * 1024.0)
            } else {
                0.0
            }
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        0.0
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

#[cfg(target_os = "macos")]
fn read_process_ticks_and_rss() -> (u64, f64, f64) {
    unsafe {
        let mut usage: libc::rusage = std::mem::zeroed();
        let mut total_us = 0u64;
        if libc::getrusage(libc::RUSAGE_SELF, &mut usage) == 0 {
            let u_us = (usage.ru_utime.tv_sec as u64)
                .saturating_mul(1_000_000)
                .saturating_add(usage.ru_utime.tv_usec as u64);
            let s_us = (usage.ru_stime.tv_sec as u64)
                .saturating_mul(1_000_000)
                .saturating_add(usage.ru_stime.tv_usec as u64);
            total_us = u_us.saturating_add(s_us);
        }

        let mut task_info: libc::proc_taskinfo = std::mem::zeroed();
        let info_size = std::mem::size_of::<libc::proc_taskinfo>() as libc::c_int;
        let ret = libc::proc_pidinfo(
            libc::getpid(),
            libc::PROC_PIDTASKINFO,
            0,
            &mut task_info as *mut _ as *mut libc::c_void,
            info_size,
        );
        let rss_mb = if ret == info_size {
            (task_info.pti_resident_size as f64) / (1024.0 * 1024.0)
        } else {
            (usage.ru_maxrss as f64) / (1024.0 * 1024.0)
        };

        (total_us, 1_000_000.0, rss_mb)
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
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


