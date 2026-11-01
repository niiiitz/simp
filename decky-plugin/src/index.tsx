import React, { useEffect, useState } from 'react';
import {
  defaultSimpClient,
  AlbumSummary,
  PlaylistSummary,
  RepeatMode,
  SimpStateSnapshot,
} from '@simp/client';

/**
 * Pilot Phase 2: Lightweight Decky Loader QAM (`...` Menu) Drawer.
 * Connects directly to `simp --daemon` over `ws://127.0.0.1:18888/ws` with zero Python audio glue.
 */
export const SimpDeckyDrawer: React.FC = () => {
  const [snap, setSnap] = useState<SimpStateSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [drawerTab, setDrawerTab] = useState<'none' | 'albums' | 'playlists'>('none');
  const [preMuteVol, setPreMuteVol] = useState<number>(0.85);

  useEffect(() => {
    defaultSimpClient.connect();
    const unsubConn = defaultSimpClient.subscribeConnection((isConn) => {
      setConnected(isConn);
      if (isConn) {
        defaultSimpClient.getAlbums(undefined, undefined, 40, 0).then(setAlbums).catch(() => {});
        defaultSimpClient.getPlaylists().then(setPlaylists).catch(() => {});
      }
    });
    const unsubState = defaultSimpClient.subscribeState((s) => setSnap({ ...s }));
    return () => {
      unsubConn();
      unsubState();
    };
  }, []);

  const track = snap?.current_track;
  const volumePct = Math.round((snap?.volume ?? 0.85) * 100);

  const cycleRepeat = () => {
    const nextMode: RepeatMode =
      snap?.repeat === 'Off' ? 'All' : snap?.repeat === 'All' ? 'One' : 'Off';
    defaultSimpClient.setRepeat(nextMode);
  };

  const toggleMute = () => {
    const cur = snap?.volume ?? 0.85;
    if (cur > 0.005) {
      setPreMuteVol(cur);
      defaultSimpClient.setVolume(0);
    } else {
      defaultSimpClient.setVolume(preMuteVol > 0.05 ? preMuteVol : 0.85);
    }
  };

  const seekRelative = (deltaMs: number) => {
    const pos = defaultSimpClient.getInterpolatedPositionMs();
    const dur = track?.duration_ms ?? 0;
    const target = Math.max(0, dur > 0 ? Math.min(dur, pos + deltaMs) : pos + deltaMs);
    defaultSimpClient.seek(Math.round(target));
  };

  const playAlbum = async (album: AlbumSummary) => {
    try {
      const tracks = await defaultSimpClient.getAlbumTracks(album.album_id);
      if (tracks.length > 0) {
        defaultSimpClient.loadQueue(
          tracks.map((t) => t.uri),
          0,
          true
        );
      }
    } catch {
      // ignore
    }
  };

  const playPlaylist = async (pl: PlaylistSummary) => {
    try {
      const tracks = await defaultSimpClient.getPlaylistItems(pl.playlist_id, 500, 0);
      if (tracks.length > 0) {
        defaultSimpClient.loadQueue(
          tracks.map((t) => t.uri),
          0,
          true
        );
      }
    } catch {
      // ignore
    }
  };

  const btnStyle: React.CSSProperties = {
    minHeight: 44,
    borderRadius: 10,
    border: '1px solid #262630',
    background: '#121216',
    color: '#ffffff',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div
      style={{
        padding: 10,
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Now Playing Card */}
      <div
        style={{
          padding: 12,
          borderRadius: 12,
          background: '#000000',
          border: '1px solid #262630',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 8,
              background: '#121216',
              border: '1px solid #262630',
              overflow: 'hidden',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {track?.artwork_url ? (
              <img
                src={`http://127.0.0.1:18888${track.artwork_url}`}
                alt="Art"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: 22 }}>🎵</span>
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {track?.title || 'SIMP Ready'}
            </div>
            <div
              style={{
                fontSize: 12,
                color: '#a1a1aa',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {track?.artists?.join(', ') || (connected ? 'Daemon Online (:18888)' : 'Connecting...')}
            </div>
            {track?.album_title && (
              <div
                style={{
                  fontSize: 11,
                  color: '#3b82f6',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {track.album_title}
              </div>
            )}
          </div>
        </div>

        {/* 5-Button Symmetrical Transport Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          <button onClick={() => seekRelative(-10_000)} style={btnStyle} title="Rewind 10s">
            ⏪
          </button>
          <button onClick={() => defaultSimpClient.previous()} style={btnStyle} title="Previous">
            ⏮
          </button>
          <button
            onClick={() => defaultSimpClient.togglePlayPause()}
            style={{
              ...btnStyle,
              background: '#3b82f6',
              borderColor: '#60a5fa',
              fontSize: 16,
            }}
            title="Play / Pause"
          >
            {snap?.is_playing ? '⏸' : '▶'}
          </button>
          <button onClick={() => defaultSimpClient.next()} style={btnStyle} title="Next">
            ⏭
          </button>
          <button onClick={() => seekRelative(10_000)} style={btnStyle} title="Fast-Forward 10s">
            ⏩
          </button>
        </div>

        {/* Shuffle & Repeat Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button
            onClick={() => defaultSimpClient.setShuffle(!snap?.shuffle)}
            style={{
              ...btnStyle,
              minHeight: 38,
              fontSize: 12,
              borderColor: snap?.shuffle ? '#3b82f6' : '#262630',
              color: snap?.shuffle ? '#60a5fa' : '#a1a1aa',
            }}
          >
            🔀 {snap?.shuffle ? 'Shuffle: ON' : 'Shuffle: OFF'}
          </button>
          <button
            onClick={cycleRepeat}
            style={{
              ...btnStyle,
              minHeight: 38,
              fontSize: 12,
              borderColor: snap?.repeat && snap.repeat !== 'Off' ? '#3b82f6' : '#262630',
              color: snap?.repeat && snap.repeat !== 'Off' ? '#60a5fa' : '#a1a1aa',
            }}
          >
            🔁 Repeat: {snap?.repeat ?? 'Off'}
          </button>
        </div>

        {/* Volume Slider Row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            borderRadius: 8,
            background: '#121216',
            border: '1px solid #262630',
          }}
        >
          <button
            onClick={toggleMute}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ffffff',
              fontSize: 15,
              cursor: 'pointer',
              padding: 2,
            }}
          >
            {volumePct === 0 ? '🔇' : volumePct < 45 ? '🔉' : '🔊'}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={volumePct}
            onChange={(e) => defaultSimpClient.setVolume(Number(e.target.value) / 100)}
            style={{ flex: 1, accentColor: '#3b82f6', cursor: 'pointer' }}
          />
          <span style={{ fontSize: 12, fontWeight: 700, minWidth: 34, textAlign: 'right' }}>
            {volumePct}%
          </span>
        </div>
      </div>

      {/* Quick Switcher Drawer Tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button
          onClick={() => setDrawerTab(drawerTab === 'albums' ? 'none' : 'albums')}
          style={{
            ...btnStyle,
            minHeight: 38,
            fontSize: 12,
            borderColor: drawerTab === 'albums' ? '#3b82f6' : '#262630',
          }}
        >
          💿 Albums ({albums.length})
        </button>
        <button
          onClick={() => setDrawerTab(drawerTab === 'playlists' ? 'none' : 'playlists')}
          style={{
            ...btnStyle,
            minHeight: 38,
            fontSize: 12,
            borderColor: drawerTab === 'playlists' ? '#3b82f6' : '#262630',
          }}
        >
          Queue / Playlists ({playlists.length})
        </button>
      </div>

      {drawerTab === 'albums' && (
        <div
          style={{
            maxHeight: 190,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 6,
            borderRadius: 10,
            background: '#000000',
            border: '1px solid #262630',
          }}
        >
          {albums.map((alb) => (
            <button
              key={alb.album_id}
              onClick={() => playAlbum(alb)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '8px 10px',
                borderRadius: 8,
                background: '#121216',
                border: '1px solid #262630',
                color: '#ffffff',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700 }}>{alb.title}</span>
              <span style={{ fontSize: 11, color: '#a1a1aa' }}>
                {alb.album_artist} • {alb.track_count} tracks
              </span>
            </button>
          ))}
        </div>
      )}

      {drawerTab === 'playlists' && (
        <div
          style={{
            maxHeight: 190,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 6,
            borderRadius: 10,
            background: '#000000',
            border: '1px solid #262630',
          }}
        >
          {playlists.length === 0 ? (
            <div style={{ fontSize: 12, color: '#a1a1aa', padding: 8 }}>
              No saved playlists yet. Create one in the Full Console.
            </div>
          ) : (
            playlists.map((pl) => (
              <button
                key={pl.playlist_id}
                onClick={() => playPlaylist(pl)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: '#121216',
                  border: '1px solid #262630',
                  color: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700 }}>{pl.name}</span>
                <span style={{ fontSize: 11, color: '#a1a1aa' }}>{pl.track_count} tracks</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Open Full SIMP Console Button */}
      <button
        onClick={() => window.open('http://127.0.0.1:18888', '_blank')}
        style={{
          ...btnStyle,
          minHeight: 40,
          fontSize: 12,
          color: '#a1a1aa',
        }}
      >
        ↗ Open Full SIMP Console (:18888)
      </button>
    </div>
  );
};

/**
 * Standard Decky Loader plugin entrypoint (`api_version: 1`).
 */
export default function defineSimpDeckyPlugin() {
  return {
    title: <div style={{ fontWeight: 800 }}>SIMP Audio Player</div>,
    content: <SimpDeckyDrawer />,
    icon: <span>🎵</span>,
    onDismount() {
      // Daemon remains active in background; no teardown required
    },
  };
}
