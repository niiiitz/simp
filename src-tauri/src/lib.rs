#![allow(unexpected_cfgs)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Command, Stdio};
use std::time::Duration;

#[cfg(target_os = "macos")]
pub mod macos_app;

fn query_running_daemon_health(addr: &SocketAddr) -> Option<(String, Option<u32>)> {
    let mut stream = TcpStream::connect_timeout(addr, Duration::from_millis(150)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));
    stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1:18888\r\nConnection: close\r\n\r\n")
        .ok()?;
    let mut resp = String::new();
    let _ = stream.read_to_string(&mut resp);
    let body = resp.split("\r\n\r\n").nth(1)?;
    let val: serde_json::Value = serde_json::from_str(body.trim()).ok()?;
    let ver = val.get("version")?.as_str()?.to_string();
    let pid = val.get("pid").and_then(|v| v.as_u64()).map(|n| n as u32);
    Some((ver, pid))
}

/// Ensures `simp --daemon` is listening on `127.0.0.1:18888`.
/// If not running (or if an older daemon binary is running after an update), spawns `simp --daemon` as a detached background process.
pub fn ensure_daemon_running() {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe) = std::env::current_exe() {
            let _ = std::fs::remove_file(exe.with_extension("exe.old"));
            if let Some(dir) = exe.parent() {
                let _ = std::fs::remove_file(dir.join("simp.exe.old"));
                let _ = std::fs::remove_file(dir.join("simp.ico"));
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name();
                        let name_str = name.to_string_lossy();
                        if name_str.starts_with("simp.exe.") && name_str.ends_with(".old") {
                            let _ = std::fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }
    }
    let addr = SocketAddr::from(([127, 0, 0, 1], 18888));
    if let Some((running_ver, running_pid)) = query_running_daemon_health(&addr) {
        if running_ver == env!("CARGO_PKG_VERSION") {
            return;
        }
        // A stale daemon from a previous version is listening on :18888 — replace it cleanly
        #[cfg(target_os = "windows")]
        {
            simp_core::close_windows_headless_worker_windows();
            if let Some(pid) = running_pid {
                let mut tk = Command::new("taskkill");
                tk.args(["/F", "/PID", &pid.to_string()])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                simp_core::configure_background_command(&mut tk);
                let _ = tk.status();
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        #[cfg(not(target_os = "windows"))]
        {
            if let Some(pid) = running_pid {
                let _ = Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    } else if TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_ok() {
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
    let ui_url = "http://127.0.0.1:18888";

    #[cfg(target_os = "macos")]
    {
        if std::env::var("SIMP_NO_WINDOW").ok().as_deref() == Some("1") {
            ensure_daemon_running();
            return;
        }
        macos_app::run_macos_native_app(ui_url);
    }

    #[cfg(not(target_os = "macos"))]
    {
        ensure_daemon_running();
        println!("SIMP daemon verified online at {ui_url} (IPC: ws://127.0.0.1:18888/ws)");

        if std::env::var("SIMP_NO_WINDOW").ok().as_deref() == Some("1") {
            return;
        }

        #[cfg(target_os = "windows")]
        {
            let _ = simp_core::hide_windows_headless_worker_windows();
            if simp_core::focus_existing_windows_ui_window() {
                return;
            }
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

        #[cfg(not(target_os = "windows"))]
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
}

#[cfg(target_os = "windows")]
fn run_windows_ui(ui_url: &str, profile_dir: &std::path::Path, user_data_arg: &str) {
    if simp_core::focus_existing_windows_ui_window() {
        return;
    }

    simp_core::seed_windows_browser_widevine_profile(profile_dir);

    for bin in simp_core::windows_browser_candidates() {
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

    // Fallback: open in default Windows browser via `explorer.exe` (avoids `cmd /C start ""` quote escaping issues)
    let mut fallback = Command::new("explorer");
    fallback
        .arg(ui_url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    simp_core::configure_background_command(&mut fallback);
    let _ = fallback.spawn();
}


