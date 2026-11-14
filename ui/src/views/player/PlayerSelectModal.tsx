import React from 'react';
import {
  SoundCloudComment,
  TrackMetadata,
  VideoQualityVariant,
  VideoSubtitleVariant,
} from '@simp/client';
import {
  VISUALIZER_MODES,
  type VisualizerEngine,
  type VisualizerMode,
} from '../../components/PlayerBackgroundVisualizer';
import { type FactoidBubbleItem } from '../../components/visualizers/VisualizerOverlayHud';
import { type DspConfigState } from '../../components/EqualizerModal';
import {
  likeSoundCloudTrack,
  toggleFollowSoundCloudUser,
} from '../../drivers/SoundCloudDriver';
import { type TrackLyricsResponse } from '../../drivers/appleApi';
import { ImpIcon } from '../../components/icons/ImpIcon';
import { type ImpSourceTheme } from '../../theme/sourceTheme';

export interface PlayerSelectQueueItem {
  key: string;
  index: number;
  title: string;
  subtitle: string;
  durationMs: number;
  badgeLabel: string;
  isCurrent: boolean;
  onSelect: () => void;
}

export interface PlayerSelectModalProps {
  playerActionsOpen: boolean;
  setPlayerActionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  track: TrackMetadata | null | undefined;
  selectCategory: 'track_options' | 'collection' | 'interface';
  setSelectCategory: React.Dispatch<
    React.SetStateAction<'track_options' | 'collection' | 'interface'>
  >;
  handleOpenCurrentCollection: () => void;
  activeRightColItems: PlayerSelectQueueItem[];
  isSoundCloudTrack: boolean;
  isVideoTrack: boolean;
  handleFavoriteTrack?: (track: TrackMetadata) => Promise<void>;
  showToast?: (msg: string) => void;
  isCurrentTrackFavorited: boolean;
  handleAddAppleToCloudLibrary?: (
    idOrUri: string,
    kind?: 'songs' | 'albums' | 'playlists',
    label?: string
  ) => Promise<void>;
  handleAddTracksToPlaylist?: (
    uris: string[],
    label: string,
    trackMetadata?: TrackMetadata[]
  ) => Promise<void>;
  primaryArtist: string;
  handleStartSoundCloudTrackRadio?: (seedTrack: TrackMetadata) => void;
  handleMoreByArtist?: (
    artistName: string,
    preferredSource?: string,
    artistId?: string
  ) => void;
  scTrackUserId: string | null;
  setVideoTheatreExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  scCreatorFollowed: boolean;
  setScCreatorFollowed: React.Dispatch<React.SetStateAction<boolean>>;
  playerTheme: ImpSourceTheme;
  rightColMode: 'queue' | 'chapters';
  chapterModalItems: PlayerSelectQueueItem[];
  currentQueueIdx: number;
  queueModalItems: PlayerSelectQueueItem[];
  setRightColMode: React.Dispatch<React.SetStateAction<'queue' | 'chapters'>>;
  togglePlayerFullscreen: () => void;
  isFullscreen: boolean;
  setVizDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  vizMode: VisualizerMode;
  enabledVizScenes: VisualizerEngine[];
  setEqualizerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  dspState: DspConfigState;
  handleToggleKaraokeMode: (enable: boolean) => void;
  lyricsKaraokeEnabled: boolean;
  toggleLyricsKaraoke: () => void;
  lyricsData: TrackLyricsResponse | null;
  toggleLyricsViz: () => void;
  lyricsVizEnabled: boolean;
  toggleFactoids: () => void;
  factoidsEnabled: boolean;
  factoidBubbles: FactoidBubbleItem[];
  idleFadeEnabled: boolean;
  toggleIdleFade: () => void;
  idleOpacityPct: number;
  updateIdleOpacityPct: (nextPct: number) => void;
  toggleScComments: () => void;
  scCommentsEnabled: boolean;
  scComments: SoundCloudComment[];
  toggleTheatreFullscreen: () => void;
  videoTheatreExpanded: boolean;
  cycleVideoQuality: () => void;
  activeQuality: VideoQualityVariant;
  videoQualities: VideoQualityVariant[];
  selectedQualityIdx: number;
  cycleVideoSubtitles: () => void;
  activeSubtitle: VideoSubtitleVariant | null;
  videoSubtitles: VideoSubtitleVariant[];
}

const actionRowBtnStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 52,
  padding: '10px 14px',
  borderRadius: 12,
  background: '#101018',
  border: '1px solid #222230',
  color: '#f4f4f6',
  textAlign: 'left',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  cursor: 'pointer',
};

export const PlayerSelectModal: React.FC<PlayerSelectModalProps> = ({
  playerActionsOpen,
  setPlayerActionsOpen,
  track,
  selectCategory,
  setSelectCategory,
  handleOpenCurrentCollection,
  activeRightColItems,
  isSoundCloudTrack,
  isVideoTrack,
  handleFavoriteTrack,
  showToast,
  isCurrentTrackFavorited,
  handleAddAppleToCloudLibrary,
  handleAddTracksToPlaylist,
  primaryArtist,
  handleStartSoundCloudTrackRadio,
  handleMoreByArtist,
  scTrackUserId,
  setVideoTheatreExpanded,
  scCreatorFollowed,
  setScCreatorFollowed,
  playerTheme,
  rightColMode,
  chapterModalItems,
  currentQueueIdx,
  queueModalItems,
  setRightColMode,
  togglePlayerFullscreen,
  isFullscreen,
  setVizDrawerOpen,
  vizMode,
  enabledVizScenes,
  setEqualizerOpen,
  dspState,
  handleToggleKaraokeMode,
  lyricsKaraokeEnabled,
  toggleLyricsKaraoke,
  lyricsData,
  toggleLyricsViz,
  lyricsVizEnabled,
  toggleFactoids,
  factoidsEnabled,
  factoidBubbles,
  idleFadeEnabled,
  toggleIdleFade,
  idleOpacityPct,
  updateIdleOpacityPct,
  toggleScComments,
  scCommentsEnabled,
  scComments,
  toggleTheatreFullscreen,
  videoTheatreExpanded,
  cycleVideoQuality,
  activeQuality,
  videoQualities,
  selectedQualityIdx,
  cycleVideoSubtitles,
  activeSubtitle,
  videoSubtitles,
}) => {
  return (
    <>
      {playerActionsOpen && (
        <div
          onClick={() => setPlayerActionsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.72)',
            zIndex: 55,
          }}
        >
          <div
            data-modal-root="true"
            data-player-actions-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: 58,
              left: 16,
              width: 'min(760px, calc(100vw - 32px))',
              maxHeight: 'calc(100vh - 76px)',
              overflow: 'hidden',
              background: '#0a0a10',
              border: '2px solid #2aa3c4',
              borderRadius: 18,
              padding: 16,
              boxSizing: 'border-box',
              boxShadow: '0 20px 52px rgba(0, 0, 0, 0.92)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: 8,
                borderBottom: '1px solid #1e1e2a',
                flexShrink: 0,
              }}
            >
              <div style={{ minWidth: 0, flex: 1, marginRight: 10 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 800,
                    color: '#bfeaf5',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ImpIcon name="gamepad-select" size={14} color="#67e8f9" />
                  <span>SELECT Menu</span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#8e8e99',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginTop: 2,
                  }}
                >
                  {track ? `${track.title} — ${track.artists.join(', ')}` : 'No active track'}
                </div>
              </div>
              <button
                type="button"
                data-player-actions-close="true"
                onClick={() => setPlayerActionsOpen(false)}
                style={{
                  minHeight: 34,
                  padding: '0 11px',
                  borderRadius: 9,
                  background: '#16161f',
                  border: '1px solid #2e2e3a',
                  color: '#d4d4dc',
                  fontFamily: 'monospace',
                  fontSize: 11.5,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                ✕<span className="simp-gp-badge"> B</span>
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '230px 1fr',
                gap: 14,
                minHeight: 0,
                flex: 1,
                overflow: 'hidden',
              }}
            >
              {/* Left Column: 3-Row XMB Category Selector (Up/Down or Hover exposes Right Pane) */}
              <div
                data-player-actions-col="left"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  overflowY: 'auto',
                  padding: '4px 6px',
                  boxSizing: 'border-box',
                }}
              >
                <button
                  type="button"
                  data-default-focus="true"
                  data-select-category="track_options"
                  data-select-active={selectCategory === 'track_options' ? 'true' : undefined}
                  onFocus={() => setSelectCategory('track_options')}
                  onMouseEnter={() => setSelectCategory('track_options')}
                  onClick={() => setSelectCategory('track_options')}
                  style={{
                    ...actionRowBtnStyle,
                    minHeight: 46,
                    padding: '8px 12px',
                    background: selectCategory === 'track_options' ? '#0f222a' : '#101018',
                    border:
                      selectCategory === 'track_options'
                        ? '1px solid #2aa3c4'
                        : '1px solid #222230',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: selectCategory === 'track_options' ? '#bfeaf5' : '#e4e4ec',
                      }}
                    >
                      🎵 Track Options
                    </span>
                    <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                      Favorite, Hybrid, Radio, Artist
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: selectCategory === 'track_options' ? '#67e8f9' : '#71717a',
                    }}
                  >
                    ▸
                  </span>
                </button>

                <button
                  type="button"
                  data-select-category="collection"
                  data-select-active={selectCategory === 'collection' ? 'true' : undefined}
                  onFocus={() => setSelectCategory('collection')}
                  onMouseEnter={() => setSelectCategory('collection')}
                  onClick={handleOpenCurrentCollection}
                  style={{
                    ...actionRowBtnStyle,
                    minHeight: 46,
                    padding: '8px 12px',
                    background: selectCategory === 'collection' ? '#0f222a' : '#101018',
                    border:
                      selectCategory === 'collection'
                        ? '1px solid #2aa3c4'
                        : '1px solid #222230',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: selectCategory === 'collection' ? '#bfeaf5' : '#e4e4ec',
                      }}
                    >
                      💿 Open Collection
                    </span>
                    <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                      A: Open in Library • ►: Queue ({activeRightColItems.length})
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: selectCategory === 'collection' ? '#67e8f9' : '#71717a',
                    }}
                  >
                    ▸
                  </span>
                </button>

                <button
                  type="button"
                  data-select-category="interface"
                  data-select-active={selectCategory === 'interface' ? 'true' : undefined}
                  onFocus={() => setSelectCategory('interface')}
                  onMouseEnter={() => setSelectCategory('interface')}
                  onClick={() => setSelectCategory('interface')}
                  style={{
                    ...actionRowBtnStyle,
                    minHeight: 46,
                    padding: '8px 12px',
                    background: selectCategory === 'interface' ? '#0f222a' : '#101018',
                    border:
                      selectCategory === 'interface'
                        ? '1px solid #2aa3c4'
                        : '1px solid #222230',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        color: selectCategory === 'interface' ? '#bfeaf5' : '#e4e4ec',
                      }}
                    >
                      🖥️ Interface
                    </span>
                    <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                      Fullscreen, Visualizer, Lyrics, Factoids
                      {isSoundCloudTrack ? ', Comments' : ''}
                      {isVideoTrack ? ', Stream' : ''}
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: selectCategory === 'interface' ? '#67e8f9' : '#71717a',
                    }}
                  >
                    ▸
                  </span>
                </button>
              </div>

              {/* Right Column: Context-Exposed XMB Pane */}
              <div
                data-player-actions-col="right"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: '#0d0d15',
                  border: '1px solid #1e1e2c',
                  borderRadius: 14,
                  padding: 12,
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                {selectCategory === 'track_options' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      overflowY: 'auto',
                      flex: 1,
                      padding: '4px 6px',
                      boxSizing: 'border-box',
                    }}
                  >
                    {track ? (
                      <>
                        {/* 1. Favorite / Like Track */}
                        <button
                          type="button"
                          onClick={() => {
                            setPlayerActionsOpen(false);
                            if (handleFavoriteTrack) {
                              handleFavoriteTrack(track);
                            } else if (track.source === 'soundcloud') {
                              likeSoundCloudTrack(track.uri, showToast);
                            }
                          }}
                          style={{
                            ...actionRowBtnStyle,
                            minHeight: 46,
                            padding: '8px 12px',
                            background: isCurrentTrackFavorited ? '#241016' : '#101018',
                            border: isCurrentTrackFavorited
                              ? '1px solid #f43f5e'
                              : '1px solid #222230',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fda4af' }}>
                              {isCurrentTrackFavorited ? '❤️ Favorited' : '♡ Favorite'}
                            </span>
                            <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                              {track.source === 'apple_music'
                                ? 'Love on Apple Music & ★ Favorites'
                                : track.source === 'soundcloud'
                                  ? 'Like on SoundCloud & ★ Favorites'
                                  : 'Save to ★ Favorites playlist'}
                            </span>
                          </div>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#fda4af' }}>
                            {isCurrentTrackFavorited ? '❤️ ON' : '+ ❤️'}
                          </span>
                        </button>

                        {/* 2. Add to Apple Cloud Library (Apple Music only) */}
                        {track.source === 'apple_music' && handleAddAppleToCloudLibrary && (
                          <button
                            type="button"
                            onClick={() => {
                              setPlayerActionsOpen(false);
                              handleAddAppleToCloudLibrary(track.uri, 'songs', track.title);
                            }}
                            style={{ ...actionRowBtnStyle, minHeight: 46, padding: '8px 12px' }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fca5a5' }}>
                                ☁️ + Cloud Library
                              </span>
                              <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                                Save to personal iCloud Music Library
                              </span>
                            </div>
                            <span
                              style={{ fontFamily: 'monospace', fontSize: 11, color: '#fca5a5' }}
                            >
                              + ☁️
                            </span>
                          </button>
                        )}

                        {/* 3. + Hybrid Playlist */}
                        {handleAddTracksToPlaylist && (
                          <button
                            type="button"
                            onClick={() => {
                              setPlayerActionsOpen(false);
                              handleAddTracksToPlaylist([track.uri], `"${track.title}"`, [track]);
                            }}
                            style={{ ...actionRowBtnStyle, minHeight: 46, padding: '8px 12px' }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#67e8f9' }}>
                                ★ + Hybrid Playlist
                              </span>
                              <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                                Add track to active SIMP Hybrid Playlist
                              </span>
                            </div>
                            <span
                              style={{ fontFamily: 'monospace', fontSize: 11, color: '#67e8f9' }}
                            >
                              + ★
                            </span>
                          </button>
                        )}

                        {/* 4. Radio Station / Artist Mix */}
                        {!isVideoTrack && (track.source === 'soundcloud' || primaryArtist) && (
                          <button
                            type="button"
                            onClick={() => {
                              setPlayerActionsOpen(false);
                              if (
                                track.source === 'soundcloud' &&
                                handleStartSoundCloudTrackRadio
                              ) {
                                handleStartSoundCloudTrackRadio(track);
                              } else if (primaryArtist && handleMoreByArtist) {
                                handleMoreByArtist(
                                  primaryArtist,
                                  track.source,
                                  scTrackUserId || undefined
                                );
                              }
                            }}
                            style={{ ...actionRowBtnStyle, minHeight: 46, padding: '8px 12px' }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fdba74' }}>
                                📻{' '}
                                {track.source === 'soundcloud'
                                  ? 'Radio Station'
                                  : `Artist Mix / Station`}
                              </span>
                              <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                                {track.source === 'soundcloud'
                                  ? `Continuous station from "${track.title}"`
                                  : `Station & top mixes for ${primaryArtist}`}
                              </span>
                            </div>
                            <span
                              style={{ fontFamily: 'monospace', fontSize: 11, color: '#fdba74' }}
                            >
                              ▶
                            </span>
                          </button>
                        )}

                        {/* 5. More by Artist */}
                        {primaryArtist && handleMoreByArtist && (
                          <button
                            type="button"
                            onClick={() => {
                              setPlayerActionsOpen(false);
                              setVideoTheatreExpanded(false);
                              handleMoreByArtist(
                                primaryArtist,
                                track?.source,
                                scTrackUserId || undefined
                              );
                            }}
                            style={{ ...actionRowBtnStyle, minHeight: 46, padding: '8px 12px' }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#d4d4dc' }}>
                                👤 More by {primaryArtist}
                              </span>
                              <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                                Artist profile: tracks, albums & related
                              </span>
                            </div>
                            <span
                              style={{ fontFamily: 'monospace', fontSize: 11, color: '#9ca3af' }}
                            >
                              →
                            </span>
                          </button>
                        )}

                        {/* 6. Follow Artist (SoundCloud) */}
                        {isSoundCloudTrack && scTrackUserId && primaryArtist && (
                          <button
                            type="button"
                            onClick={() => {
                              const nextFollow = !scCreatorFollowed;
                              toggleFollowSoundCloudUser(
                                scTrackUserId,
                                nextFollow,
                                primaryArtist,
                                showToast
                              )
                                .then((ok) => {
                                  if (ok) setScCreatorFollowed(nextFollow);
                                })
                                .catch((err: any) => {
                                  showToast?.(
                                    err?.message || 'Sign in with SoundCloud to follow creators'
                                  );
                                });
                            }}
                            style={{
                              ...actionRowBtnStyle,
                              minHeight: 46,
                              padding: '8px 12px',
                              background: scCreatorFollowed ? '#1f120b' : '#101018',
                              border: scCreatorFollowed
                                ? '1px solid #ea580c'
                                : '1px solid #222230',
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fdba74' }}>
                                {scCreatorFollowed
                                  ? `✓ Following @${primaryArtist}`
                                  : `➕ Follow @${primaryArtist}`}
                              </span>
                              <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                                SoundCloud Following list & stream
                              </span>
                            </div>
                            <span
                              style={{
                                fontFamily: 'monospace',
                                fontSize: 10.5,
                                fontWeight: 800,
                                color: scCreatorFollowed ? '#fdba74' : '#9ca3af',
                              }}
                            >
                              {scCreatorFollowed ? 'FOLLOWING' : '+ FOLLOW'}
                            </span>
                          </button>
                        )}

                        {/* 7. Track Properties & Local Curation */}
                        <button
                          type="button"
                          data-track-properties-trigger="true"
                          onClick={() => {
                            window.dispatchEvent(
                              new CustomEvent('simp-open-track-properties', { detail: track }),
                            );
                          }}
                          style={{
                            ...actionRowBtnStyle,
                            minHeight: 46,
                            padding: '8px 12px',
                            background: '#111a26',
                            border: `1px solid ${playerTheme.accentBorder}`,
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span
                              style={{
                                fontSize: 12.5,
                                fontWeight: 800,
                                color: playerTheme.accent,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <ImpIcon name="sliders" size={14} color={playerTheme.accent} />
                              Track Properties & Curation
                            </span>
                            <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                              Refetch/suppress lyrics, sync offset ±250ms, cover art & overlays
                            </span>
                          </div>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontSize: 11,
                              color: playerTheme.accent,
                            }}
                          >
                            ▸
                          </span>
                        </button>
                      </>
                    ) : (
                      <div style={{ padding: 18, color: '#8e8e99', fontSize: 12 }}>
                        No track loaded.
                      </div>
                    )}
                  </div>
                )}

                {selectCategory === 'collection' && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingBottom: 8,
                        marginBottom: 8,
                        borderBottom: '1px solid #1e1e2c',
                        flexShrink: 0,
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#bfeaf5' }}>
                        📑{' '}
                        {rightColMode === 'chapters' && chapterModalItems.length > 0
                          ? 'MIX CHAPTERS'
                          : isVideoTrack
                            ? 'EPISODES / QUEUE'
                            : 'ACTIVE QUEUE'}{' '}
                        ({activeRightColItems.length > 0 ? currentQueueIdx + 1 : 0} /{' '}
                        {activeRightColItems.length})
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {chapterModalItems.length > 0 && queueModalItems.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setRightColMode((prev) =>
                                prev === 'chapters' ? 'queue' : 'chapters'
                              )
                            }
                            style={{
                              padding: '3px 8px',
                              borderRadius: 6,
                              background: '#161622',
                              border: '1px solid #2aa3c4',
                              color: '#67e8f9',
                              fontSize: 10.5,
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {rightColMode === 'chapters' ? 'Switch to Queue' : 'Switch to Chapters'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleOpenCurrentCollection}
                          style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            background: '#0f222a',
                            border: '1px solid #2aa3c4',
                            color: '#bfeaf5',
                            fontSize: 10.5,
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Open in Browser →
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        overflowY: 'auto',
                        flex: 1,
                        padding: '4px 6px',
                        boxSizing: 'border-box',
                      }}
                    >
                      {activeRightColItems.length > 0 ? (
                        activeRightColItems.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            data-queue-current={item.isCurrent ? 'true' : undefined}
                            onClick={item.onSelect}
                            style={{
                              width: '100%',
                              padding: '8px 11px',
                              borderRadius: 10,
                              background: item.isCurrent ? '#0f222a' : '#12121c',
                              border: item.isCurrent ? '1px solid #2aa3c4' : '1px solid #222230',
                              color: item.isCurrent ? '#7dd3fc' : '#d4d4dc',
                              textAlign: 'left',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 10,
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: item.isCurrent ? 800 : 600,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {item.isCurrent ? '▶ ' : `${item.index + 1}. `}
                                {item.title}
                              </div>
                              {item.subtitle && (
                                <div
                                  style={{
                                    fontSize: 10.5,
                                    color: item.isCurrent ? '#67e8f9' : '#71717a',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    marginTop: 1,
                                  }}
                                >
                                  {item.subtitle}
                                </div>
                              )}
                            </div>
                            <span
                              style={{
                                fontSize: 10.5,
                                fontFamily: 'monospace',
                                color: item.isCurrent ? '#67e8f9' : '#71717a',
                                flexShrink: 0,
                              }}
                            >
                              {item.badgeLabel || `#${item.index + 1}`}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div style={{ padding: 18, color: '#8e8e99', fontSize: 12 }}>
                          Queue is currently empty.
                        </div>
                      )}
                    </div>
                  </>
                )}

                {selectCategory === 'interface' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      overflowY: 'auto',
                      flex: 1,
                      padding: '4px 6px',
                      boxSizing: 'border-box',
                    }}
                  >
                    {/* 1. Full Screen */}
                    <button
                      type="button"
                      onClick={() => {
                        setPlayerActionsOpen(false);
                        togglePlayerFullscreen();
                      }}
                      style={{
                        ...actionRowBtnStyle,
                        minHeight: 46,
                        padding: '8px 12px',
                        background: isFullscreen ? '#0f222a' : '#101018',
                        border: isFullscreen ? '1px solid #2aa3c4' : '1px solid #222230',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: '#bfeaf5' }}>
                          ⛶ {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                        </span>
                        <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                          Shortcut: F / F11 / Alt+F or double-click background
                        </span>
                      </div>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 11,
                          fontWeight: 800,
                          color: isFullscreen ? '#67e8f9' : '#71717a',
                        }}
                      >
                        {isFullscreen ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    {/* 2. Visualizer Scene Queue & Rotation Drawer (Audio tracks) */}
                    {!isVideoTrack && (
                      <button
                        type="button"
                        data-viz-drawer-trigger="true"
                        onClick={() => setVizDrawerOpen(true)}
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background: vizMode !== 'off' ? '#0f222a' : '#101018',
                          border: vizMode !== 'off' ? '1px solid #2aa3c4' : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#67e8f9' }}>
                            ✨ Visualizer:{' '}
                            {VISUALIZER_MODES.find((m) => m.id === vizMode)?.label ||
                              'Glyph Matrix'}
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            12 High-DPI Scenes • {enabledVizScenes.length}/12 in Cycle/Shuffle
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color: vizMode !== 'off' ? '#67e8f9' : '#71717a',
                          }}
                        >
                          {VISUALIZER_MODES.find((m) => m.id === vizMode)?.shortLabel || 'GLYPH'} ▸
                        </span>
                      </button>
                    )}

                    {/* 2a. 10-Band Audio Equalizer & Vocal Stage Drawer */}
                    {!isVideoTrack && (
                      <button
                        type="button"
                        data-equalizer-trigger="true"
                        onClick={() => setEqualizerOpen(true)}
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background:
                            dspState.eq_enabled || dspState.vocal_mode !== 'off'
                              ? '#0f222a'
                              : '#101018',
                          border:
                            dspState.eq_enabled || dspState.vocal_mode !== 'off'
                              ? '1px solid #38bdf8'
                              : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span
                            style={{
                              fontSize: 12.5,
                              fontWeight: 800,
                              color: '#7dd3fc',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <ImpIcon name="sliders" size={14} color="#38bdf8" />
                            10-Band Equalizer & Vocal Stage
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            EQ: {dspState.eq_enabled ? dspState.eq_preset.toUpperCase() : 'Flat (Bypass)'}{' '}
                            • Vocal:{' '}
                            {dspState.vocal_mode === 'vocal_remover'
                              ? 'Karaoke Remover'
                              : dspState.vocal_mode === 'vocal_isolate'
                                ? 'Vocal Isolate'
                                : 'Original'}
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color:
                              dspState.eq_enabled || dspState.vocal_mode !== 'off'
                                ? '#38bdf8'
                                : '#71717a',
                          }}
                        >
                          {dspState.eq_enabled || dspState.vocal_mode !== 'off' ? 'ACTIVE ▸' : 'OPEN ▸'}
                        </span>
                      </button>
                    )}

                    {/* 2a-ii. 1-Click Karaoke Mode (Vocal Remover + Synced Lyrics) */}
                    {!isVideoTrack && (
                      <button
                        type="button"
                        onClick={() =>
                          handleToggleKaraokeMode(
                            !(dspState.vocal_mode === 'vocal_remover' && lyricsKaraokeEnabled)
                          )
                        }
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background:
                            dspState.vocal_mode === 'vocal_remover' && lyricsKaraokeEnabled
                              ? '#0d261f'
                              : '#101018',
                          border:
                            dspState.vocal_mode === 'vocal_remover' && lyricsKaraokeEnabled
                              ? '1px solid #34d399'
                              : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span
                            style={{
                              fontSize: 12.5,
                              fontWeight: 800,
                              color: '#6ee7b7',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <ImpIcon
                              name={
                                dspState.vocal_mode === 'vocal_remover' ? 'mic-off' : 'mic'
                              }
                              size={14}
                              color="#34d399"
                            />
                            Karaoke Mode
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            Vocal remover + foreground synced lyrics
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color:
                              dspState.vocal_mode === 'vocal_remover' && lyricsKaraokeEnabled
                                ? '#34d399'
                                : '#71717a',
                          }}
                        >
                          {dspState.vocal_mode === 'vocal_remover' && lyricsKaraokeEnabled
                            ? 'ON'
                            : 'OFF'}
                        </span>
                      </button>
                    )}

                    {/* 2b. Karaoke / Foreground Synced Lyrics Overlay (LRCLIB v1/v2 + Local .lrc) */}
                    {!isVideoTrack && (
                      <button
                        type="button"
                        onClick={toggleLyricsKaraoke}
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background: lyricsKaraokeEnabled ? '#0f222a' : '#101018',
                          border: lyricsKaraokeEnabled ? '1px solid #2aa3c4' : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span
                            style={{
                              fontSize: 12.5,
                              fontWeight: 800,
                              color: '#67e8f9',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <ImpIcon name="lyrics" size={14} color="#67e8f9" />
                            Foreground Synced Lyrics
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            {lyricsData?.synced_lines?.length
                              ? `${lyricsData.synced_lines.length} synced lines (${lyricsData.source})`
                              : lyricsData?.instrumental
                                ? 'Instrumental track'
                                : 'Synced teleprompter lyrics overlay'}
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color: lyricsKaraokeEnabled ? '#67e8f9' : '#71717a',
                          }}
                        >
                          {lyricsKaraokeEnabled ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )}

                    {/* 2b-i. Visualizer Lyrics Data Element Toggle */}
                    {!isVideoTrack && (
                      <button
                        type="button"
                        onClick={toggleLyricsViz}
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background: lyricsVizEnabled ? '#121f2b' : '#101018',
                          border: lyricsVizEnabled ? '1px solid #38bdf8' : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span
                            style={{
                              fontSize: 12.5,
                              fontWeight: 800,
                              color: '#7dd3fc',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <ImpIcon name="sparkles" size={14} color="#7dd3fc" />
                            Visualizer Lyrics Data Element
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            {!lyricsKaraokeEnabled && !lyricsVizEnabled
                              ? 'Lyrics lookup disabled'
                              : 'Show synced lyrics inside visualizer scenes'}
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color: lyricsVizEnabled ? '#7dd3fc' : '#71717a',
                          }}
                        >
                          {lyricsVizEnabled ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )}

                    {/* 2b-ii. VH1 Pop-Up Factoid Speech Bubbles (Wikipedia / MusicBrainz) */}
                    {!isVideoTrack && (
                      <button
                        type="button"
                        onClick={toggleFactoids}
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background: factoidsEnabled ? '#241d0c' : '#101018',
                          border: factoidsEnabled ? '1px solid #eab308' : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fde047' }}>
                            💬 Pop-Up Factoids (VH1 / Wikipedia)
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            {factoidBubbles.length > 0
                              ? `${factoidBubbles.length} trivia bubble${factoidBubbles.length === 1 ? '' : 's'} queued for this track`
                              : 'Timed song & artist trivia speech bubbles'}
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color: factoidsEnabled ? '#fde047' : '#71717a',
                          }}
                        >
                          {factoidsEnabled ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )}

                    {/* 2c. Idle Controls Auto-Fade & Opacity */}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: '8px 12px',
                        borderRadius: 12,
                        background: idleFadeEnabled ? '#0f222a' : '#101018',
                        border: idleFadeEnabled ? '1px solid #2aa3c4' : '1px solid #222230',
                      }}
                    >
                      <button
                        type="button"
                        onClick={toggleIdleFade}
                        style={{
                          width: '100%',
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          color: '#f4f4f6',
                          textAlign: 'left',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 12,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#67e8f9' }}>
                            🫧 Idle Controls Fade (6s)
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            Auto-hide Nav Bar & fade controls to {idleOpacityPct}% opacity when idle
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color: idleFadeEnabled ? '#67e8f9' : '#71717a',
                          }}
                        >
                          {idleFadeEnabled ? `ON (${idleOpacityPct}%)` : 'OFF'}
                        </span>
                      </button>

                      {idleFadeEnabled && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            paddingTop: 4,
                            borderTop: '1px solid rgba(42, 163, 196, 0.22)',
                          }}
                        >
                          <span
                            style={{
                              fontSize: 10.5,
                              fontFamily: 'monospace',
                              color: '#9ca3af',
                              minWidth: 78,
                            }}
                          >
                            Idle Opacity:
                          </span>
                          <button
                            type="button"
                            data-row-aux="true"
                            onClick={() => updateIdleOpacityPct(idleOpacityPct - 10)}
                            style={{
                              minWidth: 28,
                              height: 26,
                              borderRadius: 6,
                              background: '#14141e',
                              border: '1px solid #2a2c3c',
                              color: '#bfeaf5',
                              fontFamily: 'monospace',
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            −
                          </button>
                          <input
                            type="range"
                            data-row-aux="true"
                            min={0}
                            max={90}
                            step={5}
                            value={idleOpacityPct}
                            onChange={(e) => updateIdleOpacityPct(Number(e.target.value))}
                            style={{
                              flex: 1,
                              accentColor: '#2aa3c4',
                              cursor: 'pointer',
                            }}
                          />
                          <button
                            type="button"
                            data-row-aux="true"
                            onClick={() => updateIdleOpacityPct(idleOpacityPct + 10)}
                            style={{
                              minWidth: 28,
                              height: 26,
                              borderRadius: 6,
                              background: '#14141e',
                              border: '1px solid #2a2c3c',
                              color: '#bfeaf5',
                              fontFamily: 'monospace',
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            +
                          </button>
                          <span
                            style={{
                              fontSize: 11,
                              fontFamily: 'monospace',
                              fontWeight: 800,
                              color: '#67e8f9',
                              minWidth: 36,
                              textAlign: 'right',
                            }}
                          >
                            {idleOpacityPct}%
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 3. Timed Comment Bubbles (SoundCloud only) */}
                    {isSoundCloudTrack && (
                      <button
                        type="button"
                        onClick={toggleScComments}
                        style={{
                          ...actionRowBtnStyle,
                          minHeight: 46,
                          padding: '8px 12px',
                          background: scCommentsEnabled ? '#1f120b' : '#101018',
                          border: scCommentsEnabled ? '1px solid #ea580c' : '1px solid #222230',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 800, color: '#fdba74' }}>
                            💬 Timed Comment Bubbles
                          </span>
                          <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                            {scComments.length} timed comments on this track
                          </span>
                        </div>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            fontWeight: 800,
                            color: scCommentsEnabled ? '#fdba74' : '#71717a',
                          }}
                        >
                          {scCommentsEnabled ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )}

                    {/* 4. Video Theatre & Stream Quality / Subtitles (Video tracks) */}
                    {isVideoTrack && (
                      <>
                        <button
                          type="button"
                          onClick={toggleTheatreFullscreen}
                          style={{
                            ...actionRowBtnStyle,
                            minHeight: 46,
                            padding: '8px 12px',
                            background: videoTheatreExpanded ? '#0f222a' : '#101018',
                            border: videoTheatreExpanded
                              ? '1px solid #2aa3c4'
                              : '1px solid #222230',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#67e8f9' }}>
                              {videoTheatreExpanded ? '↙ Exit Theatre Stage' : '⛶ Theatre Stage'}
                            </span>
                            <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                              Fill window with video stage & 4s auto-hide HUD
                            </span>
                          </div>
                          <span
                            style={{ fontFamily: 'monospace', fontSize: 11, color: '#67e8f9' }}
                          >
                            {videoTheatreExpanded ? 'CARD' : 'THEATRE'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={cycleVideoQuality}
                          style={{ ...actionRowBtnStyle, minHeight: 46, padding: '8px 12px' }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#f4f4f6' }}>
                              🎞️ Stream Quality: {activeQuality?.label || 'Default'}
                            </span>
                            <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                              {videoQualities.length} format(s) available
                            </span>
                          </div>
                          <span
                            style={{ fontFamily: 'monospace', fontSize: 11, color: '#2aa3c4' }}
                          >
                            {selectedQualityIdx + 1}/{Math.max(1, videoQualities.length)}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={cycleVideoSubtitles}
                          style={{ ...actionRowBtnStyle, minHeight: 46, padding: '8px 12px' }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 800, color: '#f4f4f6' }}>
                              💬 Subtitles / CC: {activeSubtitle ? activeSubtitle.label : 'Off'}
                            </span>
                            <span style={{ fontSize: 10.5, color: '#8e8e99' }}>
                              {videoSubtitles.length} subtitle track(s)
                            </span>
                          </div>
                          <span
                            style={{ fontFamily: 'monospace', fontSize: 11, color: '#2aa3c4' }}
                          >
                            {activeSubtitle ? 'ON' : 'OFF'}
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
