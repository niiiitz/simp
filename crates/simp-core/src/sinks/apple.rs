use crate::sinks::local::LocalAudioEngine;
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use simp_protocol::{PlaybackEvent, SimpSettings};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;

static HEADLESS_WIDEVINE_WORKER: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn worker_slot() -> &'static Mutex<Option<Child>> {
    HEADLESS_WIDEVINE_WORKER.get_or_init(|| Mutex::new(None))
}

/// Returns true when Zero-Browser Native Rust Widevine CDM (`libwidevinecdm.so` FFI) mode is enabled.
/// Enabled automatically when `SIMP_NATIVE_APPLE_CDM=1` or `~/.config/simp/enable-native-cdm` exists,
/// and falls back seamlessly to the browser worker if `libwidevinecdm.so` is unavailable.
pub fn is_native_apple_cdm_preferred() -> bool {
    if let Ok(val) = std::env::var("SIMP_NATIVE_APPLE_CDM") {
        let v = val.trim().to_lowercase();
        if v == "0" || v == "false" || v == "off" {
            return false;
        }
        if v == "1" || v == "true" || v == "on" {
            return true;
        }
    }
    if let Some(cfg_dir) = dirs::config_dir() {
        if cfg_dir.join("simp/enable-native-cdm").exists() {
            return true;
        }
    }
    false
}

/// Pillar 4: Apple Music Sink Facade, Native Rust Widevine Host & ES256 Developer Token Signer.
/// Supports both:
/// 1. **Zero-Browser Native Rust Widevine Mode**: Decrypts `28:ctrp256` HLS fMP4 segments in memory via
///    `libwidevinecdm.so` FFI and plays them through a native `LocalAudioEngine` (`Symphonia + Rodio`).
/// 2. **Browser Worker Fallback (`?worker=apple`)**: Emits `PlaybackEvent::AppleSinkCommand` to `<AppleMusicDriver />`.
#[derive(Clone, Default)]
pub struct AppleMusicSink {
    pub volume: f64,
    pub is_authenticated: bool,
    pub native_engine: Arc<Mutex<Option<LocalAudioEngine>>>,
    pub using_native_engine: bool,
}

#[derive(Clone, Debug, Default)]
pub struct ResolvedAppleCredentials {
    pub team_id: String,
    pub key_id: String,
    pub private_key_path: String,
    pub private_key_pem: Option<String>,
    pub pre_signed_dev_token: Option<String>,
    pub music_user_token: Option<String>,
}

impl AppleMusicSink {
    pub fn new() -> Self {
        Self {
            volume: 0.80,
            is_authenticated: false,
            native_engine: Arc::new(Mutex::new(None)),
            using_native_engine: false,
        }
    }

    pub fn set_volume(&mut self, normalized_vol: f64) {
        self.volume = normalized_vol.clamp(0.0, 1.0);
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                eng.set_volume(self.volume);
            }
        }
    }

    pub fn emit_load_and_play(
        &self,
        broadcast_tx: &broadcast::Sender<PlaybackEvent>,
        uri: &str,
        position_ms: u32,
    ) {
        Self::ensure_headless_widevine_worker();
        let _ = broadcast_tx.send(PlaybackEvent::AppleSinkCommand {
            action: "load_and_play".to_string(),
            uri: Some(uri.to_string()),
            position_ms: Some(position_ms),
            volume: Some(self.volume),
        });
    }

    pub fn emit_play(&self, broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        Self::ensure_headless_widevine_worker();
        let _ = broadcast_tx.send(PlaybackEvent::AppleSinkCommand {
            action: "play".to_string(),
            uri: None,
            position_ms: None,
            volume: Some(self.volume),
        });
    }

    pub fn is_headless_worker_active() -> bool {
        if let Ok(mut guard) = worker_slot().lock() {
            if let Some(ref mut child) = *guard {
                if let Ok(None) = child.try_wait() {
                    return true;
                }
                *guard = None;
            }
        }
        false
    }

    pub fn kill_headless_widevine_worker() {
        if let Ok(mut guard) = worker_slot().lock() {
            if let Some(ref mut child) = *guard {
                let _ = child.kill();
                let _ = child.wait();
            }
            *guard = None;
        }
        let _ = Command::new("pkill")
            .args(["-f", "simp-widevine-worker"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let _ = Command::new("pkill")
            .args(["-f", "18888/?worker=apple"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    /// Terminates the headless Widevine worker and wipes cached Apple Music / MusicKit auth storage
    /// (`webappsstore.sqlite`, `cookies.sqlite`, `Local Storage`, `Session Storage`, `IndexedDB`, `Cookies`)
    /// across worker and window profiles while preserving `WidevineCdm` / `gmp-widevinecdm` binaries.
    pub fn purge_worker_auth_storage() {
        Self::kill_headless_widevine_worker();
        crate::sinks::apple_api::clear_cached_storefront();
        let Some(home) = dirs::home_dir() else {
            return;
        };

        // 1. Clean Firefox worker profiles (preserving `gmp-widevinecdm` and `user.js`)
        for ff_worker in [
            home.join(".var/app/org.mozilla.firefox/.mozilla/firefox/simp-widevine-worker"),
            home.join(".mozilla/firefox/simp-widevine-worker"),
        ] {
            if ff_worker.is_dir() {
                clean_stale_profile_locks(&ff_worker);
                for file_name in [
                    "webappsstore.sqlite",
                    "webappsstore.sqlite-wal",
                    "webappsstore.sqlite-shm",
                    "cookies.sqlite",
                    "cookies.sqlite-wal",
                    "cookies.sqlite-shm",
                ] {
                    let _ = std::fs::remove_file(ff_worker.join(file_name));
                }
                let _ = std::fs::remove_dir_all(ff_worker.join("storage"));
            }
        }

        // 2. Clean Chromium/Chrome worker & window profiles (preserving `WidevineCdm` and `First Run`)
        for chr_worker in [
            home.join(".local/share/simp/window-profile"),
            home.join(".local/share/simp/simp-widevine-worker-chromium"),
            home.join(".var/app/com.google.Chrome/config/google-chrome/simp-widevine-worker"),
            home.join(".var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/simp-widevine-worker"),
            home.join(".var/app/com.microsoft.Edge/config/microsoft-edge/simp-widevine-worker"),
            home.join(".var/app/org.chromium.Chromium/config/chromium/simp-widevine-worker"),
        ] {
            if chr_worker.is_dir() {
                clean_stale_profile_locks(&chr_worker);
                let default_dir = chr_worker.join("Default");
                if default_dir.is_dir() {
                    for sub in ["Local Storage", "Session Storage", "IndexedDB", "Service Worker"] {
                        let _ = std::fs::remove_dir_all(default_dir.join(sub));
                    }
                    for f in ["Cookies", "Cookies-journal"] {
                        let _ = std::fs::remove_file(default_dir.join(f));
                    }
                }
            }
        }
    }

    /// Ensures a headless Widevine CDM browser worker (`http://127.0.0.1:18888/?worker=apple`)
    /// is running in the background on Linux / SteamOS (Gamescope + Desktop Mode) so full-length
    /// DRM-protected Apple Music tracks stream via PipeWire even when `steamwebhelper` lacks Widevine.
    pub fn ensure_headless_widevine_worker() -> bool {
        if is_native_apple_cdm_preferred()
            && crate::sinks::apple_native::cdm_host::discover_widevine_cdm_library().is_some()
        {
            return true;
        }
        if Self::is_headless_worker_active() {
            return true;
        }
        // On WSL, the user's browser runs on the Windows host, so do not spawn a Linux browser inside WSL
        if std::env::var("WSL_DISTRO_NAME").is_ok()
            || Path::new("/proc/sys/fs/binfmt_misc/WSLInterop").exists()
        {
            return false;
        }

        if let Ok(mut guard) = worker_slot().lock() {
            if let Some(ref mut child) = *guard {
                if let Ok(None) = child.try_wait() {
                    return true;
                }
            }
            if let Some(child) = spawn_headless_widevine_browser() {
                *guard = Some(child);
                return true;
            }
        }
        false
    }

    pub fn emit_pause(&self, broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        let _ = broadcast_tx.send(PlaybackEvent::AppleSinkCommand {
            action: "pause".to_string(),
            uri: None,
            position_ms: None,
            volume: None,
        });
    }

    pub fn emit_seek(&self, broadcast_tx: &broadcast::Sender<PlaybackEvent>, position_ms: u32) {
        let _ = broadcast_tx.send(PlaybackEvent::AppleSinkCommand {
            action: "seek".to_string(),
            uri: None,
            position_ms: Some(position_ms),
            volume: None,
        });
    }

    pub fn emit_volume(&self, broadcast_tx: &broadcast::Sender<PlaybackEvent>, volume: f64) {
        let _ = broadcast_tx.send(PlaybackEvent::AppleSinkCommand {
            action: "set_volume".to_string(),
            uri: None,
            position_ms: None,
            volume: Some(volume.clamp(0.0, 1.0)),
        });
    }

    /// Resolves Apple Developer & MusicKit credentials from `SimpSettings`, process environment,
    /// or `.env` files (`~/.config/simp/.env` or `./.env`).
    pub fn resolve_credentials(settings: &SimpSettings) -> ResolvedAppleCredentials {
        let dotenv_map = load_dotenv_candidates();
        let get_val = |setting_val: &str, env_key: &str| -> String {
            if !setting_val.trim().is_empty() {
                return setting_val.trim().to_string();
            }
            if let Ok(v) = std::env::var(env_key) {
                if !v.trim().is_empty() {
                    return v.trim().to_string();
                }
            }
            if let Some(v) = dotenv_map.get(env_key) {
                if !v.trim().is_empty() {
                    return v.trim().to_string();
                }
            }
            String::new()
        };

        let team_id = get_val(&settings.services.apple_team_id, "APPLE_TEAM_ID");
        let key_id = get_val(&settings.services.apple_key_id, "APPLE_KEY_ID");
        let raw_key_path = get_val(
            &settings.services.apple_private_key_path,
            "APPLE_PRIVATE_KEY_PATH",
        );
        let normalized_path = if raw_key_path.is_empty() {
            String::new()
        } else {
            crate::library::vdf::normalize_platform_path(&raw_key_path)
                .to_string_lossy()
                .to_string()
        };

        let mut private_key_pem = None;
        if !normalized_path.is_empty() && Path::new(&normalized_path).is_file() {
            if let Ok(pem) = std::fs::read_to_string(&normalized_path) {
                private_key_pem = Some(pem);
            }
        } else {
            let inline_pem = get_val("", "APPLE_PRIVATE_KEY");
            if inline_pem.contains("BEGIN PRIVATE KEY") {
                private_key_pem = Some(inline_pem.replace("\\n", "\n"));
            }
        }

        let mut dev_token = get_val(
            &settings.services.apple_developer_token,
            "APPLE_DEVELOPER_TOKEN",
        );
        if dev_token.is_empty() {
            if let Some(embedded) = option_env!("SIMP_EMBEDDED_APPLE_DEV_TOKEN") {
                if !embedded.trim().is_empty() {
                    dev_token = embedded.trim().to_string();
                }
            }
        }
        let pre_signed_dev_token = if dev_token.is_empty() {
            None
        } else {
            Some(dev_token)
        };

        let mut user_token = get_val(
            &settings.services.apple_music_user_token,
            "APPLE_MUSIC_USER_TOKEN",
        );
        if user_token.is_empty() {
            if let Some(embedded_user) = option_env!("SIMP_EMBEDDED_APPLE_USER_TOKEN") {
                if !embedded_user.trim().is_empty() {
                    user_token = embedded_user.trim().to_string();
                }
            }
        }
        let music_user_token = if user_token.is_empty() {
            None
        } else {
            Some(user_token)
        };

        ResolvedAppleCredentials {
            team_id,
            key_id,
            private_key_path: normalized_path,
            private_key_pem,
            pre_signed_dev_token,
            music_user_token,
        }
    }

    /// Returns a valid Apple Music Developer Token (`ES256` JWT), either from a pre-signed
    /// override or by signing a fresh token with the `.p8` private key.
    pub fn get_or_sign_developer_token(settings: &SimpSettings) -> Result<String> {
        let creds = Self::resolve_credentials(settings);
        if let Some(token) = creds.pre_signed_dev_token {
            return Ok(token);
        }
        if creds.team_id.is_empty() || creds.key_id.is_empty() {
            return Err(anyhow!(
                "Missing APPLE_TEAM_ID or APPLE_KEY_ID in settings or .env"
            ));
        }
        let pem = creds.private_key_pem.ok_or_else(|| {
            anyhow!(
                "Apple Music .p8 private key not found at '{}' (set APPLE_PRIVATE_KEY_PATH)",
                creds.private_key_path
            )
        })?;

        sign_es256_developer_jwt(&creds.team_id, &creds.key_id, &pem, 86400 * 90)
    }
}

impl crate::sinks::AudioSink for AppleMusicSink {
    fn engine_kind(&self) -> simp_protocol::ActiveEngine {
        simp_protocol::ActiveEngine::AppleMusic
    }

    fn supports_uri(&self, uri: &str) -> bool {
        uri.starts_with("applemusic:")
    }

    fn load_and_play_track(
        &mut self,
        uri: &str,
        start_pos_ms: u32,
        epoch: u64,
        internal_event_tx: &tokio::sync::mpsc::UnboundedSender<PlaybackEvent>,
        broadcast_tx: &broadcast::Sender<PlaybackEvent>,
    ) -> Result<()> {
        if is_native_apple_cdm_preferred()
            && crate::sinks::apple_native::cdm_host::discover_widevine_cdm_library().is_some()
        {
            if let Ok(mut guard) = self.native_engine.lock() {
                let eng = guard.get_or_insert_with(LocalAudioEngine::new);
                eng.set_volume(self.volume);
                match eng.load_and_play(uri, start_pos_ms, epoch, internal_event_tx.clone()) {
                    Ok(()) => {
                        self.using_native_engine = true;
                        Self::kill_headless_widevine_worker();
                        return Ok(());
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Native Widevine CDM playback failed ({e}); falling back to browser worker"
                        );
                        self.using_native_engine = false;
                    }
                }
            }
        } else {
            self.using_native_engine = false;
        }

        self.emit_load_and_play(broadcast_tx, uri, start_pos_ms);
        Ok(())
    }

    fn resume_playback(
        &mut self,
        epoch: u64,
        internal_event_tx: &tokio::sync::mpsc::UnboundedSender<PlaybackEvent>,
        broadcast_tx: &broadcast::Sender<PlaybackEvent>,
    ) -> Result<()> {
        if self.using_native_engine {
            if let Ok(mut guard) = self.native_engine.lock() {
                if let Some(ref mut eng) = *guard {
                    return eng.play(epoch, internal_event_tx.clone());
                }
            }
        }
        self.emit_play(broadcast_tx);
        Ok(())
    }

    fn pause_playback(&mut self, broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        if self.using_native_engine {
            if let Ok(mut guard) = self.native_engine.lock() {
                if let Some(ref mut eng) = *guard {
                    eng.pause();
                }
            }
        }
        self.emit_pause(broadcast_tx);
    }

    fn suspend_sink(&mut self, broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                eng.release_pipewire_stream();
            }
        }
        self.emit_pause(broadcast_tx);
    }

    fn seek_playback(
        &mut self,
        position_ms: u32,
        epoch: u64,
        internal_event_tx: &tokio::sync::mpsc::UnboundedSender<PlaybackEvent>,
        broadcast_tx: &broadcast::Sender<PlaybackEvent>,
    ) -> Result<()> {
        if self.using_native_engine {
            if let Ok(mut guard) = self.native_engine.lock() {
                if let Some(ref mut eng) = *guard {
                    return eng.seek(position_ms, epoch, internal_event_tx.clone());
                }
            }
        }
        self.emit_seek(broadcast_tx, position_ms);
        Ok(())
    }

    fn sync_volume(&mut self, volume: f32, broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        self.set_volume(volume as f64);
        self.emit_volume(broadcast_tx, volume as f64);
    }

    fn live_position_ms(&self) -> Option<u32> {
        if self.using_native_engine {
            if let Ok(guard) = self.native_engine.lock() {
                if let Some(ref eng) = *guard {
                    return Some(eng.get_position_ms());
                }
            }
        }
        None
    }

    fn shutdown_sink(&mut self, broadcast_tx: &broadcast::Sender<PlaybackEvent>) {
        if let Ok(mut guard) = self.native_engine.lock() {
            if let Some(ref mut eng) = *guard {
                eng.release_pipewire_stream();
            }
        }
        self.emit_pause(broadcast_tx);
        Self::kill_headless_widevine_worker();
    }
}

/// Signs an Apple MusicKit Developer JWT (`alg: ES256`, P-256 ECDSA + SHA-256)
/// using `/usr/bin/openssl` and converts the ASN.1 DER ECDSA signature into
/// the 64-byte IEEE P1363 (`R || S`) format mandated by RFC 7518 Section 3.4.
pub fn sign_es256_developer_jwt(
    team_id: &str,
    key_id: &str,
    private_key_pem: &str,
    ttl_seconds: u64,
) -> Result<String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let exp = now + ttl_seconds.min(15_552_000); // Max 180 days per Apple spec

    let header_json = serde_json::json!({
        "alg": "ES256",
        "kid": key_id.trim(),
        "typ": "JWT"
    });
    let payload_json = serde_json::json!({
        "iss": team_id.trim(),
        "iat": now,
        "exp": exp
    });

    let header_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&header_json)?);
    let payload_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload_json)?);
    let signing_input = format!("{header_b64}.{payload_b64}");

    // Write key to a secure temporary file in /tmp with 0600 permissions for openssl signing
    let tmp_key_path = std::env::temp_dir().join(format!(
        ".simp_apple_key_{}_{}.p8",
        std::process::id(),
        now
    ));
    {
        let mut f = std::fs::File::create(&tmp_key_path)
            .context("Failed to create temporary .p8 key file")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = f.set_permissions(std::fs::Permissions::from_mode(0o600));
        }
        f.write_all(private_key_pem.as_bytes())?;
    }

    let sign_result = (|| -> Result<Vec<u8>> {
        let mut child = Command::new("openssl")
            .args(["dgst", "-sha256", "-sign"])
            .arg(&tmp_key_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to spawn `openssl` for ES256 signing")?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(signing_input.as_bytes())?;
        }

        let output = child.wait_with_output()?;
        if !output.status.success() {
            let err_str = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow!("openssl ECDSA sign failed: {}", err_str.trim()));
        }
        Ok(output.stdout)
    })();

    let _ = std::fs::remove_file(&tmp_key_path);
    let der_sig = sign_result?;
    let p1363_sig = ecdsa_der_to_p1363_64(&der_sig)?;
    let sig_b64 = URL_SAFE_NO_PAD.encode(p1363_sig);

    Ok(format!("{signing_input}.{sig_b64}"))
}

/// Converts an ASN.1 DER-encoded ECDSA signature (`SEQUENCE { r INTEGER, s INTEGER }`)
/// into the fixed 64-byte IEEE P1363 (`32-byte big-endian R || 32-byte big-endian S`) representation.
pub fn ecdsa_der_to_p1363_64(der: &[u8]) -> Result<[u8; 64]> {
    let mut pos = 0;
    if der.get(pos) != Some(&0x30) {
        return Err(anyhow!("Invalid DER ECDSA signature: expected SEQUENCE (0x30)"));
    }
    pos += 1;

    // Parse sequence length (1 or 2 bytes)
    let seq_len_byte = *der
        .get(pos)
        .ok_or_else(|| anyhow!("Truncated DER sequence length"))?;
    pos += 1;
    if seq_len_byte & 0x80 != 0 {
        let num_bytes = (seq_len_byte & 0x7f) as usize;
        pos += num_bytes;
    }

    let read_int = |pos: &mut usize| -> Result<[u8; 32]> {
        if der.get(*pos) != Some(&0x02) {
            return Err(anyhow!("Invalid DER ECDSA signature: expected INTEGER (0x02)"));
        }
        *pos += 1;
        let len = *der
            .get(*pos)
            .ok_or_else(|| anyhow!("Truncated DER integer length"))? as usize;
        *pos += 1;
        let bytes = der
            .get(*pos..*pos + len)
            .ok_or_else(|| anyhow!("Truncated DER integer body"))?;
        *pos += len;

        // Strip optional leading 0x00 sign pad byte if present
        let stripped = if bytes.len() > 32 && bytes[0] == 0x00 {
            &bytes[bytes.len() - 32..]
        } else {
            bytes
        };
        if stripped.len() > 32 {
            return Err(anyhow!("ECDSA coordinate exceeds 32 bytes for P-256"));
        }
        let mut out = [0u8; 32];
        out[32 - stripped.len()..].copy_from_slice(stripped);
        Ok(out)
    };

    let r = read_int(&mut pos)?;
    let s = read_int(&mut pos)?;

    let mut out = [0u8; 64];
    out[..32].copy_from_slice(&r);
    out[32..].copy_from_slice(&s);
    Ok(out)
}

fn load_dotenv_candidates() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut paths: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        paths.push(cwd.join(".env"));
    }
    if let Some(cfg_dir) = dirs::config_dir() {
        paths.push(cfg_dir.join("simp").join(".env"));
    }

    for path in paths {
        if let Ok(content) = std::fs::read_to_string(&path) {
            for raw_line in content.lines() {
                let line = raw_line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = line.split_once('=') {
                    let key = k.trim().to_string();
                    let val = v
                        .trim()
                        .trim_matches('\'')
                        .trim_matches('"')
                        .to_string();
                    map.entry(key).or_insert(val);
                }
            }
        }
    }
    map
}

const FIREFOX_WIDEVINE_USER_JS: &str = r#"// Auto-generated by SIMP for headless Widevine EME + PipeWire background playback
user_pref("media.eme.enabled", true);
user_pref("media.gmp-widevinecdm.visible", true);
user_pref("media.gmp-widevinecdm.enabled", true);
user_pref("media.gmp-manager.updateEnabled", true);
user_pref("media.autoplay.default", 0);
user_pref("media.autoplay.blocking_policy", 0);
user_pref("media.block-autoplay-until-in-foreground", false);
user_pref("media.autoplay.allow-extension-background-pages", true);
user_pref("dom.AudioContext.autoplay", true);
user_pref("media.VolumeScale", "1.0");
user_pref("media.default_volume", "1.0");
user_pref("media.hardwaremediakeys.enabled", false);
user_pref("dom.media.mediasession.enabled", false);
user_pref("widget.use-xdg-desktop-portal.file-picker", 0);
user_pref("widget.use-xdg-desktop-portal.mime-handler", 0);
user_pref("widget.use-xdg-desktop-portal.settings", 0);
user_pref("widget.use-xdg-desktop-portal.location", 0);
user_pref("widget.use-xdg-desktop-portal.open-uri", 0);
user_pref("toolkit.startup.max_resumed_crashes", -1);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.shell.checkDefaultBrowser", false);
"#;

fn copy_dir_recursive(src: &Path, dst: &Path) {
    let _ = std::fs::create_dir_all(dst);
    if let Ok(entries) = std::fs::read_dir(src) {
        for entry in entries.flatten() {
            let path = entry.path();
            let dest_path = dst.join(entry.file_name());
            if path.is_dir() {
                copy_dir_recursive(&path, &dest_path);
            } else if !dest_path.is_file() {
                let _ = std::fs::copy(&path, &dest_path);
            }
        }
    }
}

fn clean_stale_profile_locks(dir: &Path) {
    for lock_name in [
        "lock",
        ".parentlock",
        "parent.lock",
        "SingletonLock",
        "SingletonCookie",
        "SingletonSocket",
    ] {
        let p = dir.join(lock_name);
        if p.exists() || p.symlink_metadata().is_ok() {
            let _ = std::fs::remove_file(&p);
        }
    }
}

fn prepare_firefox_widevine_profile(ff_root: &Path, require_cdm_present: bool) -> Option<PathBuf> {
    if !ff_root.is_dir() {
        return None;
    }

    let mut best_profile: Option<PathBuf> = None;
    let mut found_cdm = false;
    if let Ok(entries) = std::fs::read_dir(ff_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "simp-widevine-worker" || name == "Crash Reports" || name == "Pending Pings" {
                continue;
            }
            if path.join("gmp-widevinecdm").is_dir() {
                best_profile = Some(path);
                found_cdm = true;
                break;
            }
            if (name.ends_with(".default-release") || name.ends_with(".default"))
                && best_profile.is_none()
            {
                best_profile = Some(path);
            }
        }
    }

    let worker_dir = ff_root.join("simp-widevine-worker");
    if worker_dir.join("gmp-widevinecdm").is_dir() {
        found_cdm = true;
    }

    if require_cdm_present && !found_cdm {
        return None;
    }

    let _ = std::fs::create_dir_all(&worker_dir);
    clean_stale_profile_locks(&worker_dir);

    if let Some(src_profile) = best_profile {
        let src_gmp = src_profile.join("gmp-widevinecdm");
        if src_gmp.is_dir() {
            copy_dir_recursive(&src_gmp, &worker_dir.join("gmp-widevinecdm"));
        }
        let src_prefs = src_profile.join("prefs.js");
        if src_prefs.is_file() && !worker_dir.join("prefs.js").is_file() {
            let _ = std::fs::copy(&src_prefs, worker_dir.join("prefs.js"));
        }
        let src_store = src_profile.join("webappsstore.sqlite");
        if src_store.is_file() && !worker_dir.join("webappsstore.sqlite").is_file() {
            let _ = std::fs::copy(&src_store, worker_dir.join("webappsstore.sqlite"));
        }
    }

    let _ = std::fs::write(worker_dir.join("user.js"), FIREFOX_WIDEVINE_USER_JS);
    Some(worker_dir)
}

fn apply_pipewire_env(cmd: &mut Command) {
    cmd.env("MOZ_NO_REMOTE", "1");
    cmd.env("GTK_USE_PORTAL", "0");
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR")
        .ok()
        .map(PathBuf::from)
        .or_else(dirs::runtime_dir)
        .unwrap_or_else(|| PathBuf::from("/run/user/1000"));

    if runtime_dir.is_dir() {
        cmd.env("XDG_RUNTIME_DIR", &runtime_dir);
        let pulse_sock = runtime_dir.join("pulse/native");
        if pulse_sock.exists() && std::env::var("PULSE_SERVER").is_err() {
            cmd.env("PULSE_SERVER", format!("unix:{}", pulse_sock.display()));
        }
    }
}

fn spawn_headless_widevine_browser() -> Option<Child> {
    let worker_url = "http://127.0.0.1:18888/?worker=apple";
    let home = dirs::home_dir()?;

    // Ensure any orphaned headless worker from a previous daemon run is terminated before
    // opening the `simp-widevine-worker` profile so `.parentlock` / `SingletonLock` is never contended.
    let _ = Command::new("pkill")
        .args(["-f", "simp-widevine-worker"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = Command::new("pkill")
        .args(["-f", "18888/?worker=apple"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    std::thread::sleep(std::time::Duration::from_millis(120));

    // IMPORTANT: Firefox `--headless` MUST be prioritized #1 on Linux/SteamOS!
    // Why: Firefox's `cubeb` audio backend connects directly to PulseAudio/PipeWire even in `--headless`
    // mode, whereas Chromium/Chrome `--headless=new` enables `switches::kMuteAudio` / `NullAudioSink`
    // in headless mode (which advances `<audio>` `currentTime` and moves the scrubber while outputting silence!).
    for require_cdm in [true, false] {
        // 1. Flatpak Firefox (`org.mozilla.firefox` — pre-installed on SteamOS with Widevine CDM + real PipeWire output)
        let flatpak_ff_root = home.join(".var/app/org.mozilla.firefox/.mozilla/firefox");
        if Command::new("flatpak")
            .args(["info", "org.mozilla.firefox"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            if let Some(profile_dir) =
                prepare_firefox_widevine_profile(&flatpak_ff_root, require_cdm)
            {
                let mut cmd = Command::new("flatpak");
                cmd.args([
                    "run",
                    "--socket=pulseaudio",
                    "--filesystem=xdg-run/pipewire-0",
                    "org.mozilla.firefox",
                    "--headless",
                    "--no-remote",
                    "--profile",
                ])
                .arg(&profile_dir)
                .arg(worker_url)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
                apply_pipewire_env(&mut cmd);
                if let Ok(child) = cmd.spawn() {
                    return Some(child);
                }
            }
        }

        // 2. Native Firefox (`firefox`)
        let native_ff_root = home.join(".mozilla/firefox");
        if let Some(profile_dir) = prepare_firefox_widevine_profile(&native_ff_root, require_cdm) {
            let mut cmd = Command::new("firefox");
            cmd.args(["--headless", "--no-remote", "--profile"])
                .arg(&profile_dir)
                .arg(worker_url)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            apply_pipewire_env(&mut cmd);
            if let Ok(child) = cmd.spawn() {
                return Some(child);
            }
        }

        // 3. Flatpak Chromium-family browsers (`--headless=new` fallback only if Firefox is not installed)
        for (app_id, rel_cfg) in [
            ("com.google.Chrome", ".var/app/com.google.Chrome/config/google-chrome"),
            ("com.brave.Browser", ".var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser"),
            ("com.microsoft.Edge", ".var/app/com.microsoft.Edge/config/microsoft-edge"),
            ("org.chromium.Chromium", ".var/app/org.chromium.Chromium/config/chromium"),
        ] {
            let cfg_root = home.join(rel_cfg);
            let has_cdm = cfg_root.join("WidevineCdm").is_dir()
                || cfg_root.join("simp-widevine-worker/WidevineCdm").is_dir();
            if require_cdm && !has_cdm {
                continue;
            }
            if Command::new("flatpak")
                .args(["info", app_id])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
            {
                let worker_dir = cfg_root.join("simp-widevine-worker");
                let _ = std::fs::create_dir_all(&worker_dir);
                clean_stale_profile_locks(&worker_dir);
                let _ = std::fs::File::create(worker_dir.join("First Run"));
                if cfg_root.join("WidevineCdm").is_dir() && !worker_dir.join("WidevineCdm").is_dir()
                {
                    copy_dir_recursive(&cfg_root.join("WidevineCdm"), &worker_dir.join("WidevineCdm"));
                }
                let mut cmd = Command::new("flatpak");
                cmd.args([
                    "run",
                    "--socket=pulseaudio",
                    "--filesystem=xdg-run/pipewire-0",
                    app_id,
                    "--headless=new",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--alsa-output-device=default",
                    "--disable-features=HardwareMediaKeyHandling,MediaSessionService,AudioServiceOutOfProcess",
                    "--autoplay-policy=no-user-gesture-required",
                    "--enable-audio-service",
                    &format!("--user-data-dir={}", worker_dir.display()),
                    worker_url,
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
                apply_pipewire_env(&mut cmd);
                if let Ok(child) = cmd.spawn() {
                    return Some(child);
                }
            }
        }

        // 4. Native Chromium-family browsers (`--headless=new` fallback only if Firefox is not installed)
        if !require_cdm {
            let native_worker_dir = home.join(".local/share/simp/simp-widevine-worker-chromium");
            let _ = std::fs::create_dir_all(&native_worker_dir);
            clean_stale_profile_locks(&native_worker_dir);
            let _ = std::fs::File::create(native_worker_dir.join("First Run"));
            for bin in [
                "google-chrome-stable",
                "google-chrome",
                "brave-browser",
                "microsoft-edge-stable",
                "chromium",
                "chromium-browser",
            ] {
                let mut cmd = Command::new(bin);
                cmd.args([
                    "--headless=new",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--alsa-output-device=default",
                    "--disable-features=HardwareMediaKeyHandling,MediaSessionService,AudioServiceOutOfProcess",
                    "--autoplay-policy=no-user-gesture-required",
                    "--enable-audio-service",
                    &format!("--user-data-dir={}", native_worker_dir.display()),
                    worker_url,
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
                apply_pipewire_env(&mut cmd);
                if let Ok(child) = cmd.spawn() {
                    return Some(child);
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_es256_developer_jwt_generation() {
        // Generate an ephemeral prime256v1 PKCS#8 private key (.p8 format) using openssl
        let key_out = Command::new("openssl")
            .args([
                "genpkey",
                "-algorithm",
                "EC",
                "-pkeyopt",
                "ec_paramgen_curve:P-256",
            ])
            .output()
            .expect("openssl genpkey");
        assert!(key_out.status.success(), "openssl genpkey failed");
        let pem = String::from_utf8(key_out.stdout).expect("valid utf8 pem");

        let jwt = sign_es256_developer_jwt("TEAM123456", "KEY7890ABC", &pem, 3600)
            .expect("sign ES256 developer JWT");

        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3, "JWT must have 3 dot-separated parts");

        let header_bytes = URL_SAFE_NO_PAD.decode(parts[0]).expect("decode header");
        let header: serde_json::Value = serde_json::from_slice(&header_bytes).unwrap();
        assert_eq!(header["alg"], "ES256");
        assert_eq!(header["kid"], "KEY7890ABC");

        let payload_bytes = URL_SAFE_NO_PAD.decode(parts[1]).expect("decode payload");
        let payload: serde_json::Value = serde_json::from_slice(&payload_bytes).unwrap();
        assert_eq!(payload["iss"], "TEAM123456");

        let sig_bytes = URL_SAFE_NO_PAD.decode(parts[2]).expect("decode signature");
        assert_eq!(
            sig_bytes.len(),
            64,
            "ES256 IEEE P1363 signature must be exactly 64 bytes (32-byte R || 32-byte S)"
        );
    }
}
