use crate::library::db::LibraryDatabase;
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rodio::{source::SeekError as RodioSeekError, Source};
use sha1::{Digest, Sha1};
use simp_protocol::{OpticalDiscStatus, TrackMetadata};
use std::fs::OpenOptions;
#[cfg(target_os = "linux")]
use std::os::unix::fs::OpenOptionsExt;
#[cfg(target_os = "linux")]
use std::os::unix::io::AsRawFd;
#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;
#[cfg(not(target_os = "windows"))]
use std::path::Path;
use std::time::Duration;

// Linux <linux/cdrom.h> ioctl constants & structures
#[cfg(target_os = "linux")]
const CDROMREADTOCHDR: libc::Ioctl = 0x5305;
#[cfg(target_os = "linux")]
const CDROMREADTOCENTRY: libc::Ioctl = 0x5306;
#[cfg(target_os = "linux")]
const CDROMEJECT: libc::Ioctl = 0x5309;
#[cfg(target_os = "linux")]
const CDROMREADAUDIO: libc::Ioctl = 0x530e;
#[cfg(target_os = "linux")]
const CDROM_DRIVE_STATUS: libc::Ioctl = 0x5326;
#[cfg(target_os = "linux")]
const CDROM_DISC_STATUS: libc::Ioctl = 0x5327;

#[cfg(target_os = "linux")]
const CDROM_LBA: u8 = 0x01;
#[cfg(target_os = "linux")]
const CDROM_MSF: u8 = 0x02;
#[cfg(target_os = "linux")]
const CDROM_LEADOUT: u8 = 0xAA;

#[cfg(target_os = "linux")]
const CDS_NO_INFO: libc::c_int = 0;
#[cfg(target_os = "linux")]
const CDS_NO_DISC: libc::c_int = 1;
#[cfg(target_os = "linux")]
const CDS_TRAY_OPEN: libc::c_int = 2;
#[cfg(target_os = "linux")]
const CDS_DRIVE_NOT_READY: libc::c_int = 3;
#[cfg(target_os = "linux")]
const CDS_DISC_OK: libc::c_int = 4;

const CDS_AUDIO: libc::c_int = 100;
const CDS_MIXED: libc::c_int = 105;

const CD_FRAMESIZE_RAW: usize = 2352; // 588 stereo 16-bit samples per sector (1/75th sec)
const CD_SECTORS_PER_SECOND: u32 = 75;
const READ_CHUNK_SECTORS: i32 = 25; // ~333ms per ioctl read chunk

#[cfg(target_os = "linux")]
#[repr(C)]
#[derive(Debug, Default, Clone, Copy)]
struct CdromTochdr {
    cdth_trk0: u8,
    cdth_trk1: u8,
}

#[cfg(target_os = "linux")]
#[repr(C)]
#[derive(Clone, Copy)]
struct CdromMsf0 {
    minute: u8,
    second: u8,
    frame: u8,
}

#[cfg(target_os = "linux")]
#[repr(C)]
#[derive(Clone, Copy)]
union CdromAddr {
    msf: CdromMsf0,
    lba: libc::c_int,
}

#[cfg(target_os = "linux")]
#[repr(C)]
#[derive(Clone, Copy)]
struct CdromTocentry {
    cdte_track: u8,
    cdte_adr_ctrl: u8,
    cdte_format: u8,
    cdte_addr: CdromAddr,
    cdte_datamode: u8,
}

#[cfg(target_os = "linux")]
#[repr(C)]
struct CdromReadAudio {
    addr: CdromAddr,
    addr_format: u8,
    nframes: libc::c_int,
    buf: *mut u8,
}

#[derive(Clone, Debug)]
pub struct CdTrackTocEntry {
    pub track_number: u8,
    pub start_lba: i32,
    pub length_sectors: i32,
    pub is_data_track: bool,
}

#[derive(Clone, Debug)]
pub struct CdToc {
    pub first_track: u8,
    pub last_track: u8,
    pub leadout_lba: i32,
    pub tracks: Vec<CdTrackTocEntry>,
    pub disc_id: String,
    pub mb_toc_param: String,
}

/// Discovers the first present optical drive device node (`/dev/sr0`..`/dev/sr3` on Linux,
/// or `\\.\D:`..`\\.\Z:` via `GetDriveTypeW == DRIVE_CDROM` on Windows).
pub fn find_optical_device(preferred: Option<&str>) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        extern "system" {
            fn GetDriveTypeW(lp_root_path_name: *const u16) -> u32;
        }
        const DRIVE_CDROM: u32 = 5;

        let is_cdrom_letter = |ch: char| -> bool {
            let upper = ch.to_ascii_uppercase();
            let root_wide: [u16; 4] = [upper as u16, b':' as u16, b'\\' as u16, 0];
            unsafe { GetDriveTypeW(root_wide.as_ptr()) == DRIVE_CDROM }
        };

        if let Some(pref) = preferred {
            let trimmed = pref.trim();
            if !trimmed.is_empty() && !trimmed.starts_with("/dev/") {
                let candidate_letter = if let Some(rest) = trimmed.strip_prefix(r"\\.\") {
                    rest.chars().next()
                } else {
                    trimmed.chars().next()
                };
                if let Some(ch) = candidate_letter {
                    if ch.is_ascii_alphabetic() && is_cdrom_letter(ch) {
                        let upper = ch.to_ascii_uppercase();
                        return Some(format!(r"\\.\{upper}:"));
                    }
                }
            }
        }

        for letter in b'C'..=b'Z' {
            let ch = letter as char;
            if is_cdrom_letter(ch) {
                return Some(format!(r"\\.\{ch}:"));
            }
        }
        return None;
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(pref) = preferred {
            if !pref.trim().is_empty() && Path::new(pref.trim()).exists() {
                return Some(pref.trim().to_string());
            }
        }
        for candidate in ["/dev/sr0", "/dev/sr1", "/dev/sr2", "/dev/sr3", "/dev/cdrom"] {
            if Path::new(candidate).exists() {
                return Some(candidate.to_string());
            }
        }
        None
    }
}

/// Computes the official MusicBrainz DiscID (`base64` with `+ -> .`, `/ -> _`, `= -> -` over `SHA-1`
/// of uppercase hex `first_track`, `last_track`, and 100 track frame offsets with `+150` sector lead-in).
pub fn compute_musicbrainz_disc_id(
    first_track: u8,
    last_track: u8,
    leadout_lba: i32,
    track_lbas: &[i32],
) -> (String, String) {
    let mut sha = Sha1::new();
    sha.update(format!("{:02X}", first_track).as_bytes());
    sha.update(format!("{:02X}", last_track).as_bytes());

    let leadout_sectors = (leadout_lba + 150).max(0) as u32;
    sha.update(format!("{:08X}", leadout_sectors).as_bytes());

    let mut toc_parts = vec![
        first_track.to_string(),
        last_track.to_string(),
        leadout_sectors.to_string(),
    ];

    for i in 0..99usize {
        let sector_offset = if i < track_lbas.len() {
            (track_lbas[i] + 150).max(0) as u32
        } else {
            0u32
        };
        if i < track_lbas.len() {
            toc_parts.push(sector_offset.to_string());
        }
        sha.update(format!("{:08X}", sector_offset).as_bytes());
    }

    let digest = sha.finalize();
    let b64 = BASE64_STANDARD.encode(digest);
    let mb_disc_id: String = b64
        .chars()
        .map(|c| match c {
            '+' => '.',
            '/' => '_',
            '=' => '-',
            other => other,
        })
        .collect();

    (mb_disc_id, toc_parts.join("+"))
}

#[cfg(target_os = "windows")]
mod win_cdrom {
    use super::*;
    use std::ffi::c_void;
    use std::ptr::null_mut;

    pub const IOCTL_CDROM_READ_TOC: u32 = 0x00024000;
    pub const IOCTL_CDROM_RAW_READ: u32 = 0x0002403E;
    pub const IOCTL_STORAGE_CHECK_VERIFY: u32 = 0x002D4800;
    pub const IOCTL_STORAGE_CHECK_VERIFY2: u32 = 0x002D0800;
    pub const IOCTL_STORAGE_EJECT_MEDIA: u32 = 0x002D4808;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct WinTrackData {
        pub reserved: u8,
        pub control_adr: u8,
        pub track_number: u8,
        pub reserved1: u8,
        pub address: [u8; 4],
    }

    #[repr(C)]
    pub struct WinCdromToc {
        pub length: [u8; 2],
        pub first_track: u8,
        pub last_track: u8,
        pub track_data: [WinTrackData; 100],
    }

    #[repr(C)]
    pub struct WinRawReadInfo {
        pub disk_offset: i64,
        pub sector_count: u32,
        pub track_mode: u32,
    }

    #[link(name = "kernel32")]
    extern "system" {
        pub fn DeviceIoControl(
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

    pub fn msf_to_lba(addr: [u8; 4]) -> i32 {
        let m = addr[1] as i32;
        let s = addr[2] as i32;
        let f = addr[3] as i32;
        (m * 60 + s) * 75 + f - 150
    }

    pub fn check_disc_present(file: &std::fs::File, device_path: &str) -> bool {
        let handle = file.as_raw_handle() as *mut c_void;
        let mut bytes_ret = 0u32;
        let ok2 = unsafe {
            DeviceIoControl(
                handle,
                IOCTL_STORAGE_CHECK_VERIFY2,
                null_mut(),
                0,
                null_mut(),
                0,
                &mut bytes_ret,
                null_mut(),
            )
        };
        if ok2 != 0 {
            return true;
        }
        let ok1 = unsafe {
            DeviceIoControl(
                handle,
                IOCTL_STORAGE_CHECK_VERIFY,
                null_mut(),
                0,
                null_mut(),
                0,
                &mut bytes_ret,
                null_mut(),
            )
        };
        if ok1 != 0 {
            return true;
        }
        // Fallback: if Windows mounted a data/DVD filesystem at `<Drive>:\`, check if `<Drive>:\` is readable
        let drive_letter = device_path
            .strip_prefix(r"\\.\")
            .unwrap_or(device_path)
            .chars()
            .next();
        if let Some(ch) = drive_letter {
            if ch.is_ascii_alphabetic() {
                let root = format!("{ch}:\\");
                if std::fs::read_dir(&root).is_ok() {
                    return true;
                }
            }
        }
        false
    }
}

/// Reads the Table of Contents (TOC) from a Windows optical drive (`\\.\D:`) via `IOCTL_CDROM_READ_TOC`.
#[cfg(target_os = "windows")]
pub fn read_cd_toc(device_path: &str) -> Result<CdToc> {
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use win_cdrom::*;

    let file = OpenOptions::new()
        .read(true)
        .open(device_path)
        .map_err(|e| anyhow!("Cannot open optical drive {device_path}: {e}"))?;
    let handle = file.as_raw_handle() as *mut c_void;

    let mut toc: WinCdromToc = unsafe { std::mem::zeroed() };
    let mut bytes_ret = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            handle,
            IOCTL_CDROM_READ_TOC,
            null_mut(),
            0,
            &mut toc as *mut WinCdromToc as *mut c_void,
            std::mem::size_of::<WinCdromToc>() as u32,
            &mut bytes_ret,
            null_mut(),
        )
    };
    if ok == 0 {
        return Err(anyhow!(
            "Failed to read CD TOC from {device_path}: {}",
            std::io::Error::last_os_error()
        ));
    }

    let first_track = toc.first_track;
    let last_track = toc.last_track;
    if first_track == 0 || last_track < first_track || last_track > 99 {
        return Err(anyhow!(
            "Invalid track range in CD TOC ({first_track}..{last_track})"
        ));
    }

    let count = (last_track - first_track + 1) as usize;
    let mut raw_entries: Vec<(u8, i32, bool)> = Vec::with_capacity(count);
    for i in 0..count {
        let td = toc.track_data[i];
        let lba = msf_to_lba(td.address);
        let is_data = (td.control_adr & 0x04) != 0;
        raw_entries.push((td.track_number, lba, is_data));
    }

    let leadout_td = toc.track_data[count];
    let leadout_lba = msf_to_lba(leadout_td.address);

    let mut tracks = Vec::with_capacity(raw_entries.len());
    let mut audio_track_lbas = Vec::with_capacity(raw_entries.len());
    let mut last_audio_track = first_track;
    let mut audio_leadout_lba = leadout_lba;

    for i in 0..raw_entries.len() {
        let (trk_num, start_lba, is_data) = raw_entries[i];
        let next_lba = if i + 1 < raw_entries.len() {
            raw_entries[i + 1].1
        } else {
            leadout_lba
        };
        let length_sectors = (next_lba - start_lba).max(0);
        if !is_data {
            audio_track_lbas.push(start_lba);
            last_audio_track = trk_num;
            audio_leadout_lba = next_lba;
        }
        tracks.push(CdTrackTocEntry {
            track_number: trk_num,
            start_lba,
            length_sectors,
            is_data_track: is_data,
        });
    }

    let (disc_id, mb_toc_param) = compute_musicbrainz_disc_id(
        first_track,
        last_audio_track,
        audio_leadout_lba,
        &audio_track_lbas,
    );

    Ok(CdToc {
        first_track,
        last_track,
        leadout_lba,
        tracks,
        disc_id,
        mb_toc_param,
    })
}

/// Reads the Table of Contents (TOC) from an optical drive via Linux `ioctl` without requiring `sudo`.
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub fn read_cd_toc(device_path: &str) -> Result<CdToc> {
    Err(anyhow!(
        "Direct optical CD-DA TOC ioctl is not supported on this platform ({device_path})"
    ))
}

/// Reads the Table of Contents (TOC) from an optical drive via Linux `ioctl` without requiring `sudo`.
#[cfg(target_os = "linux")]
pub fn read_cd_toc(device_path: &str) -> Result<CdToc> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(device_path)
        .map_err(|e| anyhow!("Cannot open optical drive {device_path}: {e}"))?;
    let fd = file.as_raw_fd();

    let mut hdr = CdromTochdr::default();
    let res = unsafe { libc::ioctl(fd, CDROMREADTOCHDR, &mut hdr) };
    if res < 0 {
        return Err(anyhow!(
            "Failed to read CD TOC header from {device_path}: {}",
            std::io::Error::last_os_error()
        ));
    }

    let first_track = hdr.cdth_trk0;
    let last_track = hdr.cdth_trk1;
    if first_track == 0 || last_track < first_track || last_track > 99 {
        return Err(anyhow!(
            "Invalid track range in CD TOC ({first_track}..{last_track})"
        ));
    }

    let mut raw_entries: Vec<(u8, i32, bool)> =
        Vec::with_capacity((last_track - first_track + 1) as usize);
    for trk in first_track..=last_track {
        let mut entry = CdromTocentry {
            cdte_track: trk,
            cdte_adr_ctrl: 0,
            cdte_format: CDROM_LBA,
            cdte_addr: CdromAddr { lba: 0 },
            cdte_datamode: 0,
        };
        let r = unsafe { libc::ioctl(fd, CDROMREADTOCENTRY, &mut entry) };
        if r < 0 {
            return Err(anyhow!(
                "Failed to read CD TOC entry for track {trk}: {}",
                std::io::Error::last_os_error()
            ));
        }
        let lba = unsafe { entry.cdte_addr.lba };
        // Upper nibble of `cdte_adr_ctrl` on little-endian x86_64 bitfield (`adr:4, ctrl:4`)
        // Bit 2 (0x04) of `ctrl` indicates a Data track (`CDROM_DATA_TRACK`).
        let ctrl = (entry.cdte_adr_ctrl >> 4) & 0x0F;
        let is_data = (ctrl & 0x04) != 0;
        raw_entries.push((trk, lba, is_data));
    }

    // Lead-out track (0xAA)
    let mut leadout_entry = CdromTocentry {
        cdte_track: CDROM_LEADOUT,
        cdte_adr_ctrl: 0,
        cdte_format: CDROM_LBA,
        cdte_addr: CdromAddr { lba: 0 },
        cdte_datamode: 0,
    };
    let r = unsafe { libc::ioctl(fd, CDROMREADTOCENTRY, &mut leadout_entry) };
    if r < 0 {
        return Err(anyhow!(
            "Failed to read CD lead-out TOC entry: {}",
            std::io::Error::last_os_error()
        ));
    }
    let leadout_lba = unsafe { leadout_entry.cdte_addr.lba };

    let mut tracks = Vec::with_capacity(raw_entries.len());
    let mut audio_track_lbas = Vec::with_capacity(raw_entries.len());
    let mut last_audio_track = first_track;
    let mut audio_leadout_lba = leadout_lba;

    for i in 0..raw_entries.len() {
        let (trk_num, start_lba, is_data) = raw_entries[i];
        let next_lba = if i + 1 < raw_entries.len() {
            raw_entries[i + 1].1
        } else {
            leadout_lba
        };
        let length_sectors = (next_lba - start_lba).max(0);
        if !is_data {
            audio_track_lbas.push(start_lba);
            last_audio_track = trk_num;
            audio_leadout_lba = next_lba;
        }
        tracks.push(CdTrackTocEntry {
            track_number: trk_num,
            start_lba,
            length_sectors,
            is_data_track: is_data,
        });
    }

    let (disc_id, mb_toc_param) = compute_musicbrainz_disc_id(
        first_track,
        last_audio_track,
        audio_leadout_lba,
        &audio_track_lbas,
    );

    Ok(CdToc {
        first_track,
        last_track,
        leadout_lba,
        tracks,
        disc_id,
        mb_toc_param,
    })
}

/// Scans an optical drive on-demand (invoked only when the user opens Sources / CD view or clicks Scan).
/// Resolves track titles and album cover art via MusicBrainz + Cover Art Archive and caches by `disc_id` in SQLite.
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub fn scan_optical_disc(
    _db: &LibraryDatabase,
    preferred_device: Option<&str>,
    _force_refresh: bool,
) -> OpticalDiscStatus {
    OpticalDiscStatus {
        drive_present: false,
        device_path: preferred_device.unwrap_or("/dev/sr0").to_string(),
        disc_present: false,
        is_audio_cd: false,
        disc_id: None,
        album_title: String::new(),
        artist_name: String::new(),
        release_year: None,
        art_url: None,
        tracks: Vec::new(),
        status_message: "Direct optical CD-DA drive scanning is not supported on this platform".to_string(),
        ..Default::default()
    }
}

/// Scans an optical drive on-demand (invoked only when the user opens Sources / CD view or clicks Scan).
/// Resolves track titles and album cover art via MusicBrainz + Cover Art Archive and caches by `disc_id` in SQLite.
#[cfg(any(target_os = "linux", target_os = "windows"))]
pub fn scan_optical_disc(
    db: &LibraryDatabase,
    preferred_device: Option<&str>,
    force_refresh: bool,
) -> OpticalDiscStatus {
    let default_dev = if cfg!(target_os = "windows") {
        r"\\.\D:"
    } else {
        "/dev/sr0"
    };
    let Some(device_path) = find_optical_device(preferred_device) else {
        return OpticalDiscStatus {
            drive_present: false,
            device_path: default_dev.to_string(),
            disc_present: false,
            is_audio_cd: false,
            disc_id: None,
            album_title: String::new(),
            artist_name: String::new(),
            release_year: None,
            art_url: None,
            tracks: Vec::new(),
            status_message: format!("No optical drive ({default_dev}) connected"),
            ..Default::default()
        };
    };

    #[cfg(target_os = "windows")]
    let disc_status: libc::c_int = {
        let file = match OpenOptions::new().read(true).open(&device_path) {
            Ok(f) => f,
            Err(e) => {
                return OpticalDiscStatus {
                    drive_present: true,
                    device_path,
                    disc_present: false,
                    is_audio_cd: false,
                    disc_id: None,
                    album_title: String::new(),
                    artist_name: String::new(),
                    release_year: None,
                    art_url: None,
                    tracks: Vec::new(),
                    status_message: format!("Optical drive busy or inaccessible ({e})"),
                    ..Default::default()
                };
            }
        };
        if !win_cdrom::check_disc_present(&file, &device_path) {
            return OpticalDiscStatus {
                drive_present: true,
                device_path,
                disc_present: false,
                is_audio_cd: false,
                disc_id: None,
                album_title: String::new(),
                artist_name: String::new(),
                release_year: None,
                art_url: None,
                tracks: Vec::new(),
                status_message: "Drive ready — No disc inserted".to_string(),
                ..Default::default()
            };
        }
        101 // Non-zero disc status so DVD fallback can run if TOC is not an Audio CD
    };

    #[cfg(target_os = "linux")]
    let disc_status: libc::c_int = {
        let file = match OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NONBLOCK)
            .open(&device_path)
        {
            Ok(f) => f,
            Err(e) => {
                return OpticalDiscStatus {
                    drive_present: true,
                    device_path,
                    disc_present: false,
                    is_audio_cd: false,
                    disc_id: None,
                    album_title: String::new(),
                    artist_name: String::new(),
                    release_year: None,
                    art_url: None,
                    tracks: Vec::new(),
                    status_message: format!("Optical drive busy or inaccessible ({e})"),
                    ..Default::default()
                };
            }
        };

        let fd = file.as_raw_fd();
        let drive_status = unsafe { libc::ioctl(fd, CDROM_DRIVE_STATUS, 0 as libc::c_int) };
        match drive_status {
            CDS_NO_DISC => {
                return OpticalDiscStatus {
                    drive_present: true,
                    device_path,
                    disc_present: false,
                    is_audio_cd: false,
                    disc_id: None,
                    album_title: String::new(),
                    artist_name: String::new(),
                    release_year: None,
                    art_url: None,
                    tracks: Vec::new(),
                    status_message: "Drive ready — No disc inserted".to_string(),
                    ..Default::default()
                };
            }
            CDS_TRAY_OPEN => {
                return OpticalDiscStatus {
                    drive_present: true,
                    device_path,
                    disc_present: false,
                    is_audio_cd: false,
                    disc_id: None,
                    album_title: String::new(),
                    artist_name: String::new(),
                    release_year: None,
                    art_url: None,
                    tracks: Vec::new(),
                    status_message: "Drive tray is open".to_string(),
                    ..Default::default()
                };
            }
            CDS_DRIVE_NOT_READY => {
                return OpticalDiscStatus {
                    drive_present: true,
                    device_path,
                    disc_present: false,
                    is_audio_cd: false,
                    disc_id: None,
                    album_title: String::new(),
                    artist_name: String::new(),
                    release_year: None,
                    art_url: None,
                    tracks: Vec::new(),
                    status_message: "Optical drive spinning up — reading disc...".to_string(),
                    ..Default::default()
                };
            }
            CDS_DISC_OK | CDS_NO_INFO | _ => {}
        }

        unsafe { libc::ioctl(fd, CDROM_DISC_STATUS, 0 as libc::c_int) }
    };

    // Check for DVD-Video (`VIDEO_TS/VIDEO_TS.IFO`) FIRST before `read_cd_toc`, because on Windows
    // `IOCTL_CDROM_READ_TOC` fabricates a 1-track TOC for DVDs that would otherwise be mistaken for a 1-track Audio CD.
    #[cfg(feature = "experimental-dvd")]
    if disc_status != CDS_AUDIO && disc_status != CDS_MIXED {
        if let Some(dvd_status) = crate::sinks::dvd::scan_dvd_disc(&device_path, force_refresh) {
            return dvd_status;
        }
    }

    let toc = match read_cd_toc(&device_path) {
        Ok(t) => t,
        Err(e) => {
            if disc_status > 0 && disc_status != CDS_AUDIO && disc_status != CDS_MIXED {
                #[cfg(feature = "experimental-dvd")]
                if let Some(dvd_status) =
                    crate::sinks::dvd::scan_dvd_disc(&device_path, force_refresh)
                {
                    return dvd_status;
                }
                return OpticalDiscStatus {
                    drive_present: true,
                    device_path,
                    disc_present: true,
                    is_audio_cd: false,
                    disc_id: None,
                    album_title: String::new(),
                    artist_name: String::new(),
                    release_year: None,
                    art_url: None,
                    tracks: Vec::new(),
                    status_message: "Data disc inserted (not an Audio CD)".to_string(),
                    ..Default::default()
                };
            }
            return OpticalDiscStatus {
                drive_present: true,
                device_path,
                disc_present: false,
                is_audio_cd: false,
                disc_id: None,
                album_title: String::new(),
                artist_name: String::new(),
                release_year: None,
                art_url: None,
                tracks: Vec::new(),
                status_message: format!("No readable Audio CD TOC ({e})"),
                ..Default::default()
            };
        }
    };

    let audio_tracks: Vec<&CdTrackTocEntry> =
        toc.tracks.iter().filter(|t| !t.is_data_track).collect();
    if audio_tracks.is_empty() {
        #[cfg(feature = "experimental-dvd")]
        if let Some(dvd_status) = crate::sinks::dvd::scan_dvd_disc(&device_path, force_refresh) {
            return dvd_status;
        }
        return OpticalDiscStatus {
            drive_present: true,
            device_path,
            disc_present: true,
            is_audio_cd: false,
            disc_id: Some(toc.disc_id),
            album_title: String::new(),
            artist_name: String::new(),
            release_year: None,
            art_url: None,
            tracks: Vec::new(),
            status_message: "Disc contains data tracks only (0 audio tracks)".to_string(),
            ..Default::default()
        };
    }

    // 1. Check SQLite `cd_cache` first unless `force_refresh` was requested
    if !force_refresh {
        if let Ok(Some((cached_album, cached_artist, mut cached_tracks, cached_art))) =
            db.get_cd_cache(&toc.disc_id)
        {
            if !cached_tracks.is_empty() {
                for t in &mut cached_tracks {
                    if let Some(num) = t.track_number {
                        t.uri = format!("cdda://{device_path}#track={num}");
                    }
                    if t.art_url.is_none() {
                        t.art_url = cached_art.clone();
                    }
                }
                return OpticalDiscStatus {
                    drive_present: true,
                    device_path,
                    disc_present: true,
                    is_audio_cd: true,
                    disc_id: Some(toc.disc_id),
                    album_title: cached_album,
                    artist_name: cached_artist,
                    release_year: None,
                    art_url: cached_art,
                    tracks: cached_tracks,
                    status_message: "Audio CD ready (cached MusicBrainz metadata)".to_string(),
                    ..Default::default()
                };
            }
        }
    }

    // 2. Build fallback generic tracklist in case offline or not in MusicBrainz
    let mut resolved_album = format!("Audio CD ({})", &toc.disc_id[..8.min(toc.disc_id.len())]);
    let mut resolved_artist = "Optical Audio CD".to_string();
    let mut resolved_year: Option<i32> = None;
    let mut resolved_art: Option<String> = None;
    let mut status_msg = "Audio CD ready (Generic TOC)".to_string();

    let mut tracks: Vec<TrackMetadata> = audio_tracks
        .iter()
        .map(|entry| {
            let duration_ms =
                ((entry.length_sectors.max(0) as u64 * 1000) / CD_SECTORS_PER_SECOND as u64) as u32;
            TrackMetadata {
                uri: format!("cdda://{device_path}#track={}", entry.track_number),
                title: format!("Track {:02}", entry.track_number),
                artists: vec![resolved_artist.clone()],
                album: resolved_album.clone(),
                album_id: Some(format!("cdda:{}", toc.disc_id)),
                track_number: Some(entry.track_number as u32),
                disc_number: Some(1),
                art_url: None,
                duration_ms,
                source: "cdda".to_string(),
                mount_root: Some(device_path.clone()),
            }
        })
        .collect();

    // 3. Query MusicBrainz JSON API + Cover Art Archive
    if let Some(mb) = fetch_musicbrainz_metadata(&toc.disc_id, &toc.mb_toc_param) {
        resolved_album = mb.album_title;
        resolved_artist = mb.artist_name;
        resolved_year = mb.release_year;
        resolved_art = mb.art_url;
        status_msg = "Audio CD ready (MusicBrainz + Cover Art Archive)".to_string();

        for (idx, trk) in tracks.iter_mut().enumerate() {
            trk.album = resolved_album.clone();
            trk.art_url = resolved_art.clone();
            if let Some((mb_title, mb_artists)) = mb.tracks.get(idx) {
                if !mb_title.trim().is_empty() {
                    trk.title = mb_title.clone();
                }
                if !mb_artists.is_empty() {
                    trk.artists = mb_artists.clone();
                } else {
                    trk.artists = vec![resolved_artist.clone()];
                }
            } else {
                trk.artists = vec![resolved_artist.clone()];
            }
        }

        let _ = db.upsert_cd_cache(
            &toc.disc_id,
            &resolved_album,
            &resolved_artist,
            &tracks,
            resolved_art.as_deref(),
        );
    }

    OpticalDiscStatus {
        drive_present: true,
        device_path,
        disc_present: true,
        is_audio_cd: true,
        disc_id: Some(toc.disc_id),
        album_title: resolved_album,
        artist_name: resolved_artist,
        release_year: resolved_year,
        art_url: resolved_art,
        tracks,
        status_message: status_msg,
        ..Default::default()
    }
}

/// Ejects the optical disc tray via `CDROMEJECT` (Linux) or `IOCTL_STORAGE_EJECT_MEDIA` (Windows).
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub fn eject_optical_disc(_preferred_device: Option<&str>) -> Result<String> {
    Err(anyhow!("No optical drive found"))
}

/// Ejects the optical disc tray via `IOCTL_STORAGE_EJECT_MEDIA` on Windows.
#[cfg(target_os = "windows")]
pub fn eject_optical_disc(preferred_device: Option<&str>) -> Result<String> {
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use win_cdrom::*;

    let Some(device_path) = find_optical_device(preferred_device) else {
        return Err(anyhow!("No optical drive found"));
    };
    let file = OpenOptions::new()
        .read(true)
        .open(&device_path)
        .map_err(|e| anyhow!("Cannot open optical drive {device_path}: {e}"))?;
    let handle = file.as_raw_handle() as *mut c_void;
    let mut bytes_ret = 0u32;
    unsafe {
        DeviceIoControl(
            handle,
            IOCTL_STORAGE_EJECT_MEDIA,
            null_mut(),
            0,
            null_mut(),
            0,
            &mut bytes_ret,
            null_mut(),
        );
    }
    Ok(device_path)
}

/// Ejects the optical disc tray via `CDROMEJECT` ioctl (or `eject` CLI fallback).
#[cfg(target_os = "linux")]
pub fn eject_optical_disc(preferred_device: Option<&str>) -> Result<String> {
    let Some(device_path) = find_optical_device(preferred_device) else {
        return Err(anyhow!("No optical drive found"));
    };
    if let Ok(file) = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(&device_path)
    {
        let fd = file.as_raw_fd();
        let r = unsafe { libc::ioctl(fd, CDROMEJECT, 0 as libc::c_int) };
        if r == 0 {
            return Ok(device_path);
        }
    }
    let _ = std::process::Command::new("eject")
        .arg(&device_path)
        .output();
    Ok(device_path)
}

struct MusicBrainzResolvedDisc {
    album_title: String,
    artist_name: String,
    release_year: Option<i32>,
    art_url: Option<String>,
    tracks: Vec<(String, Vec<String>)>,
}

fn fetch_musicbrainz_metadata(disc_id: &str, toc_param: &str) -> Option<MusicBrainzResolvedDisc> {
    let url = format!(
        "https://musicbrainz.org/ws/2/discid/{disc_id}?toc={toc_param}&fmt=json&inc=artists+recordings"
    );
    let bytes = crate::http_pool::http_get_bytes(
        &url,
        &[
            ("User-Agent", "SIMP/0.1.0-alpha (https://github.com/niiiitz/simp)"),
            ("Accept", "application/json"),
        ],
        None,
        6,
    )
    .ok()
    .filter(|b| !b.is_empty())?;

    let json: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let releases = json.get("releases")?.as_array()?;
    let release = releases.first()?;

    let release_id = release.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let album_title = release
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Audio CD")
        .to_string();

    let release_year = release
        .get("date")
        .and_then(|v| v.as_str())
        .and_then(|d| d.get(0..4))
        .and_then(|y| y.parse::<i32>().ok());

    let artist_name = extract_artist_credit(release.get("artist-credit"))
        .unwrap_or_else(|| "Unknown Artist".to_string());

    // Find the matching medium whose `discs` contains `disc_id` (or fall back to the first medium)
    let media_arr = release.get("media").and_then(|m| m.as_array());
    let chosen_medium = media_arr.and_then(|arr| {
        arr.iter()
            .find(|m| {
                m.get("discs")
                    .and_then(|d| d.as_array())
                    .map(|discs| {
                        discs
                            .iter()
                            .any(|d| d.get("id").and_then(|id| id.as_str()) == Some(disc_id))
                    })
                    .unwrap_or(false)
            })
            .or_else(|| arr.first())
    });

    let mut tracks_out = Vec::new();
    if let Some(medium) = chosen_medium {
        if let Some(trk_arr) = medium.get("tracks").and_then(|t| t.as_array()) {
            for t in trk_arr {
                let title = t
                    .get("title")
                    .and_then(|v| v.as_str())
                    .or_else(|| {
                        t.get("recording")
                            .and_then(|r| r.get("title"))
                            .and_then(|v| v.as_str())
                    })
                    .unwrap_or("Track")
                    .to_string();
                let trk_artist = extract_artist_credit(
                    t.get("artist-credit").or_else(|| {
                        t.get("recording").and_then(|r| r.get("artist-credit"))
                    }),
                )
                .map(|a| vec![a])
                .unwrap_or_else(|| vec![artist_name.clone()]);
                tracks_out.push((title, trk_artist));
            }
        }
    }

    // Download & cache front cover artwork from Cover Art Archive (`front-500`) if available
    let art_url = if !release_id.is_empty() {
        fetch_and_cache_cover_art(disc_id, release_id)
    } else {
        None
    };

    Some(MusicBrainzResolvedDisc {
        album_title,
        artist_name,
        release_year,
        art_url,
        tracks: tracks_out,
    })
}

fn extract_artist_credit(credit_val: Option<&serde_json::Value>) -> Option<String> {
    let arr = credit_val?.as_array()?;
    let mut out = String::new();
    for item in arr {
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .or_else(|| {
                item.get("artist")
                    .and_then(|a| a.get("name"))
                    .and_then(|v| v.as_str())
            })
            .unwrap_or("");
        let joinphrase = item.get("joinphrase").and_then(|v| v.as_str()).unwrap_or("");
        out.push_str(name);
        out.push_str(joinphrase);
    }
    if out.trim().is_empty() {
        None
    } else {
        Some(out.trim().to_string())
    }
}

fn fetch_and_cache_cover_art(disc_id: &str, release_mbid: &str) -> Option<String> {
    let art_cache_dir = crate::simp_art_cache_dir();
    let _ = std::fs::create_dir_all(&art_cache_dir);

    let safe_id: String = disc_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let filename = format!("cd_{safe_id}.jpg");
    let dest_path = art_cache_dir.join(&filename);

    if dest_path.is_file() && dest_path.metadata().map(|m| m.len() > 512).unwrap_or(false) {
        return Some(format!("http://127.0.0.1:18888/art/{filename}"));
    }

    let caa_url = format!("https://coverartarchive.org/release/{release_mbid}/front-500");
    if let Ok(bytes) = crate::http_pool::http_get_bytes(
        &caa_url,
        &[("User-Agent", "SIMP/0.1.0-alpha (https://github.com/niiiitz/simp)")],
        None,
        8,
    ) {
        if bytes.len() > 512 && std::fs::write(&dest_path, &bytes).is_ok() {
            return Some(format!("http://127.0.0.1:18888/art/{filename}"));
        }
    }
    None
}

/// Parses a `cdda:///dev/sr0#track=1` or `cdda://\\.\D:#track=1` URI into `(device_path, track_number)`.
pub fn parse_cdda_uri(uri: &str) -> Option<(String, u8)> {
    let rest = uri.strip_prefix("cdda://")?;
    let (dev_part, frag_part) = rest.split_once("#track=")?;
    let device_path = if dev_part.starts_with('/')
        || dev_part.starts_with(r"\\")
        || (dev_part.len() >= 2 && dev_part.as_bytes()[1] == b':')
    {
        dev_part.to_string()
    } else {
        format!("/{dev_part}")
    };
    let track_num: u8 = frag_part.trim().parse().ok()?;
    Some((device_path, track_num))
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
struct CddaTrackRamCache {
    /// Cached PCM sectors (`1176` stereo `i16` samples per sector), indexed by `(lba - start_lba)`.
    sectors: Vec<Option<std::sync::Arc<[i16]>>>,
    /// Current playback sector index (`0..total_sectors`), used to guide read-ahead priority.
    playback_sector: usize,
    /// Set by `try_seek` when the user jumps to an unbuffered sector so the reader prioritizes it.
    priority_sector: Option<usize>,
    /// True once all sectors in the track have been cached or an unrecoverable drive error occurred.
    finished: bool,
    /// True when `CddaTrackSource` is dropped so the background reader exits and closes the drive handle.
    cancelled: bool,
}

#[cfg(target_os = "windows")]
fn read_raw_cdda_sectors(
    file: &std::fs::File,
    lba: i32,
    nframes: i32,
    raw_bytes: &mut [u8],
) -> Result<()> {
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use win_cdrom::*;

    let byte_len = (nframes as usize) * CD_FRAMESIZE_RAW;
    let info = WinRawReadInfo {
        disk_offset: (lba.max(0) as i64) * 2048,
        sector_count: nframes as u32,
        track_mode: 2, // CDDA (2352 bytes/sector)
    };
    let handle = file.as_raw_handle() as *mut c_void;
    let mut bytes_ret = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            handle,
            IOCTL_CDROM_RAW_READ,
            &info as *const WinRawReadInfo as *const c_void,
            std::mem::size_of::<WinRawReadInfo>() as u32,
            raw_bytes.as_mut_ptr() as *mut c_void,
            byte_len as u32,
            &mut bytes_ret,
            null_mut(),
        )
    };
    if ok == 0 {
        return Err(anyhow!(
            "IOCTL_CDROM_RAW_READ failed at LBA {}: {}",
            lba,
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn read_raw_cdda_sectors(
    file: &std::fs::File,
    lba: i32,
    nframes: i32,
    raw_bytes: &mut [u8],
) -> Result<()> {
    let mut ra = CdromReadAudio {
        addr: CdromAddr { lba },
        addr_format: CDROM_LBA,
        nframes,
        buf: raw_bytes.as_mut_ptr(),
    };

    let fd = file.as_raw_fd();
    let mut res = unsafe { libc::ioctl(fd, CDROMREADAUDIO, &mut ra) };

    // Fallback to MSF addressing if a USB drive firmware prefers CDROM_MSF over CDROM_LBA
    if res < 0 {
        let total_frames = (lba + 150).max(0);
        let minute = (total_frames / (60 * 75)) as u8;
        let second = ((total_frames / 75) % 60) as u8;
        let frame = (total_frames % 75) as u8;
        ra.addr = CdromAddr {
            msf: CdromMsf0 {
                minute,
                second,
                frame,
            },
        };
        ra.addr_format = CDROM_MSF;
        res = unsafe { libc::ioctl(fd, CDROMREADAUDIO, &mut ra) };
    }

    if res < 0 {
        return Err(anyhow!(
            "CDROMREADAUDIO failed at LBA {}: {}",
            lba,
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

/// Red Book CD-DA (`44.1 kHz`, 16-bit stereo little-endian) `rodio::Source` with a background
/// burst read-ahead RAM cache (`simp-cdda-readahead`).
///
/// The background reader burst-reads 25-sector chunks at full optical drive speed into RAM and
/// closes the device handle as soon as the track is buffered so the physical CD drive can spin down.
pub struct CddaTrackSource {
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    cache: std::sync::Arc<(std::sync::Mutex<CddaTrackRamCache>, std::sync::Condvar)>,
    total_sectors: usize,
    current_sector_idx: usize,
    total_duration: Duration,
    current_sector_samples: Option<std::sync::Arc<[i16]>>,
    sample_pos: usize,
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
impl Drop for CddaTrackSource {
    fn drop(&mut self) {
        let (lock, cvar) = &*self.cache;
        if let Ok(mut guard) = lock.lock() {
            guard.cancelled = true;
            cvar.notify_all();
        }
    }
}

impl CddaTrackSource {
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    pub fn open_uri(uri: &str) -> Result<Self> {
        Err(anyhow!(
            "Direct optical CD-DA playback is not supported on this platform ({uri})"
        ))
    }

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    pub fn open_uri(uri: &str) -> Result<Self> {
        use std::sync::{Arc, Condvar, Mutex};

        let (device_path, track_number) =
            parse_cdda_uri(uri).ok_or_else(|| anyhow!("Invalid cdda:// URI: {uri}"))?;
        let toc = read_cd_toc(&device_path)?;
        let entry = toc
            .tracks
            .iter()
            .find(|t| t.track_number == track_number && !t.is_data_track)
            .ok_or_else(|| anyhow!("Audio track {track_number} not found on {device_path}"))?;

        #[cfg(target_os = "linux")]
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NONBLOCK)
            .open(&device_path)
            .map_err(|e| anyhow!("Failed to open optical drive {device_path}: {e}"))?;

        #[cfg(target_os = "windows")]
        let file = OpenOptions::new()
            .read(true)
            .open(&device_path)
            .map_err(|e| anyhow!("Failed to open optical drive {device_path}: {e}"))?;

        let start_lba = entry.start_lba;
        let total_sectors = entry.length_sectors.max(1) as usize;
        let duration_ms = (total_sectors as u64 * 1000) / CD_SECTORS_PER_SECOND as u64;

        let mut sectors: Vec<Option<Arc<[i16]>>> = vec![None; total_sectors];

        // Pre-buffer the initial 25 sectors (~333ms) synchronously so audio starts immediately
        let init_frames = (total_sectors as i32).min(READ_CHUNK_SECTORS);
        let mut init_raw = vec![0u8; (init_frames as usize) * CD_FRAMESIZE_RAW];
        read_raw_cdda_sectors(&file, start_lba, init_frames, &mut init_raw)?;
        let samples_per_sector = CD_FRAMESIZE_RAW / 2;
        for s_idx in 0..(init_frames as usize) {
            let byte_off = s_idx * CD_FRAMESIZE_RAW;
            let sec_bytes = &init_raw[byte_off..byte_off + CD_FRAMESIZE_RAW];
            let mut pcm = Vec::with_capacity(samples_per_sector);
            for pair in sec_bytes.chunks_exact(2) {
                pcm.push(i16::from_le_bytes([pair[0], pair[1]]));
            }
            sectors[s_idx] = Some(Arc::from(pcm.into_boxed_slice()));
        }

        let first_sector_samples = sectors[0].clone();
        let already_complete = (init_frames as usize) >= total_sectors;

        let cache = Arc::new((
            Mutex::new(CddaTrackRamCache {
                sectors,
                playback_sector: 0,
                priority_sector: None,
                finished: already_complete,
                cancelled: false,
            }),
            Condvar::new(),
        ));

        if !already_complete {
            let cache_bg = Arc::clone(&cache);
            let _ = std::thread::Builder::new()
                .name("simp-cdda-readahead".to_string())
                .spawn(move || {
                    // Keep up to 12 minutes (`54,000` sectors = ~126 MB) ahead of playback in RAM.
                    // For normal tracks (<= 12 min), the entire track is burst-read at full drive speed,
                    // then `file` is dropped here so the optical drive spins down completely.
                    const MAX_AHEAD_SECTORS: usize = 54_000;
                    let mut raw_buf = vec![0u8; (READ_CHUNK_SECTORS as usize) * CD_FRAMESIZE_RAW];
                    let mut cursor = init_frames as usize;
                    let mut consecutive_errors = 0u8;

                    loop {
                        let next_idx = {
                            let (lock, cvar) = &*cache_bg;
                            let Ok(mut guard) = lock.lock() else {
                                break;
                            };
                            loop {
                                if guard.cancelled {
                                    return;
                                }
                                if let Some(prio) = guard.priority_sector.take() {
                                    cursor = prio.min(total_sectors.saturating_sub(1));
                                }
                                // Find next unbuffered sector starting from `cursor`, wrapping around if needed
                                let found = (cursor..total_sectors)
                                    .find(|&i| guard.sectors[i].is_none())
                                    .or_else(|| {
                                        (0..cursor).find(|&i| guard.sectors[i].is_none())
                                    });
                                let Some(target_idx) = found else {
                                    guard.finished = true;
                                    cvar.notify_all();
                                    return; // Track 100% cached in RAM -> drop `file` so disc spins down!
                                };
                                if total_sectors > MAX_AHEAD_SECTORS
                                    && target_idx
                                        > guard.playback_sector.saturating_add(MAX_AHEAD_SECTORS)
                                {
                                    let _ = cvar.wait_timeout(
                                        guard,
                                        Duration::from_millis(500),
                                    );
                                    guard = match lock.lock() {
                                        Ok(g) => g,
                                        Err(_) => return,
                                    };
                                    continue;
                                }
                                break target_idx;
                            }
                        };

                        // Determine contiguous unbuffered chunk length up to `READ_CHUNK_SECTORS` (25)
                        let nframes = ((total_sectors - next_idx) as i32).min(READ_CHUNK_SECTORS);
                        let lba = start_lba + (next_idx as i32);
                        let byte_len = (nframes as usize) * CD_FRAMESIZE_RAW;

                        if read_raw_cdda_sectors(&file, lba, nframes, &mut raw_buf[..byte_len])
                            .is_ok()
                        {
                            consecutive_errors = 0;
                            let mut parsed_batch: Vec<(usize, Arc<[i16]>)> =
                                Vec::with_capacity(nframes as usize);
                            for i in 0..(nframes as usize) {
                                let off = i * CD_FRAMESIZE_RAW;
                                let slice = &raw_buf[off..off + CD_FRAMESIZE_RAW];
                                let mut pcm = Vec::with_capacity(samples_per_sector);
                                for pair in slice.chunks_exact(2) {
                                    pcm.push(i16::from_le_bytes([pair[0], pair[1]]));
                                }
                                parsed_batch.push((next_idx + i, Arc::from(pcm.into_boxed_slice())));
                            }
                            let (lock, cvar) = &*cache_bg;
                            if let Ok(mut guard) = lock.lock() {
                                for (idx, arc_pcm) in parsed_batch {
                                    if idx < guard.sectors.len() {
                                        guard.sectors[idx] = Some(arc_pcm);
                                    }
                                }
                                cursor = next_idx + (nframes as usize);
                                cvar.notify_all();
                            }
                        } else {
                            consecutive_errors += 1;
                            if consecutive_errors >= 6 {
                                let (lock, cvar) = &*cache_bg;
                                if let Ok(mut guard) = lock.lock() {
                                    guard.finished = true;
                                    cvar.notify_all();
                                }
                                return;
                            }
                            std::thread::sleep(Duration::from_millis(40));
                        }
                    }
                });
        }

        Ok(Self {
            cache,
            total_sectors,
            current_sector_idx: 0,
            total_duration: Duration::from_millis(duration_ms),
            current_sector_samples: first_sector_samples,
            sample_pos: 0,
        })
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    fn load_sector(&mut self, _sector_idx: usize) -> bool {
        false
    }

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    fn load_sector(&mut self, sector_idx: usize) -> bool {
        if sector_idx >= self.total_sectors {
            self.current_sector_samples = None;
            return false;
        }
        let (lock, cvar) = &*self.cache;
        let Ok(mut guard) = lock.lock() else {
            return false;
        };
        guard.playback_sector = sector_idx;
        if let Some(samples) = guard.sectors.get(sector_idx).and_then(|s| s.clone()) {
            self.current_sector_idx = sector_idx;
            self.current_sector_samples = Some(samples);
            self.sample_pos = 0;
            cvar.notify_all();
            return true;
        }
        // Sector not yet in RAM cache: prioritize it and wait up to 4 seconds for the background reader
        guard.priority_sector = Some(sector_idx);
        cvar.notify_all();
        let deadline = std::time::Instant::now() + Duration::from_secs(4);
        while !guard.finished && !guard.cancelled {
            let now = std::time::Instant::now();
            if now >= deadline {
                break;
            }
            let Ok((next_guard, _)) = cvar.wait_timeout(guard, deadline - now) else {
                return false;
            };
            guard = next_guard;
            if let Some(samples) = guard.sectors.get(sector_idx).and_then(|s| s.clone()) {
                self.current_sector_idx = sector_idx;
                self.current_sector_samples = Some(samples);
                self.sample_pos = 0;
                return true;
            }
        }
        false
    }
}

impl Iterator for CddaTrackSource {
    type Item = i16;

    #[inline]
    fn next(&mut self) -> Option<i16> {
        loop {
            if let Some(samples) = self.current_sector_samples.as_ref() {
                if let Some(&sample) = samples.get(self.sample_pos) {
                    self.sample_pos += 1;
                    return Some(sample);
                }
            }
            let next_sector = self.current_sector_idx + 1;
            if !self.load_sector(next_sector) {
                return None;
            }
        }
    }
}

impl Source for CddaTrackSource {
    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        self.current_sector_samples
            .as_ref()
            .map(|s| s.len().saturating_sub(self.sample_pos))
    }

    #[inline]
    fn channels(&self) -> u16 {
        2
    }

    #[inline]
    fn sample_rate(&self) -> u32 {
        44_100
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        Some(self.total_duration)
    }

    fn try_seek(&mut self, pos: Duration) -> std::result::Result<(), RodioSeekError> {
        let sector_offset = ((pos.as_millis() as u64 * CD_SECTORS_PER_SECOND as u64) / 1000) as usize;
        let target_idx = sector_offset.min(self.total_sectors.saturating_sub(1));
        let _ = self.load_sector(target_idx);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_musicbrainz_disc_id_calculation() {
        // Canonical MusicBrainz DiscID Calculation spec example:
        // First track: 1, Last track: 15
        // Lead-out frame offset: 252105 (so LBA = 252105 - 150 = 251955)
        // Track frame offsets: 150, 15215, 32160, 46442, 63265, 80352, 95820, 112685, 132312, 149257, 164720, 177615, 198332, 211567, 232610
        let frame_offsets = [
            150, 15215, 32160, 46442, 63265, 80352, 95820, 112685, 132312, 149257, 164720, 177615,
            198332, 211567, 232610,
        ];
        let lbas: Vec<i32> = frame_offsets.iter().map(|f| f - 150).collect();
        let (disc_id, toc_param) = compute_musicbrainz_disc_id(1, 15, 252105 - 150, &lbas);
        assert_eq!(disc_id, "._UGqvOC1peWtaQ0xAQv6jinTPY-");
        assert!(toc_param.starts_with("1+15+252105+150+15215+"));
    }

    #[test]
    fn test_parse_cdda_uri() {
        let parsed = parse_cdda_uri("cdda:///dev/sr0#track=3").unwrap();
        assert_eq!(parsed.0, "/dev/sr0");
        assert_eq!(parsed.1, 3);
    }
}
