import React from 'react';
import {
  AppleMusicAuthConfig,
  defaultSimpClient,
} from '@simp/client';
import { QrCodeSvg } from '../components/QrCodeSvg';

export interface SimpUpdateStatus {
  current_version?: string;
  latest_version?: string;
  latest_tag?: string;
  update_available?: boolean;
  target_arch?: string;
  checking?: boolean;
  applying?: boolean;
  error?: string;
}

export interface PowerModalProps {
  setPowerModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSourceModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSleeping: React.Dispatch<React.SetStateAction<boolean>>;
  dismissConsole: () => void;
  brightnessPct: number;
  setBrightnessPct: React.Dispatch<React.SetStateAction<number>>;
  updateStatus: SimpUpdateStatus;
  checkSimpUpdates: (silent?: boolean) => Promise<void>;
  applySimpUpdate: () => Promise<void>;
  appleAuthCfg: AppleMusicAuthConfig | null;
  confirmHardReset: boolean;
  setConfirmHardReset: React.Dispatch<React.SetStateAction<boolean>>;
  refreshLibraryData: () => void;
  showToast: (msg: string) => void;
}

export const PowerModal: React.FC<PowerModalProps> = ({
  setPowerModalOpen,
  setSourceModalOpen,
  setIsSleeping,
  dismissConsole,
  brightnessPct,
  setBrightnessPct,
  updateStatus,
  checkSimpUpdates,
  applySimpUpdate,
  appleAuthCfg,
  confirmHardReset,
  setConfirmHardReset,
  refreshLibraryData,
  showToast,
}) => {
  return (
    <div
      onClick={() => setPowerModalOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        boxSizing: 'border-box',
        zIndex: 55,
      }}
    >
      <div
        data-modal-root="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
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
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 15 }}>
            ⏻ Power, Sources & System Menu<span className="simp-gp-badge"> (START)</span>
          </strong>
          <button
            onClick={() => setPowerModalOpen(false)}
            style={{
              minHeight: 42,
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

        {/* 0. Storage Mounts, Sources & Apple Music Authentication Node */}
        <button
          data-default-focus="true"
          onClick={() => {
            setPowerModalOpen(false);
            setSourceModalOpen(true);
          }}
          style={{
            minHeight: 54,
            padding: '10px 14px',
            borderRadius: 12,
            background: '#0f222a',
            border: '1px solid #2aa3c4',
            color: '#bfeaf5',
            textAlign: 'left',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>
              ⚙ Storage Mounts, Sources & Apple Music Auth
            </span>
            <span style={{ fontSize: 11, color: '#8e8e99' }}>
              Manage local folders, optical disc drive, and Apple Music account pairing
            </span>
          </div>
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#67e8f9', fontWeight: 800 }}>
            Open →
          </span>
        </button>

        {/* 1. Sleep Screen, Minimize to Tray/Background & Pause/Dismiss Quick Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <button
            onClick={() => {
              setPowerModalOpen(false);
              setIsSleeping(true);
            }}
            style={{
              minHeight: 62,
              padding: '10px 12px',
              borderRadius: 12,
              background: '#0d1b22',
              border: '1px solid #2aa3c4',
              color: '#bfeaf5',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 800 }}>🌙 Sleep Screen</span>
            <span style={{ fontSize: 11, color: '#8e8e99' }}>
              True-black OLED screen • Wakes on any button
            </span>
          </button>

          <button
            onClick={() => {
              setPowerModalOpen(false);
              dismissConsole();
            }}
            style={{
              minHeight: 62,
              padding: '10px 12px',
              borderRadius: 12,
              background: '#0f1d18',
              border: '1px solid #10b981',
              color: '#d1fae5',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 800 }}>📥 Minimize to Tray</span>
            <span style={{ fontSize: 11, color: '#8e8e99' }}>
              Keep playing in KDE System Tray / Decky QAM
            </span>
          </button>

          <button
            onClick={() => {
              defaultSimpClient.pause();
              setPowerModalOpen(false);
              dismissConsole();
            }}
            style={{
              minHeight: 62,
              padding: '10px 12px',
              borderRadius: 12,
              background: '#12121b',
              border: '1px solid #2c2c3c',
              color: '#e4e4ec',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 800 }}>⏸️ Pause & Dismiss</span>
            <span style={{ fontSize: 11, color: '#8e8e99' }}>
              Silence audio and close SIMP Console
            </span>
          </button>
        </div>

        {/* 1b. Gamepad-Accessible OLED Screen Brightness Control (`Start` menu) */}
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 12,
            background: '#0d0d14',
            border: '1px solid #222230',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 800, color: '#bfeaf5' }}>
              🔅 OLED Active Luminance ({brightnessPct}%)
            </span>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#71717a' }}>
              Idle Dim: {Math.round(brightnessPct * 0.5)}%
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 6,
            }}
          >
            <button
              onClick={() => setBrightnessPct((b) => Math.max(25, b - 10))}
              style={{
                minHeight: 36,
                borderRadius: 8,
                background: '#161622',
                border: '1px solid #2b2b3c',
                color: '#d4d4dc',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              −10%
            </button>
            {[25, 50, 75, 86, 100].map((preset) => {
              const active = brightnessPct === preset;
              return (
                <button
                  key={preset}
                  onClick={() => setBrightnessPct(preset)}
                  style={{
                    minHeight: 36,
                    borderRadius: 8,
                    background: active ? '#0f222a' : '#101018',
                    border: active ? '1px solid #2aa3c4' : '1px solid #222230',
                    color: active ? '#67e8f9' : '#9ca3af',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {preset}%
                </button>
              );
            })}
            <button
              onClick={() => setBrightnessPct((b) => Math.min(100, b + 10))}
              style={{
                minHeight: 36,
                borderRadius: 8,
                background: '#161622',
                border: '1px solid #2b2b3c',
                color: '#d4d4dc',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              +10%
            </button>
          </div>
        </div>

        {/* 1c. 1-Click GitHub Release Self-Updater */}
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 12,
            background: '#0d131a',
            border: updateStatus.update_available
              ? '1px solid #2aa3c4'
              : '1px solid #222230',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#bfeaf5' }}>
              ⬆️ SIMP Software Update{' '}
              {updateStatus.current_version
                ? `(Installed: v${updateStatus.current_version}${
                    updateStatus.target_arch ? ` • ${updateStatus.target_arch}` : ''
                  })`
                : ''}
            </span>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              {updateStatus.applying
                ? 'Downloading & installing release bundle (Daemon + UI + Decky QAM)...'
                : updateStatus.checking
                ? 'Checking GitHub Releases...'
                : updateStatus.error
                ? `⚠️ ${updateStatus.error}`
                : updateStatus.update_available
                ? `🟢 New release ${updateStatus.latest_tag} is ready to install!`
                : updateStatus.latest_tag
                ? `Up to date with GitHub (${updateStatus.latest_tag}) — click Reinstall to force-sync`
                : 'Check GitHub Releases to update Daemon, UI & Decky QAM in 1 click'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              disabled={Boolean(updateStatus.checking || updateStatus.applying)}
              onClick={() => checkSimpUpdates(false)}
              style={{
                minHeight: 38,
                padding: '0 12px',
                borderRadius: 8,
                background: '#141824',
                border: '1px solid #2e364f',
                color: '#d4d4dc',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {updateStatus.checking ? 'Checking...' : '🔍 Check'}
            </button>
            <button
              disabled={Boolean(updateStatus.applying)}
              onClick={applySimpUpdate}
              style={{
                minHeight: 38,
                padding: '0 14px',
                borderRadius: 8,
                background: updateStatus.update_available ? '#0f2936' : '#181824',
                border: updateStatus.update_available
                  ? '1px solid #2aa3c4'
                  : '1px solid #323246',
                color: updateStatus.update_available ? '#67e8f9' : '#e4e4ec',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {updateStatus.applying
                ? '⏳ Updating...'
                : updateStatus.update_available
                ? `⬆️ Update to ${updateStatus.latest_tag}`
                : `🔄 Reinstall ${updateStatus.latest_tag || 'Latest'}`}
            </button>
          </div>
        </div>

        {/* 2. Reset Services & Shutdown Background Daemon */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button
            onClick={() => {
              defaultSimpClient.pause();
              defaultSimpClient.restartDaemon();
              showToast('Restarting SIMP background services...');
              setPowerModalOpen(false);
              window.setTimeout(() => dismissConsole(), 300);
            }}
            style={{
              minHeight: 62,
              padding: '10px 14px',
              borderRadius: 12,
              background: '#161420',
              border: '1px solid #3b3354',
              color: '#ddd6fe',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 800 }}>🔄 Reset Services & Dismiss</span>
            <span style={{ fontSize: 11, color: '#a1a1aa' }}>
              Pause, restart BG daemon & Widevine worker, and close screen
            </span>
          </button>

          <button
            onClick={() => {
              defaultSimpClient.shutdownDaemon();
              setPowerModalOpen(false);
              window.setTimeout(() => dismissConsole(), 250);
            }}
            style={{
              minHeight: 62,
              padding: '10px 14px',
              borderRadius: 12,
              background: '#241115',
              border: '1px solid #7f1d1d',
              color: '#fca5a5',
              textAlign: 'left',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 800 }}>⏻ Shutdown SIMP</span>
            <span style={{ fontSize: 11, color: '#fca5a5', opacity: 0.8 }}>
              Kill background daemon & workers and dismiss console
            </span>
          </button>
        </div>

        {/* 3. Pairing & Troubleshooting Assistance (/pair) */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            background: '#0d0d14',
            border: '1px solid #262636',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <QrCodeSvg
            value={appleAuthCfg?.pair_url || 'http://steamdeck.local:18888/pair'}
            size={84}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#67e8f9' }}>
              📱 Pairing & Troubleshooting Assistance (/pair)
            </div>
            <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.4 }}>
              Scan with your phone or visit on a PC to pair Apple Music or access the{' '}
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

        {/* 4. Database Cache Reset & Hard Reset All Settings */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            background: '#0f0f15',
            border: '1px solid #22222e',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af' }}>
            🛠️ Storage Cache & Factory Reset
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                defaultSimpClient.resetDatabaseCache();
                showToast('Cleared offline DB cache & rescanning folders...');
                setPowerModalOpen(false);
                window.setTimeout(() => refreshLibraryData(), 600);
              }}
              style={{
                flex: 1,
                minHeight: 46,
                padding: '8px 12px',
                borderRadius: 10,
                background: '#161622',
                border: '1px solid #2e2e3e',
                color: '#d4d4dc',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              🧹 Reset Offline DB Cache (Keep Auth)
            </button>

            {!confirmHardReset ? (
              <button
                onClick={() => setConfirmHardReset(true)}
                style={{
                  flex: 1,
                  minHeight: 46,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: '#221115',
                  border: '1px solid #5c222d',
                  color: '#f87171',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ⚠️ Hard Reset All Settings...
              </button>
            ) : (
              <div
                style={{
                  width: '100%',
                  padding: 12,
                  borderRadius: 10,
                  background: '#2a0e13',
                  border: '1px solid #ef4444',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 800, color: '#fecaca' }}>
                  ⚠️ Confirm Hard Reset?
                </div>
                <div style={{ fontSize: 11, color: '#fca5a5', lineHeight: 1.4 }}>
                  This will sign out of Apple Music, clear all playlists, pinned albums, cached tracks, and reset all SIMP settings to factory defaults.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => {
                      defaultSimpClient.factoryReset();
                      setConfirmHardReset(false);
                      setPowerModalOpen(false);
                      showToast('Factory reset complete — all settings & auth cleared');
                      window.setTimeout(() => refreshLibraryData(), 600);
                    }}
                    style={{
                      flex: 1,
                      minHeight: 40,
                      borderRadius: 8,
                      background: '#dc2626',
                      border: '1px solid #f87171',
                      color: '#ffffff',
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Yes, Wipe & Hard Reset
                  </button>
                  <button
                    onClick={() => setConfirmHardReset(false)}
                    style={{
                      minHeight: 40,
                      padding: '0 14px',
                      borderRadius: 8,
                      background: '#181822',
                      border: '1px solid #2e2e3c',
                      color: '#d4d4dc',
                      fontSize: 12,
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
        </div>
      </div>
    </div>
  );
};

