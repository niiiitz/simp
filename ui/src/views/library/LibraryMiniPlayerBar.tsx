import React from 'react';
import {
  defaultSimpClient,
  SimpStateSnapshot,
  TrackMetadata,
} from '@simp/client';
import { ProgressBarRaf } from '../../components/ProgressBarRaf';

export interface LibraryMiniPlayerBarProps {
  track: TrackMetadata;
  snap: SimpStateSnapshot | null;
  hidden?: boolean;
  onReturnToPlayer: () => void;
}

export const LibraryMiniPlayerBar: React.FC<LibraryMiniPlayerBarProps> = ({
  track,
  snap,
  hidden = false,
  onReturnToPlayer,
}) => {
  return (
    <div
      data-mini-player-bar="true"
      style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        padding: '7px 14px',
        background: '#06070b',
        borderBottom: '1px solid #181a24',
        boxSizing: 'border-box',
        minWidth: 0,
      }}
    >
      {/* Left: Clickable 38x38 Artwork + Title / Artist / Album */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
          flex: '1 1 240px',
          maxWidth: '38%',
        }}
      >
        <button
          data-row-aux="true"
          onClick={onReturnToPlayer}
          title="Return to Player View"
          style={{
            padding: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            flexShrink: 0,
            display: 'flex',
          }}
        >
          {track.art_url ? (
            <img
              src={track.art_url}
              alt=""
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                objectFit: 'cover',
                border: '1px solid #2aa3c4',
              }}
            />
          ) : (
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                background: '#11141e',
                border: '1px solid #2aa3c4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
              }}
            >
              {track.source === 'apple_music'
                ? '🍎'
                : track.source === 'soundcloud'
                ? '☁️'
                : track.source === 'internet_archive' || track.source === 'ia_video'
                ? '🏛️'
                : '🎵'}
            </div>
          )}
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 800,
              color: '#f1f5f9',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ color: snap?.is_playing ? '#2aa3c4' : '#94a3b8' }}>
              {snap?.is_playing ? '▶' : '⏸'}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {track.title}
            </span>
          </div>
          <div
            style={{
              fontSize: 11,
              color: '#94a3b8',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {track.artists.join(', ')}
            {track.album ? ` • ${track.album}` : ''}
          </div>
        </div>
      </div>

      {/* Center: Compact Progress Scrubber */}
      <div style={{ flex: '1 1 320px', minWidth: 160, maxWidth: 460 }}>
        <ProgressBarRaf durationMs={track.duration_ms || 0} compact hidden={hidden} />
      </div>

      {/* Right: Transport Controls + Repeat Mode Overlay + Return to Player */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          data-row-aux="true"
          onClick={() => defaultSimpClient.previous()}
          title="Previous Track"
          style={{
            minHeight: 32,
            padding: '0 9px',
            borderRadius: 8,
            background: '#10121a',
            border: '1px solid #222634',
            color: '#d4d4dc',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          ⏮
        </button>
        <button
          data-row-aux="true"
          onClick={() => defaultSimpClient.togglePlayPause()}
          title={snap?.is_playing ? 'Pause' : 'Play'}
          style={{
            minHeight: 32,
            padding: '0 11px',
            borderRadius: 8,
            background: snap?.is_playing ? '#0f222a' : '#141622',
            border: snap?.is_playing ? '1px solid #2aa3c4' : '1px solid #2a2e3e',
            color: snap?.is_playing ? '#67e8f9' : '#f1f5f9',
            fontSize: 12,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          {snap?.is_playing ? '⏸' : '▶'}
        </button>
        <button
          data-row-aux="true"
          onClick={() => defaultSimpClient.next()}
          title="Next Track"
          style={{
            minHeight: 32,
            padding: '0 9px',
            borderRadius: 8,
            background: '#10121a',
            border: '1px solid #222634',
            color: '#d4d4dc',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          ⏭
        </button>
        <button
          data-row-aux="true"
          onClick={() => {
            const cur = snap?.repeat_mode || 'off';
            const next = cur === 'off' ? 'queue' : cur === 'queue' ? 'track' : 'off';
            defaultSimpClient.setRepeat(next);
          }}
          title={
            snap?.repeat_mode === 'track'
              ? 'Repeat: 1 Track'
              : snap?.repeat_mode === 'queue'
              ? 'Repeat: Queue (∞)'
              : 'Repeat: Off'
          }
          style={{
            position: 'relative',
            minHeight: 32,
            padding: '0 9px',
            borderRadius: 8,
            background:
              snap?.repeat_mode && snap.repeat_mode !== 'off' ? '#0f222a' : '#10121a',
            border:
              snap?.repeat_mode && snap.repeat_mode !== 'off'
                ? '1px solid #2aa3c4'
                : '1px solid #222634',
            color:
              snap?.repeat_mode && snap.repeat_mode !== 'off' ? '#67e8f9' : '#8e8e99',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          🔁
          {snap?.repeat_mode && snap.repeat_mode !== 'off' && (
            <span
              style={{
                position: 'absolute',
                right: 2,
                bottom: 1,
                minWidth: 12,
                height: 12,
                padding: '0 2px',
                borderRadius: 999,
                background: '#05161e',
                border: '1px solid #2aa3c4',
                color: '#67e8f9',
                fontSize: 8.5,
                fontFamily: 'monospace',
                fontWeight: 900,
                lineHeight: '10px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {snap.repeat_mode === 'track' ? '1' : '∞'}
            </span>
          )}
        </button>
        <button
          data-row-aux="true"
          onClick={onReturnToPlayer}
          title="Switch to Full Player View"
          style={{
            minHeight: 32,
            padding: '0 10px',
            borderRadius: 8,
            background: '#121822',
            border: '1px solid #2aa3c4',
            color: '#bfeaf5',
            fontSize: 11,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          ↗ Player
        </button>
      </div>
    </div>
  );
};
