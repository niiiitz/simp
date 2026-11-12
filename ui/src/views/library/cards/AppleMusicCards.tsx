import React from 'react';
import { AlbumRecord, PlaylistRecord, TrackMetadata } from '@simp/client';
import {
  AppleArtistSummary,
  AppleCloudAlbumSummary,
  AppleCloudPlaylistSummary,
  AppleRadioStationSummary,
  fetchFullAppleAlbum,
} from '../../../drivers/AppleMusicDriver';
import { BrowserTarget } from '../../PlayerView';
import { LibraryContextTarget } from '../../LibraryBrowserView';
import { ResilientTileArtwork } from '../ResilientTileArtwork';

export interface CloudPlaylistCardProps {
  pl: AppleCloudPlaylistSummary;
  playlists: PlaylistRecord[];
  browserTarget: BrowserTarget | null;
  selectCloudPlaylist: (pl: AppleCloudPlaylistSummary) => void;
  setCloudPlaylists: React.Dispatch<React.SetStateAction<AppleCloudPlaylistSummary[]>>;
  openLibraryContextMenu: (target: LibraryContextTarget) => void;
  handleAddAppleToCloudLibrary?: (
    idOrUri: string,
    kind?: 'songs' | 'albums' | 'playlists',
    label?: string
  ) => Promise<void>;
  handleAddCloudPlaylistToHybrid: (pl: AppleCloudPlaylistSummary) => void;
  handleDeletePlaylist: (playlistId: string, playlistName: string) => void;
  handlePinCloudPlaylist: (pl: AppleCloudPlaylistSummary) => void;
}

export const CloudPlaylistCard: React.FC<CloudPlaylistCardProps> = ({
  pl,
  playlists,
  browserTarget,
  selectCloudPlaylist,
  setCloudPlaylists,
  openLibraryContextMenu,
  handleAddAppleToCloudLibrary,
  handleAddCloudPlaylistToHybrid,
  handleDeletePlaylist,
  handlePinCloudPlaylist,
}) => {
  const isSelected = browserTarget?.kind === 'cloud_playlist' && browserTarget.id === pl.id;
  const isPinned = playlists.some((p) => p.id === `applemusic:playlist:${pl.id}`);
  return (
    <button
      data-right-tile="true"
      onContextMenu={(e) => {
        e.preventDefault();
        openLibraryContextMenu({
          type: 'collection',
          kind: 'cloud_playlist',
          id: pl.id,
          title: pl.name,
          subtitle: pl.description || 'Apple Music Playlist',
          art_url: pl.art_url,
          source: 'apple_music',
          rawItem: pl,
        });
      }}
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
        <ResilientTileArtwork
          src={pl.art_url}
          fallbackIcon="☁️"
          bg="#181118"
          border="1px solid #321a24"
          playlistCoverId={pl.id}
          playlistKind={pl.kind}
          onResolvedCover={(url) => {
            setCloudPlaylists((prev) =>
              prev.map((item) => (item.id === pl.id ? { ...item, art_url: url } : item))
            );
          }}
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
              background: '#251018',
              border: '1px solid #4c1d2e',
              color: '#fda4af',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            🍎
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {pl.kind !== 'library' && handleAddAppleToCloudLibrary && (
              <span
                role="button"
                data-tile-aux="true"
                title="Add Playlist to your Apple Music Cloud Library"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddAppleToCloudLibrary(pl.id, 'playlists', pl.name);
                }}
                style={{
                  padding: '2px 5px',
                  borderRadius: 6,
                  background: '#251018',
                  border: '1px solid #fa243c',
                  color: '#fecdd3',
                  fontSize: 9,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ☁️+
              </span>
            )}
            <span
              role="button"
              data-tile-aux="true"
              data-context-select="true"
              title="Playlist Options (SELECT)"
              onClick={(e) => {
                e.stopPropagation();
                openLibraryContextMenu({
                  type: 'collection',
                  kind: 'cloud_playlist',
                  id: pl.id,
                  title: pl.name,
                  subtitle: pl.description || 'Apple Music Playlist',
                  art_url: pl.art_url,
                  source: 'apple_music',
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
              data-tile-select="true"
              title="Add playlist tracks to active ★ SIMP Hybrid Playlist"
              onClick={(e) => {
                e.stopPropagation();
                handleAddCloudPlaylistToHybrid(pl);
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
            <span
              role="button"
              data-tile-aux="true"
              data-tile-y="true"
              title={isPinned ? 'Unpin Playlist from SIMP (Y)' : 'Pin Playlist to SIMP (Y)'}
              onClick={(e) => {
                e.stopPropagation();
                if (isPinned) {
                  handleDeletePlaylist(`applemusic:playlist:${pl.id}`, pl.name);
                } else {
                  handlePinCloudPlaylist(pl);
                }
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: isPinned ? '#0f222a' : '#251018',
                border: isPinned ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
                color: isPinned ? '#67e8f9' : '#fda4af',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isPinned ? '✓ 📌' : '📌'}
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

export interface CloudAlbumCardProps {
  alb: AppleCloudAlbumSummary;
  albums: AlbumRecord[];
  browserTarget: BrowserTarget | null;
  selectCloudAlbum: (params: { albumId?: string | null; songUri?: string | null; fallbackTitle?: string }) => void;
  openLibraryContextMenu: (target: LibraryContextTarget) => void;
  handleAddAppleToCloudLibrary?: (
    idOrUri: string,
    kind?: 'songs' | 'albums' | 'playlists',
    label?: string
  ) => Promise<void>;
  handleAddCloudAlbumToHybrid: (alb: AppleCloudAlbumSummary) => void;
  handleDeleteAlbum: (albumId: string, albumTitle: string) => void;
  setCloudLoading: React.Dispatch<React.SetStateAction<boolean>>;
  handlePinCloudAlbum: (album: AppleCloudAlbumSummary, tracks: TrackMetadata[]) => Promise<void>;
}

export const CloudAlbumCard: React.FC<CloudAlbumCardProps> = ({
  alb,
  albums,
  browserTarget,
  selectCloudAlbum,
  openLibraryContextMenu,
  handleAddAppleToCloudLibrary,
  handleAddCloudAlbumToHybrid,
  handleDeleteAlbum,
  setCloudLoading,
  handlePinCloudAlbum,
}) => {
  const isSelected = browserTarget?.kind === 'cloud_album' && browserTarget.id === alb.id;
  const isPinned = albums.some((a) => a.id === `applemusic:album:${alb.id}`);
  return (
    <button
      data-right-tile="true"
      onContextMenu={(e) => {
        e.preventDefault();
        openLibraryContextMenu({
          type: 'collection',
          kind: 'cloud_album',
          id: alb.id,
          title: alb.title,
          subtitle: `${alb.artist}${alb.release_year ? ` • ${alb.release_year}` : ''}`,
          art_url: alb.art_url,
          artistName: alb.artist,
          source: 'apple_music',
          rawItem: alb,
        });
      }}
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
        <ResilientTileArtwork
          src={alb.art_url}
          fallbackIcon="💿"
          bg="#181118"
          border="1px solid #321a24"
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
              background: '#251018',
              border: '1px solid #4c1d2e',
              color: '#fda4af',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            🍎
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {alb.kind !== 'library' && handleAddAppleToCloudLibrary && (
              <span
                role="button"
                data-tile-aux="true"
                title="Add Album to your Apple Music Cloud Library"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddAppleToCloudLibrary(alb.id, 'albums', alb.title);
                }}
                style={{
                  padding: '2px 5px',
                  borderRadius: 6,
                  background: '#251018',
                  border: '1px solid #fa243c',
                  color: '#fecdd3',
                  fontSize: 9,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ☁️+
              </span>
            )}
            <span
              role="button"
              data-tile-aux="true"
              data-context-select="true"
              title="Album Options (SELECT)"
              onClick={(e) => {
                e.stopPropagation();
                openLibraryContextMenu({
                  type: 'collection',
                  kind: 'cloud_album',
                  id: alb.id,
                  title: alb.title,
                  subtitle: `${alb.artist}${alb.release_year ? ` • ${alb.release_year}` : ''}`,
                  art_url: alb.art_url,
                  artistName: alb.artist,
                  source: 'apple_music',
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
                handleAddCloudAlbumToHybrid(alb);
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
            <span
              role="button"
              data-tile-aux="true"
              data-tile-y="true"
              title={isPinned ? 'Unpin Album from SIMP (Y)' : 'Pin Album to SIMP (Y)'}
              onClick={(e) => {
                e.stopPropagation();
                if (isPinned) {
                  handleDeleteAlbum(`applemusic:album:${alb.id}`, alb.title);
                } else {
                  setCloudLoading(true);
                  fetchFullAppleAlbum({ albumId: alb.id })
                    .then(({ album, tracks }) => handlePinCloudAlbum(album, tracks))
                    .catch(() => {})
                    .finally(() => setCloudLoading(false));
                }
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: isPinned ? '#0f222a' : '#251018',
                border: isPinned ? '1px solid #2aa3c4' : '1px solid #4c1d2e',
                color: isPinned ? '#67e8f9' : '#fda4af',
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isPinned ? '✓ 📌' : '📌'}
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
          {alb.title}
        </div>
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.35,
            color: alb.kind === 'library' ? '#fda4af' : '#8e8e99',
            marginTop: 4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
          }}
        >
          {alb.kind === 'library' ? `☁️ Your Library • ${alb.artist}` : alb.artist}
          {alb.release_year ? ` • ${alb.release_year}` : ''}
          {alb.track_count ? ` • ${alb.track_count} trk` : ''}
        </div>
      </div>
    </button>
  );
};

export interface StationCardProps {
  st: AppleRadioStationSummary;
  playingContextId: string;
  handleStartAppleStation: (st: AppleRadioStationSummary) => void;
}

export const StationCard: React.FC<StationCardProps> = ({
  st,
  playingContextId,
  handleStartAppleStation,
}) => {
  const isPlayingStation = playingContextId === `station:${st.id}`;
  return (
    <button
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

export interface AppleArtistCardProps {
  artist: AppleArtistSummary;
  isSelected: boolean;
  onSelect: () => void;
}

export const AppleArtistCard: React.FC<AppleArtistCardProps> = ({
  artist,
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
        <ResilientTileArtwork
          src={artist.art_url}
          fallbackIcon="🎤"
          bg="#221118"
          border="1px solid #4c1d2e"
        />
        <span
          style={{
            padding: '2px 6px',
            borderRadius: 6,
            background: '#251018',
            border: '1px solid #4c1d2e',
            color: '#fda4af',
            fontSize: 10,
            fontFamily: 'monospace',
            fontWeight: 800,
            whiteSpace: 'nowrap',
          }}
        >
          🍎 Artist
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
          {artist.name}
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
          {artist.genre || 'Apple Music Artist'}
        </div>
      </div>
    </button>
  );
};
