use crate::sinks::apple_native::{
    hls::AppleHlsMediaPlaylist,
    mp4_cbcs::{parse_moof_fragment, TrackEncryptionInfo},
};
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Describes the location and ABI capabilities of a discovered Widevine CDM binary
/// (`libwidevinecdm.so` on Linux/SteamOS/Steam Frame, `libwidevinecdm.dylib` on macOS, `widevinecdm.dll` on Windows).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscoveredWidevineCdm {
    pub library_path: PathBuf,
    pub source_label: String,
    pub cdm_version: Option<String>,
}

fn load_provisioning_settings() -> simp_protocol::ProvisioningSettings {
    let path = crate::simp_config_dir().join("settings.vdf");
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(parsed) = keyvalues_serde::from_str::<simp_protocol::SimpSettings>(&text) {
            return parsed.provisioning;
        }
    }
    simp_protocol::ProvisioningSettings::default()
}

const fn platform_cdm_filename() -> &'static str {
    if cfg!(target_os = "macos") {
        "libwidevinecdm.dylib"
    } else if cfg!(target_os = "windows") {
        "widevinecdm.dll"
    } else {
        "libwidevinecdm.so"
    }
}

static NATIVE_CDM_VMP_REJECTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub fn is_native_cdm_vmp_rejected() -> bool {
    NATIVE_CDM_VMP_REJECTED.load(std::sync::atomic::Ordering::SeqCst)
}

pub fn mark_native_cdm_vmp_rejected(reason: &str) {
    if !NATIVE_CDM_VMP_REJECTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        tracing::info!(
            "Native Widevine CDM unavailable ({reason}); delegating Apple Music playback to in-app WebKit/MusicKit worker"
        );
    }
}

#[cfg(target_os = "macos")]
fn verify_macos_cdm_usable_once(lib_path: &Path) -> bool {
    static MACOS_CDM_VERIFIED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *MACOS_CDM_VERIFIED.get_or_init(|| {
        // Minimal 52-byte Widevine v0 PSSH box with a 16-byte test KID
        const TEST_PSSH: [u8; 52] = [
            0x00, 0x00, 0x00, 0x34, b'p', b's', b's', b'h', 0x00, 0x00, 0x00, 0x00, 0xed, 0xef,
            0x8b, 0xa9, 0x79, 0xd6, 0x4a, 0xce, 0xa3, 0xc8, 0x27, 0xdc, 0xd5, 0x1d, 0x21, 0xed,
            0x00, 0x00, 0x00, 0x14, 0x08, 0x01, 0x12, 0x10, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
            0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
        ];
        match with_persistent_cdm_session(lib_path, |session| {
            session.generate_license_challenge(&TEST_PSSH)
        }) {
            Ok(challenge) if !challenge.is_empty() => true,
            Ok(_) => {
                mark_native_cdm_vmp_rejected("macOS libwidevinecdm.dylib returned empty challenge (VMP check)");
                false
            }
            Err(e) => {
                mark_native_cdm_vmp_rejected(&format!("macOS libwidevinecdm.dylib VMP check failed: {e}"));
                false
            }
        }
    })
}

#[cfg(not(target_os = "macos"))]
fn verify_macos_cdm_usable_once(_lib_path: &Path) -> bool {
    true
}

/// Discovers an installed Widevine CDM library (`libwidevinecdm.so`, `libwidevinecdm.dylib`, or `widevinecdm.dll`)
/// on the system without spawning any browser process.
/// Searches:
/// 1. `SIMP_WIDEVINE_CDM_PATH` or `settings.vdf` `[provisioning] widevine_cdm_custom_path`
/// 2. `~/.local/share/simp/lib/<cdm_filename>` (user/SIMP drop-in path)
/// 3. Firefox & Chromium/Chrome/Brave/Edge WidevineCdm directories across Linux, macOS, and Windows
/// 4. Declarative auto-provisioning from `settings.vdf` `[provisioning]` URLs for the current `(OS, ARCH)`
pub fn discover_widevine_cdm_library() -> Option<DiscoveredWidevineCdm> {
    if is_native_cdm_vmp_rejected() || !crate::sinks::apple::is_native_apple_cdm_preferred() {
        return None;
    }
    if let Ok(env_path) = std::env::var("SIMP_WIDEVINE_CDM_PATH") {
        let p = PathBuf::from(env_path.trim());
        if p.is_file() {
            return Some(DiscoveredWidevineCdm {
                library_path: p,
                source_label: "env-override".to_string(),
                cdm_version: None,
            });
        }
    }

    let prov = load_provisioning_settings();
    if !prov.widevine_cdm_custom_path.trim().is_empty() {
        let custom_p = crate::library::vdf::normalize_platform_path(prov.widevine_cdm_custom_path.trim());
        if custom_p.is_file() {
            return Some(DiscoveredWidevineCdm {
                library_path: custom_p,
                source_label: "settings-vdf-custom".to_string(),
                cdm_version: None,
            });
        }
    }

    let home = dirs::home_dir()?;
    let cdm_file = platform_cdm_filename();

    // 1. Explicit SIMP userland / portable library folder
    let simp_lib = crate::simp_data_dir().join("lib").join(cdm_file);
    if simp_lib.is_file() {
        if is_compatible_cdm_binary(&simp_lib) {
            if !verify_macos_cdm_usable_once(&simp_lib) {
                return None;
            }
            return Some(DiscoveredWidevineCdm {
                library_path: simp_lib,
                source_label: "simp-userland".to_string(),
                cdm_version: None,
            });
        } else {
            let _ = std::fs::remove_file(&simp_lib);
        }
    }
    // Also check ~/.local/share/simp/lib and ~/.local/share/simp/cdm on macOS/Linux in case staged there
    for sub in ["lib", "cdm"] {
        let legacy_simp_lib = home.join(".local/share/simp").join(sub).join(cdm_file);
        if legacy_simp_lib.is_file() {
            if is_compatible_cdm_binary(&legacy_simp_lib) {
                if !verify_macos_cdm_usable_once(&legacy_simp_lib) {
                    return None;
                }
                return Some(DiscoveredWidevineCdm {
                    library_path: legacy_simp_lib,
                    source_label: "simp-userland".to_string(),
                    cdm_version: None,
                });
            } else {
                let _ = std::fs::remove_file(&legacy_simp_lib);
            }
        }
    }

    // 2. Firefox profiles (Flatpak, Native Linux, macOS, Windows)
    let mut ff_roots: Vec<(&str, PathBuf)> = vec![
        (
            "firefox-flatpak",
            home.join(".var/app/org.mozilla.firefox/.mozilla/firefox"),
        ),
        ("firefox-native", home.join(".mozilla/firefox")),
    ];
    if cfg!(target_os = "macos") {
        ff_roots.push((
            "firefox-macos",
            home.join("Library/Application Support/Firefox/Profiles"),
        ));
    } else if cfg!(target_os = "windows") {
        if let Some(appdata) = dirs::config_dir() {
            ff_roots.push(("firefox-windows", appdata.join("Mozilla/Firefox/Profiles")));
        }
    }

    for (label, ff_root) in ff_roots {
        if let Some(found) = scan_for_file_named(&ff_root, cdm_file, 4) {
            if is_compatible_cdm_binary(&found) {
                stage_cdm_into_userland(&found, &simp_lib);
                let active_path = if simp_lib.is_file() { simp_lib } else { found };
                if !verify_macos_cdm_usable_once(&active_path) {
                    return None;
                }
                return Some(DiscoveredWidevineCdm {
                    library_path: active_path,
                    source_label: label.to_string(),
                    cdm_version: None,
                });
            }
        }
    }

    // 3. Chromium/Chrome/Brave/Edge WidevineCdm directories (Linux, macOS, Windows)
    let mut chr_roots: Vec<(&str, PathBuf)> = vec![
        (
            "chrome-flatpak",
            home.join(".var/app/com.google.Chrome/config/google-chrome/WidevineCdm"),
        ),
        (
            "brave-flatpak",
            home.join(".var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/WidevineCdm"),
        ),
        (
            "chromium-flatpak",
            home.join(".var/app/org.chromium.Chromium/config/chromium/WidevineCdm"),
        ),
        (
            "chrome-native",
            home.join(".config/google-chrome/WidevineCdm"),
        ),
        (
            "chromium-native",
            home.join(".config/chromium/WidevineCdm"),
        ),
        (
            "opt-chrome",
            PathBuf::from("/opt/google/chrome/WidevineCdm"),
        ),
    ];
    if cfg!(target_os = "macos") {
        chr_roots.push((
            "chrome-macos-user",
            home.join("Library/Application Support/Google/Chrome/WidevineCdm"),
        ));
        chr_roots.push((
            "brave-macos-user",
            home.join("Library/Application Support/BraveSoftware/Brave-Browser/WidevineCdm"),
        ));
        chr_roots.push((
            "edge-macos-user",
            home.join("Library/Application Support/Microsoft Edge/WidevineCdm"),
        ));
        chr_roots.push((
            "chrome-macos-app",
            PathBuf::from("/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/Current/Libraries/WidevineCdm"),
        ));
    } else if cfg!(target_os = "windows") {
        if let Some(local_app) = dirs::data_local_dir() {
            chr_roots.push((
                "chrome-win-user",
                local_app.join("Google/Chrome/User Data/WidevineCdm"),
            ));
            chr_roots.push((
                "edge-win-user",
                local_app.join("Microsoft/Edge/User Data/WidevineCdm"),
            ));
            chr_roots.push((
                "brave-win-user",
                local_app.join("BraveSoftware/Brave-Browser/User Data/WidevineCdm"),
            ));
        }
    }

    for (label, chr_root) in chr_roots {
        if let Some(found) = scan_for_file_named(&chr_root, cdm_file, 5) {
            if is_compatible_cdm_binary(&found) {
                stage_cdm_into_userland(&found, &simp_lib);
                let active_path = if simp_lib.is_file() { simp_lib } else { found };
                if !verify_macos_cdm_usable_once(&active_path) {
                    return None;
                }
                return Some(DiscoveredWidevineCdm {
                    library_path: active_path,
                    source_label: label.to_string(),
                    cdm_version: None,
                });
            }
        }
    }

    for sys_path in [
        "/usr/lib/chromium/libwidevinecdm.so",
        "/usr/lib64/chromium/libwidevinecdm.so",
        "/usr/lib/aarch64-linux-gnu/chromium/libwidevinecdm.so",
    ] {
        let p = Path::new(sys_path);
        if p.is_file() && is_compatible_cdm_binary(p) {
            stage_cdm_into_userland(p, &simp_lib);
            let active_path = if simp_lib.is_file() {
                simp_lib
            } else {
                p.to_path_buf()
            };
            return Some(DiscoveredWidevineCdm {
                library_path: active_path,
                source_label: "system-chromium".to_string(),
                cdm_version: None,
            });
        }
    }

    // 4. Auto-provision Widevine CDM into userland using URLs from `settings.vdf` `[provisioning]`
    if auto_provision_widevine_cdm(&simp_lib, &prov)
        && simp_lib.is_file()
        && is_compatible_cdm_binary(&simp_lib)
    {
        if !verify_macos_cdm_usable_once(&simp_lib) {
            return None;
        }
        return Some(DiscoveredWidevineCdm {
            library_path: simp_lib,
            source_label: "simp-auto-provisioned".to_string(),
            cdm_version: None,
        });
    }

    None
}

/// Verifies that an ELF (`\x7fELF`) or Mach-O (`0xFEEDFACF` / Universal `0xCAFEBABE`) header
/// matches the current CPU architecture (`x86_64` vs `aarch64`).
pub fn check_cdm_header_bytes(hdr: &[u8]) -> bool {
    if hdr.len() < 20 {
        return false;
    }
    // 1. ELF header (`\x7FELF`) e_machine field (little-endian u16 at offset 18)
    if &hdr[0..4] == b"\x7fELF" {
        let e_machine = u16::from_le_bytes([hdr[18], hdr[19]]);
        if cfg!(target_arch = "x86_64") {
            return e_machine == 0x3E; // EM_X86_64 (62)
        } else if cfg!(target_arch = "aarch64") {
            return e_machine == 0xB7; // EM_AARCH64 (183)
        }
    }
    // 2. 64-bit Mach-O little-endian (`MH_MAGIC_64 = 0xFEEDFACF` -> bytes `[0xCF, 0xFA, 0xED, 0xFE]`)
    if hdr[0..4] == [0xCF, 0xFA, 0xED, 0xFE] {
        let cputype = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
        if cfg!(target_arch = "aarch64") {
            return cputype == 0x0100_000C; // CPU_TYPE_ARM64
        } else if cfg!(target_arch = "x86_64") {
            return cputype == 0x0100_0007; // CPU_TYPE_X86_64
        }
    }
    // 3. Universal Fat Mach-O big-endian (`FAT_MAGIC = 0xCAFEBABE` -> bytes `[0xCA, 0xFE, 0xBA, 0xBE]`)
    if hdr[0..4] == [0xCA, 0xFE, 0xBA, 0xBE] {
        let nfat_arch = u32::from_be_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]) as usize;
        let target_cputype: u32 = if cfg!(target_arch = "aarch64") {
            0x0100_000C
        } else {
            0x0100_0007
        };
        for i in 0..nfat_arch.min(4) {
            let off = 8 + i * 20;
            if off + 4 <= hdr.len() {
                let cputype = u32::from_be_bytes([hdr[off], hdr[off + 1], hdr[off + 2], hdr[off + 3]]);
                if cputype == target_cputype {
                    return true;
                }
            }
        }
        return false;
    }
    true
}

/// Verifies that an ELF/Mach-O/PE shared library matches the current CPU architecture (`x86_64` vs `aarch64`)
/// before attempting `dlopen`, preventing an `x86_64` `.so`/`.dylib` from breaking an `aarch64` build.
fn is_compatible_cdm_binary(path: &Path) -> bool {
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    use std::io::Read;
    let mut hdr = [0u8; 68];
    let Ok(n) = f.read(&mut hdr) else {
        return false;
    };
    check_cdm_header_bytes(&hdr[..n])
}

static LAST_PROVISION_ATTEMPT_SECS: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

/// Pure-Rust parser for Debian `.deb` (`!<arch>\n`) archives.
/// Slices out the `data.tar.*` payload (`data.tar.xz`, `data.tar.zst`, `data.tar.gz`) without needing `dpkg-deb` or `ar`.
pub fn extract_deb_data_tar(deb_bytes: &[u8]) -> Option<(&str, &[u8])> {
    if !deb_bytes.starts_with(b"!<arch>\n") {
        return None;
    }
    let mut offset = 8usize;
    while offset + 60 <= deb_bytes.len() {
        let name = std::str::from_utf8(&deb_bytes[offset..offset + 16])
            .ok()?
            .trim()
            .trim_end_matches('/');
        let size_str = std::str::from_utf8(&deb_bytes[offset + 48..offset + 58])
            .ok()?
            .trim();
        let size: usize = size_str.parse().ok()?;
        let data_start = offset + 60;
        let data_end = data_start.checked_add(size)?;
        if data_end > deb_bytes.len() {
            return None;
        }
        if name.starts_with("data.tar") {
            return Some((name, &deb_bytes[data_start..data_end]));
        }
        offset = data_end + (size % 2);
    }
    None
}

fn auto_provision_widevine_cdm(dest: &Path, prov: &simp_protocol::ProvisioningSettings) -> bool {
    if dest.is_file() && is_compatible_cdm_binary(dest) {
        return true;
    }
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let prev_secs = LAST_PROVISION_ATTEMPT_SECS.load(std::sync::atomic::Ordering::SeqCst);
    if prev_secs > 0 && now_secs.saturating_sub(prev_secs) < 15 {
        return dest.is_file() && is_compatible_cdm_binary(dest);
    }
    LAST_PROVISION_ATTEMPT_SECS.store(now_secs, std::sync::atomic::Ordering::SeqCst);

    let default_aarch64_url = simp_protocol::default_widevine_url_aarch64_linux();
    let default_macos_arm64_url = simp_protocol::default_widevine_url_aarch64_macos();
    let default_macos_x64_url = simp_protocol::default_widevine_url_x86_64_macos();
    let url = if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        prov.widevine_cdm_url_x86_64_linux.trim()
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        let configured = prov.widevine_cdm_url_aarch64_linux.trim();
        if configured.is_empty() || configured.contains("4.10.2710.0-linux-arm64.zip") {
            default_aarch64_url.as_str()
        } else {
            configured
        }
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        let configured = prov.widevine_cdm_url_aarch64_macos.trim();
        if configured.is_empty() {
            default_macos_arm64_url.as_str()
        } else {
            configured
        }
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        let configured = prov.widevine_cdm_url_x86_64_macos.trim();
        if configured.is_empty() {
            default_macos_x64_url.as_str()
        } else {
            configured
        }
    } else {
        ""
    };
    if url.is_empty() {
        return false;
    }

    let Some(parent) = dest.parent() else {
        return false;
    };
    let _ = std::fs::create_dir_all(parent);
    let target_name = platform_cdm_filename();
    let tmp_extract_dir = parent.join(".widevine_extract_tmp");
    let _ = std::fs::remove_dir_all(&tmp_extract_dir);
    let _ = std::fs::create_dir_all(&tmp_extract_dir);

    tracing::info!(
        "Auto-provisioning native Widevine CDM ({}) from {url}...",
        std::env::consts::ARCH
    );

    let Ok(raw_bytes) = crate::http_pool::http_get_bytes(url, &[], None, 35) else {
        tracing::warn!("Failed to download Widevine CDM package from {url}");
        let _ = std::fs::remove_dir_all(&tmp_extract_dir);
        return false;
    };

    // Case 1: Debian `.deb` archive (`!<arch>\n`, e.g. `libwidevinecdm0_*_arm64.deb`)
    if let Some((tar_name, tar_bytes)) = extract_deb_data_tar(&raw_bytes) {
        let tmp_tar = parent.join(format!(".widevine_{tar_name}"));
        if std::fs::write(&tmp_tar, tar_bytes).is_ok() {
            let extracted = Command::new("tar")
                .args(["-xf"])
                .arg(&tmp_tar)
                .arg("-C")
                .arg(&tmp_extract_dir)
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
                || Command::new("bsdtar")
                    .args(["-xf"])
                    .arg(&tmp_tar)
                    .arg("-C")
                    .arg(&tmp_extract_dir)
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
            let _ = std::fs::remove_file(&tmp_tar);
            if extracted {
                if let Some(found) = scan_for_file_named(&tmp_extract_dir, target_name, 7) {
                    stage_cdm_into_userland(&found, dest);
                }
            }
        }
    } else if let Some(pk_offset) = raw_bytes.windows(4).position(|w| w == b"PK\x03\x04") {
        // Case 2: Chrome CRX3 package (strip header up to `PK\x03\x04`) or standard `.zip` archive
        let tmp_zip = parent.join(".widevine_download.zip");
        if std::fs::write(&tmp_zip, &raw_bytes[pk_offset..]).is_ok() {
            let unzipped = Command::new("unzip")
                .args(["-q", "-o"])
                .arg(&tmp_zip)
                .arg("-d")
                .arg(&tmp_extract_dir)
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
                || Command::new("bsdtar")
                    .args(["-xf"])
                    .arg(&tmp_zip)
                    .arg("-C")
                    .arg(&tmp_extract_dir)
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false)
                || Command::new("python3")
                    .args(["-m", "zipfile", "-e"])
                    .arg(&tmp_zip)
                    .arg(&tmp_extract_dir)
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
            let _ = std::fs::remove_file(&tmp_zip);
            if unzipped {
                if let Some(found) = scan_for_file_named(&tmp_extract_dir, target_name, 7) {
                    stage_cdm_into_userland(&found, dest);
                }
            }
        }
    }

    let _ = std::fs::remove_dir_all(&tmp_extract_dir);
    let ok = dest.is_file() && is_compatible_cdm_binary(dest);
    if ok {
        tracing::info!(
            "Successfully provisioned native Widevine CDM at {}",
            dest.display()
        );
    }
    ok
}

fn stage_cdm_into_userland(src: &Path, dest: &Path) {
    if dest.is_file() && is_compatible_cdm_binary(dest) {
        return;
    }
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let resolved_src = std::fs::canonicalize(src).unwrap_or_else(|_| src.to_path_buf());
    if std::fs::copy(&resolved_src, dest).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(dest, std::fs::Permissions::from_mode(0o755));
        }
        // Also copy companion `.sig` or `manifest.json` files if present alongside `libwidevinecdm.so` / `libwidevinecdm.dylib` / `widevinecdm.dll`
        if let (Some(src_dir), Some(dest_dir)) = (resolved_src.parent(), dest.parent()) {
            for companion in [
                "libwidevinecdm.so.sig",
                "libwidevinecdm.dylib.sig",
                "widevinecdm.dll.sig",
                "manifest.json",
            ] {
                let s = src_dir.join(companion);
                if s.is_file() {
                    let _ = std::fs::copy(&s, dest_dir.join(companion));
                }
            }
        }
    }
}

fn scan_for_file_named(root: &Path, target_name: &str, max_depth: usize) -> Option<PathBuf> {
    if max_depth == 0 || !root.is_dir() {
        return None;
    }
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if path.file_name().and_then(|n| n.to_str()) == Some(target_name)
                && is_compatible_cdm_binary(&path)
            {
                return Some(path);
            }
        } else if path.is_dir() {
            if let Some(found) = scan_for_file_named(&path, target_name, max_depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

/// Ensures `libnspr4.so` is loaded into the process namespace before `dlopen`ing `libwidevinecdm.so`.
/// On `aarch64` Linux, `libwidevinecdm.so` has `DT_NEEDED: [libnspr4.so]` even though it imports zero
/// symbols from `libnspr4.so`; loading SIMP's bundled fallback `~/.local/share/simp/lib/libnspr4.so`
/// with `RTLD_GLOBAL` satisfies `glibc` `dlopen` on minimal OS images that lack system `nspr`.
#[cfg(target_os = "linux")]
unsafe fn ensure_nspr4_loaded_for_cdm() {
    let sys_h = libc::dlopen(c"libnspr4.so".as_ptr(), libc::RTLD_LAZY | libc::RTLD_GLOBAL);
    if !sys_h.is_null() {
        return;
    }
    if let Some(home) = dirs::home_dir() {
        for cand in [
            home.join(".local/share/simp/lib/libnspr4.so"),
            PathBuf::from("/usr/lib/libnspr4.so"),
            PathBuf::from("/usr/lib64/libnspr4.so"),
            PathBuf::from("/usr/lib/aarch64-linux-gnu/libnspr4.so"),
        ] {
            if cand.is_file() {
                if let Ok(cs) = CString::new(cand.to_string_lossy().as_bytes()) {
                    let h = libc::dlopen(cs.as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL);
                    if !h.is_null() {
                        return;
                    }
                }
            }
        }
    }
}

#[cfg(not(target_os = "linux"))]
unsafe fn ensure_nspr4_loaded_for_cdm() {}

#[cfg(unix)]
unsafe fn dl_open_library(lib_path: &Path) -> Result<*mut c_void> {
    ensure_nspr4_loaded_for_cdm();
    let c_path = CString::new(
        lib_path
            .to_str()
            .ok_or_else(|| anyhow!("Invalid UTF-8 path for Widevine CDM"))?,
    )?;
    let handle = libc::dlopen(c_path.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
    if handle.is_null() {
        let err_ptr = libc::dlerror();
        let err_msg = if !err_ptr.is_null() {
            CStr::from_ptr(err_ptr).to_string_lossy().to_string()
        } else {
            "unknown dlopen error".to_string()
        };
        return Err(anyhow!("Failed to dlopen {}: {}", lib_path.display(), err_msg));
    }
    Ok(handle)
}

#[cfg(unix)]
unsafe fn dl_find_symbol(handle: *mut c_void, name: &str) -> *mut c_void {
    let Ok(cs) = CString::new(name) else {
        return std::ptr::null_mut();
    };
    libc::dlsym(handle, cs.as_ptr())
}

#[cfg(unix)]
unsafe fn dl_close_library(handle: *mut c_void) {
    if !handle.is_null() {
        libc::dlclose(handle);
    }
}

#[cfg(windows)]
unsafe fn dl_open_library(lib_path: &Path) -> Result<*mut c_void> {
    #[link(name = "kernel32")]
    extern "system" {
        fn LoadLibraryW(lp_lib_file_name: *const u16) -> *mut c_void;
    }
    let wide: Vec<u16> = lib_path
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let handle = LoadLibraryW(wide.as_ptr());
    if handle.is_null() {
        return Err(anyhow!(
            "Failed to LoadLibraryW {}: {}",
            lib_path.display(),
            std::io::Error::last_os_error()
        ));
    }
    Ok(handle)
}

#[cfg(windows)]
unsafe fn dl_find_symbol(handle: *mut c_void, name: &str) -> *mut c_void {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetProcAddress(h_module: *mut c_void, lp_proc_name: *const c_char) -> *mut c_void;
    }
    let Ok(cs) = CString::new(name) else {
        return std::ptr::null_mut();
    };
    GetProcAddress(handle, cs.as_ptr())
}

#[cfg(windows)]
unsafe fn dl_close_library(handle: *mut c_void) {
    #[link(name = "kernel32")]
    extern "system" {
        fn FreeLibrary(h_lib_module: *mut c_void) -> i32;
    }
    if !handle.is_null() {
        FreeLibrary(handle);
    }
}

/// Queries `GetCdmVersion()` from a Widevine CDM shared library (`libwidevinecdm.so` / `widevinecdm.dll`).
pub fn query_cdm_version(lib_path: &Path) -> Option<String> {
    unsafe {
        let handle = dl_open_library(lib_path).ok()?;
        let sym = dl_find_symbol(handle, "GetCdmVersion");
        let ver = if !sym.is_null() {
            let func: extern "C" fn() -> *const c_char = std::mem::transmute(sym);
            let ptr = func();
            if !ptr.is_null() {
                Some(CStr::from_ptr(ptr).to_string_lossy().to_string())
            } else {
                None
            }
        } else {
            None
        };
        dl_close_library(handle);
        ver
    }
}

/// Exchanges a Widevine license challenge (`challenge_bytes`) with Apple Music's
/// `https://play.itunes.apple.com/WebObjects/MZPlay.woa/wa/acquireWebPlaybackLicense` endpoint
/// and returns the raw binary Server Certificate or CKC (Content Key Context) bytes.
pub fn post_apple_widevine_license_request(
    license_server_url: &str,
    dev_token: &str,
    user_token: &str,
    song_id: &str,
    key_uri_or_pssh_b64: &str,
    challenge_bytes: &[u8],
) -> Result<Vec<u8>> {
    let challenge_b64 = BASE64_STD.encode(challenge_bytes);
    let clean_id = song_id
        .strip_prefix("applemusic:song:")
        .or_else(|| song_id.strip_prefix("applemusic:track:"))
        .or_else(|| song_id.strip_prefix("applemusic:"))
        .unwrap_or(song_id)
        .trim();

    let uri_field = if key_uri_or_pssh_b64.starts_with("data:") {
        key_uri_or_pssh_b64.to_string()
    } else {
        format!("data:;base64,{key_uri_or_pssh_b64}")
    };

    let payload = serde_json::json!({
        "challenge": challenge_b64,
        "key-system": "com.widevine.alpha",
        "uri": uri_field,
        "adamId": clean_id,
        "isLibrary": clean_id.starts_with("i."),
        "user-initiated": true,
    });

    let body_bytes = serde_json::to_vec(&payload)?;
    let auth_header = format!("Bearer {}", dev_token.trim());
    let headers = [
        ("Authorization", auth_header.as_str()),
        ("x-apple-music-user-token", user_token.trim()),
        ("media-user-token", user_token.trim()),
        ("Music-User-Token", user_token.trim()),
        ("Content-Type", "application/json"),
        ("Origin", "https://music.apple.com"),
        ("Referer", "https://music.apple.com/"),
    ];

    let resp_bytes =
        crate::http_pool::http_post_bytes(license_server_url, &headers, &body_bytes, 15)
            .context("Apple Widevine license POST failed")?;

    let resp_json: Value =
        serde_json::from_slice(&resp_bytes).context("Invalid JSON from Apple license server")?;
    let license_b64 = resp_json
        .get("license")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            anyhow!(
                "Apple license server did not return a 'license' field: {}",
                resp_json
            )
        })?;

    BASE64_STD
        .decode(license_b64.trim())
        .context("Failed to base64-decode CKC license from Apple")
}

// ============================================================================
// Stage 3: Native Rust `cdm::ContentDecryptionModule_10` / `CDM_11` C++ ABI Host
// ============================================================================
// Implements Itanium C++ ABI vtables (`#[repr(C)]`) for:
// - `cdm::Buffer`
// - `cdm::DecryptedBlock`
// - `cdm::Host_10` / `cdm::Host_11`
// - `cdm::ContentDecryptionModule_10` / `cdm::ContentDecryptionModule_11`
// so `simp --daemon` can load `libwidevinecdm.so` directly via `dlopen`, negotiate
// the Apple Music Widevine license, and decrypt `cenc` / `cbcs` fMP4 samples in memory
// with zero browser processes!

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CdmStatus {
    Success = 0,
    NeedMoreData = 1,
    NoKey = 2,
    InitializationError = 3,
    DecryptError = 4,
    DecodeError = 5,
    DeferredInitialization = 6,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CdmEncryptionScheme {
    Unencrypted = 0,
    Cenc = 1, // AES-CTR
    Cbcs = 2, // AES-CBC
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct CdmPattern {
    pub crypt_byte_block: u32,
    pub skip_byte_block: u32,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct CdmSubsampleEntry {
    pub clear_bytes: u32,
    pub cipher_bytes: u32,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct CdmInputBuffer2 {
    pub data: *const u8,
    pub data_size: u32,
    pub encryption_scheme: CdmEncryptionScheme,
    pub key_id: *const u8,
    pub key_id_size: u32,
    pub _pad0: u32,
    pub iv: *const u8,
    pub iv_size: u32,
    pub _pad1: u32,
    pub subsamples: *const CdmSubsampleEntry,
    pub num_subsamples: u32,
    pub _pad2: u32,
    pub pattern: CdmPattern,
    pub timestamp: i64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct CdmKeyInformation {
    pub key_id: *const u8,
    pub key_id_size: u32,
    pub status: u32,
    pub system_code: u32,
}

// --- `cdm::Buffer` C++ VTable & Instance ---

#[repr(C)]
struct CdmBufferVtable {
    destroy: unsafe extern "C" fn(*mut CdmBufferImpl),
    capacity: unsafe extern "C" fn(*const CdmBufferImpl) -> u32,
    data: unsafe extern "C" fn(*mut CdmBufferImpl) -> *mut u8,
    set_size: unsafe extern "C" fn(*mut CdmBufferImpl, u32),
    size: unsafe extern "C" fn(*const CdmBufferImpl) -> u32,
}

#[repr(C)]
pub struct CdmBufferImpl {
    vtable: *const CdmBufferVtable,
    storage: Vec<u8>,
    used_size: u32,
}

unsafe extern "C" fn buffer_destroy(this: *mut CdmBufferImpl) {
    if !this.is_null() {
        drop(Box::from_raw(this));
    }
}

unsafe extern "C" fn buffer_capacity(this: *const CdmBufferImpl) -> u32 {
    let this_ref = &*this;
    this_ref.storage.len() as u32
}

unsafe extern "C" fn buffer_data(this: *mut CdmBufferImpl) -> *mut u8 {
    let this_ref = &mut *this;
    this_ref.storage.as_mut_ptr()
}

unsafe extern "C" fn buffer_set_size(this: *mut CdmBufferImpl, size: u32) {
    let this_ref = &mut *this;
    let cap = this_ref.storage.len() as u32;
    this_ref.used_size = size.min(cap);
}

unsafe extern "C" fn buffer_size(this: *const CdmBufferImpl) -> u32 {
    (*this).used_size
}

static CDM_BUFFER_VTABLE: CdmBufferVtable = CdmBufferVtable {
    destroy: buffer_destroy,
    capacity: buffer_capacity,
    data: buffer_data,
    set_size: buffer_set_size,
    size: buffer_size,
};

impl CdmBufferImpl {
    pub fn allocate(capacity: u32) -> *mut Self {
        let cap = capacity.max(64) as usize;
        let boxed = Box::new(Self {
            vtable: &CDM_BUFFER_VTABLE,
            storage: vec![0u8; cap],
            used_size: 0,
        });
        Box::into_raw(boxed)
    }

    pub fn as_slice(&self) -> &[u8] {
        let n = (self.used_size as usize).min(self.storage.len());
        &self.storage[..n]
    }
}

// --- `cdm::DecryptedBlock` C++ VTable & Instance ---

#[repr(C)]
struct CdmDecryptedBlockVtable {
    set_decrypted_buffer: unsafe extern "C" fn(*mut CdmDecryptedBlockImpl, *mut CdmBufferImpl),
    decrypted_buffer: unsafe extern "C" fn(*mut CdmDecryptedBlockImpl) -> *mut CdmBufferImpl,
    set_timestamp: unsafe extern "C" fn(*mut CdmDecryptedBlockImpl, i64),
    timestamp: unsafe extern "C" fn(*const CdmDecryptedBlockImpl) -> i64,
    dtor_complete: unsafe extern "C" fn(*mut CdmDecryptedBlockImpl),
    dtor_deleting: unsafe extern "C" fn(*mut CdmDecryptedBlockImpl),
}

#[repr(C)]
pub struct CdmDecryptedBlockImpl {
    vtable: *const CdmDecryptedBlockVtable,
    pub buffer: *mut CdmBufferImpl,
    pub timestamp_us: i64,
}

unsafe extern "C" fn dec_block_set_buffer(
    this: *mut CdmDecryptedBlockImpl,
    buffer: *mut CdmBufferImpl,
) {
    if !(*this).buffer.is_null() && (*this).buffer != buffer {
        buffer_destroy((*this).buffer);
    }
    (*this).buffer = buffer;
}

unsafe extern "C" fn dec_block_get_buffer(this: *mut CdmDecryptedBlockImpl) -> *mut CdmBufferImpl {
    (*this).buffer
}

unsafe extern "C" fn dec_block_set_ts(this: *mut CdmDecryptedBlockImpl, ts: i64) {
    (*this).timestamp_us = ts;
}

unsafe extern "C" fn dec_block_get_ts(this: *const CdmDecryptedBlockImpl) -> i64 {
    (*this).timestamp_us
}

unsafe extern "C" fn dec_block_dtor(_this: *mut CdmDecryptedBlockImpl) {}

static CDM_DECRYPTED_BLOCK_VTABLE: CdmDecryptedBlockVtable = CdmDecryptedBlockVtable {
    set_decrypted_buffer: dec_block_set_buffer,
    decrypted_buffer: dec_block_get_buffer,
    set_timestamp: dec_block_set_ts,
    timestamp: dec_block_get_ts,
    dtor_complete: dec_block_dtor,
    dtor_deleting: dec_block_dtor,
};

impl CdmDecryptedBlockImpl {
    pub fn new() -> Self {
        Self {
            vtable: &CDM_DECRYPTED_BLOCK_VTABLE,
            buffer: std::ptr::null_mut(),
            timestamp_us: 0,
        }
    }
}

impl Drop for CdmDecryptedBlockImpl {
    fn drop(&mut self) {
        if !self.buffer.is_null() {
            unsafe {
                buffer_destroy(self.buffer);
            }
            self.buffer = std::ptr::null_mut();
        }
    }
}

// --- `cdm::FileIO` & `cdm::FileIOClient` C++ VTables ---

#[repr(C)]
struct CdmFileIoClientVtable {
    on_open_complete: unsafe extern "C" fn(*mut c_void, u32),
    on_read_complete: unsafe extern "C" fn(*mut c_void, u32, *const u8, u32),
    on_write_complete: unsafe extern "C" fn(*mut c_void, u32),
}

#[repr(C)]
struct CdmFileIoVtable {
    open: unsafe extern "C" fn(*mut CdmFileIoImpl, *const c_char, u32),
    read: unsafe extern "C" fn(*mut CdmFileIoImpl),
    write: unsafe extern "C" fn(*mut CdmFileIoImpl, *const u8, u32),
    close: unsafe extern "C" fn(*mut CdmFileIoImpl),
}

#[repr(C)]
pub struct CdmFileIoImpl {
    vtable: *const CdmFileIoVtable,
    client_ptr: *mut c_void,
}

unsafe extern "C" fn file_io_open(
    this: *mut CdmFileIoImpl,
    _file_name: *const c_char,
    _file_name_size: u32,
) {
    let client = (*this).client_ptr;
    if !client.is_null() {
        let client_vtbl = *(client as *const *const CdmFileIoClientVtable);
        // kSuccess = 0
        ((*client_vtbl).on_open_complete)(client, 0);
    }
}

unsafe extern "C" fn file_io_read(this: *mut CdmFileIoImpl) {
    let client = (*this).client_ptr;
    if !client.is_null() {
        let client_vtbl = *(client as *const *const CdmFileIoClientVtable);
        // kSuccess = 0, 0 bytes (empty file)
        ((*client_vtbl).on_read_complete)(client, 0, std::ptr::null(), 0);
    }
}

unsafe extern "C" fn file_io_write(
    this: *mut CdmFileIoImpl,
    _data: *const u8,
    _data_size: u32,
) {
    let client = (*this).client_ptr;
    if !client.is_null() {
        let client_vtbl = *(client as *const *const CdmFileIoClientVtable);
        // kSuccess = 0
        ((*client_vtbl).on_write_complete)(client, 0);
    }
}

unsafe extern "C" fn file_io_close(this: *mut CdmFileIoImpl) {
    if !this.is_null() {
        drop(Box::from_raw(this));
    }
}

static CDM_FILE_IO_VTABLE: CdmFileIoVtable = CdmFileIoVtable {
    open: file_io_open,
    read: file_io_read,
    write: file_io_write,
    close: file_io_close,
};

// --- `cdm::Host_10` / `cdm::Host_11` C++ VTable & Instance ---
// Exact slot order from Chromium `media/cdm/api/content_decryption_module.h`:
//   0: Allocate(uint32_t capacity) -> Buffer*
//   1: SetTimer(int64_t delay_ms, void* context)
//   2: GetCurrentWallTime() -> Time (double)
//   3: OnInitialized(bool success)
//   4: OnResolveKeyStatusPromise(uint32_t promise_id, KeyStatus key_status)
//   5: OnResolveNewSessionPromise(uint32_t promise_id, const char* session_id, uint32_t session_id_size)
//   6: OnResolvePromise(uint32_t promise_id)
//   7: OnRejectPromise(uint32_t promise_id, Exception exception, uint32_t system_code, const char* error_message, uint32_t error_message_size)
//   8: OnSessionMessage(const char* session_id, uint32_t session_id_size, MessageType message_type, const char* message, uint32_t message_size)
//   9: OnSessionKeysChange(const char* session_id, uint32_t session_id_size, bool has_additional_usable_key, const KeyInformation* keys_info, uint32_t keys_info_count)
//  10: OnExpirationChange(const char* session_id, uint32_t session_id_size, Time new_expiry_time)
//  11: OnSessionClosed(const char* session_id, uint32_t session_id_size)
//  12: SendPlatformChallenge(const char* service_id, uint32_t service_id_size, const char* challenge, uint32_t challenge_size)
//  13: EnableOutputProtection(uint32_t desired_protection_mask)
//  14: QueryOutputProtectionStatus()
//  15: OnDeferredInitializationDone(StreamType stream_type, Status decoder_status)
//  16: CreateFileIO(FileIOClient* client) -> FileIO*
//  17: RequestStorageId(uint32_t version)
//  18: ReportMetrics(MetricName metric_name, uint64_t value) [Host_11+]

#[repr(C)]
struct CdmHostVtable {
    allocate: unsafe extern "C" fn(*mut CdmHostState, u32) -> *mut CdmBufferImpl,
    set_timer: unsafe extern "C" fn(*mut CdmHostState, i64, *mut c_void),
    get_current_wall_time: unsafe extern "C" fn(*mut CdmHostState) -> f64,
    on_initialized: unsafe extern "C" fn(*mut CdmHostState, bool),
    on_resolve_key_status_promise: unsafe extern "C" fn(*mut CdmHostState, u32, u32),
    on_resolve_new_session_promise:
        unsafe extern "C" fn(*mut CdmHostState, u32, *const c_char, u32),
    on_resolve_promise: unsafe extern "C" fn(*mut CdmHostState, u32),
    on_reject_promise:
        unsafe extern "C" fn(*mut CdmHostState, u32, u32, u32, *const c_char, u32),
    on_session_message:
        unsafe extern "C" fn(*mut CdmHostState, *const c_char, u32, u32, *const u8, u32),
    on_session_keys_change: unsafe extern "C" fn(
        *mut CdmHostState,
        *const c_char,
        u32,
        bool,
        *const CdmKeyInformation,
        u32,
    ),
    on_expiration_change: unsafe extern "C" fn(*mut CdmHostState, *const c_char, u32, f64),
    on_session_closed: unsafe extern "C" fn(*mut CdmHostState, *const c_char, u32),
    send_platform_challenge:
        unsafe extern "C" fn(*mut CdmHostState, *const c_char, u32, *const c_char, u32),
    enable_output_protection: unsafe extern "C" fn(*mut CdmHostState, u32),
    query_output_protection_status: unsafe extern "C" fn(*mut CdmHostState),
    on_deferred_initialization_done: unsafe extern "C" fn(*mut CdmHostState, u32, u32),
    create_file_io: unsafe extern "C" fn(*mut CdmHostState, *mut c_void) -> *mut c_void,
    request_storage_id: unsafe extern "C" fn(*mut CdmHostState, u32),
    // Extra slot used by `cdm::Host_11::ReportMetrics`
    report_metrics: unsafe extern "C" fn(*mut CdmHostState, u32, u64),
    dtor_complete: unsafe extern "C" fn(*mut CdmHostState),
    dtor_deleting: unsafe extern "C" fn(*mut CdmHostState),
}

#[repr(C)]
pub struct CdmHostState {
    vtable: *const CdmHostVtable,
    pub cdm_ptr: *mut c_void,
    pub initialized: bool,
    pub session_id: String,
    pub latest_challenge: Vec<u8>,
    pub usable_keys_count: usize,
    pub last_rejection: Option<String>,
    pub trace_log: Vec<String>,
    pub pending_timers: Vec<(i64, *mut c_void)>,
}

unsafe extern "C" fn host_allocate(_this: *mut CdmHostState, capacity: u32) -> *mut CdmBufferImpl {
    CdmBufferImpl::allocate(capacity)
}

unsafe extern "C" fn host_set_timer(this: *mut CdmHostState, delay_ms: i64, context: *mut c_void) {
    let this_ref = &mut *this;
    this_ref
        .trace_log
        .push(format!("Host::SetTimer(delay_ms={delay_ms})"));
    if delay_ms <= 100 && !context.is_null() {
        this_ref.pending_timers.push((delay_ms, context));
    }
}

unsafe extern "C" fn host_get_current_wall_time(_this: *mut CdmHostState) -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(1_700_000_000.0)
}

unsafe extern "C" fn host_on_resolve_key_status_promise(
    this: *mut CdmHostState,
    promise_id: u32,
    key_status: u32,
) {
    let this_ref = &mut *this;
    this_ref.trace_log.push(format!(
        "Host::OnResolveKeyStatusPromise(promise={promise_id}, status={key_status})"
    ));
}

unsafe extern "C" fn host_on_resolve_new_session_promise(
    this: *mut CdmHostState,
    promise_id: u32,
    session_id: *const c_char,
    session_id_size: u32,
) {
    let this_ref = &mut *this;
    if !session_id.is_null() && session_id_size > 0 {
        let bytes = std::slice::from_raw_parts(session_id as *const u8, session_id_size as usize);
        this_ref.session_id = String::from_utf8_lossy(bytes).to_string();
    }
    this_ref.trace_log.push(format!(
        "Host::OnResolveNewSessionPromise(promise={promise_id}, sid={})",
        this_ref.session_id
    ));
}

unsafe extern "C" fn host_on_resolve_promise(this: *mut CdmHostState, promise_id: u32) {
    let this_ref = &mut *this;
    this_ref
        .trace_log
        .push(format!("Host::OnResolvePromise(promise={promise_id})"));
}

unsafe extern "C" fn host_on_reject_promise(
    this: *mut CdmHostState,
    promise_id: u32,
    exception: u32,
    system_code: u32,
    error_message: *const c_char,
    error_message_size: u32,
) {
    let this_ref = &mut *this;
    let msg = if !error_message.is_null() && error_message_size > 0 {
        let bytes =
            std::slice::from_raw_parts(error_message as *const u8, error_message_size as usize);
        String::from_utf8_lossy(bytes).to_string()
    } else {
        String::new()
    };
    let formatted = format!(
        "CDM rejected promise {promise_id} (exception={exception}, sys={system_code}): {msg}"
    );
    this_ref.trace_log.push(formatted.clone());
    this_ref.last_rejection = Some(formatted);
}

unsafe extern "C" fn host_on_session_message(
    this: *mut CdmHostState,
    session_id: *const c_char,
    session_id_size: u32,
    message_type: u32,
    message: *const u8,
    message_size: u32,
) {
    let this_ref = &mut *this;
    if this_ref.session_id.is_empty() && !session_id.is_null() && session_id_size > 0 {
        let s_bytes = std::slice::from_raw_parts(session_id as *const u8, session_id_size as usize);
        this_ref.session_id = String::from_utf8_lossy(s_bytes).to_string();
    }
    if !message.is_null() && message_size > 0 {
        let m_bytes = std::slice::from_raw_parts(message, message_size as usize);
        this_ref.latest_challenge = m_bytes.to_vec();
    }
    this_ref.trace_log.push(format!(
        "Host::OnSessionMessage(type={message_type}, bytes={message_size})"
    ));
}

unsafe extern "C" fn host_on_session_keys_change(
    this: *mut CdmHostState,
    _session_id: *const c_char,
    _session_id_size: u32,
    has_additional_usable_key: bool,
    keys_info: *const CdmKeyInformation,
    keys_info_count: u32,
) {
    let this_ref = &mut *this;
    if !keys_info.is_null() && keys_info_count > 0 {
        let slice = std::slice::from_raw_parts(keys_info, keys_info_count as usize);
        this_ref.usable_keys_count = slice.iter().filter(|k| k.status == 0).count().max(1);
    } else {
        this_ref.usable_keys_count = this_ref.usable_keys_count.max(1);
    }
    this_ref.trace_log.push(format!(
        "Host::OnSessionKeysChange(has_usable={has_additional_usable_key}, count={keys_info_count}, usable={})",
        this_ref.usable_keys_count
    ));
}

unsafe extern "C" fn host_on_expiration_change(
    _this: *mut CdmHostState,
    _session_id: *const c_char,
    _session_id_size: u32,
    _new_expiry_time: f64,
) {
}

unsafe extern "C" fn host_on_session_closed(
    _this: *mut CdmHostState,
    _session_id: *const c_char,
    _session_id_size: u32,
) {
}

unsafe extern "C" fn host_send_platform_challenge(
    _this: *mut CdmHostState,
    _service_id: *const c_char,
    _service_id_size: u32,
    _challenge: *const c_char,
    _challenge_size: u32,
) {
}

unsafe extern "C" fn host_enable_output_protection(_this: *mut CdmHostState, _desired_mask: u32) {}

unsafe extern "C" fn host_query_output_protection_status(_this: *mut CdmHostState) {}

unsafe extern "C" fn host_on_deferred_init_done(
    _this: *mut CdmHostState,
    _stream_type: u32,
    _decoder_status: u32,
) {
}

unsafe extern "C" fn host_create_file_io(
    this: *mut CdmHostState,
    client: *mut c_void,
) -> *mut c_void {
    let this_ref = &mut *this;
    this_ref
        .trace_log
        .push(format!("Host::CreateFileIO(client={client:?})"));
    let fio = Box::new(CdmFileIoImpl {
        vtable: &CDM_FILE_IO_VTABLE,
        client_ptr: client,
    });
    Box::into_raw(fio) as *mut c_void
}

unsafe extern "C" fn host_request_storage_id(this: *mut CdmHostState, version: u32) {
    let this_ref = &mut *this;
    this_ref
        .trace_log
        .push(format!("Host::RequestStorageId(version={version})"));
    if !this_ref.cdm_ptr.is_null() {
        let vtable_ptr = *(this_ref.cdm_ptr as *const *const CdmInstanceVtable);
        let dummy_id = [0x53u8; 32];
        ((*vtable_ptr).on_storage_id)(this_ref.cdm_ptr, version, dummy_id.as_ptr(), 32);
    }
}

unsafe extern "C" fn host_on_initialized(this: *mut CdmHostState, success: bool) {
    let this_ref = &mut *this;
    this_ref
        .trace_log
        .push(format!("Host::OnInitialized(success={success})"));
    this_ref.initialized = success;
}

unsafe extern "C" fn host_report_metrics(
    _this: *mut CdmHostState,
    _metric_name: u32,
    _value: u64,
) {
}

unsafe extern "C" fn host_dtor(_this: *mut CdmHostState) {}

static CDM_HOST_VTABLE: CdmHostVtable = CdmHostVtable {
    allocate: host_allocate,
    set_timer: host_set_timer,
    get_current_wall_time: host_get_current_wall_time,
    on_initialized: host_on_initialized,
    on_resolve_key_status_promise: host_on_resolve_key_status_promise,
    on_resolve_new_session_promise: host_on_resolve_new_session_promise,
    on_resolve_promise: host_on_resolve_promise,
    on_reject_promise: host_on_reject_promise,
    on_session_message: host_on_session_message,
    on_session_keys_change: host_on_session_keys_change,
    on_expiration_change: host_on_expiration_change,
    on_session_closed: host_on_session_closed,
    send_platform_challenge: host_send_platform_challenge,
    enable_output_protection: host_enable_output_protection,
    query_output_protection_status: host_query_output_protection_status,
    on_deferred_initialization_done: host_on_deferred_init_done,
    create_file_io: host_create_file_io,
    request_storage_id: host_request_storage_id,
    report_metrics: host_report_metrics,
    dtor_complete: host_dtor,
    dtor_deleting: host_dtor,
};

extern "C" fn get_cdm_host_callback(host_interface_version: c_int, user_data: *mut c_void) -> *mut c_void {
    // Support Host_10 (10) and Host_11 (11)
    if host_interface_version == 10 || host_interface_version == 11 {
        user_data
    } else {
        user_data
    }
}

/// Virtual method table layout of `cdm::ContentDecryptionModule_10` / `cdm::ContentDecryptionModule_11`.
/// Note: In `content_decryption_module.h`, `~ContentDecryptionModule_10()` is declared at the bottom
/// (`protected: virtual ~ContentDecryptionModule_10() {}`), so slot 0 is `Initialize`,
/// slot 1 is `GetStatusForPolicy`, and slot 2 is `SetServerCertificate`!
#[repr(C)]
struct CdmInstanceVtable {
    initialize: unsafe extern "C" fn(*mut c_void, bool, bool, bool),
    get_status_for_policy: unsafe extern "C" fn(*mut c_void, u32, *const c_void),
    set_server_certificate: unsafe extern "C" fn(*mut c_void, u32, *const u8, u32),
    create_session_and_generate_request:
        unsafe extern "C" fn(*mut c_void, u32, u32, u32, *const u8, u32),
    load_session: unsafe extern "C" fn(*mut c_void, u32, u32, *const c_char, u32),
    update_session:
        unsafe extern "C" fn(*mut c_void, u32, *const c_char, u32, *const u8, u32),
    close_session: unsafe extern "C" fn(*mut c_void, u32, *const c_char, u32),
    remove_session: unsafe extern "C" fn(*mut c_void, u32, *const c_char, u32),
    timer_expired: unsafe extern "C" fn(*mut c_void, *mut c_void),
    decrypt: unsafe extern "C" fn(
        *mut c_void,
        *const CdmInputBuffer2,
        *mut CdmDecryptedBlockImpl,
    ) -> CdmStatus,
    initialize_audio_decoder: unsafe extern "C" fn(*mut c_void, *const c_void) -> CdmStatus,
    initialize_video_decoder: unsafe extern "C" fn(*mut c_void, *const c_void) -> CdmStatus,
    deinitialize_decoder: unsafe extern "C" fn(*mut c_void, u32),
    reset_decoder: unsafe extern "C" fn(*mut c_void, u32),
    decrypt_and_decode_frame:
        unsafe extern "C" fn(*mut c_void, *const CdmInputBuffer2, *mut c_void) -> CdmStatus,
    decrypt_and_decode_samples:
        unsafe extern "C" fn(*mut c_void, *const CdmInputBuffer2, *mut c_void) -> CdmStatus,
    on_platform_challenge_response: unsafe extern "C" fn(*mut c_void, *const c_void),
    on_query_output_protection_status: unsafe extern "C" fn(*mut c_void, u32, u32, u32),
    on_storage_id: unsafe extern "C" fn(*mut c_void, u32, *const u8, u32),
    destroy: unsafe extern "C" fn(*mut c_void),
}

#[repr(C)]
struct CdmHostFile {
    file_path: *const c_char,
    file: c_int,
    sig_file_path: *const c_char,
    sig_file: c_int,
}

type VerifyCdmHost0Fn = unsafe extern "C" fn(*const CdmHostFile, u32) -> bool;
type InitializeCdmModuleFn = unsafe extern "C" fn();
type DeinitializeCdmModuleFn = unsafe extern "C" fn();
type GetCdmHostFn = extern "C" fn(c_int, *mut c_void) -> *mut c_void;
type CreateCdmInstanceFn = unsafe extern "C" fn(
    c_int,
    *const c_char,
    u32,
    GetCdmHostFn,
    *mut c_void,
) -> *mut c_void;

struct LoadedCdmModule {
    dl_handle: *mut c_void,
    create_fn: CreateCdmInstanceFn,
    deinit_fn: Option<DeinitializeCdmModuleFn>,
}

unsafe impl Send for LoadedCdmModule {}
unsafe impl Sync for LoadedCdmModule {}

static LOADED_CDM_MODULE: std::sync::OnceLock<std::sync::Mutex<Option<LoadedCdmModule>>> =
    std::sync::OnceLock::new();

fn cdm_trace_enabled() -> bool {
    std::env::var("SIMP_CDM_TRACE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

macro_rules! cdm_step_log {
    ($($arg:tt)*) => {
        if cdm_trace_enabled() {
            eprintln!($($arg)*);
        }
    };
}

/// Active Native Rust Widevine CDM Session hosting `libwidevinecdm.so` / `widevinecdm.dll` directly via FFI.
#[allow(dead_code)]
pub struct WidevineCdmSession {
    dl_handle: *mut c_void,
    cdm_ptr: *mut c_void,
    deinit_fn: Option<DeinitializeCdmModuleFn>,
    host: Box<CdmHostState>,
    next_promise_id: u32,
    active_sessions: Vec<String>,
}

unsafe impl Send for WidevineCdmSession {}

impl WidevineCdmSession {
    /// Dynamically loads `libwidevinecdm.so` / `widevinecdm.dll` (initializing the module strictly once per process),
    /// instantiates `ContentDecryptionModule_10` (or `_11`), and initializes the CDM session.
    pub fn open(lib_path: &Path) -> Result<Self> {
        unsafe {
            let module_mutex = LOADED_CDM_MODULE.get_or_init(|| std::sync::Mutex::new(None));
            let mut module_guard = module_mutex
                .lock()
                .map_err(|_| anyhow!("Poisoned CDM module lock"))?;

            let (dl_handle, create_fn, deinit_fn) = if let Some(ref m) = *module_guard {
                (m.dl_handle, m.create_fn, m.deinit_fn)
            } else {
                cdm_step_log!("[CDM-STEP] 1/5 dl_open_library({})...", lib_path.display());
                let dl_handle = dl_open_library(lib_path)?;

                let ver_sym = dl_find_symbol(dl_handle, "GetCdmVersion");
                if !ver_sym.is_null() {
                    let ver_fn: extern "C" fn() -> *const c_char = std::mem::transmute(ver_sym);
                    let p = ver_fn();
                    if !p.is_null() {
                        cdm_step_log!(
                            "[CDM-STEP] GetCdmVersion() = {}",
                            CStr::from_ptr(p).to_string_lossy()
                        );
                    }
                }

                // 0. Call VerifyCdmHost_0 if exported (some Widevine builds check that it was called prior to Initialize)
                let verify_sym = dl_find_symbol(dl_handle, "VerifyCdmHost_0");
                if !verify_sym.is_null() {
                    cdm_step_log!("[CDM-STEP] 2/5 VerifyCdmHost_0...");
                    let verify_fn: VerifyCdmHost0Fn = std::mem::transmute(verify_sym);
                    let ok = verify_fn(std::ptr::null(), 0);
                    cdm_step_log!("[CDM-STEP] VerifyCdmHost_0 returned {ok}");
                }

                // 1. Call InitializeCdmModule_4 (or InitializeCdmModule) strictly once per process
                for init_sym in ["InitializeCdmModule_4", "InitializeCdmModule"] {
                    let sym = dl_find_symbol(dl_handle, init_sym);
                    if !sym.is_null() {
                        cdm_step_log!("[CDM-STEP] 3/5 {init_sym}()...");
                        let init_fn: InitializeCdmModuleFn = std::mem::transmute(sym);
                        init_fn();
                        break;
                    }
                }

                let deinit_sym = dl_find_symbol(dl_handle, "DeinitializeCdmModule");
                let deinit_fn: Option<DeinitializeCdmModuleFn> = if !deinit_sym.is_null() {
                    Some(std::mem::transmute(deinit_sym))
                } else {
                    None
                };

                let create_sym = dl_find_symbol(dl_handle, "CreateCdmInstance");
                if create_sym.is_null() {
                    return Err(anyhow!(
                        "CreateCdmInstance symbol not found in {}",
                        lib_path.display()
                    ));
                }
                let create_fn: CreateCdmInstanceFn = std::mem::transmute(create_sym);

                *module_guard = Some(LoadedCdmModule {
                    dl_handle,
                    create_fn,
                    deinit_fn,
                });
                (dl_handle, create_fn, deinit_fn)
            };
            drop(module_guard);

            let mut host = Box::new(CdmHostState {
                vtable: &CDM_HOST_VTABLE,
                cdm_ptr: std::ptr::null_mut(),
                initialized: false,
                session_id: String::new(),
                latest_challenge: Vec::new(),
                usable_keys_count: 0,
                last_rejection: None,
                trace_log: Vec::new(),
                pending_timers: Vec::new(),
            });
            let host_ptr: *mut CdmHostState = &mut *host;

            let key_system = b"com.widevine.alpha\0";
            let mut cdm_ptr: *mut c_void = std::ptr::null_mut();
            for ver in [10, 11] {
                cdm_step_log!("[CDM-STEP] 4/5 CreateCdmInstance(version={ver})...");
                cdm_ptr = create_fn(
                    ver,
                    key_system.as_ptr() as *const c_char,
                    18,
                    get_cdm_host_callback,
                    host_ptr as *mut c_void,
                );
                if !cdm_ptr.is_null() {
                    cdm_step_log!("[CDM-STEP] CreateCdmInstance(version={ver}) succeeded: {cdm_ptr:?}");
                    break;
                }
            }

            if cdm_ptr.is_null() {
                return Err(anyhow!(
                    "CreateCdmInstance(10/11, \"com.widevine.alpha\") returned null"
                ));
            }

            host.cdm_ptr = cdm_ptr;
            let vtable_ptr = *(cdm_ptr as *const *const CdmInstanceVtable);
            cdm_step_log!("[CDM-STEP] 5/5 cdm->Initialize(false, false, false)...");
            ((*vtable_ptr).initialize)(cdm_ptr, false, false, false);
            let mut session = Self {
                dl_handle,
                cdm_ptr,
                deinit_fn,
                host,
                next_promise_id: 10,
                active_sessions: Vec::new(),
            };
            session.pump_pending_timers();
            cdm_step_log!(
                "[CDM-STEP] cdm->Initialize done (host.initialized={}, trace={:?})",
                session.host.initialized,
                session.host.trace_log
            );

            Ok(session)
        }
    }

    fn alloc_promise_id(&mut self) -> u32 {
        let id = self.next_promise_id;
        self.next_promise_id = self.next_promise_id.wrapping_add(1).max(1);
        id
    }

    /// Pumps any deferred short timers scheduled by the CDM via `Host::SetTimer`.
    pub fn pump_pending_timers(&mut self) {
        for _ in 0..8 {
            if self.host.pending_timers.is_empty() {
                break;
            }
            let timers: Vec<(i64, *mut c_void)> = self.host.pending_timers.drain(..).collect();
            for (_delay, ctx) in timers {
                if !ctx.is_null() && !self.cdm_ptr.is_null() {
                    unsafe {
                        let vtable_ptr = *(self.cdm_ptr as *const *const CdmInstanceVtable);
                        ((*vtable_ptr).timer_expired)(self.cdm_ptr, ctx);
                    }
                }
            }
        }
    }

    /// Optional: Sets the Widevine Server Certificate (`SetServerCertificate`) before generating the license challenge.
    pub fn set_server_certificate(&mut self, cert_bytes: &[u8]) -> Result<()> {
        if cert_bytes.is_empty() {
            return Ok(());
        }
        let pid = self.alloc_promise_id();
        unsafe {
            let vtable_ptr = *(self.cdm_ptr as *const *const CdmInstanceVtable);
            ((*vtable_ptr).set_server_certificate)(
                self.cdm_ptr,
                pid,
                cert_bytes.as_ptr(),
                cert_bytes.len() as u32,
            );
        }
        self.pump_pending_timers();
        if let Some(ref rej) = self.host.last_rejection {
            return Err(anyhow!("{rej}"));
        }
        Ok(())
    }

    /// Calls `CreateSessionAndGenerateRequest(kTemporary, kCenc, pssh_box)` and returns the
    /// generated Widevine license request challenge bytes.
    pub fn generate_license_challenge(&mut self, pssh_box: &[u8]) -> Result<Vec<u8>> {
        // Evict oldest sessions when more than 3 accumulate on the persistent CDM instance
        while self.active_sessions.len() >= 3 {
            let old_sid = self.active_sessions.remove(0);
            let close_pid = self.alloc_promise_id();
            unsafe {
                let vtable_ptr = *(self.cdm_ptr as *const *const CdmInstanceVtable);
                let sid_bytes = old_sid.as_bytes();
                ((*vtable_ptr).close_session)(
                    self.cdm_ptr,
                    close_pid,
                    sid_bytes.as_ptr() as *const c_char,
                    sid_bytes.len() as u32,
                );
            }
            self.pump_pending_timers();
        }

        self.host.latest_challenge.clear();
        self.host.last_rejection = None;
        let pid = self.alloc_promise_id();

        cdm_step_log!(
            "[CDM-STEP] 6/8 CreateSessionAndGenerateRequest(pssh_len={})...",
            pssh_box.len()
        );
        unsafe {
            let vtable_ptr = *(self.cdm_ptr as *const *const CdmInstanceVtable);
            // session_type = 0 (kTemporary), init_data_type = 0 (kCenc)
            ((*vtable_ptr).create_session_and_generate_request)(
                self.cdm_ptr,
                pid,
                0,
                0,
                pssh_box.as_ptr(),
                pssh_box.len() as u32,
            );
        }
        self.pump_pending_timers();
        if !self.host.session_id.is_empty()
            && !self.active_sessions.contains(&self.host.session_id)
        {
            self.active_sessions.push(self.host.session_id.clone());
        }
        cdm_step_log!(
            "[CDM-STEP] CreateSessionAndGenerateRequest done (sid={}, challenge_len={}, trace={:?})",
            self.host.session_id,
            self.host.latest_challenge.len(),
            self.host.trace_log
        );

        if let Some(ref rej) = self.host.last_rejection {
            return Err(anyhow!("{rej}"));
        }
        if self.host.latest_challenge.is_empty() {
            return Err(anyhow!(
                "Widevine CDM did not emit an OnSessionMessage challenge for PSSH box ({} bytes)",
                pssh_box.len()
            ));
        }

        Ok(self.host.latest_challenge.clone())
    }

    /// Calls `UpdateSession` with the CKC license returned by Apple's `acquireWebPlaybackLicense` endpoint.
    pub fn update_session_with_license(&mut self, license_bytes: &[u8]) -> Result<()> {
        self.host.last_rejection = None;
        let pid = self.alloc_promise_id();
        let sid_bytes = self.host.session_id.as_bytes();
        cdm_step_log!(
            "[CDM-STEP] 7/8 UpdateSession(sid={}, license_len={})...",
            self.host.session_id,
            license_bytes.len()
        );
        unsafe {
            let vtable_ptr = *(self.cdm_ptr as *const *const CdmInstanceVtable);
            ((*vtable_ptr).update_session)(
                self.cdm_ptr,
                pid,
                sid_bytes.as_ptr() as *const c_char,
                sid_bytes.len() as u32,
                license_bytes.as_ptr(),
                license_bytes.len() as u32,
            );
        }
        self.pump_pending_timers();
        cdm_step_log!(
            "[CDM-STEP] UpdateSession done (usable_keys={}, challenge_len={}, trace={:?})",
            self.host.usable_keys_count,
            self.host.latest_challenge.len(),
            self.host.trace_log
        );

        if let Some(ref rej) = self.host.last_rejection {
            return Err(anyhow!("{rej}"));
        }
        Ok(())
    }

    /// Decrypts a single encrypted audio sample via `cdm->Decrypt(InputBuffer_2, DecryptedBlock)`.
    pub fn decrypt_sample(
        &mut self,
        encrypted_sample: &[u8],
        key_id: &[u8; 16],
        iv_16: &[u8; 16],
        scheme: CdmEncryptionScheme,
        crypt_byte_block: u8,
        skip_byte_block: u8,
    ) -> Result<Vec<u8>> {
        let subsample = CdmSubsampleEntry {
            clear_bytes: 0,
            cipher_bytes: encrypted_sample.len() as u32,
        };
        let input = CdmInputBuffer2 {
            data: encrypted_sample.as_ptr(),
            data_size: encrypted_sample.len() as u32,
            encryption_scheme: scheme,
            key_id: key_id.as_ptr(),
            key_id_size: key_id.len() as u32,
            _pad0: 0,
            iv: iv_16.as_ptr(),
            iv_size: iv_16.len() as u32,
            _pad1: 0,
            subsamples: &subsample,
            num_subsamples: 1,
            _pad2: 0,
            pattern: CdmPattern {
                crypt_byte_block: crypt_byte_block as u32,
                skip_byte_block: skip_byte_block as u32,
            },
            timestamp: 0,
        };

        let mut dec_block = CdmDecryptedBlockImpl::new();
        let status = unsafe {
            let vtable_ptr = *(self.cdm_ptr as *const *const CdmInstanceVtable);
            ((*vtable_ptr).decrypt)(self.cdm_ptr, &input, &mut dec_block)
        };

        if status != CdmStatus::Success {
            return Err(anyhow!("cdm->Decrypt failed with status {:?}", status));
        }
        if dec_block.buffer.is_null() {
            return Err(anyhow!("cdm->Decrypt returned null DecryptedBuffer"));
        }

        let clear_slice = unsafe {
            let buf_ref = &*dec_block.buffer;
            buf_ref.as_slice()
        };
        Ok(clear_slice.to_vec())
    }

    /// Decrypts an entire fMP4 media segment (`moof` + `mdat`) in place using this active `WidevineCdmSession`.
    pub fn decrypt_fmp4_media_segment_in_place(
        &mut self,
        segment_bytes: &mut [u8],
        tenc: &TrackEncryptionInfo,
    ) -> Result<usize> {
        let moof_info = parse_moof_fragment(segment_bytes, tenc.per_sample_iv_size);
        if moof_info.sample_sizes.is_empty() {
            return Err(anyhow!("No trun sample sizes found in media segment moof box"));
        }

        let mut offset = 0usize;
        let mut mdat_payload_range: Option<(usize, usize)> = None;
        while offset + 8 <= segment_bytes.len() {
            let size = u32::from_be_bytes([
                segment_bytes[offset],
                segment_bytes[offset + 1],
                segment_bytes[offset + 2],
                segment_bytes[offset + 3],
            ]) as usize;
            let box_type = &segment_bytes[offset + 4..offset + 8];
            let box_end = if size == 0 {
                segment_bytes.len()
            } else if size >= 8 && offset + size <= segment_bytes.len() {
                offset + size
            } else {
                break;
            };

            if box_type == b"mdat" {
                mdat_payload_range = Some((offset + 8, box_end));
                break;
            }
            offset = box_end;
        }

        let (mdat_start, mdat_end) =
            mdat_payload_range.ok_or_else(|| anyhow!("No mdat box found in fMP4 media segment"))?;

        let scheme = if &tenc.scheme_type == b"cenc" {
            CdmEncryptionScheme::Cenc
        } else {
            CdmEncryptionScheme::Cbcs
        };

        let mut default_iv = [0u8; 16];
        let copy_len = tenc.constant_iv.len().min(16);
        default_iv[..copy_len].copy_from_slice(&tenc.constant_iv[..copy_len]);

        let mdat_slice = &mut segment_bytes[mdat_start..mdat_end];
        let mut sample_cursor = 0usize;
        let mut decrypted_samples = 0usize;

        cdm_step_log!(
            "[CDM-STEP] 8/8 Decrypting {} samples in mdat ({} bytes)...",
            moof_info.sample_sizes.len(),
            mdat_slice.len()
        );

        for (idx, &sample_sz) in moof_info.sample_sizes.iter().enumerate() {
            let sz = sample_sz as usize;
            if sample_cursor + sz > mdat_slice.len() {
                break;
            }
            let mut iv = default_iv;
            if let Some(s_iv) = moof_info.sample_ivs.get(idx) {
                let n = s_iv.len().min(16);
                iv = [0u8; 16];
                iv[..n].copy_from_slice(&s_iv[..n]);
            }

            let clear = self.decrypt_sample(
                &mdat_slice[sample_cursor..sample_cursor + sz],
                &tenc.default_kid,
                &iv,
                scheme,
                tenc.crypt_byte_block,
                tenc.skip_byte_block,
            )?;
            if clear.len() == sz {
                mdat_slice[sample_cursor..sample_cursor + sz].copy_from_slice(&clear);
            }
            sample_cursor += sz;
            decrypted_samples += 1;
        }

        cdm_step_log!("[CDM-STEP] Decrypted {decrypted_samples} samples successfully!");
        Ok(decrypted_samples)
    }

    /// Performs the complete Apple Music Widevine handshake for an `AppleHlsMediaPlaylist`:
    /// 1. `CreateSessionAndGenerateRequest(pssh)`
    /// 2. If the first message is a 2-byte service certificate request (`0x08 0x04`), exchanges it first
    ///    and then sends the full license challenge to `acquireWebPlaybackLicense`
    /// 3. `UpdateSession(ckc)`
    pub fn negotiate_apple_license(
        &mut self,
        license_server_url: &str,
        dev_token: &str,
        user_token: &str,
        song_id: &str,
        playlist: &AppleHlsMediaPlaylist,
        pssh_bytes: &[u8],
    ) -> Result<()> {
        let key_uri_or_b64 = playlist
            .key_uri
            .clone()
            .or_else(|| playlist.widevine_pssh_b64.clone())
            .unwrap_or_else(|| BASE64_STD.encode(pssh_bytes));

        let first_challenge = self.generate_license_challenge(pssh_bytes)?;
        let first_response = post_apple_widevine_license_request(
            license_server_url,
            dev_token,
            user_token,
            song_id,
            &key_uri_or_b64,
            &first_challenge,
        )?;

        self.host.latest_challenge.clear();
        self.update_session_with_license(&first_response)?;

        // If `first_challenge` was a 2-byte Privacy Mode Service Certificate Request (`[0x08, 0x04]`),
        // `UpdateSession` with the returned certificate triggers a second `OnSessionMessage` with the real license challenge!
        if !self.host.latest_challenge.is_empty() {
            let second_challenge = self.host.latest_challenge.clone();
            let ckc_license = post_apple_widevine_license_request(
                license_server_url,
                dev_token,
                user_token,
                song_id,
                &key_uri_or_b64,
                &second_challenge,
            )?;
            self.update_session_with_license(&ckc_license)?;
        }

        Ok(())
    }
}

static CACHED_APPLE_SERVER_CERT: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();

struct CdmSessionEntry {
    song_id: String,
    session: WidevineCdmSession,
    licensed: bool,
}

pub struct CdmWorkerPool {
    sessions: std::collections::VecDeque<CdmSessionEntry>,
    standby: Option<WidevineCdmSession>,
}

type CdmThreadJob = Box<dyn FnOnce(&mut CdmWorkerPool) + Send + 'static>;

static DEDICATED_CDM_WORKER_TX: std::sync::OnceLock<std::sync::mpsc::Sender<CdmThreadJob>> =
    std::sync::OnceLock::new();

fn cdm_worker_tx() -> &'static std::sync::mpsc::Sender<CdmThreadJob> {
    DEDICATED_CDM_WORKER_TX.get_or_init(|| {
        let (job_tx, job_rx) = std::sync::mpsc::channel::<CdmThreadJob>();
        std::thread::Builder::new()
            .name("simp-widevine-cdm".to_string())
            .spawn(move || {
                let mut pool = CdmWorkerPool {
                    sessions: std::collections::VecDeque::with_capacity(6),
                    standby: None,
                };
                while let Ok(job) = job_rx.recv() {
                    job(&mut pool);
                }
            })
            .expect("Failed to spawn dedicated simp-widevine-cdm worker thread");
        job_tx
    })
}

fn run_on_cdm_worker<F, R>(f: F) -> Result<R>
where
    F: FnOnce(&mut CdmWorkerPool) -> Result<R> + Send + 'static,
    R: Send + 'static,
{
    let tx = cdm_worker_tx();
    let (res_tx, res_rx) = std::sync::mpsc::sync_channel::<Result<R>>(1);
    tx.send(Box::new(move |pool: &mut CdmWorkerPool| {
        let res = f(pool);
        let _ = res_tx.send(res);
    }))
    .map_err(|_| anyhow!("Dedicated Widevine CDM worker thread terminated unexpectedly"))?;

    res_rx
        .recv()
        .map_err(|_| anyhow!("Dedicated Widevine CDM worker thread dropped response channel"))?
}

/// Asynchronously pre-opens and initializes a warm standby `WidevineCdmSession` on `"simp-widevine-cdm"`
/// so the next track's `CreateCdmInstance + Initialize + SetServerCertificate` costs `0ms`.
pub fn prewarm_standby_cdm_session(lib_path: &Path) {
    let lib_path_buf = lib_path.to_path_buf();
    let _ = cdm_worker_tx().send(Box::new(move |pool: &mut CdmWorkerPool| {
        if pool.standby.is_none() {
            if let Ok(mut session) = WidevineCdmSession::open(&lib_path_buf) {
                if let Some(cert) = CACHED_APPLE_SERVER_CERT.get() {
                    let _ = session.set_server_certificate(cert);
                }
                pool.standby = Some(session);
            }
        }
    }));
}

/// Negotiates (or reuses an already-prefetched) `WidevineCdmSession` for `song_id` on `"simp-widevine-cdm"`.
/// - If `prefetch_apple_music_track` already negotiated the license for `song_id`, returns `Ok(())` in `0ms`!
/// - Otherwise takes the pre-warmed `standby` session (or opens a new one), exchanges the CKC without
///   blocking `"simp-widevine-cdm"` during HTTP calls, retains up to 4 concurrent track sessions so active
///   playback and background prefetching never collide, and replenishes `standby` in the background.
pub fn negotiate_apple_license_for_epoch(
    lib_path: &Path,
    epoch: u64,
    active_epoch: &std::sync::atomic::AtomicU64,
    license_server_url: &str,
    dev_token: &str,
    user_token: &str,
    song_id: &str,
    playlist: &AppleHlsMediaPlaylist,
    pssh_bytes: &[u8],
) -> Result<()> {
    use std::sync::atomic::Ordering;

    if epoch != 0 && active_epoch.load(Ordering::SeqCst) != epoch {
        return Err(anyhow!("Track superseded before Widevine session open"));
    }

    let key_uri_or_b64 = playlist
        .key_uri
        .clone()
        .or_else(|| playlist.widevine_pssh_b64.clone())
        .unwrap_or_else(|| BASE64_STD.encode(pssh_bytes));

    let lib_path_buf = lib_path.to_path_buf();
    let pssh_vec = pssh_bytes.to_vec();
    let song_key = song_id.to_string();

    // Step 1 (on `"simp-widevine-cdm"`): Check if `song_id` already has a licensed session from prefetch!
    // Otherwise take the warm standby session (or open a fresh one) and generate the initial challenge.
    let challenge_opt: Option<Vec<u8>> = run_on_cdm_worker(move |pool| {
        if let Some(pos) = pool
            .sessions
            .iter()
            .position(|e| e.song_id == song_key && e.licensed)
        {
            if let Some(entry) = pool.sessions.remove(pos) {
                pool.sessions.push_back(entry);
            }
            return Ok(None);
        }

        pool.sessions.retain(|e| e.song_id != song_key);
        while pool.sessions.len() >= 4 {
            pool.sessions.pop_front();
        }

        let mut session = match pool.standby.take() {
            Some(s) => s,
            None => WidevineCdmSession::open(&lib_path_buf)?,
        };
        if let Some(cert) = CACHED_APPLE_SERVER_CERT.get() {
            let _ = session.set_server_certificate(cert);
        }
        let challenge = session.generate_license_challenge(&pssh_vec)?;
        pool.sessions.push_back(CdmSessionEntry {
            song_id: song_key,
            session,
            licensed: false,
        });
        Ok(Some(challenge))
    })?;

    // Replenish the warm standby session asynchronously!
    prewarm_standby_cdm_session(lib_path);

    let Some(first_challenge) = challenge_opt else {
        // Already licensed during prefetch!
        return Ok(());
    };
    let was_service_cert_request = first_challenge.len() <= 8;

    if epoch != 0 && active_epoch.load(Ordering::SeqCst) != epoch {
        return Err(anyhow!("Track superseded before license request #1"));
    }

    // Step 2 (on caller thread, NOT holding `"simp-widevine-cdm"`): Exchange challenge #1 via HTTP POST
    let first_response = post_apple_widevine_license_request(
        license_server_url,
        dev_token,
        user_token,
        song_id,
        &key_uri_or_b64,
        &first_challenge,
    )?;

    if epoch != 0 && active_epoch.load(Ordering::SeqCst) != epoch {
        return Err(anyhow!("Track superseded after license request #1"));
    }

    // Step 3 (on `"simp-widevine-cdm"`): Apply `first_response` via `UpdateSession`
    let first_resp_for_cert = first_response.clone();
    let song_key_step3 = song_id.to_string();
    let second_challenge = run_on_cdm_worker(move |pool| {
        let entry = pool
            .sessions
            .iter_mut()
            .rev()
            .find(|e| e.song_id == song_key_step3)
            .ok_or_else(|| anyhow!("Widevine CDM session missing for song {song_key_step3}"))?;
        entry.session.host.latest_challenge.clear();
        entry.session.update_session_with_license(&first_response)?;
        if entry.session.host.latest_challenge.is_empty() {
            entry.licensed = true;
        }
        Ok(entry.session.host.latest_challenge.clone())
    })?;

    // Step 4: If `first_challenge` was a 2-byte Privacy Mode Service Certificate Request (`[0x08, 0x04]`),
    // cache the Server Certificate for future `SetServerCertificate` pre-warming, then exchange the
    // resulting full license challenge via HTTP POST and apply the CKC on `"simp-widevine-cdm"`.
    if !second_challenge.is_empty() {
        if was_service_cert_request {
            let _ = CACHED_APPLE_SERVER_CERT.set(first_resp_for_cert);
        }
        if epoch != 0 && active_epoch.load(Ordering::SeqCst) != epoch {
            return Err(anyhow!("Track superseded before license request #2"));
        }
        let ckc_license = post_apple_widevine_license_request(
            license_server_url,
            dev_token,
            user_token,
            song_id,
            &key_uri_or_b64,
            &second_challenge,
        )?;
        if epoch != 0 && active_epoch.load(Ordering::SeqCst) != epoch {
            return Err(anyhow!("Track superseded after license request #2"));
        }
        let song_key_step4 = song_id.to_string();
        run_on_cdm_worker(move |pool| {
            let entry = pool
                .sessions
                .iter_mut()
                .rev()
                .find(|e| e.song_id == song_key_step4)
                .ok_or_else(|| anyhow!("Widevine CDM session missing for song {song_key_step4}"))?;
            entry.session.update_session_with_license(&ckc_license)?;
            entry.licensed = true;
            Ok(())
        })?;
    }

    Ok(())
}

/// Decrypts a batch of fMP4 media segments on `"simp-widevine-cdm"` using the active session for `song_id`.
pub fn decrypt_segments_for_epoch(
    _epoch: u64,
    song_id: &str,
    mut segments: Vec<Vec<u8>>,
    tenc: TrackEncryptionInfo,
) -> Result<Vec<Vec<u8>>> {
    let song_key = song_id.to_string();
    run_on_cdm_worker(move |pool| {
        let entry = pool
            .sessions
            .iter_mut()
            .rev()
            .find(|e| e.song_id == song_key && e.licensed)
            .ok_or_else(|| anyhow!("Licensed Widevine CDM session missing for song {song_key}"))?;
        for seg in &mut segments {
            entry
                .session
                .decrypt_fmp4_media_segment_in_place(seg, &tenc)?;
        }
        Ok(segments)
    })
}

/// Executes a closure against a fresh `WidevineCdmSession` pinned to the dedicated `"simp-widevine-cdm"`
/// OS thread (used by synchronous one-shot loaders).
pub fn with_persistent_cdm_session<F, R>(lib_path: &Path, f: F) -> Result<R>
where
    F: FnOnce(&mut WidevineCdmSession) -> Result<R> + Send + 'static,
    R: Send + 'static,
{
    let lib_path_buf = lib_path.to_path_buf();
    run_on_cdm_worker(move |pool| {
        let mut s = match pool.standby.take() {
            Some(st) => st,
            None => WidevineCdmSession::open(&lib_path_buf)?,
        };
        let res = f(&mut s);
        while pool.sessions.len() >= 4 {
            pool.sessions.pop_front();
        }
        pool.sessions.push_back(CdmSessionEntry {
            song_id: "oneshot".to_string(),
            session: s,
            licensed: true,
        });
        res
    })
}

impl Drop for WidevineCdmSession {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe {
            if !self.cdm_ptr.is_null() {
                let vtable_ptr = *(self.cdm_ptr as *const *const CdmInstanceVtable);
                if !self.host.session_id.is_empty() {
                    let sid_bytes = self.host.session_id.as_bytes();
                    ((*vtable_ptr).close_session)(
                        self.cdm_ptr,
                        99,
                        sid_bytes.as_ptr() as *const c_char,
                        sid_bytes.len() as u32,
                    );
                }
                ((*vtable_ptr).destroy)(self.cdm_ptr);
                self.cdm_ptr = std::ptr::null_mut();
            }
            let _ = self.deinit_fn;
            let _ = self.dl_handle;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cdm_buffer_and_decrypted_block_vtable_abi() {
        unsafe {
            let buf_ptr = CdmBufferImpl::allocate(128);
            assert!(!buf_ptr.is_null());
            let vtbl = (*buf_ptr).vtable;
            assert_eq!(((*vtbl).capacity)(buf_ptr), 128);
            let data_ptr = ((*vtbl).data)(buf_ptr);
            std::ptr::copy_nonoverlapping(b"SIMP_CDM_OK".as_ptr(), data_ptr, 11);
            ((*vtbl).set_size)(buf_ptr, 11);
            assert_eq!(((*vtbl).size)(buf_ptr), 11);
            let buf_ref = &*buf_ptr;
            assert_eq!(buf_ref.as_slice(), b"SIMP_CDM_OK");

            let mut block = CdmDecryptedBlockImpl::new();
            let blk_vtbl = block.vtable;
            ((*blk_vtbl).set_decrypted_buffer)(&mut block, buf_ptr);
            ((*blk_vtbl).set_timestamp)(&mut block, 42_000);
            assert_eq!(((*blk_vtbl).timestamp)(&block), 42_000);
            assert_eq!(((*blk_vtbl).decrypted_buffer)(&mut block), buf_ptr);
        }
    }

    #[test]
    fn test_extract_deb_data_tar_parser() {
        let mut deb = Vec::new();
        deb.extend_from_slice(b"!<arch>\n");
        // Member 1: debian-binary (4 bytes: "2.0\n")
        deb.extend_from_slice(
            b"debian-binary   1700000000  0     0     100644  4         `\n2.0\n",
        );
        // Member 2: data.tar.xz (5 bytes: "HELLO", padded by 1 byte)
        deb.extend_from_slice(
            b"data.tar.xz     1700000000  0     0     100644  5         `\nHELLO\n",
        );
        let (name, payload) = extract_deb_data_tar(&deb).expect("extract data.tar.xz");
        assert_eq!(name, "data.tar.xz");
        assert_eq!(payload, b"HELLO");
    }

    #[test]
    fn test_macho_and_universal_header_compatibility() {
        // 64-bit Mach-O little-endian header (`MH_MAGIC_64 = 0xFEEDFACF` -> `[0xCF, 0xFA, 0xED, 0xFE]`)
        let mut arm64_macho = [0u8; 32];
        arm64_macho[0..4].copy_from_slice(&[0xCF, 0xFA, 0xED, 0xFE]);
        arm64_macho[4..8].copy_from_slice(&0x0100_000Cu32.to_le_bytes()); // CPU_TYPE_ARM64

        let mut x64_macho = [0u8; 32];
        x64_macho[0..4].copy_from_slice(&[0xCF, 0xFA, 0xED, 0xFE]);
        x64_macho[4..8].copy_from_slice(&0x0100_0007u32.to_le_bytes()); // CPU_TYPE_X86_64

        if cfg!(target_arch = "aarch64") {
            assert!(check_cdm_header_bytes(&arm64_macho));
            assert!(!check_cdm_header_bytes(&x64_macho));
        } else if cfg!(target_arch = "x86_64") {
            assert!(check_cdm_header_bytes(&x64_macho));
            assert!(!check_cdm_header_bytes(&arm64_macho));
        }

        // Universal Fat Mach-O (`0xCAFEBABE`) containing both x86_64 and arm64 slices
        let mut fat_macho = [0u8; 48];
        fat_macho[0..4].copy_from_slice(&[0xCA, 0xFE, 0xBA, 0xBE]);
        fat_macho[4..8].copy_from_slice(&2u32.to_be_bytes()); // nfat_arch = 2
        fat_macho[8..12].copy_from_slice(&0x0100_0007u32.to_be_bytes()); // slice 0: x86_64
        fat_macho[28..32].copy_from_slice(&0x0100_000Cu32.to_be_bytes()); // slice 1: arm64
        assert!(check_cdm_header_bytes(&fat_macho));
    }
}
