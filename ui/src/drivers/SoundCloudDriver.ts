import {
  defaultSimpClient,
  PlaylistRecord,
  SoundCloudComment,
  TrackMetadata,
} from '@simp/client';

export type { SoundCloudComment };

export interface SoundCloudPlaylistSummary {
  id: string;
  name: string;
  description: string;
  creator: string;
  art_url: string | null;
  track_count: number;
  duration_ms: number;
  kind: 'likes' | 'user_set' | 'liked_set' | 'catalog_set' | string;
  permalink_url?: string | null;
  tracks?: TrackMetadata[];
  gated_track_count?: number;
}

export interface SoundCloudStationSummary {
  id: string;
  name: string;
  subtitle: string;
  seed_track_id: string;
  art_url: string | null;
}

export interface SoundCloudPlaylistsResponse {
  playlists: SoundCloudPlaylistSummary[];
  liked_tracks_preview: TrackMetadata[];
}

export interface SoundCloudStreamResponse {
  stream_tracks: TrackMetadata[];
  stream_playlists?: SoundCloudPlaylistSummary[];
  stations: SoundCloudStationSummary[];
}

export interface SoundCloudMixChapter {
  label: string;
  timestamp_ms: number;
}

export interface SoundCloudUserSummary {
  id: string;
  urn: string;
  username: string;
  avatar_url: string | null;
  track_count: number;
  followers_count: number;
  description: string;
  permalink_url?: string | null;
}

export interface SoundCloudUserProfileResponse {
  user: SoundCloudUserSummary | null;
  tracks: TrackMetadata[];
  playlists: SoundCloudPlaylistSummary[];
  liked_tracks?: TrackMetadata[];
  followings?: SoundCloudUserSummary[];
  next_tracks_href?: string | null;
  gated_track_count?: number;
  gated_playlist_count?: number;
}

export interface SoundCloudDiscoverResponse {
  tracks: TrackMetadata[];
  mixes: TrackMetadata[];
  playlists: SoundCloudPlaylistSummary[];
  more_of_what_you_like?: TrackMetadata[];
  fresh_uploads?: TrackMetadata[];
  recommended_artists?: SoundCloudUserSummary[];
  next_tracks_href?: string | null;
}

export interface SoundCloudSearchResults {
  tracks: TrackMetadata[];
  mixes: TrackMetadata[];
  playlists: SoundCloudPlaylistSummary[];
  stations: SoundCloudStationSummary[];
  users?: SoundCloudUserSummary[];
  next_tracks_href?: string | null;
}

export interface SoundCloudCatalogSearchResults {
  songs: TrackMetadata[];
  playlists: SoundCloudPlaylistSummary[];
  users?: SoundCloudUserSummary[];
  next_tracks_href?: string | null;
}

export interface SoundCloudPaginateResponse {
  tracks: TrackMetadata[];
  next_href: string | null;
}

export interface SoundCloudWaveform {
  track_id: string;
  bars: number[];
  waveform_url?: string | null;
  permalink_url?: string | null;
  bpm?: number | null;
  favoritings_count?: number | null;
  playback_count?: number | null;
  user_id?: string | null;
  chapters?: SoundCloudMixChapter[];
}

export const SOUNDCLOUD_GENRE_PILLS: Array<{ id: string; label: string; icon: string }> = [
  { id: 'all', label: 'All Vibes', icon: '🔥' },
  { id: 'electronic', label: 'Electronic', icon: '⚡' },
  { id: 'synthwave', label: 'Synthwave', icon: '🌆' },
  { id: 'lo-fi', label: 'Lo-Fi & Chill', icon: '☕' },
  { id: 'hip-hop & rap', label: 'Hip-Hop', icon: '🎤' },
  { id: 'drum & bass', label: 'Drum & Bass', icon: '🥁' },
  { id: 'techno', label: 'Techno & House', icon: '🎛️' },
  { id: 'ambient', label: 'Ambient & OST', icon: '🌌' },
];

function resolveDaemonHttpBase(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const host = window.location.hostname;
    if (
      window.location.protocol === 'http:' &&
      host !== 'steamloopback.host' &&
      host !== '127.0.0.1' &&
      host !== 'localhost'
    ) {
      const port = window.location.port === '1420' ? '18888' : window.location.port || '18888';
      return `http://${host}:${port}`;
    }
  }
  return 'http://127.0.0.1:18888';
}

async function fetchSoundCloudDaemonJson<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const base = resolveDaemonHttpBase();
  const r = await fetch(`${base}${endpoint}`, options);
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!r.ok || !j.ok) {
    throw new Error(j.error || `SoundCloud daemon request failed (${endpoint})`);
  }
  return (j.data !== undefined ? j.data : j) as T;
}

export function cleanSoundCloudTrackId(uriOrId: string): string {
  return uriOrId
    .replace(/^soundcloud:station:track:/, '')
    .replace(/^soundcloud:tracks?:/, '')
    .replace(/^soundcloud:playlists?:/, '')
    .replace(/^soundcloud:/, '')
    .trim();
}

/**
 * Opens the canonical `https://soundcloud.com/...` `permalink_url` for a SoundCloud track,
 * playlist/set, or creator in the system browser per SoundCloud Attribution Guidelines.
 */
export function openSoundCloudPermalink(opts: {
  permalinkUrl?: string | null;
  kind?: 'track' | 'playlist' | 'user';
  id?: string | null;
}): void {
  if (typeof window === 'undefined') return;
  const direct = opts.permalinkUrl?.trim();
  if (direct && (direct.startsWith('https://soundcloud.com') || direct.startsWith('http://soundcloud.com'))) {
    window.open(direct, '_blank', 'noopener,noreferrer');
    return;
  }
  const cleanId = opts.id ? cleanSoundCloudTrackId(opts.id) : '';
  if (cleanId) {
    const base = resolveDaemonHttpBase();
    const kind = opts.kind || 'track';
    const redirectEndpoint = `${base}/api/soundcloud/open?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(cleanId)}`;
    window.open(redirectEndpoint, '_blank', 'noopener,noreferrer');
    return;
  }
  window.open('https://soundcloud.com', '_blank', 'noopener,noreferrer');
}

/**
 * Initiates the SoundCloud OAuth 2.1 Authorization Code + PKCE (`S256`) login flow.
 */
export async function authorizeSoundCloudOAuth(
  onToast?: (msg: string) => void
): Promise<boolean> {
  const base = resolveDaemonHttpBase();
  const startResp = await fetch(`${base}/api/soundcloud/auth/start?json=1`);
  const startJson = await startResp.json().catch(() => ({ ok: false }));
  if (!startResp.ok || !startJson.ok || !startJson.authorize_url) {
    throw new Error(
      startJson.error ||
        'Configure SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET in .env or Sources first'
    );
  }

  onToast?.('Opening SoundCloud OAuth 2.1 login...');
  const popup = window.open(
    startJson.authorize_url,
    `simp_soundcloud_oauth_${Date.now()}`,
    'width=540,height=700,menubar=no,toolbar=no,location=yes,status=no'
  );

  const isGenuineUserSession = (cfg: {
    soundcloud_authenticated?: boolean;
    auth_mode?: string;
    username?: string;
  } | null) =>
    Boolean(
      cfg?.soundcloud_authenticated &&
        cfg?.auth_mode === 'user' &&
        cfg?.username &&
        cfg.username !== 'Public Discovery (Client Credentials)'
    );

  // Poll daemon auth config until callback completes or popup closes
  const startedAt = Date.now();
  while (Date.now() - startedAt < 90_000) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const cfg = await defaultSimpClient.getSoundCloudAuthConfig();
      if (isGenuineUserSession(cfg)) {
        onToast?.(
          `☁️ SoundCloud connected${cfg.username ? ` as @${cfg.username}` : ''}!`
        );
        return true;
      }
    } catch {
      // Keep polling
    }
    if (popup && popup.closed) {
      break;
    }
  }

  const finalCfg = await defaultSimpClient.getSoundCloudAuthConfig().catch(() => null);
  if (isGenuineUserSession(finalCfg)) {
    onToast?.(
      `☁️ SoundCloud connected${finalCfg?.username ? ` as @${finalCfg.username}` : ''}!`
    );
    return true;
  }
  return false;
}

/**
 * Activates SoundCloud Public Discovery & Streaming (`client_credentials` grant) using
 * the configured `SOUNDCLOUD_CLIENT_ID` and `SOUNDCLOUD_CLIENT_SECRET`.
 */
export async function activateSoundCloudPublicMode(
  onToast?: (msg: string) => void
): Promise<boolean> {
  const base = resolveDaemonHttpBase();
  const r = await fetch(`${base}/api/soundcloud/client-auth`, { method: 'POST' });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!r.ok || !j.ok) {
    throw new Error(j.error || 'Failed to mint SoundCloud Client Credentials token');
  }
  onToast?.('☁️ SoundCloud Public Discovery & 160kbps AAC Streaming activated!');
  return true;
}

/**
 * Exchanges a manually pasted OAuth callback `code` (or full callback URL) on `/pair`.
 */
export async function submitSoundCloudCallbackCodeOrUrl(
  rawInput: string,
  onToast?: (msg: string) => void
): Promise<boolean> {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('Paste the callback URL or authorization code first');
  }
  let code = trimmed;
  let state = '';
  if (trimmed.includes('code=')) {
    try {
      const u = new URL(trimmed.startsWith('http') ? trimmed : `http://localhost/${trimmed}`);
      code = u.searchParams.get('code') || '';
      state = u.searchParams.get('state') || '';
    } catch {
      const m = trimmed.match(/[?&]code=([^&]+)/);
      if (m) code = decodeURIComponent(m[1]);
    }
  }
  if (!code) {
    throw new Error('Could not find `code=` parameter in the pasted URL');
  }

  const base = resolveDaemonHttpBase();
  const q = new URLSearchParams({ json: '1', code });
  if (state) q.set('state', state);
  const r = await fetch(`${base}/api/soundcloud/callback?${q.toString()}`);
  const j = await r.json().catch(() => ({ ok: false }));
  if (!r.ok || !j.ok) {
    throw new Error(j.error || 'SoundCloud code exchange failed');
  }
  onToast?.(`☁️ SoundCloud connected${j.username ? ` as @${j.username}` : ''}!`);
  return true;
}

export async function disconnectSoundCloudCleanSlate(
  onToast?: (msg: string) => void
): Promise<void> {
  defaultSimpClient.disconnectSoundCloud();
  onToast?.('Signed out of SoundCloud account (Public Discovery active)');
}

export const startSoundCloudOAuthLogin = authorizeSoundCloudOAuth;
export const enableSoundCloudPublicMode = activateSoundCloudPublicMode;

export async function fetchSoundCloudPlaylistsAndLikes(): Promise<SoundCloudPlaylistsResponse> {
  return fetchSoundCloudDaemonJson<SoundCloudPlaylistsResponse>('/api/soundcloud/playlists');
}

export async function fetchSoundCloudLikesAndPlaylists(): Promise<{
  likedTracks: TrackMetadata[];
  playlists: SoundCloudPlaylistSummary[];
}> {
  const res = await fetchSoundCloudPlaylistsAndLikes();
  return {
    likedTracks: res.liked_tracks_preview || [],
    playlists: res.playlists || [],
  };
}

export async function fetchSoundCloudPlaylistTracks(
  playlistId: string
): Promise<TrackMetadata[]> {
  const clean = cleanSoundCloudTrackId(playlistId);
  return fetchSoundCloudDaemonJson<TrackMetadata[]>(
    `/api/soundcloud/playlist-tracks?id=${encodeURIComponent(clean)}`
  );
}

export async function fetchSoundCloudStreamAndStations(): Promise<SoundCloudStreamResponse> {
  return fetchSoundCloudDaemonJson<SoundCloudStreamResponse>('/api/soundcloud/stream');
}

export async function fetchSoundCloudStreamAndRadio(): Promise<{
  streamTracks: TrackMetadata[];
  streamPlaylists: SoundCloudPlaylistSummary[];
  stations: SoundCloudStationSummary[];
}> {
  const res = await fetchSoundCloudStreamAndStations();
  return {
    streamTracks: res.stream_tracks || [],
    streamPlaylists: res.stream_playlists || [],
    stations: res.stations || [],
  };
}

export async function fetchSoundCloudFollowings(): Promise<SoundCloudUserSummary[]> {
  try {
    return await fetchSoundCloudDaemonJson<SoundCloudUserSummary[]>('/api/soundcloud/followings');
  } catch {
    return [];
  }
}

export async function fetchSoundCloudUserTracks(
  userId: string
): Promise<SoundCloudUserProfileResponse> {
  const clean = cleanSoundCloudTrackId(userId).replace(/^users:/, '');
  return fetchSoundCloudDaemonJson<SoundCloudUserProfileResponse>(
    `/api/soundcloud/user-tracks?id=${encodeURIComponent(clean)}`
  );
}

export async function toggleFollowSoundCloudUser(
  userId: string,
  follow = true,
  username?: string,
  onToast?: (msg: string) => void
): Promise<boolean> {
  const clean = cleanSoundCloudTrackId(userId).replace(/^users:/, '');
  if (!clean) return false;
  const base = resolveDaemonHttpBase();
  const r = await fetch(
    `${base}/api/soundcloud/follow?id=${encodeURIComponent(clean)}&follow=${follow ? '1' : '0'}`,
    { method: 'POST' }
  );
  const j = await r.json().catch(() => ({ ok: false }));
  if (!r.ok || !j.ok) {
    throw new Error(j.error || 'Sign in with your personal SoundCloud account to follow creators');
  }
  onToast?.(
    follow
      ? `👥 Following ${username ? `@${username}` : 'creator'} on SoundCloud!`
      : `Unfollowed ${username ? `@${username}` : 'creator'} on SoundCloud`
  );
  return true;
}

export async function setSoundCloudPlaylistLiked(
  playlistId: string,
  liked: boolean
): Promise<boolean> {
  const clean = cleanSoundCloudTrackId(playlistId);
  if (!clean || clean === 'likes') return false;
  try {
    const base = resolveDaemonHttpBase();
    const r = await fetch(
      `${base}/api/soundcloud/like-playlist?id=${encodeURIComponent(clean)}&liked=${
        liked ? '1' : '0'
      }`,
      { method: 'POST' }
    );
    const j = await r.json().catch(() => ({ ok: false }));
    return Boolean(r.ok && j.ok);
  } catch {
    return false;
  }
}

export async function unlikeSoundCloudTrack(
  trackUriOrId: string,
  onToast?: (msg: string) => void
): Promise<boolean> {
  const clean = cleanSoundCloudTrackId(trackUriOrId);
  if (!clean) return false;
  const base = resolveDaemonHttpBase();
  const r = await fetch(
    `${base}/api/soundcloud/like?id=${encodeURIComponent(clean)}&unlike=1`,
    { method: 'POST' }
  );
  const j = await r.json().catch(() => ({ ok: false }));
  if (!r.ok || !j.ok) {
    throw new Error(j.error || 'Could not remove track from SoundCloud Likes');
  }
  onToast?.('Removed from your SoundCloud Likes');
  return true;
}

export async function fetchSoundCloudDiscover(
  genre?: string,
  mixesOnly = false
): Promise<SoundCloudDiscoverResponse> {
  const q = new URLSearchParams();
  if (genre && genre !== 'all') q.set('genre', genre);
  if (mixesOnly) q.set('mixes_only', '1');
  const qs = q.toString();
  return fetchSoundCloudDaemonJson<SoundCloudDiscoverResponse>(
    `/api/soundcloud/discover${qs ? `?${qs}` : ''}`
  );
}

export async function fetchSoundCloudNextPage(
  nextHref: string
): Promise<SoundCloudPaginateResponse> {
  if (!nextHref || !nextHref.trim()) {
    return { tracks: [], next_href: null };
  }
  return fetchSoundCloudDaemonJson<SoundCloudPaginateResponse>(
    `/api/soundcloud/paginate?next_href=${encodeURIComponent(nextHref.trim())}`
  );
}

export async function searchSoundCloudCatalog(
  term: string
): Promise<SoundCloudCatalogSearchResults> {
  if (!term.trim()) {
    return { songs: [], playlists: [], users: [], next_tracks_href: null };
  }
  const res = await fetchSoundCloudDaemonJson<SoundCloudSearchResults>(
    `/api/soundcloud/search?term=${encodeURIComponent(term.trim())}`
  );
  const combinedSongs = [...(res.tracks || []), ...(res.mixes || [])];
  const seen = new Set<string>();
  const uniqueSongs = combinedSongs.filter((t) => {
    if (seen.has(t.uri)) return false;
    seen.add(t.uri);
    return true;
  });
  return {
    songs: uniqueSongs,
    playlists: res.playlists || [],
    users: res.users || [],
    next_tracks_href: res.next_tracks_href || null,
  };
}

export async function fetchSoundCloudTrackComments(
  trackUriOrId: string
): Promise<SoundCloudComment[]> {
  const clean = cleanSoundCloudTrackId(trackUriOrId);
  if (!clean) return [];
  try {
    return await fetchSoundCloudDaemonJson<SoundCloudComment[]>(
      `/api/soundcloud/comments?id=${encodeURIComponent(clean)}`
    );
  } catch {
    return [];
  }
}

export async function fetchSoundCloudTrackWaveform(
  trackUriOrId: string
): Promise<SoundCloudWaveform | null> {
  const clean = cleanSoundCloudTrackId(trackUriOrId);
  if (!clean) return null;
  try {
    return await fetchSoundCloudDaemonJson<SoundCloudWaveform>(
      `/api/soundcloud/waveform?id=${encodeURIComponent(clean)}`
    );
  } catch {
    return null;
  }
}

export async function likeSoundCloudTrack(
  trackUriOrId: string,
  onToast?: (msg: string) => void
): Promise<boolean> {
  const clean = cleanSoundCloudTrackId(trackUriOrId);
  if (!clean) return false;
  const base = resolveDaemonHttpBase();
  const r = await fetch(`${base}/api/soundcloud/like?id=${encodeURIComponent(clean)}`, {
    method: 'POST',
  });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!r.ok || !j.ok) {
    throw new Error(j.error || 'Sign in with a personal SoundCloud account to Like tracks');
  }
  onToast?.('❤️ Added to your SoundCloud Likes!');
  return true;
}

export async function pinSoundCloudPlaylistToSimp(
  playlist: SoundCloudPlaylistSummary,
  preloadedTracks?: TrackMetadata[],
  onToast?: (msg: string) => void
): Promise<number> {
  onToast?.(`Pinning "${playlist.name}" to SIMP...`);
  let tracks =
    preloadedTracks && preloadedTracks.length > 0
      ? preloadedTracks
      : await fetchSoundCloudPlaylistTracks(playlist.id).catch(() => []);

  if (tracks.length === 0 && playlist.tracks && playlist.tracks.length > 0) {
    tracks = playlist.tracks;
  }

  if (tracks.length === 0) {
    throw new Error(`No playable tracks found in "${playlist.name}"`);
  }

  const record: PlaylistRecord = {
    id: `soundcloud:playlist:${cleanSoundCloudTrackId(playlist.id)}`,
    name: playlist.name,
    description: playlist.description || `SoundCloud Set • ${playlist.creator}`,
    origin: 'soundcloud_remote',
    cover_art_url: playlist.art_url || tracks[0]?.art_url || null,
    track_count: tracks.length,
    updated_at: Math.floor(Date.now() / 1000),
    has_local: false,
    has_apple: false,
    has_soundcloud: true,
  };

  defaultSimpClient.importCatalogTracks({
    source: 'soundcloud',
    playlist: record,
    tracks,
  });

  // Also sync as a Liked Set on SoundCloud (`POST /likes/playlists/{id}`) if signed in
  setSoundCloudPlaylistLiked(playlist.id, true).catch(() => {});

  onToast?.(`📌 Pinned "${playlist.name}" (${tracks.length} tracks) to SIMP Library`);
  return tracks.length;
}

export function startSoundCloudTrackRadio(
  trackUriOrId: string,
  trackTitle?: string,
  onToast?: (msg: string) => void
): void {
  const clean = cleanSoundCloudTrackId(trackUriOrId);
  if (!clean) return;
  onToast?.(
    `📻 Starting SoundCloud Track Radio${trackTitle ? `: ${trackTitle}` : ''}...`
  );
  defaultSimpClient.loadUri(`soundcloud:station:track:${clean}`);
}
