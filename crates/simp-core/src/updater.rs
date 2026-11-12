#[cfg(not(target_os = "macos"))]
use anyhow::Context;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
#[cfg(not(target_os = "windows"))]
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateStatus {
    pub current_version: String,
    pub latest_version: String,
    pub latest_tag: String,
    pub update_available: bool,
    pub release_url: String,
    pub published_at: Option<String>,
    pub target_arch: String,
    pub asset_url: Option<String>,
    pub channel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateApplyResult {
    pub ok: bool,
    pub previous_version: String,
    pub updated_version: String,
    pub decky_updated: bool,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    state: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct GithubReleaseItem {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GithubReleaseAsset>,
}

/// Parses a semver + prerelease version string (e.g., `"0.1.0-alpha.22"`) into a comparable tuple
/// `(major, minor, patch, is_stable, prerelease_num)` so `"0.1.0-alpha.23" > "0.1.0-alpha.22"`
/// and `"0.1.0" > "0.1.0-alpha.99"`.
pub fn parse_version_tuple(raw: &str) -> (u32, u32, u32, u32, u32) {
    let cleaned = raw.trim().trim_start_matches('v');
    let (core, pre) = cleaned.split_once('-').unwrap_or((cleaned, ""));
    let mut parts = core.split('.').map(|s| s.parse::<u32>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    let patch = parts.next().unwrap_or(0);

    if pre.is_empty() {
        (major, minor, patch, 1, 0)
    } else {
        let pre_num = pre
            .rsplit('.')
            .next()
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        (major, minor, patch, 0, pre_num)
    }
}

pub fn is_newer_version(current: &str, candidate: &str) -> bool {
    parse_version_tuple(candidate) > parse_version_tuple(current)
}

fn load_provisioning_settings() -> simp_protocol::ProvisioningSettings {
    let portable_or_cfg = crate::simp_config_dir().join("settings.vdf");
    if let Ok(text) = std::fs::read_to_string(&portable_or_cfg) {
        if let Ok(parsed) = keyvalues_serde::from_str::<simp_protocol::SimpSettings>(&text) {
            return parsed.provisioning;
        }
    }
    if let Some(cfg_dir) = dirs::config_dir() {
        let path = cfg_dir.join("simp").join("settings.vdf");
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(parsed) = keyvalues_serde::from_str::<simp_protocol::SimpSettings>(&text) {
                return parsed.provisioning;
            }
        }
    }
    simp_protocol::ProvisioningSettings::default()
}

/// Finds the matching architecture asset URL inside a GitHub release's `assets` list for `(os, arch)`.
pub(crate) fn find_platform_arch_asset_url(
    release: &GithubReleaseItem,
    os: &str,
    arch: &str,
) -> Option<String> {
    let candidates: Vec<String> = match os {
        "macos" => {
            if arch == "aarch64" {
                vec![
                    "SIMP-macos-arm64.zip".to_string(),
                    "SIMP-macos-aarch64.zip".to_string(),
                    "SIMP-macos-universal.zip".to_string(),
                ]
            } else {
                vec![
                    format!("SIMP-macos-{arch}.zip"),
                    "SIMP-macos-universal.zip".to_string(),
                ]
            }
        }
        "windows" => vec![
            format!("simp-windows-portable-{arch}.zip"),
            "simp-windows-portable.zip".to_string(),
        ],
        _ => {
            if arch == "x86_64" {
                vec![
                    format!("simp-steamos-userland-{arch}.tar.gz"),
                    "simp-steamos-userland.tar.gz".to_string(),
                ]
            } else {
                vec![format!("simp-steamos-userland-{arch}.tar.gz")]
            }
        }
    };

    for candidate in candidates {
        if let Some(asset) = release.assets.iter().find(|a| {
            a.name == candidate && (a.state.is_empty() || a.state == "uploaded")
        }) {
            return Some(asset.browser_download_url.clone());
        }
    }
    None
}

fn find_arch_asset_url(release: &GithubReleaseItem, arch: &str) -> Option<String> {
    find_platform_arch_asset_url(release, std::env::consts::OS, arch)
}

fn fetch_github_releases_bytes(api_url: &str) -> Result<Vec<u8>> {
    if let Ok(bytes) = crate::http_pool::http_get_bytes(
        api_url,
        &[
            ("Accept", "application/vnd.github+json"),
            ("User-Agent", "SIMP-Updater"),
        ],
        None,
        12,
    ) {
        let trimmed = bytes.iter().copied().skip_while(|b| b.is_ascii_whitespace()).next();
        if trimmed == Some(b'[') {
            return Ok(bytes);
        }
    }

    // Fallback: `curl -4 --http1.1`
    let mut cmd = Command::new("curl");
    cmd.args([
        "-4",
        "--http1.1",
        "-fsSL",
        "--connect-timeout",
        "8",
        "--max-time",
        "15",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "User-Agent: SIMP-Updater",
        api_url,
    ]);
    crate::configure_background_command(&mut cmd);
    if let Ok(out) = cmd.output() {
        let trimmed = out
            .stdout
            .iter()
            .copied()
            .skip_while(|b| b.is_ascii_whitespace())
            .next();
        if out.status.success() && trimmed == Some(b'[') {
            return Ok(out.stdout);
        }
    }

    Err(anyhow!("GitHub Releases API request failed for {api_url}"))
}

pub(crate) fn is_stable_release_item(r: &GithubReleaseItem) -> bool {
    let tag = r.tag_name.trim();
    !r.prerelease && !tag.contains("-alpha") && !tag.contains("-beta") && !tag.contains("-rc")
}

/// Queries GitHub Releases (`niiiitz/simp` or configured `github_releases_api_url` in `settings.vdf`)
/// for the newest release on the configured channel (`"alpha"` vs `"stable"`) that provides a build
/// for the current OS & CPU architecture (`aarch64` or `x86_64`).
pub fn check_for_updates() -> Result<UpdateStatus> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let target_arch = std::env::consts::ARCH.to_string();
    let prov = load_provisioning_settings();
    let channel = if prov.update_channel.trim().eq_ignore_ascii_case("alpha") {
        "alpha".to_string()
    } else {
        "stable".to_string()
    };
    let api_url = if prov.github_releases_api_url.trim().is_empty() {
        "https://api.github.com/repos/niiiitz/simp/releases?per_page=10"
    } else {
        prov.github_releases_api_url.trim()
    };

    let bytes = fetch_github_releases_bytes(api_url)?;

    let releases: Vec<GithubReleaseItem> = serde_json::from_slice(&bytes)
        .map_err(|e| anyhow!("Failed to parse GitHub releases JSON: {e}"))?;

    let valid_releases: Vec<GithubReleaseItem> = releases
        .into_iter()
        .filter(|r| !r.draft && !r.tag_name.trim().is_empty())
        .filter(|r| {
            if channel == "stable" {
                is_stable_release_item(r)
            } else {
                true
            }
        })
        .collect();

    if valid_releases.is_empty() && channel == "stable" {
        return Ok(UpdateStatus {
            current_version: current_version.clone(),
            latest_version: current_version,
            latest_tag: "No stable release yet".to_string(),
            update_available: false,
            release_url: "https://github.com/niiiitz/simp/releases".to_string(),
            published_at: None,
            target_arch,
            asset_url: None,
            channel,
        });
    }

    // Prefer the newest release that actually has the current OS/architecture's asset uploaded
    let newest = valid_releases
        .iter()
        .filter(|r| find_arch_asset_url(r, &target_arch).is_some())
        .max_by_key(|r| parse_version_tuple(&r.tag_name))
        .or_else(|| {
            valid_releases
                .iter()
                .max_by_key(|r| parse_version_tuple(&r.tag_name))
        })
        .ok_or_else(|| anyhow!("No published releases found on GitHub"))?;

    let latest_version = newest.tag_name.trim().trim_start_matches('v').to_string();
    let update_available = is_newer_version(&current_version, &latest_version);
    let asset_url = find_arch_asset_url(newest, &target_arch);

    Ok(UpdateStatus {
        current_version,
        latest_version,
        latest_tag: newest.tag_name.clone(),
        update_available,
        release_url: newest.html_url.clone(),
        published_at: newest.published_at.clone(),
        target_arch,
        asset_url,
        channel,
    })
}

#[cfg(not(target_os = "macos"))]
fn copy_dir_contents(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dest_path = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_contents(&path, &dest_path)?;
        } else {
            let _ = std::fs::remove_file(&dest_path);
            std::fs::copy(&path, &dest_path)?;
        }
    }
    Ok(())
}

/// Spawns a detached background shell that waits 450ms (allowing the HTTP 200 OK response to flush
/// to the UI / Decky QAM client) and then cleanly restarts `simp.service` (or the daemon process).
pub fn spawn_delayed_daemon_restart() {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe) = std::env::current_exe() {
            let pid = std::process::id();
            let exe_dir = exe.parent().map(|p| p.to_path_buf());
            let target_exe = exe_dir
                .as_ref()
                .map(|d| d.join("simp.exe"))
                .filter(|p| p.is_file())
                .unwrap_or(exe);
            let old_exe = exe_dir
                .as_ref()
                .map(|d| d.join("simp.exe.old"))
                .unwrap_or_else(|| target_exe.with_extension("exe.old"));
            let pid_old_exe = exe_dir
                .as_ref()
                .map(|d| d.join(format!("simp.exe.{pid}.old")))
                .unwrap_or_else(|| target_exe.with_extension(format!("exe.{pid}.old")));
            let loose_ico = exe_dir
                .as_ref()
                .map(|d| d.join("simp.ico"))
                .unwrap_or_else(|| target_exe.with_file_name("simp.ico"));

            let clean_win_path = |p: &std::path::Path| -> String {
                p.to_string_lossy()
                    .trim_start_matches(r"\\?\")
                    .to_string()
            };
            let target_str = clean_win_path(&target_exe);
            let old_str = clean_win_path(&old_exe);
            let pid_old_str = clean_win_path(&pid_old_exe);
            let ico_str = clean_win_path(&loose_ico);

            // Write a clean batch file to %TEMP% rather than passing embedded quotes to `cmd /C`
            // (Rust's Windows Command escapes inner quotes as `\"`, which breaks `cmd.exe` path parsing).
            let bat_path = std::env::temp_dir().join(format!("simp-restart-{pid}.bat"));
            let bat_contents = format!(
                "@echo off\r\n\
                 ping 127.0.0.1 -n 2 >nul 2>&1\r\n\
                 taskkill /F /PID {pid} >nul 2>&1\r\n\
                 ping 127.0.0.1 -n 2 >nul 2>&1\r\n\
                 if exist \"{old_str}\" del /F /Q \"{old_str}\" >nul 2>&1\r\n\
                 if exist \"{pid_old_str}\" del /F /Q \"{pid_old_str}\" >nul 2>&1\r\n\
                 if exist \"{ico_str}\" del /F /Q \"{ico_str}\" >nul 2>&1\r\n\
                 start \"IMP\" \"{target_str}\" --daemon\r\n\
                 del /F /Q \"%~f0\" >nul 2>&1\r\n"
            );
            if std::fs::write(&bat_path, bat_contents).is_ok() {
                let mut cmd = Command::new("cmd");
                cmd.arg("/C")
                    .arg(&bat_path)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                crate::configure_background_command(&mut cmd);
                let _ = cmd.spawn();
            }
        }
        return;
    }

    #[cfg(target_os = "macos")]
    {
        let pid = std::process::id();
        let exe_path = std::env::current_exe()
            .ok()
            .and_then(|p| p.to_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "/Applications/SIMP.app/Contents/MacOS/simp".to_string());
        let script = format!(
            "sleep 0.50; kill -TERM {pid} 2>/dev/null || true; sleep 0.25; nohup \"{exe_path}\" >/dev/null 2>&1 &"
        );
        let _ = Command::new("sh")
            .args(["-c", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        return;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let self_pid = std::process::id();
        let script = format!(
            "sleep 0.45; \
            export XDG_RUNTIME_DIR=\"${{XDG_RUNTIME_DIR:-/run/user/$(id -u)}}\"; \
            export DBUS_SESSION_BUS_ADDRESS=\"${{DBUS_SESSION_BUS_ADDRESS:-unix:path=${{XDG_RUNTIME_DIR}}/bus}}\"; \
            pkill -f 'simp-widevine-worker' 2>/dev/null || true; \
            pkill -f '18888/?worker=apple' 2>/dev/null || true; \
            if command -v systemctl >/dev/null 2>&1 && [ -f \"$HOME/.config/systemd/user/simp.service\" ]; then \
              systemctl --user daemon-reload 2>/dev/null || true; \
              systemctl --user stop simp.service 2>/dev/null || true; \
            fi; \
            kill -TERM {self_pid} 2>/dev/null || true; \
            pkill -TERM -f 'simp --daemon' 2>/dev/null || true; \
            sleep 0.25; \
            kill -9 {self_pid} 2>/dev/null || true; \
            pkill -9 -f 'simp --daemon' 2>/dev/null || true; \
            if command -v systemctl >/dev/null 2>&1 && [ -f \"$HOME/.config/systemd/user/simp.service\" ]; then \
              systemctl --user restart simp.service 2>/dev/null || systemctl --user start simp.service 2>/dev/null || true; \
              sleep 0.6; \
            fi; \
            if ! curl -fsS --max-time 2 http://127.0.0.1:18888/health >/dev/null 2>&1; then \
              nohup \"$HOME/.local/share/simp/bin/simp\" --daemon >/dev/null 2>&1 & \
            fi"
        );

        // Detach into a new session via `setsid` so `systemctl --user stop simp.service` never kills the restart script
        let spawned = Command::new("setsid")
            .args(["sh", "-c", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();

        if spawned.is_err() {
            let _ = Command::new("sh")
                .args(["-c", &script])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
        }
    }
}

/// Synchronously stops any existing background daemon (systemd user service or standalone `simp --daemon`),
/// starts the newly installed binary, and waits until `http://127.0.0.1:18888/health` responds.
/// Used by CLI `simp update` so the background service is guaranteed to be running the updated version
/// before `simp update` returns to the shell prompt.
pub fn restart_daemon_synchronously() -> Result<String> {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    fn probe_health() -> Option<(String, Option<u32>)> {
        let addr = SocketAddr::from(([127, 0, 0, 1], 18888));
        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(180)).ok()?;
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

    let previous_pid = probe_health().and_then(|(_, pid)| pid);

    #[cfg(target_os = "windows")]
    {
        crate::close_windows_headless_worker_windows();
        if let Some(pid) = previous_pid {
            let mut tk = Command::new("taskkill");
            tk.args(["/F", "/PID", &pid.to_string()])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            crate::configure_background_command(&mut tk);
            let _ = tk.status();
        }
        let mut tk_all = Command::new("taskkill");
        tk_all
            .args(["/F", "/IM", "simp.exe", "/FI", &format!("PID ne {}", std::process::id())])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        crate::configure_background_command(&mut tk_all);
        let _ = tk_all.status();
        std::thread::sleep(Duration::from_millis(300));

        if let Ok(exe) = std::env::current_exe() {
            let target_exe = exe
                .parent()
                .map(|d| d.join("simp.exe"))
                .filter(|p| p.is_file())
                .unwrap_or(exe);
            let _ = std::fs::remove_file(target_exe.with_extension("exe.old"));
            let mut cmd = Command::new(&target_exe);
            cmd.arg("--daemon")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            crate::configure_background_command(&mut cmd);
            let _ = cmd.spawn();
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(pid) = previous_pid {
            let _ = Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .status();
            std::thread::sleep(Duration::from_millis(250));
        }
        let app_bin = resolve_macos_app_bundle_dest().join("Contents/MacOS/simp");
        let bin = if app_bin.is_file() {
            app_bin
        } else {
            std::env::current_exe().unwrap_or(app_bin)
        };
        let _ = Command::new(&bin)
            .arg("--daemon")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let uid = unsafe { libc::getuid() };
        let runtime_dir = std::env::var("XDG_RUNTIME_DIR")
            .unwrap_or_else(|_| format!("/run/user/{uid}"));
        let dbus_addr = std::env::var("DBUS_SESSION_BUS_ADDRESS")
            .unwrap_or_else(|_| format!("unix:path={runtime_dir}/bus"));
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        let service_file = home.join(".config/systemd/user/simp.service");
        let installed_bin = home.join(".local/share/simp/bin/simp");

        let _ = Command::new("pkill")
            .args(["-f", "simp-widevine-worker"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = Command::new("pkill")
            .args(["-f", "18888/?worker=apple"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        if service_file.is_file() {
            let _ = Command::new("systemctl")
                .env("XDG_RUNTIME_DIR", &runtime_dir)
                .env("DBUS_SESSION_BUS_ADDRESS", &dbus_addr)
                .args(["--user", "daemon-reload"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            let _ = Command::new("systemctl")
                .env("XDG_RUNTIME_DIR", &runtime_dir)
                .env("DBUS_SESSION_BUS_ADDRESS", &dbus_addr)
                .args(["--user", "stop", "simp.service"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }

        if let Some(pid) = previous_pid {
            let _ = Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = Command::new("pkill")
            .args(["-TERM", "-f", "simp --daemon"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        std::thread::sleep(Duration::from_millis(250));

        if let Some(pid) = previous_pid {
            let _ = Command::new("kill")
                .args(["-9", &pid.to_string()])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = Command::new("pkill")
            .args(["-9", "-f", "simp --daemon"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        if service_file.is_file() {
            let _ = Command::new("systemctl")
                .env("XDG_RUNTIME_DIR", &runtime_dir)
                .env("DBUS_SESSION_BUS_ADDRESS", &dbus_addr)
                .args(["--user", "start", "simp.service"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            std::thread::sleep(Duration::from_millis(450));
        }

        if probe_health().is_none() && installed_bin.is_file() {
            let _ = Command::new(&installed_bin)
                .arg("--daemon")
                .env("XDG_RUNTIME_DIR", &runtime_dir)
                .env("DBUS_SESSION_BUS_ADDRESS", &dbus_addr)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
        }
    }

    for _ in 0..25 {
        if let Some((ver, pid)) = probe_health() {
            return Ok(match pid {
                Some(p) => format!("Background service restarted (v{ver}, PID {p})"),
                None => format!("Background service restarted (v{ver})"),
            });
        }
        std::thread::sleep(Duration::from_millis(120));
    }

    Ok("Background service restart initiated".to_string())
}

/// Downloads the latest `simp-steamos-userland-{arch}.tar.gz` release bundle from GitHub,
/// atomically updates `~/.local/share/simp/bin/simp`, `~/.local/share/simp/ui/`,
/// `~/.local/share/simp/openvr/`, and `~/homebrew/plugins/simp-decky/` (if present),
/// and schedules a daemon restart.
pub fn apply_self_update(
    target_tag: Option<&str>,
    force_reinstall: bool,
    restart_daemon_after: bool,
) -> Result<UpdateApplyResult> {
    let status = check_for_updates()?;
    let tag = target_tag.unwrap_or(&status.latest_tag).to_string();
    let target_ver = tag.trim().trim_start_matches('v').to_string();

    if !force_reinstall
        && !is_newer_version(&status.current_version, &target_ver)
        && target_ver == status.current_version
    {
        // Still allow reinstalling if explicitly requested
    }

    #[cfg(target_os = "macos")]
    {
        return apply_macos_self_update(&status, &tag, &target_ver, restart_daemon_after);
    }

    #[cfg(target_os = "windows")]
    {
        return apply_windows_self_update(&status, &tag, &target_ver, restart_daemon_after);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("Could not determine HOME directory"))?;
    let install_root = home.join(".local/share/simp");
    let bin_dest_dir = install_root.join("bin");
    let ui_dest_dir = install_root.join("ui");
    let local_bin_dir = home.join(".local/bin");
    std::fs::create_dir_all(&bin_dest_dir)?;
    std::fs::create_dir_all(&ui_dest_dir)?;
    std::fs::create_dir_all(&local_bin_dir)?;

    let tmp_dir = PathBuf::from(format!("/tmp/simp-self-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp_dir);
    std::fs::create_dir_all(&tmp_dir)?;

    let prov = load_provisioning_settings();
    let arch = std::env::consts::ARCH; // "x86_64" on Deck/PC, "aarch64" on Steam Frame
    let tarball_name = format!("simp-steamos-userland-{arch}.tar.gz");
    let tarball_path = tmp_dir.join(&tarball_name);

    let download_url = if target_tag.is_none() {
        status.asset_url.clone().unwrap_or_else(|| {
            let template = if prov.release_asset_template.trim().is_empty() {
                "https://github.com/niiiitz/simp/releases/download/{tag}/simp-steamos-userland-{arch}.tar.gz"
            } else {
                prov.release_asset_template.trim()
            };
            template.replace("{tag}", &tag).replace("{arch}", arch)
        })
    } else {
        let template = if prov.release_asset_template.trim().is_empty() {
            "https://github.com/niiiitz/simp/releases/download/{tag}/simp-steamos-userland-{arch}.tar.gz"
        } else {
            prov.release_asset_template.trim()
        };
        template.replace("{tag}", &tag).replace("{arch}", arch)
    };

    // Try IPv4 + HTTP/1.1 first with retries so IPv6/HTTP2 stalls never break self-updates
    let mut dl_ok = Command::new("curl")
        .args([
            "-4",
            "--http1.1",
            "--retry",
            "2",
            "-fsSL",
            "--connect-timeout",
            "15",
            "--max-time",
            "180",
            "-o",
        ])
        .arg(&tarball_path)
        .arg(&download_url)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !dl_ok {
        dl_ok = Command::new("curl")
            .args(["-fsSL", "--max-time", "120", "-o"])
            .arg(&tarball_path)
            .arg(&download_url)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
    }

    if !dl_ok {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(anyhow!(
            "Failed to download {arch} release archive from {download_url}"
        ));
    }

    let tar_status = Command::new("tar")
        .args(["-xzf"])
        .arg(&tarball_path)
        .arg("-C")
        .arg(&tmp_dir)
        .status()
        .map_err(|e| anyhow!("Failed to extract release archive: {e}"))?;

    if !tar_status.success() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(anyhow!("tar extraction failed for {download_url}"));
    }

    let extracted_root = tmp_dir.join("simp-steamos-userland");
    let src_bin = extracted_root.join("bin/simp");
    let src_ui = extracted_root.join("ui");
    let src_decky = extracted_root.join("simp-decky");

    if !src_bin.is_file() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(anyhow!("Downloaded archive did not contain bin/simp"));
    }

    // 1. Atomically replace `~/.local/share/simp/bin/simp` using a `.new` temp file + rename
    // Runs 100% in userland (`~/.local/share/simp`); only tries non-interactive `sudo -n` if an older
    // root-run script left root-owned files behind, never prompting interactively with `sudo` or `pkexec`.
    let dest_bin = bin_dest_dir.join("simp");
    let dest_bin_new = bin_dest_dir.join("simp.new");
    let _ = std::fs::remove_file(&dest_bin_new);
    if std::fs::copy(&src_bin, &dest_bin_new).is_err() {
        #[cfg(unix)]
        {
            let uid = unsafe { libc::getuid() };
            let gid = unsafe { libc::getgid() };
            let install_str = install_root.to_string_lossy().to_string();
            let systemd_str = home.join(".config/systemd").to_string_lossy().to_string();
            let fix_userland_cmd = format!(
                "chown -R {uid}:{gid} \"{install_str}\" \"{systemd_str}\" 2>/dev/null || true"
            );
            let _ = Command::new("sudo")
                .args(["-n", "sh", "-c", &fix_userland_cmd])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
    std::fs::copy(&src_bin, &dest_bin_new).with_context(|| {
        format!(
            "Failed to write {} (if previously installed with sudo, run: sudo chown -R $USER:$USER ~/.local/share/simp)",
            dest_bin_new.display()
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest_bin_new, std::fs::Permissions::from_mode(0o755));
    }
    std::fs::rename(&dest_bin_new, &dest_bin)?;

    // Also update `install-steamos.sh` & `uninstall-steamos.sh` in `~/.local/share/simp/bin/` if present in the bundle
    for script_name in ["install-steamos.sh", "uninstall-steamos.sh"] {
        let src_script = extracted_root.join(script_name);
        if src_script.is_file() {
            let dest_script = bin_dest_dir.join(script_name);
            let _ = std::fs::remove_file(&dest_script);
            if std::fs::copy(&src_script, &dest_script).is_ok() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(
                        &dest_script,
                        std::fs::Permissions::from_mode(0o755),
                    );
                }
            }
        }
    }

    // Also update `~/.config/systemd/user/simp.service` and `~/.local/share/applications/org.simp.player.desktop`
    let src_service = extracted_root.join("systemd/simp.service");
    if src_service.is_file() {
        let systemd_user_dir = home.join(".config/systemd/user");
        let _ = std::fs::create_dir_all(&systemd_user_dir);
        let dest_service = systemd_user_dir.join("simp.service");
        let _ = std::fs::copy(&src_service, &dest_service);
    }

    // 2. Replace `~/.local/share/simp/ui/`
    if src_ui.join("index.html").is_file() {
        let _ = std::fs::remove_dir_all(&ui_dest_dir);
        copy_dir_contents(&src_ui, &ui_dest_dir)?;
    }

    // 2a. Install FreeDesktop `hicolor` icons (16x16..512x512 + pixmaps) & `.desktop` launcher + WMClass alias entries
    let src_desktop = extracted_root.join("desktop/org.simp.player.desktop");
    install_linux_icons_and_desktop_entries(
        &home,
        &dest_bin,
        &ui_dest_dir,
        src_desktop.is_file().then_some(src_desktop.as_path()),
    );

    // 2b. Copy any bundled support libraries in `lib/` (e.g. `libnspr4.so` on aarch64)
    let src_lib = extracted_root.join("lib");
    if src_lib.is_dir() {
        let lib_dest_dir = install_root.join("lib");
        let _ = copy_dir_contents(&src_lib, &lib_dest_dir);
    }

    // 2c. Refresh OpenVR manifest + Steam shortcut icons
    let _ = crate::vr_overlay::ensure_vrmanifest_installed();

    // 3. Stage Decky plugin into `~/.local/share/simp/decky-staged/` (if present in bundle)
    let mut decky_updated = false;
    let decky_staged = install_root.join("decky-staged");
    if src_decky.is_dir() {
        let _ = std::fs::remove_dir_all(&decky_staged);
        let _ = copy_dir_contents(&src_decky, &decky_staged);
    }

    let homebrew_dir = home.join("homebrew");
    let decky_plugins_dir = homebrew_dir.join("plugins");
    let decky_target = decky_plugins_dir.join("simp-decky");
    if src_decky.is_dir()
        && (decky_target.is_dir() || decky_plugins_dir.is_dir() || homebrew_dir.is_dir())
    {
        // Clean any nested/legacy subdirectories inside simp-decky so stale binaries never linger
        let _ = std::fs::remove_dir_all(decky_target.join("simp-decky"));
        let _ = std::fs::remove_dir_all(decky_target.join("bin"));
        let _ = std::fs::remove_dir_all(decky_target.join("ui"));

        if copy_dir_contents(&src_decky, &decky_target).is_ok() {
            decky_updated = true;
        } else {
            #[cfg(unix)]
            {
                let uid = unsafe { libc::getuid() };
                let gid = unsafe { libc::getgid() };
                let target_str = decky_target.to_string_lossy().to_string();
                let plugins_str = decky_plugins_dir.to_string_lossy().to_string();
                let uid_str = uid.to_string();
                let gid_str = gid.to_string();
                let fix_perms_cmd =
                    "mkdir -p \"$1\" && chown -R \"$2:$3\" \"$4\" \"$1\" && chmod 0755 \"$4\" \"$1\"";

                // 3a. Only try non-interactive `sudo -n` (never prompt with interactive `sudo` or `pkexec`!).
                // If `~/homebrew/plugins` is owned by root and passwordless sudo is not enabled,
                // `~/.local/share/simp/decky-staged/` is already updated in userland and Decky Loader's
                // root `main.py` (`_sync_staged_decky_plugin`) automatically syncs it without sudo.
                let _ = Command::new("sudo")
                    .args([
                        "-n",
                        "sh",
                        "-c",
                        fix_perms_cmd,
                        "--",
                        &target_str,
                        &uid_str,
                        &gid_str,
                        &plugins_str,
                    ])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();

                if copy_dir_contents(&src_decky, &decky_target).is_ok() {
                    decky_updated = true;
                }
            }
        }

        if decky_updated {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let main_py = decky_target.join("main.py");
                if main_py.is_file() {
                    let _ =
                        std::fs::set_permissions(&main_py, std::fs::Permissions::from_mode(0o755));
                }
                // Best-effort non-interactive reload of Decky's plugin_loader service if passwordless sudo is enabled
                let _ = Command::new("sudo")
                    .args(["-n", "systemctl", "restart", "plugin_loader"])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
        }
    }

    let _ = std::fs::remove_dir_all(&tmp_dir);

    // 4. Schedule background daemon restart (after a 450ms delay so HTTP response returns first)
    if restart_daemon_after {
        spawn_delayed_daemon_restart();
    }

    let msg = if decky_updated {
        format!("Updated SIMP ({arch} Daemon + UI + Decky QAM) to v{target_ver}")
    } else {
        format!("Updated SIMP ({arch} Daemon + UI) to v{target_ver}")
    };

    Ok(UpdateApplyResult {
        ok: true,
        previous_version: status.current_version,
        updated_version: target_ver,
        decky_updated,
        message: msg,
    })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn install_linux_icons_and_desktop_entries(
    home: &Path,
    dest_bin: &Path,
    ui_dest_dir: &Path,
    src_desktop: Option<&Path>,
) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let local_bin_dir = home.join(".local/bin");
        let _ = std::fs::create_dir_all(&local_bin_dir);
        let symlink_path = local_bin_dir.join("simp");
        let _ = std::fs::remove_file(&symlink_path);
        let _ = std::os::unix::fs::symlink(dest_bin, &symlink_path);

        let usr_local_bin_link = PathBuf::from("/usr/local/bin/simp");
        if usr_local_bin_link.exists() || Path::new("/usr/local/bin").exists() {
            let _ = std::fs::remove_file(&usr_local_bin_link);
            let _ = std::os::unix::fs::symlink(dest_bin, &usr_local_bin_link);
        }

        // Install multi-resolution RGBA PNGs into `~/.local/share/icons/hicolor/<size>/apps/org.simp.player.png`
        // and `~/.local/share/pixmaps/org.simp.player.png` so Steam Frame's program launcher, app launch history,
        // and KDE Plasma always resolve `Icon=org.simp.player` at native resolution.
        let hicolor_root = home.join(".local/share/icons/hicolor");
        let fallback_icon = ui_dest_dir.join("simp-icon-256.png");
        let fallback_icon = if fallback_icon.is_file() {
            fallback_icon
        } else {
            ui_dest_dir.join("simp-icon-dark.png")
        };

        for (size_dir, file_name) in [
            ("16x16", "simp-icon-16.png"),
            ("32x32", "simp-icon-32.png"),
            ("48x48", "simp-icon-48.png"),
            ("64x64", "simp-icon-64.png"),
            ("128x128", "simp-icon-128.png"),
            ("256x256", "simp-icon-256.png"),
            ("512x512", "simp-icon-512.png"),
        ] {
            let src_png = {
                let candidate = ui_dest_dir.join(file_name);
                if candidate.is_file() {
                    candidate
                } else {
                    fallback_icon.clone()
                }
            };
            if src_png.is_file() {
                let apps_icon_dir = hicolor_root.join(size_dir).join("apps");
                let _ = std::fs::create_dir_all(&apps_icon_dir);
                let _ = std::fs::copy(&src_png, apps_icon_dir.join("org.simp.player.png"));
                let _ = std::fs::copy(&src_png, apps_icon_dir.join("simp.png"));
            }
        }

        if fallback_icon.is_file() {
            let icons_base = home.join(".local/share/icons");
            let pixmaps_dir = home.join(".local/share/pixmaps");
            let _ = std::fs::create_dir_all(&icons_base);
            let _ = std::fs::create_dir_all(&pixmaps_dir);
            let _ = std::fs::copy(&fallback_icon, icons_base.join("org.simp.player.png"));
            let _ = std::fs::copy(&fallback_icon, pixmaps_dir.join("org.simp.player.png"));
            let _ = std::fs::copy(&fallback_icon, pixmaps_dir.join("simp.png"));
        }

        let apps_dir = home.join(".local/share/applications");
        let _ = std::fs::create_dir_all(&apps_dir);
        let bin_str = dest_bin.to_string_lossy();

        if let Some(desktop_file) = src_desktop {
            if let Ok(raw_desktop) = std::fs::read_to_string(desktop_file) {
                let rendered = raw_desktop
                    .replace("__SIMP_BIN__", &bin_str)
                    .replace("__SIMP_ICON__", "org.simp.player");
                let dest_desktop = apps_dir.join("org.simp.player.desktop");
                if std::fs::write(&dest_desktop, rendered).is_ok() {
                    let _ = std::fs::set_permissions(
                        &dest_desktop,
                        std::fs::Permissions::from_mode(0o755),
                    );
                }
            }
        }

        // Hidden Wayland/X11/Steam Frame launcher matcher `.desktop` entries so app launch history
        // and window managers map `simp`, `simp-player-ui`, and Chromium `--app=http://127.0.0.1:18888` to SIMP's icon.
        for alias_id in [
            "simp-player-ui",
            "simp",
            "chrome-127.0.0.1__-Default",
            "chrome-http___127.0.0.1_18888_-Default",
            "127.0.0.1",
        ] {
            let alias_path = apps_dir.join(format!("{alias_id}.desktop"));
            let content = format!(
                "[Desktop Entry]\nType=Application\nName=SIMP\nExec={bin_str}\nIcon=org.simp.player\nNoDisplay=true\nStartupWMClass={alias_id}\n"
            );
            if std::fs::write(&alias_path, content).is_ok() {
                let _ = std::fs::set_permissions(&alias_path, std::fs::Permissions::from_mode(0o644));
            }
        }

        let _ = Command::new("gtk-update-icon-cache")
            .args(["-f", "-t"])
            .arg(&hicolor_root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = Command::new("update-desktop-database")
            .arg(&apps_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_self_update(
    status: &UpdateStatus,
    tag: &str,
    target_ver: &str,
    restart_after: bool,
) -> Result<UpdateApplyResult> {
    let current_exe = std::env::current_exe()
        .context("Could not determine running simp.exe path")?;
    let install_dir = current_exe
        .parent()
        .ok_or_else(|| anyhow!("Could not determine simp.exe install directory"))?
        .to_path_buf();

    let tmp_dir = std::env::temp_dir().join(format!("simp-windows-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp_dir);
    std::fs::create_dir_all(&tmp_dir)?;

    let arch = std::env::consts::ARCH;
    let zip_name = format!("simp-windows-portable-{arch}.zip");
    let zip_path = tmp_dir.join(&zip_name);
    let download_url = status.asset_url.clone().unwrap_or_else(|| {
        format!("https://github.com/niiiitz/simp/releases/download/{tag}/{zip_name}")
    });

    // 1. Download `simp-windows-portable-x86_64.zip` via in-process WinHTTP / system curl.exe
    let mut dl_ok = false;
    if let Ok(bytes) = crate::http_pool::http_get_bytes(
        &download_url,
        &[("User-Agent", "SIMP-Updater")],
        None,
        180,
    ) {
        if bytes.len() > 1024 && bytes.starts_with(b"PK\x03\x04") {
            if std::fs::write(&zip_path, &bytes).is_ok() {
                dl_ok = true;
            }
        }
    }

    if !dl_ok {
        let curl_bin = if Path::new(r"C:\Windows\System32\curl.exe").is_file() {
            r"C:\Windows\System32\curl.exe"
        } else {
            "curl"
        };
        let mut cmd = Command::new(curl_bin);
        cmd.args([
            "-4",
            "--http1.1",
            "--retry",
            "2",
            "-fsSL",
            "--connect-timeout",
            "15",
            "--max-time",
            "180",
            "-o",
        ])
        .arg(&zip_path)
        .arg(&download_url);
        crate::configure_background_command(&mut cmd);
        dl_ok = cmd.status().map(|s| s.success()).unwrap_or(false);
    }

    if !dl_ok {
        let ps_cmd = format!(
            "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '{}' -OutFile '{}'",
            download_url.replace('\'', "''"),
            zip_path.to_string_lossy().replace('\'', "''")
        );
        let mut ps = Command::new("powershell");
        ps.args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd]);
        crate::configure_background_command(&mut ps);
        dl_ok = ps.status().map(|s| s.success()).unwrap_or(false);
    }

    if !dl_ok || !zip_path.is_file() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(anyhow!(
            "Failed to download Windows Portable release archive from {download_url}"
        ));
    }

    // 2. Extract `.zip` using built-in Windows 10/11 `tar.exe -xf` (or PowerShell `Expand-Archive` fallback)
    let extract_dir = tmp_dir.join("extracted");
    std::fs::create_dir_all(&extract_dir)?;
    let tar_bin = if Path::new(r"C:\Windows\System32\tar.exe").is_file() {
        r"C:\Windows\System32\tar.exe"
    } else {
        "tar"
    };
    let mut tar_cmd = Command::new(tar_bin);
    tar_cmd
        .arg("-xf")
        .arg(&zip_path)
        .arg("-C")
        .arg(&extract_dir);
    crate::configure_background_command(&mut tar_cmd);
    let mut extracted_ok = tar_cmd.status().map(|s| s.success()).unwrap_or(false);

    if !extracted_ok {
        let ps_extract = format!(
            "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
            zip_path.to_string_lossy().replace('\'', "''"),
            extract_dir.to_string_lossy().replace('\'', "''")
        );
        let mut ps = Command::new("powershell");
        ps.args(["-NoProfile", "-NonInteractive", "-Command", &ps_extract]);
        crate::configure_background_command(&mut ps);
        extracted_ok = ps.status().map(|s| s.success()).unwrap_or(false);
    }

    if !extracted_ok {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(anyhow!("Failed to extract Windows release archive {download_url}"));
    }

    let nested_root = extract_dir.join("simp-windows-portable");
    let bundle_root = if nested_root.join("simp.exe").is_file() {
        nested_root
    } else {
        extract_dir.clone()
    };
    let src_exe = bundle_root.join("simp.exe");
    let src_ui = bundle_root.join("ui");
    if !src_exe.is_file() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(anyhow!(
            "Downloaded Windows archive did not contain simp.exe"
        ));
    }

    // 3. In-place atomic replacement of `simp.exe` in `install_dir`:
    // Windows allows renaming a currently running `.exe` (`simp.exe` -> `simp.exe.old`) in the same folder
    // without Administrator privileges, while keeping `data\` (`library.db`, `settings.vdf`, `art\`) untouched!
    let dest_exe = install_dir.join("simp.exe");
    let primary_old_exe = install_dir.join("simp.exe.old");
    let _ = std::fs::remove_file(&primary_old_exe);
    let _ = std::fs::remove_file(install_dir.join("simp.ico"));
    let old_exe = if primary_old_exe.exists() {
        // Fallback if a previous `.old` file is still locked by another process
        install_dir.join(format!("simp.exe.{}.old", std::process::id()))
    } else {
        primary_old_exe
    };
    if dest_exe.is_file() {
        std::fs::rename(&dest_exe, &old_exe).with_context(|| {
            format!(
                "Could not rename running {} to {} (check folder write permissions)",
                dest_exe.display(),
                old_exe.display()
            )
        })?;
    }
    if let Err(e) = std::fs::copy(&src_exe, &dest_exe) {
        if old_exe.is_file() && !dest_exe.is_file() {
            let _ = std::fs::rename(&old_exe, &dest_exe);
        }
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(anyhow!(
            "Failed to write updated {}: {e}",
            dest_exe.display()
        ));
    }

    // 4. Update `ui\` in-place (preserving `data\`)
    if src_ui.join("index.html").is_file() {
        let dest_ui = install_dir.join("ui");
        let _ = std::fs::remove_dir_all(&dest_ui);
        let _ = copy_dir_contents(&src_ui, &dest_ui);
    }

    let _ = std::fs::remove_dir_all(&tmp_dir);

    if restart_after {
        spawn_delayed_daemon_restart();
    }

    Ok(UpdateApplyResult {
        ok: true,
        previous_version: status.current_version.clone(),
        updated_version: target_ver.to_string(),
        decky_updated: false,
        message: format!(
            "Updated SIMP Portable ({}) to v{target_ver}",
            install_dir.display()
        ),
    })
}

#[cfg(target_os = "macos")]
fn resolve_macos_app_bundle_dest() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        for ancestor in exe.ancestors() {
            if ancestor
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("app"))
                .unwrap_or(false)
            {
                return ancestor.to_path_buf();
            }
        }
    }
    let sys_app = PathBuf::from("/Applications/SIMP.app");
    if sys_app.exists() || Path::new("/Applications").exists() {
        return sys_app;
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("Applications/SIMP.app")
}

#[cfg(target_os = "macos")]
fn apply_macos_self_update(
    status: &UpdateStatus,
    tag: &str,
    target_ver: &str,
    restart_after: bool,
) -> Result<UpdateApplyResult> {
    let tmp_dir = PathBuf::from(format!("/tmp/simp-macos-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp_dir);
    std::fs::create_dir_all(&tmp_dir)?;

    let arch_slug = if std::env::consts::ARCH == "aarch64" {
        "arm64"
    } else {
        std::env::consts::ARCH
    };
    let zip_path = tmp_dir.join(format!("SIMP-macos-{arch_slug}.zip"));
    let download_url = status.asset_url.clone().unwrap_or_else(|| {
        format!("https://github.com/niiiitz/simp/releases/download/{tag}/SIMP-macos-{arch_slug}.zip")
    });

    let dl_ok = Command::new("curl")
        .args([
            "-4",
            "--http1.1",
            "--retry",
            "2",
            "-fsSL",
            "--connect-timeout",
            "15",
            "--max-time",
            "180",
            "-o",
        ])
        .arg(&zip_path)
        .arg(&download_url)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !dl_ok {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(anyhow!(
            "Failed to download macOS release bundle from {download_url}"
        ));
    }

    let extract_dir = tmp_dir.join("extracted");
    std::fs::create_dir_all(&extract_dir)?;
    let ditto_ok = Command::new("ditto")
        .args(["-x", "-k"])
        .arg(&zip_path)
        .arg(&extract_dir)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !ditto_ok {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(anyhow!("Failed to extract {download_url} with ditto"));
    }

    let staged_app = extract_dir.join("SIMP.app");
    if !staged_app.join("Contents/MacOS/simp").is_file() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(anyhow!(
            "Downloaded macOS archive did not contain SIMP.app/Contents/MacOS/simp"
        ));
    }

    let dest_app = resolve_macos_app_bundle_dest();
    if let Some(parent) = dest_app.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::remove_dir_all(&dest_app);
    let copy_ok = Command::new("ditto")
        .arg(&staged_app)
        .arg(&dest_app)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    let _ = std::fs::remove_dir_all(&tmp_dir);
    if !copy_ok {
        return Err(anyhow!(
            "Failed to install updated SIMP.app into {}",
            dest_app.display()
        ));
    }

    let _ = Command::new("xattr")
        .args(["-cr"])
        .arg(&dest_app)
        .status();

    if restart_after {
        spawn_delayed_daemon_restart();
    }

    Ok(UpdateApplyResult {
        ok: true,
        previous_version: status.current_version.clone(),
        updated_version: target_ver.to_string(),
        decky_updated: false,
        message: format!(
            "Updated SIMP.app ({}) to v{target_ver}",
            dest_app.display()
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_tuple_comparison() {
        assert!(is_newer_version("0.1.0-alpha.21", "0.1.0-alpha.22"));
        assert!(is_newer_version("0.1.0-alpha.9", "0.1.0-alpha.10"));
        assert!(!is_newer_version("0.1.0-alpha.22", "0.1.0-alpha.22"));
        assert!(!is_newer_version("0.1.0-alpha.22", "0.1.0-alpha.21"));
        assert!(is_newer_version("0.1.0-alpha.99", "0.1.0"));
        assert!(is_newer_version("0.1.0", "0.1.1-alpha.1"));
    }

    #[test]
    fn test_find_platform_arch_asset_url_matches_os_and_architecture() {
        let rel = GithubReleaseItem {
            tag_name: "v0.1.0-alpha.40".to_string(),
            html_url: "https://github.com/niiiitz/simp/releases/tag/v0.1.0-alpha.40".to_string(),
            draft: false,
            prerelease: true,
            published_at: None,
            assets: vec![
                GithubReleaseAsset {
                    name: "simp-steamos-userland-aarch64.tar.gz".to_string(),
                    browser_download_url: "https://example.com/aarch64.tar.gz".to_string(),
                    state: "uploaded".to_string(),
                },
                GithubReleaseAsset {
                    name: "simp-steamos-userland-x86_64.tar.gz".to_string(),
                    browser_download_url: "https://example.com/x86_64.tar.gz".to_string(),
                    state: "uploaded".to_string(),
                },
                GithubReleaseAsset {
                    name: "SIMP-macos-arm64.zip".to_string(),
                    browser_download_url: "https://example.com/SIMP-macos-arm64.zip".to_string(),
                    state: "uploaded".to_string(),
                },
            ],
        };
        assert_eq!(
            find_platform_arch_asset_url(&rel, "linux", "aarch64").as_deref(),
            Some("https://example.com/aarch64.tar.gz")
        );
        assert_eq!(
            find_platform_arch_asset_url(&rel, "linux", "x86_64").as_deref(),
            Some("https://example.com/x86_64.tar.gz")
        );
        assert_eq!(
            find_platform_arch_asset_url(&rel, "macos", "aarch64").as_deref(),
            Some("https://example.com/SIMP-macos-arm64.zip")
        );
        assert!(!is_stable_release_item(&rel));
    }
}
