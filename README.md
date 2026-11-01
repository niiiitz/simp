<div align="center">
  <img src="ui/public/simp-icon-dark.png" width="160" alt="SIMP Logo" />

  # SIMP — Simple Integrated Media Player (`v0.1.0-alpha`)

  **A microscopic-footprint, update-proof background media player built for SteamOS, Bazzite, and `gamescope` handhelds/consoles.**

  [![Status: v0.1.0-alpha Pilot](https://img.shields.io/badge/version-0.1.0--alpha%20(Pilot)-00e5ff?style=flat-square)](#)
  [![Platform: SteamOS / Linux](https://img.shields.io/badge/platform-SteamOS%20%7C%20Bazzite%20%7C%20WSL2-1a1a1a?style=flat-square)](#)
  [![Backend: Rust + Tokio](https://img.shields.io/badge/backend-Rust%20%2B%20Tokio-dea584?style=flat-square)](#)
  [![UI: Tauri v2 + React](https://img.shields.io/badge/UI-Tauri%20v2%20%2B%20React-24c8db?style=flat-square)](#)
</div>

---

## Why SIMP?

Running desktop media apps alongside demanding AAA games in SteamOS Game Mode burns hundreds of megabytes of RAM, drains battery, and breaks console immersion. **SIMP** separates playback from presentation:

* **Headless Rust Audio Daemon (`simp --daemon`):** Powered by `tokio` (2 worker threads) and `mimalloc` with **zero WebView overhead** when the UI is closed, plus 60-second PipeWire DSP idle-suspend (`0.00%` CPU when paused).
* **Native SteamOS Quick Access Menu (QAM) & `MPRIS2`:** Hooks into Linux `MPRIS2` (`org.mpris.MediaPlayer2.org.simp.player`) via `souvlaki` and pairs with a zero-Python-backend `simp-decky` QAM drawer over local WebSocket (`ws://127.0.0.1:18888/ws`).
* **OLED Console Mode UI (`simp`):** True-black (`#000000`) interface with 30-second battery auto-dim + wake-tap guard, 60fps `requestAnimationFrame` scrub bar, and hybrid **Touch (`>= 48x48px`) + Gamepad (`ABXY` / `L1/R1` / `L2/R2`)** navigation.

---

## Feature Phases & Current Status

### ✅ Pilot Phase 1 & 2 — Core Engine, Local/USB, Steam OSTs & Console UI *(Live)*
* [x] **Dual-Mode Binary (`simp --daemon` + `simp` UI)** & `simp-decky` QAM drawer over `ws://127.0.0.1:18888/ws`.
* [x] **Valve Hybrid Storage:** `.vdf` settings (`~/.config/simp/settings.vdf`) + SQLite `WAL` index (`~/.local/share/simp/library.db`) with non-destructive USB/MicroSD hotplug tracking.
* [x] **Local Audio & Steam Soundtracks:** `rodio` + `symphonia` playback & seeking (`FLAC`, `MP3`, `WAV`, `M4A`, `OGG`, `OPUS`), `libraryfolders.vdf` discovery (SteamOS + WSL2 Windows mounts), `.mp3`/`.wav` twin deduplication, and `album_art.png` / ID3 cover extraction.
* [x] **Handheld Safeguards:** Anti-runaway-skip circuit breaker (pauses after 3 consecutive unreachable tracks), 60s PipeWire idle-suspend, interactive master volume persistence, custom folder picker, and SQLite playlist builder.

### 🚧 Pilot Phase 3 — Spotify Premium Engine *(Next Up)*
* [ ] **Port `8888` PKCE OAuth Trap:** Single browser sign-in authenticating both `rspotify` library/playlist sync (`moka` cache) and native `librespot` encrypted audio streaming + Spotify Connect.
* [ ] **Seamless Mixed-Queue Transitions:** Interleave local tracks, Steam OSTs, and Spotify tracks with normalized volume.

### ⏳ Pilot Phase 4 — Apple Music Virtual Sink *(Planned)*
* [ ] **Lazy-Loaded `<AppleMusicDriver />`:** On-demand `MusicKit JS v3` virtual sink (`AppleMusicSink`) for FairPlay DRM streams without bloating pure-Rust local/Spotify playback.

### 🔮 Post-Pilot (`v0.2+`)
* [ ] **External USB Optical CD-ROM (`cdda://`):** Plug-and-play `/dev/sr0` Audio CD playback with MusicBrainz DiscID + Cover Art Archive lookup.
* [ ] **Modality B ("Full Fat Y2K / Winamp Mode"):** Skeuomorphic skins + 60fps Rust FFT spectrum visualizer (gated for Desktop Mode / AC power).

---

## Quick Start (WSL2 / Linux Dev)

```bash
# 1. Start the headless audio & IPC daemon (127.0.0.1:18888)
cargo run -p simp -- --daemon

# 2. Launch the Vite OLED Console UI (http://localhost:1420)
npm run dev:ui
```

---

## Workspace Layout

```text
simp/
├── crates/
│   ├── simp-protocol/    # Shared serde command, event & metadata contracts
│   ├── simp-core/        # Audio Orchestrator, sinks, VDF/SQLite indexer & MPRIS2
│   └── simp-daemon/      # Headless systemd service + WebSocket / Artwork HTTP server
├── src-tauri/            # Unified `simp` binary (`--daemon` headless vs `--ui` Tauri v2)
├── packages/simp-client/ # Shared TypeScript WebSocket SDK (`@simp/client`)
├── ui/                   # OLED Console Mode React + Vite frontend
└── decky-plugin/         # `simp-decky` SteamOS Quick Access Menu (QAM) drawer
```

---

## License

Private / Pre-Release Alpha (`v0.1.0-alpha`).
