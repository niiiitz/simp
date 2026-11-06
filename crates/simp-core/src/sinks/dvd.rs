use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use simp_protocol::{
    DvdAudioTrack, DvdChapterInfo, DvdSubtitleTrack, DvdTitleInfo, OpticalDiscStatus,
};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

const DVD_SECTOR_SIZE: usize = 2048;
const DVDCSS_SEEK_MPEG: libc::c_int = 1 << 0;
const DVDCSS_SEEK_KEY: libc::c_int = 1 << 1;
const DVDCSS_READ_DECRYPT: libc::c_int = 1 << 0;

/// Contiguous sector range inside a Title Set's `VTS_XX_1..9.VOB` span.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DvdCellSectorSpan {
    pub chapter_number: u16,
    pub start_ms: u32,
    pub duration_ms: u32,
    pub first_sector: u32,
    pub last_sector: u32,
}

/// Internal parsed representation of a DVD Title including its physical LBA layout.
#[derive(Clone, Debug)]
pub struct ParsedDvdTitle {
    pub info: DvdTitleInfo,
    pub vob_base_lba: u32,
    pub cell_spans: Vec<DvdCellSectorSpan>,
}

#[derive(Clone, Debug)]
pub struct ParsedDvdDisc {
    pub disc_id: String,
    pub volume_label: String,
    pub display_title: String,
    pub release_year: Option<i32>,
    pub art_url: Option<String>,
    pub titles: Vec<ParsedDvdTitle>,
}

// ============================================================================
// 1. Runtime Dynamic Loader for User-Supplied `libdvdcss.so.2` (Zero Bundling)
// ============================================================================

type DvdCssOpenFn = unsafe extern "C" fn(*const libc::c_char) -> *mut libc::c_void;
type DvdCssCloseFn = unsafe extern "C" fn(*mut libc::c_void) -> libc::c_int;
type DvdCssSeekFn =
    unsafe extern "C" fn(*mut libc::c_void, libc::c_int, libc::c_int) -> libc::c_int;
type DvdCssReadFn = unsafe extern "C" fn(
    *mut libc::c_void,
    *mut libc::c_void,
    libc::c_int,
    libc::c_int,
) -> libc::c_int;

pub struct DvdCssSession {
    _lib_handle: *mut libc::c_void,
    css_handle: *mut libc::c_void,
    fn_close: DvdCssCloseFn,
    fn_seek: DvdCssSeekFn,
    fn_read: DvdCssReadFn,
}

unsafe impl Send for DvdCssSession {}

impl Drop for DvdCssSession {
    fn drop(&mut self) {
        unsafe {
            if !self.css_handle.is_null() {
                (self.fn_close)(self.css_handle);
            }
        }
    }
}

/// Returns candidate paths where a user may have placed `libdvdcss.so.2` (Linux) or `libdvdcss-2.dll` (Windows).
pub fn candidate_libdvdcss_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(env_path) = std::env::var("SIMP_DVDCSS_PATH") {
        if !env_path.trim().is_empty() {
            paths.push(PathBuf::from(env_path.trim()));
        }
    }
    let data_dir = crate::simp_data_dir();
    let data_lib = data_dir.join("lib");
    #[cfg(target_os = "windows")]
    {
        for name in ["libdvdcss-2.dll", "libdvdcss.dll", "dvdcss.dll"] {
            paths.push(data_lib.join(name));
            paths.push(data_dir.join(name));
            paths.push(data_dir.join("bin").join(name));
        }
        let mut search_roots = vec![data_dir.clone()];
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                for name in ["libdvdcss-2.dll", "libdvdcss.dll", "dvdcss.dll"] {
                    paths.push(exe_dir.join(name));
                }
                search_roots.push(exe_dir.to_path_buf());
                if let Some(parent_dir) = exe_dir.parent() {
                    search_roots.push(parent_dir.to_path_buf());
                }
            }
        }
        if let Some(user_profile) = std::env::var_os("USERPROFILE") {
            let up = PathBuf::from(user_profile);
            search_roots.push(up.join("Downloads"));
            search_roots.push(up.join("Desktop"));
            search_roots.push(up.join("OneDrive").join("Desktop"));
        }
        for root in search_roots {
            if root.is_dir() {
                for entry in walkdir::WalkDir::new(&root)
                    .max_depth(3)
                    .into_iter()
                    .flatten()
                {
                    if entry.path().is_file() {
                        let fname = entry.file_name().to_string_lossy().to_lowercase();
                        if fname.contains("dvdcss") && fname.ends_with(".dll") {
                            let p = entry.path().to_path_buf();
                            if !paths.contains(&p) {
                                paths.push(p);
                            }
                        }
                    }
                }
            }
        }
        paths.push(PathBuf::from(r"C:\Program Files\VideoLAN\VLC\libdvdcss-2.dll"));
        paths.push(PathBuf::from(r"C:\Program Files (x86)\VideoLAN\VLC\libdvdcss-2.dll"));
    }
    #[cfg(not(target_os = "windows"))]
    {
        paths.push(data_lib.join("libdvdcss.so.2"));
        if let Some(data_dir) = dirs::data_local_dir() {
            paths.push(data_dir.join("simp").join("lib").join("libdvdcss.so.2"));
        }
        if let Some(home) = std::env::var_os("HOME") {
            paths.push(
                PathBuf::from(home)
                    .join(".local/share/simp/lib/libdvdcss.so.2"),
            );
        }
        for sys in [
            "/usr/lib/libdvdcss.so.2",
            "/usr/lib64/libdvdcss.so.2",
            "/usr/local/lib/libdvdcss.so.2",
            "/usr/lib/x86_64-linux-gnu/libdvdcss.so.2",
            "/usr/lib/aarch64-linux-gnu/libdvdcss.so.2",
        ] {
            paths.push(PathBuf::from(sys));
        }
    }
    paths
}

pub fn find_libdvdcss_path() -> Option<PathBuf> {
    for p in candidate_libdvdcss_paths() {
        if !p.is_file() {
            continue;
        }
        #[cfg(windows)]
        unsafe {
            #[link(name = "kernel32")]
            extern "system" {
                fn LoadLibraryW(lp_lib_file_name: *const u16) -> *mut libc::c_void;
                fn GetProcAddress(
                    h_module: *mut libc::c_void,
                    lp_proc_name: *const libc::c_char,
                ) -> *mut libc::c_void;
                fn FreeLibrary(h_lib_module: *mut libc::c_void) -> i32;
            }
            let wide_path: Vec<u16> = p
                .to_string_lossy()
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let h = LoadLibraryW(wide_path.as_ptr());
            if h.is_null() {
                continue;
            }
            let sym = GetProcAddress(h, b"dvdcss_open\0".as_ptr() as *const _);
            FreeLibrary(h);
            if sym.is_null() {
                continue;
            }
        }
        return Some(p);
    }
    None
}

/// Discovers an installed VLC binary (`vlc.exe` on Windows or `vlc` on Linux), which embeds `libdvdcss`
/// statically inside its `dvdread` / `dvdnav` access plugins on Windows.
pub fn find_vlc_binary() -> Option<PathBuf> {
    if let Ok(env_vlc) = std::env::var("SIMP_VLC_PATH") {
        let p = PathBuf::from(env_vlc.trim());
        if p.is_file() {
            return Some(p);
        }
    }
    #[cfg(target_os = "windows")]
    {
        for candidate in [
            r"C:\Program Files\VideoLAN\VLC\vlc.exe",
            r"C:\Program Files (x86)\VideoLAN\VLC\vlc.exe",
        ] {
            let p = PathBuf::from(candidate);
            if p.is_file() {
                return Some(p);
            }
        }
        if let Some(user_profile) = std::env::var_os("USERPROFILE") {
            let scoop = PathBuf::from(user_profile)
                .join("scoop")
                .join("apps")
                .join("vlc")
                .join("current")
                .join("vlc.exe");
            if scoop.is_file() {
                return Some(scoop);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        for candidate in ["/usr/bin/vlc", "/usr/local/bin/vlc"] {
            let p = PathBuf::from(candidate);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

impl DvdCssSession {
    pub fn open(device_path: &str) -> Option<Self> {
        let so_path = find_libdvdcss_path()?;

        #[cfg(unix)]
        unsafe {
            let c_dev = std::ffi::CString::new(device_path.as_bytes()).ok()?;
            let c_so = std::ffi::CString::new(so_path.to_string_lossy().as_bytes()).ok()?;
            let lib_handle = libc::dlopen(c_so.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
            if lib_handle.is_null() {
                return None;
            }
            let sym_open = libc::dlsym(lib_handle, b"dvdcss_open\0".as_ptr() as *const _);
            let sym_close = libc::dlsym(lib_handle, b"dvdcss_close\0".as_ptr() as *const _);
            let sym_seek = libc::dlsym(lib_handle, b"dvdcss_seek\0".as_ptr() as *const _);
            let sym_read = libc::dlsym(lib_handle, b"dvdcss_read\0".as_ptr() as *const _);
            if sym_open.is_null()
                || sym_close.is_null()
                || sym_seek.is_null()
                || sym_read.is_null()
            {
                libc::dlclose(lib_handle);
                return None;
            }

            let fn_open: DvdCssOpenFn = std::mem::transmute(sym_open);
            let fn_close: DvdCssCloseFn = std::mem::transmute(sym_close);
            let fn_seek: DvdCssSeekFn = std::mem::transmute(sym_seek);
            let fn_read: DvdCssReadFn = std::mem::transmute(sym_read);

            let css_handle = fn_open(c_dev.as_ptr());
            if css_handle.is_null() {
                libc::dlclose(lib_handle);
                return None;
            }

            Some(Self {
                _lib_handle: lib_handle,
                css_handle,
                fn_close,
                fn_seek,
                fn_read,
            })
        }

        #[cfg(windows)]
        unsafe {
            #[link(name = "kernel32")]
            extern "system" {
                fn LoadLibraryW(lp_lib_file_name: *const u16) -> *mut libc::c_void;
                fn GetProcAddress(
                    h_module: *mut libc::c_void,
                    lp_proc_name: *const libc::c_char,
                ) -> *mut libc::c_void;
                fn FreeLibrary(h_lib_module: *mut libc::c_void) -> i32;
            }
            let wide_path: Vec<u16> = so_path
                .to_string_lossy()
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let lib_handle = LoadLibraryW(wide_path.as_ptr());
            if lib_handle.is_null() {
                return None;
            }
            let sym_open = GetProcAddress(lib_handle, b"dvdcss_open\0".as_ptr() as *const _);
            let sym_close = GetProcAddress(lib_handle, b"dvdcss_close\0".as_ptr() as *const _);
            let sym_seek = GetProcAddress(lib_handle, b"dvdcss_seek\0".as_ptr() as *const _);
            let sym_read = GetProcAddress(lib_handle, b"dvdcss_read\0".as_ptr() as *const _);
            if sym_open.is_null()
                || sym_close.is_null()
                || sym_seek.is_null()
                || sym_read.is_null()
            {
                FreeLibrary(lib_handle);
                return None;
            }

            let fn_open: DvdCssOpenFn = std::mem::transmute(sym_open);
            let fn_close: DvdCssCloseFn = std::mem::transmute(sym_close);
            let fn_seek: DvdCssSeekFn = std::mem::transmute(sym_seek);
            let fn_read: DvdCssReadFn = std::mem::transmute(sym_read);

            // VideoLAN's `libdvdcss` on Windows (`win2k_open`) expects `"D:"` (2 chars)
            // and prepends `"\\.\"` internally when enabling Win32 SCSI pass-through ioctls.
            let win_drive_spec = device_path
                .strip_prefix(r"\\.\")
                .unwrap_or(device_path)
                .trim_end_matches('\\');
            let c_short = std::ffi::CString::new(win_drive_spec.as_bytes()).ok()?;
            let mut css_handle = fn_open(c_short.as_ptr());
            if css_handle.is_null() {
                if let Ok(c_raw) = std::ffi::CString::new(device_path.as_bytes()) {
                    css_handle = fn_open(c_raw.as_ptr());
                }
            }
            if css_handle.is_null() {
                FreeLibrary(lib_handle);
                return None;
            }

            Some(Self {
                _lib_handle: lib_handle,
                css_handle,
                fn_close,
                fn_seek,
                fn_read,
            })
        }
    }

    pub fn seek_sector(&mut self, lba: u32, unlock_key: bool) -> Result<()> {
        let flags = if unlock_key {
            DVDCSS_SEEK_KEY
        } else {
            DVDCSS_SEEK_MPEG
        };
        let res = unsafe { (self.fn_seek)(self.css_handle, lba as libc::c_int, flags) };
        if res < 0 {
            return Err(anyhow!("dvdcss_seek failed at sector {lba}"));
        }
        Ok(())
    }

    pub fn read_sectors(&mut self, buf: &mut [u8], sectors: usize, decrypt: bool) -> Result<usize> {
        let flags = if decrypt { DVDCSS_READ_DECRYPT } else { 0 };
        let read_blocks = unsafe {
            (self.fn_read)(
                self.css_handle,
                buf.as_mut_ptr() as *mut libc::c_void,
                sectors as libc::c_int,
                flags,
            )
        };
        if read_blocks < 0 {
            return Err(anyhow!("dvdcss_read failed ({read_blocks})"));
        }
        Ok(read_blocks as usize)
    }
}

/// Discovers an available `ffmpeg` binary (`~/.local/share/simp/bin/ffmpeg`, `<portable_dir>/data/bin/ffmpeg.exe`, or system `PATH`).
pub fn find_ffmpeg_binary() -> Option<PathBuf> {
    if let Ok(env_bin) = std::env::var("SIMP_FFMPEG_PATH") {
        let p = PathBuf::from(env_bin.trim());
        if p.is_file() {
            return Some(p);
        }
    }
    let bin_name = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let data_bin = crate::simp_data_dir().join("bin").join(bin_name);
    if data_bin.is_file() {
        return Some(data_bin);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let sibling = exe_dir.join(bin_name);
            if sibling.is_file() {
                return Some(sibling);
            }
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let p = PathBuf::from(home).join(".local/share/simp/bin/ffmpeg");
        if p.is_file() {
            return Some(p);
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let base = PathBuf::from(local_app_data).join("Microsoft").join("WinGet");
            let link = base.join("Links").join("ffmpeg.exe");
            if link.is_file() {
                return Some(link);
            }
            let pkgs = base.join("Packages");
            if let Ok(entries) = fs::read_dir(&pkgs) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    if name.contains("ffmpeg") {
                        for sub in walkdir::WalkDir::new(entry.path())
                            .max_depth(4)
                            .into_iter()
                            .flatten()
                        {
                            if sub.file_name().eq_ignore_ascii_case("ffmpeg.exe")
                                && sub.path().is_file()
                            {
                                return Some(sub.path().to_path_buf());
                            }
                        }
                    }
                }
            }
        }
        if let Some(user_profile) = std::env::var_os("USERPROFILE") {
            let scoop = PathBuf::from(user_profile)
                .join("scoop")
                .join("shims")
                .join("ffmpeg.exe");
            if scoop.is_file() {
                return Some(scoop);
            }
        }
        let choco = PathBuf::from(r"C:\ProgramData\chocolatey\bin\ffmpeg.exe");
        if choco.is_file() {
            return Some(choco);
        }
        for fixed in [r"C:\ffmpeg\bin\ffmpeg.exe", r"C:\Program Files\ffmpeg\bin\ffmpeg.exe"] {
            let p = PathBuf::from(fixed);
            if p.is_file() {
                return Some(p);
            }
        }
        let mut search_roots = vec![crate::simp_data_dir()];
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                search_roots.push(exe_dir.to_path_buf());
                if let Some(parent_dir) = exe_dir.parent() {
                    search_roots.push(parent_dir.to_path_buf());
                }
            }
        }
        if let Some(user_profile) = std::env::var_os("USERPROFILE") {
            let up = PathBuf::from(user_profile);
            search_roots.push(up.join("Downloads"));
            search_roots.push(up.join("Desktop"));
            search_roots.push(up.join("OneDrive").join("Desktop"));
        }
        for root in search_roots {
            if root.is_dir() {
                for entry in walkdir::WalkDir::new(&root)
                    .max_depth(4)
                    .into_iter()
                    .flatten()
                {
                    if entry.file_name().eq_ignore_ascii_case("ffmpeg.exe")
                        && entry.path().is_file()
                    {
                        return Some(entry.path().to_path_buf());
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    for sys in ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/bin/ffmpeg"] {
        let p = PathBuf::from(sys);
        if p.is_file() {
            return Some(p);
        }
    }
    let mut cmd = Command::new(bin_name);
    cmd.arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::configure_background_command(&mut cmd);
    if cmd.status().map(|s| s.success()).unwrap_or(false) {
        return Some(PathBuf::from(bin_name));
    }
    None
}

// ============================================================================
// 2. Pure-Rust ISO-9660 Bridge + `.IFO` (`DVDVIDEO-VMG` / `DVDVIDEO-VTS`) Parser
// ============================================================================

#[derive(Clone, Copy, Debug)]
struct IsoFileEntry {
    extent_lba: u32,
    data_len: u32,
}

fn read_sectors_raw(file: &mut File, lba: u32, byte_len: usize) -> Result<Vec<u8>> {
    let aligned_len = ((byte_len + DVD_SECTOR_SIZE - 1) / DVD_SECTOR_SIZE) * DVD_SECTOR_SIZE;
    file.seek(SeekFrom::Start((lba as u64) * (DVD_SECTOR_SIZE as u64)))?;
    let mut buf = vec![0u8; aligned_len];
    file.read_exact(&mut buf)?;
    buf.truncate(byte_len);
    Ok(buf)
}

fn parse_iso9660_directory_entries(dir_bytes: &[u8]) -> HashMap<String, (IsoFileEntry, bool)> {
    let mut entries = HashMap::new();
    let mut pos = 0usize;
    while pos < dir_bytes.len() {
        let rec_len = dir_bytes[pos] as usize;
        if rec_len == 0 {
            // Advance to next 2048-byte sector boundary
            pos = ((pos / DVD_SECTOR_SIZE) + 1) * DVD_SECTOR_SIZE;
            continue;
        }
        if pos + rec_len > dir_bytes.len() || rec_len < 34 {
            break;
        }
        let extent_lba = u32::from_le_bytes([
            dir_bytes[pos + 2],
            dir_bytes[pos + 3],
            dir_bytes[pos + 4],
            dir_bytes[pos + 5],
        ]);
        let data_len = u32::from_le_bytes([
            dir_bytes[pos + 10],
            dir_bytes[pos + 11],
            dir_bytes[pos + 12],
            dir_bytes[pos + 13],
        ]);
        let flags = dir_bytes[pos + 25];
        let is_dir = (flags & 0x02) != 0;
        let name_len = dir_bytes[pos + 32] as usize;
        if pos + 33 + name_len <= pos + rec_len {
            let raw_name = String::from_utf8_lossy(&dir_bytes[pos + 33..pos + 33 + name_len]);
            let clean_name = raw_name
                .split(';')
                .next()
                .unwrap_or(&raw_name)
                .trim()
                .to_uppercase();
            if !clean_name.is_empty() && clean_name != "\0" && clean_name != "\u{1}" {
                entries.insert(
                    clean_name,
                    (
                        IsoFileEntry {
                            extent_lba,
                            data_len,
                        },
                        is_dir,
                    ),
                );
            }
        }
        pos += rec_len;
    }
    entries
}

/// Resolves a Windows optical device path (`\\.\E:` or `E:`) to its mounted drive root (`E:\`) if present.
fn windows_mounted_drive_root(device_path: &str) -> Option<PathBuf> {
    let trimmed = device_path.trim().strip_prefix(r"\\.\").unwrap_or(device_path.trim());
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        let ch = (bytes[0] as char).to_ascii_uppercase();
        let root = PathBuf::from(format!("{ch}:\\"));
        if root.is_dir() {
            return Some(root);
        }
    }
    let p = PathBuf::from(trimmed);
    if p.is_dir() {
        return Some(p);
    }
    None
}

/// Queries the physical starting LBA sector of a file (`VTS_XX_1.VOB`) on a mounted Windows UDF/ISO-9660 volume
/// via `FSCTL_GET_RETRIEVAL_POINTERS` so `libdvdcss-2.dll` can unlock and decrypt pure-UDF DVDs.
#[cfg(target_os = "windows")]
fn query_windows_file_starting_lba(file_path: & std::path::Path) -> Option<u32> {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    #[link(name = "kernel32")]
    extern "system" {
        fn DeviceIoControl(
            h_device: *mut c_void,
            dw_io_control_code: u32,
            lp_in_buffer: *const c_void,
            n_in_buffer_size: u32,
            lp_out_buffer: *mut c_void,
            n_out_buffer_size: u32,
            lp_bytes_returned: *mut u32,
            lp_overlapped: *mut c_void,
        ) -> i32;
    }
    const FSCTL_GET_RETRIEVAL_POINTERS: u32 = 0x00090073;
    #[repr(C)]
    struct StartingVcnInput {
        starting_vcn: i64,
    }
    #[repr(C)]
    struct RetrievalPointersBuffer {
        extent_count: u32,
        _pad: u32,
        starting_vcn: i64,
        next_vcn: i64,
        lcn: i64,
    }
    let f = File::open(file_path).ok()?;
    let handle = f.as_raw_handle() as *mut c_void;
    let input = StartingVcnInput { starting_vcn: 0 };
    let mut out: RetrievalPointersBuffer = unsafe { std::mem::zeroed() };
    let mut bytes_ret = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            handle,
            FSCTL_GET_RETRIEVAL_POINTERS,
            &input as *const StartingVcnInput as *const c_void,
            std::mem::size_of::<StartingVcnInput>() as u32,
            &mut out as *mut RetrievalPointersBuffer as *mut c_void,
            std::mem::size_of::<RetrievalPointersBuffer>() as u32,
            &mut bytes_ret,
            std::ptr::null_mut(),
        )
    };
    if ok != 0 && out.extent_count > 0 && out.lcn > 0 {
        return Some(out.lcn as u32);
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn query_windows_file_starting_lba(_file_path: &std::path::Path) -> Option<u32> {
    None
}

fn parse_mounted_dvd_directory(mount_root: &std::path::Path) -> Result<ParsedDvdDisc> {
    let video_ts_dir = if mount_root.join("VIDEO_TS").is_dir() {
        mount_root.join("VIDEO_TS")
    } else if mount_root.join("VIDEO_TS.IFO").is_file() {
        mount_root.to_path_buf()
    } else {
        return Err(anyhow!("No VIDEO_TS directory found in {}", mount_root.display()));
    };

    let vmg_path = video_ts_dir.join("VIDEO_TS.IFO");
    let vmg_bytes = fs::read(&vmg_path)
        .map_err(|e| anyhow!("Failed to read {}: {e}", vmg_path.display()))?;

    let mut volume_label = String::new();
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn GetVolumeInformationW(
                lp_root_path_name: *const u16,
                lp_volume_name_buffer: *mut u16,
                n_volume_name_size: u32,
                lp_volume_serial_number: *mut u32,
                lp_maximum_component_length: *mut u32,
                lp_file_system_flags: *mut u32,
                lp_file_system_name_buffer: *mut u16,
                n_file_system_name_size: u32,
            ) -> i32;
        }
        let s = mount_root.to_string_lossy();
        if s.len() >= 2 && s.as_bytes()[1] == b':' {
            let ch = (s.as_bytes()[0] as char).to_ascii_uppercase();
            let root_wide: [u16; 4] = [ch as u16, b':' as u16, b'\\' as u16, 0];
            let mut vol_buf = [0u16; 128];
            let ok = unsafe {
                GetVolumeInformationW(
                    root_wide.as_ptr(),
                    vol_buf.as_mut_ptr(),
                    vol_buf.len() as u32,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    0,
                )
            };
            if ok != 0 {
                let len = vol_buf.iter().position(|&c| c == 0).unwrap_or(0);
                volume_label = String::from_utf16_lossy(&vol_buf[..len]).trim().to_string();
            }
        }
    }
    if volume_label.is_empty() {
        volume_label = mount_root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "DVD_VIDEO".to_string());
    }

    parse_dvd_ifo_tables(&volume_label, &vmg_bytes, |vts_num| {
        let ifo_path = video_ts_dir.join(format!("VTS_{:02}_0.IFO", vts_num));
        let vob_path = video_ts_dir.join(format!("VTS_{:02}_1.VOB", vts_num));
        let ifo_bytes = fs::read(&ifo_path).ok()?;
        let vob_lba = query_windows_file_starting_lba(&vob_path).unwrap_or(0);
        Some((ifo_bytes, vob_lba))
    })
}

/// Parses a DVD-Video disc from an optical device (`/dev/sr0`, `\\.\E:`), mounted drive (`E:\`), or ISO file.
pub fn parse_dvd_device(device_path: &str) -> Result<ParsedDvdDisc> {
    let raw_res = (|| -> Result<ParsedDvdDisc> {
        let mut file = OpenOptions::new()
            .read(true)
            .open(device_path)
            .map_err(|e| anyhow!("Cannot open {device_path}: {e}"))?;

        // Read ISO-9660 Primary Volume Descriptor at Sector 16
        let pvd = read_sectors_raw(&mut file, 16, DVD_SECTOR_SIZE)?;
        if pvd.len() < 2048 || pvd[0] != 0x01 || &pvd[1..6] != b"CD001" {
            return Err(anyhow!("Not an ISO-9660 / UDF bridge DVD volume"));
        }

        let volume_label = String::from_utf8_lossy(&pvd[40..72]).trim().to_string();
        let root_lba = u32::from_le_bytes([pvd[158], pvd[159], pvd[160], pvd[161]]);
        let root_len = u32::from_le_bytes([pvd[166], pvd[167], pvd[168], pvd[169]]);
        if root_lba == 0 || root_len == 0 || root_len > 1024 * 1024 {
            return Err(anyhow!("Invalid ISO-9660 root directory record"));
        }

        let root_bytes = read_sectors_raw(&mut file, root_lba, root_len as usize)?;
        let root_entries = parse_iso9660_directory_entries(&root_bytes);

        let Some((video_ts_dir, true)) = root_entries.get("VIDEO_TS").copied() else {
            return Err(anyhow!("No /VIDEO_TS directory found on disc"));
        };

        let video_ts_bytes = read_sectors_raw(
            &mut file,
            video_ts_dir.extent_lba,
            video_ts_dir.data_len.min(2 * 1024 * 1024) as usize,
        )?;
        let vts_files = parse_iso9660_directory_entries(&video_ts_bytes);

        let Some((vmg_entry, false)) = vts_files.get("VIDEO_TS.IFO").copied() else {
            return Err(anyhow!("No /VIDEO_TS/VIDEO_TS.IFO found on disc"));
        };

        let vmg_bytes = read_sectors_raw(
            &mut file,
            vmg_entry.extent_lba,
            vmg_entry.data_len.min(512 * 1024) as usize,
        )?;

        parse_dvd_ifo_tables(&volume_label, &vmg_bytes, |vts_num| {
            let ifo_name = format!("VTS_{:02}_0.IFO", vts_num);
            let vob_name = format!("VTS_{:02}_1.VOB", vts_num);
            let (ifo_entry, _) = vts_files.get(&ifo_name).copied()?;
            let vob_lba = vts_files
                .get(&vob_name)
                .map(|(e, _)| e.extent_lba)
                .unwrap_or(0);
            let ifo_bytes = read_sectors_raw(
                &mut file,
                ifo_entry.extent_lba,
                ifo_entry.data_len.min(2 * 1024 * 1024) as usize,
            )
            .ok()?;
            Some((ifo_bytes, vob_lba))
        })
    })();

    if raw_res.is_ok() {
        return raw_res;
    }

    if let Some(mount_root) = windows_mounted_drive_root(device_path) {
        if let Ok(mounted_disc) = parse_mounted_dvd_directory(&mount_root) {
            return Ok(mounted_disc);
        }
    }

    raw_res
}

pub fn parse_dvd_ifo_tables<F>(
    volume_label: &str,
    vmg_bytes: &[u8],
    mut load_vts_ifo: F,
) -> Result<ParsedDvdDisc>
where
    F: FnMut(u8) -> Option<(Vec<u8>, u32)>,
{
    if vmg_bytes.len() < 0x100 || &vmg_bytes[0..12] != b"DVDVIDEO-VMG" {
        return Err(anyhow!("Invalid VIDEO_TS.IFO header (missing DVDVIDEO-VMG)"));
    }

    let tt_srpt_sector = u32::from_be_bytes([
        vmg_bytes[0xC4],
        vmg_bytes[0xC5],
        vmg_bytes[0xC6],
        vmg_bytes[0xC7],
    ]) as usize;
    let tt_srpt_offset = tt_srpt_sector * DVD_SECTOR_SIZE;
    if tt_srpt_offset + 8 > vmg_bytes.len() {
        return Err(anyhow!("VIDEO_TS.IFO TT_SRPT offset out of bounds"));
    }

    let num_titles = u16::from_be_bytes([
        vmg_bytes[tt_srpt_offset],
        vmg_bytes[tt_srpt_offset + 1],
    ]) as usize;

    let mut vts_cache: HashMap<u8, (Vec<u8>, u32)> = HashMap::new();
    let mut raw_titles: Vec<ParsedDvdTitle> = Vec::new();

    for idx in 0..num_titles.min(99) {
        let entry_off = tt_srpt_offset + 8 + idx * 12;
        if entry_off + 12 > vmg_bytes.len() {
            break;
        }
        let title_number = (idx + 1) as u16;
        let angles = vmg_bytes[entry_off + 1].max(1);
        let num_chapters = u16::from_be_bytes([vmg_bytes[entry_off + 2], vmg_bytes[entry_off + 3]]);
        let vts_number = vmg_bytes[entry_off + 6];
        let vts_ttn = vmg_bytes[entry_off + 7];

        if vts_number == 0 || vts_ttn == 0 {
            continue;
        }

        if !vts_cache.contains_key(&vts_number) {
            if let Some(loaded) = load_vts_ifo(vts_number) {
                vts_cache.insert(vts_number, loaded);
            }
        }
        let Some((vts_bytes, vob_base_lba)) = vts_cache.get(&vts_number) else {
            continue;
        };

        if let Some(parsed_title) = parse_vts_title(
            title_number,
            vts_number,
            vts_ttn,
            angles,
            num_chapters,
            vts_bytes,
            *vob_base_lba,
        ) {
            raw_titles.push(parsed_title);
        }
    }

    if raw_titles.is_empty() {
        return Err(anyhow!("No playable DVD-Video titles found in VIDEO_TS.IFO"));
    }

    // Filter out tiny <120s studio bumper/menu titles unless all titles are short
    let has_long_titles = raw_titles.iter().any(|t| t.info.duration_ms >= 120_000);
    let mut filtered_titles: Vec<ParsedDvdTitle> = if has_long_titles {
        raw_titles
            .into_iter()
            .filter(|t| t.info.duration_ms >= 120_000)
            .collect()
    } else {
        raw_titles
    };

    // Classify Movie vs. Multi-Episode TV disc
    let episode_like_count = filtered_titles
        .iter()
        .filter(|t| (14 * 60_000..=62 * 60_000).contains(&t.info.duration_ms))
        .count();
    let max_duration_ms = filtered_titles
        .iter()
        .map(|t| t.info.duration_ms)
        .max()
        .unwrap_or(0);

    if episode_like_count >= 2 && max_duration_ms <= 68 * 60_000 {
        let mut ep_num = 1usize;
        for t in &mut filtered_titles {
            if (14 * 60_000..=62 * 60_000).contains(&t.info.duration_ms) {
                t.info.label = format!("Episode {ep_num}");
                ep_num += 1;
            } else {
                t.info.label = format!("Bonus / Featurette (Title {})", t.info.title_number);
            }
        }
    } else {
        let mut marked_main = false;
        for t in &mut filtered_titles {
            if !marked_main && t.info.duration_ms == max_duration_ms {
                t.info.label = "★ Main Feature".to_string();
                marked_main = true;
            } else {
                t.info.label = format!("Title {}", t.info.title_number);
            }
        }
    }

    // Compute deterministic DVD fingerprint
    let mut hasher = blake3::Hasher::new();
    hasher.update(volume_label.as_bytes());
    for t in &filtered_titles {
        hasher.update(&t.info.title_number.to_be_bytes());
        hasher.update(&t.info.duration_ms.to_be_bytes());
    }
    let disc_id = format!("dvd_{}", &hasher.finalize().to_hex()[..16]);
    let display_title = humanize_dvd_volume_label(volume_label);

    Ok(ParsedDvdDisc {
        disc_id,
        volume_label: volume_label.to_string(),
        display_title,
        release_year: None,
        art_url: None,
        titles: filtered_titles,
    })
}

fn parse_vts_title(
    title_number: u16,
    vts_number: u8,
    vts_ttn: u8,
    angles: u8,
    fallback_chapters: u16,
    vts_bytes: &[u8],
    vob_base_lba: u32,
) -> Option<ParsedDvdTitle> {
    if vts_bytes.len() < 0x320 || &vts_bytes[0..12] != b"DVDVIDEO-VTS" {
        return None;
    }

    // 1. Video Aspect Ratio (`0x200`)
    let video_attr0 = vts_bytes[0x200];
    let ar_bits = (video_attr0 >> 2) & 0x03;
    let aspect_ratio = if ar_bits == 3 {
        "16:9".to_string()
    } else {
        "4:3".to_string()
    };

    // 2. Audio Tracks (`0x202` count, `0x204..0x244` 8-byte entries)
    let audio_count = u16::from_be_bytes([vts_bytes[0x202], vts_bytes[0x203]]).min(8) as usize;
    let mut audio_tracks = Vec::new();
    for i in 0..audio_count {
        let off = 0x204 + i * 8;
        let b0 = vts_bytes[off];
        let b1 = vts_bytes[off + 1];
        let coding_mode = (b0 >> 5) & 0x07;
        let codec = match coding_mode {
            0 => "AC-3",
            2 => "MPEG-1",
            3 => "MPEG-2",
            4 => "LPCM",
            6 => "DTS",
            _ => "Audio",
        };
        let channels = (b1 & 0x07) + 1;
        let has_lang = (b0 & 0x0C) == 0x04;
        let lang_code = if has_lang && vts_bytes[off + 2].is_ascii_alphabetic() {
            String::from_utf8_lossy(&vts_bytes[off + 2..off + 4])
                .to_lowercase()
        } else {
            "und".to_string()
        };
        let lang_name = iso639_language_name(&lang_code);
        let ext_code = vts_bytes[off + 5];
        let ext_suffix = match ext_code {
            2 => " (Visually Impaired)",
            3 | 4 => " (Commentary)",
            _ => "",
        };
        let ch_label = if channels >= 6 {
            "5.1".to_string()
        } else if channels == 2 {
            "2.0".to_string()
        } else {
            format!("{channels}ch")
        };
        audio_tracks.push(DvdAudioTrack {
            stream_index: i as u8,
            lang_code,
            lang_name: lang_name.clone(),
            codec: codec.to_string(),
            channels,
            label: format!("{lang_name} ({codec} {ch_label}){ext_suffix}"),
        });
    }

    // 3. Subtitle / SPU Tracks (`0x254` count, `0x256..0x316` 6-byte entries)
    let sub_count = u16::from_be_bytes([vts_bytes[0x254], vts_bytes[0x255]]).min(32) as usize;
    let mut subtitle_tracks = Vec::new();
    for i in 0..sub_count {
        let off = 0x256 + i * 6;
        let b0 = vts_bytes[off];
        let has_lang = (b0 & 0x03) == 0x01;
        let lang_code = if has_lang && vts_bytes[off + 2].is_ascii_alphabetic() {
            String::from_utf8_lossy(&vts_bytes[off + 2..off + 4])
                .to_lowercase()
        } else {
            "und".to_string()
        };
        let lang_name = iso639_language_name(&lang_code);
        let ext_code = vts_bytes[off + 5];
        let ext_suffix = match ext_code {
            5 => " (Forced)",
            9 | 10 => " (SDH)",
            13 | 14 => " (Commentary)",
            _ => "",
        };
        subtitle_tracks.push(DvdSubtitleTrack {
            stream_index: i as u8,
            lang_code,
            lang_name: lang_name.clone(),
            label: format!("{lang_name}{ext_suffix}"),
        });
    }

    // 4. Program Chain (`VTS_PGCIT` at `0xCC`)
    let pgcit_sector = u32::from_be_bytes([
        vts_bytes[0xCC],
        vts_bytes[0xCD],
        vts_bytes[0xCE],
        vts_bytes[0xCF],
    ]) as usize;
    let pgcit_offset = pgcit_sector * DVD_SECTOR_SIZE;
    let mut duration_ms = 0u32;
    let mut chapters = Vec::new();
    let mut cell_spans = Vec::new();

    if pgcit_offset + 8 <= vts_bytes.len() {
        let num_pgcs =
            u16::from_be_bytes([vts_bytes[pgcit_offset], vts_bytes[pgcit_offset + 1]]) as usize;
        let mut target_pgc_offset: Option<usize> = None;

        for i in 0..num_pgcs.min(256) {
            let srp_off = pgcit_offset + 8 + i * 8;
            if srp_off + 8 > vts_bytes.len() {
                break;
            }
            let entry_id = vts_bytes[srp_off];
            let pgc_rel = u32::from_be_bytes([
                vts_bytes[srp_off + 4],
                vts_bytes[srp_off + 5],
                vts_bytes[srp_off + 6],
                vts_bytes[srp_off + 7],
            ]) as usize;
            if (entry_id & 0x80) != 0 && (entry_id & 0x7F) == vts_ttn {
                target_pgc_offset = Some(pgcit_offset + pgc_rel);
                break;
            }
            if target_pgc_offset.is_none() && i + 1 == (vts_ttn as usize) {
                target_pgc_offset = Some(pgcit_offset + pgc_rel);
            }
        }

        if let Some(pgc_off) = target_pgc_offset {
            if pgc_off + 0xEC <= vts_bytes.len() {
                // Map logical Audio Tracks (`0..8`) via PGC Audio Stream Control Table (`pgc_off + 0x0C`)
                for (idx, track) in audio_tracks.iter_mut().enumerate() {
                    let ctl_off = pgc_off + 0x0C + idx * 2;
                    if ctl_off + 2 <= vts_bytes.len() && (vts_bytes[ctl_off] & 0x80) != 0 {
                        track.stream_index = vts_bytes[ctl_off] & 0x07;
                    }
                }
                // Map logical Subtitle Tracks (`0..32`) via PGC Subpicture Stream Control Table (`pgc_off + 0x1C`)
                let is_wide = aspect_ratio == "16:9";
                for (idx, sub) in subtitle_tracks.iter_mut().enumerate() {
                    let ctl_off = pgc_off + 0x1C + idx * 4;
                    if ctl_off + 4 <= vts_bytes.len() && (vts_bytes[ctl_off] & 0x80) != 0 {
                        let s_43 = vts_bytes[ctl_off] & 0x1F;
                        let s_wide = vts_bytes[ctl_off + 1] & 0x1F;
                        sub.stream_index = if is_wide && (s_wide != 0 || idx == 0) {
                            s_wide
                        } else {
                            s_43
                        };
                    }
                }

                let num_programs = vts_bytes[pgc_off + 2] as usize;
                let num_cells = vts_bytes[pgc_off + 3] as usize;
                duration_ms = decode_dvd_bcd_time(&vts_bytes[pgc_off + 4..pgc_off + 8]);

                let pgmap_rel =
                    u16::from_be_bytes([vts_bytes[pgc_off + 0xE6], vts_bytes[pgc_off + 0xE7]])
                        as usize;
                let cpbit_rel =
                    u16::from_be_bytes([vts_bytes[pgc_off + 0xE8], vts_bytes[pgc_off + 0xE9]])
                        as usize;

                // Map starting cell index (1-based) to chapter number (1-based)
                let mut cell_to_chapter: HashMap<usize, u16> = HashMap::new();
                if pgmap_rel > 0 && pgc_off + pgmap_rel + num_programs <= vts_bytes.len() {
                    for prog_idx in 0..num_programs {
                        let start_cell = vts_bytes[pgc_off + pgmap_rel + prog_idx] as usize;
                        cell_to_chapter.insert(start_cell, (prog_idx + 1) as u16);
                    }
                }

                if cpbit_rel > 0 && pgc_off + cpbit_rel + num_cells * 24 <= vts_bytes.len() {
                    let mut running_ms = 0u32;
                    let mut current_chapter = 1u16;
                    for cell_idx in 0..num_cells {
                        let c_off = pgc_off + cpbit_rel + cell_idx * 24;
                        let cell_num = cell_idx + 1;
                        if let Some(&ch) = cell_to_chapter.get(&cell_num) {
                            current_chapter = ch;
                        }
                        let c_flags = vts_bytes[c_off];
                        // Skip secondary angle cells so multi-angle streams don't stutter/repeat
                        let block_mode = (c_flags >> 6) & 0x03;
                        let block_type = (c_flags >> 4) & 0x03;
                        if block_type == 1 && block_mode >= 2 {
                            continue;
                        }

                        let cell_dur_ms = decode_dvd_bcd_time(&vts_bytes[c_off + 4..c_off + 8]);
                        let first_sector = u32::from_be_bytes([
                            vts_bytes[c_off + 8],
                            vts_bytes[c_off + 9],
                            vts_bytes[c_off + 10],
                            vts_bytes[c_off + 11],
                        ]);
                        let last_sector = u32::from_be_bytes([
                            vts_bytes[c_off + 20],
                            vts_bytes[c_off + 21],
                            vts_bytes[c_off + 22],
                            vts_bytes[c_off + 23],
                        ]);

                        if last_sector >= first_sector {
                            cell_spans.push(DvdCellSectorSpan {
                                chapter_number: current_chapter,
                                start_ms: running_ms,
                                duration_ms: cell_dur_ms,
                                first_sector,
                                last_sector,
                            });
                        }
                        running_ms = running_ms.saturating_add(cell_dur_ms);
                    }

                    // Aggregate cell spans into Chapter summaries
                    for span in &cell_spans {
                        if let Some(last_ch) = chapters.last_mut() as Option<&mut DvdChapterInfo> {
                            if last_ch.chapter_number == span.chapter_number {
                                last_ch.duration_ms =
                                    last_ch.duration_ms.saturating_add(span.duration_ms);
                                continue;
                            }
                        }
                        chapters.push(DvdChapterInfo {
                            chapter_number: span.chapter_number,
                            start_ms: span.start_ms,
                            duration_ms: span.duration_ms,
                        });
                    }
                }
            }
        }
    }

    if chapters.is_empty() && fallback_chapters > 0 {
        let per_ch = if fallback_chapters > 0 {
            duration_ms / (fallback_chapters as u32)
        } else {
            duration_ms
        };
        for c in 1..=fallback_chapters {
            chapters.push(DvdChapterInfo {
                chapter_number: c,
                start_ms: ((c - 1) as u32) * per_ch,
                duration_ms: per_ch,
            });
        }
    }

    Some(ParsedDvdTitle {
        info: DvdTitleInfo {
            title_number,
            vts_number,
            vts_ttn,
            label: format!("Title {title_number}"),
            duration_ms,
            aspect_ratio,
            angles,
            chapters,
            audio_tracks,
            subtitle_tracks,
        },
        vob_base_lba,
        cell_spans,
    })
}

fn bcd_byte(b: u8) -> u32 {
    (((b >> 4) & 0x0F) as u32) * 10 + ((b & 0x0F) as u32)
}

/// Decodes a 4-byte DVD BCD playback time (`HH:MM:SS:FF`) into milliseconds.
pub fn decode_dvd_bcd_time(bcd: &[u8]) -> u32 {
    if bcd.len() < 4 {
        return 0;
    }
    let hours = bcd_byte(bcd[0]);
    let minutes = bcd_byte(bcd[1]);
    let seconds = bcd_byte(bcd[2]);
    let fps_code = (bcd[3] >> 6) & 0x03;
    let frames = (((bcd[3] >> 4) & 0x03) as u32) * 10 + ((bcd[3] & 0x0F) as u32);
    let frame_ms = match fps_code {
        1 => (frames * 1000) / 25,
        3 => (frames * 1000) / 30,
        _ => 0,
    };
    ((hours * 3600 + minutes * 60 + seconds) * 1000) + frame_ms
}

pub fn humanize_dvd_volume_label(raw_label: &str) -> String {
    let trimmed = raw_label.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("DVD_VIDEO") || trimmed.eq_ignore_ascii_case("DVDVIDEO") {
        return "DVD Video Disc".to_string();
    }
    let words: Vec<String> = trimmed
        .split(['_', '-', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let lower = w.to_lowercase();
            if matches!(lower.as_str(), "ii" | "iii" | "iv" | "vi" | "tv" | "ost" | "uk" | "us") {
                w.to_uppercase()
            } else {
                let mut chars = lower.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            }
        })
        .collect();
    if words.is_empty() {
        "DVD Video Disc".to_string()
    } else {
        words.join(" ")
    }
}

fn iso639_language_name(code: &str) -> String {
    match code {
        "en" => "English".to_string(),
        "ja" => "Japanese".to_string(),
        "es" => "Spanish".to_string(),
        "fr" => "French".to_string(),
        "de" => "German".to_string(),
        "it" => "Italian".to_string(),
        "pt" => "Portuguese".to_string(),
        "ru" => "Russian".to_string(),
        "ko" => "Korean".to_string(),
        "zh" => "Chinese".to_string(),
        "nl" => "Dutch".to_string(),
        "sv" => "Swedish".to_string(),
        "pl" => "Polish".to_string(),
        "und" | "" => "Audio Track".to_string(),
        other => other.to_uppercase(),
    }
}

// ============================================================================
// 3. On-Demand DVD Metadata & Poster Art Cache (`~/.cache/simp/dvd_cache.json`)
// ============================================================================

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
struct DvdArtCacheEntry {
    pub display_title: String,
    pub release_year: Option<i32>,
    pub art_url: Option<String>,
}

fn dvd_cache_file_path() -> PathBuf {
    crate::simp_data_dir().join("dvd_cache.json")
}

fn lookup_or_fetch_dvd_poster(disc: &mut ParsedDvdDisc, force_refresh: bool) {
    let cache_path = dvd_cache_file_path();
    let mut cache_map: HashMap<String, DvdArtCacheEntry> = fs::read_to_string(&cache_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    if !force_refresh {
        if let Some(cached) = cache_map.get(&disc.disc_id) {
            if !cached.display_title.is_empty() {
                disc.display_title = cached.display_title.clone();
            }
            disc.release_year = cached.release_year;
            disc.art_url = cached.art_url.clone();
            return;
        }
    }

    if disc.display_title == "DVD Video Disc" || disc.display_title.len() < 3 {
        return;
    }

    // Strip common disc suffixes (`Disc 1`, `D1`, `Widescreen`, `16x9`, `Vol 1`) when searching for poster art
    let search_term: String = disc
        .display_title
        .split_whitespace()
        .filter(|w| {
            let l = w.to_lowercase();
            !matches!(
                l.as_str(),
                "disc" | "disk" | "d1" | "d2" | "d3" | "d4" | "16x9" | "4x3" | "ws" | "fs" | "ntsc" | "pal"
            )
        })
        .collect::<Vec<_>>()
        .join(" ");

    if search_term.len() < 2 {
        return;
    }

    let encoded: String = search_term
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' => (b as char).to_string(),
            b' ' => "+".to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect();

    let url = format!(
        "https://itunes.apple.com/search?term={encoded}&media=movie&limit=3"
    );
    if let Ok(bytes) = crate::http_pool::http_get_bytes(&url, &[], None, 5)
    {
        if !bytes.is_empty() {
            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if let Some(first) = json
                    .get("results")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                {
                    if let Some(art) = first.get("artworkUrl100").and_then(|v| v.as_str()) {
                        disc.art_url = Some(art.replace("100x100bb", "600x600bb"));
                    }
                    if let Some(date) = first.get("releaseDate").and_then(|v| v.as_str()) {
                        if date.len() >= 4 {
                            disc.release_year = date[..4].parse::<i32>().ok();
                        }
                    }
                }
            }
        }
    }

    cache_map.insert(
        disc.disc_id.clone(),
        DvdArtCacheEntry {
            display_title: disc.display_title.clone(),
            release_year: disc.release_year,
            art_url: disc.art_url.clone(),
        },
    );
    if let Some(parent) = cache_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(serialized) = serde_json::to_string_pretty(&cache_map) {
        let _ = fs::write(&cache_path, serialized);
    }
}

/// Inspects `device_path` as a DVD-Video disc and returns an `OpticalDiscStatus` if valid.
pub fn scan_dvd_disc(device_path: &str, force_refresh: bool) -> Option<OpticalDiscStatus> {
    let mut parsed = parse_dvd_device(device_path).ok()?;
    lookup_or_fetch_dvd_poster(&mut parsed, force_refresh);

    let css_dll_available = find_libdvdcss_path().is_some();
    let vlc_available = find_vlc_binary().is_some();
    let css_available = css_dll_available || vlc_available;
    let ffmpeg_available = find_ffmpeg_binary().is_some();
    let dvd_titles: Vec<DvdTitleInfo> = parsed.titles.iter().map(|t| t.info.clone()).collect();

    let css_lib_hint = if cfg!(target_os = "windows") {
        "install VLC or place libdvdcss-2.dll in data\\lib\\"
    } else {
        "place libdvdcss.so.2 in ~/.local/share/simp/lib/"
    };
    let css_label = if css_dll_available {
        "CSS"
    } else {
        "VLC CSS"
    };
    let status_message = match (css_available, ffmpeg_available) {
        (true, true) => format!(
            "DVD-Video ready ({} title{}, {} + ffmpeg active)",
            dvd_titles.len(),
            if dvd_titles.len() == 1 { "" } else { "s" },
            css_label
        ),
        (false, true) => format!(
            "DVD-Video detected ({} title{}) — {} for encrypted discs",
            dvd_titles.len(),
            if dvd_titles.len() == 1 { "" } else { "s" },
            css_lib_hint
        ),
        (_, false) => "DVD-Video detected — install ffmpeg to enable video transcoding".to_string(),
    };

    Some(OpticalDiscStatus {
        drive_present: true,
        device_path: device_path.to_string(),
        disc_present: true,
        is_audio_cd: false,
        disc_id: Some(parsed.disc_id),
        album_title: parsed.display_title,
        artist_name: format!("DVD-Video ({})", parsed.volume_label),
        release_year: parsed.release_year,
        art_url: parsed.art_url,
        tracks: Vec::new(),
        status_message,
        is_dvd_video: true,
        dvd_css_available: css_available,
        dvd_ffmpeg_available: ffmpeg_available,
        dvd_titles,
    })
}

// ============================================================================
// 4. Live PGC Sector Streamer + `ffmpeg` Fragmented MP4 Transcode Pipeline
// ============================================================================

/// Extracts the 6-byte MPEG-2 Pack `SCR` and 5-byte PES `PTS` from the first video (`0xE0`)
/// or audio (`0xBD` / `0xC0`) packet in `buf` that carries a valid PTS.
/// Falls back to `PTS = 0` (`[0x21, 0x00, 0x01, 0x00, 0x01]`) if none is found.
fn extract_first_pes_scr_and_pts(buf: &[u8]) -> ([u8; 6], [u8; 5]) {
    let mut fallback_scr = [0x44, 0x00, 0x04, 0x00, 0x04, 0x01];
    for sector in buf.chunks_exact(DVD_SECTOR_SIZE) {
        if sector[0..4] != [0x00, 0x00, 0x01, 0xBA] {
            continue;
        }
        let mut scr = [0u8; 6];
        scr.copy_from_slice(&sector[4..10]);
        fallback_scr = scr;
        let stuffing = (sector[13] & 0x07) as usize;
        let mut pos = 14 + stuffing;
        while pos + 14 <= DVD_SECTOR_SIZE {
            if sector[pos] != 0x00 || sector[pos + 1] != 0x00 || sector[pos + 2] != 0x01 {
                break;
            }
            let stream_id = sector[pos + 3];
            let pes_len = u16::from_be_bytes([sector[pos + 4], sector[pos + 5]]) as usize;
            if pes_len == 0 {
                break;
            }
            if ((0xE0..=0xEF).contains(&stream_id)
                || stream_id == 0xBD
                || (0xC0..=0xDF).contains(&stream_id))
                && (sector[pos + 6] & 0xC0) == 0x80
                && (sector[pos + 7] & 0x80) != 0
                && sector[pos + 8] >= 5
            {
                let mut pts = [0u8; 5];
                pts.copy_from_slice(&sector[pos + 9..pos + 14]);
                return (scr, pts);
            }
            pos += 6 + pes_len;
        }
    }
    (fallback_scr, [0x21, 0x00, 0x01, 0x00, 0x01])
}

/// Builds a synthetic 2048-byte MPEG-2 Pack containing a `PRIVATE_STREAM_1` (`0xBD`) PES packet
/// for DVD subtitle substream `0x20` (`0:s:0`) stamped with the exact `SCR` and 5-byte `PTS`
/// of the first VOBU in the stream.
///
/// Why a valid `PTS` (`PTS_DTS_flags = 0x80`) is required:
/// `fftools/ffmpeg_dec.c` (`process_subtitle`) discards any subtitle packet with `PTS == AV_NOPTS_VALUE`
/// ("Subtitle packets must have a pts"), which otherwise prevents `sub2video` from initializing pad 1
/// of `vf_overlay` when seeking or switching subtitles mid-chapter.
pub fn build_bootstrap_spu_sector(scr: [u8; 6], pts: [u8; 5]) -> [u8; DVD_SECTOR_SIZE] {
    let mut sector = [0u8; DVD_SECTOR_SIZE];
    // 14-byte MPEG-2 Pack Header (`00 00 01 BA`, matching VOBU SCR, mux_rate = 25200, stuffing = 0)
    sector[0..4].copy_from_slice(&[0x00, 0x00, 0x01, 0xBA]);
    sector[4..10].copy_from_slice(&scr);
    sector[10..14].copy_from_slice(&[0x01, 0x89, 0xC3, 0xF8]);

    // 25-byte `PRIVATE_STREAM_1` (`00 00 01 BD`) PES packet at offset 14:
    // - pes_len = 19 (`0x0013`: 3 bytes PES flags/hdr_len + 5 bytes PTS + 1 byte substream `0x20` + 10 bytes SPU)
    // - flags: `0x80, 0x80, 0x05` (MPEG-2 PES, PTS present, 5-byte header data)
    sector[14..23].copy_from_slice(&[0x00, 0x00, 0x01, 0xBD, 0x00, 0x13, 0x80, 0x80, 0x05]);
    sector[23..28].copy_from_slice(&pts);
    sector[28] = 0x20; // DVD subtitle substream 0 (`0:s:0`)
    // Valid 10-byte stop-display SPU (`spu_size = 10`, `dcsq_offset = 4`, `stm = 0`, `next = 4`, `STP_DSP = 0x02`, `END = 0xFF`)
    sector[29..39]
        .copy_from_slice(&[0x00, 0x0A, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x02, 0xFF]);

    // Fill remaining 2009 bytes (`39..2048`) with a standard MPEG-2 Padding Stream (`00 00 01 BE`)
    let pad_len = (DVD_SECTOR_SIZE - 39 - 6) as u16;
    sector[39..43].copy_from_slice(&[0x00, 0x00, 0x01, 0xBE]);
    sector[43..45].copy_from_slice(&pad_len.to_be_bytes());
    sector[45..].fill(0xFF);
    sector
}

/// Returns true if `sector` is a DVD VOBU NAV Pack (`00 00 01 BA` + `00 00 01 BB` System Header at offset 14)
/// or starts an MPEG-2 Video Sequence Header (`00 00 01 B3`).
fn is_vobu_nav_or_seq_sector(sector: &[u8]) -> bool {
    if sector.len() < DVD_SECTOR_SIZE || sector[0..4] != [0x00, 0x00, 0x01, 0xBA] {
        return false;
    }
    if sector[14..18] == [0x00, 0x00, 0x01, 0xBB] {
        return true;
    }
    sector[14..256].windows(4).any(|w| w == [0x00, 0x00, 0x01, 0xB3])
}

/// Normalizes 2048-byte DVD `.VOB` sectors in-place before writing to `ffmpeg_stdin`:
/// 1. Clears any residual PES scrambling flags (`sector[0x14] &= !0x30`) if a drive/library left bits set.
/// 2. Maps the user's selected DVD subtitle substream (`0x20 + sub_idx`, or its 4:3/16:9 pair) to `0x20` (`0:s:0`)
///    and converts all other subtitle substreams (`0x20..=0x3F`) into `0xBE` Padding Stream packets.
/// 3. Converts unselected audio substreams (`0x80..=0x8F`, `0xA0..=0xA7`) into `0xBE` Padding Stream
///    packets so the selected `audio_idx` is deterministically exposed as `0:a:0`.
pub fn normalize_dvd_sector_streams(
    buf: &mut [u8],
    audio_idx: u8,
    sub_candidates: &[u8],
    locked_sub_id: &mut Option<u8>,
) {
    for sector in buf.chunks_exact_mut(DVD_SECTOR_SIZE) {
        if sector[0..4] != [0x00, 0x00, 0x01, 0xBA] {
            continue;
        }
        sector[0x14] &= !0x30;
        let stuffing = (sector[13] & 0x07) as usize;
        let mut pos = 14 + stuffing;
        while pos + 6 <= DVD_SECTOR_SIZE {
            if sector[pos] != 0x00 || sector[pos + 1] != 0x00 || sector[pos + 2] != 0x01 {
                break;
            }
            let stream_id = sector[pos + 3];
            let pes_len = u16::from_be_bytes([sector[pos + 4], sector[pos + 5]]) as usize;
            if pes_len == 0 {
                break;
            }
            let next_pos = pos + 6 + pes_len;
            if stream_id == 0xBD {
                if pos + 9 < DVD_SECTOR_SIZE && (sector[pos + 6] & 0xC0) == 0x80 {
                    sector[pos + 6] &= !0x30;
                    let hdr_len = sector[pos + 8] as usize;
                    let sub_pos = pos + 9 + hdr_len;
                    if sub_pos < DVD_SECTOR_SIZE && sub_pos < next_pos {
                        let sub_id = sector[sub_pos];
                        if (0x20..=0x3F).contains(&sub_id) {
                            let phys_idx = sub_id & 0x1F;
                            if !sub_candidates.is_empty() {
                                let matches = if let Some(locked) = *locked_sub_id {
                                    phys_idx == locked
                                } else if sub_candidates.contains(&phys_idx) {
                                    *locked_sub_id = Some(phys_idx);
                                    true
                                } else {
                                    false
                                };
                                if matches {
                                    sector[sub_pos] = 0x20;
                                } else {
                                    sector[pos + 3] = 0xBE;
                                }
                            } else {
                                sector[pos + 3] = 0xBE;
                            }
                        } else if (0x80..=0x8F).contains(&sub_id)
                            || (0xA0..=0xA7).contains(&sub_id)
                        {
                            if (sub_id & 0x07) != (audio_idx & 0x07) {
                                sector[pos + 3] = 0xBE;
                            }
                        }
                    }
                }
            } else if (0xE0..=0xEF).contains(&stream_id) || (0xC0..=0xDF).contains(&stream_id) {
                if pos + 6 < DVD_SECTOR_SIZE {
                    sector[pos + 6] &= !0x30;
                }
                if (0xC0..=0xC7).contains(&stream_id) && (stream_id & 0x07) != (audio_idx & 0x07) {
                    sector[pos + 3] = 0xBE;
                }
            }
            pos = next_pos;
        }
    }
}

/// Uses an installed VLC binary (`vlc.exe` / `vlc`) in headless `dummy` mode to CSS-decrypt
/// `(device_path, title_number, start_chapter, seek_ms)` via `dvdsimple://` and relay the MPEG-PS
/// stream over a local loopback socket into `ffmpeg_stdin`.
fn stream_via_vlc_decryptor(
    vlc_bin: &std::path::Path,
    device_path: &str,
    title_number: u16,
    start_chapter: u16,
    seek_ms: Option<u32>,
    audio_stream_index: u8,
    subtitle_stream_index: Option<u8>,
    ffmpeg_stdin: &mut std::process::ChildStdin,
) -> bool {
    let Ok(listener) = std::net::TcpListener::bind("127.0.0.1:0") else {
        return false;
    };
    let Ok(addr) = listener.local_addr() else {
        return false;
    };
    let port = addr.port();
    drop(listener);

    let ch_num = if seek_ms.unwrap_or(0) > 0 {
        1
    } else {
        start_chapter.max(1)
    };
    let mrl = if let Some(rest) = device_path.strip_prefix(r"\\.\") {
        let drive = rest.trim_end_matches('\\');
        format!("dvdsimple:///{drive}/#{title_number}:{ch_num}")
    } else if device_path.len() >= 2 && device_path.as_bytes()[1] == b':' {
        let drive = &device_path[..2];
        format!("dvdsimple:///{drive}/#{title_number}:{ch_num}")
    } else {
        format!("dvdsimple://{device_path}#{title_number}:{ch_num}")
    };

    let sout_arg = format!(
        "--sout=#standard{{access=http,mux=ps,dst=127.0.0.1:{port}/stream.mpg}}"
    );
    let mut vlc_args: Vec<String> = vec![
        "-I".to_string(),
        "dummy".to_string(),
        "--dummy-quiet".to_string(),
        "--no-video-title-show".to_string(),
        "--no-repeat".to_string(),
        "--play-and-exit".to_string(),
        format!("--audio-track={audio_stream_index}"),
    ];
    if let Some(sub_idx) = subtitle_stream_index {
        vlc_args.push(format!("--sub-track={sub_idx}"));
        vlc_args.push("--sout-spu".to_string());
    } else {
        vlc_args.push("--no-spu".to_string());
    }
    if let Some(ms) = seek_ms.filter(|&ms| ms > 0) {
        vlc_args.push(format!("--start-time={:.2}", (ms as f64) / 1000.0));
    }
    vlc_args.push(mrl);
    vlc_args.push(sout_arg);

    let mut vlc_cmd = Command::new(vlc_bin);
    vlc_cmd
        .args(&vlc_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::configure_background_command(&mut vlc_cmd);

    let Ok(mut vlc_child) = vlc_cmd.spawn() else {
        return false;
    };

    let mut spu_bootstrapped = false;
    let mut streamed_bytes = 0usize;
    let mut tcp_opt: Option<std::net::TcpStream> = None;
    for _ in 0..80 {
        if let Ok(Some(_)) = vlc_child.try_wait() {
            break;
        }
        if let Ok(mut stream) = std::net::TcpStream::connect(("127.0.0.1", port)) {
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(12)));
            if stream
                .write_all(b"GET /stream.mpg HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
                .is_ok()
            {
                let mut hdr_buf = [0u8; 4096];
                if let Ok(n) = stream.read(&mut hdr_buf) {
                    if n > 0 && hdr_buf[..n].starts_with(b"HTTP/1.") {
                        if let Some(pos) = hdr_buf[..n]
                            .windows(4)
                            .position(|w| w == b"\r\n\r\n")
                        {
                            let body_start = pos + 4;
                            if body_start < n {
                                let payload = &hdr_buf[body_start..n];
                                if subtitle_stream_index.is_some() && !spu_bootstrapped {
                                    let (scr, pts) = extract_first_pes_scr_and_pts(payload);
                                    let spu_sec = build_bootstrap_spu_sector(scr, pts);
                                    let _ = ffmpeg_stdin.write_all(&spu_sec);
                                    spu_bootstrapped = true;
                                }
                                if ffmpeg_stdin.write_all(payload).is_err() {
                                    let _ = vlc_child.kill();
                                    let _ = vlc_child.wait();
                                    return true;
                                }
                                streamed_bytes += payload.len();
                            }
                            tcp_opt = Some(stream);
                            break;
                        }
                    }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }

    if let Some(mut stream) = tcp_opt {
        let mut chunk = vec![0u8; 64 * 1024];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    if subtitle_stream_index.is_some() && !spu_bootstrapped {
                        let (scr, pts) = extract_first_pes_scr_and_pts(&chunk[..n]);
                        let spu_sec = build_bootstrap_spu_sector(scr, pts);
                        let _ = ffmpeg_stdin.write_all(&spu_sec);
                        spu_bootstrapped = true;
                    }
                    streamed_bytes += n;
                    if ffmpeg_stdin.write_all(&chunk[..n]).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    }

    let _ = vlc_child.kill();
    let _ = vlc_child.wait();
    streamed_bytes > 0
}

/// Spawns an `ffmpeg` fragmented MP4 (`video/mp4`) child process fed by a background thread
/// reading and CSS-decrypting the exact PGC sector spans for `(title_number, chapter_number, seek_ms)`.
pub fn spawn_dvd_title_mp4_stream(
    device_path: &str,
    title_number: u16,
    start_chapter: u16,
    audio_stream_index: u8,
    subtitle_stream_index: Option<u8>,
    seek_ms: Option<u32>,
) -> Result<Child> {
    let ffmpeg_bin = find_ffmpeg_binary()
        .ok_or_else(|| anyhow!("ffmpeg not found in ~/.local/share/simp/bin/ or PATH"))?;
    let parsed = parse_dvd_device(device_path)?;
    let target_title = parsed
        .titles
        .into_iter()
        .find(|t| t.info.title_number == title_number)
        .ok_or_else(|| anyhow!("DVD Title {title_number} not found on disc"))?;

    let mounted_vts_root = windows_mounted_drive_root(device_path).and_then(|r| {
        if r.join("VIDEO_TS").is_dir() {
            Some(r.join("VIDEO_TS"))
        } else if r.join("VIDEO_TS.IFO").is_file() {
            Some(r)
        } else {
            None
        }
    });

    if (target_title.vob_base_lba == 0 && mounted_vts_root.is_none())
        || target_title.cell_spans.is_empty()
    {
        return Err(anyhow!(
            "DVD Title {title_number} has no readable VTS VOB sector spans"
        ));
    }

    let mut args: Vec<String> = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-fflags".to_string(),
        "+genpts+discardcorrupt".to_string(),
        "-probesize".to_string(),
        "10M".to_string(),
        "-analyzeduration".to_string(),
        "10M".to_string(),
        "-f".to_string(),
        "mpeg".to_string(),
        "-i".to_string(),
        "pipe:0".to_string(),
        // Trim the ~350ms DVD VBV audio preload lead-in at the start of VOBUs so both
        // video and audio start at `tfdt = 0` in perfect lip-sync inside `empty_moov` fMP4
        "-ss".to_string(),
        "0.35".to_string(),
    ];

    if subtitle_stream_index.is_some() {
        args.push("-filter_complex".to_string());
        args.push(
            "[0:v:0]yadif=0:-1:1[v];[v][0:s:0]overlay=eof_action=pass:repeatlast=0[outv]"
                .to_string(),
        );
        args.push("-map".to_string());
        args.push("[outv]".to_string());
    } else {
        args.push("-vf".to_string());
        args.push("yadif=0:-1:1".to_string());
        args.push("-map".to_string());
        args.push("0:v:0".to_string());
    }

    args.extend([
        "-map".to_string(),
        "0:a:0?".to_string(),
        "-af".to_string(),
        "aresample=async=1000".to_string(),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "ultrafast".to_string(),
        "-tune".to_string(),
        "zerolatency".to_string(),
        "-g".to_string(),
        "48".to_string(),
        "-crf".to_string(),
        "20".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-ac".to_string(),
        "2".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        "-f".to_string(),
        "mp4".to_string(),
        "-movflags".to_string(),
        "frag_keyframe+empty_moov+default_base_moof".to_string(),
        "pipe:1".to_string(),
    ]);

    let mut cmd = Command::new(ffmpeg_bin);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::configure_background_command(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| anyhow!("Failed to spawn ffmpeg: {e}"))?;

    let Some(mut ffmpeg_stdin) = child.stdin.take() else {
        return Err(anyhow!("Failed to open ffmpeg stdin pipe"));
    };

    let dev_owned = device_path.to_string();
    let vob_base = target_title.vob_base_lba;
    let vts_num = target_title.info.vts_number;
    // Build candidate physical subtitle substreams (`sub_idx`, `sub_idx ^ 1` for 4:3/16:9 pairs)
    let sub_candidates: Vec<u8> = if let Some(s) = subtitle_stream_index {
        let base = s & 0x1F;
        let mut c = vec![base];
        // On 16:9 DVDs where each language has a 4:3 + 16:9 substream pair, allow adjacent pair fallback
        if target_title.info.subtitle_tracks.len() <= 8 {
            let alt = base ^ 1;
            if !target_title
                .info
                .subtitle_tracks
                .iter()
                .any(|t| t.stream_index == alt)
            {
                c.push(alt);
            }
        }
        c
    } else {
        Vec::new()
    };

    let mut spans: Vec<DvdCellSectorSpan> = if let Some(target_ms) = seek_ms.filter(|&ms| ms > 0) {
        let mut matched: Vec<DvdCellSectorSpan> = target_title
            .cell_spans
            .iter()
            .filter(|s| s.start_ms.saturating_add(s.duration_ms.max(1)) > target_ms)
            .cloned()
            .collect();
        if matched.is_empty() {
            if let Some(last) = target_title.cell_spans.last() {
                matched.push(last.clone());
            }
        }
        if let Some(first) = matched.first_mut() {
            let cell_offset_ms = target_ms.saturating_sub(first.start_ms);
            if cell_offset_ms > 0
                && first.duration_ms > 0
                && first.last_sector > first.first_sector
            {
                let total_sectors = (first.last_sector - first.first_sector) as u64;
                let skip_sectors =
                    ((cell_offset_ms as u64) * total_sectors) / (first.duration_ms as u64);
                first.first_sector = first
                    .first_sector
                    .saturating_add(skip_sectors as u32)
                    .min(first.last_sector);
            }
        }
        matched
    } else {
        target_title
            .cell_spans
            .into_iter()
            .filter(|s| s.chapter_number >= start_chapter.max(1))
            .collect()
    };
    if spans.is_empty() {
        return Err(anyhow!("No playable DVD cells matched the requested position"));
    }

    std::thread::spawn(move || {
        const CHUNK_SECTORS: usize = 32; // 64 KB per read
        let mut buf = vec![0u8; CHUNK_SECTORS * DVD_SECTOR_SIZE];
        let mut locked_sub_id: Option<u8> = None;

        if vob_base > 0 {
            if let Some(mut css) = DvdCssSession::open(&dev_owned) {
                let first_span_lba = vob_base.saturating_add(spans[0].first_sector);
                // Unlock VTS title CSS key ONCE at `vob_base` (with fallback to `first_span_lba`)
                if css.seek_sector(vob_base, true).is_err() {
                    let _ = css.seek_sector(first_span_lba, true);
                }
                let mut css_streamed_sectors = 0usize;
                let mut spu_bootstrapped = false;
                let mut aligned_to_vobu = false;
                let mut skipped_for_vobu = 0usize;
                let mut expected_next_lba: Option<u32> = None;
                let mut css_failed_at_start = false;

                for span in &spans {
                    let start_lba = vob_base.saturating_add(span.first_sector);
                    let end_lba = vob_base.saturating_add(span.last_sector);
                    // Only seek when non-contiguous (`expected_next_lba != Some(start_lba)`),
                    // and use `DVDCSS_SEEK_MPEG` (`unlock_key = false`) so `libdvdcss` never wipes
                    // the already-unlocked VTS Title Key during chapter transitions!
                    if expected_next_lba != Some(start_lba) {
                        if css.seek_sector(start_lba, false).is_err() {
                            break;
                        }
                    }
                    let mut cur = start_lba;
                    while cur <= end_lba {
                        let count = ((end_lba - cur + 1) as usize).min(CHUNK_SECTORS);
                        match css.read_sectors(&mut buf[..count * DVD_SECTOR_SIZE], count, true) {
                            Ok(n) if n > 0 => {
                                let byte_len = n * DVD_SECTOR_SIZE;
                                cur += n as u32;
                                expected_next_lba = Some(cur);

                                // Verify first read chunk isn't still CSS-scrambled (`0x14 & 0x30 != 0`)
                                if css_streamed_sectors == 0 && skipped_for_vobu == 0 {
                                    let still_scrambled = buf[..byte_len]
                                        .chunks_exact(DVD_SECTOR_SIZE)
                                        .any(|sec| {
                                            sec[0..4] == [0x00, 0x00, 0x01, 0xBA]
                                                && (sec[0x14] & 0x30) != 0
                                        });
                                    if still_scrambled {
                                        css_failed_at_start = true;
                                        break;
                                    }
                                }

                                // Align stream start (especially after `seek_ms`) to a DVD VOBU NAV Pack / Sequence Header
                                let mut write_start_off = 0usize;
                                if !aligned_to_vobu {
                                    if let Some(sec_idx) = buf[..byte_len]
                                        .chunks_exact(DVD_SECTOR_SIZE)
                                        .position(is_vobu_nav_or_seq_sector)
                                    {
                                        write_start_off = sec_idx * DVD_SECTOR_SIZE;
                                        aligned_to_vobu = true;
                                    } else if skipped_for_vobu + n < 192 {
                                        skipped_for_vobu += n;
                                        continue;
                                    } else {
                                        aligned_to_vobu = true;
                                    }
                                }

                                let slice = &mut buf[write_start_off..byte_len];
                                if slice.is_empty() {
                                    continue;
                                }

                                if !spu_bootstrapped {
                                    if !sub_candidates.is_empty() {
                                        let (scr, pts) = extract_first_pes_scr_and_pts(slice);
                                        let spu_sec = build_bootstrap_spu_sector(scr, pts);
                                        if ffmpeg_stdin.write_all(&spu_sec).is_err() {
                                            return;
                                        }
                                    }
                                    spu_bootstrapped = true;
                                }

                                normalize_dvd_sector_streams(
                                    slice,
                                    audio_stream_index,
                                    &sub_candidates,
                                    &mut locked_sub_id,
                                );
                                if ffmpeg_stdin.write_all(slice).is_err() {
                                    return;
                                }
                                css_streamed_sectors += slice.len() / DVD_SECTOR_SIZE;
                            }
                            _ => {
                                if css_streamed_sectors == 0 {
                                    css_failed_at_start = true;
                                }
                                break;
                            }
                        }
                    }
                    if css_failed_at_start {
                        break;
                    }
                }
                if css_streamed_sectors > 0 {
                    return;
                }
            }
        }

        // Fallback to VLC headless `dvdsimple://` decryptor when VLC is installed and no standalone `libdvdcss-2.dll` is present
        if let Some(vlc_bin) = find_vlc_binary() {
            if stream_via_vlc_decryptor(
                &vlc_bin,
                &dev_owned,
                title_number,
                start_chapter,
                seek_ms,
                audio_stream_index,
                subtitle_stream_index,
                &mut ffmpeg_stdin,
            ) {
                return;
            }
        }

        if vob_base > 0 {
            if let Ok(mut raw_file) = OpenOptions::new().read(true).open(&dev_owned) {
                // Fallback for unencrypted DVDs when libdvdcss is not present
                let mut streamed_any = false;
                let mut spu_bootstrapped = false;
                let mut aligned_to_vobu = false;
                let mut skipped_for_vobu = 0usize;
                for span in &spans {
                    let start_lba = vob_base.saturating_add(span.first_sector);
                    let end_lba = vob_base.saturating_add(span.last_sector);
                    if raw_file
                        .seek(SeekFrom::Start((start_lba as u64) * (DVD_SECTOR_SIZE as u64)))
                        .is_err()
                    {
                        break;
                    }
                    let mut cur = start_lba;
                    while cur <= end_lba {
                        let count = ((end_lba - cur + 1) as usize).min(CHUNK_SECTORS);
                        let byte_count = count * DVD_SECTOR_SIZE;
                        if raw_file.read_exact(&mut buf[..byte_count]).is_err() {
                            break;
                        }
                        cur += count as u32;

                        let mut write_start_off = 0usize;
                        if !aligned_to_vobu {
                            if let Some(sec_idx) = buf[..byte_count]
                                .chunks_exact(DVD_SECTOR_SIZE)
                                .position(is_vobu_nav_or_seq_sector)
                            {
                                write_start_off = sec_idx * DVD_SECTOR_SIZE;
                                aligned_to_vobu = true;
                            } else if skipped_for_vobu + count < 192 {
                                skipped_for_vobu += count;
                                continue;
                            } else {
                                aligned_to_vobu = true;
                            }
                        }
                        let slice = &mut buf[write_start_off..byte_count];
                        if !spu_bootstrapped {
                            if !sub_candidates.is_empty() {
                                let (scr, pts) = extract_first_pes_scr_and_pts(slice);
                                let spu_sec = build_bootstrap_spu_sector(scr, pts);
                                if ffmpeg_stdin.write_all(&spu_sec).is_err() {
                                    return;
                                }
                            }
                            spu_bootstrapped = true;
                        }
                        normalize_dvd_sector_streams(
                            slice,
                            audio_stream_index,
                            &sub_candidates,
                            &mut locked_sub_id,
                        );
                        streamed_any = true;
                        if ffmpeg_stdin.write_all(slice).is_err() {
                            return;
                        }
                    }
                }
                if streamed_any {
                    return;
                }
            }
        }

        // Mounted VIDEO_TS/VTS_XX_1..9.VOB fallback on Windows / mounted folders
        if let Some(vts_dir) = mounted_vts_root {
            let mut vob_parts: Vec<(PathBuf, u64, u64)> = Vec::new();
            let mut running_sectors = 0u64;
            for part in 1..=9u8 {
                let p = vts_dir.join(format!("VTS_{:02}_{}.VOB", vts_num, part));
                if let Ok(meta) = fs::metadata(&p) {
                    let sectors = meta.len() / (DVD_SECTOR_SIZE as u64);
                    if sectors > 0 {
                        vob_parts.push((p, running_sectors, running_sectors + sectors));
                        running_sectors += sectors;
                    }
                } else {
                    break;
                }
            }
            let mut spu_bootstrapped = false;
            let mut aligned_to_vobu = false;
            let mut skipped_for_vobu = 0usize;
            for span in &mut spans {
                let mut cur_sec = span.first_sector as u64;
                let end_sec = span.last_sector as u64;
                while cur_sec <= end_sec {
                    let Some((part_path, part_start, part_end)) = vob_parts
                        .iter()
                        .find(|(_, s, e)| cur_sec >= *s && cur_sec < *e)
                    else {
                        break;
                    };
                    let Ok(mut vf) = File::open(part_path) else {
                        break;
                    };
                    let rel_sec = cur_sec - *part_start;
                    if vf
                        .seek(SeekFrom::Start(rel_sec * (DVD_SECTOR_SIZE as u64)))
                        .is_err()
                    {
                        break;
                    }
                    let max_in_part = (*part_end - cur_sec).min(end_sec - cur_sec + 1);
                    let mut rem_in_part = max_in_part;
                    while rem_in_part > 0 {
                        let count = (rem_in_part as usize).min(CHUNK_SECTORS);
                        let byte_count = count * DVD_SECTOR_SIZE;
                        if vf.read_exact(&mut buf[..byte_count]).is_err() {
                            cur_sec = end_sec + 1;
                            break;
                        }
                        cur_sec += count as u64;
                        rem_in_part -= count as u64;

                        let mut write_start_off = 0usize;
                        if !aligned_to_vobu {
                            if let Some(sec_idx) = buf[..byte_count]
                                .chunks_exact(DVD_SECTOR_SIZE)
                                .position(is_vobu_nav_or_seq_sector)
                            {
                                write_start_off = sec_idx * DVD_SECTOR_SIZE;
                                aligned_to_vobu = true;
                            } else if skipped_for_vobu + count < 192 {
                                skipped_for_vobu += count;
                                continue;
                            } else {
                                aligned_to_vobu = true;
                            }
                        }
                        let slice = &mut buf[write_start_off..byte_count];
                        if !spu_bootstrapped {
                            if !sub_candidates.is_empty() {
                                let (scr, pts) = extract_first_pes_scr_and_pts(slice);
                                let spu_sec = build_bootstrap_spu_sector(scr, pts);
                                if ffmpeg_stdin.write_all(&spu_sec).is_err() {
                                    return;
                                }
                            }
                            spu_bootstrapped = true;
                        }
                        normalize_dvd_sector_streams(
                            slice,
                            audio_stream_index,
                            &sub_candidates,
                            &mut locked_sub_id,
                        );
                        if ffmpeg_stdin.write_all(slice).is_err() {
                            return;
                        }
                    }
                }
            }
        }
    });

    Ok(child)
}

/// Spawns an `ffmpeg` fragmented MP4 (`video/mp4`) child process that transcodes any local file
/// or remote HTTP/HTTPS video stream (such as legacy MPEG-4 Part 2, MPEG-2, AVI, MKV, or AC-3 audio)
/// into browser-native H.264 + AAC fMP4 on `stdout`.
pub fn spawn_generic_video_mp4_stream(
    input_source: &str,
    seek_ms: Option<u32>,
) -> Result<Child> {
    let ffmpeg_bin = find_ffmpeg_binary()
        .ok_or_else(|| anyhow!("ffmpeg not found in ~/.local/share/simp/bin/ or PATH"))?;
    let mut args: Vec<String> = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-fflags".to_string(),
        "+genpts+discardcorrupt".to_string(),
    ];
    if let Some(ms) = seek_ms.filter(|&m| m > 0) {
        args.push("-ss".to_string());
        args.push(format!("{:.3}", (ms as f64) / 1000.0));
    }
    if input_source.starts_with("http://") || input_source.starts_with("https://") {
        args.extend([
            "-reconnect".to_string(),
            "1".to_string(),
            "-reconnect_streamed".to_string(),
            "1".to_string(),
            "-reconnect_delay_max".to_string(),
            "5".to_string(),
        ]);
    }
    args.extend([
        "-i".to_string(),
        input_source.to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "0:a:0?".to_string(),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "ultrafast".to_string(),
        "-tune".to_string(),
        "zerolatency".to_string(),
        "-g".to_string(),
        "48".to_string(),
        "-crf".to_string(),
        "21".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-ac".to_string(),
        "2".to_string(),
        "-b:a".to_string(),
        "160k".to_string(),
        "-f".to_string(),
        "mp4".to_string(),
        "-movflags".to_string(),
        "frag_keyframe+empty_moov+default_base_moof".to_string(),
        "pipe:1".to_string(),
    ]);

    let mut cmd = Command::new(ffmpeg_bin);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::configure_background_command(&mut cmd);
    cmd.spawn()
        .map_err(|e| anyhow!("Failed to spawn ffmpeg video stream: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dvd_bcd_time_and_volume_label_humanizer() {
        // 01:38:24.15 @ 30fps (fps_code = 3 -> 0xC0 | 0x15 = 0xD5)
        let bcd = [0x01, 0x38, 0x24, 0xD5];
        let ms = decode_dvd_bcd_time(&bcd);
        assert_eq!(ms, (3600 + 38 * 60 + 24) * 1000 + 500);
        assert_eq!(
            humanize_dvd_volume_label("COWBOY_BEBOP_SESSION_1"),
            "Cowboy Bebop Session 1"
        );
    }

    #[test]
    fn test_synthetic_dvd_ifo_multi_episode_and_audio_subtitle_parser() {
        // Construct a synthetic VIDEO_TS.IFO with 2 24-minute episodes in VTS_01
        let mut vmg = vec![0u8; 2 * DVD_SECTOR_SIZE];
        vmg[0..12].copy_from_slice(b"DVDVIDEO-VMG");
        // TT_SRPT at sector 1
        vmg[0xC4..0xC8].copy_from_slice(&1u32.to_be_bytes());
        let tt_off = DVD_SECTOR_SIZE;
        vmg[tt_off..tt_off + 2].copy_from_slice(&2u16.to_be_bytes()); // 2 titles

        // Title 1: VTS 1, TTN 1, 2 chapters
        let t1 = tt_off + 8;
        vmg[t1 + 1] = 1; // 1 angle
        vmg[t1 + 2..t1 + 4].copy_from_slice(&2u16.to_be_bytes());
        vmg[t1 + 6] = 1; // VTS 1
        vmg[t1 + 7] = 1; // TTN 1

        // Title 2: VTS 1, TTN 2, 2 chapters
        let t2 = tt_off + 20;
        vmg[t2 + 1] = 1;
        vmg[t2 + 2..t2 + 4].copy_from_slice(&2u16.to_be_bytes());
        vmg[t2 + 6] = 1; // VTS 1
        vmg[t2 + 7] = 2; // TTN 2

        // Construct synthetic VTS_01_0.IFO
        let mut vts = vec![0u8; 3 * DVD_SECTOR_SIZE];
        vts[0..12].copy_from_slice(b"DVDVIDEO-VTS");
        vts[0xCC..0xD0].copy_from_slice(&1u32.to_be_bytes()); // VTS_PGCIT at sector 1
        vts[0x200] = 0x0C; // 16:9 aspect ratio
        vts[0x202..0x204].copy_from_slice(&2u16.to_be_bytes()); // 2 audio tracks
        // Audio 0: English AC-3 5.1
        vts[0x204] = 0x04; // AC-3 + has_lang
        vts[0x205] = 5; // 6 channels (5.1)
        vts[0x206..0x208].copy_from_slice(b"en");
        // Audio 1: Japanese AC-3 2.0
        vts[0x20C] = 0x04;
        vts[0x20D] = 1; // 2 channels (2.0)
        vts[0x20E..0x210].copy_from_slice(b"ja");

        // 1 Subtitle track: English
        vts[0x254..0x256].copy_from_slice(&1u16.to_be_bytes());
        vts[0x256] = 0x01;
        vts[0x258..0x25A].copy_from_slice(b"en");

        // VTS_PGCIT at sector 1 with 2 PGCs (24:10 and 24:15)
        let pgcit = DVD_SECTOR_SIZE;
        vts[pgcit..pgcit + 2].copy_from_slice(&2u16.to_be_bytes());
        // PGC 1 pointer (TTN 1) -> offset 0x100
        vts[pgcit + 8] = 0x81;
        vts[pgcit + 12..pgcit + 16].copy_from_slice(&0x100u32.to_be_bytes());
        // PGC 2 pointer (TTN 2) -> offset 0x300
        vts[pgcit + 16] = 0x82;
        vts[pgcit + 20..pgcit + 24].copy_from_slice(&0x300u32.to_be_bytes());

        for (pgc_rel, bcd_sec) in [(0x100usize, 0x10u8), (0x300usize, 0x15u8)] {
            let p = pgcit + pgc_rel;
            vts[p + 2] = 1; // 1 program
            vts[p + 3] = 1; // 1 cell
            vts[p + 4..p + 8].copy_from_slice(&[0x00, 0x24, bcd_sec, 0xC0]); // 00:24:XX.00
            vts[p + 0xE6..p + 0xE8].copy_from_slice(&0xECu16.to_be_bytes());
            vts[p + 0xE8..p + 0xEA].copy_from_slice(&0xF0u16.to_be_bytes());
            vts[p + 0xEC] = 1; // Program 1 starts at cell 1
            let cell = p + 0xF0;
            vts[cell + 4..cell + 8].copy_from_slice(&[0x00, 0x24, bcd_sec, 0xC0]);
            vts[cell + 8..cell + 12].copy_from_slice(&0u32.to_be_bytes());
            vts[cell + 20..cell + 24].copy_from_slice(&500u32.to_be_bytes());
        }

        let parsed = parse_dvd_ifo_tables("FUTURAMA_VOL_1_D1", &vmg, |_vts_num| {
            Some((vts.clone(), 400))
        })
        .expect("parse synthetic DVD IFO tables");

        assert_eq!(parsed.display_title, "Futurama Vol 1 D1");
        assert_eq!(parsed.titles.len(), 2);
        assert_eq!(parsed.titles[0].info.label, "Episode 1");
        assert_eq!(parsed.titles[1].info.label, "Episode 2");
        assert_eq!(parsed.titles[0].info.aspect_ratio, "16:9");
        assert_eq!(parsed.titles[0].info.audio_tracks.len(), 2);
        assert_eq!(
            parsed.titles[0].info.audio_tracks[0].label,
            "English (AC-3 5.1)"
        );
        assert_eq!(
            parsed.titles[0].info.audio_tracks[1].label,
            "Japanese (AC-3 2.0)"
        );
        assert_eq!(parsed.titles[0].info.subtitle_tracks.len(), 1);
        assert_eq!(parsed.titles[0].info.subtitle_tracks[0].label, "English");
    }
}
