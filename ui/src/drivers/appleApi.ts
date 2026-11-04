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
  // Prefer the live catalog relationship ID (from `?include=catalog`) first in case a library playlist
  // track's original `playParams.catalogId` was re-uploaded/re-linked by the distributor, then fall back
  // to `playParams.catalogId`, `playParams.id`, or `item.id`.
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

/**
 * Fetches the user's Cloud Playlists on-demand via the native Rust daemon (`/api/apple/playlists`),
 * falling back to direct browser fetch if needed.
 */
export async function fetchAppleCloudPlaylists(): Promise<AppleCloudPlaylistSummary[]> {
  try {
    const r = await fetch('http://127.0.0.1:18888/api/apple/playlists');
    if (r.ok) {
      const j = await r.json();
      if (j.ok && Array.isArray(j.data)) return j.data;
    }
  } catch {
    // Fallback to browser fetch
  }
  const { headers } = await getAppleAuthHeaders();
  let nextUrl: string | null = 'https://api.music.apple.com/v1/me/library/playlists?limit=100';
  const items: AppleCloudPlaylistSummary[] = [];

  for (let page = 0; page < 3 && nextUrl; page++) {
    const resp = await fetch(nextUrl, { headers });
    if (!resp.ok) break;
    const json = await resp.json();
    for (const pl of json.data || []) {
      const attrs = pl.attributes || {};
      items.push({
        id: pl.id,
        name: attrs.name || 'Apple Playlist',
        description: attrs.description?.standard || 'iCloud Music Library Playlist',
        art_url: formatAppleArtUrl(attrs.artwork?.url, 300),
        kind: pl.id.startsWith('pl.') ? 'catalog' : 'library',
      });
    }
    nextUrl = json.next ? `https://api.music.apple.com${json.next}` : null;
  }

  return items;
}

/**
 * Fetches the full tracklist for a specific Apple Music Playlist via the native Rust daemon (`/api/apple/playlist-tracks`).
 */
export async function fetchApplePlaylistTracks(
  playlistId: string,
  kind: 'library' | 'catalog' = playlistId.startsWith('pl.') ? 'catalog' : 'library'
): Promise<TrackMetadata[]> {
  try {
    const r = await fetch(
      `http://127.0.0.1:18888/api/apple/playlist-tracks?id=${encodeURIComponent(
        playlistId
      )}&kind=${encodeURIComponent(kind)}`
    );
    if (r.ok) {
      const j = await r.json();
      if (j.ok && Array.isArray(j.data)) return j.data;
    }
  } catch {
    // Fallback to browser fetch
  }
  const { headers, storefront } = await getAppleAuthHeaders();
  const cleanId = playlistId.replace(/^applemusic:playlist:/, '');
  let nextUrl: string | null =
    kind === 'catalog' || cleanId.startsWith('pl.')
      ? `https://api.music.apple.com/v1/catalog/${storefront}/playlists/${encodeURIComponent(
          cleanId
        )}/tracks?limit=100`
      : `https://api.music.apple.com/v1/me/library/playlists/${encodeURIComponent(
          cleanId
        )}/tracks?include=catalog&limit=100`;

  const tracks: TrackMetadata[] = [];
  for (let page = 0; page < 5 && nextUrl; page++) {
    const resp = await fetch(nextUrl, { headers });
    if (!resp.ok) break;
    const json = await resp.json();
    const mapped: TrackMetadata[] = (json.data || [])
      .map(mapAppleItemToTrack)
      .filter((t: TrackMetadata | null): t is TrackMetadata => t !== null);
    tracks.push(...mapped);
    nextUrl = json.next ? `https://api.music.apple.com${json.next}` : null;
  }
  return tracks;
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
    name: pl.name.startsWith('🍎') ? pl.name : `🍎 ${pl.name}`,
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
  try {
    const qs = new URLSearchParams();
    if (params.albumId) qs.set('album_id', params.albumId);
    if (params.songUri) qs.set('song_uri', params.songUri);
    const r = await fetch(`http://127.0.0.1:18888/api/apple/full-album?${qs.toString()}`);
    if (r.ok) {
      const j = await r.json();
      if (j.ok && j.data?.album && Array.isArray(j.data?.tracks)) {
        return j.data;
      }
    }
  } catch {
    // Fallback to browser fetch
  }
  const { headers, storefront } = await getAppleAuthHeaders();

  let catalogAlbumId: string | null = null;

  if (params.albumId) {
    const cleanAlb = params.albumId.replace(/^applemusic:album:/, '');
    if (cleanAlb.startsWith('l.')) {
      const catResp = await fetch(
        `https://api.music.apple.com/v1/me/library/albums/${encodeURIComponent(cleanAlb)}/catalog`,
        { headers }
      );
      if (catResp.ok) {
        const catJson = await catResp.json();
        catalogAlbumId = catJson?.data?.[0]?.id || null;
      }
    } else {
      catalogAlbumId = cleanAlb;
    }
  }

  if (!catalogAlbumId && params.songUri) {
    const rawSongId = params.songUri
      .replace(/^applemusic:(song|track):/, '')
      .replace(/^applemusic:/, '');

    if (rawSongId.startsWith('i.')) {
      const libSongResp = await fetch(
        `https://api.music.apple.com/v1/me/library/songs/${encodeURIComponent(
          rawSongId
        )}/catalog?include=albums`,
        { headers }
      );
      if (libSongResp.ok) {
        const libSongJson = await libSongResp.json();
        const catSong = libSongJson?.data?.[0];
        catalogAlbumId = catSong?.relationships?.albums?.data?.[0]?.id || null;
      }
    } else {
      const songResp = await fetch(
        `https://api.music.apple.com/v1/catalog/${storefront}/songs/${encodeURIComponent(
          rawSongId
        )}?include=albums`,
        { headers }
      );
      if (songResp.ok) {
        const songJson = await songResp.json();
        catalogAlbumId =
          songJson?.data?.[0]?.relationships?.albums?.data?.[0]?.id || null;
      }
    }
  }

  if (!catalogAlbumId) {
    throw new Error('Could not resolve full catalog album on Apple Music');
  }

  const albResp = await fetch(
    `https://api.music.apple.com/v1/catalog/${storefront}/albums/${encodeURIComponent(
      catalogAlbumId
    )}?include=tracks`,
    { headers }
  );
  if (!albResp.ok) {
    throw new Error('Failed to load catalog album from Apple Music');
  }
  const albJson = await albResp.json();
  const albData = albJson?.data?.[0];
  if (!albData) {
    throw new Error('Catalog album not found');
  }

  const attrs = albData.attributes || {};
  const relTracks = albData.relationships?.tracks?.data || [];
  const tracks: TrackMetadata[] = relTracks
    .map(mapAppleItemToTrack)
    .filter((t: TrackMetadata | null): t is TrackMetadata => t !== null);

  const releaseYear = attrs.releaseDate
    ? Number(String(attrs.releaseDate).slice(0, 4)) || null
    : null;

  const summary: AppleCloudAlbumSummary = {
    id: String(albData.id),
    title: attrs.name || 'Apple Music Album',
    artist: attrs.artistName || 'Unknown Artist',
    art_url: formatAppleArtUrl(attrs.artwork?.url, 400) || tracks[0]?.art_url || null,
    track_count: tracks.length || Number(attrs.trackCount || 0),
    release_year: releaseYear,
    kind: 'catalog',
  };

  return { album: summary, tracks };
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
    title: album.title.startsWith('🍎') ? album.title : `🍎 ${album.title}`,
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
  try {
    const r = await fetch('http://127.0.0.1:18888/api/apple/radio');
    if (r.ok) {
      const j = await r.json();
      if (j.ok && j.data) return j.data;
    }
  } catch {
    // Fallback to browser fetch
  }
  const { headers, storefront } = await getAppleAuthHeaders();

  const stations: AppleRadioStationSummary[] = [];
  const playlists: AppleCloudPlaylistSummary[] = [];
  const albums: AppleCloudAlbumSummary[] = [];
  const seenStationIds = new Set<string>();
  const seenPlaylistIds = new Set<string>();
  const seenAlbumIds = new Set<string>();

  const pushStation = (st: any, fallbackSub = 'Apple Music Radio') => {
    if (!st?.id || seenStationIds.has(st.id)) return;
    seenStationIds.add(st.id);
    const attrs = st.attributes || {};
    stations.push({
      id: st.id,
      name: attrs.name || 'Radio Station',
      subtitle: attrs.editorialNotes?.short || fallbackSub,
      art_url: formatAppleArtUrl(attrs.artwork?.url, 300),
    });
  };

  const pushItem = (item: any, groupTitle = '') => {
    if (!item?.id) return;
    const type = item.type;
    const attrs = item.attributes || {};
    if (type === 'stations') {
      pushStation(item, groupTitle || 'Personal Station');
    } else if (type === 'playlists' || type === 'library-playlists') {
      if (seenPlaylistIds.has(item.id)) return;
      seenPlaylistIds.add(item.id);
      playlists.push({
        id: item.id,
        name: attrs.name || 'Mix',
        description: attrs.curatorName || groupTitle || 'Made For You',
        art_url: formatAppleArtUrl(attrs.artwork?.url, 300),
        kind: item.id.startsWith('pl.') ? 'catalog' : 'library',
      });
    } else if (type === 'albums' || type === 'library-albums') {
      if (seenAlbumIds.has(item.id)) return;
      seenAlbumIds.add(item.id);
      albums.push({
        id: item.id,
        title: attrs.name || 'Album',
        artist: attrs.artistName || 'Apple Music',
        art_url: formatAppleArtUrl(attrs.artwork?.url, 300),
        track_count: Number(attrs.trackCount || 0),
        release_year: attrs.releaseDate ? Number(String(attrs.releaseDate).slice(0, 4)) || null : null,
        kind: item.id.startsWith('l.') ? 'library' : 'catalog',
      });
    }
  };

  await Promise.allSettled([
    fetch('https://api.music.apple.com/v1/me/recent/radio-stations?limit=12', { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        for (const st of json?.data || []) pushStation(st, 'Recent Radio Station');
      }),
    fetch('https://api.music.apple.com/v1/me/history/heavy-rotation?limit=15', { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        for (const item of json?.data || []) pushItem(item, 'Heavy Rotation');
      }),
    fetch('https://api.music.apple.com/v1/me/recommendations?limit=10', { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        for (const rec of json?.data || []) {
          const title = rec.attributes?.title?.stringForDisplay || 'For You';
          for (const item of rec.relationships?.contents?.data || []) {
            pushItem(item, title);
          }
        }
      }),
    fetch(
      `https://api.music.apple.com/v1/catalog/${storefront}/stations?filter[featured]=apple-music-live-radio`,
      { headers }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        for (const st of json?.data || []) pushStation(st, 'Live Global Radio');
      }),
  ]);

  return { stations, playlists, albums };
}

/**
 * Fetches Apple Music "New" / Top Charts & Hot New Releases via the Rust daemon.
 */
export async function fetchAppleNewFeed(): Promise<{
  albums: AppleCloudAlbumSummary[];
  playlists: AppleCloudPlaylistSummary[];
  songs: TrackMetadata[];
}> {
  try {
    const r = await fetch('http://127.0.0.1:18888/api/apple/new');
    if (r.ok) {
      const j = await r.json();
      if (j.ok && j.data) return j.data;
    }
  } catch {
    // Fallback to browser fetch
  }
  const { headers, storefront } = await getAppleAuthHeaders();
  const albums: AppleCloudAlbumSummary[] = [];
  const playlists: AppleCloudPlaylistSummary[] = [];
  const songs: TrackMetadata[] = [];
  const seenAlbumIds = new Set<string>();
  const seenPlaylistIds = new Set<string>();
  const seenSongUris = new Set<string>();

  const pushAlbum = (alb: any) => {
    if (!alb?.id || seenAlbumIds.has(String(alb.id))) return;
    seenAlbumIds.add(String(alb.id));
    const attrs = alb.attributes || {};
    albums.push({
      id: String(alb.id),
      title: attrs.name || 'New Album',
      artist: attrs.artistName || 'Apple Music',
      art_url: formatAppleArtUrl(attrs.artwork?.url, 300),
      track_count: Number(attrs.trackCount || 0),
      release_year: attrs.releaseDate ? Number(String(attrs.releaseDate).slice(0, 4)) || null : null,
      kind: 'catalog',
    });
  };

  const pushPlaylist = (pl: any) => {
    if (!pl?.id || seenPlaylistIds.has(String(pl.id))) return;
    seenPlaylistIds.add(String(pl.id));
    const attrs = pl.attributes || {};
    playlists.push({
      id: String(pl.id),
      name: attrs.name || 'Featured Playlist',
      description: attrs.curatorName || attrs.editorialNotes?.short || 'Apple Music New & Featured',
      art_url: formatAppleArtUrl(attrs.artwork?.url, 300),
      kind: 'catalog',
    });
  };

  await Promise.allSettled([
    fetch(
      `https://api.music.apple.com/v1/catalog/${storefront}/charts?types=albums,playlists,songs&limit=15`,
      { headers }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const res = json?.results || {};
        for (const chart of res.albums || []) {
          for (const alb of chart.data || []) pushAlbum(alb);
        }
        for (const chart of res.playlists || []) {
          for (const pl of chart.data || []) pushPlaylist(pl);
        }
        for (const chart of res.songs || []) {
          for (const item of chart.data || []) {
            const tr = mapAppleItemToTrack(item);
            if (tr && !seenSongUris.has(tr.uri)) {
              seenSongUris.add(tr.uri);
              songs.push(tr);
            }
          }
        }
      }),
    fetch(
      `https://api.music.apple.com/v1/catalog/${storefront}/search?term=${encodeURIComponent(
        'New Music Daily'
      )}&types=playlists,albums&limit=10`,
      { headers }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const res = json?.results || {};
        for (const pl of res.playlists?.data || []) pushPlaylist(pl);
        for (const alb of res.albums?.data || []) pushAlbum(alb);
      }),
  ]);

  return { albums, playlists, songs };
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
  try {
    const r = await fetch(
      `http://127.0.0.1:18888/api/apple/search?term=${encodeURIComponent(cleaned)}`
    );
    if (r.ok) {
      const j = await r.json();
      if (j.ok && j.data) return j.data;
    }
  } catch {
    // Fallback to browser fetch
  }
  const { headers, storefront } = await getAppleAuthHeaders();
  const url = `https://api.music.apple.com/v1/catalog/${storefront}/search?term=${encodeURIComponent(
    cleaned
  )}&types=songs,albums,playlists,stations&limit=15`;

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    throw new Error('Apple Music catalog search failed');
  }
  const json = await resp.json();
  const results = json?.results || {};

  const songs: TrackMetadata[] = (results.songs?.data || [])
    .map(mapAppleItemToTrack)
    .filter((t: TrackMetadata | null): t is TrackMetadata => t !== null);

  const albums: AppleCloudAlbumSummary[] = (results.albums?.data || []).map((alb: any) => {
    const attrs = alb.attributes || {};
    return {
      id: String(alb.id),
      title: attrs.name || 'Album',
      artist: attrs.artistName || 'Unknown Artist',
      art_url: formatAppleArtUrl(attrs.artwork?.url, 300),
      track_count: Number(attrs.trackCount || 0),
      release_year: attrs.releaseDate ? Number(String(attrs.releaseDate).slice(0, 4)) || null : null,
      kind: 'catalog' as const,
    };
  });

  const playlists: AppleCloudPlaylistSummary[] = (results.playlists?.data || []).map((pl: any) => {
    const attrs = pl.attributes || {};
    return {
      id: String(pl.id),
      name: attrs.name || 'Playlist',
      description: attrs.curatorName || 'Apple Music Playlist',
      art_url: formatAppleArtUrl(attrs.artwork?.url, 300),
      kind: 'catalog' as const,
    };
  });

  const stations: AppleRadioStationSummary[] = (results.stations?.data || []).map((st: any) => {
    const attrs = st.attributes || {};
    return {
      id: String(st.id),
      name: attrs.name || 'Station',
      subtitle: attrs.editorialNotes?.short || 'Apple Music Radio',
      art_url: formatAppleArtUrl(attrs.artwork?.url, 300),
    };
  });

  return { songs, albums, playlists, stations };
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
    // Fallback to browser lookup below
  }
  try {
    const { headers, storefront } = await getAppleAuthHeaders();
    if (rawId.startsWith('i.')) {
      const relResp = await fetch(
        `https://api.music.apple.com/v1/me/library/songs/${encodeURIComponent(rawId)}/catalog`,
        { headers }
      );
      if (relResp.ok) {
        const relJson = await relResp.json();
        const catId = relJson?.data?.[0]?.id;
        if (catId) return String(catId);
      }
    }
    if (cur && cur.title && cur.title !== 'Unknown Track') {
      const artist = cur.artists?.[0] || '';
      const term = `${cur.title} ${artist}`.trim();
      const searchResp = await fetch(
        `https://api.music.apple.com/v1/catalog/${storefront}/search?term=${encodeURIComponent(
          term
        )}&types=songs&limit=5`,
        { headers }
      );
      if (searchResp.ok) {
        const searchJson = await searchResp.json();
        const candidates: any[] = searchJson?.results?.songs?.data || [];
        const titleLower = cur.title.toLowerCase();
        const artistLower = artist.toLowerCase();
        const exact =
          candidates.find((c) => {
            const n = String(c?.attributes?.name || '').toLowerCase();
            const a = String(c?.attributes?.artistName || '').toLowerCase();
            return n === titleLower && (!artistLower || a.includes(artistLower));
          }) || candidates[0];
        if (exact?.id && String(exact.id) !== rawId) {
          console.info(
            `[SIMP AppleMusicDriver] Resolved re-linked catalogId ${exact.id} for stale playlist track ${rawId} ("${cur.title}")`
          );
          return String(exact.id);
        }
      }
    }
  } catch {
    // ignore fallback lookup errors
  }
  return null;
}

