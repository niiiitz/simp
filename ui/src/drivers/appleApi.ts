import {
  AlbumRecord,
  defaultSimpClient,
  PlaylistRecord,
  TrackMetadata,
} from '@simp/client';

declare global {
  interface Window {
    MusicKit?: any;
  }
}

export interface AppleCloudPlaylistSummary {
  id: string;
  name: string;
  description: string;
  art_url: string | null;
  kind: 'library' | 'catalog';
}

export interface AppleCloudAlbumSummary {
  id: string;
  title: string;
  artist: string;
  art_url: string | null;
  track_count: number;
  release_year: number | null;
  kind: 'catalog' | 'library';
}

export interface AppleRadioStationSummary {
  id: string;
  name: string;
  subtitle: string;
  art_url: string | null;
}

export interface AppleCatalogSearchResults {
  songs: TrackMetadata[];
  albums: AppleCloudAlbumSummary[];
  playlists: AppleCloudPlaylistSummary[];
  stations: AppleRadioStationSummary[];
}

let musicKitLoadPromise: Promise<any> | null = null;
let configuredToken: string | null = null;
let cachedStorefront: string | null = null;

export function formatAppleArtUrl(rawUrl?: string | null, size = 400): string | null {
  if (!rawUrl) return null;
  return rawUrl
    .replace('{w}', String(size))
    .replace('{h}', String(size))
    .replace('{f}', 'jpg');
}

export function mapAppleItemToTrack(item: any): TrackMetadata | null {
  if (!item) return null;
  const attrs = item.attributes || item;
  const playParams = attrs.playParams || item.playParams || {};
  const relCatalogId = item.relationships?.catalog?.data?.[0]?.id;
  const trackId = relCatalogId || playParams.catalogId || playParams.id || item.id || attrs.id;
  if (!trackId) return null;

  const title = attrs.name || attrs.title || item.title || 'Unknown Track';
  const artistName = attrs.artistName || item.artistName || 'Unknown Artist';
  const albumName = attrs.albumName || item.albumName || 'Apple Music';
  const durationMs = Math.round(
    Number(attrs.durationInMillis || item.durationInMillis || item.playbackDuration || 0)
  );
  const relCatalogArt = item.relationships?.catalog?.data?.[0]?.attributes?.artwork?.url;
  const attrArt = attrs.artwork?.url || item.artwork?.url || item.artworkURL || null;
  const rawArt =
    attrArt && String(attrArt).includes('blobstore.apple.com') && relCatalogArt
      ? relCatalogArt
      : attrArt || relCatalogArt || null;
  const artUrl = formatAppleArtUrl(rawArt, 400);

  return {
    uri: `applemusic:song:${trackId}`,
    title,
    artists: [artistName],
    album: albumName,
    album_id: null,
    track_number: attrs.trackNumber ? Number(attrs.trackNumber) : null,
    disc_number: attrs.discNumber ? Number(attrs.discNumber) : 1,
    art_url: artUrl,
    duration_ms: durationMs,
    source: 'apple_music',
    mount_root: null,
  };
}

export async function checkWidevineDrm(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.requestMediaKeySystemAccess) {
    return false;
  }
  const configs: MediaKeySystemConfiguration[] = [
    {
      initDataTypes: ['cenc'],
      audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
    },
  ];
  for (const ks of ['com.widevine.alpha', 'com.apple.fps.1_0', 'com.apple.fps']) {
    try {
      await navigator.requestMediaKeySystemAccess(ks, configs);
      return true;
    } catch {
      // Try next key system
    }
  }
  return false;
}

export async function ensureMusicKitConfigured(
  developerToken: string,
  musicUserToken?: string | null
): Promise<any> {
  if (!window.MusicKit) {
    if (!musicKitLoadPromise) {
      musicKitLoadPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(
          'script[data-simp-musickit="true"]'
        ) as HTMLScriptElement | null;
        if (existing && window.MusicKit) {
          resolve(window.MusicKit);
          return;
        }
        const onLoaded = () => {
          document.removeEventListener('musickitloaded', onLoaded);
          if (window.MusicKit) {
            resolve(window.MusicKit);
          } else {
            reject(new Error('MusicKit loaded event fired without window.MusicKit'));
          }
        };
        document.addEventListener('musickitloaded', onLoaded);

        if (!existing) {
          const script = document.createElement('script');
          script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
          script.async = true;
          script.dataset.simpMusickit = 'true';
          script.onerror = () => {
            musicKitLoadPromise = null;
            reject(new Error('Failed to load MusicKit JS from Apple CDN'));
          };
          document.head.appendChild(script);
        }
      });
    }
    await musicKitLoadPromise;
  }

  const MK = window.MusicKit;
  if (configuredToken !== developerToken) {
    await MK.configure({
      developerToken,
      app: {
        name: 'SIMP Media Player',
        build: '0.1.0-alpha',
      },
    });
    configuredToken = developerToken;
  }
  const instance = MK.getInstance();
  const effectiveToken = musicUserToken || instance.musicUserToken;
  if (effectiveToken && instance.musicUserToken !== effectiveToken) {
    try {
      if (instance.storekit && !instance.isAuthorized) {
        instance.storekit._authorizationStatus = 0;
      }
      instance.musicUserToken = effectiveToken;
      if (instance.storekit?.userTokenIsValid && !instance.isAuthorized) {
        await instance.authorize().catch(() => {});
      }
    } catch {
      // Ignore if read-only in a future MusicKit build
    }
  }
  return instance;
}

export async function getAppleAuthHeaders(): Promise<{
  headers: Record<string, string>;
  storefront: string;
}> {
  const cfg = await defaultSimpClient.getAppleMusicAuthConfig();
  if (!cfg.developer_token) {
    throw new Error(cfg.status_error || 'Missing Apple Developer Token');
  }
  const userToken =
    cfg.music_user_token ||
    (typeof window !== 'undefined' && window.MusicKit
      ? window.MusicKit.getInstance?.()?.musicUserToken
      : null);
  if (!userToken) {
    throw new Error('Please authorize with your Apple ID first');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.developer_token}`,
    'Music-User-Token': userToken,
  };

  if (!cachedStorefront) {
    try {
      const sfResp = await fetch('https://api.music.apple.com/v1/me/storefront', { headers });
      if (sfResp.ok) {
        const sfJson = await sfResp.json();
        cachedStorefront = sfJson?.data?.[0]?.id || 'us';
      }
    } catch {
      cachedStorefront = 'us';
    }
  }

  return { headers, storefront: cachedStorefront || 'us' };
}

export async function authorizeAppleMusic(
  onToast?: (msg: string) => void
): Promise<boolean> {
  const cfg = await defaultSimpClient.getAppleMusicAuthConfig();
  if (!cfg.configured || !cfg.developer_token) {
    throw new Error(
      cfg.status_error ||
        'Apple Developer credentials not configured yet (Team ID, Key ID, and .p8 key required)'
    );
  }

  onToast?.('Loading Apple MusicKit v3...');
  const mk = await ensureMusicKitConfigured(cfg.developer_token);
  onToast?.('Opening Apple ID authorization...');
  const userToken: string = await mk.authorize();
  if (!userToken) {
    throw new Error('Apple Music authorization was cancelled');
  }

  defaultSimpClient.setAppleMusicUserToken(userToken);
  defaultSimpClient.reportAppleWorkerEvent('authorized', 0, null, null);
  onToast?.('Apple Music connected! Browse Cloud Playlists, Radio, or Search to Pin to SIMP.');
  return true;
}

/**
 * Clean-slate Apple Music deauthorization: revokes the browser's MusicKit session (`mk.unauthorize()`),
 * purges cached MusicKit/Apple keys from `localStorage`/`sessionStorage`, and instructs `simp --daemon`
 * to clear `settings.vdf` and wipe all headless worker auth stores.
 */
export async function disconnectAppleMusicCleanSlate(
  onToast?: (msg: string) => void
): Promise<void> {
  try {
    const mk = window.MusicKit?.getInstance?.();
    if (mk) {
      await mk.stop?.().catch(() => {});
      await mk.unauthorize?.().catch(() => {});
    }
  } catch {
    // ignore
  }
  try {
    for (const store of [window.localStorage, window.sessionStorage]) {
      if (!store) continue;
      const toRemove: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && /musickit|music\.apple|apple_music|amp-/i.test(k)) {
          toRemove.push(k);
        }
      }
      for (const k of toRemove) store.removeItem(k);
    }
  } catch {
    // ignore
  }
  defaultSimpClient.disconnectAppleMusic();
  onToast?.('Disconnected Apple Music & wiped cached auth tokens');
}

async function fetchAppleDaemonJson<T>(endpoint: string): Promise<T> {
  const r = await fetch(`http://127.0.0.1:18888${endpoint}`);
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!r.ok || !j.ok) {
    throw new Error(j.error || `Apple Music daemon request failed (${endpoint})`);
  }
  return j.data as T;
}

/**
 * Fetches the user's Cloud Playlists via the native Rust daemon (`/api/apple/playlists`).
 */
export async function fetchAppleCloudPlaylists(): Promise<AppleCloudPlaylistSummary[]> {
  return fetchAppleDaemonJson<AppleCloudPlaylistSummary[]>('/api/apple/playlists');
}

/**
 * Fetches the full tracklist for a specific Apple Music Playlist via the native Rust daemon (`/api/apple/playlist-tracks`).
 */
export async function fetchApplePlaylistTracks(
  playlistId: string,
  kind: 'library' | 'catalog' = playlistId.startsWith('pl.') ? 'catalog' : 'library'
): Promise<TrackMetadata[]> {
  return fetchAppleDaemonJson<TrackMetadata[]>(
    `/api/apple/playlist-tracks?id=${encodeURIComponent(playlistId)}&kind=${encodeURIComponent(kind)}`
  );
}

/**
 * Pins a chosen Apple Music playlist into SIMP's local SQLite `PLAYLISTS` table (`origin = 'apple_remote'`).
 */
export async function pinApplePlaylistToSimp(
  pl: AppleCloudPlaylistSummary,
  preloadedTracks?: TrackMetadata[],
  onToast?: (msg: string) => void
): Promise<PlaylistRecord> {
  const tracks = preloadedTracks || (await fetchApplePlaylistTracks(pl.id, pl.kind));
  if (tracks.length === 0) {
    throw new Error('Playlist has no playable tracks');
  }
  const record: PlaylistRecord = {
    id: `applemusic:playlist:${pl.id.replace(/^applemusic:playlist:/, '')}`,
    name: pl.name.replace(/^[\s🍎📌]+/u, '').trim() || pl.name,
    description: pl.description || 'Pinned Apple Music Playlist',
    origin: 'apple_remote',
    cover_art_url: pl.art_url || tracks[0]?.art_url || null,
    track_count: tracks.length,
    updated_at: Math.floor(Date.now() / 1000),
  };
  defaultSimpClient.importCatalogTracks({
    source: 'apple_music',
    playlist: record,
    tracks,
  });
  onToast?.(`Pinned "${pl.name}" (${tracks.length} tracks) to SIMP!`);
  return record;
}

/**
 * Resolves the FULL Master Catalog Album via the native Rust daemon (`/api/apple/full-album`).
 */
export async function fetchFullAppleAlbum(params: {
  albumId?: string | null;
  songUri?: string | null;
}): Promise<{ album: AppleCloudAlbumSummary; tracks: TrackMetadata[] }> {
  const qs = new URLSearchParams();
  if (params.albumId) qs.set('album_id', params.albumId);
  if (params.songUri) qs.set('song_uri', params.songUri);
  return fetchAppleDaemonJson<{ album: AppleCloudAlbumSummary; tracks: TrackMetadata[] }>(
    `/api/apple/full-album?${qs.toString()}`
  );
}

/**
 * Pins a full Apple Music Catalog Album into SIMP's local SQLite `ALBUMS & SOUNDTRACKS` list.
 */
export async function pinAppleAlbumToSimp(
  album: AppleCloudAlbumSummary,
  tracks: TrackMetadata[],
  onToast?: (msg: string) => void
): Promise<AlbumRecord> {
  const albId = `applemusic:album:${album.id.replace(/^applemusic:album:/, '')}`;
  const record: AlbumRecord = {
    id: albId,
    title: album.title.replace(/^[\s🍎📌💿]+/u, '').trim() || album.title,
    album_artist: album.artist,
    release_year: album.release_year,
    steam_app_id: null,
    art_url: album.art_url,
    track_count: tracks.length,
  };
  defaultSimpClient.importCatalogTracks({
    source: 'apple_music',
    album: record,
    tracks: tracks.map((t) => ({ ...t, album_id: albId })),
  });
  onToast?.(`Pinned full album "${album.title}" (${tracks.length} tracks) to SIMP!`);
  return record;
}

/**
 * Fetches the user's Apple Music Radio Stations, Personal Mixes, and Heavy Rotation via the Rust daemon.
 */
export async function fetchAppleRadioAndForYou(): Promise<{
  stations: AppleRadioStationSummary[];
  playlists: AppleCloudPlaylistSummary[];
  albums: AppleCloudAlbumSummary[];
}> {
  return fetchAppleDaemonJson<{
    stations: AppleRadioStationSummary[];
    playlists: AppleCloudPlaylistSummary[];
    albums: AppleCloudAlbumSummary[];
  }>('/api/apple/radio');
}

/**
 * Fetches Apple Music "New" / Top Charts & Hot New Releases via the Rust daemon.
 */
export async function fetchAppleNewFeed(): Promise<{
  albums: AppleCloudAlbumSummary[];
  playlists: AppleCloudPlaylistSummary[];
  songs: TrackMetadata[];
}> {
  return fetchAppleDaemonJson<{
    albums: AppleCloudAlbumSummary[];
    playlists: AppleCloudPlaylistSummary[];
    songs: TrackMetadata[];
  }>('/api/apple/new');
}

/**
 * Live Apple Music Catalog Search (Songs, Full Albums, Playlists, and Radio Stations) via the Rust daemon.
 */
export async function searchAppleMusicCatalog(
  term: string
): Promise<AppleCatalogSearchResults> {
  const cleaned = term.trim();
  if (!cleaned) {
    return { songs: [], albums: [], playlists: [], stations: [] };
  }
  return fetchAppleDaemonJson<AppleCatalogSearchResults>(
    `/api/apple/search?term=${encodeURIComponent(cleaned)}`
  );
}

/**
 * Refresh any already-pinned `apple_remote` playlists in SIMP (opt-in only; never dumps unpinned playlists).
 */
export async function syncAppleMusicCatalog(
  onToast?: (msg: string) => void
): Promise<{ playlists: number; tracks: number }> {
  const existing = await defaultSimpClient.query<PlaylistRecord[]>('get_playlists').catch(() => []);
  const pinnedApple = existing.filter((p) => p.origin === 'apple_remote');
  let syncedTracks = 0;

  for (const pl of pinnedApple) {
    const rawId = pl.id.replace(/^applemusic:playlist:/, '');
    const tracks = await fetchApplePlaylistTracks(rawId).catch(() => []);
    if (tracks.length > 0) {
      defaultSimpClient.importCatalogTracks({
        source: 'apple_music',
        playlist: { ...pl, track_count: tracks.length },
        tracks,
      });
      syncedTracks += tracks.length;
    }
  }

  onToast?.(
    pinnedApple.length > 0
      ? `Refreshed ${pinnedApple.length} pinned Apple Music playlists (${syncedTracks} tracks)`
      : 'Connected! Use the 🍎 Apple Music tab to browse & Pin Playlists, Full Albums, or Radio.'
  );
  return { playlists: pinnedApple.length, tracks: syncedTracks };
}

/**
 * Resolves a re-linked or tombstoned playlist track ID (`i.xxxx` library song ID or stale catalog ID)
 * to its active storefront catalog song ID via the Rust daemon (`/api/apple/resolve-track`).
 */
export async function resolveReplacementCatalogSongId(rawId: string): Promise<string | null> {
  const snap = defaultSimpClient.getState();
  const cur = snap?.current_track;
  try {
    const qs = new URLSearchParams({ id: rawId });
    if (cur?.title) qs.set('title', cur.title);
    if (cur?.artists?.[0]) qs.set('artist', cur.artists[0]);
    const r = await fetch(`http://127.0.0.1:18888/api/apple/resolve-track?${qs.toString()}`);
    if (r.ok) {
      const j = await r.json();
      if (j.ok && j.catalog_id) {
        return String(j.catalog_id);
      }
    }
  } catch {
    // ignore
  }
  return null;
}
