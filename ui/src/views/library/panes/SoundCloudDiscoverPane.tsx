import React from "react";
import {
  defaultSimpClient,
  SimpStateSnapshot,
  TrackMetadata,
} from "@simp/client";
import {
  fetchSoundCloudDiscover,
  fetchSoundCloudFollowings,
  fetchSoundCloudLikesAndPlaylists,
  fetchSoundCloudStreamAndRadio,
  SoundCloudPlaylistSummary,
  SoundCloudUserSummary,
} from "../../../drivers/SoundCloudDriver";
import {
  tileGridStyle,
} from "../libraryHelpers";

export interface SoundCloudDiscoverPaneProps {
  browserSourceFilter: "all" | "local" | "apple_music" | "soundcloud" | "internet_archive";
  cloudLoading: boolean;
  handleStartSoundCloudTrackRadio: any;
  loadMoreScDiscover: any;
  recentlyPlayed: TrackMetadata[];
  renderSingleSongRow: any;
  renderSoundCloudPlaylistCard: any;
  renderSoundCloudUserCard: any;
  scDiscoverNextHref: string | null | undefined;
  scFollowings: SoundCloudUserSummary[];
  scFreshUploads: TrackMetadata[];
  scLikedTracks: TrackMetadata[];
  scLikesFilter: "all" | "sets" | "likes" | "following";
  scLoadingMore: boolean;
  scMoreOfWhatYouLike: TrackMetadata[];
  scPlaylists: SoundCloudPlaylistSummary[];
  scRecommendedArtists: SoundCloudUserSummary[];
  scSelectedGenre: string;
  scStreamFilter: "all" | "sets" | "history" | "stream";
  scStreamPlaylists: SoundCloudPlaylistSummary[];
  scStreamTracks: TrackMetadata[];
  scTrendingFilter: "all" | "for_you" | "fresh" | "artists" | "mixes" | "sets" | "tracks";
  scTrendingMixes: TrackMetadata[];
  scTrendingPlaylists: SoundCloudPlaylistSummary[];
  scTrendingTracks: TrackMetadata[];
  setCloudLoading: any;
  setPlayingContextId: any;
  setScDiscoverNextHref: any;
  setScFollowings: any;
  setScLikedTracks: any;
  setScLikesFilter: any;
  setScPlaylists: any;
  setScSelectedGenre: any;
  setScStreamFilter: any;
  setScStreamPlaylists: any;
  setScStreamTracks: any;
  setScTrendingFilter: any;
  setScTrendingMixes: any;
  setScTrendingPlaylists: any;
  setScTrendingTracks: any;
  setView: any;
  snap: SimpStateSnapshot | null;
  soundCloudSubTab: "pinned" | "likes_sets" | "stream_radio" | "trending";
}

export const SoundCloudDiscoverPane: React.FC<SoundCloudDiscoverPaneProps> = ({
  browserSourceFilter,
  cloudLoading,
  handleStartSoundCloudTrackRadio,
  loadMoreScDiscover,
  recentlyPlayed,
  renderSingleSongRow,
  renderSoundCloudPlaylistCard,
  renderSoundCloudUserCard,
  scDiscoverNextHref,
  scFollowings,
  scFreshUploads,
  scLikedTracks,
  scLikesFilter,
  scLoadingMore,
  scMoreOfWhatYouLike,
  scPlaylists,
  scRecommendedArtists,
  scSelectedGenre,
  scStreamFilter,
  scStreamPlaylists,
  scStreamTracks,
  scTrendingFilter,
  scTrendingMixes,
  scTrendingPlaylists,
  scTrendingTracks,
  setCloudLoading,
  setPlayingContextId,
  setScDiscoverNextHref,
  setScFollowings,
  setScLikedTracks,
  setScLikesFilter,
  setScPlaylists,
  setScSelectedGenre,
  setScStreamFilter,
  setScStreamPlaylists,
  setScStreamTracks,
  setScTrendingFilter,
  setScTrendingMixes,
  setScTrendingPlaylists,
  setScTrendingTracks,
  setView,
  snap,
  soundCloudSubTab,
}) => {
  return (
    <>
                {/* ---------------------------------------------------------
                    6. ☁️ SOUNDCLOUD LIKES & SETS HUB (Personal Account OAuth)
                   --------------------------------------------------------- */}
                {browserSourceFilter === 'soundcloud' && soundCloudSubTab === 'likes_sets' && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingBottom: 10,
                        borderBottom: '1px solid #16161c',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 800,
                            color: '#fed7aa',
                            marginRight: 6,
                          }}
                        >
                          ❤️ Likes & Sets
                        </span>
                        {(
                          [
                            { id: 'all', label: 'All' },
                            { id: 'likes', label: `❤️ Liked Tracks (${scLikedTracks.length})` },
                            { id: 'sets', label: `🎶 Sets & Playlists (${scPlaylists.length})` },
                            { id: 'following', label: `👥 Following (${scFollowings.length})` },
                          ] as const
                        ).map((f) => {
                          const active = scLikesFilter === f.id;
                          return (
                            <button
                              key={f.id}
                              data-right-filter-pill="true"
                              onClick={() => setScLikesFilter(f.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 6,
                                background: active ? '#2c140a' : '#101018',
                                border: active ? '1px solid #ff5500' : '1px solid #222230',
                                color: active ? '#fed7aa' : '#9ca3af',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {f.label}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {scLikedTracks.length > 0 && (
                          <button
                            data-right-filter-pill="true"
                            onClick={() => {
                              setPlayingContextId('sc:likes');
                              defaultSimpClient.loadQueue(
                                scLikedTracks.map((t) => t.uri),
                                0,
                                scLikedTracks
                              );
                              setView('lock');
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              background: '#2c140a',
                              border: '1px solid #ff5500',
                              color: '#fed7aa',
                              fontSize: 11,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            ▶ Play All Likes
                          </button>
                        )}
                        <button
                          data-right-filter-pill="true"
                          onClick={() => {
                            setCloudLoading(true);
                            Promise.all([
                              fetchSoundCloudLikesAndPlaylists().then((res) => {
                                setScLikedTracks(res.likedTracks);
                                setScPlaylists(res.playlists);
                              }),
                              fetchSoundCloudFollowings().then((users) => {
                                if (Array.isArray(users)) setScFollowings(users);
                              }),
                            ])
                              .catch(() => {})
                              .finally(() => setCloudLoading(false));
                          }}
                          style={{
                            padding: '4px 9px',
                            borderRadius: 6,
                            background: '#161620',
                            border: '1px solid #2a2a38',
                            color: '#fdba74',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ↻ Refresh
                        </button>
                      </div>
                    </div>

                    {(scLikesFilter === 'all' || scLikesFilter === 'sets') &&
                      scPlaylists.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🎶 YOUR SOUNDCLOUD SETS & PLAYLISTS ({scPlaylists.length})
                          </div>
                          <div style={tileGridStyle}>
                            {scPlaylists.map(renderSoundCloudPlaylistCard)}
                          </div>
                        </>
                      )}

                    {(scLikesFilter === 'all' || scLikesFilter === 'following') &&
                      scFollowings.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            👥 FOLLOWED CREATORS & DJS ({scFollowings.length})
                          </div>
                          <div style={tileGridStyle}>
                            {scFollowings.map(renderSoundCloudUserCard)}
                          </div>
                        </>
                      )}

                    {(scLikesFilter === 'all' || scLikesFilter === 'likes') &&
                      scLikedTracks.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            ❤️ LIKED TRACKS ({scLikedTracks.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scLikedTracks.map((s) =>
                              renderSingleSongRow(s, scLikedTracks, 'sc_likes')
                            )}
                          </div>
                        </>
                      )}

                    {scPlaylists.length === 0 &&
                      scLikedTracks.length === 0 &&
                      scFollowings.length === 0 &&
                      !cloudLoading && (
                      <div style={{ fontSize: 12, color: '#8e8e99', padding: '12px 4px' }}>
                        {snap?.soundcloud_authenticated
                          ? 'No SoundCloud likes or sets found yet.'
                          : 'Sign in with your personal SoundCloud account (OAuth 2.1 + PKCE) to browse your Likes & Sets, or switch to 🔥 Trending & Mixes.'}
                      </div>
                    )}
                  </>
                )}

                {/* ---------------------------------------------------------
                    7. ⚡ SOUNDCLOUD STREAM & RADIO HUB (Following Stream + Listening History + Track Radio)
                   --------------------------------------------------------- */}
                {browserSourceFilter === 'soundcloud' && soundCloudSubTab === 'stream_radio' && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingBottom: 10,
                        borderBottom: '1px solid #16161c',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 800,
                            color: '#fed7aa',
                            marginRight: 6,
                          }}
                        >
                          ⚡ Stream & Radio
                        </span>
                        {(
                          [
                            { id: 'all', label: 'All' },
                            {
                              id: 'history',
                              label: `🕒 Listening History (${
                                recentlyPlayed.filter((t) => t.source === 'soundcloud').length
                              })`,
                            },
                            { id: 'stream', label: `⚡ Following Stream (${scStreamTracks.length})` },
                            { id: 'sets', label: `🎶 Reposted Sets (${scStreamPlaylists.length})` },
                          ] as const
                        ).map((f) => {
                          const active = scStreamFilter === f.id;
                          return (
                            <button
                              key={f.id}
                              data-right-filter-pill="true"
                              onClick={() => setScStreamFilter(f.id)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 6,
                                background: active ? '#2c140a' : '#101018',
                                border: active ? '1px solid #ff5500' : '1px solid #222230',
                                color: active ? '#fed7aa' : '#9ca3af',
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              {f.label}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {(scStreamTracks.length > 0 || scLikedTracks.length > 0) && (
                          <button
                            data-right-filter-pill="true"
                            onClick={() => {
                              const seed = scStreamTracks[0] || scLikedTracks[0];
                              if (seed) handleStartSoundCloudTrackRadio(seed);
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              background: '#2c140a',
                              border: '1px solid #ff5500',
                              color: '#fed7aa',
                              fontSize: 11,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            📻 Start Station
                          </button>
                        )}
                        <button
                          data-right-filter-pill="true"
                          onClick={() => {
                            setCloudLoading(true);
                            fetchSoundCloudStreamAndRadio()
                              .then((res) => {
                                setScStreamTracks(res.streamTracks);
                                setScStreamPlaylists(res.streamPlaylists);
                              })
                              .catch(() => {})
                              .finally(() => setCloudLoading(false));
                          }}
                          style={{
                            padding: '4px 9px',
                            borderRadius: 6,
                            background: '#161620',
                            border: '1px solid #2a2a38',
                            color: '#fdba74',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ↻ Refresh
                        </button>
                      </div>
                    </div>

                    {(scStreamFilter === 'all' || scStreamFilter === 'history') &&
                      recentlyPlayed.some((t) => t.source === 'soundcloud') && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🕒 LISTENING HISTORY IN SIMP (
                            {recentlyPlayed.filter((t) => t.source === 'soundcloud').length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {recentlyPlayed
                              .filter((t) => t.source === 'soundcloud')
                              .map((s) =>
                                renderSingleSongRow(
                                  s,
                                  recentlyPlayed.filter((t) => t.source === 'soundcloud'),
                                  'sc_history'
                                )
                              )}
                          </div>
                        </>
                      )}

                    {(scStreamFilter === 'all' || scStreamFilter === 'sets') &&
                      scStreamPlaylists.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🎶 SETS FROM ARTISTS YOU FOLLOW ({scStreamPlaylists.length})
                          </div>
                          <div style={tileGridStyle}>
                            {scStreamPlaylists.map(renderSoundCloudPlaylistCard)}
                          </div>
                        </>
                      )}

                    {(scStreamFilter === 'all' || scStreamFilter === 'stream') &&
                      scStreamTracks.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            ⚡ FOLLOWING STREAM — UPLOADS & REPOSTS FROM ARTISTS YOU FOLLOW (
                            {scStreamTracks.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scStreamTracks.map((s) =>
                              renderSingleSongRow(s, scStreamTracks, 'sc_stream')
                            )}
                          </div>
                        </>
                      )}

                    {scStreamPlaylists.length === 0 && scStreamTracks.length === 0 && !cloudLoading && (
                      <div style={{ fontSize: 12, color: '#8e8e99', padding: '12px 4px' }}>
                        {snap?.soundcloud_authenticated
                          ? 'Your chronological SoundCloud activity stream is empty.'
                          : 'Sign in with your personal SoundCloud account to view your chronological /me/activities/all/own feed.'}
                      </div>
                    )}
                  </>
                )}

                {/* ---------------------------------------------------------
                    8. 🔥 SOUNDCLOUD TRENDING & MIXES HUB (Genres + 20m+ DJ Mixes + Featured Sets)
                   --------------------------------------------------------- */}
                {browserSourceFilter === 'soundcloud' && soundCloudSubTab === 'trending' && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        paddingBottom: 10,
                        borderBottom: '1px solid #16161c',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 800,
                              color: '#fed7aa',
                              marginRight: 6,
                            }}
                          >
                            🔥 Trending & Mixes
                          </span>
                          {(
                            [
                              { id: 'all' as const, label: 'All' },
                              ...(scMoreOfWhatYouLike.length > 0
                                ? [
                                    {
                                      id: 'for_you' as const,
                                      label: `💡 For You (${scMoreOfWhatYouLike.length})`,
                                    },
                                  ]
                                : []),
                              ...(scFreshUploads.length > 0
                                ? [
                                    {
                                      id: 'fresh' as const,
                                      label: `🆕 Fresh (${scFreshUploads.length})`,
                                    },
                                  ]
                                : []),
                              ...(scRecommendedArtists.length > 0
                                ? [
                                    {
                                      id: 'artists' as const,
                                      label: `👥 Artists (${scRecommendedArtists.length})`,
                                    },
                                  ]
                                : []),
                              { id: 'mixes' as const, label: `🎧 20m+ DJ Mixes (${scTrendingMixes.length})` },
                              { id: 'sets' as const, label: `🎶 Featured Sets (${scTrendingPlaylists.length})` },
                              { id: 'tracks' as const, label: `🔥 Trending Tracks (${scTrendingTracks.length})` },
                            ]
                          ).map((f) => {
                            const active = scTrendingFilter === f.id;
                            return (
                              <button
                                key={f.id}
                                data-right-filter-pill="true"
                                onClick={() => setScTrendingFilter(f.id)}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 6,
                                  background: active ? '#2c140a' : '#101018',
                                  border: active ? '1px solid #ff5500' : '1px solid #222230',
                                  color: active ? '#fed7aa' : '#9ca3af',
                                  fontSize: 11,
                                  fontWeight: 800,
                                  cursor: 'pointer',
                                }}
                              >
                                {f.label}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          data-right-filter-pill="true"
                          onClick={() => {
                            setCloudLoading(true);
                            fetchSoundCloudDiscover(scSelectedGenre || undefined)
                              .then((res) => {
                                setScTrendingTracks(res.tracks);
                                setScTrendingMixes(res.mixes);
                                setScTrendingPlaylists(res.playlists);
                                setScDiscoverNextHref?.(res.next_tracks_href || null);
                              })
                              .catch(() => {})
                              .finally(() => setCloudLoading(false));
                          }}
                          style={{
                            padding: '4px 9px',
                            borderRadius: 6,
                            background: '#161620',
                            border: '1px solid #2a2a38',
                            color: '#fdba74',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          ↻ Refresh
                        </button>
                      </div>

                      {/* Genre & Vibe Pills */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#9ca3af' }}>
                          VIBE:
                        </span>
                        {[
                          { id: '', label: '🌐 All Vibes' },
                          { id: 'Electronic', label: '⚡ Electronic' },
                          { id: 'House', label: '🪩 House' },
                          { id: 'Techno', label: '🎛️ Techno' },
                          { id: 'Drum & Bass', label: '🥁 Drum & Bass' },
                          { id: 'Hip-hop & Rap', label: '🎤 Hip-Hop' },
                          { id: 'Ambient', label: '🌌 Ambient' },
                          { id: 'Synthwave', label: '🌆 Synthwave' },
                          { id: 'Indie', label: '🎸 Indie' },
                        ].map((g) => {
                          const active = scSelectedGenre === g.id;
                          return (
                            <button
                              key={g.id || 'all'}
                              data-right-filter-pill="true"
                              onClick={() => {
                                setScSelectedGenre(g.id);
                                setCloudLoading(true);
                                fetchSoundCloudDiscover(g.id || undefined)
                                  .then((res) => {
                                    setScTrendingTracks(res.tracks);
                                    setScTrendingMixes(res.mixes);
                                    setScTrendingPlaylists(res.playlists);
                                    setScDiscoverNextHref?.(res.next_tracks_href || null);
                                  })
                                  .catch(() => {})
                                  .finally(() => setCloudLoading(false));
                              }}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 999,
                                background: active ? '#3c1c0f' : '#12121a',
                                border: active ? '1px solid #ff5500' : '1px solid #232332',
                                color: active ? '#fed7aa' : '#a1a1aa',
                                fontSize: 10,
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {g.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {(scTrendingFilter === 'all' || scTrendingFilter === 'for_you') &&
                      scMoreOfWhatYouLike.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            💡 MORE OF WHAT YOU LIKE — BASED ON YOUR HISTORY & LIKES (
                            {scMoreOfWhatYouLike.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scMoreOfWhatYouLike.map((s) =>
                              renderSingleSongRow(s, scMoreOfWhatYouLike, 'sc_for_you')
                            )}
                          </div>
                        </>
                      )}

                    {(scTrendingFilter === 'all' || scTrendingFilter === 'artists') &&
                      scRecommendedArtists.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            👥 ARTISTS & CREATORS TO CHECK OUT ({scRecommendedArtists.length})
                          </div>
                          <div style={tileGridStyle}>
                            {scRecommendedArtists.map(renderSoundCloudUserCard)}
                          </div>
                        </>
                      )}

                    {(scTrendingFilter === 'all' || scTrendingFilter === 'fresh') &&
                      scFreshUploads.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🆕 FRESH UPLOADS FROM CREATORS ({scFreshUploads.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scFreshUploads.map((s) =>
                              renderSingleSongRow(s, scFreshUploads, 'sc_fresh')
                            )}
                          </div>
                        </>
                      )}

                    {(scTrendingFilter === 'all' || scTrendingFilter === 'sets') &&
                      scTrendingPlaylists.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🎶 FEATURED SOUNDCLOUD SETS ({scTrendingPlaylists.length})
                          </div>
                          <div style={tileGridStyle}>
                            {scTrendingPlaylists.map(renderSoundCloudPlaylistCard)}
                          </div>
                        </>
                      )}

                    {(scTrendingFilter === 'all' || scTrendingFilter === 'mixes') &&
                      scTrendingMixes.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🎧 LONG-FORM DJ MIXES & SETS (20m+) ({scTrendingMixes.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scTrendingMixes.map((s) =>
                              renderSingleSongRow(s, scTrendingMixes, 'sc_mixes')
                            )}
                          </div>
                        </>
                      )}

                    {(scTrendingFilter === 'all' || scTrendingFilter === 'tracks') &&
                      scTrendingTracks.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#fdba74' }}>
                            🔥 TRENDING TRACKS ({scTrendingTracks.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {scTrendingTracks.map((s) =>
                              renderSingleSongRow(s, scTrendingTracks, 'sc_trending')
                            )}
                            {scDiscoverNextHref && (
                              <button
                                data-right-tile="true"
                                onClick={loadMoreScDiscover}
                                disabled={scLoadingMore}
                                style={{
                                  minHeight: 40,
                                  padding: '8px 16px',
                                  borderRadius: 10,
                                  background: '#2c140a',
                                  border: '1px solid #ea580c',
                                  color: '#fed7aa',
                                  fontSize: 12,
                                  fontWeight: 800,
                                  cursor: scLoadingMore ? 'default' : 'pointer',
                                  alignSelf: 'center',
                                  marginTop: 4,
                                }}
                              >
                                {scLoadingMore
                                  ? '⏳ Loading more SoundCloud tracks...'
                                  : '⬇ Load More SoundCloud Tracks'}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                  </>
                )}
    </>
  );
};
