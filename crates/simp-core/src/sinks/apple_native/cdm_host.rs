use crate::sinks::apple_native::{
    hls::AppleHlsMediaPlaylist,
    mp4_cbcs::{parse_moof_fragment, TrackEncryptionInfo},
};
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

/// Describes the location and ABI capabilities of a discovered `libwidevinecdm.so` binary on Linux/SteamOS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiscoveredWidevineCdm {
    pub library_path: PathBuf,
    pub source_label: String,
    pub cdm_version: Option<String>,
}

/// Discovers an installed `libwidevinecdm.so` on the system without spawning any browser process.
/// Searches:
/// 1. `~/.local/share/simp/lib/libwidevinecdm.so` (user/SIMP drop-in path)
/// 2. Flatpak Firefox (`~/.var/app/org.mozilla.firefox/.mozilla/firefox/*/gmp-widevinecdm/*/libwidevinecdm.so`)
/// 3. Native Firefox (`~/.mozilla/firefox/*/gmp-widevinecdm/*/libwidevinecdm.so`)
/// 4. Flatpak / Native Chrome, Brave, Edge, and Chromium `WidevineCdm` directories
/// 5. System `/opt/google/chrome/WidevineCdm` and `/usr/lib/chromium/libwidevinecdm.so`
pub fn discover_widevine_cdm_library() -> Option<DiscoveredWidevineCdm> {
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

    let home = dirs::home_dir()?;

    // 1. Explicit SIMP userland library folder
    let simp_lib = home.join(".local/share/simp/lib/libwidevinecdm.so");
    if simp_lib.is_file() {
        return Some(DiscoveredWidevineCdm {
            library_path: simp_lib,
            source_label: "simp-userland".to_string(),
            cdm_version: None,
        });
    }

    // 2. Firefox profiles (Flatpak & Native)
    for (label, ff_root) in [
        (
            "firefox-flatpak",
            home.join(".var/app/org.mozilla.firefox/.mozilla/firefox"),
        ),
        ("firefox-native", home.join(".mozilla/firefox")),
    ] {
        if let Some(found) = scan_for_file_named(&ff_root, "libwidevinecdm.so", 4) {
            stage_cdm_into_userland(&found, &simp_lib);
            let active_path = if simp_lib.is_file() { simp_lib } else { found };
            return Some(DiscoveredWidevineCdm {
                library_path: active_path,
                source_label: label.to_string(),
                cdm_version: None,
            });
        }
    }

    // 3. Chromium/Chrome/Brave/Edge WidevineCdm directories
    for (label, chr_root) in [
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
    ] {
        if let Some(found) = scan_for_file_named(&chr_root, "libwidevinecdm.so", 5) {
            stage_cdm_into_userland(&found, &simp_lib);
            let active_path = if simp_lib.is_file() { simp_lib } else { found };
            return Some(DiscoveredWidevineCdm {
                library_path: active_path,
                source_label: label.to_string(),
                cdm_version: None,
            });
        }
    }

    for sys_path in [
        "/usr/lib/chromium/libwidevinecdm.so",
        "/usr/lib64/chromium/libwidevinecdm.so",
    ] {
        let p = Path::new(sys_path);
        if p.is_file() {
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

    None
}

fn stage_cdm_into_userland(src: &Path, dest: &Path) {
    if dest.is_file() {
        return;
    }
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if std::fs::copy(src, dest).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(dest, std::fs::Permissions::from_mode(0o755));
        }
        // Also copy companion `.sig` or `manifest.json` files if present alongside `libwidevinecdm.so`
        if let (Some(src_dir), Some(dest_dir)) = (src.parent(), dest.parent()) {
            for companion in ["libwidevinecdm.so.sig", "manifest.json"] {
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
            if path.file_name().and_then(|n| n.to_str()) == Some(target_name) {
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

/// Queries `GetCdmVersion()` from a `libwidevinecdm.so` shared library via `dlopen`/`dlsym`.
pub fn query_cdm_version(lib_path: &Path) -> Option<String> {
    #[cfg(unix)]
    unsafe {
        let c_path = CString::new(lib_path.to_str()?).ok()?;
        let handle = libc::dlopen(c_path.as_ptr(), libc::RTLD_LAZY | libc::RTLD_LOCAL);
        if handle.is_null() {
            return None;
        }
        let sym_name = CString::new("GetCdmVersion").ok()?;
        let sym = libc::dlsym(handle, sym_name.as_ptr());
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
        libc::dlclose(handle);
        ver
    }
    #[cfg(not(unix))]
    {
        let _ = lib_path;
        None
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
    widevine_pssh_b64: &str,
    challenge_bytes: &[u8],
) -> Result<Vec<u8>> {
    let challenge_b64 = BASE64_STD.encode(challenge_bytes);
    let clean_id = song_id
        .strip_prefix("applemusic:song:")
        .or_else(|| song_id.strip_prefix("applemusic:track:"))
        .or_else(|| song_id.strip_prefix("applemusic:"))
        .unwrap_or(song_id)
        .trim();

    let payload = serde_json::json!({
        "challenge": challenge_b64,
        "key-system": "com.widevine.alpha",
        "uri": format!("data:text/plain;base64,{widevine_pssh_b64}"),
        "adamId": clean_id,
        "isLibrary": clean_id.starts_with("i."),
        "user-initiated": true,
    });

    let body_str = serde_json::to_string(&payload)?;
    let curl_cfg = format!(
        "url = \"{}\"\nrequest = \"POST\"\nheader = \"Authorization: Bearer {}\"\nheader = \"Music-User-Token: {}\"\nheader = \"Content-Type: application/json\"\nheader = \"Origin: https://music.apple.com\"\nheader = \"Referer: https://music.apple.com/\"\ndata = \"{}\"\n",
        license_server_url.replace('"', "\\\""),
        dev_token.trim(),
        user_token.trim(),
        body_str.replace('\\', "\\\\").replace('"', "\\\"")
    );

    let mut child = Command::new("curl")
        .args(["-fsSL", "--max-time", "15", "--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Failed to invoke curl for Apple Widevine license exchange")?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(curl_cfg.as_bytes());
    }

    let out = child.wait_with_output()?;
    if !out.status.success() {
        return Err(anyhow!(
            "Apple Widevine license POST failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    let resp_json: Value =
        serde_json::from_slice(&out.stdout).context("Invalid JSON from Apple license server")?;
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

#[repr(C)]
struct CdmHostVtable {
    allocate: unsafe extern "C" fn(*mut CdmHostState, u32) -> *mut CdmBufferImpl,
    set_timer: unsafe extern "C" fn(*mut CdmHostState, i64, *mut c_void),
    get_current_wall_time: unsafe extern "C" fn(*mut CdmHostState) -> f64,
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
    on_initialized: unsafe extern "C" fn(*mut CdmHostState, bool),
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
}

unsafe extern "C" fn host_allocate(_this: *mut CdmHostState, capacity: u32) -> *mut CdmBufferImpl {
    CdmBufferImpl::allocate(capacity)
}

unsafe extern "C" fn host_set_timer(_this: *mut CdmHostState, _delay_ms: i64, _context: *mut c_void) {
}

unsafe extern "C" fn host_get_current_wall_time(_this: *mut CdmHostState) -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(1_700_000_000.0)
}

unsafe extern "C" fn host_on_resolve_key_status_promise(
    _this: *mut CdmHostState,
    _promise_id: u32,
    _key_status: u32,
) {
}

unsafe extern "C" fn host_on_resolve_new_session_promise(
    this: *mut CdmHostState,
    _promise_id: u32,
    session_id: *const c_char,
    session_id_size: u32,
) {
    if !session_id.is_null() && session_id_size > 0 {
        let bytes = std::slice::from_raw_parts(session_id as *const u8, session_id_size as usize);
        (*this).session_id = String::from_utf8_lossy(bytes).to_string();
    }
}

unsafe extern "C" fn host_on_resolve_promise(_this: *mut CdmHostState, _promise_id: u32) {}

unsafe extern "C" fn host_on_reject_promise(
    this: *mut CdmHostState,
    _promise_id: u32,
    exception: u32,
    system_code: u32,
    error_message: *const c_char,
    error_message_size: u32,
) {
    let msg = if !error_message.is_null() && error_message_size > 0 {
        let bytes =
            std::slice::from_raw_parts(error_message as *const u8, error_message_size as usize);
        String::from_utf8_lossy(bytes).to_string()
    } else {
        String::new()
    };
    (*this).last_rejection = Some(format!(
        "CDM rejected promise (exception={exception}, sys={system_code}): {msg}"
    ));
}

unsafe extern "C" fn host_on_session_message(
    this: *mut CdmHostState,
    session_id: *const c_char,
    session_id_size: u32,
    _message_type: u32,
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
}

unsafe extern "C" fn host_on_session_keys_change(
    this: *mut CdmHostState,
    _session_id: *const c_char,
    _session_id_size: u32,
    _has_additional_usable_key: bool,
    keys_info: *const CdmKeyInformation,
    keys_info_count: u32,
) {
    if !keys_info.is_null() && keys_info_count > 0 {
        let slice = std::slice::from_raw_parts(keys_info, keys_info_count as usize);
        (*this).usable_keys_count = slice.iter().filter(|k| k.status == 0).count().max(1);
    } else {
        (*this).usable_keys_count = (*this).usable_keys_count.max(1);
    }
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
    on_initialized: host_on_initialized,
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
/// (`protected: virtual ~ContentDecryptionModule_10() {}`), so slot 0 is `Initialize`!
#[repr(C)]
struct CdmInstanceVtable {
    initialize: unsafe extern "C" fn(*mut c_void, bool, bool, bool),
    set_server_certificate: unsafe extern "C" fn(*mut c_void, u32, *const u8, u32),
    get_status_for_policy: unsafe extern "C" fn(*mut c_void, u32, *const c_void),
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

/// Active Native Rust Widevine CDM Session hosting `libwidevinecdm.so` directly via FFI.
pub struct WidevineCdmSession {
    #[cfg(unix)]
    dl_handle: *mut c_void,
    cdm_ptr: *mut c_void,
    deinit_fn: Option<DeinitializeCdmModuleFn>,
    host: Box<CdmHostState>,
}

unsafe impl Send for WidevineCdmSession {}

impl WidevineCdmSession {
    /// Dynamically loads `libwidevinecdm.so`, instantiates `ContentDecryptionModule_10` (or `_11`),
    /// and initializes the CDM session.
    pub fn open(lib_path: &Path) -> Result<Self> {
        #[cfg(not(unix))]
        {
            let _ = lib_path;
            return Err(anyhow!("Native libwidevinecdm.so FFI is only supported on Unix targets"));
        }

        #[cfg(unix)]
        unsafe {
            let c_path = CString::new(
                lib_path
                    .to_str()
                    .ok_or_else(|| anyhow!("Invalid UTF-8 path for libwidevinecdm.so"))?,
            )?;
            eprintln!("[CDM-STEP] 1/5 dlopen({})...", lib_path.display());
            let dl_handle = libc::dlopen(c_path.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
            if dl_handle.is_null() {
                let err_ptr = libc::dlerror();
                let err_msg = if !err_ptr.is_null() {
                    CStr::from_ptr(err_ptr).to_string_lossy().to_string()
                } else {
                    "unknown dlopen error".to_string()
                };
                return Err(anyhow!(
                    "Failed to dlopen {}: {}",
                    lib_path.display(),
                    err_msg
                ));
            }

            if let Ok(ver_cs) = CString::new("GetCdmVersion") {
                let ver_sym = libc::dlsym(dl_handle, ver_cs.as_ptr());
                if !ver_sym.is_null() {
                    let ver_fn: extern "C" fn() -> *const c_char = std::mem::transmute(ver_sym);
                    let p = ver_fn();
                    if !p.is_null() {
                        eprintln!(
                            "[CDM-STEP] GetCdmVersion() = {}",
                            CStr::from_ptr(p).to_string_lossy()
                        );
                    }
                }
            }

            // 0. Call VerifyCdmHost_0 if exported (some Widevine builds check that it was called prior to Initialize)
            if let Ok(verify_cs) = CString::new("VerifyCdmHost_0") {
                let verify_sym = libc::dlsym(dl_handle, verify_cs.as_ptr());
                if !verify_sym.is_null() {
                    eprintln!("[CDM-STEP] 2/5 VerifyCdmHost_0...");
                    let verify_fn: VerifyCdmHost0Fn = std::mem::transmute(verify_sym);
                    let ok = verify_fn(std::ptr::null(), 0);
                    eprintln!("[CDM-STEP] VerifyCdmHost_0 returned {ok}");
                }
            }

            // 1. Call InitializeCdmModule_4 (or InitializeCdmModule) if exported
            for init_sym in ["InitializeCdmModule_4", "InitializeCdmModule"] {
                if let Ok(cs) = CString::new(init_sym) {
                    let sym = libc::dlsym(dl_handle, cs.as_ptr());
                    if !sym.is_null() {
                        eprintln!("[CDM-STEP] 3/5 {init_sym}()...");
                        let init_fn: InitializeCdmModuleFn = std::mem::transmute(sym);
                        init_fn();
                        break;
                    }
                }
            }

            let deinit_cs = CString::new("DeinitializeCdmModule").unwrap();
            let deinit_sym = libc::dlsym(dl_handle, deinit_cs.as_ptr());
            let deinit_fn: Option<DeinitializeCdmModuleFn> = if !deinit_sym.is_null() {
                Some(std::mem::transmute(deinit_sym))
            } else {
                None
            };

            let create_cs = CString::new("CreateCdmInstance").unwrap();
            let create_sym = libc::dlsym(dl_handle, create_cs.as_ptr());
            if create_sym.is_null() {
                libc::dlclose(dl_handle);
                return Err(anyhow!(
                    "CreateCdmInstance symbol not found in {}",
                    lib_path.display()
                ));
            }
            let create_fn: CreateCdmInstanceFn = std::mem::transmute(create_sym);

            let mut host = Box::new(CdmHostState {
                vtable: &CDM_HOST_VTABLE,
                cdm_ptr: std::ptr::null_mut(),
                initialized: false,
                session_id: String::new(),
                latest_challenge: Vec::new(),
                usable_keys_count: 0,
                last_rejection: None,
                trace_log: Vec::new(),
            });
            let host_ptr: *mut CdmHostState = &mut *host;

            let key_system = b"com.widevine.alpha\0";
            let mut cdm_ptr: *mut c_void = std::ptr::null_mut();
            for ver in [10, 11] {
                eprintln!("[CDM-STEP] 4/5 CreateCdmInstance(version={ver})...");
                cdm_ptr = create_fn(
                    ver,
                    key_system.as_ptr() as *const c_char,
                    18,
                    get_cdm_host_callback,
                    host_ptr as *mut c_void,
                );
                if !cdm_ptr.is_null() {
                    eprintln!("[CDM-STEP] CreateCdmInstance(version={ver}) succeeded: {cdm_ptr:?}");
                    break;
                }
            }

            if cdm_ptr.is_null() {
                libc::dlclose(dl_handle);
                return Err(anyhow!(
                    "CreateCdmInstance(10/11, \"com.widevine.alpha\") returned null"
                ));
            }

            host.cdm_ptr = cdm_ptr;
            let vtable_ptr = *(cdm_ptr as *const *const CdmInstanceVtable);
            eprintln!("[CDM-STEP] 5/5 cdm->Initialize(false, false, false)...");
            ((*vtable_ptr).initialize)(cdm_ptr, false, false, false);
            eprintln!(
                "[CDM-STEP] cdm->Initialize done (host.initialized={}, trace={:?})",
                host.initialized, host.trace_log
            );

            Ok(Self {
                dl_handle,
                cdm_ptr,
                deinit_fn,
                host,
            })
        }
    }

    /// Optional: Sets the Widevine Server Certificate (`SetServerCertificate`) before generating the license challenge.
    pub fn set_server_certificate(&mut self, cert_bytes: &[u8]) -> Result<()> {
        if cert_bytes.is_empty() {
            return Ok(());
        }
        unsafe {
            let vtable_ptr = *(self.cdm_ptr as *const *const CdmInstanceVtable);
            ((*vtable_ptr).set_server_certificate)(
                self.cdm_ptr,
                1,
                cert_bytes.as_ptr(),
                cert_bytes.len() as u32,
            );
        }
        if let Some(ref rej) = self.host.last_rejection {
            return Err(anyhow!("{rej}"));
        }
        Ok(())
    }

    /// Calls `CreateSessionAndGenerateRequest(kTemporary, kCenc, pssh_box)` and returns the
    /// generated Widevine license request challenge bytes.
    pub fn generate_license_challenge(&mut self, pssh_box: &[u8]) -> Result<Vec<u8>> {
        self.host.latest_challenge.clear();
        self.host.last_rejection = None;

        unsafe {
            let vtable_ptr = *(self.cdm_ptr as *const *const CdmInstanceVtable);
            // promise_id = 2, session_type = 0 (kTemporary), init_data_type = 0 (kCenc)
            ((*vtable_ptr).create_session_and_generate_request)(
                self.cdm_ptr,
                2,
                0,
                0,
                pssh_box.as_ptr(),
                pssh_box.len() as u32,
            );
        }

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
        let sid_bytes = self.host.session_id.as_bytes();
        unsafe {
            let vtable_ptr = *(self.cdm_ptr as *const *const CdmInstanceVtable);
            ((*vtable_ptr).update_session)(
                self.cdm_ptr,
                3,
                sid_bytes.as_ptr() as *const c_char,
                sid_bytes.len() as u32,
                license_bytes.as_ptr(),
                license_bytes.len() as u32,
            );
        }

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
        let pssh_b64 = playlist
            .widevine_pssh_b64
            .clone()
            .unwrap_or_else(|| BASE64_STD.encode(pssh_bytes));

        let first_challenge = self.generate_license_challenge(pssh_bytes)?;
        let first_response = post_apple_widevine_license_request(
            license_server_url,
            dev_token,
            user_token,
            song_id,
            &pssh_b64,
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
                &pssh_b64,
                &second_challenge,
            )?;
            self.update_session_with_license(&ckc_license)?;
        }

        Ok(())
    }
}

impl Drop for WidevineCdmSession {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe {
            if !self.cdm_ptr.is_null() {
                let vtable_ptr = *(self.cdm_ptr as *const *const CdmInstanceVtable);
                ((*vtable_ptr).destroy)(self.cdm_ptr);
                self.cdm_ptr = std::ptr::null_mut();
            }
            if let Some(deinit) = self.deinit_fn.take() {
                deinit();
            }
            if !self.dl_handle.is_null() {
                libc::dlclose(self.dl_handle);
                self.dl_handle = std::ptr::null_mut();
            }
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
}
