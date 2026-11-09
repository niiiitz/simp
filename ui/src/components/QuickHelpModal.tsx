import React from 'react';
import { SourceVisibilityPrefs } from '../views/SettingsModal';

export interface QuickHelpModalProps {
  onClose: () => void;
  onOpenFoldersAccounts: () => void;
  sourceVisibility: SourceVisibilityPrefs;
  onToggleSourceVisibility: (key: keyof SourceVisibilityPrefs) => void;
}

export const QuickHelpModal: React.FC<QuickHelpModalProps> = ({
  onClose,
  onOpenFoldersAccounts,
  sourceVisibility,
  onToggleSourceVisibility,
}) => {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.84)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        boxSizing: 'border-box',
        zIndex: 92,
      }}
    >
      <div
        data-modal-root="true"
        data-quick-help-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 620,
          maxHeight: '88vh',
          overflowY: 'auto',
          background: '#09090f',
          border: '2px solid #2aa3c4',
          borderRadius: 18,
          padding: 20,
          boxSizing: 'border-box',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.94)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          color: '#e4e4ec',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            paddingBottom: 10,
            borderBottom: '1px solid #1e1e2c',
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#bfeaf5' }}>
              ⚡ Welcome to SIMP • Quick Guide & Tips
            </div>
            <div style={{ fontSize: 11.5, color: '#8e8e99', marginTop: 2 }}>
              Console-first hybrid media player • Re-open anytime via{' '}
              <span style={{ fontFamily: 'monospace', color: '#67e8f9' }}>START (☰) → ❓ Help</span>
            </div>
          </div>
          <button
            type="button"
            data-quick-help-close="true"
            onClick={onClose}
            style={{
              minHeight: 36,
              padding: '0 12px',
              borderRadius: 9,
              background: '#16161f',
              border: '1px solid #2e2e3a',
              color: '#d4d4dc',
              fontFamily: 'monospace',
              fontSize: 12,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ✕<span className="simp-gp-badge"> B</span>
          </button>
        </div>

        {/* Tip Cards Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: 10,
          }}
        >
          {/* Tip 1: START -> Folders & Accounts */}
          <div style={tipCardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#67e8f9' }}>
              1. ☰ START → 📁 Folders & Accounts
            </div>
            <div style={tipBodyStyle}>
              Press <strong>START</strong> (or click <strong>☰</strong> top-right) and open{' '}
              <strong>Folders & Accounts</strong> to mount local music/video paths, sign in to{' '}
              <strong>Apple Music</strong> (with QR companion pairing) or{' '}
              <strong>SoundCloud</strong>, and show or hide sources.
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenFoldersAccounts();
              }}
              style={{
                marginTop: 4,
                minHeight: 34,
                padding: '0 12px',
                borderRadius: 8,
                background: '#0f222a',
                border: '1px solid #2aa3c4',
                color: '#bfeaf5',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
                alignSelf: 'flex-start',
              }}
            >
              📁 Open Folders & Accounts ▸
            </button>
          </div>

          {/* Tip 2: SELECT -> Contextual Action Menu */}
          <div style={tipCardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fdba74' }}>
              2. 🎛️ SELECT (•••) → Context Actions
            </div>
            <div style={tipBodyStyle}>
              Press <strong>SELECT</strong> on your controller (or click <strong>•••</strong> /
              right-click) on any track, album, or playlist in the Library or Player to:
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.5 }}>
                <li>
                  <strong>⏭ Play Next</strong> (inserts right after the playing song)
                </li>
                <li>
                  <strong>★ Add to SIMP Hybrid Playlist</strong> (mix Local + Cloud)
                </li>
                <li>
                  <strong>🎤 Artist Profile</strong>, <strong>📻 Track Radio</strong>, or{' '}
                  <strong>📌 Pin</strong>
                </li>
              </ul>
            </div>
          </div>

          {/* Tip 3: Views, Visualizers & Synced Lyrics */}
          <div style={tipCardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#a7f3d0' }}>
              3. 🎨 Visualizers & 🎤 Synced Lyrics
            </div>
            <div style={tipBodyStyle}>
              On the Player screen, cycle between 5 OLED-black visualizers (
              <strong>Glyph Matrix</strong>, <strong>Winamp AVS</strong>,{' '}
              <strong>Demoscene 64K</strong>, <strong>Vertigo Corridor</strong>,{' '}
              <strong>90s Bryce Trapper</strong>) and toggle <strong>🎤 Lyrics</strong> for live
              time-synced lyrics.
            </div>
          </div>

          {/* Tip 4: Controller & Keyboard Quick Reference */}
          <div style={tipCardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fda4af' }}>
              4. 🎮 Controller & Quick Shortcuts
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                columnGap: 10,
                rowGap: 4,
                fontSize: 11.5,
                color: '#cbd5e1',
                marginTop: 2,
              }}
            >
              <span style={kbdBadgeStyle}>R1 / L1</span>
              <span>Switch Player ↔ Library / Cycle tabs</span>
              <span style={kbdBadgeStyle}>A / B</span>
              <span>Play or Select / Walk Back</span>
              <span style={kbdBadgeStyle}>X / Y</span>
              <span>Shuffle Collection / Focus Search</span>
              <span style={kbdBadgeStyle}>SELECT</span>
              <span>Context Menu (Library) / Actions (Player)</span>
            </div>
          </div>
        </div>

        {/* OOBE Source Visibility Quick-Toggles (including Internet Archive Safer Search note) */}
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 12,
            background: '#0e1018',
            border: '1px solid #222638',
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
              flexWrap: 'wrap',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 800, color: '#bfeaf5' }}>
              👁 Active Library Sources (Quick Toggle)
            </span>
            <span style={{ fontSize: 11, color: '#8e8e99' }}>
              🏛️ Internet Archive includes{' '}
              <strong style={{ color: '#38bdf8' }}>🛡️ Safer Search</strong>{' '}
              <em>(at least we tried)</em> — hide anytime if you only want music sources
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              onClick={() => onToggleSourceVisibility('apple_music')}
              style={sourceChipStyle(sourceVisibility.apple_music, '#f43f5e')}
            >
              🍎 Apple Music: {sourceVisibility.apple_music ? 'Shown' : 'Hidden'}
            </button>
            <button
              type="button"
              onClick={() => onToggleSourceVisibility('soundcloud')}
              style={sourceChipStyle(sourceVisibility.soundcloud, '#ea580c')}
            >
              ☁️ SoundCloud: {sourceVisibility.soundcloud ? 'Shown' : 'Hidden'}
            </button>
            <button
              type="button"
              onClick={() => onToggleSourceVisibility('internet_archive')}
              style={sourceChipStyle(sourceVisibility.internet_archive, '#34d399')}
            >
              🏛️ Internet Archive: {sourceVisibility.internet_archive ? 'Shown' : 'Hidden'}
            </button>
            <button
              type="button"
              onClick={() => onToggleSourceVisibility('optical_drive')}
              style={sourceChipStyle(sourceVisibility.optical_drive, '#f59e0b')}
            >
              💿 Optical CD/DVD: {sourceVisibility.optical_drive ? 'Shown' : 'Hidden'}
            </button>
          </div>
        </div>

        {/* Footer Action */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            data-default-focus="true"
            onClick={onClose}
            style={{
              minHeight: 40,
              padding: '0 20px',
              borderRadius: 10,
              background: '#0f222a',
              border: '1px solid #2aa3c4',
              color: '#bfeaf5',
              fontSize: 13,
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            ✓ Got It<span className="simp-gp-badge"> (A)</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const tipCardStyle: React.CSSProperties = {
  padding: '11px 13px',
  borderRadius: 12,
  background: '#10111a',
  border: '1px solid #222436',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const tipBodyStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#cbd5e1',
  lineHeight: 1.48,
};

const kbdBadgeStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 10.5,
  fontWeight: 800,
  color: '#67e8f9',
  background: '#141c24',
  border: '1px solid #243b4a',
  borderRadius: 5,
  padding: '1px 6px',
  alignSelf: 'start',
};

function sourceChipStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    minHeight: 32,
    padding: '0 11px',
    borderRadius: 8,
    background: active ? 'rgba(42, 163, 196, 0.14)' : '#14141e',
    border: active ? `1px solid ${accent}` : '1px solid #262636',
    color: active ? '#f8fafc' : '#8e8e99',
    fontSize: 11.5,
    fontWeight: 800,
    cursor: 'pointer',
  };
}

