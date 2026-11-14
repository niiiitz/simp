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

## 2. Console UX, Demoscene Visualizer & Generative Art Inspiration

* **Sony Interactive Entertainment — PlayStation 3 XrossMediaBar (XMB)**:
  * SIMP's two-column spatial controller navigation (`ui/src/hooks/useGamepadNavigation.ts` and `ui/src/views/LibraryBrowserView.tsx`) is an homage to the award-winning PlayStation 3 XMB interface: moving the cursor up and down the left category column automatically previews content in the right pane after a short debounce, pressing D-Pad Right steps directly onto the first playable item (bypassing auxiliary header filters), and pressing `B` walks back up the hierarchy.
* **Cheng Lou ([@chenglou](https://github.com/chenglou)) — [Pretext Variable Typographic ASCII](https://chenglou.me/pretext/variable-typographic-ascii/)**:
  * Directly inspired SIMP's `VIZ: GLYPH` mode (`ui/src/components/PlayerBackgroundVisualizer.tsx`): treating typographic character density, weight, and punctuation geometry as a real-time luminance and motion medium, backed by a zero-allocation 8×8 bitmap glyph LUT (`Uint32Array` `ImageData` blitting with 4×4 Bayer ordered dithering and live synced-lyric character stamping).
* **Andrei Fomin — [*Effulgence RPG*](https://andreifomin.itch.io/effulgencerpg)**:
  * Inspired the volumetric glowing CRT phosphor aesthetic, 3D relief shading sculpted from album artwork luminance, and deep shadow-to-highlight color grading in `VIZ: GLYPH`.
* **Tetsuya Mizuguchi, United Game Artists & Enhance — *Rez* (2001) & *Tetris Effect* (2018)**:
  * Inspired SIMP's synesthetic audio-visual coupling — where sub-bass onsets, mid-range harmonics, and high-frequency transients drive geometric pulses, scanline datamosh bursts, wireframe horizon motion, and bespoke track-transition lock-on sequences.
* **Drool (Marc Flury & Brian Gibson) — *Thumper* (2016) & Parallax Software — *Descent* (1995)**:
  * Directly inspired `VIZ: VERTIGO` (*Vertigo Corridor*): banking 6-DOF octagonal tunnel architecture, forward-chasing *Thumper* chrome floor chevrons and neon rails, vanishing-point vector reticles, and floating 3D holographic lyric banners.
* **Kai Krause & MetaCreations — *Bryce 3D* (1994) & 1990s Mead *Trapper Keeper* CGI Art**:
  * Directly inspired `VIZ: TRAPPER` (*90s Bryce Trapper*): raytraced-style chrome spheres, orbiting wireframe pyramids, receding perspective checkerboard floors, Amiga copper horizon rasters, and a 2-of-3 geometric Rock-Paper-Scissors arena.
* **Nullsoft (Justin Frankel, Christophe Thibault & Contributors) — Winamp Spectrum Analyzer & Advanced Visualization Studio (`AVS`)**:
  * Directly inspired `VIZ: AVS`: parametric `SuperScope` waveform ribbons, 3D starfield warp interleaved with live timed SoundCloud comment and synced lyric pills, and a 16-band logarithmic spectrum analyzer with gravity peak-hold caps.
* **The 8-Bit & 16-Bit Demoscene Community & Artiom "Megus" Fedosov ([*"Creativity Through Limitation: 8-bit Demoscene"*](https://medium.com/@megus/creativity-through-limitation-8-bit-demoscene-68266b918e4a))**:
  * Inspired `VIZ: 64K` and SIMP's broader engineering ethos of achieving rich visual expression within tight CPU/battery budgets: Amiga-style `Copperbars` (horizontal raster scanline gradient bars oscillating in sine/cosine phase), 3D perspective synth horizons, and classic `DYCP` (*Different Y Character Position*) sine-wave scrollers carrying track metadata, synced lyrics, and live SoundCloud community "greetz".
* **[`Nannou`](https://github.com/nannou-org/nannou) ([*Why Nannou? Goals*](https://guide.nannou.cc/why_nannou.html#goals)) & [`Processing` / `p5.js`](https://github.com/processing/p5.js) (The Processing Foundation)**:
  * Studied when designing SIMP's hybrid Rust-DSP + Canvas2D visualizer architecture (`crates/simp-core/src/viz.rs` and `ui/src/components/PlayerBackgroundVisualizer.tsx`), including lock-free audio sample ring-buffer tapping (`AudioTapSource<S>`), 30 Hz `AudioSpectrumTick` feature extraction, and immediate-mode 2D generative math primitives.
* **[`WASM-4`](https://wasm4.org) (Bruno Garcia / `@aduros`), [`MicroW8`](https://microw8.github.io) (exoticorn), [`PICO-8`](https://www.lexaloffle.com/pico-8.php) (Joseph White / Lexaloffle), and [`Pouët.net`](https://www.pouet.net) Demoscene Productions**:
  * Directly inspired SIMP's deterministic demoscene math primitives and transition choreography (`ui/src/components/PlayerBackgroundVisualizer.tsx` and `ui/src/components/visualizers/scenes/`): combining high-DPI `1280×720` sub-pixel vector rendering, SNES Mode-7 perspective floors, water wave heightfields, and classic hardware transitions (SNES `MOSAIC`, RPG battle swirl, VHS head-switching tear, and CRT degauss wipes).
* **1980s/1990s Broadcast Music Television (*MTV* Lower-Third Chyrons & `VH1 Pop-Up Video`, created by Woody Thompson & Tad Low) + [`Wikimedia REST API`](https://en.wikipedia.org/api/rest_v1/)**:
  * Inspired SIMP's faded-HUD **"Video Mode"** broadcast overlay (`ui/src/components/visualizers/VisualizerOverlayHud.tsx`) and encyclopedia trivia engine (`crates/simp-core/src/factoids.rs`), surfacing soft VHS-styled track intro chyrons (`0.4s–8.6s`), `T-15s` `"UP NEXT"` cable lower-thirds, and 2-part sequential VH1-style "Pop-Up Video" speech bubbles fetched from MusicBrainz and Wikipedia REST v1 / Search APIs.
* **Classic Console & Arcade Art Direction (Moodboard Visualizer Pack `a`–`h` in `ui/src/components/visualizers/scenes/`)**:
  * *Rhythm Stage (`VIZ: RHYTHM`, `rhythmScene.ts`)*: Homage to Konami's *Dance Dance Revolution*, Nintendo SPD1's *Rhythm Tengoku / Rhythm Heaven* & *WarioWare, Inc.*, Crypton Future Media's *Hatsune Miku* live projection concerts, and Namco's *Katamari Damacy*.
  * *Midnight Mountain (`VIZ: MIDNIGHT`, `midnightScene.ts`)* & *Dark Fantasy Sanctum (`VIZ: SANCTUM`, `sanctumScene.ts`)*: Homage to Konami's *Castlevania: Symphony of the Night* & *Rondo of Blood*, FromSoftware's *Dark Souls* soapstone messages, and 16-bit SNES multi-layer raster parallax & water-reflection scanline engines.
  * *Cosmic Warp & 50s Saucer (`VIZ: COSMOS`, `cosmosScene.ts`)*: Homage to 1950s sci-fi practical-effect flying saucers (*Plan 9 from Outer Space*) and volumetric gravitational-lensing space odysseys.
  * *Coral Reef (`VIZ: REEF`, `reefScene.ts`)* & *Y2K Vaporwave Odyssey (`VIZ: VAPORWAVE`, `vaporwaveScene.ts`)*: Homage to Novotrade/Sega's *Ecco the Dolphin*, Sega AM2's *OutRun* & *Space Harrier* super-scaler horizons, Windows 95 *Solitaire* (Wes Cherry) bouncing card cascades, classic *AOL Instant Messenger* chat windows, and Macintosh Plus *Floral Shoppe* vaporwave aesthetics.
  * *Retro Arcade Remix (`VIZ: ARCADE`, `arcadeScene.ts`)*: Homage to Namco (*Pac-Man*), Williams Electronics (*Joust*), Atari (*Pong*, *Breakout*, *Missile Command*), Nintendo (*Donkey Kong*), and Taito (*Space Invaders*, *Arkanoid*).


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
* **Robert Bristow-Johnson — *Cookbook Formulae for Audio Equalizer Biquad Filter Coefficients* (`Audio-EQ-Cookbook`)**:
  * Reference for SIMP's lock-free 10-band stereo biquad cascade (`32 Hz` low-shelf, `64 Hz–8 kHz` peaking EQ, `16 kHz` high-shelf) and `130 Hz–4.5 kHz` band-limited Mid/Side Butterworth vocal isolation/removal filters in `crates/simp-core/src/dsp.rs`.

---

## 4. Optical Media (`CD-DA` & `DVD-Video`), Cover Art & Synced Lyrics Resolution

* **Tran Xuan Thang ([@tranxuanthang](https://github.com/tranxuanthang)) & the [`LRCLIB`](https://lrclib.net) Project ([`tranxuanthang/lrclib`](https://github.com/tranxuanthang/lrclib))**:
  * Thank you for building and operating the open, crowd-sourced synchronized lyrics database (`https://lrclib.net/docs`). Powers SIMP's native Rust time-synced LRC & plain lyrics resolver (`crates/simp-core/src/lyrics.rs`), pairing local `.lrc` sidecar discovery with duration-matched `/api/get` and `/api/search` lookups across Local, Steam OST, Apple Music, SoundCloud, and Internet Archive tracks.
* **VideoLAN Project ([`libdvdcss`](https://code.videolan.org/videolan/libdvdcss), [`libdvdread`](https://code.videolan.org/videolan/libdvdread), [`libdvdnav`](https://code.videolan.org/videolan/libdvdnav), and [`VLC`](https://www.videolan.org/vlc/))**:
  * Reference for SIMP's zero-bundled runtime `dlopen`/`LoadLibraryW` integration with user-supplied `libdvdcss` (`dvdcss_open`, `dvdcss_seek`, `dvdcss_read` — including automatic discovery inside Linux VLC Flatpak runtimes), as well as the DVD-Video `VIDEO_TS.IFO` (`VMGI_MAT`, `TT_SRPT`) and `VTS_XX_0.IFO` (`VTSI_MAT`, `VTS_PGCIT`) binary table specifications, BCD frame timing, VOBU NAV pack alignment (`0x000001BF`), and MPEG-2 PES `private_stream_1` (`0xBD`) AC-3 / SPU subtitle sub-stream headers in `crates/simp-core/src/sinks/dvd.rs`.
* **MetaBrainz Foundation ([`MusicBrainz`](https://musicbrainz.org) & [`Cover Art Archive`](https://coverartarchive.org))**:
  * Reference for Red Book Audio CD TOC SHA-1 DiscID calculation (`crates/simp-core/src/sinks/cdda.rs`) and polite rate-limited cover art resolution (`crates/simp-core/src/library/artwork.rs`).
* **Linux Kernel `<linux/cdrom.h>` & Microsoft Win32 `ntddcdrm.h`**:
  * Reference for raw 2352-byte Red Book CD-DA sector reading via `CDROMREADTOCHDR` / `CDROMREADTOCENTRY` / `CDROMREADAUDIO` on Linux and `IOCTL_CDROM_READ_TOC` / `IOCTL_CDROM_RAW_READ` on Windows.

---

## 5. Streaming Protocols & Content Decryption Specifications

* **Chromium Open Source Project (`media/cdm/api/content_decryption_module.h`) & ISO/IEC 23001-7 (`CENC` / `cbcs`)**:
  * Reference for SIMP's in-process `ContentDecryptionModule_10` and `Host_10` C++ vtable FFI bridge (`crates/simp-core/src/sinks/apple_native/cdm_host.rs`) and ISO-BMFF fragmented MP4 (`moov`/`moof`/`mdat`, `sinf`/`schi`/`tenc`, and AES-128-CBC 1:9 pattern decryption in `mp4_cbcs.rs`).
* **SoundCloud Developers API ([Authentication Guide](https://developers.soundcloud.com/docs/api/guide#authentication), [Credential Rotation](https://developers.soundcloud.com/docs/api/credential-rotation), [API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use#changes), and [Branding & Attribution Guidelines](https://developers.soundcloud.com/docs/api/buttons-logos#how-to-properly-attribute-in-your-app)), IETF RFC 7636 (`PKCE`) & Cloudflare Workers**:
  * Reference for OAuth 2.1 Authorization Code + PKCE (`S256`) and `client_credentials` authentication brokered through a zero-storage, stateless **Cloudflare Worker** token proxy (`packaging/cloudflare/simp-tap-67/worker.js`, keeping `client_secret` out of distributed binaries), official 7-bar Cloudmark attribution (`ui/src/components/SoundCloudLogo.tsx`), volatile RAM-only HLS AAC/fMP4 stream transcodings, `POST /disconnect` session revocation, waveform peak envelopes, and timed track comments (`crates/simp-core/src/sinks/soundcloud_api.rs` and `soundcloud.rs`).
* **Apple MusicKit & Web Playback API**:
  * Reference for ES256 (`P-256` ECDSA) developer token signing, storefront catalog resolution, artist profile & discography views, cloud library pagination, and personal/algorithmic radio station seeding (`crates/simp-core/src/sinks/apple_api.rs`).
* **Daniel Stenberg & the [`curl` / `libcurl`](https://curl.se/libcurl/) Project**:
  * Reference for SIMP's in-process `libcurl.so.4` C FFI connection pool (`crates/simp-core/src/http_pool.rs`) enabling persistent TLS + HTTP/2 connection reuse without bloating the binary.

---

## 6. SteamOS, Gamescope, OpenVR, macOS, Windows & Cross-Compilation Ecosystem

* **Valve Corporation ([`SteamOS`](https://store.steampowered.com/steamos), [`Gamescope`](https://github.com/ValveSoftware/gamescope), and [`OpenVR`](https://github.com/ValveSoftware/openvr)) & The Khronos Group ([`OpenXR`](https://www.khronos.org/openxr/) & W3C [`xr-standard` Gamepad Mapping](https://immersive-web.github.io/webxr-gamepads-module/))**:
  * Reference for Valve Data Format (`libraryfolders.vdf`, `appmanifest_*.acf`, and binary `shortcuts.vdf`) parsing, native Linux `/dev/hidraw*` Valve Steam Controller (`0x28de`) lizard-mode & gamepad packet decoding (`crates/simp-core/src/gamepad.rs`), zero-dependency `libopenvr_api.so` `IVRSystem` background VR controller polling (`VRControllerState001_t`), OpenVR/SteamVR action manifests (`packaging/openvr/actions.json`) for Steam Frame (Valve Roy), Valve Index (Knuckles), and Oculus Touch controllers, and W3C `xr-standard` WebXR thumbstick/button + 6DoF laser-pointer anti-thrash handoff (`ui/src/hooks/useGamepadNavigation.ts`).
* **[`SteamDeckHomebrew / Decky Loader`](https://github.com/SteamDeckHomebrew/decky-loader)**:
  * Reference and plugin host ecosystem for SIMP's optional Quick Access Menu (`decky-plugin`) companion drawer.
* **freedesktop.org (`org.mpris.MediaPlayer2`) & KDE (`org.kde.StatusNotifierItem`)**:
  * D-Bus specifications powering SIMP's native media key arbitration and Linux desktop system tray integration.
* **[`Souvlaki`](https://github.com/Sinono3/souvlaki), [`rust-objc`](https://github.com/SSheldon/rust-objc), [`core-foundation-rs`](https://github.com/servo/core-foundation-rs) & Apple macOS Frameworks (`AppKit`, `WebKit`, `MediaPlayer`, `IOKit`)**:
  * Powers SIMP's native macOS application bundle (`src-tauri/src/macos_app.rs`), `NSStatusItem` Menu Bar tray, `WKWebView` presentation layer, `MPNowPlayingInfoCenter` / `MPRemoteCommandCenter` Control Center & media key integration (`crates/simp-core/src/mpris.rs`), and `IOHIDManager` USB/Bluetooth gamepad input reader (`crates/simp-core/src/gamepad.rs`).
* **Microsoft Win32 (`Shell_NotifyIconW`, `XInput`, `WebView2`), [`MinGW-w64`](https://www.mingw-w64.org/) & [`Zig` / `cargo-zigbuild`](https://github.com/rust-cross/cargo-zigbuild)**:
  * Powers SIMP's single-instance Windows system tray & headless background worker lifecycle (`src-tauri/src/main.rs`) and reproducible multi-architecture cross-compilation (`x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `x86_64-pc-windows-gnu`, `aarch64-apple-darwin`, and `x86_64-apple-darwin`) from Linux or macOS hosts.
