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

export interface AppleMusicDiscoverPaneProps {
  appleRadioFilter: "all" | "genre" | "live" | "shows" | "mixes";
  appleRadioGenre: string;
  appleRecentlyPlayedTracks: TrackMetadata[];
  appleSubTab: "pinned" | "for_you" | "cloud_playlists" | "new" | "radio";
  artistRadioShows: AppleCloudPlaylistSummary[];
  browserSourceFilter: "all" | "local" | "apple_music" | "soundcloud" | "internet_archive";
  cloudAlpha: AlphaBucket;
  cloudLoading: boolean;
  cloudPlaylists: AppleCloudPlaylistSummary[];
  clubMixes: AppleCloudPlaylistSummary[];
  filteredCloudPlaylists: AppleCloudPlaylistSummary[];
  forYouAlbums: AppleCloudAlbumSummary[];
  forYouFilter: "all" | "stations" | "new_releases" | "recently_played" | "mixes" | "social" | "recent_library";
  forYouNewReleases: AppleCloudAlbumSummary[];
  forYouPlaylists: AppleCloudPlaylistSummary[];
  forYouShelves: AppleRecommendationShelf[];
  genreRadioStations: AppleRadioStationSummary[];
  liveRadioStations: AppleRadioStationSummary[];
  newFeedAlbums: AppleCloudAlbumSummary[];
  newFeedPlaylists: AppleCloudPlaylistSummary[];
  newFeedRecentReleases: AppleCloudAlbumSummary[];
  newFeedSongs: TrackMetadata[];
  newFilter: "all" | "recent_releases" | "playlists" | "albums" | "songs";
  pagedCloudPlaylists: AppleCloudPlaylistSummary[];
  personalRadioStations: AppleRadioStationSummary[];
  radioStations: AppleRadioStationSummary[];
  recentlyAddedCloudAlbums: AppleCloudAlbumSummary[];
  renderCloudAlbumCard: any;
  renderCloudPlaylistCard: any;
  renderSingleSongRow: any;
  renderStationCard: any;
  safeCloudPage: number;
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
  setLiveRadioStations: any;
  setNewFeedAlbums: any;
  setNewFeedPlaylists: any;
  setNewFeedRecentReleases: any;
  setNewFeedSongs: any;
  setNewFilter: any;
  setPersonalRadioStations: any;
  setRadioStations: any;
  setRecentlyAddedCloudAlbums: any;
  snap: SimpStateSnapshot | null;
  totalCloudPages: number;
}

export const AppleMusicDiscoverPane: React.FC<AppleMusicDiscoverPaneProps> = ({
  appleRadioFilter,
  appleRadioGenre,
  appleRecentlyPlayedTracks,
  appleSubTab,
  artistRadioShows,
  browserSourceFilter,
  cloudAlpha,
  cloudLoading,
  cloudPlaylists,
  clubMixes,
  filteredCloudPlaylists,
  forYouAlbums,
  forYouFilter,
  forYouNewReleases,
  forYouPlaylists,
  forYouShelves,
  genreRadioStations,
  liveRadioStations,
  newFeedAlbums,
  newFeedPlaylists,
  newFeedRecentReleases,
  newFeedSongs,
  newFilter,
  pagedCloudPlaylists,
  personalRadioStations,
  radioStations,
  recentlyAddedCloudAlbums,
  renderCloudAlbumCard,
  renderCloudPlaylistCard,
  renderSingleSongRow,
  renderStationCard,
  safeCloudPage,
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
  setLiveRadioStations,
  setNewFeedAlbums,
  setNewFeedPlaylists,
  setNewFeedRecentReleases,
  setNewFeedSongs,
  setNewFilter,
  setPersonalRadioStations,
  setRadioStations,
  setRecentlyAddedCloudAlbums,
  snap,
  totalCloudPages,
}) => {
  return (
    <>
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
                                  ...(otherShelves.some((s) => s.is_social)
                                    ? [
                                        {
                                          id: 'social' as const,
                                          label: `👥 Friends Listening (${
                                            otherShelves.filter((s) => s.is_social).length
                                          })`,
                                        },
                                      ]
                                    : []),
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
                                      setArtistRadioShows?.(res.artist_shows ?? []);
                                      setClubMixes?.(res.club_mixes ?? []);
                                      setGenreRadioStations?.(res.genre_stations ?? []);
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

                          {(forYouFilter === 'all' ||
                            forYouFilter === 'mixes' ||
                            forYouFilter === 'social') &&
                            (otherShelves.length > 0 ? (
                              <>
                                {otherShelves
                                  .filter((s) => (forYouFilter === 'social' ? s.is_social : true))
                                  .map((shelf) => {
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
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            flexWrap: 'wrap',
                                          }}
                                        >
                                          <span>
                                            {shelf.is_social ? '👥' : '✨'}{' '}
                                            {shelf.title.toUpperCase()} ({totalItems})
                                          </span>
                                          {shelf.is_social && (
                                            <span
                                              style={{
                                                padding: '2px 7px',
                                                borderRadius: 999,
                                                background: '#2a131c',
                                                border: '1px solid #fa243c',
                                                color: '#fecdd3',
                                                fontSize: 9.5,
                                                fontWeight: 800,
                                              }}
                                            >
                                              👥 Friends Listening
                                            </span>
                                          )}
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
                    5B. 📻 RADIO HUB (Live Broadcast, Artist-Hosted Shows, Club Mixes & Stations by Genre)
                   --------------------------------------------------------- */}
                {browserSourceFilter !== 'soundcloud' &&
                  browserSourceFilter !== 'internet_archive' &&
                  appleSubTab === 'radio' &&
                  snap?.apple_authenticated && (
                  <>
                    {(() => {
                      const stationsToDisplay =
                        liveRadioStations.length > 0 ? liveRadioStations : radioStations;
                      const allGenreStations =
                        genreRadioStations.length > 0 ? genreRadioStations : radioStations;
                      const genreSet = new Set<string>();
                      for (const st of allGenreStations) {
                        if (st.genre) genreSet.add(st.genre);
                      }
                      const availableGenres = Array.from(genreSet).slice(0, 10);
                      const filteredGenreStations = appleRadioGenre
                        ? allGenreStations.filter(
                            (st) =>
                              (st.genre || '').toLowerCase() === appleRadioGenre.toLowerCase() ||
                              st.name.toLowerCase().includes(appleRadioGenre.toLowerCase()) ||
                              st.subtitle.toLowerCase().includes(appleRadioGenre.toLowerCase())
                          )
                        : allGenreStations;

                      return (
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
                                    marginRight: 4,
                                  }}
                                >
                                  📻 Apple Music Radio
                                </span>
                                {(
                                  [
                                    { id: 'all' as const, label: 'All Radio' },
                                    {
                                      id: 'live' as const,
                                      label: `📻 Live & Personal (${
                                        stationsToDisplay.length + personalRadioStations.length
                                      })`,
                                    },
                                    ...(artistRadioShows.length > 0
                                      ? [
                                          {
                                            id: 'shows' as const,
                                            label: `🎙️ Shows & Interviews (${artistRadioShows.length})`,
                                          },
                                        ]
                                      : []),
                                    ...(clubMixes.length > 0
                                      ? [
                                          {
                                            id: 'mixes' as const,
                                            label: `🎧 Club Mixes & DJ Sets (${clubMixes.length})`,
                                          },
                                        ]
                                      : []),
                                    {
                                      id: 'genre' as const,
                                      label: `📡 By Genre (${allGenreStations.length})`,
                                    },
                                  ] as const
                                ).map((tab) => {
                                  const active = appleRadioFilter === tab.id;
                                  return (
                                    <button
                                      key={tab.id}
                                      data-right-filter-pill="true"
                                      onClick={() => setAppleRadioFilter(tab.id)}
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
                                      {tab.label}
                                    </button>
                                  );
                                })}
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
                                      setArtistRadioShows?.(res.artist_shows ?? []);
                                      setClubMixes?.(res.club_mixes ?? []);
                                      setGenreRadioStations?.(res.genre_stations ?? []);
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

                            {availableGenres.length > 0 && (
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 5,
                                  flexWrap: 'wrap',
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontFamily: 'monospace',
                                    color: '#9ca3af',
                                  }}
                                >
                                  GENRE:
                                </span>
                                {[
                                  { id: '', label: '🌐 All Genres' },
                                  ...availableGenres.map((g) => ({ id: g, label: g })),
                                ].map((g) => {
                                  const active = appleRadioGenre === g.id;
                                  return (
                                    <button
                                      key={g.id || 'all-genres'}
                                      data-right-filter-pill="true"
                                      onClick={() => setAppleRadioGenre(g.id)}
                                      style={{
                                        padding: '3px 8px',
                                        borderRadius: 999,
                                        background: active ? '#28111b' : '#12121a',
                                        border: active
                                          ? '1px solid #fa243c'
                                          : '1px solid #232332',
                                        color: active ? '#fecdd3' : '#a1a1aa',
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
                            )}
                          </div>

                          {(appleRadioFilter === 'all' || appleRadioFilter === 'live') &&
                            personalRadioStations.length > 0 && (
                              <>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: '#fda4af',
                                  }}
                                >
                                  📻 PERSONAL & DISCOVERY STATIONS ({personalRadioStations.length})
                                </div>
                                <div style={tileGridStyle}>
                                  {personalRadioStations.map(renderStationCard)}
                                </div>
                              </>
                            )}

                          {(appleRadioFilter === 'all' || appleRadioFilter === 'live') &&
                            stationsToDisplay.length > 0 && (
                              <>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: '#fda4af',
                                  }}
                                >
                                  📡 LIVE GLOBAL BROADCAST STATIONS — APPLE MUSIC 1, HITS, COUNTRY & CLUB (
                                  {stationsToDisplay.length})
                                </div>
                                <div style={tileGridStyle}>
                                  {stationsToDisplay.map(renderStationCard)}
                                </div>
                              </>
                            )}

                          {(appleRadioFilter === 'all' || appleRadioFilter === 'shows') &&
                            artistRadioShows.length > 0 && (
                              <>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: '#fda4af',
                                  }}
                                >
                                  🎙️ ARTIST-HOSTED SHOWS, RADIO HOSTS & INTERVIEWS (
                                  {artistRadioShows.length})
                                </div>
                                <div style={tileGridStyle}>
                                  {artistRadioShows.map(renderCloudPlaylistCard)}
                                </div>
                              </>
                            )}

                          {(appleRadioFilter === 'all' || appleRadioFilter === 'mixes') &&
                            clubMixes.length > 0 && (
                              <>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: '#fda4af',
                                  }}
                                >
                                  🎧 CLUB MIXES & DJ SETS ({clubMixes.length})
                                </div>
                                <div style={tileGridStyle}>
                                  {clubMixes.map(renderCloudPlaylistCard)}
                                </div>
                              </>
                            )}

                          {(appleRadioFilter === 'all' || appleRadioFilter === 'genre') &&
                            filteredGenreStations.length > 0 && (
                              <>
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontFamily: 'monospace',
                                    color: '#fda4af',
                                  }}
                                >
                                  🎶 STATIONS BY GENRE & TOP STATIONS
                                  {appleRadioGenre ? ` — ${appleRadioGenre.toUpperCase()}` : ''} (
                                  {filteredGenreStations.length})
                                </div>
                                <div style={tileGridStyle}>
                                  {filteredGenreStations.map(renderStationCard)}
                                </div>
                              </>
                            )}

                          {stationsToDisplay.length === 0 &&
                            artistRadioShows.length === 0 &&
                            clubMixes.length === 0 &&
                            filteredGenreStations.length === 0 && (
                              <div
                                style={{
                                  padding: 28,
                                  textAlign: 'center',
                                  color: '#9ca3af',
                                  fontSize: 12,
                                }}
                              >
                                {cloudLoading
                                  ? 'Loading Apple Music radio stations, shows & mixes…'
                                  : 'No radio stations returned right now. Click Refresh to retry.'}
                              </div>
                            )}
                        </>
                      );
                    })()}
                  </>
                )}
    </>
  );
};
