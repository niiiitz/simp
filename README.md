<div align="center">
  <img src="ui/public/simp-icon-dark.png" width="170" alt="SIMP Logo" />

  # SIMP — Simple Integrated Media Player

  **A lightweight, controller-first audio & video player for SteamOS, Linux, Windows, and SteamVR.**

  [![Status: v0.1.0-alpha.59](https://img.shields.io/badge/status-v0.1.0--alpha.59-ff6a00?style=flat-square)](#)
  [![Target: SteamOS / Linux / Windows / SteamVR](https://img.shields.io/badge/target-SteamOS%20%7C%20Linux%20%7C%20Windows%20%7C%20SteamVR-000000?style=flat-square)](#)
  [![Backend: 100% Native Rust](https://img.shields.io/badge/backend-Native%20Rust-dea584?style=flat-square)](#)
</div>

---

## What is this?

Playing your own music and video while gaming on a Steam Deck, living-room PC, desktop, or VR headset shouldn't require a heavy web browser or five separate apps.

**SIMP** runs a tiny native Rust media daemon in the background paired with a high-contrast console UI designed for gamepads, VR pointers, and mouse & keyboard alike.

| <a href="docs/screenshots/on_deck.jpg"><img src="docs/screenshots/on_deck.jpg" alt="SIMP on Steam Deck" width="100%" /></a> | <a href="docs/screenshots/spacial_computing_simp.jpg"><img src="docs/screenshots/spacial_computing_simp.jpg" alt="SIMP in SteamVR on Steam Frame" width="100%" /></a> |
| :---: | :---: |
| **Steam Deck (Handheld Gamepad Mode)**<br><sub>Controller button hints (`L1`/`R1`/`X`/`Y`/`L2`/`R2`) active</sub> | **Steam Frame (`aarch64` SteamVR Spatial Overlay)**<br><sub>Floating alongside your VR library in passthrough/3D space</sub> |
| <a href="docs/screenshots/KDE_steammachine.jpg"><img src="docs/screenshots/KDE_steammachine.jpg" alt="SIMP on KDE Plasma Desktop with MPRIS2" width="100%" /></a> | <a href="docs/screenshots/library_queue.png"><img src="docs/screenshots/library_queue.png" alt="SIMP Library and Cloud Playlists" width="100%" /></a> |
| **KDE Plasma & Desktop Mode**<br><sub>Local/Steam OST browser with native `MPRIS2` tray controls</sub> | **Library & Hybrid Playlists**<br><sub>Pinning cloud playlists, collections, and local media together</sub> |
| <a href="docs/screenshots/mouse_mode.png"><img src="docs/screenshots/mouse_mode.png" alt="SIMP Adaptive Mouse Mode" width="100%" /></a> | <a href="docs/screenshots/search_and_pin.png"><img src="docs/screenshots/search_and_pin.png" alt="SIMP Search and Controller OSK" width="100%" /></a> |
| **Adaptive Pointer / Mouse Mode**<br><sub>Controller glyphs auto-hide when using a mouse or trackpad</sub> | **Source-Scoped Search & Controller OSK**<br><sub>Fast catalog search, pinning, and built-in on-screen keyboard</sub> |

---

## Highlights

* **One queue for audio & video:** Mix local music & video files, **Steam Soundtracks**, **Apple Music**, **SoundCloud** tracks & DJ mixes, **Internet Archive** films & live concerts, and physical **Audio CDs / DVDs** inside the same **Hybrid Playlist**.
* **Unified player card:** Watch video directly inside the Now Playing card or expand into full-viewport **Theatre Mode** with an auto-hiding HUD, stream quality/audio track switching, subtitles, and continuous background audio when flipping back to your library (`L1`/`R1`).
* **Zero browser bloat:** Playback, indexing, and streaming run in a single ~4 MB native Rust daemon (`< 1%` CPU). Close the UI window and your media keeps playing.
* **Pin only what you want:** Browse **Apple Music**, **SoundCloud**, and **Internet Archive** catalogs on demand, and **Pin (`📌`)** individual albums, movies, or entire collections into SIMP for instant access.
* **Controller-first, mouse-friendly:** Built around console spatial navigation (`L1`/`R1`, D-Pad, on-screen keyboard), with controller badges that automatically step aside when you move a mouse.
* **OLED-safe & VR-ready:** Pure `#000000` black theme with smart idle dimming (automatically suppressed during active video playback, re-engaged on pause/end), Linux `MPRIS2` media keys, and a native **SteamVR** dashboard overlay.

---

## Installation

### SteamOS / Bazzite / Linux (`x86_64` & `aarch64` Steam Frame)

SIMP installs into `~/.local/share/simp` as a `systemd --user` service and **never** touches read-only system partitions.

Download `simp-steamos-userland-x86_64.tar.gz` (or `simp-steamos-userland-aarch64.tar.gz` for **Steam Frame** / ARM64) from the [latest GitHub Release](https://github.com/niiiitz/simp/releases):

```bash
rm -rf /tmp/simp-steamos-userland && tar -xzf simp-steamos-userland-x86_64.tar.gz -C /tmp
/tmp/simp-steamos-userland/install-steamos.sh
```

* **Launch:** Open **SIMP** from your app menu, run `simp`, or right-click **SIMP** → **Add to Steam** for Game Mode & SteamVR.
* **Update / Uninstall:** Click **Update SIMP** in the in-app Power menu (`⏻`), or run `~/.local/share/simp/bin/uninstall-steamos.sh`.
* **Optional Decky Plugin:** Install `simp-decky.zip` via Decky Loader's *Install from ZIP* menu for a Quick Access Menu drawer.

### Windows (`x86_64` Portable)

Download `simp-windows-portable-x86_64.zip` from the [latest GitHub Release](https://github.com/niiiitz/simp/releases), extract it anywhere, and launch `simp.exe` (or `Start-SIMP.bat`). Settings and database live in `%APPDATA%\simp` and `%LOCALAPPDATA%\simp`.

---

## Quick Reference

### Controller Shortcuts

| Button | Now Playing (`L1`) | Library & Queue (`R1`) |
| :--- | :--- | :--- |
| **`A` / `Enter`** | Play / Pause | Play item, press button, or open search OSK |
| **`B` / `Esc`** | Close popups / Exit Theatre | Back out of menus / Return to Player |
| **`X` / `Y`** | Shuffle (`X`) / Repeat (`Y`) | Shuffle (`X`) / Repeat (`Y`) |
| **`D-Pad Left / Right`** | Previous / Next track | Navigate across columns & pills |
| **`D-Pad Up / Down`** | Volume `+5%` / `-5%` | Scroll lists |
| **`L1` / `R1` Bumpers** | Switch to Player (`L1`) / Library (`R1`) | Switch to Player (`L1`) / Library (`R1`) |
| **`L2` / `R2` Triggers** | Seek `-10s` / `+10s` | Seek `-10s` / `+10s` |
| **`Select` / `Start`** | Video & Track Actions (`Select`) / Power (`Start`) | Sources (`Select`) / Power (`Start`) |

### Tips & Paths

* **QR Code Sign-In:** To connect **Apple Music** or **SoundCloud** without typing on a gamepad, open **Sources (`Select`)** and scan the on-screen **QR Code** from your phone or desktop browser.
* **Optical Discs (`cdda://` / `dvd://`):** SIMP never polls `/dev/sr0` in the background. Insert an Audio CD or DVD and click **🔄 Scan** in the sidebar. For CSS-encrypted commercial DVDs on Linux/SteamOS, place `libdvdcss.so.2` in `~/.local/share/simp/lib/`.
* **Config & Database:** `~/.config/simp/settings.vdf` and `~/.local/share/simp/library.db` (Linux/SteamOS) · `%APPDATA%\simp\settings.vdf` and `%LOCALAPPDATA%\simp\library.db` (Windows).
* **Service Logs (Linux):** `journalctl --user -u simp.service -f`

---

## Architecture & Building from Source

SIMP decouples playback from presentation:
1. **Rust Daemon (`simp --daemon`):** Indexes media into SQLite, decodes local audio (`symphonia`/`rodio`), streams Apple Music, SoundCloud, and Internet Archive media, handles optical discs (`cdrom` ioctls / `libdvdread` / `ffmpeg`), and drives `MPRIS2` + `OpenVR`.
2. **Console UI (`http://127.0.0.1:18888`):** A lightweight React frontend synced over WebSockets. Open it in a native app window, inside SteamVR, or from any browser on your LAN as a couch remote.

```bash
# Development
cargo run -p simp -- --daemon
npm run dev:ui

# Release Bundles (dist/)
./packaging/scripts/package-release.sh
SIMP_TARGET_ARCH=aarch64 ./packaging/scripts/package-release.sh
./packaging/scripts/package-windows.sh
```

---

## Attributions & Provenance

* **Internet Archive Integration:** Special thanks to **Jake Johnson ([@jjjake](https://github.com/jjjake))** ([`internetarchive`](https://github.com/jjjake/internetarchive)) and the **[Internet Archive (`archive.org`)](https://archive.org/developers/)** team.
* **Console UX Inspiration:** Sony PlayStation 3 **XrossMediaBar (XMB)**.
* **Full Provenance Ledger:** See **[`ATTRIBUTIONS.md`](ATTRIBUTIONS.md)** for complete credits across `Symphonia`, `Rodio`, `Lofty`, VideoLAN (`libdvdcss` / `libdvdread`), `MusicBrainz` & `Cover Art Archive`, Chromium `CDM_10` / ISO `CENC`, `libcurl`, Valve `OpenVR`, and `Decky Loader`.

---

## Disclaimer

> **SIMP (Simple Integrated Media Player)** is an independent open-source project and is **not** affiliated with, endorsed by, or sponsored by **Valve Corporation**, **Apple Inc.**, **SoundCloud**, **Internet Archive**, or the **MetaBrainz Foundation**. All product and company names are trademarks of their respective owners and are used strictly for identification and interoperability (nominative fair use).
