use crate::orchestrator::OrchestratorSnapshot;
use simp_protocol::AudioCommand;
#[cfg(target_os = "linux")]
use std::ffi::{c_char, c_int, c_void, CString};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
#[cfg(target_os = "linux")]
use std::time::Duration;
use tokio::sync::mpsc;

// OpenVR EVRApplicationType constants
#[cfg(target_os = "linux")]
const VR_APPLICATION_OVERLAY: c_int = 2;

/// Generates the canonical OpenVR `.vrmanifest` JSON payload for `org.simp.player`.
pub fn build_vrmanifest_json(bin_path: &Path, icon_path: &Path) -> String {
    let manifest = serde_json::json!({
        "source": "builtin",
        "applications": [
            {
                "app_key": "org.simp.player",
                "launch_type": "binary",
                "binary_path_linux": bin_path.to_string_lossy(),
                "binary_path_windows": bin_path.to_string_lossy(),
                "is_dashboard_overlay": true,
                "image_path": icon_path.to_string_lossy(),
                "strings": {
                    "en_us": {
                        "name": "SIMP Media Player",
                        "description": "Simple Integrated Media Player — Native Console & SteamVR Audio Hub"
                    }
                }
            }
        ]
    });
    serde_json::to_string_pretty(&manifest).unwrap_or_default()
}

/// Writes `org.simp.player.vrmanifest` and non-destructively
/// registers its path inside SteamVR's `config/appconfig.json` if a Steam installation is present.
pub fn ensure_vrmanifest_installed() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let install_root = if cfg!(target_os = "windows") || crate::portable_data_dir().is_some() {
        crate::simp_data_dir()
    } else {
        home.join(".local/share/simp")
    };
    let openvr_dir = install_root.join("openvr");
    let _ = std::fs::create_dir_all(&openvr_dir);

    let bin_path = {
        let candidate = install_root.join(if cfg!(target_os = "windows") {
            "bin/simp.exe"
        } else {
            "bin/simp"
        });
        if candidate.is_file() {
            candidate
        } else {
            std::env::current_exe().unwrap_or(candidate)
        }
    };
    let icon_path = {
        let primary = install_root.join("ui/simp-icon-dark.png");
        if primary.is_file() {
            primary
        } else if let Ok(exe) = std::env::current_exe() {
            exe.parent()
                .map(|p| p.join("ui/simp-icon-dark.png"))
                .unwrap_or(primary)
        } else {
            primary
        }
    };
    let local_openvr_icon = openvr_dir.join("simp-icon-dark.png");
    if icon_path.is_file() {
        let _ = std::fs::copy(&icon_path, &local_openvr_icon);
    }
    let manifest_icon = if local_openvr_icon.is_file() {
        &local_openvr_icon
    } else {
        &icon_path
    };
    let manifest_path = openvr_dir.join("org.simp.player.vrmanifest");

    let json_text = build_vrmanifest_json(&bin_path, manifest_icon);
    let _ = std::fs::write(&manifest_path, json_text);

    // Register in SteamVR's `appconfig.json` if present so SteamVR knows about SIMP on startup
    for steam_cfg_dir in [
        home.join(".local/share/Steam/config"),
        home.join(".steam/steam/config"),
        home.join(".steam/root/config"),
        PathBuf::from(r"C:\Program Files (x86)\Steam\config"),
        PathBuf::from(r"C:\Program Files\Steam\config"),
    ] {
        if steam_cfg_dir.is_dir() {
            let appconfig_path = steam_cfg_dir.join("appconfig.json");
            let _ = register_manifest_in_appconfig(&appconfig_path, &manifest_path);
            break;
        }
    }

    // Also populate missing Non-Steam shortcut icons (`shortcuts.vdf` + `grid/<appid>_icon.png`)
    // so the SteamVR Quick Launch Bar and Game Mode Library never show a blank icon slot.
    if icon_path.is_file() {
        ensure_steam_shortcuts_icon_populated(&home, &icon_path);
    }

    Some(manifest_path)
}

/// Scans Steam `userdata/*/config/shortcuts.vdf` and populates the SIMP icon path + `grid/` artwork
/// whenever a Non-Steam shortcut for SIMP was added with a blank `icon` field.
fn ensure_steam_shortcuts_icon_populated(home: &Path, icon_path: &Path) {
    let icon_str = icon_path.to_string_lossy();
    for steam_root in [
        home.join(".local/share/Steam"),
        home.join(".steam/steam"),
        home.join(".steam/root"),
    ] {
        let userdata_dir = steam_root.join("userdata");
        let Ok(entries) = std::fs::read_dir(&userdata_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let cfg_dir = entry.path().join("config");
            let shortcuts_path = cfg_dir.join("shortcuts.vdf");
            if !shortcuts_path.is_file() {
                continue;
            }
            let Ok(raw) = std::fs::read(&shortcuts_path) else {
                continue;
            };
            let (patched_opt, appids) = patch_shortcuts_vdf_icon(&raw, &icon_str);
            if let Some(patched) = patched_opt {
                let _ = std::fs::write(&shortcuts_path, patched);
            }
            if !appids.is_empty() {
                let grid_dir = cfg_dir.join("grid");
                let _ = std::fs::create_dir_all(&grid_dir);
                for appid in appids {
                    for suffix in ["_icon.png", "p.png", "_hero.png", "_logo.png", ".png"] {
                        let dest = grid_dir.join(format!("{appid}{suffix}"));
                        if !dest.is_file() {
                            let _ = std::fs::copy(icon_path, &dest);
                        }
                    }
                }
            }
        }
    }
}

/// Parses binary `shortcuts.vdf` bytes, locates any shortcut whose `AppName` is `"SIMP"` (or `Exe` contains `/simp`),
/// extracts its `appid` (for `grid/<appid>_icon.png`), and fills in `\x01icon\x00<icon_path>\x00` if empty.
pub fn patch_shortcuts_vdf_icon(raw: &[u8], icon_path: &str) -> (Option<Vec<u8>>, Vec<u32>) {
    let mut matched_appids = Vec::new();
    let mut replacements: Vec<(usize, usize)> = Vec::new();

    // Walk top-level shortcut entries inside `\x00shortcuts\x00`
    let mut i = 0usize;
    while i < raw.len() {
        // Look for `\x02appid\x00` (case-insensitive `appid`) or scan each shortcut block
        if raw[i] == 0x00 && i + 2 < raw.len() {
            // Possible block start `\x00<index>\x00`
            if let Some(end_key) = raw[i + 1..].iter().position(|&b| b == 0) {
                let key_bytes = &raw[i + 1..i + 1 + end_key];
                if !key_bytes.is_empty() && key_bytes.iter().all(|b| b.is_ascii_digit()) {
                    let mut cur = i + 1 + end_key + 1;
                    let mut appid: u32 = 0;
                    let mut is_simp = false;
                    let mut empty_icon_span: Option<(usize, usize)> = None;

                    while cur < raw.len() {
                        let tag = raw[cur];
                        cur += 1;
                        if tag == 0x08 {
                            break;
                        }
                        let Some(k_len) = raw[cur..].iter().position(|&b| b == 0) else {
                            break;
                        };
                        let key = String::from_utf8_lossy(&raw[cur..cur + k_len]).to_lowercase();
                        cur += k_len + 1;

                        match tag {
                            0x01 => {
                                let val_start = cur;
                                let Some(v_len) = raw[cur..].iter().position(|&b| b == 0) else {
                                    break;
                                };
                                let val = String::from_utf8_lossy(&raw[val_start..val_start + v_len]);
                                cur += v_len + 1;
                                if key == "appname" && val.trim().to_lowercase().contains("simp") {
                                    is_simp = true;
                                } else if key == "exe" && (val.contains("/simp") || val.contains("\"simp\"")) {
                                    is_simp = true;
                                } else if key == "icon" {
                                    let trimmed = val.trim();
                                    let needs_update = trimmed.is_empty()
                                        || !trimmed.ends_with(".png")
                                        || (trimmed != icon_path && !Path::new(trimmed).is_file());
                                    if needs_update {
                                        empty_icon_span = Some((val_start, val_start + v_len));
                                    }
                                }
                            }
                            0x02 => {
                                if cur + 4 > raw.len() {
                                    break;
                                }
                                if key == "appid" {
                                    appid = u32::from_le_bytes([
                                        raw[cur],
                                        raw[cur + 1],
                                        raw[cur + 2],
                                        raw[cur + 3],
                                    ]);
                                }
                                cur += 4;
                            }
                            0x00 => {
                                // Skip nested map (e.g., `tags`) until matching `0x08`
                                let mut depth = 1usize;
                                while cur < raw.len() && depth > 0 {
                                    let t = raw[cur];
                                    cur += 1;
                                    if t == 0x08 {
                                        depth -= 1;
                                    } else {
                                        let Some(kl) = raw[cur..].iter().position(|&b| b == 0) else {
                                            break;
                                        };
                                        cur += kl + 1;
                                        if t == 0x00 {
                                            depth += 1;
                                        } else if t == 0x01 {
                                            let Some(vl) = raw[cur..].iter().position(|&b| b == 0) else {
                                                break;
                                            };
                                            cur += vl + 1;
                                        } else if t == 0x02 {
                                            cur = (cur + 4).min(raw.len());
                                        }
                                    }
                                }
                            }
                            _ => break,
                        }
                    }

                    if is_simp {
                        if appid != 0 {
                            matched_appids.push(appid);
                        }
                        if let Some(span) = empty_icon_span {
                            replacements.push(span);
                        }
                    }
                    i = cur;
                    continue;
                }
            }
        }
        i += 1;
    }

    if replacements.is_empty() {
        return (None, matched_appids);
    }

    let mut out = Vec::with_capacity(raw.len() + replacements.len() * icon_path.len());
    let mut last = 0usize;
    for (start, end) in replacements {
        out.extend_from_slice(&raw[last..start]);
        out.extend_from_slice(icon_path.as_bytes());
        last = end;
    }
    out.extend_from_slice(&raw[last..]);
    (Some(out), matched_appids)
}

/// Non-destructively adds `manifest_path` to `manifest_paths` array in SteamVR's `appconfig.json`.
pub fn register_manifest_in_appconfig(appconfig_path: &Path, manifest_path: &Path) -> bool {
    let manifest_str = manifest_path.to_string_lossy().to_string();
    let mut root: serde_json::Value = if appconfig_path.is_file() {
        std::fs::read_to_string(appconfig_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let Some(obj) = root.as_object_mut() else {
        return false;
    };
    let paths_val = obj
        .entry("manifest_paths")
        .or_insert_with(|| serde_json::json!([]));
    if let Some(arr) = paths_val.as_array_mut() {
        if !arr.iter().any(|v| v.as_str() == Some(&manifest_str)) {
            arr.push(serde_json::Value::String(manifest_str));
        }
    }
    if let Ok(pretty) = serde_json::to_string_pretty(&root) {
        std::fs::write(appconfig_path, pretty).is_ok()
    } else {
        false
    }
}

/// Checks `/proc` on Linux to see if `vrserver` or `vrcompositor` is currently running.
/// Avoids calling `VR_InitInternal` when SteamVR is not active so `simp --daemon` never
/// auto-launches SteamVR while the user is in 2D desktop mode.
#[cfg(target_os = "linux")]
fn is_steamvr_process_running() -> bool {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return false;
    };
    for entry in entries.flatten() {
        let comm_path = entry.path().join("comm");
        if let Ok(comm) = std::fs::read_to_string(&comm_path) {
            let name = comm.trim();
            if name == "vrserver" || name == "vrcompositor" {
                return true;
            }
        }
    }
    false
}

/// Searches for `libopenvr_api.so` across userland SIMP lib dir, SteamVR `linuxarm64` (Steam Frame),
/// and SteamVR `linux64` (SteamOS / Linux PCVR).
#[cfg(target_os = "linux")]
fn discover_openvr_library_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(custom) = std::env::var("SIMP_OPENVR_LIB_PATH") {
        if !custom.trim().is_empty() {
            candidates.push(PathBuf::from(custom.trim()));
        }
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/share/simp/lib/libopenvr_api.so"));
        let arch_dirs: &[&str] = if cfg!(target_arch = "aarch64") {
            &["linuxarm64", "arm64", "linux64"]
        } else {
            &["linux64", "linuxarm64"]
        };
        for steam_root in [
            home.join(".local/share/Steam"),
            home.join(".steam/steam"),
            home.join(".steam/root"),
        ] {
            for ad in arch_dirs {
                candidates.push(
                    steam_root
                        .join("steamapps/common/SteamVR/bin")
                        .join(ad)
                        .join("libopenvr_api.so"),
                );
            }
        }
    }
    candidates.push(PathBuf::from("libopenvr_api.so"));
    candidates
}

#[cfg(target_os = "linux")]
#[repr(C)]
struct VrApplicationsFnTablePrefix {
    add_application_manifest: unsafe extern "C" fn(*const c_char, bool) -> c_int,
}

#[cfg(target_os = "linux")]
#[repr(C)]
struct VrOverlayFnTablePrefix {
    find_overlay: unsafe extern "C" fn(*const c_char, *mut u64) -> c_int,
    create_overlay: unsafe extern "C" fn(*const c_char, *const c_char, *mut u64) -> c_int,
    destroy_overlay: unsafe extern "C" fn(u64) -> c_int,
    set_overlay_name: unsafe extern "C" fn(u64, *const c_char) -> c_int,
}

/// Spawns the non-blocking OpenVR `IVROverlay` & `.vrmanifest` integration thread for
/// Steam Frame (`aarch64`) and Linux SteamVR headsets.
pub fn spawn_openvr_overlay_bridge(
    state: Arc<Mutex<OrchestratorSnapshot>>,
    cmd_tx: mpsc::UnboundedSender<AudioCommand>,
) {
    let _ = ensure_vrmanifest_installed();

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (state, cmd_tx);
    }

    #[cfg(target_os = "linux")]
    {
        let _ = cmd_tx;
        let _ = std::thread::Builder::new()
            .name("simp-openvr-bridge".to_string())
            .spawn(move || {
                openvr_bridge_loop(state);
            });
    }
}

#[cfg(target_os = "linux")]
fn openvr_bridge_loop(state: Arc<Mutex<OrchestratorSnapshot>>) {
    type VrInitInternalFn = unsafe extern "C" fn(*mut c_int, c_int) -> u32;
    type VrShutdownInternalFn = unsafe extern "C" fn();
    type VrGetGenericInterfaceFn = unsafe extern "C" fn(*const c_char, *mut c_int) -> *mut c_void;

    loop {
        if !is_steamvr_process_running() {
            std::thread::sleep(Duration::from_secs(6));
            continue;
        }

        let manifest_path = ensure_vrmanifest_installed();

        // Attempt to dlopen libopenvr_api.so
        let mut handle: *mut c_void = std::ptr::null_mut();
        for candidate in discover_openvr_library_paths() {
            let Ok(c_path) = CString::new(candidate.to_string_lossy().as_bytes()) else {
                continue;
            };
            let h = unsafe { libc::dlopen(c_path.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL) };
            if !h.is_null() {
                handle = h;
                tracing::info!(
                    "OpenVR runtime loaded from {} for SteamVR / Steam Frame integration",
                    candidate.display()
                );
                break;
            }
        }

        if handle.is_null() {
            std::thread::sleep(Duration::from_secs(12));
            continue;
        }

        unsafe {
            let init_sym = libc::dlsym(handle, c"VR_InitInternal".as_ptr());
            let shutdown_sym = libc::dlsym(handle, c"VR_ShutdownInternal".as_ptr());
            let get_iface_sym = libc::dlsym(handle, c"VR_GetGenericInterface".as_ptr());

            if !init_sym.is_null() && !shutdown_sym.is_null() && !get_iface_sym.is_null() {
                let vr_init: VrInitInternalFn = std::mem::transmute(init_sym);
                let vr_shutdown: VrShutdownInternalFn = std::mem::transmute(shutdown_sym);
                let vr_get_iface: VrGetGenericInterfaceFn = std::mem::transmute(get_iface_sym);

                let mut init_err: c_int = 0;
                let _token = vr_init(&mut init_err, VR_APPLICATION_OVERLAY);
                if init_err == 0 {
                    // 1. Register `org.simp.player.vrmanifest` with `IVRApplications`
                    if let Some(ref m_path) = manifest_path {
                        if let Ok(c_manifest) = CString::new(m_path.to_string_lossy().as_bytes()) {
                            for ver in [
                                c"FnTable:IVRApplications_007",
                                c"FnTable:IVRApplications_006",
                            ] {
                                let mut iface_err: c_int = 0;
                                let ptr = vr_get_iface(ver.as_ptr(), &mut iface_err);
                                if !ptr.is_null() && iface_err == 0 {
                                    let fns = &*(ptr as *const VrApplicationsFnTablePrefix);
                                    let _ =
                                        (fns.add_application_manifest)(c_manifest.as_ptr(), false);
                                    break;
                                }
                            }
                        }
                    }

                    // 2. Register or update the SIMP overlay handle so SteamVR tracks Now Playing title
                    let mut overlay_fns: Option<&VrOverlayFnTablePrefix> = None;
                    for ver in [
                        c"FnTable:IVROverlay_028",
                        c"FnTable:IVROverlay_027",
                        c"FnTable:IVROverlay_026",
                        c"FnTable:IVROverlay_025",
                        c"FnTable:IVROverlay_024",
                    ] {
                        let mut iface_err: c_int = 0;
                        let ptr = vr_get_iface(ver.as_ptr(), &mut iface_err);
                        if !ptr.is_null() && iface_err == 0 {
                            overlay_fns = Some(&*(ptr as *const VrOverlayFnTablePrefix));
                            break;
                        }
                    }

                    let mut overlay_handle: u64 = 0;
                    if let Some(ov) = overlay_fns {
                        let _ = (ov.create_overlay)(
                            c"org.simp.player.status".as_ptr(),
                            c"SIMP Media Player".as_ptr(),
                            &mut overlay_handle,
                        );
                    }

                    let mut last_label = String::new();
                    while is_steamvr_process_running() {
                        if let Some(ov) = overlay_fns {
                            if overlay_handle != 0 {
                                let label = if let Ok(s) = state.lock() {
                                    if let Some(ref trk) = s.current_track {
                                        let icon = if s.is_playing { "▶" } else { "⏸" };
                                        format!("SIMP • {icon} {}", trk.title)
                                    } else {
                                        "SIMP Media Player".to_string()
                                    }
                                } else {
                                    "SIMP Media Player".to_string()
                                };
                                if label != last_label {
                                    if let Ok(c_lbl) = CString::new(label.as_bytes()) {
                                        let _ = (ov.set_overlay_name)(
                                            overlay_handle,
                                            c_lbl.as_ptr(),
                                        );
                                    }
                                    last_label = label;
                                }
                            }
                        }
                        std::thread::sleep(Duration::from_secs(2));
                    }

                    if let (Some(ov), true) = (overlay_fns, overlay_handle != 0) {
                        let _ = (ov.destroy_overlay)(overlay_handle);
                    }
                    vr_shutdown();
                }
            }
            libc::dlclose(handle);
        }

        std::thread::sleep(Duration::from_secs(6));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_openvr_vrmanifest_json_and_appconfig_registration() {
        let bin = Path::new("/home/deck/.local/share/simp/bin/simp");
        let icon = Path::new("/home/deck/.local/share/simp/ui/simp-icon-dark.png");
        let json_str = build_vrmanifest_json(bin, icon);
        let parsed: serde_json::Value = serde_json::from_str(&json_str).expect("valid json");
        let apps = parsed["applications"].as_array().expect("applications array");
        assert_eq!(apps[0]["app_key"].as_str(), Some("org.simp.player"));
        assert_eq!(apps[0]["is_dashboard_overlay"].as_bool(), Some(true));

        let tmp_cfg = PathBuf::from(format!("/tmp/simp_test_appconfig_{}.json", std::process::id()));
        let tmp_manifest = Path::new("/home/deck/.local/share/simp/openvr/org.simp.player.vrmanifest");
        let _ = std::fs::remove_file(&tmp_cfg);
        assert!(register_manifest_in_appconfig(&tmp_cfg, tmp_manifest));
        // Idempotent second registration
        assert!(register_manifest_in_appconfig(&tmp_cfg, tmp_manifest));
        let cfg_text = std::fs::read_to_string(&tmp_cfg).expect("read appconfig");
        let cfg_val: serde_json::Value = serde_json::from_str(&cfg_text).expect("parse appconfig");
        let paths = cfg_val["manifest_paths"].as_array().expect("manifest_paths");
        assert_eq!(paths.len(), 1);
        assert_eq!(
            paths[0].as_str(),
            Some("/home/deck/.local/share/simp/openvr/org.simp.player.vrmanifest")
        );
        let _ = std::fs::remove_file(&tmp_cfg);
    }

    #[test]
    fn test_patch_shortcuts_vdf_icon() {
        let mut raw = Vec::new();
        raw.extend_from_slice(b"\x00shortcuts\x00\x000\x00");
        raw.extend_from_slice(b"\x02appid\x00\x78\x56\x34\x12");
        raw.extend_from_slice(b"\x01AppName\x00SIMP\x00");
        raw.extend_from_slice(b"\x01Exe\x00\"/home/deck/.local/share/simp/bin/simp\"\x00");
        raw.extend_from_slice(b"\x01icon\x00\x00");
        raw.extend_from_slice(b"\x08\x08\x08");

        let icon_target = "/home/deck/.local/share/simp/ui/simp-icon-dark.png";
        let (patched, appids) = patch_shortcuts_vdf_icon(&raw, icon_target);
        assert_eq!(appids, vec![0x12345678]);
        let patched_bytes = patched.expect("should patch empty icon");
        assert!(patched_bytes
            .windows(icon_target.len())
            .any(|w| w == icon_target.as_bytes()));
    }
}
