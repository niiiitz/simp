import React from "react";
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
} from "@simp/client";
import {
  AppleArtistSummary,
  AppleCatalogSearchResults,
  AppleCloudAlbumSummary,
  AppleCloudPlaylistSummary,
  AppleRadioStationSummary,
  AppleRecommendationShelf,
  fetchAppleCloudPlaylists,
  fetchAppleLibraryRecentlyAdded,
  fetchAppleNewFeed,
  fetchAppleRadioAndForYou,
} from "../../../drivers/AppleMusicDriver";
import {
  fetchSoundCloudDiscover,
  fetchSoundCloudFollowings,
  fetchSoundCloudLikesAndPlaylists,
  fetchSoundCloudStreamAndRadio,
  SoundCloudCatalogSearchResults,
  SoundCloudPlaylistSummary,
  SoundCloudUserSummary,
} from "../../../drivers/SoundCloudDriver";
import { SoundCloudAttributionLink, SoundCloudLogo } from "../../../components/SoundCloudLogo";
import { AppleMusicAttributionLink } from "../../../components/AppleMusicLogo";
import { isUiVideoTrack } from "../../PlayerView";
import {
  AlphaBucket,
  cleanCollectionTitle,
  CLOUD_PAGE_SIZE,
  extractAudioFormat,
  formatPlaylistSourceBadge,
  tileGridStyle,
} from "../libraryHelpers";
import { ResilientTileArtwork } from "../ResilientTileArtwork";
import { UniversalSearchResultsPane } from "./UniversalSearchResultsPane";
import { AppleMusicDiscoverPane } from "./AppleMusicDiscoverPane";
import { SoundCloudDiscoverPane } from "./SoundCloudDiscoverPane";
import { InternetArchiveDiscoverPane } from "./InternetArchiveDiscoverPane";
import { ImpIcon } from "../../../components/icons/ImpIcon";

export interface LibraryBrowseRightPaneProps {
  activeHubLabel: string;
  activeMountPlaceObj: { mount_root: string; label: string; track_count: number; is_online: boolean } | null | undefined;
  appleAuthState: "connected" | "reauth_required" | "never_used";
  appleRadioFilter: "all" | "genre" | "live" | "shows" | "mixes";
  appleRadioGenre: string;
  appleRecentlyPlayedTracks: TrackMetadata[];
  appleSubTab: "pinned" | "for_you" | "cloud_playlists" | "new" | "radio";
  artistRadioShows: AppleCloudPlaylistSummary[];
  browserSearch: string;
  browserSourceFilter: "all" | "local" | "apple_music" | "soundcloud" | "internet_archive";
  catalogSearchResults: AppleCatalogSearchResults;
  cloudAlpha: AlphaBucket;
  cloudLoading: boolean;
  cloudPlaylists: AppleCloudPlaylistSummary[];
  clubMixes: AppleCloudPlaylistSummary[];
  creatingPlaylist: boolean;
  filteredAlbums: AlbumRecord[];
  filteredCloudPlaylists: AppleCloudPlaylistSummary[];
  filteredIaItems: ArchiveItemSummary[];
  filteredIaSearchResults: ArchiveItemSummary[];
  filteredLocalSearchTracks: TrackMetadata[];
  filteredPlaylists: PlaylistRecord[];
  filteredRecentlyPlayed: TrackMetadata[];
  forYouAlbums: AppleCloudAlbumSummary[];
  forYouFilter: "all" | "stations" | "new_releases" | "recently_played" | "mixes" | "social" | "recent_library";
  forYouNewReleases: AppleCloudAlbumSummary[];
  forYouPlaylists: AppleCloudPlaylistSummary[];
  forYouShelves: AppleRecommendationShelf[];
  genreRadioStations: AppleRadioStationSummary[];
  handleAddTracksToPlaylist: any;
  handleCreatePlaylist: any;
  handleDeletePlaylist: any;
  handlePinArchiveCollection: any;
  handleStartSoundCloudTrackRadio: any;
  hybridPlaylistsList: PlaylistRecord[];
  iaHasMore: boolean;
  iaLoading: boolean;
  iaLoadingMore: boolean;
  iaSearchHasMore: boolean;
  iaSearchLoadingMore: boolean;
  iaSubFilter: string;
  iaSubTab: "pinned" | "trending" | "films" | "tv" | "audio";
  isSourceIncluded: any;
  liveRadioStations: AppleRadioStationSummary[];
  loadIaDiscover: any;
  loadMoreIaDiscover: any;
  loadMoreIaSearch: any;
  loadMoreScDiscover: any;
  loadMoreScSearch: any;
  localVideos: TrackMetadata[];
  mediaTypeFilter: "all" | "video" | "audio";
  mountAlbums: AlbumRecord[];
  mountTracks: TrackMetadata[];
  newFeedAlbums: AppleCloudAlbumSummary[];
  newFeedPlaylists: AppleCloudPlaylistSummary[];
  newFeedRecentReleases: AppleCloudAlbumSummary[];
  newFeedSongs: TrackMetadata[];
  newFilter: "all" | "recent_releases" | "playlists" | "albums" | "songs";
  newPlaylistName: string;
  pagedCloudPlaylists: AppleCloudPlaylistSummary[];
  personalRadioStations: AppleRadioStationSummary[];
  pinnedPlaylistsList: PlaylistRecord[];
  playlists: PlaylistRecord[];
  radioStations: AppleRadioStationSummary[];
  recentlyAddedCloudAlbums: AppleCloudAlbumSummary[];
  recentlyPlayed: TrackMetadata[];
  renderAppleArtistCard: any;
  renderArchiveItemCard: any;
  renderCloudAlbumCard: any;
  renderCloudPlaylistCard: any;
  renderLocalArtistCard: any;
  renderSimpAlbumCard: any;
  renderSimpPlaylistCard: any;
  renderSingleSongRow: any;
  renderSoundCloudPlaylistCard: any;
  renderSoundCloudUserCard: any;
  renderStationCard: any;
  safeCloudPage: number;
  scCatalogSearchResults: SoundCloudCatalogSearchResults;
  scDiscoverNextHref: string | null | undefined;
  scFollowings: SoundCloudUserSummary[];
  scFreshUploads: TrackMetadata[];
  scLikedTracks: TrackMetadata[];
  scLikesFilter: "all" | "sets" | "likes" | "following";
  scLoadingMore: boolean;
  scMoreOfWhatYouLike: TrackMetadata[];
  scPlaylists: SoundCloudPlaylistSummary[];
  scRecommendedArtists: SoundCloudUserSummary[];
  scSelectedGenre: string;
  scStreamFilter: "all" | "sets" | "history" | "stream";
  scStreamPlaylists: SoundCloudPlaylistSummary[];
  scStreamTracks: TrackMetadata[];
  scTrendingFilter: "all" | "for_you" | "fresh" | "artists" | "mixes" | "sets" | "tracks";
  scTrendingMixes: TrackMetadata[];
  scTrendingPlaylists: SoundCloudPlaylistSummary[];
  scTrendingTracks: TrackMetadata[];
  searchLower: string;
  searchMatchedPlaylists: PlaylistRecord[];
  searchPreferredSource: "local" | "apple_music" | "soundcloud" | "internet_archive" | null | undefined;
  setAppleRadioFilter: any;
  setAppleRadioGenre: any;
  setAppleRecentlyPlayedTracks: any;
  setArtistRadioShows: any;
  setCloudAlpha: any;
  setCloudLoading: any;
  setCloudPage: React.Dispatch<React.SetStateAction<number>>;
  setCloudPlaylists: React.Dispatch<React.SetStateAction<AppleCloudPlaylistSummary[]>>;
  setClubMixes: any;
  setForYouAlbums: any;
  setForYouFilter: any;
  setForYouNewReleases: any;
  setForYouPlaylists: any;
  setForYouShelves: any;
  setGenreRadioStations: any;
  setIaSubFilter: any;
  setLiveRadioStations: any;
  setNewFeedAlbums: any;
  setNewFeedPlaylists: any;
  setNewFeedRecentReleases: any;
  setNewFeedSongs: any;
  setNewFilter: any;
  setNewPlaylistName: any;
  setOskTarget: any;
  setPersonalRadioStations: any;
  setPlayingContextId: any;
  setRadioStations: any;
  setRecentlyAddedCloudAlbums: any;
  setScDiscoverNextHref: any;
  setScFollowings: any;
  setScLikedTracks: any;
  setScLikesFilter: any;
  setScPlaylists: any;
  setScSelectedGenre: any;
  setScStreamFilter: any;
  setScStreamPlaylists: any;
  setScStreamTracks: any;
  setScTrendingFilter: any;
  setScTrendingMixes: any;
  setScTrendingPlaylists: any;
  setScTrendingTracks: any;
  setSimpHubFilter: any;
  setSourceModalOpen: any;
  setView: any;
  simpHubFilter: "all" | "recent" | "hybrid" | "pinned" | "albums" | "videos";
  snap: SimpStateSnapshot | null;
  soundCloudSubTab: "pinned" | "likes_sets" | "stream_radio" | "trending";
  totalCloudPages: number;
}

export const LibraryBrowseRightPane: React.FC<LibraryBrowseRightPaneProps> = ({
  activeHubLabel,
  activeMountPlaceObj,
  appleAuthState,
  appleRadioFilter,
  appleRadioGenre,
  appleRecentlyPlayedTracks,
  appleSubTab,
  artistRadioShows,
  browserSearch,
  browserSourceFilter,
  catalogSearchResults,
  cloudAlpha,
  cloudLoading,
  cloudPlaylists,
  clubMixes,
  creatingPlaylist,
  filteredAlbums,
  filteredCloudPlaylists,
  filteredIaItems,
  filteredIaSearchResults,
  filteredLocalSearchTracks,
  filteredPlaylists,
  filteredRecentlyPlayed,
  forYouAlbums,
  forYouFilter,
  forYouNewReleases,
  forYouPlaylists,
  forYouShelves,
  genreRadioStations,
  handleAddTracksToPlaylist,
  handleCreatePlaylist,
  handleDeletePlaylist,
  handlePinArchiveCollection,
  handleStartSoundCloudTrackRadio,
  hybridPlaylistsList,
  iaHasMore,
  iaLoading,
  iaLoadingMore,
  iaSearchHasMore,
  iaSearchLoadingMore,
  iaSubFilter,
  iaSubTab,
  isSourceIncluded,
  liveRadioStations,
  loadIaDiscover,
  loadMoreIaDiscover,
  loadMoreIaSearch,
  loadMoreScDiscover,
  loadMoreScSearch,
  localVideos,
  mediaTypeFilter,
  mountAlbums,
  mountTracks,
  newFeedAlbums,
  newFeedPlaylists,
  newFeedRecentReleases,
  newFeedSongs,
  newFilter,
  newPlaylistName,
  pagedCloudPlaylists,
  personalRadioStations,
  pinnedPlaylistsList,
  playlists,
  radioStations,
  recentlyAddedCloudAlbums,
  recentlyPlayed,
  renderAppleArtistCard,
  renderArchiveItemCard,
  renderCloudAlbumCard,
  renderCloudPlaylistCard,
  renderLocalArtistCard,
  renderSimpAlbumCard,
  renderSimpPlaylistCard,
  renderSingleSongRow,
  renderSoundCloudPlaylistCard,
  renderSoundCloudUserCard,
  renderStationCard,
  safeCloudPage,
  scCatalogSearchResults,
  scDiscoverNextHref,
  scFollowings,
  scFreshUploads,
  scLikedTracks,
  scLikesFilter,
  scLoadingMore,
  scMoreOfWhatYouLike,
  scPlaylists,
  scRecommendedArtists,
  scSelectedGenre,
  scStreamFilter,
  scStreamPlaylists,
  scStreamTracks,
  scTrendingFilter,
  scTrendingMixes,
  scTrendingPlaylists,
  scTrendingTracks,
  searchLower,
  searchMatchedPlaylists,
  searchPreferredSource,
  setAppleRadioFilter,
  setAppleRadioGenre,
  setAppleRecentlyPlayedTracks,
  setArtistRadioShows,
  setCloudAlpha,
  setCloudLoading,
  setCloudPage,
  setCloudPlaylists,
  setClubMixes,
  setForYouAlbums,
  setForYouFilter,
  setForYouNewReleases,
  setForYouPlaylists,
  setForYouShelves,
  setGenreRadioStations,
  setIaSubFilter,
  setLiveRadioStations,
  setNewFeedAlbums,
  setNewFeedPlaylists,
  setNewFeedRecentReleases,
  setNewFeedSongs,
  setNewFilter,
  setNewPlaylistName,
  setOskTarget,
  setPersonalRadioStations,
  setPlayingContextId,
  setRadioStations,
  setRecentlyAddedCloudAlbums,
  setScDiscoverNextHref,
  setScFollowings,
  setScLikedTracks,
  setScLikesFilter,
  setScPlaylists,
  setScSelectedGenre,
  setScStreamFilter,
  setScStreamPlaylists,
  setScStreamTracks,
  setScTrendingFilter,
  setScTrendingMixes,
  setScTrendingPlaylists,
  setScTrendingTracks,
  setSimpHubFilter,
  setSourceModalOpen,
  setView,
  simpHubFilter,
  snap,
  soundCloudSubTab,
  totalCloudPages,
}) => {
  const [activeSmartFacet, setActiveSmartFacet] = React.useState<
    'synced_lyrics' | 'has_art' | 'missing_art' | 'has_factoids' | 'has_comments' | null
  >(null);
  const [facetTracks, setFacetTracks] = React.useState<TrackMetadata[]>([]);
  const [facetLoading, setFacetLoading] = React.useState(false);

  React.useEffect(() => {
    if (!activeSmartFacet) {
      setFacetTracks([]);
      return;
    }
    let cancelled = false;
    setFacetLoading(true);
    fetch(`http://127.0.0.1:18888/api/library/facets?facet=${encodeURIComponent(activeSmartFacet)}`)
      .then((r) => r.json())
      .then((facetJson) => {
        if (cancelled) return;
        const matched: TrackMetadata[] = Array.isArray(facetJson?.tracks) ? facetJson.tracks : [];
        setFacetTracks(matched);
      })
      .catch(() => {
        if (!cancelled) setFacetTracks([]);
      })
      .finally(() => {
        if (!cancelled) setFacetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSmartFacet]);

  const unifiedSavedPlaylists = React.useMemo(() => {
    const seen = new Set<string>();
    const combined: PlaylistRecord[] = [];
    for (const pl of [...hybridPlaylistsList, ...pinnedPlaylistsList]) {
      if (!seen.has(pl.id)) {
        seen.add(pl.id);
        combined.push(pl);
      }
    }
    return combined;
  }, [hybridPlaylistsList, pinnedPlaylistsList]);

  return (
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
              <UniversalSearchResultsPane
                browserSearch={browserSearch}
                catalogSearchResults={catalogSearchResults}
                cloudLoading={cloudLoading}
                filteredAlbums={filteredAlbums}
                filteredCloudPlaylists={filteredCloudPlaylists}
                filteredIaSearchResults={filteredIaSearchResults}
                filteredLocalSearchTracks={filteredLocalSearchTracks}
                filteredPlaylists={filteredPlaylists}
                iaLoading={iaLoading}
                iaSearchHasMore={iaSearchHasMore}
                iaSearchLoadingMore={iaSearchLoadingMore}
                isSourceIncluded={isSourceIncluded}
                loadMoreIaSearch={loadMoreIaSearch}
                loadMoreScSearch={loadMoreScSearch}
                mediaTypeFilter={mediaTypeFilter}
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
                scCatalogSearchResults={scCatalogSearchResults}
                scLoadingMore={scLoadingMore}
                searchLower={searchLower}
                searchMatchedPlaylists={searchMatchedPlaylists}
                searchPreferredSource={searchPreferredSource}
                snap={snap}
              />
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
                              label: `★ Saved / Playlists (${unifiedSavedPlaylists.length})`,
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
                          const active = simpHubFilter === f.id && !activeSmartFacet;
                          return (
                            <button
                              key={f.id}
                              data-right-filter-pill="true"
                              onClick={() => {
                                setActiveSmartFacet(null);
                                setSimpHubFilter(f.id);
                              }}
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

                      {/* Smart Facet Filter Bar (Local / My Library View) */}
                      {(browserSourceFilter === 'all' || browserSourceFilter === 'local') && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {(
                            [
                              {
                                id: 'synced_lyrics' as const,
                                icon: 'lyrics' as const,
                                label: 'Synced Lyrics',
                                accent: '#34d399',
                              },
                              {
                                id: 'has_factoids' as const,
                                icon: 'factoid' as const,
                                label: 'Pop-Up Factoids',
                                accent: '#c084fc',
                              },
                              {
                                id: 'has_comments' as const,
                                icon: 'comments' as const,
                                label: 'Timed Comments',
                                accent: '#fb923c',
                              },
                              {
                                id: 'has_art' as const,
                                icon: 'artwork' as const,
                                label: 'Has Artwork',
                                accent: '#38bdf8',
                              },
                              {
                                id: 'missing_art' as const,
                                icon: 'artwork-missing' as const,
                                label: 'Missing Artwork',
                                accent: '#facc15',
                              },
                            ] as const
                          ).map((facet) => {
                            const active = activeSmartFacet === facet.id;
                            return (
                              <button
                                key={facet.id}
                                data-right-filter-pill="true"
                                onClick={() =>
                                  setActiveSmartFacet((prev) =>
                                    prev === facet.id ? null : facet.id,
                                  )
                                }
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 6,
                                  background: active ? 'rgba(52, 211, 153, 0.14)' : '#0d1017',
                                  border: active
                                    ? `1px solid ${facet.accent}`
                                    : '1px solid rgba(255,255,255,0.1)',
                                  color: active ? facet.accent : '#94a3b8',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 5,
                                }}
                              >
                                <ImpIcon name={facet.icon} size={12} color={active ? facet.accent : '#64748b'} />
                                {facet.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {activeSmartFacet && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          padding: 12,
                          borderRadius: 12,
                          background: 'rgba(12, 18, 28, 0.85)',
                          border: '1px solid rgba(56, 189, 248, 0.28)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 800, color: '#e2e8f0' }}>
                            <ImpIcon
                              name={
                                activeSmartFacet === 'synced_lyrics'
                                  ? 'lyrics'
                                  : activeSmartFacet === 'has_factoids'
                                  ? 'factoid'
                                  : activeSmartFacet === 'has_comments'
                                  ? 'comments'
                                  : activeSmartFacet === 'has_art'
                                  ? 'artwork'
                                  : 'artwork-missing'
                              }
                              size={14}
                              color="#34d399"
                            />
                            <span>
                              Smart Facet:{' '}
                              {activeSmartFacet === 'synced_lyrics'
                                ? 'Synced Lyrics (Karaoke Ready)'
                                : activeSmartFacet === 'has_factoids'
                                ? 'Tracks with Pop-Up Video Factoids'
                                : activeSmartFacet === 'has_comments'
                                ? 'Tracks with Attributed Timed Comments'
                                : activeSmartFacet === 'has_art'
                                ? 'Tracks with Cover Artwork'
                                : 'Tracks Missing Cover Artwork'}{' '}
                              ({facetTracks.length})
                            </span>
                          </div>
                          <button
                            data-right-filter-pill="true"
                            onClick={() => setActiveSmartFacet(null)}
                            style={{
                              padding: '3px 9px',
                              borderRadius: 6,
                              background: 'rgba(255,255,255,0.06)',
                              border: '1px solid rgba(255,255,255,0.14)',
                              color: '#cbd5e1',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            Clear Facet
                          </button>
                        </div>
                        {facetLoading ? (
                          <div style={{ fontSize: 12, color: '#94a3b8', padding: '10px 4px' }}>
                            Filtering library by facet…
                          </div>
                        ) : facetTracks.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#94a3b8', padding: '10px 4px' }}>
                            No indexed tracks match this facet yet.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {facetTracks.slice(0, 120).map((ft) =>
                              renderSingleSongRow(ft, facetTracks, `facet_${activeSmartFacet}`),
                            )}
                          </div>
                        )}
                      </div>
                    )}

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
                          placeholder="Name your new IMP Hybrid Playlist (Local + Apple + SoundCloud)..."
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

                    {/* Saved / Hybrid Playlists Section (Unifies Hybrid + Pinned when on `hybrid` tab) */}
                    {simpHubFilter === 'hybrid' && unifiedSavedPlaylists.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                          ★ SAVED & HYBRID PLAYLISTS ({unifiedSavedPlaylists.length})
                        </div>
                        <div style={tileGridStyle}>
                          {unifiedSavedPlaylists.map(renderSimpPlaylistCard)}
                        </div>
                      </>
                    )}

                    {simpHubFilter === 'all' && hybridPlaylistsList.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#2aa3c4' }}>
                          ★ IMP HYBRID PLAYLISTS ({hybridPlaylistsList.length})
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

              <AppleMusicDiscoverPane
                appleRadioFilter={appleRadioFilter}
                appleRadioGenre={appleRadioGenre}
                appleRecentlyPlayedTracks={appleRecentlyPlayedTracks}
                appleSubTab={appleSubTab}
                artistRadioShows={artistRadioShows}
                browserSourceFilter={browserSourceFilter}
                cloudAlpha={cloudAlpha}
                cloudLoading={cloudLoading}
                cloudPlaylists={cloudPlaylists}
                clubMixes={clubMixes}
                filteredCloudPlaylists={filteredCloudPlaylists}
                forYouAlbums={forYouAlbums}
                forYouFilter={forYouFilter}
                forYouNewReleases={forYouNewReleases}
                forYouPlaylists={forYouPlaylists}
                forYouShelves={forYouShelves}
                genreRadioStations={genreRadioStations}
                liveRadioStations={liveRadioStations}
                newFeedAlbums={newFeedAlbums}
                newFeedPlaylists={newFeedPlaylists}
                newFeedRecentReleases={newFeedRecentReleases}
                newFeedSongs={newFeedSongs}
                newFilter={newFilter}
                pagedCloudPlaylists={pagedCloudPlaylists}
                personalRadioStations={personalRadioStations}
                radioStations={radioStations}
                recentlyAddedCloudAlbums={recentlyAddedCloudAlbums}
                renderCloudAlbumCard={renderCloudAlbumCard}
                renderCloudPlaylistCard={renderCloudPlaylistCard}
                renderSingleSongRow={renderSingleSongRow}
                renderStationCard={renderStationCard}
                safeCloudPage={safeCloudPage}
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
                setLiveRadioStations={setLiveRadioStations}
                setNewFeedAlbums={setNewFeedAlbums}
                setNewFeedPlaylists={setNewFeedPlaylists}
                setNewFeedRecentReleases={setNewFeedRecentReleases}
                setNewFeedSongs={setNewFeedSongs}
                setNewFilter={setNewFilter}
                setPersonalRadioStations={setPersonalRadioStations}
                setRadioStations={setRadioStations}
                setRecentlyAddedCloudAlbums={setRecentlyAddedCloudAlbums}
                snap={snap}
                totalCloudPages={totalCloudPages}
              />
              <SoundCloudDiscoverPane
                browserSourceFilter={browserSourceFilter}
                cloudLoading={cloudLoading}
                handleStartSoundCloudTrackRadio={handleStartSoundCloudTrackRadio}
                loadMoreScDiscover={loadMoreScDiscover}
                recentlyPlayed={recentlyPlayed}
                renderSingleSongRow={renderSingleSongRow}
                renderSoundCloudPlaylistCard={renderSoundCloudPlaylistCard}
                renderSoundCloudUserCard={renderSoundCloudUserCard}
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
                setCloudLoading={setCloudLoading}
                setPlayingContextId={setPlayingContextId}
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
                setView={setView}
                snap={snap}
                soundCloudSubTab={soundCloudSubTab}
              />
              <InternetArchiveDiscoverPane
                activeHubLabel={activeHubLabel}
                browserSearch={browserSearch}
                browserSourceFilter={browserSourceFilter}
                filteredIaItems={filteredIaItems}
                handleDeletePlaylist={handleDeletePlaylist}
                handlePinArchiveCollection={handlePinArchiveCollection}
                iaHasMore={iaHasMore}
                iaLoading={iaLoading}
                iaLoadingMore={iaLoadingMore}
                iaSubFilter={iaSubFilter}
                iaSubTab={iaSubTab}
                loadIaDiscover={loadIaDiscover}
                loadMoreIaDiscover={loadMoreIaDiscover}
                playlists={playlists}
                renderArchiveItemCard={renderArchiveItemCard}
                setIaSubFilter={setIaSubFilter}
              />
              </>
            )}
          </div>
  );
};
