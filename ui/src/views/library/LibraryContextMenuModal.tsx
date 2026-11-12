import React from 'react';
import {
  AlbumRecord,
  ArchiveItemSummary,
  defaultSimpClient,
  PlaylistRecord,
  TrackMetadata,
} from '@simp/client';
import { AppleCloudAlbumSummary, AppleCloudPlaylistSummary } from '../../drivers/appleApi';
import { SoundCloudPlaylistSummary } from '../../drivers/SoundCloudDriver';
import { BrowserTarget } from '../PlayerView';
import type { LibraryContextTarget } from '../LibraryBrowserView';
import { ImpIcon } from '../../components/icons/ImpIcon';

export interface LibraryContextMenuModalProps {
  target: LibraryContextTarget;
  onClose: () => void;
  favoritedUris: string[];
  writablePlaylists: PlaylistRecord[];
  activePlaylistId: string | null;
  cleanCollectionTitle: (raw: string) => string;
  cycleTargetHybridPlaylist: () => void;
  handlePlayTracksNext: (tracksToInsert: TrackMetadata[], label: string) => void;
  handleAddTracksToPlaylist: (
    uris: string[],
    label: string,
    tracks?: TrackMetadata[]
  ) => Promise<void> | void;
  handleFavoriteTrack?: (t: TrackMetadata) => void;
  handleAddAppleToCloudLibrary?: (
    idOrUri: string,
    kind: 'songs' | 'albums' | 'playlists',
    title: string
  ) => void;
  albums: AlbumRecord[];
  selectCloudAlbum: (params: {
    albumId?: string | null;
    songUri?: string | null;
    fallbackTitle?: string;
  }) => Promise<void>;
  selectLocalCollection: (target: BrowserTarget) => void;
  openArtistProfile: (params: {
    source: 'apple_music' | 'soundcloud' | 'local';
    idOrName: string;
    displayName: string;
  }) => Promise<void>;
  handleStartSoundCloudTrackRadio: (t: TrackMetadata) => void;
  browserTarget: BrowserTarget | null;
  handleRemoveTrackFromPlaylist: (playlistId: string, uri: string, title: string) => void;
  setPlayingContextId: React.Dispatch<React.SetStateAction<string>>;
  setView: React.Dispatch<React.SetStateAction<'lock' | 'browser'>>;
  resolveCollectionTracks: (
    target: Extract<LibraryContextTarget, { type: 'collection' }>
  ) => Promise<TrackMetadata[]>;
  showToast: (msg: string) => void;
  handleAddSimpPlaylistToHybrid: (pl: PlaylistRecord) => Promise<void>;
  handleAddSimpAlbumToHybrid: (alb: AlbumRecord) => Promise<void>;
  handleAddArchiveItemToHybrid: (item: ArchiveItemSummary) => Promise<void>;
  handlePinCloudPlaylist: (pl: AppleCloudPlaylistSummary) => void;
  handlePinCloudAlbum: (alb: AppleCloudAlbumSummary, tracks: TrackMetadata[]) => void;
  handlePinSoundCloudPlaylist: (pl: SoundCloudPlaylistSummary) => void;
  handlePinArchiveItem: (item: ArchiveItemSummary, preloadedTracks?: TrackMetadata[]) => Promise<void>;
  handleDeletePlaylist: (playlistId: string, name: string) => void;
  handleDeleteAlbum: (albumId: string, title: string) => void;
}

export const LibraryContextMenuModal: React.FC<LibraryContextMenuModalProps> = ({
  target: libraryContextTarget,
  onClose,
  favoritedUris,
  writablePlaylists,
  activePlaylistId,
  cleanCollectionTitle,
  cycleTargetHybridPlaylist,
  handlePlayTracksNext,
  handleAddTracksToPlaylist,
  handleFavoriteTrack,
  handleAddAppleToCloudLibrary,
  albums,
  selectCloudAlbum,
  selectLocalCollection,
  openArtistProfile,
  handleStartSoundCloudTrackRadio,
  browserTarget,
  handleRemoveTrackFromPlaylist,
  setPlayingContextId,
  setView,
  resolveCollectionTracks,
  showToast,
  handleAddSimpPlaylistToHybrid,
  handleAddSimpAlbumToHybrid,
  handleAddArchiveItemToHybrid,
  handlePinCloudPlaylist,
  handlePinCloudAlbum,
  handlePinSoundCloudPlaylist,
  handlePinArchiveItem,
  handleDeletePlaylist,
  handleDeleteAlbum,
}) => {
  const activeWritable =
    writablePlaylists.find((p) => p.id === activePlaylistId) || writablePlaylists[0];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2500,
        background: 'rgba(2, 4, 10, 0.78)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
    >
      <div
        data-library-context-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 94vw)',
          maxHeight: '86vh',
          overflowY: 'auto',
          borderRadius: 16,
          background: '#0b0c13',
          border: '1px solid #2aa3c4',
          boxShadow: '0 22px 55px rgba(0, 0, 0, 0.85)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            paddingBottom: 10,
            borderBottom: '1px solid #181a28',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                fontWeight: 800,
                color: '#2aa3c4',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
              }}
            >
              {libraryContextTarget.type === 'track'
                ? '🎵 Track Actions (SELECT)'
                : '💿 Collection Actions (SELECT)'}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: '#f8fafc',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 2,
              }}
            >
              {libraryContextTarget.type === 'track'
                ? libraryContextTarget.track.title
                : libraryContextTarget.title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: '#94a3b8',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {libraryContextTarget.type === 'track'
                ? `${libraryContextTarget.track.artists.join(', ')}${
                    libraryContextTarget.track.album
                      ? ` • ${libraryContextTarget.track.album}`
                      : ''
                  }`
                : libraryContextTarget.subtitle || libraryContextTarget.artistName || ''}
            </div>
          </div>
          <button
            data-focusable="true"
            data-library-context-close="true"
            onClick={onClose}
            style={{
              minHeight: 34,
              padding: '0 10px',
              borderRadius: 8,
              background: '#141622',
              border: '1px solid #2b2f44',
              color: '#cbd5e1',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ✕ Close<span className="simp-gp-badge"> (B)</span>
          </button>
        </div>

        {/* Track Context Actions */}
        {libraryContextTarget.type === 'track' &&
          (() => {
            const t = libraryContextTarget.track;
            const isFav = favoritedUris.includes(t.uri);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  data-focusable="true"
                  data-default-focus="true"
                  onClick={() => {
                    handlePlayTracksNext([t], `"${t.title}"`);
                    onClose();
                  }}
                  style={{
                    minHeight: 40,
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: '#0f222a',
                    border: '1px solid #2aa3c4',
                    color: '#e0f7fc',
                    fontSize: 12,
                    fontWeight: 800,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  ⏭ Play Next (Insert After Current Track)
                </button>

                <button
                  data-focusable="true"
                  onClick={() => {
                    handleAddTracksToPlaylist([t.uri], `"${t.title}"`, [t]);
                    onClose();
                  }}
                  style={{
                    minHeight: 40,
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: '#121824',
                    border: '1px solid #26354d',
                    color: '#bae6fd',
                    fontSize: 12,
                    fontWeight: 800,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  ★ Add to SIMP Hybrid Playlist (
                  {activeWritable ? cleanCollectionTitle(activeWritable.name) : 'Create / Select'}
                  )
                </button>

                {writablePlaylists.length >= 2 && (
                  <button
                    data-focusable="true"
                    onClick={() => {
                      cycleTargetHybridPlaylist();
                    }}
                    style={{
                      minHeight: 34,
                      padding: '6px 12px',
                      borderRadius: 8,
                      background: '#10121a',
                      border: '1px solid #222638',
                      color: '#94a3b8',
                      fontSize: 11,
                      fontWeight: 700,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    ⇄ Switch Target Hybrid Playlist
                  </button>
                )}

                {handleFavoriteTrack && (
                  <button
                    data-focusable="true"
                    onClick={() => {
                      handleFavoriteTrack(t);
                      onClose();
                    }}
                    style={{
                      minHeight: 40,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: isFav ? '#2a101b' : '#16141e',
                      border: isFav ? '1px solid #f43f5e' : '1px solid #2c283e',
                      color: isFav ? '#fda4af' : '#e2e8f0',
                      fontSize: 12,
                      fontWeight: 800,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    {isFav
                      ? '💔 Remove from Favorites / Likes'
                      : t.source === 'soundcloud'
                      ? '❤️ Like on SoundCloud & Favorite'
                      : t.source === 'apple_music'
                      ? '❤️ Love on Apple Music & Favorite'
                      : '❤️ Add to Favorites'}
                  </button>
                )}

                {t.source === 'apple_music' && handleAddAppleToCloudLibrary && (
                  <button
                    data-focusable="true"
                    onClick={() => {
                      handleAddAppleToCloudLibrary(t.uri, 'songs', t.title);
                      onClose();
                    }}
                    style={{
                      minHeight: 40,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: '#221019',
                      border: '1px solid #fb7185',
                      color: '#fda4af',
                      fontSize: 12,
                      fontWeight: 800,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    ☁️+ Add Song to Apple Music Cloud Library
                  </button>
                )}

                {(t.source === 'apple_music' || t.album_id || t.album) && (
                  <button
                    data-focusable="true"
                    onClick={() => {
                      onClose();
                      if (t.source === 'apple_music') {
                        selectCloudAlbum({
                          albumId: t.album_id,
                          songUri: t.uri,
                          fallbackTitle: t.album || t.title,
                        });
                      } else if (t.album_id) {
                        const foundAlb = albums.find((a) => a.id === t.album_id);
                        if (foundAlb) {
                          selectLocalCollection({
                            kind: 'album',
                            id: foundAlb.id,
                            title: foundAlb.title,
                            subtitle: foundAlb.album_artist,
                            art_url: foundAlb.art_url,
                          });
                        }
                      }
                    }}
                    style={{
                      minHeight: 40,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: '#161420',
                      border: '1px solid #2e2a40',
                      color: '#e2e8f0',
                      fontSize: 12,
                      fontWeight: 700,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    💿 Open Parent Album {t.album ? `("${t.album}")` : ''}
                  </button>
                )}

                {t.artists.length > 0 && t.artists[0] && (
                  <button
                    data-focusable="true"
                    onClick={() => {
                      const artistName = t.artists[0];
                      const src: 'soundcloud' | 'apple_music' | 'local' =
                        t.source === 'soundcloud'
                          ? 'soundcloud'
                          : t.source === 'apple_music'
                          ? 'apple_music'
                          : 'local';
                      onClose();
                      openArtistProfile({
                        source: src,
                        idOrName: `name:${artistName}`,
                        displayName: artistName,
                      });
                    }}
                    style={{
                      minHeight: 40,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: '#141622',
                      border: '1px solid #282c42',
                      color: '#cbd5e1',
                      fontSize: 12,
                      fontWeight: 700,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    🎤 More from Artist ({t.artists[0]})
                  </button>
                )}

                {t.source === 'soundcloud' && (
                  <button
                    data-focusable="true"
                    onClick={() => {
                      onClose();
                      handleStartSoundCloudTrackRadio(t);
                    }}
                    style={{
                      minHeight: 40,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: '#221108',
                      border: '1px solid #ea580c',
                      color: '#fed7aa',
                      fontSize: 12,
                      fontWeight: 800,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    📻 Start SoundCloud Track Radio
                  </button>
                )}

                {libraryContextTarget.isViewingLocalPlaylist && browserTarget && (
                  <button
                    data-focusable="true"
                    onClick={() => {
                      const pid = browserTarget.id;
                      onClose();
                      handleRemoveTrackFromPlaylist(pid, t.uri, t.title);
                    }}
                    style={{
                      minHeight: 40,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: '#221014',
                      border: '1px solid #7f1d1d',
                      color: '#fca5a5',
                      fontSize: 12,
                      fontWeight: 800,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    − Remove Track from Playlist
                  </button>
                )}

                <button
                  data-focusable="true"
                  onClick={() => {
                    onClose();
                    window.dispatchEvent(
                      new CustomEvent('simp-open-track-properties', { detail: t }),
                    );
                  }}
                  style={{
                    minHeight: 40,
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: '#111b27',
                    border: '1px solid #2aa3c4',
                    color: '#bfeaf5',
                    fontSize: 12,
                    fontWeight: 800,
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <ImpIcon name="sliders" size={14} color="#38bdf8" />
                  Track Properties & Local Curation (Lyrics / Art / Overlays)
                </button>
              </div>
            );
          })()}

        {/* Collection Context Actions */}
        {libraryContextTarget.type === 'collection' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {libraryContextTarget.kind === 'simp_playlist' &&
              libraryContextTarget.rawItem?.origin &&
              libraryContextTarget.rawItem.origin !== 'simp_local' && (
                <button
                  data-focusable="true"
                  onClick={async () => {
                    const pl = libraryContextTarget.rawItem;
                    onClose();
                    try {
                      const resp = await fetch(
                        'http://127.0.0.1:18888/api/library/playlists/convert-to-hybrid',
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ playlist_id: pl.id }),
                        },
                      );
                      const json = await resp.json();
                      if (json?.ok) {
                        showToast(`Converted "${cleanCollectionTitle(pl.name)}" to Editable Hybrid Playlist`);
                      } else {
                        showToast('Failed to convert playlist to Hybrid');
                      }
                    } catch {
                      showToast('Failed to convert playlist to Hybrid');
                    }
                  }}
                  style={{
                    minHeight: 40,
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'rgba(52, 211, 153, 0.14)',
                    border: '1px solid rgba(52, 211, 153, 0.5)',
                    color: '#6ee7b7',
                    fontSize: 12,
                    fontWeight: 800,
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <ImpIcon name="fork" size={14} color="#34d399" />
                  Fork / Convert Pinned Collection to Hybrid Playlist
                </button>
              )}
            <button
              data-focusable="true"
              data-default-focus="true"
              onClick={async () => {
                const target = libraryContextTarget;
                onClose();
                if (target.kind === 'simp_playlist') {
                  setPlayingContextId(`playlist:${target.id}`);
                  defaultSimpClient.playPlaylist(target.id, true);
                  setView('lock');
                  return;
                }
                if (target.kind === 'simp_album') {
                  setPlayingContextId(`album:${target.id}`);
                  defaultSimpClient.playAlbum(target.id, true);
                  setView('lock');
                  return;
                }
                const tracks = await resolveCollectionTracks(target);
                if (tracks.length > 0) {
                  defaultSimpClient.setShuffle(true);
                  defaultSimpClient.loadQueue(
                    tracks.map((tr) => tr.uri),
                    0,
                    tracks
                  );
                  setView('lock');
                } else {
                  showToast('Could not resolve tracks to shuffle');
                }
              }}
              style={{
                minHeight: 40,
                padding: '8px 12px',
                borderRadius: 10,
                background: '#0f222a',
                border: '1px solid #2aa3c4',
                color: '#e0f7fc',
                fontSize: 12,
                fontWeight: 800,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              🔀 Shuffle Collection Now
            </button>

            <button
              data-focusable="true"
              onClick={async () => {
                const target = libraryContextTarget;
                onClose();
                const tracks = await resolveCollectionTracks(target);
                if (tracks.length > 0) {
                  handlePlayTracksNext(tracks, `"${target.title}"`);
                } else {
                  showToast('Could not resolve collection tracks');
                }
              }}
              style={{
                minHeight: 40,
                padding: '8px 12px',
                borderRadius: 10,
                background: '#121824',
                border: '1px solid #26354d',
                color: '#bae6fd',
                fontSize: 12,
                fontWeight: 800,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              ⏭ Play Collection Next (Insert After Current Track)
            </button>

            <button
              data-focusable="true"
              onClick={async () => {
                const target = libraryContextTarget;
                onClose();
                if (target.kind === 'simp_playlist') {
                  await handleAddSimpPlaylistToHybrid(target.rawItem);
                } else if (target.kind === 'simp_album') {
                  await handleAddSimpAlbumToHybrid(target.rawItem);
                } else if (target.kind === 'ia_item') {
                  await handleAddArchiveItemToHybrid(target.rawItem);
                } else {
                  const tracks = await resolveCollectionTracks(target);
                  if (tracks.length > 0) {
                    await handleAddTracksToPlaylist(
                      tracks.map((tr) => tr.uri),
                      `all ${tracks.length} tracks from "${target.title}"`,
                      tracks
                    );
                  }
                }
              }}
              style={{
                minHeight: 40,
                padding: '8px 12px',
                borderRadius: 10,
                background: '#141824',
                border: '1px solid #2b3548',
                color: '#e2e8f0',
                fontSize: 12,
                fontWeight: 800,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              ★ Add All Tracks to SIMP Hybrid Playlist (
              {activeWritable ? cleanCollectionTitle(activeWritable.name) : 'Create / Select'}
              )
            </button>

            {(libraryContextTarget.kind === 'cloud_playlist' ||
              libraryContextTarget.kind === 'cloud_album' ||
              libraryContextTarget.kind === 'sc_playlist' ||
              libraryContextTarget.kind === 'ia_item') && (
              <button
                data-focusable="true"
                onClick={async () => {
                  const target = libraryContextTarget;
                  onClose();
                  if (target.kind === 'cloud_playlist') {
                    handlePinCloudPlaylist(target.rawItem);
                  } else if (target.kind === 'cloud_album') {
                    const tracks = await resolveCollectionTracks(target);
                    handlePinCloudAlbum(target.rawItem, tracks);
                  } else if (target.kind === 'sc_playlist') {
                    handlePinSoundCloudPlaylist(target.rawItem);
                  } else if (target.kind === 'ia_item') {
                    handlePinArchiveItem(target.rawItem);
                  }
                }}
                style={{
                  minHeight: 40,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: '#1c160c',
                  border: '1px solid #d97706',
                  color: '#fde68a',
                  fontSize: 12,
                  fontWeight: 800,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                📌 Pin Collection to SIMP Library
              </button>
            )}

            {libraryContextTarget.kind === 'cloud_album' && handleAddAppleToCloudLibrary && (
              <button
                data-focusable="true"
                onClick={() => {
                  const target = libraryContextTarget;
                  onClose();
                  handleAddAppleToCloudLibrary(target.id, 'albums', target.title);
                }}
                style={{
                  minHeight: 40,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: '#221019',
                  border: '1px solid #fb7185',
                  color: '#fda4af',
                  fontSize: 12,
                  fontWeight: 800,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                ☁️+ Add Album to Apple Music Cloud Library
              </button>
            )}

            {libraryContextTarget.kind === 'cloud_playlist' && handleAddAppleToCloudLibrary && (
              <button
                data-focusable="true"
                onClick={() => {
                  const target = libraryContextTarget;
                  onClose();
                  handleAddAppleToCloudLibrary(target.id, 'playlists', target.title);
                }}
                style={{
                  minHeight: 40,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: '#221019',
                  border: '1px solid #fb7185',
                  color: '#fda4af',
                  fontSize: 12,
                  fontWeight: 800,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                ☁️+ Add Playlist to Apple Music Cloud Library
              </button>
            )}

            {libraryContextTarget.artistName && (
              <button
                data-focusable="true"
                onClick={() => {
                  const target = libraryContextTarget;
                  onClose();
                  const src: 'soundcloud' | 'apple_music' | 'local' =
                    target.source === 'soundcloud'
                      ? 'soundcloud'
                      : target.source === 'apple_music'
                      ? 'apple_music'
                      : 'local';
                  openArtistProfile({
                    source: src,
                    idOrName: `name:${target.artistName}`,
                    displayName: target.artistName!,
                  });
                }}
                style={{
                  minHeight: 40,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: '#141622',
                  border: '1px solid #282c42',
                  color: '#cbd5e1',
                  fontSize: 12,
                  fontWeight: 700,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                🎤 More from Artist ({libraryContextTarget.artistName})
              </button>
            )}

            {(libraryContextTarget.kind === 'simp_playlist' ||
              libraryContextTarget.kind === 'simp_album') && (
              <button
                data-focusable="true"
                onClick={() => {
                  const target = libraryContextTarget;
                  onClose();
                  if (target.kind === 'simp_playlist') {
                    handleDeletePlaylist(target.id, target.title);
                  } else if (target.kind === 'simp_album') {
                    handleDeleteAlbum(target.id, target.title);
                  }
                }}
                style={{
                  minHeight: 40,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: '#221014',
                  border: '1px solid #7f1d1d',
                  color: '#fca5a5',
                  fontSize: 12,
                  fontWeight: 800,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                🗑️ Remove from SIMP Library
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
