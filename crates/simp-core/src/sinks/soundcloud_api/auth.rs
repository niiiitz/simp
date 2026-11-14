use super::*;
use anyhow::{anyhow, Context, Result};
use base64::{
    engine::general_purpose::{STANDARD as BASE64_STD, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde_json::Value;
use simp_protocol::{SimpSettings, TrackMetadata};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Resolves SoundCloud credentials from `SimpSettings`, in-memory cache, environment variables,
/// `.env` files (`./.env`, parent git repo `.env` if in a worktree, or `~/.config/simp/.env`),
/// and compile-time public `SIMP_EMBEDDED_SOUNDCLOUD_CLIENT_ID` (never embedding `client_secret`).
pub fn resolve_soundcloud_credentials(settings: &SimpSettings) -> ResolvedSoundCloudCredentials {
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

    let mut client_id = get_val(
        &settings.services.soundcloud_client_id,
        "SOUNDCLOUD_CLIENT_ID",
    );
    if client_id == REVOKED_SOUNDCLOUD_CLIENT_ID {
        client_id.clear();
    }
    if client_id.is_empty() {
        if let Some(embedded) = option_env!("SIMP_EMBEDDED_SOUNDCLOUD_CLIENT_ID") {
            let trimmed = embedded.trim();
            if !trimmed.is_empty() && trimmed != REVOKED_SOUNDCLOUD_CLIENT_ID {
                client_id = trimmed.to_string();
            }
        }
    }
    if client_id.is_empty() || client_id == REVOKED_SOUNDCLOUD_CLIENT_ID {
        client_id = SOUNDCLOUD_DEFAULT_CLIENT_ID.to_string();
    }

    // Optional local BYO override only; distributed binaries never embed `client_secret`
    // and route token exchanges through `SOUNDCLOUD_DEFAULT_TOKEN_PROXY_URL` (`https://simp-tap-67.niiiitz.workers.dev`).
    let client_secret = get_val(
        &settings.services.soundcloud_client_secret,
        "SOUNDCLOUD_CLIENT_SECRET",
    );

    let mut access_token = settings.services.soundcloud_access_token.trim().to_string();
    let mut refresh_token = settings
        .services
        .soundcloud_refresh_token
        .trim()
        .to_string();
    let mut expires_at = settings.services.soundcloud_token_expires_at;
    let mut auth_mode = settings.services.soundcloud_auth_mode.trim().to_string();
    let mut username = settings.services.soundcloud_username.trim().to_string();

    // Check persisted `settings.vdf` on disk in case an earlier background refresh updated it
    // while the caller's in-memory `SimpSettings` clone still holds an older token/refresh_token.
    let disk_vdf = crate::library::vdf::load_or_create_settings();
    let disk_srv = &disk_vdf.services;
    if !disk_srv.soundcloud_access_token.trim().is_empty()
        && (access_token.is_empty()
            || disk_srv.soundcloud_token_expires_at >= expires_at
            || (disk_srv.soundcloud_auth_mode.trim() == "user" && auth_mode != "user"))
    {
        access_token = disk_srv.soundcloud_access_token.trim().to_string();
        expires_at = disk_srv.soundcloud_token_expires_at;
        auth_mode = disk_srv.soundcloud_auth_mode.trim().to_string();
        if !disk_srv.soundcloud_username.trim().is_empty() {
            username = disk_srv.soundcloud_username.trim().to_string();
        }
    }
    if disk_srv.soundcloud_refresh_token.trim().is_empty()
        && disk_srv.soundcloud_auth_mode.trim() == "client_credentials"
    {
        refresh_token.clear();
    } else if !disk_srv.soundcloud_refresh_token.trim().is_empty()
        && (refresh_token.is_empty() || disk_srv.soundcloud_token_expires_at >= expires_at)
    {
        refresh_token = disk_srv.soundcloud_refresh_token.trim().to_string();
    }

    if auth_mode == "user"
        && refresh_token.is_empty()
        && (username.is_empty() || username == "Public Discovery (Client Credentials)")
    {
        auth_mode = "client_credentials".to_string();
    }

    if let Some(cached) = get_cached_soundcloud_tokens() {
        let cached_is_genuine_user = cached.auth_mode == "user"
            && (!cached.refresh_token.is_empty()
                || (!cached.username.is_empty()
                    && cached.username != "Public Discovery (Client Credentials)"));
        // Prefer the in-memory token if settings hasn't been reloaded yet or if cached is newer
        let use_cached = access_token.is_empty()
            || (cached_is_genuine_user && auth_mode != "user")
            || (!cached.refresh_token.is_empty() && refresh_token.is_empty())
            || (cached.expires_at >= expires_at && cached.auth_mode == auth_mode);
        if use_cached {
            access_token = cached.access_token;
            if !cached.refresh_token.is_empty() {
                refresh_token = cached.refresh_token;
            }
            expires_at = cached.expires_at;
            auth_mode = if cached_is_genuine_user {
                "user".to_string()
            } else {
                "client_credentials".to_string()
            };
            if !cached.username.is_empty() {
                username = cached.username;
            }
        }
    } else if !access_token.is_empty() {
        // Seed TOKEN_CACHE from disk/settings on startup so `save_settings` always knows the latest token
        update_cached_soundcloud_tokens(SoundCloudTokenBundle {
            access_token: access_token.clone(),
            refresh_token: refresh_token.clone(),
            expires_at,
            auth_mode: auth_mode.clone(),
            username: username.clone(),
        });
    }

    ResolvedSoundCloudCredentials {
        client_id,
        client_secret,
        access_token,
        refresh_token,
        expires_at,
        auth_mode,
        username,
    }
}

fn load_dotenv_candidates() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut paths: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        paths.push(cwd.join(".env"));
        // If running inside a git worktree (`gitdir: /path/to/repo/.git/worktrees/...`), also check main repo `.env`
        let dot_git = cwd.join(".git");
        if dot_git.is_file() {
            if let Ok(git_ref) = std::fs::read_to_string(&dot_git) {
                if let Some(gitdir_str) = git_ref.trim().strip_prefix("gitdir:") {
                    let gitdir_path = PathBuf::from(gitdir_str.trim());
                    if let Some(repo_root) = gitdir_path
                        .parent()
                        .and_then(|p| p.parent())
                        .and_then(|p| p.parent())
                    {
                        paths.push(repo_root.join(".env"));
                    }
                }
            }
        }
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

/// Pure-Rust RFC 6234 SHA-256 implementation for OAuth 2.1 PKCE `S256` code challenge generation.
pub fn sha256_digest(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (data.len() as u64) * 8;
    let mut padded = Vec::with_capacity(data.len() + 72);
    padded.extend_from_slice(data);
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0x00);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

/// Computes the RFC 7636 PKCE `S256` `code_challenge` (`BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))`).
pub fn pkce_code_challenge_s256(code_verifier: &str) -> String {
    let digest = sha256_digest(code_verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn generate_random_url_safe_token(byte_len: usize) -> String {
    let mut buf = vec![0u8; byte_len];
    #[allow(unused_mut)]
    let mut filled = false;
    #[cfg(unix)]
    {
        if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
            use std::io::Read;
            if f.read_exact(&mut buf).is_ok() {
                filled = true;
            }
        }
    }
    if !filled {
        let now_nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let seed = format!("simp-pkce-{now_nanos}-{}", std::process::id());
        let h1 = blake3::hash(seed.as_bytes());
        let h2 = blake3::hash(h1.as_bytes());
        for (i, b) in buf.iter_mut().enumerate() {
            *b = if i < 32 {
                h1.as_bytes()[i]
            } else {
                h2.as_bytes()[i % 32]
            };
        }
    }
    URL_SAFE_NO_PAD.encode(&buf)
}

pub fn url_encode_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 16);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{b:02X}"));
            }
        }
    }
    out
}

/// Initiates an OAuth 2.1 Authorization Code + PKCE (`S256`) flow and returns `(authorize_url, state)`.
pub fn start_oauth_pkce_flow(
    settings: &SimpSettings,
    redirect_uri_override: Option<&str>,
) -> Result<(String, String)> {
    let creds = resolve_soundcloud_credentials(settings);
    if creds.client_id.is_empty() {
        return Err(anyhow!(
            "Missing SOUNDCLOUD_CLIENT_ID in settings or .env"
        ));
    }

    let redirect_uri = redirect_uri_override
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(SOUNDCLOUD_DEFAULT_REDIRECT_URI)
        .to_string();

    let code_verifier = generate_random_url_safe_token(48);
    let code_challenge = pkce_code_challenge_s256(&code_verifier);
    let state = generate_random_url_safe_token(18);

    if let Ok(mut guard) = pkce_flows().lock() {
        guard.retain(|f| f.created_at.elapsed() < Duration::from_secs(1800));
        while guard.len() >= 8 {
            guard.pop_front();
        }
        guard.push_back(PendingPkceFlow {
            state: state.clone(),
            code_verifier,
            redirect_uri: redirect_uri.clone(),
            created_at: Instant::now(),
        });
    }

    let authorize_url = format!(
        "https://secure.soundcloud.com/authorize?client_id={}&redirect_uri={}&response_type=code&code_challenge={}&code_challenge_method=S256&state={}",
        url_encode_component(&creds.client_id),
        url_encode_component(&redirect_uri),
        url_encode_component(&code_challenge),
        url_encode_component(&state),
    );

    Ok((authorize_url, state))
}

fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn resolve_token_proxy_url() -> String {
    if let Ok(v) = std::env::var("SOUNDCLOUD_TOKEN_PROXY_URL") {
        if !v.trim().is_empty() {
            return v.trim().to_string();
        }
    }
    let dotenv_map = load_dotenv_candidates();
    if let Some(v) = dotenv_map.get("SOUNDCLOUD_TOKEN_PROXY_URL") {
        if !v.trim().is_empty() {
            return v.trim().to_string();
        }
    }
    SOUNDCLOUD_DEFAULT_TOKEN_PROXY_URL.to_string()
}

/// Exchanges an OAuth 2.1 `code` + PKCE `code_verifier` for a SoundCloud user `access_token` and `refresh_token`.
pub fn exchange_oauth_code(
    settings: &SimpSettings,
    code: &str,
    state: Option<&str>,
    redirect_uri_override: Option<&str>,
) -> Result<SoundCloudTokenBundle> {
    let creds = resolve_soundcloud_credentials(settings);
    if creds.client_id.is_empty() {
        return Err(anyhow!("Missing SOUNDCLOUD_CLIENT_ID"));
    }

    let mut matched_flow: Option<PendingPkceFlow> = None;
    if let Ok(mut guard) = pkce_flows().lock() {
        guard.retain(|f| f.created_at.elapsed() < Duration::from_secs(1800));
        if let Some(st) = state.map(|s| s.trim()).filter(|s| !s.is_empty()) {
            if let Some(pos) = guard.iter().position(|f| f.state == st) {
                matched_flow = guard.remove(pos);
            }
        }
        if matched_flow.is_none() {
            matched_flow = guard.pop_back();
        }
    }

    let flow = matched_flow.ok_or_else(|| {
        anyhow!("No pending SoundCloud PKCE login session found — please click Sign In again")
    })?;
    let redirect_uri = redirect_uri_override
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(&flow.redirect_uri);

    let proxy_body = format!(
        "grant_type=authorization_code&client_id={}&redirect_uri={}&code_verifier={}&code={}",
        url_encode_component(&creds.client_id),
        url_encode_component(redirect_uri),
        url_encode_component(&flow.code_verifier),
        url_encode_component(code.trim()),
    );

    let mut bundle = if creds.client_secret.is_empty()
        || creds.client_id == SOUNDCLOUD_DEFAULT_CLIENT_ID
    {
        post_oauth_token_request_via_proxy(&proxy_body, "user").or_else(|proxy_err| {
            if !creds.client_secret.is_empty() {
                let direct_body = format!(
                    "{proxy_body}&client_secret={}",
                    url_encode_component(&creds.client_secret)
                );
                post_oauth_token_request(&direct_body, None, "user")
            } else {
                Err(proxy_err)
            }
        })?
    } else {
        let direct_body = format!(
            "{proxy_body}&client_secret={}",
            url_encode_component(&creds.client_secret)
        );
        post_oauth_token_request(&direct_body, None, "user")?
    };

    if let Ok(me) = soundcloud_get_json("/me", &bundle.access_token) {
        if let Some(uname) = me.get("username").and_then(|v| v.as_str()) {
            bundle.username = uname.trim().to_string();
        }
    }
    update_cached_soundcloud_tokens(bundle.clone());
    persist_soundcloud_tokens_to_settings_vdf(&bundle);
    Ok(bundle)
}

/// Obtains a `client_credentials` token via the stateless Cloudflare Worker proxy
/// (or directly using `SOUNDCLOUD_CLIENT_SECRET` if a custom BYO secret is configured locally).
pub fn obtain_client_credentials_token(settings: &SimpSettings) -> Result<SoundCloudTokenBundle> {
    let creds = resolve_soundcloud_credentials(settings);
    if creds.client_id.is_empty() {
        return Err(anyhow!(
            "Missing SOUNDCLOUD_CLIENT_ID in settings or .env"
        ));
    }

    let proxy_body = format!(
        "grant_type=client_credentials&client_id={}",
        url_encode_component(&creds.client_id),
    );

    let mut bundle = if creds.client_secret.is_empty()
        || creds.client_id == SOUNDCLOUD_DEFAULT_CLIENT_ID
    {
        post_oauth_token_request_via_proxy(&proxy_body, "client_credentials").or_else(
            |proxy_err| {
                if !creds.client_secret.is_empty() {
                    let basic_b64 =
                        BASE64_STD.encode(format!("{}:{}", creds.client_id, creds.client_secret));
                    let basic_header = format!("Basic {basic_b64}");
                    let direct_body = format!(
                        "{proxy_body}&client_secret={}",
                        url_encode_component(&creds.client_secret),
                    );
                    post_oauth_token_request(
                        &direct_body,
                        Some(&basic_header),
                        "client_credentials",
                    )
                } else {
                    Err(proxy_err)
                }
            },
        )?
    } else {
        let basic_b64 = BASE64_STD.encode(format!("{}:{}", creds.client_id, creds.client_secret));
        let basic_header = format!("Basic {basic_b64}");
        let direct_body = format!(
            "{proxy_body}&client_secret={}",
            url_encode_component(&creds.client_secret),
        );
        post_oauth_token_request(&direct_body, Some(&basic_header), "client_credentials")?
    };

    bundle.username = "Public Discovery (Client Credentials)".to_string();
    update_cached_soundcloud_tokens(bundle.clone());
    persist_soundcloud_tokens_to_settings_vdf(&bundle);
    Ok(bundle)
}

/// Refreshes an expired user OAuth token using its single-use `refresh_token`.
pub fn refresh_user_oauth_token(
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
    existing_username: &str,
) -> Result<SoundCloudTokenBundle> {
    let proxy_body = format!(
        "grant_type=refresh_token&client_id={}&refresh_token={}",
        url_encode_component(client_id),
        url_encode_component(refresh_token),
    );

    let mut bundle = if client_secret.trim().is_empty()
        || client_id.trim() == SOUNDCLOUD_DEFAULT_CLIENT_ID
    {
        post_oauth_token_request_via_proxy(&proxy_body, "user")?
    } else {
        let basic_b64 = BASE64_STD.encode(format!("{client_id}:{client_secret}"));
        let basic_header = format!("Basic {basic_b64}");
        let direct_body = format!(
            "{proxy_body}&client_secret={}",
            url_encode_component(client_secret),
        );
        post_oauth_token_request(&direct_body, None, "user")
            .or_else(|_| post_oauth_token_request(&direct_body, Some(&basic_header), "user"))?
    };

    if bundle.refresh_token.is_empty() {
        bundle.refresh_token = refresh_token.trim().to_string();
    }
    bundle.username = if existing_username == "Public Discovery (Client Credentials)" {
        String::new()
    } else {
        existing_username.to_string()
    };
    if bundle.username.is_empty() {
        if let Ok(me) = soundcloud_get_json("/me", &bundle.access_token) {
            if let Some(uname) = me.get("username").and_then(|v| v.as_str()) {
                bundle.username = uname.trim().to_string();
            }
        }
    }
    update_cached_soundcloud_tokens(bundle.clone());
    persist_soundcloud_tokens_to_settings_vdf(&bundle);
    Ok(bundle)
}

fn post_oauth_token_request_via_proxy(
    form_body: &str,
    auth_mode: &str,
) -> Result<SoundCloudTokenBundle> {
    let proxy_url = resolve_token_proxy_url();
    let headers = [
        ("Accept", "application/json; charset=utf-8"),
        ("Content-Type", "application/x-www-form-urlencoded"),
    ];
    let bytes = crate::http_pool::http_post_bytes(&proxy_url, &headers, form_body.as_bytes(), 15)
        .context("SoundCloud OAuth token proxy request failed")?;
    parse_oauth_token_response_bytes(&bytes, auth_mode)
}

fn post_oauth_token_request(
    form_body: &str,
    basic_auth: Option<&str>,
    auth_mode: &str,
) -> Result<SoundCloudTokenBundle> {
    let mut headers = vec![
        ("Accept", "application/json; charset=utf-8"),
        ("Content-Type", "application/x-www-form-urlencoded"),
    ];
    if let Some(basic) = basic_auth {
        headers.push(("Authorization", basic));
    }

    let bytes = crate::http_pool::http_post_bytes(
        "https://secure.soundcloud.com/oauth/token",
        &headers,
        form_body.as_bytes(),
        15,
    )
    .or_else(|_| {
        crate::http_pool::http_post_bytes(
            "https://api.soundcloud.com/oauth2/token",
            &headers,
            form_body.as_bytes(),
            15,
        )
    })
    .context("SoundCloud OAuth token request failed")?;

    parse_oauth_token_response_bytes(&bytes, auth_mode)
}

fn parse_oauth_token_response_bytes(
    bytes: &[u8],
    auth_mode: &str,
) -> Result<SoundCloudTokenBundle> {
    let json: Value =
        serde_json::from_slice(bytes).context("Invalid JSON from SoundCloud OAuth endpoint")?;
    if let Some(err_code) = json.get("error").and_then(|v| v.as_str()) {
        let desc = json
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        return Err(anyhow!(
            "SoundCloud OAuth error: {err_code}{}",
            if desc.is_empty() {
                String::new()
            } else {
                format!(" ({desc})")
            }
        ));
    }
    let access_token = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("SoundCloud token response did not include access_token"))?;
    let refresh_token = json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let expires_in = json
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .unwrap_or(3599);

    Ok(SoundCloudTokenBundle {
        access_token,
        refresh_token,
        expires_at: now_unix_secs() + expires_in,
        auth_mode: auth_mode.to_string(),
        username: String::new(),
    })
}

fn persist_soundcloud_tokens_to_settings_vdf(bundle: &SoundCloudTokenBundle) {
    let mut settings = crate::library::vdf::load_or_create_settings();
    // Never overwrite a personal user OAuth session (`refresh_token` present) with a `client_credentials` fallback token!
    if bundle.auth_mode == "client_credentials"
        && !settings.services.soundcloud_refresh_token.trim().is_empty()
    {
        return;
    }
    settings.services.soundcloud_enabled = true;
    settings.services.soundcloud_access_token = bundle.access_token.clone();
    if !bundle.refresh_token.is_empty() {
        settings.services.soundcloud_refresh_token = bundle.refresh_token.clone();
    }
    settings.services.soundcloud_token_expires_at = bundle.expires_at;
    settings.services.soundcloud_auth_mode = bundle.auth_mode.clone();
    if !bundle.username.is_empty() {
        settings.services.soundcloud_username = bundle.username.clone();
    }
    let _ = crate::library::vdf::save_settings(&settings);
}

pub(crate) fn clear_consumed_user_refresh_token(failed_refresh_token: &str) {
    let failed_trimmed = failed_refresh_token.trim();
    let mut settings = crate::library::vdf::load_or_create_settings();
    // Only clear if the token on disk is still the exact refresh_token that failed with `invalid_grant`
    // (never wipe a newly rotated refresh_token written by another thread).
    if !settings.services.soundcloud_refresh_token.trim().is_empty()
        && (failed_trimmed.is_empty()
            || settings.services.soundcloud_refresh_token.trim() == failed_trimmed)
    {
        settings.services.soundcloud_refresh_token.clear();
        if settings.services.soundcloud_auth_mode != "client_credentials" {
            settings.services.soundcloud_auth_mode = "client_credentials".to_string();
        }
        let _ = crate::library::vdf::save_settings_raw(&settings);
    }
    if let Ok(mut guard) = token_cache().lock() {
        if let Some(ref mut cached) = *guard {
            if failed_trimmed.is_empty() || cached.refresh_token.trim() == failed_trimmed {
                cached.refresh_token.clear();
                cached.auth_mode = "client_credentials".to_string();
            }
        }
    }
}

fn is_clobbered_user_token(creds: &ResolvedSoundCloudCredentials) -> bool {
    !creds.refresh_token.is_empty()
        && (creds.username == "Public Discovery (Client Credentials)" || creds.auth_mode != "user")
}

/// Resolves a valid SoundCloud OAuth access token, transparently refreshing user tokens
/// up to 10 minutes (`600s`) before expiry or minting a `client_credentials` token when
/// `SOUNDCLOUD_CLIENT_ID` & `SOUNDCLOUD_CLIENT_SECRET` are available.
pub fn ensure_valid_access_token(settings: &SimpSettings) -> Result<String> {
    let creds = resolve_soundcloud_credentials(settings);
    let now = now_unix_secs();

    if !creds.access_token.is_empty()
        && !is_clobbered_user_token(&creds)
        && (creds.expires_at == 0 || now + 600 < creds.expires_at)
    {
        return Ok(creds.access_token);
    }

    // Serialize token refreshes so concurrent requests never race on SoundCloud's single-use refresh_token
    let _guard = token_refresh_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let creds = resolve_soundcloud_credentials(settings);
    let now = now_unix_secs();

    if !creds.access_token.is_empty()
        && !is_clobbered_user_token(&creds)
        && (creds.expires_at == 0 || now + 600 < creds.expires_at)
    {
        return Ok(creds.access_token);
    }

    if !creds.refresh_token.is_empty() && !creds.client_id.is_empty() {
        match refresh_user_oauth_token(
            &creds.client_id,
            &creds.client_secret,
            &creds.refresh_token,
            &creds.username,
        ) {
            Ok(refreshed) => return Ok(refreshed.access_token),
            Err(refresh_err) => {
                let msg = format!("{refresh_err:#}");
                tracing::warn!("SoundCloud user OAuth refresh attempt failed: {msg}");
                if msg.contains("invalid_grant")
                    || msg.contains("invalid_client")
                    || msg.contains("unauthorized_client")
                    || msg.contains("revoked_client_id")
                {
                    clear_consumed_user_refresh_token(&creds.refresh_token);
                } else if !creds.access_token.is_empty() && now + 30 < creds.expires_at {
                    // Transient network failure during early (10m pre-expiry) refresh window:
                    // keep using the still-valid access_token and preserve refresh_token for next retry!
                    return Ok(creds.access_token);
                }
            }
        }
    }

    if !creds.access_token.is_empty() && (creds.expires_at == 0 || now + 30 < creds.expires_at) {
        return Ok(creds.access_token);
    }

    if !creds.client_id.is_empty() {
        let bundle = obtain_client_credentials_token(settings)?;
        return Ok(bundle.access_token);
    }

    if !creds.access_token.is_empty() {
        return Ok(creds.access_token);
    }

    Err(anyhow!(
        "SoundCloud is not authenticated — sign in via Sources (Select)"
    ))
}

/// Revokes the active SoundCloud token and clears in-memory and on-disk state.
pub fn disconnect_soundcloud_session(settings: &SimpSettings) {
    let creds = resolve_soundcloud_credentials(settings);
    if !creds.access_token.is_empty() {
        let auth_header = format!("OAuth {}", creds.access_token.trim());
        let body = serde_json::json!({ "access_token": creds.access_token }).to_string();
        let _ = crate::http_pool::http_post_bytes(
            "https://api.soundcloud.com/disconnect",
            &[
                ("Authorization", auth_header.as_str()),
                ("Content-Type", "application/json"),
            ],
            body.as_bytes(),
            6,
        );
    }
    clear_cached_soundcloud_state();
    let mut disk = crate::library::vdf::load_or_create_settings();
    disk.services.soundcloud_access_token.clear();
    disk.services.soundcloud_refresh_token.clear();
    disk.services.soundcloud_token_expires_at = 0;
    disk.services.soundcloud_auth_mode = "client_credentials".to_string();
    disk.services.soundcloud_username.clear();
    disk.services.soundcloud_enabled = true;
    let _ = crate::library::vdf::save_settings_raw(&disk);
}

pub fn is_soundcloud_ready(settings: &SimpSettings) -> bool {
    let creds = resolve_soundcloud_credentials(settings);
    !creds.access_token.is_empty() || !creds.client_id.is_empty()
}

/// Returns `true` when the user is signed in with a personal SoundCloud OAuth account (`auth_mode == "user"`),
/// as opposed to anonymous `client_credentials` Public Discovery mode.
pub fn is_soundcloud_user_signed_in(settings: &SimpSettings) -> bool {
    let creds = resolve_soundcloud_credentials(settings);
    !creds.refresh_token.trim().is_empty()
        || (creds.auth_mode.trim() == "user"
            && !creds.access_token.trim().is_empty()
            && creds.username != "Public Discovery (Client Credentials)")
}

pub(crate) fn access_param_for_session(settings: &SimpSettings) -> &'static str {
    if is_soundcloud_user_signed_in(settings) {
        "playable"
    } else {
        "playable,preview"
    }
}

pub(crate) fn is_preview_track_meta(t: &TrackMetadata) -> bool {
    t.album.contains("• Preview") || t.album.ends_with("Preview")
}

pub(crate) fn should_keep_track_for_session(t: &TrackMetadata, signed_in: bool) -> bool {
    if signed_in && is_preview_track_meta(t) {
        return false;
    }
    true
}

pub(crate) fn should_keep_playlist_for_session(pl: &mut SoundCloudPlaylistSummary, signed_in: bool) -> bool {
    if signed_in && !pl.tracks.is_empty() {
        let before_len = pl.tracks.len();
        pl.tracks.retain(|t| !is_preview_track_meta(t));
        let removed_previews = before_len.saturating_sub(pl.tracks.len());
        pl.gated_track_count = pl.gated_track_count.saturating_add(removed_previews);
        if pl.tracks.is_empty() {
            return false;
        }
        pl.track_count = pl.tracks.len();
    }
    pl.track_count > 0 || !pl.tracks.is_empty()
}

