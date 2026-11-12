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
import { SoundCloudLogo } from '../components/SoundCloudLogo';
import { OskTargetKind } from '../hooks/useGamepadNavigation';
import { BrowserTarget } from './PlayerView';
import { ImpIcon } from '../components/icons/ImpIcon';
import { FolderChooserModal } from '../components/FolderChooserModal';
import {
  applySkinPackToDocument,
  loadActiveSkinPackId,
  SKIN_PACK_REGISTRY,
  SkinPackId,
} from '../theme/skinPacks';

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
    React.SetStateAction<'pinned' | 'for_you' | 'cloud_playlists' | 'new' | 'radio'>
  >;
  setSoundCloudSubTab: React.Dispatch<
    React.SetStateAction<'pinned' | 'likes_sets' | 'stream_radio' | 'trending'>
  >;
  sourceVisibility: SourceVisibilityPrefs;
  setSourceVisibility: React.Dispatch<React.SetStateAction<SourceVisibilityPrefs>>;
  refreshLibraryData: () => void;
  applyFocusMarker?: (el: HTMLElement | null) => void;
  showToast: (msg: string) => void;
  onOpenQuickHelp?: () => void;
  initialOpenFoldersAccounts?: boolean;
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
  setSoundCloudSubTab,
  sourceVisibility,
  setSourceVisibility,
  refreshLibraryData,
  applyFocusMarker,
  showToast,
  onOpenQuickHelp,
  initialOpenFoldersAccounts,
}) => {
  // Slide-out Folders & Accounts secondary column state
  const [foldersAccountsOpen, setFoldersAccountsOpen] = useState(Boolean(initialOpenFoldersAccounts));
  const [iaAuthOpen, setIaAuthOpen] = useState(false);
  const [appleAuthOpen, setAppleAuthOpen] = useState(false);
  const [scAuthOpen, setScAuthOpen] = useState(false);
  const [addPathOpen, setAddPathOpen] = useState(false);
  const [folderChooserOpen, setFolderChooserOpen] = useState(false);
  const [confirmPurgeSource, setConfirmPurgeSource] = useState<string | null>(null);

  const handlePurgeSource = async (source: 'local' | 'apple' | 'soundcloud' | 'ia', label: string) => {
    if (confirmPurgeSource !== source) {
      setConfirmPurgeSource(source);
      showToast(`Click [Confirm Purge ${label} DB] again to wipe ${label} records`);
      return;
    }
    setConfirmPurgeSource(null);
    try {
      const resp = await fetch('http://127.0.0.1:18888/api/library/purge-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      const json = await resp.json();
      if (json?.ok) {
        showToast(`Purged ${label} database records (${json.removed || 0} items)`);
        refreshLibraryData();
      } else {
        showToast(`Failed to purge ${label} DB`);
      }
    } catch {
      showToast(`Failed to purge ${label} DB`);
    }
  };

  const [iaUsername, setIaUsername] = useState('');
  const [iaAccessKey, setIaAccessKey] = useState('');
  const [iaSecretKey, setIaSecretKey] = useState('');
  const [iaEnabledLocal, setIaEnabledLocal] = useState(
    snap?.internet_archive_authenticated ?? true
  );
  const [iaSafeSearch, setIaSafeSearch] = useState(true);
  const [perfSnap, setPerfSnap] = useState<DaemonPerfSnapshot | null>(null);
  const [activeSkinPack, setActiveSkinPack] = useState<SkinPackId>(() => loadActiveSkinPackId());

  const closeSettingsDrawer = () => {
    setSourceModalOpen(false);
    setPowerModalOpen(false);
    setConfirmHardReset(false);
  };

  useEffect(() => {
    setIaEnabledLocal(snap?.internet_archive_authenticated ?? true);
    defaultSimpClient
      .getInternetArchiveConfig()
      .then((cfg) => {
        if (cfg) {
          setIaEnabledLocal(cfg.enabled ?? true);
          setIaUsername(cfg.username || '');
          setIaSafeSearch(cfg.safe_search ?? true);
        }
      })
      .catch(() => {});
  }, [snap?.internet_archive_authenticated]);

  useEffect(() => {
    if (!updateStatus.latest_version && !updateStatus.checking) {
      checkSimpUpdates(true);
    }
  }, []);

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

  const [brightnessScrubActive, setBrightnessScrubActive] = useState(false);
  const triggerHoverRef = React.useRef(false);
  const subPanelHoverRef = React.useRef(false);
  const dismissTimerRef = React.useRef<number | null>(null);

  const clearFoldersDismissTimer = () => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };

  const scheduleFoldersAutoDismiss = () => {
    clearFoldersDismissTimer();
    dismissTimerRef.current = window.setTimeout(() => {
      if (
        triggerHoverRef.current ||
        subPanelHoverRef.current ||
        folderChooserOpen ||
        document.querySelector('[data-folder-chooser-modal="true"]')
      ) {
        return;
      }
      const subEl = document.querySelector<HTMLElement>('[data-settings-col="sub"]');
      const trigEl = document.querySelector<HTMLElement>('[data-settings-folders-trigger="true"]');
      const gpFocused =
        document.querySelector<HTMLElement>('[data-simp-active-focus="true"]') ||
        document.querySelector<HTMLElement>('[data-gp-focused="true"]');
      const activeEl = document.activeElement as HTMLElement | null;
      const gpInside =
        (gpFocused && ((subEl && subEl.contains(gpFocused)) || (trigEl && trigEl.contains(gpFocused)))) ||
        (activeEl &&
          activeEl.tagName === 'INPUT' &&
          subEl &&
          subEl.contains(activeEl));
      if (!gpInside) {
        setFoldersAccountsOpen(false);
      }
    }, 480);
  };

  useEffect(() => {
    const onBrightnessStep = (ev: Event) => {
      const detail = (ev as CustomEvent<{ delta?: number }>).detail;
      const delta = typeof detail?.delta === 'number' ? detail.delta : 0;
      if (delta !== 0) {
        setBrightnessPct((b) => Math.max(25, Math.min(100, b + delta)));
      }
    };
    const onBrightnessExit = () => {
      setBrightnessScrubActive(false);
    };
    const onFoldersFocus = (ev: Event) => {
      const open = Boolean((ev as CustomEvent<{ open?: boolean }>).detail?.open);
      if (open) {
        clearFoldersDismissTimer();
        setFoldersAccountsOpen(true);
      } else {
        scheduleFoldersAutoDismiss();
      }
    };
    window.addEventListener('simp-brightness-step', onBrightnessStep);
    window.addEventListener('simp-brightness-exit', onBrightnessExit);
    window.addEventListener('simp-settings-folders-focus', onFoldersFocus);
    return () => {
      clearFoldersDismissTimer();
      window.removeEventListener('simp-brightness-step', onBrightnessStep);
      window.removeEventListener('simp-brightness-exit', onBrightnessExit);
      window.removeEventListener('simp-settings-folders-focus', onFoldersFocus);
    };
  }, [setBrightnessPct]);

  const toggleSourceVisible = (key: keyof SourceVisibilityPrefs) => {
    setSourceVisibility((prev) => {
      const nextVal = !prev[key];
      const next = { ...prev, [key]: nextVal };
      try {
        window.localStorage.setItem('simp_source_visibility_v2', JSON.stringify(next));
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

  // Determine if a sub-level inside Folders & Accounts or Brightness scrub is open so `B` / `ESC` walks back cleanly
  const hasNestedChildOpen =
    brightnessScrubActive ||
    confirmHardReset ||
    addPathOpen ||
    iaAuthOpen ||
    appleAuthOpen ||
    scAuthOpen;

  const handleWalkBackNested = () => {
    if (brightnessScrubActive) {
      setBrightnessScrubActive(false);
    } else if (confirmHardReset) {
      setConfirmHardReset(false);
    } else if (addPathOpen) {
      setAddPathOpen(false);
    } else if (iaAuthOpen) {
      setIaAuthOpen(false);
    } else if (appleAuthOpen) {
      setAppleAuthOpen(false);
    } else if (scAuthOpen) {
      setScAuthOpen(false);
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
            onMouseEnter={() => {
              subPanelHoverRef.current = true;
              clearFoldersDismissTimer();
            }}
            onMouseLeave={() => {
              subPanelHoverRef.current = false;
              scheduleFoldersAutoDismiss();
            }}
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
              <strong style={{ fontSize: 13.5, color: '#bfeaf5', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ImpIcon name="folder" size={14} /> Folders & Accounts
              </strong>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#67e8f9' }}>
                <span className="simp-gp-badge">D-Pad ▸ / B</span>
              </span>
            </div>

            {/* + Internet Archive [Show/Hide, Safe Search, Sign In] */}
            <div style={nestedCardStyle}>
              <div style={nestedHeaderRowStyle}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#6ee7b7', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <ImpIcon name="archive" size={13} /> Internet Archive
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    data-sub-default="true"
                    onClick={() => toggleSourceVisible('internet_archive')}
                    style={pillToggleStyle(sourceVisibility.internet_archive, '#34d399')}
                  >
                    <ImpIcon
                      name={sourceVisibility.internet_archive ? 'eye' : 'eye-off'}
                      size={11}
                      style={{ marginRight: 4 }}
                    />
                    {sourceVisibility.internet_archive ? 'Shown' : 'Hidden'}
                  </button>
                  <button
                    type="button"
                    title="Safer Search (at least we tried)"
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
                          ? 'Archive Safer Search enabled (at least we tried)'
                          : 'Archive Safer Search disabled'
                      );
                      refreshLibraryData();
                    }}
                    style={pillToggleStyle(iaSafeSearch, '#38bdf8')}
                  >
                    <ImpIcon name="shield" size={11} style={{ marginRight: 4 }} />
                    Safer Search: {iaSafeSearch ? 'On' : 'Off'}
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
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => handlePurgeSource('ia', 'Internet Archive')}
                      style={compactDangerBtnStyle}
                    >
                      <ImpIcon name="database" size={11} style={{ marginRight: 4 }} />
                      {confirmPurgeSource === 'ia' ? 'Confirm Purge IA DB' : 'Purge IA DB'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* + Apple Music [Show/Hide, Sign In] */}
            <div style={nestedCardStyle}>
              <div style={nestedHeaderRowStyle}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#fda4af', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <ImpIcon name="apple" size={15} color="#ffffff" /> Apple Music
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => toggleSourceVisible('apple_music')}
                    style={pillToggleStyle(sourceVisibility.apple_music, '#f43f5e')}
                  >
                    <ImpIcon
                      name={sourceVisibility.apple_music ? 'eye' : 'eye-off'}
                      size={11}
                      style={{ marginRight: 4 }}
                    />
                    {sourceVisibility.apple_music ? 'Shown' : 'Hidden'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppleAuthOpen((v) => !v)}
                    style={pillToggleStyle(!!snap?.apple_authenticated || appleAuthOpen, '#fda4af')}
                  >
                    {snap?.apple_authenticated ? 'Connected' : 'Sign In'} {appleAuthOpen ? '▾' : '▸'}
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
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
                        <ImpIcon name="sign-out" size={11} style={{ marginRight: 4 }} />
                        Sign Out (Keep DB)
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handlePurgeSource('apple', 'Apple Music')}
                      style={compactDangerBtnStyle}
                    >
                      <ImpIcon name="database" size={11} style={{ marginRight: 4 }} />
                      {confirmPurgeSource === 'apple' ? 'Confirm Purge Apple DB' : 'Purge Apple DB'}
                    </button>
                  </div>

                  {!snap?.apple_authenticated && appleAuthCfg?.pair_url && (
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
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: '#fdba74',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <SoundCloudLogo width={30} color="#ffffff" />
                  <span>SoundCloud</span>
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => toggleSourceVisible('soundcloud')}
                    style={pillToggleStyle(sourceVisibility.soundcloud, '#ea580c')}
                  >
                    <ImpIcon
                      name={sourceVisibility.soundcloud ? 'eye' : 'eye-off'}
                      size={11}
                      style={{ marginRight: 4 }}
                    />
                    {sourceVisibility.soundcloud ? 'Shown' : 'Hidden'}
                  </button>
                  {(() => {
                    const isPersonalUser = Boolean(
                      soundcloudAuthCfg?.auth_mode === 'user' &&
                        soundcloudAuthCfg?.username &&
                        soundcloudAuthCfg.username !== 'Public Discovery (Client Credentials)'
                    );
                    return (
                      <button
                        type="button"
                        onClick={() => setScAuthOpen((v) => !v)}
                        style={pillToggleStyle(
                          Boolean(isPersonalUser || scAuthOpen),
                          '#fdba74'
                        )}
                      >
                        {isPersonalUser
                          ? `@${soundcloudAuthCfg?.username}`
                          : 'Public · Sign In'}{' '}
                        {scAuthOpen ? '▾' : '▸'}
                      </button>
                    );
                  })()}
                </div>
              </div>

              {scAuthOpen && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'flex-end',
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
                  {soundcloudAuthCfg?.auth_mode === 'user' &&
                    Boolean(
                      soundcloudAuthCfg?.username &&
                        soundcloudAuthCfg.username !== 'Public Discovery (Client Credentials)'
                    ) && (
                      <button
                        type="button"
                        onClick={async () => {
                          await disconnectSoundCloudCleanSlate(showToast);
                          setSoundCloudSubTab('trending');
                          const updated = await defaultSimpClient
                            .getSoundCloudAuthConfig()
                            .catch(() => null);
                          if (updated) setSoundcloudAuthCfg(updated);
                          refreshLibraryData();
                        }}
                        style={compactDangerBtnStyle}
                      >
                        <ImpIcon name="sign-out" size={11} style={{ marginRight: 4 }} />
                        Sign Out (Keep DB)
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={() => handlePurgeSource('soundcloud', 'SoundCloud')}
                    style={compactDangerBtnStyle}
                  >
                    <ImpIcon name="database" size={11} style={{ marginRight: 4 }} />
                    {confirmPurgeSource === 'soundcloud' ? 'Confirm Purge SC DB' : 'Purge SC DB'}
                  </button>
                </div>
              )}
            </div>

            {/* + Optical Drive [Show/Hide] */}
            <div style={nestedCardStyle}>
              <div style={nestedHeaderRowStyle}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#fcd34d', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <ImpIcon name="disc" size={13} /> Optical Drive
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => toggleSourceVisible('optical_drive')}
                    style={pillToggleStyle(sourceVisibility.optical_drive, '#f59e0b')}
                  >
                    <ImpIcon
                      name={sourceVisibility.optical_drive ? 'eye' : 'eye-off'}
                      size={11}
                      style={{ marginRight: 4 }}
                    />
                    {sourceVisibility.optical_drive ? 'Shown' : 'Hidden'}
                  </button>
                  {sourceVisibility.optical_drive && (
                    <>
                      <button
                        type="button"
                        disabled={cdScanning}
                        onClick={() => handleScanOpticalDisc(true, false)}
                        style={pillToggleStyle(false, '#fcd34d')}
                      >
                        <ImpIcon name="refresh" size={11} style={{ marginRight: 4 }} />
                        {cdScanning ? 'Scanning...' : 'Scan'}
                      </button>
                      {opticalDisc?.drive_present && (
                        <button
                          type="button"
                          onClick={handleEjectOpticalDisc}
                          style={pillToggleStyle(false, '#fca5a5')}
                        >
                          <ImpIcon name="eject" size={11} style={{ marginRight: 4 }} />
                          Eject
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
                <span style={{ fontSize: 12, fontWeight: 800, color: '#67e8f9', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <ImpIcon name="folder" size={13} /> Local Folders ({snap?.mounts?.length || 0})
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    data-folder-browse-trigger="true"
                    onClick={() => setFolderChooserOpen(true)}
                    style={pillToggleStyle(folderChooserOpen, '#34d399')}
                  >
                    <ImpIcon name="folder-plus" size={11} style={{ marginRight: 4 }} />
                    Browse...
                  </button>
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
                    <ImpIcon name="refresh" size={11} style={{ marginRight: 4 }} />
                    Rescan
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePurgeSource('local', 'Local Media')}
                    style={compactDangerBtnStyle}
                  >
                    <ImpIcon name="database" size={11} style={{ marginRight: 4 }} />
                    {confirmPurgeSource === 'local' ? 'Confirm Purge Local DB' : 'Purge Local DB'}
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
                      onClick={(e) => {
                        if (
                          e.detail === 0 ||
                          document.documentElement.dataset.simpInput === 'gamepad'
                        ) {
                          setOskTarget('folder');
                          if (window.parent && window.parent !== window) {
                            window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                          }
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
                <ImpIcon name="trash" size={11} style={{ marginRight: 4 }} />
                Reset DB (Preserves Auth)
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
                <ImpIcon name="alert" size={11} style={{ marginRight: 4 }} />
                Hard Reset
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
                <div style={{ fontSize: 11.5, fontWeight: 800, color: '#fecaca', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <ImpIcon name="alert" size={12} /> Confirm Hard Reset (Wipes Auth, Playlists & Settings)?
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      defaultSimpClient.factoryReset();
                      try {
                        window.localStorage.removeItem('simp_source_visibility_v2');
                        window.localStorage.removeItem('simp_brightness_pct_v2');
                        window.localStorage.removeItem('simp_idle_opacity_pct');
                        window.localStorage.removeItem('simp_factoids_enabled');
                        window.localStorage.removeItem('simp_oobe_help_seen_v1');
                        window.localStorage.setItem('simp.visualizer_mode', 'cycle');
                      } catch {}
                      setBrightnessPct(100);
                      setSourceVisibility({
                        internet_archive: true,
                        apple_music: true,
                        soundcloud: true,
                        optical_drive: false,
                      });
                      setIaEnabledLocal(true);
                      setIaSafeSearch(true);
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
              gap: 8,
            }}
          >
            <strong style={{ fontSize: 14, color: '#bfeaf5', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ImpIcon name="settings" size={14} /> IMP Settings<span className="simp-gp-badge"> (START)</span>
            </strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {onOpenQuickHelp && (
                <button
                  type="button"
                  onClick={() => {
                    closeSettingsDrawer();
                    onOpenQuickHelp();
                  }}
                  title="Quick Start & Controls Guide"
                  style={{
                    minHeight: 34,
                    padding: '0 10px',
                    borderRadius: 8,
                    background: '#101d24',
                    border: '1px solid #2aa3c4',
                    color: '#67e8f9',
                    fontSize: 11.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <ImpIcon name="help" size={12} /> Help
                </button>
              )}
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
          </div>

          {/* Row 1: [Sleep Screen] [Power_BTN_icon] */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px', gap: 8 }}>
            <button
              type="button"
              data-default-focus="true"
              onClick={() => {
                closeSettingsDrawer();
                setIsSleeping(true);
              }}
              style={{
                minHeight: 46,
                padding: '8px 14px',
                borderRadius: 12,
                background: '#0d1b22',
                border: '1px solid #2aa3c4',
                color: '#bfeaf5',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ImpIcon name="moon" size={13} /> Sleep Screen
              </span>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#67e8f9' }}>OLED 0%</span>
            </button>

            <button
              type="button"
              title="Shutdown IMP (Hold Shift to Restart Service)"
              aria-label="Shutdown IMP"
              onClick={(e) => {
                if (e.shiftKey) {
                  defaultSimpClient.pause();
                  defaultSimpClient.restartDaemon();
                  showToast('Restarting IMP background service...');
                  closeSettingsDrawer();
                  if (window.parent && window.parent !== window) {
                    window.setTimeout(() => dismissConsole(), 300);
                  } else {
                    window.setTimeout(() => window.location.reload(), 900);
                  }
                  return;
                }
                defaultSimpClient.shutdownDaemon();
                closeSettingsDrawer();
                window.setTimeout(() => dismissConsole(), 250);
              }}
              style={{
                minHeight: 46,
                width: 56,
                borderRadius: 12,
                background: '#221014',
                border: '1px solid #7f1d1d',
                color: '#fca5a5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 19,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              <ImpIcon name="power" size={16} />
            </button>
          </div>

          {/* Row 2: [Brightness] */}
          <button
            type="button"
            data-brightness-slider="true"
            data-brightness-scrub-active={brightnessScrubActive ? 'true' : undefined}
            onClick={() => setBrightnessScrubActive((v) => !v)}
            onBlur={() => setBrightnessScrubActive(false)}
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: 12,
              background: brightnessScrubActive ? '#0f222a' : '#0e0e16',
              border: brightnessScrubActive ? '2px solid #2aa3c4' : '1px solid #222230',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 6,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 800, color: '#bfeaf5', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ImpIcon name="sun" size={13} /> Brightness
              </span>
              <span style={{ fontSize: 11.5, fontFamily: 'monospace', color: '#67e8f9' }}>
                {brightnessScrubActive ? `◄ ${brightnessPct}% ►` : `${brightnessPct}%`}
              </span>
            </div>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
              onClick={(e) => e.stopPropagation()}
            >
              <span
                role="button"
                onClick={() => setBrightnessPct((b) => Math.max(25, b - 5))}
                style={{
                  ...smallStepBtnStyle,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  userSelect: 'none',
                }}
              >
                −
              </span>
              <input
                type="range"
                tabIndex={-1}
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
              <span
                role="button"
                onClick={() => setBrightnessPct((b) => Math.min(100, b + 5))}
                style={{
                  ...smallStepBtnStyle,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  userSelect: 'none',
                }}
              >
                +
              </span>
            </div>
          </button>

          {/* Row 3: [Folders & Accounts <] */}
          <button
            type="button"
            data-settings-folders-trigger="true"
            onMouseEnter={() => {
              triggerHoverRef.current = true;
              clearFoldersDismissTimer();
              setFoldersAccountsOpen(true);
            }}
            onMouseLeave={() => {
              triggerHoverRef.current = false;
              scheduleFoldersAutoDismiss();
            }}
            onFocus={() => {
              clearFoldersDismissTimer();
              setFoldersAccountsOpen(true);
            }}
            onClick={() => openFoldersAccountsPanel()}
            style={{
              width: '100%',
              minHeight: 44,
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
            <span style={{ fontSize: 13, fontWeight: 800, color: '#bfeaf5', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ImpIcon name="folder" size={14} /> Folders & Accounts
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#67e8f9', fontWeight: 900 }}>
              ◄
            </span>
          </button>

          {/* Row 3b: [Skin Pack Switcher] */}
          <div
            style={{
              padding: '9px 12px',
              borderRadius: 14,
              background: '#0d0d14',
              border: '1px solid #222230',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#bfeaf5', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ImpIcon name="palette" size={13} /> Skin Pack
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 10.5, color: '#67e8f9' }}>
                {SKIN_PACK_REGISTRY.find((s) => s.id === activeSkinPack)?.name || 'IMP Portal Dark'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {SKIN_PACK_REGISTRY.map((pack) => {
                const isActive = activeSkinPack === pack.id;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    title={pack.tagline}
                    onClick={() => {
                      setActiveSkinPack(pack.id);
                      applySkinPackToDocument(pack.id);
                      showToast(`Skin Pack: ${pack.name}`);
                    }}
                    style={{
                      minHeight: 34,
                      padding: '4px 6px',
                      borderRadius: 8,
                      background: isActive ? pack.tokens.surfaceElevated : '#13131d',
                      border: isActive
                        ? `1.5px solid ${pack.tokens.brandPrimary}`
                        : '1px solid #252534',
                      color: isActive ? pack.tokens.textPrimary : '#a1a1aa',
                      fontSize: 10.5,
                      fontWeight: isActive ? 800 : 700,
                      cursor: 'pointer',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {pack.name.replace(/^IMP\s+/i, '')}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 4: [System Load] */}
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
              <span style={{ fontSize: 12, fontWeight: 800, color: '#d4d4dc', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ImpIcon name="cpu" size={13} /> System Load
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
              • RAM:{' '}
              <strong style={{ color: '#67e8f9' }}>
                {perfSnap?.rss_mb.toFixed(1) ?? '0.0'} MB
                {typeof (perfSnap as any)?.ram_percent === 'number'
                  ? ` (${((perfSnap as any).ram_percent as number).toFixed(1)}%)`
                  : ''}
              </strong>
            </div>
          </div>

          {/* Row 5: [Update Channel: $channelName][Update] */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 8 }}>
              <button
                type="button"
                disabled={Boolean(updateStatus.checking || updateStatus.applying)}
                onClick={async () => {
                  const nextChannel =
                    (updateStatus.channel || 'stable').toLowerCase() === 'stable'
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
                        ? 'Channel: Stable'
                        : 'Channel: Alpha'
                    );
                    checkSimpUpdates(false);
                  } catch {
                    showToast('Failed to switch update channel');
                  }
                }}
                style={{
                  minHeight: 42,
                  padding: '0 12px',
                  borderRadius: 12,
                  background: '#0d0d14',
                  border:
                    (updateStatus.channel || 'stable').toLowerCase() === 'stable'
                      ? '1px solid #6ee7b7'
                      : '1px solid #222230',
                  color: '#d4d4dc',
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                }}
              >
                <span>Update Channel:</span>
                <span
                  style={{
                    color:
                      (updateStatus.channel || 'stable').toLowerCase() === 'stable'
                        ? '#6ee7b7'
                        : '#67e8f9',
                    fontFamily: 'monospace',
                  }}
                >
                  {(updateStatus.channel || 'stable').toLowerCase() === 'stable'
                    ? 'Stable'
                    : 'Alpha'}
                </span>
              </button>

              <button
                type="button"
                disabled={Boolean(updateStatus.checking || updateStatus.applying)}
                onClick={() => {
                  if (updateStatus.update_available) {
                    applySimpUpdate();
                  } else {
                    checkSimpUpdates(false);
                  }
                }}
                style={{
                  minHeight: 42,
                  padding: '0 12px',
                  borderRadius: 12,
                  background: updateStatus.update_available ? '#0f2936' : '#0f222a',
                  border: updateStatus.update_available
                    ? '1px solid #6ee7b7'
                    : '1px solid #2aa3c4',
                  color: updateStatus.update_available ? '#6ee7b7' : '#bfeaf5',
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                {updateStatus.applying
                  ? '⏳ Updating...'
                  : updateStatus.checking
                    ? 'Checking...'
                    : updateStatus.update_available
                      ? `⬆️ Update (${updateStatus.latest_tag})`
                      : `Update${updateStatus.current_version ? ` (v${updateStatus.current_version})` : ''}`}
              </button>
            </div>
            {updateStatus.error && (
              <div style={{ fontSize: 10.5, color: '#fca5a5', paddingLeft: 4 }}>
                {updateStatus.error}
              </div>
            )}
          </div>
        </div>
      </div>

      <FolderChooserModal
        open={folderChooserOpen}
        initialPath={customFolderPath}
        applyFocusMarker={applyFocusMarker}
        onSelectFolder={(folderPath) => {
          setCustomFolderPath(folderPath);
          handleAddFolder(folderPath);
        }}
        onClose={() => {
          setFolderChooserOpen(false);
          window.setTimeout(() => {
            const browseTrigger =
              document.querySelector<HTMLElement>(
                '[data-folder-browse-trigger="true"]:not([disabled])'
              ) ||
              document.querySelector<HTMLElement>(
                '[data-settings-col="sub"] button:not([disabled])'
              );
            if (browseTrigger && applyFocusMarker) {
              applyFocusMarker(browseTrigger);
            }
          }, 30);
        }}
      />
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
