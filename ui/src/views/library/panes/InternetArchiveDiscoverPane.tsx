import React from "react";
import {
  ArchiveItemSummary,
  PlaylistRecord,
} from "@simp/client";
import {
  tileGridStyle,
} from "../libraryHelpers";

export interface InternetArchiveDiscoverPaneProps {
  activeHubLabel: string;
  browserSearch: string;
  browserSourceFilter: "all" | "local" | "apple_music" | "soundcloud" | "internet_archive";
  filteredIaItems: ArchiveItemSummary[];
  handleDeletePlaylist: any;
  handlePinArchiveCollection: any;
  iaHasMore: boolean;
  iaLoading: boolean;
  iaLoadingMore: boolean;
  iaSubFilter: string;
  iaSubTab: "pinned" | "trending" | "films" | "tv" | "audio";
  loadIaDiscover: any;
  loadMoreIaDiscover: any;
  playlists: PlaylistRecord[];
  renderArchiveItemCard: any;
  setIaSubFilter: any;
}

export const InternetArchiveDiscoverPane: React.FC<InternetArchiveDiscoverPaneProps> = ({
  activeHubLabel,
  browserSearch,
  browserSourceFilter,
  filteredIaItems,
  handleDeletePlaylist,
  handlePinArchiveCollection,
  iaHasMore,
  iaLoading,
  iaLoadingMore,
  iaSubFilter,
  iaSubTab,
  loadIaDiscover,
  loadMoreIaDiscover,
  playlists,
  renderArchiveItemCard,
  setIaSubFilter,
}) => {
  return (
    <>
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
  );
};
