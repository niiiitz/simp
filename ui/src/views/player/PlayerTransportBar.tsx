import React from 'react';
import {
  defaultSimpClient,
  SimpStateSnapshot,
  SoundCloudComment,
  TrackMetadata,
} from '@simp/client';
import { ProgressBarRaf } from '../../components/ProgressBarRaf';
import { type TrackLyricsResponse } from '../../drivers/appleApi';
import { type ImpSourceTheme } from '../../theme/sourceTheme';

export interface ActiveCommentBubble {
  comment: SoundCloudComment;
  slot: 0 | 1;
  placement: 'above' | 'below';
  expiresAt: number;
}

export function formatCommentTs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '💬';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export interface PlayerTransportBarProps {
  hidden: boolean;
  snap: SimpStateSnapshot | null;
  track: TrackMetadata | null | undefined;
  isPlaying: boolean;
  isSoundCloudTrack: boolean;
  isVideoTrack: boolean;
  scCommentsEnabled: boolean;
  scWaveformBars: number[] | null;
  trackPropsState: {
    suppress_lyrics?: boolean;
    suppress_comments?: boolean;
    suppress_factoids?: boolean;
    preferred_viz_mode?: string | null;
  };
  lyricsKaraokeEnabled: boolean;
  idleOpacityPct: number;
  lyricsData: TrackLyricsResponse | null;
  activeLyricIdx: number;
  activeBubbles: ActiveCommentBubble[];
  playerScale: number;
  scrubRowRef: React.RefObject<HTMLDivElement | null>;
  buttonsRowRef: React.RefObject<HTMLDivElement | null>;
  scrubOffsetLeftPx: number | null;
  buttonsOffsetLeftPx: number | null;
  buttonsFitScale: number | null;
  videoTheatreExpanded: boolean;
  commentTimestampsMs: number[];
  handlePlayheadTick: (currentMs: number) => void;
  isForegroundFaded: boolean;
  effectiveScale: number;
  buttonsBottomPx: number;
  scrubBottomPx: number;
  playerTheme: ImpSourceTheme;
}

export const PlayerTransportBar: React.FC<PlayerTransportBarProps> = ({
  hidden,
  snap,
  track,
  isPlaying,
  isSoundCloudTrack,
  isVideoTrack,
  scCommentsEnabled,
  scWaveformBars,
  trackPropsState,
  lyricsKaraokeEnabled,
  idleOpacityPct,
  lyricsData,
  activeLyricIdx,
  activeBubbles,
  playerScale,
  scrubRowRef,
  buttonsRowRef,
  scrubOffsetLeftPx,
  buttonsOffsetLeftPx,
  buttonsFitScale,
  videoTheatreExpanded,
  commentTimestampsMs,
  handlePlayheadTick,
  isForegroundFaded,
  effectiveScale,
  buttonsBottomPx,
  scrubBottomPx,
  playerTheme,
}) => {
  return (
    <>
    {/* Adaptive 7-Button Player Control Array — Anchored Above Lyrics Zone (Steps to Match Scrub Bar Center on Art Collision) */}
    <div
      ref={buttonsRowRef}
      style={{
        position: 'absolute',
        bottom: buttonsBottomPx,
        left: buttonsOffsetLeftPx !== null ? buttonsOffsetLeftPx : 48,
        right: 48,
        zIndex: 2,
        display: isVideoTrack && videoTheatreExpanded ? 'none' : 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        opacity: isForegroundFaded ? Math.max(0, Math.min(0.95, idleOpacityPct / 100)) : 1,
        transition: isForegroundFaded ? 'opacity 480ms ease' : 'opacity 60ms ease-out',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          pointerEvents: 'auto',
          transform:
            buttonsFitScale !== null
              ? `scale(${buttonsFitScale})`
              : effectiveScale > 1.02
              ? `scale(${effectiveScale})`
              : undefined,
          transformOrigin: 'bottom center',
        }}
      >
        <TransportIconButton
          icon="🔀"
          badge="X"
          title={snap?.shuffle ? 'Shuffle: On' : 'Shuffle: Off'}
          active={!!snap?.shuffle}
          onClick={() => defaultSimpClient.setShuffle(!snap?.shuffle)}
        />
        <TransportIconButton
          icon="⏪"
          badge="L2"
          onClick={() => defaultSimpClient.seekRelative(-10_000)}
        />
        <TransportIconButton
          icon="⏮"
          badge="◄"
          onClick={() => defaultSimpClient.previous()}
        />
        <button
          data-default-focus="true"
          onClick={() => defaultSimpClient.togglePlayPause()}
          title={isPlaying ? 'Pause (Silence Audio)' : 'Resume Playback'}
          style={{
            width: 92,
            height: 86,
            borderRadius: 22,
            background: isPlaying ? playerTheme.accentMuted : '#12121a',
            color: isPlaying ? '#f8fafc' : '#d4d4dc',
            border: isPlaying ? `2px solid ${playerTheme.accent}` : '2px solid #3f3f4e',
            boxShadow: isPlaying
              ? `0 12px 32px rgba(0, 0, 0, 0.94), 0 0 22px ${playerTheme.accentGlow}, 0 0 0 1px rgba(0, 0, 0, 0.85)`
              : '0 12px 32px rgba(0, 0, 0, 0.94), 0 3px 10px rgba(0, 0, 0, 0.96), 0 0 0 1px rgba(0, 0, 0, 0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            cursor: 'pointer',
            fontWeight: 900,
          }}
        >
          <span style={{ fontSize: 28, color: isPlaying ? playerTheme.accent : '#d4d4dc' }}>
            {isPlaying ? '⏸' : '▶'}
          </span>
          <span
            className="simp-gp-badge"
            style={{
              padding: '2px 10px',
              borderRadius: 99,
              background: isPlaying ? 'rgba(0, 0, 0, 0.45)' : '#1f1f2b',
              color: isPlaying ? playerTheme.accent : '#a1a1aa',
              fontSize: 11,
              fontFamily: 'monospace',
            }}
          >
            {isPlaying ? 'A • 🔊' : 'A • 🔇'}
          </span>
        </button>
        <TransportIconButton
          icon="⏭"
          badge="►"
          onClick={() => defaultSimpClient.next()}
        />
        <TransportIconButton
          icon="⏩"
          badge="R2"
          onClick={() => defaultSimpClient.seekRelative(10_000)}
        />
        <TransportIconButton
          icon="🔁"
          badge={
            snap?.repeat_mode === 'track'
              ? 'Y•1'
              : snap?.repeat_mode === 'queue'
              ? 'Y•Q'
              : 'Y'
          }
          overlayBadge={
            snap?.repeat_mode === 'track'
              ? '1'
              : snap?.repeat_mode === 'queue'
              ? '∞'
              : null
          }
          title={
            snap?.repeat_mode === 'track'
              ? 'Repeat Mode: Single Track (1)'
              : snap?.repeat_mode === 'queue'
              ? 'Repeat Mode: Loop Queue (∞)'
              : 'Repeat Mode: Off'
          }
          active={snap?.repeat_mode !== 'off'}
          onClick={() => defaultSimpClient.cycleRepeat()}
        />
      </div>
    </div>

    {/* Adaptive Scrub Bar + Timed SoundCloud Comments — Anchored Above 7-Button Control Array */}
    <div
      style={{
        position: 'absolute',
        bottom: scrubBottomPx - Math.round(80 * effectiveScale),
        left: scrubOffsetLeftPx !== null ? scrubOffsetLeftPx : 48,
        right: 48,
        zIndex: 8,
        display:
          isVideoTrack && videoTheatreExpanded
            ? 'none'
            : scrubOffsetLeftPx !== null
            ? 'block'
            : 'flex',
        justifyContent: scrubOffsetLeftPx !== null ? undefined : 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'relative',
          width:
            scrubOffsetLeftPx !== null
              ? effectiveScale > 1.02
                ? `${100 / effectiveScale}%`
                : '100%'
              : 'min(740px, 100%)',
          paddingTop: 72,
          paddingBottom: 80,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          transform: effectiveScale > 1.02 ? `scale(${effectiveScale})` : undefined,
          transformOrigin: scrubOffsetLeftPx !== null ? 'bottom left' : 'bottom center',
        }}
      >
        <div
          ref={scrubRowRef}
          style={{
            position: 'relative',
            pointerEvents: 'auto',
            opacity: isForegroundFaded ? Math.max(0, Math.min(0.95, idleOpacityPct / 100)) : 1,
            transition: isForegroundFaded ? 'opacity 480ms ease' : 'opacity 60ms ease-out',
          }}
        >
          <ProgressBarRaf
            durationMs={track?.duration_ms ?? 0}
            trackUri={track?.uri}
            waveformBars={!isVideoTrack ? scWaveformBars : null}
            commentTimestampsMs={
              isSoundCloudTrack && scCommentsEnabled ? commentTimestampsMs : undefined
            }
            onPlayheadTick={handlePlayheadTick}
            hidden={hidden || (isVideoTrack && videoTheatreExpanded)}
          />
        </div>

        {/* Ephemeral SoundCloud Timed Comment Speech Bubbles (100% inside the 237px padded layout box so GPU opacity layers never clip) */}
        {isSoundCloudTrack &&
          scCommentsEnabled &&
          activeBubbles.map((b) => {
            const dur = track?.duration_ms || 0;
            const pct =
              dur > 0 && Number.isFinite(b.comment.timestamp_ms)
                ? Math.max(0, Math.min(46, (b.comment.timestamp_ms / dur) * 100))
                : 0;
            const isBelow = b.placement === 'below';
            return (
              <div
                key={b.comment.id}
                style={{
                  position: 'absolute',
                  ...(isBelow
                    ? { top: 134 }
                    : { bottom: 'calc(100% - 86px)' }),
                  left: 14,
                  right: 14,
                  display: 'flex',
                  justifyContent: 'flex-start',
                  pointerEvents: 'none',
                  zIndex: 25,
                }}
              >
                <div
                  style={{
                    marginLeft: `${pct}%`,
                    maxWidth: '78%',
                    minWidth: 240,
                    padding: '8px 14px',
                    borderRadius: 15,
                    ...(isBelow
                      ? { borderTopLeftRadius: 4 }
                      : { borderBottomLeftRadius: 4 }),
                    background: 'rgba(14, 12, 20, 0.96)',
                    border: '1px solid rgba(251, 146, 60, 0.6)',
                    boxShadow: '0 10px 26px rgba(0, 0, 0, 0.88)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    opacity: isForegroundFaded
                      ? Math.max(0, Math.min(0.95, idleOpacityPct / 100))
                      : 1,
                    transition: isForegroundFaded
                      ? 'opacity 480ms ease'
                      : 'opacity 60ms ease-out',
                  }}
                >
                  {b.comment.avatar_url ? (
                    <img
                      src={b.comment.avatar_url}
                      alt=""
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 99,
                        objectFit: 'cover',
                        border: '1px solid #ea580c',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 99,
                        background: '#27150c',
                        border: '1px solid #ea580c',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 15,
                        flexShrink: 0,
                      }}
                    >
                      💬
                    </div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12.5,
                        fontFamily: 'monospace',
                        color: '#fdba74',
                        fontWeight: 800,
                      }}
                    >
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        @{b.comment.username}
                      </span>
                      <span
                        style={{
                          padding: '2px 7px',
                          borderRadius: 6,
                          background: '#27150c',
                          border: '1px solid #7c2d12',
                          color: '#fb923c',
                          fontSize: 11.5,
                          flexShrink: 0,
                        }}
                      >
                        {formatCommentTs(b.comment.timestamp_ms)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 14.5,
                        color: '#f4f4f6',
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      “{b.comment.body.slice(0, 120)}”
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>

    {/* Bottom-Edge Synced Lyrics Pill — Anchored near bottom screen edge & centered to the page */}
    {!isVideoTrack && (() => {
      const showLyricsBubble = Boolean(
        lyricsKaraokeEnabled &&
          !trackPropsState.suppress_lyrics &&
          lyricsData &&
          (lyricsData.synced_lines.length > 0 || lyricsData.instrumental)
      );
      if (!showLyricsBubble || !lyricsData) return null;
      return (
        <div
          style={{
            position: 'absolute',
            bottom: 18,
            left: 48,
            right: 48,
            zIndex: 3,
            pointerEvents: 'none',
            display: 'flex',
            justifyContent: 'center',
            opacity: isForegroundFaded ? Math.max(0, Math.min(0.95, idleOpacityPct / 100)) : 1,
            transition: isForegroundFaded ? 'opacity 480ms ease' : 'opacity 60ms ease-out',
          }}
        >
          <div
            style={{
              width: 'fit-content',
              maxWidth: '100%',
              padding: '6px 18px',
              borderRadius: 12,
              background: 'rgba(8, 9, 14, 0.82)',
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.88)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              textAlign: 'center',
              boxSizing: 'border-box',
              pointerEvents: 'auto',
              transition: 'opacity 200ms ease',
              transform:
                !videoTheatreExpanded && playerScale > 1.02 ? `scale(${playerScale})` : undefined,
              transformOrigin: 'bottom center',
            }}
          >
            {lyricsData.instrumental ? (
              <div
                style={{
                  fontSize: 13,
                  fontFamily: 'monospace',
                  color: '#67e8f9',
                  fontWeight: 700,
                  textShadow: '0 1px 4px rgba(0, 0, 0, 0.98)',
                }}
              >
                🎵 Instrumental Track
              </div>
            ) : (
              <>
                {activeLyricIdx >= 0 && lyricsData.synced_lines[activeLyricIdx] ? (
                  <div
                    onClick={() => {
                      const line = lyricsData.synced_lines[activeLyricIdx];
                      if (line) defaultSimpClient.seek(line.timestamp_ms);
                    }}
                    title="Click to replay this lyric line"
                    style={{
                      maxWidth: '100%',
                      fontSize: 15,
                      fontWeight: 800,
                      color: '#67e8f9',
                      textShadow: '0 1px 6px rgba(0, 0, 0, 0.98)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                    }}
                  >
                    {lyricsData.synced_lines[activeLyricIdx].text}
                  </div>
                ) : (
                  <div
                    style={{
                      maxWidth: '100%',
                      fontSize: 13.5,
                      fontFamily: 'monospace',
                      color: '#9ca3af',
                      textShadow: '0 1px 4px rgba(0, 0, 0, 0.98)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {lyricsData.synced_lines[0]?.text || '♪ …'}
                  </div>
                )}
                {lyricsData.synced_lines[activeLyricIdx + 1] && (
                  <div
                    onClick={() => {
                      const nextLine = lyricsData.synced_lines[activeLyricIdx + 1];
                      if (nextLine) defaultSimpClient.seek(nextLine.timestamp_ms);
                    }}
                    title="Click to jump to next lyric line"
                    style={{
                      maxWidth: '100%',
                      fontSize: 12,
                      color: '#8e8e99',
                      textShadow: '0 1px 4px rgba(0, 0, 0, 0.98)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                    }}
                  >
                    {lyricsData.synced_lines[activeLyricIdx + 1].text}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      );
    })()}
    </>
  );
};

export interface TransportBtnProps {
  icon: string;
  badge: string;
  overlayBadge?: string | null;
  title?: string;
  active?: boolean;
  onClick: () => void;
}

export const TransportIconButton: React.FC<TransportBtnProps> = ({
  icon,
  badge,
  overlayBadge,
  title,
  active,
  onClick,
}) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      width: 72,
      height: 72,
      borderRadius: 18,
      background: active ? 'var(--imp-accent-muted, #0d1b22)' : '#0b0c12',
      border: active ? '2px solid var(--imp-accent, #2aa3c4)' : '2px solid #2a2c3c',
      boxShadow:
        '0 10px 26px rgba(0, 0, 0, 0.94), 0 3px 8px rgba(0, 0, 0, 0.96), 0 0 0 1px rgba(0, 0, 0, 0.85)',
      color: '#d4d4dc',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      cursor: 'pointer',
      position: 'relative',
    }}
  >
    <span style={{ fontSize: 24, position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {icon}
      {overlayBadge && (
        <span
          style={{
            position: 'absolute',
            right: -9,
            bottom: -4,
            minWidth: 17,
            height: 17,
            padding: '0 3px',
            borderRadius: 99,
            background: '#061820',
            border: '1.5px solid var(--imp-accent, #38bdf8)',
            color: 'var(--imp-accent, #7dd3fc)',
            fontSize: 10.5,
            fontFamily: 'monospace',
            fontWeight: 900,
            lineHeight: '14px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.92)',
          }}
        >
          {overlayBadge}
        </span>
      )}
    </span>
    <span
      className="simp-gp-badge"
      style={{
        padding: '2px 8px',
        borderRadius: 99,
        background: '#14141c',
        border: '1px solid #262632',
        fontSize: 12,
        fontFamily: 'monospace',
        color: active ? 'var(--imp-accent, #7dd3fc)' : '#8e8e99',
        fontWeight: 700,
      }}
    >
      {badge}
    </span>
  </button>
);
