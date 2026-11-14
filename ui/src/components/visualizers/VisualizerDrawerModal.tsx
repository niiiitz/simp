import React, { useEffect } from 'react';
import { ImpIcon } from '../icons/ImpIcon';
import {
  VISUALIZER_SCENES,
  type VisualizerEngine,
  type VisualizerMode,
} from './sceneRegistry';

interface VisualizerDrawerModalProps {
  open: boolean;
  onClose: () => void;
  vizMode: VisualizerMode;
  activeEngine: VisualizerEngine;
  enabledScenes: VisualizerEngine[];
  onSelectMode: (mode: VisualizerMode) => void;
  onToggleSceneInRotation: (engine: VisualizerEngine) => void;
  onSetAllScenesInRotation?: (engines: VisualizerEngine[]) => void;
}

export const VisualizerDrawerModal: React.FC<VisualizerDrawerModalProps> = ({
  open,
  onClose,
  vizMode,
  activeEngine,
  enabledScenes,
  onSelectMode,
  onToggleSceneInRotation,
}) => {
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const target =
        document.querySelector<HTMLElement>(
          '[data-viz-drawer-modal="true"] button[data-default-focus="true"]:not([disabled])',
        ) ||
        document.querySelector<HTMLElement>(
          '[data-viz-drawer-modal="true"] button:not([disabled])',
        );
      if (!target) return;
      document
        .querySelectorAll<HTMLElement>('[data-simp-active-focus="true"], .simp-gpfocus')
        .forEach((node) => {
          if (node !== target) {
            node.removeAttribute('data-simp-active-focus');
            node.classList.remove('simp-gpfocus');
          }
        });
      target.setAttribute('data-simp-active-focus', 'true');
      target.classList.add('simp-gpfocus');
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, 25);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.78)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
        zIndex: 92,
      }}
    >
      <div
        data-modal-root="true"
        data-viz-drawer-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 650,
          maxHeight: '88vh',
          background: '#0a0b10',
          border: '2px solid var(--imp-accent, #2aa3c4)',
          borderRadius: 18,
          padding: 20,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.92)',
          color: '#f1f5f9',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ImpIcon name="sparkles" size={20} color="var(--imp-accent, #38bdf8)" />
            <div>
              <div style={{ fontSize: 15, fontWeight: 900, color: '#f8fafc' }}>
                Visualizer Scene Queue & Rotation
              </div>
              <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                Lock a scene or choose which scenes rotate on track change
              </div>
            </div>
          </div>
          <button
            type="button"
            data-viz-drawer-close="true"
            onClick={onClose}
            style={{
              minHeight: 38,
              padding: '0 12px',
              borderRadius: 9,
              background: '#161822',
              border: '1px solid #2e3244',
              color: '#e2e8f0',
              fontFamily: 'monospace',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ImpIcon name="close" size={14} />
            <span className="simp-gp-badge">B</span>
          </button>
        </div>

        {/* Playback Mode Pills: Cycle | Shuffle | Off */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 8,
          }}
        >
          <button
            type="button"
            data-default-focus={vizMode === 'cycle' ? 'true' : undefined}
            onClick={() => onSelectMode('cycle')}
            style={{
              minHeight: 40,
              padding: '8px 10px',
              borderRadius: 10,
              background: vizMode === 'cycle' ? 'rgba(42, 163, 196, 0.22)' : '#12141e',
              border:
                vizMode === 'cycle'
                  ? '1.5px solid var(--imp-accent, #38bdf8)'
                  : '1px solid #252838',
              color: vizMode === 'cycle' ? '#f8fafc' : '#cbd5e1',
              fontWeight: 800,
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <ImpIcon name="refresh" size={14} color={vizMode === 'cycle' ? '#38bdf8' : '#94a3b8'} />
            <span>Cycle Enabled ({enabledScenes.length})</span>
          </button>

          <button
            type="button"
            data-default-focus={vizMode === 'shuffle' ? 'true' : undefined}
            onClick={() => onSelectMode('shuffle')}
            style={{
              minHeight: 40,
              padding: '8px 10px',
              borderRadius: 10,
              background: vizMode === 'shuffle' ? 'rgba(42, 163, 196, 0.22)' : '#12141e',
              border:
                vizMode === 'shuffle'
                  ? '1.5px solid var(--imp-accent, #38bdf8)'
                  : '1px solid #252838',
              color: vizMode === 'shuffle' ? '#f8fafc' : '#cbd5e1',
              fontWeight: 800,
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <ImpIcon
              name="shuffle"
              size={14}
              color={vizMode === 'shuffle' ? '#38bdf8' : '#94a3b8'}
            />
            <span>Shuffle Enabled ({enabledScenes.length})</span>
          </button>

          <button
            type="button"
            data-default-focus={vizMode === 'off' ? 'true' : undefined}
            onClick={() => onSelectMode('off')}
            style={{
              minHeight: 40,
              padding: '8px 10px',
              borderRadius: 10,
              background: vizMode === 'off' ? 'rgba(244, 63, 94, 0.2)' : '#12141e',
              border: vizMode === 'off' ? '1.5px solid #fb7185' : '1px solid #252838',
              color: vizMode === 'off' ? '#fecdd3' : '#94a3b8',
              fontWeight: 800,
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <ImpIcon name="ban" size={14} color={vizMode === 'off' ? '#fb7185' : '#94a3b8'} />
            <span>Visualizer Off</span>
          </button>
        </div>

        {/* Rotation Legend */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            padding: '0 2px',
            fontSize: 11,
            color: '#94a3b8',
          }}
        >
          <span>
            <strong>Left toggle</strong> = rotation • <strong>Row</strong> = lock scene
          </span>
        </div>

        {/* Scrollable Scene Roster */}
        <div
          style={{
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            paddingRight: 4,
          }}
        >
          {VISUALIZER_SCENES.map((scene) => {
            const isLockedSingle = vizMode === scene.id;
            const isCurrentlyRendering = vizMode !== 'off' && activeEngine === scene.id;
            const isInRotation = enabledScenes.includes(scene.id);

            return (
              <div
                key={scene.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '76px minmax(0, 1fr)',
                  alignItems: 'stretch',
                  gap: 8,
                }}
              >
                {/* Left-Aligned Rotation Enable Toggle */}
                <button
                  type="button"
                  onClick={() => onToggleSceneInRotation(scene.id)}
                  title="Include or exclude this scene when Cycle or Shuffle is active"
                  style={{
                    width: '100%',
                    minHeight: 50,
                    borderRadius: 11,
                    background: isInRotation ? 'rgba(16, 185, 129, 0.14)' : '#12141e',
                    border: isInRotation
                      ? '1px solid rgba(52, 211, 153, 0.45)'
                      : '1px solid #222638',
                    color: isInRotation ? '#34d399' : '#64748b',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                  }}
                >
                  <ImpIcon
                    name={isInRotation ? 'check' : 'close'}
                    size={12}
                    color={isInRotation ? '#34d399' : '#64748b'}
                  />
                  <span>{isInRotation ? 'On' : 'Off'}</span>
                </button>

                {/* Right Scene Lock Card */}
                <button
                  type="button"
                  data-default-focus={isLockedSingle ? 'true' : undefined}
                  onClick={() => onSelectMode(scene.id)}
                  style={{
                    minWidth: 0,
                    minHeight: 50,
                    padding: '7px 12px',
                    borderRadius: 11,
                    background: isCurrentlyRendering
                      ? 'rgba(15, 34, 46, 0.92)'
                      : 'rgba(16, 18, 28, 0.9)',
                    border: isLockedSingle
                      ? '1.5px solid var(--imp-accent, #38bdf8)'
                      : isCurrentlyRendering
                        ? '1px solid rgba(56, 189, 248, 0.5)'
                        : '1px solid #222638',
                    color: '#f1f5f9',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    textAlign: 'left',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          color: isCurrentlyRendering ? '#67e8f9' : '#f1f5f9',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {scene.label}
                      </span>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontFamily: 'monospace',
                          fontWeight: 800,
                          padding: '1px 6px',
                          borderRadius: 5,
                          flexShrink: 0,
                          background: 'rgba(56, 189, 248, 0.14)',
                          color: '#7dd3fc',
                          border: '1px solid rgba(56, 189, 248, 0.28)',
                        }}
                      >
                        {scene.eraBadge}
                      </span>
                      {isCurrentlyRendering && (
                        <span
                          style={{
                            fontSize: 9.5,
                            fontFamily: 'monospace',
                            fontWeight: 800,
                            color: '#facc15',
                            flexShrink: 0,
                          }}
                        >
                          LIVE
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#94a3b8',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {scene.subtitle}
                    </div>
                  </div>

                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 10.5,
                      fontWeight: 800,
                      color: isLockedSingle ? '#38bdf8' : '#64748b',
                      flexShrink: 0,
                    }}
                  >
                    {isLockedSingle ? 'LOCKED' : scene.shortLabel}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
