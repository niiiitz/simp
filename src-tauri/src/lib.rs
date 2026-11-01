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

    if let Ok(exe) = std::env::current_exe() {
        let _ = Command::new(exe)
            .arg("--daemon")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();

        // Wait up to 1.5s for the daemon socket to come online
        for _ in 0..15 {
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

    // 1. Try native Chromium/Chrome/Edge/Brave in chromeless 1280x800 app mode
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
        if let Ok(mut child) = Command::new(bin)
            .arg(format!("--app={ui_url}"))
            .arg("--window-size=1280,800")
            .arg("--class=org.simp.player")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
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
            if let Ok(mut child) = Command::new("flatpak")
                .arg("run")
                .arg(app_id)
                .arg(format!("--app={ui_url}"))
                .arg("--window-size=1280,800")
                .arg("--class=org.simp.player")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
            {
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

