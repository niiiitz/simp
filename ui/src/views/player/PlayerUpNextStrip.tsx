import React from 'react';
import { SimpStateSnapshot } from '@simp/client';
import { ImpIcon } from '../../components/icons/ImpIcon';

export interface PlayerUpNextStripProps {
  hasUpNext: boolean;
  snap: SimpStateSnapshot | null;
  isVideoTrack: boolean;
  videoTheatreExpanded: boolean;
  isForegroundFaded: boolean;
  idleOpacityPct: number;
  effectiveScale: number;
}

export const PlayerUpNextStrip: React.FC<PlayerUpNextStripProps> = ({
  hasUpNext,
  snap,
  isVideoTrack,
  videoTheatreExpanded,
  isForegroundFaded,
  idleOpacityPct,
  effectiveScale,
}) => {
  return (
    <>
      {hasUpNext && snap?.up_next && !(isVideoTrack && videoTheatreExpanded) ? (
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 48,
            zIndex: 3,
            maxWidth: 'calc((100vw - 120px) * 0.42)',
            pointerEvents: 'none',
            opacity: isForegroundFaded ? Math.max(0, Math.min(0.95, idleOpacityPct / 100)) : 1,
            transition: isForegroundFaded ? 'opacity 480ms ease' : 'opacity 60ms ease-out',
            transform: effectiveScale > 1.02 ? `scale(${effectiveScale})` : undefined,
            transformOrigin: 'top right',
          }}
        >
          <div
            style={{
              width: 'fit-content',
              maxWidth: '100%',
              minWidth: 0,
              padding: '8px 14px',
              borderRadius: 12,
              background: 'rgba(8, 9, 14, 0.90)',
              border: '1px solid #283044',
              boxShadow:
                '0 10px 26px rgba(0, 0, 0, 0.92), 0 2px 8px rgba(0, 0, 0, 0.96), 0 0 0 1px rgba(0, 0, 0, 0.8)',
              fontSize: 12,
              color: '#c4c4d0',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              boxSizing: 'border-box',
              pointerEvents: 'auto',
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              <strong style={{ fontFamily: 'monospace', color: '#2aa3c4', marginRight: 8 }}>
                NEXT:
              </strong>
              {snap.up_next[0].title} — {snap.up_next[0].artists.join(', ')}
            </span>
            <span
              className="simp-gp-badge"
              style={{
                fontFamily: 'monospace',
                color: '#71717a',
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              <ImpIcon
                name="gamepad-select"
                size={12}
                color="#71717a"
                style={{ marginRight: 4, verticalAlign: '-1px' }}
              />
              SELECT • Actions
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
};
