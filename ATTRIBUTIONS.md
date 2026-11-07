# Attributions, Provenance & Acknowledgments

SIMP (Simple Integrated Media Player) is built with deep gratitude toward the open-source maintainers, archival institutions, standards bodies, and systems engineers whose documentation, libraries, and reference implementations made a sub-4 MB native Rust console media player possible.

This document serves as our living provenance ledger — crediting both direct library dependencies and the external documentation, specifications, and reference codebases we studied when writing SIMP's native Rust engines.

---

## 1. Internet Archive (`archive.org`) & `jjjake/internetarchive`

SIMP's native Rust Internet Archive client (`crates/simp-core/src/sinks/internet_archive_api.rs` and `internet_archive.rs`) was designed by studying the architecture and documentation of the official Python [`internetarchive`](https://github.com/jjjake/internetarchive) library and the Internet Archive Developer Portal:

* **Jake Johnson ([@jjjake](https://github.com/jjjake)) and all contributors to [`jjjake/internetarchive`](https://github.com/jjjake/internetarchive)**:
  * Thank you for creating and maintaining the canonical programmatic interface to `archive.org`. SIMP's pure-Rust session conventions, search/scrape query builders, derivative file selection, `cnt=0` non-inflating automated access behavior, and `LOW` IAS3 authorization support are directly inspired by the clean design of `ArchiveSession`, `Item`, and `Search` in `internetarchive`.
* **The Internet Archive ([`archive.org`](https://archive.org)) & Brewster Kahle**:
  * Thank you for preserving universal access to human culture — feature films, classic television, *The Computer Chronicles*, the Live Music Archive (`etree`), netlabels, old-time radio, and LibriVox — and for publishing clear, open developer documentation:
    * [Bots, LLMs, and Automated Access Best Practices (`bots.html`)](https://archive.org/developers/bots.html)
    * [Internet Archive Item Metadata Schema (`metadata.html`)](https://archive.org/developers/metadata.html)
    * [Item Metadata Read API (`md-read.html`)](https://archive.org/developers/md-read.html)
    * [Views Data Service API (`views_api.html`)](https://archive.org/developers/views_api.html)
    * [Advanced Search (`advancedsearch.php`) & Cursor Scraping (`/services/search/v1/scrape`)](https://archive.org/advancedsearch.php)

---

## 2. Console UX & Industrial Design Inspiration

* **Sony Interactive Entertainment — PlayStation 3 XrossMediaBar (XMB)**:
  * SIMP's two-column spatial controller navigation (`ui/src/hooks/useGamepadNavigation.ts` and `ui/src/views/LibraryBrowserView.tsx`) is an homage to the award-winning PlayStation 3 XMB interface: moving the cursor up and down the left category column automatically previews content in the right pane after a short debounce, pressing D-Pad Right steps directly onto the first playable item (bypassing auxiliary header filters), and pressing `B` walks back up the hierarchy.

---

## 3. Native Audio Decoding, Tagging & Output Stack

* **Philip Deljanov & [`Symphonia`](https://github.com/pdeljanov/Symphonia) Contributors**:
  * Pure-Rust multimedia container demuxing (`ISOMP4`, `MKV`, `OGG`, `WAV`) and audio decoding (`FLAC`, `MP3`, `AAC-LC`, `Vorbis`, `PCM`) powering SIMP's local, optical, SoundCloud, Apple Music, and Internet Archive audio pipelines.
* **[`Rodio`](https://github.com/RustAudio/rodio) & [`cpal`](https://github.com/RustAudio/cpal) Contributors**:
  * Cross-platform audio output stream management across Linux PipeWire/ALSA/PulseAudio, macOS CoreAudio, and Windows WASAPI.
* **[`Lofty`](https://github.com/Serial-ATA/lofty-rs) Contributors**:
  * Pure-Rust audio metadata tag (`ID3v2`, `Vorbis Comments`, `MP4/iTunes` atoms) and embedded cover artwork extraction.
* **PipeWire & PulseAudio Communities**:
  * Reference for SIMP's perceptual cubic volume taper ($v^3$, corresponding to $-60 \log_{10}(v)\text{ dB}$) and zero-CPU idle stream suspension on Steam Deck.

---

## 4. Optical Media (`CD-DA` & `DVD-Video`) & Cover Art Resolution

* **VideoLAN Project ([`libdvdcss`](https://code.videolan.org/videolan/libdvdcss), [`libdvdread`](https://code.videolan.org/videolan/libdvdread), [`libdvdnav`](https://code.videolan.org/videolan/libdvdnav), and [`VLC`](https://www.videolan.org/vlc/))**:
  * Reference for SIMP's zero-bundled runtime `dlopen`/`LoadLibraryW` integration with user-supplied `libdvdcss` (`dvdcss_open`, `dvdcss_seek`, `dvdcss_read`), as well as the DVD-Video `VIDEO_TS.IFO` (`VMGI_MAT`, `TT_SRPT`) and `VTS_XX_0.IFO` (`VTSI_MAT`, `VTS_PGCIT`) binary table specifications, BCD frame timing, VOBU NAV pack alignment (`0x000001BF`), and MPEG-2 PES `private_stream_1` (`0xBD`) AC-3 / SPU subtitle sub-stream headers in `crates/simp-core/src/sinks/dvd.rs`.
* **MetaBrainz Foundation ([`MusicBrainz`](https://musicbrainz.org) & [`Cover Art Archive`](https://coverartarchive.org))**:
  * Reference for Red Book Audio CD TOC SHA-1 DiscID calculation (`crates/simp-core/src/sinks/cdda.rs`) and polite rate-limited cover art resolution (`crates/simp-core/src/library/artwork.rs`).
* **Linux Kernel `<linux/cdrom.h>` & Microsoft Win32 `ntddcdrm.h`**:
  * Reference for raw 2352-byte Red Book CD-DA sector reading via `CDROMREADTOCHDR` / `CDROMREADTOCENTRY` / `CDROMREADAUDIO` on Linux and `IOCTL_CDROM_READ_TOC` / `IOCTL_CDROM_RAW_READ` on Windows.

---

## 5. Streaming Protocols & Content Decryption Specifications

* **Chromium Open Source Project (`media/cdm/api/content_decryption_module.h`) & ISO/IEC 23001-7 (`CENC` / `cbcs`)**:
  * Reference for SIMP's in-process `ContentDecryptionModule_10` and `Host_10` C++ vtable FFI bridge (`crates/simp-core/src/sinks/apple_native/cdm_host.rs`) and ISO-BMFF fragmented MP4 (`moov`/`moof`/`mdat`, `sinf`/`schi`/`tenc`, and AES-128-CBC 1:9 pattern decryption in `mp4_cbcs.rs`).
* **SoundCloud Developers API & IETF RFC 7636 (`PKCE`)**:
  * Reference for OAuth 2.1 Authorization Code + PKCE (`S256`) authentication, HLS AAC/fMP4 stream transcodings, waveform peak envelopes, and timed track comments (`crates/simp-core/src/sinks/soundcloud_api.rs` and `soundcloud.rs`).
* **Apple MusicKit & Web Playback API**:
  * Reference for ES256 (`P-256` ECDSA) developer token signing, storefront catalog resolution, cloud library pagination, and personal radio station seeding (`crates/simp-core/src/sinks/apple_api.rs`).
* **Daniel Stenberg & the [`curl` / `libcurl`](https://curl.se/libcurl/) Project**:
  * Reference for SIMP's in-process `libcurl.so.4` C FFI connection pool (`crates/simp-core/src/http_pool.rs`) enabling persistent TLS + HTTP/2 connection reuse without bloating the binary.

---

## 6. SteamOS, Gamescope, OpenVR, macOS & Desktop Ecosystem

* **Valve Corporation ([`SteamOS`](https://store.steampowered.com/steamos), [`Gamescope`](https://github.com/ValveSoftware/gamescope), and [`OpenVR`](https://github.com/ValveSoftware/openvr))**:
  * Reference for Valve Data Format (`libraryfolders.vdf`, `appmanifest_*.acf`, and binary `shortcuts.vdf`) parsing and SIMP's zero-dependency `libopenvr_api.so` `IVROverlay` C ABI bridge (`crates/simp-core/src/vr_overlay.rs`) for SteamVR / Steam Frame dashboard overlays.
* **[`SteamDeckHomebrew / Decky Loader`](https://github.com/SteamDeckHomebrew/decky-loader)**:
  * Reference and plugin host ecosystem for SIMP's optional Quick Access Menu (`decky-plugin`) companion drawer.
* **freedesktop.org (`org.mpris.MediaPlayer2`) & KDE (`org.kde.StatusNotifierItem`)**:
  * D-Bus specifications powering SIMP's native media key arbitration and Linux desktop system tray integration.
* **[`Souvlaki`](https://github.com/Sinono3/souvlaki), [`rust-objc`](https://github.com/SSheldon/rust-objc), [`core-foundation-rs`](https://github.com/servo/core-foundation-rs) & Apple macOS Frameworks (`AppKit`, `WebKit`, `MediaPlayer`, `IOKit`)**:
  * Powers SIMP's native macOS application bundle (`src-tauri/src/macos_app.rs`), `NSStatusItem` Menu Bar tray, `WKWebView` presentation layer, `MPNowPlayingInfoCenter` / `MPRemoteCommandCenter` Control Center & media key integration (`crates/simp-core/src/mpris.rs`), and `IOHIDManager` USB/Bluetooth gamepad input reader (`crates/simp-core/src/gamepad.rs`).
