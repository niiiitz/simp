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
import { ImpIcon } from "../../../components/icons/ImpIcon";
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

export interface UniversalSearchResultsPaneProps {
  browserSearch: string;
  catalogSearchResults: AppleCatalogSearchResults;
  cloudLoading: boolean;
  filteredAlbums: AlbumRecord[];
  filteredCloudPlaylists: AppleCloudPlaylistSummary[];
  filteredIaSearchResults: ArchiveItemSummary[];
  filteredLocalSearchTracks: TrackMetadata[];
  filteredPlaylists: PlaylistRecord[];
  iaLoading: boolean;
  iaSearchHasMore: boolean;
  iaSearchLoadingMore: boolean;
  isSourceIncluded: any;
  loadMoreIaSearch: any;
  loadMoreScSearch: any;
  mediaTypeFilter: "all" | "video" | "audio";
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
  scCatalogSearchResults: SoundCloudCatalogSearchResults;
  scLoadingMore: boolean;
  searchLower: string;
  searchMatchedPlaylists: PlaylistRecord[];
  searchPreferredSource: "local" | "apple_music" | "soundcloud" | "internet_archive" | null | undefined;
  snap: SimpStateSnapshot | null;
}

export const UniversalSearchResultsPane: React.FC<UniversalSearchResultsPaneProps> = ({
  browserSearch,
  catalogSearchResults,
  cloudLoading,
  filteredAlbums,
  filteredCloudPlaylists,
  filteredIaSearchResults,
  filteredLocalSearchTracks,
  filteredPlaylists,
  iaLoading,
  iaSearchHasMore,
  iaSearchLoadingMore,
  isSourceIncluded,
  loadMoreIaSearch,
  loadMoreScSearch,
  mediaTypeFilter,
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
  scCatalogSearchResults,
  scLoadingMore,
  searchLower,
  searchMatchedPlaylists,
  searchPreferredSource,
  snap,
}) => {
  return (
    <>
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
                                      isUiVideoTrack(s)
                                        ? filteredLocalSearchTracks.filter((tr) =>
                                            isUiVideoTrack(tr)
                                          )
                                        : filteredLocalSearchTracks.filter(
                                            (tr) => !isUiVideoTrack(tr)
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
                                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                      <ImpIcon name="apple" size={12} color="#fda4af" />
                                      <span>
                                        APPLE CATALOG ALBUMS (
                                        {
                                          catalogSearchResults.albums.filter((a) => a.kind !== 'library')
                                            .length
                                        }
                                        )
                                      </span>
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
    </>
  );
};
