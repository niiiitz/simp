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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateApplyResult {
    pub ok: bool,
    pub previous_version: String,
    pub updated_version: String,
    pub decky_updated: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseItem {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    published_at: Option<String>,
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

/// Queries GitHub Releases (`niiiitz/simp` or configured `github_releases_api_url` in `settings.vdf`)
/// for the newest release (including `-alpha.X` pre-releases).
pub fn check_for_updates() -> Result<UpdateStatus> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let prov = load_provisioning_settings();
    let api_url = if prov.github_releases_api_url.trim().is_empty() {
        "https://api.github.com/repos/niiiitz/simp/releases?per_page=8"
    } else {
        prov.github_releases_api_url.trim()
    };

    let bytes = crate::http_pool::http_get_bytes(
        api_url,
        &[("Accept", "application/vnd.github+json")],
        None,
        8,
    )
    .map_err(|e| anyhow!("GitHub API request failed: {e}"))?;

    let releases: Vec<GithubReleaseItem> = serde_json::from_slice(&bytes)
        .map_err(|e| anyhow!("Failed to parse GitHub releases JSON: {e}"))?;

    let newest = releases
        .into_iter()
        .filter(|r| !r.draft && !r.tag_name.trim().is_empty())
        .max_by_key(|r| parse_version_tuple(&r.tag_name))
        .ok_or_else(|| anyhow!("No published releases found on GitHub"))?;

    let latest_version = newest.tag_name.trim().trim_start_matches('v').to_string();
    let update_available = is_newer_version(&current_version, &latest_version);

    Ok(UpdateStatus {
        current_version,
        latest_version,
        latest_tag: newest.tag_name,
        update_available,
        release_url: newest.html_url,
        published_at: newest.published_at,
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
            // Unlink destination first: on POSIX/Linux, if a file was previously created by `sudo` (root:root)
            // inside a user-owned directory, overwriting in-place fails with EACCES, whereas unlinking first succeeds!
            let _ = std::fs::remove_file(&dest_path);
            std::fs::copy(&path, &dest_path)?;
        }
    }
    Ok(())
}

/// Spawns a detached background shell that waits 450ms (allowing the HTTP 200 OK response to flush
/// to the UI / Decky QAM client) and then cleanly restarts `simp.service` (or the daemon process).
pub fn spawn_delayed_daemon_restart() {
    let _ = Command::new("sh")
        .arg("-c")
        .arg(
            "sleep 0.45 && \
             export XDG_RUNTIME_DIR=\"${XDG_RUNTIME_DIR:-/run/user/$(id -u)}\"; \
             pkill -f 'simp-widevine-worker' 2>/dev/null || true; \
             pkill -f '18888/?worker=apple' 2>/dev/null || true; \
             if command -v systemctl >/dev/null 2>&1 && [ -f \"$HOME/.config/systemd/user/simp.service\" ]; then \
               systemctl --user daemon-reload 2>/dev/null || true; \
               systemctl --user restart simp.service 2>/dev/null || true; \
             else \
               pkill -f 'simp --daemon' 2>/dev/null || true; \
               sleep 0.2; \
               nohup \"$HOME/.local/share/simp/bin/simp\" --daemon >/dev/null 2>&1 & \
             fi",
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

/// Downloads the latest `simp-steamos-userland-x86_64.tar.gz` release bundle from GitHub,
/// atomically updates `~/.local/share/simp/bin/simp`, `~/.local/share/simp/ui/`, and
/// `~/homebrew/plugins/simp-decky/` (if writable), and schedules a daemon restart.
pub fn apply_self_update(
    target_tag: Option<&str>,
    force_reinstall: bool,
    restart_daemon_after: bool,
) -> Result<UpdateApplyResult> {
    let status = check_for_updates()?;
    let tag = target_tag.unwrap_or(&status.latest_tag).to_string();
    let target_ver = tag.trim().trim_start_matches('v').to_string();

    if !force_reinstall && !is_newer_version(&status.current_version, &target_ver) && target_ver == status.current_version {
        // Still allow reinstalling if explicitly requested, otherwise report already up-to-date
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
    let template = if prov.release_asset_template.trim().is_empty() {
        "https://github.com/niiiitz/simp/releases/download/{tag}/simp-steamos-userland-{arch}.tar.gz"
    } else {
        prov.release_asset_template.trim()
    };
    let download_url = template
        .replace("{tag}", &tag)
        .replace("{arch}", arch);

    let dl_status = Command::new("curl")
        .args(["-fsSL", "--max-time", "90", "-o"])
        .arg(&tarball_path)
        .arg(&download_url)
        .status()
        .map_err(|e| anyhow!("Failed to invoke curl for download: {e}"))?;

    if !dl_status.success() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(anyhow!("Failed to download release archive from {download_url}"));
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
    // so replacing the currently-running binary never triggers `ETXTBSY` ("Text file busy").
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
                let _ = std::fs::set_permissions(&dest_uninstall, std::fs::Permissions::from_mode(0o755));
            }
        }
    }

    // Ensure `~/.local/bin/simp` symlink points to `~/.local/share/simp/bin/simp`
    #[cfg(unix)]
    {
        let symlink_path = local_bin_dir.join("simp");
        let _ = std::fs::remove_file(&symlink_path);
        let _ = std::os::unix::fs::symlink(&dest_bin, &symlink_path);

        // If `/usr/local/bin` is writable (or `/usr/local/bin/simp` already exists and is replaceable),
        // update `/usr/local/bin/simp` as well so `whereis simp` and `simp` work in every shell.
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

    // 3. Stage Decky plugin into `~/.local/share/simp/decky-staged/` (always writable in userland)
    // and also copy directly into `~/homebrew/plugins/simp-decky/` if present and writable.
    // Even if `~/homebrew/plugins/simp-decky/` is owned by `root:root`, Decky Loader's `main.py`
    // (running as root) automatically syncs `~/.local/share/simp/decky-staged/` into `~/homebrew/plugins/simp-decky/`!
    let mut decky_updated = false;
    let decky_staged = install_root.join("decky-staged");
    if src_decky.is_dir() {
        let _ = std::fs::remove_dir_all(&decky_staged);
        if copy_dir_contents(&src_decky, &decky_staged).is_ok() {
            decky_updated = true;
        }
    }

    let decky_target = home.join("homebrew/plugins/simp-decky");
    if src_decky.is_dir() && decky_target.is_dir() {
        let _ = std::fs::remove_dir_all(decky_target.join("simp-decky"));
        if copy_dir_contents(&src_decky, &decky_target).is_ok() {
            decky_updated = true;
        }
    }

    let _ = std::fs::remove_dir_all(&tmp_dir);

    // 4. Schedule background daemon restart (after a 450ms delay so HTTP response returns first)
    if restart_daemon_after {
        spawn_delayed_daemon_restart();
    }

    let msg = if decky_updated {
        format!("Updated SIMP (Daemon + UI + Decky QAM) to v{target_ver}")
    } else {
        format!("Updated SIMP (Daemon + UI) to v{target_ver}")
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
}

