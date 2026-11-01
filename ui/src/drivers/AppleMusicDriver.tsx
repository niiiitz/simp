import React, { useEffect, useRef } from 'react';
import {
  defaultSimpClient,
  PlaylistRecord,
  TrackMetadata,
} from '@simp/client';

declare global {
  interface Window {
    MusicKit?: any;
  }
}

let musicKitLoadPromise: Promise<any> | null = null;
let configuredToken: string | null = null;

function formatAppleArtUrl(rawUrl?: string | null, size = 400): string | null {
  if (!rawUrl) return null;
  return rawUrl
    .replace('{w}', String(size))
    .replace('{h}', String(size))
    .replace('{f}', 'jpg');
}

function mapAppleItemToTrack(item: any): TrackMetadata | null {
  if (!item) return null;
  const attrs = item.attributes || {};
  const playParams = attrs.playParams || {};
  // Prefer catalogId so MusicKit can stream full catalog or library items reliably
  const trackId = playParams.catalogId || playParams.id || item.id;
  if (!trackId) return null;

  const title = attrs.name || 'Unknown Track';
  const artistName = attrs.artistName || 'Unknown Artist';
  const albumName = attrs.albumName || 'Apple Music';
  const durationMs = Math.round(Number(attrs.durationInMillis || 0));
  const artUrl = formatAppleArtUrl(attrs.artwork?.url, 400);

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

export async function ensureMusicKitConfigured(developerToken: string): Promise<any> {
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
  return MK.getInstance();
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
  onToast?.('Apple Music connected! Syncing library & playlists...');
  await syncAppleMusicCatalog(onToast);
  return true;
}

export async function syncAppleMusicCatalog(
  onToast?: (msg: string) => void
): Promise<{ playlists: number; tracks: number }> {
  const cfg = await defaultSimpClient.getAppleMusicAuthConfig();
  if (!cfg.developer_token) {
    throw new Error(cfg.status_error || 'Missing Apple Developer Token');
  }

  const mk = await ensureMusicKitConfigured(cfg.developer_token);
  const userToken = mk.musicUserToken || cfg.music_user_token;
  if (!userToken) {
    throw new Error('Please authorize with your Apple ID first');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.developer_token}`,
    'Music-User-Token': userToken,
  };

  let importedPlaylists = 0;
  let importedTracks = 0;

  // 1. Fetch User's Apple Music Library Playlists
  const plResp = await fetch(
    'https://api.music.apple.com/v1/me/library/playlists?limit=50',
    { headers }
  );
  if (plResp.ok) {
    const plJson = await plResp.json();
    const playlistsData: any[] = plJson.data || [];
    for (const plItem of playlistsData) {
      const plId = plItem.id;
      const plAttrs = plItem.attributes || {};
      const trResp = await fetch(
        `https://api.music.apple.com/v1/me/library/playlists/${encodeURIComponent(
          plId
        )}/tracks?limit=100`,
        { headers }
      );
      if (!trResp.ok) continue;
      const trJson = await trResp.json();
      const tracks: TrackMetadata[] = (trJson.data || [])
        .map(mapAppleItemToTrack)
        .filter((t: TrackMetadata | null): t is TrackMetadata => t !== null);

      if (tracks.length > 0) {
        const playlistRecord: PlaylistRecord = {
          id: `applemusic:playlist:${plId}`,
          name: `🍎 ${plAttrs.name || 'Apple Playlist'}`,
          description: plAttrs.description?.standard || 'Apple Music Library Playlist',
          origin: 'apple_remote',
          cover_art_url:
            formatAppleArtUrl(plAttrs.artwork?.url, 400) || tracks[0]?.art_url || null,
          track_count: tracks.length,
          updated_at: Math.floor(Date.now() / 1000),
        };
        defaultSimpClient.importCatalogTracks({
          source: 'apple_music',
          playlist: playlistRecord,
          tracks,
        });
        importedPlaylists += 1;
        importedTracks += tracks.length;
      }
    }
  }

  // 2. Fetch User's Apple Music Library Songs (up to 100 recent songs grouped into albums)
  const songsResp = await fetch(
    'https://api.music.apple.com/v1/me/library/songs?limit=100',
    { headers }
  );
  if (songsResp.ok) {
    const songsJson = await songsResp.json();
    const libraryTracks: TrackMetadata[] = (songsJson.data || [])
      .map(mapAppleItemToTrack)
      .filter((t: TrackMetadata | null): t is TrackMetadata => t !== null);

    if (libraryTracks.length > 0) {
      defaultSimpClient.importCatalogTracks({
        source: 'apple_music',
        tracks: libraryTracks,
      });
      importedTracks += libraryTracks.length;
    }
  }

  onToast?.(
    `Synced ${importedPlaylists} Apple Music playlists (${importedTracks} tracks)`
  );
  return { playlists: importedPlaylists, tracks: importedTracks };
}

/**
 * Headless `<AppleMusicDriver />` Virtual Sink Bridge.
 * Listens for `AppleSinkCommand` events from `simp --daemon` (`AudioOrchestrator`)
 * and drives `MusicKit JS` playback, relaying state/time/completion back to Rust & MPRIS2.
 */
export const AppleMusicDriver: React.FC = () => {
  const mkRef = useRef<any>(null);
  const listenersBoundRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const bindMusicKitEvents = (mk: any) => {
      if (listenersBoundRef.current || !window.MusicKit) return;
      listenersBoundRef.current = true;
      const Events = window.MusicKit.Events;
      const States = window.MusicKit.PlaybackStates;

      mk.addEventListener(Events.playbackStateDidChange, () => {
        const st = mk.playbackState;
        const posMs = Math.round(Number(mk.currentPlaybackTime || 0) * 1000);
        const durMs = Math.round(Number(mk.currentPlaybackDuration || 0) * 1000);

        if (st === States.playing) {
          defaultSimpClient.reportAppleWorkerEvent('playing', posMs, null, durMs);
        } else if (st === States.paused || st === States.stopped) {
          defaultSimpClient.reportAppleWorkerEvent('paused', posMs, null, durMs);
        } else if (st === States.completed || st === States.ended) {
          defaultSimpClient.reportAppleWorkerEvent('ended', posMs, null, durMs);
        }
      });

      mk.addEventListener(Events.playbackTimeDidChange, () => {
        const posMs = Math.round(Number(mk.currentPlaybackTime || 0) * 1000);
        const durMs = Math.round(Number(mk.currentPlaybackDuration || 0) * 1000);
        defaultSimpClient.reportAppleWorkerEvent('time_update', posMs, null, durMs);
      });

      mk.addEventListener(Events.nowPlayingItemDidChange, () => {
        const item = mk.nowPlayingItem;
        if (!item) return;
        const mapped = mapAppleItemToTrack(item);
        const posMs = Math.round(Number(mk.currentPlaybackTime || 0) * 1000);
        if (mapped) {
          defaultSimpClient.reportAppleWorkerEvent(
            'playing',
            posMs,
            mapped,
            mapped.duration_ms
          );
        }
      });
    };

    const ensureInstance = async () => {
      if (mkRef.current) return mkRef.current;
      const cfg = await defaultSimpClient.getAppleMusicAuthConfig();
      if (!cfg.configured || !cfg.developer_token || cancelled) return null;
      const mk = await ensureMusicKitConfigured(cfg.developer_token);
      mkRef.current = mk;
      bindMusicKitEvents(mk);
      return mk;
    };

    // Pre-initialize if Apple Music is already authenticated
    defaultSimpClient
      .getAppleMusicAuthConfig()
      .then((cfg) => {
        if (cfg.configured && cfg.apple_authenticated && cfg.developer_token) {
          ensureInstance().catch(() => {});
        }
      })
      .catch(() => {});

    const unsubSink = defaultSimpClient.subscribeAppleSink(async (cmd) => {
      try {
        const mk = await ensureInstance();
        if (!mk) return;

        if (cmd.volume != null) {
          mk.volume = Math.max(0, Math.min(1, cmd.volume));
        }

        switch (cmd.action) {
          case 'load_and_play': {
            if (!cmd.uri) return;
            const rawId = cmd.uri
              .replace(/^applemusic:(song|track):/, '')
              .replace(/^applemusic:/, '');
            await mk.setQueue({
              song: rawId,
              startPlaying: true,
            });
            if (cmd.position_ms && cmd.position_ms > 0) {
              await mk.seekToTime(cmd.position_ms / 1000);
            }
            await mk.play();
            break;
          }
          case 'play':
            await mk.play();
            break;
          case 'pause':
            await mk.pause();
            break;
          case 'seek':
            if (cmd.position_ms != null) {
              await mk.seekToTime(cmd.position_ms / 1000);
            }
            break;
          case 'set_volume':
            if (cmd.volume != null) {
              mk.volume = Math.max(0, Math.min(1, cmd.volume));
            }
            break;
        }
      } catch (err) {
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

