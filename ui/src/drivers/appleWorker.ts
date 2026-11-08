import { useEffect, useRef } from 'react';
import { defaultSimpClient } from '@simp/client';
import {
  checkWidevineDrm,
  ensureMusicKitConfigured,
  mapAppleItemToTrack,
  resolveReplacementCatalogSongId,
} from './appleApi';

/**
 * React hook that binds the MusicKit JS v3 EME playback worker to `simp --daemon` (`AudioOrchestrator`).
 * Isolated into `appleWorker.ts` so it can be swapped or disabled cleanly as native Rust Widevine CDM matures.
 */
export function useAppleMusicWorker(): void {
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
      const cfg = await defaultSimpClient.getAppleMusicAuthConfig();
      if (!cfg.configured || !cfg.developer_token || cancelled) return null;

      if (cfg.headless_worker_active && !isDedicatedWorker) {
        if (mkRef.current) {
          try {
            await mkRef.current.stop();
          } catch {
            // ignore
          }
          mkRef.current = null;
        }
        return null;
      }

      if (mkRef.current) return mkRef.current;

      const hasWidevine = await checkWidevineDrm();
      if (!hasWidevine && !isDedicatedWorker && cfg.headless_worker_active) {
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

    const unsubState = defaultSimpClient.subscribeState((snap) => {
      if (snap.apple_authenticated && !mkRef.current) {
        ensureInstance(false).catch(() => {});
      }
    });

    const unsubSink = defaultSimpClient.subscribeAppleSink(async (cmd) => {
      try {
        if (cmd.action === 'unauthorize') {
          try {
            if (mkRef.current) {
              await mkRef.current.stop?.().catch(() => {});
              await mkRef.current.unauthorize?.().catch(() => {});
              mkRef.current = null;
            }
          } catch {
            // ignore
          }
          return;
        }

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

            let rawId = cmd.uri
              .replace(/^applemusic:(song|track):/, '')
              .replace(/^applemusic:/, '');

            if (rawId.startsWith('i.')) {
              const resolved = await resolveReplacementCatalogSongId(rawId);
              if (resolved) rawId = resolved;
            }

            const attemptQueueAndWait = async (songId: string) => {
              const queueArg = songId.startsWith('i.')
                ? { librarySong: songId, startPlaying: true }
                : { song: songId, startPlaying: true };
              await mk.setQueue(queueArg);
              if (mySeq !== loadSeqRef.current) return;
              for (let attempt = 0; attempt < 10; attempt++) {
                if (mySeq !== loadSeqRef.current) return;
                if (mk.playbackState === States?.playing) break;
                const isHandshakeInFlight =
                  mk.playbackState === States?.loading ||
                  mk.playbackState === States?.waiting ||
                  mk.playbackState === States?.stalled;
                if (!isHandshakeInFlight && attempt >= 2) break;
                await new Promise((r) => setTimeout(r, 150));
              }
              if (mySeq !== loadSeqRef.current) return;
              if (cmd.position_ms && cmd.position_ms > 0) {
                await mk.seekToTime(cmd.position_ms / 1000).catch(() => {});
              }
              if (mk.playbackState !== States?.playing) {
                await mk.play();
              }
            };

            try {
              await attemptQueueAndWait(rawId);
              if (
                mySeq === loadSeqRef.current &&
                mk.playbackState !== States?.playing &&
                mk.playbackState !== States?.loading &&
                mk.playbackState !== States?.waiting
              ) {
                const replacementId = await resolveReplacementCatalogSongId(rawId);
                if (replacementId && mySeq === loadSeqRef.current) {
                  await mk.stop().catch(() => {});
                  await attemptQueueAndWait(replacementId);
                }
              }
            } catch (firstErr) {
              console.warn('[SIMP AppleMusicDriver] First setQueue/play attempt failed, checking catalog fallback:', firstErr);
              if (mySeq !== loadSeqRef.current) return;
              const replacementId = await resolveReplacementCatalogSongId(rawId);
              const retryId = replacementId || rawId;
              if (mySeq !== loadSeqRef.current) return;
              await mk.stop().catch(() => {});
              await mk.setQueue({ song: retryId, startPlaying: false });
              if (mySeq !== loadSeqRef.current) return;
              await mk.play();
            }

            const audioEl = document.getElementById('apple-music-player') as HTMLAudioElement | null;
            if (audioEl) {
              audioEl.muted = false;
              if (cmd.volume != null) {
                audioEl.volume = Math.max(0, Math.min(1, cmd.volume));
              }
              if (audioEl.paused && mk.playbackState !== States?.loading && mk.playbackState !== States?.waiting) {
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
      unsubState();
      unsubSink();
    };
  }, []);
}

