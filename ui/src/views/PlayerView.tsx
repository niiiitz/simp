import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveItemDetail,
  defaultSimpClient,
  DvdTitleInfo,
  OpticalDiscStatus,
  SimpStateSnapshot,
  SoundCloudComment,
  TrackMetadata,
  VideoQualityVariant,
  VideoSubtitleVariant,
} from '@simp/client';
import { ProgressBarRaf } from '../components/ProgressBarRaf';
import {
  PlayerBackgroundVisualizer,
  VISUALIZER_MODES,
  type VisualizerMode,
} from '../components/PlayerBackgroundVisualizer';
import {
  fetchSoundCloudTrackComments,
  fetchSoundCloudTrackWaveform,
  likeSoundCloudTrack,
  SoundCloudMixChapter,
  toggleFollowSoundCloudUser,
} from '../drivers/SoundCloudDriver';

export interface BrowserTarget {
  kind:
    | 'album'
    | 'playlist'
    | 'mount'
    | 'cloud_playlist'
    | 'cloud_album'
    | 'soundcloud_playlist'
    | 'soundcloud_user'
    | 'ia_discover'
    | 'ia_item'
    | 'cdda';
  id: string;
  title?: string;
  subtitle?: string;
  art_url?: string | null;
}

export interface PlayerViewProps {
  hidden?: boolean;
  snap: SimpStateSnapshot | null;
  track: TrackMetadata | null | undefined;
  isPlaying: boolean;
  opticalDisc: OpticalDiscStatus | null;
  browserTarget: BrowserTarget | null;
  playingContextId: string;
  setBrowserTarget: React.Dispatch<React.SetStateAction<BrowserTarget | null>>;
  setBrowserTracks?: React.Dispatch<React.SetStateAction<TrackMetadata[]>>;
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
  handleMoreByArtist?: (artistName: string, preferredSource?: string) => void;
  applyFocusMarker?: (el: HTMLElement | null) => void;
  showToast?: (msg: string) => void;
}

interface ActiveCommentBubble {
  comment: SoundCloudComment;
  slot: 0 | 1;
  placement: 'above' | 'below';
  expiresAt: number;
}

const iaDetailMemoryCache = new Map<string, ArchiveItemDetail>();

export function isUiVideoTrack(track: TrackMetadata | null | undefined): boolean {
  if (!track) return false;
  return (
    track.source === 'ia_video' ||
    track.source === 'local_video' ||
    track.source === 'dvd' ||
    track.uri.startsWith('ia:video:') ||
    track.uri.startsWith('ia://video/') ||
    track.uri.startsWith('video://local/') ||
    track.uri.startsWith('dvd://')
  );
}

function formatCommentTs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '💬';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function computePlayerViewportScale(isVideo = false): number {
  if (typeof window === 'undefined') return 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw <= 1340 && vh <= 840) return 1;
  const baseWidth = isVideo ? 1140 : 1060;
  const scaleX = (vw - 192) / baseWidth;
  const scaleY = (vh - 150) / 520;
  const maxScale = isVideo ? 1.75 : 1.95;
  return Math.min(maxScale, Math.max(1, Math.min(scaleX, scaleY)));
}

export const PlayerView: React.FC<PlayerViewProps> = ({
  hidden = false,
  snap,
  track,
  isPlaying,
  opticalDisc,
  browserTarget,
  playingContextId,
  setBrowserTarget,
  setBrowserTracks,
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
  const isVideoTrack = isUiVideoTrack(track);

  const [scCommentsEnabled, setScCommentsEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('simp_sc_comments_enabled') !== '0';
    } catch {
      return true;
    }
  });
  const [scComments, setScComments] = useState<SoundCloudComment[]>([]);
  const [scWaveformBars, setScWaveformBars] = useState<number[] | null>(null);
  const [scTrackBpm, setScTrackBpm] = useState<number | null>(null);
  const [scMixChapters, setScMixChapters] = useState<SoundCloudMixChapter[]>([]);
  const [scTrackUserId, setScTrackUserId] = useState<string | null>(null);
  const [scCreatorFollowed, setScCreatorFollowed] = useState<boolean>(false);
  const [vizMode, setVizMode] = useState<VisualizerMode>(() => {
    try {
      const saved = window.localStorage.getItem('simp.visualizer_mode') as VisualizerMode | null;
      if (
        saved === 'glyph' ||
        saved === 'avs' ||
        saved === 'demoscene' ||
        saved === 'cycle' ||
        saved === 'off'
      ) {
        return saved;
      }
    } catch {}
    return 'glyph';
  });
  const [rightColMode, setRightColMode] = useState<'queue' | 'chapters'>('queue');
  const [activeBubbles, setActiveBubbles] = useState<ActiveCommentBubble[]>([]);
  const [playerActionsOpen, setPlayerActionsOpen] = useState<boolean>(false);
  const [playerScale, setPlayerScale] = useState<number>(() =>
    computePlayerViewportScale(isVideoTrack)
  );
  const shownCommentIdsRef = useRef<Set<string>>(new Set());
  const lastPlayheadMsRef = useRef<number>(0);
  const nextCommentPlacementRef = useRef<'above' | 'below'>('above');

  // Unified Video Modality State (`ia_video`, `local_video`, `dvd`)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoTheatreExpanded, setVideoTheatreExpanded] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );
  const [hudVisible, setHudVisible] = useState<boolean>(true);
  const hudTimerRef = useRef<number | null>(null);
  const lastTimeReportMsRef = useRef<number>(0);
  const pendingResumeTimeSecRef = useRef<number>(0);

  const [videoQualities, setVideoQualities] = useState<VideoQualityVariant[]>([]);
  const [selectedQualityIdx, setSelectedQualityIdx] = useState<number>(0);
  const [videoSubtitles, setVideoSubtitles] = useState<VideoSubtitleVariant[]>([]);
  const [selectedSubtitleIdx, setSelectedSubtitleIdx] = useState<number>(-1);
  const [resolvedSubtitleBlobUrl, setResolvedSubtitleBlobUrl] = useState<string | null>(null);
  const [videoErrorMsg, setVideoErrorMsg] = useState<string | null>(null);
  const [iaDetail, setIaDetail] = useState<ArchiveItemDetail | null>(null);
  const [dvdTitles, setDvdTitles] = useState<DvdTitleInfo[]>([]);
  const [dvdSeekOffsetSec, setDvdSeekOffsetSec] = useState<number>(0);

  useEffect(() => {
    setPlayerScale(computePlayerViewportScale(isVideoTrack));
    const onResize = () => setPlayerScale(computePlayerViewportScale(isVideoTrack));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isVideoTrack]);

  const togglePlayerFullscreen = useCallback(() => {
    if (isVideoTrack) {
      setVideoTheatreExpanded((prev) => {
        const next = !prev;
        if (next) {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.().catch(() => {});
          }
        } else if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        return next;
      });
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    }
  }, [isVideoTrack]);

  // Listen for `SELECT` button (`simp-player-actions-toggle`), `F`/`Alt+F`/`F11` (`simp-player-fullscreen-toggle`), and `fullscreenchange`
  useEffect(() => {
    const onToggleActions = () => {
      setPlayerActionsOpen((prev) => !prev);
    };
    const onToggleFullscreen = () => {
      togglePlayerFullscreen();
    };
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    window.addEventListener('simp-player-actions-toggle', onToggleActions);
    window.addEventListener('simp-player-fullscreen-toggle', onToggleFullscreen);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      window.removeEventListener('simp-player-actions-toggle', onToggleActions);
      window.removeEventListener('simp-player-fullscreen-toggle', onToggleFullscreen);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [togglePlayerFullscreen]);

  // 4-Second (`4000ms`) Floating Controls & Scrub Bar Auto-Hide Timer in Expanded Theatre Mode
  const wakeFloatingHud = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current) {
      window.clearTimeout(hudTimerRef.current);
      hudTimerRef.current = null;
    }
    if (videoTheatreExpanded && isPlaying && !playerActionsOpen) {
      hudTimerRef.current = window.setTimeout(() => {
        setHudVisible(false);
      }, 4000);
    }
  }, [videoTheatreExpanded, isPlaying, playerActionsOpen]);

  useEffect(() => {
    if (!videoTheatreExpanded || !isPlaying || playerActionsOpen) {
      setHudVisible(true);
      if (hudTimerRef.current) {
        window.clearTimeout(hudTimerRef.current);
        hudTimerRef.current = null;
      }
      return;
    }
    wakeFloatingHud();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, wakeFloatingHud, { passive: true }));

    // Also poll gamepad buttons/axes lightly while in Expanded Theatre so D-pad/stick wakes the HUD
    let lastGpSignature = '';
    const gpPoll = window.setInterval(() => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        if (!p) continue;
        const pressed = p.buttons.map((b) => (b.pressed ? '1' : '0')).join('');
        const axes = p.axes.map((a) => (Math.abs(a) > 0.35 ? a.toFixed(1) : '0')).join(',');
        const sig = `${pressed}|${axes}`;
        if (lastGpSignature && sig !== lastGpSignature) {
          wakeFloatingHud();
        }
        lastGpSignature = sig;
        break;
      }
    }, 150);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, wakeFloatingHud));
      window.clearInterval(gpPoll);
      if (hudTimerRef.current) {
        window.clearTimeout(hudTimerRef.current);
        hudTimerRef.current = null;
      }
    };
  }, [videoTheatreExpanded, isPlaying, playerActionsOpen, wakeFloatingHud]);

  // Allow `B` / `Escape` to exit Expanded Theatre back to Card View when Track Actions modal is closed
  useEffect(() => {
    if (!videoTheatreExpanded || playerActionsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        setVideoTheatreExpanded(false);
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [videoTheatreExpanded, playerActionsOpen]);

  // Resolve video stream qualities, subtitles, and metadata when `track.uri` changes
  useEffect(() => {
    setVideoErrorMsg(null);
    setSelectedQualityIdx(0);
    setSelectedSubtitleIdx(-1);
    setDvdSeekOffsetSec(0);
    pendingResumeTimeSecRef.current = 0;

    if (!isVideoTrack || !track?.uri) {
      setVideoQualities([]);
      setVideoSubtitles([]);
      setIaDetail(null);
      setDvdTitles([]);
      setVideoTheatreExpanded(false);
      return;
    }

    let cancelled = false;
    const uri = track.uri;

    if (uri.startsWith('ia:video:') || uri.startsWith('ia://video/')) {
      const cleaned = uri.replace(/^ia:video:/, '').replace(/^ia:\/\/video\//, '');
      const parts = cleaned.split('/');
      const identifier = decodeURIComponent(parts[0] || '');
      const epIdx = Math.max(0, parseInt(parts[1] || '0', 10) || 0);

      const applyDetail = (detail: ArchiveItemDetail) => {
        if (cancelled) return;
        setIaDetail(detail);
        const ep = detail.episodes[epIdx] || detail.episodes[0];
        if (ep) {
          setVideoQualities(ep.qualities || []);
          setVideoSubtitles(ep.subtitles || []);
        } else {
          setVideoQualities([]);
          setVideoSubtitles([]);
        }
      };

      const cached = iaDetailMemoryCache.get(identifier);
      if (cached) {
        applyDetail(cached);
      } else {
        fetch(`/api/ia/item?id=${encodeURIComponent(identifier)}`)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })
          .then((d) => {
            const detail: ArchiveItemDetail | undefined = d?.detail || d?.data;
            if (!detail) throw new Error(d?.error || 'Missing detail');
            iaDetailMemoryCache.set(identifier, detail);
            applyDetail(detail);
          })
          .catch((err) => {
            if (!cancelled) {
              setVideoErrorMsg(`Failed to load Internet Archive video metadata: ${err}`);
            }
          });
      }
    } else if (uri.startsWith('video://local/')) {
      const rawPath = decodeURIComponent(uri.replace(/^video:\/\/local\//, ''));
      setVideoQualities([
        {
          label: 'Direct Play (Original)',
          format: 'mp4',
          stream_url: `/api/video/local?path=${encodeURIComponent(rawPath)}`,
          size_bytes: null,
        },
        {
          label: 'Compatibility MP4 (ffmpeg)',
          format: 'mp4',
          stream_url: `/api/video/local?path=${encodeURIComponent(rawPath)}&transcode=1`,
          size_bytes: null,
        },
      ]);
      setVideoSubtitles([]);
    } else if (uri.startsWith('dvd://')) {
      // Format: `dvd:///dev/sr0/1` or `dvd:///dev/sr0`
      const withoutScheme = uri.replace(/^dvd:\/\//, '');
      const lastSlash = withoutScheme.lastIndexOf('/');
      let devicePath = opticalDisc?.device_path || '/dev/sr0';
      let titleNum = 1;
      if (lastSlash > 0 && /^\d+$/.test(withoutScheme.slice(lastSlash + 1))) {
        devicePath = withoutScheme.slice(0, lastSlash);
        titleNum = parseInt(withoutScheme.slice(lastSlash + 1), 10) || 1;
      } else if (withoutScheme) {
        devicePath = withoutScheme;
      }
      const titles = opticalDisc?.dvd_titles || [];
      setDvdTitles(titles);
      const chosenTitle =
        titles.find((t: DvdTitleInfo) => t.title_number === titleNum) || titles[0];
      const tNum = chosenTitle?.title_number || titleNum;
      const audioVariants: VideoQualityVariant[] =
        chosenTitle && chosenTitle.audio_tracks.length > 0
          ? chosenTitle.audio_tracks.map((a, idx) => ({
              label: `Audio ${idx + 1}: ${a.lang_name || a.lang_code.toUpperCase()} (${a.codec.toUpperCase()} ${a.channels}ch)`,
              format: 'mp4',
              stream_url: `/api/dvd/stream?device=${encodeURIComponent(devicePath)}&title=${tNum}&audio=${a.stream_index ?? idx}`,
              size_bytes: null,
            }))
          : [
              {
                label: 'DVD Main Audio (MP4 Stream)',
                format: 'mp4',
                stream_url: `/api/dvd/stream?device=${encodeURIComponent(devicePath)}&title=${tNum}&audio=0`,
                size_bytes: null,
              },
            ];
      setVideoQualities(audioVariants);
      setVideoSubtitles([]);
    }

    return () => {
      cancelled = true;
    };
  }, [isVideoTrack, track?.uri, opticalDisc?.device_path, opticalDisc?.dvd_titles]);

  // Load selected `.vtt` subtitle track into a same-origin Blob URL so `<video>` never needs `crossOrigin="anonymous"`
  const activeSubtitle =
    selectedSubtitleIdx >= 0 && selectedSubtitleIdx < videoSubtitles.length
      ? videoSubtitles[selectedSubtitleIdx]
      : null;

  useEffect(() => {
    let activeBlobUrl: string | null = null;
    let cancelled = false;

    if (!activeSubtitle?.vtt_url) {
      setResolvedSubtitleBlobUrl(null);
      return;
    }

    fetch(activeSubtitle.vtt_url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((vttText) => {
        if (cancelled) return;
        const blob = new Blob([vttText], { type: 'text/vtt;charset=utf-8' });
        activeBlobUrl = URL.createObjectURL(blob);
        setResolvedSubtitleBlobUrl(activeBlobUrl);
      })
      .catch(() => {
        if (!cancelled) setResolvedSubtitleBlobUrl(null);
      });

    return () => {
      cancelled = true;
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
    };
  }, [activeSubtitle?.vtt_url]);

  // Compute active video stream URL
  const activeQuality = videoQualities[selectedQualityIdx] || videoQualities[0] || null;
  const activeStreamUrl = useMemo(() => {
    if (!activeQuality) return '';
    if (track?.uri?.startsWith('dvd://') && dvdSeekOffsetSec > 0) {
      return `${activeQuality.stream_url}&seek_ms=${Math.round(dvdSeekOffsetSec * 1000)}`;
    }
    return activeQuality.stream_url;
  }, [activeQuality, track?.uri, dvdSeekOffsetSec]);

  // Sync `isPlaying` and `snap.volume` from Orchestrator to `<video>`
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !isVideoTrack || !activeStreamUrl) return;
    if (typeof snap?.volume === 'number') {
      vid.volume = Math.max(0, Math.min(1, snap.volume));
    }
    if (isPlaying) {
      if (vid.paused) {
        vid.play().catch(() => {});
      }
    } else {
      if (!vid.paused) {
        vid.pause();
      }
    }
  }, [isPlaying, snap?.volume, isVideoTrack, activeStreamUrl]);

  // Listen for `AppleSinkCommand` (`action === 'seek'`) from Orchestrator so scrub bar & L2/R2 seek `<video>`
  useEffect(() => {
    if (!isVideoTrack) return;
    const unsub = defaultSimpClient.subscribeAppleSink((cmd) => {
      if (cmd.action === 'seek' && typeof cmd.position_ms === 'number') {
        const targetSec = cmd.position_ms / 1000;
        if (track?.uri?.startsWith('dvd://')) {
          setDvdSeekOffsetSec(targetSec);
        } else if (videoRef.current) {
          videoRef.current.currentTime = targetSec;
        }
      }
    });
    return unsub;
  }, [isVideoTrack, track?.uri]);

  const cycleVideoQuality = useCallback(() => {
    if (videoQualities.length <= 1) {
      showToast?.(
        videoQualities.length === 1
          ? `🎞️ Only 1 stream format available (${videoQualities[0].label})`
          : '🎞️ No alternative stream formats available'
      );
      return;
    }
    if (videoRef.current) {
      pendingResumeTimeSecRef.current = videoRef.current.currentTime || 0;
    }
    const nextIdx = (selectedQualityIdx + 1) % videoQualities.length;
    setSelectedQualityIdx(nextIdx);
    setVideoErrorMsg(null);
    showToast?.(`🎞️ Stream Quality: ${videoQualities[nextIdx].label}`);
  }, [videoQualities, selectedQualityIdx, showToast]);

  const cycleVideoSubtitles = useCallback(() => {
    if (videoSubtitles.length === 0) {
      showToast?.('💬 No subtitle tracks available for this video');
      return;
    }
    const nextIdx = selectedSubtitleIdx + 1 >= videoSubtitles.length ? -1 : selectedSubtitleIdx + 1;
    setSelectedSubtitleIdx(nextIdx);
    showToast?.(
      nextIdx === -1 ? '💬 Subtitles: Off' : `💬 Subtitles: ${videoSubtitles[nextIdx].label}`
    );
  }, [videoSubtitles, selectedSubtitleIdx, showToast]);

  const toggleTheatreFullscreen = useCallback(() => {
    setVideoTheatreExpanded((prev) => {
      const next = !prev;
      if (!next && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      return next;
    });
    setPlayerActionsOpen(false);
  }, []);

  // Focus first item in Left Column when Player Track Actions Overlay opens, and scroll current queue item into view
  useEffect(() => {
    if (!playerActionsOpen) return;
    const t = window.setTimeout(() => {
      const currentQueueEl = document.querySelector<HTMLElement>(
        '[data-player-actions-modal="true"] [data-queue-current="true"]'
      );
      if (currentQueueEl) {
        currentQueueEl.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
      const firstBtn =
        document.querySelector<HTMLElement>(
          '[data-player-actions-modal="true"] [data-player-actions-col="left"] button[data-default-focus="true"]:not([disabled])'
        ) ||
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

  const cycleVisualizerMode = useCallback(() => {
    setVizMode((prev) => {
      const idx = VISUALIZER_MODES.findIndex((m) => m.id === prev);
      const next = VISUALIZER_MODES[(idx + 1) % VISUALIZER_MODES.length];
      try {
        window.localStorage.setItem('simp.visualizer_mode', next.id);
      } catch {}
      showToast?.(`✨ Visualizer: ${next.label}`);
      return next.id;
    });
  }, [showToast]);

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

    if (!track?.uri || isVideoTrack) {
      setScComments([]);
      setScWaveformBars(null);
      setScTrackBpm(null);
      setScMixChapters([]);
      setScTrackUserId(null);
      setScCreatorFollowed(false);
      setRightColMode('queue');
      return;
    }

    let cancelled = false;

    if (!isSoundCloudTrack) {
      setScComments([]);
      setScTrackBpm(null);
      setScMixChapters([]);
      setScTrackUserId(null);
      setScCreatorFollowed(false);
      setRightColMode('queue');

      fetch(`/api/audio/waveform?uri=${encodeURIComponent(track.uri)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled) {
            const bars = d?.data?.bars;
            setScWaveformBars(Array.isArray(bars) && bars.length > 0 ? bars : null);
          }
        })
        .catch(() => {
          if (!cancelled) setScWaveformBars(null);
        });

      return () => {
        cancelled = true;
      };
    }

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
          setScTrackBpm(typeof wf?.bpm === 'number' && wf.bpm > 0 ? wf.bpm : null);
          const chapters = wf?.chapters || [];
          setScMixChapters(chapters);
          setScTrackUserId(wf?.user_id || null);
          setScCreatorFollowed(false);
          setRightColMode(chapters.length > 0 ? 'chapters' : 'queue');
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isSoundCloudTrack, isVideoTrack, track?.uri]);

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
        let placement: 'above' | 'below';
        if (alive.length === 1) {
          placement = alive[0].placement === 'above' ? 'below' : 'above';
        } else {
          placement = nextCommentPlacementRef.current;
        }
        nextCommentPlacementRef.current = placement === 'above' ? 'below' : 'above';
        return [...alive, { comment: match, slot, placement, expiresAt: now + 5000 }];
      });
    },
    [isSoundCloudTrack, scCommentsEnabled, scComments, track?.duration_ms]
  );

  const handleOpenCurrentCollection = useCallback(() => {
    setPlayerActionsOpen(false);
    setVideoTheatreExpanded(false);
    const notifyOpenCollection = () => {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('simp-open-collection-in-library'));
      }, 0);
    };

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
          if (
            (ctxKind === 'cloud_playlist' ||
              ctxKind === 'cloud_album' ||
              ctxKind === 'soundcloud_playlist') &&
            snap?.queue &&
            snap.queue.length > 0 &&
            setBrowserTracks
          ) {
            setBrowserTracks(snap.queue);
          }
          setBrowserTarget((prev) =>
            prev && prev.kind === ctxKind && prev.id === ctxId
              ? { ...prev }
              : {
                  kind: ctxKind,
                  id: ctxId,
                  title: track?.album || track?.title,
                  subtitle: track?.artists?.join(', '),
                  art_url: track?.art_url,
                }
          );
          setView('browser');
          notifyOpenCollection();
          return;
        }
      }
    }
    if (track?.source === 'internet_archive' || track?.source === 'ia_video') {
      const rawId =
        track.album_id?.replace(/^ia:/, '') ||
        track.uri
          .replace(/^ia:audio:/, '')
          .replace(/^ia:video:/, '')
          .split('/')[0];
      if (rawId) {
        setBrowserTarget({
          kind: 'ia_item',
          id: rawId,
          title: track.album || track.title,
          subtitle: track.artists?.join(', '),
          art_url: track.art_url,
        });
        setView('browser');
        notifyOpenCollection();
        return;
      }
    }
    if (track?.source === 'apple_music') {
      handleOpenFullAppleAlbum({
        albumId: track.album_id?.replace(/^applemusic:album:/, '') || undefined,
        songUri: track.uri,
        fallbackTitle: track.album || track.title,
      });
      return;
    }
    if (track?.source === 'cdda' || track?.source === 'dvd') {
      setBrowserTarget({
        kind: 'cdda',
        id: opticalDisc?.disc_id || opticalDisc?.device_path || '/dev/sr0',
        title: `💿 ${opticalDisc?.album_title || track.album || 'Optical Disc'}`,
        subtitle: opticalDisc?.artist_name || track.artists?.join(', ') || 'Optical Disc',
        art_url: opticalDisc?.art_url || track.art_url,
      });
      setView('browser');
      notifyOpenCollection();
      return;
    }
    if (track?.album_id) {
      setBrowserTarget({
        kind: 'album',
        id: track.album_id,
        title: track.album || track.title,
        subtitle: track.artists?.join(', '),
        art_url: track.art_url,
      });
      setView('browser');
      notifyOpenCollection();
      return;
    }
    if (snap?.queue && snap.queue.length > 0 && setBrowserTracks) {
      setBrowserTracks(snap.queue);
      setBrowserTarget({
        kind: 'soundcloud_playlist',
        id: 'active_queue',
        title:
          track?.album ||
          (track?.source === 'soundcloud'
            ? '☁️ Active SoundCloud Queue'
            : '🎵 Active Playback Queue'),
        subtitle: track?.artists?.join(', ') || `${snap.queue.length} tracks in queue`,
        art_url: track?.art_url || null,
      });
      setView('browser');
      notifyOpenCollection();
      return;
    }
    setView('browser');
    notifyOpenCollection();
  }, [
    playingContextId,
    track,
    snap?.queue,
    opticalDisc,
    setBrowserTarget,
    setBrowserTracks,
    setView,
    handleOpenFullAppleAlbum,
  ]);

  const primaryArtist = track?.artists?.[0]?.trim() || '';

  // Build unified Queue / Episodes / DVD Titles / SoundCloud DJ Mix Chapters list for the right column of the SELECT modal
  const chapterModalItems = useMemo(() => {
    if (!isSoundCloudTrack || scMixChapters.length === 0) return [];
    const posMs = snap?.position_ms ?? 0;
    return scMixChapters.map((ch, idx) => {
      const nextTs = scMixChapters[idx + 1]?.timestamp_ms ?? Infinity;
      const isCurrent = posMs >= ch.timestamp_ms && posMs < nextTs;
      return {
        key: `chapter:${idx}:${ch.timestamp_ms}`,
        index: idx,
        title: ch.label,
        subtitle: `Jump to ${formatCommentTs(ch.timestamp_ms)}`,
        durationMs: ch.timestamp_ms,
        badgeLabel: formatCommentTs(ch.timestamp_ms),
        isCurrent,
        onSelect: () => {
          setPlayerActionsOpen(false);
          defaultSimpClient.seek(ch.timestamp_ms);
          showToast?.(`⏭ Seeking to ${formatCommentTs(ch.timestamp_ms)} — ${ch.label}`);
        },
      };
    });
  }, [isSoundCloudTrack, scMixChapters, snap?.position_ms, showToast]);

  const queueModalItems = useMemo(() => {
    if (snap?.queue && snap.queue.length > 1) {
      return snap.queue.map((qt, idx) => ({
        key: `${idx}:${qt.uri}`,
        index: idx,
        title: qt.title || `Track ${idx + 1}`,
        subtitle: qt.artists?.join(', ') || qt.album || '',
        durationMs: qt.duration_ms || 0,
        badgeLabel: `#${idx + 1}`,
        isCurrent: idx === (snap.queue_index ?? 0),
        onSelect: () => {
          setPlayerActionsOpen(false);
          defaultSimpClient.loadQueue(
            snap.queue!.map((t) => t.uri),
            idx,
            snap.queue!
          );
        },
      }));
    }
    if (isVideoTrack && iaDetail && iaDetail.episodes.length > 1) {
      return iaDetail.episodes.map((ep, idx) => {
        const epUri = `ia:video:${encodeURIComponent(iaDetail.summary.identifier)}/${idx}`;
        return {
          key: epUri,
          index: idx,
          title: ep.label,
          subtitle: iaDetail.summary.title,
          durationMs: ep.duration_ms || 0,
          badgeLabel: `#${idx + 1}`,
          isCurrent: track?.uri === epUri,
          onSelect: () => {
            setPlayerActionsOpen(false);
            const allTracks: TrackMetadata[] = iaDetail.episodes.map((itemEp, i) => ({
              uri: `ia:video:${encodeURIComponent(iaDetail.summary.identifier)}/${i}`,
              title: itemEp.label,
              artists: [iaDetail.summary.creator],
              album: iaDetail.summary.title,
              album_id: `ia:${iaDetail.summary.identifier}`,
              track_number: itemEp.episode_number,
              disc_number: 1,
              art_url: iaDetail.summary.art_url,
              duration_ms: itemEp.duration_ms,
              source: 'ia_video',
            }));
            defaultSimpClient.loadQueue(
              allTracks.map((t) => t.uri),
              idx,
              allTracks
            );
          },
        };
      });
    }
    if (isVideoTrack && dvdTitles.length > 1) {
      const dev = opticalDisc?.device_path || '/dev/sr0';
      return dvdTitles.map((t: DvdTitleInfo, idx) => {
        const dvdUri = `dvd://${dev}/${t.title_number}`;
        return {
          key: dvdUri,
          index: idx,
          title: `Title ${t.title_number}: ${t.label || 'DVD Video'}`,
          subtitle: `${Math.round(t.duration_ms / 60000)}m • ${t.aspect_ratio}`,
          durationMs: t.duration_ms || 0,
          badgeLabel: `#${idx + 1}`,
          isCurrent: track?.uri === dvdUri,
          onSelect: () => {
            setPlayerActionsOpen(false);
            const meta: TrackMetadata = {
              uri: dvdUri,
              title: `${opticalDisc?.album_title || 'DVD'} — Title ${t.title_number}`,
              artists: ['Optical DVD Video'],
              album: opticalDisc?.album_title || 'DVD Video',
              album_id: null,
              track_number: t.title_number,
              disc_number: 1,
              art_url: opticalDisc?.art_url || null,
              duration_ms: t.duration_ms,
              source: 'dvd',
            };
            defaultSimpClient.loadQueue([dvdUri], 0, [meta]);
          },
        };
      });
    }
    return [];
  }, [snap?.queue, snap?.queue_index, isVideoTrack, iaDetail, dvdTitles, opticalDisc, track?.uri]);

  const activeRightColItems = useMemo(() => {
    if (rightColMode === 'chapters' && chapterModalItems.length > 0) {
      return chapterModalItems;
    }
    if (queueModalItems.length > 0) {
      return queueModalItems;
    }
    return chapterModalItems;
  }, [rightColMode, chapterModalItems, queueModalItems]);

  const currentQueueIdx = useMemo(() => {
    const found = activeRightColItems.findIndex((item) => item.isCurrent);
    return found >= 0 ? found : 0;
  }, [activeRightColItems]);

  return (
    <>
      <main
        style={{
          flex: 1,
          boxSizing: 'border-box',
          display: hidden ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 48px',
          width: '100%',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
      {!isVideoTrack && !hidden && (
        <PlayerBackgroundVisualizer
          mode={vizMode}
          isPlaying={isPlaying}
          track={track || null}
          artUrl={track?.art_url || opticalDisc?.art_url || null}
          bpm={scTrackBpm}
          waveformBars={scWaveformBars}
          activeComment={activeBubbles[activeBubbles.length - 1]?.comment || null}
          comments={scComments}
          activeChapterLabel={
            chapterModalItems.find((c) => c.isCurrent)?.title || null
          }
        />
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isVideoTrack ? '420px 1fr' : '260px 1fr',
          alignItems: 'center',
          gap: 36,
          maxWidth: isVideoTrack ? 1140 : 1060,
          width: '100%',
          margin: '0 auto',
          position: 'relative',
          zIndex: 2,
          transform:
            !videoTheatreExpanded && playerScale > 1.02 ? `scale(${playerScale})` : undefined,
          transformOrigin: 'center center',
        }}
      >
        {/* Left Column: Clean 240x240 Album Art OR 16:9 Live Video Stage + Transport/Mode Controls Below */}
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
            onClick={() => {
              if (isVideoTrack && !videoTheatreExpanded) {
                setVideoTheatreExpanded(true);
              }
            }}
            style={
              isVideoTrack && videoTheatreExpanded
                ? {
                    position: 'fixed',
                    inset: 0,
                    zIndex: 48,
                    background: '#000',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: hudVisible ? 'default' : 'none',
                  }
                : {
                    width: isVideoTrack ? 420 : 240,
                    height: isVideoTrack ? 236 : 240,
                    borderRadius: 20,
                    background: '#050508',
                    border: isVideoTrack ? '2px solid #2aa3c4' : '1px solid #2b2d3c',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    boxShadow:
                      '0 18px 44px rgba(0, 0, 0, 0.94), 0 4px 14px rgba(0, 0, 0, 0.96), 0 0 0 1px rgba(0, 0, 0, 0.85)',
                    cursor: isVideoTrack ? 'pointer' : 'default',
                  }
            }
          >
            {isVideoTrack ? (
              <>
                {activeStreamUrl ? (
                  <video
                    ref={videoRef}
                    src={activeStreamUrl}
                    poster={track?.art_url || undefined}
                    autoPlay={isPlaying}
                    playsInline
                    onLoadedMetadata={(e) => {
                      const vid = e.currentTarget;
                      setVideoErrorMsg(null);
                      if (pendingResumeTimeSecRef.current > 0) {
                        vid.currentTime = pendingResumeTimeSecRef.current;
                        pendingResumeTimeSecRef.current = 0;
                      }
                      const rawDur =
                        Number.isFinite(vid.duration) && vid.duration > 0
                          ? Math.round(vid.duration * 1000)
                          : track?.duration_ms || 0;
                      const posMs = Math.round((dvdSeekOffsetSec + vid.currentTime) * 1000);
                      defaultSimpClient.reportAppleWorkerEvent(
                        vid.paused ? 'paused' : 'playing',
                        posMs,
                        undefined,
                        rawDur > 0 ? rawDur : undefined
                      );
                    }}
                    onPlay={(e) => {
                      const posMs = Math.round(
                        (dvdSeekOffsetSec + e.currentTarget.currentTime) * 1000
                      );
                      defaultSimpClient.reportAppleWorkerEvent('playing', posMs);
                    }}
                    onPause={(e) => {
                      if (e.currentTarget.ended) return;
                      const posMs = Math.round(
                        (dvdSeekOffsetSec + e.currentTarget.currentTime) * 1000
                      );
                      defaultSimpClient.reportAppleWorkerEvent('paused', posMs);
                    }}
                    onTimeUpdate={(e) => {
                      const now = performance.now();
                      if (now - lastTimeReportMsRef.current < 400) return;
                      lastTimeReportMsRef.current = now;
                      const vid = e.currentTarget;
                      const posMs = Math.round((dvdSeekOffsetSec + vid.currentTime) * 1000);
                      const rawDur =
                        Number.isFinite(vid.duration) && vid.duration > 0
                          ? Math.round(vid.duration * 1000)
                          : undefined;
                      defaultSimpClient.reportAppleWorkerEvent(
                        'time_update',
                        posMs,
                        undefined,
                        rawDur
                      );
                    }}
                    onEnded={(e) => {
                      const posMs = Math.round(
                        (dvdSeekOffsetSec + e.currentTarget.currentTime) * 1000
                      );
                      const hasNextTrack = Boolean(
                        (snap?.up_next && snap.up_next.length > 0) ||
                          snap?.repeat_mode === 'track' ||
                          snap?.repeat_mode === 'queue'
                      );
                      // When video concludes and no next track is queued, exit Fullscreen Theatre so OLED dimming can engage
                      if (!hasNextTrack) {
                        setVideoTheatreExpanded(false);
                        if (document.fullscreenElement) {
                          document.exitFullscreen().catch(() => {});
                        }
                      }
                      defaultSimpClient.reportAppleWorkerEvent('ended', posMs);
                    }}
                    onError={() => {
                      // Automatically try the next quality variant (e.g. falling back to Compatibility MP4 ffmpeg)
                      if (selectedQualityIdx + 1 < videoQualities.length) {
                        const nextIdx = selectedQualityIdx + 1;
                        setSelectedQualityIdx(nextIdx);
                        showToast?.(
                          `🎬 Switching stream format to ${videoQualities[nextIdx].label}…`
                        );
                      } else {
                        setVideoErrorMsg(
                          'Video stream unavailable for this format. Open SELECT menu to switch quality.'
                        );
                      }
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      background: '#000',
                    }}
                  >
                    {activeSubtitle && resolvedSubtitleBlobUrl && (
                      <track
                        key={activeSubtitle.vtt_url}
                        kind="subtitles"
                        src={resolvedSubtitleBlobUrl}
                        srcLang={activeSubtitle.lang_code}
                        label={activeSubtitle.label}
                        default
                      />
                    )}
                  </video>
                ) : (
                  <div style={{ color: '#9ca3af', fontSize: 13, fontFamily: 'monospace' }}>
                    ⏳ Resolving video stream…
                  </div>
                )}

                {videoErrorMsg && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 12,
                      background: 'rgba(10, 10, 16, 0.92)',
                      border: '1px solid #ef4444',
                      borderRadius: 12,
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 10,
                      textAlign: 'center',
                    }}
                  >
                    <span style={{ color: '#fca5a5', fontSize: 12.5, fontWeight: 700 }}>
                      ⚠️ {videoErrorMsg}
                    </span>
                    {videoQualities.length > 1 && (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          cycleVideoQuality();
                        }}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 8,
                          background: '#1e293b',
                          border: '1px solid #38bdf8',
                          color: '#e0f2fe',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        🎞️ Switch Quality ({activeQuality?.label || 'Next'})
                      </button>
                    )}
                  </div>
                )}

                {/* Floating 4-Second Auto-Hide Theatre HUD & Scrub Bar when in Expanded Theatre Mode */}
                {videoTheatreExpanded && (
                  <div
                    onClick={(ev) => ev.stopPropagation()}
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      padding: '28px 36px 24px',
                      background:
                        'linear-gradient(to top, rgba(4, 4, 8, 0.95) 0%, rgba(4, 4, 8, 0.78) 65%, rgba(4, 4, 8, 0) 100%)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                      opacity: hudVisible ? 1 : 0,
                      pointerEvents: hudVisible ? 'auto' : 'none',
                      transition: 'opacity 0.28s ease',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 16,
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 22,
                            fontWeight: 800,
                            color: '#f4f4f6',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {track?.title || 'Video Playback'}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: '#9ca3af',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginTop: 2,
                          }}
                        >
                          {track?.artists?.join(', ')}
                          {activeQuality ? ` • ${activeQuality.label}` : ''}
                          {activeSubtitle ? ` • CC: ${activeSubtitle.label}` : ''}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {videoQualities.length > 1 && (
                          <button
                            type="button"
                            onClick={cycleVideoQuality}
                            style={{
                              minHeight: 40,
                              padding: '0 12px',
                              borderRadius: 10,
                              background: '#12121c',
                              border: '1px solid #2aa3c4',
                              color: '#bfeaf5',
                              fontSize: 12,
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            🎞️ {activeQuality?.label || 'Quality'}
                          </button>
                        )}
                        {videoSubtitles.length > 0 && (
                          <button
                            type="button"
                            onClick={cycleVideoSubtitles}
                            style={{
                              minHeight: 40,
                              padding: '0 12px',
                              borderRadius: 10,
                              background: activeSubtitle ? '#0f222a' : '#12121c',
                              border: activeSubtitle ? '1px solid #2aa3c4' : '1px solid #2e2e3a',
                              color: activeSubtitle ? '#7dd3fc' : '#a1a1aa',
                              fontSize: 12,
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            💬 CC: {activeSubtitle ? activeSubtitle.label : 'Off'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setVideoTheatreExpanded(false);
                            if (document.fullscreenElement) {
                              document.exitFullscreen().catch(() => {});
                            }
                          }}
                          style={{
                            minHeight: 40,
                            padding: '0 14px',
                            borderRadius: 10,
                            background: '#181824',
                            border: '1px solid #3f3f4e',
                            color: '#f4f4f6',
                            fontSize: 12,
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          🗗 Card View<span className="simp-gp-badge"> B</span>
                        </button>
                      </div>
                    </div>

                    <ProgressBarRaf durationMs={track?.duration_ms ?? 0} trackUri={track?.uri} />

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 14,
                      }}
                    >
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
                        type="button"
                        onClick={() => defaultSimpClient.togglePlayPause()}
                        style={{
                          width: 88,
                          height: 76,
                          borderRadius: 20,
                          background: isPlaying ? '#0f222a' : '#12121a',
                          color: isPlaying ? '#bfeaf5' : '#d4d4dc',
                          border: isPlaying ? '2px solid #2aa3c4' : '2px solid #3f3f4e',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                          cursor: 'pointer',
                          fontWeight: 900,
                        }}
                      >
                        <span style={{ fontSize: 26 }}>{isPlaying ? '⏸' : '▶'}</span>
                        <span
                          className="simp-gp-badge"
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: isPlaying ? '#7dd3fc' : '#a1a1aa',
                          }}
                        >
                          A
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
                  </div>
                )}
              </>
            ) : track?.art_url ? (
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

          {/* Queue Mode Controls: Shuffle (X) & Loop/Repeat (Y) */}
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
          <div
            style={{
              minWidth: 0,
              position: 'relative',
              padding: '10px 14px',
              margin: '-10px -14px',
              borderRadius: 16,
              background:
                !isVideoTrack && vizMode !== 'off'
                  ? 'radial-gradient(ellipse at 35% 50%, rgba(6, 7, 12, 0.72) 0%, rgba(6, 7, 12, 0.38) 68%, rgba(6, 7, 12, 0) 100%)'
                  : 'transparent',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <h1
                style={{
                  margin: 0,
                  fontSize: 30,
                  fontWeight: 800,
                  letterSpacing: -0.5,
                  color: '#f4f4fa',
                  textShadow:
                    '0 2px 6px rgba(0, 0, 0, 0.98), 0 0 18px rgba(0, 0, 0, 0.96), 0 0 34px rgba(0, 0, 0, 0.9)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {track?.title || 'No Track Loaded'}
              </h1>
            </div>
            <p
              style={{
                margin: '6px 0 0',
                fontSize: 16,
                fontWeight: 600,
                color: '#d4d4e2',
                textShadow:
                  '0 2px 5px rgba(0, 0, 0, 0.98), 0 0 14px rgba(0, 0, 0, 0.96), 0 0 26px rgba(0, 0, 0, 0.92)',
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
              {(() => {
                const uri = track?.uri;
                if (!uri || (!uri.startsWith('file://') && !uri.startsWith('/'))) return null;
                const clean = uri.split('?')[0].split('#')[0];
                const dot = clean.lastIndexOf('.');
                if (dot < 0 || dot === clean.length - 1) return null;
                const ext = clean.slice(dot + 1).toUpperCase();
                return ['FLAC', 'MP3', 'WAV', 'OGG', 'OPUS', 'M4A', 'AAC', 'ALAC', 'AIFF'].includes(ext)
                  ? ` • ${ext}`
                  : null;
              })()}
              {isVideoTrack && activeQuality ? ` • ${activeQuality.label}` : ''}
            </p>
          </div>

          <div style={{ position: 'relative', width: '100%' }}>
            {/* Ephemeral SoundCloud Timed Comment Speech Bubbles — Alternating Over & Under Scrub Bar */}
            {isSoundCloudTrack &&
              scCommentsEnabled &&
              activeBubbles.map((b) => {
                const dur = track?.duration_ms || 0;
                const pct =
                  dur > 0 && Number.isFinite(b.comment.timestamp_ms)
                    ? Math.max(0, Math.min(46, (b.comment.timestamp_ms / dur) * 100))
                    : 0;
                const isBelow = b.placement === 'below';
                return (
                  <div
                    key={b.comment.id}
                    style={{
                      position: 'absolute',
                      ...(isBelow
                        ? { top: 'calc(100% + 6px)' }
                        : { bottom: 'calc(100% - 8px)' }),
                      left: 14,
                      right: 14,
                      display: 'flex',
                      justifyContent: 'flex-start',
                      pointerEvents: 'none',
                      zIndex: 25,
                    }}
                  >
                    <div
                      style={{
                        marginLeft: `${pct}%`,
                        maxWidth: '78%',
                        minWidth: 240,
                        padding: '8px 14px',
                        borderRadius: 15,
                        ...(isBelow
                          ? { borderTopLeftRadius: 4 }
                          : { borderBottomLeftRadius: 4 }),
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
                  </div>
                );
              })}

            <ProgressBarRaf
              durationMs={track?.duration_ms ?? 0}
              trackUri={track?.uri}
              waveformBars={!isVideoTrack ? scWaveformBars : null}
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
                boxShadow:
                  '0 12px 32px rgba(0, 0, 0, 0.94), 0 3px 10px rgba(0, 0, 0, 0.96), 0 0 0 1px rgba(0, 0, 0, 0.85)',
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
                background: 'rgba(8, 9, 14, 0.94)',
                border: '1px solid #283044',
                boxShadow:
                  '0 10px 26px rgba(0, 0, 0, 0.92), 0 2px 8px rgba(0, 0, 0, 0.96), 0 0 0 1px rgba(0, 0, 0, 0.8)',
                fontSize: 12,
                color: '#c4c4d0',
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
      </main>

      {/* Unified Two-Column Controller-First `SELECT` Track & Queue Actions Overlay Menu */}
      {playerActionsOpen && (
        <div
          onClick={() => setPlayerActionsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.84)',
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
              maxWidth: activeRightColItems.length > 0 ? 840 : 460,
              maxHeight: '88vh',
              overflow: 'hidden',
              background: '#0a0a10',
              border: '2px solid #2aa3c4',
              borderRadius: 20,
              padding: 20,
              boxSizing: 'border-box',
              boxShadow: '0 18px 48px rgba(0, 0, 0, 0.9)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: 8,
                borderBottom: '1px solid #1e1e2a',
                flexShrink: 0,
              }}
            >
              <div style={{ minWidth: 0, flex: 1, marginRight: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#bfeaf5' }}>
                  {isVideoTrack ? '🎬 Video & Track Actions' : '🎵 Track & Player Actions'}
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

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: activeRightColItems.length > 0 ? '1fr 1fr' : '1fr',
                gap: 16,
                minHeight: 0,
                flex: 1,
                overflow: 'hidden',
              }}
            >
              {/* Left Column: Settings & Track Actions (D-Pad Up/Down stays here without crossing hundreds of tracks) */}
              <div
                data-player-actions-col="left"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 9,
                  overflowY: 'auto',
                  padding: '6px 8px',
                  boxSizing: 'border-box',
                }}
              >
                {isVideoTrack && (
                  <>
                    <button
                      type="button"
                      data-default-focus="true"
                      onClick={toggleTheatreFullscreen}
                      style={{
                        ...actionRowBtnStyle,
                        background: videoTheatreExpanded ? '#0f222a' : '#101018',
                        border: videoTheatreExpanded ? '1px solid #2aa3c4' : '1px solid #222230',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#67e8f9' }}>
                          {videoTheatreExpanded
                            ? '🗗 Exit Fullscreen Theatre to Card View'
                            : '⛶ Expand to Fullscreen Theatre'}
                        </span>
                        <span style={{ fontSize: 11, color: '#8e8e99' }}>
                          {videoTheatreExpanded
                            ? 'Return to split-card player layout'
                            : 'Fill screen with video stage and 4-second auto-hiding HUD'}
                        </span>
                      </div>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#67e8f9' }}>
                        {videoTheatreExpanded ? 'CARD' : 'THEATRE'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={cycleVideoQuality}
                      style={actionRowBtnStyle}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#f4f4f6' }}>
                          🎞️ Stream Quality / Audio: {activeQuality?.label || 'Default'}
                        </span>
                        <span style={{ fontSize: 11, color: '#8e8e99' }}>
                          {videoQualities.length > 1
                            ? `Cycle across ${videoQualities.length} available formats (MP4 prioritized)`
                            : 'Single stream format available'}
                        </span>
                      </div>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#2aa3c4' }}>
                        {selectedQualityIdx + 1}/{Math.max(1, videoQualities.length)}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={cycleVideoSubtitles}
                      style={actionRowBtnStyle}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#f4f4f6' }}>
                          💬 Subtitles / CC: {activeSubtitle ? activeSubtitle.label : 'Off'}
                        </span>
                        <span style={{ fontSize: 11, color: '#8e8e99' }}>
                          {videoSubtitles.length > 0
                            ? `${videoSubtitles.length} subtitle track(s) available`
                            : 'No subtitle tracks attached to this item'}
                        </span>
                      </div>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#2aa3c4' }}>
                        {activeSubtitle ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  </>
                )}

                {/* 1. Open Collection / Album / Playlist in Library */}
                <button
                  type="button"
                  data-default-focus={!isVideoTrack ? 'true' : undefined}
                  onClick={handleOpenCurrentCollection}
                  style={actionRowBtnStyle}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#f4f4f6' }}>
                      💿 Open Collection in Library
                    </span>
                    <span style={{ fontSize: 11, color: '#8e8e99' }}>
                      Jump to the active album, archive item, playlist, or queue in the Right Pane
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
                        ❤️ Favorite {isVideoTrack ? 'Video / Episode' : 'Track'}
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
                        Mix movies, episodes, Local, Apple Music & SoundCloud tracks in any SIMP playlist
                      </span>
                    </div>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#67e8f9' }}>+ ★</span>
                  </button>
                )}

                {/* 4. Start Track Radio / Station */}
                {track && !isVideoTrack && (track.source === 'soundcloud' || primaryArtist) && (
                  <button
                    type="button"
                    onClick={() => {
                      setPlayerActionsOpen(false);
                      if (track.source === 'soundcloud' && handleStartSoundCloudTrackRadio) {
                        handleStartSoundCloudTrackRadio(track);
                      } else if (primaryArtist && handleMoreByArtist) {
                        handleMoreByArtist(primaryArtist, track.source);
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

                {/* 5. More by Artist / Creator */}
                {primaryArtist && handleMoreByArtist && (
                  <button
                    type="button"
                    onClick={() => {
                      setPlayerActionsOpen(false);
                      setVideoTheatreExpanded(false);
                      handleMoreByArtist(primaryArtist, track?.source);
                    }}
                    style={actionRowBtnStyle}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#d4d4dc' }}>
                        👤 More by {primaryArtist}
                      </span>
                      <span style={{ fontSize: 11, color: '#8e8e99' }}>
                        Search across sources for {primaryArtist} (current source prioritized first)
                      </span>
                    </div>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#9ca3af' }}>🔍</span>
                  </button>
                )}

                {/* 5b. Follow / Unfollow Creator on SoundCloud */}
                {isSoundCloudTrack && scTrackUserId && primaryArtist && (
                  <button
                    type="button"
                    onClick={() => {
                      const nextFollow = !scCreatorFollowed;
                      toggleFollowSoundCloudUser(
                        scTrackUserId,
                        nextFollow,
                        primaryArtist,
                        showToast
                      )
                        .then((ok) => {
                          if (ok) setScCreatorFollowed(nextFollow);
                        })
                        .catch((err: any) => {
                          showToast?.(
                            err?.message || 'Sign in with SoundCloud to follow creators'
                          );
                        });
                    }}
                    style={{
                      ...actionRowBtnStyle,
                      background: scCreatorFollowed ? '#1f120b' : '#101018',
                      border: scCreatorFollowed ? '1px solid #ea580c' : '1px solid #222230',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#fdba74' }}>
                        {scCreatorFollowed
                          ? `✓ Following @${primaryArtist}`
                          : `➕ Follow @${primaryArtist} on SoundCloud`}
                      </span>
                      <span style={{ fontSize: 11, color: '#8e8e99' }}>
                        {scCreatorFollowed
                          ? 'In your 👥 Following list & ⚡ Following Stream'
                          : 'Add creator to your 👥 Following list & ⚡ Following Stream'}
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 11,
                        fontWeight: 800,
                        color: scCreatorFollowed ? '#fdba74' : '#9ca3af',
                      }}
                    >
                      {scCreatorFollowed ? 'FOLLOWING' : '+ FOLLOW'}
                    </span>
                  </button>
                )}

                {/* 5c. Switch Right Column between Mix Chapters & Active Queue when both exist */}
                {chapterModalItems.length > 0 && queueModalItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setRightColMode((prev) => (prev === 'chapters' ? 'queue' : 'chapters'))
                    }
                    style={actionRowBtnStyle}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#67e8f9' }}>
                        📑 Right Column:{' '}
                        {rightColMode === 'chapters'
                          ? `Mix Chapters (${chapterModalItems.length})`
                          : `Active Queue (${queueModalItems.length})`}
                      </span>
                      <span style={{ fontSize: 11, color: '#8e8e99' }}>
                        Toggle right column between timestamped DJ Mix Chapters and Active Queue
                      </span>
                    </div>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#67e8f9' }}>
                      {rightColMode === 'chapters' ? 'CHAPTERS' : 'QUEUE'}
                    </span>
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

                {/* 7. Cycle Background Visualizer Mode (Audio only) */}
                {!isVideoTrack && (
                  <button
                    type="button"
                    onClick={cycleVisualizerMode}
                    style={{
                      ...actionRowBtnStyle,
                      background: vizMode !== 'off' ? '#0f222a' : '#101018',
                      border: vizMode !== 'off' ? '1px solid #2aa3c4' : '1px solid #222230',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: '#67e8f9' }}>
                        ✨ Visualizer:{' '}
                        {VISUALIZER_MODES.find((m) => m.id === vizMode)?.label || 'Glyph Matrix'}
                      </span>
                      <span style={{ fontSize: 11, color: '#8e8e99' }}>
                        Glyph Matrix • Winamp AVS • Demoscene 64K • Cycle • Off
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 11,
                        fontWeight: 800,
                        color: vizMode !== 'off' ? '#67e8f9' : '#71717a',
                      }}
                    >
                      {VISUALIZER_MODES.find((m) => m.id === vizMode)?.shortLabel || 'GLYPH'}
                    </span>
                  </button>
                )}

                {/* 8. Toggle Fullscreen */}
                <button
                  type="button"
                  onClick={() => {
                    setPlayerActionsOpen(false);
                    togglePlayerFullscreen();
                  }}
                  style={{
                    ...actionRowBtnStyle,
                    background: isFullscreen ? '#0f222a' : '#101018',
                    border: isFullscreen ? '1px solid #2aa3c4' : '1px solid #222230',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#bfeaf5' }}>
                      ⛶ {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Player'}
                    </span>
                    <span style={{ fontSize: 11, color: '#8e8e99' }}>
                      Shortcut: F / F11 / Alt+F
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 11,
                      fontWeight: 800,
                      color: isFullscreen ? '#67e8f9' : '#71717a',
                    }}
                  >
                    {isFullscreen ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>

              {/* Right Column: Queue / Mix Chapters / Episodes / DVD Titles Browser (D-Pad Right jumps straight to current item) */}
              {activeRightColItems.length > 0 && (
                <div
                  data-player-actions-col="right"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#0d0d15',
                    border: '1px solid #1e1e2c',
                    borderRadius: 14,
                    padding: 12,
                    minHeight: 0,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingBottom: 8,
                      marginBottom: 8,
                      borderBottom: '1px solid #1e1e2c',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#bfeaf5' }}>
                      📑{' '}
                      {rightColMode === 'chapters' && chapterModalItems.length > 0
                        ? 'MIX CHAPTERS'
                        : isVideoTrack
                          ? 'EPISODES / QUEUE'
                          : 'ACTIVE QUEUE'}{' '}
                      ({currentQueueIdx + 1} / {activeRightColItems.length})
                    </span>
                    <span
                      className="simp-gp-badge"
                      style={{ fontSize: 10.5, fontFamily: 'monospace', color: '#7dd3fc' }}
                    >
                      ◄ Settings | ►{' '}
                      {rightColMode === 'chapters' && chapterModalItems.length > 0
                        ? 'Chapters'
                        : 'Queue'}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      overflowY: 'auto',
                      flex: 1,
                      padding: '6px 8px',
                      boxSizing: 'border-box',
                    }}
                  >
                    {activeRightColItems.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        data-queue-current={item.isCurrent ? 'true' : undefined}
                        onClick={item.onSelect}
                        style={{
                          width: '100%',
                          padding: '8px 11px',
                          borderRadius: 10,
                          background: item.isCurrent ? '#0f222a' : '#12121c',
                          border: item.isCurrent ? '1px solid #2aa3c4' : '1px solid #222230',
                          color: item.isCurrent ? '#7dd3fc' : '#d4d4dc',
                          textAlign: 'left',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 10,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: 12.5,
                              fontWeight: item.isCurrent ? 800 : 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.isCurrent ? '▶ ' : `${item.index + 1}. `}
                            {item.title}
                          </div>
                          {item.subtitle && (
                            <div
                              style={{
                                fontSize: 10.5,
                                color: item.isCurrent ? '#67e8f9' : '#71717a',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                marginTop: 1,
                              }}
                            >
                              {item.subtitle}
                            </div>
                          )}
                        </div>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontFamily: 'monospace',
                            color: item.isCurrent ? '#67e8f9' : '#71717a',
                            flexShrink: 0,
                          }}
                        >
                          {item.badgeLabel || `#${item.index + 1}`}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
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
      background: active ? '#0d1b22' : '#0b0c12',
      border: active ? '2px solid #2aa3c4' : '2px solid #2a2c3c',
      boxShadow:
        '0 10px 26px rgba(0, 0, 0, 0.94), 0 3px 8px rgba(0, 0, 0, 0.96), 0 0 0 1px rgba(0, 0, 0, 0.85)',
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
