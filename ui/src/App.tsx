import React, { useEffect, useState } from 'react';
import {
  AlbumRecord,
  defaultSimpClient,
  SimpStateSnapshot,
  TrackMetadata,
} from '@simp/client';
import { ProgressBarRaf } from './components/ProgressBarRaf';

export const App: React.FC = () => {
  const [snap, setSnap] = useState<SimpStateSnapshot | null>(null);
  const [view, setView] = useState<'lock' | 'browser'>('lock');
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [albumTracks, setAlbumTracks] = useState<TrackMetadata[]>([]);
  const [isDimmed, setIsDimmed] = useState(false);

  // 1. Connect to `simp --daemon` (`ws://127.0.0.1:18888/ws`)
  useEffect(() => {
    defaultSimpClient.connect();
    const unsub = defaultSimpClient.subscribeState((nextState) => {
      setSnap({ ...nextState });
    });
    return unsub;
  }, []);

  // 2. Load indexed albums when switching to the Library Browser
  useEffect(() => {
    if (view === 'browser') {
      defaultSimpClient
        .query<AlbumRecord[]>('get_albums', { limit: 100, offset: 0 })
        .then((res) => {
          setAlbums(res);
          if (res.length > 0 && !selectedAlbumId) {
            setSelectedAlbumId(res[0].id);
          }
        })
        .catch(() => {});
    }
  }, [view, snap?.mounts]);

  useEffect(() => {
    if (selectedAlbumId) {
      defaultSimpClient
        .query<TrackMetadata[]>('get_album_tracks', { album_id: selectedAlbumId })
        .then(setAlbumTracks)
        .catch(() => {});
    }
  }, [selectedAlbumId]);

  // 3. 30-second Battery Auto-Dim + Wake-Tap Guard (SPEC.md Section 13.6)
  useEffect(() => {
    let timerId: number | undefined;
    const resetIdleTimer = () => {
      setIsDimmed(false);
      if (timerId) window.clearTimeout(timerId);
      if (snap?.power.on_battery) {
        timerId = window.setTimeout(() => setIsDimmed(true), 30_000);
      }
    };

    resetIdleTimer();
    window.addEventListener('pointerdown', resetIdleTimer);
    window.addEventListener('keydown', resetIdleTimer);
    return () => {
      if (timerId) window.clearTimeout(timerId);
      window.removeEventListener('pointerdown', resetIdleTimer);
      window.removeEventListener('keydown', resetIdleTimer);
    };
  }, [snap?.power.on_battery]);

  // 4. HTML5 Gamepad API polling for Steam Deck / Steam Machine controllers
  useEffect(() => {
    let prevButtons: boolean[] = [];
    const poll = window.setInterval(() => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = pads[0];
      if (!pad) return;

      const pressed = (idx: number) => !!pad.buttons[idx]?.pressed && !prevButtons[idx];
      if (pressed(0)) defaultSimpClient.togglePlayPause(); // A
      if (pressed(1)) setSourceModalOpen(false); // B
      if (pressed(2)) defaultSimpClient.setShuffle(!snap?.shuffle); // X
      if (pressed(3)) defaultSimpClient.cycleRepeat(); // Y
      if (pressed(4)) setView('lock'); // L1
      if (pressed(5)) setView('browser'); // R1
      if (pressed(6)) defaultSimpClient.seekRelative(-10_000); // L2
      if (pressed(7)) defaultSimpClient.seekRelative(10_000); // R2
      if (pressed(8)) setSourceModalOpen((v) => !v); // Select
      if (pressed(14)) defaultSimpClient.previous(); // D-Left
      if (pressed(15)) defaultSimpClient.next(); // D-Right

      prevButtons = pad.buttons.map((b) => b.pressed);
    }, 50);

    return () => window.clearInterval(poll);
  }, [snap?.shuffle]);

  const track = snap?.current_track;
  const volPct = Math.round((snap?.volume ?? 0.8) * 100);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#000000',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        opacity: isDimmed ? 0.15 : 1,
        transition: 'opacity 300ms ease',
        position: 'relative',
      }}
    >
      {/* Wake-Tap Guard: intercepts the first tap when dimmed on battery so no button is misfired */}
      {isDimmed && (
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            setIsDimmed(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            cursor: 'pointer',
          }}
        />
      )}

      {/* Top Action Bar: Source Pop-Up Trigger | View Switcher (L1/R1) | Volume & Power */}
      <header
        style={{
          height: 58,
          padding: '0 22px',
          borderBottom: '1px solid #16161c',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#000000',
        }}
      >
        <button
          onClick={() => setSourceModalOpen(true)}
          style={{
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 12,
            background: '#0a0a0e',
            border: '1px solid #262630',
            color: '#f4f4f6',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 99,
              background: '#10b981',
            }}
          />
          <span>Source: {track?.source?.toUpperCase() || 'LOCAL / USB'}</span>
          <span style={{ color: '#71717a' }}>▾</span>
          <span
            style={{
              padding: '2px 6px',
              borderRadius: 6,
              background: '#18181f',
              border: '1px solid #2e2e38',
              fontSize: 11,
              fontFamily: 'monospace',
              color: '#a1a1aa',
            }}
          >
            Select
          </span>
        </button>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#0a0a0e',
            padding: 4,
            borderRadius: 12,
            border: '1px solid #1c1c24',
          }}
        >
          <span style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'monospace', color: '#71717a' }}>
            L1
          </span>
          <button
            onClick={() => setView('lock')}
            style={{
              minHeight: 36,
              padding: '0 16px',
              borderRadius: 8,
              border: 'none',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              background: view === 'lock' ? '#00e5ff' : 'transparent',
              color: view === 'lock' ? '#000000' : '#a1a1aa',
            }}
          >
            🎵 Player
          </button>
          <button
            onClick={() => setView('browser')}
            style={{
              minHeight: 36,
              padding: '0 16px',
              borderRadius: 8,
              border: 'none',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              background: view === 'browser' ? '#00e5ff' : 'transparent',
              color: view === 'browser' ? '#000000' : '#a1a1aa',
            }}
          >
            📚 Library & Queue
          </button>
          <span style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'monospace', color: '#71717a' }}>
            R1
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              minHeight: 44,
              padding: '0 12px',
              borderRadius: 12,
              background: '#0a0a0e',
              border: '1px solid #1c1c24',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          >
            <span>🔊 {volPct}%</span>
            {snap?.power.on_battery && <span>🔋 {snap.power.battery_pct ?? ''}%</span>}
          </div>
          <button
            onClick={() => setSourceModalOpen(true)}
            title="Power & Daemon Controls"
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#0a0a0e',
              border: '1px solid #262630',
              color: '#e4e4e7',
              fontSize: 16,
              cursor: 'pointer',
            }}
          >
            ⏻
          </button>
        </div>
      </header>

      {/* Main Viewport: Either Lock Screen (240x240 art + Upscaled Icon Buttons) or Split Browser */}
      {view === 'lock' ? (
        <main
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '320px 1fr',
            alignItems: 'center',
            gap: 40,
            padding: '0 48px',
          }}
        >
          {/* Compact 240x240 Album Art */}
          <div
            style={{
              width: 240,
              height: 240,
              borderRadius: 20,
              background: '#0d0d12',
              border: '1px solid #262630',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto',
              position: 'relative',
            }}
          >
            {track?.art_url ? (
              <img
                src={track.art_url}
                alt={track.album}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: -1 }}>SIMP</div>
                <div style={{ fontSize: 12, color: '#71717a', marginTop: 4 }}>
                  {track?.source?.toUpperCase() || 'READY'}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Track Info + rAF Scrub Bar + Upscaled Icon-Only Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, letterSpacing: -0.5 }}>
                {track?.title || 'No Track Loaded'}
              </h1>
              <p style={{ margin: '6px 0 0', fontSize: 18, color: '#a1a1aa' }}>
                {track?.artists?.join(', ') || 'Select a track from Library & Queue (R1)'}
                {track?.album ? ` • ${track.album}` : ''}
              </p>
            </div>

            <ProgressBarRaf durationMs={track?.duration_ms ?? 0} />

            {/* Upscaled Icon-Only Transport Row with Integrated (X, ◄, A, ►, Y) Badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <TransportIconButton
                icon="🔀"
                badge="X"
                active={!!snap?.shuffle}
                onClick={() => defaultSimpClient.setShuffle(!snap?.shuffle)}
              />
              <TransportIconButton
                icon="⏮"
                badge="◄"
                onClick={() => defaultSimpClient.previous()}
              />
              <button
                onClick={() => defaultSimpClient.togglePlayPause()}
                style={{
                  width: 96,
                  height: 92,
                  borderRadius: 24,
                  background: '#00e5ff',
                  color: '#000000',
                  border: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  fontWeight: 900,
                }}
              >
                <span style={{ fontSize: 30 }}>{snap?.is_playing ? '⏸' : '▶'}</span>
                <span
                  style={{
                    padding: '2px 10px',
                    borderRadius: 99,
                    background: 'rgba(0,0,0,0.18)',
                    fontSize: 12,
                    fontFamily: 'monospace',
                  }}
                >
                  A
                </span>
              </button>
              <TransportIconButton
                icon="⏭"
                badge="►"
                onClick={() => defaultSimpClient.next()}
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

            {/* Up Next Strip */}
            {snap?.up_next && snap.up_next.length > 0 && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: '#08080c',
                  border: '1px solid #181820',
                  fontSize: 12,
                  color: '#a1a1aa',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  <strong style={{ fontFamily: 'monospace', color: '#71717a', marginRight: 8 }}>
                    NEXT:
                  </strong>
                  {snap.up_next[0].title} — {snap.up_next[0].artists.join(', ')}
                </span>
                <span style={{ fontFamily: 'monospace', color: '#00e5ff' }}>
                  {snap.up_next[0].source.toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </main>
      ) : (
        /* Split Library & Queue Browser */
        <main style={{ flex: 1, display: 'grid', gridTemplateColumns: '38% 62%', overflow: 'hidden' }}>
          <div
            style={{
              borderRight: '1px solid #16161c',
              padding: 16,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#71717a' }}>
              STORAGE MOUNTS ({snap?.mounts.length ?? 0})
            </div>
            {snap?.mounts.map((m) => (
              <div
                key={m.mount_root}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: '#0a0a0e',
                  border: '1px solid #1e1e26',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  opacity: m.is_online ? 1 : 0.5,
                }}
              >
                <span>
                  {m.is_online ? '🟢' : '⚫'} {m.label}
                </span>
                <span style={{ fontFamily: 'monospace', color: '#00e5ff' }}>{m.track_count}</span>
              </div>
            ))}

            <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#71717a', marginTop: 8 }}>
              ALBUMS & SOUNDTRACKS ({albums.length})
            </div>
            {albums.map((alb) => (
              <button
                key={alb.id}
                onClick={() => setSelectedAlbumId(alb.id)}
                style={{
                  minHeight: 52,
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: selectedAlbumId === alb.id ? 'rgba(0,229,255,0.12)' : '#0a0a0e',
                  border:
                    selectedAlbumId === alb.id ? '1px solid #00e5ff' : '1px solid #181820',
                  color: '#ffffff',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{alb.title}</div>
                  <div style={{ fontSize: 12, color: '#8e8e99' }}>{alb.album_artist}</div>
                </div>
                <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#00e5ff' }}>
                  {alb.track_count}
                </span>
              </button>
            ))}
          </div>

          <div
            style={{
              padding: 20,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingBottom: 12,
                  borderBottom: '1px solid #16161c',
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 700 }}>Album Tracks</div>
                {selectedAlbumId && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => {
                        defaultSimpClient.playAlbum(selectedAlbumId, false);
                        setView('lock');
                      }}
                      style={{
                        minHeight: 48,
                        padding: '0 16px',
                        borderRadius: 12,
                        background: '#00e5ff',
                        color: '#000',
                        border: 'none',
                        fontWeight: 800,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      ▶ (A)
                    </button>
                    <button
                      onClick={() => {
                        defaultSimpClient.playAlbum(selectedAlbumId, true);
                        setView('lock');
                      }}
                      style={{
                        minHeight: 48,
                        padding: '0 16px',
                        borderRadius: 12,
                        background: '#14141c',
                        color: '#fff',
                        border: '1px solid #2e2e3a',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      🔀 (X)
                    </button>
                  </div>
                )}
              </div>

              {albumTracks.map((t, i) => (
                <div
                  key={t.uri}
                  onClick={() => {
                    defaultSimpClient.loadUri(t.uri);
                    setView('lock');
                  }}
                  style={{
                    minHeight: 50,
                    padding: '0 12px',
                    borderRadius: 12,
                    background: track?.uri === t.uri ? 'rgba(0,229,255,0.12)' : '#0a0a0e',
                    border: track?.uri === t.uri ? '1px solid #00e5ff' : '1px solid #16161e',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#71717a' }}>
                      {String(t.track_number ?? i + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{t.title}</div>
                      <div style={{ fontSize: 12, color: '#8e8e99' }}>{t.artists.join(', ')}</div>
                    </div>
                  </div>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#8e8e99' }}>
                    {Math.floor(t.duration_ms / 60000)}:
                    {String(Math.floor((t.duration_ms % 60000) / 1000)).padStart(2, '0')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {/* Source Selection & Authentication Pop-Up Modal */}
      {sourceModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: 520,
              background: '#0a0a0e',
              border: '2px solid #262632',
              borderRadius: 20,
              padding: 22,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 15 }}>Audio Sources, Mounts & Auth</strong>
              <button
                onClick={() => setSourceModalOpen(false)}
                style={{
                  minHeight: 44,
                  padding: '0 14px',
                  borderRadius: 10,
                  background: '#16161f',
                  border: '1px solid #2e2e3a',
                  color: '#fff',
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                }}
              >
                ✕ B
              </button>
            </div>

            <div
              onClick={() => {
                setView('browser');
                setSourceModalOpen(false);
              }}
              style={{
                minHeight: 54,
                padding: '10px 14px',
                borderRadius: 12,
                background: 'rgba(0,229,255,0.12)',
                border: '1px solid #00e5ff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  📁 Local, Steam OSTs & Removable USB/SD
                </div>
                <div style={{ fontSize: 12, color: '#a1a1aa' }}>
                  {snap?.mounts.length ?? 0} storage mounts indexed
                </div>
              </div>
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#00e5ff' }}>Browse</span>
            </div>

            <div
              style={{
                minHeight: 54,
                padding: '10px 14px',
                borderRadius: 12,
                background: '#121218',
                border: '1px solid #24242e',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>🟢 Spotify Premium</div>
                <div style={{ fontSize: 12, color: '#a1a1aa' }}>PKCE OAuth + Spotify Connect</div>
              </div>
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#10b981' }}>Phase 3</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <button
                onClick={() => {
                  defaultSimpClient.rescanStorage();
                  setSourceModalOpen(false);
                }}
                style={{
                  minHeight: 44,
                  padding: '0 16px',
                  borderRadius: 12,
                  background: '#16161f',
                  border: '1px solid #2e2e3a',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                🔄 Rescan Storage Drives
              </button>
              <button
                onClick={() => defaultSimpClient.shutdownDaemon()}
                style={{
                  minHeight: 44,
                  padding: '0 16px',
                  borderRadius: 12,
                  background: '#2a1215',
                  border: '1px solid #7f1d1d',
                  color: '#fca5a5',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ⏻ Stop Background Daemon
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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
      background: '#0a0a0e',
      border: active ? '2px solid #00e5ff' : '2px solid #22222c',
      color: '#ffffff',
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
      style={{
        padding: '2px 8px',
        borderRadius: 99,
        background: '#16161f',
        border: '1px solid #2e2e38',
        fontSize: 12,
        fontFamily: 'monospace',
        color: active ? '#00e5ff' : '#a1a1aa',
        fontWeight: 700,
      }}
    >
      {badge}
    </span>
  </button>
);

