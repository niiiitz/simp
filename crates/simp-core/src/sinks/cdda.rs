use crate::library::db::LibraryDatabase;
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rodio::{source::SeekError as RodioSeekError, Source};
use sha1::{Digest, Sha1};
#[cfg(target_os = "linux")]
use simp_protocol::TrackMetadata;
use simp_protocol::OpticalDiscStatus;
#[cfg(target_os = "linux")]
use std::fs::OpenOptions;
#[cfg(target_os = "linux")]
use std::os::unix::fs::OpenOptionsExt;
#[cfg(target_os = "linux")]
use std::os::unix::io::AsRawFd;
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

const CDROM_LBA: u8 = 0x01;
const CDROM_MSF: u8 = 0x02;
const CDROM_LEADOUT: u8 = 0xAA;

const CDS_NO_INFO: libc::c_int = 0;
const CDS_NO_DISC: libc::c_int = 1;
const CDS_TRAY_OPEN: libc::c_int = 2;
const CDS_DRIVE_NOT_READY: libc::c_int = 3;
const CDS_DISC_OK: libc::c_int = 4;

const CDS_AUDIO: libc::c_int = 100;
const CDS_MIXED: libc::c_int = 105;

const CD_FRAMESIZE_RAW: usize = 2352; // 588 stereo 16-bit samples per sector (1/75th sec)
const CD_SECTORS_PER_SECOND: u32 = 75;
const READ_CHUNK_SECTORS: i32 = 25; // ~333ms per ioctl read chunk

#[repr(C)]
#[derive(Debug, Default, Clone, Copy)]
struct CdromTochdr {
    cdth_trk0: u8,
    cdth_trk1: u8,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CdromMsf0 {
    minute: u8,
    second: u8,
    frame: u8,
}

#[repr(C)]
#[derive(Clone, Copy)]
union CdromAddr {
    msf: CdromMsf0,
    lba: libc::c_int,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CdromTocentry {
    cdte_track: u8,
    cdte_adr_ctrl: u8,
    cdte_format: u8,
    cdte_addr: CdromAddr,
    cdte_datamode: u8,
}

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

/// Discovers the first present optical drive device node (`/dev/sr0`..`/dev/sr3` or `/dev/cdrom`).
pub fn find_optical_device(preferred: Option<&str>) -> Option<String> {
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

/// Reads the Table of Contents (TOC) from an optical drive via Linux `ioctl` without requiring `sudo`.
#[cfg(not(target_os = "linux"))]
pub fn read_cd_toc(device_path: &str) -> Result<CdToc> {
    Err(anyhow!(
        "Direct optical CD-DA TOC ioctl is only supported on Linux ({device_path})"
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
#[cfg(not(target_os = "linux"))]
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
        status_message: "Direct optical CD-DA drive scanning is supported on Linux".to_string(),
    }
}

/// Scans an optical drive on-demand (invoked only when the user opens Sources / CD view or clicks Scan).
/// Resolves track titles and album cover art via MusicBrainz + Cover Art Archive and caches by `disc_id` in SQLite.
#[cfg(target_os = "linux")]
pub fn scan_optical_disc(
    db: &LibraryDatabase,
    preferred_device: Option<&str>,
    force_refresh: bool,
) -> OpticalDiscStatus {
    let Some(device_path) = find_optical_device(preferred_device) else {
        return OpticalDiscStatus {
            drive_present: false,
            device_path: "/dev/sr0".to_string(),
            disc_present: false,
            is_audio_cd: false,
            disc_id: None,
            album_title: String::new(),
            artist_name: String::new(),
            release_year: None,
            art_url: None,
            tracks: Vec::new(),
            status_message: "No USB optical drive (/dev/sr0) connected".to_string(),
        };
    };

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
            };
        }
        CDS_DISC_OK | CDS_NO_INFO | _ => {}
    }

    let disc_status = unsafe { libc::ioctl(fd, CDROM_DISC_STATUS, 0 as libc::c_int) };
    drop(file);

    let toc = match read_cd_toc(&device_path) {
        Ok(t) => t,
        Err(e) => {
            if disc_status > 0 && disc_status != CDS_AUDIO && disc_status != CDS_MIXED {
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
            };
        }
    };

    let audio_tracks: Vec<&CdTrackTocEntry> =
        toc.tracks.iter().filter(|t| !t.is_data_track).collect();
    if audio_tracks.is_empty() {
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
        };
    }

    // 1. Check SQLite `cd_cache` first unless `force_refresh` was requested
    if !force_refresh {
        if let Ok(Some((cached_album, cached_artist, mut cached_tracks, cached_art))) =
            db.get_cd_cache(&toc.disc_id)
        {
            if !cached_tracks.is_empty() {
                for t in &mut cached_tracks {
                    if let Some( num) = t.track_number {
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
    }
}

/// Ejects the optical disc tray via `CDROMEJECT` ioctl (or `eject` CLI fallback).
#[cfg(not(target_os = "linux"))]
pub fn eject_optical_disc(_preferred_device: Option<&str>) -> Result<String> {
    Err(anyhow!("No optical drive found"))
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
    let out = std::process::Command::new("curl")
        .args([
            "-sL",
            "--max-time",
            "6",
            "-H",
            "User-Agent: SIMP/0.1.0-alpha (https://github.com/niiiitz/simp)",
            "-H",
            "Accept: application/json",
            &url,
        ])
        .output()
        .ok()?;
    if !out.status.success() || out.stdout.is_empty() {
        return None;
    }

    let json: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
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
    let art_cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join("simp")
        .join("art");
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
    let status = std::process::Command::new("curl")
        .args([
            "-sL",
            "--fail",
            "--max-time",
            "8",
            "-H",
            "User-Agent: SIMP/0.1.0-alpha (https://github.com/niiiitz/simp)",
            "-o",
            &dest_path.to_string_lossy(),
            &caa_url,
        ])
        .status()
        .ok()?;

    if status.success()
        && dest_path.is_file()
        && dest_path.metadata().map(|m| m.len() > 512).unwrap_or(false)
    {
        Some(format!("http://127.0.0.1:18888/art/{filename}"))
    } else {
        let _ = std::fs::remove_file(&dest_path);
        None
    }
}

/// Parses a `cdda:///dev/sr0#track=1` URI into `(device_path, track_number)`.
pub fn parse_cdda_uri(uri: &str) -> Option<(String, u8)> {
    let rest = uri.strip_prefix("cdda://")?;
    let (dev_part, frag_part) = rest.split_once("#track=")?;
    let device_path = if dev_part.starts_with('/') {
        dev_part.to_string()
    } else {
        format!("/{dev_part}")
    };
    let track_num: u8 = frag_part.trim().parse().ok()?;
    Some((device_path, track_num))
}

/// Red Book CD-DA (`44.1 kHz`, 16-bit stereo little-endian) streaming `rodio::Source`
/// reading directly from `/dev/sr0` via `CDROMREADAUDIO` in 25-sector buffered chunks.
pub struct CddaTrackSource {
    #[cfg(target_os = "linux")]
    file: std::fs::File,
    start_lba: i32,
    end_lba: i32,
    current_lba: i32,
    total_duration: Duration,
    sample_buf: Vec<i16>,
    sample_pos: usize,
}

impl CddaTrackSource {
    #[cfg(not(target_os = "linux"))]
    pub fn open_uri(uri: &str) -> Result<Self> {
        Err(anyhow!("Direct optical CD-DA playback is only supported on Linux ({uri})"))
    }

    #[cfg(target_os = "linux")]
    pub fn open_uri(uri: &str) -> Result<Self> {
        let (device_path, track_number) =
            parse_cdda_uri(uri).ok_or_else(|| anyhow!("Invalid cdda:// URI: {uri}"))?;
        let toc = read_cd_toc(&device_path)?;
        let entry = toc
            .tracks
            .iter()
            .find(|t| t.track_number == track_number && !t.is_data_track)
            .ok_or_else(|| anyhow!("Audio track {track_number} not found on {device_path}"))?;

        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NONBLOCK)
            .open(&device_path)
            .map_err(|e| anyhow!("Failed to open optical drive {device_path}: {e}"))?;

        let start_lba = entry.start_lba;
        let end_lba = entry.start_lba + entry.length_sectors.max(1);
        let duration_ms =
            (entry.length_sectors.max(0) as u64 * 1000) / CD_SECTORS_PER_SECOND as u64;

        let mut source = Self {
            file,
            start_lba,
            end_lba,
            current_lba: start_lba,
            total_duration: Duration::from_millis(duration_ms),
            sample_buf: Vec::with_capacity(READ_CHUNK_SECTORS as usize * CD_FRAMESIZE_RAW / 2),
            sample_pos: 0,
        };
        source.fill_next_chunk()?;
        Ok(source)
    }

    #[cfg(not(target_os = "linux"))]
    fn fill_next_chunk(&mut self) -> Result<bool> {
        Ok(false)
    }

    #[cfg(target_os = "linux")]
    fn fill_next_chunk(&mut self) -> Result<bool> {
        if self.current_lba >= self.end_lba {
            return Ok(false);
        }
        let remaining = self.end_lba - self.current_lba;
        let nframes = remaining.min(READ_CHUNK_SECTORS);
        let byte_len = nframes as usize * CD_FRAMESIZE_RAW;
        let mut raw_bytes = vec![0u8; byte_len];

        let mut ra = CdromReadAudio {
            addr: CdromAddr {
                lba: self.current_lba,
            },
            addr_format: CDROM_LBA,
            nframes,
            buf: raw_bytes.as_mut_ptr(),
        };

        let fd = self.file.as_raw_fd();
        let mut res = unsafe { libc::ioctl(fd, CDROMREADAUDIO, &mut ra) };

        // Fallback to MSF addressing if a USB drive firmware prefers CDROM_MSF over CDROM_LBA
        if res < 0 {
            let total_frames = (self.current_lba + 150).max(0);
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
                self.current_lba,
                std::io::Error::last_os_error()
            ));
        }

        self.current_lba += nframes;
        self.sample_buf.clear();
        for chunk in raw_bytes.chunks_exact(2) {
            self.sample_buf
                .push(i16::from_le_bytes([chunk[0], chunk[1]]));
        }
        self.sample_pos = 0;
        Ok(!self.sample_buf.is_empty())
    }
}

impl Iterator for CddaTrackSource {
    type Item = i16;

    #[inline]
    fn next(&mut self) -> Option<i16> {
        if self.sample_pos >= self.sample_buf.len() {
            match self.fill_next_chunk() {
                Ok(true) => {}
                _ => return None,
            }
        }
        let sample = *self.sample_buf.get(self.sample_pos)?;
        self.sample_pos += 1;
        Some(sample)
    }
}

impl Source for CddaTrackSource {
    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        Some(self.sample_buf.len().saturating_sub(self.sample_pos))
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
        let sector_offset = ((pos.as_millis() as u64 * CD_SECTORS_PER_SECOND as u64) / 1000) as i32;
        let target_lba = (self.start_lba + sector_offset).clamp(self.start_lba, self.end_lba);
        self.current_lba = target_lba;
        self.sample_buf.clear();
        self.sample_pos = 0;
        let _ = self.fill_next_chunk();
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
