import React from 'react';
import {
  AlbumRecord,
  ArchiveItemDetail,
  ArchiveItemSummary,
  PlaylistRecord,
  TrackMetadata,
} from '@simp/client';
import {
  AppleCloudAlbumSummary,
  AppleCloudPlaylistSummary,
} from '../../drivers/AppleMusicDriver';
import { SoundCloudPlaylistSummary } from '../../drivers/SoundCloudDriver';
import { BrowserTarget } from '../PlayerView';
import { ImpIcon } from '../../components/icons/ImpIcon';

export interface LibraryContextLegendBarProps {
  rightPaneMode: 'browse' | 'tracks' | 'artist';
  browserTarget: BrowserTarget | null;
  selectedPlaylistObj: PlaylistRecord | null | undefined;
  selectedAlbumObj: AlbumRecord | null | undefined;
  activeCloudPlaylist: AppleCloudPlaylistSummary | null;
  activeScPlaylist: SoundCloudPlaylistSummary | null;
  activeCloudAlbum: AppleCloudAlbumSummary | null;
  activeIaDetail: ArchiveItemDetail | null;
  playlists: PlaylistRecord[];
  albums: AlbumRecord[];
  browserTracks: TrackMetadata[];
  canWalkBackInBrowse: boolean;
  handleWalkBack: () => void;
  handleAddTracksToPlaylist: (
    uris: string[],
    label: string,
    trackMetadata?: TrackMetadata[]
  ) => Promise<void>;
  handleDeletePlaylist: (playlistId: string, playlistName: string) => Promise<void>;
  handlePinCloudPlaylist: (
    pl: AppleCloudPlaylistSummary,
    preloadedTracks?: TrackMetadata[]
  ) => Promise<void>;
  handlePinSoundCloudPlaylist: (
    pl: SoundCloudPlaylistSummary,
    preloadedTracks?: TrackMetadata[]
  ) => Promise<void>;
  handleDeleteAlbum: (albumId: string, albumTitle: string) => Promise<void>;
  handlePinCloudAlbum: (
    album: AppleCloudAlbumSummary,
    tracks: TrackMetadata[]
  ) => Promise<void>;
  handlePinArchiveItem: (
    item: ArchiveItemSummary,
    preloadedTracks?: TrackMetadata[]
  ) => Promise<void>;
  handleTogglePinLocalAlbum: (
    alb: AlbumRecord,
    preloadedTracks?: TrackMetadata[]
  ) => Promise<void>;
  setRightPaneMode: React.Dispatch<React.SetStateAction<'browse' | 'tracks' | 'artist'>>;
}

export const LibraryContextLegendBar: React.FC<LibraryContextLegendBarProps> = ({
  rightPaneMode,
  browserTarget,
  selectedPlaylistObj,
  selectedAlbumObj,
  activeCloudPlaylist,
  activeScPlaylist,
  activeCloudAlbum,
  activeIaDetail,
  playlists,
  albums,
  browserTracks,
  canWalkBackInBrowse,
  handleWalkBack,
  handleAddTracksToPlaylist,
  handleDeletePlaylist,
  handlePinCloudPlaylist,
  handlePinSoundCloudPlaylist,
  handleDeleteAlbum,
  handlePinCloudAlbum,
  handlePinArchiveItem,
  handleTogglePinLocalAlbum,
  setRightPaneMode,
}) => {
  const isViewingLocalPlaylist =
    rightPaneMode === 'tracks' &&
    browserTarget?.kind === 'playlist' &&
    selectedPlaylistObj?.origin === 'simp_local';

  const isCloudPlaylistPinned =
    rightPaneMode === 'tracks' &&
    browserTarget?.kind === 'cloud_playlist' &&
    activeCloudPlaylist &&
    playlists.some((p) => p.id === `applemusic:playlist:${activeCloudPlaylist.id}`);

  const isScPlaylistPinned =
    rightPaneMode === 'tracks' &&
    browserTarget?.kind === 'soundcloud_playlist' &&
    activeScPlaylist &&
    playlists.some((p) => p.id === `soundcloud:playlist:${activeScPlaylist.id}`);

  const isCloudAlbumPinned =
    rightPaneMode === 'tracks' &&
    browserTarget?.kind === 'cloud_album' &&
    activeCloudAlbum &&
    albums.some((a) => a.id === `applemusic:album:${activeCloudAlbum.id}`);

  const isArchiveItemPinned =
    rightPaneMode === 'tracks' &&
    browserTarget?.kind === 'ia_item' &&
    activeIaDetail &&
    playlists.some((p) => p.id === `archive:item:${activeIaDetail.summary.identifier}`);

  const isLocalAlbumPinned =
    rightPaneMode === 'tracks' &&
    browserTarget?.kind === 'album' &&
    selectedAlbumObj &&
    !selectedAlbumObj.id.startsWith('applemusic:album:') &&
    playlists.some((p) => p.id === `local:album:${selectedAlbumObj.id}`);

  const gpSelectBadge = (
    <span
      className="simp-gp-badge"
      style={{
        padding: '1px 5px',
        borderRadius: 4,
        background: '#141822',
        border: '1px solid #283044',
        color: '#67e8f9',
        fontFamily: 'monospace',
        fontSize: 10,
        fontWeight: 800,
        marginRight: 5,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
      }}
    >
      <ImpIcon name="gamepad-select" size={10} color="#67e8f9" />
      <span>SELECT</span>
    </span>
  );

  const gpYBadge = (
    <span
      className="simp-gp-badge"
      style={{
        padding: '1px 5px',
        borderRadius: 4,
        background: '#1e1610',
        border: '1px solid #4c3518',
        color: '#fcd34d',
        fontFamily: 'monospace',
        fontSize: 10,
        fontWeight: 800,
        marginRight: 5,
      }}
    >
      Y
    </span>
  );

  // In Grid view (`browse`), show `← Back` when there is navigation history (mouse or gamepad),
  // and show the muted controller legend when a gamepad is active
  if (rightPaneMode === 'browse') {
    return (
      <div
        className={canWalkBackInBrowse ? undefined : 'simp-gp-badge'}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          padding: '5px 10px',
          borderRadius: 8,
          background: '#0a0b10',
          border: '1px solid #161822',
          fontSize: 11,
          color: '#8e8e99',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {canWalkBackInBrowse && (
            <button
              data-right-walk-back="true"
              onClick={handleWalkBack}
              title="Walk back to previous Library view"
              style={{
                minHeight: 24,
                padding: '2px 9px',
                borderRadius: 6,
                background: '#14141e',
                border: '1px solid #2a2a38',
                color: '#bfeaf5',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ← Back
            </button>
          )}
          <span className="simp-gp-badge" style={{ display: 'inline-flex', alignItems: 'center' }}>
            {gpSelectBadge}
            <span>+ Add tile to SIMP Playlist</span>
          </span>
        </div>
        <span className="simp-gp-badge" style={{ display: 'inline-flex', alignItems: 'center' }}>
          {gpYBadge}
          <span>📌 Pin / Unpin focused tile</span>
        </span>
      </div>
    );
  }

  if (rightPaneMode === 'artist') {
    return null;
  }

  const canAddAllTracks =
    browserTarget &&
    (browserTarget.kind === 'album' ||
      browserTarget.kind === 'mount' ||
      browserTarget.kind === 'cloud_album' ||
      browserTarget.kind === 'cloud_playlist' ||
      browserTarget.kind === 'soundcloud_playlist' ||
      browserTarget.kind === 'soundcloud_user' ||
      browserTarget.kind === 'ia_item' ||
      (browserTarget.kind === 'playlist' && selectedPlaylistObj?.origin !== 'simp_local')) &&
    browserTracks.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 10,
        padding: '5px 10px',
        borderRadius: 8,
        background: '#0a0b10',
        border: '1px solid #161822',
        fontSize: 11,
        color: '#8e8e99',
      }}
    >
      {/* Left side: SELECT hint (only shown when controller is active) + Add All button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="simp-gp-badge" style={{ display: 'inline-flex', alignItems: 'center' }}>
          {gpSelectBadge}
          <span>
            {isViewingLocalPlaylist
              ? '− Remove focused track'
              : '+ Add focused track / collection'}
          </span>
        </span>

        {canAddAllTracks && (
          <button
            data-collection-select="true"
            onClick={() =>
              handleAddTracksToPlaylist(
                browserTracks.map((t) => t.uri),
                `all ${browserTracks.length} tracks`,
                browserTracks
              )
            }
            title={`Add all ${browserTracks.length} tracks to SIMP Hybrid Playlist`}
            style={{
              padding: '3px 9px',
              borderRadius: 6,
              background: '#121820',
              border: '1px solid #283848',
              color: '#bfeaf5',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            + Add All ({browserTracks.length})
          </button>
        )}

        {browserTarget?.kind === 'playlist' &&
          selectedPlaylistObj &&
          selectedPlaylistObj.origin !== 'simp_local' && (
            <button
              data-collection-fork="true"
              onClick={async () => {
                try {
                  await fetch('http://127.0.0.1:18888/api/library/playlists/convert-to-hybrid', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playlist_id: selectedPlaylistObj.id }),
                  });
                } catch {}
              }}
              title="Convert this pinned collection into an editable Hybrid SIMP Playlist"
              style={{
                padding: '3px 9px',
                borderRadius: 6,
                background: 'rgba(52, 211, 153, 0.14)',
                border: '1px solid rgba(52, 211, 153, 0.45)',
                color: '#6ee7b7',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <ImpIcon name="fork" size={12} color="#34d399" />
              Fork / Convert to Hybrid
            </button>
          )}
      </div>

      {/* Right side: Single Pin / Unpin / Delete control (exposes [Y] badge when controller is active) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          marginLeft: 'auto',
        }}
      >
        {browserTarget && (
          <>
            {browserTarget.kind === 'cloud_playlist' && activeCloudPlaylist && (
              <button
                data-collection-y="true"
                onClick={() => {
                  if (isCloudPlaylistPinned) {
                    handleDeletePlaylist(
                      `applemusic:playlist:${activeCloudPlaylist.id}`,
                      activeCloudPlaylist.name
                    );
                  } else {
                    handlePinCloudPlaylist(activeCloudPlaylist, browserTracks);
                  }
                }}
                title="Pin or Unpin this playlist in SIMP"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '3px 9px',
                  borderRadius: 6,
                  background: isCloudPlaylistPinned ? '#0f222a' : '#241119',
                  border: isCloudPlaylistPinned ? '1px solid #2aa3c4' : '1px solid #5c1f33',
                  color: isCloudPlaylistPinned ? '#67e8f9' : '#fecdd3',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {gpYBadge}
                <span>{isCloudPlaylistPinned ? '✓ Pinned (Unpin)' : '📌 Pin to SIMP'}</span>
              </button>
            )}

            {browserTarget.kind === 'soundcloud_playlist' && activeScPlaylist && (
              <button
                data-collection-y="true"
                onClick={() => {
                  if (isScPlaylistPinned) {
                    handleDeletePlaylist(
                      `soundcloud:playlist:${activeScPlaylist.id}`,
                      activeScPlaylist.name
                    );
                  } else {
                    handlePinSoundCloudPlaylist(activeScPlaylist, browserTracks);
                  }
                }}
                title="Pin or Unpin this SoundCloud set in SIMP"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '3px 9px',
                  borderRadius: 6,
                  background: isScPlaylistPinned ? '#0f222a' : '#2c140a',
                  border: isScPlaylistPinned ? '1px solid #2aa3c4' : '1px solid #ea580c',
                  color: isScPlaylistPinned ? '#67e8f9' : '#fdba74',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {gpYBadge}
                <span>{isScPlaylistPinned ? '✓ Pinned (Unpin)' : '📌 Pin Set to SIMP'}</span>
              </button>
            )}

            {browserTarget.kind === 'cloud_album' && activeCloudAlbum && (
              <button
                data-collection-y="true"
                onClick={() => {
                  if (isCloudAlbumPinned) {
                    handleDeleteAlbum(
                      `applemusic:album:${activeCloudAlbum.id}`,
                      activeCloudAlbum.title
                    );
                  } else {
                    handlePinCloudAlbum(activeCloudAlbum, browserTracks);
                  }
                }}
                title="Pin or Unpin this album in SIMP"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '3px 9px',
                  borderRadius: 6,
                  background: isCloudAlbumPinned ? '#0f222a' : '#241119',
                  border: isCloudAlbumPinned ? '1px solid #2aa3c4' : '1px solid #5c1f33',
                  color: isCloudAlbumPinned ? '#67e8f9' : '#fecdd3',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {gpYBadge}
                <span>{isCloudAlbumPinned ? '✓ Pinned (Unpin)' : '📌 Pin Album to SIMP'}</span>
              </button>
            )}

            {browserTarget.kind === 'ia_item' && activeIaDetail && browserTracks.length > 0 && (
              <button
                data-collection-y="true"
                onClick={() => {
                  if (isArchiveItemPinned) {
                    handleDeletePlaylist(
                      `archive:item:${activeIaDetail.summary.identifier}`,
                      activeIaDetail.summary.title
                    );
                  } else {
                    handlePinArchiveItem(activeIaDetail.summary, browserTracks);
                  }
                }}
                title="Pin or Unpin this Internet Archive audio collection in SIMP"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '3px 9px',
                  borderRadius: 6,
                  background: isArchiveItemPinned ? '#0f222a' : '#261a0b',
                  border: isArchiveItemPinned ? '1px solid #2aa3c4' : '1px solid #d97706',
                  color: isArchiveItemPinned ? '#67e8f9' : '#fde68a',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {gpYBadge}
                <span>{isArchiveItemPinned ? '✓ Pinned (Unpin)' : '📌 Pin to SIMP'}</span>
              </button>
            )}

            {browserTarget.kind === 'playlist' && selectedPlaylistObj && (
              <button
                data-collection-y="true"
                onClick={() => {
                  handleDeletePlaylist(selectedPlaylistObj.id, selectedPlaylistObj.name);
                  setRightPaneMode('browse');
                }}
                title={
                  selectedPlaylistObj.origin === 'simp_local'
                    ? 'Delete this SIMP Playlist'
                    : 'Unpin this playlist from SIMP'
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '3px 9px',
                  borderRadius: 6,
                  background: '#1e1115',
                  border: '1px solid #4c2228',
                  color: '#fca5a5',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {gpYBadge}
                <span>
                  {selectedPlaylistObj.origin === 'simp_local'
                    ? '🗑 Delete Playlist'
                    : '✕ Unpin Playlist'}
                </span>
              </button>
            )}

            {browserTarget.kind === 'album' &&
              selectedAlbumObj &&
              selectedAlbumObj.id.startsWith('applemusic:album:') && (
                <button
                  data-collection-y="true"
                  onClick={() => {
                    handleDeleteAlbum(selectedAlbumObj.id, selectedAlbumObj.title);
                    setRightPaneMode('browse');
                  }}
                  title="Unpin this album from SIMP"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '3px 9px',
                    borderRadius: 6,
                    background: '#1e1115',
                    border: '1px solid #4c2228',
                    color: '#fca5a5',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {gpYBadge}
                  <span>✕ Unpin Album</span>
                </button>
              )}

            {browserTarget.kind === 'album' &&
              selectedAlbumObj &&
              !selectedAlbumObj.id.startsWith('applemusic:album:') && (
                <button
                  data-collection-y="true"
                  onClick={() => {
                    handleTogglePinLocalAlbum(selectedAlbumObj, browserTracks);
                  }}
                  title="Pin or Unpin this local album in SIMP Library"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '3px 9px',
                    borderRadius: 6,
                    background: isLocalAlbumPinned ? '#0f222a' : '#121820',
                    border: isLocalAlbumPinned ? '1px solid #2aa3c4' : '1px solid #283848',
                    color: isLocalAlbumPinned ? '#67e8f9' : '#bfeaf5',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {gpYBadge}
                  <span>{isLocalAlbumPinned ? '✓ Pinned (Unpin)' : '📌 Pin Album to SIMP'}</span>
                </button>
              )}
          </>
        )}
      </div>
    </div>
  );
};
