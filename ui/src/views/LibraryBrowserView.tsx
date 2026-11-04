import React from 'react';
import {
  AlbumRecord,
  defaultSimpClient,
  OpticalDiscStatus,
  PlaylistRecord,
  SimpStateSnapshot,
  TrackMetadata,
} from '@simp/client';
import {
  AppleCatalogSearchResults,
  AppleCloudAlbumSummary,
  AppleCloudPlaylistSummary,
  AppleRadioStationSummary,
  fetchAppleCloudPlaylists,
  fetchAppleNewFeed,
  fetchAppleRadioAndForYou,
} from '../drivers/AppleMusicDriver';
import { OskTargetKind } from '../hooks/useGamepadNavigation';
import { BrowserTarget } from './PlayerView';

export interface LibraryBrowserViewProps {
  snap: SimpStateSnapshot | null;
  track: TrackMetadata | null | undefined;
  albums: AlbumRecord[];
  playlists: PlaylistRecord[];
  browserSourceFilter: 'all' | 'local' | 'apple_music';
  setBrowserSourceFilter: React.Dispatch<React.SetStateAction<'all' | 'local' | 'apple_music'>>;
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
}

export const LibraryBrowserView: React.FC<LibraryBrowserViewProps> = ({
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
}) => {
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
    <main
      style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '38% 62%',
        overflow: 'hidden',
        boxSizing: 'border-box',
        width: '100%',
      }}
    >
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
            {!browserSearch.trim() && browserSourceFilter !== 'apple_music' && (
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

            {/* Unified Live Apple Music Catalog Search Results right under the search bar when searching */}
            {browserSearch.trim() &&
              browserSourceFilter !== 'local' &&
              snap?.apple_authenticated && (
                <>
                  <div
                    style={{
                      marginTop: 4,
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
  );
};

