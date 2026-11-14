import React from 'react';
import { AlbumRecord, PlaylistRecord } from '@simp/client';
import { BrowserTarget } from '../../PlayerView';
import { LibraryContextTarget } from '../../LibraryBrowserView';
import { cleanCollectionTitle, formatPlaylistSourceBadge } from '../libraryHelpers';
import { ContentRatingBadge } from '../ContentRatingBadge';
import { ResilientTileArtwork } from '../ResilientTileArtwork';

export interface SimpPlaylistCardProps {
  pl: PlaylistRecord;
  activePlaylistId: string;
  rightPaneMode: 'browse' | 'tracks' | 'artist';
  browserTarget: BrowserTarget | null;
  setActivePlaylistId: (id: string) => void;
  selectLocalCollection: (target: BrowserTarget) => void;
  openLibraryContextMenu: (target: LibraryContextTarget) => void;
  handleAddSimpPlaylistToHybrid: (pl: PlaylistRecord) => void;
  handleDeletePlaylist: (playlistId: string, playlistName: string) => void;
}

export const SimpPlaylistCard: React.FC<SimpPlaylistCardProps> = ({
  pl,
  activePlaylistId,
  rightPaneMode,
  browserTarget,
  setActivePlaylistId,
  selectLocalCollection,
  openLibraryContextMenu,
  handleAddSimpPlaylistToHybrid,
  handleDeletePlaylist,
}) => {
  const isLocal = pl.origin === 'simp_local';
  const isActiveTarget = isLocal && activePlaylistId === pl.id;
  const isSelected =
    rightPaneMode === 'tracks' && browserTarget?.kind === 'playlist' && browserTarget.id === pl.id;
  const cleanTitle = cleanCollectionTitle(pl.name);
  const sourceBadge = formatPlaylistSourceBadge(pl);
  return (
    <button
      data-right-tile="true"
      onContextMenu={(e) => {
        e.preventDefault();
        openLibraryContextMenu({
          type: 'collection',
          kind: 'simp_playlist',
          id: pl.id,
          title: cleanTitle,
          subtitle: `${pl.track_count} tracks`,
          art_url: pl.cover_art_url,
          source:
            pl.origin === 'apple_remote'
              ? 'apple_music'
              : pl.origin === 'soundcloud_remote'
              ? 'soundcloud'
              : pl.origin === 'archive_remote'
              ? 'internet_archive'
              : 'local',
          rawItem: pl,
        });
      }}
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
        <ResilientTileArtwork
          src={pl.cover_art_url}
          fallbackIcon={isLocal ? '🎵' : '🍎'}
          bg={isLocal ? '#0f222a' : '#251018'}
          border={isLocal ? '1px solid #2aa3c4' : '1px solid #4c1d2e'}
          playlistCoverId={
            pl.id.startsWith('applemusic:playlist:')
              ? pl.id.replace('applemusic:playlist:', '')
              : undefined
          }
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 4,
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          <span
            style={{
              padding: '2px 6px',
              borderRadius: 6,
              background: isLocal ? '#0f222a' : '#251018',
              border: isLocal ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
              color: isLocal ? '#67e8f9' : '#fda4af',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            {isActiveTarget ? `★ ${sourceBadge}` : sourceBadge}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {!isLocal ? (
              <span
                role="button"
                data-tile-aux="true"
                data-tile-select="true"
                title="Add all tracks to active ★ SIMP Hybrid Playlist (SELECT)"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddSimpPlaylistToHybrid(pl);
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: 6,
                  background: '#0f222a',
                  border: '1px solid #2aa3c4',
                  color: '#67e8f9',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                +
              </span>
            ) : (
              <span
                role="button"
                data-tile-aux="true"
                data-tile-select="true"
                title="Set as active ★ target playlist (SELECT)"
                onClick={(e) => {
                  e.stopPropagation();
                  setActivePlaylistId(pl.id);
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: 6,
                  background: isActiveTarget ? '#13303d' : '#12141c',
                  border: isActiveTarget ? '1px solid #2aa3c4' : '1px solid #262a38',
                  color: isActiveTarget ? '#67e8f9' : '#71717a',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ★
              </span>
            )}
            <span
              role="button"
              data-tile-aux="true"
              data-context-select="true"
              title="Collection Options (SELECT)"
              onClick={(e) => {
                e.stopPropagation();
                openLibraryContextMenu({
                  type: 'collection',
                  kind: 'simp_playlist',
                  id: pl.id,
                  title: cleanTitle,
                  subtitle: `${pl.track_count} tracks`,
                  art_url: pl.cover_art_url,
                  source:
                    pl.origin === 'apple_remote'
                      ? 'apple_music'
                      : pl.origin === 'soundcloud_remote'
                      ? 'soundcloud'
                      : pl.origin === 'archive_remote'
                      ? 'internet_archive'
                      : 'local',
                  rawItem: pl,
                });
              }}
              style={{
                padding: '2px 5px',
                borderRadius: 6,
                background: '#14141e',
                border: '1px solid #282838',
                color: '#c8c8d4',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              •••
            </span>
            <span
              role="button"
              data-tile-aux="true"
              data-tile-y="true"
              title={isLocal ? 'Delete SIMP Playlist (Y)' : 'Unpin Playlist from SIMP (Y)'}
              onClick={(e) => {
                e.stopPropagation();
                handleDeletePlaylist(pl.id, cleanTitle);
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#1c1115',
                border: '1px solid #4c2228',
                color: '#fca5a5',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isLocal ? '🗑' : '✕'}
            </span>
          </div>
        </div>
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

export interface SimpAlbumCardProps {
  alb: AlbumRecord;
  playlists: PlaylistRecord[];
  rightPaneMode: 'browse' | 'tracks' | 'artist';
  browserTarget: BrowserTarget | null;
  selectLocalCollection: (target: BrowserTarget) => void;
  openLibraryContextMenu: (target: LibraryContextTarget) => void;
  handleAddSimpAlbumToHybrid: (alb: AlbumRecord) => void;
  handleDeleteAlbum: (albumId: string, albumTitle: string) => void;
  handleTogglePinLocalAlbum: (alb: AlbumRecord) => void;
}

export const SimpAlbumCard: React.FC<SimpAlbumCardProps> = ({
  alb,
  playlists,
  rightPaneMode,
  browserTarget,
  selectLocalCollection,
  openLibraryContextMenu,
  handleAddSimpAlbumToHybrid,
  handleDeleteAlbum,
  handleTogglePinLocalAlbum,
}) => {
  const isAppleAlbum = alb.id.startsWith('applemusic:album:');
  const isLocalPinned =
    !isAppleAlbum && playlists.some((p) => p.id === `local:album:${alb.id}`);
  const isSelected =
    rightPaneMode === 'tracks' && browserTarget?.kind === 'album' && browserTarget.id === alb.id;
  const cleanTitle = cleanCollectionTitle(alb.title);
  return (
    <button
      data-right-tile="true"
      onContextMenu={(e) => {
        e.preventDefault();
        openLibraryContextMenu({
          type: 'collection',
          kind: 'simp_album',
          id: alb.id,
          title: cleanTitle,
          subtitle: `${alb.album_artist} • ${alb.track_count} tracks`,
          art_url: alb.art_url,
          artistName: alb.album_artist
            .replace(/\s*•\s*(FLAC(?:\s*\+\s*MP3)?|MP3|WAV|OGG|OPUS|M4A|AAC|ALAC|AIFF)$/i, '')
            .trim(),
          source: isAppleAlbum ? 'apple_music' : 'local',
          rawItem: alb,
        });
      }}
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
        <ResilientTileArtwork
          src={alb.art_url}
          fallbackIcon="💿"
          bg="#121820"
          border="1px solid #222e3c"
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 4,
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          <span
            style={{
              padding: '2px 6px',
              borderRadius: 6,
              background: isAppleAlbum ? '#251018' : '#0f222a',
              border: isAppleAlbum ? '1px solid #4c1d2e' : '1px solid #2aa3c4',
              color: isAppleAlbum ? '#fda4af' : '#67e8f9',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            {isAppleAlbum
              ? '🍎'
              : (() => {
                  const fmtMatch = alb.album_artist.match(
                    /•\s*(FLAC(?:\s*\+\s*MP3)?|MP3|WAV|OGG|OPUS|M4A|AAC|ALAC|AIFF)$/i
                  );
                  return fmtMatch ? `💾 ${fmtMatch[1].toUpperCase()}` : '💾';
                })()}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              role="button"
              data-tile-aux="true"
              data-context-select="true"
              title="Album Options (SELECT)"
              onClick={(e) => {
                e.stopPropagation();
                openLibraryContextMenu({
                  type: 'collection',
                  kind: 'simp_album',
                  id: alb.id,
                  title: cleanTitle,
                  subtitle: `${alb.album_artist} • ${alb.track_count} tracks`,
                  art_url: alb.art_url,
                  artistName: alb.album_artist
                    .replace(
                      /\s*•\s*(FLAC(?:\s*\+\s*MP3)?|MP3|WAV|OGG|OPUS|M4A|AAC|ALAC|AIFF)$/i,
                      ''
                    )
                    .trim(),
                  source: isAppleAlbum ? 'apple_music' : 'local',
                  rawItem: alb,
                });
              }}
              style={{
                padding: '2px 5px',
                borderRadius: 6,
                background: '#14141e',
                border: '1px solid #282838',
                color: '#c8c8d4',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              •••
            </span>
            <span
              role="button"
              data-tile-aux="true"
              data-tile-select="true"
              title="Add album tracks to active ★ SIMP Hybrid Playlist"
              onClick={(e) => {
                e.stopPropagation();
                handleAddSimpAlbumToHybrid(alb);
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: '#0f222a',
                border: '1px solid #2aa3c4',
                color: '#67e8f9',
                fontSize: 10,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              +
            </span>
            {isAppleAlbum ? (
              <span
                role="button"
                data-tile-aux="true"
                data-tile-y="true"
                title="Unpin Album from SIMP (Y)"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteAlbum(alb.id, cleanTitle);
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: 6,
                  background: '#1c1115',
                  border: '1px solid #4c2228',
                  color: '#fca5a5',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ✕
              </span>
            ) : (
              <span
                role="button"
                data-tile-aux="true"
                data-tile-y="true"
                title={
                  isLocalPinned
                    ? 'Unpin Local Album from SIMP Library (Y)'
                    : 'Pin Local Album to SIMP Library (Y)'
                }
                onClick={(e) => {
                  e.stopPropagation();
                  handleTogglePinLocalAlbum(alb);
                }}
                style={{
                  padding: '2px 6px',
                  borderRadius: 6,
                  background: isLocalPinned ? '#0f222a' : '#121820',
                  border: isLocalPinned ? '1px solid #2aa3c4' : '1px solid #283848',
                  color: isLocalPinned ? '#67e8f9' : '#bfeaf5',
                  fontSize: 10,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {isLocalPinned ? '✓' : '📌'}
              </span>
            )}
          </div>
        </div>
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
          <ContentRatingBadge rating={alb.content_rating} style={{ marginRight: 5 }} />
          {alb.album_artist} • {alb.track_count} tracks
        </div>
      </div>
    </button>
  );
};

export interface LocalArtistCardProps {
  artistName: string;
  artUrl?: string | null;
  subtitle?: string;
  isSelected: boolean;
  onSelect: () => void;
}

export const LocalArtistCard: React.FC<LocalArtistCardProps> = ({
  artistName,
  artUrl,
  subtitle,
  isSelected,
  onSelect,
}) => {
  return (
    <button
      data-right-tile="true"
      onClick={onSelect}
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
        <ResilientTileArtwork
          src={artUrl}
          fallbackIcon="🎤"
          bg="#0f222a"
          border="1px solid #2aa3c4"
        />
        <span
          style={{
            padding: '2px 6px',
            borderRadius: 6,
            background: '#0f222a',
            border: '1px solid #2aa3c4',
            color: '#67e8f9',
            fontSize: 10,
            fontFamily: 'monospace',
            fontWeight: 800,
            whiteSpace: 'nowrap',
          }}
        >
          💾 Artist
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
          {artistName}
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
          {subtitle || 'Local Library Artist'}
        </div>
      </div>
    </button>
  );
};
