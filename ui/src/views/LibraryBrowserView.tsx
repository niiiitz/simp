import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlbumRecord,
  ArchiveItemDetail,
  ArchiveItemSummary,
  defaultSimpClient,
  DvdTitleInfo,
  OpticalDiscStatus,
  PlaylistRecord,
  SimpStateSnapshot,
  TrackMetadata,
  VideoEpisodeItem,
} from '@simp/client';
import { DvdPlayerModal } from '../components/DvdPlayerModal';
import {
  AppleArtistProfileResponse,
  AppleArtistSummary,
  AppleCatalogSearchResults,
  AppleCloudAlbumSummary,
  AppleCloudPlaylistSummary,
  AppleRadioStationSummary,
  AppleRecommendationShelf,
  fetchAppleArtistProfile,
  fetchAppleCloudPlaylists,
  fetchAppleLibraryRecentlyAdded,
  fetchAppleNewFeed,
  fetchApplePlaylistTracks,
  fetchAppleRadioAndForYou,
  fetchFullAppleAlbum,
  fetchLocalArtistProfile,
  LocalArtistProfileResponse,
} from '../drivers/AppleMusicDriver';
import {
  fetchSoundCloudDiscover,
  fetchSoundCloudFollowings,
  fetchSoundCloudLikesAndPlaylists,
  fetchSoundCloudNextPage,
  fetchSoundCloudPlaylistTracks,
  fetchSoundCloudStreamAndRadio,
  fetchSoundCloudUserTracks,
  likeSoundCloudTrack,
  SoundCloudCatalogSearchResults,
  SoundCloudPlaylistSummary,
  SoundCloudUserProfileResponse,
  SoundCloudUserSummary,
  toggleFollowSoundCloudUser,
  unlikeSoundCloudTrack,
} from '../drivers/SoundCloudDriver';
import { OskTargetKind } from '../hooks/useGamepadNavigation';
import { BrowserTarget, isUiVideoTrack } from './PlayerView';
import { SourceVisibilityPrefs } from './SettingsModal';

const iaItemCountCache = new Map<string, number>();
const iaItemCountPending = new Set<string>();

export interface LibraryBrowserViewProps {
  hidden?: boolean;
  snap: SimpStateSnapshot | null;
  track: TrackMetadata | null | undefined;
  albums: AlbumRecord[];
  playlists: PlaylistRecord[];
  browserSourceFilter: 'all' | 'local' | 'apple_music' | 'soundcloud' | 'internet_archive';
  setBrowserSourceFilter: React.Dispatch<
    React.SetStateAction<'all' | 'local' | 'apple_music' | 'soundcloud' | 'internet_archive'>
  >;
  selectedSources: Array<'local' | 'apple_music' | 'soundcloud' | 'internet_archive'>;
  setSelectedSources: React.Dispatch<
    React.SetStateAction<Array<'local' | 'apple_music' | 'soundcloud' | 'internet_archive'>>
  >;
  setBrowserSourceFilterRaw: React.Dispatch<
    React.SetStateAction<'all' | 'local' | 'apple_music' | 'soundcloud' | 'internet_archive'>
  >;
  browserSearch: string;
  setBrowserSearch: React.Dispatch<React.SetStateAction<string>>;
  searchPreferredSource?: 'local' | 'apple_music' | 'soundcloud' | 'internet_archive' | null;
  browserTarget: BrowserTarget | null;
  setBrowserTarget: React.Dispatch<React.SetStateAction<BrowserTarget | null>>;
  browserTracks: TrackMetadata[];
  setBrowserTracks: React.Dispatch<React.SetStateAction<TrackMetadata[]>>;
  opticalDisc: OpticalDiscStatus | null;
  cdScanning: boolean;
  handleScanOpticalDisc: (forceRefresh?: boolean, silent?: boolean) => Promise<void>;
  handleEjectOpticalDisc: () => void;
  appleSubTab: 'pinned' | 'for_you' | 'cloud_playlists' | 'new' | 'radio';
  setAppleSubTab: React.Dispatch<
    React.SetStateAction<'pinned' | 'for_you' | 'cloud_playlists' | 'new' | 'radio'>
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
  personalRadioStations?: AppleRadioStationSummary[];
  setPersonalRadioStations?: React.Dispatch<React.SetStateAction<AppleRadioStationSummary[]>>;
  liveRadioStations?: AppleRadioStationSummary[];
  setLiveRadioStations?: React.Dispatch<React.SetStateAction<AppleRadioStationSummary[]>>;
  forYouPlaylists: AppleCloudPlaylistSummary[];
  setForYouPlaylists: React.Dispatch<React.SetStateAction<AppleCloudPlaylistSummary[]>>;
  forYouAlbums: AppleCloudAlbumSummary[];
  setForYouAlbums: React.Dispatch<React.SetStateAction<AppleCloudAlbumSummary[]>>;
  forYouNewReleases?: AppleCloudAlbumSummary[];
  setForYouNewReleases?: React.Dispatch<React.SetStateAction<AppleCloudAlbumSummary[]>>;
  setForYouShelves?: React.Dispatch<React.SetStateAction<AppleRecommendationShelf[]>>;
  appleRecentlyPlayedTracks?: TrackMetadata[];
  setAppleRecentlyPlayedTracks?: React.Dispatch<React.SetStateAction<TrackMetadata[]>>;
  newFeedRecentReleases?: AppleCloudAlbumSummary[];
  setNewFeedRecentReleases?: React.Dispatch<React.SetStateAction<AppleCloudAlbumSummary[]>>;
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
  sourceVisibility: SourceVisibilityPrefs;
  recentlyPlayed: TrackMetadata[];
  showToast: (msg: string) => void;
  forYouShelves?: AppleRecommendationShelf[];
  scMoreOfWhatYouLike?: TrackMetadata[];
  scFreshUploads?: TrackMetadata[];
  scRecommendedArtists?: SoundCloudUserSummary[];
  scDiscoverNextHref?: string | null;
  setScDiscoverNextHref?: React.Dispatch<React.SetStateAction<string | null>>;
  setScCatalogSearchResults?: React.Dispatch<
    React.SetStateAction<SoundCloudCatalogSearchResults>
  >;
  handleFavoriteTrack?: (track: TrackMetadata) => Promise<void>;
  handleAddAppleToCloudLibrary?: (
    idOrUri: string,
    kind?: 'songs' | 'albums' | 'playlists',
    label?: string
  ) => Promise<void>;
  favoritedUris?: string[];
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
  selectedSources,
  setSelectedSources,
  setBrowserSourceFilterRaw,
  browserSearch,
  setBrowserSearch,
  searchPreferredSource = null,
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
  personalRadioStations = [],
  setPersonalRadioStations,
  liveRadioStations = [],
  setLiveRadioStations,
  forYouPlaylists,
  setForYouPlaylists,
  forYouAlbums,
  setForYouAlbums,
  forYouNewReleases = [],
  setForYouNewReleases,
  setForYouShelves,
  appleRecentlyPlayedTracks = [],
  setAppleRecentlyPlayedTracks,
  newFeedRecentReleases = [],
  setNewFeedRecentReleases,
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
  sourceVisibility,
  recentlyPlayed,
  showToast,
  forYouShelves = [],
  scMoreOfWhatYouLike = [],
  scFreshUploads = [],
  scRecommendedArtists = [],
  scDiscoverNextHref = null,
  setScDiscoverNextHref,
  setScCatalogSearchResults,
  handleFavoriteTrack,
  handleAddAppleToCloudLibrary,
  favoritedUris = [],
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

  // Internet Archive & Universal Theatre Video Player state
  const [iaSubTab, setIaSubTab] = useState<'pinned' | 'trending' | 'films' | 'tv' | 'audio'>('trending');
  const [iaSubFilter, setIaSubFilter] = useState<string>('all');
  const [iaItems, setIaItems] = useState<ArchiveItemSummary[]>([]);
  const [iaPage, setIaPage] = useState<number>(1);
  const [iaHasMore, setIaHasMore] = useState<boolean>(false);
  const [iaLoadingMore, setIaLoadingMore] = useState<boolean>(false);
  const [iaSearchResults, setIaSearchResults] = useState<ArchiveItemSummary[]>([]);
  const [iaSearchPage, setIaSearchPage] = useState<number>(1);
  const [iaSearchHasMore, setIaSearchHasMore] = useState<boolean>(false);
  const [iaSearchLoadingMore, setIaSearchLoadingMore] = useState<boolean>(false);
  const [activeIaDetail, setActiveIaDetail] = useState<ArchiveItemDetail | null>(null);
  const [iaLoading, setIaLoading] = useState<boolean>(false);
  const [scLoadingMore, setScLoadingMore] = useState<boolean>(false);
  const [activeVideoModal, setActiveVideoModal] = useState<{
    mode: 'ia_video' | 'local_video';
    title: string;
    episodes: VideoEpisodeItem[];
    initialEpisodeIndex?: number;
  } | null>(null);

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

  // Right Pane State: 'browse' (4-Column-Max Visual Card Grid for the active Place), 'tracks' (Selected Collection Tracklist), or 'artist' (Dedicated Artist Profile View)
  const [rightPaneMode, setRightPaneMode] = useState<'browse' | 'tracks' | 'artist'>('browse');
  const [activeArtistProfile, setActiveArtistProfile] = useState<{
    source: 'apple_music' | 'soundcloud' | 'local';
    idOrName: string;
    displayName: string;
    subTab: 'tracks' | 'albums' | 'singles_or_likes' | 'related_or_following';
    loading: boolean;
    loadingMore?: boolean;
    appleData?: AppleArtistProfileResponse | null;
    scData?: SoundCloudUserProfileResponse | null;
    localData?: LocalArtistProfileResponse | null;
  } | null>(null);
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'video' | 'audio'>('all');
  const [iaResolvedCounts, setIaResolvedCounts] = useState<Record<string, number>>({});
  const [activeMountRoot, setActiveMountRoot] = useState<string | null>(null);
  const [mountAlbums, setMountAlbums] = useState<AlbumRecord[]>([]);
  const [mountTracks, setMountTracks] = useState<TrackMetadata[]>([]);
  const [localVideos, setLocalVideos] = useState<TrackMetadata[]>([]);
  const [localSearchTracks, setLocalSearchTracks] = useState<TrackMetadata[]>([]);
  const [simpHubFilter, setSimpHubFilter] = useState<
    'all' | 'recent' | 'hybrid' | 'pinned' | 'albums' | 'videos'
  >('all');
  const [cloudPage, setCloudPage] = useState<number>(0);
  const [cloudAlpha, setCloudAlpha] = useState<AlphaBucket>('all');
  const [forYouFilter, setForYouFilter] = useState<
    'all' | 'stations' | 'new_releases' | 'recently_played' | 'mixes' | 'recent_library'
  >('all');
  const [newFilter, setNewFilter] = useState<
    'all' | 'recent_releases' | 'albums' | 'playlists' | 'songs'
  >('all');
  const [scLikesFilter, setScLikesFilter] = useState<'all' | 'likes' | 'sets' | 'following'>('all');
  const [scFollowings, setScFollowings] = useState<SoundCloudUserSummary[]>([]);
  const [scFollowingsLoaded, setScFollowingsLoaded] = useState<boolean>(false);
  const [scStreamFilter, setScStreamFilter] = useState<'all' | 'history' | 'stream' | 'sets'>('all');
  const [scTrendingFilter, setScTrendingFilter] = useState<
    'all' | 'for_you' | 'fresh' | 'artists' | 'mixes' | 'sets' | 'tracks'
  >('all');
  const [recentlyAddedCloudAlbums, setRecentlyAddedCloudAlbums] = useState<AppleCloudAlbumSummary[]>(
    []
  );
  const recentLoadedRef = useRef(false);

  const isSourceIncluded = useCallback(
    (src: 'local' | 'apple_music' | 'soundcloud' | 'internet_archive'): boolean => {
      if (src === 'apple_music' && !sourceVisibility.apple_music) return false;
      if (src === 'soundcloud' && !sourceVisibility.soundcloud) return false;
      if (src === 'internet_archive' && !sourceVisibility.internet_archive) return false;
      if (selectedSources.length > 0) {
        return selectedSources.includes(src);
      }
      return browserSourceFilter === 'all' || browserSourceFilter === src;
    },
    [sourceVisibility, selectedSources, browserSourceFilter]
  );

  useEffect(() => {
    if (
      browserSourceFilter !== 'soundcloud' ||
      soundCloudSubTab !== 'likes_sets' ||
      !snap?.soundcloud_authenticated
    ) {
      return;
    }
    if (scFollowingsLoaded) return;
    setScFollowingsLoaded(true);
    fetchSoundCloudFollowings()
      .then((users) => {
        if (Array.isArray(users)) setScFollowings(users);
      })
      .catch(() => {
        setScFollowingsLoaded(false);
      });
  }, [browserSourceFilter, soundCloudSubTab, snap?.soundcloud_authenticated, scFollowingsLoaded]);

  useEffect(() => {
    if (
      !snap?.apple_authenticated ||
      !isSourceIncluded('apple_music')
    )
      return;
    if (appleSubTab !== 'for_you' && appleSubTab !== 'pinned') return;
    if (recentLoadedRef.current && recentlyAddedCloudAlbums.length > 0) return;
    recentLoadedRef.current = true;
    fetchAppleLibraryRecentlyAdded()
      .then((albs) => {
        if (Array.isArray(albs)) setRecentlyAddedCloudAlbums(albs);
      })
      .catch(() => {
        recentLoadedRef.current = false;
      });
  }, [snap?.apple_authenticated, isSourceIncluded, appleSubTab, recentlyAddedCloudAlbums.length]);

  // Clear activeMountRoot if user switches source filter away from Local
  useEffect(() => {
    if (!isSourceIncluded('local') && activeMountRoot) {
      setActiveMountRoot(null);
    }
  }, [isSourceIncluded, activeMountRoot]);

  const resolveDaemonUrl = useCallback((path: string): string => {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      const host = window.location.hostname;
      if (
        window.location.protocol === 'http:' &&
        host !== 'steamloopback.host' &&
        host !== '127.0.0.1' &&
        host !== 'localhost'
      ) {
        const port = window.location.port === '1420' ? '18888' : window.location.port || '18888';
        return `http://${host}:${port}${path}`;
      }
      if (window.location.port === '18888') {
        return path;
      }
    }
    return `http://127.0.0.1:18888${path}`;
  }, []);

  // Fetch Internet Archive discovery hub items (page 1)
  const loadIaDiscover = useCallback(
    (hub: string, sub: string) => {
      setIaLoading(true);
      setIaPage(1);
      setIaHasMore(false);
      fetch(
        resolveDaemonUrl(
          `/api/ia/discover?hub=${encodeURIComponent(hub)}&sub=${encodeURIComponent(sub)}&page=1`
        )
      )
        .then((r) => r.json())
        .then((d) => {
          const list = Array.isArray(d?.items)
            ? d.items
            : Array.isArray(d?.data)
              ? d.data
              : [];
          if (d?.ok) {
            setIaItems(list);
            setIaHasMore(Boolean(d?.has_more));
          }
        })
        .catch(() => {})
        .finally(() => setIaLoading(false));
    },
    [resolveDaemonUrl]
  );

  const loadMoreIaDiscover = useCallback(() => {
    if (iaLoadingMore || !iaHasMore) return;
    const nextPage = iaPage + 1;
    setIaLoadingMore(true);
    fetch(
      resolveDaemonUrl(
        `/api/ia/discover?hub=${encodeURIComponent(iaSubTab)}&sub=${encodeURIComponent(
          iaSubFilter
        )}&page=${nextPage}`
      )
    )
      .then((r) => r.json())
      .then((d) => {
        const list: ArchiveItemSummary[] = Array.isArray(d?.items)
          ? d.items
          : Array.isArray(d?.data)
            ? d.data
            : [];
        if (d?.ok) {
          setIaItems((prev) => {
            const seen = new Set(prev.map((it) => it.identifier));
            const added = list.filter((it) => !seen.has(it.identifier));
            return [...prev, ...added];
          });
          setIaPage(nextPage);
          setIaHasMore(Boolean(d?.has_more) && list.length > 0);
        }
      })
      .catch(() => {})
      .finally(() => setIaLoadingMore(false));
  }, [iaLoadingMore, iaHasMore, iaPage, iaSubTab, iaSubFilter, resolveDaemonUrl]);

  useEffect(() => {
    if (browserSourceFilter !== 'internet_archive' || iaSubTab === 'pinned') return;
    if (!snap?.internet_archive_authenticated || !sourceVisibility.internet_archive) return;
    loadIaDiscover(iaSubTab, iaSubFilter);
  }, [
    browserSourceFilter,
    iaSubTab,
    iaSubFilter,
    snap?.internet_archive_authenticated,
    sourceVisibility.internet_archive,
    loadIaDiscover,
  ]);

  // Debounced Internet Archive Search
  useEffect(() => {
    const q = browserSearch.trim();
    if (!q || !snap?.internet_archive_authenticated || !isSourceIncluded('internet_archive')) {
      setIaSearchResults([]);
      setIaSearchPage(1);
      setIaSearchHasMore(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setIaSearchPage(1);
      fetch(resolveDaemonUrl(`/api/ia/search?q=${encodeURIComponent(q)}&page=1`))
        .then((r) => r.json())
        .then((d) => {
          const list = Array.isArray(d?.items)
            ? d.items
            : Array.isArray(d?.data)
              ? d.data
              : [];
          if (d?.ok) {
            setIaSearchResults(list);
            setIaSearchHasMore(Boolean(d?.has_more));
          }
        })
        .catch(() => {});
    }, 280);
    return () => window.clearTimeout(timer);
  }, [browserSearch, isSourceIncluded, snap?.internet_archive_authenticated, resolveDaemonUrl]);

  const loadMoreIaSearch = useCallback(() => {
    const q = browserSearch.trim();
    if (!q || iaSearchLoadingMore || !iaSearchHasMore) return;
    const nextPage = iaSearchPage + 1;
    setIaSearchLoadingMore(true);
    fetch(resolveDaemonUrl(`/api/ia/search?q=${encodeURIComponent(q)}&page=${nextPage}`))
      .then((r) => r.json())
      .then((d) => {
        const list: ArchiveItemSummary[] = Array.isArray(d?.items)
          ? d.items
          : Array.isArray(d?.data)
            ? d.data
            : [];
        if (d?.ok) {
          setIaSearchResults((prev) => {
            const seen = new Set(prev.map((it) => it.identifier));
            const added = list.filter((it) => !seen.has(it.identifier));
            return [...prev, ...added];
          });
          setIaSearchPage(nextPage);
          setIaSearchHasMore(Boolean(d?.has_more) && list.length > 0);
        }
      })
      .catch(() => {})
      .finally(() => setIaSearchLoadingMore(false));
  }, [browserSearch, iaSearchLoadingMore, iaSearchHasMore, iaSearchPage, resolveDaemonUrl]);

  const loadMoreScDiscover = useCallback(() => {
    if (!scDiscoverNextHref || scLoadingMore) return;
    setScLoadingMore(true);
    fetchSoundCloudNextPage(scDiscoverNextHref)
      .then((res) => {
        if (res.tracks && res.tracks.length > 0) {
          setScTrendingTracks((prev) => {
            const seen = new Set(prev.map((t) => t.uri));
            const added = res.tracks.filter((t) => !seen.has(t.uri));
            return [...prev, ...added];
          });
        }
        setScDiscoverNextHref?.(res.next_href || null);
      })
      .catch(() => {})
      .finally(() => setScLoadingMore(false));
  }, [scDiscoverNextHref, scLoadingMore, setScTrendingTracks, setScDiscoverNextHref]);

  const loadMoreScSearch = useCallback(() => {
    const nextHref = scCatalogSearchResults.next_tracks_href;
    if (!nextHref || scLoadingMore || !setScCatalogSearchResults) return;
    setScLoadingMore(true);
    fetchSoundCloudNextPage(nextHref)
      .then((res) => {
        setScCatalogSearchResults((prev) => {
          const seen = new Set(prev.songs.map((t) => t.uri));
          const added = (res.tracks || []).filter((t) => !seen.has(t.uri));
          return {
            ...prev,
            songs: [...prev.songs, ...added],
            next_tracks_href: res.next_href || null,
          };
        });
      })
      .catch(() => {})
      .finally(() => setScLoadingMore(false));
  }, [scCatalogSearchResults.next_tracks_href, scLoadingMore, setScCatalogSearchResults]);

  // Lazy background item/episode count resolver for visible Internet Archive tiles
  useEffect(() => {
    const visibleList = browserSearch.trim() ? iaSearchResults : iaItems;
    if (visibleList.length === 0) return;
    const candidates = visibleList.filter(
      (it) =>
        it.item_count === undefined &&
        it.item_count !== null &&
        !iaItemCountCache.has(it.identifier) &&
        !iaItemCountPending.has(it.identifier)
    );
    if (candidates.length === 0) return;

    let cancelled = false;
    const runResolve = async () => {
      for (const it of candidates.slice(0, 16)) {
        if (cancelled) break;
        iaItemCountPending.add(it.identifier);
        try {
          const resp = await fetch(
            resolveDaemonUrl(`/api/ia/item?id=${encodeURIComponent(it.identifier)}`)
          );
          const d = await resp.json();
          const detail: ArchiveItemDetail | undefined = d?.detail || d?.data;
          if (!cancelled && d?.ok && detail) {
            const count =
              detail.episodes && detail.episodes.length > 0
                ? detail.episodes.length
                : detail.tracks
                ? detail.tracks.length
                : 1;
            iaItemCountCache.set(it.identifier, count);
            setIaResolvedCounts((prev) => ({ ...prev, [it.identifier]: count }));
          }
        } catch {
          // Ignore individual metadata failures
        }
        await new Promise((r) => window.setTimeout(r, 180));
      }
    };
    runResolve();
    return () => {
      cancelled = true;
    };
  }, [iaItems, iaSearchResults, browserSearch, resolveDaemonUrl]);

  // Auto-load Internet Archive item detail when jumping directly from Player ('Open Collection')
  useEffect(() => {
    if (browserTarget?.kind !== 'ia_item') return;
    setRightPaneMode('tracks');
    if (activeIaDetail?.summary.identifier === browserTarget.id) return;
    setIaLoading(true);
    fetch(resolveDaemonUrl(`/api/ia/item?id=${encodeURIComponent(browserTarget.id)}`))
      .then((r) => r.json())
      .then((d) => {
        const detail: ArchiveItemDetail | undefined = d?.detail || d?.data;
        if (d?.ok && detail) {
          setActiveIaDetail(detail);
          setBrowserTracks(detail.tracks || []);
        }
      })
      .catch(() => {})
      .finally(() => setIaLoading(false));
  }, [browserTarget, activeIaDetail?.summary.identifier, setBrowserTracks, resolveDaemonUrl]);

  // Listen for 'Open Collection in Library' ('simp-open-collection-in-library') from Player / SELECT menu:
  // Switch the Right Pane to 'tracks' mode, clear any active search query, and scroll/focus the playing track!
  useEffect(() => {
    const onOpenCollectionInLibrary = () => {
      setBrowserSearch('');
      setActiveMountRoot(null);
      setRightPaneMode('tracks');
      pendingRightFocusRef.current = 'track';
      window.setTimeout(() => {
        const playingRow =
          document.querySelector<HTMLElement>(
            '[data-nav-col="right"] [data-right-track="true"][data-track-playing="true"]'
          ) ||
          document.querySelector<HTMLElement>(
            '[data-nav-col="right"] [data-right-track="true"]'
          ) ||
          document.querySelector<HTMLElement>(
            '[data-nav-col="right"] [data-right-play-all="true"]:not([disabled])'
          );
        if (playingRow) {
          playingRow.scrollIntoView({ block: 'center', inline: 'nearest' });
          applyFocusMarker(playingRow);
          if (playingRow.dataset.rightTrack === 'true') {
            pendingRightFocusRef.current = null;
          }
        }
      }, 65);
    };
    window.addEventListener('simp-open-collection-in-library', onOpenCollectionInLibrary);
    return () => {
      window.removeEventListener('simp-open-collection-in-library', onOpenCollectionInLibrary);
    };
  }, [applyFocusMarker, setBrowserSearch]);

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

  // Load indexed Local Video files (`source: 'local_video'`) for the SIMP Library hub
  useEffect(() => {
    defaultSimpClient
      .query<TrackMetadata[]>('get_tracks', {
        source: 'local_video',
        mount_root: null,
        search: null,
        limit: 500,
        offset: 0,
      })
      .then((res) => {
        if (Array.isArray(res)) setLocalVideos(res);
      })
      .catch(() => {});
  }, [albums, snap?.mounts]);

  // Query matching Local tracks & videos when searching in `all` or `local`
  useEffect(() => {
    const q = browserSearch.trim();
    if (!q || !isSourceIncluded('local')) {
      setLocalSearchTracks([]);
      return;
    }
    defaultSimpClient
      .query<TrackMetadata[]>('get_tracks', {
        source: null,
        mount_root: null,
        search: q,
        limit: 60,
        offset: 0,
      })
      .then((res) => {
        if (Array.isArray(res)) setLocalSearchTracks(res);
      })
      .catch(() => {});
  }, [browserSearch, isSourceIncluded]);

  // Auto-focus Right Pane when selecting a Place ('tile') or Collection ('track')
  const pendingRightFocusRef = useRef<'track' | 'tile' | null>(null);
  const xmbPreviewTriggerRef = useRef<boolean>(false);

  // PS3 XMB Auto-Fill: When cursor lands on a non-drill-down row in the Left Column (`data-xmb-preview="true"`),
  // automatically fill the Right Pane after a 180ms debounce while keeping focus in the Left Column!
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
      }, 180);
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

  // Source-aware & media-type-aware SIMP Album filtering
  // In `📌 My SIMP Library` (when not in `💾 Local` source mode and not searching), only show pinned albums.
  // In `💾 Local` source mode or when searching, show all matching local albums so they can be browsed & pinned.
  const filteredAlbums = useMemo(
    () =>
      albums.filter((alb) => {
        if (mediaTypeFilter === 'video') return false;
        const isApple = alb.id.startsWith('applemusic:album:');
        if (isApple && !isSourceIncluded('apple_music')) return false;
        if (!isApple && !isSourceIncluded('local')) return false;
        if (searchLower) {
          const matchTitle = alb.title.toLowerCase().includes(searchLower);
          const matchArtist = alb.album_artist.toLowerCase().includes(searchLower);
          if (!matchTitle && !matchArtist) return false;
          return true;
        }
        if (!isApple && browserSourceFilter !== 'local') {
          return playlists.some((p) => p.id === `local:album:${alb.id}`);
        }
        return true;
      }),
    [albums, mediaTypeFilter, isSourceIncluded, searchLower, browserSourceFilter, playlists]
  );

  // Source-aware & media-type-aware Recently Played filtering
  const filteredRecentlyPlayed = useMemo(
    () =>
      recentlyPlayed.filter((tr) => {
        const isVid = isUiVideoTrack(tr);
        if (mediaTypeFilter === 'video' && !isVid) return false;
        if (mediaTypeFilter === 'audio' && isVid) return false;
        if (tr.source === 'apple_music' && !isSourceIncluded('apple_music')) return false;
        if (tr.source === 'soundcloud' && !isSourceIncluded('soundcloud')) return false;
        if (
          (tr.source === 'internet_archive' || tr.source === 'ia_video') &&
          !isSourceIncluded('internet_archive')
        )
          return false;
        if (
          (tr.source === 'local' ||
            tr.source === 'local_video' ||
            tr.source === 'steam_ost' ||
            tr.source === 'removable' ||
            tr.source === 'cdda' ||
            tr.source === 'dvd') &&
          !isSourceIncluded('local')
        )
          return false;
        if (searchLower) {
          const matchTitle = tr.title.toLowerCase().includes(searchLower);
          const matchArtist = tr.artists.some((a) => a.toLowerCase().includes(searchLower));
          const matchAlbum = tr.album ? tr.album.toLowerCase().includes(searchLower) : false;
          if (!matchTitle && !matchArtist && !matchAlbum) return false;
        }
        return true;
      }),
    [recentlyPlayed, mediaTypeFilter, isSourceIncluded, searchLower]
  );

  const filteredLocalSearchTracks = useMemo(
    () =>
      localSearchTracks.filter((tr) => {
        const isVid = isUiVideoTrack(tr);
        if (mediaTypeFilter === 'video' && !isVid) return false;
        if (mediaTypeFilter === 'audio' && isVid) return false;
        return true;
      }),
    [localSearchTracks, mediaTypeFilter]
  );

  const filteredIaItems = useMemo(
    () =>
      iaItems.filter((it) => {
        if (mediaTypeFilter === 'video' && it.mediatype !== 'movies') return false;
        if (mediaTypeFilter === 'audio' && it.mediatype === 'movies') return false;
        return true;
      }),
    [iaItems, mediaTypeFilter]
  );

  const filteredIaSearchResults = useMemo(
    () =>
      iaSearchResults.filter((it) => {
        if (mediaTypeFilter === 'video' && it.mediatype !== 'movies') return false;
        if (mediaTypeFilter === 'audio' && it.mediatype === 'movies') return false;
        return true;
      }),
    [iaSearchResults, mediaTypeFilter]
  );

  // Source-aware SIMP Playlist membership (`has_local`, `has_apple`, `has_soundcloud`, & `has_archive`)
  // Left-column and My SIMP Library hub playlists remain visible regardless of `browserSearch`
  // so users can always select or drop search results into a playlist without it disappearing.
  const filteredPlaylists = useMemo(
    () =>
      playlists.filter((pl) => {
        if (mediaTypeFilter === 'video') {
          const isVideoPl =
            pl.name.startsWith('🎬') ||
            pl.origin === 'archive_remote' ||
            (pl.origin === 'simp_local' && (pl.has_archive || pl.has_local));
          if (!isVideoPl) return false;
        } else if (mediaTypeFilter === 'audio') {
          if (pl.name.startsWith('🎬')) return false;
        }
        if (pl.origin === 'local_pinned') return isSourceIncluded('local');
        if (pl.origin === 'apple_remote') return isSourceIncluded('apple_music');
        if (pl.origin === 'soundcloud_remote') return isSourceIncluded('soundcloud');
        if (pl.origin === 'archive_remote') return isSourceIncluded('internet_archive');
        if (pl.origin === 'simp_local' && pl.track_count > 0) {
          const matchesLocal = pl.has_local && isSourceIncluded('local');
          const matchesApple = pl.has_apple && isSourceIncluded('apple_music');
          const matchesSc = pl.has_soundcloud && isSourceIncluded('soundcloud');
          const matchesIa = pl.has_archive && isSourceIncluded('internet_archive');
          if (!matchesLocal && !matchesApple && !matchesSc && !matchesIa) {
            return false;
          }
        }
        return true;
      }),
    [playlists, mediaTypeFilter, isSourceIncluded]
  );

  // Playlists matching the active search query (`searchLower`) for the right-pane Unified Search section.
  const searchMatchedPlaylists = useMemo(
    () =>
      !searchLower
        ? []
        : playlists.filter((pl) => {
            if (mediaTypeFilter === 'video') {
              const isVideoPl =
                pl.name.startsWith('🎬') ||
                pl.origin === 'archive_remote' ||
                (pl.origin === 'simp_local' && (pl.has_archive || pl.has_local));
              if (!isVideoPl) return false;
            } else if (mediaTypeFilter === 'audio') {
              if (pl.name.startsWith('🎬')) return false;
            }
            const matchesQuery =
              pl.name.toLowerCase().includes(searchLower) ||
              Boolean(pl.description && pl.description.toLowerCase().includes(searchLower));
            if (!matchesQuery) return false;
            if (pl.origin === 'simp_local') return true;
            if (pl.origin === 'local_pinned') return isSourceIncluded('local');
            if (pl.origin === 'apple_remote') return isSourceIncluded('apple_music');
            if (pl.origin === 'soundcloud_remote') return isSourceIncluded('soundcloud');
            if (pl.origin === 'archive_remote') return isSourceIncluded('internet_archive');
            return true;
          }),
    [playlists, mediaTypeFilter, isSourceIncluded, searchLower]
  );

  const extractAudioFormat = (uri?: string | null): string | null => {
    if (!uri || !uri.startsWith('file://')) return null;
    const m = uri.match(/\.([a-zA-Z0-9]{2,5})(?:$|[?#])/);
    if (!m) return null;
    const ext = m[1].toUpperCase();
    if (
      ext === 'FLAC' ||
      ext === 'MP3' ||
      ext === 'WAV' ||
      ext === 'OGG' ||
      ext === 'OPUS' ||
      ext === 'M4A' ||
      ext === 'AAC' ||
      ext === 'ALAC' ||
      ext === 'AIFF'
    ) {
      return ext;
    }
    return null;
  };

  const cleanCollectionTitle = (raw: string): string =>
    raw.replace(/^[\s📌💾🍎☁️🏛️🎵💿]+/u, '').trim() || raw;

  const formatPlaylistSourceBadge = (pl: PlaylistRecord): string => {
    if (pl.origin === 'local_pinned') {
      return '💾';
    }
    if (pl.origin === 'soundcloud_remote') {
      return '☁️';
    }
    if (pl.origin === 'archive_remote') {
      return '🏛️';
    }
    if (pl.origin !== 'simp_local') {
      return '🍎';
    }
    const parts: string[] = [];
    if (pl.has_local) parts.push('💾');
    if (pl.has_apple) parts.push('🍎');
    if (pl.has_soundcloud) parts.push('☁️');
    if (pl.has_archive) parts.push('🏛️');
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
        (p) =>
          p.origin === 'local_pinned' ||
          p.origin === 'apple_remote' ||
          p.origin === 'soundcloud_remote' ||
          p.origin === 'archive_remote'
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
    browserSourceFilter: 'all' | 'local' | 'apple_music' | 'soundcloud' | 'internet_archive';
    rightPaneMode: 'browse' | 'tracks' | 'artist';
    browserTarget: BrowserTarget | null;
    browserTracks: TrackMetadata[];
    appleSubTab: 'pinned' | 'for_you' | 'cloud_playlists' | 'new' | 'radio';
    soundCloudSubTab: 'pinned' | 'likes_sets' | 'stream_radio' | 'trending';
    iaSubTab: 'pinned' | 'trending' | 'films' | 'tv' | 'audio';
    activeMountRoot: string | null;
    browserSearch: string;
    activeArtistProfile?: typeof activeArtistProfile;
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
        iaSubTab,
        activeMountRoot,
        browserSearch,
        activeArtistProfile,
      };
      const last = prev[prev.length - 1];
      if (
        last &&
        last.browserSourceFilter === next.browserSourceFilter &&
        last.rightPaneMode === next.rightPaneMode &&
        last.appleSubTab === next.appleSubTab &&
        last.soundCloudSubTab === next.soundCloudSubTab &&
        last.iaSubTab === next.iaSubTab &&
        last.activeMountRoot === next.activeMountRoot &&
        last.browserSearch === next.browserSearch &&
        last.activeArtistProfile?.idOrName === next.activeArtistProfile?.idOrName &&
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
    iaSubTab,
    activeMountRoot,
    browserSearch,
    activeArtistProfile,
  ]);

  const handleWalkBack = useCallback(() => {
    if (navHistory.length > 0) {
      const prev = navHistory[navHistory.length - 1];
      setNavHistory((h) => h.slice(0, -1));
      setBrowserSourceFilter(prev.browserSourceFilter);
      setAppleSubTab(prev.appleSubTab);
      setSoundCloudSubTab(prev.soundCloudSubTab);
      setIaSubTab(prev.iaSubTab);
      setActiveMountRoot(prev.activeMountRoot);
      setBrowserSearch(prev.browserSearch);
      setBrowserTarget(prev.browserTarget);
      setBrowserTracks(prev.browserTracks);
      setActiveArtistProfile(prev.activeArtistProfile || null);
      setRightPaneMode(prev.rightPaneMode);
      if (prev.rightPaneMode === 'browse') {
        focusRightPaneFirstTile();
      } else {
        focusRightPaneFirstTrack();
      }
      return;
    }
    if (rightPaneMode === 'tracks' || rightPaneMode === 'artist') {
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
      setIaSubTab('pinned');
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

  // Open a dedicated Artist Profile view in the right pane (`Tracks`, `Albums/Sets`, `Singles/Likes`, `Related/Following`)
  const openArtistProfile = useCallback(
    async (params: {
      source: 'apple_music' | 'soundcloud' | 'local';
      idOrName: string;
      displayName: string;
    }) => {
      pushCurrentNavState();
      setActiveArtistProfile({
        source: params.source,
        idOrName: params.idOrName,
        displayName: params.displayName,
        subTab: 'tracks',
        loading: true,
        appleData: null,
        scData: null,
        localData: null,
      });
      setRightPaneMode('artist');
      focusRightPaneFirstTile();

      try {
        if (params.source === 'soundcloud') {
          const scProfile = await fetchSoundCloudUserTracks(params.idOrName);
          setActiveArtistProfile((prev) =>
            prev && prev.idOrName === params.idOrName
              ? {
                  ...prev,
                  displayName: scProfile.user?.username
                    ? `@${scProfile.user.username}`
                    : prev.displayName,
                  loading: false,
                  scData: scProfile,
                }
              : prev
          );
          if (scProfile.tracks && scProfile.tracks.length > 0) {
            setBrowserTracks(scProfile.tracks);
          }
        } else if (params.source === 'apple_music') {
          const appleProfile = await fetchAppleArtistProfile(params.idOrName);
          setActiveArtistProfile((prev) =>
            prev && prev.idOrName === params.idOrName
              ? {
                  ...prev,
                  displayName: appleProfile.artist?.name || prev.displayName,
                  loading: false,
                  appleData: appleProfile,
                }
              : prev
          );
          if (appleProfile.top_tracks && appleProfile.top_tracks.length > 0) {
            setBrowserTracks(appleProfile.top_tracks);
          }
        } else {
          const cleanName = params.idOrName.replace(/^name:/i, '').trim() || params.displayName;
          const localProfile = await fetchLocalArtistProfile(cleanName);
          setActiveArtistProfile((prev) =>
            prev && prev.idOrName === params.idOrName
              ? {
                  ...prev,
                  displayName: localProfile.name || prev.displayName,
                  loading: false,
                  localData: localProfile,
                }
              : prev
          );
          if (localProfile.tracks && localProfile.tracks.length > 0) {
            setBrowserTracks(localProfile.tracks);
          }
        }
      } catch (err: any) {
        showToast(err?.message || `Could not load artist profile for ${params.displayName}`);
        setActiveArtistProfile((prev) =>
          prev && prev.idOrName === params.idOrName ? { ...prev, loading: false } : prev
        );
      }
    },
    [pushCurrentNavState, focusRightPaneFirstTile, setBrowserTracks, showToast]
  );

  const loadMoreArtistTracks = useCallback(() => {
    const nextHref = activeArtistProfile?.scData?.next_tracks_href;
    if (
      !activeArtistProfile ||
      activeArtistProfile.source !== 'soundcloud' ||
      !nextHref ||
      activeArtistProfile.loadingMore
    ) {
      return;
    }
    setActiveArtistProfile((prev) => (prev ? { ...prev, loadingMore: true } : prev));
    fetchSoundCloudNextPage(nextHref)
      .then((res) => {
        setActiveArtistProfile((prev) => {
          if (!prev || !prev.scData) return prev;
          const seen = new Set(prev.scData.tracks.map((t) => t.uri));
          const added = (res.tracks || []).filter((t) => !seen.has(t.uri));
          const updatedTracks = [...prev.scData.tracks, ...added];
          return {
            ...prev,
            loadingMore: false,
            scData: {
              ...prev.scData,
              tracks: updatedTracks,
              next_tracks_href: res.next_href || null,
            },
          };
        });
      })
      .catch(() => {
        setActiveArtistProfile((prev) => (prev ? { ...prev, loadingMore: false } : prev));
      });
  }, [activeArtistProfile]);

  useEffect(() => {
    const onOpenArtistEvent = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{
          artistName?: string;
          source?: 'apple_music' | 'soundcloud' | 'local';
          artistId?: string;
        }>
      ).detail;
      if (!detail || (!detail.artistName && !detail.artistId)) return;
      const source = detail.source || 'local';
      const idOrName = detail.artistId || `name:${detail.artistName}`;
      const displayName = detail.artistName || detail.artistId || 'Artist';
      openArtistProfile({ source, idOrName, displayName });
    };
    window.addEventListener('simp-open-artist-profile', onOpenArtistEvent);
    return () => window.removeEventListener('simp-open-artist-profile', onOpenArtistEvent);
  }, [openArtistProfile]);

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

  const selectSoundCloudUser = async (user: SoundCloudUserSummary) => {
    await openArtistProfile({
      source: 'soundcloud',
      idOrName: user.id,
      displayName: `@${user.username}`,
    });
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

  const openLocalVideoFile = useCallback(
    (t: TrackMetadata) => {
      const videoUri = t.uri.startsWith('video://local/')
        ? t.uri
        : `video://local/${encodeURIComponent(t.uri)}`;
      const meta: TrackMetadata = {
        ...t,
        uri: videoUri,
        source: 'local_video',
      };
      setPlayingContextId(`local_video:${videoUri}`);
      defaultSimpClient.loadQueue([videoUri], 0, [meta]);
      setView('lock');
    },
    [setPlayingContextId, setView]
  );

  const openIaItem = useCallback(
    async (item: ArchiveItemSummary, watchImmediately = false) => {
      setIaLoading(true);
      try {
        const resp = await fetch(
          resolveDaemonUrl(`/api/ia/item?id=${encodeURIComponent(item.identifier)}`)
        );
        const d = await resp.json();
        const detail: ArchiveItemDetail | undefined = d?.detail || d?.data;
        if (!d?.ok || !detail) {
          showToast('Could not load Internet Archive item metadata');
          return;
        }
        setActiveIaDetail(detail);
        const itemTracks = detail.tracks || [];
        pushCurrentNavState();
        setBrowserTarget({
          kind: 'ia_item',
          id: detail.summary.identifier,
          title: detail.summary.title,
          subtitle: `${detail.summary.creator}${
            detail.summary.year ? ` • ${detail.summary.year}` : ''
          }`,
          art_url: detail.summary.art_url,
        });
        setBrowserTracks(itemTracks);
        setRightPaneMode('tracks');
        focusRightPaneFirstTrack();

        if (watchImmediately && itemTracks.length > 0) {
          setPlayingContextId(`ia_item:${detail.summary.identifier}`);
          defaultSimpClient.loadQueue(
            itemTracks.map((t) => t.uri),
            0,
            itemTracks
          );
          setView('lock');
        }
      } catch {
        showToast('Failed to fetch Internet Archive item');
      } finally {
        setIaLoading(false);
      }
    },
    [
      resolveDaemonUrl,
      pushCurrentNavState,
      setBrowserTarget,
      setBrowserTracks,
      focusRightPaneFirstTrack,
      setPlayingContextId,
      setView,
      showToast,
    ]
  );

  const handlePinArchiveItem = useCallback(
    async (item: ArchiveItemSummary, preloadedTracks?: TrackMetadata[]) => {
      setIaLoading(true);
      try {
        let tracksToPin = preloadedTracks;
        if (!tracksToPin || tracksToPin.length === 0) {
          const resp = await fetch(
            resolveDaemonUrl(`/api/ia/item?id=${encodeURIComponent(item.identifier)}`)
          );
          const d = await resp.json();
          const detail: ArchiveItemDetail | undefined = d?.detail || d?.data;
          tracksToPin = detail?.tracks || [];
        }
        if (!tracksToPin || tracksToPin.length === 0) {
          showToast('No playable video or audio streams found in this item');
          return;
        }
        const pinId = `archive:item:${item.identifier}`;
        const isVideo = item.mediatype === 'movies' || tracksToPin.some((t) => t.source === 'ia_video');
        const record: PlaylistRecord = {
          id: pinId,
          name: `${isVideo ? '🎬' : '🏛️'} ${item.title}`,
          description: `${item.creator}${item.year ? ` • ${item.year}` : ''}`,
          origin: 'archive_remote',
          cover_art_url: item.art_url || tracksToPin[0]?.art_url || null,
          track_count: tracksToPin.length,
          updated_at: Math.floor(Date.now() / 1000),
          has_local: false,
          has_apple: false,
          has_soundcloud: false,
          has_archive: true,
        };
        defaultSimpClient.importCatalogTracks({
          source: 'internet_archive',
          playlist: record,
          tracks: tracksToPin,
        });
        showToast(
          `Pinned "${item.title}" (${tracksToPin.length} ${
            tracksToPin.length === 1 ? 'item' : 'items'
          }) to SIMP`
        );
      } catch {
        showToast('Could not pin Internet Archive item');
      } finally {
        setIaLoading(false);
      }
    },
    [resolveDaemonUrl, showToast]
  );

  const handlePinArchiveCollection = useCallback(
    async (collectionKey: string, collectionLabel: string, items: ArchiveItemSummary[]) => {
      if (items.length === 0) return;
      setIaLoading(true);
      try {
        const tracksToPin: TrackMetadata[] = [];
        for (let idx = 0; idx < items.length; idx++) {
          const it = items[idx];
          if (it.mediatype === 'movies') {
            tracksToPin.push({
              uri: `ia:video:${encodeURIComponent(it.identifier)}/0`,
              title: it.title,
              artists: [it.creator || 'Internet Archive'],
              album: collectionLabel,
              album_id: `ia:${it.identifier}`,
              track_number: idx + 1,
              disc_number: 1,
              art_url: it.art_url,
              duration_ms: 0,
              source: 'ia_video',
            });
          } else {
            // For audio items in a collection, fetch the first playable track (or full item tracks if few)
            try {
              const resp = await fetch(
                resolveDaemonUrl(`/api/ia/item?id=${encodeURIComponent(it.identifier)}`)
              );
              const d = await resp.json();
              const detail: ArchiveItemDetail | undefined = d?.detail || d?.data;
              if (detail?.tracks && detail.tracks.length > 0) {
                tracksToPin.push(...detail.tracks.slice(0, 3));
              }
            } catch {}
          }
        }
        if (tracksToPin.length === 0) {
          showToast('Could not resolve playable items for this Archive collection');
          return;
        }
        const pinId = `archive:collection:${collectionKey}`;
        const record: PlaylistRecord = {
          id: pinId,
          name: `🏛️ ${collectionLabel}`,
          description: `Pinned Internet Archive Collection (${tracksToPin.length} items)`,
          origin: 'archive_remote',
          cover_art_url: items[0]?.art_url || tracksToPin[0]?.art_url || null,
          track_count: tracksToPin.length,
          updated_at: Math.floor(Date.now() / 1000),
          has_local: false,
          has_apple: false,
          has_soundcloud: false,
          has_archive: true,
        };
        defaultSimpClient.importCatalogTracks({
          source: 'internet_archive',
          playlist: record,
          tracks: tracksToPin,
        });
        showToast(`Pinned collection "${collectionLabel}" (${tracksToPin.length} items) to SIMP`);
      } catch {
        showToast('Could not pin Internet Archive collection');
      } finally {
        setIaLoading(false);
      }
    },
    [resolveDaemonUrl, showToast]
  );

  const handleAddArchiveItemToHybrid = useCallback(
    async (item: ArchiveItemSummary) => {
      setIaLoading(true);
      try {
        const resp = await fetch(
          resolveDaemonUrl(`/api/ia/item?id=${encodeURIComponent(item.identifier)}`)
        );
        const d = await resp.json();
        const detail: ArchiveItemDetail | undefined = d?.detail || d?.data;
        const tracks: TrackMetadata[] = detail?.tracks || [];
        if (tracks.length > 0) {
          await handleAddTracksToPlaylist(
            tracks.map((t) => t.uri),
            `${tracks.length === 1 ? `"${tracks[0].title}"` : `all ${tracks.length} items from "${item.title}"`}`,
            tracks
          );
        } else {
          showToast('No playable video or audio streams found in this item');
        }
      } catch {
        showToast('Could not add Internet Archive item');
      } finally {
        setIaLoading(false);
      }
    },
    [resolveDaemonUrl, handleAddTracksToPlaylist, showToast]
  );

  const activeHubLabel = browserSearch.trim()
    ? 'Search Results'
    : activeMountPlaceObj
    ? `💾 ${activeMountPlaceObj.label}`
    : browserSourceFilter === 'local'
    ? 'Local SIMP Library'
    : browserSourceFilter === 'internet_archive'
    ? iaSubTab === 'trending'
      ? 'Internet Archive Trending'
      : iaSubTab === 'films'
      ? 'Films & Cinema'
      : iaSubTab === 'tv'
      ? 'TV & Animation'
      : iaSubTab === 'audio'
      ? 'Live Concerts & Audio'
      : 'SIMP Library (Archive)'
    : browserSourceFilter === 'soundcloud'
    ? soundCloudSubTab === 'likes_sets'
      ? 'SoundCloud Likes & Sets'
      : soundCloudSubTab === 'stream_radio'
      ? 'SoundCloud Stream & Radio'
      : soundCloudSubTab === 'trending'
      ? 'SoundCloud Trending & Mixes'
      : 'SIMP Library (SoundCloud)'
    : appleSubTab === 'for_you'
    ? 'For You'
    : appleSubTab === 'cloud_playlists'
    ? 'Apple Playlists'
    : appleSubTab === 'new'
    ? 'New & Charts'
    : appleSubTab === 'radio'
    ? 'Radio'
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

  const handleTogglePinLocalAlbum = useCallback(
    async (alb: AlbumRecord, preloadedTracks?: TrackMetadata[]) => {
      const pinId = `local:album:${alb.id}`;
      const cleanTitle = cleanCollectionTitle(alb.title);
      const isAlreadyPinned = playlists.some((p) => p.id === pinId);
      if (isAlreadyPinned) {
        handleDeletePlaylist(pinId, cleanTitle);
        return;
      }
      try {
        let items = preloadedTracks;
        if (!items || items.length === 0) {
          items = await defaultSimpClient.query<TrackMetadata[]>('get_album_tracks', {
            album_id: alb.id,
          });
        }
        if (!items || items.length === 0) {
          showToast('No tracks found for this local album');
          return;
        }
        const record: PlaylistRecord = {
          id: pinId,
          name: `💾 ${cleanTitle}`,
          description: alb.album_artist,
          origin: 'local_pinned',
          cover_art_url: alb.art_url || items[0]?.art_url || null,
          track_count: items.length,
          updated_at: Math.floor(Date.now() / 1000),
          has_local: true,
          has_apple: false,
          has_soundcloud: false,
          has_archive: false,
        };
        defaultSimpClient.importCatalogTracks({
          source: 'local',
          playlist: record,
          tracks: items,
        });
        showToast(
          `Pinned "${cleanTitle}" (${items.length} ${
            items.length === 1 ? 'track' : 'tracks'
          }) to SIMP Library`
        );
      } catch {
        showToast('Could not pin local album to SIMP Library');
      }
    },
    [playlists, handleDeletePlaylist, showToast]
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
        let items = await fetchSoundCloudPlaylistTracks(pl.id).catch(() => []);
        if (items.length === 0 && pl.tracks && pl.tracks.length > 0) {
          items = pl.tracks;
        }
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
      browserTarget?.kind === 'soundcloud_playlist' &&
      activeScPlaylist &&
      playlists.some((p) => p.id === `soundcloud:playlist:${activeScPlaylist.id}`);

    const isCloudAlbumPinned =
      rightPaneMode === 'tracks' &&
      browserTarget?.kind === 'cloud_album' &&
      activeCloudAlbum &&
      albums.some((a) => a.id === `applemusic:album:${activeCloudAlbum.id}`);

    const isArchiveItemPinned =
      rightPaneMode === 'tracks' &&
      browserTarget?.kind === 'ia_item' &&
      activeIaDetail &&
      playlists.some((p) => p.id === `archive:item:${activeIaDetail.summary.identifier}`);

    const isLocalAlbumPinned =
      rightPaneMode === 'tracks' &&
      browserTarget?.kind === 'album' &&
      selectedAlbumObj &&
      !selectedAlbumObj.id.startsWith('applemusic:album:') &&
      playlists.some((p) => p.id === `local:album:${selectedAlbumObj.id}`);

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

    if (rightPaneMode === 'artist') {
      return null;
    }

    const canAddAllTracks =
      browserTarget &&
      (browserTarget.kind === 'album' ||
        browserTarget.kind === 'mount' ||
        browserTarget.kind === 'cloud_album' ||
        browserTarget.kind === 'cloud_playlist' ||
        browserTarget.kind === 'soundcloud_playlist' ||
        browserTarget.kind === 'soundcloud_user' ||
        browserTarget.kind === 'ia_item' ||
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

              {browserTarget.kind === 'soundcloud_playlist' && activeScPlaylist && (
                <button
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

              {browserTarget.kind === 'ia_item' && activeIaDetail && browserTracks.length > 0 && (
                <button
                  data-collection-y="true"
                  onClick={() => {
                    if (isArchiveItemPinned) {
                      handleDeletePlaylist(
                        `archive:item:${activeIaDetail.summary.identifier}`,
                        activeIaDetail.summary.title
                      );
                    } else {
                      handlePinArchiveItem(activeIaDetail.summary, browserTracks);
                    }
                  }}
                  title="Pin or Unpin this Internet Archive audio collection in SIMP"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '3px 9px',
                    borderRadius: 6,
                    background: isArchiveItemPinned ? '#0f222a' : '#261a0b',
                    border: isArchiveItemPinned ? '1px solid #2aa3c4' : '1px solid #d97706',
                    color: isArchiveItemPinned ? '#67e8f9' : '#fde68a',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {gpYBadge}
                  <span>{isArchiveItemPinned ? '✓ Pinned (Unpin)' : '📌 Pin to SIMP'}</span>
                </button>
              )}

              {browserTarget.kind === 'playlist' && selectedPlaylistObj && (
                <button
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

              {browserTarget.kind === 'album' &&
                selectedAlbumObj &&
                !selectedAlbumObj.id.startsWith('applemusic:album:') && (
                  <button
                    data-collection-y="true"
                    onClick={() => {
                      handleTogglePinLocalAlbum(selectedAlbumObj, browserTracks);
                    }}
                    title="Pin or Unpin this local album in SIMP Library"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '3px 9px',
                      borderRadius: 6,
                      background: isLocalAlbumPinned ? '#0f222a' : '#121820',
                      border: isLocalAlbumPinned ? '1px solid #2aa3c4' : '1px solid #283848',
                      color: isLocalAlbumPinned ? '#67e8f9' : '#bfeaf5',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {gpYBadge}
                    <span>{isLocalAlbumPinned ? '✓ Pinned (Unpin)' : '📌 Pin Album to SIMP'}</span>
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
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 4,
              flexShrink: 0,
              minWidth: 0,
            }}
          >
            <span
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: isLocal ? '#0f222a' : '#251018',
                border: isLocal ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
                color: isLocal ? '#67e8f9' : '#fda4af',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              {isActiveTarget ? `★ ${sourceBadge}` : sourceBadge}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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

  // Reusable Visual Tile for Local & Pinned Albums (in `📌 My SIMP Library` and `💾 Local`)
  const renderSimpAlbumCard = (alb: AlbumRecord) => {
    const isAppleAlbum = alb.id.startsWith('applemusic:album:');
    const isLocalPinned =
      !isAppleAlbum && playlists.some((p) => p.id === `local:album:${alb.id}`);
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
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 4,
              flexShrink: 0,
              minWidth: 0,
            }}
          >
            <span
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: isAppleAlbum ? '#251018' : '#0f222a',
                border: isAppleAlbum ? '1px solid #4c1d2e' : '1px solid #2aa3c4',
                color: isAppleAlbum ? '#fda4af' : '#67e8f9',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              {isAppleAlbum
                ? '🍎'
                : (() => {
                    const fmtMatch = alb.album_artist.match(/•\s*(FLAC(?:\s*\+\s*MP3)?|MP3|WAV|OGG|OPUS|M4A|AAC|ALAC|AIFF)$/i);
                    return fmtMatch ? `💾 ${fmtMatch[1].toUpperCase()}` : '💾';
                  })()}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
              {isAppleAlbum ? (
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
              ) : (
                <span
                  role="button"
                  data-tile-aux="true"
                  data-tile-y="true"
                  title={
                    isLocalPinned
                      ? 'Unpin Local Album from SIMP Library (Y)'
                      : 'Pin Local Album to SIMP Library (Y)'
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTogglePinLocalAlbum(alb);
                  }}
                  style={{
                    padding: '2px 6px',
                    borderRadius: 6,
                    background: isLocalPinned ? '#0f222a' : '#121820',
                    border: isLocalPinned ? '1px solid #2aa3c4' : '1px solid #283848',
                    color: isLocalPinned ? '#67e8f9' : '#bfeaf5',
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {isLocalPinned ? '✓' : '📌'}
                </span>
              )}
            </div>
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
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 4,
              flexShrink: 0,
              minWidth: 0,
            }}
          >
            <span
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#251018',
                border: '1px solid #4c1d2e',
                color: '#fda4af',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              🍎
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {pl.kind !== 'library' && handleAddAppleToCloudLibrary && (
                <span
                  role="button"
                  data-tile-aux="true"
                  title="Add Playlist to your Apple Music Cloud Library"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddAppleToCloudLibrary(pl.id, 'playlists', pl.name);
                  }}
                  style={{
                    padding: '2px 5px',
                    borderRadius: 6,
                    background: '#251018',
                    border: '1px solid #fa243c',
                    color: '#fecdd3',
                    fontSize: 9,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  ☁️+
                </span>
              )}
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
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 4,
              flexShrink: 0,
              minWidth: 0,
            }}
          >
            <span
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#251018',
                border: '1px solid #4c1d2e',
                color: '#fda4af',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              🍎
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {alb.kind !== 'library' && handleAddAppleToCloudLibrary && (
                <span
                  role="button"
                  data-tile-aux="true"
                  title="Add Album to your Apple Music Cloud Library"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddAppleToCloudLibrary(alb.id, 'albums', alb.title);
                  }}
                  style={{
                    padding: '2px 5px',
                    borderRadius: 6,
                    background: '#251018',
                    border: '1px solid #fa243c',
                    color: '#fecdd3',
                    fontSize: 9,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  ☁️+
                </span>
              )}
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
    const isSelected = browserTarget?.kind === 'soundcloud_playlist' && browserTarget.id === pl.id;
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
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 4,
              flexShrink: 0,
              minWidth: 0,
            }}
          >
            <span
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#2c140a',
                border: '1px solid #7c2d12',
                color: '#fdba74',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              ☁️
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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

  // Reusable Visual Tile for Followed SoundCloud Creators / DJs (`GET /me/followings`)
  const renderSoundCloudUserCard = (user: SoundCloudUserSummary) => {
    const isSelected = browserTarget?.kind === 'soundcloud_user' && browserTarget.id === user.id;
    return (
      <button
        key={user.id}
        data-right-tile="true"
        onClick={() => selectSoundCloudUser(user)}
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
            src={user.avatar_url}
            fallbackIcon="👤"
            bg="#23120b"
            border="1px solid #7c2d12"
          />
          <span
            style={{
              padding: '2px 6px',
              borderRadius: 6,
              background: '#2c140a',
              border: '1px solid #7c2d12',
              color: '#fdba74',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            👥 {user.track_count} Trk
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
            @{user.username}
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
            {user.description || `${user.track_count} tracks`}
          </div>
        </div>
      </button>
    );
  };

  // Reusable Visual Tile for Apple Music Catalog Artists (`AppleArtistSummary`)
  const renderAppleArtistCard = (artist: AppleArtistSummary) => {
    const isSelected =
      rightPaneMode === 'artist' &&
      activeArtistProfile?.source === 'apple_music' &&
      activeArtistProfile?.idOrName === artist.id;
    return (
      <button
        key={artist.id}
        data-right-tile="true"
        onClick={() =>
          openArtistProfile({
            source: 'apple_music',
            idOrName: artist.id,
            displayName: artist.name,
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
            src={artist.art_url}
            fallbackIcon="🎤"
            bg="#221118"
            border="1px solid #4c1d2e"
          />
          <span
            style={{
              padding: '2px 6px',
              borderRadius: 6,
              background: '#251018',
              border: '1px solid #4c1d2e',
              color: '#fda4af',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            🍎 Artist
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
            {artist.name}
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
            {artist.genre || 'Apple Music Artist'}
          </div>
        </div>
      </button>
    );
  };

  // Reusable Visual Tile for Local Library Artists
  const renderLocalArtistCard = (
    artistName: string,
    artUrl?: string | null,
    subtitle?: string
  ) => {
    const isSelected =
      rightPaneMode === 'artist' &&
      activeArtistProfile?.source === 'local' &&
      activeArtistProfile?.displayName.toLowerCase() === artistName.toLowerCase();
    return (
      <button
        key={`local-artist-${artistName}`}
        data-right-tile="true"
        onClick={() =>
          openArtistProfile({
            source: 'local',
            idOrName: `name:${artistName}`,
            displayName: artistName,
          })
        }
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
            src={artUrl}
            fallbackIcon="🎤"
            bg="#0f222a"
            border="1px solid #2aa3c4"
          />
          <span
            style={{
              padding: '2px 6px',
              borderRadius: 6,
              background: '#0f222a',
              border: '1px solid #2aa3c4',
              color: '#67e8f9',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            💾 Artist
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
            {artistName}
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
            {subtitle || 'Local Library Artist'}
          </div>
        </div>
      </button>
    );
  };

  // Reusable Visual Tile for Internet Archive Films, TV, Concerts & Audio
  const renderArchiveItemCard = (item: ArchiveItemSummary) => {
    const isVideo = item.mediatype === 'movies';
    const isSelected = browserTarget?.kind === 'ia_item' && browserTarget.id === item.identifier;
    const isPinned = playlists.some((p) => p.id === `archive:item:${item.identifier}`);
    const count =
      item.item_count ??
      iaResolvedCounts[item.identifier] ??
      iaItemCountCache.get(item.identifier);
    const badgeLabel =
      count !== undefined && count > 0
        ? isVideo
          ? count === 1
            ? '🎬 1 Film'
            : `🎬 ${count} Ep`
          : count === 1
          ? '🎵 1 Audio'
          : `🎵 ${count} Trk`
        : isVideo
        ? '🎬 VIDEO'
        : '🎵 AUDIO';
    return (
      <button
        key={item.identifier}
        data-right-tile="true"
        onClick={() => openIaItem(item, false)}
        style={{
          minWidth: 0,
          minHeight: 124,
          padding: 10,
          borderRadius: 12,
          background: isSelected ? '#261a0b' : '#0a0a0e',
          border: isSelected ? '1px solid #f59e0b' : '1px solid #181822',
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
            src={item.art_url}
            fallbackIcon={isVideo ? '🎬' : '🏛️'}
            bg="#1f160b"
            border="1px solid #78350f"
          />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 4,
              flexShrink: 0,
              minWidth: 0,
            }}
          >
            <span
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#261a0b',
                border: '1px solid #78350f',
                color: '#fde68a',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                whiteSpace: 'nowrap',
              }}
            >
              {badgeLabel}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                role="button"
                data-tile-aux="true"
                data-tile-select="true"
                title="Add to active ★ SIMP Hybrid Playlist (SELECT)"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddArchiveItemToHybrid(item);
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
                title={isPinned ? 'Unpin from SIMP (Y)' : 'Pin to SIMP (Y)'}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isPinned) {
                    handleDeletePlaylist(`archive:item:${item.identifier}`, item.title);
                  } else {
                    handlePinArchiveItem(item);
                  }
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: 6,
                  background: isPinned ? '#0f222a' : '#261a0b',
                  border: isPinned ? '1px solid #2aa3c4' : '1px solid #78350f',
                  color: isPinned ? '#67e8f9' : '#fde68a',
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
            {item.title}
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
            {item.creator}
            {item.year ? ` • ${item.year}` : ''}
          </div>
        </div>
      </button>
    );
  };

  // Reusable Row/Card for Individual Songs / Singles / DJ Mixes (Direct Play + Add to Hybrid Playlist + Open Full Album / Start Track Radio / Artist Profile / Favorite / Cloud Library)
  const renderSingleSongRow = (s: TrackMetadata, peerList: TrackMetadata[], ctxPrefix: string) => {
    const isLongMix = s.source === 'soundcloud' && s.duration_ms >= 20 * 60 * 1000;
    const isScPreview =
      s.source === 'soundcloud' &&
      Boolean(s.album?.includes('• Preview') || s.title.toLowerCase().includes('[preview]'));
    const isFavorited =
      favoritedUris.includes(s.uri) ||
      ctxPrefix === 'sc_likes' ||
      scLikedTracks.some((lt) => lt.uri === s.uri);
    const durMin = Math.floor(s.duration_ms / 60000);
    const durSec = Math.floor((s.duration_ms / 1000) % 60);
    const primaryArtist = s.artists?.[0]?.trim();
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
            if (s.source === 'local_video' || s.uri.startsWith('video://local/')) {
              openLocalVideoFile(s);
              return;
            }
            if (isScPreview) {
              showToast('30s Preview — Sign in to SoundCloud in Accounts for full track playback');
            }
            const rowCtxKey = `${ctxPrefix}:${s.uri}`;
            const idx = Math.max(0, peerList.findIndex((tr) => tr.uri === s.uri));
            const queueAlreadyMatches =
              snap?.queue &&
              snap.queue.length === peerList.length &&
              snap.queue_index === idx &&
              snap.queue[idx]?.uri === s.uri;
            setPlayingContextId(rowCtxKey);
            if (track?.uri === s.uri && queueAlreadyMatches) {
              if (!snap?.is_playing) {
                defaultSimpClient.play();
              }
              setView('lock');
            } else {
              defaultSimpClient.loadQueue(
                peerList.map((tr) => tr.uri),
                idx,
                peerList
              );
              setView('lock');
            }
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
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>▶ {s.title}</span>
              {isScPreview && (
                <span
                  style={{
                    fontSize: 9,
                    fontFamily: 'monospace',
                    fontWeight: 800,
                    padding: '1px 5px',
                    borderRadius: 4,
                    background: '#3c2208',
                    border: '1px solid #d97706',
                    color: '#fcd34d',
                    flexShrink: 0,
                  }}
                >
                  30s PREVIEW
                </span>
              )}
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
              {(() => {
                const fmt = extractAudioFormat(s.uri);
                return fmt ? ` • ${fmt}` : '';
              })()}
            </div>
          </div>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
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
          {primaryArtist &&
            s.source !== 'local_video' &&
            s.source !== 'ia_video' &&
            s.source !== 'dvd' && (
              <button
                data-row-aux="true"
                onClick={() =>
                  openArtistProfile({
                    source:
                      s.source === 'apple_music'
                        ? 'apple_music'
                        : s.source === 'soundcloud'
                        ? 'soundcloud'
                        : 'local',
                    idOrName: `name:${primaryArtist}`,
                    displayName: primaryArtist,
                  })
                }
                title={`Open Artist Profile for ${primaryArtist}`}
                style={{
                  padding: '5px 7px',
                  borderRadius: 8,
                  background: '#14141e',
                  border: '1px solid #282838',
                  color: '#c4b5fd',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                🎤
              </button>
            )}
          {handleFavoriteTrack &&
            s.source !== 'local_video' &&
            s.source !== 'ia_video' &&
            s.source !== 'dvd' && (
              <button
                data-row-aux="true"
                onClick={() => handleFavoriteTrack(s)}
                title={isFavorited ? 'Remove from Favorites' : 'Favorite this track'}
                style={{
                  padding: '5px 8px',
                  borderRadius: 8,
                  background: isFavorited ? '#28111b' : '#14141e',
                  border: isFavorited ? '1px solid #fa243c' : '1px solid #282838',
                  color: isFavorited ? '#fda4af' : '#9ca3af',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {isFavorited ? '❤️' : '♡'}
              </button>
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
          ) : s.source === 'apple_music' ? (
            <>
              {handleAddAppleToCloudLibrary && (
                <button
                  data-row-aux="true"
                  onClick={() => handleAddAppleToCloudLibrary(s.uri, 'songs', s.title)}
                  title="Add song to your Apple Music Cloud Library"
                  style={{
                    padding: '5px 7px',
                    borderRadius: 8,
                    background: '#251018',
                    border: '1px solid #4c1d2e',
                    color: '#fecdd3',
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  ☁️+
                </button>
              )}
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
            </>
          ) : null}
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
                : browserSourceFilter === 'internet_archive'
                ? '🔍 Search Internet Archive Films, TV & Audio...'
                : '🔍 Search SIMP Library, Apple Music, SoundCloud & Archive...'
            }
            value={browserSearch}
            onChange={(e) => setBrowserSearch(e.target.value)}
            onClick={(e) => {
              if (e.detail === 0 || document.documentElement.dataset.simpInput === 'gamepad') {
                setOskTarget('search');
                if (window.parent && window.parent !== window) {
                  window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                }
              }
            }}
            style={{
              width: '100%',
              minHeight: 36,
              padding: browserSearch ? '0 58px 0 12px' : '0 34px 0 12px',
              borderRadius: 8,
              background: '#08080c',
              border: browserSearch ? '1px solid #2aa3c4' : '1px solid #242430',
              color: '#d4d4dc',
              fontSize: 12,
              boxSizing: 'border-box',
            }}
          />
          <button
            data-row-aux="true"
            onClick={() => {
              setOskTarget((prev) => (prev === 'search' ? null : 'search'));
              if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
              }
            }}
            title="Toggle On-Screen Keyboard"
            style={{
              position: 'absolute',
              right: browserSearch ? 32 : 6,
              width: 24,
              height: 24,
              borderRadius: 6,
              background: '#12121a',
              border: '1px solid #242432',
              color: '#9ca3af',
              fontSize: 11,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ⌨
          </button>
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

        {/* Row 2: Top-Level Multi-Select Source Filter Bar (`[ 🌐 All | 💾 Local | 🍎 Apple | ☁️ SC | 🏛️ Archive ]`)
            🌐 All resets to all sources; clicking individual pills toggles them into a custom multi-source mix. */}
        {(() => {
          const sourceTabs = [
            { id: 'all' as const, label: '🌐 All', accent: 'teal' as const },
            { id: 'local' as const, label: '💾 Local', accent: 'teal' as const },
            ...(sourceVisibility.apple_music &&
            (snap?.apple_authenticated || appleAuthState === 'reauth_required')
              ? [
                  {
                    id: 'apple_music' as const,
                    label: appleAuthState === 'reauth_required' ? '🍎 Apple⚠️' : '🍎 Apple',
                    accent: 'apple' as const,
                  },
                ]
              : []),
            ...(sourceVisibility.soundcloud && snap?.soundcloud_authenticated
              ? [
                  {
                    id: 'soundcloud' as const,
                    label: '☁️ SC',
                    accent: 'soundcloud' as const,
                  },
                ]
              : []),
            ...(sourceVisibility.internet_archive && snap?.internet_archive_authenticated
              ? [
                  {
                    id: 'internet_archive' as const,
                    label: '🏛️ Archive',
                    accent: 'archive' as const,
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
                const active =
                  tab.id === 'all'
                    ? selectedSources.length === 0 && browserSourceFilter === 'all'
                    : selectedSources.length > 0
                    ? selectedSources.includes(tab.id)
                    : browserSourceFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      pushCurrentNavState();
                      if (tab.id === 'all') {
                        setSelectedSources([]);
                        setBrowserSourceFilterRaw('all');
                        setAppleSubTab('pinned');
                        setSoundCloudSubTab('pinned');
                        setIaSubTab('pinned');
                        setRightPaneMode('browse');
                        return;
                      }
                      const currentSet =
                        selectedSources.length > 0
                          ? selectedSources
                          : browserSourceFilter !== 'all'
                          ? [browserSourceFilter]
                          : [];
                      const exists = currentSet.includes(tab.id);
                      const nextSet = exists
                        ? currentSet.filter((s) => s !== tab.id)
                        : [...currentSet, tab.id];

                      setSelectedSources(nextSet);
                      if (nextSet.length === 0) {
                        setBrowserSourceFilterRaw('all');
                        setAppleSubTab('pinned');
                        setSoundCloudSubTab('pinned');
                        setIaSubTab('pinned');
                        setRightPaneMode('browse');
                      } else if (nextSet.length === 1) {
                        const single = nextSet[0];
                        setBrowserSourceFilterRaw(single);
                        if (single === 'local') {
                          setAppleSubTab('pinned');
                          setSoundCloudSubTab('pinned');
                          setIaSubTab('pinned');
                          setRightPaneMode('browse');
                        } else if (single === 'soundcloud') {
                          setActiveMountRoot(null);
                          if (soundCloudSubTab === 'pinned') {
                            setSoundCloudSubTab('trending');
                          }
                          setRightPaneMode('browse');
                        } else if (single === 'apple_music') {
                          setActiveMountRoot(null);
                          if (appleSubTab === 'pinned') {
                            setAppleSubTab('for_you');
                          }
                          setRightPaneMode('browse');
                        } else if (single === 'internet_archive') {
                          setActiveMountRoot(null);
                          if (iaSubTab === 'pinned') {
                            setIaSubTab('trending');
                            setIaSubFilter('all');
                          }
                          setRightPaneMode('browse');
                        }
                      } else {
                        // Multi-source mix (e.g. Local + Internet Archive): show unified SIMP Library / Search filtered to those sources
                        setBrowserSourceFilterRaw('all');
                        setActiveMountRoot(null);
                        setAppleSubTab('pinned');
                        setSoundCloudSubTab('pinned');
                        setIaSubTab('pinned');
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
                          : tab.accent === 'archive'
                          ? '#261a0b'
                          : '#0f222a'
                        : '#0a0a0e',
                      border: active
                        ? tab.accent === 'apple'
                          ? '1px solid #fa243c'
                          : tab.accent === 'soundcloud'
                          ? '1px solid #ea580c'
                          : tab.accent === 'archive'
                          ? '1px solid #f59e0b'
                          : '1px solid #2aa3c4'
                        : '1px solid #1e1e26',
                      color: active
                        ? tab.accent === 'apple'
                          ? '#fecdd3'
                          : tab.accent === 'soundcloud'
                          ? '#fdba74'
                          : tab.accent === 'archive'
                          ? '#fde68a'
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

        {/* Row 2b: Media Type Filter Strip (`[ All Media | 🎬 Video | 🎵 Audio ]`) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 5,
          }}
        >
          {(
            [
              { id: 'all' as const, label: 'All Media' },
              { id: 'video' as const, label: '🎬 Video' },
              { id: 'audio' as const, label: '🎵 Audio' },
            ] as const
          ).map((m) => {
            const active = mediaTypeFilter === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMediaTypeFilter(m.id)}
                style={{
                  minHeight: 28,
                  padding: '0 6px',
                  borderRadius: 7,
                  background: active ? '#11222c' : '#09090d',
                  border: active ? '1px solid #2aa3c4' : '1px solid #1a1a24',
                  color: active ? '#bfeaf5' : '#8e8e99',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

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
            {browserSourceFilter === 'internet_archive' ? (
              (
                [
                  {
                    id: 'pinned' as const,
                    label: `SIMP Library (${filteredPlaylists.length})`,
                    isSimp: true,
                    defaultSub: 'all',
                  },
                  {
                    id: 'trending' as const,
                    label: 'Trending',
                    isSimp: false,
                    defaultSub: 'all',
                  },
                  {
                    id: 'films' as const,
                    label: 'Films & Cinema',
                    isSimp: false,
                    defaultSub: 'all',
                  },
                  {
                    id: 'tv' as const,
                    label: 'TV & Animation',
                    isSimp: false,
                    defaultSub: 'all',
                  },
                  {
                    id: 'audio' as const,
                    label: 'Concerts & Audio',
                    isSimp: false,
                    defaultSub: 'all',
                  },
                ] as const
              ).map((hub) => {
                const active =
                  !activeMountRoot && iaSubTab === hub.id && rightPaneMode === 'browse';
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
                          iaSubTab !== hub.id ||
                          rightPaneMode !== 'browse')
                      ) {
                        pushCurrentNavState();
                      }
                      setActiveMountRoot(null);
                      setIaSubTab(hub.id);
                      setIaSubFilter(hub.defaultSub);
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
                          : '#261a0b'
                        : '#0a0a0e',
                      border: active
                        ? hub.isSimp
                          ? '1px solid #2aa3c4'
                          : '1px solid #f59e0b'
                        : '1px solid #181820',
                      color: active
                        ? hub.isSimp
                          ? '#bfeaf5'
                          : '#fde68a'
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
                        color: active ? (hub.isSimp ? '#2aa3c4' : '#fde68a') : '#71717a',
                      }}
                    >
                      ⊞
                    </span>
                  </button>
                );
              })
            ) : browserSourceFilter === 'soundcloud' ? (
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
                      label: `📌 SIMP Library (${filteredPlaylists.length + pinnedAppleAlbumCount})`,
                      isSimp: true,
                    },
                    { id: 'for_you' as const, label: '✨ For You', isSimp: false },
                    {
                      id: 'cloud_playlists' as const,
                      label: `☁️ Apple Playlists${
                        cloudPlaylists.length ? ` (${cloudPlaylists.length})` : ''
                      }`,
                      isSimp: false,
                    },
                    { id: 'new' as const, label: '🔥 New & Charts', isSimp: false },
                    { id: 'radio' as const, label: '📻 Radio', isSimp: false },
                  ]
                : [
                    {
                      id: 'pinned' as const,
                      label:
                        browserSourceFilter === 'local'
                          ? `💾 All Local Albums (${filteredAlbums.length})`
                          : `📌 My SIMP Library (${filteredPlaylists.length + pinnedAppleAlbumCount})`,
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

            {/* Unified Service Drill-Right Places in `🌐 All` / multi-source mode (only when authenticated & visible) */}
            {browserSourceFilter === 'all' &&
              isSourceIncluded('apple_music') &&
              snap?.apple_authenticated && (
              <button
                data-xmb-drill-right="true"
                onClick={() => {
                  pushCurrentNavState();
                  setActiveMountRoot(null);
                  setBrowserSourceFilter('apple_music');
                  setAppleSubTab('for_you');
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

            {browserSourceFilter === 'all' &&
              isSourceIncluded('soundcloud') &&
              snap?.soundcloud_authenticated && (
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

            {browserSourceFilter === 'all' &&
              isSourceIncluded('internet_archive') &&
              snap?.internet_archive_authenticated && (
              <button
                data-xmb-drill-right="true"
                onClick={() => {
                  pushCurrentNavState();
                  setActiveMountRoot(null);
                  setBrowserSourceFilter('internet_archive');
                  setIaSubTab('trending');
                  setIaSubFilter('all');
                  setRightPaneMode('browse');
                  focusRightPaneFirstTile();
                }}
                style={{
                  minHeight: 34,
                  padding: '0 10px',
                  borderRadius: 8,
                  background: '#0a0a0e',
                  border: '1px solid #181820',
                  color: '#fde68a',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>🏛️ Internet Archive</span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#fde68a' }}>▸</span>
              </button>
            )}

            {/* Local Places (shown when Local is included) */}
            {isSourceIncluded('local') &&
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

            {/* Loaded Audio CD or DVD-Video (`cdda://` or `dvd://`) — only shown when Optical Drive is enabled and Local is included */}
            {sourceVisibility.optical_drive && isSourceIncluded('local') && (
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
              onClick={(e) => {
                if (e.detail === 0 || document.documentElement.dataset.simpInput === 'gamepad') {
                  setOskTarget('playlist');
                  if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                  }
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
                }${pl.has_archive ? '🏛️' : ''}`
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
                    : pl.origin === 'local_pinned'
                    ? `💾 ${cleanTitle}`
                    : pl.origin === 'soundcloud_remote'
                    ? `☁️ ${cleanTitle}`
                    : pl.origin === 'archive_remote'
                    ? `🏛️ ${cleanTitle}`
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
          RIGHT COLUMN (68%): Context-Driven Main Canvas (4-Col Max Tile Grid, Collection Tracklist, or Artist Profile)
         ===================================================================== */}
      <div
        data-nav-col="right"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight > 220) return;
          if (rightPaneMode === 'artist') {
            if (
              activeArtistProfile?.source === 'soundcloud' &&
              activeArtistProfile.subTab === 'tracks' &&
              activeArtistProfile.scData?.next_tracks_href &&
              !activeArtistProfile.loadingMore
            ) {
              loadMoreArtistTracks();
            }
            return;
          }
          if (rightPaneMode !== 'browse') return;
          if (browserSearch.trim()) {
            if (isSourceIncluded('internet_archive') && iaSearchHasMore && !iaSearchLoadingMore) {
              loadMoreIaSearch();
            }
            if (
              isSourceIncluded('soundcloud') &&
              scCatalogSearchResults.next_tracks_href &&
              !scLoadingMore
            ) {
              loadMoreScSearch();
            }
            return;
          }
          if (
            browserSourceFilter === 'internet_archive' &&
            iaSubTab !== 'pinned' &&
            iaHasMore &&
            !iaLoadingMore
          ) {
            loadMoreIaDiscover();
          } else if (
            browserSourceFilter === 'soundcloud' &&
            soundCloudSubTab === 'trending' &&
            scDiscoverNextHref &&
            !scLoadingMore
          ) {
            loadMoreScDiscover();
          }
        }}
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
        {browserSearch.trim() && rightPaneMode !== 'tracks' && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              borderRadius: 10,
              background: '#0f222a',
              border: '1px solid #2aa3c4',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 800, color: '#bfeaf5' }}>
              🔍 Filtering by “{browserSearch.trim()}”
            </span>
            <button
              type="button"
              data-right-filter-pill="true"
              onClick={() => setBrowserSearch('')}
              style={{
                padding: '4px 10px',
                borderRadius: 7,
                background: '#16313c',
                border: '1px solid #2aa3c4',
                color: '#7dd3fc',
                fontSize: 11.5,
                fontFamily: 'monospace',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ✕ Clear
            </button>
          </div>
        )}
        {/* =================================================================
            STATE A: ⊞ 4-COLUMN-MAX VISUAL TILE GRID (My SIMP Library, Apple Playlists, Radio, New, Search)
           ================================================================= */}
        {rightPaneMode === 'browse' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, width: '100%' }}>
            {/* Not Signed In Setup Card (only shown when opening an Apple Cloud Hub while not authenticated) */}
            {!snap?.apple_authenticated &&
              appleSubTab !== 'pinned' &&
              browserSourceFilter !== 'local' &&
              browserSourceFilter !== 'soundcloud' &&
              browserSourceFilter !== 'internet_archive' && (
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

            {(cloudLoading || iaLoading) && (
              <div
                style={{
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color:
                    browserSourceFilter === 'internet_archive'
                      ? '#fde68a'
                      : browserSourceFilter === 'soundcloud'
                      ? '#fdba74'
                      : '#fda4af',
                  padding: '4px 2px',
                }}
              >
                {browserSourceFilter === 'internet_archive' || iaLoading
                  ? '⏳ Loading from Internet Archive...'
                  : browserSourceFilter === 'soundcloud'
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
                {searchMatchedPlaylists.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                      📌 MATCHING SIMP & PINNED PLAYLISTS ({searchMatchedPlaylists.length})
                    </div>
                    <div style={tileGridStyle}>
                      {searchMatchedPlaylists.map(renderSimpPlaylistCard)}
                    </div>
                  </>
                )}

                {/* 1B–1F. Source-Grouped Search Results (Originating / Preferred Source Prioritized First) */}
                {(
                  [
                    'local',
                    'apple_music',
                    'soundcloud',
                    'internet_archive',
                  ] as const
                )
                  .slice()
                  .sort((a, b) => {
                    if (searchPreferredSource) {
                      if (a === searchPreferredSource && b !== searchPreferredSource) return -1;
                      if (b === searchPreferredSource && a !== searchPreferredSource) return 1;
                    }
                    return 0;
                  })
                  .map((sourceGroup) => {
                    if (sourceGroup === 'local') {
                      const localArtistsMap = new Map<
                        string,
                        { name: string; artUrl: string | null; count: number }
                      >();
                      if (mediaTypeFilter !== 'video') {
                        for (const alb of filteredAlbums) {
                          if (alb.id.startsWith('applemusic:album:')) continue;
                          const cleanArtName = alb.album_artist
                            .replace(/\s*•\s*(FLAC(?:\s*\+\s*MP3)?|MP3|WAV|OGG|OPUS|M4A|AAC|ALAC|AIFF)$/i, '')
                            .trim();
                          if (
                            cleanArtName &&
                            cleanArtName.toLowerCase().includes(searchLower)
                          ) {
                            const key = cleanArtName.toLowerCase();
                            const prev = localArtistsMap.get(key);
                            localArtistsMap.set(key, {
                              name: prev?.name || cleanArtName,
                              artUrl: prev?.artUrl || alb.art_url || null,
                              count: (prev?.count || 0) + 1,
                            });
                          }
                        }
                        for (const tr of filteredLocalSearchTracks) {
                          if (isUiVideoTrack(tr)) continue;
                          for (const artName of tr.artists) {
                            const cleanArtName = artName.trim();
                            if (
                              cleanArtName &&
                              cleanArtName.toLowerCase().includes(searchLower)
                            ) {
                              const key = cleanArtName.toLowerCase();
                              const prev = localArtistsMap.get(key);
                              localArtistsMap.set(key, {
                                name: prev?.name || cleanArtName,
                                artUrl: prev?.artUrl || tr.art_url || null,
                                count: (prev?.count || 0) + 1,
                              });
                            }
                          }
                        }
                      }
                      const matchedLocalArtists = Array.from(localArtistsMap.values()).slice(0, 8);

                      return (
                        <React.Fragment key="search-group-local">
                          {/* 1C-0. Matching Local Library Artists */}
                          {isSourceIncluded('local') && matchedLocalArtists.length > 0 && (
                            <>
                              <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                                🎤 MATCHING LOCAL LIBRARY ARTISTS ({matchedLocalArtists.length})
                              </div>
                              <div style={tileGridStyle}>
                                {matchedLocalArtists.map((a) =>
                                  renderLocalArtistCard(
                                    a.name,
                                    a.artUrl,
                                    `${a.count} matching ${a.count === 1 ? 'item' : 'items'}`
                                  )
                                )}
                              </div>
                            </>
                          )}

                          {/* 1C. Matching Local & Pinned Albums */}
                          {filteredAlbums.length > 0 && (
                            <>
                              <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                                💿 MATCHING SIMP LIBRARY ALBUMS ({filteredAlbums.length})
                              </div>
                              <div style={tileGridStyle}>
                                {filteredAlbums.slice(0, 24).map(renderSimpAlbumCard)}
                              </div>
                            </>
                          )}

                          {/* 1C-2. Matching Local Tracks & Local Videos */}
                          {isSourceIncluded('local') &&
                            filteredLocalSearchTracks.length > 0 && (
                              <>
                                <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                                  LOCAL TRACKS & VIDEOS ({filteredLocalSearchTracks.length})
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {filteredLocalSearchTracks.map((s) =>
                                    renderSingleSongRow(
                                      s,
                                      filteredLocalSearchTracks.filter(
                                        (tr) =>
                                          tr.source !== 'local_video' &&
                                          !tr.uri.startsWith('video://local/')
                                      ),
                                      'local_search'
                                    )
                                  )}
                                </div>
                              </>
                            )}
                        </React.Fragment>
                      );
                    }

                    if (sourceGroup === 'apple_music') {
                      return (
                        <React.Fragment key="search-group-apple">
                          {/* 1B. Matching Unpinned Apple Library Playlists */}
                          {isSourceIncluded('apple_music') &&
                            mediaTypeFilter !== 'video' &&
                            filteredCloudPlaylists.length > 0 && (
                              <>
                                <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                                  ☁️ MATCHING APPLE LIBRARY PLAYLISTS ({filteredCloudPlaylists.length})
                                </div>
                                <div style={tileGridStyle}>
                                  {filteredCloudPlaylists.slice(0, 50).map(renderCloudPlaylistCard)}
                                </div>
                              </>
                            )}

                          {/* 1D. Personal Apple Cloud Library ("Your Library") & Public Catalog Search Results */}
                          {isSourceIncluded('apple_music') &&
                            mediaTypeFilter !== 'video' &&
                            snap?.apple_authenticated && (
                              <>
                                {catalogSearchResults.artists &&
                                  catalogSearchResults.artists.length > 0 && (
                                    <>
                                      <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                                        🎤 APPLE MUSIC ARTISTS ({catalogSearchResults.artists.length})
                                      </div>
                                      <div style={tileGridStyle}>
                                        {catalogSearchResults.artists.map(renderAppleArtistCard)}
                                      </div>
                                    </>
                                  )}

                                {catalogSearchResults.albums.some((a) => a.kind === 'library') && (
                                  <>
                                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                                      ☁️ IN YOUR APPLE CLOUD LIBRARY — ALBUMS (
                                      {
                                        catalogSearchResults.albums.filter((a) => a.kind === 'library')
                                          .length
                                      }
                                      )
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
                                      {
                                        catalogSearchResults.albums.filter((a) => a.kind !== 'library')
                                          .length
                                      }
                                      )
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
                        </React.Fragment>
                      );
                    }

                    if (sourceGroup === 'soundcloud') {
                      return (
                        <React.Fragment key="search-group-sc">
                          {/* 1E. SoundCloud Catalog Search Results (Creators, Sets & Tracks) */}
                          {isSourceIncluded('soundcloud') &&
                            mediaTypeFilter !== 'video' &&
                            ((scCatalogSearchResults.users?.length || 0) > 0 ||
                              scCatalogSearchResults.playlists.length > 0 ||
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
                                  ☁️ SoundCloud Creators, Sets & Tracks
                                </div>

                                {scCatalogSearchResults.users &&
                                  scCatalogSearchResults.users.length > 0 && (
                                    <>
                                      <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                                        👥 SOUNDCLOUD ARTISTS & CREATORS (
                                        {scCatalogSearchResults.users.length})
                                      </div>
                                      <div style={tileGridStyle}>
                                        {scCatalogSearchResults.users.map(renderSoundCloudUserCard)}
                                      </div>
                                    </>
                                  )}

                                {scCatalogSearchResults.playlists.length > 0 && (
                                  <>
                                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                                      🎶 SOUNDCLOUD SETS & PLAYLISTS (
                                      {scCatalogSearchResults.playlists.length})
                                    </div>
                                    <div style={tileGridStyle}>
                                      {scCatalogSearchResults.playlists.map(renderSoundCloudPlaylistCard)}
                                    </div>
                                  </>
                                )}

                                {scCatalogSearchResults.songs.length > 0 && (
                                  <>
                                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                                      ☁️ SOUNDCLOUD TRACKS & MIXES (
                                      {scCatalogSearchResults.songs.length})
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                      {scCatalogSearchResults.songs.map((s) =>
                                        renderSingleSongRow(s, scCatalogSearchResults.songs, 'sc_search')
                                      )}
                                      {scCatalogSearchResults.next_tracks_href && (
                                        <button
                                          data-right-tile="true"
                                          onClick={loadMoreScSearch}
                                          disabled={scLoadingMore}
                                          style={{
                                            minHeight: 40,
                                            padding: '8px 16px',
                                            borderRadius: 10,
                                            background: '#2c140a',
                                            border: '1px solid #ea580c',
                                            color: '#fed7aa',
                                            fontSize: 12,
                                            fontWeight: 800,
                                            cursor: scLoadingMore ? 'default' : 'pointer',
                                            alignSelf: 'center',
                                            marginTop: 4,
                                          }}
                                        >
                                          {scLoadingMore
                                            ? '⏳ Loading more SoundCloud tracks...'
                                            : '⬇ Load More SoundCloud Tracks'}
                                        </button>
                                      )}
                                    </div>
                                  </>
                                )}
                              </>
                            )}
                        </React.Fragment>
                      );
                    }

                    return (
                      <React.Fragment key="search-group-ia">
                        {/* 1F. Internet Archive Search Results (Films, TV, Concerts & Audio) */}
                        {isSourceIncluded('internet_archive') &&
                          filteredIaSearchResults.length > 0 && (
                            <>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 800,
                                  color: '#fde68a',
                                  borderBottom: '1px solid #3c260a',
                                  paddingBottom: 6,
                                  marginTop: 8,
                                }}
                              >
                                🏛️ Internet Archive ({filteredIaSearchResults.length})
                              </div>
                              <div style={tileGridStyle}>
                                {filteredIaSearchResults.map(renderArchiveItemCard)}
                              </div>
                              {iaSearchHasMore && (
                                <button
                                  data-right-tile="true"
                                  onClick={loadMoreIaSearch}
                                  disabled={iaSearchLoadingMore}
                                  style={{
                                    minHeight: 40,
                                    padding: '8px 16px',
                                    borderRadius: 10,
                                    background: '#261a0b',
                                    border: '1px solid #d97706',
                                    color: '#fde68a',
                                    fontSize: 12,
                                    fontWeight: 800,
                                    cursor: iaSearchLoadingMore ? 'default' : 'pointer',
                                    alignSelf: 'center',
                                    marginTop: 4,
                                  }}
                                >
                                  {iaSearchLoadingMore
                                    ? '⏳ Loading more Internet Archive items...'
                                    : '⬇ Load More Archive Results'}
                                </button>
                              )}
                            </>
                          )}
                      </React.Fragment>
                    );
                  })}

                {filteredPlaylists.length === 0 &&
                  filteredCloudPlaylists.length === 0 &&
                  filteredAlbums.length === 0 &&
                  filteredLocalSearchTracks.length === 0 &&
                  catalogSearchResults.albums.length === 0 &&
                  catalogSearchResults.playlists.length === 0 &&
                  catalogSearchResults.stations.length === 0 &&
                  catalogSearchResults.songs.length === 0 &&
                  scCatalogSearchResults.playlists.length === 0 &&
                  scCatalogSearchResults.songs.length === 0 &&
                  filteredIaSearchResults.length === 0 &&
                  !cloudLoading &&
                  !iaLoading && (
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
                    {mountTracks.some(
                      (t) => t.source !== 'local_video' && !t.uri.startsWith('video://local/')
                    ) && (
                      <>
                        <button
                          data-right-tile="true"
                          onClick={() => {
                            const audioOnly = mountTracks.filter(
                              (t) =>
                                t.source !== 'local_video' && !t.uri.startsWith('video://local/')
                            );
                            setPlayingContextId(`mount:${activeMountPlaceObj.mount_root}`);
                            defaultSimpClient.loadQueue(
                              audioOnly.map((t) => t.uri),
                              0,
                              audioOnly
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
                          ▶ Play All (
                          {
                            mountTracks.filter(
                              (t) =>
                                t.source !== 'local_video' && !t.uri.startsWith('video://local/')
                            ).length
                          }
                          )
                        </button>
                        <button
                          onClick={() => {
                            const audioOnly = mountTracks.filter(
                              (t) =>
                                t.source !== 'local_video' && !t.uri.startsWith('video://local/')
                            );
                            handleAddTracksToPlaylist(
                              audioOnly.map((t) => t.uri),
                              `all ${audioOnly.length} tracks from ${activeMountPlaceObj.label}`,
                              audioOnly
                            );
                          }}
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
                  mountTracks.length === 0 && (
                    <div style={{ fontSize: 12, color: '#8e8e99', padding: '12px 4px' }}>
                      No albums indexed on {activeMountPlaceObj.label} yet.
                    </div>
                  )
                )}

                {mountTracks.some(
                  (t) => t.source === 'local_video' || t.uri.startsWith('video://local/')
                ) && (
                  <>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                      LOCAL VIDEOS ON {activeMountPlaceObj.label.toUpperCase()} (
                      {
                        mountTracks.filter(
                          (t) => t.source === 'local_video' || t.uri.startsWith('video://local/')
                        ).length
                      }
                      )
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {mountTracks
                        .filter(
                          (t) => t.source === 'local_video' || t.uri.startsWith('video://local/')
                        )
                        .map((v) => renderSingleSongRow(v, [], 'mount_video'))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                {/* ---------------------------------------------------------
                    2B. 📌 MY SIMP LIBRARY HUB (4-Column Visual Card Grid & Playlist Manager)
                   --------------------------------------------------------- */}
                {((browserSourceFilter !== 'soundcloud' &&
                  browserSourceFilter !== 'internet_archive' &&
                  appleSubTab === 'pinned') ||
                  (browserSourceFilter === 'soundcloud' && soundCloudSubTab === 'pinned') ||
                  (browserSourceFilter === 'internet_archive' && iaSubTab === 'pinned')) && (
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
                            ...(filteredRecentlyPlayed.length > 0
                              ? [
                                  {
                                    id: 'recent' as const,
                                    label: `🕒 Recent (${filteredRecentlyPlayed.length})`,
                                  },
                                ]
                              : []),
                            {
                              id: 'hybrid',
                              label: `★ SIMP Playlists (${hybridPlaylistsList.length})`,
                            },
                            ...(browserSourceFilter !== 'local' || pinnedPlaylistsList.length > 0
                              ? [
                                  {
                                    id: 'pinned' as const,
                                    label: `📌 Pinned (${pinnedPlaylistsList.length})`,
                                  },
                                ]
                              : []),
                            ...(mediaTypeFilter !== 'video'
                              ? [
                                  {
                                    id: 'albums' as const,
                                    label: `💿 Albums (${filteredAlbums.length})`,
                                  },
                                ]
                              : []),
                            ...(isSourceIncluded('local') &&
                            mediaTypeFilter !== 'audio' &&
                            localVideos.length > 0
                              ? [
                                  {
                                    id: 'videos' as const,
                                    label: `🎬 Videos (${localVideos.length})`,
                                  },
                                ]
                              : []),
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
                          onClick={(e) => {
                            if (
                              e.detail === 0 ||
                              document.documentElement.dataset.simpInput === 'gamepad'
                            ) {
                              setOskTarget('playlist');
                              if (window.parent && window.parent !== window) {
                                window.parent.postMessage({ type: 'SIMP_OPEN_OSK' }, '*');
                              }
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

                    {/* Recently Played Section */}
                    {(simpHubFilter === 'all' || simpHubFilter === 'recent') &&
                      filteredRecentlyPlayed.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                            🕒 RECENTLY PLAYED ({filteredRecentlyPlayed.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {(simpHubFilter === 'recent'
                              ? filteredRecentlyPlayed
                              : filteredRecentlyPlayed.slice(0, 6)
                            ).map((rTrack) =>
                              renderSingleSongRow(
                                rTrack,
                                filteredRecentlyPlayed.filter((tr) => !isUiVideoTrack(tr)),
                                'recent_played'
                              )
                            )}
                          </div>
                        </>
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
                      filteredAlbums.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                            💿 ALBUMS & SOUNDTRACKS ({filteredAlbums.length})
                          </div>
                          <div style={tileGridStyle}>
                            {filteredAlbums.map(renderSimpAlbumCard)}
                          </div>
                        </>
                      )}

                    {/* Indexed Local Unencrypted Video Files Section */}
                    {(simpHubFilter === 'all' || simpHubFilter === 'videos') &&
                      isSourceIncluded('local') &&
                      mediaTypeFilter !== 'audio' &&
                      localVideos.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                            LOCAL VIDEOS ({localVideos.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {localVideos.map((v) =>
                              renderSingleSongRow(v, [], 'local_video_hub')
                            )}
                          </div>
                        </>
                      )}
                  </>
                )}

                {/* ---------------------------------------------------------
                    3. ☁️ APPLE LIBRARY PLAYLISTS HUB (Paginated 50/page + A-Z Jump Pills)
                   --------------------------------------------------------- */}
                {browserSourceFilter !== 'soundcloud' &&
                  browserSourceFilter !== 'internet_archive' &&
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
                    4. ✨ FOR YOU HUB (Personal Radio, New Releases, Recently Played, Mixes & Shelves)
                   --------------------------------------------------------- */}
                {browserSourceFilter !== 'soundcloud' &&
                  browserSourceFilter !== 'internet_archive' &&
                  appleSubTab === 'for_you' &&
                  snap?.apple_authenticated && (
                  <>
                    {(() => {
                      const recentShelves = forYouShelves.filter(
                        (s) =>
                          s.id === 'recently-played' ||
                          s.title.toLowerCase().includes('recent')
                      );
                      const otherShelves = forYouShelves.filter(
                        (s) =>
                          s.id !== 'recently-played' &&
                          !s.title.toLowerCase().includes('recent') &&
                          !s.title.toLowerCase().includes('new release')
                      );
                      const recentShelfCount = recentShelves.reduce(
                        (acc, s) =>
                          acc + s.playlists.length + s.albums.length + s.stations.length,
                        0
                      );
                      const totalRecentCount =
                        recentShelfCount + appleRecentlyPlayedTracks.length;
                      const effectiveNewReleases =
                        forYouNewReleases.length > 0
                          ? forYouNewReleases
                          : newFeedRecentReleases;

                      return (
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
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                flexWrap: 'wrap',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 14,
                                  fontWeight: 800,
                                  color: '#fecdd3',
                                  marginRight: 6,
                                }}
                              >
                                ✨ For You
                              </span>
                              {(
                                [
                                  { id: 'all' as const, label: 'All' },
                                  ...(personalRadioStations.length > 0
                                    ? [
                                        {
                                          id: 'stations' as const,
                                          label: `📻 Personal Radio (${personalRadioStations.length})`,
                                        },
                                      ]
                                    : []),
                                  ...(effectiveNewReleases.length > 0
                                    ? [
                                        {
                                          id: 'new_releases' as const,
                                          label: `🆕 New Releases (${effectiveNewReleases.length})`,
                                        },
                                      ]
                                    : []),
                                  ...(totalRecentCount > 0
                                    ? [
                                        {
                                          id: 'recently_played' as const,
                                          label: `🕒 Recently Played (${totalRecentCount})`,
                                        },
                                      ]
                                    : []),
                                  {
                                    id: 'mixes' as const,
                                    label: `✨ Mixes & Recommendations (${
                                      forYouPlaylists.length + forYouAlbums.length
                                    })`,
                                  },
                                  ...(recentlyAddedCloudAlbums.length > 0
                                    ? [
                                        {
                                          id: 'recent_library' as const,
                                          label: `☁️ Recently Added (${recentlyAddedCloudAlbums.length})`,
                                        },
                                      ]
                                    : []),
                                ] as const
                              ).map((f) => {
                                const active = forYouFilter === f.id;
                                return (
                                  <button
                                    key={f.id}
                                    data-right-filter-pill="true"
                                    onClick={() => setForYouFilter(f.id)}
                                    style={{
                                      padding: '4px 10px',
                                      borderRadius: 6,
                                      background: active ? '#28111b' : '#101018',
                                      border: active
                                        ? '1px solid #fa243c'
                                        : '1px solid #222230',
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
                                      setPersonalRadioStations?.(res.personal_stations ?? []);
                                      setLiveRadioStations?.(res.live_stations ?? []);
                                      setForYouNewReleases?.(res.new_releases ?? []);
                                      setForYouPlaylists(res.playlists);
                                      setForYouAlbums(res.albums);
                                      setForYouShelves?.(res.shelves ?? []);
                                      setAppleRecentlyPlayedTracks?.(res.recently_played ?? []);
                                    })
                                    .catch(() => {}),
                                  fetchAppleLibraryRecentlyAdded()
                                    .then((albs) => {
                                      if (Array.isArray(albs))
                                        setRecentlyAddedCloudAlbums(albs);
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

                          {(forYouFilter === 'all' || forYouFilter === 'stations') &&
                            personalRadioStations.length > 0 && (
                              <>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: '#fda4af',
                                  }}
                                >
                                  📻 PERSONAL RADIO STATIONS ({personalRadioStations.length})
                                </div>
                                <div style={tileGridStyle}>
                                  {personalRadioStations.map(renderStationCard)}
                                </div>
                              </>
                            )}

                          {(forYouFilter === 'all' || forYouFilter === 'new_releases') &&
                            effectiveNewReleases.length > 0 && (
                              <>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: '#fda4af',
                                  }}
                                >
                                  🆕 NEW & RECENT RELEASES FOR YOU ({effectiveNewReleases.length})
                                </div>
                                <div style={tileGridStyle}>
                                  {effectiveNewReleases.map(renderCloudAlbumCard)}
                                </div>
                              </>
                            )}

                          {(forYouFilter === 'all' || forYouFilter === 'recently_played') &&
                            totalRecentCount > 0 && (
                              <>
                                {recentShelves.map((shelf) => {
                                  const totalItems =
                                    shelf.playlists.length +
                                    shelf.albums.length +
                                    shelf.stations.length;
                                  if (totalItems === 0) return null;
                                  return (
                                    <React.Fragment key={shelf.id}>
                                      <div
                                        style={{
                                          fontSize: 11,
                                          fontFamily: 'monospace',
                                          color: '#fda4af',
                                        }}
                                      >
                                        🕒 {shelf.title.toUpperCase()} ({totalItems})
                                      </div>
                                      <div style={tileGridStyle}>
                                        {shelf.stations.map(renderStationCard)}
                                        {shelf.playlists.map(renderCloudPlaylistCard)}
                                        {shelf.albums.map(renderCloudAlbumCard)}
                                      </div>
                                    </React.Fragment>
                                  );
                                })}

                                {appleRecentlyPlayedTracks.length > 0 && (
                                  <>
                                    <div
                                      style={{
                                        fontSize: 11,
                                        fontFamily: 'monospace',
                                        color: '#fda4af',
                                      }}
                                    >
                                      🎵 RECENTLY PLAYED TRACKS (
                                      {appleRecentlyPlayedTracks.length})
                                    </div>
                                    <div
                                      style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 6,
                                      }}
                                    >
                                      {appleRecentlyPlayedTracks
                                        .slice(
                                          0,
                                          forYouFilter === 'recently_played' ? 40 : 12
                                        )
                                        .map((s) =>
                                          renderSingleSongRow(
                                            s,
                                            appleRecentlyPlayedTracks,
                                            'for_you_recent'
                                          )
                                        )}
                                    </div>
                                  </>
                                )}
                              </>
                            )}

                          {(forYouFilter === 'all' || forYouFilter === 'recent_library') &&
                            recentlyAddedCloudAlbums.length > 0 && (
                              <>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: '#fda4af',
                                  }}
                                >
                                  ☁️ RECENTLY ADDED TO YOUR APPLE CLOUD LIBRARY (
                                  {recentlyAddedCloudAlbums.length})
                                </div>
                                <div style={tileGridStyle}>
                                  {recentlyAddedCloudAlbums.map(renderCloudAlbumCard)}
                                </div>
                              </>
                            )}

                          {(forYouFilter === 'all' || forYouFilter === 'mixes') &&
                            (otherShelves.length > 0 ? (
                              <>
                                {otherShelves.map((shelf) => {
                                  const totalItems =
                                    shelf.playlists.length +
                                    shelf.albums.length +
                                    shelf.stations.length;
                                  if (totalItems === 0) return null;
                                  return (
                                    <React.Fragment key={shelf.id}>
                                      <div
                                        style={{
                                          fontSize: 11,
                                          fontFamily: 'monospace',
                                          color: '#fda4af',
                                        }}
                                      >
                                        ✨ {shelf.title.toUpperCase()} ({totalItems})
                                      </div>
                                      <div style={tileGridStyle}>
                                        {shelf.stations.map(renderStationCard)}
                                        {shelf.playlists.map(renderCloudPlaylistCard)}
                                        {shelf.albums.map(renderCloudAlbumCard)}
                                      </div>
                                    </React.Fragment>
                                  );
                                })}
                              </>
                            ) : (
                              <>
                                {forYouPlaylists.length > 0 && (
                                  <>
                                    <div
                                      style={{
                                        fontSize: 11,
                                        fontFamily: 'monospace',
                                        color: '#fda4af',
                                      }}
                                    >
                                      ✨ MADE FOR YOU & HEAVY ROTATION (
                                      {forYouPlaylists.length})
                                    </div>
                                    <div style={tileGridStyle}>
                                      {forYouPlaylists.map(renderCloudPlaylistCard)}
                                    </div>
                                  </>
                                )}

                                {forYouAlbums.length > 0 && (
                                  <>
                                    <div
                                      style={{
                                        fontSize: 11,
                                        fontFamily: 'monospace',
                                        color: '#fda4af',
                                      }}
                                    >
                                      💿 RECOMMENDED FULL ALBUMS ({forYouAlbums.length})
                                    </div>
                                    <div style={tileGridStyle}>
                                      {forYouAlbums.map(renderCloudAlbumCard)}
                                    </div>
                                  </>
                                )}
                              </>
                            ))}
                        </>
                      );
                    })()}
                  </>
                )}

                {/* ---------------------------------------------------------
                    5. 🔥 NEW RELEASES & TOP CHARTS HUB (Recent Releases For You + Charts)
                   --------------------------------------------------------- */}
                {browserSourceFilter !== 'soundcloud' &&
                  browserSourceFilter !== 'internet_archive' &&
                  appleSubTab === 'new' &&
                  snap?.apple_authenticated && (
                  <>
                    {(() => {
                      const recentReleasesForYou =
                        newFeedRecentReleases.length > 0
                          ? newFeedRecentReleases
                          : forYouNewReleases;
                      return (
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
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                flexWrap: 'wrap',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 14,
                                  fontWeight: 800,
                                  color: '#fecdd3',
                                  marginRight: 6,
                                }}
                              >
                                🔥 New & Charts
                              </span>
                              {(
                                [
                                  { id: 'all' as const, label: 'All' },
                                  ...(recentReleasesForYou.length > 0
                                    ? [
                                        {
                                          id: 'recent_releases' as const,
                                          label: `🆕 Recent Releases (${recentReleasesForYou.length})`,
                                        },
                                      ]
                                    : []),
                                  {
                                    id: 'albums' as const,
                                    label: `💿 New Albums (${newFeedAlbums.length})`,
                                  },
                                  {
                                    id: 'playlists' as const,
                                    label: `🎶 Featured Playlists (${newFeedPlaylists.length})`,
                                  },
                                  {
                                    id: 'songs' as const,
                                    label: `🎵 Top Singles (${newFeedSongs.length})`,
                                  },
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
                                      border: active
                                        ? '1px solid #fa243c'
                                        : '1px solid #222230',
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
                                      setNewFeedRecentReleases?.(res.recent_releases ?? []);
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

                          {(newFilter === 'all' || newFilter === 'recent_releases') &&
                            recentReleasesForYou.length > 0 && (
                              <>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: '#fda4af',
                                  }}
                                >
                                  🆕 RECENT RELEASES FOR YOU ({recentReleasesForYou.length})
                                </div>
                                <div style={tileGridStyle}>
                                  {recentReleasesForYou.map(renderCloudAlbumCard)}
                                </div>
                              </>
                            )}

                          {(newFilter === 'all' || newFilter === 'albums') &&
                            newFeedAlbums.length > 0 && (
                              <>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: '#fda4af',
                                  }}
                                >
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
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: '#fda4af',
                                  }}
                                >
                                  🎶 NEW & FEATURED PLAYLISTS ({newFeedPlaylists.length})
                                </div>
                                <div style={tileGridStyle}>
                                  {newFeedPlaylists.map(renderCloudPlaylistCard)}
                                </div>
                              </>
                            )}

                          {(newFilter === 'all' || newFilter === 'songs') &&
                            newFeedSongs.length > 0 && (
                              <>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: '#fda4af',
                                  }}
                                >
                                  🎵 TOP NEW SONGS / SINGLES ({newFeedSongs.length})
                                </div>
                                <div
                                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                                >
                                  {newFeedSongs.map((s) =>
                                    renderSingleSongRow(s, newFeedSongs, 'new')
                                  )}
                                </div>
                              </>
                            )}
                        </>
                      );
                    })()}
                  </>
                )}

                {/* ---------------------------------------------------------
                    5B. 📻 RADIO HUB (Live Broadcast & Global Apple Music Radio Stations)
                   --------------------------------------------------------- */}
                {browserSourceFilter !== 'soundcloud' &&
                  browserSourceFilter !== 'internet_archive' &&
                  appleSubTab === 'radio' &&
                  snap?.apple_authenticated && (
                  <>
                    {(() => {
                      const stationsToDisplay =
                        liveRadioStations.length > 0 ? liveRadioStations : radioStations;
                      return (
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
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                flexWrap: 'wrap',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 14,
                                  fontWeight: 800,
                                  color: '#fecdd3',
                                }}
                              >
                                📻 Live & Global Radio
                              </span>
                              <span
                                style={{
                                  fontSize: 11,
                                  fontFamily: 'monospace',
                                  color: '#9ca3af',
                                }}
                              >
                                {stationsToDisplay.length} broadcast & genre stations
                              </span>
                            </div>
                            <button
                              data-right-filter-pill="true"
                              onClick={() => {
                                setCloudLoading(true);
                                fetchAppleRadioAndForYou()
                                  .then((res) => {
                                    setRadioStations(res.stations);
                                    setPersonalRadioStations?.(res.personal_stations ?? []);
                                    setLiveRadioStations?.(res.live_stations ?? []);
                                    setForYouNewReleases?.(res.new_releases ?? []);
                                    setForYouPlaylists(res.playlists);
                                    setForYouAlbums(res.albums);
                                    setForYouShelves?.(res.shelves ?? []);
                                    setAppleRecentlyPlayedTracks?.(res.recently_played ?? []);
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

                          {stationsToDisplay.length > 0 ? (
                            <>
                              <div
                                style={{
                                  fontSize: 11,
                                  fontFamily: 'monospace',
                                  color: '#fda4af',
                                }}
                              >
                                📻 APPLE MUSIC LIVE & GENRE RADIO STATIONS (
                                {stationsToDisplay.length})
                              </div>
                              <div style={tileGridStyle}>
                                {stationsToDisplay.map(renderStationCard)}
                              </div>
                            </>
                          ) : (
                            <div
                              style={{
                                padding: 28,
                                textAlign: 'center',
                                color: '#9ca3af',
                                fontSize: 12,
                              }}
                            >
                              {cloudLoading
                                ? 'Loading Apple Music radio stations…'
                                : 'No live radio stations returned right now. Click Refresh to retry.'}
                            </div>
                          )}
                        </>
                      );
                    })()}
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
                            { id: 'following', label: `👥 Following (${scFollowings.length})` },
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
                            Promise.all([
                              fetchSoundCloudLikesAndPlaylists().then((res) => {
                                setScLikedTracks(res.likedTracks);
                                setScPlaylists(res.playlists);
                              }),
                              fetchSoundCloudFollowings().then((users) => {
                                if (Array.isArray(users)) setScFollowings(users);
                              }),
                            ])
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

                    {(scLikesFilter === 'all' || scLikesFilter === 'following') &&
                      scFollowings.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            👥 FOLLOWED CREATORS & DJS ({scFollowings.length})
                          </div>
                          <div style={tileGridStyle}>
                            {scFollowings.map(renderSoundCloudUserCard)}
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

                    {scPlaylists.length === 0 &&
                      scLikedTracks.length === 0 &&
                      scFollowings.length === 0 &&
                      !cloudLoading && (
                      <div style={{ fontSize: 12, color: '#8e8e99', padding: '12px 4px' }}>
                        {snap?.soundcloud_authenticated
                          ? 'No SoundCloud likes or sets found yet.'
                          : 'Sign in with your personal SoundCloud account (OAuth 2.1 + PKCE) to browse your Likes & Sets, or switch to 🔥 Trending & Mixes.'}
                      </div>
                    )}
                  </>
                )}

                {/* ---------------------------------------------------------
                    7. ⚡ SOUNDCLOUD STREAM & RADIO HUB (Following Stream + Listening History + Track Radio)
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
                            {
                              id: 'history',
                              label: `🕒 Listening History (${
                                recentlyPlayed.filter((t) => t.source === 'soundcloud').length
                              })`,
                            },
                            { id: 'stream', label: `⚡ Following Stream (${scStreamTracks.length})` },
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

                    {(scStreamFilter === 'all' || scStreamFilter === 'history') &&
                      recentlyPlayed.some((t) => t.source === 'soundcloud') && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🕒 LISTENING HISTORY IN SIMP (
                            {recentlyPlayed.filter((t) => t.source === 'soundcloud').length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {recentlyPlayed
                              .filter((t) => t.source === 'soundcloud')
                              .map((s) =>
                                renderSingleSongRow(
                                  s,
                                  recentlyPlayed.filter((t) => t.source === 'soundcloud'),
                                  'sc_history'
                                )
                              )}
                          </div>
                        </>
                      )}

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
                            ⚡ FOLLOWING STREAM — UPLOADS & REPOSTS FROM ARTISTS YOU FOLLOW (
                            {scStreamTracks.length})
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
                              { id: 'all' as const, label: 'All' },
                              ...(scMoreOfWhatYouLike.length > 0
                                ? [
                                    {
                                      id: 'for_you' as const,
                                      label: `💡 For You (${scMoreOfWhatYouLike.length})`,
                                    },
                                  ]
                                : []),
                              ...(scFreshUploads.length > 0
                                ? [
                                    {
                                      id: 'fresh' as const,
                                      label: `🆕 Fresh (${scFreshUploads.length})`,
                                    },
                                  ]
                                : []),
                              ...(scRecommendedArtists.length > 0
                                ? [
                                    {
                                      id: 'artists' as const,
                                      label: `👥 Artists (${scRecommendedArtists.length})`,
                                    },
                                  ]
                                : []),
                              { id: 'mixes' as const, label: `🎧 20m+ DJ Mixes (${scTrendingMixes.length})` },
                              { id: 'sets' as const, label: `🎶 Featured Sets (${scTrendingPlaylists.length})` },
                              { id: 'tracks' as const, label: `🔥 Trending Tracks (${scTrendingTracks.length})` },
                            ]
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
                                setScDiscoverNextHref?.(res.next_tracks_href || null);
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
                                    setScDiscoverNextHref?.(res.next_tracks_href || null);
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

                    {(scTrendingFilter === 'all' || scTrendingFilter === 'for_you') &&
                      scMoreOfWhatYouLike.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            💡 MORE OF WHAT YOU LIKE — BASED ON YOUR HISTORY & LIKES (
                            {scMoreOfWhatYouLike.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scMoreOfWhatYouLike.map((s) =>
                              renderSingleSongRow(s, scMoreOfWhatYouLike, 'sc_for_you')
                            )}
                          </div>
                        </>
                      )}

                    {(scTrendingFilter === 'all' || scTrendingFilter === 'artists') &&
                      scRecommendedArtists.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            👥 ARTISTS & CREATORS TO CHECK OUT ({scRecommendedArtists.length})
                          </div>
                          <div style={tileGridStyle}>
                            {scRecommendedArtists.map(renderSoundCloudUserCard)}
                          </div>
                        </>
                      )}

                    {(scTrendingFilter === 'all' || scTrendingFilter === 'fresh') &&
                      scFreshUploads.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🆕 FRESH UPLOADS FROM CREATORS ({scFreshUploads.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scFreshUploads.map((s) =>
                              renderSingleSongRow(s, scFreshUploads, 'sc_fresh')
                            )}
                          </div>
                        </>
                      )}

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
                            {scDiscoverNextHref && (
                              <button
                                data-right-tile="true"
                                onClick={loadMoreScDiscover}
                                disabled={scLoadingMore}
                                style={{
                                  minHeight: 40,
                                  padding: '8px 16px',
                                  borderRadius: 10,
                                  background: '#2c140a',
                                  border: '1px solid #ea580c',
                                  color: '#fed7aa',
                                  fontSize: 12,
                                  fontWeight: 800,
                                  cursor: scLoadingMore ? 'default' : 'pointer',
                                  alignSelf: 'center',
                                  marginTop: 4,
                                }}
                              >
                                {scLoadingMore
                                  ? '⏳ Loading more SoundCloud tracks...'
                                  : '⬇ Load More SoundCloud Tracks'}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                  </>
                )}

                {/* ---------------------------------------------------------
                    9. 🏛️ INTERNET ARCHIVE DISCOVERY HUB (Trending, Films, TV, Concerts & Audio)
                   --------------------------------------------------------- */}
                {browserSourceFilter === 'internet_archive' && iaSubTab !== 'pinned' && (
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
                            color: '#fde68a',
                            marginRight: 6,
                          }}
                        >
                          🏛️ {activeHubLabel}
                        </span>
                        {(iaSubTab === 'trending'
                          ? [
                              { id: 'all', label: 'This Week' },
                              { id: 'movies', label: 'Video' },
                              { id: 'audio', label: 'Audio' },
                              { id: 'all_time', label: 'All-Time' },
                              { id: 'favorites', label: 'Favorites' },
                            ]
                          : iaSubTab === 'films'
                          ? [
                              { id: 'all', label: 'Feature Films' },
                              { id: 'noir', label: 'Film Noir' },
                              { id: 'scifi_horror', label: 'Sci-Fi & Horror' },
                              { id: 'comedy', label: 'Comedy' },
                              { id: 'silent', label: 'Silent Films' },
                            ]
                          : iaSubTab === 'tv'
                          ? [
                              { id: 'all', label: 'All TV' },
                              { id: 'cartoons', label: 'Animation' },
                              { id: 'classic_tv', label: 'Classic TV' },
                              { id: 'scifi_tv', label: 'Sci-Fi & Mystery' },
                            ]
                          : [
                              { id: 'all', label: 'All Audio' },
                              { id: 'etree', label: 'Live Concerts' },
                              { id: 'netlabels', label: 'Netlabels' },
                              { id: 'radio', label: 'Old Time Radio' },
                              { id: 'librivox', label: 'Audiobooks' },
                            ]
                        ).map((f) => {
                          const active = iaSubFilter === f.id;
                          return (
                            <button
                              key={f.id}
                              data-right-filter-pill="true"
                              onClick={() => setIaSubFilter(f.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 6,
                                background: active ? '#261a0b' : '#101018',
                                border: active ? '1px solid #f59e0b' : '1px solid #222230',
                                color: active ? '#fde68a' : '#9ca3af',
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {filteredIaItems.length > 0 &&
                          (() => {
                            const collKey = `${iaSubTab}:${iaSubFilter}`;
                            const collId = `archive:collection:${collKey}`;
                            const isCollPinned = playlists.some((p) => p.id === collId);
                            const collTitle = `${activeHubLabel}${
                              iaSubFilter !== 'all' ? ` (${iaSubFilter.replace('_', ' ')})` : ''
                            }`;
                            return (
                              <button
                                data-right-filter-pill="true"
                                onClick={() => {
                                  if (isCollPinned) {
                                    handleDeletePlaylist(collId, collTitle);
                                  } else {
                                    handlePinArchiveCollection(collKey, collTitle, filteredIaItems);
                                  }
                                }}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 6,
                                  background: isCollPinned ? '#0f222a' : '#261a0b',
                                  border: isCollPinned ? '1px solid #2aa3c4' : '1px solid #d97706',
                                  color: isCollPinned ? '#67e8f9' : '#fde68a',
                                  fontSize: 11,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                {isCollPinned ? '✓ 📌 Pinned Collection' : '📌 Pin Collection'}
                              </button>
                            );
                          })()}
                        <button
                          data-right-filter-pill="true"
                          onClick={() => loadIaDiscover(iaSubTab, iaSubFilter)}
                          style={{
                            padding: '4px 9px',
                            borderRadius: 6,
                            background: '#161620',
                            border: '1px solid #2a2a38',
                            color: '#fde68a',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ↻ Refresh
                        </button>
                      </div>
                    </div>

                    {filteredIaItems.length > 0 ? (
                      <>
                        <div style={tileGridStyle}>{filteredIaItems.map(renderArchiveItemCard)}</div>
                        {iaHasMore && !browserSearch.trim() && (
                          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
                            <button
                              data-focusable="true"
                              data-load-more="true"
                              onClick={loadMoreIaDiscover}
                              disabled={iaLoadingMore}
                              style={{
                                minHeight: 38,
                                padding: '0 20px',
                                borderRadius: 10,
                                background: '#1c140a',
                                border: '1px solid #d97706',
                                color: '#fcd34d',
                                fontSize: 12,
                                fontWeight: 800,
                                cursor: iaLoadingMore ? 'wait' : 'pointer',
                              }}
                            >
                              {iaLoadingMore ? '⏳ Loading More Archive Items...' : '⬇ Load More Archive Items'}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      !iaLoading && (
                        <div style={{ fontSize: 12, color: '#8e8e99', padding: '12px 4px' }}>
                          {iaSubFilter === 'favorites'
                            ? 'No public Internet Archive favorites found. Add your @username in Folders & Connected Accounts to sync fav-{username}.'
                            : 'No items returned from Internet Archive for this filter.'}
                        </div>
                      )
                    )}
                  </>
                )}
              </>
            )}
          </div>
        ) : rightPaneMode === 'artist' && activeArtistProfile ? (
          /* =================================================================
             STATE A.5: 🎤 DEDICATED ARTIST PROFILE & RABBIT HOLE VIEW
             ================================================================= */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, width: '100%' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                <button
                  data-right-back-grid="true"
                  onClick={handleWalkBack}
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
                {(activeArtistProfile.scData?.user?.avatar_url ||
                  activeArtistProfile.appleData?.artist?.art_url ||
                  activeArtistProfile.localData?.art_url) ? (
                  <img
                    src={
                      activeArtistProfile.scData?.user?.avatar_url ||
                      activeArtistProfile.appleData?.artist?.art_url ||
                      activeArtistProfile.localData?.art_url ||
                      ''
                    }
                    alt=""
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '2px solid #2aa3c4',
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: '50%',
                      background: '#141622',
                      border: '2px solid #2aa3c4',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 22,
                      flexShrink: 0,
                    }}
                  >
                    🎤
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      color: '#f8fafc',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {activeArtistProfile.scData?.user?.username ||
                      activeArtistProfile.appleData?.artist?.name ||
                      activeArtistProfile.localData?.name ||
                      activeArtistProfile.displayName}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {activeArtistProfile.source === 'soundcloud'
                      ? `☁️ SoundCloud Creator${
                          activeArtistProfile.scData?.user
                            ? ` • ${activeArtistProfile.scData.user.followers_count.toLocaleString()} followers`
                            : ''
                        }`
                      : activeArtistProfile.source === 'apple_music'
                      ? `🍎 Apple Music Artist${
                          activeArtistProfile.appleData?.artist?.genre
                            ? ` • ${activeArtistProfile.appleData.artist.genre}`
                            : ''
                        }`
                      : '💾 Local Library Artist'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {(() => {
                  const topTracks: TrackMetadata[] =
                    activeArtistProfile.scData?.tracks ||
                    activeArtistProfile.appleData?.top_tracks ||
                    activeArtistProfile.localData?.tracks ||
                    [];
                  return topTracks.length > 0 ? (
                    <>
                      <button
                        data-right-play-all="true"
                        onClick={() => {
                          setPlayingContextId(
                            `artist:${activeArtistProfile.source}:${activeArtistProfile.displayName}`
                          );
                          defaultSimpClient.loadQueue(
                            topTracks.map((t: TrackMetadata) => t.uri),
                            0,
                            topTracks
                          );
                          setView('lock');
                        }}
                        style={{
                          minHeight: 38,
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
                        ▶ Play Tracks<span className="simp-gp-badge"> (A)</span>
                      </button>
                      <button
                        onClick={() => {
                          setPlayingContextId(
                            `artist:${activeArtistProfile.source}:${activeArtistProfile.displayName}`
                          );
                          defaultSimpClient.setShuffle(true);
                          defaultSimpClient.loadQueue(
                            topTracks.map((t: TrackMetadata) => t.uri),
                            0,
                            topTracks
                          );
                          setView('lock');
                        }}
                        style={{
                          minHeight: 38,
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
                    </>
                  ) : null;
                })()}
                {activeArtistProfile.source === 'soundcloud' && activeArtistProfile.scData?.user && (
                  <button
                    onClick={async () => {
                      const u = activeArtistProfile.scData?.user;
                      if (!u) return;
                      const isFollowing = scFollowings.some((f) => f.id === u.id);
                      await toggleFollowSoundCloudUser(u.id, !isFollowing).catch(() => {});
                      setScFollowings((prev) =>
                        isFollowing ? prev.filter((f) => f.id !== u.id) : [u, ...prev]
                      );
                      showToast(isFollowing ? `Unfollowed ${u.username}` : `Following ${u.username}`);
                    }}
                    style={{
                      minHeight: 38,
                      padding: '0 14px',
                      borderRadius: 10,
                      background: '#221108',
                      border: '1px solid #f97316',
                      color: '#fdba74',
                      fontWeight: 800,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {scFollowings.some((f) => f.id === activeArtistProfile.scData?.user?.id)
                      ? '✓ Following'
                      : '+ Follow Artist'}
                  </button>
                )}
              </div>
            </div>

            {/* Sub-tab pills */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(
                [
                  {
                    id: 'tracks' as const,
                    label:
                      activeArtistProfile.source === 'soundcloud'
                        ? `🎵 Tracks (${activeArtistProfile.scData?.tracks.length ?? 0}${
                            activeArtistProfile.scData?.next_tracks_href ? '+' : ''
                          })`
                        : activeArtistProfile.source === 'apple_music'
                        ? `🎵 Top Tracks (${activeArtistProfile.appleData?.top_tracks.length ?? 0})`
                        : `🎵 Tracks (${activeArtistProfile.localData?.tracks.length ?? 0})`,
                  },
                  {
                    id: 'albums' as const,
                    label:
                      activeArtistProfile.source === 'soundcloud'
                        ? `🎶 Sets & Albums (${activeArtistProfile.scData?.playlists.length ?? 0})`
                        : activeArtistProfile.source === 'apple_music'
                        ? `💿 Albums (${activeArtistProfile.appleData?.albums.length ?? 0})`
                        : `💿 Albums (${activeArtistProfile.localData?.albums.length ?? 0})`,
                  },
                  ...(activeArtistProfile.source === 'soundcloud'
                    ? [
                        {
                          id: 'singles_or_likes' as const,
                          label: `❤️ Likes (${activeArtistProfile.scData?.liked_tracks?.length ?? 0})`,
                        },
                        {
                          id: 'related_or_following' as const,
                          label: `👥 Following (${activeArtistProfile.scData?.followings?.length ?? 0})`,
                        },
                      ]
                    : activeArtistProfile.source === 'apple_music'
                    ? [
                        {
                          id: 'singles_or_likes' as const,
                          label: `🎶 Singles & EPs (${activeArtistProfile.appleData?.singles.length ?? 0})`,
                        },
                        {
                          id: 'related_or_following' as const,
                          label: `👥 Related Artists (${activeArtistProfile.appleData?.related_artists.length ?? 0})`,
                        },
                      ]
                    : []),
                ]
              ).map((tab) => {
                const active = activeArtistProfile.subTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    data-right-filter-pill="true"
                    onClick={() =>
                      setActiveArtistProfile((prev) => (prev ? { ...prev, subTab: tab.id } : prev))
                    }
                    style={{
                      minHeight: 34,
                      padding: '0 14px',
                      borderRadius: 999,
                      background: active ? '#122934' : '#121218',
                      border: active ? '1px solid #2aa3c4' : '1px solid #242430',
                      color: active ? '#e0f7fc' : '#a1a1aa',
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {activeArtistProfile.loading ? (
              <div style={{ padding: 24, color: '#94a3b8', fontSize: 13 }}>
                ⏳ Loading artist catalog...
              </div>
            ) : (
              <>
                {activeArtistProfile.subTab === 'tracks' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(() => {
                      const tracks: TrackMetadata[] =
                        activeArtistProfile.scData?.tracks ||
                        activeArtistProfile.appleData?.top_tracks ||
                        activeArtistProfile.localData?.tracks ||
                        [];
                      return tracks.length > 0 ? (
                        <>
                          {tracks.map((s) =>
                            renderSingleSongRow(
                              s,
                              tracks,
                              `artist:${activeArtistProfile.source}:${activeArtistProfile.displayName}`
                            )
                          )}
                          {activeArtistProfile.source === 'soundcloud' &&
                            activeArtistProfile.scData?.next_tracks_href && (
                              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                                <button
                                  data-focusable="true"
                                  data-load-more="true"
                                  onClick={loadMoreArtistTracks}
                                  disabled={activeArtistProfile.loadingMore}
                                  style={{
                                    minHeight: 38,
                                    padding: '0 20px',
                                    borderRadius: 10,
                                    background: '#1c1008',
                                    border: '1px solid #ea580c',
                                    color: '#fdba74',
                                    fontSize: 12,
                                    fontWeight: 800,
                                    cursor: activeArtistProfile.loadingMore ? 'wait' : 'pointer',
                                  }}
                                >
                                  {activeArtistProfile.loadingMore
                                    ? '⏳ Loading More Tracks...'
                                    : '⬇ Load More Artist Tracks'}
                                </button>
                              </div>
                            )}
                        </>
                      ) : (
                        <div style={{ padding: 16, color: '#8e8e99', fontSize: 12 }}>
                          No streamable tracks found for this artist.
                        </div>
                      );
                    })()}
                  </div>
                )}

                {activeArtistProfile.subTab === 'albums' && (
                  <div style={tileGridStyle}>
                    {activeArtistProfile.source === 'soundcloud'
                      ? (activeArtistProfile.scData?.playlists || []).map((pl) =>
                          renderSoundCloudPlaylistCard(pl)
                        )
                      : activeArtistProfile.source === 'apple_music'
                      ? (activeArtistProfile.appleData?.albums || []).map(renderCloudAlbumCard)
                      : (activeArtistProfile.localData?.albums || []).map(renderSimpAlbumCard)}
                  </div>
                )}

                {activeArtistProfile.subTab === 'singles_or_likes' && (
                  <>
                    {activeArtistProfile.source === 'soundcloud' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {(activeArtistProfile.scData?.liked_tracks || []).map((s, _idx, arr) =>
                          renderSingleSongRow(
                            s,
                            arr,
                            `artist:sc:likes:${activeArtistProfile.displayName}`
                          )
                        )}
                      </div>
                    ) : (
                      <div style={tileGridStyle}>
                        {(activeArtistProfile.appleData?.singles || []).map(
                          renderCloudAlbumCard
                        )}
                      </div>
                    )}
                  </>
                )}

                {activeArtistProfile.subTab === 'related_or_following' && (
                  <div style={tileGridStyle}>
                    {activeArtistProfile.source === 'soundcloud'
                      ? (activeArtistProfile.scData?.followings || []).map((u) =>
                          renderSoundCloudUserCard(u)
                        )
                      : (activeArtistProfile.appleData?.related_artists || []).map(
                          renderAppleArtistCard
                        )}
                  </div>
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
                  browserTarget?.art_url) && (
                  <img
                    src={
                      selectedAlbumObj?.art_url ||
                      selectedPlaylistObj?.cover_art_url ||
                      browserTarget?.art_url ||
                      ''
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
                      : browserTarget?.title || 'Tracks'}
                  </div>
                  <div style={{ fontSize: 12, color: '#8e8e99' }}>
                    {browserTarget?.kind === 'ia_item' &&
                    activeIaDetail &&
                    activeIaDetail.episodes.length > 0
                      ? `${activeIaDetail.episodes.length} video ${
                          activeIaDetail.episodes.length === 1 ? 'part' : 'parts'
                        }${
                          browserTracks.length > 0 ? ` • ${browserTracks.length} audio tracks` : ''
                        }`
                      : `${browserTracks.length} tracks`}
                    {selectedAlbumObj ? ` • ${selectedAlbumObj.album_artist}` : ''}
                    {selectedMountObj ? ` in ${selectedMountObj.mount_root}` : ''}
                    {!selectedAlbumObj &&
                    !selectedMountObj &&
                    browserTarget?.subtitle
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
                        const tInfo = opticalDisc.dvd_titles[0];
                        const dev = opticalDisc.device_path || '/dev/sr0';
                        const dvdUri = `dvd://${dev}/${tInfo.title_number}`;
                        const meta: TrackMetadata = {
                          uri: dvdUri,
                          title: `${opticalDisc.album_title || 'DVD Video'} — ${tInfo.label}`,
                          artists: ['Optical DVD Video'],
                          album: opticalDisc.album_title || 'DVD Video',
                          album_id: null,
                          track_number: tInfo.title_number,
                          disc_number: 1,
                          art_url: opticalDisc.art_url || null,
                          duration_ms: tInfo.duration_ms,
                          source: 'dvd',
                        };
                        setPlayingContextId(`dvd:${dvdUri}`);
                        defaultSimpClient.loadQueue([dvdUri], 0, [meta]);
                        setView('lock');
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
                    {browserTarget.kind === 'ia_item' &&
                    activeIaDetail &&
                    activeIaDetail.episodes.length > 0
                      ? '▶ Watch in Theatre'
                      : '▶ Play'}
                    <span className="simp-gp-badge"> (A)</span>
                  </button>
                  {!(browserTarget.kind === 'cdda' && opticalDisc?.is_dvd_video) &&
                    browserTracks.length > 0 && (
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

            {/* Internet Archive Description Banner */}
            {browserTarget?.kind === 'ia_item' &&
              activeIaDetail &&
              activeIaDetail.summary.description && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: '#0c0d14',
                    border: '1px solid #1e202c',
                    fontSize: 12,
                    color: '#a1a1aa',
                    lineHeight: 1.45,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {activeIaDetail.summary.description}
                </div>
              )}

            {/* DVD-Video Title & Episode Browser */}
            {browserTarget?.kind === 'cdda' && opticalDisc?.is_dvd_video && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(!opticalDisc.dvd_css_available || !opticalDisc.dvd_ffmpeg_available) && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: '#261a0d',
                      border: '1px solid #b45309',
                      color: '#fcd34d',
                      fontSize: 12,
                      fontWeight: 700,
                      lineHeight: 1.4,
                    }}
                  >
                    💿 DVD Playback Notice: Please install <strong>VLC Media Player</strong> (
                    <span style={{ fontFamily: 'monospace' }}>videolan.org</span>) if DVD playback
                    libraries (<span style={{ fontFamily: 'monospace' }}>libdvdcss</span> /{' '}
                    <span style={{ fontFamily: 'monospace' }}>ffmpeg</span>) are missing on your
                    system.
                  </div>
                )}
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
                        ? '🔓 DVD CSS Active (VLC / libdvdcss)'
                        : '🔒 Unencrypted Only — Install VLC Media Player (videolan.org) for encrypted DVDs'}
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
                          onClick={() => {
                            const dev = opticalDisc.device_path || '/dev/sr0';
                            const dvdUri = `dvd://${dev}/${tInfo.title_number}`;
                            const meta: TrackMetadata = {
                              uri: dvdUri,
                              title: `${opticalDisc.album_title || 'DVD Video'} — ${tInfo.label}`,
                              artists: ['Optical DVD Video'],
                              album: opticalDisc.album_title || 'DVD Video',
                              album_id: null,
                              track_number: tInfo.title_number,
                              disc_number: 1,
                              art_url: opticalDisc.art_url || null,
                              duration_ms: tInfo.duration_ms,
                              source: 'dvd',
                            };
                            setPlayingContextId(`dvd:${dvdUri}`);
                            defaultSimpClient.loadQueue([dvdUri], 0, [meta]);
                            setView('lock');
                          }}
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
                  data-track-playing={track?.uri === t.uri ? 'true' : undefined}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).click();
                    }
                  }}
                  onClick={() => {
                    if (t.source === 'local_video' || t.uri.startsWith('video://local/')) {
                      openLocalVideoFile(t);
                      return;
                    }
                    if (
                      t.source === 'soundcloud' &&
                      Boolean(t.album?.includes('• Preview') || t.title.toLowerCase().includes('[preview]'))
                    ) {
                      showToast(
                        '🔒 30s Preview — Sign in to SoundCloud in Settings for full track playback'
                      );
                    }
                    const queueAlreadyMatches =
                      snap?.queue &&
                      snap.queue.length === browserTracks.length &&
                      snap.queue_index === i &&
                      snap.queue[i]?.uri === t.uri;
                    setPlayingContextId(currentCtxKey);
                    if (track?.uri === t.uri && playingContextId === currentCtxKey && queueAlreadyMatches) {
                      if (!snap?.is_playing) {
                        defaultSimpClient.play();
                      }
                      setView('lock');
                    } else {
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
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.title}
                        </span>
                        {t.source === 'soundcloud' &&
                          Boolean(
                            t.album?.includes('• Preview') || t.title.toLowerCase().includes('[preview]')
                          ) && (
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 800,
                                padding: '1px 5px',
                                borderRadius: 4,
                                background: '#3a1a08',
                                border: '1px solid #f59e0b',
                                color: '#fcd34d',
                                flexShrink: 0,
                              }}
                              title="Sign in to SoundCloud (Go+) in Settings for full track playback"
                            >
                              30s PREVIEW
                            </span>
                          )}
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
                            : t.source === 'internet_archive' ||
                              t.source === 'ia_video' ||
                              t.source === 'cdda'
                            ? '#261a0d'
                            : '#101822',
                        color:
                          t.source === 'apple_music'
                            ? '#fda4af'
                            : t.source === 'soundcloud'
                            ? '#fdba74'
                            : t.source === 'internet_archive' ||
                              t.source === 'ia_video' ||
                              t.source === 'cdda'
                            ? '#fcd34d'
                            : '#67e8f9',
                      }}
                    >
                      {(() => {
                        const fmt = extractAudioFormat(t.uri);
                        const fmtSuffix = fmt ? ` • ${fmt}` : '';
                        return t.source === 'apple_music'
                          ? '🍎 Apple'
                          : t.source === 'soundcloud'
                          ? '☁️ SC'
                          : t.source === 'ia_video'
                          ? '🎬 Archive'
                          : t.source === 'internet_archive'
                          ? '🏛️ Archive'
                          : t.source === 'local_video' || t.uri.startsWith('video://local/')
                          ? '🎬 Video'
                          : t.source === 'steam_ost'
                          ? `🎮 OST${fmtSuffix}`
                          : t.source === 'cdda'
                          ? '💿 CD'
                          : `💾 Local${fmtSuffix}`;
                      })()}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#71717a' }}>
                      {Math.floor(t.duration_ms / 60000)}:
                      {String(Math.floor((t.duration_ms / 1000) % 60)).padStart(2, '0')}
                    </span>
                    {t.artists.length > 0 && t.artists[0] && (
                      <button
                        data-row-aux="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          const src: 'soundcloud' | 'apple_music' | 'local' =
                            t.source === 'soundcloud'
                              ? 'soundcloud'
                              : t.source === 'apple_music'
                              ? 'apple_music'
                              : 'local';
                          openArtistProfile({
                            source: src,
                            idOrName: `name:${t.artists[0]}`,
                            displayName: t.artists[0],
                          });
                        }}
                        title={`Open Artist Profile for ${t.artists[0]}`}
                        style={{
                          padding: '5px 8px',
                          borderRadius: 8,
                          background: '#141622',
                          border: '1px solid #282c42',
                          color: '#cbd5e1',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        🎤
                      </button>
                    )}
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
                    {handleFavoriteTrack && (
                      <button
                        data-row-aux="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFavoriteTrack(t);
                        }}
                        title={
                          favoritedUris.includes(t.uri)
                            ? 'Unfavorite track'
                            : 'Favorite track (Local / SoundCloud Like / Apple Love)'
                        }
                        style={{
                          padding: '5px 8px',
                          borderRadius: 8,
                          background: favoritedUris.includes(t.uri) ? '#2a101b' : '#161620',
                          border: favoritedUris.includes(t.uri)
                            ? '1px solid #f43f5e'
                            : '1px solid #2e2e3c',
                          color: favoritedUris.includes(t.uri) ? '#fda4af' : '#a1a1aa',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        {favoritedUris.includes(t.uri) ? '❤️' : '♡'}
                      </button>
                    )}
                    {t.source === 'apple_music' && handleAddAppleToCloudLibrary && (
                      <button
                        data-row-aux="true"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddAppleToCloudLibrary(t.uri, 'songs', t.title);
                        }}
                        title="Add song to Apple Music Cloud Library"
                        style={{
                          padding: '5px 8px',
                          borderRadius: 8,
                          background: '#221019',
                          border: '1px solid #fb7185',
                          color: '#fda4af',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        ☁️+
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

            {browserTracks.length === 0 && !(browserTarget?.kind === 'cdda' && opticalDisc?.is_dvd_video) && (
              <div
                style={{
                  padding: '20px 14px',
                  borderRadius: 12,
                  background: '#0a0a0e',
                  border: '1px solid #16161e',
                  fontSize: 13,
                  color: '#8e8e99',
                  textAlign: 'center',
                }}
              >
                {cloudLoading || iaLoading
                  ? '⏳ Loading tracks...'
                  : 'No streamable tracks available in this collection.'}
              </div>
            )}
          </div>
        )}
      </div>

      {activeDvdPlayback && opticalDisc && (
        <DvdPlayerModal
          mode="dvd"
          devicePath={opticalDisc.device_path || '/dev/sr0'}
          discTitle={opticalDisc.album_title || 'DVD Video'}
          titleInfo={activeDvdPlayback.titleInfo}
          initialChapter={activeDvdPlayback.chapter}
          initialAudioIndex={activeDvdPlayback.audioIdx}
          initialSubtitleIndex={activeDvdPlayback.subIdx}
          onClose={() => setActiveDvdPlayback(null)}
        />
      )}

      {activeVideoModal && (
        <DvdPlayerModal
          mode={activeVideoModal.mode}
          discTitle={activeVideoModal.title}
          episodes={activeVideoModal.episodes}
          initialEpisodeIndex={activeVideoModal.initialEpisodeIndex ?? 0}
          onClose={() => setActiveVideoModal(null)}
        />
      )}
    </main>
  );
};
