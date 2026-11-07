import React, { useEffect, useState } from 'react';
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

interface DaemonPerfSnapshot {
  cpu_percent: number;
  rss_mb: number;
  platform: string;
  audio_backend: string;
  portable_mode?: boolean;
}

export interface SimpUpdateStatus {
  current_version?: string;
  latest_version?: string;
  latest_tag?: string;
  update_available?: boolean;
  target_arch?: string;
  channel?: string;
  checking?: boolean;
  applying?: boolean;
  error?: string;
}

export interface SourceVisibilityPrefs {
  internet_archive: boolean;
  apple_music: boolean;
  soundcloud: boolean;
  optical_drive: boolean;
}

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
  setIsSleeping: React.Dispatch<React.SetStateAction<boolean>>;
  dismissConsole: () => void;
  brightnessPct: number;
  setBrightnessPct: React.Dispatch<React.SetStateAction<number>>;
  updateStatus: SimpUpdateStatus;
  checkSimpUpdates: (silent?: boolean) => Promise<void>;
  applySimpUpdate: () => Promise<void>;
  confirmHardReset: boolean;
  setConfirmHardReset: React.Dispatch<React.SetStateAction<boolean>>;
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
  sourceVisibility: SourceVisibilityPrefs;
  setSourceVisibility: React.Dispatch<React.SetStateAction<SourceVisibilityPrefs>>;
  refreshLibraryData: () => void;
  applyFocusMarker?: (el: HTMLElement | null) => void;
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
  setIsSleeping,
  dismissConsole,
  brightnessPct,
  setBrightnessPct,
  updateStatus,
  checkSimpUpdates,
  applySimpUpdate,
  confirmHardReset,
  setConfirmHardReset,
  opticalDisc,
  cdScanning,
  handleScanOpticalDisc,
  handleEjectOpticalDisc,
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
  sourceVisibility,
  setSourceVisibility,
  refreshLibraryData,
  applyFocusMarker,
  showToast,
}) => {
  // Slide-out Folders & Accounts secondary column state
  const [foldersAccountsOpen, setFoldersAccountsOpen] = useState(false);
  const [iaAuthOpen, setIaAuthOpen] = useState(false);
  const [appleAuthOpen, setAppleAuthOpen] = useState(false);
  const [scAuthOpen, setScAuthOpen] = useState(false);
  const [addPathOpen, setAddPathOpen] = useState(false);

  const [iaUsername, setIaUsername] = useState('');
  const [iaAccessKey, setIaAccessKey] = useState('');
  const [iaSecretKey, setIaSecretKey] = useState('');
  const [iaEnabledLocal, setIaEnabledLocal] = useState(
    !!snap?.internet_archive_authenticated
  );
  const [iaSafeSearch, setIaSafeSearch] = useState(false);
  const [perfSnap, setPerfSnap] = useState<DaemonPerfSnapshot | null>(null);

  const closeSettingsDrawer = () => {
    setSourceModalOpen(false);
    setPowerModalOpen(false);
    setConfirmHardReset(false);
  };

  useEffect(() => {
    setIaEnabledLocal(!!snap?.internet_archive_authenticated);
    defaultSimpClient
      .getInternetArchiveConfig()
      .then((cfg) => {
        if (cfg) {
          setIaEnabledLocal(!!cfg.enabled);
          setIaUsername(cfg.username || '');
          setIaSafeSearch(!!cfg.safe_search);
        }
      })
      .catch(() => {});
  }, [snap?.internet_archive_authenticated]);

  useEffect(() => {
    let cancelled = false;
    const fetchPerf = async () => {
      try {
        const res = await fetch('http://127.0.0.1:18888/api/v1/system/perf');
        if (res.ok) {
          const data = (await res.json()) as DaemonPerfSnapshot;
          if (!cancelled) setPerfSnap(data);
        }
      } catch {
        // Ignore transient offline error
      }
    };
    fetchPerf();
    const timer = window.setInterval(fetchPerf, 1800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const toggleSourceVisible = (key: keyof SourceVisibilityPrefs) => {
    setSourceVisibility((prev) => {
      const nextVal = !prev[key];
      const next = { ...prev, [key]: nextVal };
      try {
        window.localStorage.setItem('simp_source_visibility_v1', JSON.stringify(next));
      } catch {}
      if (key === 'internet_archive') {
        defaultSimpClient.configureInternetArchive({
          enabled: nextVal,
          username: iaUsername.trim(),
          safe_search: iaSafeSearch,
        });
        setIaEnabledLocal(nextVal);
      }
      return next;
    });
  };

  const openFoldersAccountsPanel = () => {
    setFoldersAccountsOpen(true);
    window.setTimeout(() => {
      const firstSubBtn = document.querySelector<HTMLElement>(
        '[data-settings-col="sub"] button[data-sub-default="true"]:not([disabled]), [data-settings-col="sub"] button:not([disabled])'
      );
      if (firstSubBtn && applyFocusMarker) {
        applyFocusMarker(firstSubBtn);
      }
    }, 35);
  };

  const closeFoldersAccountsPanel = () => {
    setConfirmHardReset(false);
    setAddPathOpen(false);
    setIaAuthOpen(false);
    setAppleAuthOpen(false);
    setScAuthOpen(false);
    setFoldersAccountsOpen(false);
    window.setTimeout(() => {
      const triggerBtn = document.querySelector<HTMLElement>(
        '[data-settings-folders-trigger="true"]:not([disabled])'
      );
      if (triggerBtn && applyFocusMarker) {
        applyFocusMarker(triggerBtn);
      }
    }, 35);
  };

  // Determine if a sub-level or slide-out column is open so `B` / `ESC` walks back cleanly
  const hasNestedChildOpen =
    confirmHardReset ||
    addPathOpen ||
    iaAuthOpen ||
    appleAuthOpen ||
    scAuthOpen ||
    foldersAccountsOpen;

  const handleWalkBackNested = () => {
    if (confirmHardReset) {
      setConfirmHardReset(false);
    } else if (addPathOpen) {
      setAddPathOpen(false);
    } else if (iaAuthOpen) {
      setIaAuthOpen(false);
    } else if (appleAuthOpen) {
      setAppleAuthOpen(false);
    } else if (scAuthOpen) {
      setScAuthOpen(false);
    } else if (foldersAccountsOpen) {
      closeFoldersAccountsPanel();
    }
  };

  return (
    <div
      onClick={closeSettingsDrawer}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.72)',
        zIndex: 55,
      }}
    >
      {/* Hidden walk-back hook button triggered by `useGamepadNavigation` when `B` / `ESC` is pressed */}
      {hasNestedChildOpen && (
        <button
          type="button"
          data-settings-walk-back="true"
          onClick={handleWalkBackNested}
          style={{ display: 'none' }}
        />
      )}

      <div
        data-modal-root="true"
        data-settings-drawer="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: 58,
          right: 16,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 76px)',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        {/* Slide-Out Left Panel: Folders & Accounts Dedicated Column */}
        {foldersAccountsOpen && (
          <div
            data-settings-col="sub"
            style={{
              width: 'min(480px, calc(100vw - 440px))',
              minWidth: 340,
              maxHeight: 'calc(100vh - 76px)',
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y',
              background: '#09090f',
              border: '2px solid #2aa3c4',
              borderRadius: 18,
              padding: 16,
              boxSizing: 'border-box',
              boxShadow: '0 20px 52px rgba(0, 0, 0, 0.92)',
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
                paddingBottom: 8,
                borderBottom: '1px solid #1e1e2a',
              }}
            >
              <strong style={{ fontSize: 13.5, color: '#bfeaf5' }}>
                📁 Folders & Accounts
              </strong>
              <button
                type="button"
                onClick={closeFoldersAccountsPanel}
                style={{
                  minHeight: 32,
                  padding: '0 10px',
                  borderRadius: 8,
                  background: '#16161f',
                  border: '1px solid #2e2e3a',
                  color: '#d4d4dc',
                  fontFamily: 'monospace',
                  fontSize: 11.5,
                  cursor: 'pointer',
                }}
              >
                Shut ▸
              </button>
            </div>

            {/* + Internet Archive [Show/Hide, Safe Search, Sign In] */}
            <div style={nestedCardStyle}>
              <div style={nestedHeaderRowStyle}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#6ee7b7' }}>
                  🏛️ Internet Archive
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    data-sub-default="true"
                    onClick={() => toggleSourceVisible('internet_archive')}
                    style={pillToggleStyle(sourceVisibility.internet_archive, '#34d399')}
                  >
                    {sourceVisibility.internet_archive ? '🚫 Hide' : '👁 Show'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextSafe = !iaSafeSearch;
                      setIaSafeSearch(nextSafe);
                      defaultSimpClient.configureInternetArchive({
                        enabled: sourceVisibility.internet_archive || iaEnabledLocal,
                        username: iaUsername.trim(),
                        safe_search: nextSafe,
                      });
                      showToast(
                        nextSafe
                          ? '🛡️ Archive Safe Search enabled'
                          : '🛡️ Archive Safe Search disabled'
                      );
                      refreshLibraryData();
                    }}
                    style={pillToggleStyle(iaSafeSearch, '#38bdf8')}
                  >
                    🛡️ Safe: {iaSafeSearch ? 'On' : 'Off'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIaAuthOpen((v) => !v)}
                    style={pillToggleStyle(iaAuthOpen || Boolean(iaUsername.trim()), '#a7f3d0')}
                  >
                    {iaUsername.trim() ? `@${iaUsername.trim()}` : 'Sign In'} {iaAuthOpen ? '▾' : '▸'}
                  </button>
                </div>
              </div>

              {iaAuthOpen && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    paddingTop: 6,
                    borderTop: '1px solid #1c2824',
                  }}
                >
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      placeholder="Archive.org @username (syncs fav-@username)"
                      value={iaUsername}
                      onChange={(e) => setIaUsername(e.target.value)}
                      style={compactInputStyle}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        defaultSimpClient.configureInternetArchive({
                          enabled: true,
                          username: iaUsername.trim(),
                          safe_search: iaSafeSearch,
                          ...(iaAccessKey.trim() ? { access_key: iaAccessKey.trim() } : {}),
                          ...(iaSecretKey.trim() ? { secret_key: iaSecretKey.trim() } : {}),
                        });
                        setIaEnabledLocal(true);
                        setSourceVisibility((p) => ({ ...p, internet_archive: true }));
                        showToast(
                          iaUsername.trim()
                            ? `Saved Internet Archive @${iaUsername.trim()}`
                            : 'Saved Internet Archive settings'
                        );
                        refreshLibraryData();
                      }}
                      style={compactPrimaryBtnStyle}
                    >
                      Save
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      placeholder="Optional IAS3 Access Key"
                      value={iaAccessKey}
                      onChange={(e) => setIaAccessKey(e.target.value)}
                      style={compactInputStyle}
                    />
                    <input
                      type="password"
                      placeholder="Optional IAS3 Secret Key"
                      value={iaSecretKey}
                      onChange={(e) => setIaSecretKey(e.target.value)}
                      style={compactInputStyle}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* + Apple Music [Show/Hide, Sign In] */}
            <div style={nestedCardStyle}>
              <div style={nestedHeaderRowStyle}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#fda4af' }}>
                  🍎 Apple Music
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => toggleSourceVisible('apple_music')}
                    style={pillToggleStyle(sourceVisibility.apple_music, '#f43f5e')}
                  >
                    {sourceVisibility.apple_music ? '🚫 Hide' : '👁 Show'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppleAuthOpen((v) => !v)}
                    style={pillToggleStyle(!!snap?.apple_authenticated || appleAuthOpen, '#fda4af')}
                  >
                    {snap?.apple_authenticated ? '🟢 Connected' : 'Sign In'} {appleAuthOpen ? '▾' : '▸'}
                  </button>
                </div>
              </div>

              {appleAuthOpen && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    paddingTop: 6,
                    borderTop: '1px solid #281820',
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {!snap?.apple_authenticated ? (
                      <button
                        type="button"
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
                          ...compactPrimaryBtnStyle,
                          background: '#31101b',
                          borderColor: '#f43f5e',
                          color: '#fda4af',
                        }}
                      >
                        {appleBusy ? 'Working...' : 'Authorize Apple ID'}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setBrowserSourceFilter('apple_music');
                            setAppleSubTab('cloud_playlists');
                            setView('browser');
                            closeSettingsDrawer();
                          }}
                          style={compactPrimaryBtnStyle}
                        >
                          Open Cloud Hub
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await disconnectAppleMusicCleanSlate(showToast);
                            const updated = await defaultSimpClient
                              .getAppleMusicAuthConfig()
                              .catch(() => null);
                            if (updated) setAppleAuthCfg(updated);
                          }}
                          style={compactDangerBtnStyle}
                        >
                          Disconnect
                        </button>
                      </>
                    )}
                  </div>

                  {appleAuthCfg?.pair_url && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: 8,
                        borderRadius: 8,
                        background: '#08080c',
                        border: '1px solid #222230',
                      }}
                    >
                      <QrCodeSvg value={appleAuthCfg.pair_url} size={68} />
                      <div style={{ minWidth: 0, flex: 1, fontSize: 10.5, color: '#a1a1aa' }}>
                        <div style={{ fontWeight: 800, color: '#fda4af', marginBottom: 2 }}>
                          📱 Companion Pairing QR
                        </div>
                        <div>Scan on phone/PC for Face ID, Passkey, or FIDO2 sign-in:</div>
                        <div
                          style={{
                            fontFamily: 'monospace',
                            color: '#67e8f9',
                            marginTop: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {appleAuthCfg.pair_url}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* + SoundCloud [Show/Hide, Sign In] */}
            <div style={nestedCardStyle}>
              <div style={nestedHeaderRowStyle}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#fdba74' }}>
                  ☁️ SoundCloud
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => toggleSourceVisible('soundcloud')}
                    style={pillToggleStyle(sourceVisibility.soundcloud, '#ea580c')}
                  >
                    {sourceVisibility.soundcloud ? '🚫 Hide' : '👁 Show'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScAuthOpen((v) => !v)}
                    style={pillToggleStyle(
                      Boolean(
                        snap?.soundcloud_authenticated ||
                          soundcloudAuthCfg?.soundcloud_authenticated ||
                          scAuthOpen
                      ),
                      '#fdba74'
                    )}
                  >
                    {soundcloudAuthCfg?.username
                      ? `@${soundcloudAuthCfg.username}`
                      : snap?.soundcloud_authenticated ||
                        soundcloudAuthCfg?.soundcloud_authenticated
                      ? '🟢 Public'
                      : 'Sign In'}{' '}
                    {scAuthOpen ? '▾' : '▸'}
                  </button>
                </div>
              </div>

              {scAuthOpen && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    paddingTop: 6,
                    borderTop: '1px solid #281c14',
                  }}
                >
                  <button
                    type="button"
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
                      ...compactPrimaryBtnStyle,
                      background: '#2c140a',
                      borderColor: '#ea580c',
                      color: '#fdba74',
                    }}
                  >
                    {soundcloudBusy ? 'Working...' : 'OAuth Sign In'}
                  </button>
                  <button
                    type="button"
                    disabled={soundcloudBusy}
                    onClick={async () => {
                      setSoundcloudBusy(true);
                      try {
                        await enableSoundCloudPublicMode(showToast);
                        const updated = await defaultSimpClient.getSoundCloudAuthConfig();
                        setSoundcloudAuthCfg(updated);
                        refreshLibraryData();
                      } catch (err: any) {
                        showToast(err?.message || 'Public Mode failed');
                      } finally {
                        setSoundcloudBusy(false);
                      }
                    }}
                    style={compactPrimaryBtnStyle}
                  >
                    ⚡ Public Mode
                  </button>
                  {(snap?.soundcloud_authenticated ||
                    soundcloudAuthCfg?.soundcloud_authenticated) && (
                    <button
                      type="button"
                      onClick={async () => {
                        await disconnectSoundCloudCleanSlate(showToast);
                        const updated = await defaultSimpClient
                          .getSoundCloudAuthConfig()
                          .catch(() => null);
                        if (updated) setSoundcloudAuthCfg(updated);
                      }}
                      style={compactDangerBtnStyle}
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* + Optical Drive [Show/Hide] */}
            <div style={nestedCardStyle}>
              <div style={nestedHeaderRowStyle}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#fcd34d' }}>
                  💿 Optical Drive
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => toggleSourceVisible('optical_drive')}
                    style={pillToggleStyle(sourceVisibility.optical_drive, '#f59e0b')}
                  >
                    {sourceVisibility.optical_drive ? '🚫 Hide' : '👁 Show'}
                  </button>
                  {sourceVisibility.optical_drive && (
                    <>
                      <button
                        type="button"
                        disabled={cdScanning}
                        onClick={() => handleScanOpticalDisc(true, false)}
                        style={pillToggleStyle(false, '#fcd34d')}
                      >
                        {cdScanning ? '⏳...' : '🔄 Scan'}
                      </button>
                      {opticalDisc?.drive_present && (
                        <button
                          type="button"
                          onClick={handleEjectOpticalDisc}
                          style={pillToggleStyle(false, '#fca5a5')}
                        >
                          ⏏ Eject
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* + Folders */}
            <div style={nestedCardStyle}>
              <div style={nestedHeaderRowStyle}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#67e8f9' }}>
                  📁 Local Folders ({snap?.mounts?.length || 0})
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setAddPathOpen((v) => !v)}
                    style={pillToggleStyle(addPathOpen, '#2aa3c4')}
                  >
                    + Add local path
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      defaultSimpClient.rescanStorage();
                      showToast('Rescanning local folders...');
                    }}
                    style={pillToggleStyle(false, '#bfeaf5')}
                  >
                    🔄 Rescan
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  paddingTop: 6,
                  borderTop: '1px solid #1e1e2c',
                }}
              >
                {addPathOpen && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      data-osk-input="folder"
                      placeholder="/path/to/music-or-videos"
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
                      style={compactInputStyle}
                    />
                    <button
                      type="button"
                      onClick={() => handleAddFolder(customFolderPath)}
                      style={compactPrimaryBtnStyle}
                    >
                      Add
                    </button>
                  </div>
                )}

                {snap?.mounts && snap.mounts.length > 0 ? (
                  <div
                    style={{
                      maxHeight: 150,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
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
                          padding: '5px 8px',
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
                          {m.mount_root} ({m.track_count})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFolder(m.mount_root, m.label)}
                          style={compactDangerBtnStyle}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#71717a' }}>No mounted local paths</div>
                )}
              </div>
            </div>

            {/* + [ Reset DB (Preserves Auth) ] & + [ HARD RESET ] */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  defaultSimpClient.resetDatabaseCache();
                  showToast('Cleared DB cache & rescanning folders...');
                  closeSettingsDrawer();
                  window.setTimeout(() => refreshLibraryData(), 600);
                }}
                style={{
                  minHeight: 40,
                  padding: '6px 10px',
                  borderRadius: 10,
                  background: '#14141e',
                  border: '1px solid #2c2c3c',
                  color: '#d4d4dc',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                🧹 Reset DB (Preserves Auth)
              </button>

              <button
                type="button"
                onClick={() => setConfirmHardReset((v) => !v)}
                style={{
                  minHeight: 40,
                  padding: '6px 10px',
                  borderRadius: 10,
                  background: '#221115',
                  border: '1px solid #5c222d',
                  color: '#f87171',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                ⚠️ Hard Reset
              </button>
            </div>

            {confirmHardReset && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 10,
                  background: '#2a0e13',
                  border: '1px solid #ef4444',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 11.5, fontWeight: 800, color: '#fecaca' }}>
                  ⚠️ Confirm Hard Reset (Wipes Auth, Playlists & Settings)?
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      defaultSimpClient.factoryReset();
                      closeSettingsDrawer();
                      showToast('Factory reset complete');
                      window.setTimeout(() => refreshLibraryData(), 600);
                    }}
                    style={{
                      flex: 1,
                      minHeight: 34,
                      borderRadius: 8,
                      background: '#dc2626',
                      border: '1px solid #f87171',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Yes, Hard Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmHardReset(false)}
                    style={{
                      minHeight: 34,
                      padding: '0 12px',
                      borderRadius: 8,
                      background: '#181822',
                      border: '1px solid #2e2e3c',
                      color: '#d4d4dc',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Primary Right Column: Settings Menu */}
        <div
          data-settings-col="main"
          style={{
            width: 'min(420px, calc(100vw - 32px))',
            maxHeight: 'calc(100vh - 76px)',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y',
            background: '#09090f',
            border: '2px solid #2aa3c4',
            borderRadius: 18,
            padding: 16,
            boxSizing: 'border-box',
            boxShadow: '0 20px 52px rgba(0, 0, 0, 0.92)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            flexShrink: 0,
          }}
        >
          {/* Header Row */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingBottom: 8,
              borderBottom: '1px solid #1e1e2a',
            }}
          >
            <strong style={{ fontSize: 14, color: '#bfeaf5' }}>
              ☰ Settings<span className="simp-gp-badge"> (START)</span>
            </strong>
            <button
              type="button"
              onClick={closeSettingsDrawer}
              style={{
                minHeight: 34,
                padding: '0 12px',
                borderRadius: 8,
                background: '#16161f',
                border: '1px solid #2e2e3a',
                color: '#d4d4dc',
                fontFamily: 'monospace',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              ✕<span className="simp-gp-badge"> B</span>
            </button>
          </div>

          {/* Row 1: [BRIGHTNESS SLIDER] [SLEEP SCREEN] */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 8 }}>
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 12,
                background: '#0e0e16',
                border: '1px solid #222230',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: '#bfeaf5' }}>
                  🔅 Brightness
                </span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#67e8f9' }}>
                  {brightnessPct}%
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  data-default-focus="true"
                  onClick={() => setBrightnessPct((b) => Math.max(25, b - 10))}
                  style={smallStepBtnStyle}
                >
                  −
                </button>
                <input
                  type="range"
                  min={25}
                  max={100}
                  step={5}
                  value={brightnessPct}
                  onChange={(e) => setBrightnessPct(Number(e.target.value))}
                  style={{
                    flex: 1,
                    accentColor: '#2aa3c4',
                    cursor: 'pointer',
                    minWidth: 0,
                  }}
                />
                <button
                  type="button"
                  onClick={() => setBrightnessPct((b) => Math.min(100, b + 10))}
                  style={smallStepBtnStyle}
                >
                  +
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                closeSettingsDrawer();
                setIsSleeping(true);
              }}
              style={{
                minHeight: 56,
                padding: '8px 12px',
                borderRadius: 12,
                background: '#0d1b22',
                border: '1px solid #2aa3c4',
                color: '#bfeaf5',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 3,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 800 }}>🌙 Sleep Screen</span>
              <span style={{ fontSize: 10.5, color: '#8e8e99' }}>True-black OLED saver</span>
            </button>
          </div>

          {/* Row 2: [POWER OFF] [RESET SERVICE] */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                defaultSimpClient.shutdownDaemon();
                closeSettingsDrawer();
                window.setTimeout(() => dismissConsole(), 250);
              }}
              style={{
                minHeight: 50,
                padding: '8px 12px',
                borderRadius: 12,
                background: '#221014',
                border: '1px solid #7f1d1d',
                color: '#fca5a5',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 2,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 800 }}>⏻ Power Off</span>
              <span style={{ fontSize: 10.5, color: '#fca5a5', opacity: 0.8 }}>
                Stop daemon & exit
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                defaultSimpClient.pause();
                defaultSimpClient.restartDaemon();
                showToast('Restarting SIMP background service...');
                closeSettingsDrawer();
                if (window.parent && window.parent !== window) {
                  window.setTimeout(() => dismissConsole(), 300);
                } else {
                  window.setTimeout(() => window.location.reload(), 900);
                }
              }}
              style={{
                minHeight: 50,
                padding: '8px 12px',
                borderRadius: 12,
                background: '#151320',
                border: '1px solid #3b3354',
                color: '#ddd6fe',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 2,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 800 }}>🔄 Reset Service</span>
              <span style={{ fontSize: 10.5, color: '#a1a1aa' }}>Restart audio daemon</span>
            </button>
          </div>

          {/* Row 3: [Folders & Accounts] Slide-Out Trigger */}
          <button
            type="button"
            data-settings-folders-trigger="true"
            onClick={() => {
              if (foldersAccountsOpen) {
                closeFoldersAccountsPanel();
              } else {
                openFoldersAccountsPanel();
              }
            }}
            style={{
              width: '100%',
              minHeight: 48,
              padding: '10px 14px',
              borderRadius: 14,
              background: foldersAccountsOpen ? '#0f222a' : '#0d0d14',
              border: foldersAccountsOpen ? '1px solid #2aa3c4' : '1px solid #222230',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#bfeaf5' }}>
                📁 Folders & Accounts
              </span>
              <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                Internet Archive, Apple Music, SoundCloud, Optical & Local Paths
              </span>
            </div>
            <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#67e8f9', fontWeight: 900 }}>
              {foldersAccountsOpen ? '▸ Shut' : '◄ Open'}
            </span>
          </button>

          {/* Row 4: Perf Metrics (Always Visible Inline — Not Hidden Behind Dropdown) */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 14,
              background: '#0d0d14',
              border: '1px solid #222230',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#d4d4dc' }}>
                📊 Perf Metrics
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8e8e99' }}>
                {perfSnap?.audio_backend || 'PipeWire'} • {perfSnap?.platform || 'Linux'}
              </span>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 11.5, color: '#a1a1aa' }}>
              CPU:{' '}
              <strong style={{ color: '#6ee7b7' }}>
                {perfSnap?.cpu_percent.toFixed(1) ?? '0.0'}%
              </strong>{' '}
              • RAM (RSS):{' '}
              <strong style={{ color: '#67e8f9' }}>
                {perfSnap?.rss_mb.toFixed(1) ?? '0.0'} MB
              </strong>
            </div>
          </div>

          {/* Row 5: Upgrade Check (Always Visible Inline — Not Hidden Behind +) */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 14,
              background: '#0d0d14',
              border: updateStatus.update_available ? '1px solid #2aa3c4' : '1px solid #222230',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#bfeaf5' }}>
                ⬆️ Upgrade Check{' '}
                {updateStatus.current_version ? (
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#8e8e99' }}>
                    (v{updateStatus.current_version})
                  </span>
                ) : null}
              </span>
              <span style={{ fontSize: 11, color: updateStatus.update_available ? '#6ee7b7' : '#9ca3af' }}>
                {updateStatus.applying
                  ? 'Installing...'
                  : updateStatus.checking
                  ? 'Checking...'
                  : updateStatus.error
                  ? '⚠️ Error'
                  : updateStatus.update_available
                  ? `🟢 ${updateStatus.latest_tag} Ready`
                  : updateStatus.latest_tag
                  ? `Up to date`
                  : ''}
              </span>
            </div>
            {updateStatus.error && (
              <div style={{ fontSize: 10.5, color: '#fca5a5' }}>{updateStatus.error}</div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={Boolean(updateStatus.checking || updateStatus.applying)}
                onClick={async () => {
                  const nextChannel =
                    (updateStatus.channel || 'alpha').toLowerCase() === 'stable'
                      ? 'alpha'
                      : 'stable';
                  try {
                    await fetch('http://127.0.0.1:18888/api/update/channel', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ channel: nextChannel }),
                    });
                    showToast(
                      nextChannel === 'stable'
                        ? 'Update channel set to Stable (official releases only)'
                        : 'Update channel set to Alpha (includes pre-releases)'
                    );
                    checkSimpUpdates(false);
                  } catch {
                    showToast('Failed to switch update channel');
                  }
                }}
                style={pillToggleStyle(
                  (updateStatus.channel || 'alpha').toLowerCase() === 'stable',
                  '#6ee7b7'
                )}
              >
                {(updateStatus.channel || 'alpha').toLowerCase() === 'stable'
                  ? '🛡️ Channel: Stable'
                  : '🧪 Channel: Alpha'}
              </button>
              <button
                type="button"
                disabled={Boolean(updateStatus.checking || updateStatus.applying)}
                onClick={() => checkSimpUpdates(false)}
                style={compactPrimaryBtnStyle}
              >
                {updateStatus.checking ? 'Checking...' : '🔍 Check for Updates'}
              </button>
              <button
                type="button"
                disabled={Boolean(updateStatus.applying)}
                onClick={applySimpUpdate}
                style={{
                  ...compactPrimaryBtnStyle,
                  background: updateStatus.update_available ? '#0f2936' : '#181824',
                }}
              >
                {updateStatus.applying
                  ? '⏳ Updating...'
                  : updateStatus.update_available
                  ? `⬆️ Install ${updateStatus.latest_tag}`
                  : `🔄 Reinstall ${updateStatus.latest_tag || 'Latest'}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const smallStepBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 7,
  background: '#161622',
  border: '1px solid #2b2b3c',
  color: '#d4d4dc',
  fontSize: 13,
  fontWeight: 800,
  cursor: 'pointer',
  flexShrink: 0,
};

const nestedCardStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 10,
  background: '#11111a',
  border: '1px solid #222232',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const nestedHeaderRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

function pillToggleStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    minHeight: 28,
    padding: '0 9px',
    borderRadius: 7,
    background: active ? 'rgba(42, 163, 196, 0.16)' : '#171722',
    border: active ? `1px solid ${accent}` : '1px solid #2a2a3a',
    color: active ? accent : '#a1a1aa',
    fontSize: 10.5,
    fontWeight: 800,
    cursor: 'pointer',
  };
}

const compactInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 120,
  minHeight: 32,
  padding: '0 9px',
  borderRadius: 7,
  background: '#07070b',
  border: '1px solid #2a2a3a',
  color: '#d4d4dc',
  fontSize: 11,
  fontFamily: 'monospace',
};

const compactPrimaryBtnStyle: React.CSSProperties = {
  minHeight: 32,
  padding: '0 11px',
  borderRadius: 7,
  background: '#0f222a',
  border: '1px solid #2aa3c4',
  color: '#bfeaf5',
  fontSize: 11,
  fontWeight: 800,
  cursor: 'pointer',
};

const compactDangerBtnStyle: React.CSSProperties = {
  minHeight: 28,
  padding: '0 9px',
  borderRadius: 7,
  background: '#221115',
  border: '1px solid #5c222d',
  color: '#fca5a5',
  fontSize: 10.5,
  fontWeight: 700,
  cursor: 'pointer',
};
