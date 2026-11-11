import React from "react";
import {
  AlbumRecord,
  OpticalDiscStatus,
  PlaylistRecord,
  SimpStateSnapshot,
  TrackMetadata,
} from "@simp/client";
import { AppleCloudPlaylistSummary } from "../../../drivers/AppleMusicDriver";
import { SoundCloudPlaylistSummary } from "../../../drivers/SoundCloudDriver";
import { SoundCloudLogo } from "../../../components/SoundCloudLogo";
import { OskTargetKind } from "../../../hooks/useGamepadNavigation";
import { BrowserTarget } from "../../PlayerView";
import { SourceVisibilityPrefs } from "../../SettingsModal";
import { cleanCollectionTitle } from "../libraryHelpers";
import { ImpIcon, ImpIconName } from "../../../components/icons/ImpIcon";

export interface LibraryXmbLeftColumnProps {
  browserSourceFilter: "all" | "local" | "apple_music" | "soundcloud" | "internet_archive";
  setBrowserSourceFilter: React.Dispatch<
    React.SetStateAction<"all" | "local" | "apple_music" | "soundcloud" | "internet_archive">
  >;
  selectedSources: Array<"local" | "apple_music" | "soundcloud" | "internet_archive">;
  setSelectedSources: React.Dispatch<
    React.SetStateAction<Array<"local" | "apple_music" | "soundcloud" | "internet_archive">>
  >;
  setBrowserSourceFilterRaw: React.Dispatch<
    React.SetStateAction<"all" | "local" | "apple_music" | "soundcloud" | "internet_archive">
  >;
  browserSearch: string;
  setBrowserSearch: React.Dispatch<React.SetStateAction<string>>;
  setOskTarget: React.Dispatch<React.SetStateAction<OskTargetKind>>;
  sourceVisibility: SourceVisibilityPrefs;
  snap: SimpStateSnapshot | null;
  appleAuthState: "connected" | "reauth_required" | "never_used";
  pushCurrentNavState: () => void;
  appleSubTab: "pinned" | "for_you" | "cloud_playlists" | "new" | "radio";
  setAppleSubTab: React.Dispatch<
    React.SetStateAction<"pinned" | "for_you" | "cloud_playlists" | "new" | "radio">
  >;
  soundCloudSubTab: "pinned" | "likes_sets" | "stream_radio" | "trending";
  setSoundCloudSubTab: React.Dispatch<
    React.SetStateAction<"pinned" | "likes_sets" | "stream_radio" | "trending">
  >;
  iaSubTab: "pinned" | "trending" | "films" | "tv" | "audio";
  setIaSubTab: React.Dispatch<
    React.SetStateAction<"pinned" | "trending" | "films" | "tv" | "audio">
  >;
  setIaSubFilter: React.Dispatch<React.SetStateAction<string>>;
  rightPaneMode: "browse" | "tracks" | "artist";
  setRightPaneMode: React.Dispatch<React.SetStateAction<"browse" | "tracks" | "artist">>;
  activeMountRoot: string | null;
  setActiveMountRoot: React.Dispatch<React.SetStateAction<string | null>>;
  mediaTypeFilter: "all" | "video" | "audio";
  setMediaTypeFilter: React.Dispatch<React.SetStateAction<"all" | "video" | "audio">>;
  placesOpen: boolean;
  togglePlacesOpen: () => void;
  filteredPlaylists: PlaylistRecord[];
  filteredAlbums: AlbumRecord[];
  pinnedAppleAlbumCount: number;
  scLikedTracks: TrackMetadata[];
  scPlaylists: SoundCloudPlaylistSummary[];
  cloudPlaylists: AppleCloudPlaylistSummary[];
  xmbPreviewTriggerRef: React.MutableRefObject<boolean>;
  focusRightPaneFirstTile: () => void;
  isSourceIncluded: (src: "local" | "apple_music" | "soundcloud" | "internet_archive") => boolean;
  opticalDisc: OpticalDiscStatus | null;
  cdScanning: boolean;
  browserTarget: BrowserTarget | null;
  selectLocalCollection: (target: BrowserTarget) => void;
  setBrowserTracks: React.Dispatch<React.SetStateAction<TrackMetadata[]>>;
  handleScanOpticalDisc: (forceRefresh?: boolean, silent?: boolean) => Promise<void>;
  handleEjectOpticalDisc: () => void;
  setSourceModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  playlistsOpen: boolean;
  togglePlaylistsOpen: () => void;
  creatingPlaylist: boolean;
  setCreatingPlaylist: React.Dispatch<React.SetStateAction<boolean>>;
  newPlaylistName: string;
  setNewPlaylistName: React.Dispatch<React.SetStateAction<string>>;
  handleCreatePlaylist: () => Promise<void>;
  activePlaylistId: string;
  setActivePlaylistId: React.Dispatch<React.SetStateAction<string>>;
}

export const LibraryXmbLeftColumn: React.FC<LibraryXmbLeftColumnProps> = ({
  browserSourceFilter,
  setBrowserSourceFilter,
  selectedSources,
  setSelectedSources,
  setBrowserSourceFilterRaw,
  browserSearch,
  setBrowserSearch,
  setOskTarget,
  sourceVisibility,
  snap,
  appleAuthState,
  pushCurrentNavState,
  appleSubTab,
  setAppleSubTab,
  soundCloudSubTab,
  setSoundCloudSubTab,
  iaSubTab,
  setIaSubTab,
  setIaSubFilter,
  rightPaneMode,
  setRightPaneMode,
  activeMountRoot,
  setActiveMountRoot,
  mediaTypeFilter,
  setMediaTypeFilter,
  placesOpen,
  togglePlacesOpen,
  filteredPlaylists,
  filteredAlbums,
  pinnedAppleAlbumCount,
  scLikedTracks,
  scPlaylists,
  cloudPlaylists,
  xmbPreviewTriggerRef,
  focusRightPaneFirstTile,
  isSourceIncluded,
  opticalDisc,
  cdScanning,
  browserTarget,
  selectLocalCollection,
  setBrowserTracks,
  handleScanOpticalDisc,
  handleEjectOpticalDisc,
  setSourceModalOpen,
  playlistsOpen,
  togglePlaylistsOpen,
  creatingPlaylist,
  setCreatingPlaylist,
  newPlaylistName,
  setNewPlaylistName,
  handleCreatePlaylist,
  activePlaylistId,
  setActivePlaylistId,
}) => {
  return (
    <>
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
        {/* Top-Level Multi-Select Source Filter Bar (`[ 🌐 All | 💾 Local | 🍎 Apple | ☁️ SC | 🏛️ Archive ]`)
            🌐 All resets to all sources; clicking individual pills toggles them into a custom multi-source mix. */}
        {(() => {
          const sourceTabs: Array<{
            id: 'all' | 'local' | 'apple_music' | 'soundcloud' | 'internet_archive';
            label: string;
            icon: ImpIconName;
            accent: 'teal' | 'apple' | 'soundcloud' | 'archive';
          }> = [
            { id: 'all', label: 'All', icon: 'globe', accent: 'teal' },
            { id: 'local', label: 'Local', icon: 'disc', accent: 'teal' },
            ...(sourceVisibility.apple_music &&
            (snap?.apple_authenticated || appleAuthState === 'reauth_required')
              ? [
                  {
                    id: 'apple_music' as const,
                    label: appleAuthState === 'reauth_required' ? 'Apple!' : 'Apple',
                    icon: 'apple' as const,
                    accent: 'apple' as const,
                  },
                ]
              : []),
            ...(sourceVisibility.soundcloud
              ? [
                  {
                    id: 'soundcloud' as const,
                    label: 'SC',
                    icon: 'soundcloud' as const,
                    accent: 'soundcloud' as const,
                  },
                ]
              : []),
            ...(sourceVisibility.internet_archive && snap?.internet_archive_authenticated
              ? [
                  {
                    id: 'internet_archive' as const,
                    label: 'Archive',
                    icon: 'archive' as const,
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
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    <ImpIcon name={tab.icon} size={11} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* Row 2b: Media Type Filter Strip (`[ All Media | Video | Audio ]`) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 5,
          }}
        >
          {(
            [
              { id: 'all' as const, label: 'All Media', icon: null },
              { id: 'video' as const, label: 'Video', icon: 'video' as const },
              { id: 'audio' as const, label: 'Audio', icon: 'music' as const },
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
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                {m.icon && <ImpIcon name={m.icon} size={11} />}
                <span>{m.label}</span>
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
                    label: `IMP Library (${filteredPlaylists.length})`,
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
                    label: `📌 IMP Library (${filteredPlaylists.length})`,
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
                      label: `📌 IMP Library (${filteredPlaylists.length + pinnedAppleAlbumCount})`,
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
                          : `📌 My IMP Library (${filteredPlaylists.length + pinnedAppleAlbumCount})`,
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <ImpIcon name="apple" size={13} color="#fda4af" />
                  <span>Apple Music</span>
                </span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#fda4af' }}>▸</span>
              </button>
            )}

            {browserSourceFilter === 'all' &&
              isSourceIncluded('soundcloud') && (
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <SoundCloudLogo width={30} color="#ffffff" />
                  <span>SoundCloud</span>
                </span>
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
            {playlistsOpen ? '▾' : '▸'} IMP PLAYLISTS ({filteredPlaylists.length})
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
            title={creatingPlaylist ? 'Cancel New IMP Playlist' : 'Create New IMP Hybrid Playlist'}
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
              placeholder="New IMP Playlist name..."
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
    </>
  );
};
