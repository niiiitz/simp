use std::net::{SocketAddr, TcpStream};
use std::process::{Command, Stdio};
use std::time::Duration;

/// Ensures `simp --daemon` is listening on `127.0.0.1:18888`.
/// If not running, spawns `simp --daemon` as a detached background process.
pub fn ensure_daemon_running() {
    let addr = SocketAddr::from(([127, 0, 0, 1], 18888));
    if TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_ok() {
        return;
    }

    // 1. Prefer starting the managed systemd user unit if installed (Linux / SteamOS)
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("systemctl")
            .args(["--user", "start", "simp.service"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        for _ in 0..8 {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    // 2. Fallback (or primary on Windows): spawn `simp --daemon` directly as a headless background process
    if let Ok(exe) = std::env::current_exe() {
        let mut cmd = Command::new(exe);
        cmd.arg("--daemon")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        simp_core::configure_background_command(&mut cmd);
        let _ = cmd.spawn();

        // Wait up to 2.0s for the daemon socket to come online
        for _ in 0..20 {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

pub fn run_ui() {
    ensure_daemon_running();
    let ui_url = "http://127.0.0.1:18888";
    println!("SIMP daemon verified online at {ui_url} (IPC: ws://127.0.0.1:18888/ws)");

    if std::env::var("SIMP_NO_WINDOW").ok().as_deref() == Some("1") {
        return;
    }

    let profile_dir_path = simp_core::simp_data_dir().join("window-profile");
    let _ = std::fs::create_dir_all(&profile_dir_path);
    // Create the Chromium "First Run" sentinel file and clear any stale Crash/Singleton locks
    let _ = std::fs::File::create(profile_dir_path.join("First Run"));
    for lock_name in ["SingletonLock", "SingletonCookie", "SingletonSocket"] {
        let _ = std::fs::remove_file(profile_dir_path.join(lock_name));
    }
    let user_data_arg = format!("--user-data-dir={}", profile_dir_path.to_string_lossy());

    #[cfg(target_os = "windows")]
    {
        run_windows_ui(ui_url, &profile_dir_path, &user_data_arg);
        return;
    }

    #[cfg(target_os = "macos")]
    {
        run_macos_ui(ui_url, &user_data_arg);
        return;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        // Ensure DISPLAY / WAYLAND_DISPLAY are populated even if invoked from a background D-Bus/systemd context
        let mut wmctrl = Command::new("wmctrl");
        wmctrl
            .args(["-xa", "org.simp.player"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        simp_core::mpris::apply_desktop_display_env(&mut wmctrl);
        if wmctrl.status().map(|s| s.success()).unwrap_or(false) {
            return;
        }

        // 1. Try native Chromium/Chrome/Edge/Brave in chromeless 1280x800 app mode
        // Pass `--ozone-platform=x11` so `--class=org.simp.player` sets X11 `WM_CLASS="org.simp.player"`
        // (preventing KWin Wayland's generic yellow "W" icon and allowing `wmctrl -xa org.simp.player` to raise it).
        let native_browsers = [
            "chromium",
            "chromium-browser",
            "google-chrome-stable",
            "google-chrome",
            "microsoft-edge-stable",
            "microsoft-edge",
            "brave-browser",
        ];

        for bin in native_browsers {
            let mut cmd = Command::new(bin);
            cmd.arg(format!("--app={ui_url}"))
                .arg("--window-size=1280,800")
                .arg("--class=org.simp.player")
                .arg("--ozone-platform=x11")
                .arg("--no-first-run")
                .arg("--no-default-browser-check")
                .arg("--disable-features=HardwareMediaKeyHandling,MediaSessionService")
                .arg(&user_data_arg)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            simp_core::mpris::apply_desktop_display_env(&mut cmd);
            if let Ok(mut child) = cmd.spawn() {
                let _ = child.wait();
                return;
            }
        }

        // 2. Try SteamOS Flatpak browsers in chromeless 1280x800 app mode
        let flatpak_browsers = [
            "org.chromium.Chromium",
            "com.google.Chrome",
            "com.microsoft.Edge",
            "com.brave.Browser",
        ];

        for app_id in flatpak_browsers {
            if Command::new("flatpak")
                .arg("info")
                .arg(app_id)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
            {
                let mut cmd = Command::new("flatpak");
                cmd.arg("run")
                    .arg("--filesystem=xdg-data/simp:create")
                    .arg("--device=all")
                    .arg(app_id)
                    .arg(format!("--app={ui_url}"))
                    .arg("--window-size=1280,800")
                    .arg("--class=org.simp.player")
                    .arg("--ozone-platform=x11")
                    .arg("--no-first-run")
                    .arg("--no-default-browser-check")
                    .arg("--disable-features=HardwareMediaKeyHandling,MediaSessionService")
                    .arg(&user_data_arg)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                simp_core::mpris::apply_desktop_display_env(&mut cmd);
                if let Ok(mut child) = cmd.spawn() {
                    let _ = child.wait();
                    return;
                }
            }
        }

        // 3. Fallback to xdg-open
        let _ = Command::new("xdg-open")
            .arg(ui_url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(target_os = "windows")]
fn run_windows_ui(ui_url: &str, profile_dir: &std::path::Path, user_data_arg: &str) {
    use std::path::PathBuf;

    simp_core::seed_windows_browser_widevine_profile(profile_dir);

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

    for bin in candidates {
        let mut cmd = Command::new(&bin);
        cmd.arg(format!("--app={ui_url}"))
            .arg("--window-size=1280,800")
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg("--autoplay-policy=no-user-gesture-required")
            .arg("--disable-features=HardwareMediaKeyHandling,MediaSessionService")
            .arg(user_data_arg)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        simp_core::configure_background_command(&mut cmd);
        if cmd.spawn().is_ok() {
            return;
        }
    }

    // Fallback: open in default Windows browser via `cmd /C start`
    let mut fallback = Command::new("cmd");
    fallback
        .args(["/C", "start", "", ui_url])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    simp_core::configure_background_command(&mut fallback);
    let _ = fallback.spawn();
}

#[cfg(target_os = "macos")]
fn run_macos_ui(ui_url: &str, user_data_arg: &str) {
    use std::path::PathBuf;

    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut app_roots = vec![PathBuf::from("/Applications")];
    if let Ok(home) = std::env::var("HOME") {
        app_roots.push(PathBuf::from(home).join("Applications"));
    }

    let rel_paths = [
        "Google Chrome.app/Contents/MacOS/Google Chrome",
        "Brave Browser.app/Contents/MacOS/Brave Browser",
        "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "Chromium.app/Contents/MacOS/Chromium",
    ];

    for rel in rel_paths {
        for root in &app_roots {
            let p = root.join(rel);
            if p.is_file() && !candidates.contains(&p) {
                candidates.push(p);
            }
        }
    }

    for bin in candidates {
        let mut cmd = Command::new(&bin);
        cmd.arg(format!("--app={ui_url}"))
            .arg("--window-size=1280,800")
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg("--autoplay-policy=no-user-gesture-required")
            .arg("--disable-features=HardwareMediaKeyHandling,MediaSessionService")
            .arg(user_data_arg)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if cmd.spawn().is_ok() {
            return;
        }
    }

    // Fallback: open in default macOS browser via `open`
    let _ = Command::new("open")
        .arg(ui_url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

