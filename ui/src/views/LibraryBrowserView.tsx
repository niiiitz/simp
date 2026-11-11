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
import { SoundCloudAttributionLink, SoundCloudLogo } from '../components/SoundCloudLogo';
import { AppleMusicAttributionLink } from '../components/AppleMusicLogo';
import { LibraryMiniPlayerBar } from './library/LibraryMiniPlayerBar';
import { LibraryContextMenuModal } from './library/LibraryContextMenuModal';
import { LibraryArtistProfilePane } from './library/LibraryArtistProfilePane';
import { LibraryContextLegendBar } from './library/LibraryContextLegendBar';
import { LibraryXmbLeftColumn } from './library/panes/LibraryXmbLeftColumn';
import { LibraryBrowseRightPane } from './library/panes/LibraryBrowseRightPane';
import { LibraryTracklistRightPane } from './library/panes/LibraryTracklistRightPane';
import {
  AlphaBucket,
  cleanCollectionTitle,
  CLOUD_PAGE_SIZE,
  extractAudioFormat,
  formatPlaylistSourceBadge,
  iaItemCountCache,
  iaItemCountPending,
  matchesAlphaBucket,
  tileGridStyle,
} from './library/libraryHelpers';
import {
  failedPlaylistCoverLookupIds,
  ResilientTileArtwork,
  resolvedPlaylistCoverMemoryCache,
} from './library/ResilientTileArtwork';
import {
  LocalArtistCard,
  SimpAlbumCard,
  SimpPlaylistCard,
} from './library/cards/LocalCollectionCards';
import {
  AppleArtistCard,
  CloudAlbumCard,
  CloudPlaylistCard,
  StationCard,
} from './library/cards/AppleMusicCards';
import {
  ArchiveItemCard,
  SoundCloudPlaylistCard,
  SoundCloudUserCard,
} from './library/cards/SoundCloudAndArchiveCards';
import { SingleSongRow } from './library/cards/SingleSongRow';
import { OskTargetKind } from '../hooks/useGamepadNavigation';
import { BrowserTarget, isUiVideoTrack } from './PlayerView';
import { SourceVisibilityPrefs } from './SettingsModal';

export type LibraryContextTarget =
  | {
      type: 'track';
      track: TrackMetadata;
      peerList: TrackMetadata[];
      isViewingLocalPlaylist?: boolean;
    }
  | {
      type: 'collection';
      kind:
        | 'simp_playlist'
        | 'simp_album'
        | 'cloud_playlist'
        | 'cloud_album'
        | 'sc_playlist'
        | 'ia_item';
      id: string;
      title: string;
      subtitle?: string;
      art_url?: string | null;
      artistName?: string;
      source: 'local' | 'apple_music' | 'soundcloud' | 'internet_archive';
      rawItem: any;
    };

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
  artistRadioShows?: AppleCloudPlaylistSummary[];
  setArtistRadioShows?: React.Dispatch<React.SetStateAction<AppleCloudPlaylistSummary[]>>;
  clubMixes?: AppleCloudPlaylistSummary[];
  setClubMixes?: React.Dispatch<React.SetStateAction<AppleCloudPlaylistSummary[]>>;
  genreRadioStations?: AppleRadioStationSummary[];
  setGenreRadioStations?: React.Dispatch<React.SetStateAction<AppleRadioStationSummary[]>>;
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
  artistRadioShows = [],
  setArtistRadioShows,
  clubMixes = [],
  setClubMixes,
  genreRadioStations = [],
  setGenreRadioStations,
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
    'all' | 'stations' | 'new_releases' | 'recently_played' | 'mixes' | 'social' | 'recent_library'
  >('all');
  const [appleRadioFilter, setAppleRadioFilter] = useState<
    'all' | 'live' | 'shows' | 'mixes' | 'genre'
  >('all');
  const [appleRadioGenre, setAppleRadioGenre] = useState<string>('');
  const [libraryContextTarget, setLibraryContextTarget] = useState<LibraryContextTarget | null>(
    null
  );
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

  const openLibraryContextMenu = useCallback(
    (target: LibraryContextTarget) => {
      setLibraryContextTarget(target);
      window.setTimeout(() => {
        const firstBtn = document.querySelector<HTMLElement>(
          '[data-library-context-modal="true"] button[data-default-focus="true"], [data-library-context-modal="true"] button:not([disabled])'
        );
        if (firstBtn) applyFocusMarker(firstBtn);
      }, 30);
    },
    [applyFocusMarker]
  );

  // Inserts one or more tracks into the active playback queue immediately after the current track
  // (`snap.queue_index + 1`) without wiping or restarting the rest of the playing album/playlist.
  const handlePlayTracksNext = useCallback(
    (tracksToInsert: TrackMetadata[], label: string) => {
      if (tracksToInsert.length === 0) return;
      const currentQueue = snap?.queue || [];
      if (currentQueue.length === 0 || !track) {
        defaultSimpClient.loadQueue(
          tracksToInsert.map((t) => t.uri),
          0,
          tracksToInsert
        );
        showToast(`Playing ${label}`);
        return;
      }
      const curIdx = Math.max(
        0,
        Math.min(currentQueue.length - 1, snap?.queue_index ?? 0)
      );
      const nextQueue = [
        ...currentQueue.slice(0, curIdx + 1),
        ...tracksToInsert,
        ...currentQueue.slice(curIdx + 1),
      ];
      defaultSimpClient.loadQueue(
        nextQueue.map((t) => t.uri),
        curIdx,
        nextQueue
      );
      showToast(`⏭ Queued ${label} to play next`);
    },
    [snap?.queue, snap?.queue_index, track, showToast]
  );

  const resolveCollectionTracks = useCallback(
    async (
      target: Extract<LibraryContextTarget, { type: 'collection' }>
    ): Promise<TrackMetadata[]> => {
      if (target.kind === 'simp_playlist') {
        return defaultSimpClient.query<TrackMetadata[]>('get_playlist_items', {
          playlist_id: target.id,
          limit: 2000,
          offset: 0,
        });
      }
      if (target.kind === 'simp_album') {
        return defaultSimpClient.query<TrackMetadata[]>('get_album_tracks', {
          album_id: target.id,
        });
      }
      if (target.kind === 'cloud_playlist') {
        const pl = target.rawItem as AppleCloudPlaylistSummary;
        return fetchApplePlaylistTracks(pl.id, pl.kind);
      }
      if (target.kind === 'cloud_album') {
        const alb = target.rawItem as AppleCloudAlbumSummary;
        const { tracks } = await fetchFullAppleAlbum({ albumId: alb.id });
        return tracks;
      }
      if (target.kind === 'sc_playlist') {
        const pl = target.rawItem as SoundCloudPlaylistSummary;
        const items = await fetchSoundCloudPlaylistTracks(pl.id).catch(() => []);
        return items.length > 0 ? items : pl.tracks || [];
      }
      if (target.kind === 'ia_item') {
        const item = target.rawItem as ArchiveItemSummary;
        const resp = await fetch(
          resolveDaemonUrl(`/api/ia/item?id=${encodeURIComponent(item.identifier)}`)
        );
        const d = await resp.json();
        const detail: ArchiveItemDetail | undefined = d?.detail || d?.data;
        return detail?.tracks || [];
      }
      return [];
    },
    [resolveDaemonUrl]
  );

  // Listen for `SELECT` (Contextual Action Menu) and `Y` (Pin/Unpin to SIMP) gamepad/keyboard actions
  useEffect(() => {
    if (hidden) return;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ op: 'y' | 'select' }>).detail;
      if (!detail) return;
      const focused = document.querySelector<HTMLElement>('[data-simp-active-focus="true"]');

      if (detail.op === 'select') {
        if (libraryContextTarget) {
          setLibraryContextTarget(null);
          return;
        }
        // 1. Focused on (or inside) a single track row -> open its `[data-context-select="true"]` menu (or fallback to `[data-track-select="true"]`)
        const trackRow = focused?.closest<HTMLElement>(
          '[data-right-track="true"], [data-single-song-row="true"]'
        );
        const trackCtxBtn =
          focused?.querySelector<HTMLElement>('[data-context-select="true"]') ||
          trackRow?.querySelector<HTMLElement>('[data-context-select="true"]') ||
          focused?.querySelector<HTMLElement>('[data-track-select="true"]') ||
          trackRow?.querySelector<HTMLElement>('[data-track-select="true"]');
        if (trackCtxBtn) {
          trackCtxBtn.click();
          return;
        }

        // 2. Focused on a Right-Pane Collection Tile -> open its `[data-context-select="true"]` menu (or fallback to `[data-tile-select="true"]`)
        const tileEl =
          focused?.dataset.rightTile === 'true'
            ? focused
            : focused?.closest<HTMLElement>('[data-right-tile="true"]');
        if (tileEl) {
          const tileCtxBtn =
            tileEl.querySelector<HTMLElement>('[data-context-select="true"]') ||
            tileEl.querySelector<HTMLElement>('[data-tile-select="true"]');
          if (tileCtxBtn) {
            tileCtxBtn.click();
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
    libraryContextTarget,
  ]);

  // Context Legend & Collection Action Bar (Target pill retired; SELECT/Y badges hidden in mouse mode)
  const renderContextLegendBar = () => (
    <LibraryContextLegendBar
      rightPaneMode={rightPaneMode}
      browserTarget={browserTarget}
      selectedPlaylistObj={selectedPlaylistObj}
      selectedAlbumObj={selectedAlbumObj}
      activeCloudPlaylist={activeCloudPlaylist}
      activeScPlaylist={activeScPlaylist}
      activeCloudAlbum={activeCloudAlbum}
      activeIaDetail={activeIaDetail}
      playlists={playlists}
      albums={albums}
      browserTracks={browserTracks}
      canWalkBackInBrowse={canWalkBackInBrowse}
      handleWalkBack={handleWalkBack}
      handleAddTracksToPlaylist={handleAddTracksToPlaylist}
      handleDeletePlaylist={handleDeletePlaylist}
      handlePinCloudPlaylist={handlePinCloudPlaylist}
      handlePinSoundCloudPlaylist={handlePinSoundCloudPlaylist}
      handleDeleteAlbum={handleDeleteAlbum}
      handlePinCloudAlbum={handlePinCloudAlbum}
      handlePinArchiveItem={handlePinArchiveItem}
      handleTogglePinLocalAlbum={handleTogglePinLocalAlbum}
      setRightPaneMode={setRightPaneMode}
    />
  );

  const renderSimpPlaylistCard = (pl: PlaylistRecord) => (
    <SimpPlaylistCard
      key={pl.id}
      pl={pl}
      activePlaylistId={activePlaylistId}
      rightPaneMode={rightPaneMode}
      browserTarget={browserTarget}
      setActivePlaylistId={setActivePlaylistId}
      selectLocalCollection={selectLocalCollection}
      openLibraryContextMenu={openLibraryContextMenu}
      handleAddSimpPlaylistToHybrid={handleAddSimpPlaylistToHybrid}
      handleDeletePlaylist={handleDeletePlaylist}
    />
  );

  const renderSimpAlbumCard = (alb: AlbumRecord) => (
    <SimpAlbumCard
      key={alb.id}
      alb={alb}
      playlists={playlists}
      rightPaneMode={rightPaneMode}
      browserTarget={browserTarget}
      selectLocalCollection={selectLocalCollection}
      openLibraryContextMenu={openLibraryContextMenu}
      handleAddSimpAlbumToHybrid={handleAddSimpAlbumToHybrid}
      handleDeleteAlbum={handleDeleteAlbum}
      handleTogglePinLocalAlbum={handleTogglePinLocalAlbum}
    />
  );

  const renderCloudPlaylistCard = (pl: AppleCloudPlaylistSummary) => (
    <CloudPlaylistCard
      key={pl.id}
      pl={pl}
      playlists={playlists}
      browserTarget={browserTarget}
      selectCloudPlaylist={selectCloudPlaylist}
      setCloudPlaylists={setCloudPlaylists}
      openLibraryContextMenu={openLibraryContextMenu}
      handleAddAppleToCloudLibrary={handleAddAppleToCloudLibrary}
      handleAddCloudPlaylistToHybrid={handleAddCloudPlaylistToHybrid}
      handleDeletePlaylist={handleDeletePlaylist}
      handlePinCloudPlaylist={handlePinCloudPlaylist}
    />
  );

  const renderCloudAlbumCard = (alb: AppleCloudAlbumSummary) => (
    <CloudAlbumCard
      key={alb.id}
      alb={alb}
      albums={albums}
      browserTarget={browserTarget}
      selectCloudAlbum={selectCloudAlbum}
      openLibraryContextMenu={openLibraryContextMenu}
      handleAddAppleToCloudLibrary={handleAddAppleToCloudLibrary}
      handleAddCloudAlbumToHybrid={handleAddCloudAlbumToHybrid}
      handleDeleteAlbum={handleDeleteAlbum}
      setCloudLoading={setCloudLoading}
      handlePinCloudAlbum={handlePinCloudAlbum}
    />
  );

  const renderStationCard = (st: AppleRadioStationSummary) => (
    <StationCard
      key={st.id}
      st={st}
      playingContextId={playingContextId}
      handleStartAppleStation={handleStartAppleStation}
    />
  );

  const renderSoundCloudPlaylistCard = (pl: SoundCloudPlaylistSummary) => (
    <SoundCloudPlaylistCard
      key={pl.id}
      pl={pl}
      playlists={playlists}
      browserTarget={browserTarget}
      selectSoundCloudPlaylist={selectSoundCloudPlaylist}
      openLibraryContextMenu={openLibraryContextMenu}
      handleAddSoundCloudPlaylistToHybrid={handleAddSoundCloudPlaylistToHybrid}
      handleDeletePlaylist={handleDeletePlaylist}
      handlePinSoundCloudPlaylist={handlePinSoundCloudPlaylist}
    />
  );

  const renderSoundCloudUserCard = (user: SoundCloudUserSummary) => (
    <SoundCloudUserCard
      key={user.id}
      user={user}
      browserTarget={browserTarget}
      selectSoundCloudUser={selectSoundCloudUser}
    />
  );

  const renderAppleArtistCard = (artist: AppleArtistSummary) => (
    <AppleArtistCard
      key={artist.id}
      artist={artist}
      isSelected={
        rightPaneMode === "artist" &&
        activeArtistProfile?.source === "apple_music" &&
        activeArtistProfile?.idOrName === artist.id
      }
      onSelect={() =>
        openArtistProfile({
          source: "apple_music",
          idOrName: artist.id,
          displayName: artist.name,
        })
      }
    />
  );

  const renderLocalArtistCard = (
    artistName: string,
    artUrl?: string | null,
    subtitle?: string
  ) => (
    <LocalArtistCard
      key={`local-artist-${artistName}`}
      artistName={artistName}
      artUrl={artUrl}
      subtitle={subtitle}
      isSelected={
        rightPaneMode === "artist" &&
        activeArtistProfile?.source === "local" &&
        activeArtistProfile?.displayName.toLowerCase() === artistName.toLowerCase()
      }
      onSelect={() =>
        openArtistProfile({
          source: "local",
          idOrName: `name:${artistName}`,
          displayName: artistName,
        })
      }
    />
  );

  const renderArchiveItemCard = (item: ArchiveItemSummary) => (
    <ArchiveItemCard
      key={item.identifier}
      item={item}
      playlists={playlists}
      browserTarget={browserTarget}
      iaResolvedCounts={iaResolvedCounts}
      openIaItem={openIaItem}
      openLibraryContextMenu={openLibraryContextMenu}
      handleAddArchiveItemToHybrid={handleAddArchiveItemToHybrid}
      handleDeletePlaylist={handleDeletePlaylist}
      handlePinArchiveItem={handlePinArchiveItem}
    />
  );

  const renderSingleSongRow = (s: TrackMetadata, peerList: TrackMetadata[], ctxPrefix: string) => (
    <SingleSongRow
      key={`${ctxPrefix}-${s.uri}`}
      song={s}
      peerList={peerList}
      ctxPrefix={ctxPrefix}
      track={track}
      snap={snap}
      favoritedUris={favoritedUris}
      scLikedTracks={scLikedTracks}
      openLocalVideoFile={openLocalVideoFile}
      showToast={showToast}
      setPlayingContextId={setPlayingContextId}
      setView={setView}
      openLibraryContextMenu={openLibraryContextMenu}
      openArtistProfile={openArtistProfile}
      handleFavoriteTrack={handleFavoriteTrack}
      handleAddTracksToPlaylist={handleAddTracksToPlaylist}
      handleStartSoundCloudTrackRadio={handleStartSoundCloudTrackRadio}
      handleAddAppleToCloudLibrary={handleAddAppleToCloudLibrary}
      selectCloudAlbum={selectCloudAlbum}
    />
  );

  return (
    <main
      style={{
        flex: 1,
        display: hidden ? 'none' : 'grid',
        gridTemplateColumns: 'minmax(250px, 32%) minmax(0, 68%)',
        gridTemplateRows: track ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)',
        overflow: 'hidden',
        boxSizing: 'border-box',
        width: '100%',
        minWidth: 0,
      }}
    >
      {/* =====================================================================
          TOP MINI-PLAYER BAR (Spans Full Width Above Left + Right Columns)
         ===================================================================== */}
      {track && (
        <LibraryMiniPlayerBar
          track={track}
          snap={snap}
          hidden={hidden}
          onReturnToPlayer={() => setView('lock')}
        />
      )}
      <LibraryXmbLeftColumn
        browserSourceFilter={browserSourceFilter}
        setBrowserSourceFilter={setBrowserSourceFilter}
        selectedSources={selectedSources}
        setSelectedSources={setSelectedSources}
        setBrowserSourceFilterRaw={setBrowserSourceFilterRaw}
        browserSearch={browserSearch}
        setBrowserSearch={setBrowserSearch}
        setOskTarget={setOskTarget}
        sourceVisibility={sourceVisibility}
        snap={snap}
        appleAuthState={appleAuthState}
        pushCurrentNavState={pushCurrentNavState}
        appleSubTab={appleSubTab}
        setAppleSubTab={setAppleSubTab}
        soundCloudSubTab={soundCloudSubTab}
        setSoundCloudSubTab={setSoundCloudSubTab}
        iaSubTab={iaSubTab}
        setIaSubTab={setIaSubTab}
        setIaSubFilter={setIaSubFilter}
        rightPaneMode={rightPaneMode}
        setRightPaneMode={setRightPaneMode}
        activeMountRoot={activeMountRoot}
        setActiveMountRoot={setActiveMountRoot}
        mediaTypeFilter={mediaTypeFilter}
        setMediaTypeFilter={setMediaTypeFilter}
        placesOpen={placesOpen}
        togglePlacesOpen={togglePlacesOpen}
        filteredPlaylists={filteredPlaylists}
        filteredAlbums={filteredAlbums}
        pinnedAppleAlbumCount={pinnedAppleAlbumCount}
        scLikedTracks={scLikedTracks}
        scPlaylists={scPlaylists}
        cloudPlaylists={cloudPlaylists}
        xmbPreviewTriggerRef={xmbPreviewTriggerRef}
        focusRightPaneFirstTile={focusRightPaneFirstTile}
        isSourceIncluded={isSourceIncluded}
        opticalDisc={opticalDisc}
        cdScanning={cdScanning}
        browserTarget={browserTarget}
        selectLocalCollection={selectLocalCollection}
        setBrowserTracks={setBrowserTracks}
        handleScanOpticalDisc={handleScanOpticalDisc}
        handleEjectOpticalDisc={handleEjectOpticalDisc}
        setSourceModalOpen={setSourceModalOpen}
        playlistsOpen={playlistsOpen}
        togglePlaylistsOpen={togglePlaylistsOpen}
        creatingPlaylist={creatingPlaylist}
        setCreatingPlaylist={setCreatingPlaylist}
        newPlaylistName={newPlaylistName}
        setNewPlaylistName={setNewPlaylistName}
        handleCreatePlaylist={handleCreatePlaylist}
        activePlaylistId={activePlaylistId}
        setActivePlaylistId={setActivePlaylistId}
      />

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
          <LibraryBrowseRightPane
            activeHubLabel={activeHubLabel}
            activeMountPlaceObj={activeMountPlaceObj}
            appleAuthState={appleAuthState}
            appleRadioFilter={appleRadioFilter}
            appleRadioGenre={appleRadioGenre}
            appleRecentlyPlayedTracks={appleRecentlyPlayedTracks}
            appleSubTab={appleSubTab}
            artistRadioShows={artistRadioShows}
            browserSearch={browserSearch}
            browserSourceFilter={browserSourceFilter}
            catalogSearchResults={catalogSearchResults}
            cloudAlpha={cloudAlpha}
            cloudLoading={cloudLoading}
            cloudPlaylists={cloudPlaylists}
            clubMixes={clubMixes}
            creatingPlaylist={creatingPlaylist}
            filteredAlbums={filteredAlbums}
            filteredCloudPlaylists={filteredCloudPlaylists}
            filteredIaItems={filteredIaItems}
            filteredIaSearchResults={filteredIaSearchResults}
            filteredLocalSearchTracks={filteredLocalSearchTracks}
            filteredPlaylists={filteredPlaylists}
            filteredRecentlyPlayed={filteredRecentlyPlayed}
            forYouAlbums={forYouAlbums}
            forYouFilter={forYouFilter}
            forYouNewReleases={forYouNewReleases}
            forYouPlaylists={forYouPlaylists}
            forYouShelves={forYouShelves}
            genreRadioStations={genreRadioStations}
            handleAddTracksToPlaylist={handleAddTracksToPlaylist}
            handleCreatePlaylist={handleCreatePlaylist}
            handleDeletePlaylist={handleDeletePlaylist}
            handlePinArchiveCollection={handlePinArchiveCollection}
            handleStartSoundCloudTrackRadio={handleStartSoundCloudTrackRadio}
            hybridPlaylistsList={hybridPlaylistsList}
            iaHasMore={iaHasMore}
            iaLoading={iaLoading}
            iaLoadingMore={iaLoadingMore}
            iaSearchHasMore={iaSearchHasMore}
            iaSearchLoadingMore={iaSearchLoadingMore}
            iaSubFilter={iaSubFilter}
            iaSubTab={iaSubTab}
            isSourceIncluded={isSourceIncluded}
            liveRadioStations={liveRadioStations}
            loadIaDiscover={loadIaDiscover}
            loadMoreIaDiscover={loadMoreIaDiscover}
            loadMoreIaSearch={loadMoreIaSearch}
            loadMoreScDiscover={loadMoreScDiscover}
            loadMoreScSearch={loadMoreScSearch}
            localVideos={localVideos}
            mediaTypeFilter={mediaTypeFilter}
            mountAlbums={mountAlbums}
            mountTracks={mountTracks}
            newFeedAlbums={newFeedAlbums}
            newFeedPlaylists={newFeedPlaylists}
            newFeedRecentReleases={newFeedRecentReleases}
            newFeedSongs={newFeedSongs}
            newFilter={newFilter}
            newPlaylistName={newPlaylistName}
            pagedCloudPlaylists={pagedCloudPlaylists}
            personalRadioStations={personalRadioStations}
            pinnedPlaylistsList={pinnedPlaylistsList}
            playlists={playlists}
            radioStations={radioStations}
            recentlyAddedCloudAlbums={recentlyAddedCloudAlbums}
            recentlyPlayed={recentlyPlayed}
            renderAppleArtistCard={renderAppleArtistCard}
            renderArchiveItemCard={renderArchiveItemCard}
            renderCloudAlbumCard={renderCloudAlbumCard}
            renderCloudPlaylistCard={renderCloudPlaylistCard}
            renderLocalArtistCard={renderLocalArtistCard}
            renderSimpAlbumCard={renderSimpAlbumCard}
            renderSimpPlaylistCard={renderSimpPlaylistCard}
            renderSingleSongRow={renderSingleSongRow}
            renderSoundCloudPlaylistCard={renderSoundCloudPlaylistCard}
            renderSoundCloudUserCard={renderSoundCloudUserCard}
            renderStationCard={renderStationCard}
            safeCloudPage={safeCloudPage}
            scCatalogSearchResults={scCatalogSearchResults}
            scDiscoverNextHref={scDiscoverNextHref}
            scFollowings={scFollowings}
            scFreshUploads={scFreshUploads}
            scLikedTracks={scLikedTracks}
            scLikesFilter={scLikesFilter}
            scLoadingMore={scLoadingMore}
            scMoreOfWhatYouLike={scMoreOfWhatYouLike}
            scPlaylists={scPlaylists}
            scRecommendedArtists={scRecommendedArtists}
            scSelectedGenre={scSelectedGenre}
            scStreamFilter={scStreamFilter}
            scStreamPlaylists={scStreamPlaylists}
            scStreamTracks={scStreamTracks}
            scTrendingFilter={scTrendingFilter}
            scTrendingMixes={scTrendingMixes}
            scTrendingPlaylists={scTrendingPlaylists}
            scTrendingTracks={scTrendingTracks}
            searchLower={searchLower}
            searchMatchedPlaylists={searchMatchedPlaylists}
            searchPreferredSource={searchPreferredSource}
            setAppleRadioFilter={setAppleRadioFilter}
            setAppleRadioGenre={setAppleRadioGenre}
            setAppleRecentlyPlayedTracks={setAppleRecentlyPlayedTracks}
            setArtistRadioShows={setArtistRadioShows}
            setCloudAlpha={setCloudAlpha}
            setCloudLoading={setCloudLoading}
            setCloudPage={setCloudPage}
            setCloudPlaylists={setCloudPlaylists}
            setClubMixes={setClubMixes}
            setForYouAlbums={setForYouAlbums}
            setForYouFilter={setForYouFilter}
            setForYouNewReleases={setForYouNewReleases}
            setForYouPlaylists={setForYouPlaylists}
            setForYouShelves={setForYouShelves}
            setGenreRadioStations={setGenreRadioStations}
            setIaSubFilter={setIaSubFilter}
            setLiveRadioStations={setLiveRadioStations}
            setNewFeedAlbums={setNewFeedAlbums}
            setNewFeedPlaylists={setNewFeedPlaylists}
            setNewFeedRecentReleases={setNewFeedRecentReleases}
            setNewFeedSongs={setNewFeedSongs}
            setNewFilter={setNewFilter}
            setNewPlaylistName={setNewPlaylistName}
            setOskTarget={setOskTarget}
            setPersonalRadioStations={setPersonalRadioStations}
            setPlayingContextId={setPlayingContextId}
            setRadioStations={setRadioStations}
            setRecentlyAddedCloudAlbums={setRecentlyAddedCloudAlbums}
            setScDiscoverNextHref={setScDiscoverNextHref}
            setScFollowings={setScFollowings}
            setScLikedTracks={setScLikedTracks}
            setScLikesFilter={setScLikesFilter}
            setScPlaylists={setScPlaylists}
            setScSelectedGenre={setScSelectedGenre}
            setScStreamFilter={setScStreamFilter}
            setScStreamPlaylists={setScStreamPlaylists}
            setScStreamTracks={setScStreamTracks}
            setScTrendingFilter={setScTrendingFilter}
            setScTrendingMixes={setScTrendingMixes}
            setScTrendingPlaylists={setScTrendingPlaylists}
            setScTrendingTracks={setScTrendingTracks}
            setSimpHubFilter={setSimpHubFilter}
            setSourceModalOpen={setSourceModalOpen}
            setView={setView}
            simpHubFilter={simpHubFilter}
            snap={snap}
            soundCloudSubTab={soundCloudSubTab}
            totalCloudPages={totalCloudPages}
          />
        ) : rightPaneMode === 'artist' && activeArtistProfile ? (
          /* =================================================================
             STATE A.5: 🎤 DEDICATED ARTIST PROFILE & RABBIT HOLE VIEW
             ================================================================= */
          <LibraryArtistProfilePane
            activeArtistProfile={activeArtistProfile}
            setActiveArtistProfile={setActiveArtistProfile}
            handleWalkBack={handleWalkBack}
            setPlayingContextId={setPlayingContextId}
            setView={setView}
            scFollowings={scFollowings}
            setScFollowings={setScFollowings}
            showToast={showToast}
            loadMoreArtistTracks={loadMoreArtistTracks}
            tileGridStyle={tileGridStyle}
            renderSingleSongRow={renderSingleSongRow}
            renderSoundCloudPlaylistCard={renderSoundCloudPlaylistCard}
            renderCloudAlbumCard={renderCloudAlbumCard}
            renderSimpAlbumCard={renderSimpAlbumCard}
            renderSoundCloudUserCard={renderSoundCloudUserCard}
            renderAppleArtistCard={renderAppleArtistCard}
          />
        ) : (
          <LibraryTracklistRightPane
            activeHubLabel={activeHubLabel}
            activeIaDetail={activeIaDetail}
            activeScPlaylist={activeScPlaylist}
            browserTarget={browserTarget}
            browserTracks={browserTracks}
            cdScanning={cdScanning}
            cloudLoading={cloudLoading}
            dvdAudioChoice={dvdAudioChoice}
            dvdSubChoice={dvdSubChoice}
            favoritedUris={favoritedUris}
            focusRightPaneFirstTile={focusRightPaneFirstTile}
            handleAddAppleToCloudLibrary={handleAddAppleToCloudLibrary}
            handleAddTracksToPlaylist={handleAddTracksToPlaylist}
            handleEjectOpticalDisc={handleEjectOpticalDisc}
            handleFavoriteTrack={handleFavoriteTrack}
            handleRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
            handleScanOpticalDisc={handleScanOpticalDisc}
            handleStartSoundCloudTrackRadio={handleStartSoundCloudTrackRadio}
            handleWalkBack={handleWalkBack}
            iaLoading={iaLoading}
            navHistory={navHistory}
            openArtistProfile={openArtistProfile}
            openLibraryContextMenu={openLibraryContextMenu}
            openLocalVideoFile={openLocalVideoFile}
            opticalDisc={opticalDisc}
            playingContextId={playingContextId}
            selectCloudAlbum={selectCloudAlbum}
            selectedAlbumObj={selectedAlbumObj}
            selectedMountObj={selectedMountObj}
            selectedPlaylistObj={selectedPlaylistObj}
            setActiveDvdPlayback={setActiveDvdPlayback}
            setDvdAudioChoice={setDvdAudioChoice}
            setDvdSubChoice={setDvdSubChoice}
            setPlayingContextId={setPlayingContextId}
            setRightPaneMode={setRightPaneMode}
            setView={setView}
            showToast={showToast}
            snap={snap}
            track={track}
          />
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

      {/* Contextual SELECT Action Menu Modal */}
      {libraryContextTarget && (
        <LibraryContextMenuModal
          target={libraryContextTarget}
          onClose={() => setLibraryContextTarget(null)}
          favoritedUris={favoritedUris}
          writablePlaylists={writablePlaylists}
          activePlaylistId={activePlaylistId}
          cleanCollectionTitle={cleanCollectionTitle}
          cycleTargetHybridPlaylist={cycleTargetHybridPlaylist}
          handlePlayTracksNext={handlePlayTracksNext}
          handleAddTracksToPlaylist={handleAddTracksToPlaylist}
          handleFavoriteTrack={handleFavoriteTrack}
          handleAddAppleToCloudLibrary={handleAddAppleToCloudLibrary}
          albums={albums}
          selectCloudAlbum={selectCloudAlbum}
          selectLocalCollection={selectLocalCollection}
          openArtistProfile={openArtistProfile}
          handleStartSoundCloudTrackRadio={handleStartSoundCloudTrackRadio}
          browserTarget={browserTarget}
          handleRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
          setPlayingContextId={setPlayingContextId}
          setView={setView}
          resolveCollectionTracks={resolveCollectionTracks}
          showToast={showToast}
          handleAddSimpPlaylistToHybrid={handleAddSimpPlaylistToHybrid}
          handleAddSimpAlbumToHybrid={handleAddSimpAlbumToHybrid}
          handleAddArchiveItemToHybrid={handleAddArchiveItemToHybrid}
          handlePinCloudPlaylist={handlePinCloudPlaylist}
          handlePinCloudAlbum={handlePinCloudAlbum}
          handlePinSoundCloudPlaylist={handlePinSoundCloudPlaylist}
          handlePinArchiveItem={handlePinArchiveItem}
          handleDeletePlaylist={handleDeletePlaylist}
          handleDeleteAlbum={handleDeleteAlbum}
        />
      )}
    </main>
  );
};
