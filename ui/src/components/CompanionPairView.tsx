import React, { useEffect, useState } from 'react';
import {
  AppleMusicAuthConfig,
  defaultSimpClient,
  SimpStateSnapshot,
} from '@simp/client';
import {
  authorizeAppleMusic,
  syncAppleMusicCatalog,
} from '../drivers/AppleMusicDriver';

/**
 * Console-Style LAN QR Companion Pairing Page (`/pair` or `?pair=1`).
 * Designed for iPhone / Android / PC browsers on the same LAN as the Steam Deck:
 * - Runs `MusicKit.getInstance().authorize()` natively on the user's phone/PC where
 *   Face ID, Touch ID, Passkeys, and YubiKey / FIDO2 hardware keys work natively.
 * - Pushes `Music-User-Token` + synced Apple Music playlists & songs directly over
 *   WebSocket (`ws://<deck-lan-ip>:18888/ws`) to the Steam Deck's `simp --daemon`.
 */
export const CompanionPairView: React.FC = () => {
  const [snap, setSnap] = useState<SimpStateSnapshot | null>(null);
  const [authCfg, setAuthCfg] = useState<AppleMusicAuthConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>(
    'Connecting to SIMP Daemon on your Steam Deck...'
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [syncResult, setSyncResult] = useState<{
    playlists: number;
    tracks: number;
  } | null>(null);

  useEffect(() => {
    defaultSimpClient.connect();
    const unsub = defaultSimpClient.subscribeState((next) => {
      setSnap({ ...next });
    });

    const timer = window.setTimeout(() => {
      defaultSimpClient
        .getAppleMusicAuthConfig()
        .then((cfg) => {
          setAuthCfg(cfg);
          if (cfg.apple_authenticated) {
            setStatusMsg(
              'Connected! Your Steam Deck is linked to Apple Music.'
            );
          } else if (cfg.configured) {
            setStatusMsg(
              'Ready to pair — tap below to sign in with Apple ID (Face ID / Passkey / YubiKey supported).'
            );
          } else {
            setStatusMsg(
              cfg.status_error || 'Apple Developer Token not configured on host.'
            );
          }
        })
        .catch(() => {
          setStatusMsg(
            'Waiting for WebSocket connection to Steam Deck (:18888)...'
          );
        });
    }, 350);

    return () => {
      window.clearTimeout(timer);
      unsub();
    };
  }, []);

  const handleAuthorize = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await authorizeAppleMusic((msg) => setStatusMsg(msg));
      const updated = await defaultSimpClient.getAppleMusicAuthConfig();
      setAuthCfg(updated);
      setStatusMsg(
        'Paired & synced! You can return to your Steam Deck now.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Apple Music authorization failed');
    } finally {
      setBusy(false);
    }
  };

  const handleManualToken = async () => {
    const trimmed = manualToken.trim();
    if (!trimmed) {
      setErrorMsg('Please paste a valid Music-User-Token first.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setStatusMsg('Saving Music-User-Token to Steam Deck & syncing catalog...');
    defaultSimpClient.setAppleMusicUserToken(trimmed);
    window.setTimeout(async () => {
      try {
        const res = await syncAppleMusicCatalog((msg) => setStatusMsg(msg));
        setSyncResult(res);
        const updated = await defaultSimpClient.getAppleMusicAuthConfig();
        setAuthCfg(updated);
        setManualToken('');
        setStatusMsg(
          `Paired! Synced ${res.playlists} playlists (${res.tracks} tracks) to your Steam Deck.`
        );
      } catch (err: any) {
        setErrorMsg(err?.message || 'Token saved, but catalog sync failed.');
      } finally {
        setBusy(false);
      }
    }, 300);
  };

  const handleResync = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await syncAppleMusicCatalog((msg) => setStatusMsg(msg));
      setSyncResult(res);
      setStatusMsg(
        `Synced ${res.playlists} playlists (${res.tracks} tracks) to your Steam Deck!`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  const isAuth = !!(snap?.apple_authenticated || authCfg?.apple_authenticated);

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        boxSizing: 'border-box',
        background: '#050508',
        color: '#e4e4ec',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          borderRadius: 20,
          background: '#0c0c12',
          border: '1px solid #222230',
          padding: 24,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.85)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img
            src="/simp-icon-dark.png"
            alt="SIMP"
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              border: '1px solid #262636',
              objectFit: 'cover',
            }}
          />
          <div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                letterSpacing: '-0.01em',
              }}
            >
              SIMP Companion Pairing
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
              Host: <span style={{ fontFamily: 'monospace', color: '#67e8f9' }}>{window.location.host}</span>
            </div>
          </div>
        </div>

        {/* Status Banner */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            background: isAuth ? '#0d221c' : '#11111a',
            border: isAuth ? '1px solid #10b981' : '1px solid #262638',
            fontSize: 13,
            lineHeight: 1.45,
            color: isAuth ? '#a7f3d0' : '#d4d4dc',
          }}
        >
          {isAuth ? '🟢 ' : '📱 '}
          {statusMsg}
        </div>

        {errorMsg && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: '#281117',
              border: '1px solid #f43f5e',
              color: '#fda4af',
              fontSize: 12,
            }}
          >
            ⚠️ {errorMsg}
          </div>
        )}

        {/* Primary Action: 1-Tap Apple Music Sign-In */}
        <button
          disabled={busy || !authCfg?.configured}
          onClick={handleAuthorize}
          style={{
            minHeight: 52,
            borderRadius: 14,
            background: isAuth ? '#181824' : '#e11d48',
            border: isAuth ? '1px solid #2e2e40' : '1px solid #fb7185',
            color: '#ffffff',
            fontSize: 15,
            fontWeight: 800,
            cursor: busy ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          <span>🍎</span>
          <span>
            {busy
              ? 'Authorizing & Syncing...'
              : isAuth
              ? 'Re-Authorize Apple ID'
              : 'Sign in with Apple Music'}
          </span>
        </button>

        {isAuth && (
          <button
            disabled={busy}
            onClick={handleResync}
            style={{
              minHeight: 46,
              borderRadius: 12,
              background: '#0f222a',
              border: '1px solid #2aa3c4',
              color: '#bfeaf5',
              fontSize: 13,
              fontWeight: 800,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            🔄 Sync Playlists & Library to Steam Deck
          </button>
        )}

        {syncResult && (
          <div
            style={{
              fontSize: 12,
              color: '#67e8f9',
              textAlign: 'center',
              fontFamily: 'monospace',
            }}
          >
            ✓ Imported {syncResult.playlists} playlists • {syncResult.tracks} tracks
          </div>
        )}

        {/* Fallback Manual Token Paste */}
        <div
          style={{
            borderTop: '1px solid #1e1e2a',
            paddingTop: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700 }}>
            🔑 Or Paste a Music-User-Token Directly
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Paste media-user-token / Music-User-Token..."
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              style={{
                flex: 1,
                minHeight: 40,
                padding: '0 12px',
                borderRadius: 10,
                background: '#07070c',
                border: '1px solid #282838',
                color: '#e4e4ec',
                fontSize: 12,
                fontFamily: 'monospace',
              }}
            />
            <button
              disabled={busy}
              onClick={handleManualToken}
              style={{
                minHeight: 40,
                padding: '0 14px',
                borderRadius: 10,
                background: '#1e1e2e',
                border: '1px solid #383850',
                color: '#e4e4ec',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Send
            </button>
          </div>
        </div>

        {/* Open Full Console Link */}
        <a
          href="/"
          style={{
            marginTop: 4,
            textAlign: 'center',
            fontSize: 12,
            color: '#71717a',
            textDecoration: 'none',
          }}
        >
          ← Open Full SIMP Console UI
        </a>
      </div>
    </div>
  );
};

