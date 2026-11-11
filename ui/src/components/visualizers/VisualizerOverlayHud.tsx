import React, { useEffect, useRef, useState } from 'react';
import {
  defaultSimpClient,
  type SoundCloudComment,
  type TrackMetadata,
} from '@simp/client';
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
  part_index?: number | null;
  part_total?: number | null;
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
  const bottomOffset = oskOrModalOpen ? 190 : 88;
  const topOffset = 68;
  switch (anchor) {
    case 'top-left':
      return { top: topOffset, left: 36, alignItems: 'flex-start' };
    case 'top-center':
      return {
        top: topOffset,
        left: '50%',
        transform: 'translateX(-50%)',
        alignItems: 'center',
      };
    case 'top-right':
      return { top: topOffset, right: 36, alignItems: 'flex-end' };
    case 'bottom-left':
      return { bottom: bottomOffset, left: 36, alignItems: 'flex-start' };
    case 'bottom-right':
      return { bottom: bottomOffset, right: 36, alignItems: 'flex-end' };
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

/**
 * Computes a soft VHS fade-in / fade-out envelope (0.0 .. 1.0) over `[startSec, endSec]`
 * with `fadeSec` ramps at both ends.
 */
function computeSoftVhsEnvelope(
  posSec: number,
  startSec: number,
  endSec: number,
  fadeSec: number,
): number {
  if (posSec < startSec || posSec > endSec) return 0;
  const fadeIn = Math.min(1, Math.max(0, (posSec - startSec) / Math.max(0.1, fadeSec)));
  const fadeOut = Math.min(1, Math.max(0, (endSec - posSec) / Math.max(0.1, fadeSec)));
  const raw = Math.min(fadeIn, fadeOut);
  // Smoothstep easing for warm analog CRT phosphor rise/decay
  return raw * raw * (3 - 2 * raw);
}

export const VisualizerOverlayHud: React.FC<VisualizerOverlayHudProps> = ({
  activeEngine,
  track,
  upNextTrack,
  positionMs,
  durationMs,
  factoidBubbles,
  suppressFactoids,
  isForegroundFaded,
  oskOrModalOpen,
}) => {
  const [livePosMs, setLivePosMs] = useState<number>(positionMs);
  const fadeIntroStartSecRef = useRef<number>(0.4);
  const lastTrackUriRef = useRef<string | undefined>(track?.uri);
  const prevFadedRef = useRef<boolean>(isForegroundFaded);

  // Sync initial / seek / pause snapshot position
  useEffect(() => {
    setLivePosMs(positionMs);
  }, [positionMs, track?.uri]);

  // Subscribe to real-time playback progress ticks so chyrons & factoids advance continuously while playing
  useEffect(() => {
    const unsub = defaultSimpClient.subscribeProgress((posMs) => {
      if (typeof posMs === 'number' && Number.isFinite(posMs)) {
        setLivePosMs(posMs);
      }
    });
    return unsub;
  }, []);

  const posSec = Math.max(0, livePosMs / 1000);

  // Reset intro window on track change, or trigger an 8s VHS intro window when the display first fades out
  if (track?.uri !== lastTrackUriRef.current) {
    lastTrackUriRef.current = track?.uri;
    fadeIntroStartSecRef.current = 0.4;
  }
  if (isForegroundFaded && !prevFadedRef.current) {
    // If display just faded out during the first 40s of the song, start the 8s VHS Intro Chyron right now!
    if (posSec > 2.0 && posSec < 40.0 && posSec > fadeIntroStartSecRef.current + 6.0) {
      fadeIntroStartSecRef.current = posSec;
    }
  }
  prevFadedRef.current = isForegroundFaded;

  if (!track) return null;

  const scene = getSceneDescriptor(activeEngine);
  const { safeZones } = scene;
  const durSec = Math.max(0, (durationMs || track.duration_ms || 0) / 1000);
  const remainingSec = durSec > 0 ? durSec - posSec : 999;

  // 1. MTV Cable-Broadcast VHS Track Intro Chyron — ONLY when display is faded out (`isForegroundFaded`)
  const introStart = fadeIntroStartSecRef.current;
  const introEnd = introStart + 8.2;
  const introEnv = isForegroundFaded
    ? computeSoftVhsEnvelope(posSec, introStart, introEnd, 1.35)
    : 0;
  const showMtvIntroChyron = introEnv > 0.01;

  // 2. MTV "UP NEXT" VHS Flyover Chyron — disabled per user preference
  const upNextEnv = 0;
  const showUpNextFlyover = false;
  void durationMs;
  void upNextTrack;

  // 3. VH1-Style "Pop-Up Video" Speech-Bubble Factoids (18s .. T-20s, with 2-part sequential support)
  const activeFactoid =
    !suppressFactoids && !showMtvIntroChyron && !showUpNextFlyover
      ? factoidBubbles.find(
          (b) => posSec >= b.start_sec && posSec <= b.start_sec + b.duration_sec,
        ) || null
      : null;

  const factoidEnv = activeFactoid
    ? computeSoftVhsEnvelope(
        posSec,
        activeFactoid.start_sec,
        activeFactoid.start_sec + activeFactoid.duration_sec,
        0.45,
      )
    : 0;

  const vhsChromaticShadow =
    '-1.3px 0 rgba(251, 113, 133, 0.62), 1.3px 0 rgba(56, 189, 248, 0.62), 0 2px 12px rgba(0, 0, 0, 0.95)';

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
      {/* 1. MTV Cable-Broadcast Soft VHS Track Intro Chyron (Faded-Out Display Mode, 1.5x Scaled) */}
      {showMtvIntroChyron && (
        <div
          style={{
            position: 'absolute',
            ...getAnchorStyle(safeZones.chyronAnchor, oskOrModalOpen),
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            padding: '19px 32px 19px 24px',
            borderRadius: 16,
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(255,255,255,0.038) 0px, rgba(255,255,255,0.038) 1px, transparent 1px, transparent 3px), linear-gradient(90deg, rgba(8, 10, 18, 0.90) 0%, rgba(12, 15, 28, 0.80) 78%, rgba(12, 15, 28, 0.16) 100%)',
            borderLeft: '6px solid rgba(250, 204, 21, 0.88)',
            borderTop: '1px solid rgba(255, 255, 255, 0.16)',
            borderBottom: '1px solid rgba(56, 189, 248, 0.28)',
            boxShadow:
              '0 18px 44px rgba(0, 0, 0, 0.82), 0 0 28px rgba(56, 189, 248, 0.18)',
            maxWidth: 'min(780px, 88vw)',
            opacity: introEnv,
            filter: `blur(${((1 - introEnv) * 2.6).toFixed(2)}px)`,
            transform: `translateY(${((1 - introEnv) * 10).toFixed(1)}px)`,
          }}
        >
          {track.art_url && (
            <img
              src={track.art_url}
              alt=""
              style={{
                width: 84,
                height: 84,
                borderRadius: 11,
                objectFit: 'cover',
                flexShrink: 0,
                border: '1.5px solid rgba(255, 255, 255, 0.25)',
                boxShadow:
                  '-2.5px 0 10px rgba(251, 113, 133, 0.38), 2.5px 0 10px rgba(56, 189, 248, 0.38)',
              }}
            />
          )}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div
              style={{
                fontSize: 14,
                fontFamily: '"JetBrains Mono", "Courier New", monospace',
                fontWeight: 800,
                letterSpacing: '0.16em',
                color: '#fde047',
                textTransform: 'uppercase',
                textShadow: vhsChromaticShadow,
              }}
            >
              IMP CABLE • {scene.shortLabel}
            </div>
            <div
              style={{
                fontSize: 22.5,
                fontWeight: 900,
                letterSpacing: '0.04em',
                color: '#f8fafc',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textShadow: vhsChromaticShadow,
              }}
            >
              {track.artists?.join(', ') || 'Unknown Artist'}
            </div>
            <div
              style={{
                fontSize: 25.5,
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontStyle: 'italic',
                fontWeight: 700,
                color: '#fef9c3',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textShadow: vhsChromaticShadow,
              }}
            >
              “{track.title}”
            </div>
            {track.album && track.album !== 'Unknown Album' && (
              <div
                style={{
                  fontSize: 17.5,
                  fontWeight: 700,
                  color: '#cbd5e1',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  textShadow: '0 1px 6px rgba(0, 0, 0, 0.95)',
                }}
              >
                {track.album}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. MTV ~15s "UP NEXT" Soft VHS Flyover Chyron (Faded-Out Display Mode) */}
      {showUpNextFlyover && upNextTrack && (
        <div
          style={{
            position: 'absolute',
            ...getAnchorStyle(safeZones.chyronAnchor, oskOrModalOpen),
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 20px 12px 15px',
            borderRadius: 12,
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 3px), linear-gradient(90deg, rgba(8, 12, 22, 0.90) 0%, rgba(12, 18, 32, 0.78) 80%, rgba(12, 18, 32, 0.16) 100%)',
            borderLeft: '4px solid #38bdf8',
            borderTop: '1px solid rgba(255, 255, 255, 0.14)',
            borderBottom: '1px solid rgba(250, 204, 21, 0.25)',
            boxShadow: '0 14px 36px rgba(0, 0, 0, 0.82)',
            maxWidth: 'min(520px, 78vw)',
            opacity: upNextEnv,
            filter: `blur(${((1 - upNextEnv) * 2.4).toFixed(2)}px)`,
            transform: `translateY(${((1 - upNextEnv) * 8).toFixed(1)}px)`,
          }}
        >
          {upNextTrack.art_url && (
            <img
              src={upNextTrack.art_url}
              alt=""
              style={{
                width: 50,
                height: 50,
                borderRadius: 8,
                objectFit: 'cover',
                flexShrink: 0,
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            />
          )}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div
              style={{
                fontSize: 10,
                fontFamily: '"JetBrains Mono", "Courier New", monospace',
                fontWeight: 800,
                letterSpacing: '0.15em',
                color: '#38bdf8',
                textTransform: 'uppercase',
                textShadow: vhsChromaticShadow,
              }}
            >
              UP NEXT • {Math.max(1, Math.ceil(remainingSec))}S
            </div>
            <div
              style={{
                fontSize: 15.5,
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontStyle: 'italic',
                fontWeight: 700,
                color: '#fef9c3',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textShadow: vhsChromaticShadow,
              }}
            >
              “{upNextTrack.title}”
            </div>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 800,
                color: '#e2e8f0',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textShadow: vhsChromaticShadow,
              }}
            >
              {upNextTrack.artists?.join(', ') || 'Unknown Artist'}
            </div>
          </div>
        </div>
      )}

      {/* 3. VH1-Style "Pop-Up Video" Speech Bubble (Bottom-Center, Scaled Up, 2-Part Continuation & Pointer Tail) */}
      {activeFactoid && factoidEnv > 0.01 && (
        <div
          style={{
            position: 'absolute',
            bottom: oskOrModalOpen ? 190 : 82,
            left: '50%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: 'min(580px, 84vw)',
            opacity: factoidEnv,
            transform: `translateX(-50%) scale(${(0.92 + factoidEnv * 0.08).toFixed(3)}) translateY(${((1 - factoidEnv) * 8).toFixed(1)}px)`,
            transformOrigin: 'bottom center',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
              padding: '16px 24px 18px 24px',
              borderRadius: '28px',
              background:
                'radial-gradient(circle at 22% 18%, rgba(24, 32, 54, 0.96) 0%, rgba(10, 14, 26, 0.95) 100%)',
              border: '2.5px solid rgba(250, 204, 21, 0.85)',
              boxShadow:
                '0 18px 42px rgba(0, 0, 0, 0.88), 0 0 28px rgba(250, 204, 21, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.24)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                fontSize: 12,
                fontFamily: '"JetBrains Mono", monospace',
                fontWeight: 800,
                color: '#facc15',
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ImpIcon name="factoid" size={15} color="#facc15" />
                <span>
                  {activeFactoid.category} • {activeFactoid.source}
                </span>
              </span>
              {activeFactoid.part_total && activeFactoid.part_total > 1 && (
                <span
                  style={{
                    padding: '2px 9px',
                    borderRadius: 999,
                    background: 'rgba(250, 204, 21, 0.2)',
                    border: '1px solid rgba(250, 204, 21, 0.5)',
                    color: '#fef08a',
                    fontSize: 11,
                  }}
                >
                  {activeFactoid.part_index || 1}/{activeFactoid.part_total}
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 'clamp(15.5px, 1.8vw, 18.5px)',
                fontWeight: 700,
                color: '#f8fafc',
                lineHeight: 1.42,
                textShadow: '0 1px 5px rgba(0, 0, 0, 0.92)',
              }}
            >
              {activeFactoid.body}
            </div>
          </div>
          {/* Speech Bubble Pointer Tail (Bottom-Center) */}
          <svg
            width="30"
            height="16"
            viewBox="0 0 30 16"
            style={{
              marginTop: -2.5,
              filter: 'drop-shadow(0 5px 8px rgba(0,0,0,0.7))',
            }}
          >
            <path
              d="M4 0 L26 0 L15 14 Z"
              fill="rgba(12, 16, 30, 0.96)"
              stroke="rgba(250, 204, 21, 0.85)"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </div>
  );
};
