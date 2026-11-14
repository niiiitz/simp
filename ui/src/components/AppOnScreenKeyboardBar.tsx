import React from 'react';
import { TrackMetadata } from '@simp/client';
import { OskTargetKind } from '../hooks/useGamepadNavigation';

export interface AppOnScreenKeyboardBarProps {
  oskTarget: OskTargetKind;
  setOskTarget: React.Dispatch<React.SetStateAction<OskTargetKind>>;
  view: 'lock' | 'browser';
  sourceModalOpen: boolean;
  powerModalOpen: boolean;
  pendingHybridAdd: {
    uris: string[];
    label: string;
    trackMetadata?: TrackMetadata[];
    creatingNew?: boolean;
  } | null;
  browserSearch: string;
  setBrowserSearch: React.Dispatch<React.SetStateAction<string>>;
  newPlaylistName: string;
  setNewPlaylistName: React.Dispatch<React.SetStateAction<string>>;
  customFolderPath: string;
  setCustomFolderPath: React.Dispatch<React.SetStateAction<string>>;
  applyFocusMarker: (el: HTMLElement | null) => void;
}

export const AppOnScreenKeyboardBar: React.FC<AppOnScreenKeyboardBarProps> = ({
  oskTarget,
  setOskTarget,
  view,
  sourceModalOpen,
  powerModalOpen,
  pendingHybridAdd,
  browserSearch,
  setBrowserSearch,
  newPlaylistName,
  setNewPlaylistName,
  customFolderPath,
  setCustomFolderPath,
  applyFocusMarker,
}) => {
  return (
    <>
    {/* Controller-Navigable On-Screen Keyboard (OSK) Bar for Search, Playlist Name & Folder Path */}
    {oskTarget &&
      (view === 'browser' || sourceModalOpen || powerModalOpen || Boolean(pendingHybridAdd)) && (
      <div
        data-osk-root="true"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 95,
          background: 'rgba(8, 8, 12, 0.96)',
          borderTop: '2px solid #2aa3c4',
          boxShadow: '0 -12px 32px rgba(0, 0, 0, 0.85)',
          padding: '10px 18px 14px',
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
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'monospace',
                color: '#2aa3c4',
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {oskTarget === 'search'
                ? '⌨️ SEARCH:'
                : oskTarget === 'playlist'
                ? '⌨️ PLAYLIST NAME:'
                : '⌨️ FOLDER PATH:'}
            </span>
            <div
              style={{
                flex: 1,
                minHeight: 32,
                padding: '0 12px',
                borderRadius: 8,
                background: '#050508',
                border: '1px solid #2aa3c4',
                color: '#f4f4f6',
                fontSize: 13,
                fontFamily: 'monospace',
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {(oskTarget === 'search'
                ? browserSearch
                : oskTarget === 'playlist'
                ? newPlaylistName
                : customFolderPath) || (
                <span style={{ color: '#71717a' }}>Type with D-Pad + (A) or press (B) when done...</span>
              )}
              <span style={{ color: '#2aa3c4', marginLeft: 2, fontWeight: 900 }}>▋</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => {
                if (oskTarget === 'search') setBrowserSearch((v) => v.slice(0, -1));
                else if (oskTarget === 'playlist') setNewPlaylistName((v) => v.slice(0, -1));
                else setCustomFolderPath((v) => v.slice(0, -1));
              }}
              style={{
                minHeight: 34,
                padding: '0 12px',
                borderRadius: 8,
                background: '#161622',
                border: '1px solid #2e2e3e',
                color: '#fca5a5',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ⌫ Backspace
            </button>
            <button
              onClick={() => {
                if (oskTarget === 'search') setBrowserSearch('');
                else if (oskTarget === 'playlist') setNewPlaylistName('');
                else setCustomFolderPath('');
              }}
              style={{
                minHeight: 34,
                padding: '0 12px',
                borderRadius: 8,
                background: '#161622',
                border: '1px solid #2e2e3e',
                color: '#9ca3af',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
            <button
              onClick={() => {
                const prevInputSelector = `[data-osk-input="${oskTarget}"]`;
                setOskTarget(null);
                window.setTimeout(() => {
                  const pickerSubmit = document.querySelector<HTMLElement>(
                    '[data-hybrid-picker-submit="true"]:not([disabled])'
                  );
                  const inp =
                    pickerSubmit || document.querySelector<HTMLElement>(prevInputSelector);
                  if (inp) applyFocusMarker(inp);
                }, 30);
              }}
              style={{
                minHeight: 34,
                padding: '0 14px',
                borderRadius: 8,
                background: '#0f222a',
                border: '1px solid #2aa3c4',
                color: '#bfeaf5',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ✓ Done<span className="simp-gp-badge"> (B)</span>
            </button>
          </div>
        </div>

        {[
          ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '/'],
          ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
          ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"],
          ['z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '_', 'SPACE'],
        ].map((row, rIdx) => (
          <div
            key={rIdx}
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 5,
            }}
          >
            {row.map((keyChar) => {
              const isSpace = keyChar === 'SPACE';
              return (
                <button
                  key={keyChar}
                  data-default-focus={keyChar === 'a' ? 'true' : undefined}
                  onClick={() => {
                    const ch = isSpace ? ' ' : keyChar;
                    if (oskTarget === 'search') setBrowserSearch((v) => v + ch);
                    else if (oskTarget === 'playlist') setNewPlaylistName((v) => v + ch);
                    else setCustomFolderPath((v) => v + ch);
                  }}
                  style={{
                    flex: isSpace ? 2.6 : 1,
                    maxWidth: isSpace ? 180 : 62,
                    minHeight: 36,
                    borderRadius: 8,
                    background: '#12121a',
                    border: '1px solid #262636',
                    color: '#e4e4ec',
                    fontSize: 13,
                    fontFamily: 'monospace',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {isSpace ? '␣ Space' : keyChar.toUpperCase()}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    )}
    </>
  );
};
