import React from 'react';
import {
  AppleMusicAuthConfig,
  defaultSimpClient,
  OpticalDiscStatus,
  SimpStateSnapshot,
  SoundCloudAuthConfig,
  TrackMetadata,
} from '@simp/client';
import { QrCodeSvg } from '../components/QrCodeSvg';
import {
  authorizeAppleMusic,
  disconnectAppleMusicCleanSlate,
} from '../drivers/AppleMusicDriver';
import {
  disconnectSoundCloudCleanSlate,
  enableSoundCloudPublicMode,
  startSoundCloudOAuthLogin,
} from '../drivers/SoundCloudDriver';
import { OskTargetKind } from '../hooks/useGamepadNavigation';
import { BrowserTarget } from './PlayerView';

export interface SettingsModalProps {
  snap: SimpStateSnapshot | null;
  customFolderPath: string;
  setCustomFolderPath: React.Dispatch<React.SetStateAction<string>>;
  setOskTarget: React.Dispatch<React.SetStateAction<OskTargetKind>>;
  handleAddFolder: (folderPath: string) => void;
  handleRemoveFolder: (mountRoot: string, label: string) => void;
  setView: React.Dispatch<React.SetStateAction<'lock' | 'browser'>>;
  setSourceModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPowerModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  opticalDisc: OpticalDiscStatus | null;
  cdScanning: boolean;
  handleScanOpticalDisc: (forceRefresh?: boolean, silent?: boolean) => Promise<void>;
  handleEjectOpticalDisc: () => void;
  setBrowserTarget: React.Dispatch<React.SetStateAction<BrowserTarget | null>>;
  setBrowserTracks: React.Dispatch<React.SetStateAction<TrackMetadata[]>>;
  appleAuthCfg: AppleMusicAuthConfig | null;
  setAppleAuthCfg: React.Dispatch<React.SetStateAction<AppleMusicAuthConfig | null>>;
  appleBusy: boolean;
  setAppleBusy: React.Dispatch<React.SetStateAction<boolean>>;
  soundcloudAuthCfg: SoundCloudAuthConfig | null;
  setSoundcloudAuthCfg: React.Dispatch<React.SetStateAction<SoundCloudAuthConfig | null>>;
  soundcloudBusy: boolean;
  setSoundcloudBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setBrowserSourceFilter: React.Dispatch<
    React.SetStateAction<'all' | 'local' | 'apple_music' | 'soundcloud' | 'internet_archive'>
  >;
  setAppleSubTab: React.Dispatch<
    React.SetStateAction<'pinned' | 'cloud_playlists' | 'radio' | 'new'>
  >;
  setSoundCloudSubTab: React.Dispatch<
    React.SetStateAction<'pinned' | 'likes_sets' | 'stream_radio' | 'trending'>
  >;
  refreshLibraryData: () => void;
  showToast: (msg: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  snap,
  customFolderPath,
  setCustomFolderPath,
  setOskTarget,
  handleAddFolder,
  handleRemoveFolder,
  setView,
  setSourceModalOpen,
  setPowerModalOpen,
  opticalDisc,
  cdScanning,
  handleScanOpticalDisc,
  handleEjectOpticalDisc,
  setBrowserTarget,
  setBrowserTracks,
  appleAuthCfg,
  setAppleAuthCfg,
  appleBusy,
  setAppleBusy,
  soundcloudAuthCfg,
  setSoundcloudAuthCfg,
  soundcloudBusy,
  setSoundcloudBusy,
  setBrowserSourceFilter,
  setAppleSubTab,
  setSoundCloudSubTab,
  refreshLibraryData,
  showToast,
}) => {
  const [pairHelpOpen, setPairHelpOpen] = React.useState(false);
  const [iaUsername, setIaUsername] = React.useState('');
  const [iaAccessKey, setIaAccessKey] = React.useState('');
  const [iaSecretKey, setIaSecretKey] = React.useState('');
  const [iaKeysOpen, setIaKeysOpen] = React.useState(false);
  const [iaEnabledLocal, setIaEnabledLocal] = React.useState(
    !!snap?.internet_archive_authenticated
  );

  React.useEffect(() => {
    setIaEnabledLocal(!!snap?.internet_archive_authenticated);
    defaultSimpClient
      .getInternetArchiveConfig()
      .then((cfg) => {
        if (cfg) {
          setIaEnabledLocal(!!cfg.enabled);
          setIaUsername(cfg.username || '');
        }
      })
      .catch(() => {});
  }, [snap?.internet_archive_authenticated]);

  return (
    <div
      onClick={() => setSourceModalOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        boxSizing: 'border-box',
        zIndex: 50,
      }}
    >
      <div
        data-modal-root="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 580,
          maxHeight: '86vh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          background: '#0a0a0e',
          border: '2px solid #262632',
          borderRadius: 20,
          padding: 22,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 15 }}>Folders & Connected Accounts</strong>
          <button
            onClick={() => setSourceModalOpen(false)}
            style={{
              minHeight: 44,
              padding: '0 14px',
              borderRadius: 10,
              background: '#16161f',
              border: '1px solid #2e2e3a',
              color: '#d4d4dc',
              fontFamily: 'monospace',
              cursor: 'pointer',
            }}
          >
            ✕<span className="simp-gp-badge"> B</span>
          </button>
        </div>

        {/* Custom Local / WSL2 Folder Picker */}
        <div
          style={{
            padding: 14,
            borderRadius: 14,
            background: '#0f0f16',
            border: '1px solid #242432',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#2aa3c4' }}>
            ➕ Add Local / Windows / USB Music Folder
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              data-osk-input="folder"
              placeholder="/mnt/c/Users/<you>/Music or /home/deck/Music (Press A for Keyboard)"
              value={customFolderPath}
              onChange={(e) => setCustomFolderPath(e.target.value)}
              onClick={() => {
                setOskTarget('folder');
                if (window.parent && window.parent !== window) {
                  window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddFolder(customFolderPath);
              }}
              style={{
                flex: 1,
                minHeight: 42,
                padding: '0 12px',
                borderRadius: 10,
                background: '#07070a',
                border: '1px solid #2e2e3c',
                color: '#d4d4dc',
                fontSize: 12,
                fontFamily: 'monospace',
              }}
            />
            <button
              onClick={() => handleAddFolder(customFolderPath)}
              style={{
                minHeight: 42,
                padding: '0 16px',
                borderRadius: 10,
                background: '#0f222a',
                color: '#bfeaf5',
                border: '1px solid #2aa3c4',
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Add & Scan
            </button>
          </div>

          {/* 1-Tap Preset Paths */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[
              { label: 'Steam OSTs (C:)', path: '/mnt/c/Program Files (x86)/Steam/steamapps/music' },
              { label: 'Apple Music (C:)', path: '/mnt/c/Users/niiii/Music/Apple Music/Media/Music' },
              { label: 'Windows Public Music', path: '/mnt/c/Users/Public/Music' },
              { label: 'SteamOS ~/Music', path: '/home/deck/Music' },
            ].map((preset) => (
              <button
                key={preset.path}
                onClick={() => handleAddFolder(preset.path)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 8,
                  background: '#161622',
                  border: '1px solid #2b2b3c',
                  color: '#c8c8d2',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                + {preset.label}
              </button>
            ))}
          </div>

          {/* Active Mounts List with 1-Tap Remove inside Modal */}
          {snap?.mounts && snap.mounts.length > 0 && (
            <div
              style={{
                maxHeight: 160,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-y',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                marginTop: 4,
              }}
            >
              {snap.mounts.map((m) => (
                <div
                  key={m.mount_root}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: 8,
                    background: '#08080c',
                    border: '1px solid #1c1c26',
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'monospace',
                      color: m.is_online ? '#c8c8d2' : '#71717a',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.is_online ? '🟢' : '⚫'} {m.mount_root} ({m.track_count} tracks)
                  </span>
                  <button
                    onClick={() => handleRemoveFolder(m.mount_root, m.label)}
                    style={{
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: '#1f1216',
                      border: '1px solid #4c2228',
                      color: '#f87171',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    Remove ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          data-default-focus="true"
          onClick={() => {
            setView('browser');
            setSourceModalOpen(false);
          }}
          style={{
            width: '100%',
            minHeight: 54,
            padding: '10px 14px',
            borderRadius: 12,
            background: '#0d1b22',
            border: '1px solid #2aa3c4',
            color: '#f4f4f6',
            textAlign: 'left',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              📁 Local, Steam OSTs & Removable USB/SD
            </div>
            <div style={{ fontSize: 12, color: '#8e8e99' }}>
              {snap?.mounts.length ?? 0} local folders indexed • Browse in Library
            </div>
          </div>
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#2aa3c4' }}>Browse →</span>
        </button>

        {/* External USB / Optical CD-ROM Drive (Red Book CD-DA + DVD-Video) */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            background:
              opticalDisc?.is_audio_cd || opticalDisc?.is_dvd_video
                ? '#1b140c'
                : '#101016',
            border:
              opticalDisc?.is_audio_cd || opticalDisc?.is_dvd_video
                ? '1px solid #f59e0b'
                : '1px solid #24242e',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fcd34d' }}>
              💿 Optical CD-ROM & DVD-Video Drive
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
              {cdScanning
                ? '⏳ Reading Optical Disc (CD TOC / DVD-Video)...'
                : opticalDisc?.status_message ||
                  'Connect an external USB CD/DVD drive — no sudo required'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => handleScanOpticalDisc(true, false)}
              disabled={cdScanning}
              style={{
                minHeight: 36,
                padding: '0 12px',
                borderRadius: 8,
                background: '#1f160d',
                border: '1px solid #f59e0b',
                color: '#fcd34d',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {cdScanning ? 'Scanning...' : '🔄 Scan Disc'}
            </button>
            {(opticalDisc?.is_audio_cd || opticalDisc?.is_dvd_video) && (
              <button
                onClick={() => {
                  if (opticalDisc.is_dvd_video) {
                    setBrowserTarget({
                      kind: 'cdda',
                      id: opticalDisc.disc_id || opticalDisc.device_path || '/dev/sr0',
                      title: `📀 ${opticalDisc.album_title || 'DVD Video'}`,
                      subtitle: `${opticalDisc.artist_name || 'DVD-Video'}${
                        opticalDisc.release_year ? ` • ${opticalDisc.release_year}` : ''
                      }`,
                      art_url: opticalDisc.art_url,
                    });
                    setBrowserTracks([]);
                  } else {
                    setBrowserTarget({
                      kind: 'cdda',
                      id: opticalDisc.disc_id || opticalDisc.device_path || '/dev/sr0',
                      title: `💿 ${opticalDisc.album_title || 'Audio CD'}`,
                      subtitle: `${opticalDisc.artist_name || 'Unknown Artist'}${
                        opticalDisc.release_year ? ` • ${opticalDisc.release_year}` : ''
                      }`,
                      art_url: opticalDisc.art_url,
                    });
                    setBrowserTracks(opticalDisc.tracks);
                  }
                  setView('browser');
                  setSourceModalOpen(false);
                }}
                style={{
                  minHeight: 36,
                  padding: '0 12px',
                  borderRadius: 8,
                  background: '#0f222a',
                  border: '1px solid #2aa3c4',
                  color: '#bfeaf5',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {opticalDisc.is_dvd_video
                  ? `▶ Open DVD (${opticalDisc.dvd_titles?.length || 0})`
                  : `▶ Open CD (${opticalDisc.tracks.length})`}
              </button>
            )}
            {opticalDisc?.drive_present && (
              <button
                onClick={handleEjectOpticalDisc}
                style={{
                  minHeight: 36,
                  padding: '0 10px',
                  borderRadius: 8,
                  background: '#1f1216',
                  border: '1px solid #4c2228',
                  color: '#fca5a5',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ⏏ Eject
              </button>
            )}
          </div>
        </div>

        {/* Apple Music (MusicKit v3 + Companion QR Pairing) */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            background: snap?.apple_authenticated ? '#141018' : '#121218',
            border: snap?.apple_authenticated ? '1px solid #f43f5e' : '1px solid #24242e',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                🍎 Apple Music
              </div>
              <div style={{ fontSize: 11, color: '#8e8e99' }}>
                {snap?.apple_authenticated
                  ? '🟢 Connected — Browse Cloud Playlists, Radio & Full Albums'
                  : appleAuthCfg?.configured
                  ? 'Sign in with your Apple ID or scan the Companion QR code'
                  : 'Apple Music Developer Token not loaded'}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {appleAuthCfg?.configured && !snap?.apple_authenticated && (
                <button
                  disabled={appleBusy}
                  onClick={async () => {
                    setAppleBusy(true);
                    try {
                      await authorizeAppleMusic(showToast);
                      const updated = await defaultSimpClient.getAppleMusicAuthConfig();
                      setAppleAuthCfg(updated);
                      refreshLibraryData();
                    } catch (err: any) {
                      showToast(err?.message || 'Apple Music auth failed');
                    } finally {
                      setAppleBusy(false);
                    }
                  }}
                  style={{
                    minHeight: 36,
                    padding: '0 12px',
                    borderRadius: 8,
                    background: '#31101b',
                    border: '1px solid #f43f5e',
                    color: '#fda4af',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {appleBusy ? 'Working...' : 'Authorize Apple ID'}
                </button>
              )}

              {snap?.apple_authenticated && (
                <>
                  <button
                    onClick={() => {
                      setBrowserSourceFilter('apple_music');
                      setAppleSubTab('cloud_playlists');
                      setView('browser');
                      setSourceModalOpen(false);
                    }}
                    style={{
                      minHeight: 36,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#0f222a',
                      border: '1px solid #2aa3c4',
                      color: '#bfeaf5',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ☁️ Cloud Hub
                  </button>
                  <button
                    onClick={async () => {
                      await disconnectAppleMusicCleanSlate(showToast);
                      const updated = await defaultSimpClient
                        .getAppleMusicAuthConfig()
                        .catch(() => null);
                      if (updated) setAppleAuthCfg(updated);
                    }}
                    style={{
                      minHeight: 36,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#1f1216',
                      border: '1px solid #4c2228',
                      color: '#f87171',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Disconnect & Wipe Auth
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Console-Style LAN QR Companion Pairing Banner */}
          {appleAuthCfg?.configured && !snap?.apple_authenticated && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '10px 12px',
                borderRadius: 10,
                background: '#0a0a10',
                border: '1px solid #282838',
              }}
            >
              <QrCodeSvg
                value={appleAuthCfg.pair_url || 'http://steamdeck.local:18888/pair'}
                size={96}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#fda4af' }}>
                  📱 Scan to Pair with iPhone / Android / PC
                </div>
                <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.4 }}>
                  Sign in on your phone or PC where Face ID, Passkeys, and YubiKey / FIDO2 work natively. Having FIDO2 or security key issues? Visit the <code>/pair</code> URL below for troubleshooting & token tools.
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: '#67e8f9',
                    marginTop: 2,
                  }}
                >
                  {appleAuthCfg.pair_url || 'http://steamdeck.local:18888/pair'}
                </div>
              </div>
            </div>
          )}

          {snap?.apple_authenticated && (
            <div style={{ fontSize: 11, color: '#71717a' }}>
              Need to re-pair or use FIDO2 / token troubleshooting? Open{' '}
              <span style={{ fontFamily: 'monospace', color: '#67e8f9' }}>
                {appleAuthCfg?.pair_url || 'http://127.0.0.1:18888/pair'}
              </span>{' '}
              or use the <strong>⏻ Power Menu</strong>.
            </div>
          )}
        </div>

        {/* SoundCloud (OAuth 2.1 PKCE + Client Credentials Public Discovery) */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            background:
              snap?.soundcloud_authenticated || soundcloudAuthCfg?.soundcloud_authenticated
                ? '#18110c'
                : '#121218',
            border:
              snap?.soundcloud_authenticated || soundcloudAuthCfg?.soundcloud_authenticated
                ? '1px solid #ea580c'
                : '1px solid #24242e',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fdba74' }}>
                ☁️ SoundCloud
              </div>
              <div style={{ fontSize: 11, color: '#8e8e99' }}>
                {snap?.soundcloud_authenticated || soundcloudAuthCfg?.soundcloud_authenticated
                  ? soundcloudAuthCfg?.username
                    ? `🟢 Connected (@${soundcloudAuthCfg.username}) — Likes, Sets, Stream, Radio & DJ Mixes`
                    : '🟢 Public Discovery Active (Client Credentials) — Trending, Search, Radio & DJ Mixes'
                  : soundcloudAuthCfg?.configured
                  ? 'Sign in with SoundCloud (OAuth 2.1 PKCE) or enable Public Discovery'
                  : 'Configure SOUNDCLOUD_CLIENT_ID & SOUNDCLOUD_CLIENT_SECRET in .env or /pair'}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {soundcloudAuthCfg?.configured && (
                <button
                  disabled={soundcloudBusy}
                  onClick={async () => {
                    setSoundcloudBusy(true);
                    try {
                      await startSoundCloudOAuthLogin(showToast);
                      const updated = await defaultSimpClient.getSoundCloudAuthConfig();
                      setSoundcloudAuthCfg(updated);
                      refreshLibraryData();
                    } catch (err: any) {
                      showToast(err?.message || 'SoundCloud OAuth failed');
                    } finally {
                      setSoundcloudBusy(false);
                    }
                  }}
                  style={{
                    minHeight: 36,
                    padding: '0 12px',
                    borderRadius: 8,
                    background: '#2c140a',
                    border: '1px solid #ea580c',
                    color: '#fdba74',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {soundcloudBusy
                    ? 'Working...'
                    : soundcloudAuthCfg?.username
                    ? `Re-Auth (@${soundcloudAuthCfg.username})`
                    : 'Sign in with SoundCloud'}
                </button>
              )}

              {soundcloudAuthCfg?.configured &&
                !(snap?.soundcloud_authenticated || soundcloudAuthCfg?.soundcloud_authenticated) && (
                  <button
                    disabled={soundcloudBusy}
                    onClick={async () => {
                      setSoundcloudBusy(true);
                      try {
                        await enableSoundCloudPublicMode(showToast);
                        const updated = await defaultSimpClient.getSoundCloudAuthConfig();
                        setSoundcloudAuthCfg(updated);
                        refreshLibraryData();
                      } catch (err: any) {
                        showToast(err?.message || 'SoundCloud Public Mode failed');
                      } finally {
                        setSoundcloudBusy(false);
                      }
                    }}
                    style={{
                      minHeight: 36,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#161622',
                      border: '1px solid #2e2e40',
                      color: '#cbd5e1',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ⚡ Public Mode
                  </button>
                )}

              {(snap?.soundcloud_authenticated || soundcloudAuthCfg?.soundcloud_authenticated) && (
                <>
                  <button
                    onClick={() => {
                      setBrowserSourceFilter('soundcloud');
                      setSoundCloudSubTab(
                        soundcloudAuthCfg?.username ? 'likes_sets' : 'trending'
                      );
                      setView('browser');
                      setSourceModalOpen(false);
                    }}
                    style={{
                      minHeight: 36,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#0f222a',
                      border: '1px solid #2aa3c4',
                      color: '#bfeaf5',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ☁️ SoundCloud Hub
                  </button>
                  <button
                    onClick={async () => {
                      await disconnectSoundCloudCleanSlate(showToast);
                      const updated = await defaultSimpClient
                        .getSoundCloudAuthConfig()
                        .catch(() => null);
                      if (updated) setSoundcloudAuthCfg(updated);
                    }}
                    style={{
                      minHeight: 36,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#1f1216',
                      border: '1px solid #4c2228',
                      color: '#f87171',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#71717a' }}>
            Redirect URI:{' '}
            <span style={{ fontFamily: 'monospace', color: '#fdba74' }}>
              {soundcloudAuthCfg?.redirect_uri ||
                'http://127.0.0.1:18888/api/soundcloud/callback'}
            </span>
          </div>
        </div>

        {/* Internet Archive (Free Digital Library Card — Public Domain Movies, TV, Concerts & Audio) */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            background: iaEnabledLocal ? '#101815' : '#121218',
            border: iaEnabledLocal ? '1px solid #34d399' : '1px solid #24242e',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6ee7b7' }}>
                🏛️ Internet Archive — Free Digital Library Card
              </div>
              <div style={{ fontSize: 11, color: '#8e8e99' }}>
                {iaEnabledLocal
                  ? iaUsername.trim()
                    ? `🟢 Active (@${iaUsername.trim()}) — Feature Films, Classic TV, Live Concerts & Audio`
                    : '🟢 Active — Stream Public Domain Films, TV, Animation, Live Concerts & Audio'
                  : 'No subscription required — 1-click access to archive.org video & audio collections'}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {!iaEnabledLocal ? (
                <button
                  onClick={() => {
                    defaultSimpClient.configureInternetArchive({
                      enabled: true,
                      username: iaUsername.trim(),
                    });
                    setIaEnabledLocal(true);
                    showToast('Internet Archive Library Card enabled');
                    refreshLibraryData();
                  }}
                  style={{
                    minHeight: 36,
                    padding: '0 12px',
                    borderRadius: 8,
                    background: '#0d261e',
                    border: '1px solid #34d399',
                    color: '#a7f3d0',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Enable Free Library Card
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setBrowserSourceFilter('internet_archive');
                      setView('browser');
                      setSourceModalOpen(false);
                    }}
                    style={{
                      minHeight: 36,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#0f222a',
                      border: '1px solid #2aa3c4',
                      color: '#bfeaf5',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Open Archive
                  </button>
                  <button
                    onClick={() => {
                      defaultSimpClient.disconnectInternetArchive();
                      setIaEnabledLocal(false);
                      setIaUsername('');
                      showToast('Internet Archive disconnected');
                      refreshLibraryData();
                    }}
                    style={{
                      minHeight: 36,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#1f1216',
                      border: '1px solid #4c2228',
                      color: '#f87171',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>

          {iaEnabledLocal && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Optional @username on archive.org (syncs fav-@username)"
                  value={iaUsername}
                  onChange={(e) => setIaUsername(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      defaultSimpClient.configureInternetArchive({
                        enabled: true,
                        username: iaUsername.trim(),
                        ...(iaAccessKey.trim() ? { access_key: iaAccessKey.trim() } : {}),
                        ...(iaSecretKey.trim() ? { secret_key: iaSecretKey.trim() } : {}),
                      });
                      showToast(
                        iaUsername.trim()
                          ? `Saved Internet Archive @${iaUsername.trim()}`
                          : 'Updated Internet Archive settings'
                      );
                    }
                  }}
                  style={{
                    flex: 1,
                    minWidth: 180,
                    minHeight: 34,
                    padding: '0 10px',
                    borderRadius: 8,
                    background: '#080b0a',
                    border: '1px solid #243830',
                    color: '#d4d4dc',
                    fontSize: 11,
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  onClick={() => {
                    defaultSimpClient.configureInternetArchive({
                      enabled: true,
                      username: iaUsername.trim(),
                      ...(iaAccessKey.trim() ? { access_key: iaAccessKey.trim() } : {}),
                      ...(iaSecretKey.trim() ? { secret_key: iaSecretKey.trim() } : {}),
                    });
                    showToast(
                      iaUsername.trim()
                        ? `Saved Internet Archive @${iaUsername.trim()}`
                        : 'Updated Internet Archive settings'
                    );
                  }}
                  style={{
                    minHeight: 34,
                    padding: '0 12px',
                    borderRadius: 8,
                    background: '#132a22',
                    border: '1px solid #34d399',
                    color: '#a7f3d0',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setIaKeysOpen((v) => !v)}
                  style={{
                    minHeight: 34,
                    padding: '0 10px',
                    borderRadius: 8,
                    background: '#0e1412',
                    border: '1px solid #243830',
                    color: '#9ca3af',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {iaKeysOpen ? '▾ Hide S3 Keys' : '▸ Optional S3 Keys'}
                </button>
              </div>

              {iaKeysOpen && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: '#080b0a',
                    border: '1px solid #1e2e28',
                  }}
                >
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>
                    Optional IAS3 keys from <code>archive.org/account/s3.php</code> for higher rate
                    limits (`Authorization: LOW access:secret`).
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      placeholder="IAS3 Access Key"
                      value={iaAccessKey}
                      onChange={(e) => setIaAccessKey(e.target.value)}
                      style={{
                        flex: 1,
                        minWidth: 140,
                        minHeight: 32,
                        padding: '0 8px',
                        borderRadius: 6,
                        background: '#050706',
                        border: '1px solid #243830',
                        color: '#d4d4dc',
                        fontSize: 11,
                        fontFamily: 'monospace',
                      }}
                    />
                    <input
                      type="password"
                      placeholder="IAS3 Secret Key"
                      value={iaSecretKey}
                      onChange={(e) => setIaSecretKey(e.target.value)}
                      style={{
                        flex: 1,
                        minWidth: 140,
                        minHeight: 32,
                        padding: '0 8px',
                        borderRadius: 6,
                        background: '#050706',
                        border: '1px solid #243830',
                        color: '#d4d4dc',
                        fontSize: 11,
                        fontFamily: 'monospace',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Collapsible Phone / PC Companion Pairing & Diagnostics (/pair) */}
        <div
          style={{
            borderRadius: 12,
            background: '#0d0d14',
            border: '1px solid #262636',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => setPairHelpOpen((v) => !v)}
            style={{
              width: '100%',
              minHeight: 44,
              padding: '10px 14px',
              background: 'transparent',
              border: 'none',
              color: '#a1a1aa',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              textAlign: 'left',
            }}
          >
            <span>🛠️ Companion Pairing & Auth Diagnostics (/pair)</span>
            <span style={{ fontFamily: 'monospace', color: '#67e8f9' }}>
              {pairHelpOpen ? '▾ Hide' : '▸ Show QR'}
            </span>
          </button>

          {pairHelpOpen && (
            <div
              style={{
                padding: '0 14px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                borderTop: '1px solid #1c1c28',
                paddingTop: 12,
              }}
            >
              <QrCodeSvg
                value={appleAuthCfg?.pair_url || 'http://steamdeck.local:18888/pair'}
                size={84}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#67e8f9' }}>
                  📱 Remote Phone / PC Companion Portal
                </div>
                <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.4 }}>
                  Scan with your phone or visit on a PC to pair Apple Music / SoundCloud or access{' '}
                  <strong>FIDO2 / YubiKey & Token Debug</strong> tools.
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginTop: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: '#fda4af',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {appleAuthCfg?.pair_url || 'http://127.0.0.1:18888/pair'}
                  </span>
                  <a
                    href="/pair"
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      padding: '5px 10px',
                      borderRadius: 8,
                      background: '#171724',
                      border: '1px solid #2aa3c4',
                      color: '#bfeaf5',
                      fontSize: 11,
                      fontWeight: 700,
                      textDecoration: 'none',
                    }}
                  >
                    Open /pair ↗
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <button
            onClick={() => {
              defaultSimpClient.rescanStorage();
              showToast('Rescanning local folders...');
              setSourceModalOpen(false);
            }}
            style={{
              minHeight: 44,
              padding: '0 16px',
              borderRadius: 12,
              background: '#16161f',
              border: '1px solid #2e2e3a',
              color: '#d4d4dc',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            🔄 Rescan Local Folders
          </button>
          <button
            onClick={() => {
              setSourceModalOpen(false);
              setPowerModalOpen(true);
            }}
            style={{
              minHeight: 44,
              padding: '0 16px',
              borderRadius: 12,
              background: '#12121a',
              border: '1px solid #2e2e3a',
              color: '#9ca3af',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ⏻ Power & System Menu →
          </button>
        </div>
      </div>
    </div>
  );
};

