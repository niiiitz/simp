import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlbumRecord,
  AppleMusicAuthConfig,
  defaultSimpClient,
  OpticalDiscStatus,
  PlaylistRecord,
  SimpStateSnapshot,
  SoundCloudAuthConfig,
  TrackMetadata,
} from '@simp/client';
import { CompanionPairView } from './components/CompanionPairView';
import {
  addAppleItemToCloudLibrary,
  AppleCatalogSearchResults,
  AppleCloudAlbumSummary,
  AppleCloudPlaylistSummary,
  AppleMusicDriver,
  AppleRadioStationSummary,
  AppleRecommendationShelf,
  disconnectAppleMusicCleanSlate,
  fetchAppleCloudPlaylists,
  fetchAppleNewFeed,
  fetchApplePlaylistTracks,
  fetchAppleRadioAndForYou,
  fetchFullAppleAlbum,
  pinAppleAlbumToSimp,
  pinApplePlaylistToSimp,
  searchAppleMusicCatalog,
  setAppleItemFavorited,
} from './drivers/AppleMusicDriver';
import {
  disconnectSoundCloudCleanSlate,
  fetchSoundCloudDiscover,
  fetchSoundCloudLikesAndPlaylists,
  fetchSoundCloudPlaylistTracks,
  fetchSoundCloudStreamAndRadio,
  likeSoundCloudTrack,
  pinSoundCloudPlaylistToSimp,
  searchSoundCloudCatalog,
  setSoundCloudPlaylistLiked,
  SoundCloudCatalogSearchResults,
  SoundCloudPlaylistSummary,
  SoundCloudUserSummary,
  startSoundCloudTrackRadio,
  unlikeSoundCloudTrack,
} from './drivers/SoundCloudDriver';
import { OskTargetKind, useGamepadNavigation } from './hooks/useGamepadNavigation';
import { BrowserTarget, isUiVideoTrack, PlayerView } from './views/PlayerView';
import { LibraryBrowserView } from './views/LibraryBrowserView';
import { SettingsModal, SimpUpdateStatus, SourceVisibilityPrefs } from './views/SettingsModal';
import { QuickHelpModal } from './components/QuickHelpModal';
import { TrackPropertiesModal, TrackPropertiesTarget } from './components/TrackPropertiesModal';
import { ImpIcon } from './components/icons/ImpIcon';
import { applySkinPackToDocument, loadActiveSkinPackId } from './theme/skinPacks';

const isCompanionPairRoute =
  typeof window !== 'undefined' &&
  (window.location.pathname.startsWith('/pair') ||
    new URLSearchParams(window.location.search).get('pair') === '1');

const isDedicatedAppleWorkerRoute =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('worker') === 'apple';

const DedicatedAppleWorkerApp: React.FC = () => {
  useEffect(() => {
    document.title = 'IMP Headless Audio Worker';
    defaultSimpClient.connect();
  }, []);
  return <AppleMusicDriver />;
};

export const App: React.FC = () => {
  useEffect(() => {
    applySkinPackToDocument(loadActiveSkinPackId());
  }, []);
  if (isDedicatedAppleWorkerRoute) {
    return <DedicatedAppleWorkerApp />;
  }
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
  const [initialOpenFoldersAccounts, setInitialOpenFoldersAccounts] = useState(false);
  const [quickHelpOpen, setQuickHelpOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('simp_oobe_help_seen_v1') !== '1';
    } catch {
      return false;
    }
  });
  const [isSleeping, setIsSleeping] = useState(false);
  const [confirmHardReset, setConfirmHardReset] = useState(false);

  // Library & Playlist Browser state
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [browserSourceFilter, setBrowserSourceFilterState] = useState<
    'all' | 'local' | 'apple_music' | 'soundcloud' | 'internet_archive'
  >('all');
  const [selectedSources, setSelectedSources] = useState<
    Array<'local' | 'apple_music' | 'soundcloud' | 'internet_archive'>
  >([]);
  const setBrowserSourceFilter: React.Dispatch<
    React.SetStateAction<'all' | 'local' | 'apple_music' | 'soundcloud' | 'internet_archive'>
  > = useCallback((action) => {
    setBrowserSourceFilterState((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      setSelectedSources(next === 'all' ? [] : [next]);
      return next;
    });
  }, []);
  const [browserSearch, setBrowserSearch] = useState('');
  const [searchPreferredSource, setSearchPreferredSource] = useState<
    'local' | 'apple_music' | 'soundcloud' | 'internet_archive' | null
  >(null);
  const [browserTarget, setBrowserTarget] = useState<BrowserTarget | null>(null);
  const [browserTracks, setBrowserTracks] = useState<TrackMetadata[]>([]);

  // Optical CD-ROM (`cdda://`) drive status (scanned only on-demand / when CD source is in view & awake)
  const [opticalDisc, setOpticalDisc] = useState<OpticalDiscStatus | null>(null);
  const [cdScanning, setCdScanning] = useState(false);

  // Source Visibility preferences (Show / Hide Internet Archive, Apple Music, SoundCloud, Optical Drive)
  const [sourceVisibility, setSourceVisibility] = useState<SourceVisibilityPrefs>(() => {
    try {
      const raw = window.localStorage.getItem('simp_source_visibility_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          internet_archive: parsed.internet_archive !== false,
          apple_music: parsed.apple_music !== false,
          soundcloud: parsed.soundcloud !== false,
          optical_drive: parsed.optical_drive === true,
        };
      }
    } catch {
      // Ignore storage access errors
    }
    return {
      internet_archive: true,
      apple_music: true,
      soundcloud: true,
      optical_drive: false,
    };
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('simp_source_visibility_v2', JSON.stringify(sourceVisibility));
    } catch {
      // Ignore storage access errors
    }
  }, [sourceVisibility]);

  // Recently Played history (`simp_recently_played_v1` + SQLite `/api/history`, max 40 items)
  const [recentlyPlayed, setRecentlyPlayed] = useState<TrackMetadata[]>(() => {
    try {
      const raw = window.localStorage.getItem('simp_recently_played_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.slice(0, 40);
      }
    } catch {
      // Ignore storage access errors
    }
    return [];
  });
  const [favoritedUris, setFavoritedUris] = useState<string[]>([]);

  // Hydrate persistent SQLite `play_history` and `local_favorites` on mount
  useEffect(() => {
    fetch('http://127.0.0.1:18888/api/history?limit=40')
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && Array.isArray(d.data) && d.data.length > 0) {
          setRecentlyPlayed((prev) => {
            const seen = new Set<string>();
            const merged: TrackMetadata[] = [];
            for (const item of [...d.data, ...prev]) {
              if (item?.uri && !seen.has(item.uri)) {
                seen.add(item.uri);
                merged.push(item);
              }
            }
            const next = merged.slice(0, 40);
            try {
              window.localStorage.setItem('simp_recently_played_v1', JSON.stringify(next));
            } catch {}
            return next;
          });
        }
      })
      .catch(() => {});

    fetch('http://127.0.0.1:18888/api/favorites')
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && Array.isArray(d.uris)) {
          setFavoritedUris(d.uris);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const cur = snap?.current_track;
    if (!cur?.uri || !snap?.is_playing) return;
    fetch('http://127.0.0.1:18888/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cur),
    }).catch(() => {});
    setRecentlyPlayed((prev) => {
      if (prev[0]?.uri === cur.uri) return prev;
      const next = [cur, ...prev.filter((t) => t.uri !== cur.uri)].slice(0, 40);
      try {
        window.localStorage.setItem('simp_recently_played_v1', JSON.stringify(next));
      } catch {
        // Ignore storage access errors
      }
      return next;
    });
  }, [snap?.current_track?.uri, snap?.is_playing]);

  // Apple Music Cloud Hub state
  const [appleSubTab, setAppleSubTab] = useState<
    'pinned' | 'for_you' | 'cloud_playlists' | 'new' | 'radio'
  >('pinned');
  const [cloudPlaylists, setCloudPlaylists] = useState<AppleCloudPlaylistSummary[]>([]);
  const [radioStations, setRadioStations] = useState<AppleRadioStationSummary[]>([]);
  const [personalRadioStations, setPersonalRadioStations] = useState<AppleRadioStationSummary[]>([]);
  const [liveRadioStations, setLiveRadioStations] = useState<AppleRadioStationSummary[]>([]);
  const [artistRadioShows, setArtistRadioShows] = useState<AppleCloudPlaylistSummary[]>([]);
  const [clubMixes, setClubMixes] = useState<AppleCloudPlaylistSummary[]>([]);
  const [genreRadioStations, setGenreRadioStations] = useState<AppleRadioStationSummary[]>([]);
  const [forYouPlaylists, setForYouPlaylists] = useState<AppleCloudPlaylistSummary[]>([]);
  const [forYouAlbums, setForYouAlbums] = useState<AppleCloudAlbumSummary[]>([]);
  const [forYouNewReleases, setForYouNewReleases] = useState<AppleCloudAlbumSummary[]>([]);
  const [forYouShelves, setForYouShelves] = useState<AppleRecommendationShelf[]>([]);
  const [appleRecentlyPlayedTracks, setAppleRecentlyPlayedTracks] = useState<TrackMetadata[]>([]);
  const [newFeedRecentReleases, setNewFeedRecentReleases] = useState<AppleCloudAlbumSummary[]>([]);
  const [newFeedAlbums, setNewFeedAlbums] = useState<AppleCloudAlbumSummary[]>([]);
  const [newFeedPlaylists, setNewFeedPlaylists] = useState<AppleCloudPlaylistSummary[]>([]);
  const [newFeedSongs, setNewFeedSongs] = useState<TrackMetadata[]>([]);
  const [catalogSearchResults, setCatalogSearchResults] = useState<AppleCatalogSearchResults>({
    songs: [],
    albums: [],
    playlists: [],
    stations: [],
    artists: [],
  });
  const [cloudLoading, setCloudLoading] = useState(false);
  const [activeCloudAlbum, setActiveCloudAlbum] = useState<AppleCloudAlbumSummary | null>(null);
  const [activeCloudPlaylist, setActiveCloudPlaylist] = useState<AppleCloudPlaylistSummary | null>(null);

  // SoundCloud Cloud Hub state
  const [soundCloudSubTab, setSoundCloudSubTab] = useState<
    'pinned' | 'likes_sets' | 'stream_radio' | 'trending'
  >('trending');
  const [scLikedTracks, setScLikedTracks] = useState<TrackMetadata[]>([]);
  const [scPlaylists, setScPlaylists] = useState<SoundCloudPlaylistSummary[]>([]);
  const [scStreamTracks, setScStreamTracks] = useState<TrackMetadata[]>([]);
  const [scStreamPlaylists, setScStreamPlaylists] = useState<SoundCloudPlaylistSummary[]>([]);
  const [scTrendingTracks, setScTrendingTracks] = useState<TrackMetadata[]>([]);
  const [scTrendingMixes, setScTrendingMixes] = useState<TrackMetadata[]>([]);
  const [scTrendingPlaylists, setScTrendingPlaylists] = useState<SoundCloudPlaylistSummary[]>([]);
  const [scMoreOfWhatYouLike, setScMoreOfWhatYouLike] = useState<TrackMetadata[]>([]);
  const [scFreshUploads, setScFreshUploads] = useState<TrackMetadata[]>([]);
  const [scRecommendedArtists, setScRecommendedArtists] = useState<SoundCloudUserSummary[]>([]);
  const [scDiscoverNextHref, setScDiscoverNextHref] = useState<string | null>(null);
  const [scSelectedGenre, setScSelectedGenre] = useState<string>('');
  const [scCatalogSearchResults, setScCatalogSearchResults] =
    useState<SoundCloudCatalogSearchResults>({
      songs: [],
      playlists: [],
      users: [],
      next_tracks_href: null,
    });
  const [activeScPlaylist, setActiveScPlaylist] = useState<SoundCloudPlaylistSummary | null>(null);

  // Playlist creation, active playback context & target state
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [activePlaylistId, setActivePlaylistId] = useState<string>('');
  const [playingContextId, setPlayingContextId] = useState<string>('');

  // Custom folder input inside Source Modal + Controller On-Screen Keyboard (OSK) state
  const [customFolderPath, setCustomFolderPath] = useState('');
  const [oskTarget, setOskTarget] = useState<OskTargetKind>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [pendingHybridAdd, setPendingHybridAdd] = useState<{
    uris: string[];
    label: string;
    trackMetadata?: TrackMetadata[];
    creatingNew?: boolean;
  } | null>(null);

  // Automatically dismiss the On-Screen Keyboard whenever its target context closes or view switches to Player
  useEffect(() => {
    if (!oskTarget) return;
    if (oskTarget === 'search' && view !== 'browser') {
      setOskTarget(null);
      return;
    }
    if (oskTarget === 'folder' && !sourceModalOpen && !powerModalOpen) {
      setOskTarget(null);
      return;
    }
    if (oskTarget === 'playlist' && !creatingPlaylist && !pendingHybridAdd) {
      setOskTarget(null);
      return;
    }
    if (view !== 'browser' && !sourceModalOpen && !powerModalOpen && !pendingHybridAdd) {
      setOskTarget(null);
    }
  }, [oskTarget, view, sourceModalOpen, powerModalOpen, creatingPlaylist, pendingHybridAdd]);

  // Dismiss the On-Screen Keyboard when clicking outside it (and outside its target input) or pressing Escape
  useEffect(() => {
    if (!oskTarget) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-osk-root="true"]') || target.closest('[data-osk-input]')) {
        return;
      }
      setOskTarget(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOskTarget(null);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [oskTarget]);

  // Apple Music & SoundCloud Auth Modal state
  const [appleAuthCfg, setAppleAuthCfg] = useState<AppleMusicAuthConfig | null>(null);
  const [appleBusy, setAppleBusy] = useState(false);
  const [soundcloudAuthCfg, setSoundcloudAuthCfg] = useState<SoundCloudAuthConfig | null>(null);
  const [soundcloudBusy, setSoundcloudBusy] = useState(false);
  const scAutoClientAuthRef = useRef(false);

  // OLED auto-dim, active luminance percentage, popovers & sub-pixel orbit state
  const [isDimmed, setIsDimmed] = useState(false);
  const [brightnessPct, setBrightnessPct] = useState<number>(() => {
    try {
      const saved = window.localStorage.getItem('simp_brightness_pct_v2');
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
        if (!window.localStorage.getItem('simp_brightness_pct_v2')) {
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
        window.localStorage.setItem('simp_brightness_pct_v2', String(brightnessPct));
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

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  const [updateStatus, setUpdateStatus] = useState<SimpUpdateStatus>({ channel: 'stable' });

  useEffect(() => {
    if (snap?.daemon_version) {
      setUpdateStatus((prev) =>
        prev.current_version === snap.daemon_version
          ? prev
          : { ...prev, current_version: snap.daemon_version }
      );
    }
  }, [snap?.daemon_version]);

  const resolveDaemonBaseUrl = useCallback(() => {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      const host = window.location.hostname;
      if (
        window.location.protocol === 'http:' &&
        host !== 'steamloopback.host' &&
        host !== '127.0.0.1' &&
        host !== 'localhost'
      ) {
        const port = window.location.port === '1420' ? '18888' : window.location.port || '18888';
        return `http://${host}:${port}`;
      }
    }
    return 'http://127.0.0.1:18888';
  }, []);

  const compareSemverStrings = useCallback((currentRaw: string, candidateRaw: string): boolean => {
    const parseTuple = (v: string): [number, number, number, number, number] => {
      const cleaned = v.trim().replace(/^v/i, '');
      const [core, pre = ''] = cleaned.split('-', 2);
      const parts = core.split('.').map((n) => parseInt(n, 10) || 0);
      const major = parts[0] || 0;
      const minor = parts[1] || 0;
      const patch = parts[2] || 0;
      if (!pre) return [major, minor, patch, 1, 0];
      const preParts = pre.split('.');
      const preNum = parseInt(preParts[preParts.length - 1] || '0', 10) || 0;
      return [major, minor, patch, 0, preNum];
    };
    const cur = parseTuple(currentRaw);
    const cand = parseTuple(candidateRaw);
    for (let i = 0; i < 5; i++) {
      if (cand[i] !== cur[i]) return cand[i] > cur[i];
    }
    return false;
  }, []);

  const checkSimpUpdates = useCallback(async (_silent = false) => {
    setUpdateStatus((prev) => ({ ...prev, checking: true, error: undefined }));
    const base = resolveDaemonBaseUrl();
    try {
      const resp = await fetch(`${base}/api/update/check?t=${Date.now()}`, { cache: 'no-store' });
      const text = await resp.text();
      if (text.trim().startsWith('{')) {
        const data = JSON.parse(text);
        if (data.ok) {
          setUpdateStatus({
            current_version: data.current_version,
            latest_version: data.latest_version,
            latest_tag: data.latest_tag,
            update_available: Boolean(data.update_available),
            target_arch: data.target_arch,
            channel: data.channel || 'stable',
            checking: false,
          });
          return;
        } else if (data.error && !String(data.error).includes('<!DOCTYPE')) {
          setUpdateStatus((prev) => ({
            ...prev,
            current_version: data.current_version || prev.current_version,
            target_arch: data.target_arch || prev.target_arch,
            channel: data.channel || prev.channel || 'stable',
            checking: false,
            error: data.error,
          }));
          return;
        }
      }

      // Fallback: query GitHub Releases API directly if the daemon endpoint returned HTML or was unreachable
      const ghResp = await fetch('https://api.github.com/repos/niiiitz/simp/releases?per_page=10', {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store',
      });
      const ghText = await ghResp.text();
      if (!ghText.trim().startsWith('[')) {
        throw new Error('Could not query GitHub Releases API');
      }
      const releases = JSON.parse(ghText) as Array<{ tag_name?: string; draft?: boolean }>;
      const valid = releases.filter((r) => !r.draft && r.tag_name);
      if (valid.length === 0) {
        throw new Error('No published releases found on GitHub');
      }
      const newestTag = String(valid[0].tag_name || '');
      const latestVer = newestTag.replace(/^v/i, '');
      setUpdateStatus((prev) => {
        const curVer = prev.current_version || snap?.daemon_version || '';
        const isNewer = curVer ? compareSemverStrings(curVer, latestVer) : false;
        return {
          ...prev,
          current_version: curVer || undefined,
          latest_version: latestVer,
          latest_tag: newestTag,
          update_available: isNewer,
          checking: false,
          error: undefined,
        };
      });
    } catch (e: any) {
      const rawMsg = String(e?.message || 'Could not reach update server');
      const cleanMsg =
        rawMsg.includes('<!DOCTYPE') || rawMsg.includes('Unexpected token')
          ? 'Daemon binary needs restart to enable self-update endpoint'
          : rawMsg;
      setUpdateStatus((prev) => ({
        ...prev,
        checking: false,
        error: cleanMsg,
      }));
    }
  }, [resolveDaemonBaseUrl, compareSemverStrings, snap?.daemon_version]);

  const applySimpUpdate = useCallback(async () => {
    setUpdateStatus((prev) => ({ ...prev, applying: true, error: undefined }));
    showToast('Downloading & installing latest IMP release from GitHub...');
    const base = resolveDaemonBaseUrl();
    try {
      const resp = await fetch(`${base}/api/update/apply`, { method: 'POST', cache: 'no-store' });
      const text = await resp.text();
      if (!text.trim().startsWith('{')) {
        throw new Error('Daemon binary does not support /api/update/apply yet — rebuild or restart simp --daemon');
      }
      const data = JSON.parse(text);
      if (data.ok) {
        const nextVer = String(data.updated_version || '').replace(/^v/, '');
        if (nextVer) {
          setUpdateStatus((prev) => ({
            ...prev,
            current_version: nextVer,
            update_available: false,
          }));
        }
        showToast(`${data.message} — restarting IMP...`);
        await new Promise((r) => window.setTimeout(r, 950));
        for (let attempt = 0; attempt < 15; attempt++) {
          try {
            const hr = await fetch(`${base}/health?t=${Date.now()}`, { cache: 'no-store' });
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
  }, [resolveDaemonBaseUrl, showToast]);

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

  // 1b. Auto-reload open UI window when background daemon restarts on a new version (e.g. after CLI `simp update`)
  const knownDaemonVersionRef = useRef<string | null>(null);
  useEffect(() => {
    const reported = (snap?.daemon_version || '').trim().replace(/^v/, '');
    if (!reported) return;
    if (!knownDaemonVersionRef.current) {
      knownDaemonVersionRef.current = reported;
      return;
    }
    if (knownDaemonVersionRef.current !== reported && !updateStatus.applying) {
      knownDaemonVersionRef.current = reported;
      window.location.replace(
        `${window.location.pathname}?v=${encodeURIComponent(reported)}&t=${Date.now()}`
      );
    }
  }, [snap?.daemon_version, updateStatus.applying]);

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
    defaultSimpClient
      .getSoundCloudAuthConfig()
      .then((cfg) => {
        setSoundcloudAuthCfg(cfg);
        // Auto-bootstrap Tier 1 Public Mode (client_credentials) if credentials exist and not yet authenticated
        if (
          cfg.configured &&
          !cfg.soundcloud_authenticated &&
          !scAutoClientAuthRef.current
        ) {
          scAutoClientAuthRef.current = true;
          fetch('/api/soundcloud/client-auth', { method: 'POST' })
            .then(() => defaultSimpClient.getSoundCloudAuthConfig())
            .then((nextCfg) => setSoundcloudAuthCfg(nextCfg))
            .catch(() => {});
        }
      })
      .catch(() => {});
    if (sourceModalOpen || powerModalOpen) {
      defaultSimpClient
        .getAppleMusicAuthConfig()
        .then((cfg) => {
          setAppleAuthCfg(cfg);
        })
        .catch(() => {});
    }
    if (!sourceModalOpen && !powerModalOpen) {
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
    } else if (
      browserTarget.kind === 'cloud_playlist' &&
      browserTarget.id !== 'active_queue' &&
      activeCloudPlaylist?.id !== browserTarget.id
    ) {
      fetchApplePlaylistTracks(browserTarget.id)
        .then((tracks) => {
          setBrowserTracks(tracks);
        })
        .catch(() => {});
    } else if (
      browserTarget.kind === 'soundcloud_playlist' &&
      browserTarget.id !== 'active_queue' &&
      activeScPlaylist?.id !== browserTarget.id
    ) {
      fetchSoundCloudPlaylistTracks(browserTarget.id)
        .then((tracks) => {
          setBrowserTracks(tracks);
        })
        .catch(() => {});
    } else if (
      browserTarget.kind === 'cloud_album' &&
      activeCloudAlbum?.id !== browserTarget.id
    ) {
      fetchFullAppleAlbum({ albumId: browserTarget.id })
        .then(({ album, tracks }) => {
          setActiveCloudAlbum(album);
          setBrowserTracks(tracks);
        })
        .catch(() => {});
    }
  }, [
    browserTarget,
    browserSearch,
    opticalDisc,
    activeCloudPlaylist?.id,
    activeScPlaylist?.id,
    activeCloudAlbum?.id,
  ]);

  // 3a. Optical CD-ROM (`cdda://`) & DVD-Video Scanner & Eject Handler
  const handleScanOpticalDisc = useCallback(
    async (forceRefresh = false, silent = false) => {
      if (!silent) {
        setCdScanning(true);
      }
      try {
        const res = await defaultSimpClient.scanOpticalDisc(
          forceRefresh,
          opticalDisc?.drive_present ? opticalDisc.device_path || undefined : undefined
        );
        setOpticalDisc(res);
        setBrowserTarget((prev) => {
          if (prev?.kind === 'cdda') {
            if (!res.is_audio_cd && !res.is_dvd_video) {
              return null;
            }
            if (res.is_dvd_video) {
              return {
                kind: 'cdda',
                id: res.disc_id || res.device_path || '/dev/sr0',
                title: `📀 ${res.album_title || 'DVD Video'}`,
                subtitle: `${res.artist_name || 'DVD-Video'}${
                  res.release_year ? ` • ${res.release_year}` : ''
                }`,
                art_url: res.art_url,
              };
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
            is_dvd_video: false,
            dvd_titles: [],
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
    if (isSleeping || isDimmed || !sourceVisibility.optical_drive) return;
    const isCdActiveInView =
      sourceModalOpen || (view === 'browser' && browserTarget?.kind === 'cdda');
    const isStreamingCd =
      snap?.is_playing && snap?.current_track?.source === 'cdda';

    if ((view === 'browser' || sourceModalOpen) && !opticalDisc && !isStreamingCd) {
      handleScanOpticalDisc(false, true);
    }

    if (!isCdActiveInView || isStreamingCd || opticalDisc?.disc_present) return;
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
    sourceVisibility.optical_drive,
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
      (appleSubTab === 'for_you' || appleSubTab === 'radio') &&
      radioStations.length === 0 &&
      forYouPlaylists.length === 0 &&
      forYouAlbums.length === 0
    ) {
      setCloudLoading(true);
      fetchAppleRadioAndForYou()
        .then((res) => {
          setRadioStations(res.stations);
          setPersonalRadioStations(res.personal_stations || []);
          setLiveRadioStations(res.live_stations || []);
          setArtistRadioShows(res.artist_shows || []);
          setClubMixes(res.club_mixes || []);
          setGenreRadioStations(res.genre_stations || []);
          setForYouPlaylists(res.playlists);
          setForYouAlbums(res.albums);
          setForYouNewReleases(res.new_releases || []);
          setForYouShelves(res.shelves || []);
          setAppleRecentlyPlayedTracks(res.recently_played || []);
        })
        .catch((err: any) => showToast(err?.message || 'Failed to load For You & Radio'))
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
          setNewFeedRecentReleases(res.recent_releases || []);
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

  // 3c. SoundCloud Cloud Hub data loader
  useEffect(() => {
    if (view !== 'browser' || browserSourceFilter !== 'soundcloud') {
      return;
    }
    if (
      soundCloudSubTab === 'likes_sets' &&
      scLikedTracks.length === 0 &&
      scPlaylists.length === 0
    ) {
      setCloudLoading(true);
      fetchSoundCloudLikesAndPlaylists()
        .then((res) => {
          setScLikedTracks(res.likedTracks);
          setScPlaylists(res.playlists);
        })
        .catch(() => {})
        .finally(() => setCloudLoading(false));
    } else if (
      soundCloudSubTab === 'stream_radio' &&
      scStreamTracks.length === 0 &&
      scStreamPlaylists.length === 0
    ) {
      setCloudLoading(true);
      fetchSoundCloudStreamAndRadio()
        .then((res) => {
          setScStreamTracks(res.streamTracks);
          setScStreamPlaylists(res.streamPlaylists);
        })
        .catch(() => {})
        .finally(() => setCloudLoading(false));
    } else if (
      soundCloudSubTab === 'trending' &&
      scTrendingTracks.length === 0 &&
      scTrendingMixes.length === 0 &&
      scTrendingPlaylists.length === 0
    ) {
      setCloudLoading(true);
      fetchSoundCloudDiscover(scSelectedGenre || undefined)
        .then((res) => {
          setScTrendingTracks(res.tracks);
          setScTrendingMixes(res.mixes);
          setScTrendingPlaylists(res.playlists);
          setScMoreOfWhatYouLike(res.more_of_what_you_like || []);
          setScFreshUploads(res.fresh_uploads || []);
          setScRecommendedArtists(res.recommended_artists || []);
          setScDiscoverNextHref(res.next_tracks_href || null);
        })
        .catch((err: any) =>
          showToast(err?.message || 'Failed to load SoundCloud Trending & Mixes')
        )
        .finally(() => setCloudLoading(false));
    }
  }, [
    view,
    browserSourceFilter,
    snap?.soundcloud_authenticated,
    soundcloudAuthCfg?.soundcloud_authenticated,
    soundCloudSubTab,
    scLikedTracks.length,
    scPlaylists.length,
    scStreamTracks.length,
    scStreamPlaylists.length,
    scTrendingTracks.length,
    scTrendingMixes.length,
    scTrendingPlaylists.length,
    scSelectedGenre,
    showToast,
  ]);

  // Debounced live Apple Music & SoundCloud Catalog Search
  useEffect(() => {
    const term = browserSearch.trim();
    if (!term) {
      setCatalogSearchResults({ songs: [], albums: [], playlists: [], stations: [] });
      setScCatalogSearchResults({ songs: [], playlists: [] });
      return;
    }
    const isAppleIncluded =
      sourceVisibility.apple_music &&
      (selectedSources.length === 0
        ? browserSourceFilter === 'all' || browserSourceFilter === 'apple_music'
        : selectedSources.includes('apple_music'));
    const isScIncluded =
      sourceVisibility.soundcloud &&
      (selectedSources.length === 0
        ? browserSourceFilter === 'all' || browserSourceFilter === 'soundcloud'
        : selectedSources.includes('soundcloud'));
    if (!isAppleIncluded && !isScIncluded) {
      setCatalogSearchResults({ songs: [], albums: [], playlists: [], stations: [] });
      setScCatalogSearchResults({ songs: [], playlists: [] });
      return;
    }
    const timer = window.setTimeout(() => {
      const promises: Promise<any>[] = [];
      if (isAppleIncluded && snap?.apple_authenticated) {
        promises.push(
          searchAppleMusicCatalog(term)
            .then((res) => setCatalogSearchResults(res))
            .catch(() => {})
        );
      } else {
        setCatalogSearchResults({ songs: [], albums: [], playlists: [], stations: [] });
      }
      if (isScIncluded) {
        promises.push(
          searchSoundCloudCatalog(term)
            .then((res) => setScCatalogSearchResults(res))
            .catch(() => {})
        );
      } else {
        setScCatalogSearchResults({ songs: [], playlists: [] });
      }
      if (promises.length > 0) {
        setCloudLoading(true);
        Promise.all(promises).finally(() => setCloudLoading(false));
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    browserSearch,
    browserSourceFilter,
    selectedSources,
    sourceVisibility.apple_music,
    sourceVisibility.soundcloud,
    snap?.apple_authenticated,
    snap?.soundcloud_authenticated,
    soundcloudAuthCfg?.soundcloud_authenticated,
  ]);

  const handleOpenSoundCloudPlaylist = useCallback(
    async (pl: SoundCloudPlaylistSummary) => {
      const initialTracks = pl.tracks && pl.tracks.length > 0 ? pl.tracks : [];
      setActiveScPlaylist(pl);
      setActiveCloudPlaylist(null);
      setActiveCloudAlbum(null);
      setBrowserTracks(initialTracks);
      setBrowserTarget({
        kind: 'soundcloud_playlist',
        id: pl.id,
        title: `☁️ ${pl.name}`,
        subtitle: pl.description,
        art_url: pl.art_url,
      });
      setCloudLoading(true);
      try {
        const tracks = await fetchSoundCloudPlaylistTracks(pl.id);
        if (tracks.length > 0) {
          setBrowserTracks(tracks);
        } else if (initialTracks.length === 0) {
          setBrowserTracks([]);
          showToast(`No streamable tracks available in "${pl.name}"`);
        }
      } catch (err: any) {
        if (initialTracks.length === 0) {
          setBrowserTracks([]);
          showToast(err?.message || 'Could not load SoundCloud set tracks');
        }
      } finally {
        setCloudLoading(false);
      }
    },
    [showToast]
  );

  const handleStartSoundCloudTrackRadio = useCallback(
    (seedTrack: TrackMetadata) => {
      setPlayingContextId(`sc:radio:${seedTrack.uri}`);
      startSoundCloudTrackRadio(seedTrack.uri, seedTrack.title, showToast);
      setView('lock');
    },
    [showToast]
  );

  const handleOpenCloudPlaylist = useCallback(
    async (pl: AppleCloudPlaylistSummary) => {
      setActiveCloudPlaylist(pl);
      setActiveScPlaylist(null);
      setActiveCloudAlbum(null);
      setBrowserTracks([]);
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
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('simp-open-collection-in-library'));
        }, 0);
      } catch (err: any) {
        if (snap?.queue && snap.queue.length > 0) {
          setBrowserTracks(snap.queue);
          setBrowserTarget({
            kind: 'cloud_playlist',
            id: 'active_queue',
            title: `🍎 ${params.fallbackTitle || 'Active Playback Queue'}`,
            subtitle: `${snap.queue.length} tracks in queue`,
            art_url: snap.current_track?.art_url || null,
          });
          setView('browser');
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('simp-open-collection-in-library'));
          }, 0);
        } else {
          showToast(err?.message || 'Could not resolve full catalog album');
        }
      } finally {
        setCloudLoading(false);
      }
    },
    [showToast, snap?.queue, snap?.current_track?.art_url]
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

  const isActiveVideoPlayback = Boolean(
    isUiVideoTrack(snap?.current_track) && snap?.is_playing && view === 'lock'
  );

  const isOverlayOrPopoverOpen = Boolean(
    sourceModalOpen ||
      powerModalOpen ||
      volumePopoverOpen ||
      brightnessPopoverOpen ||
      quickHelpOpen ||
      oskTarget ||
      pendingHybridAdd
  );

  useEffect(() => {
    let timerId: number | undefined;
    const resetIdleTimer = () => {
      setIsDimmed(false);
      if (timerId) window.clearTimeout(timerId);
      if (view === 'lock' && !isOverlayOrPopoverOpen) {
        timerId = window.setTimeout(() => setIsDimmed(true), 6_000);
      }
    };

    if (!isDimmed) {
      resetIdleTimer();
    }
    window.addEventListener('pointerdown', resetIdleTimer, { passive: true });
    window.addEventListener('pointermove', resetIdleTimer, { passive: true });
    window.addEventListener('wheel', resetIdleTimer, { passive: true });
    window.addEventListener('keydown', resetIdleTimer);
    window.addEventListener('touchstart', resetIdleTimer, { passive: true });
    window.addEventListener('simp-wake-idle', resetIdleTimer);

    let lastGpSig = '';
    const gpPoll =
      view === 'lock'
        ? window.setInterval(() => {
            const pads = navigator.getGamepads ? navigator.getGamepads() : [];
            for (const p of pads) {
              if (!p) continue;
              const pressed = p.buttons.map((b) => (b.pressed ? '1' : '0')).join('');
              const axes = p.axes.map((a) => (Math.abs(a) > 0.3 ? a.toFixed(1) : '0')).join(',');
              const sig = `${pressed}|${axes}`;
              if (lastGpSig && sig !== lastGpSig) {
                resetIdleTimer();
              }
              lastGpSig = sig;
              break;
            }
          }, 150)
        : undefined;

    return () => {
      if (timerId) window.clearTimeout(timerId);
      if (gpPoll) window.clearInterval(gpPoll);
      window.removeEventListener('pointerdown', resetIdleTimer);
      window.removeEventListener('pointermove', resetIdleTimer);
      window.removeEventListener('wheel', resetIdleTimer);
      window.removeEventListener('keydown', resetIdleTimer);
      window.removeEventListener('touchstart', resetIdleTimer);
      window.removeEventListener('simp-wake-idle', resetIdleTimer);
    };
  }, [view, isOverlayOrPopoverOpen, isDimmed]);

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

  const [trackPropertiesTarget, setTrackPropertiesTarget] =
    useState<TrackPropertiesTarget | null>(null);
  const [expiredAuthAlert, setExpiredAuthAlert] = useState<{
    provider: 'apple' | 'soundcloud';
    label: string;
    reason?: string;
  } | null>(null);
  const [pendingDroppedFolder, setPendingDroppedFolder] = useState<string | null>(null);

  useEffect(() => {
    const onOpenTrackProps = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (detail && detail.uri) {
        setTrackPropertiesTarget(detail);
      }
    };
    window.addEventListener('simp-open-track-properties', onOpenTrackProps);
    return () => window.removeEventListener('simp-open-track-properties', onOpenTrackProps);
  }, []);

  // Proactive Auth Probe (startup + every 30 minutes)
  useEffect(() => {
    const runProbe = async () => {
      if (localStorage.getItem('simp_mute_auth_reminders') === '1') return;
      try {
        const resp = await fetch('http://127.0.0.1:18888/api/auth/probe');
        const json = await resp.json();
        if (!json?.ok || !json.data) return;
        const { apple, soundcloud } = json.data;
        if (apple?.was_connected && apple?.expired) {
          setExpiredAuthAlert({
            provider: 'apple',
            label: 'Apple Music',
            reason: apple.reason,
          });
        } else if (soundcloud?.was_connected && soundcloud?.expired) {
          setExpiredAuthAlert({
            provider: 'soundcloud',
            label: 'SoundCloud',
            reason: soundcloud.reason,
          });
        }
      } catch {}
    };
    const initialTimer = window.setTimeout(runProbe, 3500);
    const interval = window.setInterval(runProbe, 30 * 60 * 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, []);

  // Global Window Drag-and-Drop Interceptor (Folder Ingestion Only — Never Navigate or Play Unindexed Files)
  useEffect(() => {
    const supportedExts = new Set([
      'flac',
      'mp3',
      'wav',
      'm4a',
      'aac',
      'ogg',
      'opus',
      'aiff',
      'aif',
      'wma',
      'alac',
      'mp4',
      'mkv',
      'webm',
      'mov',
      'avi',
      'm4v',
    ]);

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const dt = e.dataTransfer;
      if (!dt) return;

      const items = Array.from(dt.items || []);
      const files = Array.from(dt.files || []);
      let hasDirectory = false;
      let droppedFolderName = '';
      let droppedDirEntry: any = null;
      for (const item of items) {
        const entry = (item as any).webkitGetAsEntry ? (item as any).webkitGetAsEntry() : null;
        if (entry && entry.isDirectory) {
          hasDirectory = true;
          if (!droppedDirEntry) droppedDirEntry = entry;
          if (!droppedFolderName && entry.name) {
            droppedFolderName = String(entry.name);
          }
        }
      }

      let supportedFileFound = false;
      let unsupportedExt: string | null = null;
      let sampleMediaFile: File | null = null;
      for (const f of files) {
        const parts = f.name.split('.');
        if (parts.length > 1) {
          const ext = parts[parts.length - 1].toLowerCase();
          if (supportedExts.has(ext)) {
            supportedFileFound = true;
            if (!sampleMediaFile) sampleMediaFile = f;
          } else {
            unsupportedExt = `.${ext}`;
          }
        }
      }

      if (!hasDirectory && !supportedFileFound && unsupportedExt) {
        showToast(
          `Unsupported filetype (${unsupportedExt}) — drop audio/video files or a media folder to index`,
        );
        return;
      }

      const stripVerbatimPrefix = (p: string) =>
        p.replace(/^(\\\\?\\\?\\|\/\/\?\/|\/\?\/)/, '');

      // Extract native filesystem path if exposed by Tauri/WebView or URI list
      let extractedPath = '';
      const uriList = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
      const firstLine = uriList
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('#'));

      if (files.length > 0 && (files[0] as any).path) {
        const rawPath = stripVerbatimPrefix(String((files[0] as any).path));
        if (hasDirectory) {
          extractedPath = rawPath;
        } else {
          extractedPath = rawPath.replace(/[\\/][^\\/]+$/, '');
        }
      } else if (firstLine) {
        const cleaned = stripVerbatimPrefix(
          decodeURIComponent(firstLine.replace(/^file:\/\/\/?/i, '')),
        );
        if (cleaned.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(cleaned)) {
          extractedPath = hasDirectory ? cleaned : cleaned.replace(/[\\/][^\\/]+$/, '');
        }
      }

      const resolveViaDaemon = (childHint: string | null) => {
        fetch('/api/fs/resolve-drop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folder_name:
              droppedFolderName || (hasDirectory && files[0]?.name ? files[0].name : null),
            child_name: childHint,
            file_name: sampleMediaFile ? sampleMediaFile.name : null,
            file_size: sampleMediaFile ? sampleMediaFile.size : null,
            uri_hint: firstLine || null,
          }),
        })
          .then((r) => r.json())
          .then((res) => {
            if (res && res.ok && res.resolved_folder) {
              setPendingDroppedFolder(stripVerbatimPrefix(String(res.resolved_folder)));
            } else {
              setSourceModalOpen(true);
              showToast('Select the folder in Local Folders -> [Browse...] to index it into IMP');
            }
          })
          .catch(() => {
            setSourceModalOpen(true);
            showToast('Select the folder in Local Folders -> [Browse...] to index it into IMP');
          });
      };

      if (extractedPath) {
        setPendingDroppedFolder(extractedPath);
      } else if (hasDirectory || supportedFileFound) {
        if (droppedDirEntry && typeof droppedDirEntry.createReader === 'function') {
          let settled = false;
          const finish = (childHint: string | null) => {
            if (settled) return;
            settled = true;
            resolveViaDaemon(childHint);
          };
          const timer = window.setTimeout(() => finish(null), 180);
          try {
            droppedDirEntry.createReader().readEntries(
              (entries: any[]) => {
                window.clearTimeout(timer);
                const firstChild = (entries || []).find(
                  (en) => en && en.name && !String(en.name).startsWith('.'),
                );
                finish(firstChild ? String(firstChild.name) : null);
              },
              () => {
                window.clearTimeout(timer);
                finish(null);
              },
            );
          } catch {
            window.clearTimeout(timer);
            finish(null);
          }
        } else {
          resolveViaDaemon(null);
        }
      }
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // 8. Playlist & Custom Folder Handlers
  const handleCreatePlaylist = async () => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    try {
      const created = await defaultSimpClient.query<PlaylistRecord>('create_playlist', {
        name: trimmed,
        description: 'Created in IMP',
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

  const commitAddTracksToPlaylist = async (
    uris: string[],
    label: string,
    trackMetadata?: TrackMetadata[],
    explicitPlaylistId?: string,
    createNewName?: string
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
      const scTracks = (trackMetadata || browserTracks).filter(
        (t) => t.source === 'soundcloud' && uris.includes(t.uri)
      );
      if (scTracks.length > 0) {
        defaultSimpClient.importCatalogTracks({
          source: 'soundcloud',
          album: null,
          playlist: null,
          tracks: scTracks,
        });
      }
      const iaTracks = (trackMetadata || browserTracks).filter(
        (t) =>
          (t.source === 'internet_archive' ||
            t.source === 'ia_video' ||
            t.source === 'local_video' ||
            t.source === 'dvd') &&
          uris.includes(t.uri)
      );
      if (iaTracks.length > 0) {
        defaultSimpClient.importCatalogTracks({
          source: 'internet_archive',
          album: null,
          playlist: null,
          tracks: iaTracks,
        });
      }

      const writablePlaylists = playlists.filter((p) => p.origin === 'simp_local');
      let targetPlId = '';
      let targetPlName = 'Favorites';

      if (createNewName !== undefined) {
        const trimmedName = createNewName.trim() || 'New IMP Playlist';
        const created = await defaultSimpClient.query<PlaylistRecord>('create_playlist', {
          name: trimmedName,
          description: 'Hybrid Local + Apple Music IMP playlist',
        });
        targetPlId = created.id;
        targetPlName = created.name;
        setActivePlaylistId(created.id);
        setNewPlaylistName('');
      } else if (explicitPlaylistId) {
        const found = playlists.find((p) => p.id === explicitPlaylistId);
        if (found && found.origin && found.origin !== 'simp_local') {
          await fetch('/api/library/playlists/convert-to-hybrid', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playlist_id: found.id }),
          }).catch(() => {});
        }
        targetPlId = found?.id || explicitPlaylistId;
        targetPlName = found?.name || 'IMP Playlist';
        setActivePlaylistId(targetPlId);
      } else if (writablePlaylists.length === 1) {
        targetPlId = writablePlaylists[0].id;
        targetPlName = writablePlaylists[0].name;
        setActivePlaylistId(targetPlId);
      } else {
        const selectedWritable = writablePlaylists.find((p) => p.id === activePlaylistId);
        targetPlId = selectedWritable?.id || '';
        targetPlName = selectedWritable?.name || 'Favorites';
      }

      if (!targetPlId) {
        const created = await defaultSimpClient.query<PlaylistRecord>('create_playlist', {
          name: 'Favorites',
          description: 'Hybrid Local + Apple Music IMP playlist',
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
      showToast(`Added ${label} to "★ ${targetPlName}"`);
    } catch {
      showToast('Could not add tracks to playlist');
    }
  };

  const handleAddTracksToPlaylist = async (
    uris: string[],
    label: string,
    trackMetadata?: TrackMetadata[]
  ) => {
    if (uris.length === 0) return;
    const writablePlaylists = playlists.filter((p) => p.origin === 'simp_local');
    const hasPinnedPlaylists = playlists.some((p) => p.origin !== 'simp_local');
    // When > 1 playlist exists or when Pinned collections exist alongside Hybrid playlists, prompt user to choose (or Fork & Add)
    if (writablePlaylists.length > 1 || (hasPinnedPlaylists && playlists.length >= 1)) {
      setPendingHybridAdd({
        uris,
        label,
        trackMetadata,
        creatingNew: false,
      });
      window.setTimeout(() => {
        const firstChoice = document.querySelector<HTMLElement>(
          '[data-hybrid-picker-modal="true"] button[data-default-focus="true"], [data-hybrid-picker-modal="true"] button:not([disabled])'
        );
        if (firstChoice) applyFocusMarker(firstChoice);
      }, 30);
      return;
    }
    await commitAddTracksToPlaylist(uris, label, trackMetadata);
  };

  const handleFavoriteTrack = async (favTrack: TrackMetadata) => {
    const isCurrentlyFav = favoritedUris.includes(favTrack.uri);
    const nextFav = !isCurrentlyFav;
    setFavoritedUris((prev) =>
      nextFav
        ? prev.includes(favTrack.uri)
          ? prev
          : [favTrack.uri, ...prev]
        : prev.filter((u) => u !== favTrack.uri)
    );
    fetch(`http://127.0.0.1:18888/api/favorites?favorited=${nextFav ? '1' : '0'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(favTrack),
    }).catch(() => {});

    if (favTrack.source === 'apple_music') {
      setAppleItemFavorited(favTrack.uri, 'songs', nextFav, showToast).catch(() => {});
    } else if (favTrack.source === 'soundcloud') {
      if (nextFav) {
        likeSoundCloudTrack(favTrack.uri, showToast).catch(() => {});
        setScLikedTracks((prev) =>
          prev.some((t) => t.uri === favTrack.uri) ? prev : [favTrack, ...prev]
        );
      } else {
        unlikeSoundCloudTrack(favTrack.uri, showToast).catch(() => {});
        setScLikedTracks((prev) => prev.filter((t) => t.uri !== favTrack.uri));
      }
    }

    const writablePlaylists = playlists.filter((p) => p.origin === 'simp_local');
    const favPl = writablePlaylists.find(
      (p) =>
        p.name.toLowerCase().includes('favorite') ||
        p.name.toLowerCase().includes('liked')
    );
    if (nextFav) {
      if (favPl) {
        await commitAddTracksToPlaylist(
          [favTrack.uri],
          `"${favTrack.title}"`,
          [favTrack],
          favPl.id
        );
      } else {
        await commitAddTracksToPlaylist(
          [favTrack.uri],
          `"${favTrack.title}"`,
          [favTrack],
          undefined,
          '❤️ Favorites'
        );
      }
    } else if (favPl) {
      await defaultSimpClient
        .query('remove_track_from_playlist', {
          playlist_id: favPl.id,
          track_uri: favTrack.uri,
        })
        .catch(() => {});
      refreshLibraryData();
      if (favTrack.source !== 'apple_music' && favTrack.source !== 'soundcloud') {
        showToast(`Removed "${favTrack.title}" from ❤️ Favorites`);
      }
    }
  };

  const handleAddAppleToCloudLibrary = useCallback(
    async (
      idOrUri: string,
      kind: 'songs' | 'albums' | 'playlists' = 'songs',
      label?: string
    ) => {
      try {
        await addAppleItemToCloudLibrary(idOrUri, kind, (msg) => {
          showToast(label ? `☁️ Added "${label}" to Apple Music Cloud Library!` : msg);
        });
      } catch (err: any) {
        showToast(err?.message || 'Could not add to Apple Music Cloud Library');
      }
    },
    [showToast]
  );

  const handleMoreByArtist = (
    artistName: string,
    preferredSource?: string,
    artistId?: string
  ) => {
    const cleaned = artistName.trim();
    if (!cleaned) return;
    const raw = (preferredSource || snap?.current_track?.source || '').toLowerCase();
    let mapped: 'local' | 'apple_music' | 'soundcloud' | 'internet_archive' = 'local';
    if (raw === 'apple_music') mapped = 'apple_music';
    else if (raw === 'soundcloud') mapped = 'soundcloud';
    else if (raw === 'internet_archive' || raw === 'ia_video') mapped = 'internet_archive';
    setSearchPreferredSource(mapped);
    setView('browser');
    if (mapped === 'internet_archive') {
      setSelectedSources(['internet_archive']);
      setBrowserSourceFilterState('internet_archive');
      setBrowserSearch(cleaned);
    } else {
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('simp-open-artist-profile', {
            detail: {
              artistName: cleaned,
              source: mapped,
              artistId: artistId || null,
            },
          })
        );
      }, 20);
    }
  };

  // Automatically reset `browserSourceFilter` to `'all'` if the user disconnects or is not signed into that service
  useEffect(() => {
    if (!snap) return;
    if (browserSourceFilter === 'apple_music' && !snap.apple_authenticated) {
      setBrowserSourceFilter('all');
    } else if (
      browserSourceFilter === 'internet_archive' &&
      !snap.internet_archive_authenticated
    ) {
      setBrowserSourceFilter('all');
    }
  }, [
    snap?.apple_authenticated,
    snap?.soundcloud_authenticated,
    snap?.internet_archive_authenticated,
    browserSourceFilter,
  ]);

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
      if (playlistId.startsWith('soundcloud:playlist:')) {
        setSoundCloudPlaylistLiked(playlistId, false).catch(() => {});
      }
      setBrowserTarget((prev) =>
        prev?.kind === 'playlist' && prev.id === playlistId
          ? albums.length > 0
            ? { kind: 'album', id: albums[0].id }
            : null
          : prev
      );
      setActivePlaylistId((prev) => (prev === playlistId ? '' : prev));
      refreshLibraryData();
      showToast(`Removed playlist "${playlistName}" from IMP`);
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
      showToast(`Unpinned album "${albumTitle}" from IMP`);
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
      showToast(err?.message || 'Failed to pin playlist to IMP');
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
      showToast(err?.message || 'Failed to pin album to IMP');
    } finally {
      setCloudLoading(false);
    }
  };

  const handlePinSoundCloudPlaylist = async (
    pl: SoundCloudPlaylistSummary,
    preloadedTracks?: TrackMetadata[]
  ) => {
    setCloudLoading(true);
    try {
      await pinSoundCloudPlaylistToSimp(pl, preloadedTracks, showToast);
      refreshLibraryData();
    } catch (err: any) {
      showToast(err?.message || 'Failed to pin SoundCloud set to IMP');
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
  const isNavBarHidden = view === 'lock' && isDimmed && !isOverlayOrPopoverOpen;

  return (
    <div
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (
          target.closest(
            'button, input, select, textarea, a, [role="button"], [data-osk-root="true"], [data-modal-root="true"], [data-focusable="true"]'
          )
        ) {
          return;
        }
        window.dispatchEvent(new CustomEvent('simp-player-fullscreen-toggle'));
      }}
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
        opacity: activeOpacity,
        transform: isActiveVideoPlayback ? undefined : `translate3d(${orbitX}px, ${orbitY}px, 0)`,
        transition: 'opacity 200ms ease, transform 4000ms linear',
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
          outline: 2px solid var(--imp-accent-primary, #2aa3c4) !important;
          outline-offset: 2px !important;
          box-shadow: 0 0 0 3px var(--imp-accent-glow, rgba(42, 163, 196, 0.28)) !important;
        }
        html[data-simp-input="pointer"] .simp-gp-badge {
          display: none !important;
        }
        html[data-simp-input="gamepad"] .simp-mouse-only {
          display: none !important;
        }
        html[data-simp-input="pointer"] .simp-gpfocus,
        html[data-simp-input="pointer"] [data-simp-active-focus="true"],
        html[data-simp-input="pointer"] button:focus:not(:focus-visible) {
          outline: none !important;
          box-shadow: none !important;
        }
      `}</style>

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
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <ImpIcon name="moon" size={12} /> IMP Screen Sleep • {snap?.is_playing && track ? `▶ ${track.title}` : 'Standby'}
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

      {/* Top Action Bar: Source Pop-Up Trigger | View Switcher (L1/R1) | Interactive Volume & Brightness */}
      <header
        style={{
          height: 58,
          boxSizing: 'border-box',
          padding: '0 24px',
          borderBottom: isNavBarHidden ? '1px solid transparent' : '1px solid #16161c',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isNavBarHidden ? 'transparent' : '#000000',
          width: '100%',
          flexShrink: 0,
          opacity: isNavBarHidden ? 0 : 1,
          pointerEvents: isNavBarHidden ? 'none' : 'auto',
          transform: isNavBarHidden ? 'translateY(-8px)' : 'translateY(0)',
          transition: isNavBarHidden
            ? 'opacity 420ms ease, transform 420ms ease, background 420ms ease, border-color 420ms ease'
            : 'opacity 60ms ease-out, transform 60ms ease-out',
          position: 'relative',
          zIndex: 40,
        }}
      >
        <button
          data-tile-aux="true"
          onClick={() => {
            setVolumePopoverOpen(false);
            setBrightnessPopoverOpen(false);
            setPowerModalOpen(false);
            setSourceModalOpen(false);
            if (view !== 'lock') {
              setView('lock');
            }
            window.dispatchEvent(new CustomEvent('simp-player-actions-toggle'));
          }}
          title="Track Options, Visualizer & Active Queue (SELECT)"
          style={{
            minHeight: 44,
            maxWidth: 'clamp(190px, 32vw, 380px)',
            padding: '0 12px 0 10px',
            borderRadius: 12,
            background: '#0a0a0e',
            border: '1px solid #22222c',
            color: '#d4d4dc',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            fontWeight: 700,
            cursor: 'pointer',
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1, color: '#9ca3af', flexShrink: 0 }}>⚙</span>
          <span
            className="simp-gp-badge"
            style={{
              padding: '2px 6px',
              borderRadius: 6,
              background: '#14141e',
              border: '1px solid #2a2a38',
              color: '#9ca3af',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            SELECT
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1, flexShrink: 0 }}>
            {track?.source === 'apple_music' ? (
              <ImpIcon name="apple" size={14} color="#fda4af" />
            ) : track?.source === 'soundcloud' ? (
              <ImpIcon name="soundcloud" size={12} color="#ffffff" />
            ) : track?.source === 'internet_archive' || track?.source === 'ia_video' ? (
              <ImpIcon name="archive" size={13} color="#6ee7b7" />
            ) : track?.source === 'cdda' || track?.source === 'dvd' ? (
              <ImpIcon name="disc" size={13} color="#fcd34d" />
            ) : (
              <ImpIcon name="disc" size={13} color="#67e8f9" />
            )}
          </span>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: 1,
              textAlign: 'left',
            }}
          >
            {track
              ? `${track.title}${track.artists?.length ? ` — ${track.artists[0]}` : ''}`
              : 'Local / Ready'}
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

        {/* Compact Volume & Brightness Dropdown Controls + Settings Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', zIndex: 40 }}>
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
              overflow: 'visible',
            }}
          >
            {view === 'lock' && (
              <span
                className="simp-gp-badge"
                title="D-Pad Down: Volume Down (-5%)"
                onClick={() => applyVolume(currentVolume - 0.05)}
                style={{
                  padding: '0 8px',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: '#71717a',
                  borderRight: '1px solid #1e1e28',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                ▼
              </span>
            )}
            <button
              onClick={() => defaultSimpClient.togglePlayPause()}
              title={isPlaying ? 'Audio Active — Click to Pause (Silence)' : 'Paused (Silenced) — Click to Resume'}
              style={{
                padding: '0 10px',
                border: 'none',
                borderRight: '1px solid #1e1e28',
                borderTopLeftRadius: view === 'lock' ? 0 : 11,
                borderBottomLeftRadius: view === 'lock' ? 0 : 11,
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
                borderTopRightRadius: view === 'lock' ? 0 : 11,
                borderBottomRightRadius: view === 'lock' ? 0 : 11,
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
            {view === 'lock' && (
              <span
                className="simp-gp-badge"
                title="D-Pad Up: Volume Up (+5%)"
                onClick={() => applyVolume(currentVolume + 0.05)}
                style={{
                  padding: '0 8px',
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: '#71717a',
                  borderLeft: '1px solid #1e1e28',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                ▲
              </span>
            )}

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
              </div>
            )}
          </div>

          {/* Right-End Hamburger (☰) Settings Button + Dynamic Gamepad START Badge */}
          <button
            onClick={() => {
              setVolumePopoverOpen(false);
              setBrightnessPopoverOpen(false);
              setPowerModalOpen(false);
              setSourceModalOpen((v) => !v);
            }}
            title="Settings Menu (START)"
            style={{
              height: 44,
              padding: '0 12px',
              borderRadius: 12,
              background: sourceModalOpen || powerModalOpen ? '#0f222a' : '#0a0a0e',
              border:
                sourceModalOpen || powerModalOpen
                  ? '1px solid #2aa3c4'
                  : '1px solid #22222c',
              color: sourceModalOpen || powerModalOpen ? '#bfeaf5' : '#c8c8d2',
              fontSize: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              className="simp-gp-badge"
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#14141e',
                border: '1px solid #2a2a38',
                color: '#9ca3af',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 700,
              }}
            >
              START
            </span>
            <span style={{ lineHeight: 1 }}>☰</span>
          </button>
        </div>
      </header>

      {/* Main Viewport: Lock Screen (PlayerView stays mounted across L1/R1 so video audio continues in background) + Persistent Split Browser */}
      <PlayerView
        hidden={view !== 'lock'}
        isPlayerIdle={isNavBarHidden}
        snap={snap}
        track={track}
        isPlaying={isPlaying}
        opticalDisc={opticalDisc}
        browserTarget={browserTarget}
        playingContextId={playingContextId}
        setBrowserTarget={setBrowserTarget}
        setBrowserTracks={setBrowserTracks}
        setView={setView}
        handleOpenFullAppleAlbum={handleOpenFullAppleAlbum}
        handleStartSoundCloudTrackRadio={handleStartSoundCloudTrackRadio}
        handleAddTracksToPlaylist={handleAddTracksToPlaylist}
        handleFavoriteTrack={handleFavoriteTrack}
        handleAddAppleToCloudLibrary={handleAddAppleToCloudLibrary}
        favoritedUris={favoritedUris}
        handleMoreByArtist={handleMoreByArtist}
        applyFocusMarker={applyFocusMarker}
        showToast={showToast}
      />
      <LibraryBrowserView
        hidden={view !== 'browser'}
        snap={snap}
          track={track}
          albums={albums}
          playlists={playlists}
          browserSourceFilter={browserSourceFilter}
          setBrowserSourceFilter={setBrowserSourceFilter}
          selectedSources={selectedSources}
          setSelectedSources={setSelectedSources}
          setBrowserSourceFilterRaw={setBrowserSourceFilterState}
          browserSearch={browserSearch}
          setBrowserSearch={setBrowserSearch}
          searchPreferredSource={searchPreferredSource}
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
          personalRadioStations={personalRadioStations}
          setPersonalRadioStations={setPersonalRadioStations}
          liveRadioStations={liveRadioStations}
          setLiveRadioStations={setLiveRadioStations}
          artistRadioShows={artistRadioShows}
          setArtistRadioShows={setArtistRadioShows}
          clubMixes={clubMixes}
          setClubMixes={setClubMixes}
          genreRadioStations={genreRadioStations}
          setGenreRadioStations={setGenreRadioStations}
          forYouPlaylists={forYouPlaylists}
          setForYouPlaylists={setForYouPlaylists}
          forYouAlbums={forYouAlbums}
          setForYouAlbums={setForYouAlbums}
          forYouNewReleases={forYouNewReleases}
          setForYouNewReleases={setForYouNewReleases}
          forYouShelves={forYouShelves}
          setForYouShelves={setForYouShelves}
          appleRecentlyPlayedTracks={appleRecentlyPlayedTracks}
          setAppleRecentlyPlayedTracks={setAppleRecentlyPlayedTracks}
          newFeedRecentReleases={newFeedRecentReleases}
          setNewFeedRecentReleases={setNewFeedRecentReleases}
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
          soundCloudSubTab={soundCloudSubTab}
          setSoundCloudSubTab={setSoundCloudSubTab}
          scLikedTracks={scLikedTracks}
          setScLikedTracks={setScLikedTracks}
          scPlaylists={scPlaylists}
          setScPlaylists={setScPlaylists}
          scStreamTracks={scStreamTracks}
          setScStreamTracks={setScStreamTracks}
          scStreamPlaylists={scStreamPlaylists}
          setScStreamPlaylists={setScStreamPlaylists}
          scTrendingTracks={scTrendingTracks}
          setScTrendingTracks={setScTrendingTracks}
          scTrendingMixes={scTrendingMixes}
          setScTrendingMixes={setScTrendingMixes}
          scTrendingPlaylists={scTrendingPlaylists}
          setScTrendingPlaylists={setScTrendingPlaylists}
          scMoreOfWhatYouLike={scMoreOfWhatYouLike}
          scFreshUploads={scFreshUploads}
          scRecommendedArtists={scRecommendedArtists}
          scDiscoverNextHref={scDiscoverNextHref}
          setScDiscoverNextHref={setScDiscoverNextHref}
          scSelectedGenre={scSelectedGenre}
          setScSelectedGenre={setScSelectedGenre}
          scCatalogSearchResults={scCatalogSearchResults}
          setScCatalogSearchResults={setScCatalogSearchResults}
          activeScPlaylist={activeScPlaylist}
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
          handleFavoriteTrack={handleFavoriteTrack}
          handleAddAppleToCloudLibrary={handleAddAppleToCloudLibrary}
          favoritedUris={favoritedUris}
          handleRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
          handleDeletePlaylist={handleDeletePlaylist}
          handleDeleteAlbum={handleDeleteAlbum}
          handlePinCloudPlaylist={handlePinCloudPlaylist}
          handlePinCloudAlbum={handlePinCloudAlbum}
          handleOpenCloudPlaylist={handleOpenCloudPlaylist}
          handleOpenFullAppleAlbum={handleOpenFullAppleAlbum}
          handleStartAppleStation={handleStartAppleStation}
          handleOpenSoundCloudPlaylist={handleOpenSoundCloudPlaylist}
          handlePinSoundCloudPlaylist={handlePinSoundCloudPlaylist}
          handleStartSoundCloudTrackRadio={handleStartSoundCloudTrackRadio}
          sourceVisibility={sourceVisibility}
          recentlyPlayed={recentlyPlayed}
          showToast={showToast}
        />

      {/* Unified Top-Left Hamburger (☰ / START) Nested Settings Drawer */}
      {(sourceModalOpen || powerModalOpen) && (
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
          setIsSleeping={setIsSleeping}
          dismissConsole={dismissConsole}
          brightnessPct={brightnessPct}
          setBrightnessPct={setBrightnessPct}
          updateStatus={updateStatus}
          checkSimpUpdates={checkSimpUpdates}
          applySimpUpdate={applySimpUpdate}
          confirmHardReset={confirmHardReset}
          setConfirmHardReset={setConfirmHardReset}
          sourceVisibility={sourceVisibility}
          setSourceVisibility={setSourceVisibility}
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
          soundcloudAuthCfg={soundcloudAuthCfg}
          setSoundcloudAuthCfg={setSoundcloudAuthCfg}
          soundcloudBusy={soundcloudBusy}
          setSoundcloudBusy={setSoundcloudBusy}
          setBrowserSourceFilter={setBrowserSourceFilter}
          setAppleSubTab={setAppleSubTab}
          setSoundCloudSubTab={setSoundCloudSubTab}
          refreshLibraryData={refreshLibraryData}
          applyFocusMarker={applyFocusMarker}
          showToast={showToast}
          initialOpenFoldersAccounts={initialOpenFoldersAccounts}
          onOpenQuickHelp={() => {
            setInitialOpenFoldersAccounts(false);
            setQuickHelpOpen(true);
            window.setTimeout(() => {
              const btn = document.querySelector<HTMLElement>(
                '[data-quick-help-modal="true"] button[data-default-focus="true"]'
              );
              if (btn) applyFocusMarker(btn);
            }, 35);
          }}
        />
      )}

      {/* First-Time Run (OOBE) & START -> Help Overlay Modal */}
      {quickHelpOpen && (
        <QuickHelpModal
          onClose={() => {
            try {
              window.localStorage.setItem('simp_oobe_help_seen_v1', '1');
            } catch {}
            setQuickHelpOpen(false);
          }}
          onOpenFoldersAccounts={() => {
            try {
              window.localStorage.setItem('simp_oobe_help_seen_v1', '1');
            } catch {}
            setQuickHelpOpen(false);
            setInitialOpenFoldersAccounts(true);
            setSourceModalOpen(true);
          }}
          sourceVisibility={sourceVisibility}
          onToggleSourceVisibility={(key) => {
            setSourceVisibility((prev) => {
              const nextVal = !prev[key];
              const next = { ...prev, [key]: nextVal };
              try {
                window.localStorage.setItem('simp_source_visibility_v2', JSON.stringify(next));
              } catch {}
              if (key === 'internet_archive') {
                defaultSimpClient.configureInternetArchive({
                  enabled: nextVal,
                  username: '',
                  safe_search: true,
                });
              }
              return next;
            });
          }}
        />
      )}

      {/* On-Demand SIMP Hybrid Playlist Chooser Modal (shown when > 1 Hybrid Playlist exists) */}
      {pendingHybridAdd && (
        <div
          onClick={() => {
            setPendingHybridAdd(null);
            setOskTarget(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.86)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            boxSizing: 'border-box',
            zIndex: 80,
          }}
        >
          <div
            data-modal-root="true"
            data-hybrid-picker-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 460,
              maxHeight: '82vh',
              overflowY: 'auto',
              background: '#0a0a0e',
              border: '2px solid #2aa3c4',
              borderRadius: 18,
              padding: 20,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.85)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#bfeaf5' }}>
                  ★ Add to IMP Hybrid Playlist
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#8e8e99',
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Adding {pendingHybridAdd.label}
                </div>
              </div>
              <button
                data-hybrid-picker-close="true"
                onClick={() => {
                  setPendingHybridAdd(null);
                  setOskTarget(null);
                }}
                style={{
                  minHeight: 38,
                  padding: '0 12px',
                  borderRadius: 9,
                  background: '#16161f',
                  border: '1px solid #2e2e3a',
                  color: '#d4d4dc',
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                ✕<span className="simp-gp-badge"> B</span>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {[...playlists]
                .sort((a, b) => (a.origin === 'simp_local' ? -1 : 1) - (b.origin === 'simp_local' ? -1 : 1))
                .map((p, idx) => {
                  const isPinned = Boolean(p.origin && p.origin !== 'simp_local');
                  const isPreferred =
                    p.id === activePlaylistId || (!activePlaylistId && idx === 0);
                  return (
                    <button
                      key={p.id}
                      data-default-focus={
                        !pendingHybridAdd.creatingNew && isPreferred ? 'true' : undefined
                      }
                      onClick={() => {
                        const job = pendingHybridAdd;
                        setPendingHybridAdd(null);
                        setOskTarget(null);
                        commitAddTracksToPlaylist(
                          job.uris,
                          job.label,
                          job.trackMetadata,
                          p.id
                        );
                      }}
                      style={{
                        minHeight: 44,
                        padding: '0 14px',
                        borderRadius: 10,
                        background: isPreferred ? '#0f222a' : '#101018',
                        border: isPreferred ? '1px solid #2aa3c4' : '1px solid #222230',
                        color: '#e4e4ec',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 800, color: isPinned ? '#fde68a' : '#bfeaf5' }}>
                        {isPinned ? '📌 ' : '★ '}
                        {p.name}
                      </span>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: isPinned ? '#fbbf24' : '#67e8f9' }}>
                        {isPinned
                          ? `Fork to Hybrid • ${p.track_count}`
                          : `${p.track_count} ${p.track_count === 1 ? 'track' : 'tracks'}`}
                      </span>
                    </button>
                  );
                })}
            </div>

            {/* Only shown when > 1 Hybrid Playlist already exists */}
            {!pendingHybridAdd.creatingNew ? (
              <button
                onClick={() => {
                  setNewPlaylistName('');
                  setPendingHybridAdd((prev) =>
                    prev ? { ...prev, creatingNew: true } : null
                  );
                  if (document.documentElement.dataset.simpInput === 'gamepad') {
                    setOskTarget('playlist');
                    if (window.parent && window.parent !== window) {
                      window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                    }
                    window.setTimeout(() => {
                      const firstKey = document.querySelector<HTMLElement>(
                        '[data-osk-root="true"] button[data-default-focus="true"], [data-osk-root="true"] button'
                      );
                      if (firstKey) applyFocusMarker(firstKey);
                    }, 40);
                  } else {
                    window.setTimeout(() => {
                      const inp = document.querySelector<HTMLInputElement>(
                        '[data-hybrid-picker-modal="true"] input[data-osk-input="playlist"]'
                      );
                      inp?.focus();
                    }, 30);
                  }
                }}
                style={{
                  minHeight: 42,
                  padding: '0 14px',
                  borderRadius: 10,
                  background: '#121822',
                  border: '1px dashed #2aa3c4',
                  color: '#67e8f9',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                + Add to New IMP Playlist...
              </button>
            ) : (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  background: '#0c161c',
                  border: '1px solid #2aa3c4',
                }}
              >
                <input
                  type="text"
                  data-osk-input="playlist"
                  placeholder="New IMP Playlist name..."
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onClick={() => {
                    if (document.documentElement.dataset.simpInput === 'gamepad') {
                      setOskTarget('playlist');
                      if (window.parent && window.parent !== window) {
                        window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const job = pendingHybridAdd;
                      const chosenName = newPlaylistName;
                      setPendingHybridAdd(null);
                      setOskTarget(null);
                      commitAddTracksToPlaylist(
                        job.uris,
                        job.label,
                        job.trackMetadata,
                        undefined,
                        chosenName
                      );
                    }
                  }}
                  style={{
                    flex: 1,
                    minHeight: 38,
                    padding: '0 12px',
                    borderRadius: 8,
                    background: '#08080c',
                    border: '1px solid #2e2e3c',
                    color: '#d4d4dc',
                    fontSize: 12,
                  }}
                />
                <button
                  data-hybrid-picker-submit="true"
                  data-default-focus="true"
                  onClick={() => {
                    const job = pendingHybridAdd;
                    const chosenName = newPlaylistName;
                    setPendingHybridAdd(null);
                    setOskTarget(null);
                    commitAddTracksToPlaylist(
                      job.uris,
                      job.label,
                      job.trackMetadata,
                      undefined,
                      chosenName
                    );
                  }}
                  style={{
                    minHeight: 38,
                    padding: '0 14px',
                    borderRadius: 8,
                    background: '#0f222a',
                    color: '#bfeaf5',
                    border: '1px solid #2aa3c4',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Create & Add
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Controller-Navigable On-Screen Keyboard (OSK) Bar for Search, Playlist Name & Folder Path */}
      {oskTarget &&
        (view === 'browser' || sourceModalOpen || powerModalOpen || Boolean(pendingHybridAdd)) && (
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
                    const pickerSubmit = document.querySelector<HTMLElement>(
                      '[data-hybrid-picker-submit="true"]:not([disabled])'
                    );
                    const inp =
                      pickerSubmit || document.querySelector<HTMLElement>(prevInputSelector);
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

      {/* Track Properties & Local Curation Modal */}
      {trackPropertiesTarget && (
        <TrackPropertiesModal
          track={trackPropertiesTarget}
          onClose={() => setTrackPropertiesTarget(null)}
          onToast={showToast}
        />
      )}

      {/* Proactive Auth Probe Banner */}
      {expiredAuthAlert && (
        <div
          data-modal-root="true"
          style={{
            position: 'fixed',
            top: 14,
            right: 16,
            zIndex: 9920,
            maxWidth: 440,
            padding: '12px 14px',
            borderRadius: 12,
            background: 'rgba(15, 22, 34, 0.97)',
            border: '1px solid rgba(250, 204, 21, 0.5)',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.72)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            color: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: '#facc15' }}>
              <ImpIcon name="key" size={15} color="#facc15" />
              <span>{expiredAuthAlert.label} Session Needs Re-Sign-In</span>
            </div>
            <button
              onClick={() => setExpiredAuthAlert(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: 2,
              }}
            >
              <ImpIcon name="close" size={14} />
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.4 }}>
            Your {expiredAuthAlert.label} token has expired. Your pinned collections and hybrid playlists are safe in your local database.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button
              data-focusable="true"
              onClick={() => {
                setExpiredAuthAlert(null);
                setSourceModalOpen(true);
              }}
              style={{
                padding: '6px 10px',
                borderRadius: 7,
                background: 'rgba(56, 189, 248, 0.16)',
                border: '1px solid rgba(56, 189, 248, 0.5)',
                color: '#bae6fd',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Open Connected Accounts
            </button>
            <button
              data-focusable="true"
              onClick={async () => {
                const prov = expiredAuthAlert.provider;
                setExpiredAuthAlert(null);
                if (prov === 'apple') {
                  await disconnectAppleMusicCleanSlate(showToast);
                } else {
                  await disconnectSoundCloudCleanSlate(showToast);
                }
              }}
              style={{
                padding: '6px 10px',
                borderRadius: 7,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                color: '#e2e8f0',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Sign Out (Keep DB)
            </button>
            <button
              data-focusable="true"
              onClick={() => {
                localStorage.setItem('simp_mute_auth_reminders', '1');
                setExpiredAuthAlert(null);
                showToast('Muted proactive auth reminder notifications');
              }}
              style={{
                padding: '6px 10px',
                borderRadius: 7,
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#94a3b8',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <ImpIcon name="bell-off" size={12} />
              Mute
            </button>
          </div>
        </div>
      )}

      {/* Dropped Folder Ingestion Confirmation Modal */}
      {pendingDroppedFolder && (
        <div
          data-modal-root="true"
          onClick={() => setPendingDroppedFolder(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9970,
            background: 'rgba(4, 7, 13, 0.82)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(480px, 92vw)',
              borderRadius: 16,
              background: 'linear-gradient(180deg, rgba(15, 23, 36, 0.99), rgba(9, 13, 22, 0.99))',
              border: '1px solid rgba(52, 211, 153, 0.5)',
              boxShadow: '0 22px 55px rgba(0, 0, 0, 0.75)',
              padding: 20,
              color: '#f1f5f9',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ImpIcon name="folder-plus" size={20} color="#34d399" />
              <div style={{ fontSize: 15, fontWeight: 800 }}>Add Folder to Local Folders?</div>
            </div>
            <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.45 }}>
              Index this folder into your local IMP library so its albums, tracks, artwork, and `.lrc` lyrics are available across all views:
            </div>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: 'rgba(0, 0, 0, 0.38)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                fontFamily: 'monospace',
                fontSize: 12,
                color: '#6ee7b7',
                wordBreak: 'break-all',
              }}
            >
              {pendingDroppedFolder}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                data-focusable="true"
                onClick={() => setPendingDroppedFolder(null)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  color: '#cbd5e1',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                data-focusable="true"
                onClick={() => {
                  const pathToAdd = pendingDroppedFolder;
                  setPendingDroppedFolder(null);
                  handleAddFolder(pathToAdd);
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, rgba(5, 150, 105, 0.45), rgba(52, 211, 153, 0.25))',
                  border: '1px solid rgba(52, 211, 153, 0.6)',
                  color: '#ecfdf5',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <ImpIcon name="folder-plus" size={14} color="#34d399" />
                Add to Local Folders
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
