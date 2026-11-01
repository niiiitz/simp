import type * as ReactTypes from 'react';
import {
  defaultSimpClient,
  AlbumRecord,
  PlaylistRecord,
  SimpStateSnapshot,
} from '@simp/client';

/**
 * SteamOS Gaming Mode (`SharedJSContext`) exposes its active React instance on `window.SP_REACT`.
 * Using `window.SP_REACT` directly avoids bundling a second copy of React with a null hook dispatcher.
 */
const SP_REACT: typeof ReactTypes = (window as any).SP_REACT || (globalThis as any).SP_REACT || (window as any).React;

/**
 * Gamepad-navigable Focusable component.
 * Uses Decky / Steam's native Focusable from `window.DFL` if available,
 * and falls back gracefully to a focusable HTML container with standard Steam `Focusable` class & handlers.
 */
const Focusable: ReactTypes.FC<any> = ({
  onActivate,
  onClick,
  className = '',
  children,
  style,
  flowChildren,
  ...rest
}) => {
  const DFLFocusable = (window as any).DFL?.Focusable;
  const handleClick = (e: any) => {
    if (onActivate) onActivate(e);
    if (onClick) onClick(e);
  };

  if (DFLFocusable) {
    return SP_REACT.createElement(
      DFLFocusable,
      {
        onActivate: handleClick,
        onClick: handleClick,
        className: `Focusable ${className}`.trim(),
        style,
        'flow-children': flowChildren,
        ...rest,
      },
      children
    );
  }

  return SP_REACT.createElement(
    'div',
    {
      role: 'button',
      tabIndex: 0,
      className: `Focusable ${className}`.trim(),
      onClick: handleClick,
      onKeyDown: (e: any) => {
        if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32) {
          e.preventDefault();
          handleClick(e);
        }
      },
      style,
      ...rest,
    },
    children
  );
};

/**
 * Pilot Phase 2: Lightweight Decky Loader QAM (`...` Menu) Drawer.
 * Connects directly to `simp --daemon` over `ws://127.0.0.1:18888/ws` with zero Python audio glue.
 */
const SimpDeckyDrawer: ReactTypes.FC = () => {
  const { useState, useEffect } = SP_REACT;
  const [snap, setSnap] = useState<SimpStateSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [drawerTab, setDrawerTab] = useState<'none' | 'albums' | 'playlists'>('none');
  const [preMuteVol, setPreMuteVol] = useState<number>(0.85);

  useEffect(() => {
    defaultSimpClient.connect();

    const refreshCatalogs = () => {
      defaultSimpClient
        .query<AlbumRecord[]>('get_albums', { limit: 40, offset: 0 })
        .then((res) => {
          setConnected(true);
          if (Array.isArray(res)) setAlbums(res);
        })
        .catch(() => {});
      defaultSimpClient
        .query<PlaylistRecord[]>('get_playlists')
        .then((res) => {
          setConnected(true);
          if (Array.isArray(res)) setPlaylists(res);
        })
        .catch(() => {});
    };

    const unsubState = defaultSimpClient.subscribeState((s) => {
      setSnap({ ...s });
      setConnected(true);
    });

    const timer = window.setTimeout(refreshCatalogs, 350);
    return () => {
      window.clearTimeout(timer);
      unsubState();
    };
  }, []);

  const toggleDrawerTab = (tab: 'albums' | 'playlists') => {
    const next = drawerTab === tab ? 'none' : tab;
    setDrawerTab(next);
    if (next === 'albums') {
      defaultSimpClient
        .query<AlbumRecord[]>('get_albums', { limit: 40, offset: 0 })
        .then((res) => Array.isArray(res) && setAlbums(res))
        .catch(() => {});
    } else if (next === 'playlists') {
      defaultSimpClient
        .query<PlaylistRecord[]>('get_playlists')
        .then((res) => Array.isArray(res) && setPlaylists(res))
        .catch(() => {});
    }
  };

  const track = snap?.current_track;
  const volumePct = Math.round((snap?.volume ?? 0.85) * 100);
  const repeatMode = snap?.repeat_mode ?? 'off';
  const repeatLabel = repeatMode === 'queue' ? 'All' : repeatMode === 'track' ? 'One' : 'Off';

  const toggleMute = () => {
    const cur = snap?.volume ?? 0.85;
    if (cur > 0.005) {
      setPreMuteVol(cur);
      defaultSimpClient.setVolume(0);
    } else {
      defaultSimpClient.setVolume(preMuteVol > 0.05 ? preMuteVol : 0.85);
    }
  };

  const btnStyle: ReactTypes.CSSProperties = {
    minHeight: 44,
    borderRadius: 10,
    border: '1px solid #262630',
    background: '#121216',
    color: '#d4d4dc',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    userSelect: 'none',
  };

  return (
    <div
      style={{
        padding: 10,
        color: '#d4d4dc',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <style>{`
        .Focusable:focus, .Focusable:focus-visible, .Focusable.gpfocus {
          outline: 2px solid #2aa3c4 !important;
          outline-offset: 1px !important;
          background: #18333e !important;
        }
      `}</style>

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
            {track?.art_url ? (
              <img
                src={track.art_url}
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
            {track?.album && (
              <div
                style={{
                  fontSize: 11,
                  color: '#2aa3c4',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {track.album}
              </div>
            )}
          </div>
        </div>

        {/* 5-Button Symmetrical Transport Row */}
        <Focusable flowChildren="horizontal" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          <Focusable
            onActivate={() => defaultSimpClient.seekRelative(-10_000)}
            onClick={() => defaultSimpClient.seekRelative(-10_000)}
            style={btnStyle}
            title="Rewind 10s"
          >
            ⏪
          </Focusable>
          <Focusable
            onActivate={() => defaultSimpClient.previous()}
            onClick={() => defaultSimpClient.previous()}
            style={btnStyle}
            title="Previous"
          >
            ⏮
          </Focusable>
          <Focusable
            onActivate={() => defaultSimpClient.togglePlayPause()}
            onClick={() => defaultSimpClient.togglePlayPause()}
            style={{
              ...btnStyle,
              background: '#0f222a',
              borderColor: '#2aa3c4',
              color: '#5bc0de',
              fontSize: 16,
            }}
            title="Play / Pause"
          >
            {snap?.is_playing ? '⏸' : '▶'}
          </Focusable>
          <Focusable
            onActivate={() => defaultSimpClient.next()}
            onClick={() => defaultSimpClient.next()}
            style={btnStyle}
            title="Next"
          >
            ⏭
          </Focusable>
          <Focusable
            onActivate={() => defaultSimpClient.seekRelative(10_000)}
            onClick={() => defaultSimpClient.seekRelative(10_000)}
            style={btnStyle}
            title="Fast-Forward 10s"
          >
            ⏩
          </Focusable>
        </Focusable>

        {/* Shuffle & Repeat Row */}
        <Focusable flowChildren="horizontal" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <Focusable
            onActivate={() => defaultSimpClient.setShuffle(!snap?.shuffle)}
            onClick={() => defaultSimpClient.setShuffle(!snap?.shuffle)}
            style={{
              ...btnStyle,
              minHeight: 38,
              fontSize: 12,
              borderColor: snap?.shuffle ? '#2aa3c4' : '#262630',
              color: snap?.shuffle ? '#5bc0de' : '#a1a1aa',
            }}
          >
            🔀 {snap?.shuffle ? 'Shuffle: ON' : 'Shuffle: OFF'}
          </Focusable>
          <Focusable
            onActivate={() => defaultSimpClient.cycleRepeat()}
            onClick={() => defaultSimpClient.cycleRepeat()}
            style={{
              ...btnStyle,
              minHeight: 38,
              fontSize: 12,
              borderColor: repeatMode !== 'off' ? '#2aa3c4' : '#262630',
              color: repeatMode !== 'off' ? '#5bc0de' : '#a1a1aa',
            }}
          >
            🔁 Repeat: {repeatLabel}
          </Focusable>
        </Focusable>

        {/* Volume Slider Row with Gamepad-Accessible Step Buttons */}
        <Focusable
          flowChildren="horizontal"
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
          <Focusable
            onActivate={toggleMute}
            onClick={toggleMute}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#d4d4dc',
              fontSize: 15,
              cursor: 'pointer',
              padding: '4px 6px',
              borderRadius: 6,
            }}
          >
            {volumePct === 0 ? '🔇' : volumePct < 45 ? '🔉' : '🔊'}
          </Focusable>

          <Focusable
            onActivate={() => defaultSimpClient.setVolume(Math.max(0, (snap?.volume ?? 0.85) - 0.05))}
            onClick={() => defaultSimpClient.setVolume(Math.max(0, (snap?.volume ?? 0.85) - 0.05))}
            style={{
              ...btnStyle,
              minHeight: 32,
              padding: '0 8px',
              fontSize: 12,
              background: '#181822',
            }}
            title="Volume -5%"
          >
            −5%
          </Focusable>

          <input
            type="range"
            min={0}
            max={100}
            value={volumePct}
            onChange={(e) => defaultSimpClient.setVolume(Number(e.target.value) / 100)}
            style={{ flex: 1, accentColor: '#2aa3c4', cursor: 'pointer' }}
          />

          <Focusable
            onActivate={() => defaultSimpClient.setVolume(Math.min(1, (snap?.volume ?? 0.85) + 0.05))}
            onClick={() => defaultSimpClient.setVolume(Math.min(1, (snap?.volume ?? 0.85) + 0.05))}
            style={{
              ...btnStyle,
              minHeight: 32,
              padding: '0 8px',
              fontSize: 12,
              background: '#181822',
            }}
            title="Volume +5%"
          >
            +5%
          </Focusable>

          <span style={{ fontSize: 12, fontWeight: 700, minWidth: 34, textAlign: 'right' }}>
            {volumePct}%
          </span>
        </Focusable>
      </div>

      {/* Quick Switcher Drawer Tabs */}
      <Focusable flowChildren="horizontal" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <Focusable
          onActivate={() => toggleDrawerTab('albums')}
          onClick={() => toggleDrawerTab('albums')}
          style={{
            ...btnStyle,
            minHeight: 38,
            fontSize: 12,
            borderColor: drawerTab === 'albums' ? '#2aa3c4' : '#262630',
            color: drawerTab === 'albums' ? '#5bc0de' : '#d4d4dc',
          }}
        >
          💿 Albums ({albums.length})
        </Focusable>
        <Focusable
          onActivate={() => toggleDrawerTab('playlists')}
          onClick={() => toggleDrawerTab('playlists')}
          style={{
            ...btnStyle,
            minHeight: 38,
            fontSize: 12,
            borderColor: drawerTab === 'playlists' ? '#2aa3c4' : '#262630',
            color: drawerTab === 'playlists' ? '#5bc0de' : '#d4d4dc',
          }}
        >
          Queue / Playlists ({playlists.length})
        </Focusable>
      </Focusable>

      {drawerTab === 'albums' && (
        <Focusable
          flowChildren="vertical"
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
            <Focusable
              key={alb.id}
              onActivate={() => defaultSimpClient.playAlbum(alb.id, false)}
              onClick={() => defaultSimpClient.playAlbum(alb.id, false)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '8px 10px',
                borderRadius: 8,
                background: '#121216',
                border: '1px solid #262630',
                color: '#d4d4dc',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700 }}>{alb.title}</span>
              <span style={{ fontSize: 11, color: '#a1a1aa' }}>
                {alb.album_artist} • {alb.track_count} tracks
              </span>
            </Focusable>
          ))}
        </Focusable>
      )}

      {drawerTab === 'playlists' && (
        <Focusable
          flowChildren="vertical"
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
              <Focusable
                key={pl.id}
                onActivate={() => defaultSimpClient.playPlaylist(pl.id, false)}
                onClick={() => defaultSimpClient.playPlaylist(pl.id, false)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: '#121216',
                  border: '1px solid #262630',
                  color: '#d4d4dc',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700 }}>{pl.name}</span>
                <span style={{ fontSize: 11, color: '#a1a1aa' }}>{pl.track_count} tracks</span>
              </Focusable>
            ))
          )}
        </Focusable>
      )}

      {/* Open Full SIMP Console Button */}
      <Focusable
        onActivate={() => window.open('http://127.0.0.1:18888', '_blank')}
        onClick={() => window.open('http://127.0.0.1:18888', '_blank')}
        style={{
          ...btnStyle,
          minHeight: 40,
          fontSize: 12,
          color: '#a1a1aa',
        }}
      >
        ↗ Open Full SIMP Console (:18888)
      </Focusable>
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

