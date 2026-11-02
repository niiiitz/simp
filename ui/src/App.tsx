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
import { CompanionPairView } from './components/CompanionPairView';
import { QrCodeSvg } from './components/QrCodeSvg';
import {
  AppleCatalogSearchResults,
  AppleCloudAlbumSummary,
  AppleCloudPlaylistSummary,
  AppleMusicDriver,
  AppleRadioStationSummary,
  authorizeAppleMusic,
  fetchAppleCloudPlaylists,
  fetchApplePlaylistTracks,
  fetchAppleRadioAndForYou,
  fetchFullAppleAlbum,
  pinAppleAlbumToSimp,
  pinApplePlaylistToSimp,
  searchAppleMusicCatalog,
  syncAppleMusicCatalog,
} from './drivers/AppleMusicDriver';

const isCompanionPairRoute =
  typeof window !== 'undefined' &&
  (window.location.pathname.startsWith('/pair') ||
    new URLSearchParams(window.location.search).get('pair') === '1');

export const App: React.FC = () => {
  if (isCompanionPairRoute) {
    return <CompanionPairView />;
  }
  return <ConsoleMainApp />;
};

const ConsoleMainApp: React.FC = () => {
  const [snap, setSnap] = useState<SimpStateSnapshot | null>(null);
  const [view, setView] = useState<'lock' | 'browser'>('lock');
  const [sourceModalOpen, setSourceModalOpen] = useState(false);

  // Library & Playlist Browser state
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [browserSourceFilter, setBrowserSourceFilter] = useState<'all' | 'local' | 'apple_music'>('all');
  const [browserSearch, setBrowserSearch] = useState('');
  const [browserTarget, setBrowserTarget] = useState<{
    kind: 'album' | 'playlist' | 'mount' | 'cloud_playlist' | 'cloud_album';
    id: string;
    title?: string;
    subtitle?: string;
    art_url?: string | null;
  } | null>(null);
  const [browserTracks, setBrowserTracks] = useState<TrackMetadata[]>([]);

  // Apple Music Cloud Hub state (Opt-In Cloud Playlists, Radio & For You Mixes, Live Catalog Search)
  const [appleSubTab, setAppleSubTab] = useState<'pinned' | 'cloud_playlists' | 'radio' | 'search'>('radio');
  const [cloudPlaylists, setCloudPlaylists] = useState<AppleCloudPlaylistSummary[]>([]);
  const [radioStations, setRadioStations] = useState<AppleRadioStationSummary[]>([]);
  const [forYouPlaylists, setForYouPlaylists] = useState<AppleCloudPlaylistSummary[]>([]);
  const [forYouAlbums, setForYouAlbums] = useState<AppleCloudAlbumSummary[]>([]);
  const [catalogSearchResults, setCatalogSearchResults] = useState<AppleCatalogSearchResults>({
    songs: [],
    albums: [],
    playlists: [],
    stations: [],
  });
  const [cloudLoading, setCloudLoading] = useState(false);
  const [activeCloudAlbum, setActiveCloudAlbum] = useState<AppleCloudAlbumSummary | null>(null);
  const [activeCloudPlaylist, setActiveCloudPlaylist] = useState<AppleCloudPlaylistSummary | null>(null);

  // Playlist creation, active playback context & target state
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [activePlaylistId, setActivePlaylistId] = useState<string>('');
  const [playingContextId, setPlayingContextId] = useState<string>('');

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
    const sourceParam =
      browserSourceFilter === 'all' ? null : browserSourceFilter;
    const mountParam =
      browserTarget?.kind === 'mount' ? browserTarget.id : null;
    const searchParam = browserSearch.trim() ? browserSearch.trim() : null;

    defaultSimpClient
      .query<AlbumRecord[]>('get_albums', {
        source: sourceParam,
        mount_root: mountParam,
        search: searchParam,
        limit: 1000,
        offset: 0,
      })
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
        const writable = pls.filter((p) => p.origin === 'simp_local');
        if (writable.length > 0) {
          setActivePlaylistId((prev) =>
            writable.some((w) => w.id === prev) ? prev : writable[0].id
          );
        }
      })
      .catch(() => {});
  }, [browserSourceFilter, browserTarget?.kind, browserTarget?.id, browserSearch]);

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

  // 3. Load tracks for whichever Album, Playlist, Storage Mount, or Apple Cloud item is selected in the Browser
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
    } else if (browserTarget.kind === 'playlist') {
      defaultSimpClient
        .query<TrackMetadata[]>('get_playlist_items', {
          playlist_id: browserTarget.id,
          limit: 2000,
          offset: 0,
        })
        .then(setBrowserTracks)
        .catch(() => {});
    } else if (browserTarget.kind === 'mount') {
      defaultSimpClient
        .query<TrackMetadata[]>('get_tracks', {
          source: null,
          mount_root: browserTarget.id,
          search: browserSearch.trim() ? browserSearch.trim() : null,
          limit: 2000,
          offset: 0,
        })
        .then(setBrowserTracks)
        .catch(() => {});
    }
  }, [browserTarget, browserSearch]);

  // 3b. Apple Music Cloud Hub data loader (Radio & For You, Cloud Playlists, Live Catalog Search)
  useEffect(() => {
    if (view !== 'browser' || browserSourceFilter !== 'apple_music' || !snap?.apple_authenticated) {
      return;
    }
    if (appleSubTab === 'cloud_playlists' && cloudPlaylists.length === 0) {
      setCloudLoading(true);
      fetchAppleCloudPlaylists()
        .then(setCloudPlaylists)
        .catch((err: any) => showToast(err?.message || 'Failed to load Cloud Playlists'))
        .finally(() => setCloudLoading(false));
    } else if (
      appleSubTab === 'radio' &&
      radioStations.length === 0 &&
      forYouPlaylists.length === 0 &&
      forYouAlbums.length === 0
    ) {
      setCloudLoading(true);
      fetchAppleRadioAndForYou()
        .then((res) => {
          setRadioStations(res.stations);
          setForYouPlaylists(res.playlists);
          setForYouAlbums(res.albums);
        })
        .catch((err: any) => showToast(err?.message || 'Failed to load Radio & For You'))
        .finally(() => setCloudLoading(false));
    }
  }, [
    view,
    browserSourceFilter,
    snap?.apple_authenticated,
    appleSubTab,
    cloudPlaylists.length,
    radioStations.length,
    forYouPlaylists.length,
    forYouAlbums.length,
    showToast,
  ]);

  // Debounced live Apple Music Catalog Search
  useEffect(() => {
    const term = browserSearch.trim();
    if (!term || !snap?.apple_authenticated) {
      setCatalogSearchResults({ songs: [], albums: [], playlists: [], stations: [] });
      return;
    }
    if (browserSourceFilter === 'local') {
      return;
    }
    const timer = window.setTimeout(() => {
      setCloudLoading(true);
      searchAppleMusicCatalog(term)
        .then((res) => {
          setCatalogSearchResults(res);
          if (browserSourceFilter === 'apple_music') {
            setAppleSubTab('search');
          }
        })
        .catch(() => {})
        .finally(() => setCloudLoading(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [browserSearch, browserSourceFilter, snap?.apple_authenticated]);

  const handleOpenCloudPlaylist = useCallback(
    async (pl: AppleCloudPlaylistSummary) => {
      setActiveCloudPlaylist(pl);
      setActiveCloudAlbum(null);
      setBrowserTarget({
        kind: 'cloud_playlist',
        id: pl.id,
        title: pl.name,
        subtitle: pl.description,
        art_url: pl.art_url,
      });
      setCloudLoading(true);
      try {
        const tracks = await fetchApplePlaylistTracks(pl.id, pl.kind);
        setBrowserTracks(tracks);
      } catch (err: any) {
        showToast(err?.message || 'Could not load playlist tracks');
      } finally {
        setCloudLoading(false);
      }
    },
    [showToast]
  );

  const handleOpenFullAppleAlbum = useCallback(
    async (params: { albumId?: string | null; songUri?: string | null; fallbackTitle?: string }) => {
      setCloudLoading(true);
      if (params.fallbackTitle) {
        showToast(`Loading full album for "${params.fallbackTitle}"...`);
      }
      try {
        const { album, tracks } = await fetchFullAppleAlbum({
          albumId: params.albumId,
          songUri: params.songUri,
        });
        setActiveCloudAlbum(album);
        setActiveCloudPlaylist(null);
        setBrowserTarget({
          kind: 'cloud_album',
          id: album.id,
          title: `🍎 ${album.title}`,
          subtitle: `${album.artist}${album.release_year ? ` • ${album.release_year}` : ''}`,
          art_url: album.art_url,
        });
        setBrowserTracks(tracks);
        setView('browser');
      } catch (err: any) {
        showToast(err?.message || 'Could not resolve full catalog album');
      } finally {
        setCloudLoading(false);
      }
    },
    [showToast]
  );

  const handleStartAppleStation = useCallback(
    (st: AppleRadioStationSummary) => {
      const stationUri = `applemusic:station:${st.id}`;
      const stationTrack: TrackMetadata = {
        uri: stationUri,
        title: `📻 ${st.name}`,
        artists: [st.tagline || 'Apple Music Radio'],
        album: 'Apple Music Radio',
        album_id: null,
        track_number: 1,
        disc_number: 1,
        art_url: st.art_url,
        duration_ms: 0,
        source: 'apple_music',
        mount_root: null,
      };
      setPlayingContextId(`station:${st.id}`);
      defaultSimpClient.loadQueue([stationUri], 0, [stationTrack]);
      showToast(`Tuning into 📻 ${st.name}...`);
      setView('lock');
    },
    [showToast]
  );

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

  // 6. Spatial Focus Navigation Helper (Gamepad D-Pad / Left Stick / Keyboard Arrows)
  const moveSpatialFocus = useCallback(
    (dir: 'up' | 'down' | 'left' | 'right') => {
      setIsDimmed(false);
      const selector = sourceModalOpen
        ? '[data-modal-root="true"] button:not([disabled]), [data-modal-root="true"] input:not([disabled]), [data-modal-root="true"] select:not([disabled])'
        : 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [data-focusable="true"]';
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (nodes.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      if (!active || !nodes.includes(active)) {
        const preferred =
          nodes.find((el) => el.dataset.defaultFocus === 'true') || nodes[0];
        preferred.focus();
        preferred.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }

      const cur = active.getBoundingClientRect();
      const cx = cur.left + cur.width / 2;
      const cy = cur.top + cur.height / 2;

      let best: HTMLElement | null = null;
      let bestScore = Infinity;

      for (const candidate of nodes) {
        if (candidate === active) continue;
        const r = candidate.getBoundingClientRect();
        const tx = r.left + r.width / 2;
        const ty = r.top + r.height / 2;
        const dx = tx - cx;
        const dy = ty - cy;

        if (dir === 'right' && dx <= 6) continue;
        if (dir === 'left' && dx >= -6) continue;
        if (dir === 'down' && dy <= 6) continue;
        if (dir === 'up' && dy >= -6) continue;

        const primary = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
        const cross = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
        const score = primary + cross * 2.6;

        if (score < bestScore) {
          bestScore = score;
          best = candidate;
        }
      }

      if (best) {
        best.focus();
        best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    },
    [sourceModalOpen]
  );

  // 7. Keyboard shortcuts + Native Decky Fullscreen Route `postMessage` Gamepad Bridge
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSpatialFocus('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSpatialFocus('down');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveSpatialFocus('left');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveSpatialFocus('right');
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        if (sourceModalOpen) {
          e.preventDefault();
          setSourceModalOpen(false);
        } else if (view === 'browser') {
          e.preventDefault();
          setView('lock');
        }
      } else if (e.key === ' ') {
        if (document.activeElement === document.body || !document.activeElement) {
          e.preventDefault();
          defaultSimpClient.togglePlayPause();
        }
      }
    };

    const lastActionTs: Record<string, number> = {};
    const handleGamepadAction = (action: string) => {
      const now = performance.now();
      if (lastActionTs[action] && now - lastActionTs[action] < 70) return;
      lastActionTs[action] = now;
      setIsDimmed(false);

      switch (action) {
        case 'up':
        case 'down':
        case 'left':
        case 'right':
          moveSpatialFocus(action);
          break;
        case 'activate': {
          const active = document.activeElement as HTMLElement | null;
          if (active && active !== document.body && typeof active.click === 'function') {
            active.click();
          } else {
            defaultSimpClient.togglePlayPause();
          }
          break;
        }
        case 'back':
          if (sourceModalOpen) {
            setSourceModalOpen(false);
          } else if (cloudAlbumDetail) {
            setCloudAlbumDetail(null);
          } else if (view === 'browser' && browserTarget.kind !== 'overview') {
            setBrowserTarget({ kind: 'overview' });
          } else if (view === 'browser') {
            setView('lock');
          } else if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'SIMP_EXIT_CONSOLE' }, '*');
          }
          break;
        case 'shuffle':
          defaultSimpClient.setShuffle(!snap?.shuffle);
          break;
        case 'repeat':
          defaultSimpClient.cycleRepeat();
          break;
        case 'l1':
          setView('lock');
          break;
        case 'r1':
          setView('browser');
          break;
        case 'l2':
          defaultSimpClient.seekRelative(-10_000);
          break;
        case 'r2':
          defaultSimpClient.seekRelative(10_000);
          break;
        case 'sources':
          setSourceModalOpen((v) => !v);
          break;
        case 'vol_up':
          applyVolume(currentVolume + 0.05);
          break;
        case 'vol_down':
          applyVolume(currentVolume - 0.05);
          break;
      }
    };

    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type !== 'SIMP_GAMEPAD_ACTION') return;
      handleGamepadAction(data.action);
    };

    // Also listen for SteamUI's native `vgp_onbuttondown` / `vgp_ondirection` events directly
    const onVgpEvent = (e: any) => {
      const btn = Number(e?.detail?.button);
      if (!btn) return;
      const map: Record<number, string> = {
        1: 'activate',
        2: 'back',
        3: 'shuffle',
        4: 'repeat',
        5: 'l1',
        6: 'r1',
        7: 'l2',
        8: 'r2',
        9: 'up',
        10: 'down',
        11: 'left',
        12: 'right',
        13: 'sources',
        14: 'sources',
      };
      const action = map[btn];
      if (action) {
        handleGamepadAction(action);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('message', onMessage);
    window.addEventListener('vgp_onbuttondown', onVgpEvent as EventListener, true);
    window.addEventListener('vgp_ondirection', onVgpEvent as EventListener, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('vgp_onbuttondown', onVgpEvent as EventListener, true);
      window.removeEventListener('vgp_ondirection', onVgpEvent as EventListener, true);
    };
  }, [
    moveSpatialFocus,
    sourceModalOpen,
    cloudAlbumDetail,
    browserTarget.kind,
    view,
    snap?.shuffle,
    applyVolume,
    currentVolume,
  ]);

  // 8. HTML5 Gamepad API polling across all connected controllers (D-Pad + Left/Right Sticks + ABXY/Bumpers/Triggers)
  useEffect(() => {
    const prevButtonsByPad = new Map<number, boolean[]>();
    const prevAxisDirByPad = new Map<number, string | null>();

    const poll = window.setInterval(() => {
      const rawPads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of rawPads) {
        if (!pad || !pad.connected) continue;

        const prevButtons = prevButtonsByPad.get(pad.index) || [];
        const pressed = (idx: number) => !!pad.buttons[idx]?.pressed && !prevButtons[idx];

        if (pressed(0)) {
          // A Button: Activate focused element, or toggle Play/Pause if nothing focused
          setIsDimmed(false);
          const active = document.activeElement as HTMLElement | null;
          if (active && active !== document.body && typeof active.click === 'function') {
            active.click();
          } else {
            defaultSimpClient.togglePlayPause();
          }
        }
        if (pressed(1)) {
          // B Button: Close modal or return to Player view
          setIsDimmed(false);
          if (sourceModalOpen) {
            setSourceModalOpen(false);
          } else if (view === 'browser') {
            setView('lock');
          }
        }
        if (pressed(2)) defaultSimpClient.setShuffle(!snap?.shuffle); // X
        if (pressed(3)) defaultSimpClient.cycleRepeat(); // Y
        if (pressed(4)) setView('lock'); // L1
        if (pressed(5)) setView('browser'); // R1
        if (pressed(6)) defaultSimpClient.seekRelative(-10_000); // L2 (Rewind 10s)
        if (pressed(7)) defaultSimpClient.seekRelative(10_000); // R2 (Fast-Forward 10s)
        if (pressed(8) || pressed(9)) setSourceModalOpen((v) => !v); // Select / Start
        if (pressed(12)) moveSpatialFocus('up'); // D-Up
        if (pressed(13)) moveSpatialFocus('down'); // D-Down
        if (pressed(14)) moveSpatialFocus('left'); // D-Left
        if (pressed(15)) moveSpatialFocus('right'); // D-Right

        // Left Stick 2D Spatial Navigation (with edge-trigger debounce)
        const lx = pad.axes[0] ?? 0;
        const ly = pad.axes[1] ?? 0;
        let stickDir: 'up' | 'down' | 'left' | 'right' | null = null;
        if (ly < -0.55) stickDir = 'up';
        else if (ly > 0.55) stickDir = 'down';
        else if (lx < -0.55) stickDir = 'left';
        else if (lx > 0.55) stickDir = 'right';

        const prevDir = prevAxisDirByPad.get(pad.index) || null;
        if (stickDir && stickDir !== prevDir) {
          moveSpatialFocus(stickDir);
        }
        prevAxisDirByPad.set(pad.index, stickDir);

        // Right Stick Y-Axis Volume Adjustment
        const ry = pad.axes[3] ?? 0;
        if (Math.abs(ry) > 0.6) {
          applyVolume(currentVolume + (ry < 0 ? 0.02 : -0.02));
        }

        prevButtonsByPad.set(
          pad.index,
          pad.buttons.map((b) => b.pressed)
        );
      }
    }, 50);

    return () => window.clearInterval(poll);
  }, [snap?.shuffle, applyVolume, currentVolume, moveSpatialFocus, sourceModalOpen, view]);

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

  const handleAddTracksToPlaylist = async (
    uris: string[],
    label: string,
    trackMetadata?: TrackMetadata[]
  ) => {
    if (uris.length === 0) return;
    try {
      // Ensure any unpinned Apple Music cloud tracks have their metadata cached in SQLite `tracks`
      // (without creating fake AlbumRecords) before linking them into a Hybrid Playlist.
      const appleTracks = (trackMetadata || browserTracks).filter(
        (t) => t.source === 'apple_music' && uris.includes(t.uri)
      );
      if (appleTracks.length > 0) {
        defaultSimpClient.importCatalogTracks({
          source: 'apple_music',
          album: null,
          playlist: null,
          tracks: appleTracks,
        });
      }

      const writablePlaylists = playlists.filter((p) => p.origin === 'simp_local');
      const selectedWritable = writablePlaylists.find((p) => p.id === activePlaylistId);
      let targetPlId = selectedWritable?.id || '';
      let targetPlName = selectedWritable?.name || 'Favorites';

      if (!targetPlId) {
        const created = await defaultSimpClient.query<PlaylistRecord>('create_playlist', {
          name: 'Favorites',
          description: 'Hybrid Local + Apple Music SIMP playlist',
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
          limit: 2000,
          offset: 0,
        });
        setBrowserTracks(updated);
      }
      showToast(`Added ${label} to "${targetPlName}"`);
    } catch {
      showToast('Could not add tracks to playlist');
    }
  };

  const handleRemoveTrackFromPlaylist = async (playlistId: string, trackUri: string, title: string) => {
    try {
      await defaultSimpClient.query('remove_track_from_playlist', {
        playlist_id: playlistId,
        track_uri: trackUri,
      });
      refreshLibraryData();
      if (browserTarget?.kind === 'playlist' && browserTarget.id === playlistId) {
        const updated = await defaultSimpClient.query<TrackMetadata[]>('get_playlist_items', {
          playlist_id: playlistId,
          limit: 2000,
          offset: 0,
        });
        setBrowserTracks(updated);
      }
      showToast(`Removed "${title}" from playlist`);
    } catch {
      showToast('Could not remove track from playlist');
    }
  };

  const handleDeletePlaylist = async (playlistId: string, playlistName: string) => {
    try {
      await defaultSimpClient.query('delete_playlist', { playlist_id: playlistId });
      setBrowserTarget((prev) =>
        prev?.kind === 'playlist' && prev.id === playlistId
          ? albums.length > 0
            ? { kind: 'album', id: albums[0].id }
            : null
          : prev
      );
      setActivePlaylistId((prev) => (prev === playlistId ? '' : prev));
      refreshLibraryData();
      showToast(`Removed playlist "${playlistName}" from SIMP`);
    } catch {
      showToast('Could not remove playlist');
    }
  };

  const handleDeleteAlbum = async (albumId: string, albumTitle: string) => {
    try {
      await defaultSimpClient.query('delete_album', { album_id: albumId });
      setBrowserTarget((prev) =>
        prev?.kind === 'album' && prev.id === albumId
          ? albums.length > 1
            ? { kind: 'album', id: albums.find((a) => a.id !== albumId)?.id || '' }
            : null
          : prev
      );
      refreshLibraryData();
      showToast(`Unpinned album "${albumTitle}" from SIMP`);
    } catch {
      showToast('Could not remove album');
    }
  };

  const handlePinCloudPlaylist = async (
    pl: AppleCloudPlaylistSummary,
    preloadedTracks?: TrackMetadata[]
  ) => {
    setCloudLoading(true);
    try {
      await pinApplePlaylistToSimp(pl, preloadedTracks, showToast);
      refreshLibraryData();
    } catch (err: any) {
      showToast(err?.message || 'Failed to pin playlist to SIMP');
    } finally {
      setCloudLoading(false);
    }
  };

  const handlePinCloudAlbum = async (album: AppleCatalogAlbumSummary, tracks: TrackMetadata[]) => {
    setCloudLoading(true);
    try {
      await pinAppleAlbumToSimp(album, tracks, showToast);
      refreshLibraryData();
    } catch (err: any) {
      showToast(err?.message || 'Failed to pin album to SIMP');
    } finally {
      setCloudLoading(false);
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
  const selectedMountObj =
    browserTarget?.kind === 'mount'
      ? snap?.mounts.find((m) => m.mount_root === browserTarget.id)
      : null;
  const writablePlaylists = playlists.filter((p) => p.origin === 'simp_local');
  const filteredPlaylists = playlists.filter((pl) => {
    if (browserSourceFilter === 'local' && pl.origin === 'apple_remote') return false;
    if (browserSourceFilter === 'apple_music' && pl.origin !== 'apple_remote') return false;
    if (browserSearch.trim()) {
      return pl.name.toLowerCase().includes(browserSearch.trim().toLowerCase());
    }
    return true;
  });

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

      {/* Gamepad & Keyboard Focus Ring Style */}
      <style>{`
        button:focus, button:focus-visible,
        input:focus, input:focus-visible,
        select:focus, select:focus-visible,
        [data-focusable="true"]:focus, [data-focusable="true"]:focus-visible {
          outline: 2px solid #2aa3c4 !important;
          outline-offset: 2px !important;
          box-shadow: 0 0 0 3px rgba(42, 163, 196, 0.28) !important;
        }
      `}</style>

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

            {/* Queue Mode Controls: Shuffle (X), Loop/Repeat (Y), & Full Album (💿) directly under Album Art */}
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
              {track?.source === 'apple_music' && (
                <TransportIconButton
                  icon="💿"
                  badge="ALB"
                  onClick={() =>
                    handleOpenFullAppleAlbum({
                      songUri: track.uri,
                      fallbackTitle: track.album || track.title,
                    })
                  }
                />
              )}
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
                data-default-focus="true"
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
          {/* Left Column: Source Filter Pills, Storage Mounts, Playlists & Albums */}
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
            {/* Source Filter Tabs + Quick Search */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 6,
                }}
              >
                {([
                  { id: 'all', label: '🌐 All Sources' },
                  { id: 'local', label: '💾 Local / Steam' },
                  { id: 'apple_music', label: '🍎 Apple Music' },
                ] as const).map((tab) => {
                  const active = browserSourceFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setBrowserSourceFilter(tab.id);
                        if (tab.id === 'apple_music' && browserTarget?.kind === 'mount') {
                          setBrowserTarget(null);
                        }
                      }}
                      style={{
                        minHeight: 36,
                        padding: '0 8px',
                        borderRadius: 8,
                        background: active ? '#0f222a' : '#0a0a0e',
                        border: active ? '1px solid #2aa3c4' : '1px solid #1e1e26',
                        color: active ? '#bfeaf5' : '#9ca3af',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <input
                type="text"
                placeholder={
                  browserSourceFilter === 'apple_music'
                    ? '🔍 Search Apple Music catalog, albums, playlists, or radio...'
                    : '🔍 Filter playlists, albums, or tracks...'
                }
                value={browserSearch}
                onChange={(e) => setBrowserSearch(e.target.value)}
                style={{
                  minHeight: 36,
                  padding: '0 12px',
                  borderRadius: 8,
                  background: '#08080c',
                  border: '1px solid #242430',
                  color: '#d4d4dc',
                  fontSize: 12,
                }}
              />
            </div>

            {browserSourceFilter === 'apple_music' ? (
              /* 🍎 APPLE MUSIC CLOUD HUB: Radio & Mixes | Cloud Playlists (Opt-In) | Live Catalog Search | Pinned in SIMP */
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 6,
                    marginTop: 2,
                  }}
                >
                  {(
                    [
                      { id: 'radio', label: '📻 Radio & For You' },
                      {
                        id: 'cloud_playlists',
                        label: `☁️ Cloud Playlists${cloudPlaylists.length ? ` (${cloudPlaylists.length})` : ''}`,
                      },
                      { id: 'search', label: '🔍 Catalog Search' },
                      {
                        id: 'pinned',
                        label: `📌 Pinned in SIMP (${filteredPlaylists.length + albums.length})`,
                      },
                    ] as const
                  ).map((st) => {
                    const active = appleSubTab === st.id;
                    return (
                      <button
                        key={st.id}
                        onClick={() => setAppleSubTab(st.id)}
                        style={{
                          minHeight: 34,
                          padding: '0 8px',
                          borderRadius: 8,
                          background: active ? '#28111b' : '#0a0a0e',
                          border: active ? '1px solid #fa243c' : '1px solid #1e1e26',
                          color: active ? '#fecdd3' : '#9ca3af',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>

                {!snap?.apple_authenticated && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      background: '#160d12',
                      border: '1px solid #4c1d2e',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fda4af' }}>
                      🍎 Apple Music Not Signed In
                    </div>
                    <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                      Sign in or scan the QR code in Sources to browse Radio, Cloud Playlists, and Full Catalog Albums.
                    </div>
                    <button
                      onClick={() => setSourceModalOpen(true)}
                      style={{
                        minHeight: 34,
                        padding: '0 12px',
                        borderRadius: 8,
                        background: '#2a131c',
                        border: '1px solid #fa243c',
                        color: '#fecdd3',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        alignSelf: 'flex-start',
                      }}
                    >
                      Open Apple Music Setup
                    </button>
                  </div>
                )}

                {cloudLoading && (
                  <div
                    style={{
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: '#fda4af',
                      padding: '4px 2px',
                    }}
                  >
                    ⏳ Fetching from Apple Music Cloud...
                  </div>
                )}

                {/* SUB-TAB 1: RADIO & FOR YOU */}
                {appleSubTab === 'radio' && snap?.apple_authenticated && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 4,
                      }}
                    >
                      <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#fda4af' }}>
                        📻 RADIO STATIONS ({radioStations.length})
                      </span>
                      <button
                        onClick={() => {
                          setCloudLoading(true);
                          fetchAppleRadioAndForYou()
                            .then((res) => {
                              setRadioStations(res.stations);
                              setForYouPlaylists(res.playlists);
                              setForYouAlbums(res.albums);
                            })
                            .catch(() => {})
                            .finally(() => setCloudLoading(false));
                        }}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          background: '#161620',
                          border: '1px solid #2a2a38',
                          color: '#fda4af',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        ↻ Refresh
                      </button>
                    </div>
                    {radioStations.map((st) => (
                      <button
                        key={st.id}
                        onClick={() => handleStartAppleStation(st)}
                        style={{
                          minHeight: 48,
                          padding: '8px 10px',
                          borderRadius: 12,
                          background:
                            playingContextId === `station:${st.id}` ? '#28111b' : '#0a0a0e',
                          border:
                            playingContextId === `station:${st.id}`
                              ? '1px solid #fa243c'
                              : '1px solid #1e1e26',
                          color: '#d4d4dc',
                          textAlign: 'left',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            📻 {st.name}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: '#8e8e99',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {st.tagline || 'Apple Music Live / Personal Station'}
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: '#fda4af',
                            fontWeight: 800,
                            flexShrink: 0,
                          }}
                        >
                          ▶ TUNE IN
                        </span>
                      </button>
                    ))}

                    {forYouPlaylists.length > 0 && (
                      <>
                        <div
                          style={{
                            fontSize: 12,
                            fontFamily: 'monospace',
                            color: '#fda4af',
                            marginTop: 8,
                          }}
                        >
                          ✨ MADE FOR YOU & HEAVY ROTATION ({forYouPlaylists.length})
                        </div>
                        {forYouPlaylists.map((pl) => {
                          const isSelected =
                            browserTarget?.kind === 'cloud_playlist' && browserTarget.id === pl.id;
                          const isPinned = playlists.some(
                            (p) => p.id === `applemusic:playlist:${pl.id}`
                          );
                          return (
                            <div
                              key={pl.id}
                              style={{
                                minHeight: 48,
                                padding: '6px 10px',
                                borderRadius: 12,
                                background: isSelected ? '#28111b' : '#0a0a0e',
                                border: isSelected
                                  ? '1px solid #fa243c'
                                  : '1px solid #181820',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 8,
                              }}
                            >
                              <button
                                onClick={() => handleOpenCloudPlaylist(pl)}
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#d4d4dc',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  padding: '2px 0',
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {pl.name}
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: '#8e8e99',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {pl.description || 'Apple Music Mix'}
                                </div>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isPinned) {
                                    handleDeletePlaylist(
                                      `applemusic:playlist:${pl.id}`,
                                      pl.name
                                    );
                                  } else {
                                    handlePinCloudPlaylist(pl);
                                  }
                                }}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: 8,
                                  background: isPinned ? '#0f222a' : '#251018',
                                  border: isPinned
                                    ? '1px solid #2aa3c4'
                                    : '1px solid #4c1d2e',
                                  color: isPinned ? '#67e8f9' : '#fda4af',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                  flexShrink: 0,
                                }}
                              >
                                {isPinned ? '✓ Pinned' : '📌 Pin'}
                              </button>
                            </div>
                          );
                        })}
                      </>
                    )}

                    {forYouAlbums.length > 0 && (
                      <>
                        <div
                          style={{
                            fontSize: 12,
                            fontFamily: 'monospace',
                            color: '#fda4af',
                            marginTop: 8,
                          }}
                        >
                          💿 RECOMMENDED FULL ALBUMS ({forYouAlbums.length})
                        </div>
                        {forYouAlbums.map((alb) => {
                          const isSelected =
                            browserTarget?.kind === 'cloud_album' && browserTarget.id === alb.id;
                          return (
                            <button
                              key={alb.id}
                              onClick={() =>
                                handleOpenFullAppleAlbum({
                                  albumId: alb.id,
                                  fallbackTitle: alb.title,
                                })
                              }
                              style={{
                                minHeight: 50,
                                padding: '8px 10px',
                                borderRadius: 12,
                                background: isSelected ? '#28111b' : '#0a0a0e',
                                border: isSelected
                                  ? '1px solid #fa243c'
                                  : '1px solid #181820',
                                color: '#d4d4dc',
                                textAlign: 'left',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 8,
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  💿 {alb.title}
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: '#8e8e99',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {alb.artist}
                                </div>
                              </div>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontFamily: 'monospace',
                                  color: '#fda4af',
                                  flexShrink: 0,
                                }}
                              >
                                Full Album →
                              </span>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </>
                )}

                {/* SUB-TAB 2: CLOUD PLAYLISTS (META-PLAYLIST OPT-IN BROWSER) */}
                {appleSubTab === 'cloud_playlists' && snap?.apple_authenticated && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 4,
                      }}
                    >
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>
                        Click any Cloud Playlist to preview tracks, or click <strong>📌 Pin</strong> to add it to SIMP.
                      </span>
                      <button
                        onClick={() => {
                          setCloudLoading(true);
                          fetchAppleCloudPlaylists()
                            .then(setCloudPlaylists)
                            .catch(() => {})
                            .finally(() => setCloudLoading(false));
                        }}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          background: '#161620',
                          border: '1px solid #2a2a38',
                          color: '#fda4af',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        ↻ Reload
                      </button>
                    </div>
                    {cloudPlaylists
                      .filter((pl) =>
                        browserSearch.trim()
                          ? pl.name.toLowerCase().includes(browserSearch.trim().toLowerCase())
                          : true
                      )
                      .map((pl) => {
                        const isSelected =
                          browserTarget?.kind === 'cloud_playlist' && browserTarget.id === pl.id;
                        const isPinned = playlists.some(
                          (p) => p.id === `applemusic:playlist:${pl.id}`
                        );
                        return (
                          <div
                            key={pl.id}
                            style={{
                              minHeight: 48,
                              padding: '6px 10px',
                              borderRadius: 12,
                              background: isSelected ? '#28111b' : '#0a0a0e',
                              border: isSelected ? '1px solid #fa243c' : '1px solid #181820',
                              color: '#d4d4dc',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 8,
                            }}
                          >
                            <button
                              onClick={() => handleOpenCloudPlaylist(pl)}
                              style={{
                                flex: 1,
                                minWidth: 0,
                                background: 'transparent',
                                border: 'none',
                                color: '#d4d4dc',
                                textAlign: 'left',
                                cursor: 'pointer',
                                padding: '2px 0',
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 700,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                ☁️ {pl.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: '#8e8e99',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {pl.description || 'iCloud Music Library Playlist'}
                              </div>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isPinned) {
                                  handleDeletePlaylist(
                                    `applemusic:playlist:${pl.id}`,
                                    pl.name
                                  );
                                } else {
                                  handlePinCloudPlaylist(pl);
                                }
                              }}
                              title={
                                isPinned
                                  ? 'Unpin from SIMP'
                                  : 'Pin this playlist to SIMP Library'
                              }
                              style={{
                                padding: '5px 10px',
                                borderRadius: 8,
                                background: isPinned ? '#0f222a' : '#251018',
                                border: isPinned ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
                                color: isPinned ? '#67e8f9' : '#fda4af',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                                flexShrink: 0,
                              }}
                            >
                              {isPinned ? '✓ Pinned' : '📌 Pin'}
                            </button>
                          </div>
                        );
                      })}
                  </>
                )}

                {/* SUB-TAB 3: LIVE APPLE MUSIC CATALOG SEARCH */}
                {appleSubTab === 'search' && snap?.apple_authenticated && (
                  <>
                    {!browserSearch.trim() && (
                      <div style={{ fontSize: 12, color: '#8e8e99', padding: '8px 2px' }}>
                        Type an artist, album, song, or station in the search box above to search the full Apple Music Catalog.
                      </div>
                    )}

                    {catalogSearchResults.stations.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                          📻 STATIONS ({catalogSearchResults.stations.length})
                        </div>
                        {catalogSearchResults.stations.map((st) => (
                          <button
                            key={st.id}
                            onClick={() => handleStartAppleStation(st)}
                            style={{
                              minHeight: 44,
                              padding: '6px 10px',
                              borderRadius: 10,
                              background: '#0a0a0e',
                              border: '1px solid #1e1e26',
                              color: '#d4d4dc',
                              textAlign: 'left',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              cursor: 'pointer',
                            }}
                          >
                            <span style={{ fontSize: 12, fontWeight: 700 }}>📻 {st.name}</span>
                            <span style={{ fontSize: 10, color: '#fda4af', fontFamily: 'monospace' }}>
                              ▶ TUNE IN
                            </span>
                          </button>
                        ))}
                      </>
                    )}

                    {catalogSearchResults.albums.length > 0 && (
                      <>
                        <div
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: '#fda4af',
                            marginTop: 6,
                          }}
                        >
                          💿 FULL CATALOG ALBUMS ({catalogSearchResults.albums.length})
                        </div>
                        {catalogSearchResults.albums.map((alb) => {
                          const isSelected =
                            browserTarget?.kind === 'cloud_album' && browserTarget.id === alb.id;
                          return (
                            <button
                              key={alb.id}
                              onClick={() =>
                                handleOpenFullAppleAlbum({
                                  albumId: alb.id,
                                  fallbackTitle: alb.title,
                                })
                              }
                              style={{
                                minHeight: 48,
                                padding: '6px 10px',
                                borderRadius: 10,
                                background: isSelected ? '#28111b' : '#0a0a0e',
                                border: isSelected
                                  ? '1px solid #fa243c'
                                  : '1px solid #181820',
                                color: '#d4d4dc',
                                textAlign: 'left',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 8,
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  💿 {alb.title}
                                </div>
                                <div style={{ fontSize: 11, color: '#8e8e99' }}>
                                  {alb.artist}
                                  {alb.release_year ? ` • ${alb.release_year}` : ''}
                                </div>
                              </div>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontFamily: 'monospace',
                                  color: '#fda4af',
                                  flexShrink: 0,
                                }}
                              >
                                {alb.track_count} trk
                              </span>
                            </button>
                          );
                        })}
                      </>
                    )}

                    {catalogSearchResults.playlists.length > 0 && (
                      <>
                        <div
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: '#fda4af',
                            marginTop: 6,
                          }}
                        >
                          🎶 CATALOG PLAYLISTS ({catalogSearchResults.playlists.length})
                        </div>
                        {catalogSearchResults.playlists.map((pl) => (
                          <div
                            key={pl.id}
                            style={{
                              minHeight: 46,
                              padding: '6px 10px',
                              borderRadius: 10,
                              background: '#0a0a0e',
                              border: '1px solid #181820',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 8,
                            }}
                          >
                            <button
                              onClick={() => handleOpenCloudPlaylist(pl)}
                              style={{
                                flex: 1,
                                minWidth: 0,
                                background: 'transparent',
                                border: 'none',
                                color: '#d4d4dc',
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {pl.name}
                              </div>
                            </button>
                            <button
                              onClick={() => handlePinCloudPlaylist(pl)}
                              style={{
                                padding: '4px 8px',
                                borderRadius: 6,
                                background: '#251018',
                                border: '1px solid #4c1d2e',
                                color: '#fda4af',
                                fontSize: 10,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              📌 Pin
                            </button>
                          </div>
                        ))}
                      </>
                    )}

                    {catalogSearchResults.songs.length > 0 && (
                      <>
                        <div
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: '#fda4af',
                            marginTop: 6,
                          }}
                        >
                          🎵 SONGS ({catalogSearchResults.songs.length})
                        </div>
                        {catalogSearchResults.songs.map((s) => (
                          <div
                            key={s.uri}
                            style={{
                              minHeight: 46,
                              padding: '6px 10px',
                              borderRadius: 10,
                              background: '#0a0a0e',
                              border: '1px solid #181820',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <button
                              onClick={() => {
                                setPlayingContextId(`search:${s.uri}`);
                                defaultSimpClient.loadQueue(
                                  catalogSearchResults.songs.map((tr) => tr.uri),
                                  catalogSearchResults.songs.findIndex((tr) => tr.uri === s.uri),
                                  catalogSearchResults.songs
                                );
                                setView('lock');
                              }}
                              style={{
                                flex: 1,
                                minWidth: 0,
                                background: 'transparent',
                                border: 'none',
                                color: '#d4d4dc',
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                ▶ {s.title}
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: '#8e8e99',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {s.artists.join(', ')} • {s.album}
                              </div>
                            </button>
                            <button
                              onClick={() =>
                                handleOpenFullAppleAlbum({
                                  songUri: s.uri,
                                  fallbackTitle: s.album || s.title,
                                })
                              }
                              title="Open Full Album"
                              style={{
                                padding: '4px 7px',
                                borderRadius: 6,
                                background: '#181824',
                                border: '1px solid #2e2e3e',
                                color: '#fda4af',
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                            >
                              💿
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}

                {/* SUB-TAB 4: PINNED IN SIMP (OPT-IN APPLE PLAYLISTS & ALBUMS) */}
                {appleSubTab === 'pinned' && (
                  <>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                      Only Apple Music playlists and full albums you explicitly pin appear in SIMP.
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: '#71717a',
                        marginTop: 4,
                      }}
                    >
                      PINNED PLAYLISTS ({filteredPlaylists.length})
                    </div>
                    {filteredPlaylists.map((pl) => {
                      const isSelected =
                        browserTarget?.kind === 'playlist' && browserTarget.id === pl.id;
                      return (
                        <div
                          key={pl.id}
                          style={{
                            minHeight: 48,
                            padding: '6px 10px',
                            borderRadius: 12,
                            background: isSelected ? '#0d1b22' : '#0a0a0e',
                            border: isSelected ? '1px solid #2aa3c4' : '1px solid #181820',
                            color: '#d4d4dc',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <button
                            onClick={() => setBrowserTarget({ kind: 'playlist', id: pl.id })}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              background: 'transparent',
                              border: 'none',
                              color: '#d4d4dc',
                              textAlign: 'left',
                              cursor: 'pointer',
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 700 }}>{pl.name}</div>
                            <div style={{ fontSize: 11, color: '#8e8e99' }}>
                              Pinned Apple Music Playlist • {pl.track_count} tracks
                            </div>
                          </button>
                          <button
                            onClick={() => handleDeletePlaylist(pl.id, pl.name)}
                            title="Unpin playlist from SIMP"
                            style={{
                              padding: '3px 7px',
                              borderRadius: 6,
                              background: '#1f1216',
                              border: '1px solid #4c2228',
                              color: '#f87171',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}

                    <div
                      style={{
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: '#71717a',
                        marginTop: 8,
                      }}
                    >
                      PINNED FULL ALBUMS ({albums.length})
                    </div>
                    {albums.map((alb) => {
                      const isSelected =
                        browserTarget?.kind === 'album' && browserTarget.id === alb.id;
                      return (
                        <div
                          key={alb.id}
                          style={{
                            minHeight: 48,
                            padding: '6px 10px',
                            borderRadius: 12,
                            background: isSelected ? '#0d1b22' : '#0a0a0e',
                            border: isSelected ? '1px solid #2aa3c4' : '1px solid #181820',
                            color: '#d4d4dc',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <button
                            onClick={() => setBrowserTarget({ kind: 'album', id: alb.id })}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              background: 'transparent',
                              border: 'none',
                              color: '#d4d4dc',
                              textAlign: 'left',
                              cursor: 'pointer',
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 700 }}>{alb.title}</div>
                            <div style={{ fontSize: 11, color: '#8e8e99' }}>
                              {alb.album_artist} • {alb.track_count} tracks
                            </div>
                          </button>
                          <button
                            onClick={() => handleDeleteAlbum(alb.id, alb.title)}
                            title="Unpin album from SIMP"
                            style={{
                              padding: '3px 7px',
                              borderRadius: 6,
                              background: '#1f1216',
                              border: '1px solid #4c2228',
                              color: '#f87171',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            ) : (
              /* 🌐 ALL SOURCES & 💾 LOCAL / STEAM VIEW */
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 4,
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
                {snap?.mounts.map((m) => {
                  const isMountSelected =
                    browserTarget?.kind === 'mount' && browserTarget.id === m.mount_root;
                  return (
                    <button
                      key={m.mount_root}
                      onClick={() =>
                        setBrowserTarget((prev) =>
                          prev?.kind === 'mount' && prev.id === m.mount_root
                            ? null
                            : { kind: 'mount', id: m.mount_root }
                        )
                      }
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: isMountSelected ? '#0d1b22' : '#0a0a0e',
                        border: isMountSelected ? '1px solid #2aa3c4' : '1px solid #1e1e26',
                        color: '#d4d4dc',
                        textAlign: 'left',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                        opacity: m.is_online ? 1 : 0.65,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontWeight: 700,
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
                    </button>
                  );
                })}

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
                    PLAYLISTS ({filteredPlaylists.length})
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
                    {creatingPlaylist ? 'Cancel' : '+ New Hybrid Playlist'}
                  </button>
                </div>

                {creatingPlaylist && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      placeholder="Playlist name (mixes Local + Apple Music)..."
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

                {filteredPlaylists.map((pl) => {
                  const isSelected =
                    browserTarget?.kind === 'playlist' && browserTarget.id === pl.id;
                  const isLocalPlaylist = pl.origin === 'simp_local';
                  return (
                    <div
                      key={pl.id}
                      style={{
                        minHeight: 48,
                        padding: '6px 10px',
                        borderRadius: 12,
                        background: isSelected ? '#0d1b22' : '#0a0a0e',
                        border: isSelected ? '1px solid #2aa3c4' : '1px solid #181820',
                        color: '#d4d4dc',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <button
                        onClick={() => {
                          if (isLocalPlaylist) {
                            setActivePlaylistId(pl.id);
                          }
                          setBrowserTarget({ kind: 'playlist', id: pl.id });
                        }}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          background: 'transparent',
                          border: 'none',
                          color: '#d4d4dc',
                          textAlign: 'left',
                          cursor: 'pointer',
                          padding: '2px 0',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isLocalPlaylist ? `🎵 ${pl.name}` : `📌 ${pl.name}`}
                        </div>
                        <div
                          style={{ fontSize: 11, color: isLocalPlaylist ? '#2aa3c4' : '#fda4af' }}
                        >
                          {isLocalPlaylist
                            ? '★ SIMP Hybrid Playlist (Local + Apple Music)'
                            : 'Pinned Apple Music Playlist'}
                        </div>
                      </button>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#2aa3c4' }}>
                          {pl.track_count}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePlaylist(pl.id, pl.name);
                          }}
                          title={
                            isLocalPlaylist
                              ? `Delete playlist "${pl.name}"`
                              : `Unpin "${pl.name}" from SIMP`
                          }
                          style={{
                            padding: '3px 7px',
                            borderRadius: 6,
                            background: '#1f1216',
                            border: '1px solid #4c2228',
                            color: '#f87171',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Albums & Soundtracks Section */}
                <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#71717a', marginTop: 8 }}>
                  ALBUMS & SOUNDTRACKS ({albums.length})
                  {browserTarget?.kind === 'mount' && selectedMountObj
                    ? ` — ${selectedMountObj.label}`
                    : ''}
                </div>
                {albums.map((alb) => {
                  const isSelected =
                    browserTarget?.kind === 'album' && browserTarget.id === alb.id;
                  const isAppleAlbum = alb.id.startsWith('applemusic:album:');
                  return (
                    <div
                      key={alb.id}
                      style={{
                        minHeight: 52,
                        padding: '8px 12px',
                        borderRadius: 12,
                        background: isSelected ? '#0d1b22' : '#0a0a0e',
                        border: isSelected ? '1px solid #2aa3c4' : '1px solid #181820',
                        color: '#d4d4dc',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <button
                        onClick={() => setBrowserTarget({ kind: 'album', id: alb.id })}
                        style={{
                          minWidth: 0,
                          flex: 1,
                          background: 'transparent',
                          border: 'none',
                          color: '#d4d4dc',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {alb.title}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: '#8e8e99',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {alb.album_artist}
                        </div>
                      </button>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#2aa3c4' }}>
                          {alb.track_count}
                        </span>
                        {isAppleAlbum && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteAlbum(alb.id, alb.title);
                            }}
                            title={`Unpin album "${alb.title}" from SIMP`}
                            style={{
                              padding: '3px 7px',
                              borderRadius: 6,
                              background: '#1f1216',
                              border: '1px solid #4c2228',
                              color: '#f87171',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Right Column: Tracks for Selected Album, Playlist, Cloud Item, or Storage Mount */}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  {(selectedAlbumObj?.art_url ||
                    (browserTarget &&
                      (browserTarget.kind === 'cloud_album' ||
                        browserTarget.kind === 'cloud_playlist') &&
                      browserTarget.art_url)) && (
                    <img
                      src={
                        selectedAlbumObj?.art_url ||
                        (browserTarget &&
                        (browserTarget.kind === 'cloud_album' ||
                          browserTarget.kind === 'cloud_playlist')
                          ? browserTarget.art_url || ''
                          : '')
                      }
                      alt=""
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 10,
                        objectFit: 'cover',
                        border: '1px solid #242430',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 800,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {selectedAlbumObj
                        ? selectedAlbumObj.title
                        : selectedPlaylistObj
                        ? selectedPlaylistObj.name
                        : selectedMountObj
                        ? `💾 ${selectedMountObj.label}`
                        : browserTarget &&
                          (browserTarget.kind === 'cloud_album' ||
                            browserTarget.kind === 'cloud_playlist')
                        ? browserTarget.title
                        : 'Tracks'}
                    </div>
                    <div style={{ fontSize: 12, color: '#8e8e99' }}>
                      {browserTracks.length} tracks
                      {selectedAlbumObj ? ` • ${selectedAlbumObj.album_artist}` : ''}
                      {selectedMountObj ? ` in ${selectedMountObj.mount_root}` : ''}
                      {browserTarget &&
                      (browserTarget.kind === 'cloud_album' ||
                        browserTarget.kind === 'cloud_playlist') &&
                      browserTarget.subtitle
                        ? ` • ${browserTarget.subtitle}`
                        : ''}
                    </div>
                  </div>
                </div>

                {browserTarget && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Target Hybrid Playlist Selector for `+` Button */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: '#0c0c12',
                        border: '1px solid #262634',
                        borderRadius: 10,
                        padding: '0 8px',
                        minHeight: 40,
                      }}
                    >
                      <span style={{ fontSize: 11, color: '#8e8e99' }}>Add `+` to:</span>
                      {writablePlaylists.length > 0 ? (
                        <select
                          value={activePlaylistId}
                          onChange={(e) => setActivePlaylistId(e.target.value)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#67e8f9',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {writablePlaylists.map((wp) => (
                            <option key={wp.id} value={wp.id} style={{ background: '#0c0c12' }}>
                              {wp.name} ({wp.track_count})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 11, color: '#67e8f9', fontWeight: 700 }}>
                          Favorites (auto-create)
                        </span>
                      )}
                    </div>

                    {/* Pin / Unpin Cloud Playlist to SIMP */}
                    {browserTarget.kind === 'cloud_playlist' && activeCloudPlaylist && (
                      <button
                        onClick={() => {
                          const isPinned = playlists.some(
                            (p) => p.id === `applemusic:playlist:${activeCloudPlaylist.id}`
                          );
                          if (isPinned) {
                            handleDeletePlaylist(
                              `applemusic:playlist:${activeCloudPlaylist.id}`,
                              activeCloudPlaylist.name
                            );
                          } else {
                            handlePinCloudPlaylist(activeCloudPlaylist, browserTracks);
                          }
                        }}
                        style={{
                          minHeight: 44,
                          padding: '0 12px',
                          borderRadius: 12,
                          background: '#28111b',
                          color: '#fecdd3',
                          border: '1px solid #fa243c',
                          fontWeight: 800,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        {playlists.some(
                          (p) => p.id === `applemusic:playlist:${activeCloudPlaylist.id}`
                        )
                          ? '✓ Pinned in SIMP (Unpin)'
                          : '📌 Pin Playlist to SIMP'}
                      </button>
                    )}

                    {/* Pin / Unpin Full Catalog Album to SIMP */}
                    {browserTarget.kind === 'cloud_album' && activeCloudAlbum && (
                      <button
                        onClick={() => {
                          const isPinned = albums.some(
                            (a) => a.id === `applemusic:album:${activeCloudAlbum.id}`
                          );
                          if (isPinned) {
                            handleDeleteAlbum(
                              `applemusic:album:${activeCloudAlbum.id}`,
                              activeCloudAlbum.title
                            );
                          } else {
                            handlePinCloudAlbum(activeCloudAlbum, browserTracks);
                          }
                        }}
                        style={{
                          minHeight: 44,
                          padding: '0 12px',
                          borderRadius: 12,
                          background: '#28111b',
                          color: '#fecdd3',
                          border: '1px solid #fa243c',
                          fontWeight: 800,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        {albums.some((a) => a.id === `applemusic:album:${activeCloudAlbum.id}`)
                          ? '✓ Pinned in SIMP (Unpin)'
                          : '📌 Pin Full Album to SIMP'}
                      </button>
                    )}

                    {browserTarget.kind === 'playlist' && selectedPlaylistObj && (
                      <button
                        onClick={() =>
                          handleDeletePlaylist(
                            selectedPlaylistObj.id,
                            selectedPlaylistObj.name
                          )
                        }
                        style={{
                          minHeight: 44,
                          padding: '0 12px',
                          borderRadius: 12,
                          background: '#221116',
                          color: '#f87171',
                          border: '1px solid #5c222d',
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        {selectedPlaylistObj.origin === 'simp_local'
                          ? '🗑 Delete Playlist'
                          : '✕ Unpin Playlist'}
                      </button>
                    )}

                    {(browserTarget.kind === 'album' ||
                      browserTarget.kind === 'mount' ||
                      browserTarget.kind === 'cloud_album' ||
                      browserTarget.kind === 'cloud_playlist') && (
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
                        + Add All to Hybrid Playlist
                      </button>
                    )}

                    <button
                      onClick={() => {
                        const ctxKey = `${browserTarget.kind}:${browserTarget.id}`;
                        setPlayingContextId(ctxKey);
                        if (browserTarget.kind === 'album') {
                          defaultSimpClient.playAlbum(browserTarget.id, false);
                        } else if (browserTarget.kind === 'playlist') {
                          defaultSimpClient.playPlaylist(browserTarget.id, false);
                        } else if (browserTracks.length > 0) {
                          defaultSimpClient.loadQueue(
                            browserTracks.map((tr) => tr.uri),
                            0,
                            browserTracks
                          );
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
                        const ctxKey = `${browserTarget.kind}:${browserTarget.id}`;
                        setPlayingContextId(ctxKey);
                        if (browserTarget.kind === 'album') {
                          defaultSimpClient.playAlbum(browserTarget.id, true);
                        } else if (browserTarget.kind === 'playlist') {
                          defaultSimpClient.playPlaylist(browserTarget.id, true);
                        } else if (browserTracks.length > 0) {
                          defaultSimpClient.setShuffle(true);
                          defaultSimpClient.loadQueue(
                            browserTracks.map((tr) => tr.uri),
                            0,
                            browserTracks
                          );
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

              {browserTracks.map((t, i) => {
                const currentCtxKey = browserTarget
                  ? `${browserTarget.kind}:${browserTarget.id}`
                  : '';
                const isViewingLocalPlaylist =
                  browserTarget?.kind === 'playlist' &&
                  selectedPlaylistObj?.origin === 'simp_local';
                return (
                <div
                  key={`${t.uri}-${i}`}
                  role="button"
                  tabIndex={0}
                  data-focusable="true"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).click();
                    }
                  }}
                  onClick={() => {
                    if (track?.uri === t.uri && playingContextId === currentCtxKey) {
                      // Already playing this exact track from this exact collection: return to player view
                      setView('lock');
                    } else {
                      // Switched to a different Album / Mount / Playlist: replace queue with this collection!
                      setPlayingContextId(currentCtxKey);
                      defaultSimpClient.loadQueue(
                        browserTracks.map((tr) => tr.uri),
                        i,
                        browserTracks
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#71717a' }}>
                      {String(t.track_number ?? i + 1).padStart(2, '0')}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t.title}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: '#8e8e99',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t.artists.join(', ')}
                        {t.album ? ` • ${t.album}` : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: 'monospace',
                        padding: '2px 6px',
                        borderRadius: 6,
                        background: t.source === 'apple_music' ? '#251018' : '#0f1e26',
                        border:
                          t.source === 'apple_music'
                            ? '1px solid #4c1d2e'
                            : '1px solid #1e3a4a',
                        color: t.source === 'apple_music' ? '#fda4af' : '#67e8f9',
                      }}
                    >
                      {t.source === 'apple_music' ? '🍎 APPLE' : '💾 LOCAL'}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#8e8e99' }}>
                      {Math.floor(t.duration_ms / 60000)}:
                      {String(Math.floor((t.duration_ms % 60000) / 1000)).padStart(2, '0')}
                    </span>
                    {t.source === 'apple_music' &&
                      browserTarget?.kind !== 'cloud_album' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenFullAppleAlbum({
                              songUri: t.uri,
                              fallbackTitle: t.album || t.title,
                            });
                          }}
                          title={`Open full catalog album "${t.album || t.title}"`}
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 8,
                            background: '#221218',
                            border: '1px solid #4c1d2e',
                            color: '#fda4af',
                            fontWeight: 800,
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          💿
                        </button>
                      )}
                    {isViewingLocalPlaylist && browserTarget ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveTrackFromPlaylist(browserTarget.id, t.uri, t.title);
                        }}
                        title="Remove track from playlist"
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 8,
                          background: '#221116',
                          border: '1px solid #5c222d',
                          color: '#f87171',
                          fontWeight: 800,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        ✕
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddTracksToPlaylist([t.uri], `"${t.title}"`);
                        }}
                        title="Add track to hybrid playlist"
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
                    )}
                  </div>
                </div>
              );
              })}
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
            data-modal-root="true"
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
                      ? '🟢 Connected — Browse Cloud Playlists, Radio & Full Albums'
                      : appleAuthCfg?.configured
                      ? 'Sign in with your Apple ID to stream & browse Cloud Library'
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
                        onClick={() => {
                          setBrowserSourceFilter('apple_music');
                          setAppleSubTab('cloud_playlists');
                          setView('browser');
                          setSourceModalOpen(false);
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
                        ☁️ Cloud Hub
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

              {/* Console-Style LAN QR Companion Pairing Banner */}
              {appleAuthCfg?.configured && !snap?.apple_authenticated && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: '#0a0a10',
                    border: '1px solid #282838',
                  }}
                >
                  <QrCodeSvg
                    value={appleAuthCfg.pair_url || 'http://steamdeck.local:18888/pair'}
                    size={96}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#fda4af' }}>
                      📱 Scan to Pair with iPhone / Android / PC
                    </div>
                    <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.4 }}>
                      Sign in on your phone or PC where Face ID, Passkeys, and YubiKey / FIDO2 work natively. Your Apple Music library & token sync straight to your Steam Deck.
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontFamily: 'monospace',
                        color: '#67e8f9',
                        marginTop: 2,
                      }}
                    >
                      {appleAuthCfg.pair_url || 'http://steamdeck.local:18888/pair'}
                    </div>
                  </div>
                </div>
              )}

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


