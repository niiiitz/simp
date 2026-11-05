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
import { CompanionPairView } from './components/CompanionPairView';
import {
  AppleCatalogSearchResults,
  AppleCloudAlbumSummary,
  AppleCloudPlaylistSummary,
  AppleMusicDriver,
  AppleRadioStationSummary,
  fetchAppleCloudPlaylists,
  fetchAppleNewFeed,
  fetchApplePlaylistTracks,
  fetchAppleRadioAndForYou,
  fetchFullAppleAlbum,
  pinAppleAlbumToSimp,
  pinApplePlaylistToSimp,
  searchAppleMusicCatalog,
} from './drivers/AppleMusicDriver';
import { OskTargetKind, useGamepadNavigation } from './hooks/useGamepadNavigation';
import { BrowserTarget, PlayerView } from './views/PlayerView';
import { LibraryBrowserView } from './views/LibraryBrowserView';
import { SettingsModal } from './views/SettingsModal';
import { PowerModal, SimpUpdateStatus } from './views/PowerModal';

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
  const [browserTarget, setBrowserTarget] = useState<BrowserTarget | null>(null);
  const [browserTracks, setBrowserTracks] = useState<TrackMetadata[]>([]);

  // Optical CD-ROM (`cdda://`) drive status (scanned only on-demand / when CD source is in view & awake)
  const [opticalDisc, setOpticalDisc] = useState<OpticalDiscStatus | null>(null);
  const [cdScanning, setCdScanning] = useState(false);

  // Apple Music Cloud Hub state
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
  const [oskTarget, setOskTarget] = useState<OskTargetKind>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Apple Music Auth Modal state
  const [appleAuthCfg, setAppleAuthCfg] = useState<AppleMusicAuthConfig | null>(null);
  const [appleBusy, setAppleBusy] = useState(false);

  // OLED auto-dim, active luminance percentage, popovers & sub-pixel orbit state
  const [isDimmed, setIsDimmed] = useState(false);
  const [brightnessPct, setBrightnessPct] = useState<number>(() => {
    try {
      const saved = window.localStorage.getItem('simp_brightness_pct');
      if (saved) {
        const parsed = Number(saved);
        if (Number.isFinite(parsed) && parsed >= 25 && parsed <= 100) {
          return Math.round(parsed);
        }
      }
    } catch {
      // Ignore storage access errors
    }
    return 100;
  });
  const brightnessHydratedRef = useRef(false);
  const [volumePopoverOpen, setVolumePopoverOpen] = useState(false);
  const [brightnessPopoverOpen, setBrightnessPopoverOpen] = useState(false);
  const [orbitStep, setOrbitStep] = useState(0);

  // Hydrate brightnessPct once from daemon settings.vdf snapshot if not overridden in localStorage
  useEffect(() => {
    if (!brightnessHydratedRef.current && snap?.brightness_pct && snap.brightness_pct >= 25) {
      brightnessHydratedRef.current = true;
      try {
        if (!window.localStorage.getItem('simp_brightness_pct')) {
          setBrightnessPct(Math.max(25, Math.min(100, Math.round(snap.brightness_pct))));
        }
      } catch {
        setBrightnessPct(Math.max(25, Math.min(100, Math.round(snap.brightness_pct))));
      }
    }
  }, [snap?.brightness_pct]);

  // Persist brightnessPct to localStorage & daemon settings.vdf after 3 seconds of being unchanged
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem('simp_brightness_pct', String(brightnessPct));
      } catch {
        // Ignore storage errors
      }
      defaultSimpClient.setBrightness(brightnessPct);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [brightnessPct]);

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

  const [updateStatus, setUpdateStatus] = useState<SimpUpdateStatus>({});

  useEffect(() => {
    if (snap?.daemon_version) {
      setUpdateStatus((prev) =>
        prev.current_version === snap.daemon_version
          ? prev
          : { ...prev, current_version: snap.daemon_version }
      );
    }
  }, [snap?.daemon_version]);

  const checkSimpUpdates = useCallback(async (_silent = false) => {
    setUpdateStatus((prev) => ({ ...prev, checking: true, error: undefined }));
    try {
      const resp = await fetch(`/api/update/check?t=${Date.now()}`, { cache: 'no-store' });
      const data = await resp.json();
      if (data.ok) {
        setUpdateStatus({
          current_version: data.current_version,
          latest_version: data.latest_version,
          latest_tag: data.latest_tag,
          update_available: Boolean(data.update_available),
          target_arch: data.target_arch,
          checking: false,
        });
      } else {
        setUpdateStatus((prev) => ({
          ...prev,
          current_version: data.current_version || prev.current_version,
          target_arch: data.target_arch || prev.target_arch,
          checking: false,
          error: data.error || 'Update check failed',
        }));
      }
    } catch (e: any) {
      setUpdateStatus((prev) => ({
        ...prev,
        checking: false,
        error: e?.message || 'Could not reach daemon',
      }));
    }
  }, []);

  const applySimpUpdate = useCallback(async () => {
    setUpdateStatus((prev) => ({ ...prev, applying: true, error: undefined }));
    showToast('Downloading & installing latest SIMP release from GitHub...');
    try {
      const resp = await fetch('/api/update/apply', { method: 'POST', cache: 'no-store' });
      const data = await resp.json();
      if (data.ok) {
        const nextVer = String(data.updated_version || '').replace(/^v/, '');
        if (nextVer) {
          setUpdateStatus((prev) => ({
            ...prev,
            current_version: nextVer,
            update_available: false,
          }));
        }
        showToast(`${data.message} — restarting SIMP...`);
        await new Promise((r) => window.setTimeout(r, 950));
        for (let attempt = 0; attempt < 15; attempt++) {
          try {
            const hr = await fetch(`/health?t=${Date.now()}`, { cache: 'no-store' });
            if (hr.ok) {
              const hj = await hr.json();
              const reported = String(hj?.version || '').replace(/^v/, '');
              if (reported && (!nextVer || reported === nextVer)) {
                break;
              }
            }
          } catch {
            // Daemon is still restarting
          }
          await new Promise((r) => window.setTimeout(r, 400));
        }
        window.location.replace(
          `${window.location.pathname}?v=${encodeURIComponent(nextVer || 'latest')}&t=${Date.now()}`
        );
      } else {
        setUpdateStatus((prev) => ({
          ...prev,
          applying: false,
          error: data.error || 'Self-update failed',
        }));
        showToast(`Update failed: ${data.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      setUpdateStatus((prev) => ({
        ...prev,
        applying: false,
        error: e?.message || 'Update request failed',
      }));
      showToast('Update failed — check network connection');
    }
  }, [showToast]);

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
    const searchParam = browserSearch.trim() ? browserSearch.trim() : null;

    defaultSimpClient
      .query<AlbumRecord[]>('get_albums', {
        source: sourceParam,
        mount_root: null,
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
  }, [browserSourceFilter, browserSearch]);

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
    } else {
      checkSimpUpdates(true);
    }
  }, [view, sourceModalOpen, powerModalOpen, snap?.mounts, refreshLibraryData, checkSimpUpdates]);

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

  // 3a. Optical CD-ROM (`cdda://`) Scanner & Eject Handler
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

  // Perform a single non-intrusive optical drive check when opening the Browser or Sources modal while awake
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

  // 3b. Apple Music Cloud Hub data loader
  useEffect(() => {
    if (view !== 'browser' || browserSourceFilter === 'local' || !snap?.apple_authenticated) {
      return;
    }
    if (
      (appleSubTab === 'cloud_playlists' || Boolean(browserSearch.trim())) &&
      cloudPlaylists.length === 0
    ) {
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
    browserSearch,
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
        const fallbackArt = tracks.find(
          (t) => t.art_url && !t.art_url.includes('blobstore.apple.com')
        )?.art_url;
        if (fallbackArt && (!pl.art_url || pl.art_url.includes('blobstore.apple.com'))) {
          setCloudPlaylists((prev) =>
            prev.map((item) => (item.id === pl.id ? { ...item, art_url: fallbackArt } : item))
          );
          setActiveCloudPlaylist((prev) =>
            prev && prev.id === pl.id ? { ...prev, art_url: fallbackArt } : prev
          );
          setBrowserTarget((prev) =>
            prev && prev.kind === 'cloud_playlist' && prev.id === pl.id
              ? { ...prev, art_url: fallbackArt }
              : prev
          );
        }
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

  // 4. Volume helpers
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

  // 6 & 7. Gamepad / Spatial Focus Navigation Hook
  const { applyFocusMarker } = useGamepadNavigation({
    view,
    setView,
    sourceModalOpen,
    setSourceModalOpen,
    powerModalOpen,
    setPowerModalOpen,
    volumePopoverOpen,
    setVolumePopoverOpen,
    brightnessPopoverOpen,
    setBrightnessPopoverOpen,
    confirmHardReset,
    setConfirmHardReset,
    isSleeping,
    setIsSleeping,
    setIsDimmed,
    oskTarget,
    setOskTarget,
    activeCloudAlbum,
    setActiveCloudAlbum,
    activeCloudPlaylist,
    setActiveCloudPlaylist,
    shuffle: Boolean(snap?.shuffle),
    currentVolume,
    applyVolume,
  });

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

      {/* Gamepad & Keyboard Focus Ring Style + Adaptive Input Modality (`data-simp-input="pointer" | "gamepad"`) */}
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
        html[data-simp-input="pointer"] .simp-gp-badge {
          display: none !important;
        }
        html[data-simp-input="pointer"] .simp-gpfocus,
        html[data-simp-input="pointer"] [data-simp-active-focus="true"],
        html[data-simp-input="pointer"] button:focus:not(:focus-visible) {
          outline: none !important;
          box-shadow: none !important;
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
            className="simp-gp-badge"
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
          <span
            className="simp-gp-badge"
            style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'monospace', color: '#71717a' }}
          >
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
          <span
            className="simp-gp-badge"
            style={{ padding: '4px 8px', fontSize: 11, fontFamily: 'monospace', color: '#71717a' }}
          >
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

      {/* Main Viewport: Lock Screen (PlayerView) + Persistent Split Browser (LibraryBrowserView stays mounted to preserve scroll & selection state) */}
      {view === 'lock' && (
        <PlayerView
          snap={snap}
          track={track}
          isPlaying={isPlaying}
          opticalDisc={opticalDisc}
          browserTarget={browserTarget}
          playingContextId={playingContextId}
          setBrowserTarget={setBrowserTarget}
          setView={setView}
          handleOpenFullAppleAlbum={handleOpenFullAppleAlbum}
        />
      )}
      <LibraryBrowserView
        hidden={view !== 'browser'}
        snap={snap}
          track={track}
          albums={albums}
          playlists={playlists}
          browserSourceFilter={browserSourceFilter}
          setBrowserSourceFilter={setBrowserSourceFilter}
          browserSearch={browserSearch}
          setBrowserSearch={setBrowserSearch}
          browserTarget={browserTarget}
          setBrowserTarget={setBrowserTarget}
          browserTracks={browserTracks}
          setBrowserTracks={setBrowserTracks}
          opticalDisc={opticalDisc}
          cdScanning={cdScanning}
          handleScanOpticalDisc={handleScanOpticalDisc}
          handleEjectOpticalDisc={handleEjectOpticalDisc}
          appleSubTab={appleSubTab}
          setAppleSubTab={setAppleSubTab}
          cloudPlaylists={cloudPlaylists}
          setCloudPlaylists={setCloudPlaylists}
          radioStations={radioStations}
          setRadioStations={setRadioStations}
          forYouPlaylists={forYouPlaylists}
          setForYouPlaylists={setForYouPlaylists}
          forYouAlbums={forYouAlbums}
          setForYouAlbums={setForYouAlbums}
          newFeedAlbums={newFeedAlbums}
          setNewFeedAlbums={setNewFeedAlbums}
          newFeedPlaylists={newFeedPlaylists}
          setNewFeedPlaylists={setNewFeedPlaylists}
          newFeedSongs={newFeedSongs}
          setNewFeedSongs={setNewFeedSongs}
          catalogSearchResults={catalogSearchResults}
          cloudLoading={cloudLoading}
          setCloudLoading={setCloudLoading}
          activeCloudAlbum={activeCloudAlbum}
          activeCloudPlaylist={activeCloudPlaylist}
          creatingPlaylist={creatingPlaylist}
          setCreatingPlaylist={setCreatingPlaylist}
          newPlaylistName={newPlaylistName}
          setNewPlaylistName={setNewPlaylistName}
          activePlaylistId={activePlaylistId}
          setActivePlaylistId={setActivePlaylistId}
          playingContextId={playingContextId}
          setPlayingContextId={setPlayingContextId}
          setOskTarget={setOskTarget}
          setSourceModalOpen={setSourceModalOpen}
          setView={setView}
          applyFocusMarker={applyFocusMarker}
          handleCreatePlaylist={handleCreatePlaylist}
          handleAddTracksToPlaylist={handleAddTracksToPlaylist}
          handleRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
          handleDeletePlaylist={handleDeletePlaylist}
          handleDeleteAlbum={handleDeleteAlbum}
          handlePinCloudPlaylist={handlePinCloudPlaylist}
          handlePinCloudAlbum={handlePinCloudAlbum}
          handleOpenCloudPlaylist={handleOpenCloudPlaylist}
          handleOpenFullAppleAlbum={handleOpenFullAppleAlbum}
          handleStartAppleStation={handleStartAppleStation}
        />

      {/* Source Selection, Custom Folder Picker & Authentication Pop-Up Modal */}
      {sourceModalOpen && (
        <SettingsModal
          snap={snap}
          customFolderPath={customFolderPath}
          setCustomFolderPath={setCustomFolderPath}
          setOskTarget={setOskTarget}
          handleAddFolder={handleAddFolder}
          handleRemoveFolder={handleRemoveFolder}
          setView={setView}
          setSourceModalOpen={setSourceModalOpen}
          setPowerModalOpen={setPowerModalOpen}
          opticalDisc={opticalDisc}
          cdScanning={cdScanning}
          handleScanOpticalDisc={handleScanOpticalDisc}
          handleEjectOpticalDisc={handleEjectOpticalDisc}
          setBrowserTarget={setBrowserTarget}
          setBrowserTracks={setBrowserTracks}
          appleAuthCfg={appleAuthCfg}
          setAppleAuthCfg={setAppleAuthCfg}
          appleBusy={appleBusy}
          setAppleBusy={setAppleBusy}
          setBrowserSourceFilter={setBrowserSourceFilter}
          setAppleSubTab={setAppleSubTab}
          refreshLibraryData={refreshLibraryData}
          showToast={showToast}
        />
      )}

      {/* Dedicated Power, Sleep, Reset, Pairing & System Maintenance Modal */}
      {powerModalOpen && (
        <PowerModal
          setPowerModalOpen={setPowerModalOpen}
          setIsSleeping={setIsSleeping}
          dismissConsole={dismissConsole}
          brightnessPct={brightnessPct}
          setBrightnessPct={setBrightnessPct}
          updateStatus={updateStatus}
          checkSimpUpdates={checkSimpUpdates}
          applySimpUpdate={applySimpUpdate}
          appleAuthCfg={appleAuthCfg}
          confirmHardReset={confirmHardReset}
          setConfirmHardReset={setConfirmHardReset}
          refreshLibraryData={refreshLibraryData}
          showToast={showToast}
        />
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
                ✓ Done<span className="simp-gp-badge"> (B)</span>
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
