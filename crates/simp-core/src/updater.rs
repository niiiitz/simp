use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    state: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubReleaseItem {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
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

/// Finds the matching architecture tarball URL inside a GitHub release's `assets` list.
fn find_arch_asset_url(release: &GithubReleaseItem, arch: &str) -> Option<String> {
    let primary_name = format!("simp-steamos-userland-{arch}.tar.gz");
    if let Some(asset) = release.assets.iter().find(|a| {
        a.name == primary_name && (a.state.is_empty() || a.state == "uploaded")
    }) {
        return Some(asset.browser_download_url.clone());
    }
    // On x86_64, also accept the generic `simp-steamos-userland.tar.gz` archive
    if arch == "x86_64" {
        if let Some(asset) = release.assets.iter().find(|a| {
            a.name == "simp-steamos-userland.tar.gz"
                && (a.state.is_empty() || a.state == "uploaded")
        }) {
            return Some(asset.browser_download_url.clone());
        }
    }
    None
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

/// Queries GitHub Releases (`niiiitz/simp` or configured `github_releases_api_url` in `settings.vdf`)
/// for the newest release that provides a build for the current CPU architecture (`aarch64` or `x86_64`).
pub fn check_for_updates() -> Result<UpdateStatus> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let target_arch = std::env::consts::ARCH.to_string();
    let prov = load_provisioning_settings();
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
        .collect();

    // Prefer the newest release that actually has the current architecture's tarball uploaded
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
    })
}

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
            let mut cmd = Command::new(exe);
            cmd.arg("--daemon")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            crate::configure_background_command(&mut cmd);
            let _ = cmd.spawn();
        }
        return;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let script = "sleep 0.45; \
            export XDG_RUNTIME_DIR=\"${XDG_RUNTIME_DIR:-/run/user/$(id -u)}\"; \
            pkill -f 'simp-widevine-worker' 2>/dev/null || true; \
            pkill -f '18888/?worker=apple' 2>/dev/null || true; \
            if command -v systemctl >/dev/null 2>&1 && [ -f \"$HOME/.config/systemd/user/simp.service\" ]; then \
              systemctl --user daemon-reload 2>/dev/null || true; \
              systemctl --user stop simp.service 2>/dev/null || true; \
            fi; \
            pkill -TERM -f 'simp --daemon' 2>/dev/null || true; \
            sleep 0.25; \
            pkill -9 -f 'simp --daemon' 2>/dev/null || true; \
            if command -v systemctl >/dev/null 2>&1 && [ -f \"$HOME/.config/systemd/user/simp.service\" ]; then \
              systemctl --user start simp.service 2>/dev/null || true; \
              sleep 0.5; \
            fi; \
            if ! curl -fsS --max-time 2 http://127.0.0.1:18888/health >/dev/null 2>&1; then \
              nohup \"$HOME/.local/share/simp/bin/simp\" --daemon >/dev/null 2>&1 & \
            fi";

        // Detach into a new session via `setsid` so `systemctl --user stop simp.service` never kills the restart script
        let spawned = Command::new("setsid")
            .args(["sh", "-c", script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();

        if spawned.is_err() {
            let _ = Command::new("sh")
                .args(["-c", script])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
        }
    }
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
    let dest_bin = bin_dest_dir.join("simp");
    let dest_bin_new = bin_dest_dir.join("simp.new");
    let _ = std::fs::remove_file(&dest_bin_new);
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

    // Also update `uninstall-steamos.sh` in `~/.local/share/simp/bin/` if present in the bundle
    let src_uninstall = extracted_root.join("uninstall-steamos.sh");
    if src_uninstall.is_file() {
        let dest_uninstall = bin_dest_dir.join("uninstall-steamos.sh");
        let _ = std::fs::remove_file(&dest_uninstall);
        if std::fs::copy(&src_uninstall, &dest_uninstall).is_ok() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(
                    &dest_uninstall,
                    std::fs::Permissions::from_mode(0o755),
                );
            }
        }
    }

    // Ensure `~/.local/bin/simp` symlink points to `~/.local/share/simp/bin/simp`
    #[cfg(unix)]
    {
        let symlink_path = local_bin_dir.join("simp");
        let _ = std::fs::remove_file(&symlink_path);
        let _ = std::os::unix::fs::symlink(&dest_bin, &symlink_path);

        let usr_local_bin_link = PathBuf::from("/usr/local/bin/simp");
        if usr_local_bin_link.exists() || Path::new("/usr/local/bin").exists() {
            let _ = std::fs::remove_file(&usr_local_bin_link);
            let _ = std::os::unix::fs::symlink(&dest_bin, &usr_local_bin_link);
        }
    }

    // 2. Replace `~/.local/share/simp/ui/`
    if src_ui.join("index.html").is_file() {
        let _ = std::fs::remove_dir_all(&ui_dest_dir);
        copy_dir_contents(&src_ui, &ui_dest_dir)?;
    }

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

                // 3a. Try non-interactive sudo first
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
                } else if unsafe { libc::isatty(0) == 1 } {
                    // 3b. Running interactively from `simp update` CLI in a terminal — prompt with sudo
                    println!(
                        "🔒 ~/homebrew/plugins is owned by root (Decky Loader). Restoring ~/homebrew/plugins/simp-decky..."
                    );
                    let _ = Command::new("sudo")
                        .args([
                            "sh",
                            "-c",
                            fix_perms_cmd,
                            "--",
                            &target_str,
                            &uid_str,
                            &gid_str,
                            &plugins_str,
                        ])
                        .status();
                    if copy_dir_contents(&src_decky, &decky_target).is_ok() {
                        decky_updated = true;
                    }
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
    fn test_find_arch_asset_url_matches_architecture() {
        let rel = GithubReleaseItem {
            tag_name: "v0.1.0-alpha.40".to_string(),
            html_url: "https://github.com/niiiitz/simp/releases/tag/v0.1.0-alpha.40".to_string(),
            draft: false,
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
            ],
        };
        assert_eq!(
            find_arch_asset_url(&rel, "aarch64").as_deref(),
            Some("https://example.com/aarch64.tar.gz")
        );
        assert_eq!(
            find_arch_asset_url(&rel, "x86_64").as_deref(),
            Some("https://example.com/x86_64.tar.gz")
        );
    }
}
