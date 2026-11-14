import React from 'react';
import { defaultSimpClient, TrackMetadata } from '@simp/client';
import { ImpIcon } from './icons/ImpIcon';

export interface AppTopHeaderBarProps {
  isNavBarHidden: boolean;
  setVolumePopoverOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setBrightnessPopoverOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPowerModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSourceModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  view: 'lock' | 'browser';
  setView: React.Dispatch<React.SetStateAction<'lock' | 'browser'>>;
  track: TrackMetadata | null | undefined;
  applyVolume: (nextVol: number) => void;
  currentVolume: number;
  volumePopoverOpen: boolean;
  isPlaying: boolean;
  volPct: number;
  brightnessPopoverOpen: boolean;
  brightnessPct: number;
  setBrightnessPct: React.Dispatch<React.SetStateAction<number>>;
  sourceModalOpen: boolean;
  powerModalOpen: boolean;
}

export const AppTopHeaderBar: React.FC<AppTopHeaderBarProps> = ({
  isNavBarHidden,
  setVolumePopoverOpen,
  setBrightnessPopoverOpen,
  setPowerModalOpen,
  setSourceModalOpen,
  view,
  setView,
  track,
  applyVolume,
  currentVolume,
  volumePopoverOpen,
  isPlaying,
  volPct,
  brightnessPopoverOpen,
  brightnessPct,
  setBrightnessPct,
  sourceModalOpen,
  powerModalOpen,
}) => {
  return (
    <>
      <header
        style={{
          height: 58,
          boxSizing: 'border-box',
          padding: '0 24px',
          borderBottom: isNavBarHidden ? '1px solid transparent' : '1px solid #16161c',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isNavBarHidden ? 'transparent' : '#000000',
          width: '100%',
          flexShrink: 0,
          opacity: isNavBarHidden ? 0 : 1,
          pointerEvents: isNavBarHidden ? 'none' : 'auto',
          transform: isNavBarHidden ? 'translateY(-8px)' : 'translateY(0)',
          transition: isNavBarHidden
            ? 'opacity 420ms ease, transform 420ms ease, background 420ms ease, border-color 420ms ease'
            : 'opacity 60ms ease-out, transform 60ms ease-out',
          position: 'relative',
          zIndex: 40,
        }}
      >
        <button
          data-tile-aux="true"
          onClick={() => {
            setVolumePopoverOpen(false);
            setBrightnessPopoverOpen(false);
            setPowerModalOpen(false);
            setSourceModalOpen(false);
            if (view !== 'lock') {
              setView('lock');
            }
            window.dispatchEvent(new CustomEvent('simp-player-actions-toggle'));
          }}
          title="Track Options, Visualizer & Active Queue (SELECT)"
          style={{
            minHeight: 44,
            maxWidth: 'clamp(190px, 32vw, 380px)',
            padding: '0 12px 0 10px',
            borderRadius: 12,
            background: '#0a0a0e',
            border: '1px solid #22222c',
            color: '#d4d4dc',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
            minWidth: 0,
          }}
        >
          <ImpIcon name="gamepad-select" size={14} color="#9ca3af" />
          <span
            className="simp-gp-badge"
            style={{
              padding: '2px 6px',
              borderRadius: 6,
              background: '#14141e',
              border: '1px solid #2a2a38',
              color: '#9ca3af',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            SELECT
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1, flexShrink: 0 }}>
            {track?.source === 'apple_music' ? (
              <ImpIcon name="apple" size={14} color="#fda4af" />
            ) : track?.source === 'soundcloud' ? (
              <ImpIcon name="soundcloud" size={12} color="#ffffff" />
            ) : track?.source === 'internet_archive' || track?.source === 'ia_video' ? (
              <ImpIcon name="archive" size={13} color="#6ee7b7" />
            ) : track?.source === 'cdda' || track?.source === 'dvd' ? (
              <ImpIcon name="disc" size={13} color="#fcd34d" />
            ) : (
              <ImpIcon name="disc" size={13} color="#67e8f9" />
            )}
          </span>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: 1,
              textAlign: 'left',
            }}
          >
            {track
              ? `${track.title}${track.artists?.length ? ` — ${track.artists[0]}` : ''}`
              : 'Local / Ready'}
          </span>
        </button>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#0a0a0e',
            padding: 4,
            borderRadius: 12,
            border: '1px solid #1c1c24',
          }}
        >
          <span
            className="simp-gp-badge"
            style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'monospace', color: '#71717a' }}
          >
            L1
          </span>
          <button
            onClick={() => setView('lock')}
            style={{
              minHeight: 36,
              padding: '0 16px',
              borderRadius: 8,
              border: view === 'lock' ? '1px solid #2aa3c4' : '1px solid transparent',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              background: view === 'lock' ? '#0f222a' : 'transparent',
              color: view === 'lock' ? '#bfeaf5' : '#8e8e99',
            }}
          >
            🎵 Player
          </button>
          <button
            onClick={() => setView('browser')}
            style={{
              minHeight: 36,
              padding: '0 16px',
              borderRadius: 8,
              border: view === 'browser' ? '1px solid #2aa3c4' : '1px solid transparent',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              background: view === 'browser' ? '#0f222a' : 'transparent',
              color: view === 'browser' ? '#bfeaf5' : '#8e8e99',
            }}
          >
            📚 Library
          </button>
          <span
            className="simp-gp-badge"
            style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'monospace', color: '#71717a' }}
          >
            R1
          </span>
        </div>

        {/* Compact Volume & Brightness Dropdown Controls + Settings Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', zIndex: 40 }}>
          {/* Unified Play/Pause (Silence) Toggle + Volume % Vertical Slider Popover */}
          <div
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.05 : -0.05;
              applyVolume(currentVolume + delta);
            }}
            style={{
              height: 44,
              borderRadius: 12,
              background: '#0a0a0e',
              border: volumePopoverOpen
                ? '1px solid #2aa3c4'
                : isPlaying
                  ? '1px solid #1e3a46'
                  : '1px solid #22222c',
              display: 'flex',
              alignItems: 'stretch',
              position: 'relative',
              fontFamily: 'monospace',
              overflow: 'visible',
            }}
          >
            {view === 'lock' && (
              <span
                className="simp-gp-badge"
                title="D-Pad Down: Volume Down (-5%)"
                onClick={() => applyVolume(currentVolume - 0.05)}
                style={{
                  padding: '0 8px',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: '#71717a',
                  borderRight: '1px solid #1e1e28',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                ▼
              </span>
            )}
            <button
              onClick={() => defaultSimpClient.togglePlayPause()}
              title={isPlaying ? 'Audio Active — Click to Pause (Silence)' : 'Paused (Silenced) — Click to Resume'}
              style={{
                padding: '0 10px',
                border: 'none',
                borderRight: '1px solid #1e1e28',
                borderTopLeftRadius: view === 'lock' ? 0 : 11,
                borderBottomLeftRadius: view === 'lock' ? 0 : 11,
                background: isPlaying ? 'rgba(42, 163, 196, 0.1)' : '#12121a',
                color: isPlaying ? '#2aa3c4' : '#9ca3af',
                fontSize: 14,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span>{!isPlaying ? '🔇' : volPct < 45 ? '🔉' : '🔊'}</span>
              {!isPlaying && (
                <span style={{ fontSize: 10, letterSpacing: 0.4, color: '#9ca3af' }}>PAUSED</span>
              )}
            </button>

            <button
              onClick={() => {
                setBrightnessPopoverOpen(false);
                setVolumePopoverOpen((v) => !v);
              }}
              title="Open vertical volume slider (or use D-Pad Up/Down on Player)"
              style={{
                padding: '0 10px',
                border: 'none',
                borderTopRightRadius: view === 'lock' ? 0 : 11,
                borderBottomRightRadius: view === 'lock' ? 0 : 11,
                background: volumePopoverOpen ? '#0f222a' : 'transparent',
                color: isPlaying ? '#c8c8d2' : '#8e8e99',
                fontSize: 12,
                fontFamily: 'monospace',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>{volPct}%</span>
              <span style={{ fontSize: 10, color: '#71717a' }}>▾</span>
            </button>
            {view === 'lock' && (
              <span
                className="simp-gp-badge"
                title="D-Pad Up: Volume Up (+5%)"
                onClick={() => applyVolume(currentVolume + 0.05)}
                style={{
                  padding: '0 8px',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: '#71717a',
                  borderLeft: '1px solid #1e1e28',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                ▲
              </span>
            )}

            {volumePopoverOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: 52,
                  right: 0,
                  width: 74,
                  padding: '14px 10px',
                  borderRadius: 16,
                  background: '#0c0c12',
                  border: '2px solid #2aa3c4',
                  boxShadow: '0 12px 28px rgba(0,0,0,0.85)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  zIndex: 60,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 800, color: isPlaying ? '#67e8f9' : '#9ca3af' }}>
                  {volPct}%
                </span>
                <div
                  style={{
                    height: 128,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={1}
                    value={volPct}
                    onChange={(e) => applyVolume(Number(e.target.value) / 100)}
                    style={{
                      width: 120,
                      accentColor: '#2aa3c4',
                      transform: 'rotate(-90deg)',
                      cursor: 'pointer',
                    }}
                  />
                </div>
                <button
                  onClick={() => defaultSimpClient.togglePlayPause()}
                  style={{
                    width: '100%',
                    padding: '4px 0',
                    borderRadius: 8,
                    background: isPlaying ? '#0f222a' : '#161622',
                    border: isPlaying ? '1px solid #2aa3c4' : '1px solid #2a2a38',
                    color: isPlaying ? '#7dd3fc' : '#d4d4dc',
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {isPlaying ? '⏸ Pause' : '▶ Play'}
                </button>
              </div>
            )}
          </div>

          {/* OLED Brightness Vertical Slider Popover */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => {
                setVolumePopoverOpen(false);
                setBrightnessPopoverOpen((v) => !v);
              }}
              title="Adjust OLED screen brightness"
              style={{
                height: 44,
                padding: '0 10px',
                borderRadius: 12,
                background: brightnessPopoverOpen ? '#0f222a' : '#0a0a0e',
                border: brightnessPopoverOpen ? '1px solid #2aa3c4' : '1px solid #22222c',
                color: brightnessPopoverOpen ? '#bfeaf5' : '#c8c8d2',
                fontSize: 12,
                fontFamily: 'monospace',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span>{brightnessPct >= 75 ? '🔅' : brightnessPct >= 50 ? '🌙' : '🌑'}</span>
              <span>{brightnessPct}%</span>
              <span style={{ fontSize: 10, color: '#71717a' }}>▾</span>
            </button>

            {brightnessPopoverOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: 52,
                  right: 0,
                  width: 68,
                  padding: '14px 10px',
                  borderRadius: 16,
                  background: '#0c0c12',
                  border: '2px solid #2aa3c4',
                  boxShadow: '0 12px 28px rgba(0,0,0,0.85)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  zIndex: 60,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 800, color: '#67e8f9' }}>
                  {brightnessPct}%
                </span>
                <div
                  style={{
                    height: 128,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <input
                    type="range"
                    min={25}
                    max={100}
                    step={1}
                    value={brightnessPct}
                    onChange={(e) => setBrightnessPct(Number(e.target.value))}
                    style={{
                      width: 120,
                      accentColor: '#2aa3c4',
                      transform: 'rotate(-90deg)',
                      cursor: 'pointer',
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right-End Hamburger (☰) Settings Button + Dynamic Gamepad START Badge */}
          <button
            onClick={() => {
              setVolumePopoverOpen(false);
              setBrightnessPopoverOpen(false);
              setPowerModalOpen(false);
              setSourceModalOpen((v) => !v);
            }}
            title="Settings Menu (START)"
            style={{
              height: 44,
              padding: '0 12px',
              borderRadius: 12,
              background: sourceModalOpen || powerModalOpen ? '#0f222a' : '#0a0a0e',
              border:
                sourceModalOpen || powerModalOpen
                  ? '1px solid #2aa3c4'
                  : '1px solid #22222c',
              color: sourceModalOpen || powerModalOpen ? '#bfeaf5' : '#c8c8d2',
              fontSize: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              className="simp-gp-badge"
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#14141e',
                border: '1px solid #2a2a38',
                color: '#9ca3af',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 700,
              }}
            >
              START
            </span>
            <span style={{ lineHeight: 1 }}>☰</span>
          </button>
        </div>
      </header>
    </>
  );
};
