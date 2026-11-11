import React from 'react';
import type { SoundCloudComment, TrackMetadata } from '@simp/client';
import { ImpIcon } from '../icons/ImpIcon';
import {
  getSceneDescriptor,
  type SafeAnchorPosition,
  type VisualizerEngine,
} from './sceneRegistry';

export interface FactoidBubbleItem {
  category: string;
  headline: string;
  body: string;
  source: string;
  start_sec: number;
  duration_sec: number;
}

interface VisualizerOverlayHudProps {
  activeEngine: VisualizerEngine;
  track: TrackMetadata | null;
  upNextTrack: TrackMetadata | null;
  positionMs: number;
  durationMs: number;
  activeLyricLine: string | null;
  nextLyricLine: string | null;
  activeComment: SoundCloudComment | null;
  factoidBubbles: FactoidBubbleItem[];
  suppressLyrics: boolean;
  suppressComments: boolean;
  suppressFactoids: boolean;
  isForegroundFaded: boolean;
  idleOpacityPct: number;
  oskOrModalOpen: boolean;
}

export function isValidAttributedComment(
  comment: SoundCloudComment | null | undefined,
): comment is SoundCloudComment {
  if (!comment || !comment.body || !comment.body.trim()) return false;
  const user = (comment.username || '').trim();
  if (!user) return false;
  const lower = user.toLowerCase();
  if (
    lower === 'listener' ||
    lower === 'anonymous' ||
    lower === 'unknown' ||
    lower === 'deleted'
  ) {
    return false;
  }
  return true;
}

function getAnchorStyle(
  anchor: SafeAnchorPosition,
  oskOrModalOpen: boolean,
): React.CSSProperties {
  const bottomOffset = oskOrModalOpen ? 190 : 32;
  const topOffset = 22;
  switch (anchor) {
    case 'top-left':
      return { top: topOffset, left: 32, alignItems: 'flex-start' };
    case 'top-center':
      return {
        top: topOffset,
        left: '50%',
        transform: 'translateX(-50%)',
        alignItems: 'center',
      };
    case 'top-right':
      return { top: topOffset, right: 32, alignItems: 'flex-end' };
    case 'bottom-left':
      return { bottom: bottomOffset, left: 32, alignItems: 'flex-start' };
    case 'bottom-right':
      return { bottom: bottomOffset, right: 32, alignItems: 'flex-end' };
    case 'bottom-center':
    default:
      return {
        bottom: bottomOffset,
        left: '50%',
        transform: 'translateX(-50%)',
        alignItems: 'center',
      };
  }
}

export const VisualizerOverlayHud: React.FC<VisualizerOverlayHudProps> = ({
  activeEngine,
  track,
  upNextTrack,
  positionMs,
  durationMs,
  activeLyricLine,
  nextLyricLine,
  activeComment,
  factoidBubbles,
  suppressLyrics,
  suppressComments,
  suppressFactoids,
  isForegroundFaded,
  idleOpacityPct,
  oskOrModalOpen,
}) => {
  if (!track) return null;

  const scene = getSceneDescriptor(activeEngine);
  const { safeZones } = scene;
  const posSec = Math.max(0, positionMs / 1000);
  const durSec = Math.max(0, (durationMs || track.duration_ms || 0) / 1000);
  const remainingSec = durSec > 0 ? durSec - posSec : 999;

  // "Video Mode": when foreground opacity is < 20% and idle-faded, normal player chrome is invisible,
  // so we pop in the full-legibility MTV Broadcast Chyron (0s–8s), T-15s "UP NEXT" Flyover,
  // Synced Lyrics, Attributed Comments, and Pop-Up Video Factoids!
  const isVideoMode = isForegroundFaded && idleOpacityPct < 20;

  const showMtvIntroChyron = isVideoMode && posSec >= 0.3 && posSec <= 8.5;
  const showUpNextFlyover =
    isVideoMode &&
    Boolean(upNextTrack) &&
    durSec >= 35 &&
    remainingSec <= 15.0 &&
    remainingSec >= 0.8;

  const attributedComment =
    !suppressComments && isValidAttributedComment(activeComment) ? activeComment : null;

  const activeFactoid =
    !suppressFactoids && !showMtvIntroChyron && !showUpNextFlyover
      ? factoidBubbles.find(
          (b) => posSec >= b.start_sec && posSec <= b.start_sec + b.duration_sec,
        ) || null
      : null;

  const showVideoModeLyrics =
    isVideoMode && !suppressLyrics && Boolean(activeLyricLine && activeLyricLine.trim());

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2,
        overflow: 'hidden',
      }}
    >
      {/* 1. MTV Cable-Broadcast Track Intro Chyron (0s–8s in <20% Opacity Video Mode) */}
      {showMtvIntroChyron && (
        <div
          style={{
            position: 'absolute',
            ...getAnchorStyle(safeZones.chyronAnchor, oskOrModalOpen),
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 18px',
            borderRadius: 14,
            background: 'rgba(6, 8, 16, 0.90)',
            border: '1px solid var(--imp-accent-border, rgba(56, 189, 248, 0.55))',
            borderLeft: '5px solid var(--imp-accent, #38bdf8)',
            boxShadow: '0 14px 36px rgba(0, 0, 0, 0.88)',
            maxWidth: 'min(520px, 78vw)',
          }}
        >
          {track.art_url && (
            <img
              src={track.art_url}
              alt=""
              style={{
                width: 54,
                height: 54,
                borderRadius: 9,
                objectFit: 'cover',
                flexShrink: 0,
                border: '1px solid rgba(255,255,255,0.14)',
              }}
            />
          )}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                letterSpacing: '0.12em',
                color: 'var(--imp-accent, #38bdf8)',
                textTransform: 'uppercase',
              }}
            >
              NOW PLAYING • {scene.shortLabel}
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 900,
                color: '#f8fafc',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              “{track.title}”
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#cbd5e1',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {track.artists?.join(', ') || 'Unknown Artist'}
              {track.album && track.album !== 'Unknown Album' ? ` — ${track.album}` : ''}
            </div>
          </div>
        </div>
      )}

      {/* 2. MTV ~15s "UP NEXT" Flyover Card (T-15s in <20% Opacity Video Mode) */}
      {showUpNextFlyover && upNextTrack && (
        <div
          style={{
            position: 'absolute',
            ...getAnchorStyle(safeZones.chyronAnchor, oskOrModalOpen),
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 18px',
            borderRadius: 14,
            background: 'rgba(8, 10, 20, 0.92)',
            border: '1px solid rgba(42, 163, 196, 0.65)',
            borderLeft: '5px solid #2aa3c4',
            boxShadow: '0 14px 36px rgba(0, 0, 0, 0.9)',
            maxWidth: 'min(520px, 78vw)',
          }}
        >
          {upNextTrack.art_url && (
            <img
              src={upNextTrack.art_url}
              alt=""
              style={{
                width: 50,
                height: 50,
                borderRadius: 9,
                objectFit: 'cover',
                flexShrink: 0,
                border: '1px solid rgba(255,255,255,0.14)',
              }}
            />
          )}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                letterSpacing: '0.12em',
                color: '#67e8f9',
                textTransform: 'uppercase',
              }}
            >
              UP NEXT IN {Math.max(1, Math.ceil(remainingSec))}S
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: '#f8fafc',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {upNextTrack.title}
            </div>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: '#94a3b8',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {upNextTrack.artists?.join(', ') || 'Unknown Artist'}
            </div>
          </div>
        </div>
      )}

      {/* 3. VH1-Style "Pop-Up Video" Factoid Bubble (factoids.rs) */}
      {activeFactoid && (
        <div
          style={{
            position: 'absolute',
            ...getAnchorStyle(safeZones.factoidAnchor, oskOrModalOpen),
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '10px 15px',
            borderRadius: 16,
            background: 'rgba(10, 14, 26, 0.88)',
            border: '1.5px solid rgba(250, 204, 21, 0.55)',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.85)',
            maxWidth: 'min(390px, 64vw)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              color: '#facc15',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            <ImpIcon name="factoid" size={12} color="#facc15" />
            <span>
              {activeFactoid.category} • {activeFactoid.source}
            </span>
          </div>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: '#f1f5f9',
              lineHeight: 1.38,
            }}
          >
            {activeFactoid.body}
          </div>
        </div>
      )}

      {/* 4. Reserved Attributed Timed Comment Slot (Video Mode — Never Unattributed, Never Contends with Lyrics) */}
      {isVideoMode && attributedComment && (
        <div
          style={{
            position: 'absolute',
            ...getAnchorStyle(safeZones.commentAnchor, oskOrModalOpen),
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 14px',
            borderRadius: 14,
            background: 'rgba(12, 10, 20, 0.88)',
            border: '1px solid rgba(251, 146, 60, 0.55)',
            boxShadow: '0 10px 26px rgba(0, 0, 0, 0.85)',
            maxWidth: 'min(400px, 65vw)',
          }}
        >
          {attributedComment.avatar_url ? (
            <img
              src={attributedComment.avatar_url}
              alt=""
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                objectFit: 'cover',
                flexShrink: 0,
                border: '1px solid #fb923c',
              }}
            />
          ) : (
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: '#27170c',
                border: '1px solid #fb923c',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <ImpIcon name="comments" size={14} color="#fb923c" />
            </div>
          )}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span
              style={{
                fontSize: 10.5,
                fontFamily: 'monospace',
                fontWeight: 800,
                color: '#fb923c',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              @{attributedComment.username}
            </span>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: '#f8fafc',
                lineHeight: 1.3,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              “{attributedComment.body}”
            </span>
          </div>
        </div>
      )}

      {/* 5. Reserved Synced Lyrics Container in Video Mode (<20% Opacity) */}
      {showVideoModeLyrics && activeLyricLine && (
        <div
          style={{
            position: 'absolute',
            ...getAnchorStyle(safeZones.lyricAnchor, oskOrModalOpen),
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            padding: '10px 20px',
            borderRadius: 14,
            background: 'rgba(6, 8, 16, 0.84)',
            border: '1px solid rgba(103, 232, 249, 0.35)',
            boxShadow: '0 10px 28px rgba(0, 0, 0, 0.85)',
            maxWidth: 'min(620px, 84vw)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 17,
              fontWeight: 900,
              color: '#f8fafc',
              textShadow: '0 2px 10px rgba(0,0,0,0.95)',
            }}
          >
            ♪ {activeLyricLine} ♪
          </div>
          {nextLyricLine && (
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: '#94a3b8',
              }}
            >
              {nextLyricLine}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
