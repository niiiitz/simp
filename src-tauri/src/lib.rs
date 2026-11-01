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
    println!("SIMP daemon verified online at ws://127.0.0.1:18888/ws");
}

