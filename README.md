# SIMP — Simple Integrated Media Player (`v0.1.0-alpha`)

> **A microscopic-footprint, update-proof background media player built as a "first-class citizen" for SteamOS, Bazzite, and `gamescope` handhelds/consoles.**

[![Status: v0.1.0-alpha Pilot](https://img.shields.io/badge/version-0.1.0--alpha%20(Pilot)-00e5ff?style=flat-square)](#)
[![Platform: SteamOS / Linux](https://img.shields.io/badge/platform-SteamOS%20%7C%20Bazzite%20%7C%20Linux-1a1a1a?style=flat-square)](#)
[![Backend: Rust + Tokio](https://img.shields.io/badge/backend-Rust%20%2B%20Tokio-dea584?style=flat-square)](#)
[![UI: Tauri v2 + React](https://img.shields.io/badge/UI-Tauri%20v2%20%2B%20React-24c8db?style=flat-square)](#)

---

## Why SIMP?

Running desktop media apps alongside demanding AAA games in SteamOS Game Mode burns hundreds of megabytes of RAM, drains battery, and breaks console immersion when switching windows. Plugin-only audio solutions frequently break whenever Valve updates the Steam client UI.

**SIMP** is engineered from the ground up for handheld and living-room gaming consoles:

* **Microscopic Background Footprint:** A decoupled headless Rust audio daemon (`simp --daemon`, powered by `tokio` and `mimalloc`) idles in the low single-digit megabytes of RAM with **zero WebView overhead** when the UI is closed.
* **Native SteamOS Quick Access Menu (QAM) Integration:** Hooks directly into Linux `MPRIS2` (`org.mpris.MediaPlayer2.org.simp.player`) via D-Bus. Album artwork, track metadata, hardware volume buttons, and transport controls work natively inside the Steam Deck `...` Quick Access Menu and Bluetooth headsets—surviving every SteamOS system update.
* **OLED Console Mode UI:** When foregrounded in `gamescope`, SIMP renders a true-black (`#000000`) distraction-free console interface with software CSS pixel-shifting (preventing OLED burn-in), zero-re-render `requestAnimationFrame` progress interpolation, and hybrid **Touch (`>= 48x48px`) + Gamepad (`D-Pad` / `ABXY` / `L1/R1`)** navigation.

---

## `v0.1.0-alpha` (Pilot / MVP) Capabilities

### 1. Local Audio & Removable Storage (`MP3`, `FLAC`, `WAV`, `M4A`, `OGG`)
* Native decoding and byte-level seeking via `rodio` + `symphonia` routed directly to PipeWire/PulseAudio.
* Auto-discovers music across `~/Music`, custom directories, and removable USB-C drives / MicroSD cards (`/run/media/`).
* **Non-Destructive Hotplug Index:** Unplugging a USB drive or swapping a MicroSD card preserves your indexed metadata in SQLite (`library.db`) so tracks appear instantaneously when reconnected.

### 2. Native Steam Soundtracks (OSTs)
* Automatically parses `~/.local/share/Steam/steamapps/libraryfolders.vdf` across internal NVMe, MicroSD, and external drives to discover downloaded `<library>/steamapps/music/` soundtracks.
* Smart artwork cascade: extracts embedded ID3v2/Vorbis cover art via `lofty` or falls back to directory cover assets, caching active artwork in `/tmp` RAM disk for zero SSD write wear.

### 3. Spotify Premium
* **Unified PKCE OAuth:** Single browser login via local callback trap authenticates both playlist/library browsing (`rspotify` + `moka` pre-warmed metadata cache) and native encrypted audio streaming (`librespot`), plus **Spotify Connect** LAN casting.

### 4. Apple Music (Lazy-Loaded Virtual Sink)
* Integrates `MusicKit JS` via an on-demand Virtual Sink facade (`AppleMusicSink`), keeping local, OST, and Spotify playback 100% pure-Rust while supporting FairPlay DRM streams when Apple Music is active.

### 5. Bidirectional Volume Normalization
* Normalizes volume scales seamlessly across SteamOS MPRIS (`f64`), local/OST audio (`f32`), and Spotify Connect (`u16`) so switching sources never causes audio spikes.

---

## Architecture Overview

```text
simp/
├── crates/
│   ├── simp-protocol/    # Shared serde command, event & metadata contracts
│   ├── simp-core/        # Audio Orchestrator, sinks, VDF/SQLite indexer & MPRIS2
│   └── simp-daemon/      # Headless systemd service + local Unix Socket / WS server
├── src-tauri/            # Unified `simp` binary (`--daemon` headless vs `--ui` Tauri v2)
├── packages/
│   └── simp-client/      # Shared TypeScript WebSocket SDK & React hooks
└── ui/                   # OLED Console Mode React + Vite frontend
```

* **`simp --daemon`:** Runs persistently in the background via `systemd` user service (`~/.config/systemd/user/simp.service`).
* **`simp` (UI Mode):** Launches from your Steam Library inside `gamescope`, attaches to the running daemon over local IPC, and frees 100% of WebView memory the moment you close the window.

---

## Post-Pilot Roadmap (`v0.2+`)

* [ ] **Decky Loader Companion (`simp-decky`):** Optional lightweight React QAM drawer connecting directly to `simp --daemon` (`ws://127.0.0.1:18888/ws`) for in-game playlist browsing and source switching.
* [ ] **External USB Optical CD-ROM Playback (`cdda://`):** Plug-and-play Red Book Audio CD support over USB (`/dev/sr0`) with RAM read-ahead spin-down buffering and automatic **MusicBrainz DiscID + Cover Art Archive** lookup.
* [ ] **Modality B — "Full Fat Y2K / Winamp Mode":** Skeuomorphic Frutiger Aero / Winamp skins and real-time 60fps WebGL/Canvas audio visualizers powered by a Rust FFT spectrum analyzer (gated for Desktop Mode / AC power).

---

## License

Private / Pre-Release Alpha (`v0.1.0-alpha`).
