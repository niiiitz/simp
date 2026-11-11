import React from 'react';
import { ArchiveItemSummary, PlaylistRecord } from '@simp/client';
import {
  SoundCloudPlaylistSummary,
  SoundCloudUserSummary,
} from '../../../drivers/SoundCloudDriver';
import { BrowserTarget } from '../../PlayerView';
import { LibraryContextTarget } from '../../LibraryBrowserView';
import { iaItemCountCache } from '../libraryHelpers';
import { ResilientTileArtwork } from '../ResilientTileArtwork';

export interface SoundCloudPlaylistCardProps {
  pl: SoundCloudPlaylistSummary;
  playlists: PlaylistRecord[];
  browserTarget: BrowserTarget | null;
  selectSoundCloudPlaylist: (pl: SoundCloudPlaylistSummary) => void;
  openLibraryContextMenu: (target: LibraryContextTarget) => void;
  handleAddSoundCloudPlaylistToHybrid: (pl: SoundCloudPlaylistSummary) => void;
  handleDeletePlaylist: (playlistId: string, playlistName: string) => void;
  handlePinSoundCloudPlaylist: (pl: SoundCloudPlaylistSummary) => void;
}

export const SoundCloudPlaylistCard: React.FC<SoundCloudPlaylistCardProps> = ({
  pl,
  playlists,
  browserTarget,
  selectSoundCloudPlaylist,
  openLibraryContextMenu,
  handleAddSoundCloudPlaylistToHybrid,
  handleDeletePlaylist,
  handlePinSoundCloudPlaylist,
}) => {
  const isSelected = browserTarget?.kind === 'soundcloud_playlist' && browserTarget.id === pl.id;
  const isPinned = playlists.some((p) => p.id === `soundcloud:playlist:${pl.id}`);
  return (
    <button
      data-right-tile="true"
      onContextMenu={(e) => {
        e.preventDefault();
        openLibraryContextMenu({
          type: 'collection',
          kind: 'sc_playlist',
          id: pl.id,
          title: pl.name,
          subtitle: `${pl.track_count ? `${pl.track_count} tracks • ` : ''}${pl.description || 'SoundCloud Set'}`,
          art_url: pl.art_url,
          source: 'soundcloud',
          rawItem: pl,
        });
      }}
      onClick={() => selectSoundCloudPlaylist(pl)}
      style={{
        minWidth: 0,
        minHeight: 124,
        padding: 10,
        borderRadius: 12,
        background: isSelected ? '#2c140a' : '#0a0a0e',
        border: isSelected ? '1px solid #ea580c' : '1px solid #181822',
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
          bg="#23120b"
          border="1px solid #7c2d12"
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
              background: '#2c140a',
              border: '1px solid #7c2d12',
              color: '#fdba74',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            ☁️
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              role="button"
              data-tile-aux="true"
              data-context-select="true"
              title="Set Options (SELECT)"
              onClick={(e) => {
                e.stopPropagation();
                openLibraryContextMenu({
                  type: 'collection',
                  kind: 'sc_playlist',
                  id: pl.id,
                  title: pl.name,
                  subtitle: `${pl.track_count ? `${pl.track_count} tracks • ` : ''}${pl.description || 'SoundCloud Set'}`,
                  art_url: pl.art_url,
                  source: 'soundcloud',
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
              title="Add set tracks to active ★ SIMP Hybrid Playlist"
              onClick={(e) => {
                e.stopPropagation();
                handleAddSoundCloudPlaylistToHybrid(pl);
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
              title={isPinned ? 'Unpin Set from SIMP (Y)' : 'Pin Set to SIMP (Y)'}
              onClick={(e) => {
                e.stopPropagation();
                if (isPinned) {
                  handleDeletePlaylist(`soundcloud:playlist:${pl.id}`, pl.name);
                } else {
                  handlePinSoundCloudPlaylist(pl);
                }
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: isPinned ? '#0f222a' : '#2c140a',
                border: isPinned ? '1px solid #2aa3c4' : '1px solid #7c2d12',
                color: isPinned ? '#67e8f9' : '#fdba74',
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
          {pl.track_count ? `${pl.track_count} tracks • ` : ''}
          {pl.description || 'SoundCloud Set'}
        </div>
      </div>
    </button>
  );
};

export interface SoundCloudUserCardProps {
  user: SoundCloudUserSummary;
  browserTarget: BrowserTarget | null;
  selectSoundCloudUser: (user: SoundCloudUserSummary) => void;
}

export const SoundCloudUserCard: React.FC<SoundCloudUserCardProps> = ({
  user,
  browserTarget,
  selectSoundCloudUser,
}) => {
  const isSelected = browserTarget?.kind === 'soundcloud_user' && browserTarget.id === user.id;
  return (
    <button
      data-right-tile="true"
      onClick={() => selectSoundCloudUser(user)}
      style={{
        minWidth: 0,
        minHeight: 124,
        padding: 10,
        borderRadius: 12,
        background: isSelected ? '#2c140a' : '#0a0a0e',
        border: isSelected ? '1px solid #ea580c' : '1px solid #181822',
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
          src={user.avatar_url}
          fallbackIcon="👤"
          bg="#23120b"
          border="1px solid #7c2d12"
        />
        <span
          style={{
            padding: '2px 6px',
            borderRadius: 6,
            background: '#2c140a',
            border: '1px solid #7c2d12',
            color: '#fdba74',
            fontSize: 10,
            fontFamily: 'monospace',
            fontWeight: 800,
            whiteSpace: 'nowrap',
          }}
        >
          👥 {user.track_count} Trk
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
          @{user.username}
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
          {user.description || `${user.track_count} tracks`}
        </div>
      </div>
    </button>
  );
};

export interface ArchiveItemCardProps {
  item: ArchiveItemSummary;
  playlists: PlaylistRecord[];
  browserTarget: BrowserTarget | null;
  iaResolvedCounts: Record<string, number>;
  openIaItem: (item: ArchiveItemSummary, autoPlayFirst?: boolean) => void;
  openLibraryContextMenu: (target: LibraryContextTarget) => void;
  handleAddArchiveItemToHybrid: (item: ArchiveItemSummary) => void;
  handleDeletePlaylist: (playlistId: string, playlistName: string) => void;
  handlePinArchiveItem: (item: ArchiveItemSummary) => void;
}

export const ArchiveItemCard: React.FC<ArchiveItemCardProps> = ({
  item,
  playlists,
  browserTarget,
  iaResolvedCounts,
  openIaItem,
  openLibraryContextMenu,
  handleAddArchiveItemToHybrid,
  handleDeletePlaylist,
  handlePinArchiveItem,
}) => {
  const isVideo = item.mediatype === 'movies';
  const isSelected = browserTarget?.kind === 'ia_item' && browserTarget.id === item.identifier;
  const isPinned = playlists.some((p) => p.id === `archive:item:${item.identifier}`);
  const count =
    item.item_count ??
    iaResolvedCounts[item.identifier] ??
    iaItemCountCache.get(item.identifier);
  const badgeLabel =
    count !== undefined && count > 0
      ? isVideo
        ? count === 1
          ? '🎬 1 Film'
          : `🎬 ${count} Ep`
        : count === 1
        ? '🎵 1 Audio'
        : `🎵 ${count} Trk`
      : isVideo
      ? '🎬 VIDEO'
      : '🎵 AUDIO';
  return (
    <button
      data-right-tile="true"
      onContextMenu={(e) => {
        e.preventDefault();
        openLibraryContextMenu({
          type: 'collection',
          kind: 'ia_item',
          id: item.identifier,
          title: item.title,
          subtitle: `${item.creator}${item.year ? ` • ${item.year}` : ''}`,
          art_url: item.art_url,
          artistName: item.creator,
          source: 'internet_archive',
          rawItem: item,
        });
      }}
      onClick={() => openIaItem(item, false)}
      style={{
        minWidth: 0,
        minHeight: 124,
        padding: 10,
        borderRadius: 12,
        background: isSelected ? '#261a0b' : '#0a0a0e',
        border: isSelected ? '1px solid #f59e0b' : '1px solid #181822',
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
          src={item.art_url}
          fallbackIcon={isVideo ? '🎬' : '🏛️'}
          bg="#1f160b"
          border="1px solid #78350f"
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
              background: '#261a0b',
              border: '1px solid #78350f',
              color: '#fde68a',
              fontSize: 10,
              fontFamily: 'monospace',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            {badgeLabel}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              role="button"
              data-tile-aux="true"
              data-context-select="true"
              title="Item Options (SELECT)"
              onClick={(e) => {
                e.stopPropagation();
                openLibraryContextMenu({
                  type: 'collection',
                  kind: 'ia_item',
                  id: item.identifier,
                  title: item.title,
                  subtitle: `${item.creator}${item.year ? ` • ${item.year}` : ''}`,
                  art_url: item.art_url,
                  artistName: item.creator,
                  source: 'internet_archive',
                  rawItem: item,
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
              title="Add to active ★ SIMP Hybrid Playlist"
              onClick={(e) => {
                e.stopPropagation();
                handleAddArchiveItemToHybrid(item);
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
              title={isPinned ? 'Unpin from SIMP (Y)' : 'Pin to SIMP (Y)'}
              onClick={(e) => {
                e.stopPropagation();
                if (isPinned) {
                  handleDeletePlaylist(`archive:item:${item.identifier}`, item.title);
                } else {
                  handlePinArchiveItem(item);
                }
              }}
              style={{
                padding: '2px 6px',
                borderRadius: 6,
                background: isPinned ? '#0f222a' : '#261a0b',
                border: isPinned ? '1px solid #2aa3c4' : '1px solid #78350f',
                color: isPinned ? '#67e8f9' : '#fde68a',
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
          {item.title}
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
          {item.creator}
          {item.year ? ` • ${item.year}` : ''}
        </div>
      </div>
    </button>
  );
};
