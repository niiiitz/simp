import React from 'react';
import { AlbumRecord, defaultSimpClient, TrackMetadata } from '@simp/client';
import {
  AppleArtistProfileResponse,
  AppleArtistSummary,
  AppleCloudAlbumSummary,
  LocalArtistProfileResponse,
} from '../../drivers/AppleMusicDriver';
import {
  SoundCloudPlaylistSummary,
  SoundCloudUserProfileResponse,
  SoundCloudUserSummary,
  toggleFollowSoundCloudUser,
} from '../../drivers/SoundCloudDriver';
import { SoundCloudAttributionLink } from '../../components/SoundCloudLogo';
import { AppleMusicAttributionLink } from '../../components/AppleMusicLogo';

export interface ActiveArtistProfileState {
  source: 'apple_music' | 'soundcloud' | 'local';
  idOrName: string;
  displayName: string;
  subTab: 'tracks' | 'albums' | 'singles_or_likes' | 'related_or_following';
  loading: boolean;
  loadingMore?: boolean;
  appleData?: AppleArtistProfileResponse | null;
  scData?: SoundCloudUserProfileResponse | null;
  localData?: LocalArtistProfileResponse | null;
}

export interface LibraryArtistProfilePaneProps {
  activeArtistProfile: ActiveArtistProfileState;
  setActiveArtistProfile: React.Dispatch<React.SetStateAction<ActiveArtistProfileState | null>>;
  handleWalkBack: () => void;
  setPlayingContextId: React.Dispatch<React.SetStateAction<string>>;
  setView: React.Dispatch<React.SetStateAction<'lock' | 'browser'>>;
  scFollowings: SoundCloudUserSummary[];
  setScFollowings: React.Dispatch<React.SetStateAction<SoundCloudUserSummary[]>>;
  showToast: (msg: string) => void;
  loadMoreArtistTracks: () => void;
  tileGridStyle: React.CSSProperties;
  renderSingleSongRow: (
    s: TrackMetadata,
    peerList: TrackMetadata[],
    ctxPrefix: string
  ) => React.ReactNode;
  renderSoundCloudPlaylistCard: (pl: SoundCloudPlaylistSummary) => React.ReactNode;
  renderCloudAlbumCard: (alb: AppleCloudAlbumSummary) => React.ReactNode;
  renderSimpAlbumCard: (alb: AlbumRecord) => React.ReactNode;
  renderSoundCloudUserCard: (user: SoundCloudUserSummary) => React.ReactNode;
  renderAppleArtistCard: (artist: AppleArtistSummary) => React.ReactNode;
}

export const LibraryArtistProfilePane: React.FC<LibraryArtistProfilePaneProps> = ({
  activeArtistProfile,
  setActiveArtistProfile,
  handleWalkBack,
  setPlayingContextId,
  setView,
  scFollowings,
  setScFollowings,
  showToast,
  loadMoreArtistTracks,
  tileGridStyle,
  renderSingleSongRow,
  renderSoundCloudPlaylistCard,
  renderCloudAlbumCard,
  renderSimpAlbumCard,
  renderSoundCloudUserCard,
  renderAppleArtistCard,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: 12,
          borderBottom: '1px solid #16161c',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
          <button
            data-right-back-grid="true"
            onClick={handleWalkBack}
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
          {activeArtistProfile.scData?.user?.avatar_url ||
          activeArtistProfile.appleData?.artist?.art_url ||
          activeArtistProfile.localData?.art_url ? (
            <img
              src={
                activeArtistProfile.scData?.user?.avatar_url ||
                activeArtistProfile.appleData?.artist?.art_url ||
                activeArtistProfile.localData?.art_url ||
                ''
              }
              alt=""
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                objectFit: 'cover',
                border: '2px solid #2aa3c4',
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: '#141622',
                border: '2px solid #2aa3c4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              🎤
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: '#f8fafc',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeArtistProfile.scData?.user?.username ||
                activeArtistProfile.appleData?.artist?.name ||
                activeArtistProfile.localData?.name ||
                activeArtistProfile.displayName}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              {activeArtistProfile.source === 'soundcloud'
                ? `☁️ SoundCloud Creator${
                    activeArtistProfile.scData?.user
                      ? ` • ${activeArtistProfile.scData.user.followers_count.toLocaleString()} followers`
                      : ''
                  }`
                : activeArtistProfile.source === 'apple_music'
                ? `🍎 Apple Music Artist${
                    activeArtistProfile.appleData?.artist?.genre
                      ? ` • ${activeArtistProfile.appleData.artist.genre}`
                      : ''
                  }`
                : '💾 Local Library Artist'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {(() => {
            const topTracks: TrackMetadata[] =
              activeArtistProfile.scData?.tracks ||
              activeArtistProfile.appleData?.top_tracks ||
              activeArtistProfile.localData?.tracks ||
              [];
            return topTracks.length > 0 ? (
              <>
                <button
                  data-right-play-all="true"
                  onClick={() => {
                    setPlayingContextId(
                      `artist:${activeArtistProfile.source}:${activeArtistProfile.displayName}`
                    );
                    defaultSimpClient.loadQueue(
                      topTracks.map((t: TrackMetadata) => t.uri),
                      0,
                      topTracks
                    );
                    setView('lock');
                  }}
                  style={{
                    minHeight: 38,
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
                  ▶ Play Tracks<span className="simp-gp-badge"> (A)</span>
                </button>
                <button
                  onClick={() => {
                    setPlayingContextId(
                      `artist:${activeArtistProfile.source}:${activeArtistProfile.displayName}`
                    );
                    defaultSimpClient.setShuffle(true);
                    defaultSimpClient.loadQueue(
                      topTracks.map((t: TrackMetadata) => t.uri),
                      0,
                      topTracks
                    );
                    setView('lock');
                  }}
                  style={{
                    minHeight: 38,
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
              </>
            ) : null;
          })()}
          {activeArtistProfile.source === 'soundcloud' && (
            <SoundCloudAttributionLink
              permalinkUrl={activeArtistProfile.scData?.user?.permalink_url}
              kind="user"
              id={
                activeArtistProfile.scData?.user?.id ||
                activeArtistProfile.idOrName ||
                activeArtistProfile.displayName
              }
              label="SoundCloud"
              width={30}
              style={{ minHeight: 38, padding: '0 12px', borderRadius: 10 }}
            />
          )}
          {activeArtistProfile.source === 'apple_music' && (
            <AppleMusicAttributionLink
              kind="artist"
              id={
                activeArtistProfile.appleData?.artist?.id ||
                activeArtistProfile.idOrName ||
                activeArtistProfile.displayName
              }
              label="Apple Music"
              style={{ minHeight: 38, padding: '0 12px', borderRadius: 10 }}
            />
          )}
          {activeArtistProfile.source === 'soundcloud' && activeArtistProfile.scData?.user && (
            <button
              onClick={async () => {
                const u = activeArtistProfile.scData?.user;
                if (!u) return;
                const isFollowing = scFollowings.some((f) => f.id === u.id);
                await toggleFollowSoundCloudUser(u.id, !isFollowing).catch(() => {});
                setScFollowings((prev) =>
                  isFollowing ? prev.filter((f) => f.id !== u.id) : [u, ...prev]
                );
                showToast(isFollowing ? `Unfollowed ${u.username}` : `Following ${u.username}`);
              }}
              style={{
                minHeight: 38,
                padding: '0 14px',
                borderRadius: 10,
                background: '#221108',
                border: '1px solid #f97316',
                color: '#fdba74',
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {scFollowings.some((f) => f.id === activeArtistProfile.scData?.user?.id)
                ? '✓ Following'
                : '+ Follow Artist'}
            </button>
          )}
        </div>
      </div>

      {/* SoundCloud Gated (MONETIZE / Go+) Content Notice Banner */}
      {activeArtistProfile.source === 'soundcloud' &&
        ((activeArtistProfile.scData?.gated_track_count ?? 0) > 0 ||
          (activeArtistProfile.scData?.gated_playlist_count ?? 0) > 0) &&
        (() => {
          const gatedTracks = activeArtistProfile.scData?.gated_track_count ?? 0;
          const gatedSets = activeArtistProfile.scData?.gated_playlist_count ?? 0;
          const permalinkUrl =
            activeArtistProfile.scData?.user?.permalink_url ||
            `https://soundcloud.com/${encodeURIComponent(
              (
                activeArtistProfile.scData?.user?.username ||
                activeArtistProfile.displayName.replace(/^@/, '')
              ).trim()
            )}`;
          const isSteamGameMode =
            typeof window !== 'undefined' &&
            (window.parent !== window || window.navigator.userAgent.includes('Valve Steam'));
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
                  ☁️ More content from {activeArtistProfile.displayName} is available exclusively on
                  SoundCloud
                </div>
                <div style={{ fontSize: 11, color: '#fdba74' }}>
                  {gatedTracks > 0
                    ? `${gatedTracks} Go+ / Monetized track${gatedTracks === 1 ? '' : 's'}`
                    : ''}
                  {gatedTracks > 0 && gatedSets > 0 ? ' • ' : ''}
                  {gatedSets > 0
                    ? `${gatedSets} gated album/set${gatedSets === 1 ? '' : 's'}`
                    : ''}{' '}
                  require SoundCloud web/app playback ({permalinkUrl})
                </div>
              </div>
              {!isSteamGameMode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <SoundCloudAttributionLink
                    permalinkUrl={permalinkUrl}
                    kind="user"
                    id={
                      activeArtistProfile.scData?.user?.id ||
                      activeArtistProfile.idOrName ||
                      activeArtistProfile.displayName
                    }
                    label="Open on SoundCloud ↗"
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

      {/* Sub-tab pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(
          [
            {
              id: 'tracks' as const,
              label:
                activeArtistProfile.source === 'soundcloud'
                  ? `🎵 Tracks (${activeArtistProfile.scData?.tracks.length ?? 0}${
                      activeArtistProfile.scData?.next_tracks_href ? '+' : ''
                    })`
                  : activeArtistProfile.source === 'apple_music'
                  ? `🎵 Top Tracks (${activeArtistProfile.appleData?.top_tracks.length ?? 0})`
                  : `🎵 Tracks (${activeArtistProfile.localData?.tracks.length ?? 0})`,
            },
            {
              id: 'albums' as const,
              label:
                activeArtistProfile.source === 'soundcloud'
                  ? `🎶 Sets & Albums (${activeArtistProfile.scData?.playlists.length ?? 0})`
                  : activeArtistProfile.source === 'apple_music'
                  ? `💿 Albums (${activeArtistProfile.appleData?.albums.length ?? 0})`
                  : `💿 Albums (${activeArtistProfile.localData?.albums.length ?? 0})`,
            },
            ...(activeArtistProfile.source === 'soundcloud'
              ? [
                  {
                    id: 'singles_or_likes' as const,
                    label: `❤️ Likes (${activeArtistProfile.scData?.liked_tracks?.length ?? 0})`,
                  },
                  {
                    id: 'related_or_following' as const,
                    label: `👥 Following (${activeArtistProfile.scData?.followings?.length ?? 0})`,
                  },
                ]
              : activeArtistProfile.source === 'apple_music'
              ? [
                  {
                    id: 'singles_or_likes' as const,
                    label: `🎶 Singles & EPs (${activeArtistProfile.appleData?.singles.length ?? 0})`,
                  },
                  {
                    id: 'related_or_following' as const,
                    label: `👥 Related Artists (${activeArtistProfile.appleData?.related_artists.length ?? 0})`,
                  },
                ]
              : []),
          ]
        ).map((tab) => {
          const active = activeArtistProfile.subTab === tab.id;
          return (
            <button
              key={tab.id}
              data-right-filter-pill="true"
              onClick={() =>
                setActiveArtistProfile((prev) => (prev ? { ...prev, subTab: tab.id } : prev))
              }
              style={{
                minHeight: 34,
                padding: '0 14px',
                borderRadius: 999,
                background: active ? '#122934' : '#121218',
                border: active ? '1px solid #2aa3c4' : '1px solid #242430',
                color: active ? '#e0f7fc' : '#a1a1aa',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeArtistProfile.loading ? (
        <div style={{ padding: 24, color: '#94a3b8', fontSize: 13 }}>
          ⏳ Loading artist catalog...
        </div>
      ) : (
        <>
          {activeArtistProfile.subTab === 'tracks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(() => {
                const tracks: TrackMetadata[] =
                  activeArtistProfile.scData?.tracks ||
                  activeArtistProfile.appleData?.top_tracks ||
                  activeArtistProfile.localData?.tracks ||
                  [];
                return tracks.length > 0 ? (
                  <>
                    {tracks.map((s) =>
                      renderSingleSongRow(
                        s,
                        tracks,
                        `artist:${activeArtistProfile.source}:${activeArtistProfile.displayName}`
                      )
                    )}
                    {activeArtistProfile.source === 'soundcloud' &&
                      activeArtistProfile.scData?.next_tracks_href && (
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                          <button
                            data-focusable="true"
                            data-load-more="true"
                            onClick={loadMoreArtistTracks}
                            disabled={activeArtistProfile.loadingMore}
                            style={{
                              minHeight: 38,
                              padding: '0 20px',
                              borderRadius: 10,
                              background: '#1c1008',
                              border: '1px solid #ea580c',
                              color: '#fdba74',
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: activeArtistProfile.loadingMore ? 'wait' : 'pointer',
                            }}
                          >
                            {activeArtistProfile.loadingMore
                              ? '⏳ Loading More Tracks...'
                              : '⬇ Load More Artist Tracks'}
                          </button>
                        </div>
                      )}
                  </>
                ) : (
                  <div style={{ padding: 16, color: '#8e8e99', fontSize: 12 }}>
                    No streamable tracks found for this artist.
                  </div>
                );
              })()}
            </div>
          )}

          {activeArtistProfile.subTab === 'albums' && (
            <div style={tileGridStyle}>
              {activeArtistProfile.source === 'soundcloud'
                ? (activeArtistProfile.scData?.playlists || []).map((pl) =>
                    renderSoundCloudPlaylistCard(pl)
                  )
                : activeArtistProfile.source === 'apple_music'
                ? (activeArtistProfile.appleData?.albums || []).map(renderCloudAlbumCard)
                : (activeArtistProfile.localData?.albums || []).map(renderSimpAlbumCard)}
            </div>
          )}

          {activeArtistProfile.subTab === 'singles_or_likes' && (
            <>
              {activeArtistProfile.source === 'soundcloud' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(activeArtistProfile.scData?.liked_tracks || []).map((s, _idx, arr) =>
                    renderSingleSongRow(
                      s,
                      arr,
                      `artist:sc:likes:${activeArtistProfile.displayName}`
                    )
                  )}
                </div>
              ) : (
                <div style={tileGridStyle}>
                  {(activeArtistProfile.appleData?.singles || []).map(renderCloudAlbumCard)}
                </div>
              )}
            </>
          )}

          {activeArtistProfile.subTab === 'related_or_following' && (
            <div style={tileGridStyle}>
              {activeArtistProfile.source === 'soundcloud'
                ? (activeArtistProfile.scData?.followings || []).map((u) =>
                    renderSoundCloudUserCard(u)
                  )
                : (activeArtistProfile.appleData?.related_artists || []).map(
                    renderAppleArtistCard
                  )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

