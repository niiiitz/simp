import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultSimpClient,
  OpticalDiscStatus,
  SimpStateSnapshot,
  SoundCloudComment,
  TrackMetadata,
} from '@simp/client';
import { ProgressBarRaf } from '../components/ProgressBarRaf';
import {
  fetchSoundCloudTrackComments,
  fetchSoundCloudTrackWaveform,
  likeSoundCloudTrack,
} from '../drivers/SoundCloudDriver';

export interface BrowserTarget {
  kind:
    | 'album'
    | 'playlist'
    | 'mount'
    | 'cloud_playlist'
    | 'cloud_album'
    | 'soundcloud_playlist'
    | 'ia_discover'
    | 'ia_item'
    | 'cdda';
  id: string;
  title?: string;
  subtitle?: string;
  art_url?: string | null;
}

export interface PlayerViewProps {
  snap: SimpStateSnapshot | null;
  track: TrackMetadata | null | undefined;
  isPlaying: boolean;
  opticalDisc: OpticalDiscStatus | null;
  browserTarget: BrowserTarget | null;
  playingContextId: string;
  setBrowserTarget: React.Dispatch<React.SetStateAction<BrowserTarget | null>>;
  setView: React.Dispatch<React.SetStateAction<'lock' | 'browser'>>;
  handleOpenFullAppleAlbum: (params: {
    albumId?: string | null;
    songUri?: string | null;
    fallbackTitle?: string;
  }) => Promise<void>;
  handleStartSoundCloudTrackRadio?: (seedTrack: TrackMetadata) => void;
  handleAddTracksToPlaylist?: (
    uris: string[],
    label: string,
    trackMetadata?: TrackMetadata[]
  ) => Promise<void>;
  handleFavoriteTrack?: (track: TrackMetadata) => Promise<void>;
  handleMoreByArtist?: (artistName: string) => void;
  applyFocusMarker?: (el: HTMLElement | null) => void;
  showToast?: (msg: string) => void;
}

interface ActiveCommentBubble {
  comment: SoundCloudComment;
  slot: 0 | 1;
  expiresAt: number;
}

function formatCommentTs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '💬';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function computePlayerViewportScale(): number {
  if (typeof window === 'undefined') return 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw <= 1340 && vh <= 840) return 1;
  const scaleX = (vw - 96) / 1060;
  const scaleY = (vh - 130) / 500;
  return Math.min(2.35, Math.max(1, Math.min(scaleX, scaleY)));
}

export const PlayerView: React.FC<PlayerViewProps> = ({
  snap,
  track,
  isPlaying,
  opticalDisc,
  browserTarget,
  playingContextId,
  setBrowserTarget,
  setView,
  handleOpenFullAppleAlbum,
  handleStartSoundCloudTrackRadio,
  handleAddTracksToPlaylist,
  handleFavoriteTrack,
  handleMoreByArtist,
  applyFocusMarker,
  showToast,
}) => {
  const isSoundCloudTrack = track?.source === 'soundcloud';

  const [scCommentsEnabled, setScCommentsEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('simp_sc_comments_enabled') !== '0';
    } catch {
      return true;
    }
  });
  const [scComments, setScComments] = useState<SoundCloudComment[]>([]);
  const [scWaveformBars, setScWaveformBars] = useState<number[] | null>(null);
  const [activeBubbles, setActiveBubbles] = useState<ActiveCommentBubble[]>([]);
  const [playerActionsOpen, setPlayerActionsOpen] = useState<boolean>(false);
  const [playerScale, setPlayerScale] = useState<number>(computePlayerViewportScale);
  const shownCommentIdsRef = useRef<Set<string>>(new Set());
  const lastPlayheadMsRef = useRef<number>(0);

  useEffect(() => {
    const onResize = () => setPlayerScale(computePlayerViewportScale());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Listen for `SELECT` button (`simp-player-actions-toggle`) on Player screen
  useEffect(() => {
    const onToggleActions = () => {
      setPlayerActionsOpen((prev) => !prev);
    };
    window.addEventListener('simp-player-actions-toggle', onToggleActions);
    return () => window.removeEventListener('simp-player-actions-toggle', onToggleActions);
  }, []);

  // Focus first item when Player Track Actions Overlay opens
  useEffect(() => {
    if (!playerActionsOpen) return;
    const t = window.setTimeout(() => {
      const firstBtn =
        document.querySelector<HTMLElement>(
          '[data-player-actions-modal="true"] button[data-default-focus="true"]:not([disabled])'
        ) ||
        document.querySelector<HTMLElement>(
          '[data-player-actions-modal="true"] button:not([disabled])'
        );
      if (firstBtn && applyFocusMarker) {
        applyFocusMarker(firstBtn);
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [playerActionsOpen, applyFocusMarker]);

  const toggleScComments = useCallback(() => {
    setScCommentsEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('simp_sc_comments_enabled', next ? '1' : '0');
      } catch {}
      if (!next) {
        setActiveBubbles([]);
      }
      showToast?.(
        next ? '💬 SoundCloud timed comment bubbles ON' : '💬 SoundCloud timed comment bubbles OFF'
      );
      return next;
    });
  }, [showToast]);

  useEffect(() => {
    shownCommentIdsRef.current.clear();
    setActiveBubbles([]);
    lastPlayheadMsRef.current = 0;

    if (!isSoundCloudTrack || !track?.uri) {
      setScComments([]);
      setScWaveformBars(null);
      return;
    }

    let cancelled = false;
    fetchSoundCloudTrackComments(track.uri)
      .then((comments) => {
        if (!cancelled) {
          setScComments(comments);
        }
      })
      .catch(() => {});

    fetchSoundCloudTrackWaveform(track.uri)
      .then((wf) => {
        if (!cancelled) {
          setScWaveformBars(wf?.bars || null);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isSoundCloudTrack, track?.uri]);

  // Periodically prune expired comment speech bubbles
  useEffect(() => {
    if (activeBubbles.length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setActiveBubbles((prev) => {
        const filtered = prev.filter((b) => b.expiresAt > now);
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [activeBubbles.length]);

  const commentTimestampsMs = useMemo(
    () =>
      scComments
        .map((c) => c.timestamp_ms)
        .filter((ts): ts is number => typeof ts === 'number' && ts >= 0),
    [scComments]
  );

  const handlePlayheadTick = useCallback(
    (currentMs: number) => {
      if (!isSoundCloudTrack || !scCommentsEnabled || scComments.length === 0) return;

      // Reset shown IDs if user seeked backward or track looped
      if (currentMs + 2500 < lastPlayheadMsRef.current) {
        shownCommentIdsRef.current.clear();
      }
      lastPlayheadMsRef.current = currentMs;

      const durMs = Math.max(track?.duration_ms || 180_000, 30_000);
      const match = scComments.find((c, idx) => {
        if (shownCommentIdsRef.current.has(c.id)) return false;
        const effectiveTs =
          c.timestamp_ms !== null && c.timestamp_ms > 0
            ? c.timestamp_ms
            : Math.round(((idx + 1) / (scComments.length + 1)) * durMs);
        return currentMs >= effectiveTs - 350 && currentMs <= effectiveTs + 1850;
      });

      if (!match) return;
      shownCommentIdsRef.current.add(match.id);

      const now = Date.now();
      setActiveBubbles((prev) => {
        const alive = prev.filter((b) => b.expiresAt > now);
        if (alive.length >= 2) return alive;
        const usedSlot0 = alive.some((b) => b.slot === 0);
        const slot: 0 | 1 = usedSlot0 ? 1 : 0;
        return [...alive, { comment: match, slot, expiresAt: now + 5000 }];
      });
    },
    [isSoundCloudTrack, scCommentsEnabled, scComments, track?.duration_ms]
  );

  const handleOpenCurrentCollection = useCallback(() => {
    setPlayerActionsOpen(false);
    if (playingContextId) {
      const sep = playingContextId.indexOf(':');
      if (sep > 0) {
        const ctxKind = playingContextId.slice(0, sep);
        const ctxId = playingContextId.slice(sep + 1);
        if (
          ctxKind === 'playlist' ||
          ctxKind === 'album' ||
          ctxKind === 'mount' ||
          ctxKind === 'cdda' ||
          ctxKind === 'cloud_playlist' ||
          ctxKind === 'cloud_album' ||
          ctxKind === 'soundcloud_playlist' ||
          ctxKind === 'ia_item'
        ) {
          setBrowserTarget({ kind: ctxKind, id: ctxId });
          setView('browser');
          return;
        }
      }
    }
    if (track?.source === 'internet_archive') {
      const rawId =
        track.album_id?.replace(/^ia:/, '') ||
        track.uri.replace(/^ia:audio:/, '').split('/')[0];
      if (rawId) {
        setBrowserTarget({
          kind: 'ia_item',
          id: rawId,
          title: track.album || track.title,
          subtitle: track.artists?.join(', '),
          art_url: track.art_url,
        });
        setView('browser');
        return;
      }
    }
    if (track?.source === 'apple_music') {
      handleOpenFullAppleAlbum({
        songUri: track.uri,
        fallbackTitle: track.album || track.title,
      });
      return;
    }
    if (track?.source === 'cdda') {
      setBrowserTarget({
        kind: 'cdda',
        id: opticalDisc?.disc_id || opticalDisc?.device_path || '/dev/sr0',
        title: `💿 ${opticalDisc?.album_title || track.album || 'Audio CD'}`,
        subtitle: opticalDisc?.artist_name || track.artists?.join(', ') || 'Audio CD',
        art_url: opticalDisc?.art_url || track.art_url,
      });
      setView('browser');
      return;
    }
    if (track?.album_id) {
      setBrowserTarget({ kind: 'album', id: track.album_id });
      setView('browser');
      return;
    }
    setView('browser');
  }, [
    playingContextId,
    track,
    opticalDisc,
    setBrowserTarget,
    setView,
    handleOpenFullAppleAlbum,
  ]);

  const primaryArtist = track?.artists?.[0]?.trim() || '';

  return (
    <main
      style={{
        flex: 1,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 28px',
        width: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '260px 1fr',
          alignItems: 'center',
          gap: 36,
          maxWidth: 1060,
          width: '100%',
          margin: '0 auto',
          transform: playerScale > 1.02 ? `scale(${playerScale})` : undefined,
          transformOrigin: 'center center',
        }}
      >
        {/* Left Column: Clean 240x240 Album Art + Shuffle (X), Repeat (Y), & Track Actions (SELECT) Below */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 240,
              height: 240,
              borderRadius: 20,
              background: '#0a0a0e',
              border: '1px solid #1e1e28',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              boxShadow: '0 14px 34px rgba(0, 0, 0, 0.65)',
            }}
          >
            {track?.art_url ? (
              <img
                src={track.art_url}
                alt={track.album}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: 'brightness(0.88)',
                }}
              />
            ) : (
              <img
                src="/simp-icon-dark.png"
                alt="SIMP"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: 'brightness(0.82)',
                }}
              />
            )}
          </div>

          {/* Queue Mode & Track Actions Controls: Shuffle (X), Loop/Repeat (Y), & Track Actions (SELECT) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <TransportIconButton
              icon="🔀"
              badge="X"
              active={!!snap?.shuffle}
              onClick={() => defaultSimpClient.setShuffle(!snap?.shuffle)}
            />
            <TransportIconButton
              icon="🔁"
              badge={
                snap?.repeat_mode === 'track'
                  ? 'Y•1'
                  : snap?.repeat_mode === 'queue'
                  ? 'Y•Q'
                  : 'Y'
              }
              active={snap?.repeat_mode !== 'off'}
              onClick={() => defaultSimpClient.cycleRepeat()}
            />
            <TransportIconButton
              icon="⋯"
              badge="SELECT"
              active={playerActionsOpen}
              onClick={() => setPlayerActionsOpen((v) => !v)}
            />
          </div>
        </div>

        {/* Right Column: Track Info + Ephemeral SoundCloud Comment Bubbles (+25% scaled) + Tall Scrub Bar + Centered Transport Row */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
            minWidth: 0,
            overflow: 'visible',
            position: 'relative',
          }}
        >
          <div style={{ minWidth: 0, position: 'relative' }}>
            <h1
              style={{
                margin: 0,
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: -0.5,
                color: '#d4d4dc',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {track?.title || 'No Track Loaded'}
            </h1>
            <p
              style={{
                margin: '6px 0 0',
                fontSize: 16,
                color: '#8e8e99',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {track?.artists?.join(', ') || (
                <>
                  Select a track from Library & Queue<span className="simp-gp-badge"> (R1)</span>
                </>
              )}
              {track?.album ? ` • ${track.album}` : ''}
            </p>
          </div>

          <div style={{ position: 'relative', width: '100%' }}>
            {/* Ephemeral SoundCloud Timed Comment Speech Bubbles (+25% larger, out-of-flow overlay above scrub rail) */}
            {isSoundCloudTrack && scCommentsEnabled && activeBubbles.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% - 8px)',
                  left: 14,
                  right: 14,
                  display: 'flex',
                  justifyContent: 'flex-start',
                  gap: 12,
                  pointerEvents: 'none',
                  zIndex: 25,
                }}
              >
                {activeBubbles.map((b) => {
                  const dur = track?.duration_ms || 0;
                  const pct =
                    dur > 0 && Number.isFinite(b.comment.timestamp_ms)
                      ? Math.max(0, Math.min(46, (b.comment.timestamp_ms / dur) * 100))
                      : 0;
                  return (
                    <div
                      key={b.comment.id}
                      style={{
                        marginLeft: b.slot === 0 && activeBubbles.length === 1 ? `${pct}%` : 0,
                        maxWidth: activeBubbles.length > 1 ? '54%' : '82%',
                        minWidth: 240,
                        padding: '8px 14px',
                        borderRadius: 15,
                        borderBottomLeftRadius: b.slot === 0 ? 4 : 15,
                        borderBottomRightRadius: b.slot === 1 ? 4 : 15,
                        background: 'rgba(14, 12, 20, 0.96)',
                        border: '1px solid rgba(251, 146, 60, 0.6)',
                        boxShadow: '0 10px 26px rgba(0, 0, 0, 0.88)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      {b.comment.avatar_url ? (
                        <img
                          src={b.comment.avatar_url}
                          alt=""
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 99,
                            objectFit: 'cover',
                            border: '1px solid #ea580c',
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 99,
                            background: '#27150c',
                            border: '1px solid #ea580c',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 15,
                            flexShrink: 0,
                          }}
                        >
                          💬
                        </div>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 12.5,
                            fontFamily: 'monospace',
                            color: '#fdba74',
                            fontWeight: 800,
                          }}
                        >
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            @{b.comment.username}
                          </span>
                          <span
                            style={{
                              padding: '2px 7px',
                              borderRadius: 6,
                              background: '#27150c',
                              border: '1px solid #7c2d12',
                              color: '#fb923c',
                              fontSize: 11.5,
                              flexShrink: 0,
                            }}
                          >
                            {formatCommentTs(b.comment.timestamp_ms)}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 14.5,
                            color: '#f4f4f6',
                            marginTop: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          “{b.comment.body.slice(0, 120)}”
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <ProgressBarRaf
              durationMs={track?.duration_ms ?? 0}
              trackUri={track?.uri}
              waveformBars={isSoundCloudTrack ? scWaveformBars : null}
              commentTimestampsMs={
                isSoundCloudTrack && scCommentsEnabled ? commentTimestampsMs : undefined
              }
              onPlayheadTick={isSoundCloudTrack ? handlePlayheadTick : undefined}
            />
          </div>

          {/* Symmetrical Centered Transport Row: Rewind (L2) | Prev (◄) | Play/Pause (A) | Next (►) | Fast-Forward (R2) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <TransportIconButton
              icon="⏪"
              badge="L2"
              onClick={() => defaultSimpClient.seekRelative(-10_000)}
            />
            <TransportIconButton
              icon="⏮"
              badge="◄"
              onClick={() => defaultSimpClient.previous()}
            />
            <button
              data-default-focus="true"
              onClick={() => defaultSimpClient.togglePlayPause()}
              title={isPlaying ? 'Pause (Silence Audio)' : 'Resume Playback'}
              style={{
                width: 96,
                height: 92,
                borderRadius: 24,
                background: isPlaying ? '#0f222a' : '#12121a',
                color: isPlaying ? '#bfeaf5' : '#d4d4dc',
                border: isPlaying ? '2px solid #2aa3c4' : '2px solid #3f3f4e',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                cursor: 'pointer',
                fontWeight: 900,
              }}
            >
              <span style={{ fontSize: 30 }}>{isPlaying ? '⏸' : '▶'}</span>
              <span
                className="simp-gp-badge"
                style={{
                  padding: '2px 10px',
                  borderRadius: 99,
                  background: isPlaying ? '#16313c' : '#1f1f2b',
                  color: isPlaying ? '#7dd3fc' : '#a1a1aa',
                  fontSize: 11,
                  fontFamily: 'monospace',
                }}
              >
                {isPlaying ? 'A • 🔊' : 'A • 🔇'}
              </span>
            </button>
            <TransportIconButton
              icon="⏭"
              badge="►"
              onClick={() => defaultSimpClient.next()}
            />
            <TransportIconButton
              icon="⏩"
              badge="R2"
              onClick={() => defaultSimpClient.seekRelative(10_000)}
            />
          </div>

          {/* Clean Non-Focus-Stealing Up Next Readout Strip */}
          {snap?.up_next && snap.up_next.length > 0 ? (
            <div
              style={{
                width: '100%',
                padding: '9px 14px',
                borderRadius: 12,
                background: '#08080c',
                border: '1px solid #1a202c',
                fontSize: 12,
                color: '#a1a1aa',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                minWidth: 0,
                boxSizing: 'border-box',
              }}
            >
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  marginRight: 12,
                }}
              >
                <strong style={{ fontFamily: 'monospace', color: '#2aa3c4', marginRight: 8 }}>
                  NEXT:
                </strong>
                {snap.up_next[0].title} — {snap.up_next[0].artists.join(', ')}
              </span>
              <span
                className="simp-gp-badge"
                style={{
                  fontFamily: 'monospace',
                  color: '#71717a',
                  fontSize: 11,
                  flexShrink: 0,
                }}
              >
                SELECT • Actions
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Unified Controller-First `SELECT` Track Actions Overlay Menu */}
      {playerActionsOpen && (
        <div
          onClick={() => setPlayerActionsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.82)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            boxSizing: 'border-box',
            zIndex: 55,
          }}
        >
          <div
            data-modal-root="true"
            data-player-actions-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 460,
              background: '#0a0a10',
              border: '2px solid #2aa3c4',
              borderRadius: 20,
              padding: 20,
              boxSizing: 'border-box',
              boxShadow: '0 18px 48px rgba(0, 0, 0, 0.9)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: 8,
                borderBottom: '1px solid #1e1e2a',
              }}
            >
              <div style={{ minWidth: 0, flex: 1, marginRight: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#bfeaf5' }}>
                  🎵 Track & Player Actions
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#8e8e99',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginTop: 2,
                  }}
                >
                  {track ? `${track.title} — ${track.artists.join(', ')}` : 'No active track'}
                </div>
              </div>
              <button
                type="button"
                data-player-actions-close="true"
                onClick={() => setPlayerActionsOpen(false)}
                style={{
                  minHeight: 38,
                  padding: '0 12px',
                  borderRadius: 10,
                  background: '#16161f',
                  border: '1px solid #2e2e3a',
                  color: '#d4d4dc',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                ✕<span className="simp-gp-badge"> B</span>
              </button>
            </div>

            {/* 1. Open Collection / Album / Playlist in Library */}
            <button
              type="button"
              data-default-focus="true"
              onClick={handleOpenCurrentCollection}
              style={actionRowBtnStyle}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#f4f4f6' }}>
                  💿 Open Collection in Library
                </span>
                <span style={{ fontSize: 11, color: '#8e8e99' }}>
                  Jump to the active album, playlist, or queue in the Right Pane
                </span>
              </div>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#2aa3c4' }}>→</span>
            </button>

            {/* 2. Favorite / Like Track (Unified across SoundCloud + ❤️ Favorites SIMP Hybrid Playlist) */}
            {track && (
              <button
                type="button"
                onClick={() => {
                  setPlayerActionsOpen(false);
                  if (track.source === 'soundcloud') {
                    likeSoundCloudTrack(track.uri, showToast);
                  }
                  if (handleFavoriteTrack) {
                    handleFavoriteTrack(track);
                  }
                }}
                style={actionRowBtnStyle}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#fda4af' }}>
                    ❤️ Favorite Track
                  </span>
                  <span style={{ fontSize: 11, color: '#8e8e99' }}>
                    {track.source === 'soundcloud'
                      ? 'Like on SoundCloud & save to ★ Favorites playlist'
                      : 'Save to your ★ Favorites SIMP Hybrid Playlist'}
                  </span>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#fda4af' }}>+ ❤️</span>
              </button>
            )}

            {/* 3. Add to ★ SIMP Hybrid Playlist */}
            {track && handleAddTracksToPlaylist && (
              <button
                type="button"
                onClick={() => {
                  setPlayerActionsOpen(false);
                  handleAddTracksToPlaylist([track.uri], `"${track.title}"`, [track]);
                }}
                style={actionRowBtnStyle}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#67e8f9' }}>
                    ★ Add to Hybrid Playlist…
                  </span>
                  <span style={{ fontSize: 11, color: '#8e8e99' }}>
                    Mix Local, Apple Music & SoundCloud tracks in any SIMP playlist
                  </span>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#67e8f9' }}>+ ★</span>
              </button>
            )}

            {/* 4. Start Track Radio / Station */}
            {track && (track.source === 'soundcloud' || primaryArtist) && (
              <button
                type="button"
                onClick={() => {
                  setPlayerActionsOpen(false);
                  if (track.source === 'soundcloud' && handleStartSoundCloudTrackRadio) {
                    handleStartSoundCloudTrackRadio(track);
                  } else if (primaryArtist && handleMoreByArtist) {
                    handleMoreByArtist(primaryArtist);
                  }
                }}
                style={actionRowBtnStyle}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#fdba74' }}>
                    📻 {track.source === 'soundcloud' ? 'Start Track Radio' : `Artist Mix: ${primaryArtist}`}
                  </span>
                  <span style={{ fontSize: 11, color: '#8e8e99' }}>
                    {track.source === 'soundcloud'
                      ? `Continuous SoundCloud station seeded from "${track.title}"`
                      : `Browse tracks, albums & stations for ${primaryArtist}`}
                  </span>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#fdba74' }}>▶</span>
              </button>
            )}

            {/* 5. More by Artist */}
            {primaryArtist && handleMoreByArtist && (
              <button
                type="button"
                onClick={() => {
                  setPlayerActionsOpen(false);
                  handleMoreByArtist(primaryArtist);
                }}
                style={actionRowBtnStyle}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#d4d4dc' }}>
                    👤 More by {primaryArtist}
                  </span>
                  <span style={{ fontSize: 11, color: '#8e8e99' }}>
                    Search Library & connected catalogs for {primaryArtist}
                  </span>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#9ca3af' }}>🔍</span>
              </button>
            )}

            {/* 6. Toggle Timed Comments (SoundCloud only) */}
            {isSoundCloudTrack && (
              <button
                type="button"
                onClick={() => {
                  toggleScComments();
                }}
                style={{
                  ...actionRowBtnStyle,
                  background: scCommentsEnabled ? '#1f120b' : '#101018',
                  border: scCommentsEnabled ? '1px solid #ea580c' : '1px solid #222230',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#fdba74' }}>
                    💬 Timed Comment Bubbles: {scCommentsEnabled ? 'ON' : 'OFF'}
                  </span>
                  <span style={{ fontSize: 11, color: '#8e8e99' }}>
                    {scComments.length} timed comments on this track
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: 800,
                    color: scCommentsEnabled ? '#fdba74' : '#71717a',
                  }}
                >
                  {scCommentsEnabled ? 'ON' : 'OFF'}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
};

const actionRowBtnStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 52,
  padding: '10px 14px',
  borderRadius: 12,
  background: '#101018',
  border: '1px solid #222230',
  color: '#f4f4f6',
  textAlign: 'left',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  cursor: 'pointer',
};

interface TransportBtnProps {
  icon: string;
  badge: string;
  active?: boolean;
  onClick: () => void;
}

const TransportIconButton: React.FC<TransportBtnProps> = ({ icon, badge, active, onClick }) => (
  <button
    onClick={onClick}
    style={{
      width: 76,
      height: 76,
      borderRadius: 18,
      background: active ? '#0d1b22' : '#0a0a0e',
      border: active ? '2px solid #2aa3c4' : '2px solid #1e1e28',
      color: '#d4d4dc',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      cursor: 'pointer',
    }}
  >
    <span style={{ fontSize: 24 }}>{icon}</span>
    <span
      className="simp-gp-badge"
      style={{
        padding: '2px 8px',
        borderRadius: 99,
        background: '#14141c',
        border: '1px solid #262632',
        fontSize: 12,
        fontFamily: 'monospace',
        color: active ? '#7dd3fc' : '#8e8e99',
        fontWeight: 700,
      }}
    >
      {badge}
    </span>
  </button>
);
