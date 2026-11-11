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

export interface LibraryTracklistRightPaneProps {
  activeHubLabel: string;
  activeIaDetail: ArchiveItemDetail | null;
  activeScPlaylist: SoundCloudPlaylistSummary | null;
  browserTarget: any;
  browserTracks: TrackMetadata[];
  cdScanning: boolean;
  cloudLoading: boolean;
  dvdAudioChoice: number;
  dvdSubChoice: string;
  favoritedUris: string[];
  focusRightPaneFirstTile: any;
  handleAddAppleToCloudLibrary: any;
  handleAddTracksToPlaylist: any;
  handleEjectOpticalDisc: any;
  handleFavoriteTrack: any;
  handleRemoveTrackFromPlaylist: any;
  handleScanOpticalDisc: any;
  handleStartSoundCloudTrackRadio: any;
  handleWalkBack: any;
  iaLoading: boolean;
  navHistory: any[];
  openArtistProfile: any;
  openLibraryContextMenu: any;
  openLocalVideoFile: any;
  opticalDisc: OpticalDiscStatus | null;
  playingContextId: string;
  selectCloudAlbum: any;
  selectedAlbumObj: AlbumRecord | null | undefined;
  selectedMountObj: { mount_root: string; label: string; track_count: number; is_online: boolean } | null | undefined;
  selectedPlaylistObj: PlaylistRecord | null | undefined;
  setActiveDvdPlayback: any;
  setDvdAudioChoice: any;
  setDvdSubChoice: any;
  setPlayingContextId: any;
  setRightPaneMode: any;
  setView: any;
  showToast: any;
  snap: SimpStateSnapshot | null;
  track: TrackMetadata | null | undefined;
}

export const LibraryTracklistRightPane: React.FC<LibraryTracklistRightPaneProps> = ({
  activeHubLabel,
  activeIaDetail,
  activeScPlaylist,
  browserTarget,
  browserTracks,
  cdScanning,
  cloudLoading,
  dvdAudioChoice,
  dvdSubChoice,
  favoritedUris,
  focusRightPaneFirstTile,
  handleAddAppleToCloudLibrary,
  handleAddTracksToPlaylist,
  handleEjectOpticalDisc,
  handleFavoriteTrack,
  handleRemoveTrackFromPlaylist,
  handleScanOpticalDisc,
  handleStartSoundCloudTrackRadio,
  handleWalkBack,
  iaLoading,
  navHistory,
  openArtistProfile,
  openLibraryContextMenu,
  openLocalVideoFile,
  opticalDisc,
  playingContextId,
  selectCloudAlbum,
  selectedAlbumObj,
  selectedMountObj,
  selectedPlaylistObj,
  setActiveDvdPlayback,
  setDvdAudioChoice,
  setDvdSubChoice,
  setPlayingContextId,
  setRightPaneMode,
  setView,
  showToast,
  snap,
  track,
}) => {
  return (
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

                  {browserTarget.kind === 'soundcloud_playlist' && (
                    <SoundCloudAttributionLink
                      permalinkUrl={activeScPlaylist?.permalink_url}
                      kind="playlist"
                      id={browserTarget.id}
                      label="SoundCloud"
                      width={30}
                      style={{ minHeight: 40, padding: '0 12px', borderRadius: 10 }}
                    />
                  )}
                  {(browserTarget.kind === 'cloud_album' ||
                    browserTarget.kind === 'cloud_playlist') && (
                    <AppleMusicAttributionLink
                      kind={browserTarget.kind === 'cloud_album' ? 'album' : 'playlist'}
                      id={browserTarget.id}
                      label="Apple Music"
                      style={{ minHeight: 40, padding: '0 12px', borderRadius: 10 }}
                    />
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

            {/* SoundCloud Set Gated (MONETIZE / Go+) Content Notice Banner */}
            {browserTarget?.kind === 'soundcloud_playlist' &&
              (activeScPlaylist?.gated_track_count ?? 0) > 0 &&
              (() => {
                const gatedCount = activeScPlaylist?.gated_track_count ?? 0;
                const permalinkUrl =
                  activeScPlaylist?.permalink_url ||
                  `https://soundcloud.com/sets/${encodeURIComponent(browserTarget.id)}`;
                const isSteamGameMode =
                  typeof window !== 'undefined' &&
                  (window.parent !== window ||
                    window.navigator.userAgent.includes('Valve Steam'));
                return (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 12,
                      background: 'linear-gradient(90deg, #221006 0%, #140c08 100%)',
                      border: '1px solid #ea580c',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#fed7aa' }}>
                        ☁️ {gatedCount} additional track{gatedCount === 1 ? '' : 's'} in "{browserTarget.title}" require SoundCloud Go+ / Web playback
                      </div>
                      <div style={{ fontSize: 11, color: '#fdba74' }}>
                        Available on SoundCloud: {permalinkUrl}
                      </div>
                    </div>
                    {!isSteamGameMode && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <SoundCloudAttributionLink
                          permalinkUrl={permalinkUrl}
                          kind="playlist"
                          id={browserTarget.id}
                          label="Open Set on SoundCloud ↗"
                          width={24}
                          style={{
                            minHeight: 32,
                            padding: '0 10px',
                            borderRadius: 8,
                            background: '#3b1909',
                            border: '1px solid #f97316',
                          }}
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard?.writeText(permalinkUrl).catch(() => {});
                            showToast(`Copied ${permalinkUrl}`);
                          }}
                          style={{
                            minHeight: 32,
                            padding: '0 10px',
                            borderRadius: 8,
                            background: '#181210',
                            border: '1px solid #432818',
                            color: '#fed7aa',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          📋 Copy URL
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

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
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openLibraryContextMenu({
                      type: 'track',
                      track: t,
                      peerList: browserTracks,
                      isViewingLocalPlaylist,
                    });
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
                    {t.source === 'soundcloud' ? (
                      <SoundCloudAttributionLink
                        kind="track"
                        id={t.uri}
                        width={30}
                        style={{ padding: '2px 6px' }}
                      />
                    ) : t.source === 'apple_music' ? (
                      <AppleMusicAttributionLink
                        kind="song"
                        id={t.uri}
                        style={{ padding: '2px 6px' }}
                      />
                    ) : (
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: 'monospace',
                          padding: '2px 6px',
                          borderRadius: 6,
                          background:
                            t.source === 'internet_archive' ||
                            t.source === 'ia_video' ||
                            t.source === 'cdda'
                              ? '#261a0d'
                              : '#101822',
                          color:
                            t.source === 'internet_archive' ||
                            t.source === 'ia_video' ||
                            t.source === 'cdda'
                              ? '#fcd34d'
                              : '#67e8f9',
                        }}
                      >
                        {(() => {
                          const fmt = extractAudioFormat(t.uri);
                          const fmtSuffix = fmt ? ` • ${fmt}` : '';
                          return t.source === 'ia_video'
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
                    )}
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
                    <button
                      data-row-aux="true"
                      data-context-select="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        openLibraryContextMenu({
                          type: 'track',
                          track: t,
                          peerList: browserTracks,
                          isViewingLocalPlaylist,
                        });
                      }}
                      title="Track Actions (SELECT)"
                      style={{
                        padding: '5px 8px',
                        borderRadius: 8,
                        background: '#14141e',
                        border: '1px solid #2a2a38',
                        color: '#cbd5e1',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      •••
                    </button>
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
  );
};
