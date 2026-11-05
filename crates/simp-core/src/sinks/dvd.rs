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
const DVDCSS_SEEK_KEY: libc::c_int = 1 << 0;
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

/// Returns candidate paths where a user may have placed `libdvdcss.so.2`.
pub fn candidate_libdvdcss_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(env_path) = std::env::var("SIMP_DVDCSS_PATH") {
        if !env_path.trim().is_empty() {
            paths.push(PathBuf::from(env_path.trim()));
        }
    }
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
    paths
}

pub fn find_libdvdcss_path() -> Option<PathBuf> {
    candidate_libdvdcss_paths()
        .into_iter()
        .find(|p| p.is_file())
}

impl DvdCssSession {
    pub fn open(device_path: &str) -> Option<Self> {
        let so_path = find_libdvdcss_path()?;
        let c_so = std::ffi::CString::new(so_path.to_string_lossy().as_bytes()).ok()?;
        let c_dev = std::ffi::CString::new(device_path.as_bytes()).ok()?;

        unsafe {
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
    }

    pub fn seek_sector(&mut self, lba: u32, unlock_key: bool) -> Result<()> {
        let flags = if unlock_key { DVDCSS_SEEK_KEY } else { 0 };
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

/// Discovers an available `ffmpeg` binary (`~/.local/share/simp/bin/ffmpeg` or system `PATH`).
pub fn find_ffmpeg_binary() -> Option<PathBuf> {
    if let Ok(env_bin) = std::env::var("SIMP_FFMPEG_PATH") {
        let p = PathBuf::from(env_bin.trim());
        if p.is_file() {
            return Some(p);
        }
    }
    if let Some(data_dir) = dirs::data_local_dir() {
        let p = data_dir.join("simp").join("bin").join("ffmpeg");
        if p.is_file() {
            return Some(p);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let p = PathBuf::from(home).join(".local/share/simp/bin/ffmpeg");
        if p.is_file() {
            return Some(p);
        }
    }
    for sys in ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/bin/ffmpeg"] {
        let p = PathBuf::from(sys);
        if p.is_file() {
            return Some(p);
        }
    }
    if Command::new("ffmpeg")
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return Some(PathBuf::from("ffmpeg"));
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

/// Parses a DVD-Video disc from an optical device (`/dev/sr0`) or ISO file.
pub fn parse_dvd_device(device_path: &str) -> Result<ParsedDvdDisc> {
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
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("simp")
        .join("dvd_cache.json")
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
    if let Ok(out) = Command::new("curl")
        .args(["-4", "--http1.1", "-sL", "--max-time", "5", &url])
        .output()
    {
        if out.status.success() {
            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
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

    let css_available = find_libdvdcss_path().is_some();
    let ffmpeg_available = find_ffmpeg_binary().is_some();
    let dvd_titles: Vec<DvdTitleInfo> = parsed.titles.iter().map(|t| t.info.clone()).collect();

    let status_message = match (css_available, ffmpeg_available) {
        (true, true) => format!(
            "DVD-Video ready ({} title{}, CSS + ffmpeg active)",
            dvd_titles.len(),
            if dvd_titles.len() == 1 { "" } else { "s" }
        ),
        (false, true) => format!(
            "DVD-Video detected ({} title{}) — place libdvdcss.so.2 in ~/.local/share/simp/lib/ for encrypted discs",
            dvd_titles.len(),
            if dvd_titles.len() == 1 { "" } else { "s" }
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

/// Spawns an `ffmpeg` fragmented MP4 (`video/mp4`) child process fed by a background thread
/// reading and CSS-decrypting the exact PGC sector spans for `(title_number, chapter_number)`.
pub fn spawn_dvd_title_mp4_stream(
    device_path: &str,
    title_number: u16,
    start_chapter: u16,
    audio_stream_index: u8,
    subtitle_stream_index: Option<u8>,
) -> Result<Child> {
    let ffmpeg_bin = find_ffmpeg_binary()
        .ok_or_else(|| anyhow!("ffmpeg not found in ~/.local/share/simp/bin/ or PATH"))?;
    let parsed = parse_dvd_device(device_path)?;
    let target_title = parsed
        .titles
        .into_iter()
        .find(|t| t.info.title_number == title_number)
        .ok_or_else(|| anyhow!("DVD Title {title_number} not found on disc"))?;

    if target_title.vob_base_lba == 0 || target_title.cell_spans.is_empty() {
        return Err(anyhow!(
            "DVD Title {title_number} has no readable VTS VOB sector spans"
        ));
    }

    let mut args: Vec<String> = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-fflags".to_string(),
        "+genpts+igndts".to_string(),
        "-f".to_string(),
        "mpeg".to_string(),
        "-i".to_string(),
        "pipe:0".to_string(),
    ];

    if let Some(sub_idx) = subtitle_stream_index {
        args.push("-filter_complex".to_string());
        args.push(format!(
            "[0:v:0]yadif[v];[v][0:s:{sub_idx}]overlay[outv]"
        ));
        args.push("-map".to_string());
        args.push("[outv]".to_string());
    } else {
        args.push("-vf".to_string());
        args.push("yadif".to_string());
        args.push("-map".to_string());
        args.push("0:v:0".to_string());
    }

    args.extend([
        "-map".to_string(),
        format!("0:a:{}?", audio_stream_index),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "ultrafast".to_string(),
        "-tune".to_string(),
        "zerolatency".to_string(),
        "-crf".to_string(),
        "21".to_string(),
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

    let mut child = Command::new(ffmpeg_bin)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| anyhow!("Failed to spawn ffmpeg: {e}"))?;

    let Some(mut ffmpeg_stdin) = child.stdin.take() else {
        return Err(anyhow!("Failed to open ffmpeg stdin pipe"));
    };

    let dev_owned = device_path.to_string();
    let vob_base = target_title.vob_base_lba;
    let spans: Vec<DvdCellSectorSpan> = target_title
        .cell_spans
        .into_iter()
        .filter(|s| s.chapter_number >= start_chapter.max(1))
        .collect();

    std::thread::spawn(move || {
        const CHUNK_SECTORS: usize = 32; // 64 KB per read
        let mut buf = vec![0u8; CHUNK_SECTORS * DVD_SECTOR_SIZE];

        if let Some(mut css) = DvdCssSession::open(&dev_owned) {
            // Unlock title CSS key at the start of the VTS VOB
            let _ = css.seek_sector(vob_base, true);
            for (idx, span) in spans.iter().enumerate() {
                let start_lba = vob_base.saturating_add(span.first_sector);
                let end_lba = vob_base.saturating_add(span.last_sector);
                if css.seek_sector(start_lba, idx == 0).is_err() {
                    break;
                }
                let mut cur = start_lba;
                while cur <= end_lba {
                    let count = ((end_lba - cur + 1) as usize).min(CHUNK_SECTORS);
                    match css.read_sectors(&mut buf[..count * DVD_SECTOR_SIZE], count, true) {
                        Ok(n) if n > 0 => {
                            if ffmpeg_stdin.write_all(&buf[..n * DVD_SECTOR_SIZE]).is_err() {
                                return;
                            }
                            cur += n as u32;
                        }
                        _ => break,
                    }
                }
            }
        } else if let Ok(mut raw_file) = OpenOptions::new().read(true).open(&dev_owned) {
            // Fallback for unencrypted DVDs when libdvdcss.so.2 is not present
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
                    if ffmpeg_stdin.write_all(&buf[..byte_count]).is_err() {
                        return;
                    }
                    cur += count as u32;
                }
            }
        }
    });

    Ok(child)
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
