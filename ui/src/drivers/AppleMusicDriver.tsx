import React, { useEffect, useRef } from 'react';
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
  // Prefer catalogId so MusicKit can stream full catalog or library items and resolve full albums reliably
  const trackId = playParams.catalogId || playParams.id || item.id || attrs.id;
  if (!trackId) return null;

  const title = attrs.name || attrs.title || item.title || 'Unknown Track';
  const artistName = attrs.artistName || item.artistName || 'Unknown Artist';
  const albumName = attrs.albumName || item.albumName || 'Apple Music';
  const durationMs = Math.round(
    Number(attrs.durationInMillis || item.durationInMillis || item.playbackDuration || 0)
  );
  const rawArt = attrs.artwork?.url || item.artwork?.url || item.artworkURL || null;
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

async function checkWidevineDrm(): Promise<boolean> {
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

async function getAppleAuthHeaders(): Promise<{
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
 * Fetches the user's Cloud Playlists on-demand (headers only) without auto-dumping them into SQLite.
 * Users can preview any playlist or click "📌 Pin to SIMP" to add it to SIMP's sidebar & Decky QAM.
 */
export async function fetchAppleCloudPlaylists(): Promise<AppleCloudPlaylistSummary[]> {
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
 * Fetches the full tracklist for a specific Apple Music Playlist (either `p.xxxx` library or `pl.xxxx` catalog).
 */
export async function fetchApplePlaylistTracks(
  playlistId: string,
  kind: 'library' | 'catalog' = playlistId.startsWith('pl.') ? 'catalog' : 'library'
): Promise<TrackMetadata[]> {
  const { headers, storefront } = await getAppleAuthHeaders();
  const cleanId = playlistId.replace(/^applemusic:playlist:/, '');
  let nextUrl: string | null =
    kind === 'catalog' || cleanId.startsWith('pl.')
      ? `https://api.music.apple.com/v1/catalog/${storefront}/playlists/${encodeURIComponent(
          cleanId
        )}/tracks?limit=100`
      : `https://api.music.apple.com/v1/me/library/playlists/${encodeURIComponent(
          cleanId
        )}/tracks?limit=100`;

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
 * Resolves the FULL Master Catalog Album from either:
 * - A Catalog Album ID (`1440857781`)
 * - A Library Album ID (`l.xxxxxx`)
 * - Or a Song URI (`applemusic:song:1440857785` or `i.xxxxxx`)
 * So the user always sees all 100% of the album's tracks instead of a 1-track partial library stub!
 */
export async function fetchFullAppleAlbum(params: {
  albumId?: string | null;
  songUri?: string | null;
}): Promise<{ album: AppleCloudAlbumSummary; tracks: TrackMetadata[] }> {
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
 * Fetches the user's Apple Music Radio Stations, Personal Mixes, and Heavy Rotation.
 */
export async function fetchAppleRadioAndForYou(): Promise<{
  stations: AppleRadioStationSummary[];
  playlists: AppleCloudPlaylistSummary[];
  albums: AppleCloudAlbumSummary[];
}> {
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
    // 1. Personal & Recent Radio Stations
    fetch('https://api.music.apple.com/v1/me/recent/radio-stations?limit=12', { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        for (const st of json?.data || []) pushStation(st, 'Recent Radio Station');
      }),
    // 2. Heavy Rotation (Albums, Playlists, Stations)
    fetch('https://api.music.apple.com/v1/me/history/heavy-rotation?limit=15', { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        for (const item of json?.data || []) pushItem(item, 'Heavy Rotation');
      }),
    // 3. Personal Recommendations ("Made For You" Mixes, Personal Station, New Releases)
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
    // 4. Featured Live Apple Music Radio Stations fallback
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
 * Fetches Apple Music "New" / Top Charts & Hot New Releases (`albums`, `playlists`, `songs`) for the storefront.
 */
export async function fetchAppleNewFeed(): Promise<{
  albums: AppleCloudAlbumSummary[];
  playlists: AppleCloudPlaylistSummary[];
  songs: TrackMetadata[];
}> {
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
 * Live Apple Music Catalog Search (Songs, Full Albums, Playlists, and Radio Stations).
 */
export async function searchAppleMusicCatalog(
  term: string
): Promise<AppleCatalogSearchResults> {
  const cleaned = term.trim();
  if (!cleaned) {
    return { songs: [], albums: [], playlists: [], stations: [] };
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
 * Headless `<AppleMusicDriver />` Virtual Sink Bridge.
 * Listens for `AppleSinkCommand` events from `simp --daemon` (`AudioOrchestrator`)
 * and drives `MusicKit JS` playback (Songs & Radio Stations), relaying state/time/completion back to Rust & MPRIS2.
 */
export const AppleMusicDriver: React.FC = () => {
  const mkRef = useRef<any>(null);
  const listenersBoundRef = useRef(false);
  const loadSeqRef = useRef(0);
  const isLoadingRef = useRef(false);
  const lastEndedSeqRef = useRef(-1);

  useEffect(() => {
    let cancelled = false;

    const bindMusicKitEvents = (mk: any) => {
      if (listenersBoundRef.current || !window.MusicKit) return;
      listenersBoundRef.current = true;
      const Events = window.MusicKit.Events;
      const States = window.MusicKit.PlaybackStates;

      const readPrecisePlaybackMs = (): { posMs: number; durMs: number } => {
        const audioEl = document.getElementById('apple-music-player') as HTMLAudioElement | null;
        const rawPosSec =
          audioEl && Number.isFinite(audioEl.currentTime) && audioEl.currentTime > 0
            ? audioEl.currentTime
            : Number(mk.currentPlaybackTime || 0);
        const rawDurSec =
          audioEl && Number.isFinite(audioEl.duration) && audioEl.duration > 0
            ? audioEl.duration
            : Number(mk.currentPlaybackDuration || 0);
        return {
          posMs: Math.round(rawPosSec * 1000),
          durMs: Math.round(rawDurSec * 1000),
        };
      };

      const reportCurrentItemIfAny = (stateName: 'playing' | 'paused' = 'playing') => {
        const item = mk.nowPlayingItem;
        const { posMs, durMs } = readPrecisePlaybackMs();
        const mapped = item ? mapAppleItemToTrack(item) : null;
        if (mapped && durMs > 0 && mapped.duration_ms === 0) {
          mapped.duration_ms = durMs;
        }
        defaultSimpClient.reportAppleWorkerEvent(
          stateName,
          posMs,
          mapped,
          mapped?.duration_ms || durMs || null
        );
      };

      mk.addEventListener(Events.playbackStateDidChange, () => {
        const st = mk.playbackState;
        const { posMs, durMs } = readPrecisePlaybackMs();

        if (st === States.playing) {
          isLoadingRef.current = false;
          reportCurrentItemIfAny('playing');
          return;
        }

        // Ignore transient stopped/paused/ended events fired while `mk.setQueue` tears down the previous track
        if (isLoadingRef.current) {
          return;
        }

        if (st === States.paused) {
          defaultSimpClient.reportAppleWorkerEvent('paused', posMs, null, durMs);
        } else if (st === States.completed || st === States.ended) {
          // Deduplicate `completed` (10) followed by `ended` (6) for the same track load
          if (lastEndedSeqRef.current !== loadSeqRef.current) {
            lastEndedSeqRef.current = loadSeqRef.current;
            defaultSimpClient.reportAppleWorkerEvent('ended', posMs, null, durMs);
          }
        }
      });

      mk.addEventListener(Events.playbackTimeDidChange, () => {
        if (isLoadingRef.current) return;
        const { posMs, durMs } = readPrecisePlaybackMs();
        defaultSimpClient.reportAppleWorkerEvent('time_update', posMs, null, durMs);
      });

      mk.addEventListener(Events.nowPlayingItemDidChange, () => {
        if (mk.nowPlayingItem) {
          reportCurrentItemIfAny('playing');
        }
      });
    };

    const isDedicatedWorker =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('worker') === 'apple';

    const ensureInstance = async (fromCommand = false): Promise<any | null> => {
      if (mkRef.current) return mkRef.current;
      const cfg = await defaultSimpClient.getAppleMusicAuthConfig();
      if (!cfg.configured || !cfg.developer_token || cancelled) return null;

      if (cfg.headless_worker_active && !isDedicatedWorker) {
        return null;
      }

      const hasWidevine = await checkWidevineDrm();
      if (!hasWidevine && !isDedicatedWorker) {
        console.info(
          '[SIMP AppleMusicDriver] Browser lacks Widevine CDM (steamwebhelper); delegating audio to headless Widevine worker.'
        );
        return null;
      }

      const mk = await ensureMusicKitConfigured(cfg.developer_token, cfg.music_user_token);
      mkRef.current = mk;
      bindMusicKitEvents(mk);
      if (!fromCommand) {
        defaultSimpClient.reportAppleWorkerEvent('worker_ready', 0, null, null);
      }
      return mk;
    };

    defaultSimpClient
      .getAppleMusicAuthConfig()
      .then(async (cfg) => {
        if (cfg.configured && cfg.apple_authenticated && cfg.developer_token) {
          await ensureInstance(false).catch(() => {});
        }
      })
      .catch(() => {});

    const unsubSink = defaultSimpClient.subscribeAppleSink(async (cmd) => {
      try {
        const mk = await ensureInstance(true);
        if (!mk) return;

        if (cmd.volume != null) {
          mk.volume = Math.max(0, Math.min(1, cmd.volume));
        }

        const States = window.MusicKit?.PlaybackStates;

        switch (cmd.action) {
          case 'load_and_play': {
            if (!cmd.uri) return;
            const mySeq = ++loadSeqRef.current;
            isLoadingRef.current = true;

            // Cleanly stop any previous track's Widevine EME MediaKeySession / MediaSource before loading next song
            try {
              if (mk.playbackState && mk.playbackState !== (States?.none ?? 0)) {
                await mk.stop();
              }
            } catch {
              // Ignore stop errors on idle player
            }

            if (mySeq !== loadSeqRef.current) return;

            if (cmd.uri.startsWith('applemusic:station:')) {
              const stationId = cmd.uri.replace(/^applemusic:station:/, '');
              await mk.setQueue({
                station: stationId,
                startPlaying: true,
              });
              if (mySeq !== loadSeqRef.current) return;
              if (mk.playbackState !== States?.playing) {
                await mk.play().catch(() => {});
              }
              isLoadingRef.current = false;
              const item = mk.nowPlayingItem;
              if (item) {
                const mapped = mapAppleItemToTrack(item);
                if (mapped) {
                  defaultSimpClient.reportAppleWorkerEvent('playing', 0, mapped, mapped.duration_ms);
                }
              }
              break;
            }

            const rawId = cmd.uri
              .replace(/^applemusic:(song|track):/, '')
              .replace(/^applemusic:/, '');

            try {
              await mk.setQueue({
                song: rawId,
                startPlaying: true,
              });
              if (mySeq !== loadSeqRef.current) return;
              if (cmd.position_ms && cmd.position_ms > 0) {
                await mk.seekToTime(cmd.position_ms / 1000).catch(() => {});
              }
              if (mk.playbackState !== States?.playing) {
                await mk.play();
              }
            } catch (firstErr) {
              console.warn('[SIMP AppleMusicDriver] First setQueue/play attempt failed, retrying cleanly:', firstErr);
              if (mySeq !== loadSeqRef.current) return;
              await mk.stop().catch(() => {});
              await mk.setQueue({ song: rawId, startPlaying: false });
              if (mySeq !== loadSeqRef.current) return;
              await mk.play();
            }

            // Ensure underlying HTML5 <audio id="apple-music-player"> is unmuted and playing
            const audioEl = document.getElementById('apple-music-player') as HTMLAudioElement | null;
            if (audioEl) {
              audioEl.muted = false;
              if (cmd.volume != null) {
                audioEl.volume = Math.max(0, Math.min(1, cmd.volume));
              }
              if (audioEl.paused) {
                await audioEl.play().catch(() => {});
              }
            }

            isLoadingRef.current = false;
            const item = mk.nowPlayingItem;
            if (item) {
              const mapped = mapAppleItemToTrack(item);
              if (mapped) {
                const livePosSec =
                  audioEl && Number.isFinite(audioEl.currentTime) && audioEl.currentTime > 0
                    ? audioEl.currentTime
                    : Number(mk.currentPlaybackTime || 0);
                const livePosMs = Math.max(
                  cmd.position_ms || 0,
                  Math.round(livePosSec * 1000)
                );
                defaultSimpClient.reportAppleWorkerEvent(
                  'playing',
                  livePosMs,
                  mapped,
                  mapped.duration_ms
                );
              }
            }
            break;
          }
          case 'play': {
            await mk.play();
            const audioEl = document.getElementById('apple-music-player') as HTMLAudioElement | null;
            if (audioEl && audioEl.paused) {
              await audioEl.play().catch(() => {});
            }
            break;
          }
          case 'pause':
            await mk.pause();
            break;
          case 'seek':
            if (cmd.position_ms != null) {
              await mk.seekToTime(cmd.position_ms / 1000);
            }
            break;
          case 'set_volume': {
            if (cmd.volume != null) {
              const v = Math.max(0, Math.min(1, cmd.volume));
              mk.volume = v;
              const audioEl = document.getElementById('apple-music-player') as HTMLAudioElement | null;
              if (audioEl) audioEl.volume = v;
            }
            break;
          }
        }
      } catch (err) {
        isLoadingRef.current = false;
        console.warn('AppleMusicDriver command failed:', err);
      }
    });

    return () => {
      cancelled = true;
      unsubSink();
    };
  }, []);

  return null;
};
