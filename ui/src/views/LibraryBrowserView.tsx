import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  hidden?: boolean;
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
  const [simpHubFilter, setSimpHubFilter] = useState<'all' | 'hybrid' | 'pinned' | 'albums'>('all');
  const [cloudPage, setCloudPage] = useState<number>(0);
  const [cloudAlpha, setCloudAlpha] = useState<AlphaBucket>('all');
  const [radioFilter, setRadioFilter] = useState<'all' | 'stations' | 'mixes' | 'albums'>('all');
  const [newFilter, setNewFilter] = useState<'all' | 'albums' | 'playlists' | 'songs'>('all');

  // Auto-focus Right Pane when selecting a Place ('tile') or Collection ('track')
  const pendingRightFocusRef = useRef<'track' | 'tile' | null>(null);

  const focusRightPaneFirstTrack = useCallback(() => {
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
    pendingRightFocusRef.current = 'tile';
    window.setTimeout(() => {
      const firstTile =
        document.querySelector<HTMLElement>(
          '[data-nav-col="right"] [data-right-tile="true"]:not([disabled])'
        ) ||
        document.querySelector<HTMLElement>(
          '[data-nav-col="right"] button:not([disabled])'
        );
      if (firstTile) {
        applyFocusMarker(firstTile);
        if (firstTile.dataset.rightTile === 'true') {
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
          '[data-nav-col="right"] [data-right-tile="true"]:not([disabled])'
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
    cloudPlaylists,
    radioStations,
    forYouPlaylists,
    newFeedAlbums,
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
    browserTarget?.kind === 'album' ? albums.find((a) => a.id === browserTarget.id) : null;
  const selectedPlaylistObj =
    browserTarget?.kind === 'playlist' ? playlists.find((p) => p.id === browserTarget.id) : null;
  const selectedMountObj =
    browserTarget?.kind === 'mount'
      ? snap?.mounts.find((m) => m.mount_root === browserTarget.id)
      : null;
  const writablePlaylists = playlists.filter((p) => p.origin === 'simp_local');

  const searchLower = browserSearch.trim().toLowerCase();

  // Source-aware SIMP Playlist membership (`has_local` & `has_apple`)
  const filteredPlaylists = useMemo(
    () =>
      playlists.filter((pl) => {
        if (browserSourceFilter === 'local') {
          if (pl.origin === 'apple_remote') return false;
          // Exclude user-created SIMP playlists that contain ONLY Apple Music tracks
          if (pl.track_count > 0 && pl.has_apple && !pl.has_local) return false;
        } else if (browserSourceFilter === 'apple_music') {
          // Include Pinned Apple Playlists (`apple_remote`), empty new SIMP playlists,
          // and any SIMP Playlist (`simp_local`) that contains Apple Music tracks (`has_apple`)!
          if (pl.origin === 'simp_local' && pl.track_count > 0 && !pl.has_apple) {
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
    raw.replace(/^[\s📌🍎🎵💿]+/u, '').trim() || raw;

  const formatPlaylistSourceBadge = (pl: PlaylistRecord): string => {
    if (pl.origin !== 'simp_local') {
      return '🍎';
    }
    if (pl.has_local && pl.has_apple) {
      return '💾 + 🍎';
    }
    if (pl.has_apple && !pl.has_local) {
      return '🍎';
    }
    if (pl.has_local && !pl.has_apple) {
      return '💾';
    }
    return '★ SIMP';
  };

  const hybridPlaylistsList = useMemo(
    () => filteredPlaylists.filter((p) => p.origin === 'simp_local'),
    [filteredPlaylists]
  );
  const pinnedPlaylistsList = useMemo(
    () => filteredPlaylists.filter((p) => p.origin === 'apple_remote'),
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

  // Open a collection, switch the Right Pane to Tracklist view, and focus the first track
  const selectLocalCollection = (target: BrowserTarget) => {
    setBrowserTarget(target);
    setRightPaneMode('tracks');
    focusRightPaneFirstTrack();
  };

  const selectCloudPlaylist = async (pl: AppleCloudPlaylistSummary) => {
    setRightPaneMode('tracks');
    focusRightPaneFirstTrack();
    await handleOpenCloudPlaylist(pl);
  };

  const selectCloudAlbum = async (params: {
    albumId?: string | null;
    songUri?: string | null;
    fallbackTitle?: string;
  }) => {
    setRightPaneMode('tracks');
    focusRightPaneFirstTrack();
    await handleOpenFullAppleAlbum(params);
  };

  const activeHubLabel = browserSearch.trim()
    ? 'Search Results'
    : browserSourceFilter === 'local'
    ? 'Local SIMP Library'
    : appleSubTab === 'cloud_playlists'
    ? 'Apple Playlists'
    : appleSubTab === 'radio'
    ? 'Radio & For You'
    : appleSubTab === 'new'
    ? 'New & Charts'
    : browserSourceFilter === 'apple_music'
    ? 'SIMP Library (Apple)'
    : 'My SIMP Library';

  // Interactive Controller & Mouse Friendly Target Playlist Button (`🎯 Add + to: ★ ...`)
  const renderHybridTargetSelector = () => {
    const activeIdx = Math.max(
      0,
      writablePlaylists.findIndex((wp) => wp.id === activePlaylistId)
    );
    const activeWp = writablePlaylists[activeIdx] || null;
    return (
      <button
        onClick={() => {
          if (writablePlaylists.length >= 2) {
            const nextWp = writablePlaylists[(activeIdx + 1) % writablePlaylists.length];
            setActivePlaylistId(nextWp.id);
          } else {
            setPlaylistsOpen(true);
            setCreatingPlaylist(true);
          }
        }}
        title={
          writablePlaylists.length >= 2
            ? 'Click or press A to cycle target SIMP Playlist for + buttons'
            : 'Click or press A to create a new SIMP Playlist'
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: '#0c161c',
          border: '1px solid #2aa3c4',
          borderRadius: 10,
          padding: '0 10px',
          minHeight: 36,
          color: '#bfeaf5',
          fontSize: 11,
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        <span style={{ color: '#8e8e99', fontWeight: 600 }}>Add `+` to:</span>
        <span style={{ color: '#67e8f9' }}>
          {activeWp
            ? writablePlaylists.length >= 2
              ? `★ ${activeWp.name} ⟳ (${activeIdx + 1}/${writablePlaylists.length})`
              : `★ ${activeWp.name} (+ New)`
            : '★ Favorites (+ Create)'}
        </span>
      </button>
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
          {pl.cover_art_url ? (
            <img
              src={pl.cover_art_url}
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
                background: isLocal ? '#0f222a' : '#251018',
                border: isLocal ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              {isLocal ? '🎵' : '🍎'}
            </div>
          )}
          <span
            style={{
              padding: '3px 7px',
              borderRadius: 6,
              background: isLocal ? '#0f222a' : '#251018',
              border: isLocal ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
              color: isLocal ? '#67e8f9' : '#fda4af',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {sourceBadge}
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
          {alb.art_url ? (
            <img
              src={alb.art_url}
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
                background: '#121820',
                border: '1px solid #222e3c',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              💿
            </div>
          )}
          <span
            style={{
              padding: '3px 7px',
              borderRadius: 6,
              background: isAppleAlbum ? '#251018' : '#0f222a',
              border: isAppleAlbum ? '1px solid #4c1d2e' : '1px solid #2aa3c4',
              color: isAppleAlbum ? '#fda4af' : '#67e8f9',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {isAppleAlbum ? '🍎' : '💾'}
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
          {pl.art_url ? (
            <img
              src={pl.art_url}
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
                background: '#181118',
                border: '1px solid #321a24',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              ☁️
            </div>
          )}
          <span
            style={{
              padding: '3px 7px',
              borderRadius: 6,
              background: isPinned ? '#0f222a' : '#251018',
              border: isPinned ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
              color: isPinned ? '#67e8f9' : '#fda4af',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {isPinned ? '✓ Pinned' : '🍎'}
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
          {alb.art_url ? (
            <img
              src={alb.art_url}
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
                background: '#181118',
                border: '1px solid #321a24',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              💿
            </div>
          )}
          <span
            style={{
              padding: '3px 7px',
              borderRadius: 6,
              background: isPinned ? '#0f222a' : '#251018',
              border: isPinned ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
              color: isPinned ? '#67e8f9' : '#fda4af',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {isPinned ? '✓ Pinned' : '🍎'}
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
            {alb.title}
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
            {alb.artist}
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

  // Reusable Row/Card for Individual Songs / Singles (Direct Play + Add to Hybrid Playlist + Open Full Album)
  const renderSingleSongRow = (s: TrackMetadata, peerList: TrackMetadata[], ctxPrefix: string) => (
    <div
      key={s.uri}
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
            🎵
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
        <button
          data-row-aux="true"
          onClick={() => handleAddTracksToPlaylist([s.uri], `"${s.title}"`, [s])}
          title="Add single to active SIMP Hybrid Playlist"
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
      </div>
    </div>
  );

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
                ? '🔍 Filter local playlists, albums, or tracks... (Press A)'
                : '🔍 Search SIMP Library, Apple Playlists & Catalog... (Press A)'
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

        {/* Row 2: Top-Level Source Filter Bar (`[ 🌐 All | 💾 Local | 🍎 Apple Music ]`) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
            gap: 6,
          }}
        >
          {(
            [
              { id: 'all', label: '🌐 All', isApple: false },
              { id: 'local', label: '💾 Local', isApple: false },
              {
                id: 'apple_music',
                label:
                  appleAuthState === 'reauth_required' ? '🍎 Apple ⚠️' : '🍎 Apple Music',
                isApple: true,
              },
            ] as const
          ).map((tab) => {
            const active = browserSourceFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setBrowserSourceFilter(tab.id);
                  if (tab.id === 'local') {
                    setAppleSubTab('pinned');
                    setRightPaneMode('browse');
                  } else if (
                    tab.id === 'apple_music' &&
                    (browserTarget?.kind === 'mount' || browserTarget?.kind === 'cdda')
                  ) {
                    setRightPaneMode('browse');
                  }
                }}
                style={{
                  minHeight: 34,
                  padding: '0 6px',
                  borderRadius: 8,
                  background: active ? (tab.isApple ? '#28111b' : '#0f222a') : '#0a0a0e',
                  border: active
                    ? tab.isApple
                      ? '1px solid #fa243c'
                      : '1px solid #2aa3c4'
                    : '1px solid #1e1e26',
                  color: active ? (tab.isApple ? '#fecdd3' : '#bfeaf5') : '#9ca3af',
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

        {/* =================================================================
            COLLAPSIBLE BUCKET 0: ▾ PLACES (Vertical Destination Stack)
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
            {(browserSourceFilter === 'local'
              ? [
                  {
                    id: 'pinned' as const,
                    label: `📌 Local SIMP Library (${filteredPlaylists.length + albums.length})`,
                    isSimp: true,
                  },
                ]
              : [
                  {
                    id: 'pinned' as const,
                    label:
                      browserSourceFilter === 'apple_music'
                        ? `📌 SIMP Library (${filteredPlaylists.length + albums.length})`
                        : `📌 My SIMP Library (${filteredPlaylists.length + albums.length})`,
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
            ).map((hub) => {
              const active = appleSubTab === hub.id && rightPaneMode === 'browse';
              return (
                <button
                  key={hub.id}
                  data-default-focus={hub.id === 'pinned' ? 'true' : undefined}
                  data-left-active={active ? 'true' : undefined}
                  onClick={() => {
                    setAppleSubTab(hub.id);
                    setRightPaneMode('browse');
                    focusRightPaneFirstTile();
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
            })}
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
            COLLAPSIBLE BUCKET 1: ▾ SIMP PLAYLISTS (HYBRID & PINNED)
           ================================================================= */}
        <button
          onClick={togglePlaylistsOpen}
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
          <span>
            {playlistsOpen ? '▾' : '▸'} SIMP PLAYLISTS ({filteredPlaylists.length})
          </span>
        </button>

        {playlistsOpen && (
          <button
            onClick={() => setCreatingPlaylist((v) => !v)}
            style={{
              minHeight: 32,
              padding: '0 10px',
              borderRadius: 8,
              background: creatingPlaylist ? '#0f222a' : '#101018',
              border: creatingPlaylist ? '1px solid #2aa3c4' : '1px solid #222230',
              color: '#2aa3c4',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {creatingPlaylist ? '✕ Cancel New Playlist' : '+ New SIMP Playlist'}
          </button>
        )}

        {playlistsOpen && creatingPlaylist && (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              data-osk-input="playlist"
              placeholder="New SIMP Playlist name (Press A)..."
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
            const cleanTitle = cleanCollectionTitle(pl.name);
            const inlineSources =
              isLocalPlaylist && pl.has_local && pl.has_apple
                ? '💾🍎 '
                : isLocalPlaylist && pl.has_apple
                ? '🍎 '
                : isLocalPlaylist && pl.has_local
                ? '💾 '
                : '';
            return (
              <button
                key={pl.id}
                data-left-active={isSelected ? 'true' : undefined}
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
                  {isLocalPlaylist ? `🎵 ${cleanTitle}` : `🍎 ${cleanTitle}`}
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

        {/* =================================================================
            COLLAPSIBLE BUCKET 2: 💿 ALBUMS & SOUNDTRACKS
           ================================================================= */}
        <button
          onClick={toggleAlbumsOpen}
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
          <span>
            {albumsOpen ? '▾' : '▸'}{' '}
            {browserSourceFilter === 'apple_music'
              ? `PINNED ALBUMS (${albums.length})`
              : browserSourceFilter === 'local'
              ? `LOCAL ALBUMS (${albums.length})`
              : `ALBUMS & SOUNDTRACKS (${albums.length})`}
            {browserTarget?.kind === 'mount' && selectedMountObj
              ? ` — ${selectedMountObj.label}`
              : ''}
          </span>
        </button>

        {albumsOpen &&
          albums.map((alb) => {
            const isSelected =
              rightPaneMode === 'tracks' &&
              browserTarget?.kind === 'album' &&
              browserTarget.id === alb.id;
            const isAppleAlbum = alb.id.startsWith('applemusic:album:');
            const cleanTitle = cleanCollectionTitle(alb.title);
            return (
              <button
                key={alb.id}
                data-left-active={isSelected ? 'true' : undefined}
                onClick={() => selectLocalCollection({ kind: 'album', id: alb.id })}
                style={{
                  minHeight: 44,
                  padding: '5px 10px',
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
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isAppleAlbum ? `🍎 ${cleanTitle}` : `💿 ${cleanTitle}`}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: '#8e8e99',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {alb.album_artist}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: '#2aa3c4',
                    flexShrink: 0,
                  }}
                >
                  {alb.track_count}
                </span>
              </button>
            );
          })}

        {/* =================================================================
            COLLAPSIBLE BUCKET 3 (Only in `🌐 All` or `💾 Local`): 💾 STORAGE & OPTICAL CD
           ================================================================= */}
        {browserSourceFilter !== 'apple_music' && (
          <>
            <button
              onClick={toggleStorageOpen}
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
              <span>
                {storageOpen ? '▾' : '▸'} STORAGE & CD ({snap?.mounts.length ?? 0})
              </span>
            </button>

            {storageOpen && (
              <>
                <button
                  onClick={() => setSourceModalOpen(true)}
                  style={{
                    minHeight: 32,
                    padding: '0 10px',
                    borderRadius: 8,
                    background: '#101018',
                    border: '1px solid #222230',
                    color: '#2aa3c4',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  ⚙ Manage Storage & Sources
                </button>
                {snap?.mounts.map((m) => {
                  const isMountSelected =
                    rightPaneMode === 'tracks' &&
                    browserTarget?.kind === 'mount' &&
                    browserTarget.id === m.mount_root;
                  return (
                    <button
                      key={m.mount_root}
                      data-left-active={isMountSelected ? 'true' : undefined}
                      onClick={() => {
                        if (isMountSelected) {
                          setBrowserTarget(null);
                          setRightPaneMode('browse');
                          focusRightPaneFirstTile();
                        } else {
                          selectLocalCollection({ kind: 'mount', id: m.mount_root });
                        }
                      }}
                      style={{
                        padding: '7px 10px',
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
                    padding: '7px 10px',
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
                        ? '⏳ Reading TOC & MusicBrainz...'
                        : opticalDisc?.is_audio_cd
                        ? `${opticalDisc.artist_name || 'Unknown Artist'} • ${
                            opticalDisc.tracks.length
                          } tracks`
                        : opticalDisc?.status_message || 'Click Scan when CD-ROM is connected'}
                    </div>
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    <button
                      data-row-aux="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleScanOpticalDisc(true, false);
                      }}
                      disabled={cdScanning}
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
                        data-row-aux="true"
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
          </>
        )}
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
        {/* =================================================================
            STATE A: ⊞ 4-COLUMN-MAX VISUAL TILE GRID (My SIMP Library, Apple Playlists, Radio, New, Search)
           ================================================================= */}
        {rightPaneMode === 'browse' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, width: '100%' }}>
            {/* Not Signed In Setup Card (only shown when opening an Apple Cloud Hub while not authenticated) */}
            {!snap?.apple_authenticated &&
              appleSubTab !== 'pinned' &&
              browserSourceFilter !== 'local' && (
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

            {cloudLoading && (
              <div
                style={{
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: '#fda4af',
                  padding: '4px 2px',
                }}
              >
                ⏳ Loading from Apple Music Cloud...
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
                  {renderHybridTargetSelector()}
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

                {/* 1D. Public Apple Music Catalog Search Results */}
                {browserSourceFilter !== 'local' && snap?.apple_authenticated && (
                  <>
                    {catalogSearchResults.albums.length > 0 && (
                      <>
                        <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                          🍎 APPLE CATALOG ALBUMS ({catalogSearchResults.albums.length})
                        </div>
                        <div style={tileGridStyle}>
                          {catalogSearchResults.albums.map(renderCloudAlbumCard)}
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

                {filteredPlaylists.length === 0 &&
                  filteredCloudPlaylists.length === 0 &&
                  albums.length === 0 &&
                  catalogSearchResults.albums.length === 0 &&
                  catalogSearchResults.playlists.length === 0 &&
                  catalogSearchResults.stations.length === 0 &&
                  catalogSearchResults.songs.length === 0 &&
                  !cloudLoading && (
                    <div style={{ fontSize: 12, color: '#8e8e99', padding: '12px 4px' }}>
                      No playlists, albums, or catalog matches found for "{browserSearch.trim()}".
                    </div>
                  )}
              </>
            ) : (
              <>
                {/* ---------------------------------------------------------
                    2. 📌 MY SIMP LIBRARY HUB (2-Column Visual Card Grid & Playlist Manager)
                   --------------------------------------------------------- */}
                {appleSubTab === 'pinned' && (
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

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          onClick={() => setCreatingPlaylist((v) => !v)}
                          style={{
                            minHeight: 34,
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
                          {creatingPlaylist ? 'Cancel' : '+ New SIMP Playlist'}
                        </button>
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
                          placeholder="Name your new SIMP Hybrid Playlist (Local + Apple Music)..."
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

                    {/* Pinned Apple Music Playlists Section */}
                    {(simpHubFilter === 'all' || simpHubFilter === 'pinned') &&
                      pinnedPlaylistsList.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>
                            📌 PINNED APPLE MUSIC PLAYLISTS ({pinnedPlaylistsList.length})
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
                {appleSubTab === 'cloud_playlists' && snap?.apple_authenticated && (
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
                {appleSubTab === 'radio' && snap?.apple_authenticated && (
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
                          ] as const
                        ).map((f) => {
                          const active = radioFilter === f.id;
                          return (
                            <button
                              key={f.id}
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
                {appleSubTab === 'new' && snap?.apple_authenticated && (
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
                        {renderHybridTargetSelector()}
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
                <button
                  data-right-back-grid="true"
                  onClick={() => {
                    setRightPaneMode('browse');
                    focusRightPaneFirstTile();
                  }}
                  title={`Return to ${activeHubLabel} Grid`}
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
                  ⊞ {activeHubLabel}
                </button>

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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {browserTarget.kind !== 'cdda' &&
                    !(
                      browserTarget.kind === 'playlist' &&
                      selectedPlaylistObj?.origin === 'simp_local'
                    ) &&
                    renderHybridTargetSelector()}

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
                        minHeight: 40,
                        padding: '0 12px',
                        borderRadius: 10,
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
                        minHeight: 40,
                        padding: '0 12px',
                        borderRadius: 10,
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
                      onClick={() => {
                        handleDeletePlaylist(selectedPlaylistObj.id, selectedPlaylistObj.name);
                        setRightPaneMode('browse');
                      }}
                      style={{
                        minHeight: 40,
                        padding: '0 12px',
                        borderRadius: 10,
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

                  {browserTarget.kind === 'album' &&
                    selectedAlbumObj &&
                    selectedAlbumObj.id.startsWith('applemusic:album:') && (
                      <button
                        onClick={() => {
                          handleDeleteAlbum(selectedAlbumObj.id, selectedAlbumObj.title);
                          setRightPaneMode('browse');
                        }}
                        style={{
                          minHeight: 40,
                          padding: '0 12px',
                          borderRadius: 10,
                          background: '#221116',
                          color: '#f87171',
                          border: '1px solid #5c222d',
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        ✕ Unpin Album
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
                        minHeight: 40,
                        padding: '0 12px',
                        borderRadius: 10,
                        background: '#14141c',
                        color: '#2aa3c4',
                        border: '1px solid #2e2e3a',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      + Add All to Hybrid
                    </button>
                  )}

                  <button
                    data-right-play-all="true"
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
                  data-right-track="true"
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
                            : t.source === 'cdda'
                            ? '#261a0d'
                            : '#101822',
                        color:
                          t.source === 'apple_music'
                            ? '#fda4af'
                            : t.source === 'cdda'
                            ? '#fcd34d'
                            : '#67e8f9',
                      }}
                    >
                      {t.source === 'apple_music'
                        ? '🍎 Apple'
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
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddTracksToPlaylist([t.uri], `"${t.title}"`, [t]);
                        }}
                        title="Add track to selected SIMP Playlist"
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
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveTrackFromPlaylist(browserTarget.id, t.uri, t.title);
                        }}
                        title={`Remove "${t.title}" from this playlist`}
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
    </main>
  );
};
