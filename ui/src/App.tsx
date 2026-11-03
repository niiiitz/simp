import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlbumRecord,
  AppleMusicAuthConfig,
  defaultSimpClient,
  OpticalDiscStatus,
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
  fetchAppleNewFeed,
  fetchApplePlaylistTracks,
  fetchAppleRadioAndForYou,
  fetchFullAppleAlbum,
  pinAppleAlbumToSimp,
  pinApplePlaylistToSimp,
  searchAppleMusicCatalog,
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
  const [powerModalOpen, setPowerModalOpen] = useState(false);
  const [isSleeping, setIsSleeping] = useState(false);
  const [confirmHardReset, setConfirmHardReset] = useState(false);

  // Library & Playlist Browser state
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [browserSourceFilter, setBrowserSourceFilter] = useState<'all' | 'local' | 'apple_music'>('all');
  const [browserSearch, setBrowserSearch] = useState('');
  const [browserTarget, setBrowserTarget] = useState<{
    kind: 'album' | 'playlist' | 'mount' | 'cloud_playlist' | 'cloud_album' | 'cdda';
    id: string;
    title?: string;
    subtitle?: string;
    art_url?: string | null;
  } | null>(null);
  const [browserTracks, setBrowserTracks] = useState<TrackMetadata[]>([]);

  // Optical CD-ROM (`cdda://`) drive status (scanned only on-demand / when CD source is in view & awake)
  const [opticalDisc, setOpticalDisc] = useState<OpticalDiscStatus | null>(null);
  const [cdScanning, setCdScanning] = useState(false);

  // Apple Music Cloud Hub state (Pinned in SIMP, Opt-In Cloud Playlists, Radio & For You Mixes, New Feed & Live Catalog Search)
  const [appleSubTab, setAppleSubTab] = useState<'pinned' | 'cloud_playlists' | 'radio' | 'new'>('pinned');
  const [cloudPlaylists, setCloudPlaylists] = useState<AppleCloudPlaylistSummary[]>([]);
  const [radioStations, setRadioStations] = useState<AppleRadioStationSummary[]>([]);
  const [forYouPlaylists, setForYouPlaylists] = useState<AppleCloudPlaylistSummary[]>([]);
  const [forYouAlbums, setForYouAlbums] = useState<AppleCloudAlbumSummary[]>([]);
  const [newFeedAlbums, setNewFeedAlbums] = useState<AppleCloudAlbumSummary[]>([]);
  const [newFeedPlaylists, setNewFeedPlaylists] = useState<AppleCloudPlaylistSummary[]>([]);
  const [newFeedSongs, setNewFeedSongs] = useState<TrackMetadata[]>([]);
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

  // Custom folder input inside Source Modal + Controller On-Screen Keyboard (OSK) state
  const [customFolderPath, setCustomFolderPath] = useState('');
  const [oskTarget, setOskTarget] = useState<'search' | 'folder' | 'playlist' | null>(null);
  const lastBridgeMsgTsRef = useRef<number>(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Apple Music Auth Modal state
  const [appleAuthCfg, setAppleAuthCfg] = useState<AppleMusicAuthConfig | null>(null);
  const [appleBusy, setAppleBusy] = useState(false);

  // OLED auto-dim, active luminance percentage, popovers & sub-pixel orbit state
  const [isDimmed, setIsDimmed] = useState(false);
  const [brightnessPct, setBrightnessPct] = useState<number>(86);
  const [volumePopoverOpen, setVolumePopoverOpen] = useState(false);
  const [brightnessPopoverOpen, setBrightnessPopoverOpen] = useState(false);
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
  const activeOpacity = Math.max(0.25, Math.min(1, brightnessPct / 100));
  const idleOpacity = activeOpacity * 0.5;

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  const dismissConsole = useCallback(() => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'SIMP_EXIT_CONSOLE' }, '*');
    } else {
      window.close();
    }
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
    if (view === 'browser' || sourceModalOpen || powerModalOpen) {
      refreshLibraryData();
    }
    if (sourceModalOpen || powerModalOpen) {
      defaultSimpClient
        .getAppleMusicAuthConfig()
        .then((cfg) => {
          setAppleAuthCfg(cfg);
        })
        .catch(() => {});
    }
    if (!powerModalOpen) {
      setConfirmHardReset(false);
    }
  }, [view, sourceModalOpen, powerModalOpen, snap?.mounts, refreshLibraryData]);

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
    } else if (browserTarget.kind === 'cdda') {
      setBrowserTracks(opticalDisc?.tracks || []);
    }
  }, [browserTarget, browserSearch, opticalDisc]);

  // 3a. Optical CD-ROM (`cdda://`) Scanner & Eject Handler (never polls in the background; only scans on-demand or when CD view / Sources modal is active & awake)
  const handleScanOpticalDisc = useCallback(
    async (forceRefresh = false, silent = false) => {
      setCdScanning(true);
      try {
        const res = await defaultSimpClient.scanOpticalDisc(
          forceRefresh,
          opticalDisc?.device_path || undefined
        );
        setOpticalDisc(res);
        setBrowserTarget((prev) => {
          if (prev?.kind === 'cdda') {
            if (!res.is_audio_cd) {
              return null;
            }
            return {
              kind: 'cdda',
              id: res.disc_id || res.device_path || '/dev/sr0',
              title: `💿 ${res.album_title || 'Audio CD'}`,
              subtitle: `${res.artist_name || 'Unknown Artist'}${
                res.release_year ? ` • ${res.release_year}` : ''
              }${res.disc_id ? ` • DiscID ${res.disc_id.slice(0, 8)}…` : ''}`,
              art_url: res.art_url,
            };
          }
          return prev;
        });
        if (!silent) {
          showToast(res.status_message);
        }
      } catch {
        if (!silent) {
          showToast('Optical drive scan failed');
        }
      } finally {
        setCdScanning(false);
      }
    },
    [opticalDisc?.device_path, showToast]
  );

  const handleEjectOpticalDisc = useCallback(() => {
    defaultSimpClient.ejectOpticalDisc(opticalDisc?.device_path || undefined);
    setOpticalDisc((prev) =>
      prev
        ? {
            ...prev,
            disc_present: false,
            is_audio_cd: false,
            tracks: [],
            status_message: 'Tray ejected',
          }
        : null
    );
    setBrowserTarget((prev) => (prev?.kind === 'cdda' ? null : prev));
    showToast('⏏ Ejecting optical disc...');
  }, [opticalDisc?.device_path, showToast]);

  // Perform a single non-intrusive optical drive check when opening the Browser or Sources modal while awake,
  // and only poll (every 8s) while the user is actively viewing the CD source or Sources modal (and not sleeping/dimmed or actively streaming CD audio).
  useEffect(() => {
    if (isSleeping || isDimmed) return;
    const isCdActiveInView =
      sourceModalOpen || (view === 'browser' && browserTarget?.kind === 'cdda');
    const isStreamingCd =
      snap?.is_playing && snap?.current_track?.source === 'cdda';

    if ((view === 'browser' || sourceModalOpen) && !opticalDisc && !isStreamingCd) {
      handleScanOpticalDisc(false, true);
    }

    if (!isCdActiveInView || isStreamingCd) return;
    const timer = window.setInterval(() => {
      handleScanOpticalDisc(false, true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [
    view,
    sourceModalOpen,
    browserTarget?.kind,
    isSleeping,
    isDimmed,
    opticalDisc,
    snap?.is_playing,
    snap?.current_track?.source,
    handleScanOpticalDisc,
  ]);

  // 3b. Apple Music Cloud Hub data loader (Radio & For You, Cloud Playlists, New Feed)
  useEffect(() => {
    if (view !== 'browser' || browserSourceFilter === 'local' || !snap?.apple_authenticated) {
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
    } else if (
      appleSubTab === 'new' &&
      newFeedAlbums.length === 0 &&
      newFeedPlaylists.length === 0 &&
      newFeedSongs.length === 0
    ) {
      setCloudLoading(true);
      fetchAppleNewFeed()
        .then((res) => {
          setNewFeedAlbums(res.albums);
          setNewFeedPlaylists(res.playlists);
          setNewFeedSongs(res.songs);
        })
        .catch((err: any) => showToast(err?.message || 'Failed to load Apple Music New feed'))
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
    newFeedAlbums.length,
    newFeedPlaylists.length,
    newFeedSongs.length,
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
        artists: [st.subtitle || 'Apple Music Radio'],
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

  // 4. Volume helpers (interactive slider, wheel, keyboard & gamepad D-Pad Up/Down; Pause is unified with Silence)
  const currentVolume = snap?.volume ?? 0.8;
  const volPct = Math.round(currentVolume * 100);
  const isPlaying = Boolean(snap?.is_playing);

  const applyVolume = useCallback((nextVol: number) => {
    const clamped = Math.max(0.05, Math.min(1, Math.round(nextVol * 100) / 100));
    defaultSimpClient.setVolume(clamped);
  }, []);

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
  // IMPORTANT: Never call `el.focus()` here! Inside SteamUI's `/simp-console` iframe, calling
  // `el.focus()` steals browser focus away from the parent SteamUI `<Focusable>` wrapper,
  // causing SteamUI to play a "bonk" sound on the first D-Pad press and requiring 2 presses per row.
  const applyFocusMarker = useCallback((el: HTMLElement | null) => {
    const activeDom = document.activeElement as HTMLElement | null;
    if (
      activeDom &&
      activeDom !== document.body &&
      activeDom !== el &&
      (activeDom.tagName === 'INPUT' ||
        activeDom.tagName === 'SELECT' ||
        activeDom.tagName === 'TEXTAREA')
    ) {
      activeDom.blur();
    }
    document
      .querySelectorAll<HTMLElement>('[data-simp-active-focus="true"], .simp-gpfocus')
      .forEach((node) => {
        if (node !== el) {
          node.removeAttribute('data-simp-active-focus');
          node.classList.remove('simp-gpfocus');
        }
      });
    if (el) {
      el.setAttribute('data-simp-active-focus', 'true');
      el.classList.add('simp-gpfocus');
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, []);

  // Automatically place the focus marker on the default focus target when entering Browser or opening Modals
  useEffect(() => {
    if (view !== 'browser' && !sourceModalOpen && !powerModalOpen) return;
    const t = window.setTimeout(() => {
      const rootSelector =
        sourceModalOpen || powerModalOpen
          ? '[data-modal-root="true"] button:not([disabled]), [data-modal-root="true"] input:not([disabled])'
          : 'button[data-default-focus="true"]:not([disabled]), [data-nav-col="left"] button:not([disabled])';
      const preferred = document.querySelector<HTMLElement>(rootSelector);
      if (preferred) {
        applyFocusMarker(preferred);
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [view, sourceModalOpen, powerModalOpen, applyFocusMarker]);

  const moveSpatialFocus = useCallback(
    (dir: 'up' | 'down' | 'left' | 'right') => {
      setIsDimmed(false);
      setIsSleeping(false);
      const isModalOpen = sourceModalOpen || powerModalOpen;
      const selector = oskTarget
        ? '[data-osk-root="true"] button:not([disabled])'
        : isModalOpen
        ? '[data-modal-root="true"] button:not([disabled]), [data-modal-root="true"] input:not([disabled]), [data-modal-root="true"] select:not([disabled]), [data-modal-root="true"] a'
        : 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [data-focusable="true"]';
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (nodes.length === 0) return;

      const active =
        (document.querySelector<HTMLElement>('[data-simp-active-focus="true"]') as HTMLElement | null) ||
        (document.activeElement as HTMLElement | null);
      if (!active || !nodes.includes(active)) {
        const preferred =
          nodes.find((el) => el.dataset.defaultFocus === 'true') || nodes[0];
        applyFocusMarker(preferred);
        return;
      }

      const getCol = (el: HTMLElement): string | null =>
        el.closest<HTMLElement>('[data-nav-col]')?.dataset.navCol || null;

      // Detect secondary inline row buttons (`✕`, `📌 Pin`, `🔄 Scan`, `⏏`, `+`, `💿`, `<select>`)
      // so D-Pad Up/Down moves cleanly 1 row per click on primary items, while D-Pad Right/Left reaches inline actions.
      const isAuxRowElement = (el: HTMLElement): boolean => {
        if (el.dataset.rowAux === 'true') return true;
        if (el.tagName === 'SELECT') return true;
        if (el.parentElement?.closest('[data-focusable="true"]')) return true;
        const r = el.getBoundingClientRect();
        if (r.width >= 120) return false;
        const ry = r.top + r.height / 2;
        const elCol = getCol(el);
        return nodes.some((other) => {
          if (other === el) return false;
          if (getCol(other) !== elCol) return false;
          const or = other.getBoundingClientRect();
          const oy = or.top + or.height / 2;
          return (
            Math.abs(oy - ry) <= 16 &&
            or.left < r.left - 8 &&
            or.width > r.width * 1.35 &&
            or.width >= 110
          );
        });
      };

      const cur = active.getBoundingClientRect();
      const cx = cur.left + cur.width / 2;
      const cy = cur.top + cur.height / 2;
      const curCol = getCol(active);

      if (!oskTarget && !isModalOpen && (dir === 'up' || dir === 'down') && curCol) {
        // 1. Try moving Up/Down among primary row items inside the SAME column (`left` or `right`)
        let bestInCol: HTMLElement | null = null;
        let bestInColScore = Infinity;

        for (const candidate of nodes) {
          if (candidate === active) continue;
          if (getCol(candidate) !== curCol) continue;
          if (isAuxRowElement(candidate)) continue;

          const r = candidate.getBoundingClientRect();
          const tx = r.left + r.width / 2;
          const ty = r.top + r.height / 2;
          const dx = tx - cx;
          const dy = ty - cy;

          if (dir === 'down' && dy <= 6) continue;
          if (dir === 'up' && dy >= -6) continue;

          // Strongly prioritize vertical proximity within the same column so wide rows vs grid buttons never skip
          const score = Math.abs(dy) + Math.abs(dx) * 0.22;
          if (score < bestInColScore) {
            bestInColScore = score;
            bestInCol = candidate;
          }
        }

        if (bestInCol) {
          applyFocusMarker(bestInCol);
          return;
        }

        // If at the top of a column and pressing Up, allow escaping to the top header bar (`getCol(c) === null`)
        if (dir === 'up') {
          let bestHeader: HTMLElement | null = null;
          let bestHeaderScore = Infinity;
          for (const candidate of nodes) {
            if (getCol(candidate) !== null) continue;
            const r = candidate.getBoundingClientRect();
            const tx = r.left + r.width / 2;
            const ty = r.top + r.height / 2;
            const dy = ty - cy;
            if (dy >= -6) continue;
            const score = Math.abs(dy) + Math.abs(tx - cx) * 0.5;
            if (score < bestHeaderScore) {
              bestHeaderScore = score;
              bestHeader = candidate;
            }
          }
          if (bestHeader) {
            applyFocusMarker(bestHeader);
            return;
          }
        }
        return;
      }

      if (!oskTarget && !isModalOpen && (dir === 'left' || dir === 'right') && curCol) {
        // 1. First look for a sibling control on the SAME horizontal row in the SAME column (e.g. 2x2 sub-tabs, 3 filter pills, or inline `📌`/`✕`/`+` buttons)
        let bestSameRow: HTMLElement | null = null;
        let bestSameRowDx = Infinity;

        for (const candidate of nodes) {
          if (candidate === active) continue;
          if (getCol(candidate) !== curCol) continue;
          const r = candidate.getBoundingClientRect();
          const tx = r.left + r.width / 2;
          const ty = r.top + r.height / 2;
          const dx = tx - cx;
          const dy = ty - cy;

          if (Math.abs(dy) > 22) continue;
          if (dir === 'right' && dx <= 6) continue;
          if (dir === 'left' && dx >= -6) continue;

          if (Math.abs(dx) < bestSameRowDx) {
            bestSameRowDx = Math.abs(dx);
            bestSameRow = candidate;
          }
        }

        if (bestSameRow) {
          applyFocusMarker(bestSameRow);
          return;
        }

        // 2. Otherwise cross directly between the Left Column (`left`) and Right Column (`right`) at the closest vertical Y!
        const targetCol =
          curCol === 'left' && dir === 'right'
            ? 'right'
            : curCol === 'right' && dir === 'left'
            ? 'left'
            : null;

        if (targetCol) {
          let bestCrossCol: HTMLElement | null = null;
          let bestCrossColScore = Infinity;

          for (const candidate of nodes) {
            if (getCol(candidate) !== targetCol) continue;
            if (isAuxRowElement(candidate)) continue;
            const r = candidate.getBoundingClientRect();
            const ty = r.top + r.height / 2;
            const score = Math.abs(ty - cy) + r.left * 0.05;
            if (score < bestCrossColScore) {
              bestCrossColScore = score;
              bestCrossCol = candidate;
            }
          }

          if (bestCrossCol) {
            applyFocusMarker(bestCrossCol);
            return;
          }
        }
        return;
      }

      // Default 2D spatial navigation (Header bar, Modals, On-Screen Keyboard)
      let best: HTMLElement | null = null;
      let bestScore = Infinity;

      for (const candidate of nodes) {
        if (candidate === active) continue;
        if (!oskTarget && (dir === 'up' || dir === 'down') && isAuxRowElement(candidate)) continue;
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
        const score = primary + cross * (oskTarget ? 1.8 : 2.2);

        if (score < bestScore) {
          bestScore = score;
          best = candidate;
        }
      }

      if (best) {
        applyFocusMarker(best);
      }
    },
    [sourceModalOpen, powerModalOpen, oskTarget, applyFocusMarker]
  );

  // 7. Keyboard shortcuts + Native Decky Fullscreen Route `postMessage` Gamepad Bridge
  useEffect(() => {
    const lastActionTs: Record<string, number> = {};
    const handleGamepadAction = (action: string) => {
      const now = performance.now();
      if (lastActionTs[action] && now - lastActionTs[action] < 70) return;
      lastActionTs[action] = now;
      setIsDimmed(false);
      if (isSleeping) {
        setIsSleeping(false);
        return;
      }

      // In the `🎵 Player` (`lock`) view (when modals and OSK are closed), D-Pad maps directly
      // to the on-screen transport badges (`◄` Previous, `►` Next, `▲/▼` Volume, `A` Play/Pause)!
      const isDirectTransportView =
        view === 'lock' && !sourceModalOpen && !powerModalOpen && !oskTarget;

      switch (action) {
        case 'left':
          if (isDirectTransportView) {
            defaultSimpClient.previous();
          } else {
            moveSpatialFocus('left');
          }
          break;
        case 'right':
          if (isDirectTransportView) {
            defaultSimpClient.next();
          } else {
            moveSpatialFocus('right');
          }
          break;
        case 'up':
          if (isDirectTransportView) {
            applyVolume(currentVolume + 0.05);
          } else {
            moveSpatialFocus('up');
          }
          break;
        case 'down':
          if (isDirectTransportView) {
            applyVolume(currentVolume - 0.05);
          } else {
            moveSpatialFocus('down');
          }
          break;
        case 'activate': {
          if (isDirectTransportView) {
            defaultSimpClient.togglePlayPause();
            break;
          }
          const active =
            (document.querySelector<HTMLElement>('[data-simp-active-focus="true"]') as HTMLElement | null) ||
            (document.activeElement as HTMLElement | null);
          if (active && active.tagName === 'INPUT' && (active as HTMLInputElement).type === 'text') {
            const targetKind =
              (active.dataset.oskInput as 'search' | 'folder' | 'playlist' | undefined) || 'search';
            setOskTarget(targetKind);
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
            }
            window.setTimeout(() => {
              const firstKey = document.querySelector<HTMLElement>(
                '[data-osk-root="true"] button[data-default-focus="true"], [data-osk-root="true"] button'
              );
              if (firstKey) applyFocusMarker(firstKey);
            }, 40);
            break;
          }
          if (active && active !== document.body && typeof active.click === 'function') {
            active.click();
          } else {
            defaultSimpClient.togglePlayPause();
          }
          break;
        }
        case 'back':
          if (oskTarget) {
            const prevInputSelector = `[data-osk-input="${oskTarget}"]`;
            setOskTarget(null);
            window.setTimeout(() => {
              const inp = document.querySelector<HTMLElement>(prevInputSelector);
              if (inp) applyFocusMarker(inp);
            }, 30);
          } else if (volumePopoverOpen || brightnessPopoverOpen) {
            setVolumePopoverOpen(false);
            setBrightnessPopoverOpen(false);
          } else if (confirmHardReset) {
            setConfirmHardReset(false);
          } else if (powerModalOpen) {
            setPowerModalOpen(false);
          } else if (sourceModalOpen) {
            setSourceModalOpen(false);
          } else if (activeCloudAlbum || activeCloudPlaylist) {
            setActiveCloudAlbum(null);
            setActiveCloudPlaylist(null);
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
          setOskTarget(null);
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
          setOskTarget(null);
          setPowerModalOpen(false);
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

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
          setOskTarget(null);
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleGamepadAction('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleGamepadAction('down');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleGamepadAction('left');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleGamepadAction('right');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleGamepadAction('activate');
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        handleGamepadAction('back');
      } else if (e.key === ' ') {
        if (document.activeElement === document.body || !document.activeElement) {
          e.preventDefault();
          defaultSimpClient.togglePlayPause();
        }
      }
    };

    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type !== 'SIMP_GAMEPAD_ACTION') return;
      lastBridgeMsgTsRef.current = performance.now();
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
        lastBridgeMsgTsRef.current = performance.now();
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
    applyFocusMarker,
    oskTarget,
    sourceModalOpen,
    powerModalOpen,
    volumePopoverOpen,
    brightnessPopoverOpen,
    confirmHardReset,
    isSleeping,
    activeCloudAlbum,
    activeCloudPlaylist,
    view,
    snap?.shuffle,
    applyVolume,
    currentVolume,
  ]);

  // 8. HTML5 Gamepad API polling across all connected controllers (D-Pad + Left/Right Sticks + ABXY/Bumpers/Triggers)
  // Note: When running inside the Decky `/simp-console` wrapper, `SIMP_GAMEPAD_ACTION` already bridges
  // D-Pad and button events; we skip duplicate button/D-Pad polling while the bridge is actively sending events.
  useEffect(() => {
    const prevButtonsByPad = new Map<number, boolean[]>();
    const prevAxisDirByPad = new Map<number, string | null>();

    const poll = window.setInterval(() => {
      const bridgeActive = performance.now() - lastBridgeMsgTsRef.current < 3500;
      const rawPads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of rawPads) {
        if (!pad || !pad.connected) continue;

        const prevButtons = prevButtonsByPad.get(pad.index) || [];
        const pressed = (idx: number) => !!pad.buttons[idx]?.pressed && !prevButtons[idx];
        const anyButtonPressed = pad.buttons.some((b, i) => b.pressed && !prevButtons[i]);

        if (isSleeping && anyButtonPressed) {
          setIsSleeping(false);
          setIsDimmed(false);
          prevButtonsByPad.set(
            pad.index,
            pad.buttons.map((b) => b.pressed)
          );
          continue;
        }

        const isDirectTransportView =
          view === 'lock' && !sourceModalOpen && !powerModalOpen && !oskTarget;

        if (!bridgeActive) {
          if (pressed(0)) {
            // A Button: In Player view, toggle Play/Pause; in Browser/Modal view, activate focused element
            setIsDimmed(false);
            if (isDirectTransportView) {
              defaultSimpClient.togglePlayPause();
            } else {
              const active =
                (document.querySelector<HTMLElement>('[data-simp-active-focus="true"]') as HTMLElement | null) ||
                (document.activeElement as HTMLElement | null);
              if (active && active.tagName === 'INPUT' && (active as HTMLInputElement).type === 'text') {
                const targetKind =
                  (active.dataset.oskInput as 'search' | 'folder' | 'playlist' | undefined) || 'search';
                setOskTarget(targetKind);
                if (window.parent && window.parent !== window) {
                  window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                }
                window.setTimeout(() => {
                  const firstKey = document.querySelector<HTMLElement>(
                    '[data-osk-root="true"] button[data-default-focus="true"], [data-osk-root="true"] button'
                  );
                  if (firstKey) applyFocusMarker(firstKey);
                }, 40);
              } else if (active && active !== document.body && typeof active.click === 'function') {
                active.click();
              } else {
                defaultSimpClient.togglePlayPause();
              }
            }
          }
          if (pressed(1)) {
            // B Button: Close OSK, popover/modal, or return to Player view
            setIsDimmed(false);
            if (oskTarget) {
              const prevInputSelector = `[data-osk-input="${oskTarget}"]`;
              setOskTarget(null);
              window.setTimeout(() => {
                const inp = document.querySelector<HTMLElement>(prevInputSelector);
                if (inp) applyFocusMarker(inp);
              }, 30);
            } else if (volumePopoverOpen || brightnessPopoverOpen) {
              setVolumePopoverOpen(false);
              setBrightnessPopoverOpen(false);
            } else if (confirmHardReset) {
              setConfirmHardReset(false);
            } else if (powerModalOpen) {
              setPowerModalOpen(false);
            } else if (sourceModalOpen) {
              setSourceModalOpen(false);
            } else if (view === 'browser') {
              setView('lock');
            }
          }
          if (pressed(2)) defaultSimpClient.setShuffle(!snap?.shuffle); // X
          if (pressed(3)) defaultSimpClient.cycleRepeat(); // Y
          if (pressed(4)) {
            setOskTarget(null);
            setView('lock'); // L1
          }
          if (pressed(5)) setView('browser'); // R1
          if (pressed(6)) defaultSimpClient.seekRelative(-10_000); // L2 (Rewind 10s)
          if (pressed(7)) defaultSimpClient.seekRelative(10_000); // R2 (Fast-Forward 10s)
          if (pressed(8)) {
            setOskTarget(null);
            setPowerModalOpen(false);
            setSourceModalOpen((v) => !v); // Select -> Sources
          }
          if (pressed(9)) {
            setOskTarget(null);
            setSourceModalOpen(false);
            setPowerModalOpen((v) => !v); // Start -> Power Menu
          }
          if (pressed(12)) {
            if (isDirectTransportView) applyVolume(currentVolume + 0.05);
            else moveSpatialFocus('up'); // D-Up
          }
          if (pressed(13)) {
            if (isDirectTransportView) applyVolume(currentVolume - 0.05);
            else moveSpatialFocus('down'); // D-Down
          }
          if (pressed(14)) {
            if (isDirectTransportView) defaultSimpClient.previous();
            else moveSpatialFocus('left'); // D-Left
          }
          if (pressed(15)) {
            if (isDirectTransportView) defaultSimpClient.next();
            else moveSpatialFocus('right'); // D-Right
          }
        }

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
          if (isDirectTransportView) {
            if (stickDir === 'left') defaultSimpClient.previous();
            else if (stickDir === 'right') defaultSimpClient.next();
            else if (stickDir === 'up') applyVolume(currentVolume + 0.05);
            else if (stickDir === 'down') applyVolume(currentVolume - 0.05);
          } else {
            moveSpatialFocus(stickDir);
          }
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
  }, [
    snap?.shuffle,
    applyVolume,
    currentVolume,
    moveSpatialFocus,
    applyFocusMarker,
    oskTarget,
    sourceModalOpen,
    powerModalOpen,
    volumePopoverOpen,
    brightnessPopoverOpen,
    confirmHardReset,
    isSleeping,
    view,
  ]);

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

  const handlePinCloudAlbum = async (album: AppleCloudAlbumSummary, tracks: TrackMetadata[]) => {
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
  const pinnedInSimpCount =
    playlists.filter((p) => p.origin === 'apple_remote').length +
    albums.filter((a) => a.id.startsWith('applemusic:album:')).length;
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
        opacity: isDimmed ? idleOpacity : activeOpacity,
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
        [data-focusable="true"]:focus, [data-focusable="true"]:focus-visible,
        .simp-gpfocus, [data-simp-active-focus="true"] {
          outline: 2px solid #2aa3c4 !important;
          outline-offset: 2px !important;
          box-shadow: 0 0 0 3px rgba(42, 163, 196, 0.28) !important;
        }
      `}</style>

      {/* Wake-Tap Guard: intercepts the first tap when dimmed so no button is misfired */}
      {isDimmed && !isSleeping && (
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

      {/* True-Black OLED Sleep Screen (Wake on Tap or Any Controller Button) */}
      {isSleeping && (
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            setIsSleeping(false);
            setIsDimmed(false);
          }}
          onClick={(e) => {
            e.stopPropagation();
            setIsSleeping(false);
            setIsDimmed(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: '#000000',
            zIndex: 120,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              transform: `translate3d(${orbitX * 3}px, ${orbitY * 3}px, 0)`,
              transition: 'transform 4000ms linear',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              opacity: 0.22,
              color: '#71717a',
              fontFamily: 'monospace',
              fontSize: 12,
              textAlign: 'center',
            }}
          >
            <span>
              🌙 SIMP OLED Sleep • {snap?.is_playing && track ? `▶ ${track.title}` : 'Standby'}
            </span>
            <span style={{ fontSize: 11 }}>Tap anywhere or press any button to wake</span>
          </div>
        </div>
      )}

      {/* Backdrop for Top-Right Volume / Brightness Vertical Slider Popovers */}
      {(volumePopoverOpen || brightnessPopoverOpen) && (
        <div
          onClick={() => {
            setVolumePopoverOpen(false);
            setBrightnessPopoverOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 35,
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
            padding: '0 14px 0 8px',
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
          <img
            src="/favicon.png"
            alt="SIMP"
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              objectFit: 'cover',
              border: '1px solid #2e2e3c',
            }}
          />
          <span
            style={{
              width: 8,
              height: 8,
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

        {/* Compact Volume & Brightness Dropdown Controls + Power Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', zIndex: 40 }}>
          {snap?.power.on_battery && (
            <span
              style={{
                padding: '0 10px',
                height: 44,
                borderRadius: 12,
                background: '#0a0a0e',
                border: '1px solid #1c1c24',
                display: 'flex',
                alignItems: 'center',
                color: '#0d9488',
                fontSize: 12,
                fontFamily: 'monospace',
                fontWeight: 700,
              }}
            >
              🔋 {snap.power.battery_pct ?? ''}%
            </span>
          )}

          {/* Unified Play/Pause (Silence) Toggle + Volume % Vertical Slider Popover */}
          <div
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.05 : -0.05;
              applyVolume(currentVolume + delta);
            }}
            style={{
              height: 44,
              borderRadius: 12,
              background: '#0a0a0e',
              border: volumePopoverOpen
                ? '1px solid #2aa3c4'
                : isPlaying
                  ? '1px solid #1e3a46'
                  : '1px solid #22222c',
              display: 'flex',
              alignItems: 'stretch',
              position: 'relative',
              fontFamily: 'monospace',
            }}
          >
            <button
              onClick={() => defaultSimpClient.togglePlayPause()}
              title={isPlaying ? 'Audio Active — Click to Pause (Silence)' : 'Paused (Silenced) — Click to Resume'}
              style={{
                padding: '0 10px',
                border: 'none',
                borderRight: '1px solid #1e1e28',
                borderTopLeftRadius: 11,
                borderBottomLeftRadius: 11,
                background: isPlaying ? 'rgba(42, 163, 196, 0.1)' : '#12121a',
                color: isPlaying ? '#2aa3c4' : '#9ca3af',
                fontSize: 14,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span>{!isPlaying ? '🔇' : volPct < 45 ? '🔉' : '🔊'}</span>
              {!isPlaying && (
                <span style={{ fontSize: 10, letterSpacing: 0.4, color: '#9ca3af' }}>PAUSED</span>
              )}
            </button>

            <button
              onClick={() => {
                setBrightnessPopoverOpen(false);
                setVolumePopoverOpen((v) => !v);
              }}
              title="Open vertical volume slider (or use D-Pad Up/Down on Player)"
              style={{
                padding: '0 10px',
                border: 'none',
                borderTopRightRadius: 11,
                borderBottomRightRadius: 11,
                background: volumePopoverOpen ? '#0f222a' : 'transparent',
                color: isPlaying ? '#c8c8d2' : '#8e8e99',
                fontSize: 12,
                fontFamily: 'monospace',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>{volPct}%</span>
              <span style={{ fontSize: 10, color: '#71717a' }}>▾</span>
            </button>

            {volumePopoverOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: 52,
                  right: 0,
                  width: 74,
                  padding: '14px 10px',
                  borderRadius: 16,
                  background: '#0c0c12',
                  border: '2px solid #2aa3c4',
                  boxShadow: '0 12px 28px rgba(0,0,0,0.85)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  zIndex: 60,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 800, color: isPlaying ? '#67e8f9' : '#9ca3af' }}>
                  {volPct}%
                </span>
                <div
                  style={{
                    height: 128,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={1}
                    value={volPct}
                    onChange={(e) => applyVolume(Number(e.target.value) / 100)}
                    style={{
                      width: 120,
                      accentColor: '#2aa3c4',
                      transform: 'rotate(-90deg)',
                      cursor: 'pointer',
                    }}
                  />
                </div>
                <button
                  onClick={() => defaultSimpClient.togglePlayPause()}
                  style={{
                    width: '100%',
                    padding: '4px 0',
                    borderRadius: 8,
                    background: isPlaying ? '#0f222a' : '#161622',
                    border: isPlaying ? '1px solid #2aa3c4' : '1px solid #2a2a38',
                    color: isPlaying ? '#7dd3fc' : '#d4d4dc',
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {isPlaying ? '⏸ Pause' : '▶ Play'}
                </button>
              </div>
            )}
          </div>

          {/* OLED Brightness Vertical Slider Popover */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => {
                setVolumePopoverOpen(false);
                setBrightnessPopoverOpen((v) => !v);
              }}
              title="Adjust OLED screen brightness"
              style={{
                height: 44,
                padding: '0 10px',
                borderRadius: 12,
                background: brightnessPopoverOpen ? '#0f222a' : '#0a0a0e',
                border: brightnessPopoverOpen ? '1px solid #2aa3c4' : '1px solid #22222c',
                color: brightnessPopoverOpen ? '#bfeaf5' : '#c8c8d2',
                fontSize: 12,
                fontFamily: 'monospace',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span>{brightnessPct >= 75 ? '🔅' : brightnessPct >= 50 ? '🌙' : '🌑'}</span>
              <span>{brightnessPct}%</span>
              <span style={{ fontSize: 10, color: '#71717a' }}>▾</span>
            </button>

            {brightnessPopoverOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: 52,
                  right: 0,
                  width: 68,
                  padding: '14px 10px',
                  borderRadius: 16,
                  background: '#0c0c12',
                  border: '2px solid #2aa3c4',
                  boxShadow: '0 12px 28px rgba(0,0,0,0.85)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  zIndex: 60,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 800, color: '#67e8f9' }}>
                  {brightnessPct}%
                </span>
                <div
                  style={{
                    height: 128,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <input
                    type="range"
                    min={25}
                    max={100}
                    step={1}
                    value={brightnessPct}
                    onChange={(e) => setBrightnessPct(Number(e.target.value))}
                    style={{
                      width: 120,
                      accentColor: '#2aa3c4',
                      transform: 'rotate(-90deg)',
                      cursor: 'pointer',
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 9,
                    color: '#71717a',
                    fontFamily: 'monospace',
                    textAlign: 'center',
                    lineHeight: 1.2,
                  }}
                >
                  Idle: {Math.round(brightnessPct * 0.5)}%
                </span>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              setVolumePopoverOpen(false);
              setBrightnessPopoverOpen(false);
              setSourceModalOpen(false);
              setPowerModalOpen(true);
            }}
            title="Power, Sleep & System Menu"
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
      ) : (
        /* Split Library, Playlists & Queue Browser */
        <main style={{ flex: 1, display: 'grid', gridTemplateColumns: '38% 62%', overflow: 'hidden', boxSizing: 'border-box', width: '100%' }}>
          {/* Left Column: Source Filter Pills, Storage Mounts, Playlists & Albums */}
          <div
            data-nav-col="left"
            style={{
              borderRight: '1px solid #16161c',
              padding: 16,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {/* Top Controls: Generic 2x2 Library & Cloud Hub Sub-Tabs (Pinned | Cloud Playlists / Radio & For You | New), Search Box, then Source Filter Pills */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 6,
                }}
              >
                {(
                  [
                    {
                      id: 'pinned',
                      label: `📌 Pinned in SIMP (${pinnedInSimpCount})`,
                    },
                    {
                      id: 'cloud_playlists',
                      label: `☁️ Cloud Playlists${cloudPlaylists.length ? ` (${cloudPlaylists.length})` : ''}`,
                    },
                    { id: 'radio', label: '📻 Radio & For You' },
                    { id: 'new', label: '✨ New' },
                  ] as const
                ).map((st) => {
                  const active = appleSubTab === st.id;
                  return (
                    <button
                      key={st.id}
                      data-default-focus={st.id === 'pinned' ? 'true' : undefined}
                      onClick={() => {
                        setAppleSubTab(st.id);
                        if (st.id !== 'pinned' && browserSourceFilter === 'local') {
                          setBrowserSourceFilter('all');
                        }
                        if (st.id !== 'pinned' && browserTarget?.kind === 'mount') {
                          setBrowserTarget(null);
                        }
                      }}
                      style={{
                        minHeight: 34,
                        padding: '0 8px',
                        borderRadius: 8,
                        background: active
                          ? st.id === 'pinned' && browserSourceFilter !== 'apple_music'
                            ? '#0f222a'
                            : '#28111b'
                          : '#0a0a0e',
                        border: active
                          ? st.id === 'pinned' && browserSourceFilter !== 'apple_music'
                            ? '1px solid #2aa3c4'
                            : '1px solid #fa243c'
                          : '1px solid #1e1e26',
                        color: active
                          ? st.id === 'pinned' && browserSourceFilter !== 'apple_music'
                            ? '#bfeaf5'
                            : '#fecdd3'
                          : '#9ca3af',
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

              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="text"
                  data-osk-input="search"
                  placeholder={
                    browserSourceFilter === 'local'
                      ? '🔍 Filter local playlists, albums, or tracks... (Press A for Keyboard)'
                      : '🔍 Search SIMP library or Apple Music catalog... (Press A for Keyboard)'
                  }
                  value={browserSearch}
                  onChange={(e) => setBrowserSearch(e.target.value)}
                  onClick={() => {
                    setOskTarget('search');
                    if (window.parent && window.parent !== window) {
                      window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                    }
                  }}
                  style={{
                    width: '100%',
                    minHeight: 36,
                    padding: browserSearch ? '0 32px 0 12px' : '0 12px',
                    borderRadius: 8,
                    background: '#08080c',
                    border: '1px solid #242430',
                    color: '#d4d4dc',
                    fontSize: 12,
                    boxSizing: 'border-box',
                  }}
                />
                {browserSearch && (
                  <button
                    data-row-aux="true"
                    onClick={() => setBrowserSearch('')}
                    title="Clear search"
                    style={{
                      position: 'absolute',
                      right: 6,
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: '#161622',
                      border: '1px solid #2e2e3c',
                      color: '#9ca3af',
                      fontSize: 11,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

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
                        if (tab.id === 'local') {
                          setAppleSubTab('pinned');
                        }
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
            </div>

            {appleSubTab !== 'pinned' && browserSourceFilter !== 'local' ? (
              /* ☁️ CLOUD PLAYLISTS | 📻 RADIO & FOR YOU | ✨ NEW (Available in both All Sources & Apple Music) */
              <>
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
                      Sign in or scan the QR code in Sources to browse Radio, Cloud Playlists, New Releases, and Full Catalog Albums.
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

                {/* LIVE APPLE MUSIC CATALOG SEARCH (automatically active whenever search input is non-empty) */}
                {browserSearch.trim() && snap?.apple_authenticated ? (
                  <>
                    {catalogSearchResults.stations.length === 0 &&
                      catalogSearchResults.albums.length === 0 &&
                      catalogSearchResults.playlists.length === 0 &&
                      catalogSearchResults.songs.length === 0 &&
                      !cloudLoading && (
                        <div style={{ fontSize: 12, color: '#8e8e99', padding: '8px 2px' }}>
                          No catalog results found for "{browserSearch.trim()}".
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
                ) : (
                  <>
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
                                {st.subtitle || 'Apple Music Live / Personal Station'}
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
                        {cloudPlaylists.map((pl) => {
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

                    {/* SUB-TAB 3: NEW RELEASES & TOP CHARTS FEED */}
                    {appleSubTab === 'new' && snap?.apple_authenticated && (
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
                            ✨ NEW & TOP ALBUMS ({newFeedAlbums.length})
                          </span>
                          <button
                            onClick={() => {
                              setCloudLoading(true);
                              fetchAppleNewFeed()
                                .then((res) => {
                                  setNewFeedAlbums(res.albums);
                                  setNewFeedPlaylists(res.playlists);
                                  setNewFeedSongs(res.songs);
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

                        {newFeedAlbums.map((alb) => {
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
                                border: isSelected ? '1px solid #fa243c' : '1px solid #181820',
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

                        {newFeedPlaylists.length > 0 && (
                          <>
                            <div
                              style={{
                                fontSize: 11,
                                fontFamily: 'monospace',
                                color: '#fda4af',
                                marginTop: 6,
                              }}
                            >
                              🎶 NEW & FEATURED PLAYLISTS ({newFeedPlaylists.length})
                            </div>
                            {newFeedPlaylists.map((pl) => {
                              const isSelected =
                                browserTarget?.kind === 'cloud_playlist' && browserTarget.id === pl.id;
                              const isPinned = playlists.some(
                                (p) => p.id === `applemusic:playlist:${pl.id}`
                              );
                              return (
                                <div
                                  key={pl.id}
                                  style={{
                                    minHeight: 46,
                                    padding: '6px 10px',
                                    borderRadius: 10,
                                    background: isSelected ? '#28111b' : '#0a0a0e',
                                    border: isSelected ? '1px solid #fa243c' : '1px solid #181820',
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
                                    <div
                                      style={{
                                        fontSize: 11,
                                        color: '#8e8e99',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {pl.description}
                                    </div>
                                  </button>
                                  <button
                                    onClick={() => {
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
                                      borderRadius: 6,
                                      background: isPinned ? '#0f222a' : '#251018',
                                      border: isPinned ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
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

                        {newFeedSongs.length > 0 && (
                          <>
                            <div
                              style={{
                                fontSize: 11,
                                fontFamily: 'monospace',
                                color: '#fda4af',
                                marginTop: 6,
                              }}
                            >
                              🎵 TOP NEW SONGS ({newFeedSongs.length})
                            </div>
                            {newFeedSongs.map((s) => (
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
                                    setPlayingContextId(`new:${s.uri}`);
                                    defaultSimpClient.loadQueue(
                                      newFeedSongs.map((tr) => tr.uri),
                                      newFeedSongs.findIndex((tr) => tr.uri === s.uri),
                                      newFeedSongs
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
                  </>
                )}
              </>
            ) : (
              /* 📌 PINNED IN SIMP (Generic across All Sources, Local / Steam, and Apple Music) */
              <>
                {browserSourceFilter !== 'apple_music' && (
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

                    {/* Optical CD-ROM Drive (`cdda://` + MusicBrainz DiscID) */}
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        background:
                          browserTarget?.kind === 'cdda'
                            ? '#1f160d'
                            : opticalDisc?.is_audio_cd
                            ? '#12100e'
                            : '#0a0a0e',
                        border:
                          browserTarget?.kind === 'cdda'
                            ? '1px solid #f59e0b'
                            : opticalDisc?.is_audio_cd
                            ? '1px solid #78350f'
                            : '1px solid #1e1e26',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <button
                        onClick={() => {
                          if (opticalDisc?.is_audio_cd) {
                            setBrowserTarget({
                              kind: 'cdda',
                              id:
                                opticalDisc.disc_id ||
                                opticalDisc.device_path ||
                                '/dev/sr0',
                              title: `💿 ${opticalDisc.album_title || 'Audio CD'}`,
                              subtitle: `${opticalDisc.artist_name || 'Unknown Artist'}${
                                opticalDisc.release_year
                                  ? ` • ${opticalDisc.release_year}`
                                  : ''
                              }${
                                opticalDisc.disc_id
                                  ? ` • DiscID ${opticalDisc.disc_id.slice(0, 8)}…`
                                  : ''
                              }`,
                              art_url: opticalDisc.art_url,
                            });
                            setBrowserTracks(opticalDisc.tracks);
                          } else {
                            handleScanOpticalDisc(false, false);
                          }
                        }}
                        style={{
                          minWidth: 0,
                          flex: 1,
                          background: 'transparent',
                          border: 'none',
                          color: '#d4d4dc',
                          textAlign: 'left',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: opticalDisc?.is_audio_cd ? '#fcd34d' : '#c8c8d2',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {opticalDisc?.is_audio_cd
                            ? `🟢 💿 ${opticalDisc.album_title || 'Audio CD'}`
                            : '⚫ 💿 Optical CD Drive'}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            fontFamily: 'monospace',
                            color: '#8e8e99',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {cdScanning
                            ? '⏳ Reading TOC & MusicBrainz DiscID...'
                            : opticalDisc?.is_audio_cd
                            ? `${opticalDisc.artist_name || 'Unknown Artist'} • ${
                                opticalDisc.tracks.length
                              } tracks`
                            : opticalDisc?.status_message ||
                              'Click Scan when USB CD-ROM is connected'}
                        </div>
                      </button>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleScanOpticalDisc(true, false);
                          }}
                          disabled={cdScanning}
                          title="Scan Optical Drive & Refresh MusicBrainz Metadata"
                          style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            background: '#161622',
                            border: '1px solid #2e2e3e',
                            color: '#fcd34d',
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {cdScanning ? '⏳' : '🔄 Scan'}
                        </button>
                        {opticalDisc?.drive_present && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEjectOpticalDisc();
                            }}
                            title="Eject Optical Disc"
                            style={{
                              padding: '4px 7px',
                              borderRadius: 6,
                              background: '#1f1216',
                              border: '1px solid #4c2228',
                              color: '#fca5a5',
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            ⏏
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* Playlists Section (Pinned & Hybrid) */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 8,
                  }}
                >
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#71717a' }}>
                    {browserSourceFilter === 'apple_music'
                      ? `PINNED PLAYLISTS (${filteredPlaylists.length})`
                      : `PLAYLISTS (${filteredPlaylists.length})`}
                  </span>
                  {browserSourceFilter !== 'apple_music' && (
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
                  )}
                </div>

                {creatingPlaylist && browserSourceFilter !== 'apple_music' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      data-osk-input="playlist"
                      placeholder="Playlist name (Press A for Keyboard)..."
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      onClick={() => {
                        setOskTarget('playlist');
                        if (window.parent && window.parent !== window) {
                          window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                        }
                      }}
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
                  {browserSourceFilter === 'apple_music'
                    ? `PINNED FULL ALBUMS (${albums.length})`
                    : `ALBUMS & SOUNDTRACKS (${albums.length})`}
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

                {/* Unified Live Apple Music Catalog Search Results (shown alongside or below local/pinned matches when typing in All Sources or Apple Music) */}
                {browserSearch.trim() &&
                  browserSourceFilter !== 'local' &&
                  snap?.apple_authenticated && (
                    <>
                      <div
                        style={{
                          marginTop: 10,
                          paddingTop: 10,
                          borderTop: '1px solid #1e1e2a',
                          fontSize: 11,
                          fontFamily: 'monospace',
                          color: '#fda4af',
                        }}
                      >
                        🍎 APPLE MUSIC CATALOG RESULTS FOR "{browserSearch.trim()}"
                      </div>

                      {cloudLoading && (
                        <div
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: '#fda4af',
                            padding: '4px 2px',
                          }}
                        >
                          ⏳ Searching Apple Music Catalog...
                        </div>
                      )}

                      {catalogSearchResults.stations.length === 0 &&
                        catalogSearchResults.albums.length === 0 &&
                        catalogSearchResults.playlists.length === 0 &&
                        catalogSearchResults.songs.length === 0 &&
                        !cloudLoading && (
                          <div style={{ fontSize: 12, color: '#8e8e99', padding: '4px 2px' }}>
                            No Apple Music catalog matches found.
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
              </>
            )}
          </div>

          {/* Right Column: Tracks for Selected Album, Playlist, Cloud Item, or Storage Mount */}
          <div
            data-nav-col="right"
            style={{
              padding: 20,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y',
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
                        browserTarget.kind === 'cloud_playlist' ||
                        browserTarget.kind === 'cdda') &&
                      browserTarget.art_url)) && (
                    <img
                      src={
                        selectedAlbumObj?.art_url ||
                        (browserTarget &&
                        (browserTarget.kind === 'cloud_album' ||
                          browserTarget.kind === 'cloud_playlist' ||
                          browserTarget.kind === 'cdda')
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
                            browserTarget.kind === 'cloud_playlist' ||
                            browserTarget.kind === 'cdda')
                        ? browserTarget.title
                        : 'Tracks'}
                    </div>
                    <div style={{ fontSize: 12, color: '#8e8e99' }}>
                      {browserTracks.length} tracks
                      {selectedAlbumObj ? ` • ${selectedAlbumObj.album_artist}` : ''}
                      {selectedMountObj ? ` in ${selectedMountObj.mount_root}` : ''}
                      {browserTarget &&
                      (browserTarget.kind === 'cloud_album' ||
                        browserTarget.kind === 'cloud_playlist' ||
                        browserTarget.kind === 'cdda') &&
                      browserTarget.subtitle
                        ? ` • ${browserTarget.subtitle}`
                        : ''}
                    </div>
                  </div>
                </div>

                {browserTarget && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Target Hybrid Playlist Selector for `+` Button (hidden for ephemeral Optical CD-ROM tracks) */}
                    {browserTarget.kind !== 'cdda' && (
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
                    )}

                    {/* Optical CD-ROM Controls: Refresh MusicBrainz & Eject Disc */}
                    {browserTarget.kind === 'cdda' && (
                      <>
                        <button
                          onClick={() => handleScanOpticalDisc(true, false)}
                          disabled={cdScanning}
                          style={{
                            minHeight: 44,
                            padding: '0 12px',
                            borderRadius: 12,
                            background: '#1f160d',
                            color: '#fcd34d',
                            border: '1px solid #f59e0b',
                            fontWeight: 800,
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          {cdScanning ? '⏳ Querying MusicBrainz...' : '🔄 Refresh MusicBrainz'}
                        </button>
                        <button
                          onClick={handleEjectOpticalDisc}
                          style={{
                            minHeight: 44,
                            padding: '0 12px',
                            borderRadius: 12,
                            background: '#221116',
                            color: '#fca5a5',
                            border: '1px solid #5c222d',
                            fontWeight: 800,
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          ⏏ Eject CD
                        </button>
                      </>
                    )}

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
                        background:
                          t.source === 'apple_music'
                            ? '#251018'
                            : t.source === 'cdda'
                            ? '#24180b'
                            : '#0f1e26',
                        border:
                          t.source === 'apple_music'
                            ? '1px solid #4c1d2e'
                            : t.source === 'cdda'
                            ? '1px solid #78350f'
                            : '1px solid #1e3a4a',
                        color:
                          t.source === 'apple_music'
                            ? '#fda4af'
                            : t.source === 'cdda'
                            ? '#fcd34d'
                            : '#67e8f9',
                      }}
                    >
                      {t.source === 'apple_music'
                        ? '🍎 APPLE'
                        : t.source === 'cdda'
                        ? '💿 CD-DA'
                        : '💾 LOCAL'}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#8e8e99' }}>
                      {Math.floor(t.duration_ms / 60000)}:
                      {String(Math.floor((t.duration_ms % 60000) / 1000)).padStart(2, '0')}
                    </span>
                    {t.source === 'apple_music' &&
                      browserTarget?.kind !== 'cloud_album' && (
                        <button
                          data-row-aux="true"
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
                        data-row-aux="true"
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
                    ) : t.source !== 'cdda' && browserTarget?.kind !== 'cdda' ? (
                      <button
                        data-row-aux="true"
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
                    ) : null}
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
          onClick={() => setSourceModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
            zIndex: 50,
          }}
        >
          <div
            data-modal-root="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 580,
              maxHeight: '86vh',
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y',
              background: '#0a0a0e',
              border: '2px solid #262632',
              borderRadius: 20,
              padding: 22,
              boxSizing: 'border-box',
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
                  data-osk-input="folder"
                  placeholder="/mnt/c/Users/<you>/Music or /home/deck/Music (Press A for Keyboard)"
                  value={customFolderPath}
                  onChange={(e) => setCustomFolderPath(e.target.value)}
                  onClick={() => {
                    setOskTarget('folder');
                    if (window.parent && window.parent !== window) {
                      window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                    }
                  }}
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
                    maxHeight: 160,
                    overflowY: 'auto',
                    WebkitOverflowScrolling: 'touch',
                    touchAction: 'pan-y',
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

            {/* External USB / Optical CD-ROM Drive (Red Book CD-DA + MusicBrainz DiscID) */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: opticalDisc?.is_audio_cd ? '#1b140c' : '#101016',
                border: opticalDisc?.is_audio_cd ? '1px solid #f59e0b' : '1px solid #24242e',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fcd34d' }}>
                  💿 Optical CD-ROM Audio (Red Book CD-DA + MusicBrainz)
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                  {cdScanning
                    ? '⏳ Reading CD TOC & MusicBrainz DiscID...'
                    : opticalDisc?.status_message ||
                      'Connect an external USB CD/DVD drive (/dev/sr0) — no sudo required'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => handleScanOpticalDisc(true, false)}
                  disabled={cdScanning}
                  style={{
                    minHeight: 36,
                    padding: '0 12px',
                    borderRadius: 8,
                    background: '#1f160d',
                    border: '1px solid #f59e0b',
                    color: '#fcd34d',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {cdScanning ? 'Scanning...' : '🔄 Scan CD'}
                </button>
                {opticalDisc?.is_audio_cd && (
                  <button
                    onClick={() => {
                      setBrowserTarget({
                        kind: 'cdda',
                        id: opticalDisc.disc_id || opticalDisc.device_path || '/dev/sr0',
                        title: `💿 ${opticalDisc.album_title || 'Audio CD'}`,
                        subtitle: `${opticalDisc.artist_name || 'Unknown Artist'}${
                          opticalDisc.release_year ? ` • ${opticalDisc.release_year}` : ''
                        }`,
                        art_url: opticalDisc.art_url,
                      });
                      setBrowserTracks(opticalDisc.tracks);
                      setView('browser');
                      setSourceModalOpen(false);
                    }}
                    style={{
                      minHeight: 36,
                      padding: '0 12px',
                      borderRadius: 8,
                      background: '#0f222a',
                      border: '1px solid #2aa3c4',
                      color: '#bfeaf5',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    ▶ Open CD ({opticalDisc.tracks.length})
                  </button>
                )}
                {opticalDisc?.drive_present && (
                  <button
                    onClick={handleEjectOpticalDisc}
                    style={{
                      minHeight: 36,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#1f1216',
                      border: '1px solid #4c2228',
                      color: '#fca5a5',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ⏏ Eject
                  </button>
                )}
              </div>
            </div>

            {/* Apple Music (MusicKit v3 + Companion QR Pairing) */}
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
                  flexWrap: 'wrap',
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
                      ? 'Sign in with your Apple ID or scan the Companion QR code'
                      : 'Apple Music Developer Token not loaded'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                        minHeight: 36,
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
                          minHeight: 36,
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
                          minHeight: 36,
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
                      Sign in on your phone or PC where Face ID, Passkeys, and YubiKey / FIDO2 work natively. Having FIDO2 or security key issues? Visit the <code>/pair</code> URL below for troubleshooting & token tools.
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

              {snap?.apple_authenticated && (
                <div style={{ fontSize: 11, color: '#71717a' }}>
                  Need to re-pair or use FIDO2 / token troubleshooting? Open{' '}
                  <span style={{ fontFamily: 'monospace', color: '#67e8f9' }}>
                    {appleAuthCfg?.pair_url || 'http://127.0.0.1:18888/pair'}
                  </span>{' '}
                  or use the <strong>⏻ Power Menu</strong>.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
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
                onClick={() => {
                  setSourceModalOpen(false);
                  setPowerModalOpen(true);
                }}
                style={{
                  minHeight: 44,
                  padding: '0 16px',
                  borderRadius: 12,
                  background: '#12121a',
                  border: '1px solid #2e2e3a',
                  color: '#9ca3af',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ⏻ Power & System Menu →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dedicated Power, Sleep, Reset, Pairing & System Maintenance Modal */}
      {powerModalOpen && (
        <div
          onClick={() => setPowerModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.88)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
            zIndex: 55,
          }}
        >
          <div
            data-modal-root="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 560,
              maxHeight: '86vh',
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y',
              background: '#0a0a0e',
              border: '2px solid #262632',
              borderRadius: 20,
              padding: 22,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 15 }}>⏻ Power, Sleep & System Menu</strong>
              <button
                onClick={() => setPowerModalOpen(false)}
                style={{
                  minHeight: 42,
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

            {/* 1. Sleep Screen, Minimize to Tray/Background & Pause/Dismiss Quick Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <button
                data-default-focus="true"
                onClick={() => {
                  setPowerModalOpen(false);
                  setIsSleeping(true);
                }}
                style={{
                  minHeight: 62,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: '#0d1b22',
                  border: '1px solid #2aa3c4',
                  color: '#bfeaf5',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 800 }}>🌙 Sleep Screen</span>
                <span style={{ fontSize: 11, color: '#8e8e99' }}>
                  True-black OLED screen • Wakes on any button
                </span>
              </button>

              <button
                onClick={() => {
                  setPowerModalOpen(false);
                  dismissConsole();
                }}
                style={{
                  minHeight: 62,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: '#0f1d18',
                  border: '1px solid #10b981',
                  color: '#d1fae5',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 800 }}>📥 Minimize to Tray</span>
                <span style={{ fontSize: 11, color: '#8e8e99' }}>
                  Keep playing in KDE System Tray / Decky QAM
                </span>
              </button>

              <button
                onClick={() => {
                  defaultSimpClient.pause();
                  setPowerModalOpen(false);
                  dismissConsole();
                }}
                style={{
                  minHeight: 62,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: '#12121b',
                  border: '1px solid #2c2c3c',
                  color: '#e4e4ec',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 800 }}>⏸️ Pause & Dismiss</span>
                <span style={{ fontSize: 11, color: '#8e8e99' }}>
                  Silence audio and close SIMP Console
                </span>
              </button>
            </div>

            {/* 2. Reset Services & Shutdown Background Daemon */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                onClick={() => {
                  defaultSimpClient.pause();
                  defaultSimpClient.restartDaemon();
                  showToast('Restarting SIMP background services...');
                  setPowerModalOpen(false);
                  window.setTimeout(() => dismissConsole(), 300);
                }}
                style={{
                  minHeight: 62,
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: '#161420',
                  border: '1px solid #3b3354',
                  color: '#ddd6fe',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 800 }}>🔄 Reset Services & Dismiss</span>
                <span style={{ fontSize: 11, color: '#a1a1aa' }}>
                  Pause, restart BG daemon & Widevine worker, and close screen
                </span>
              </button>

              <button
                onClick={() => {
                  defaultSimpClient.shutdownDaemon();
                  setPowerModalOpen(false);
                  window.setTimeout(() => dismissConsole(), 250);
                }}
                style={{
                  minHeight: 62,
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: '#241115',
                  border: '1px solid #7f1d1d',
                  color: '#fca5a5',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 800 }}>⏻ Shutdown SIMP</span>
                <span style={{ fontSize: 11, color: '#fca5a5', opacity: 0.8 }}>
                  Kill background daemon & workers and dismiss console
                </span>
              </button>
            </div>

            {/* 3. Pairing & Troubleshooting Assistance (/pair) */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: '#0d0d14',
                border: '1px solid #262636',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <QrCodeSvg
                value={appleAuthCfg?.pair_url || 'http://steamdeck.local:18888/pair'}
                size={84}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#67e8f9' }}>
                  📱 Pairing & Troubleshooting Assistance (/pair)
                </div>
                <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.4 }}>
                  Scan with your phone or visit on a PC to pair Apple Music or access the{' '}
                  <strong>FIDO2 / YubiKey & Token Debug</strong> tools.
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginTop: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: '#fda4af',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {appleAuthCfg?.pair_url || 'http://127.0.0.1:18888/pair'}
                  </span>
                  <a
                    href="/pair"
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      padding: '5px 10px',
                      borderRadius: 8,
                      background: '#171724',
                      border: '1px solid #2aa3c4',
                      color: '#bfeaf5',
                      fontSize: 11,
                      fontWeight: 700,
                      textDecoration: 'none',
                    }}
                  >
                    Open /pair ↗
                  </a>
                </div>
              </div>
            </div>

            {/* 4. Database Cache Reset & Hard Reset All Settings */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: '#0f0f15',
                border: '1px solid #22222e',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af' }}>
                🛠️ Storage Cache & Factory Reset
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={() => {
                    defaultSimpClient.resetDatabaseCache();
                    showToast('Cleared offline DB cache & rescanning folders...');
                    setPowerModalOpen(false);
                    window.setTimeout(() => refreshLibraryData(), 600);
                  }}
                  style={{
                    flex: 1,
                    minHeight: 46,
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: '#161622',
                    border: '1px solid #2e2e3e',
                    color: '#d4d4dc',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  🧹 Reset Offline DB Cache (Keep Auth)
                </button>

                {!confirmHardReset ? (
                  <button
                    onClick={() => setConfirmHardReset(true)}
                    style={{
                      flex: 1,
                      minHeight: 46,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: '#221115',
                      border: '1px solid #5c222d',
                      color: '#f87171',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ⚠️ Hard Reset All Settings...
                  </button>
                ) : (
                  <div
                    style={{
                      width: '100%',
                      padding: 12,
                      borderRadius: 10,
                      background: '#2a0e13',
                      border: '1px solid #ef4444',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#fecaca' }}>
                      ⚠️ Confirm Hard Reset?
                    </div>
                    <div style={{ fontSize: 11, color: '#fca5a5', lineHeight: 1.4 }}>
                      This will sign out of Apple Music, clear all playlists, pinned albums, cached tracks, and reset all SIMP settings to factory defaults.
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => {
                          defaultSimpClient.factoryReset();
                          setConfirmHardReset(false);
                          setPowerModalOpen(false);
                          showToast('Factory reset complete — all settings & auth cleared');
                          window.setTimeout(() => refreshLibraryData(), 600);
                        }}
                        style={{
                          flex: 1,
                          minHeight: 40,
                          borderRadius: 8,
                          background: '#dc2626',
                          border: '1px solid #f87171',
                          color: '#ffffff',
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        Yes, Wipe & Hard Reset
                      </button>
                      <button
                        onClick={() => setConfirmHardReset(false)}
                        style={{
                          minHeight: 40,
                          padding: '0 14px',
                          borderRadius: 8,
                          background: '#181822',
                          border: '1px solid #2e2e3c',
                          color: '#d4d4dc',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Controller-Navigable On-Screen Keyboard (OSK) Bar for Search, Playlist Name & Folder Path */}
      {oskTarget && (
        <div
          data-osk-root="true"
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 95,
            background: 'rgba(8, 8, 12, 0.96)',
            borderTop: '2px solid #2aa3c4',
            boxShadow: '0 -12px 32px rgba(0, 0, 0, 0.85)',
            padding: '10px 18px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: '#2aa3c4',
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {oskTarget === 'search'
                  ? '⌨️ SEARCH:'
                  : oskTarget === 'playlist'
                  ? '⌨️ PLAYLIST NAME:'
                  : '⌨️ FOLDER PATH:'}
              </span>
              <div
                style={{
                  flex: 1,
                  minHeight: 32,
                  padding: '0 12px',
                  borderRadius: 8,
                  background: '#050508',
                  border: '1px solid #2aa3c4',
                  color: '#f4f4f6',
                  fontSize: 13,
                  fontFamily: 'monospace',
                  display: 'flex',
                  alignItems: 'center',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {(oskTarget === 'search'
                  ? browserSearch
                  : oskTarget === 'playlist'
                  ? newPlaylistName
                  : customFolderPath) || (
                  <span style={{ color: '#71717a' }}>Type with D-Pad + (A) or press (B) when done...</span>
                )}
                <span style={{ color: '#2aa3c4', marginLeft: 2, fontWeight: 900 }}>▋</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <button
                onClick={() => {
                  if (oskTarget === 'search') setBrowserSearch((v) => v.slice(0, -1));
                  else if (oskTarget === 'playlist') setNewPlaylistName((v) => v.slice(0, -1));
                  else setCustomFolderPath((v) => v.slice(0, -1));
                }}
                style={{
                  minHeight: 34,
                  padding: '0 12px',
                  borderRadius: 8,
                  background: '#161622',
                  border: '1px solid #2e2e3e',
                  color: '#fca5a5',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ⌫ Backspace
              </button>
              <button
                onClick={() => {
                  if (oskTarget === 'search') setBrowserSearch('');
                  else if (oskTarget === 'playlist') setNewPlaylistName('');
                  else setCustomFolderPath('');
                }}
                style={{
                  minHeight: 34,
                  padding: '0 12px',
                  borderRadius: 8,
                  background: '#161622',
                  border: '1px solid #2e2e3e',
                  color: '#9ca3af',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
              <button
                onClick={() => {
                  const prevInputSelector = `[data-osk-input="${oskTarget}"]`;
                  setOskTarget(null);
                  window.setTimeout(() => {
                    const inp = document.querySelector<HTMLElement>(prevInputSelector);
                    if (inp) applyFocusMarker(inp);
                  }, 30);
                }}
                style={{
                  minHeight: 34,
                  padding: '0 14px',
                  borderRadius: 8,
                  background: '#0f222a',
                  border: '1px solid #2aa3c4',
                  color: '#bfeaf5',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ✓ Done (B)
              </button>
            </div>
          </div>

          {[
            ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '/'],
            ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
            ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"],
            ['z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '_', 'SPACE'],
          ].map((row, rIdx) => (
            <div
              key={rIdx}
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              {row.map((keyChar) => {
                const isSpace = keyChar === 'SPACE';
                return (
                  <button
                    key={keyChar}
                    data-default-focus={keyChar === 'a' ? 'true' : undefined}
                    onClick={() => {
                      const ch = isSpace ? ' ' : keyChar;
                      if (oskTarget === 'search') setBrowserSearch((v) => v + ch);
                      else if (oskTarget === 'playlist') setNewPlaylistName((v) => v + ch);
                      else setCustomFolderPath((v) => v + ch);
                    }}
                    style={{
                      flex: isSpace ? 2.6 : 1,
                      maxWidth: isSpace ? 180 : 62,
                      minHeight: 36,
                      borderRadius: 8,
                      background: '#12121a',
                      border: '1px solid #262636',
                      color: '#e4e4ec',
                      fontSize: 13,
                      fontFamily: 'monospace',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {isSpace ? '␣ Space' : keyChar.toUpperCase()}
                  </button>
                );
              })}
            </div>
          ))}
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


