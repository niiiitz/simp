import React from 'react';
import {
  defaultSimpClient,
  OpticalDiscStatus,
  SimpStateSnapshot,
  TrackMetadata,
} from '@simp/client';
import { ProgressBarRaf } from '../components/ProgressBarRaf';

export interface BrowserTarget {
  kind: 'album' | 'playlist' | 'mount' | 'cloud_playlist' | 'cloud_album' | 'cdda';
  id: string;
  title?: string;
  subtitle?: string;
  art_url?: string | null;
}

export interface PlayerViewProps {
  snap: SimpStateSnapshot | null;
  track: TrackMetadata | null | undefined;
  isPlaying: boolean;
  opticalDisc: OpticalDiscStatus | null;
  browserTarget: BrowserTarget | null;
  playingContextId: string;
  setBrowserTarget: React.Dispatch<React.SetStateAction<BrowserTarget | null>>;
  setView: React.Dispatch<React.SetStateAction<'lock' | 'browser'>>;
  handleOpenFullAppleAlbum: (params: {
    albumId?: string | null;
    songUri?: string | null;
    fallbackTitle?: string;
  }) => Promise<void>;
}

export const PlayerView: React.FC<PlayerViewProps> = ({
  snap,
  track,
  isPlaying,
  opticalDisc,
  browserTarget,
  playingContextId,
  setBrowserTarget,
  setView,
  handleOpenFullAppleAlbum,
}) => {
  return (
    <main
      style={{
        flex: 1,
        boxSizing: 'border-box',
        display: 'grid',
        gridTemplateColumns: '260px 1fr',
        alignItems: 'center',
        gap: 36,
        padding: '0 28px',
        maxWidth: 1180,
        width: '100%',
        margin: '0 auto',
        overflow: 'hidden',
      }}
    >
      {/* Left Column: Compact 240x240 Album Art + Shuffle (X) & Repeat (Y) Mode Controls Below */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 240,
            height: 240,
            borderRadius: 20,
            background: '#0a0a0e',
            border: '1px solid #1e1e28',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {track?.art_url ? (
            <img
              src={track.art_url}
              alt={track.album}
              style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.88)' }}
            />
          ) : (
            <img
              src="/simp-icon-dark.png"
              alt="SIMP"
              style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.82)' }}
            />
          )}

          {/* Top-Left 💿 Full Album Overlay Badge on Album Art */}
          {track &&
            (track.source === 'apple_music' ||
              track.source === 'cdda' ||
              track.album_id) && (
              <button
                onClick={() => {
                  if (track.source === 'apple_music') {
                    handleOpenFullAppleAlbum({
                      songUri: track.uri,
                      fallbackTitle: track.album || track.title,
                    });
                  } else if (track.source === 'cdda') {
                    setBrowserTarget({
                      kind: 'cdda',
                      id: opticalDisc?.disc_id || opticalDisc?.device_path || '/dev/sr0',
                      title: `💿 ${opticalDisc?.album_title || track.album || 'Audio CD'}`,
                      subtitle:
                        opticalDisc?.artist_name ||
                        track.artists?.join(', ') ||
                        'Audio CD',
                      art_url: opticalDisc?.art_url || track.art_url,
                    });
                    setView('browser');
                  } else if (track.album_id) {
                    setBrowserTarget({ kind: 'album', id: track.album_id });
                    setView('browser');
                  }
                }}
                title={`Open Full Album: ${track.album || track.title}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: 48,
                  height: 48,
                  borderTopLeftRadius: 19,
                  borderBottomRightRadius: 16,
                  borderTopRightRadius: 6,
                  borderBottomLeftRadius: 6,
                  background: 'rgba(10, 10, 16, 0.88)',
                  border: '1px solid rgba(255, 255, 255, 0.24)',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.7)',
                  color: '#f4f4f6',
                  fontSize: 23,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                💿
              </button>
            )}
        </div>

        {/* Queue Mode Controls: Shuffle (X) & Loop/Repeat (Y) directly under Album Art */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <TransportIconButton
            icon="🔀"
            badge="X"
            active={!!snap?.shuffle}
            onClick={() => defaultSimpClient.setShuffle(!snap?.shuffle)}
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
            active={snap?.repeat_mode !== 'off'}
            onClick={() => defaultSimpClient.cycleRepeat()}
          />
        </div>
      </div>

      {/* Right Column: Track Info + Tall Scrub Bar + Aligned Player Transport Row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 30,
              fontWeight: 800,
              letterSpacing: -0.5,
              color: '#d4d4dc',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {track?.title || 'No Track Loaded'}
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 16,
              color: '#8e8e99',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {track?.artists?.join(', ') || (
              <>
                Select a track from Library & Queue<span className="simp-gp-badge"> (R1)</span>
              </>
            )}
            {track?.album ? ` • ${track.album}` : ''}
          </p>
        </div>

        <ProgressBarRaf durationMs={track?.duration_ms ?? 0} />

        {/* Symmetrical Transport Row: Rewind (L2) | Prev (◄) | Play/Pause (A) | Next (►) | Fast-Forward (R2) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
              width: 96,
              height: 92,
              borderRadius: 24,
              background: isPlaying ? '#0f222a' : '#12121a',
              color: isPlaying ? '#bfeaf5' : '#d4d4dc',
              border: isPlaying ? '2px solid #2aa3c4' : '2px solid #3f3f4e',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
              fontWeight: 900,
            }}
          >
            <span style={{ fontSize: 30 }}>{isPlaying ? '⏸' : '▶'}</span>
            <span
              className="simp-gp-badge"
              style={{
                padding: '2px 10px',
                borderRadius: 99,
                background: isPlaying ? '#16313c' : '#1f1f2b',
                color: isPlaying ? '#7dd3fc' : '#a1a1aa',
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
        </div>

        {/* Interactive Up Next / Return to Active Playlist Strip */}
        {(snap?.up_next && snap.up_next.length > 0) || browserTarget ? (
          <button
            onClick={() => {
              if (playingContextId) {
                const sep = playingContextId.indexOf(':');
                if (sep > 0) {
                  const ctxKind = playingContextId.slice(0, sep);
                  const ctxId = playingContextId.slice(sep + 1);
                  if (
                    ctxKind === 'playlist' ||
                    ctxKind === 'album' ||
                    ctxKind === 'mount' ||
                    ctxKind === 'cdda'
                  ) {
                    setBrowserTarget({ kind: ctxKind, id: ctxId });
                  }
                }
              }
              setView('browser');
            }}
            title="Click to return to the active playlist / queue in Library & Queue"
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 12,
              background: '#08080c',
              border: '1px solid #1e2631',
              fontSize: 12,
              color: '#c8c8d2',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              minWidth: 0,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
                marginRight: 12,
              }}
            >
              {snap?.up_next && snap.up_next.length > 0 ? (
                <>
                  <strong style={{ fontFamily: 'monospace', color: '#2aa3c4', marginRight: 8 }}>
                    NEXT:
                  </strong>
                  {snap.up_next[0].title} — {snap.up_next[0].artists.join(', ')}
                </>
              ) : (
                <>
                  <strong style={{ fontFamily: 'monospace', color: '#2aa3c4', marginRight: 8 }}>
                    QUEUE:
                  </strong>
                  Return to active playlist / album tracks
                </>
              )}
            </span>
            <span
              style={{
                fontFamily: 'monospace',
                color: '#67e8f9',
                fontWeight: 700,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>📋 Queue / Playlist</span>
              <span>→</span>
            </span>
          </button>
        ) : null}
      </div>
    </main>
  );
};

interface TransportBtnProps {
  icon: string;
  badge: string;
  active?: boolean;
  onClick: () => void;
}

const TransportIconButton: React.FC<TransportBtnProps> = ({ icon, badge, active, onClick }) => (
  <button
    onClick={onClick}
    style={{
      width: 76,
      height: 76,
      borderRadius: 18,
      background: active ? '#0d1b22' : '#0a0a0e',
      border: active ? '2px solid #2aa3c4' : '2px solid #1e1e28',
      color: '#d4d4dc',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      cursor: 'pointer',
    }}
  >
    <span style={{ fontSize: 24 }}>{icon}</span>
    <span
      className="simp-gp-badge"
      style={{
        padding: '2px 8px',
        borderRadius: 99,
        background: '#14141c',
        border: '1px solid #262632',
        fontSize: 12,
        fontFamily: 'monospace',
        color: active ? '#7dd3fc' : '#8e8e99',
        fontWeight: 700,
      }}
    >
      {badge}
    </span>
  </button>
);

