import React, { useEffect, useState } from 'react';
import {
  AppleMusicAuthConfig,
  defaultSimpClient,
  SimpStateSnapshot,
  SoundCloudAuthConfig,
} from '@simp/client';
import {
  authorizeAppleMusic,
  syncAppleMusicCatalog,
} from '../drivers/AppleMusicDriver';
import {
  enableSoundCloudPublicMode,
  startSoundCloudOAuthLogin,
} from '../drivers/SoundCloudDriver';
import { ImpIcon } from './icons/ImpIcon';

/**
 * Console-Style LAN QR Companion Pairing Page (`/pair` or `?pair=1`).
 * Designed for iPhone / Android / PC browsers on the same LAN as the Steam Deck:
 * - Runs `MusicKit.getInstance().authorize()` natively on the user's phone/PC where
 *   Face ID, Touch ID, Passkeys, and YubiKey / FIDO2 hardware keys work natively.
 * - Also supports SoundCloud OAuth 2.1 PKCE login + Client Credentials configuration.
 */
export const CompanionPairView: React.FC = () => {
  const [snap, setSnap] = useState<SimpStateSnapshot | null>(null);
  const [authCfg, setAuthCfg] = useState<AppleMusicAuthConfig | null>(null);
  const [scAuthCfg, setScAuthCfg] = useState<SoundCloudAuthConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>(
    'Connecting to SIMP Daemon on your Steam Deck...'
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [debugOpen, setDebugOpen] = useState(false);
  const [devTeamId, setDevTeamId] = useState('');
  const [devKeyId, setDevKeyId] = useState('');
  const [devKeyPath, setDevKeyPath] = useState('');
  const [scClientId, setScClientId] = useState('');
  const [scClientSecret, setScClientSecret] = useState('');
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
        .getSoundCloudAuthConfig()
        .then((sc) => setScAuthCfg(sc))
        .catch(() => {});

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
              'Ready to pair — tap below to sign in with Apple ID or SoundCloud.'
            );
          } else {
            setStatusMsg(
              cfg.status_error || 'Ready to pair Apple Music or SoundCloud.'
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
          <ImpIcon name="apple" size={16} color="#ffffff" />
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

        {/* SoundCloud OAuth 2.1 PKCE + Public Discovery Pairing */}
        <div
          style={{
            borderTop: '1px solid #1e1e2a',
            paddingTop: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#fdba74' }}>
              ☁️ SoundCloud Pairing
            </span>
            <span style={{ fontSize: 11, color: '#8e8e99', fontFamily: 'monospace' }}>
              {snap?.soundcloud_authenticated || scAuthCfg?.soundcloud_authenticated
                ? scAuthCfg?.username
                  ? `🟢 @${scAuthCfg.username}`
                  : '🟢 Public Mode'
                : scAuthCfg?.configured
                ? 'Ready'
                : 'Needs Client ID'}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              disabled={busy || !scAuthCfg?.configured}
              onClick={async () => {
                setBusy(true);
                setErrorMsg(null);
                try {
                  await startSoundCloudOAuthLogin((msg) => setStatusMsg(msg));
                  const updated = await defaultSimpClient.getSoundCloudAuthConfig();
                  setScAuthCfg(updated);
                } catch (err: any) {
                  setErrorMsg(err?.message || 'SoundCloud OAuth failed');
                } finally {
                  setBusy(false);
                }
              }}
              style={{
                minHeight: 44,
                borderRadius: 12,
                background: '#2c140a',
                border: '1px solid #ea580c',
                color: '#fdba74',
                fontSize: 12,
                fontWeight: 800,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              ☁️ Sign in (OAuth 2.1)
            </button>
            <button
              disabled={busy || !scAuthCfg?.configured}
              onClick={async () => {
                setBusy(true);
                setErrorMsg(null);
                try {
                  await enableSoundCloudPublicMode((msg) => setStatusMsg(msg));
                  const updated = await defaultSimpClient.getSoundCloudAuthConfig();
                  setScAuthCfg(updated);
                } catch (err: any) {
                  setErrorMsg(err?.message || 'SoundCloud Public Mode failed');
                } finally {
                  setBusy(false);
                }
              }}
              style={{
                minHeight: 44,
                borderRadius: 12,
                background: '#161622',
                border: '1px solid #2e2e40',
                color: '#cbd5e1',
                fontSize: 12,
                fontWeight: 800,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              ⚡ Public Mode
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#71717a', fontFamily: 'monospace' }}>
            Redirect URI: {scAuthCfg?.redirect_uri || 'http://127.0.0.1:18888/api/soundcloud/callback'}
          </div>
        </div>

        {/* Collapsible Troubleshooting, FIDO2/YubiKey Bypass & Developer Debug Section */}
        <div
          style={{
            borderTop: '1px solid #1e1e2a',
            paddingTop: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <button
            onClick={() => setDebugOpen((v) => !v)}
            style={{
              minHeight: 38,
              padding: '0 12px',
              borderRadius: 10,
              background: '#12121b',
              border: '1px solid #282838',
              color: '#9ca3af',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>🛠️ Troubleshooting & FIDO2 / Token Debug</span>
            <span>{debugOpen ? '▴' : '▾'}</span>
          </button>

          {debugOpen && (
            <div
              style={{
                padding: 12,
                borderRadius: 12,
                background: '#08080e',
                border: '1px solid #222232',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.45 }}>
                <strong style={{ color: '#e4e4ec' }}>Why use this?</strong> If your Apple ID uses hardware security keys (FIDO2 / YubiKey) or a browser blocks the Apple popup, you can paste a <code style={{ color: '#67e8f9' }}>Music-User-Token</code> directly:
                <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  <li>Sign in to <code style={{ color: '#67e8f9' }}>music.apple.com</code> on any desktop browser.</li>
                  <li>Open DevTools (<code style={{ color: '#67e8f9' }}>F12</code>) → Application / Storage → Cookies or Local Storage, or run <code style={{ color: '#67e8f9' }}>MusicKit.getInstance().musicUserToken</code> in the Console.</li>
                  <li>Paste the token below to authorize your Steam Deck immediately.</li>
                </ol>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700 }}>
                  🔑 Manual Music-User-Token Override
                </span>
                {authCfg?.music_user_token && (
                  <button
                    onClick={() => {
                      navigator.clipboard
                        .writeText(authCfg.music_user_token || '')
                        .then(() => setStatusMsg('Copied active Music-User-Token to clipboard!'))
                        .catch(() => {});
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      background: '#171724',
                      border: '1px solid #2e2e42',
                      color: '#67e8f9',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    📋 Copy Active Token
                  </button>
                )}
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
                    background: '#050508',
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
                    background: '#2a131c',
                    border: '1px solid #f43f5e',
                    color: '#fda4af',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Apply
                </button>
              </div>

              {/* Custom Developer Key Override (for self-compiled builds without embedded token) */}
              <div
                style={{
                  borderTop: '1px dashed #222232',
                  paddingTop: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 11, color: '#71717a', fontWeight: 700 }}>
                  ⚙️ Custom Build Developer Key Override (Optional)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="APPLE_TEAM_ID"
                    value={devTeamId}
                    onChange={(e) => setDevTeamId(e.target.value)}
                    style={{
                      minHeight: 34,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#050508',
                      border: '1px solid #282838',
                      color: '#d4d4dc',
                      fontSize: 11,
                      fontFamily: 'monospace',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="APPLE_KEY_ID"
                    value={devKeyId}
                    onChange={(e) => setDevKeyId(e.target.value)}
                    style={{
                      minHeight: 34,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#050508',
                      border: '1px solid #282838',
                      color: '#d4d4dc',
                      fontSize: 11,
                      fontFamily: 'monospace',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="/path/to/AuthKey_XXXXXXXXXX.p8"
                    value={devKeyPath}
                    onChange={(e) => setDevKeyPath(e.target.value)}
                    style={{
                      flex: 1,
                      minHeight: 34,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#050508',
                      border: '1px solid #282838',
                      color: '#d4d4dc',
                      fontSize: 11,
                      fontFamily: 'monospace',
                    }}
                  />
                  <button
                    onClick={() => {
                      defaultSimpClient.configureAppleMusic({
                        team_id: devTeamId,
                        key_id: devKeyId,
                        private_key_path: devKeyPath,
                      });
                      window.setTimeout(() => {
                        defaultSimpClient
                          .getAppleMusicAuthConfig()
                          .then((cfg) => {
                            setAuthCfg(cfg);
                            setStatusMsg(
                              cfg.configured
                                ? 'Custom ES256 Developer Token signed & active!'
                                : cfg.status_error || 'Failed to sign developer token'
                            );
                          })
                          .catch(() => {});
                      }, 200);
                    }}
                    style={{
                      minHeight: 34,
                      padding: '0 12px',
                      borderRadius: 8,
                      background: '#161622',
                      border: '1px solid #2e2e42',
                      color: '#c8c8d2',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Sign Key
                  </button>
                </div>
              </div>

              {/* SoundCloud Client ID / Secret Override */}
              <div
                style={{
                  borderTop: '1px dashed #222232',
                  paddingTop: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 11, color: '#fdba74', fontWeight: 700 }}>
                  ☁️ SoundCloud API Credentials (Optional if not in .env)
                </div>
                <input
                  type="text"
                  placeholder="SOUNDCLOUD_CLIENT_ID"
                  value={scClientId}
                  onChange={(e) => setScClientId(e.target.value)}
                  style={{
                    minHeight: 34,
                    padding: '0 10px',
                    borderRadius: 8,
                    background: '#050508',
                    border: '1px solid #282838',
                    color: '#d4d4dc',
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    placeholder="SOUNDCLOUD_CLIENT_SECRET"
                    value={scClientSecret}
                    onChange={(e) => setScClientSecret(e.target.value)}
                    style={{
                      flex: 1,
                      minHeight: 34,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#050508',
                      border: '1px solid #282838',
                      color: '#d4d4dc',
                      fontSize: 11,
                      fontFamily: 'monospace',
                    }}
                  />
                  <button
                    onClick={() => {
                      defaultSimpClient.configureSoundCloud({
                        client_id: scClientId,
                        client_secret: scClientSecret,
                      });
                      window.setTimeout(() => {
                        defaultSimpClient
                          .getSoundCloudAuthConfig()
                          .then((sc) => {
                            setScAuthCfg(sc);
                            setStatusMsg(
                              sc.configured
                                ? 'SoundCloud Client ID & Secret saved!'
                                : sc.status_error || 'Failed to save SoundCloud credentials'
                            );
                          })
                          .catch(() => {});
                      }, 250);
                    }}
                    style={{
                      minHeight: 34,
                      padding: '0 12px',
                      borderRadius: 8,
                      background: '#2c140a',
                      border: '1px solid #ea580c',
                      color: '#fdba74',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Save SC
                  </button>
                </div>
              </div>
            </div>
          )}
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

