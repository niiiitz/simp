import React from 'react';
import { SourceVisibilityPrefs } from '../views/SettingsModal';
import { AppleMusicLogo } from './AppleMusicLogo';
import { SoundCloudLogo } from './SoundCloudLogo';

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
          maxWidth: 640,
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

        {/* Choose Sources Bar (Above Steps 1-4) */}
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
          <div style={{ fontSize: 12, fontWeight: 800, color: '#bfeaf5' }}>
            Choose Sources:
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={() => onToggleSourceVisibility('apple_music')}
              style={sourceChipStyle(sourceVisibility.apple_music, '#f43f5e')}
            >
              {sourceVisibility.apple_music ? <AppleMusicLogo size={14} /> : <span>🚫</span>}
              <span>Apple Music</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleSourceVisibility('soundcloud')}
              style={sourceChipStyle(sourceVisibility.soundcloud, '#ea580c')}
            >
              {sourceVisibility.soundcloud ? <SoundCloudLogo width={30} /> : <span>🚫</span>}
              <span>SoundCloud</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleSourceVisibility('internet_archive')}
              style={sourceChipStyle(sourceVisibility.internet_archive, '#34d399')}
            >
              <span>{sourceVisibility.internet_archive ? '🏛️' : '🚫'}</span>
              <span>Internet Archive</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleSourceVisibility('optical_drive')}
              style={sourceChipStyle(sourceVisibility.optical_drive, '#f59e0b')}
            >
              <span>{sourceVisibility.optical_drive ? '💿' : '🚫'}</span>
              <span>Optical Disc</span>
            </button>
          </div>
        </div>

        {/* Tip Cards Grid (Steps 1-4) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: 10,
          }}
        >
          {/* 1. START Menu */}
          <div style={tipCardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#67e8f9' }}>
              1. ☰ START Menu
            </div>
            <div style={tipBodyStyle}>
              <strong>&ldquo;START&rdquo;</strong> (<strong>☰</strong> from top-right) to configure
              your connected accounts and local folders to scan for media.
            </div>
            <button
              type="button"
              data-default-focus="true"
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
              Folders &amp; Accounts →
            </button>
          </div>

          {/* 2. [SELECT] Context Actions */}
          <div style={tipCardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fdba74' }}>
              2. ⚙ [SELECT] Context Actions
            </div>
            <div style={tipBodyStyle}>
              <strong>&ldquo;SELECT&rdquo; ⚙</strong> menu or right-click on library object for
              contextual controls.
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.5 }}>
                <li>
                  <strong>Player View:</strong> Interface Settings: Lyrics, Visualizer,{' '}
                  <SoundCloudLogo
                    width={30}
                    style={{ margin: '0 2px', verticalAlign: 'middle' }}
                  />{' '}
                  Comments, Content Queue, <span style={{ color: '#f43f5e' }}>♥</span> Favorite
                  &amp; Discover more, etc.
                </li>
              </ul>
            </div>
          </div>

          {/* 3. Gamepad and Controls */}
          <div style={tipCardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fda4af' }}>
              3. 🎮 Gamepad and Controls
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
              <span style={kbdBadgeStyle}>R2 / L2</span>
              <span>Seek +10s / -10s (Fast-Forward / Rewind)</span>
            </div>
          </div>

          {/* 4. Library Management */}
          <div style={tipCardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#a7f3d0' }}>
              4. 📚 Library Management
            </div>
            <div style={tipBodyStyle}>
              Search across combinations of the selected sources, as found in the{' '}
              <strong>☰ START</strong> menu Folders &amp; Accounts. Create and Edit Hybrid
              Playlists that may span across sources. Drill down into sources to discover and
              browse content. Manage 📌 pinned collections.
            </div>
          </div>
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
    minHeight: 34,
    padding: '0 10px',
    borderRadius: 8,
    background: active ? 'rgba(42, 163, 196, 0.14)' : '#12121a',
    border: active ? `1px solid ${accent}` : '1px solid transparent',
    color: active ? '#f8fafc' : '#6b7280',
    fontSize: 11.5,
    fontWeight: active ? 800 : 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    whiteSpace: 'nowrap',
    gap: 6,
  };
}

