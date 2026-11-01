import React, { useCallback, useEffect, useState } from 'react';
import {
  AlbumRecord,
  AppleMusicAuthConfig,
  defaultSimpClient,
  PlaylistRecord,
  SimpStateSnapshot,
  TrackMetadata,
} from '@simp/client';
import { ProgressBarRaf } from './components/ProgressBarRaf';
import {
  AppleMusicDriver,
  authorizeAppleMusic,
  syncAppleMusicCatalog,
} from './drivers/AppleMusicDriver';

export const App: React.FC = () => {
  const [snap, setSnap] = useState<SimpStateSnapshot | null>(null);
  const [view, setView] = useState<'lock' | 'browser'>('lock');
  const [sourceModalOpen, setSourceModalOpen] = useState(false);

  // Library & Playlist Browser state
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [browserTarget, setBrowserTarget] = useState<{
    kind: 'album' | 'playlist';
    id: string;
  } | null>(null);
  const [browserTracks, setBrowserTracks] = useState<TrackMetadata[]>([]);

  // Playlist creation & target state
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [activePlaylistId, setActivePlaylistId] = useState<string>('');

  // Custom folder input inside Source Modal
  const [customFolderPath, setCustomFolderPath] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Apple Music Developer Key & Auth Modal state
  const [appleAuthCfg, setAppleAuthCfg] = useState<AppleMusicAuthConfig | null>(null);
  const [appleConfigOpen, setAppleConfigOpen] = useState(false);
  const [appleTeamId, setAppleTeamId] = useState('');
  const [appleKeyId, setAppleKeyId] = useState('');
  const [appleKeyPath, setAppleKeyPath] = useState('');
  const [appleManualUserToken, setAppleManualUserToken] = useState('');
  const [appleBusy, setAppleBusy] = useState(false);

  // Volume mute memory, OLED auto-dim, active luminance cap & sub-pixel orbit state
  const [preMuteVolume, setPreMuteVolume] = useState<number>(0.8);
  const [isDimmed, setIsDimmed] = useState(false);
  const [oledCap, setOledCap] = useState<'soft' | 'low' | 'night'>('soft');
  const [orbitStep, setOrbitStep] = useState(0);

  // 8-point ±2px circular sub-pixel orbit to prevent static OLED sub-pixel image retention
  const ORBIT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 1],
    [2, 0],
    [1, -1],
    [0, -2],
    [-1, -1],
    [-2, 0],
    [-1, 1],
  ];
  const [orbitX, orbitY] = ORBIT_OFFSETS[orbitStep % ORBIT_OFFSETS.length];
  const activeOpacity = oledCap === 'soft' ? 0.86 : oledCap === 'low' ? 0.68 : 0.48;

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  // 1. Connect to `simp --daemon` (`ws://127.0.0.1:18888/ws`)
  useEffect(() => {
    defaultSimpClient.connect();
    const unsub = defaultSimpClient.subscribeState((nextState) => {
      setSnap({ ...nextState });
    });
    return unsub;
  }, []);

  // 2. Refresh Albums & Playlists helper
  const refreshLibraryData = useCallback(() => {
    defaultSimpClient
      .query<AlbumRecord[]>('get_albums', { limit: 200, offset: 0 })
      .then((res) => {
        setAlbums(res);
        setBrowserTarget((prev) => {
          if (!prev && res.length > 0) {
            return { kind: 'album', id: res[0].id };
          }
          return prev;
        });
      })
      .catch(() => {});

    defaultSimpClient
      .query<PlaylistRecord[]>('get_playlists')
      .then((pls) => {
        setPlaylists(pls);
        if (pls.length > 0) {
          setActivePlaylistId((prev) => prev || pls[0].id);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (view === 'browser' || sourceModalOpen) {
      refreshLibraryData();
    }
    if (sourceModalOpen) {
      defaultSimpClient
        .getAppleMusicAuthConfig()
        .then((cfg) => {
          setAppleAuthCfg(cfg);
          setAppleTeamId((prev) => prev || cfg.team_id || '');
          setAppleKeyId((prev) => prev || cfg.key_id || '');
          setAppleKeyPath((prev) => prev || cfg.private_key_path || '');
        })
        .catch(() => {});
    }
  }, [view, sourceModalOpen, snap?.mounts, refreshLibraryData]);

  // 3. Load tracks for whichever Album or Playlist is selected in the Browser
  useEffect(() => {
    if (!browserTarget) {
      setBrowserTracks([]);
      return;
    }
    if (browserTarget.kind === 'album') {
      defaultSimpClient
        .query<TrackMetadata[]>('get_album_tracks', { album_id: browserTarget.id })
        .then(setBrowserTracks)
        .catch(() => {});
    } else {
      defaultSimpClient
        .query<TrackMetadata[]>('get_playlist_items', {
          playlist_id: browserTarget.id,
          limit: 500,
          offset: 0,
        })
        .then(setBrowserTracks)
        .catch(() => {});
    }
  }, [browserTarget]);

  // 4. Volume helpers (interactive slider, mute toggle, wheel, keyboard & gamepad D-Pad Up/Down)
  const currentVolume = snap?.volume ?? 0.8;
  const volPct = Math.round(currentVolume * 100);

  const applyVolume = useCallback((nextVol: number) => {
    const clamped = Math.max(0, Math.min(1, Math.round(nextVol * 100) / 100));
    if (clamped > 0) {
      setPreMuteVolume(clamped);
    }
    defaultSimpClient.setVolume(clamped);
  }, []);

  const toggleMute = useCallback(() => {
    if (currentVolume > 0.01) {
      setPreMuteVolume(currentVolume);
      defaultSimpClient.setVolume(0);
    } else {
      defaultSimpClient.setVolume(preMuteVolume > 0.05 ? preMuteVolume : 0.8);
    }
  }, [currentVolume, preMuteVolume]);

  // 5. Continuous OLED Sub-Pixel Shifter (rotates ±2px every 20s) + Universal 30s Idle Auto-Dim
  useEffect(() => {
    const orbitTimer = window.setInterval(() => {
      setOrbitStep((s) => (s + 1) % 8);
    }, 20_000);
    return () => window.clearInterval(orbitTimer);
  }, []);

  useEffect(() => {
    let timerId: number | undefined;
    const resetIdleTimer = () => {
      setIsDimmed(false);
      if (timerId) window.clearTimeout(timerId);
      timerId = window.setTimeout(() => setIsDimmed(true), 30_000);
    };

    resetIdleTimer();
    window.addEventListener('pointerdown', resetIdleTimer);
    window.addEventListener('pointermove', resetIdleTimer);
    window.addEventListener('wheel', resetIdleTimer, { passive: true });
    window.addEventListener('keydown', resetIdleTimer);
    return () => {
      if (timerId) window.clearTimeout(timerId);
      window.removeEventListener('pointerdown', resetIdleTimer);
      window.removeEventListener('pointermove', resetIdleTimer);
      window.removeEventListener('wheel', resetIdleTimer);
      window.removeEventListener('keydown', resetIdleTimer);
    };
  }, []);

  // 6. Keyboard shortcuts (ArrowUp/ArrowDown volume on Lock Screen, Space Play/Pause)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        applyVolume(currentVolume + 0.05);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        applyVolume(currentVolume - 0.05);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        defaultSimpClient.seekRelative(-10_000);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        defaultSimpClient.seekRelative(10_000);
      } else if (e.key === ' ') {
        e.preventDefault();
        defaultSimpClient.togglePlayPause();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyVolume, currentVolume]);

  // 7. HTML5 Gamepad API polling for Steam Deck / Steam Machine controllers
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
      if (pressed(6)) defaultSimpClient.seekRelative(-10_000); // L2 (Rewind 10s)
      if (pressed(7)) defaultSimpClient.seekRelative(10_000); // R2 (Fast-Forward 10s)
      if (pressed(8)) setSourceModalOpen((v) => !v); // Select
      if (pressed(12)) applyVolume(currentVolume + 0.05); // D-Up (+5% Volume)
      if (pressed(13)) applyVolume(currentVolume - 0.05); // D-Down (-5% Volume)
      if (pressed(14)) defaultSimpClient.previous(); // D-Left (Previous Track)
      if (pressed(15)) defaultSimpClient.next(); // D-Right (Next Track)

      prevButtons = pad.buttons.map((b) => b.pressed);
    }, 50);

    return () => window.clearInterval(poll);
  }, [snap?.shuffle, applyVolume, currentVolume]);

  // 8. Playlist & Custom Folder Handlers
  const handleCreatePlaylist = async () => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    try {
      const created = await defaultSimpClient.query<PlaylistRecord>('create_playlist', {
        name: trimmed,
        description: 'Created in SIMP',
      });
      setNewPlaylistName('');
      setCreatingPlaylist(false);
      setActivePlaylistId(created.id);
      refreshLibraryData();
      setBrowserTarget({ kind: 'playlist', id: created.id });
      showToast(`Created playlist "${created.name}"`);
    } catch {
      showToast('Failed to create playlist');
    }
  };

  const handleAddTracksToPlaylist = async (uris: string[], label: string) => {
    if (uris.length === 0) return;
    try {
      let targetPlId = activePlaylistId;
      let targetPlName = playlists.find((p) => p.id === targetPlId)?.name || 'Favorites';

      if (!targetPlId) {
        const created = await defaultSimpClient.query<PlaylistRecord>('create_playlist', {
          name: 'Favorites',
          description: 'Default SIMP playlist',
        });
        targetPlId = created.id;
        targetPlName = created.name;
        setActivePlaylistId(created.id);
      }

      await defaultSimpClient.query('add_tracks_to_playlist', {
        playlist_id: targetPlId,
        uris,
      });
      refreshLibraryData();
      if (browserTarget?.kind === 'playlist' && browserTarget.id === targetPlId) {
        const updated = await defaultSimpClient.query<TrackMetadata[]>('get_playlist_items', {
          playlist_id: targetPlId,
          limit: 500,
          offset: 0,
        });
        setBrowserTracks(updated);
      }
      showToast(`Added ${label} to "${targetPlName}"`);
    } catch {
      showToast('Could not add tracks to playlist');
    }
  };

  const handleAddFolder = (folderPath: string) => {
    const cleaned = folderPath.trim();
    if (!cleaned) return;
    defaultSimpClient.addLibraryPath(cleaned);
    setCustomFolderPath('');
    showToast(`Scanning folder: ${cleaned}`);
    window.setTimeout(() => refreshLibraryData(), 700);
  };

  const handleRemoveFolder = (mountRoot: string, label: string) => {
    defaultSimpClient.removeLibraryPath(mountRoot);
    showToast(`Removed mount: ${label}`);
    window.setTimeout(() => refreshLibraryData(), 350);
  };

  const track = snap?.current_track;
  const selectedAlbumObj =
    browserTarget?.kind === 'album' ? albums.find((a) => a.id === browserTarget.id) : null;
  const selectedPlaylistObj =
    browserTarget?.kind === 'playlist' ? playlists.find((p) => p.id === browserTarget.id) : null;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '100vw',
        height: '100%',
        maxHeight: '100vh',
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: '#000000',
        color: '#d4d4dc',
        display: 'flex',
        flexDirection: 'column',
        opacity: isDimmed ? 0.3 : activeOpacity,
        transform: `translate3d(${orbitX}px, ${orbitY}px, 0)`,
        transition: 'opacity 350ms ease, transform 4000ms linear',
        position: 'relative',
      }}
    >
      {/* Headless Apple Music Virtual Sink Bridge (MusicKit v3) */}
      <AppleMusicDriver />

      {/* Wake-Tap Guard: intercepts the first tap when dimmed so no button is misfired */}
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

      {/* Toast Notification Pill */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#0d0d14',
            border: '1px solid #2aa3c4',
            color: '#d4d4dc',
            padding: '10px 18px',
            borderRadius: 99,
            fontSize: 13,
            fontWeight: 700,
            zIndex: 90,
            boxShadow: '0 8px 24px rgba(0,0,0,0.75)',
          }}
        >
          ✨ {toastMsg}
        </div>
      )}

      {/* Top Action Bar: Source Pop-Up Trigger | View Switcher (L1/R1) | Interactive Volume & OLED Saver */}
      <header
        style={{
          height: 58,
          boxSizing: 'border-box',
          padding: '0 24px',
          borderBottom: '1px solid #16161c',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#000000',
          width: '100%',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setSourceModalOpen(true)}
          style={{
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 12,
            background: '#0a0a0e',
            border: '1px solid #22222c',
            color: '#d4d4dc',
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
              background: '#0d9488',
            }}
          />
          <span>Source: {track?.source?.toUpperCase() || 'LOCAL / USB'}</span>
          <span style={{ color: '#71717a' }}>▾</span>
          <span
            style={{
              padding: '2px 6px',
              borderRadius: 6,
              background: '#14141b',
              border: '1px solid #262630',
              fontSize: 11,
              fontFamily: 'monospace',
              color: '#9ca3af',
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
              border: view === 'lock' ? '1px solid #2aa3c4' : '1px solid transparent',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              background: view === 'lock' ? '#0f222a' : 'transparent',
              color: view === 'lock' ? '#bfeaf5' : '#8e8e99',
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
              border: view === 'browser' ? '1px solid #2aa3c4' : '1px solid transparent',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              background: view === 'browser' ? '#0f222a' : 'transparent',
              color: view === 'browser' ? '#bfeaf5' : '#8e8e99',
            }}
          >
            📚 Library & Queue
          </button>
          <span style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'monospace', color: '#71717a' }}>
            R1
          </span>
        </div>

        {/* Interactive Volume Slider + OLED Luminance Cap + Power Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.05 : -0.05;
              applyVolume(currentVolume + delta);
            }}
            title="Scroll wheel, drag slider, or use D-Pad Up/Down to adjust volume"
            style={{
              minHeight: 44,
              padding: '0 12px',
              borderRadius: 12,
              background: '#0a0a0e',
              border: '1px solid #1c1c24',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          >
            <button
              onClick={toggleMute}
              title={volPct === 0 ? 'Unmute' : 'Mute'}
              style={{
                background: 'transparent',
                border: 'none',
                color: volPct === 0 ? '#ef4444' : '#2aa3c4',
                fontSize: 16,
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
              }}
            >
              {volPct === 0 ? '🔇' : volPct < 45 ? '🔉' : '🔊'}
            </button>

            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={volPct}
              onChange={(e) => applyVolume(Number(e.target.value) / 100)}
              style={{
                width: 88,
                accentColor: '#2aa3c4',
                cursor: 'pointer',
              }}
            />

            <span style={{ minWidth: 34, textAlign: 'right', color: '#c8c8d2', fontWeight: 700 }}>
              {volPct}%
            </span>

            {snap?.power.on_battery && (
              <span style={{ color: '#0d9488', marginLeft: 4 }}>
                🔋 {snap.power.battery_pct ?? ''}%
              </span>
            )}
          </div>

          <button
            onClick={() =>
              setOledCap((prev) =>
                prev === 'soft' ? 'low' : prev === 'low' ? 'night' : 'soft'
              )
            }
            title="Cycle OLED anti-burn-in luminance cap (Soft 86% / Low 68% / Night 48%)"
            style={{
              height: 44,
              padding: '0 10px',
              borderRadius: 12,
              background: '#0a0a0e',
              border: '1px solid #22222c',
              color: '#9ca3af',
              fontSize: 11,
              fontFamily: 'monospace',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {oledCap === 'soft' ? '🔅86%' : oledCap === 'low' ? '🌙68%' : '🌑48%'}
          </button>

          <button
            onClick={() => setSourceModalOpen(true)}
            title="Power & Daemon Controls"
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#0a0a0e',
              border: '1px solid #22222c',
              color: '#c8c8d2',
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
                {track?.artists?.join(', ') || 'Select a track from Library & Queue (R1)'}
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
                onClick={() => defaultSimpClient.togglePlayPause()}
                style={{
                  width: 96,
                  height: 92,
                  borderRadius: 24,
                  background: '#0f222a',
                  color: '#bfeaf5',
                  border: '2px solid #2aa3c4',
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
                    background: '#16313c',
                    color: '#7dd3fc',
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
                icon="⏩"
                badge="R2"
                onClick={() => defaultSimpClient.seekRelative(10_000)}
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
                  color: '#8e8e99',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  minWidth: 0,
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
                  <strong style={{ fontFamily: 'monospace', color: '#71717a', marginRight: 8 }}>
                    NEXT:
                  </strong>
                  {snap.up_next[0].title} — {snap.up_next[0].artists.join(', ')}
                </span>
                <span style={{ fontFamily: 'monospace', color: '#2aa3c4', flexShrink: 0 }}>
                  {snap.up_next[0].source.toUpperCase()}
                </span>
              </div>
            )}
          </div>
        </main>
      ) : (
        /* Split Library, Playlists & Queue Browser */
        <main style={{ flex: 1, display: 'grid', gridTemplateColumns: '38% 62%', overflow: 'hidden', boxSizing: 'border-box', width: '100%' }}>
          {/* Left Column: Storage Mounts, Playlists & Albums */}
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
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#71717a' }}>
                STORAGE MOUNTS ({snap?.mounts.length ?? 0})
              </span>
              <button
                onClick={() => setSourceModalOpen(true)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: '#12121a',
                  border: '1px solid #262634',
                  color: '#2aa3c4',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Manage Sources
              </button>
            </div>
            {snap?.mounts.map((m) => (
              <div
                key={m.mount_root}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: '#0a0a0e',
                  border: '1px solid #1e1e26',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  opacity: m.is_online ? 1 : 0.65,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: 600,
                    }}
                  >
                    {m.is_online ? '🟢' : '⚫'} {m.label}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: 'monospace',
                      color: '#71717a',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={m.mount_root}
                  >
                    {m.mount_root}
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: 'monospace',
                    color: '#2aa3c4',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {m.track_count}
                </span>
              </div>
            ))}

            {/* Playlists Section */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 8,
              }}
            >
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#71717a' }}>
                PLAYLISTS ({playlists.length})
              </span>
              <button
                onClick={() => setCreatingPlaylist((v) => !v)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: '#12121a',
                  border: '1px solid #262634',
                  color: '#2aa3c4',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {creatingPlaylist ? 'Cancel' : '+ New Playlist'}
              </button>
            </div>

            {creatingPlaylist && (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  placeholder="Playlist name (e.g. Deck Mix)..."
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreatePlaylist();
                  }}
                  style={{
                    flex: 1,
                    minHeight: 40,
                    padding: '0 10px',
                    borderRadius: 10,
                    background: '#08080c',
                    border: '1px solid #2e2e3c',
                    color: '#d4d4dc',
                    fontSize: 12,
                  }}
                />
                <button
                  onClick={handleCreatePlaylist}
                  style={{
                    minHeight: 40,
                    padding: '0 14px',
                    borderRadius: 10,
                    background: '#0f222a',
                    color: '#bfeaf5',
                    border: '1px solid #2aa3c4',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
              </div>
            )}

            {playlists.map((pl) => {
              const isSelected =
                browserTarget?.kind === 'playlist' && browserTarget.id === pl.id;
              return (
                <button
                  key={pl.id}
                  onClick={() => {
                    setActivePlaylistId(pl.id);
                    setBrowserTarget({ kind: 'playlist', id: pl.id });
                  }}
                  style={{
                    minHeight: 48,
                    padding: '8px 12px',
                    borderRadius: 12,
                    background: isSelected ? '#0d1b22' : '#0a0a0e',
                    border: isSelected ? '1px solid #2aa3c4' : '1px solid #181820',
                    color: '#d4d4dc',
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>🎵 {pl.name}</div>
                    <div style={{ fontSize: 11, color: '#8e8e99' }}>Local SQLite Playlist</div>
                  </div>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#2aa3c4' }}>
                    {pl.track_count}
                  </span>
                </button>
              );
            })}

            {/* Albums & Soundtracks Section */}
            <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#71717a', marginTop: 8 }}>
              ALBUMS & SOUNDTRACKS ({albums.length})
            </div>
            {albums.map((alb) => {
              const isSelected =
                browserTarget?.kind === 'album' && browserTarget.id === alb.id;
              return (
                <button
                  key={alb.id}
                  onClick={() => setBrowserTarget({ kind: 'album', id: alb.id })}
                  style={{
                    minHeight: 52,
                    padding: '8px 12px',
                    borderRadius: 12,
                    background: isSelected ? '#0d1b22' : '#0a0a0e',
                    border: isSelected ? '1px solid #2aa3c4' : '1px solid #181820',
                    color: '#d4d4dc',
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
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#2aa3c4' }}>
                    {alb.track_count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right Column: Tracks for Selected Album or Playlist */}
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
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>
                    {selectedAlbumObj
                      ? selectedAlbumObj.title
                      : selectedPlaylistObj
                      ? `🎵 ${selectedPlaylistObj.name}`
                      : 'Tracks'}
                  </div>
                  <div style={{ fontSize: 12, color: '#8e8e99' }}>
                    {browserTracks.length} tracks
                  </div>
                </div>

                {browserTarget && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {browserTarget.kind === 'album' && (
                      <button
                        onClick={() =>
                          handleAddTracksToPlaylist(
                            browserTracks.map((t) => t.uri),
                            `all ${browserTracks.length} tracks`
                          )
                        }
                        style={{
                          minHeight: 44,
                          padding: '0 12px',
                          borderRadius: 12,
                          background: '#14141c',
                          color: '#2aa3c4',
                          border: '1px solid #2e2e3a',
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        + Add Album to Playlist
                      </button>
                    )}

                    <button
                      onClick={() => {
                        if (browserTarget.kind === 'album') {
                          defaultSimpClient.playAlbum(browserTarget.id, false);
                        } else {
                          defaultSimpClient.playPlaylist(browserTarget.id, false);
                        }
                        setView('lock');
                      }}
                      style={{
                        minHeight: 44,
                        padding: '0 16px',
                        borderRadius: 12,
                        background: '#0f222a',
                        color: '#bfeaf5',
                        border: '1px solid #2aa3c4',
                        fontWeight: 800,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      ▶ (A)
                    </button>
                    <button
                      onClick={() => {
                        if (browserTarget.kind === 'album') {
                          defaultSimpClient.playAlbum(browserTarget.id, true);
                        } else {
                          defaultSimpClient.playPlaylist(browserTarget.id, true);
                        }
                        setView('lock');
                      }}
                      style={{
                        minHeight: 44,
                        padding: '0 16px',
                        borderRadius: 12,
                        background: '#14141c',
                        color: '#d4d4dc',
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

              {browserTracks.map((t, i) => (
                <div
                  key={`${t.uri}-${i}`}
                  onClick={() => {
                    if (track?.uri === t.uri) {
                      // Already active: return to player view preserving position & playback state
                      setView('lock');
                    } else {
                      defaultSimpClient.loadQueue(
                        browserTracks.map((tr) => tr.uri),
                        i
                      );
                      setView('lock');
                    }
                  }}
                  style={{
                    minHeight: 50,
                    padding: '0 12px',
                    borderRadius: 12,
                    background: track?.uri === t.uri ? '#0d1b22' : '#0a0a0e',
                    border: track?.uri === t.uri ? '1px solid #2aa3c4' : '1px solid #16161e',
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#8e8e99' }}>
                      {Math.floor(t.duration_ms / 60000)}:
                      {String(Math.floor((t.duration_ms % 60000) / 1000)).padStart(2, '0')}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddTracksToPlaylist([t.uri], `"${t.title}"`);
                      }}
                      title="Add track to playlist"
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 8,
                        background: '#14141d',
                        border: '1px solid #282836',
                        color: '#2aa3c4',
                        fontWeight: 800,
                        fontSize: 14,
                        cursor: 'pointer',
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {/* Source Selection, Custom Folder Picker & Authentication Pop-Up Modal */}
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
              width: 560,
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
              <strong style={{ fontSize: 15 }}>Audio Sources, Folders & Auth</strong>
              <button
                onClick={() => setSourceModalOpen(false)}
                style={{
                  minHeight: 44,
                  padding: '0 14px',
                  borderRadius: 10,
                  background: '#16161f',
                  border: '1px solid #2e2e3a',
                  color: '#d4d4dc',
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                }}
              >
                ✕ B
              </button>
            </div>

            {/* Custom Local / WSL2 Folder Picker */}
            <div
              style={{
                padding: 14,
                borderRadius: 14,
                background: '#0f0f16',
                border: '1px solid #242432',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: '#2aa3c4' }}>
                ➕ Add Local / Windows / USB Music Folder
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="/mnt/c/Users/<you>/Music or /home/deck/Music"
                  value={customFolderPath}
                  onChange={(e) => setCustomFolderPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddFolder(customFolderPath);
                  }}
                  style={{
                    flex: 1,
                    minHeight: 42,
                    padding: '0 12px',
                    borderRadius: 10,
                    background: '#07070a',
                    border: '1px solid #2e2e3c',
                    color: '#d4d4dc',
                    fontSize: 12,
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  onClick={() => handleAddFolder(customFolderPath)}
                  style={{
                    minHeight: 42,
                    padding: '0 16px',
                    borderRadius: 10,
                    background: '#0f222a',
                    color: '#bfeaf5',
                    border: '1px solid #2aa3c4',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Add & Scan
                </button>
              </div>

              {/* 1-Tap Preset Paths */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[
                  { label: 'Steam OSTs (C:)', path: '/mnt/c/Program Files (x86)/Steam/steamapps/music' },
                  { label: 'Apple Music (C:)', path: '/mnt/c/Users/niiii/Music/Apple Music/Media/Music' },
                  { label: 'Windows Public Music', path: '/mnt/c/Users/Public/Music' },
                  { label: 'SteamOS ~/Music', path: '/home/deck/Music' },
                ].map((preset) => (
                  <button
                    key={preset.path}
                    onClick={() => handleAddFolder(preset.path)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 8,
                      background: '#161622',
                      border: '1px solid #2b2b3c',
                      color: '#c8c8d2',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    + {preset.label}
                  </button>
                ))}
              </div>

              {/* Active Mounts List with 1-Tap Remove inside Modal */}
              {snap?.mounts && snap.mounts.length > 0 && (
                <div
                  style={{
                    maxHeight: 140,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    marginTop: 4,
                  }}
                >
                  {snap.mounts.map((m) => (
                    <div
                      key={m.mount_root}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        borderRadius: 8,
                        background: '#08080c',
                        border: '1px solid #1c1c26',
                        fontSize: 11,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'monospace',
                          color: m.is_online ? '#c8c8d2' : '#71717a',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.is_online ? '🟢' : '⚫'} {m.mount_root} ({m.track_count} tracks)
                      </span>
                      <button
                        onClick={() => handleRemoveFolder(m.mount_root, m.label)}
                        style={{
                          padding: '2px 8px',
                          borderRadius: 6,
                          background: '#1f1216',
                          border: '1px solid #4c2228',
                          color: '#f87171',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        Remove ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
                background: '#0d1b22',
                border: '1px solid #2aa3c4',
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
                <div style={{ fontSize: 12, color: '#8e8e99' }}>
                  {snap?.mounts.length ?? 0} storage mounts indexed • Click to browse
                </div>
              </div>
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#2aa3c4' }}>Browse</span>
            </div>

            {/* Apple Music (MusicKit v3 + ES256 Developer JWT) */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: snap?.apple_authenticated ? '#141018' : '#121218',
                border: snap?.apple_authenticated ? '1px solid #f43f5e' : '1px solid #24242e',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    🍎 Apple Music
                  </div>
                  <div style={{ fontSize: 11, color: '#8e8e99' }}>
                    {snap?.apple_authenticated
                      ? '🟢 Connected — Playlists & Library synced to SQLite'
                      : appleAuthCfg?.configured
                      ? 'Sign in with your Apple ID to stream & sync playlists'
                      : 'Publisher setup: add Apple Developer Key (.p8) to enable'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => setAppleConfigOpen((prev) => !prev)}
                    style={{
                      minHeight: 34,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#181822',
                      border: '1px solid #2e2e3c',
                      color: '#c8c8d2',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {appleConfigOpen ? 'Hide Key' : '⚙️ Key Setup'}
                  </button>

                  {appleAuthCfg?.configured && !snap?.apple_authenticated && (
                    <button
                      disabled={appleBusy}
                      onClick={async () => {
                        setAppleBusy(true);
                        try {
                          await authorizeAppleMusic(showToast);
                          const updated = await defaultSimpClient.getAppleMusicAuthConfig();
                          setAppleAuthCfg(updated);
                          refreshLibraryData();
                        } catch (err: any) {
                          showToast(err?.message || 'Apple Music auth failed');
                        } finally {
                          setAppleBusy(false);
                        }
                      }}
                      style={{
                        minHeight: 34,
                        padding: '0 12px',
                        borderRadius: 8,
                        background: '#31101b',
                        border: '1px solid #f43f5e',
                        color: '#fda4af',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {appleBusy ? 'Working...' : 'Authorize Apple ID'}
                    </button>
                  )}

                  {snap?.apple_authenticated && (
                    <>
                      <button
                        disabled={appleBusy}
                        onClick={async () => {
                          setAppleBusy(true);
                          try {
                            await syncAppleMusicCatalog(showToast);
                            refreshLibraryData();
                          } catch (err: any) {
                            showToast(err?.message || 'Apple Music sync failed');
                          } finally {
                            setAppleBusy(false);
                          }
                        }}
                        style={{
                          minHeight: 34,
                          padding: '0 10px',
                          borderRadius: 8,
                          background: '#0f222a',
                          border: '1px solid #2aa3c4',
                          color: '#bfeaf5',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {appleBusy ? 'Syncing...' : '🔄 Sync'}
                      </button>
                      <button
                        onClick={() => {
                          defaultSimpClient.disconnectAppleMusic();
                          showToast('Disconnected Apple Music');
                        }}
                        style={{
                          minHeight: 34,
                          padding: '0 10px',
                          borderRadius: 8,
                          background: '#1f1216',
                          border: '1px solid #4c2228',
                          color: '#f87171',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Disconnect
                      </button>
                    </>
                  )}
                </div>
              </div>

              {appleConfigOpen && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    paddingTop: 8,
                    borderTop: '1px solid #22222e',
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input
                      type="text"
                      placeholder="APPLE_TEAM_ID (10 chars)"
                      value={appleTeamId}
                      onChange={(e) => setAppleTeamId(e.target.value)}
                      style={{
                        minHeight: 36,
                        padding: '0 10px',
                        borderRadius: 8,
                        background: '#07070a',
                        border: '1px solid #2e2e3c',
                        color: '#d4d4dc',
                        fontSize: 11,
                        fontFamily: 'monospace',
                      }}
                    />
                    <input
                      type="text"
                      placeholder="APPLE_KEY_ID (10 chars)"
                      value={appleKeyId}
                      onChange={(e) => setAppleKeyId(e.target.value)}
                      style={{
                        minHeight: 36,
                        padding: '0 10px',
                        borderRadius: 8,
                        background: '#07070a',
                        border: '1px solid #2e2e3c',
                        color: '#d4d4dc',
                        fontSize: 11,
                        fontFamily: 'monospace',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      placeholder="/path/to/AuthKey_XXXXXXXXXX.p8"
                      value={appleKeyPath}
                      onChange={(e) => setAppleKeyPath(e.target.value)}
                      style={{
                        flex: 1,
                        minHeight: 36,
                        padding: '0 10px',
                        borderRadius: 8,
                        background: '#07070a',
                        border: '1px solid #2e2e3c',
                        color: '#d4d4dc',
                        fontSize: 11,
                        fontFamily: 'monospace',
                      }}
                    />
                    <button
                      onClick={() => {
                        defaultSimpClient.configureAppleMusic({
                          team_id: appleTeamId,
                          key_id: appleKeyId,
                          private_key_path: appleKeyPath,
                        });
                        window.setTimeout(() => {
                          defaultSimpClient
                            .getAppleMusicAuthConfig()
                            .then((cfg) => {
                              setAppleAuthCfg(cfg);
                              if (cfg.configured) {
                                showToast('ES256 Developer Token signed & ready!');
                                setAppleConfigOpen(false);
                              } else if (cfg.status_error) {
                                showToast(cfg.status_error);
                              }
                            })
                            .catch(() => {});
                        }, 150);
                      }}
                      style={{
                        minHeight: 36,
                        padding: '0 14px',
                        borderRadius: 8,
                        background: '#0f222a',
                        border: '1px solid #2aa3c4',
                        color: '#bfeaf5',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      Save & Sign ES256
                    </button>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      paddingTop: 6,
                      borderTop: '1px dashed #22222e',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700 }}>
                        🔑 Companion Music-User-Token (Bypass FIDO / YubiKey Popup on Handheld)
                      </span>
                      {appleAuthCfg?.music_user_token && (
                        <button
                          onClick={() => {
                            navigator.clipboard
                              .writeText(appleAuthCfg.music_user_token)
                              .then(() => showToast('Copied Music-User-Token to clipboard!'))
                              .catch(() => showToast('Clipboard copy failed'));
                          }}
                          style={{
                            minHeight: 24,
                            padding: '0 8px',
                            borderRadius: 6,
                            background: '#171722',
                            border: '1px solid #2e2e3c',
                            color: '#67e8f9',
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          📋 Copy Active Token
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        placeholder="Paste Music-User-Token from PC (0.ArOY...)"
                        value={appleManualUserToken}
                        onChange={(e) => setAppleManualUserToken(e.target.value)}
                        style={{
                          flex: 1,
                          minHeight: 36,
                          padding: '0 10px',
                          borderRadius: 8,
                          background: '#07070a',
                          border: '1px solid #2e2e3c',
                          color: '#d4d4dc',
                          fontSize: 11,
                          fontFamily: 'monospace',
                        }}
                      />
                      <button
                        onClick={async () => {
                          const token = appleManualUserToken.trim();
                          if (!token) {
                            showToast('Paste a valid Music-User-Token first');
                            return;
                          }
                          setAppleBusy(true);
                          defaultSimpClient.setAppleMusicUserToken(token);
                          window.setTimeout(async () => {
                            try {
                              const cfg = await defaultSimpClient.getAppleMusicAuthConfig();
                              setAppleAuthCfg(cfg);
                              setAppleConfigOpen(false);
                              await syncAppleMusicCatalog(showToast);
                            } finally {
                              setAppleBusy(false);
                            }
                          }, 250);
                        }}
                        style={{
                          minHeight: 36,
                          padding: '0 12px',
                          borderRadius: 8,
                          background: '#2a131c',
                          border: '1px solid #fa243c',
                          color: '#fda4af',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        Apply Token & Sync
                      </button>
                    </div>
                  </div>

                  {appleAuthCfg?.status_error && !appleAuthCfg.configured && (
                    <div style={{ fontSize: 11, color: '#f87171', fontFamily: 'monospace' }}>
                      ⚠️ {appleAuthCfg.status_error}
                    </div>
                  )}
                </div>
              )}
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
                <div style={{ fontSize: 12, color: '#8e8e99' }}>PKCE OAuth + Spotify Connect</div>
              </div>
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#0d9488' }}>Phase 3</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <button
                onClick={() => {
                  defaultSimpClient.rescanStorage();
                  showToast('Rescanning storage mounts...');
                  setSourceModalOpen(false);
                }}
                style={{
                  minHeight: 44,
                  padding: '0 16px',
                  borderRadius: 12,
                  background: '#16161f',
                  border: '1px solid #2e2e3a',
                  color: '#d4d4dc',
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


