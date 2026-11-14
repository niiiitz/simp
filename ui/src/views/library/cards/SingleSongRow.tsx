import React from 'react';
import { defaultSimpClient, SimpStateSnapshot, TrackMetadata } from '@simp/client';
import { AppleMusicAttributionLink } from '../../../components/AppleMusicLogo';
import { LibraryContextTarget } from '../../LibraryBrowserView';
import { extractAudioFormat, getTrackLyricsBadge } from '../libraryHelpers';
import { ContentRatingBadge } from '../ContentRatingBadge';

export interface SingleSongRowProps {
  song: TrackMetadata;
  peerList: TrackMetadata[];
  ctxPrefix: string;
  track: TrackMetadata | null | undefined;
  snap: SimpStateSnapshot | null;
  favoritedUris: string[];
  scLikedTracks: TrackMetadata[];
  openLocalVideoFile: (
    videoTrack: TrackMetadata,
    peerTracks?: TrackMetadata[],
    ctxId?: string
  ) => void;
  showToast: (msg: string) => void;
  setPlayingContextId: (ctxId: string) => void;
  setView: (view: 'lock' | 'browser') => void;
  openLibraryContextMenu: (target: LibraryContextTarget) => void;
  openArtistProfile: (params: {
    source: 'apple_music' | 'soundcloud' | 'local';
    idOrName: string;
    displayName: string;
  }) => void;
  handleFavoriteTrack?: (track: TrackMetadata) => Promise<void>;
  handleAddTracksToPlaylist: (
    uris: string[],
    label: string,
    trackMetadata?: TrackMetadata[]
  ) => Promise<void>;
  handleStartSoundCloudTrackRadio: (seedTrack: TrackMetadata) => void;
  handleAddAppleToCloudLibrary?: (
    idOrUri: string,
    kind?: 'songs' | 'albums' | 'playlists',
    label?: string
  ) => Promise<void>;
  selectCloudAlbum: (params: {
    albumId?: string | null;
    songUri?: string | null;
    fallbackTitle?: string;
  }) => void;
}

export const SingleSongRow: React.FC<SingleSongRowProps> = ({
  song: s,
  peerList,
  ctxPrefix,
  track,
  snap,
  favoritedUris,
  scLikedTracks,
  openLocalVideoFile,
  showToast,
  setPlayingContextId,
  setView,
  openLibraryContextMenu,
  openArtistProfile,
  handleFavoriteTrack,
  handleAddTracksToPlaylist,
  handleStartSoundCloudTrackRadio,
  handleAddAppleToCloudLibrary,
  selectCloudAlbum,
}) => {
  const isLongMix = s.source === 'soundcloud' && s.duration_ms >= 20 * 60 * 1000;
  const isScPreview =
    s.source === 'soundcloud' &&
    Boolean(s.album?.includes('• Preview') || s.title.toLowerCase().includes('[preview]'));
  const isFavorited =
    favoritedUris.includes(s.uri) ||
    ctxPrefix === 'sc_likes' ||
    scLikedTracks.some((lt) => lt.uri === s.uri);
  const durMin = Math.floor(s.duration_ms / 60000);
  const durSec = Math.floor((s.duration_ms / 1000) % 60);
  const primaryArtist = s.artists?.[0]?.trim();
  return (
    <div
      data-single-song-row="true"
      onContextMenu={(e) => {
        e.preventDefault();
        openLibraryContextMenu({
          type: 'track',
          track: s,
          peerList,
          isViewingLocalPlaylist: false,
        });
      }}
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
        data-single-song-play="true"
        onClick={() => {
          if (s.source === 'local_video' || s.uri.startsWith('video://local/')) {
            openLocalVideoFile(s, peerList, `${ctxPrefix}:${s.uri}`);
            return;
          }
          if (isScPreview) {
            showToast('30s Preview — Sign in to SoundCloud in Accounts for full track playback');
          }
          const rowCtxKey = `${ctxPrefix}:${s.uri}`;
          const idx = Math.max(0, peerList.findIndex((tr) => tr.uri === s.uri));
          const queueAlreadyMatches =
            snap?.queue &&
            snap.queue.length === peerList.length &&
            snap.queue_index === idx &&
            snap.queue[idx]?.uri === s.uri;
          setPlayingContextId(rowCtxKey);
          if (track?.uri === s.uri && queueAlreadyMatches) {
            if (!snap?.is_playing) {
              defaultSimpClient.play();
            }
            setView('lock');
          } else {
            defaultSimpClient.loadQueue(
              peerList.map((tr) => tr.uri),
              idx,
              peerList
            );
            setView('lock');
          }
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
            {s.source === 'soundcloud' ? '☁️' : '🎵'}
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
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>▶ {s.title}</span>
            <ContentRatingBadge rating={s.content_rating} />
            {(() => {
              const lyrBadge = getTrackLyricsBadge(s.uri);
              if (!lyrBadge) return null;
              const isSynced = lyrBadge === 'LRC';
              return (
                <span
                  title={
                    isSynced
                      ? 'Synced timed lyrics available (Karaoke Ready)'
                      : 'Retrieved plain lyrics available'
                  }
                  style={{
                    fontSize: 9,
                    fontFamily: 'monospace',
                    fontWeight: 800,
                    padding: '1px 5px',
                    borderRadius: 4,
                    background: isSynced
                      ? 'rgba(16, 185, 129, 0.16)'
                      : 'rgba(56, 189, 248, 0.14)',
                    border: isSynced
                      ? '1px solid rgba(52, 211, 153, 0.5)'
                      : '1px solid rgba(56, 189, 248, 0.45)',
                    color: isSynced ? '#6ee7b7' : '#7dd3fc',
                    flexShrink: 0,
                  }}
                >
                  {lyrBadge}
                </span>
              );
            })()}
            {isScPreview && (
              <span
                style={{
                  fontSize: 9,
                  fontFamily: 'monospace',
                  fontWeight: 800,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: '#3c2208',
                  border: '1px solid #d97706',
                  color: '#fcd34d',
                  flexShrink: 0,
                }}
              >
                30s PREVIEW
              </span>
            )}
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
            {(() => {
              const fmt = extractAudioFormat(s.uri);
              return fmt ? ` • ${fmt}` : '';
            })()}
          </div>
        </div>
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
        {s.duration_ms > 0 && (
          <span
            style={{
              fontSize: 10,
              fontFamily: 'monospace',
              padding: '2px 6px',
              borderRadius: 6,
              background: isLongMix ? '#2c140a' : '#12121a',
              border: isLongMix ? '1px solid #ea580c' : '1px solid #222230',
              color: isLongMix ? '#fdba74' : '#8e8e99',
            }}
          >
            {isLongMix ? `🎧 ${durMin}m` : `${durMin}:${String(durSec).padStart(2, '0')}`}
          </span>
        )}
        {primaryArtist &&
          s.source !== 'local_video' &&
          s.source !== 'ia_video' &&
          s.source !== 'dvd' && (
            <button
              data-row-aux="true"
              onClick={() =>
                openArtistProfile({
                  source:
                    s.source === 'apple_music'
                      ? 'apple_music'
                      : s.source === 'soundcloud'
                      ? 'soundcloud'
                      : 'local',
                  idOrName: `name:${primaryArtist}`,
                  displayName: primaryArtist,
                })
              }
              title={`Open Artist Profile for ${primaryArtist}`}
              style={{
                padding: '5px 7px',
                borderRadius: 8,
                background: '#14141e',
                border: '1px solid #282838',
                color: '#c4b5fd',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              🎤
            </button>
          )}
        {handleFavoriteTrack &&
          s.source !== 'local_video' &&
          s.source !== 'ia_video' &&
          s.source !== 'dvd' && (
            <button
              data-row-aux="true"
              onClick={() => handleFavoriteTrack(s)}
              title={isFavorited ? 'Remove from Favorites' : 'Favorite this track'}
              style={{
                padding: '5px 8px',
                borderRadius: 8,
                background: isFavorited ? '#28111b' : '#14141e',
                border: isFavorited ? '1px solid #fa243c' : '1px solid #282838',
                color: isFavorited ? '#fda4af' : '#9ca3af',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {isFavorited ? '❤️' : '♡'}
            </button>
          )}
        <button
          data-row-aux="true"
          data-context-select="true"
          onClick={() =>
            openLibraryContextMenu({
              type: 'track',
              track: s,
              peerList,
              isViewingLocalPlaylist: false,
            })
          }
          title="Track Options (SELECT)"
          style={{
            padding: '5px 7px',
            borderRadius: 8,
            background: '#14141e',
            border: '1px solid #282838',
            color: '#c8c8d4',
            fontSize: 11,
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          •••
        </button>
        <button
          data-row-aux="true"
          data-track-select="true"
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
        {s.source === 'soundcloud' ? (
          <button
            data-row-aux="true"
            onClick={() => handleStartSoundCloudTrackRadio(s)}
            title="Start SoundCloud Track Radio from this track"
            style={{
              padding: '5px 8px',
              borderRadius: 8,
              background: '#2c140a',
              border: '1px solid #ea580c',
              color: '#fdba74',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            📻
          </button>
        ) : s.source === 'apple_music' ? (
          <>
            <AppleMusicAttributionLink
              kind="song"
              id={s.uri}
              size={13}
              style={{ padding: '4px 6px' }}
            />
            {handleAddAppleToCloudLibrary && (
              <button
                data-row-aux="true"
                onClick={() => handleAddAppleToCloudLibrary(s.uri, 'songs', s.title)}
                title="Add song to your Apple Music Cloud Library"
                style={{
                  padding: '5px 7px',
                  borderRadius: 8,
                  background: '#251018',
                  border: '1px solid #4c1d2e',
                  color: '#fecdd3',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ☁️+
              </button>
            )}
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
          </>
        ) : null}
      </div>
    </div>
  );
};
