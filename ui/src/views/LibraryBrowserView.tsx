import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlbumRecord,
  defaultSimpClient,
  DvdTitleInfo,
  OpticalDiscStatus,
  PlaylistRecord,
  SimpStateSnapshot,
  TrackMetadata,
} from '@simp/client';
import { DvdPlayerModal } from '../components/DvdPlayerModal';
import {
  AppleCatalogSearchResults,
  AppleCloudAlbumSummary,
  AppleCloudPlaylistSummary,
  AppleRadioStationSummary,
  fetchAppleCloudPlaylists,
  fetchAppleLibraryRecentlyAdded,
  fetchAppleNewFeed,
  fetchApplePlaylistTracks,
  fetchAppleRadioAndForYou,
  fetchFullAppleAlbum,
} from '../drivers/AppleMusicDriver';
import {
  fetchSoundCloudDiscover,
  fetchSoundCloudLikesAndPlaylists,
  fetchSoundCloudPlaylistTracks,
  fetchSoundCloudStreamAndRadio,
  likeSoundCloudTrack,
  SoundCloudCatalogSearchResults,
  SoundCloudPlaylistSummary,
} from '../drivers/SoundCloudDriver';
import { OskTargetKind } from '../hooks/useGamepadNavigation';
import { BrowserTarget } from './PlayerView';

export interface LibraryBrowserViewProps {
  hidden?: boolean;
  snap: SimpStateSnapshot | null;
  track: TrackMetadata | null | undefined;
  albums: AlbumRecord[];
  playlists: PlaylistRecord[];
  browserSourceFilter: 'all' | 'local' | 'apple_music' | 'soundcloud';
  setBrowserSourceFilter: React.Dispatch<
    React.SetStateAction<'all' | 'local' | 'apple_music' | 'soundcloud'>
  >;
  browserSearch: string;
  setBrowserSearch: React.Dispatch<React.SetStateAction<string>>;
  browserTarget: BrowserTarget | null;
  setBrowserTarget: React.Dispatch<React.SetStateAction<BrowserTarget | null>>;
  browserTracks: TrackMetadata[];
  setBrowserTracks: React.Dispatch<React.SetStateAction<TrackMetadata[]>>;
  opticalDisc: OpticalDiscStatus | null;
  cdScanning: boolean;
  handleScanOpticalDisc: (forceRefresh?: boolean, silent?: boolean) => Promise<void>;
  handleEjectOpticalDisc: () => void;
  appleSubTab: 'pinned' | 'cloud_playlists' | 'radio' | 'new';
  setAppleSubTab: React.Dispatch<
    React.SetStateAction<'pinned' | 'cloud_playlists' | 'radio' | 'new'>
  >;
  soundCloudSubTab: 'pinned' | 'likes_sets' | 'stream_radio' | 'trending';
  setSoundCloudSubTab: React.Dispatch<
    React.SetStateAction<'pinned' | 'likes_sets' | 'stream_radio' | 'trending'>
  >;
  scLikedTracks: TrackMetadata[];
  setScLikedTracks: React.Dispatch<React.SetStateAction<TrackMetadata[]>>;
  scPlaylists: SoundCloudPlaylistSummary[];
  setScPlaylists: React.Dispatch<React.SetStateAction<SoundCloudPlaylistSummary[]>>;
  scStreamTracks: TrackMetadata[];
  setScStreamTracks: React.Dispatch<React.SetStateAction<TrackMetadata[]>>;
  scStreamPlaylists: SoundCloudPlaylistSummary[];
  setScStreamPlaylists: React.Dispatch<React.SetStateAction<SoundCloudPlaylistSummary[]>>;
  scTrendingTracks: TrackMetadata[];
  setScTrendingTracks: React.Dispatch<React.SetStateAction<TrackMetadata[]>>;
  scTrendingMixes: TrackMetadata[];
  setScTrendingMixes: React.Dispatch<React.SetStateAction<TrackMetadata[]>>;
  scTrendingPlaylists: SoundCloudPlaylistSummary[];
  setScTrendingPlaylists: React.Dispatch<React.SetStateAction<SoundCloudPlaylistSummary[]>>;
  scSelectedGenre: string;
  setScSelectedGenre: React.Dispatch<React.SetStateAction<string>>;
  scCatalogSearchResults: SoundCloudCatalogSearchResults;
  activeScPlaylist: SoundCloudPlaylistSummary | null;
  cloudPlaylists: AppleCloudPlaylistSummary[];
  setCloudPlaylists: React.Dispatch<React.SetStateAction<AppleCloudPlaylistSummary[]>>;
  radioStations: AppleRadioStationSummary[];
  setRadioStations: React.Dispatch<React.SetStateAction<AppleRadioStationSummary[]>>;
  forYouPlaylists: AppleCloudPlaylistSummary[];
  setForYouPlaylists: React.Dispatch<React.SetStateAction<AppleCloudPlaylistSummary[]>>;
  forYouAlbums: AppleCloudAlbumSummary[];
  setForYouAlbums: React.Dispatch<React.SetStateAction<AppleCloudAlbumSummary[]>>;
  newFeedAlbums: AppleCloudAlbumSummary[];
  setNewFeedAlbums: React.Dispatch<React.SetStateAction<AppleCloudAlbumSummary[]>>;
  newFeedPlaylists: AppleCloudPlaylistSummary[];
  setNewFeedPlaylists: React.Dispatch<React.SetStateAction<AppleCloudPlaylistSummary[]>>;
  newFeedSongs: TrackMetadata[];
  setNewFeedSongs: React.Dispatch<React.SetStateAction<TrackMetadata[]>>;
  catalogSearchResults: AppleCatalogSearchResults;
  cloudLoading: boolean;
  setCloudLoading: React.Dispatch<React.SetStateAction<boolean>>;
  activeCloudAlbum: AppleCloudAlbumSummary | null;
  activeCloudPlaylist: AppleCloudPlaylistSummary | null;
  creatingPlaylist: boolean;
  setCreatingPlaylist: React.Dispatch<React.SetStateAction<boolean>>;
  newPlaylistName: string;
  setNewPlaylistName: React.Dispatch<React.SetStateAction<string>>;
  activePlaylistId: string;
  setActivePlaylistId: React.Dispatch<React.SetStateAction<string>>;
  playingContextId: string;
  setPlayingContextId: React.Dispatch<React.SetStateAction<string>>;
  setOskTarget: React.Dispatch<React.SetStateAction<OskTargetKind>>;
  setSourceModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setView: React.Dispatch<React.SetStateAction<'lock' | 'browser'>>;
  applyFocusMarker: (el: HTMLElement | null) => void;
  handleCreatePlaylist: () => Promise<void>;
  handleAddTracksToPlaylist: (
    uris: string[],
    label: string,
    trackMetadata?: TrackMetadata[]
  ) => Promise<void>;
  handleRemoveTrackFromPlaylist: (
    playlistId: string,
    trackUri: string,
    title: string
  ) => Promise<void>;
  handleDeletePlaylist: (playlistId: string, playlistName: string) => Promise<void>;
  handleDeleteAlbum: (albumId: string, albumTitle: string) => Promise<void>;
  handlePinCloudPlaylist: (
    pl: AppleCloudPlaylistSummary,
    preloadedTracks?: TrackMetadata[]
  ) => Promise<void>;
  handlePinCloudAlbum: (
    album: AppleCloudAlbumSummary,
    tracks: TrackMetadata[]
  ) => Promise<void>;
  handleOpenCloudPlaylist: (pl: AppleCloudPlaylistSummary) => Promise<void>;
  handleOpenFullAppleAlbum: (params: {
    albumId?: string | null;
    songUri?: string | null;
    fallbackTitle?: string;
  }) => Promise<void>;
  handleStartAppleStation: (st: AppleRadioStationSummary) => void;
  handleOpenSoundCloudPlaylist: (pl: SoundCloudPlaylistSummary) => Promise<void>;
  handlePinSoundCloudPlaylist: (
    pl: SoundCloudPlaylistSummary,
    preloadedTracks?: TrackMetadata[]
  ) => Promise<void>;
  handleStartSoundCloudTrackRadio: (seedTrack: TrackMetadata) => void;
  showToast: (msg: string) => void;
}

const CLOUD_PAGE_SIZE = 50;
type AlphaBucket = 'all' | 'num' | 'a_f' | 'g_l' | 'm_r' | 's_z';

function matchesAlphaBucket(name: string, bucket: AlphaBucket): boolean {
  if (bucket === 'all') return true;
  const cleaned = name.replace(/^[\s🍎☁️📌🎵💿]+/u, '').trim();
  const first = (cleaned[0] || '').toUpperCase();
  if (!first || first < 'A' || first > 'Z') {
    return bucket === 'num';
  }
  if (bucket === 'a_f') return first >= 'A' && first <= 'F';
  if (bucket === 'g_l') return first >= 'G' && first <= 'L';
  if (bucket === 'm_r') return first >= 'M' && first <= 'R';
  if (bucket === 's_z') return first >= 'S' && first <= 'Z';
  return true;
}

const resolvedPlaylistCoverMemoryCache = new Map<string, string>();
const failedPlaylistCoverLookupIds = new Set<string>();

interface ResilientTileArtworkProps {
  src?: string | null;
  fallbackIcon: string;
  bg: string;
  border: string;
  playlistCoverId?: string;
  playlistKind?: string;
  onResolvedCover?: (url: string) => void;
}

const ResilientTileArtwork: React.FC<ResilientTileArtworkProps> = ({
  src,
  fallbackIcon,
  bg,
  border,
  playlistCoverId,
  playlistKind,
  onResolvedCover,
}) => {
  const cachedOverride = playlistCoverId
    ? resolvedPlaylistCoverMemoryCache.get(playlistCoverId)
    : undefined;
  const effectiveSrc = cachedOverride || src || null;
  const [currentSrc, setCurrentSrc] = useState<string | null>(effectiveSrc);
  const [retried, setRetried] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    const next =
      (playlistCoverId ? resolvedPlaylistCoverMemoryCache.get(playlistCoverId) : undefined) ||
      src ||
      null;
    setCurrentSrc(next);
    setRetried(false);
    setFailed(false);
  }, [src, playlistCoverId]);

  const handleImgError = () => {
    if (!retried && currentSrc && !currentSrc.includes('blobstore.apple.com')) {
      setRetried(true);
      const jitter = 500 + Math.floor(Math.random() * 700);
      window.setTimeout(() => {
        const sep = currentSrc.includes('?') ? '&' : '?';
        setCurrentSrc(`${currentSrc}${sep}retry=1`);
      }, jitter);
      return;
    }

    if (playlistCoverId && !failedPlaylistCoverLookupIds.has(playlistCoverId)) {
      failedPlaylistCoverLookupIds.add(playlistCoverId);
      fetch(
        `/api/apple/playlist-cover?id=${encodeURIComponent(playlistCoverId)}&kind=${encodeURIComponent(
          playlistKind || 'library'
        )}&force=1`
      )
        .then((r) => r.json())
        .then((d) => {
          if (d?.ok && d?.art_url) {
            resolvedPlaylistCoverMemoryCache.set(playlistCoverId, d.art_url);
            setCurrentSrc(d.art_url);
            setFailed(false);
            onResolvedCover?.(d.art_url);
          } else {
            setFailed(true);
          }
        })
        .catch(() => setFailed(true));
      return;
    }

    setFailed(true);
  };

  if (currentSrc && !failed) {
    return (
      <img
        src={currentSrc}
        alt=""
        loading="lazy"
        decoding="async"
        onError={handleImgError}
        style={{
          width: 56,
          height: 56,
          borderRadius: 10,
          objectFit: 'cover',
          border: '1px solid #262632',
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: 10,
        background: bg,
        border,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        flexShrink: 0,
      }}
    >
      {fallbackIcon}
    </div>
  );
};

export const LibraryBrowserView: React.FC<LibraryBrowserViewProps> = ({
  hidden = false,
  snap,
  track,
  albums,
  playlists,
  browserSourceFilter,
  setBrowserSourceFilter,
  browserSearch,
  setBrowserSearch,
  browserTarget,
  setBrowserTarget,
  browserTracks,
  setBrowserTracks,
  opticalDisc,
  cdScanning,
  handleScanOpticalDisc,
  handleEjectOpticalDisc,
  appleSubTab,
  setAppleSubTab,
  soundCloudSubTab,
  setSoundCloudSubTab,
  scLikedTracks,
  setScLikedTracks,
  scPlaylists,
  setScPlaylists,
  scStreamTracks,
  setScStreamTracks,
  scStreamPlaylists,
  setScStreamPlaylists,
  scTrendingTracks,
  setScTrendingTracks,
  scTrendingMixes,
  setScTrendingMixes,
  scTrendingPlaylists,
  setScTrendingPlaylists,
  scSelectedGenre,
  setScSelectedGenre,
  scCatalogSearchResults,
  activeScPlaylist,
  cloudPlaylists,
  setCloudPlaylists,
  radioStations,
  setRadioStations,
  forYouPlaylists,
  setForYouPlaylists,
  forYouAlbums,
  setForYouAlbums,
  newFeedAlbums,
  setNewFeedAlbums,
  newFeedPlaylists,
  setNewFeedPlaylists,
  newFeedSongs,
  setNewFeedSongs,
  catalogSearchResults,
  cloudLoading,
  setCloudLoading,
  activeCloudAlbum,
  activeCloudPlaylist,
  creatingPlaylist,
  setCreatingPlaylist,
  newPlaylistName,
  setNewPlaylistName,
  activePlaylistId,
  setActivePlaylistId,
  playingContextId,
  setPlayingContextId,
  setOskTarget,
  setSourceModalOpen,
  setView,
  applyFocusMarker,
  handleCreatePlaylist,
  handleAddTracksToPlaylist,
  handleRemoveTrackFromPlaylist,
  handleDeletePlaylist,
  handleDeleteAlbum,
  handlePinCloudPlaylist,
  handlePinCloudAlbum,
  handleOpenCloudPlaylist,
  handleOpenFullAppleAlbum,
  handleStartAppleStation,
  handleOpenSoundCloudPlaylist,
  handlePinSoundCloudPlaylist,
  handleStartSoundCloudTrackRadio,
  showToast,
}) => {
  // Left Sidebar Collapsible Section States (persisted in localStorage)
  const [placesOpen, setPlacesOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('simp_sec_places') !== '0';
    } catch {
      return true;
    }
  });
  const [playlistsOpen, setPlaylistsOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('simp_sec_playlists') !== '0';
    } catch {
      return true;
    }
  });
  const [albumsOpen, setAlbumsOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('simp_sec_albums') !== '0';
    } catch {
      return true;
    }
  });
  const [storageOpen, setStorageOpen] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem('simp_sec_storage');
      if (saved === '1') return true;
      if (saved === '0') return false;
      return false;
    } catch {
      return false;
    }
  });

  const [activeDvdPlayback, setActiveDvdPlayback] = useState<{
    titleInfo: DvdTitleInfo;
    chapter: number;
    audioIdx: number;
    subIdx: string;
  } | null>(null);
  const [dvdAudioChoice, setDvdAudioChoice] = useState<number>(0);
  const [dvdSubChoice, setDvdSubChoice] = useState<string>('off');

  const togglePlacesOpen = () => {
    setPlacesOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('simp_sec_places', next ? '1' : '0');
      } catch {}
      return next;
    });
  };
  const togglePlaylistsOpen = () => {
    setPlaylistsOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('simp_sec_playlists', next ? '1' : '0');
      } catch {}
      return next;
    });
  };
  const toggleAlbumsOpen = () => {
    setAlbumsOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('simp_sec_albums', next ? '1' : '0');
      } catch {}
      return next;
    });
  };
  const toggleStorageOpen = () => {
    setStorageOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('simp_sec_storage', next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  // Right Pane State: 'browse' (4-Column-Max Visual Card Grid for the active Place) vs 'tracks' (Selected Collection Tracklist)
  const [rightPaneMode, setRightPaneMode] = useState<'browse' | 'tracks'>('browse');
  const [activeMountRoot, setActiveMountRoot] = useState<string | null>(null);
  const [mountAlbums, setMountAlbums] = useState<AlbumRecord[]>([]);
  const [mountTracks, setMountTracks] = useState<TrackMetadata[]>([]);
  const [simpHubFilter, setSimpHubFilter] = useState<'all' | 'hybrid' | 'pinned' | 'albums'>('all');
  const [cloudPage, setCloudPage] = useState<number>(0);
  const [cloudAlpha, setCloudAlpha] = useState<AlphaBucket>('all');
  const [radioFilter, setRadioFilter] = useState<
    'all' | 'stations' | 'mixes' | 'albums' | 'recent_library'
  >('all');
  const [newFilter, setNewFilter] = useState<'all' | 'albums' | 'playlists' | 'songs'>('all');
  const [scLikesFilter, setScLikesFilter] = useState<'all' | 'likes' | 'sets'>('all');
  const [scStreamFilter, setScStreamFilter] = useState<'all' | 'stream' | 'sets'>('all');
  const [scTrendingFilter, setScTrendingFilter] = useState<'all' | 'mixes' | 'sets' | 'tracks'>('all');
  const [recentlyAddedCloudAlbums, setRecentlyAddedCloudAlbums] = useState<AppleCloudAlbumSummary[]>(
    []
  );
  const recentLoadedRef = useRef(false);

  useEffect(() => {
    if (!snap?.apple_authenticated || browserSourceFilter === 'local' || browserSourceFilter === 'soundcloud') return;
    if (appleSubTab !== 'radio' && appleSubTab !== 'pinned') return;
    if (recentLoadedRef.current && recentlyAddedCloudAlbums.length > 0) return;
    recentLoadedRef.current = true;
    fetchAppleLibraryRecentlyAdded()
      .then((albs) => {
        if (Array.isArray(albs)) setRecentlyAddedCloudAlbums(albs);
      })
      .catch(() => {
        recentLoadedRef.current = false;
      });
  }, [snap?.apple_authenticated, browserSourceFilter, appleSubTab, recentlyAddedCloudAlbums.length]);

  // Clear activeMountRoot if user switches source filter to Apple Music or SoundCloud only
  useEffect(() => {
    if ((browserSourceFilter === 'apple_music' || browserSourceFilter === 'soundcloud') && activeMountRoot) {
      setActiveMountRoot(null);
    }
  }, [browserSourceFilter, activeMountRoot]);

  // Load albums and tracks belonging to the selected Storage Mount Place (`activeMountRoot`)
  useEffect(() => {
    if (!activeMountRoot) {
      setMountAlbums([]);
      setMountTracks([]);
      return;
    }
    const searchParam = browserSearch.trim() ? browserSearch.trim() : null;
    defaultSimpClient
      .query<AlbumRecord[]>('get_albums', {
        source: null,
        mount_root: activeMountRoot,
        search: searchParam,
        limit: 1000,
        offset: 0,
      })
      .then((res) => {
        if (Array.isArray(res)) setMountAlbums(res);
      })
      .catch(() => {});
    defaultSimpClient
      .query<TrackMetadata[]>('get_tracks', {
        source: null,
        mount_root: activeMountRoot,
        search: searchParam,
        limit: 2000,
        offset: 0,
      })
      .then((res) => {
        if (Array.isArray(res)) setMountTracks(res);
      })
      .catch(() => {});
  }, [activeMountRoot, browserSearch, albums]);

  // Auto-focus Right Pane when selecting a Place ('tile') or Collection ('track')
  const pendingRightFocusRef = useRef<'track' | 'tile' | null>(null);
  const xmbPreviewTriggerRef = useRef<boolean>(false);

  // PS3 XMB Auto-Fill: When cursor lands on a non-drill-down row in the Left Column (`data-xmb-preview="true"`),
  // automatically fill the Right Pane after a 75ms debounce while keeping focus in the Left Column!
  useEffect(() => {
    let debounceTimer = 0;
    const onXmbLeftFocus = (e: Event) => {
      const el = (e as CustomEvent<{ element?: HTMLElement }>)?.detail?.element;
      if (!el) return;
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        if (!el.isConnected || el.getAttribute('data-simp-active-focus') !== 'true') return;
        xmbPreviewTriggerRef.current = true;
        try {
          el.click();
        } finally {
          xmbPreviewTriggerRef.current = false;
        }
      }, 75);
    };
    window.addEventListener('simp-xmb-left-focus', onXmbLeftFocus);
    return () => {
      window.clearTimeout(debounceTimer);
      window.removeEventListener('simp-xmb-left-focus', onXmbLeftFocus);
    };
  }, []);

  const focusRightPaneFirstTrack = useCallback(() => {
    if (xmbPreviewTriggerRef.current) return;
    pendingRightFocusRef.current = 'track';
    window.setTimeout(() => {
      const firstTrack =
        document.querySelector<HTMLElement>(
          '[data-nav-col="right"] [data-right-track="true"]'
        ) ||
        document.querySelector<HTMLElement>(
          '[data-nav-col="right"] [data-right-play-all="true"]:not([disabled])'
        );
      if (firstTrack) {
        applyFocusMarker(firstTrack);
        if (firstTrack.dataset.rightTrack === 'true') {
          pendingRightFocusRef.current = null;
        }
      }
    }, 55);
  }, [applyFocusMarker]);

  const focusRightPaneFirstTile = useCallback(() => {
    if (xmbPreviewTriggerRef.current) return;
    pendingRightFocusRef.current = 'tile';
    window.setTimeout(() => {
      const firstTile =
        document.querySelector<HTMLElement>(
          '[data-nav-col="right"] [data-right-tile="true"]:not([disabled]), [data-nav-col="right"] [data-single-song-play="true"]:not([disabled]), [data-nav-col="right"] [data-right-track="true"]:not([disabled])'
        ) ||
        document.querySelector<HTMLElement>(
          '[data-nav-col="right"] button:not([disabled]):not([data-right-filter-pill="true"])'
        ) ||
        document.querySelector<HTMLElement>(
          '[data-nav-col="right"] button:not([disabled])'
        );
      if (firstTile) {
        applyFocusMarker(firstTile);
        if (
          firstTile.dataset.rightTile === 'true' ||
          firstTile.dataset.singleSongPlay === 'true' ||
          firstTile.dataset.rightTrack === 'true'
        ) {
          pendingRightFocusRef.current = null;
        }
      }
    }, 45);
  }, [applyFocusMarker]);

  // Complete deferred Right-Pane focus when async tracks or cloud tiles finish loading
  useEffect(() => {
    if (pendingRightFocusRef.current === 'track' && rightPaneMode === 'tracks' && browserTracks.length > 0) {
      const t = window.setTimeout(() => {
        const firstTrack = document.querySelector<HTMLElement>(
          '[data-nav-col="right"] [data-right-track="true"]'
        );
        if (firstTrack) {
          applyFocusMarker(firstTrack);
          pendingRightFocusRef.current = null;
        }
      }, 25);
      return () => window.clearTimeout(t);
    }
    if (pendingRightFocusRef.current === 'tile' && rightPaneMode === 'browse') {
      const t = window.setTimeout(() => {
        const firstTile = document.querySelector<HTMLElement>(
          '[data-nav-col="right"] [data-right-tile="true"]:not([disabled]), [data-nav-col="right"] [data-single-song-play="true"]:not([disabled]), [data-nav-col="right"] [data-right-track="true"]:not([disabled])'
        );
        if (firstTile) {
          applyFocusMarker(firstTile);
          pendingRightFocusRef.current = null;
        }
      }, 25);
      return () => window.clearTimeout(t);
    }
  }, [
    browserTracks,
    rightPaneMode,
    appleSubTab,
    soundCloudSubTab,
    cloudPlaylists,
    radioStations,
    forYouPlaylists,
    newFeedAlbums,
    scLikedTracks,
    scPlaylists,
    scStreamTracks,
    scStreamPlaylists,
    scTrendingTracks,
    scTrendingMixes,
    scTrendingPlaylists,
    applyFocusMarker,
  ]);

  // Switch Right Pane to 'browse' when user types a search query
  useEffect(() => {
    if (browserSearch.trim()) {
      setRightPaneMode('browse');
      setCloudPage(0);
    }
  }, [browserSearch]);

  // Multi-Service Auth State Classification ('connected' | 'reauth_required' | 'never_used')
  const pinnedApplePlaylistCount = playlists.filter((p) => p.origin === 'apple_remote').length;
  const pinnedAppleAlbumCount = albums.filter((a) => a.id.startsWith('applemusic:album:')).length;
  const hasPinnedAppleContent = pinnedApplePlaylistCount + pinnedAppleAlbumCount > 0;
  const appleAuthState: 'connected' | 'reauth_required' | 'never_used' = snap?.apple_authenticated
    ? 'connected'
    : hasPinnedAppleContent
    ? 'reauth_required'
    : 'never_used';

  const selectedAlbumObj =
    browserTarget?.kind === 'album'
      ? albums.find((a) => a.id === browserTarget.id) ||
        mountAlbums.find((a) => a.id === browserTarget.id)
      : null;
  const selectedPlaylistObj =
    browserTarget?.kind === 'playlist' ? playlists.find((p) => p.id === browserTarget.id) : null;
  const selectedMountObj =
    browserTarget?.kind === 'mount'
      ? snap?.mounts.find((m) => m.mount_root === browserTarget.id)
      : null;
  const activeMountPlaceObj = activeMountRoot
    ? snap?.mounts.find((m) => m.mount_root === activeMountRoot) || null
    : null;
  const writablePlaylists = playlists.filter((p) => p.origin === 'simp_local');

  const searchLower = browserSearch.trim().toLowerCase();

  // Source-aware SIMP Playlist membership (`has_local`, `has_apple`, & `has_soundcloud`)
  const filteredPlaylists = useMemo(
    () =>
      playlists.filter((pl) => {
        if (browserSourceFilter === 'local') {
          if (pl.origin === 'apple_remote' || pl.origin === 'soundcloud_remote') return false;
          // Exclude user-created SIMP playlists that contain ONLY cloud tracks
          if (pl.track_count > 0 && (pl.has_apple || pl.has_soundcloud) && !pl.has_local) return false;
        } else if (browserSourceFilter === 'apple_music') {
          if (pl.origin === 'soundcloud_remote') return false;
          if (pl.origin === 'simp_local' && pl.track_count > 0 && !pl.has_apple) {
            return false;
          }
        } else if (browserSourceFilter === 'soundcloud') {
          if (pl.origin === 'apple_remote') return false;
          if (pl.origin === 'simp_local' && pl.track_count > 0 && !pl.has_soundcloud) {
            return false;
          }
        }
        if (searchLower) {
          return (
            pl.name.toLowerCase().includes(searchLower) ||
            (pl.description && pl.description.toLowerCase().includes(searchLower))
          );
        }
        return true;
      }),
    [playlists, browserSourceFilter, searchLower]
  );

  const cleanCollectionTitle = (raw: string): string =>
    raw.replace(/^[\s📌🍎☁️🎵💿]+/u, '').trim() || raw;

  const formatPlaylistSourceBadge = (pl: PlaylistRecord): string => {
    if (pl.origin === 'soundcloud_remote') {
      return '☁️';
    }
    if (pl.origin !== 'simp_local') {
      return '🍎';
    }
    const parts: string[] = [];
    if (pl.has_local) parts.push('💾');
    if (pl.has_apple) parts.push('🍎');
    if (pl.has_soundcloud) parts.push('☁️');
    if (parts.length > 0) {
      return parts.join(' + ');
    }
    return '★ SIMP';
  };

  const hybridPlaylistsList = useMemo(
    () => filteredPlaylists.filter((p) => p.origin === 'simp_local'),
    [filteredPlaylists]
  );
  const pinnedPlaylistsList = useMemo(
    () =>
      filteredPlaylists.filter(
        (p) => p.origin === 'apple_remote' || p.origin === 'soundcloud_remote'
      ),
    [filteredPlaylists]
  );

  // Filtered Cloud Playlists (supports both Search query and A-Z bucket filter + 50/page pagination)
  const filteredCloudPlaylists = useMemo(() => {
    return cloudPlaylists.filter((pl) => {
      if (searchLower) {
        const matchName = pl.name.toLowerCase().includes(searchLower);
        const matchDesc = pl.description ? pl.description.toLowerCase().includes(searchLower) : false;
        if (!matchName && !matchDesc) return false;
      }
      if (!searchLower && !matchesAlphaBucket(pl.name, cloudAlpha)) {
        return false;
      }
      return true;
    });
  }, [cloudPlaylists, searchLower, cloudAlpha]);

  const totalCloudPages = Math.max(1, Math.ceil(filteredCloudPlaylists.length / CLOUD_PAGE_SIZE));
  const safeCloudPage = Math.min(cloudPage, totalCloudPages - 1);
  const pagedCloudPlaylists = useMemo(
    () =>
      filteredCloudPlaylists.slice(
        safeCloudPage * CLOUD_PAGE_SIZE,
        (safeCloudPage + 1) * CLOUD_PAGE_SIZE
      ),
    [filteredCloudPlaylists, safeCloudPage]
  );

  // Throttled background backfill for visible Apple Playlists that have no playlist-level cover art
  // (fetches the playlist's first song cover on `mzstatic.com` and caches it in SQLite + memory)
  useEffect(() => {
    if (!snap?.apple_authenticated || browserSourceFilter === 'local') return;
    const candidates = pagedCloudPlaylists.filter(
      (pl) =>
        (!pl.art_url || pl.art_url.includes('blobstore.apple.com')) &&
        !resolvedPlaylistCoverMemoryCache.has(pl.id) &&
        !failedPlaylistCoverLookupIds.has(pl.id)
    );
    if (candidates.length === 0) return;

    let cancelled = false;
    const runBackfill = async () => {
      for (const pl of candidates.slice(0, 16)) {
        if (cancelled) break;
        failedPlaylistCoverLookupIds.add(pl.id);
        try {
          const resp = await fetch(
            `/api/apple/playlist-cover?id=${encodeURIComponent(pl.id)}&kind=${encodeURIComponent(
              pl.kind || 'library'
            )}`
          );
          const data = await resp.json();
          if (!cancelled && data?.ok && data?.art_url) {
            resolvedPlaylistCoverMemoryCache.set(pl.id, data.art_url);
            setCloudPlaylists((prev) =>
              prev.map((item) => (item.id === pl.id ? { ...item, art_url: data.art_url } : item))
            );
          }
        } catch {
          // Ignore individual failures
        }
        await new Promise((r) => window.setTimeout(r, 260));
      }
    };
    runBackfill();
    return () => {
      cancelled = true;
    };
  }, [pagedCloudPlaylists, snap?.apple_authenticated, browserSourceFilter, setCloudPlaylists]);

  // Right-pane navigation history stack so mouse users (and controller 'B' in Tracklist/Service view) can walk back step-by-step
  interface RightNavEntry {
    browserSourceFilter: 'all' | 'local' | 'apple_music' | 'soundcloud';
    rightPaneMode: 'browse' | 'tracks';
    browserTarget: BrowserTarget | null;
    browserTracks: TrackMetadata[];
    appleSubTab: 'pinned' | 'cloud_playlists' | 'radio' | 'new';
    soundCloudSubTab: 'pinned' | 'likes_sets' | 'stream_radio' | 'trending';
    activeMountRoot: string | null;
    browserSearch: string;
  }
  const [navHistory, setNavHistory] = useState<RightNavEntry[]>([]);

  const pushCurrentNavState = useCallback(() => {
    if (xmbPreviewTriggerRef.current) return;
    setNavHistory((prev) => {
      const next: RightNavEntry = {
        browserSourceFilter,
        rightPaneMode,
        browserTarget,
        browserTracks,
        appleSubTab,
        soundCloudSubTab,
        activeMountRoot,
        browserSearch,
      };
      const last = prev[prev.length - 1];
      if (
        last &&
        last.browserSourceFilter === next.browserSourceFilter &&
        last.rightPaneMode === next.rightPaneMode &&
        last.appleSubTab === next.appleSubTab &&
        last.soundCloudSubTab === next.soundCloudSubTab &&
        last.activeMountRoot === next.activeMountRoot &&
        last.browserSearch === next.browserSearch &&
        JSON.stringify(last.browserTarget) === JSON.stringify(next.browserTarget)
      ) {
        return prev;
      }
      return [...prev.slice(-15), next];
    });
  }, [
    browserSourceFilter,
    rightPaneMode,
    browserTarget,
    browserTracks,
    appleSubTab,
    soundCloudSubTab,
    activeMountRoot,
    browserSearch,
  ]);

  const handleWalkBack = useCallback(() => {
    if (navHistory.length > 0) {
      const prev = navHistory[navHistory.length - 1];
      setNavHistory((h) => h.slice(0, -1));
      setBrowserSourceFilter(prev.browserSourceFilter);
      setAppleSubTab(prev.appleSubTab);
      setSoundCloudSubTab(prev.soundCloudSubTab);
      setActiveMountRoot(prev.activeMountRoot);
      setBrowserSearch(prev.browserSearch);
      setBrowserTarget(prev.browserTarget);
      setBrowserTracks(prev.browserTracks);
      setRightPaneMode(prev.rightPaneMode);
      if (prev.rightPaneMode === 'browse') {
        focusRightPaneFirstTile();
      } else {
        focusRightPaneFirstTrack();
      }
      return;
    }
    if (rightPaneMode === 'tracks') {
      setRightPaneMode('browse');
      focusRightPaneFirstTile();
      return;
    }
    if (browserSearch.trim()) {
      setBrowserSearch('');
      return;
    }
    if (activeMountRoot) {
      setActiveMountRoot(null);
      return;
    }
    if (browserSourceFilter !== 'all') {
      setBrowserSourceFilter('all');
      setAppleSubTab('pinned');
      setSoundCloudSubTab('pinned');
      return;
    }
  }, [
    navHistory,
    rightPaneMode,
    browserSearch,
    activeMountRoot,
    browserSourceFilter,
    setBrowserSourceFilter,
    setAppleSubTab,
    setSoundCloudSubTab,
    setActiveMountRoot,
    setBrowserSearch,
    setBrowserTarget,
    setBrowserTracks,
    setRightPaneMode,
    focusRightPaneFirstTile,
    focusRightPaneFirstTrack,
  ]);

  const canWalkBackInBrowse =
    navHistory.length > 0 ||
    Boolean(browserSearch.trim()) ||
    Boolean(activeMountRoot) ||
    browserSourceFilter !== 'all';

  // Open a collection, switch the Right Pane to Tracklist view, and focus the first track
  const selectLocalCollection = (target: BrowserTarget) => {
    pushCurrentNavState();
    setBrowserTarget(target);
    setRightPaneMode('tracks');
    focusRightPaneFirstTrack();
  };

  const selectCloudPlaylist = async (pl: AppleCloudPlaylistSummary) => {
    pushCurrentNavState();
    setRightPaneMode('tracks');
    focusRightPaneFirstTrack();
    await handleOpenCloudPlaylist(pl);
  };

  const selectSoundCloudPlaylist = async (pl: SoundCloudPlaylistSummary) => {
    pushCurrentNavState();
    setRightPaneMode('tracks');
    focusRightPaneFirstTrack();
    await handleOpenSoundCloudPlaylist(pl);
  };

  const selectCloudAlbum = async (params: {
    albumId?: string | null;
    songUri?: string | null;
    fallbackTitle?: string;
  }) => {
    pushCurrentNavState();
    setRightPaneMode('tracks');
    focusRightPaneFirstTrack();
    await handleOpenFullAppleAlbum(params);
  };

  const activeHubLabel = browserSearch.trim()
    ? 'Search Results'
    : activeMountPlaceObj
    ? `💾 ${activeMountPlaceObj.label}`
    : browserSourceFilter === 'local'
    ? 'Local SIMP Library'
    : browserSourceFilter === 'soundcloud'
    ? soundCloudSubTab === 'likes_sets'
      ? 'SoundCloud Likes & Sets'
      : soundCloudSubTab === 'stream_radio'
      ? 'SoundCloud Stream & Radio'
      : soundCloudSubTab === 'trending'
      ? 'SoundCloud Trending & Mixes'
      : 'SIMP Library (SoundCloud)'
    : appleSubTab === 'cloud_playlists'
    ? 'Apple Playlists'
    : appleSubTab === 'radio'
    ? 'Radio & For You'
    : appleSubTab === 'new'
    ? 'New & Charts'
    : browserSourceFilter === 'apple_music'
    ? 'SIMP Library (Apple)'
    : 'My SIMP Library';

  const cycleTargetHybridPlaylist = useCallback(() => {
    if (writablePlaylists.length >= 2) {
      const activeIdx = Math.max(
        0,
        writablePlaylists.findIndex((wp) => wp.id === activePlaylistId)
      );
      const nextWp = writablePlaylists[(activeIdx + 1) % writablePlaylists.length];
      setActivePlaylistId(nextWp.id);
    } else {
      setPlaylistsOpen(true);
      setCreatingPlaylist(true);
    }
  }, [writablePlaylists, activePlaylistId, setActivePlaylistId, setCreatingPlaylist]);

  const handleAddSimpPlaylistToHybrid = useCallback(
    async (pl: PlaylistRecord) => {
      try {
        const items = await defaultSimpClient.query<TrackMetadata[]>('get_playlist_items', {
          playlist_id: pl.id,
          limit: 2000,
          offset: 0,
        });
        if (items.length > 0) {
          await handleAddTracksToPlaylist(
            items.map((t) => t.uri),
            `all ${items.length} tracks from "${cleanCollectionTitle(pl.name)}"`,
            items
          );
        }
      } catch {
        // Handled by parent toast
      }
    },
    [handleAddTracksToPlaylist]
  );

  const handleAddSimpAlbumToHybrid = useCallback(
    async (alb: AlbumRecord) => {
      try {
        const items = await defaultSimpClient.query<TrackMetadata[]>('get_album_tracks', {
          album_id: alb.id,
        });
        if (items.length > 0) {
          await handleAddTracksToPlaylist(
            items.map((t) => t.uri),
            `all ${items.length} tracks from "${cleanCollectionTitle(alb.title)}"`,
            items
          );
        }
      } catch {
        // Handled by parent toast
      }
    },
    [handleAddTracksToPlaylist]
  );

  const handleAddCloudPlaylistToHybrid = useCallback(
    async (pl: AppleCloudPlaylistSummary) => {
      setCloudLoading(true);
      try {
        const items = await fetchApplePlaylistTracks(pl.id, pl.kind);
        if (items.length > 0) {
          await handleAddTracksToPlaylist(
            items.map((t) => t.uri),
            `all ${items.length} tracks from "${pl.name}"`,
            items
          );
        }
      } catch {
        // Handled by parent toast
      } finally {
        setCloudLoading(false);
      }
    },
    [handleAddTracksToPlaylist, setCloudLoading]
  );

  const handleAddCloudAlbumToHybrid = useCallback(
    async (alb: AppleCloudAlbumSummary) => {
      setCloudLoading(true);
      try {
        const { tracks } = await fetchFullAppleAlbum({ albumId: alb.id });
        if (tracks.length > 0) {
          await handleAddTracksToPlaylist(
            tracks.map((t) => t.uri),
            `all ${tracks.length} tracks from "${alb.title}"`,
            tracks
          );
        }
      } catch {
        // Handled by parent toast
      } finally {
        setCloudLoading(false);
      }
    },
    [handleAddTracksToPlaylist, setCloudLoading]
  );

  const handleAddSoundCloudPlaylistToHybrid = useCallback(
    async (pl: SoundCloudPlaylistSummary) => {
      setCloudLoading(true);
      try {
        const items = await fetchSoundCloudPlaylistTracks(pl.id);
        if (items.length > 0) {
          await handleAddTracksToPlaylist(
            items.map((t) => t.uri),
            `all ${items.length} tracks from "${pl.name}"`,
            items
          );
        }
      } catch {
        // Handled by parent toast
      } finally {
        setCloudLoading(false);
      }
    },
    [handleAddTracksToPlaylist, setCloudLoading]
  );

  // Listen for `SELECT` (Add to Hybrid) and `Y` (Pin/Unpin to SIMP) gamepad/keyboard actions
  useEffect(() => {
    if (hidden) return;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ op: 'y' | 'select' }>).detail;
      if (!detail) return;
      const focused = document.querySelector<HTMLElement>('[data-simp-active-focus="true"]');

      if (detail.op === 'select') {
        // 1. Focused on (or inside) a single track row -> click its `[data-track-select="true"]` action (`+` or `−`)
        const trackRow = focused?.closest<HTMLElement>(
          '[data-right-track="true"], [data-single-song-row="true"]'
        );
        const trackSelectBtn =
          focused?.querySelector<HTMLElement>('[data-track-select="true"]') ||
          trackRow?.querySelector<HTMLElement>('[data-track-select="true"]');
        if (trackSelectBtn) {
          trackSelectBtn.click();
          return;
        }

        // 2. Focused on a Right-Pane Collection Tile -> click its `[data-tile-select="true"]` action (`+`)
        if (focused?.dataset.rightTile === 'true') {
          const tileSelectBtn = focused.querySelector<HTMLElement>('[data-tile-select="true"]');
          if (tileSelectBtn) {
            tileSelectBtn.click();
            return;
          }
        }

        // 3. Focused on a Left-Column `simp_local` playlist row -> set as active ★ target (or cycle if already active)
        const leftHybridId = focused?.dataset.leftHybridId;
        if (leftHybridId) {
          if (activePlaylistId !== leftHybridId) {
            setActivePlaylistId(leftHybridId);
          } else {
            cycleTargetHybridPlaylist();
          }
          return;
        }

        // 4. In Tracklist view (`rightPaneMode === 'tracks'`) -> trigger collection-level `[data-collection-select="true"]`
        if (rightPaneMode === 'tracks') {
          const collSelectBtn = document.querySelector<HTMLElement>(
            '[data-collection-select="true"]'
          );
          if (collSelectBtn) {
            collSelectBtn.click();
            return;
          }
        }

        // 5. Fallback: cycle active ★ SIMP Hybrid Playlist target
        cycleTargetHybridPlaylist();
      } else if (detail.op === 'y') {
        // 1. Focused on a Right-Pane Collection Tile -> click its `[data-tile-y="true"]` action (`📌` / `✕` / `🗑`)
        if (focused?.dataset.rightTile === 'true') {
          const tileYBtn = focused.querySelector<HTMLElement>('[data-tile-y="true"]');
          if (tileYBtn) {
            tileYBtn.click();
            return;
          }
        }

        // 2. Focused on a Left-Column playlist row -> unpin/delete playlist
        const leftPlaylistId = focused?.dataset.leftPlaylistId;
        const leftPlaylistName = focused?.dataset.leftPlaylistName;
        if (leftPlaylistId && leftPlaylistName) {
          handleDeletePlaylist(leftPlaylistId, leftPlaylistName);
          return;
        }

        // 3. In Tracklist view (`rightPaneMode === 'tracks'`) -> trigger collection-level `[data-collection-y="true"]`
        if (rightPaneMode === 'tracks') {
          const collYBtn = document.querySelector<HTMLElement>('[data-collection-y="true"]');
          if (collYBtn) {
            collYBtn.click();
            return;
          }
        }
      }
    };
    window.addEventListener('simp-browser-gamepad-op', handler);
    return () => window.removeEventListener('simp-browser-gamepad-op', handler);
  }, [
    hidden,
    activePlaylistId,
    setActivePlaylistId,
    cycleTargetHybridPlaylist,
    rightPaneMode,
    handleDeletePlaylist,
  ]);

  // Context Legend & Collection Action Bar (Target pill retired; SELECT/Y badges hidden in mouse mode)
  const renderContextLegendBar = () => {
    const isViewingLocalPlaylist =
      rightPaneMode === 'tracks' &&
      browserTarget?.kind === 'playlist' &&
      selectedPlaylistObj?.origin === 'simp_local';

    const isCloudPlaylistPinned =
      rightPaneMode === 'tracks' &&
      browserTarget?.kind === 'cloud_playlist' &&
      activeCloudPlaylist &&
      playlists.some((p) => p.id === `applemusic:playlist:${activeCloudPlaylist.id}`);

    const isScPlaylistPinned =
      rightPaneMode === 'tracks' &&
      browserTarget?.kind === 'cloud_playlist' &&
      activeScPlaylist &&
      playlists.some((p) => p.id === `soundcloud:playlist:${activeScPlaylist.id}`);

    const isCloudAlbumPinned =
      rightPaneMode === 'tracks' &&
      browserTarget?.kind === 'cloud_album' &&
      activeCloudAlbum &&
      albums.some((a) => a.id === `applemusic:album:${activeCloudAlbum.id}`);

    const gpSelectBadge = (
      <span
        className="simp-gp-badge"
        style={{
          padding: '1px 5px',
          borderRadius: 4,
          background: '#141822',
          border: '1px solid #283044',
          color: '#67e8f9',
          fontFamily: 'monospace',
          fontSize: 10,
          fontWeight: 800,
          marginRight: 5,
        }}
      >
        SELECT
      </span>
    );

    const gpYBadge = (
      <span
        className="simp-gp-badge"
        style={{
          padding: '1px 5px',
          borderRadius: 4,
          background: '#1e1610',
          border: '1px solid #4c3518',
          color: '#fcd34d',
          fontFamily: 'monospace',
          fontSize: 10,
          fontWeight: 800,
          marginRight: 5,
        }}
      >
        Y
      </span>
    );

    // In Grid view (`browse`), show `← Back` when there is navigation history (mouse or gamepad),
    // and show the muted controller legend when a gamepad is active
    if (rightPaneMode === 'browse') {
      return (
        <div
          className={canWalkBackInBrowse ? undefined : 'simp-gp-badge'}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
            padding: '5px 10px',
            borderRadius: 8,
            background: '#0a0b10',
            border: '1px solid #161822',
            fontSize: 11,
            color: '#8e8e99',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {canWalkBackInBrowse && (
              <button
                data-right-walk-back="true"
                onClick={handleWalkBack}
                title="Walk back to previous Library view"
                style={{
                  minHeight: 24,
                  padding: '2px 9px',
                  borderRadius: 6,
                  background: '#14141e',
                  border: '1px solid #2a2a38',
                  color: '#bfeaf5',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
            )}
            <span className="simp-gp-badge" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {gpSelectBadge}
              <span>+ Add tile to SIMP Playlist</span>
            </span>
          </div>
          <span className="simp-gp-badge" style={{ display: 'inline-flex', alignItems: 'center' }}>
            {gpYBadge}
            <span>📌 Pin / Unpin focused tile</span>
          </span>
        </div>
      );
    }

    const canAddAllTracks =
      browserTarget &&
      (browserTarget.kind === 'album' ||
        browserTarget.kind === 'mount' ||
        browserTarget.kind === 'cloud_album' ||
        browserTarget.kind === 'cloud_playlist' ||
        (browserTarget.kind === 'playlist' && selectedPlaylistObj?.origin !== 'simp_local')) &&
      browserTracks.length > 0;

    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          padding: '5px 10px',
          borderRadius: 8,
          background: '#0a0b10',
          border: '1px solid #161822',
          fontSize: 11,
          color: '#8e8e99',
        }}
      >
        {/* Left side: SELECT hint (only shown when controller is active) + Add All button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="simp-gp-badge" style={{ display: 'inline-flex', alignItems: 'center' }}>
            {gpSelectBadge}
            <span>
              {isViewingLocalPlaylist
                ? '− Remove focused track'
                : '+ Add focused track / collection'}
            </span>
          </span>

          {canAddAllTracks && (
            <button
              data-tile-aux="true"
              data-collection-select="true"
              onClick={() =>
                handleAddTracksToPlaylist(
                  browserTracks.map((t) => t.uri),
                  `all ${browserTracks.length} tracks`,
                  browserTracks
                )
              }
              title={`Add all ${browserTracks.length} tracks to SIMP Hybrid Playlist`}
              style={{
                padding: '3px 9px',
                borderRadius: 6,
                background: '#121820',
                border: '1px solid #283848',
                color: '#bfeaf5',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              + Add All ({browserTracks.length})
            </button>
          )}
        </div>

        {/* Right side: Single Pin / Unpin / Delete control (exposes [Y] badge when controller is active) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
          {browserTarget && (
            <>
              {browserTarget.kind === 'cloud_playlist' && activeCloudPlaylist && (
                <button
                  data-tile-aux="true"
                  data-collection-y="true"
                  onClick={() => {
                    if (isCloudPlaylistPinned) {
                      handleDeletePlaylist(
                        `applemusic:playlist:${activeCloudPlaylist.id}`,
                        activeCloudPlaylist.name
                      );
                    } else {
                      handlePinCloudPlaylist(activeCloudPlaylist, browserTracks);
                    }
                  }}
                  title="Pin or Unpin this playlist in SIMP"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '3px 9px',
                    borderRadius: 6,
                    background: isCloudPlaylistPinned ? '#0f222a' : '#241119',
                    border: isCloudPlaylistPinned ? '1px solid #2aa3c4' : '1px solid #5c1f33',
                    color: isCloudPlaylistPinned ? '#67e8f9' : '#fecdd3',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {gpYBadge}
                  <span>{isCloudPlaylistPinned ? '✓ Pinned (Unpin)' : '📌 Pin to SIMP'}</span>
                </button>
              )}

              {browserTarget.kind === 'cloud_playlist' && activeScPlaylist && (
                <button
                  data-tile-aux="true"
                  data-collection-y="true"
                  onClick={() => {
                    if (isScPlaylistPinned) {
                      handleDeletePlaylist(
                        `soundcloud:playlist:${activeScPlaylist.id}`,
                        activeScPlaylist.name
                      );
                    } else {
                      handlePinSoundCloudPlaylist(activeScPlaylist, browserTracks);
                    }
                  }}
                  title="Pin or Unpin this SoundCloud set in SIMP"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '3px 9px',
                    borderRadius: 6,
                    background: isScPlaylistPinned ? '#0f222a' : '#2c140a',
                    border: isScPlaylistPinned ? '1px solid #2aa3c4' : '1px solid #ea580c',
                    color: isScPlaylistPinned ? '#67e8f9' : '#fdba74',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {gpYBadge}
                  <span>{isScPlaylistPinned ? '✓ Pinned (Unpin)' : '📌 Pin Set to SIMP'}</span>
                </button>
              )}

              {browserTarget.kind === 'cloud_album' && activeCloudAlbum && (
                <button
                  data-tile-aux="true"
                  data-collection-y="true"
                  onClick={() => {
                    if (isCloudAlbumPinned) {
                      handleDeleteAlbum(
                        `applemusic:album:${activeCloudAlbum.id}`,
                        activeCloudAlbum.title
                      );
                    } else {
                      handlePinCloudAlbum(activeCloudAlbum, browserTracks);
                    }
                  }}
                  title="Pin or Unpin this album in SIMP"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '3px 9px',
                    borderRadius: 6,
                    background: isCloudAlbumPinned ? '#0f222a' : '#241119',
                    border: isCloudAlbumPinned ? '1px solid #2aa3c4' : '1px solid #5c1f33',
                    color: isCloudAlbumPinned ? '#67e8f9' : '#fecdd3',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {gpYBadge}
                  <span>{isCloudAlbumPinned ? '✓ Pinned (Unpin)' : '📌 Pin Album to SIMP'}</span>
                </button>
              )}

              {browserTarget.kind === 'playlist' && selectedPlaylistObj && (
                <button
                  data-tile-aux="true"
                  data-collection-y="true"
                  onClick={() => {
                    handleDeletePlaylist(selectedPlaylistObj.id, selectedPlaylistObj.name);
                    setRightPaneMode('browse');
                  }}
                  title={
                    selectedPlaylistObj.origin === 'simp_local'
                      ? 'Delete this SIMP Playlist'
                      : 'Unpin this playlist from SIMP'
                  }
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '3px 9px',
                    borderRadius: 6,
                    background: '#1e1115',
                    border: '1px solid #4c2228',
                    color: '#fca5a5',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {gpYBadge}
                  <span>
                    {selectedPlaylistObj.origin === 'simp_local'
                      ? '🗑 Delete Playlist'
                      : '✕ Unpin Playlist'}
                  </span>
                </button>
              )}

              {browserTarget.kind === 'album' &&
                selectedAlbumObj &&
                selectedAlbumObj.id.startsWith('applemusic:album:') && (
                  <button
                    data-tile-aux="true"
                    data-collection-y="true"
                    onClick={() => {
                      handleDeleteAlbum(selectedAlbumObj.id, selectedAlbumObj.title);
                      setRightPaneMode('browse');
                    }}
                    title="Unpin this album from SIMP"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '3px 9px',
                      borderRadius: 6,
                      background: '#1e1115',
                      border: '1px solid #4c2228',
                      color: '#fca5a5',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {gpYBadge}
                    <span>✕ Unpin Album</span>
                  </button>
                )}
            </>
          )}
        </div>
      </div>
    );
  };

  // Responsive 4-Column-Max Tile Grid Style (~17px narrower min-width so 4 tiles fit cleanly on Steam Deck)
  const tileGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(max(158px, calc((100% - 30px) / 4)), 1fr))',
    gap: 10,
    width: '100%',
    minWidth: 0,
  };

  // Reusable Visual Tile for SIMP Hybrid & Pinned Playlists (in `📌 My SIMP Library`)
  const renderSimpPlaylistCard = (pl: PlaylistRecord) => {
    const isLocal = pl.origin === 'simp_local';
    const isActiveTarget = isLocal && activePlaylistId === pl.id;
    const isSelected =
      rightPaneMode === 'tracks' && browserTarget?.kind === 'playlist' && browserTarget.id === pl.id;
    const cleanTitle = cleanCollectionTitle(pl.name);
    const sourceBadge = formatPlaylistSourceBadge(pl);
    return (
      <button
        key={pl.id}
        data-right-tile="true"
        onClick={() => {
          if (isLocal) {
            setActivePlaylistId(pl.id);
          }
          selectLocalCollection({ kind: 'playlist', id: pl.id });
        }}
        style={{
          minWidth: 0,
          minHeight: 124,
          padding: 10,
          borderRadius: 12,
          background: isSelected ? '#0d1b22' : '#0a0a0e',
          border: isSelected ? '1px solid #2aa3c4' : '1px solid #181822',
          color: '#d4d4dc',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 6,
          }}
        >
          <ResilientTileArtwork
            src={pl.cover_art_url}
            fallbackIcon={isLocal ? '🎵' : '🍎'}
            bg={isLocal ? '#0f222a' : '#251018'}
            border={isLocal ? '1px solid #2aa3c4' : '1px solid #4c1d2e'}
            playlistCoverId={
              pl.id.startsWith('applemusic:playlist:')
                ? pl.id.replace('applemusic:playlist:', '')
                : undefined
            }
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span
              style={{
                padding: '3px 6px',
                borderRadius: 6,
                background: isLocal ? '#0f222a' : '#251018',
                border: isLocal ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
                color: isLocal ? '#67e8f9' : '#fda4af',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
              }}
            >
              {isActiveTarget ? `★ ${sourceBadge}` : sourceBadge}
            </span>
            {!isLocal ? (
              <span
                role="button"
                data-tile-aux="true"
                data-tile-select="true"
                title="Add all tracks to active ★ SIMP Hybrid Playlist (SELECT)"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddSimpPlaylistToHybrid(pl);
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: 6,
                  background: '#0f222a',
                  border: '1px solid #2aa3c4',
                  color: '#67e8f9',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                +
              </span>
            ) : (
              <span
                role="button"
                data-tile-aux="true"
                data-tile-select="true"
                title="Set as active ★ target playlist (SELECT)"
                onClick={(e) => {
                  e.stopPropagation();
                  setActivePlaylistId(pl.id);
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: 6,
                  background: isActiveTarget ? '#13303d' : '#12141c',
                  border: isActiveTarget ? '1px solid #2aa3c4' : '1px solid #262a38',
                  color: isActiveTarget ? '#67e8f9' : '#71717a',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ★
              </span>
            )}
            <span
              role="button"
              data-tile-aux="true"
              data-tile-y="true"
              title={isLocal ? 'Delete SIMP Playlist (Y)' : 'Unpin Playlist from SIMP (Y)'}
              onClick={(e) => {
                e.stopPropagation();
                handleDeletePlaylist(pl.id, cleanTitle);
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#1c1115',
                border: '1px solid #4c2228',
                color: '#fca5a5',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isLocal ? '🗑' : '✕'}
            </span>
          </div>
        </div>
        <div style={{ minWidth: 0, width: '100%' }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              lineHeight: 1.3,
              color: '#e4e4ec',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {cleanTitle}
          </div>
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.35,
              color: '#8e8e99',
              marginTop: 4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {pl.track_count} {pl.track_count === 1 ? 'track' : 'tracks'}
          </div>
        </div>
      </button>
    );
  };

  // Reusable Visual Tile for Local & Pinned Albums (in `📌 My SIMP Library`)
  const renderSimpAlbumCard = (alb: AlbumRecord) => {
    const isAppleAlbum = alb.id.startsWith('applemusic:album:');
    const isSelected =
      rightPaneMode === 'tracks' && browserTarget?.kind === 'album' && browserTarget.id === alb.id;
    const cleanTitle = cleanCollectionTitle(alb.title);
    return (
      <button
        key={alb.id}
        data-right-tile="true"
        onClick={() => selectLocalCollection({ kind: 'album', id: alb.id })}
        style={{
          minWidth: 0,
          minHeight: 124,
          padding: 10,
          borderRadius: 12,
          background: isSelected ? '#0d1b22' : '#0a0a0e',
          border: isSelected ? '1px solid #2aa3c4' : '1px solid #181822',
          color: '#d4d4dc',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 6,
          }}
        >
          <ResilientTileArtwork
            src={alb.art_url}
            fallbackIcon="💿"
            bg="#121820"
            border="1px solid #222e3c"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span
              style={{
                padding: '3px 6px',
                borderRadius: 6,
                background: isAppleAlbum ? '#251018' : '#0f222a',
                border: isAppleAlbum ? '1px solid #4c1d2e' : '1px solid #2aa3c4',
                color: isAppleAlbum ? '#fda4af' : '#67e8f9',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
              }}
            >
              {isAppleAlbum ? '🍎' : '💾'}
            </span>
            <span
              role="button"
              data-tile-aux="true"
              data-tile-select="true"
              title="Add album tracks to active ★ SIMP Hybrid Playlist (SELECT)"
              onClick={(e) => {
                e.stopPropagation();
                handleAddSimpAlbumToHybrid(alb);
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#0f222a',
                border: '1px solid #2aa3c4',
                color: '#67e8f9',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              +
            </span>
            {isAppleAlbum && (
              <span
                role="button"
                data-tile-aux="true"
                data-tile-y="true"
                title="Unpin Album from SIMP (Y)"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteAlbum(alb.id, cleanTitle);
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: 6,
                  background: '#1c1115',
                  border: '1px solid #4c2228',
                  color: '#fca5a5',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ✕
              </span>
            )}
          </div>
        </div>
        <div style={{ minWidth: 0, width: '100%' }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              lineHeight: 1.3,
              color: '#e4e4ec',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {cleanTitle}
          </div>
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.35,
              color: '#8e8e99',
              marginTop: 4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {alb.album_artist} • {alb.track_count} tracks
          </div>
        </div>
      </button>
    );
  };

  // Reusable Visual Tile for Cloud Playlists
  const renderCloudPlaylistCard = (pl: AppleCloudPlaylistSummary) => {
    const isSelected = browserTarget?.kind === 'cloud_playlist' && browserTarget.id === pl.id;
    const isPinned = playlists.some((p) => p.id === `applemusic:playlist:${pl.id}`);
    return (
      <button
        key={pl.id}
        data-right-tile="true"
        onClick={() => selectCloudPlaylist(pl)}
        style={{
          minWidth: 0,
          minHeight: 124,
          padding: 10,
          borderRadius: 12,
          background: isSelected ? '#28111b' : '#0a0a0e',
          border: isSelected ? '1px solid #fa243c' : '1px solid #181822',
          color: '#d4d4dc',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 6,
          }}
        >
          <ResilientTileArtwork
            src={pl.art_url}
            fallbackIcon="☁️"
            bg="#181118"
            border="1px solid #321a24"
            playlistCoverId={pl.id}
            playlistKind={pl.kind}
            onResolvedCover={(url) => {
              setCloudPlaylists((prev) =>
                prev.map((item) => (item.id === pl.id ? { ...item, art_url: url } : item))
              );
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span
              role="button"
              data-tile-aux="true"
              data-tile-select="true"
              title="Add playlist tracks to active ★ SIMP Hybrid Playlist (SELECT)"
              onClick={(e) => {
                e.stopPropagation();
                handleAddCloudPlaylistToHybrid(pl);
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#0f222a',
                border: '1px solid #2aa3c4',
                color: '#67e8f9',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              +
            </span>
            <span
              role="button"
              data-tile-aux="true"
              data-tile-y="true"
              title={isPinned ? 'Unpin Playlist from SIMP (Y)' : 'Pin Playlist to SIMP (Y)'}
              onClick={(e) => {
                e.stopPropagation();
                if (isPinned) {
                  handleDeletePlaylist(`applemusic:playlist:${pl.id}`, pl.name);
                } else {
                  handlePinCloudPlaylist(pl);
                }
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: isPinned ? '#0f222a' : '#251018',
                border: isPinned ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
                color: isPinned ? '#67e8f9' : '#fda4af',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isPinned ? '✓ 📌' : '📌'}
            </span>
          </div>
        </div>
        <div style={{ minWidth: 0, width: '100%' }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              lineHeight: 1.3,
              color: '#e4e4ec',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {pl.name}
          </div>
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.35,
              color: '#8e8e99',
              marginTop: 4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {pl.description || 'Apple Music Playlist'}
          </div>
        </div>
      </button>
    );
  };

  // Reusable Visual Tile for Cloud / Catalog Albums
  const renderCloudAlbumCard = (alb: AppleCloudAlbumSummary) => {
    const isSelected = browserTarget?.kind === 'cloud_album' && browserTarget.id === alb.id;
    const isPinned = albums.some((a) => a.id === `applemusic:album:${alb.id}`);
    return (
      <button
        key={alb.id}
        data-right-tile="true"
        onClick={() =>
          selectCloudAlbum({
            albumId: alb.id,
            fallbackTitle: alb.title,
          })
        }
        style={{
          minWidth: 0,
          minHeight: 124,
          padding: 10,
          borderRadius: 12,
          background: isSelected ? '#28111b' : '#0a0a0e',
          border: isSelected ? '1px solid #fa243c' : '1px solid #181822',
          color: '#d4d4dc',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 6,
          }}
        >
          <ResilientTileArtwork
            src={alb.art_url}
            fallbackIcon="💿"
            bg="#181118"
            border="1px solid #321a24"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span
              role="button"
              data-tile-aux="true"
              data-tile-select="true"
              title="Add album tracks to active ★ SIMP Hybrid Playlist (SELECT)"
              onClick={(e) => {
                e.stopPropagation();
                handleAddCloudAlbumToHybrid(alb);
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#0f222a',
                border: '1px solid #2aa3c4',
                color: '#67e8f9',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              +
            </span>
            <span
              role="button"
              data-tile-aux="true"
              data-tile-y="true"
              title={isPinned ? 'Unpin Album from SIMP (Y)' : 'Pin Album to SIMP (Y)'}
              onClick={(e) => {
                e.stopPropagation();
                if (isPinned) {
                  handleDeleteAlbum(`applemusic:album:${alb.id}`, alb.title);
                } else {
                  setCloudLoading(true);
                  fetchFullAppleAlbum({ albumId: alb.id })
                    .then(({ album, tracks }) => handlePinCloudAlbum(album, tracks))
                    .catch(() => {})
                    .finally(() => setCloudLoading(false));
                }
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: isPinned ? '#0f222a' : '#251018',
                border: isPinned ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
                color: isPinned ? '#67e8f9' : '#fda4af',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isPinned ? '✓ 📌' : '📌'}
            </span>
          </div>
        </div>
        <div style={{ minWidth: 0, width: '100%' }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              lineHeight: 1.3,
              color: '#e4e4ec',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {alb.title}
          </div>
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.35,
              color: alb.kind === 'library' ? '#fda4af' : '#8e8e99',
              marginTop: 4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {alb.kind === 'library' ? `☁️ Your Library • ${alb.artist}` : alb.artist}
            {alb.release_year ? ` • ${alb.release_year}` : ''}
            {alb.track_count ? ` • ${alb.track_count} trk` : ''}
          </div>
        </div>
      </button>
    );
  };

  // Reusable Visual Tile for Radio Stations
  const renderStationCard = (st: AppleRadioStationSummary) => {
    const isPlayingStation = playingContextId === `station:${st.id}`;
    return (
      <button
        key={st.id}
        data-right-tile="true"
        onClick={() => handleStartAppleStation(st)}
        style={{
          minWidth: 0,
          minHeight: 124,
          padding: 10,
          borderRadius: 12,
          background: isPlayingStation ? '#28111b' : '#0a0a0e',
          border: isPlayingStation ? '1px solid #fa243c' : '1px solid #181822',
          color: '#d4d4dc',
          textAlign: 'left',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          cursor: 'pointer',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 6,
          }}
        >
          {st.art_url ? (
            <img
              src={st.art_url}
              alt=""
              loading="lazy"
              style={{
                width: 56,
                height: 56,
                borderRadius: 10,
                objectFit: 'cover',
                border: '1px solid #262632',
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 10,
                background: '#221118',
                border: '1px solid #4c1d2e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              📻
            </div>
          )}
          <span
            style={{
              fontSize: 10,
              fontFamily: 'monospace',
              color: '#fda4af',
              fontWeight: 800,
              padding: '3px 7px',
              borderRadius: 6,
              background: '#251018',
              border: '1px solid #4c1d2e',
              flexShrink: 0,
            }}
          >
            ▶ LIVE
          </span>
        </div>
        <div style={{ minWidth: 0, width: '100%' }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              lineHeight: 1.3,
              color: '#e4e4ec',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {st.name}
          </div>
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.35,
              color: '#8e8e99',
              marginTop: 4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {st.subtitle || 'Apple Music Station'}
          </div>
        </div>
      </button>
    );
  };

  // Reusable Visual Tile for SoundCloud Sets / Playlists
  const renderSoundCloudPlaylistCard = (pl: SoundCloudPlaylistSummary) => {
    const isSelected = browserTarget?.kind === 'cloud_playlist' && browserTarget.id === `sc:${pl.id}`;
    const isPinned = playlists.some((p) => p.id === `soundcloud:playlist:${pl.id}`);
    return (
      <button
        key={pl.id}
        data-right-tile="true"
        onClick={() => selectSoundCloudPlaylist(pl)}
        style={{
          minWidth: 0,
          minHeight: 124,
          padding: 10,
          borderRadius: 12,
          background: isSelected ? '#2c140a' : '#0a0a0e',
          border: isSelected ? '1px solid #ea580c' : '1px solid #181822',
          color: '#d4d4dc',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 6,
          }}
        >
          <ResilientTileArtwork
            src={pl.art_url}
            fallbackIcon="☁️"
            bg="#23120b"
            border="1px solid #7c2d12"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span
              role="button"
              data-tile-aux="true"
              data-tile-select="true"
              title="Add set tracks to active ★ SIMP Hybrid Playlist (SELECT)"
              onClick={(e) => {
                e.stopPropagation();
                handleAddSoundCloudPlaylistToHybrid(pl);
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#0f222a',
                border: '1px solid #2aa3c4',
                color: '#67e8f9',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              +
            </span>
            <span
              role="button"
              data-tile-aux="true"
              data-tile-y="true"
              title={isPinned ? 'Unpin Set from SIMP (Y)' : 'Pin Set to SIMP (Y)'}
              onClick={(e) => {
                e.stopPropagation();
                if (isPinned) {
                  handleDeletePlaylist(`soundcloud:playlist:${pl.id}`, pl.name);
                } else {
                  handlePinSoundCloudPlaylist(pl);
                }
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: isPinned ? '#0f222a' : '#2c140a',
                border: isPinned ? '1px solid #2aa3c4' : '1px solid #7c2d12',
                color: isPinned ? '#67e8f9' : '#fdba74',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isPinned ? '✓ 📌' : '📌'}
            </span>
          </div>
        </div>
        <div style={{ minWidth: 0, width: '100%' }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              lineHeight: 1.3,
              color: '#e4e4ec',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {pl.name}
          </div>
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.35,
              color: '#8e8e99',
              marginTop: 4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {pl.track_count ? `${pl.track_count} tracks • ` : ''}
            {pl.description || 'SoundCloud Set'}
          </div>
        </div>
      </button>
    );
  };

  // Reusable Row/Card for Individual Songs / Singles / DJ Mixes (Direct Play + Add to Hybrid Playlist + Open Full Album / Start Track Radio)
  const renderSingleSongRow = (s: TrackMetadata, peerList: TrackMetadata[], ctxPrefix: string) => {
    const isLongMix = s.source === 'soundcloud' && s.duration_ms >= 20 * 60 * 1000;
    const durMin = Math.floor(s.duration_ms / 60000);
    const durSec = Math.floor((s.duration_ms / 1000) % 60);
    return (
      <div
        key={s.uri}
        data-single-song-row="true"
        style={{
          minHeight: 54,
          padding: '6px 10px',
          borderRadius: 12,
          background: track?.uri === s.uri ? '#0d1b22' : '#0a0a0e',
          border: track?.uri === s.uri ? '1px solid #2aa3c4' : '1px solid #181822',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          data-single-song-play="true"
          onClick={() => {
            setPlayingContextId(`${ctxPrefix}:${s.uri}`);
            const idx = Math.max(0, peerList.findIndex((tr) => tr.uri === s.uri));
            defaultSimpClient.loadQueue(
              peerList.map((tr) => tr.uri),
              idx,
              peerList
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
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: 0,
          }}
        >
          {s.art_url ? (
            <img
              src={s.art_url}
              alt=""
              loading="lazy"
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                objectFit: 'cover',
                border: '1px solid #262632',
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: '#161622',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 15,
                flexShrink: 0,
              }}
            >
              {s.source === 'soundcloud' ? '☁️' : '🎵'}
            </div>
          )}
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
              {s.artists.join(', ')}
              {s.album ? ` • ${s.album}` : ''}
            </div>
          </div>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {s.duration_ms > 0 && (
            <span
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                padding: '2px 6px',
                borderRadius: 6,
                background: isLongMix ? '#2c140a' : '#12121a',
                border: isLongMix ? '1px solid #ea580c' : '1px solid #222230',
                color: isLongMix ? '#fdba74' : '#8e8e99',
              }}
            >
              {isLongMix ? `🎧 ${durMin}m` : `${durMin}:${String(durSec).padStart(2, '0')}`}
            </span>
          )}
          <button
            data-row-aux="true"
            data-track-select="true"
            onClick={() => handleAddTracksToPlaylist([s.uri], `"${s.title}"`, [s])}
            title="Add single to active SIMP Hybrid Playlist (SELECT)"
            style={{
              padding: '5px 9px',
              borderRadius: 8,
              background: '#0f222a',
              border: '1px solid #2aa3c4',
              color: '#67e8f9',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            +
          </button>
          {s.source === 'soundcloud' ? (
            <>
              <button
                data-row-aux="true"
                onClick={() => handleStartSoundCloudTrackRadio(s)}
                title="Start SoundCloud Track Radio from this track"
                style={{
                  padding: '5px 8px',
                  borderRadius: 8,
                  background: '#2c140a',
                  border: '1px solid #ea580c',
                  color: '#fdba74',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                📻
              </button>
              <button
                data-row-aux="true"
                onClick={() => likeSoundCloudTrack(s.uri, showToast)}
                title="Like this track on SoundCloud"
                style={{
                  padding: '5px 8px',
                  borderRadius: 8,
                  background: '#18141c',
                  border: '1px solid #2e2e3e',
                  color: '#fb923c',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                ❤️
              </button>
            </>
          ) : (
            <button
              data-row-aux="true"
              onClick={() =>
                selectCloudAlbum({
                  songUri: s.uri,
                  fallbackTitle: s.album || s.title,
                })
              }
              title="Open Full Parent Album"
              style={{
                padding: '5px 8px',
                borderRadius: 8,
                background: '#181824',
                border: '1px solid #2e2e3e',
                color: '#fda4af',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              💿
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <main
      style={{
        flex: 1,
        display: hidden ? 'none' : 'grid',
        gridTemplateColumns: 'minmax(250px, 32%) minmax(0, 68%)',
        overflow: 'hidden',
        boxSizing: 'border-box',
        width: '100%',
        minWidth: 0,
      }}
    >
      {/* =====================================================================
          LEFT COLUMN (32%): Search + 2x2 Right-Pane Hub Selector + Collapsible Quick-Jump Library
         ===================================================================== */}
      <div
        data-nav-col="left"
        style={{
          borderRight: '1px solid #16161c',
          padding: 14,
          overflowY: 'auto',
          overflowX: 'hidden',
          minWidth: 0,
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* Row 1 (Always Top): Unified Search Input */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            type="text"
            data-osk-input="search"
            placeholder={
              browserSourceFilter === 'local'
                ? '🔍 Filter local playlists, albums, or tracks...'
                : browserSourceFilter === 'soundcloud'
                ? '🔍 Search SoundCloud Tracks, Sets & DJ Mixes...'
                : '🔍 Search SIMP Library, Apple Music & SoundCloud...'
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
              border: browserSearch ? '1px solid #2aa3c4' : '1px solid #242430',
              color: '#d4d4dc',
              fontSize: 12,
              boxSizing: 'border-box',
            }}
          />
          {browserSearch && (
            <button
              data-row-aux="true"
              data-clear-search="true"
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

        {/* Row 2: Top-Level Source Filter Bar (`[ 🌐 All | 💾 Local | 🍎 Apple | ☁️ SC ]`)
            Only show Apple / SoundCloud pills when authenticated (or reauth_required for Apple). */}
        {(() => {
          const sourceTabs = [
            { id: 'all' as const, label: '🌐 All', accent: 'teal' as const },
            { id: 'local' as const, label: '💾 Local', accent: 'teal' as const },
            ...(snap?.apple_authenticated || appleAuthState === 'reauth_required'
              ? [
                  {
                    id: 'apple_music' as const,
                    label: appleAuthState === 'reauth_required' ? '🍎 Apple⚠️' : '🍎 Apple',
                    accent: 'apple' as const,
                  },
                ]
              : []),
            ...(snap?.soundcloud_authenticated
              ? [
                  {
                    id: 'soundcloud' as const,
                    label: '☁️ SC',
                    accent: 'soundcloud' as const,
                  },
                ]
              : []),
          ];
          return (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${sourceTabs.length}, minmax(0, 1fr))`,
                gap: 5,
              }}
            >
              {sourceTabs.map((tab) => {
                const active = browserSourceFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      if (browserSourceFilter !== tab.id) {
                        pushCurrentNavState();
                      }
                      setBrowserSourceFilter(tab.id);
                      if (tab.id === 'local') {
                        setAppleSubTab('pinned');
                        setSoundCloudSubTab('pinned');
                        setRightPaneMode('browse');
                      } else if (tab.id === 'soundcloud') {
                        setActiveMountRoot(null);
                        if (soundCloudSubTab === 'pinned') {
                          setSoundCloudSubTab('trending');
                        }
                        setRightPaneMode('browse');
                      } else if (tab.id === 'apple_music') {
                        setActiveMountRoot(null);
                        if (appleSubTab === 'pinned') {
                          setAppleSubTab('cloud_playlists');
                        }
                        setRightPaneMode('browse');
                      }
                    }}
                    style={{
                      minHeight: 34,
                      padding: '0 4px',
                      borderRadius: 8,
                      background: active
                        ? tab.accent === 'apple'
                          ? '#28111b'
                          : tab.accent === 'soundcloud'
                          ? '#2c140a'
                          : '#0f222a'
                        : '#0a0a0e',
                      border: active
                        ? tab.accent === 'apple'
                          ? '1px solid #fa243c'
                          : tab.accent === 'soundcloud'
                          ? '1px solid #ea580c'
                          : '1px solid #2aa3c4'
                        : '1px solid #1e1e26',
                      color: active
                        ? tab.accent === 'apple'
                          ? '#fecdd3'
                          : tab.accent === 'soundcloud'
                          ? '#fdba74'
                          : '#bfeaf5'
                        : '#9ca3af',
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
          );
        })()}

        {/* =================================================================
            COLLAPSIBLE BUCKET 0: ▾ PLACES (Unified PS3 XMB Vertical Stack)
           ================================================================= */}
        <button
          onClick={togglePlacesOpen}
          style={{
            marginTop: 2,
            background: '#0d0d14',
            border: '1px solid #1e1e28',
            borderRadius: 8,
            padding: '6px 10px',
            color: '#c8c8d4',
            fontSize: 11,
            fontFamily: 'monospace',
            fontWeight: 800,
            textAlign: 'left',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{placesOpen ? '▾' : '▸'} PLACES</span>
        </button>

        {placesOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {browserSourceFilter === 'soundcloud' ? (
              (
                [
                  {
                    id: 'pinned' as const,
                    label: `📌 SIMP Library (${filteredPlaylists.length})`,
                    isSimp: true,
                  },
                  {
                    id: 'likes_sets' as const,
                    label: `❤️ Likes & Sets${
                      scLikedTracks.length + scPlaylists.length
                        ? ` (${scLikedTracks.length + scPlaylists.length})`
                        : ''
                    }`,
                    isSimp: false,
                  },
                  {
                    id: 'stream_radio' as const,
                    label: '⚡ Stream & Radio',
                    isSimp: false,
                  },
                  {
                    id: 'trending' as const,
                    label: '🔥 Trending & Mixes',
                    isSimp: false,
                  },
                ] as const
              ).map((hub) => {
                const active =
                  !activeMountRoot && soundCloudSubTab === hub.id && rightPaneMode === 'browse';
                return (
                  <button
                    key={hub.id}
                    data-default-focus={hub.id === 'pinned' ? 'true' : undefined}
                    data-left-active={active ? 'true' : undefined}
                    data-xmb-preview="true"
                    onClick={() => {
                      const isPreview = xmbPreviewTriggerRef.current;
                      if (
                        !isPreview &&
                        (activeMountRoot !== null ||
                          soundCloudSubTab !== hub.id ||
                          rightPaneMode !== 'browse')
                      ) {
                        pushCurrentNavState();
                      }
                      setActiveMountRoot(null);
                      setSoundCloudSubTab(hub.id);
                      setRightPaneMode('browse');
                      if (!isPreview) {
                        focusRightPaneFirstTile();
                      }
                    }}
                    style={{
                      minHeight: 34,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: active
                        ? hub.isSimp
                          ? '#0f222a'
                          : '#2c140a'
                        : '#0a0a0e',
                      border: active
                        ? hub.isSimp
                          ? '1px solid #2aa3c4'
                          : '1px solid #ea580c'
                        : '1px solid #181820',
                      color: active
                        ? hub.isSimp
                          ? '#bfeaf5'
                          : '#fdba74'
                        : '#c8c8d2',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>{hub.label}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: 'monospace',
                        color: active ? (hub.isSimp ? '#2aa3c4' : '#fdba74') : '#71717a',
                      }}
                    >
                      ⊞
                    </span>
                  </button>
                );
              })
            ) : (
              (browserSourceFilter === 'apple_music'
                ? [
                    {
                      id: 'pinned' as const,
                      label: `📌 SIMP Library (${filteredPlaylists.length + albums.length})`,
                      isSimp: true,
                    },
                    {
                      id: 'cloud_playlists' as const,
                      label: `☁️ Apple Playlists${
                        cloudPlaylists.length ? ` (${cloudPlaylists.length})` : ''
                      }`,
                      isSimp: false,
                    },
                    { id: 'radio' as const, label: '📻 Radio & For You', isSimp: false },
                    { id: 'new' as const, label: '✨ New & Charts', isSimp: false },
                  ]
                : [
                    {
                      id: 'pinned' as const,
                      label:
                        browserSourceFilter === 'local'
                          ? `📌 Local SIMP Library (${filteredPlaylists.length + albums.length})`
                          : `📌 My SIMP Library (${filteredPlaylists.length + albums.length})`,
                      isSimp: true,
                    },
                  ]
              ).map((hub) => {
                const active =
                  !activeMountRoot && appleSubTab === hub.id && rightPaneMode === 'browse';
                return (
                  <button
                    key={hub.id}
                    data-default-focus={hub.id === 'pinned' ? 'true' : undefined}
                    data-left-active={active ? 'true' : undefined}
                    data-xmb-preview="true"
                    onClick={() => {
                      const isPreview = xmbPreviewTriggerRef.current;
                      if (
                        !isPreview &&
                        (activeMountRoot !== null ||
                          appleSubTab !== hub.id ||
                          rightPaneMode !== 'browse')
                      ) {
                        pushCurrentNavState();
                      }
                      setActiveMountRoot(null);
                      setAppleSubTab(hub.id);
                      setRightPaneMode('browse');
                      if (!isPreview) {
                        focusRightPaneFirstTile();
                      }
                    }}
                    style={{
                      minHeight: 34,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: active
                        ? hub.isSimp
                          ? '#0f222a'
                          : '#28111b'
                        : '#0a0a0e',
                      border: active
                        ? hub.isSimp
                          ? '1px solid #2aa3c4'
                          : '1px solid #fa243c'
                        : '1px solid #181820',
                      color: active
                        ? hub.isSimp
                          ? '#bfeaf5'
                          : '#fecdd3'
                        : '#c8c8d2',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>{hub.label}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: 'monospace',
                        color: active ? (hub.isSimp ? '#2aa3c4' : '#fda4af') : '#71717a',
                      }}
                    >
                      ⊞
                    </span>
                  </button>
                );
              })
            )}

            {/* Unified Service Drill-Right Places in `🌐 All` mode (only when authenticated) */}
            {browserSourceFilter === 'all' && snap?.apple_authenticated && (
              <button
                data-xmb-drill-right="true"
                onClick={() => {
                  pushCurrentNavState();
                  setActiveMountRoot(null);
                  setBrowserSourceFilter('apple_music');
                  setAppleSubTab('cloud_playlists');
                  setRightPaneMode('browse');
                  focusRightPaneFirstTile();
                }}
                style={{
                  minHeight: 34,
                  padding: '0 10px',
                  borderRadius: 8,
                  background: '#0a0a0e',
                  border: '1px solid #181820',
                  color: '#fecdd3',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>🍎 Apple Music</span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>▸</span>
              </button>
            )}

            {browserSourceFilter === 'all' && snap?.soundcloud_authenticated && (
              <button
                data-xmb-drill-right="true"
                onClick={() => {
                  pushCurrentNavState();
                  setActiveMountRoot(null);
                  setBrowserSourceFilter('soundcloud');
                  setSoundCloudSubTab('trending');
                  setRightPaneMode('browse');
                  focusRightPaneFirstTile();
                }}
                style={{
                  minHeight: 34,
                  padding: '0 10px',
                  borderRadius: 8,
                  background: '#0a0a0e',
                  border: '1px solid #181820',
                  color: '#fdba74',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>☁️ SoundCloud</span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>▸</span>
              </button>
            )}

            {/* Local Places (shown in `🌐 All` and `💾 Local` modes) */}
            {(browserSourceFilter === 'all' || browserSourceFilter === 'local') &&
              snap?.mounts.map((m) => {
                const isMountActive =
                  activeMountRoot === m.mount_root && rightPaneMode === 'browse';
                return (
                  <button
                    key={m.mount_root}
                    data-left-active={isMountActive ? 'true' : undefined}
                    data-xmb-preview="true"
                    onClick={() => {
                      const isPreview = xmbPreviewTriggerRef.current;
                      if (
                        !isPreview &&
                        (activeMountRoot !== m.mount_root || rightPaneMode !== 'browse')
                      ) {
                        pushCurrentNavState();
                      }
                      setActiveMountRoot(m.mount_root);
                      setRightPaneMode('browse');
                      if (!isPreview) {
                        focusRightPaneFirstTile();
                      }
                    }}
                    title={m.mount_root}
                    style={{
                      minHeight: 34,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: isMountActive ? '#0f222a' : '#0a0a0e',
                      border: isMountActive ? '1px solid #2aa3c4' : '1px solid #181820',
                      color: isMountActive ? '#bfeaf5' : '#c8c8d2',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      opacity: m.is_online ? 1 : 0.65,
                    }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      {m.is_online ? '🟢' : '⚫'} 💾 Local: {m.label} ({m.track_count})
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: 'monospace',
                        color: isMountActive ? '#2aa3c4' : '#71717a',
                        flexShrink: 0,
                      }}
                    >
                      ⊞
                    </span>
                  </button>
                );
              })}

            {/* Loaded Audio CD or DVD-Video (`cdda://` or `dvd://`) — only shown in `🌐 All` and `💾 Local` */}
            {(browserSourceFilter === 'all' || browserSourceFilter === 'local') && (
              <div
                style={{
                  padding: '6px 10px',
                  borderRadius: 9,
                  background:
                    rightPaneMode === 'tracks' && browserTarget?.kind === 'cdda'
                      ? '#1f160d'
                      : opticalDisc?.is_audio_cd || opticalDisc?.is_dvd_video
                      ? '#12100e'
                      : '#0a0a0e',
                  border:
                    rightPaneMode === 'tracks' && browserTarget?.kind === 'cdda'
                      ? '1px solid #f59e0b'
                      : opticalDisc?.is_audio_cd || opticalDisc?.is_dvd_video
                      ? '1px solid #78350f'
                      : '1px solid #181820',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <button
                  data-left-active={
                    rightPaneMode === 'tracks' && browserTarget?.kind === 'cdda'
                      ? 'true'
                      : undefined
                  }
                  data-xmb-preview={
                    opticalDisc?.is_audio_cd || opticalDisc?.is_dvd_video ? 'true' : undefined
                  }
                  onClick={() => {
                    if (opticalDisc?.is_audio_cd) {
                      selectLocalCollection({
                        kind: 'cdda',
                        id: opticalDisc.disc_id || opticalDisc.device_path || '/dev/sr0',
                        title: `💿 ${opticalDisc.album_title || 'Audio CD'}`,
                        subtitle: `${opticalDisc.artist_name || 'Unknown Artist'}${
                          opticalDisc.release_year ? ` • ${opticalDisc.release_year}` : ''
                        }${
                          opticalDisc.disc_id
                            ? ` • DiscID ${opticalDisc.disc_id.slice(0, 8)}…`
                            : ''
                        }`,
                        art_url: opticalDisc.art_url,
                      });
                      setBrowserTracks(opticalDisc.tracks);
                    } else if (opticalDisc?.is_dvd_video) {
                      selectLocalCollection({
                        kind: 'cdda',
                        id: opticalDisc.disc_id || opticalDisc.device_path || '/dev/sr0',
                        title: `📀 ${opticalDisc.album_title || 'DVD Video'}`,
                        subtitle: `${opticalDisc.artist_name || 'DVD-Video'}${
                          opticalDisc.release_year ? ` • ${opticalDisc.release_year}` : ''
                        }`,
                        art_url: opticalDisc.art_url,
                      });
                      setBrowserTracks([]);
                    } else if (!xmbPreviewTriggerRef.current) {
                      handleScanOpticalDisc(false, false);
                    }
                  }}
                  style={{
                    minWidth: 0,
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    color:
                      opticalDisc?.is_audio_cd || opticalDisc?.is_dvd_video
                        ? '#fcd34d'
                        : '#c8c8d2',
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: 12,
                    fontWeight: 700,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cdScanning
                    ? '⏳ 💿 Scanning Disc...'
                    : opticalDisc?.is_audio_cd
                    ? `💿 ${opticalDisc.album_title || 'Audio CD'} (${opticalDisc.tracks.length})`
                    : opticalDisc?.is_dvd_video
                    ? `📀 ${opticalDisc.album_title || 'DVD Video'} (${
                        opticalDisc.dvd_titles?.length || 0
                      })`
                    : '💿 Optical Disc Drive'}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <button
                    data-row-aux="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleScanOpticalDisc(true, false);
                    }}
                    disabled={cdScanning}
                    style={{
                      padding: '3px 7px',
                      borderRadius: 6,
                      background: '#161622',
                      border: '1px solid #2e2e3e',
                      color: '#fcd34d',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {cdScanning ? '⏳' : '🔄'}
                  </button>
                  {opticalDisc?.drive_present && (
                    <button
                      data-row-aux="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEjectOpticalDisc();
                      }}
                      title="Eject Optical Disc"
                      style={{
                        padding: '3px 6px',
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
            )}
          </div>
        )}

        {/* Re-Auth Prompt Pill (only shown when user has pinned Apple content while signed out) */}
        {appleAuthState === 'reauth_required' && browserSourceFilter !== 'local' && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              background: '#1f1410',
              border: '1px solid #78350f',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 11, color: '#fcd34d', fontWeight: 700 }}>
              ⚠️ Apple Music session signed out
            </span>
            <button
              onClick={() => setSourceModalOpen(true)}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                background: '#2a131c',
                border: '1px solid #fa243c',
                color: '#fecdd3',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Reconnect
            </button>
          </div>
        )}

        {/* =================================================================
            COLLAPSIBLE BUCKET 1: ▾ SIMP PLAYLISTS (HYBRID & PINNED) + Embedded [+]
           ================================================================= */}
        <div
          style={{
            marginTop: 2,
            background: '#0d0d14',
            border: '1px solid #1e1e28',
            borderRadius: 8,
            padding: '3px 6px 3px 10px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <button
            data-xmb-drill-right="true"
            onClick={togglePlaylistsOpen}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              border: 'none',
              padding: '3px 0',
              color: '#c8c8d4',
              fontSize: 11,
              fontFamily: 'monospace',
              fontWeight: 800,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {playlistsOpen ? '▾' : '▸'} SIMP PLAYLISTS ({filteredPlaylists.length})
          </button>
          <button
            data-xmb-drill-action="true"
            onClick={(e) => {
              e.stopPropagation();
              if (!playlistsOpen) {
                togglePlaylistsOpen();
              }
              setCreatingPlaylist((v) => {
                const next = !v;
                if (next) {
                  window.setTimeout(() => {
                    const inputEl = document.querySelector<HTMLElement>(
                      '[data-osk-input="playlist"]'
                    );
                    if (inputEl) inputEl.focus();
                  }, 30);
                }
                return next;
              });
            }}
            title={creatingPlaylist ? 'Cancel New SIMP Playlist' : 'Create New SIMP Hybrid Playlist'}
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              background: creatingPlaylist ? '#221116' : '#0f222a',
              border: creatingPlaylist ? '1px solid #5c222d' : '1px solid #2aa3c4',
              color: creatingPlaylist ? '#fca5a5' : '#67e8f9',
              fontSize: 11,
              fontFamily: 'monospace',
              fontWeight: 800,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {creatingPlaylist ? '✕' : '+'}
          </button>
        </div>

        {playlistsOpen && creatingPlaylist && (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              data-osk-input="playlist"
              placeholder="New SIMP Playlist name..."
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
                minHeight: 36,
                padding: '0 10px',
                borderRadius: 8,
                background: '#08080c',
                border: '1px solid #2e2e3c',
                color: '#d4d4dc',
                fontSize: 12,
              }}
            />
            <button
              data-row-aux="true"
              onClick={handleCreatePlaylist}
              style={{
                minHeight: 36,
                padding: '0 12px',
                borderRadius: 8,
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

        {playlistsOpen &&
          filteredPlaylists.map((pl) => {
            const isSelected =
              rightPaneMode === 'tracks' &&
              browserTarget?.kind === 'playlist' &&
              browserTarget.id === pl.id;
            const isLocalPlaylist = pl.origin === 'simp_local';
            const isActiveTarget = isLocalPlaylist && activePlaylistId === pl.id;
            const cleanTitle = cleanCollectionTitle(pl.name);
            const inlineSourceIcons = isLocalPlaylist
              ? `${pl.has_local ? '💾' : ''}${pl.has_apple ? '🍎' : ''}${
                  pl.has_soundcloud ? '☁️' : ''
                }`
              : '';
            const inlineSources = inlineSourceIcons ? `${inlineSourceIcons} ` : '';
            return (
              <button
                key={pl.id}
                data-left-active={isSelected ? 'true' : undefined}
                data-left-hybrid-id={isLocalPlaylist ? pl.id : undefined}
                data-left-playlist-id={pl.id}
                data-left-playlist-name={cleanTitle}
                data-xmb-preview="true"
                onClick={() => {
                  if (isLocalPlaylist) {
                    setActivePlaylistId(pl.id);
                  }
                  selectLocalCollection({ kind: 'playlist', id: pl.id });
                }}
                style={{
                  minHeight: 36,
                  padding: '0 10px',
                  borderRadius: 9,
                  background: isSelected ? '#0d1b22' : '#0a0a0e',
                  border: isSelected ? '1px solid #2aa3c4' : '1px solid #181820',
                  color: '#d4d4dc',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  textAlign: 'left',
                  cursor: 'pointer',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  {isLocalPlaylist
                    ? `${isActiveTarget ? '★ ' : '🎵 '}${cleanTitle}`
                    : pl.origin === 'soundcloud_remote'
                    ? `☁️ ${cleanTitle}`
                    : `🍎 ${cleanTitle}`}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: '#2aa3c4',
                    flexShrink: 0,
                  }}
                >
                  {inlineSources}
                  {pl.track_count}
                </span>
              </button>
            );
          })}
      </div>

      {/* =====================================================================
          RIGHT COLUMN (68%): Context-Driven Main Canvas (4-Col Max Tile Grid OR Collection Tracklist)
         ===================================================================== */}
      <div
        data-nav-col="right"
        style={{
          padding: 16,
          overflowY: 'auto',
          overflowX: 'hidden',
          minWidth: 0,
          maxWidth: '100%',
          boxSizing: 'border-box',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {renderContextLegendBar()}
        {/* =================================================================
            STATE A: ⊞ 4-COLUMN-MAX VISUAL TILE GRID (My SIMP Library, Apple Playlists, Radio, New, Search)
           ================================================================= */}
        {rightPaneMode === 'browse' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, width: '100%' }}>
            {/* Not Signed In Setup Card (only shown when opening an Apple Cloud Hub while not authenticated) */}
            {!snap?.apple_authenticated &&
              appleSubTab !== 'pinned' &&
              browserSourceFilter !== 'local' &&
              browserSourceFilter !== 'soundcloud' && (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    background: '#160d12',
                    border: '1px solid #4c1d2e',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#fda4af' }}>
                      {appleAuthState === 'reauth_required'
                        ? '⚠️ Apple Music Session Expired / Signed Out'
                        : '🍎 Connect Apple Music'}
                    </div>
                    <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 2 }}>
                      {appleAuthState === 'reauth_required'
                        ? 'Sign back in or scan the QR code in Sources to access your Apple Playlists and pinned items.'
                        : 'Sign in or scan the QR code in Sources to browse Apple Playlists, Radio & For You, and New Releases.'}
                    </div>
                  </div>
                  <button
                    onClick={() => setSourceModalOpen(true)}
                    style={{
                      minHeight: 36,
                      padding: '0 14px',
                      borderRadius: 8,
                      background: '#2a131c',
                      border: '1px solid #fa243c',
                      color: '#fecdd3',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Open Apple Music Setup
                  </button>
                </div>
              )}

            {/* SoundCloud Setup Card (shown when opening SoundCloud hubs before connecting) */}
            {browserSourceFilter === 'soundcloud' &&
              !snap?.soundcloud_authenticated &&
              soundCloudSubTab !== 'pinned' && (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    background: '#1a110b',
                    border: '1px solid #7c2d12',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#fdba74' }}>
                      ☁️ Connect SoundCloud (OAuth 2.1 PKCE or Public Mode)
                    </div>
                    <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 2 }}>
                      Sign in with SoundCloud to access your Likes, Sets & Activity Stream, or enable Public Mode for Trending, DJ Mixes & Search.
                    </div>
                  </div>
                  <button
                    onClick={() => setSourceModalOpen(true)}
                    style={{
                      minHeight: 36,
                      padding: '0 14px',
                      borderRadius: 8,
                      background: '#2c140a',
                      border: '1px solid #ea580c',
                      color: '#fdba74',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Open SoundCloud Setup
                  </button>
                </div>
              )}

            {cloudLoading && (
              <div
                style={{
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: browserSourceFilter === 'soundcloud' ? '#fdba74' : '#fda4af',
                  padding: '4px 2px',
                }}
              >
                {browserSourceFilter === 'soundcloud'
                  ? '⏳ Loading from SoundCloud...'
                  : '⏳ Loading from Apple Music Cloud...'}
              </div>
            )}

            {/* -------------------------------------------------------------
                1. UNIFIED SEARCH VIEW (Pinned + Apple Playlists + Albums + Catalog)
               ------------------------------------------------------------- */}
            {browserSearch.trim() ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingBottom: 8,
                    borderBottom: '1px solid #16161c',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#bfeaf5' }}>
                    🔍 Search Results for "{browserSearch.trim()}"
                  </div>
                </div>

                {/* 1A. Matching SIMP Hybrid & Pinned Playlists */}
                {filteredPlaylists.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                      📌 MATCHING SIMP & PINNED PLAYLISTS ({filteredPlaylists.length})
                    </div>
                    <div style={tileGridStyle}>
                      {filteredPlaylists.map(renderSimpPlaylistCard)}
                    </div>
                  </>
                )}

                {/* 1B. Matching Unpinned Apple Library Playlists */}
                {browserSourceFilter !== 'local' && filteredCloudPlaylists.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                      ☁️ MATCHING APPLE LIBRARY PLAYLISTS ({filteredCloudPlaylists.length})
                    </div>
                    <div style={tileGridStyle}>
                      {filteredCloudPlaylists.slice(0, 50).map(renderCloudPlaylistCard)}
                    </div>
                  </>
                )}

                {/* 1C. Matching Local & Pinned Albums */}
                {albums.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                      💿 MATCHING SIMP LIBRARY ALBUMS ({albums.length})
                    </div>
                    <div style={tileGridStyle}>
                      {albums.slice(0, 24).map(renderSimpAlbumCard)}
                    </div>
                  </>
                )}

                {/* 1D. Personal Apple Cloud Library ("Your Library") & Public Catalog Search Results */}
                {browserSourceFilter !== 'local' && snap?.apple_authenticated && (
                  <>
                    {catalogSearchResults.albums.some((a) => a.kind === 'library') && (
                      <>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                          ☁️ IN YOUR APPLE CLOUD LIBRARY — ALBUMS (
                          {catalogSearchResults.albums.filter((a) => a.kind === 'library').length})
                        </div>
                        <div style={tileGridStyle}>
                          {catalogSearchResults.albums
                            .filter((a) => a.kind === 'library')
                            .map(renderCloudAlbumCard)}
                        </div>
                      </>
                    )}

                    {catalogSearchResults.albums.some((a) => a.kind !== 'library') && (
                      <>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                          🍎 APPLE CATALOG ALBUMS (
                          {catalogSearchResults.albums.filter((a) => a.kind !== 'library').length})
                        </div>
                        <div style={tileGridStyle}>
                          {catalogSearchResults.albums
                            .filter((a) => a.kind !== 'library')
                            .map(renderCloudAlbumCard)}
                        </div>
                      </>
                    )}

                    {catalogSearchResults.playlists.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                          🎶 APPLE CATALOG PLAYLISTS ({catalogSearchResults.playlists.length})
                        </div>
                        <div style={tileGridStyle}>
                          {catalogSearchResults.playlists.map(renderCloudPlaylistCard)}
                        </div>
                      </>
                    )}

                    {catalogSearchResults.stations.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                          📻 RADIO STATIONS ({catalogSearchResults.stations.length})
                        </div>
                        <div style={tileGridStyle}>
                          {catalogSearchResults.stations.map(renderStationCard)}
                        </div>
                      </>
                    )}

                    {catalogSearchResults.songs.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                          🎵 SONGS / SINGLES ({catalogSearchResults.songs.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {catalogSearchResults.songs.map((s) =>
                            renderSingleSongRow(s, catalogSearchResults.songs, 'search')
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* 1E. SoundCloud Catalog Search Results (Sets & Tracks) */}
                {browserSourceFilter !== 'local' &&
                  browserSourceFilter !== 'apple_music' &&
                  (scCatalogSearchResults.playlists.length > 0 ||
                    scCatalogSearchResults.songs.length > 0) && (
                    <>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          color: '#fdba74',
                          borderBottom: '1px solid #3c1c0f',
                          paddingBottom: 6,
                          marginTop: 8,
                        }}
                      >
                        ☁️ SoundCloud Sets & Tracks
                      </div>

                      {scCatalogSearchResults.playlists.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🎶 SOUNDCLOUD SETS & PLAYLISTS ({scCatalogSearchResults.playlists.length})
                          </div>
                          <div style={tileGridStyle}>
                            {scCatalogSearchResults.playlists.map(renderSoundCloudPlaylistCard)}
                          </div>
                        </>
                      )}

                      {scCatalogSearchResults.songs.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            ☁️ SOUNDCLOUD TRACKS & MIXES ({scCatalogSearchResults.songs.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scCatalogSearchResults.songs.map((s) =>
                              renderSingleSongRow(s, scCatalogSearchResults.songs, 'sc_search')
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}

                {filteredPlaylists.length === 0 &&
                  filteredCloudPlaylists.length === 0 &&
                  albums.length === 0 &&
                  catalogSearchResults.albums.length === 0 &&
                  catalogSearchResults.playlists.length === 0 &&
                  catalogSearchResults.stations.length === 0 &&
                  catalogSearchResults.songs.length === 0 &&
                  scCatalogSearchResults.playlists.length === 0 &&
                  scCatalogSearchResults.songs.length === 0 &&
                  !cloudLoading && (
                    <div style={{ fontSize: 12, color: '#8e8e99', padding: '12px 4px' }}>
                      No playlists, albums, or catalog matches found for "{browserSearch.trim()}".
                    </div>
                  )}
              </>
            ) : activeMountPlaceObj ? (
              /* ---------------------------------------------------------
                 2A. 💾 STORAGE MOUNT PLACE (4-Col Album & Soundtrack Tile Grid)
                 --------------------------------------------------------- */
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingBottom: 10,
                    borderBottom: '1px solid #16161c',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#bfeaf5' }}>
                      {activeMountPlaceObj.is_online ? '🟢' : '⚫'} 💾 {activeMountPlaceObj.label}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontFamily: 'monospace',
                        color: '#8e8e99',
                        marginTop: 2,
                      }}
                    >
                      {activeMountPlaceObj.mount_root} • {mountAlbums.length} albums •{' '}
                      {activeMountPlaceObj.track_count} tracks
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {mountTracks.length > 0 && (
                      <>
                        <button
                          data-right-tile="true"
                          onClick={() => {
                            setPlayingContextId(`mount:${activeMountPlaceObj.mount_root}`);
                            defaultSimpClient.loadQueue(
                              mountTracks.map((t) => t.uri),
                              0,
                              mountTracks
                            );
                            setView('lock');
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
                          ▶ Play All ({mountTracks.length})
                        </button>
                        <button
                          onClick={() =>
                            handleAddTracksToPlaylist(
                              mountTracks.map((t) => t.uri),
                              `all ${mountTracks.length} tracks from ${activeMountPlaceObj.label}`,
                              mountTracks
                            )
                          }
                          style={{
                            minHeight: 36,
                            padding: '0 10px',
                            borderRadius: 8,
                            background: '#14141e',
                            border: '1px solid #2a2a38',
                            color: '#67e8f9',
                            fontSize: 11,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          + All to ★
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {mountAlbums.length > 0 ? (
                  <>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                      💿 ALBUMS & SOUNDTRACKS ON {activeMountPlaceObj.label.toUpperCase()} (
                      {mountAlbums.length})
                    </div>
                    <div style={tileGridStyle}>{mountAlbums.map(renderSimpAlbumCard)}</div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: '#8e8e99', padding: '12px 4px' }}>
                    No albums indexed on {activeMountPlaceObj.label} yet.
                  </div>
                )}
              </>
            ) : (
              <>
                {/* ---------------------------------------------------------
                    2B. 📌 MY SIMP LIBRARY HUB (4-Column Visual Card Grid & Playlist Manager)
                   --------------------------------------------------------- */}
                {((browserSourceFilter !== 'soundcloud' && appleSubTab === 'pinned') ||
                  (browserSourceFilter === 'soundcloud' && soundCloudSubTab === 'pinned')) && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingBottom: 10,
                        borderBottom: '1px solid #16161c',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 15,
                            fontWeight: 800,
                            color: '#bfeaf5',
                            marginRight: 6,
                          }}
                        >
                          📌 {activeHubLabel}
                        </span>
                        {(
                          [
                            { id: 'all', label: 'All' },
                            {
                              id: 'hybrid',
                              label: `★ SIMP Playlists (${hybridPlaylistsList.length})`,
                            },
                            ...(browserSourceFilter !== 'local'
                              ? [
                                  {
                                    id: 'pinned' as const,
                                    label: `📌 Pinned Playlists (${pinnedPlaylistsList.length})`,
                                  },
                                ]
                              : []),
                            { id: 'albums', label: `💿 Albums (${albums.length})` },
                          ] as const
                        ).map((f) => {
                          const active = simpHubFilter === f.id;
                          return (
                            <button
                              key={f.id}
                              data-right-filter-pill="true"
                              onClick={() => setSimpHubFilter(f.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 6,
                                background: active ? '#0f222a' : '#101018',
                                border: active ? '1px solid #2aa3c4' : '1px solid #222230',
                                color: active ? '#bfeaf5' : '#9ca3af',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {f.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {creatingPlaylist && (
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
                          placeholder="Name your new SIMP Hybrid Playlist (Local + Apple + SoundCloud)..."
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
                          onClick={handleCreatePlaylist}
                          style={{
                            minHeight: 38,
                            padding: '0 16px',
                            borderRadius: 8,
                            background: '#0f222a',
                            color: '#bfeaf5',
                            border: '1px solid #2aa3c4',
                            fontWeight: 800,
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          Create Playlist
                        </button>
                      </div>
                    )}

                    {/* SIMP Hybrid Playlists Section */}
                    {(simpHubFilter === 'all' || simpHubFilter === 'hybrid') &&
                      hybridPlaylistsList.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                            ★ SIMP HYBRID PLAYLISTS ({hybridPlaylistsList.length})
                          </div>
                          <div style={tileGridStyle}>
                            {hybridPlaylistsList.map(renderSimpPlaylistCard)}
                          </div>
                        </>
                      )}

                    {/* Pinned Cloud Playlists Section */}
                    {(simpHubFilter === 'all' || simpHubFilter === 'pinned') &&
                      pinnedPlaylistsList.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                            📌 PINNED CLOUD PLAYLISTS ({pinnedPlaylistsList.length})
                          </div>
                          <div style={tileGridStyle}>
                            {pinnedPlaylistsList.map(renderSimpPlaylistCard)}
                          </div>
                        </>
                      )}

                    {/* Local & Pinned Full Albums Section */}
                    {(simpHubFilter === 'all' || simpHubFilter === 'albums') &&
                      albums.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                            💿 ALBUMS & SOUNDTRACKS ({albums.length})
                          </div>
                          <div style={tileGridStyle}>
                            {albums.map(renderSimpAlbumCard)}
                          </div>
                        </>
                      )}
                  </>
                )}

                {/* ---------------------------------------------------------
                    3. ☁️ APPLE LIBRARY PLAYLISTS HUB (Paginated 50/page + A-Z Jump Pills)
                   --------------------------------------------------------- */}
                {browserSourceFilter !== 'soundcloud' &&
                  appleSubTab === 'cloud_playlists' &&
                  snap?.apple_authenticated && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingBottom: 10,
                        borderBottom: '1px solid #16161c',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      {/* A-Z Alphabetical Quick Filter Pills */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 800,
                            color: '#fecdd3',
                            marginRight: 6,
                          }}
                        >
                          ☁️ Apple Playlists
                        </span>
                        {(
                          [
                            { id: 'all', label: `All (${cloudPlaylists.length})` },
                            { id: 'a_f', label: 'A–F' },
                            { id: 'g_l', label: 'G–L' },
                            { id: 'm_r', label: 'M–R' },
                            { id: 's_z', label: 'S–Z' },
                            { id: 'num', label: '#' },
                          ] as const
                        ).map((b) => {
                          const active = cloudAlpha === b.id;
                          return (
                            <button
                              key={b.id}
                              data-right-filter-pill="true"
                              onClick={() => {
                                setCloudAlpha(b.id);
                                setCloudPage(0);
                              }}
                              style={{
                                padding: '4px 9px',
                                borderRadius: 6,
                                background: active ? '#28111b' : '#101018',
                                border: active ? '1px solid #fa243c' : '1px solid #222230',
                                color: active ? '#fecdd3' : '#9ca3af',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {b.label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Pagination Controls (50 per page) + Reload */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {totalCloudPages > 1 && (
                          <>
                            <button
                              data-right-filter-pill="true"
                              onClick={() => setCloudPage((p) => Math.max(0, p - 1))}
                              disabled={safeCloudPage === 0}
                              style={{
                                padding: '4px 9px',
                                borderRadius: 6,
                                background: '#14141e',
                                border: '1px solid #2a2a38',
                                color: safeCloudPage === 0 ? '#52525b' : '#d4d4dc',
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: safeCloudPage === 0 ? 'default' : 'pointer',
                              }}
                            >
                              ◀ Prev
                            </button>
                            <span
                              style={{
                                fontSize: 11,
                                fontFamily: 'monospace',
                                color: '#fda4af',
                              }}
                            >
                              {safeCloudPage * CLOUD_PAGE_SIZE + 1}–
                              {Math.min(
                                (safeCloudPage + 1) * CLOUD_PAGE_SIZE,
                                filteredCloudPlaylists.length
                              )}{' '}
                              of {filteredCloudPlaylists.length}
                            </span>
                            <button
                              data-right-filter-pill="true"
                              onClick={() =>
                                setCloudPage((p) => Math.min(totalCloudPages - 1, p + 1))
                              }
                              disabled={safeCloudPage >= totalCloudPages - 1}
                              style={{
                                padding: '4px 9px',
                                borderRadius: 6,
                                background: '#14141e',
                                border: '1px solid #2a2a38',
                                color:
                                  safeCloudPage >= totalCloudPages - 1 ? '#52525b' : '#d4d4dc',
                                fontSize: 11,
                                fontWeight: 700,
                                cursor:
                                  safeCloudPage >= totalCloudPages - 1 ? 'default' : 'pointer',
                              }}
                            >
                              Next ▶
                            </button>
                          </>
                        )}
                        <button
                          data-right-filter-pill="true"
                          onClick={() => {
                            setCloudLoading(true);
                            fetchAppleCloudPlaylists()
                              .then((pls) => {
                                setCloudPlaylists(pls);
                                setCloudPage(0);
                              })
                              .catch(() => {})
                              .finally(() => setCloudLoading(false));
                          }}
                          style={{
                            padding: '4px 9px',
                            borderRadius: 6,
                            background: '#161620',
                            border: '1px solid #2a2a38',
                            color: '#fda4af',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ↻ Reload
                        </button>
                      </div>
                    </div>

                    <div style={tileGridStyle}>
                      {pagedCloudPlaylists.map(renderCloudPlaylistCard)}
                    </div>
                  </>
                )}

                {/* ---------------------------------------------------------
                    4. 📻 RADIO & FOR YOU HUB (Sub-filter Pills + 4-Col-Max Artwork Tiles)
                   --------------------------------------------------------- */}
                {browserSourceFilter !== 'soundcloud' &&
                  appleSubTab === 'radio' &&
                  snap?.apple_authenticated && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingBottom: 10,
                        borderBottom: '1px solid #16161c',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 800,
                            color: '#fecdd3',
                            marginRight: 6,
                          }}
                        >
                          📻 Radio & For You
                        </span>
                        {(
                          [
                            { id: 'all', label: 'All' },
                            { id: 'stations', label: `📻 Stations (${radioStations.length})` },
                            { id: 'mixes', label: `✨ For You Mixes (${forYouPlaylists.length})` },
                            { id: 'albums', label: `💿 Albums (${forYouAlbums.length})` },
                            ...(recentlyAddedCloudAlbums.length > 0
                              ? [
                                  {
                                    id: 'recent_library' as const,
                                    label: `🕒 Recently Added (${recentlyAddedCloudAlbums.length})`,
                                  },
                                ]
                              : []),
                          ] as const
                        ).map((f) => {
                          const active = radioFilter === f.id;
                          return (
                            <button
                              key={f.id}
                              data-right-filter-pill="true"
                              onClick={() => setRadioFilter(f.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 6,
                                background: active ? '#28111b' : '#101018',
                                border: active ? '1px solid #fa243c' : '1px solid #222230',
                                color: active ? '#fecdd3' : '#9ca3af',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {f.label}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        data-right-filter-pill="true"
                        onClick={() => {
                          setCloudLoading(true);
                          Promise.all([
                            fetchAppleRadioAndForYou()
                              .then((res) => {
                                setRadioStations(res.stations);
                                setForYouPlaylists(res.playlists);
                                setForYouAlbums(res.albums);
                              })
                              .catch(() => {}),
                            fetchAppleLibraryRecentlyAdded()
                              .then((albs) => {
                                if (Array.isArray(albs)) setRecentlyAddedCloudAlbums(albs);
                              })
                              .catch(() => {}),
                          ]).finally(() => setCloudLoading(false));
                        }}
                        style={{
                          padding: '4px 9px',
                          borderRadius: 6,
                          background: '#161620',
                          border: '1px solid #2a2a38',
                          color: '#fda4af',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        ↻ Refresh
                      </button>
                    </div>

                    {(radioFilter === 'all' || radioFilter === 'stations') &&
                      radioStations.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                            📻 LIVE & PERSONAL RADIO STATIONS ({radioStations.length})
                          </div>
                          <div style={tileGridStyle}>
                            {radioStations.map(renderStationCard)}
                          </div>
                        </>
                      )}

                    {(radioFilter === 'all' || radioFilter === 'recent_library') &&
                      recentlyAddedCloudAlbums.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                            🕒 RECENTLY ADDED TO YOUR APPLE CLOUD LIBRARY (
                            {recentlyAddedCloudAlbums.length})
                          </div>
                          <div style={tileGridStyle}>
                            {recentlyAddedCloudAlbums.map(renderCloudAlbumCard)}
                          </div>
                        </>
                      )}

                    {(radioFilter === 'all' || radioFilter === 'mixes') &&
                      forYouPlaylists.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                            ✨ MADE FOR YOU & HEAVY ROTATION ({forYouPlaylists.length})
                          </div>
                          <div style={tileGridStyle}>
                            {forYouPlaylists.map(renderCloudPlaylistCard)}
                          </div>
                        </>
                      )}

                    {(radioFilter === 'all' || radioFilter === 'albums') &&
                      forYouAlbums.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                            💿 RECOMMENDED FULL ALBUMS ({forYouAlbums.length})
                          </div>
                          <div style={tileGridStyle}>
                            {forYouAlbums.map(renderCloudAlbumCard)}
                          </div>
                        </>
                      )}
                  </>
                )}

                {/* ---------------------------------------------------------
                    5. ✨ NEW RELEASES & TOP CHARTS HUB (4-Col-Max Tiles + Direct Singles)
                   --------------------------------------------------------- */}
                {browserSourceFilter !== 'soundcloud' &&
                  appleSubTab === 'new' &&
                  snap?.apple_authenticated && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingBottom: 10,
                        borderBottom: '1px solid #16161c',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 800,
                            color: '#fecdd3',
                            marginRight: 6,
                          }}
                        >
                          ✨ New & Charts
                        </span>
                        {(
                          [
                            { id: 'all', label: 'All' },
                            { id: 'albums', label: `💿 New Albums (${newFeedAlbums.length})` },
                            {
                              id: 'playlists',
                              label: `🎶 Featured Playlists (${newFeedPlaylists.length})`,
                            },
                            { id: 'songs', label: `🎵 Top Singles (${newFeedSongs.length})` },
                          ] as const
                        ).map((f) => {
                          const active = newFilter === f.id;
                          return (
                            <button
                              key={f.id}
                              data-right-filter-pill="true"
                              onClick={() => setNewFilter(f.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 6,
                                background: active ? '#28111b' : '#101018',
                                border: active ? '1px solid #fa243c' : '1px solid #222230',
                                color: active ? '#fecdd3' : '#9ca3af',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {f.label}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          data-right-filter-pill="true"
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
                            padding: '4px 9px',
                            borderRadius: 6,
                            background: '#161620',
                            border: '1px solid #2a2a38',
                            color: '#fda4af',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ↻ Refresh
                        </button>
                      </div>
                    </div>

                    {(newFilter === 'all' || newFilter === 'albums') &&
                      newFeedAlbums.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                            💿 NEW & TOP ALBUMS ({newFeedAlbums.length})
                          </div>
                          <div style={tileGridStyle}>
                            {newFeedAlbums.map(renderCloudAlbumCard)}
                          </div>
                        </>
                      )}

                    {(newFilter === 'all' || newFilter === 'playlists') &&
                      newFeedPlaylists.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                            🎶 NEW & FEATURED PLAYLISTS ({newFeedPlaylists.length})
                          </div>
                          <div style={tileGridStyle}>
                            {newFeedPlaylists.map(renderCloudPlaylistCard)}
                          </div>
                        </>
                      )}

                    {(newFilter === 'all' || newFilter === 'songs') && newFeedSongs.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                          🎵 TOP NEW SONGS / SINGLES ({newFeedSongs.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {newFeedSongs.map((s) => renderSingleSongRow(s, newFeedSongs, 'new'))}
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* ---------------------------------------------------------
                    6. ☁️ SOUNDCLOUD LIKES & SETS HUB (Personal Account OAuth)
                   --------------------------------------------------------- */}
                {browserSourceFilter === 'soundcloud' && soundCloudSubTab === 'likes_sets' && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingBottom: 10,
                        borderBottom: '1px solid #16161c',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 800,
                            color: '#fed7aa',
                            marginRight: 6,
                          }}
                        >
                          ❤️ Likes & Sets
                        </span>
                        {(
                          [
                            { id: 'all', label: 'All' },
                            { id: 'likes', label: `❤️ Liked Tracks (${scLikedTracks.length})` },
                            { id: 'sets', label: `🎶 Sets & Playlists (${scPlaylists.length})` },
                          ] as const
                        ).map((f) => {
                          const active = scLikesFilter === f.id;
                          return (
                            <button
                              key={f.id}
                              data-right-filter-pill="true"
                              onClick={() => setScLikesFilter(f.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 6,
                                background: active ? '#2c140a' : '#101018',
                                border: active ? '1px solid #ff5500' : '1px solid #222230',
                                color: active ? '#fed7aa' : '#9ca3af',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {f.label}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {scLikedTracks.length > 0 && (
                          <button
                            data-right-filter-pill="true"
                            onClick={() => {
                              setPlayingContextId('sc:likes');
                              defaultSimpClient.loadQueue(
                                scLikedTracks.map((t) => t.uri),
                                0,
                                scLikedTracks
                              );
                              setView('lock');
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              background: '#2c140a',
                              border: '1px solid #ff5500',
                              color: '#fed7aa',
                              fontSize: 11,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            ▶ Play All Likes
                          </button>
                        )}
                        <button
                          data-right-filter-pill="true"
                          onClick={() => {
                            setCloudLoading(true);
                            fetchSoundCloudLikesAndPlaylists()
                              .then((res) => {
                                setScLikedTracks(res.likedTracks);
                                setScPlaylists(res.playlists);
                              })
                              .catch(() => {})
                              .finally(() => setCloudLoading(false));
                          }}
                          style={{
                            padding: '4px 9px',
                            borderRadius: 6,
                            background: '#161620',
                            border: '1px solid #2a2a38',
                            color: '#fdba74',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ↻ Refresh
                        </button>
                      </div>
                    </div>

                    {(scLikesFilter === 'all' || scLikesFilter === 'sets') &&
                      scPlaylists.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🎶 YOUR SOUNDCLOUD SETS & PLAYLISTS ({scPlaylists.length})
                          </div>
                          <div style={tileGridStyle}>
                            {scPlaylists.map(renderSoundCloudPlaylistCard)}
                          </div>
                        </>
                      )}

                    {(scLikesFilter === 'all' || scLikesFilter === 'likes') &&
                      scLikedTracks.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            ❤️ LIKED TRACKS ({scLikedTracks.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scLikedTracks.map((s) =>
                              renderSingleSongRow(s, scLikedTracks, 'sc_likes')
                            )}
                          </div>
                        </>
                      )}

                    {scPlaylists.length === 0 && scLikedTracks.length === 0 && !cloudLoading && (
                      <div style={{ fontSize: 12, color: '#8e8e99', padding: '12px 4px' }}>
                        {snap?.soundcloud_authenticated
                          ? 'No SoundCloud likes or sets found yet.'
                          : 'Sign in with your personal SoundCloud account (OAuth 2.1 + PKCE) to browse your Likes & Sets, or switch to 🔥 Trending & Mixes.'}
                      </div>
                    )}
                  </>
                )}

                {/* ---------------------------------------------------------
                    7. ⚡ SOUNDCLOUD STREAM & RADIO HUB (Chronological Feed + Track Radio)
                   --------------------------------------------------------- */}
                {browserSourceFilter === 'soundcloud' && soundCloudSubTab === 'stream_radio' && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingBottom: 10,
                        borderBottom: '1px solid #16161c',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 800,
                            color: '#fed7aa',
                            marginRight: 6,
                          }}
                        >
                          ⚡ Stream & Radio
                        </span>
                        {(
                          [
                            { id: 'all', label: 'All' },
                            { id: 'stream', label: `⚡ Activity Stream (${scStreamTracks.length})` },
                            { id: 'sets', label: `🎶 Reposted Sets (${scStreamPlaylists.length})` },
                          ] as const
                        ).map((f) => {
                          const active = scStreamFilter === f.id;
                          return (
                            <button
                              key={f.id}
                              data-right-filter-pill="true"
                              onClick={() => setScStreamFilter(f.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 6,
                                background: active ? '#2c140a' : '#101018',
                                border: active ? '1px solid #ff5500' : '1px solid #222230',
                                color: active ? '#fed7aa' : '#9ca3af',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {f.label}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {(scStreamTracks.length > 0 || scLikedTracks.length > 0) && (
                          <button
                            data-right-filter-pill="true"
                            onClick={() => {
                              const seed = scStreamTracks[0] || scLikedTracks[0];
                              if (seed) handleStartSoundCloudTrackRadio(seed);
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              background: '#2c140a',
                              border: '1px solid #ff5500',
                              color: '#fed7aa',
                              fontSize: 11,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            📻 Start Station
                          </button>
                        )}
                        <button
                          data-right-filter-pill="true"
                          onClick={() => {
                            setCloudLoading(true);
                            fetchSoundCloudStreamAndRadio()
                              .then((res) => {
                                setScStreamTracks(res.streamTracks);
                                setScStreamPlaylists(res.streamPlaylists);
                              })
                              .catch(() => {})
                              .finally(() => setCloudLoading(false));
                          }}
                          style={{
                            padding: '4px 9px',
                            borderRadius: 6,
                            background: '#161620',
                            border: '1px solid #2a2a38',
                            color: '#fdba74',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ↻ Refresh
                        </button>
                      </div>
                    </div>

                    {(scStreamFilter === 'all' || scStreamFilter === 'sets') &&
                      scStreamPlaylists.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🎶 SETS FROM ARTISTS YOU FOLLOW ({scStreamPlaylists.length})
                          </div>
                          <div style={tileGridStyle}>
                            {scStreamPlaylists.map(renderSoundCloudPlaylistCard)}
                          </div>
                        </>
                      )}

                    {(scStreamFilter === 'all' || scStreamFilter === 'stream') &&
                      scStreamTracks.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            ⚡ CHRONOLOGICAL ACTIVITY STREAM ({scStreamTracks.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scStreamTracks.map((s) =>
                              renderSingleSongRow(s, scStreamTracks, 'sc_stream')
                            )}
                          </div>
                        </>
                      )}

                    {scStreamPlaylists.length === 0 && scStreamTracks.length === 0 && !cloudLoading && (
                      <div style={{ fontSize: 12, color: '#8e8e99', padding: '12px 4px' }}>
                        {snap?.soundcloud_authenticated
                          ? 'Your chronological SoundCloud activity stream is empty.'
                          : 'Sign in with your personal SoundCloud account to view your chronological /me/activities/all/own feed.'}
                      </div>
                    )}
                  </>
                )}

                {/* ---------------------------------------------------------
                    8. 🔥 SOUNDCLOUD TRENDING & MIXES HUB (Genres + 20m+ DJ Mixes + Featured Sets)
                   --------------------------------------------------------- */}
                {browserSourceFilter === 'soundcloud' && soundCloudSubTab === 'trending' && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        paddingBottom: 10,
                        borderBottom: '1px solid #16161c',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 800,
                              color: '#fed7aa',
                              marginRight: 6,
                            }}
                          >
                            🔥 Trending & Mixes
                          </span>
                          {(
                            [
                              { id: 'all', label: 'All' },
                              { id: 'mixes', label: `🎧 20m+ DJ Mixes (${scTrendingMixes.length})` },
                              { id: 'sets', label: `🎶 Featured Sets (${scTrendingPlaylists.length})` },
                              { id: 'tracks', label: `🔥 Trending Tracks (${scTrendingTracks.length})` },
                            ] as const
                          ).map((f) => {
                            const active = scTrendingFilter === f.id;
                            return (
                              <button
                                key={f.id}
                                data-right-filter-pill="true"
                                onClick={() => setScTrendingFilter(f.id)}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 6,
                                  background: active ? '#2c140a' : '#101018',
                                  border: active ? '1px solid #ff5500' : '1px solid #222230',
                                  color: active ? '#fed7aa' : '#9ca3af',
                                  fontSize: 11,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                {f.label}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          data-right-filter-pill="true"
                          onClick={() => {
                            setCloudLoading(true);
                            fetchSoundCloudDiscover(scSelectedGenre || undefined)
                              .then((res) => {
                                setScTrendingTracks(res.tracks);
                                setScTrendingMixes(res.mixes);
                                setScTrendingPlaylists(res.playlists);
                              })
                              .catch(() => {})
                              .finally(() => setCloudLoading(false));
                          }}
                          style={{
                            padding: '4px 9px',
                            borderRadius: 6,
                            background: '#161620',
                            border: '1px solid #2a2a38',
                            color: '#fdba74',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ↻ Refresh
                        </button>
                      </div>

                      {/* Genre & Vibe Pills */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#9ca3af' }}>
                          VIBE:
                        </span>
                        {[
                          { id: '', label: '🌐 All Vibes' },
                          { id: 'Electronic', label: '⚡ Electronic' },
                          { id: 'House', label: '🪩 House' },
                          { id: 'Techno', label: '🎛️ Techno' },
                          { id: 'Drum & Bass', label: '🥁 Drum & Bass' },
                          { id: 'Hip-hop & Rap', label: '🎤 Hip-Hop' },
                          { id: 'Ambient', label: '🌌 Ambient' },
                          { id: 'Synthwave', label: '🌆 Synthwave' },
                          { id: 'Indie', label: '🎸 Indie' },
                        ].map((g) => {
                          const active = scSelectedGenre === g.id;
                          return (
                            <button
                              key={g.id || 'all'}
                              data-right-filter-pill="true"
                              onClick={() => {
                                setScSelectedGenre(g.id);
                                setCloudLoading(true);
                                fetchSoundCloudDiscover(g.id || undefined)
                                  .then((res) => {
                                    setScTrendingTracks(res.tracks);
                                    setScTrendingMixes(res.mixes);
                                    setScTrendingPlaylists(res.playlists);
                                  })
                                  .catch(() => {})
                                  .finally(() => setCloudLoading(false));
                              }}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 999,
                                background: active ? '#3c1c0f' : '#12121a',
                                border: active ? '1px solid #ff5500' : '1px solid #232332',
                                color: active ? '#fed7aa' : '#a1a1aa',
                                fontSize: 10,
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {g.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {(scTrendingFilter === 'all' || scTrendingFilter === 'sets') &&
                      scTrendingPlaylists.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🎶 FEATURED SOUNDCLOUD SETS ({scTrendingPlaylists.length})
                          </div>
                          <div style={tileGridStyle}>
                            {scTrendingPlaylists.map(renderSoundCloudPlaylistCard)}
                          </div>
                        </>
                      )}

                    {(scTrendingFilter === 'all' || scTrendingFilter === 'mixes') &&
                      scTrendingMixes.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🎧 LONG-FORM DJ MIXES & SETS (20m+) ({scTrendingMixes.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scTrendingMixes.map((s) =>
                              renderSingleSongRow(s, scTrendingMixes, 'sc_mixes')
                            )}
                          </div>
                        </>
                      )}

                    {(scTrendingFilter === 'all' || scTrendingFilter === 'tracks') &&
                      scTrendingTracks.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🔥 TRENDING TRACKS ({scTrendingTracks.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scTrendingTracks.map((s) =>
                              renderSingleSongRow(s, scTrendingTracks, 'sc_trending')
                            )}
                          </div>
                        </>
                      )}
                  </>
                )}
              </>
            )}
          </div>
        ) : (
          /* =================================================================
             STATE B: 🎵 SELECTED COLLECTION TRACKLIST & MANAGEMENT VIEW
             ================================================================= */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, width: '100%' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: 12,
                borderBottom: '1px solid #16161c',
                flexWrap: 'wrap',
                gap: 10,
                minWidth: 0,
                width: '100%',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button
                    data-right-back-grid="true"
                    onClick={handleWalkBack}
                    title={
                      navHistory.length > 0 &&
                      navHistory[navHistory.length - 1]?.rightPaneMode === 'tracks'
                        ? 'Walk back to previous view'
                        : `Back to ${activeHubLabel}`
                    }
                    style={{
                      minHeight: 38,
                      padding: '0 10px',
                      borderRadius: 8,
                      background: '#14141e',
                      border: '1px solid #2a2a38',
                      color: '#bfeaf5',
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    ← Back<span className="simp-gp-badge"> (B)</span>
                  </button>
                  {navHistory.length > 0 &&
                    navHistory[navHistory.length - 1]?.rightPaneMode === 'tracks' && (
                      <button
                        onClick={() => {
                          setRightPaneMode('browse');
                          focusRightPaneFirstTile();
                        }}
                        title={`Return directly to ${activeHubLabel} Grid`}
                        style={{
                          minHeight: 38,
                          padding: '0 10px',
                          borderRadius: 8,
                          background: '#0e1018',
                          border: '1px solid #222432',
                          color: '#a1a1aa',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        ⊞ {activeHubLabel}
                      </button>
                    )}
                </div>

                {(selectedAlbumObj?.art_url ||
                  selectedPlaylistObj?.cover_art_url ||
                  (browserTarget &&
                    (browserTarget.kind === 'cloud_album' ||
                      browserTarget.kind === 'cloud_playlist' ||
                      browserTarget.kind === 'cdda') &&
                    browserTarget.art_url)) && (
                  <img
                    src={
                      selectedAlbumObj?.art_url ||
                      selectedPlaylistObj?.cover_art_url ||
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
                  {/* Optical CD-ROM Controls */}
                  {browserTarget.kind === 'cdda' && (
                    <>
                      <button
                        onClick={() => handleScanOpticalDisc(true, false)}
                        disabled={cdScanning}
                        style={{
                          minHeight: 40,
                          padding: '0 12px',
                          borderRadius: 10,
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
                          minHeight: 40,
                          padding: '0 12px',
                          borderRadius: 10,
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

                  <button
                    data-right-play-all="true"
                    onClick={() => {
                      if (
                        browserTarget.kind === 'cdda' &&
                        opticalDisc?.is_dvd_video &&
                        opticalDisc.dvd_titles &&
                        opticalDisc.dvd_titles.length > 0
                      ) {
                        setActiveDvdPlayback({
                          titleInfo: opticalDisc.dvd_titles[0],
                          chapter: 1,
                          audioIdx: dvdAudioChoice,
                          subIdx: dvdSubChoice,
                        });
                        return;
                      }
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
                    ▶ Play<span className="simp-gp-badge"> (A)</span>
                  </button>
                  {!(browserTarget.kind === 'cdda' && opticalDisc?.is_dvd_video) && (
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
                        minHeight: 40,
                        padding: '0 14px',
                        borderRadius: 10,
                        background: '#14141c',
                        color: '#d4d4dc',
                        border: '1px solid #2e2e3a',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      🔀 Shuffle<span className="simp-gp-badge"> (X)</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* DVD-Video Title & Episode Browser */}
            {browserTarget?.kind === 'cdda' && opticalDisc?.is_dvd_video && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: '#11131c',
                    border: '1px solid #242838',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: opticalDisc.dvd_css_available ? '#0f291e' : '#261a0d',
                        color: opticalDisc.dvd_css_available ? '#6ee7b7' : '#fcd34d',
                        border: opticalDisc.dvd_css_available
                          ? '1px solid #059669'
                          : '1px solid #b45309',
                      }}
                    >
                      {opticalDisc.dvd_css_available
                        ? opticalDisc.device_path?.startsWith('\\\\')
                          ? '🔓 DVD CSS Active (VLC / libdvdcss)'
                          : '🔓 libdvdcss.so.2 Active'
                        : opticalDisc.device_path?.startsWith('\\\\')
                        ? '🔒 Unencrypted Only (install VLC or place libdvdcss-2.dll in data\\lib\\)'
                        : '🔒 Unencrypted Only (place libdvdcss.so.2 in ~/.local/share/simp/lib/)'}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: opticalDisc.dvd_ffmpeg_available ? '#0f222a' : '#291216',
                        color: opticalDisc.dvd_ffmpeg_available ? '#67e8f9' : '#fca5a5',
                        border: opticalDisc.dvd_ffmpeg_available
                          ? '1px solid #0891b2'
                          : '1px solid #991b1b',
                      }}
                    >
                      {opticalDisc.dvd_ffmpeg_available
                        ? '🎞️ ffmpeg Streamer Ready'
                        : '⚠️ ffmpeg Not Found in PATH'}
                    </span>
                  </div>

                  {/* Default Audio & Subtitle Selectors from Title 1 */}
                  {opticalDisc.dvd_titles && opticalDisc.dvd_titles.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {opticalDisc.dvd_titles[0].audio_tracks.length > 0 && (
                        <label style={{ fontSize: 11, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 4 }}>
                          🔊 Audio:
                          <select
                            value={dvdAudioChoice}
                            onChange={(e) => setDvdAudioChoice(Number(e.target.value))}
                            style={{
                              background: '#0a0a0e',
                              color: '#f8fafc',
                              border: '1px solid #2e2e3e',
                              borderRadius: 6,
                              padding: '3px 6px',
                              fontSize: 11,
                            }}
                          >
                            {opticalDisc.dvd_titles[0].audio_tracks.map((a) => (
                              <option key={a.stream_index} value={a.stream_index}>
                                {a.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {opticalDisc.dvd_titles[0].subtitle_tracks.length > 0 && (
                        <label style={{ fontSize: 11, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 4 }}>
                          💬 Subtitles:
                          <select
                            value={dvdSubChoice}
                            onChange={(e) => setDvdSubChoice(e.target.value)}
                            style={{
                              background: '#0a0a0e',
                              color: '#f8fafc',
                              border: '1px solid #2e2e3e',
                              borderRadius: 6,
                              padding: '3px 6px',
                              fontSize: 11,
                            }}
                          >
                            <option value="off">Off</option>
                            {opticalDisc.dvd_titles[0].subtitle_tracks.map((s) => (
                              <option key={s.stream_index} value={String(s.stream_index)}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                </div>

                {(opticalDisc.dvd_titles || []).map((tInfo) => {
                  const totalSec = Math.floor(tInfo.duration_ms / 1000);
                  const mins = Math.floor(totalSec / 60);
                  const secs = totalSec % 60;
                  return (
                    <div
                      key={tInfo.title_number}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 12,
                        background: '#0a0a0e',
                        border: '1px solid #181822',
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
                          gap: 10,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: '#f8fafc' }}>
                            📀 {tInfo.label} (Title {tInfo.title_number})
                          </div>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                            {mins}m {String(secs).padStart(2, '0')}s • {tInfo.aspect_ratio} •{' '}
                            {tInfo.chapters.length} Chapters
                            {tInfo.audio_tracks.length > 0
                              ? ` • ${tInfo.audio_tracks.map((a) => a.lang_name).join(', ')}`
                              : ''}
                          </div>
                        </div>
                        <button
                          data-right-track="true"
                          onClick={() =>
                            setActiveDvdPlayback({
                              titleInfo: tInfo,
                              chapter: 1,
                              audioIdx: dvdAudioChoice,
                              subIdx: dvdSubChoice,
                            })
                          }
                          style={{
                            minHeight: 36,
                            padding: '0 14px',
                            borderRadius: 8,
                            background: '#0f222a',
                            border: '1px solid #2aa3c4',
                            color: '#bfeaf5',
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          ▶ Play
                        </button>
                      </div>

                      {tInfo.chapters.length > 1 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {tInfo.chapters.map((ch) => (
                            <button
                              key={ch.chapter_number}
                              onClick={() =>
                                setActiveDvdPlayback({
                                  titleInfo: tInfo,
                                  chapter: ch.chapter_number,
                                  audioIdx: dvdAudioChoice,
                                  subIdx: dvdSubChoice,
                                })
                              }
                              style={{
                                padding: '3px 8px',
                                borderRadius: 6,
                                background: '#14141e',
                                border: '1px solid #262636',
                                color: '#cbd5e1',
                                fontSize: 10,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Ch {ch.chapter_number}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

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
                  data-right-track="true"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).click();
                    }
                  }}
                  onClick={() => {
                    if (track?.uri === t.uri && playingContextId === currentCtxKey) {
                      setView('lock');
                    } else {
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
                    padding: '6px 12px',
                    borderRadius: 12,
                    background: track?.uri === t.uri ? '#0d1b22' : '#0a0a0e',
                    border: track?.uri === t.uri ? '1px solid #2aa3c4' : '1px solid #16161e',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    cursor: 'pointer',
                    minWidth: 0,
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#71717a', flexShrink: 0 }}>
                      {String(t.track_number ?? i + 1).padStart(2, '0')}
                    </span>
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
                            : t.source === 'soundcloud'
                            ? '#2c140a'
                            : t.source === 'cdda'
                            ? '#261a0d'
                            : '#101822',
                        color:
                          t.source === 'apple_music'
                            ? '#fda4af'
                            : t.source === 'soundcloud'
                            ? '#fdba74'
                            : t.source === 'cdda'
                            ? '#fcd34d'
                            : '#67e8f9',
                      }}
                    >
                      {t.source === 'apple_music'
                        ? '🍎 Apple'
                        : t.source === 'soundcloud'
                        ? '☁️ SC'
                        : t.source === 'steam_ost'
                        ? '🎮 OST'
                        : t.source === 'cdda'
                        ? '💿 CD'
                        : '💾 Local'}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#71717a' }}>
                      {Math.floor(t.duration_ms / 60000)}:
                      {String(Math.floor((t.duration_ms / 1000) % 60)).padStart(2, '0')}
                    </span>
                    {t.source === 'soundcloud' && (
                      <button
                        data-row-aux="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartSoundCloudTrackRadio(t);
                        }}
                        title={`Start SoundCloud Track Radio from "${t.title}"`}
                        style={{
                          padding: '5px 8px',
                          borderRadius: 8,
                          background: '#221108',
                          border: '1px solid #5c280e',
                          color: '#fdba74',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        📻 Radio
                      </button>
                    )}
                    {t.source === 'apple_music' && browserTarget?.kind !== 'cloud_album' && (
                      <button
                        data-row-aux="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectCloudAlbum({
                            songUri: t.uri,
                            fallbackTitle: t.album || t.title,
                          });
                        }}
                        title={`Open full album "${t.album || t.title}"`}
                        style={{
                          padding: '5px 8px',
                          borderRadius: 8,
                          background: '#1c1218',
                          border: '1px solid #4c1d2e',
                          color: '#fda4af',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        💿 Album
                      </button>
                    )}
                    {!isViewingLocalPlaylist && t.source !== 'cdda' && (
                      <button
                        data-row-aux="true"
                        data-track-select="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddTracksToPlaylist([t.uri], `"${t.title}"`, [t]);
                        }}
                        title="Add track to selected SIMP Playlist (SELECT)"
                        style={{
                          padding: '5px 9px',
                          borderRadius: 8,
                          background: '#161620',
                          border: '1px solid #2e2e3c',
                          color: '#2aa3c4',
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        +
                      </button>
                    )}
                    {isViewingLocalPlaylist && browserTarget && (
                      <button
                        data-row-aux="true"
                        data-track-select="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveTrackFromPlaylist(browserTarget.id, t.uri, t.title);
                        }}
                        title={`Remove "${t.title}" from this playlist (SELECT)`}
                        style={{
                          padding: '5px 9px',
                          borderRadius: 8,
                          background: '#201216',
                          border: '1px solid #4c2228',
                          color: '#f87171',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        −
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {activeDvdPlayback && opticalDisc && (
        <DvdPlayerModal
          devicePath={opticalDisc.device_path || '/dev/sr0'}
          discTitle={opticalDisc.album_title || 'DVD Video'}
          titleInfo={activeDvdPlayback.titleInfo}
          initialChapter={activeDvdPlayback.chapter}
          initialAudioIndex={activeDvdPlayback.audioIdx}
          initialSubtitleIndex={activeDvdPlayback.subIdx}
          onClose={() => setActiveDvdPlayback(null)}
        />
      )}
    </main>
  );
};
