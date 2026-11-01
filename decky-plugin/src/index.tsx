import type * as ReactTypes from 'react';
import {
  defaultSimpClient,
  AlbumRecord,
  AppleMusicAuthConfig,
  PlaylistRecord,
  SimpStateSnapshot,
} from '@simp/client';
import { encodeQrMatrix } from '../../ui/src/components/qrMatrix';

/**
 * SteamOS Gaming Mode (`SharedJSContext`) exposes its active React instance on `window.SP_REACT`.
 * Using `window.SP_REACT` directly avoids bundling a second copy of React with a null hook dispatcher.
 */
const SP_REACT: typeof ReactTypes = (window as any).SP_REACT || (globalThis as any).SP_REACT || (window as any).React;

let cachedSteamFocusable: any = null;

/**
 * Discovers Valve's native `Focusable` React component inside `window.webpackChunksteamui`
 * using the exact prop-signature matcher from `@decky/ui` (`flow-children`, `onActivate`, `onCancel`,
 * `focusClassName`, `focusWithinClassName`).
 */
function resolveSteamFocusable(): any {
  if (cachedSteamFocusable) return cachedSteamFocusable;
  if ((window as any).DFL?.Focusable) {
    cachedSteamFocusable = (window as any).DFL.Focusable;
    return cachedSteamFocusable;
  }

  try {
    const chunk = (window as any).webpackChunksteamui;
    if (!Array.isArray(chunk)) return null;

    let webpackRequire: any;
    chunk.push([
      [Symbol('simp-decky-focusable')],
      {},
      (r: any) => {
        webpackRequire = r;
      },
    ]);
    if (!webpackRequire || !webpackRequire.m) return null;

    const requiredProps = [
      'flow-children',
      'onActivate',
      'onCancel',
      'focusClassName',
      'focusWithinClassName',
    ];
    const matchesFocusable = (fn: any): boolean => {
      const str =
        (typeof fn === 'function' && fn.toString?.()) ||
        (fn?.render && typeof fn.render === 'function' && fn.render.toString?.()) ||
        '';
      if (!str) return false;
      return requiredProps.every((p) => str.includes(p));
    };

    for (const id of Object.keys(webpackRequire.m)) {
      let mod: any;
      try {
        mod = webpackRequire(id);
      } catch {
        continue;
      }
      if (!mod) continue;
      for (const candidate of [mod.default, mod]) {
        if (!candidate || candidate === window) continue;
        if (matchesFocusable(candidate)) {
          cachedSteamFocusable = candidate;
          return cachedSteamFocusable;
        }
        if (typeof candidate === 'object') {
          for (const key of Object.keys(candidate)) {
            try {
              const exp = candidate[key];
              if (exp && matchesFocusable(exp)) {
                cachedSteamFocusable = exp;
                return cachedSteamFocusable;
              }
            } catch {
              // Ignore getter errors
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[SIMP Decky] Failed to resolve Focusable from webpackChunksteamui:', err);
  }
  return null;
}

/**
 * Gamepad-navigable Focusable component.
 * Uses Valve's native Focusable from `window.webpackChunksteamui` (`@decky/ui` method),
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
  const SteamFocusable = resolveSteamFocusable();
  const handleClick = (e: any) => {
    if (onActivate) onActivate(e);
    if (onClick) onClick(e);
  };

  if (SteamFocusable) {
    return SP_REACT.createElement(
      SteamFocusable,
      {
        onActivate: handleClick,
        onClick: handleClick,
        className: `Focusable ${className}`.trim(),
        focusClassName: 'gpfocus',
        focusWithinClassName: 'gpfocuswithin',
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

const DeckyQrSvg: ReactTypes.FC<{ value: string; size?: number }> = ({
  value,
  size = 92,
}) => {
  const matrix = encodeQrMatrix(value);
  const n = matrix.length;
  const quiet = 2;
  const viewBoxSize = n + quiet * 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      shapeRendering="crispEdges"
      style={{
        borderRadius: 10,
        background: '#ffffff',
        padding: 4,
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    >
      <rect width={viewBoxSize} height={viewBoxSize} fill="#ffffff" />
      {matrix.map((row, r) =>
        row.map((cell, c) =>
          cell ? (
            <rect
              key={`${r}-${c}`}
              x={c + quiet}
              y={r + quiet}
              width={1}
              height={1}
              fill="#07070c"
            />
          ) : null
        )
      )}
    </svg>
  );
};

/**
 * Pilot Phase 2: Lightweight Decky Loader QAM (`...` Menu) Drawer.
 * Connects directly to `simp --daemon` over `ws://127.0.0.1:18888/ws` with zero Python audio glue.
 */
const SimpDeckyDrawer: ReactTypes.FC<{ serverApi?: any }> = ({ serverApi }) => {
  const { useState, useEffect } = SP_REACT;
  const [snap, setSnap] = useState<SimpStateSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [authCfg, setAuthCfg] = useState<AppleMusicAuthConfig | null>(null);
  const [drawerTab, setDrawerTab] = useState<'none' | 'albums' | 'playlists' | 'pair'>('none');
  const [preMuteVol, setPreMuteVol] = useState<number>(0.85);

  const refreshCatalogs = () => {
    defaultSimpClient
      .query<AlbumRecord[]>('get_albums', { limit: 200, offset: 0 })
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
    defaultSimpClient
      .getAppleMusicAuthConfig()
      .then((cfg) => {
        setConnected(true);
        setAuthCfg(cfg);
      })
      .catch(() => {});
  };

  useEffect(() => {
    defaultSimpClient.connect();

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

  const handleReloadDaemon = async () => {
    setReloading(true);
    try {
      if (serverApi?.callPluginMethod) {
        await serverApi.callPluginMethod('restart_daemon', {});
      }
    } catch {
      // Fallback if Decky serverApi isn't exposed or already using v2
    }
    window.setTimeout(() => {
      defaultSimpClient.connect();
      refreshCatalogs();
      setReloading(false);
    }, 800);
  };

  const toggleDrawerTab = (tab: 'albums' | 'playlists' | 'pair') => {
    const next = drawerTab === tab ? 'none' : tab;
    setDrawerTab(next);
    if (next === 'albums') {
      defaultSimpClient
        .query<AlbumRecord[]>('get_albums', { limit: 200, offset: 0 })
        .then((res) => Array.isArray(res) && setAlbums(res))
        .catch(() => {});
    } else if (next === 'playlists') {
      defaultSimpClient
        .query<PlaylistRecord[]>('get_playlists')
        .then((res) => Array.isArray(res) && setPlaylists(res))
        .catch(() => {});
    } else if (next === 'pair') {
      defaultSimpClient
        .getAppleMusicAuthConfig()
        .then((cfg) => setAuthCfg(cfg))
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
      <Focusable
        flowChildren="horizontal"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}
      >
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
          Playlists ({playlists.length})
        </Focusable>
        <Focusable
          onActivate={() => toggleDrawerTab('pair')}
          onClick={() => toggleDrawerTab('pair')}
          style={{
            ...btnStyle,
            minHeight: 38,
            padding: '0 10px',
            fontSize: 12,
            borderColor:
              drawerTab === 'pair'
                ? '#f43f5e'
                : snap?.apple_authenticated
                ? '#10b981'
                : '#262630',
            color:
              drawerTab === 'pair'
                ? '#fda4af'
                : snap?.apple_authenticated
                ? '#6ee7b7'
                : '#d4d4dc',
          }}
          title="Apple Music QR Companion Pairing"
        >
          {snap?.apple_authenticated ? '🍎 Paired' : '📱 Pair QR'}
        </Focusable>
      </Focusable>

      {drawerTab === 'pair' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: 10,
            borderRadius: 10,
            background: '#000000',
            border: '1px solid #f43f5e',
          }}
        >
          <DeckyQrSvg
            value={authCfg?.pair_url || 'http://steamdeck.local:18888/pair'}
            size={92}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#fda4af' }}>
              {snap?.apple_authenticated ? '🟢 Apple Music Connected' : '📱 Scan with iPhone / PC'}
            </div>
            <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.35 }}>
              Sign in with Face ID, Passkey, or YubiKey on your phone/PC to sync Apple Music directly to your Deck.
            </div>
            <div
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                color: '#67e8f9',
                wordBreak: 'break-all',
              }}
            >
              {authCfg?.pair_url || 'http://steamdeck.local:18888/pair'}
            </div>
          </div>
        </div>
      )}

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

      {/* Open Full SIMP Console + Reload Row */}
      <Focusable flowChildren="horizontal" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
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
        <Focusable
          onActivate={handleReloadDaemon}
          onClick={handleReloadDaemon}
          style={{
            ...btnStyle,
            minHeight: 40,
            padding: '0 12px',
            fontSize: 12,
            color: reloading ? '#5bc0de' : '#a1a1aa',
            borderColor: reloading ? '#2aa3c4' : '#262630',
          }}
          title="Reload Daemon & Reconnect"
        >
          {reloading ? '⏳' : '🔄 Reload'}
        </Focusable>
      </Focusable>
    </div>
  );
};

/**
 * Standard Decky Loader plugin entrypoint (`api_version: 1`).
 */
export default function defineSimpDeckyPlugin(serverApi?: any) {
  return {
    title: <div style={{ fontWeight: 800 }}>SIMP Audio Player</div>,
    content: <SimpDeckyDrawer serverApi={serverApi} />,
    icon: <span>🎵</span>,
    onDismount() {
      // Daemon remains active in background; no teardown required
    },
  };
}

