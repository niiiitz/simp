import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DvdTitleInfo, VideoEpisodeItem } from '@simp/client';

export interface DvdPlayerModalProps {
  mode?: 'dvd' | 'ia_video' | 'local_video';
  devicePath?: string;
  discTitle: string;
  titleInfo?: DvdTitleInfo;
  episodes?: VideoEpisodeItem[];
  initialEpisodeIndex?: number;
  initialChapter?: number;
  initialAudioIndex?: number;
  initialSubtitleIndex?: string; // 'off' or stream_index / subtitle id
  onClose: () => void;
}

const formatDuration = (ms: number): string => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const DvdPlayerModal: React.FC<DvdPlayerModalProps> = ({
  mode = 'dvd',
  devicePath = '/dev/sr0',
  discTitle,
  titleInfo,
  episodes = [],
  initialEpisodeIndex = 0,
  initialChapter = 1,
  initialAudioIndex = 0,
  initialSubtitleIndex = 'off',
  onClose,
}) => {
  const isDirectVideo = mode === 'ia_video' || mode === 'local_video' || !titleInfo;
  const dvdChapters = titleInfo?.chapters ?? [];
  const dvdAudioTracks = titleInfo?.audio_tracks ?? [];
  const dvdSubtitleTracks = titleInfo?.subtitle_tracks ?? [];

  const initialChapterStartMs =
    dvdChapters.find((c) => c.chapter_number === initialChapter)?.start_ms ?? 0;

  const [episodeIdx, setEpisodeIdx] = useState<number>(
    Math.max(0, Math.min(episodes.length - 1, initialEpisodeIndex))
  );
  const [qualityIdx, setQualityIdx] = useState<number>(0);
  const [chapter, setChapter] = useState<number>(initialChapter);
  const [seekMs, setSeekMs] = useState<number | null>(null);
  const [baseOffsetMs, setBaseOffsetMs] = useState<number>(
    isDirectVideo ? 0 : initialChapterStartMs
  );
  const [videoElapsedMs, setVideoElapsedMs] = useState<number>(0);
  const [nativeDurationMs, setNativeDurationMs] = useState<number>(0);
  const [scrubPreviewMs, setScrubPreviewMs] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [audioIdx, setAudioIdx] = useState<number>(
    dvdAudioTracks[0]?.stream_index ?? initialAudioIndex
  );
  const [subIdx, setSubIdx] = useState<string>(initialSubtitleIndex);
  const [subBlobUrl, setSubBlobUrl] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [hudVisible, setHudVisible] = useState<boolean>(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const modalRootRef = useRef<HTMLDivElement | null>(null);
  const pendingResumeSecRef = useRef<number | null>(null);
  const hudTimerRef = useRef<number | null>(null);

  const activeEpisode: VideoEpisodeItem | undefined = episodes[episodeIdx] ?? episodes[0];
  const activeQualities = activeEpisode?.qualities ?? [];
  const activeQuality = activeQualities[qualityIdx] ?? activeQualities[0];
  const activeSubtitles = activeEpisode?.subtitles ?? [];

  const isTranscodedDirectStream =
    isDirectVideo &&
    Boolean(
      activeQuality?.stream_url &&
        (activeQuality.stream_url.includes('/api/video/ia_stream') ||
          activeQuality.stream_url.includes('transcode=1'))
    );

  const daemonOrigin =
    typeof window !== 'undefined' && window.location.port === '18888'
      ? window.location.origin
      : 'http://127.0.0.1:18888';

  const resolveUrl = useCallback(
    (rawUrl: string): string => {
      if (!rawUrl) return '';
      if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        return rawUrl;
      }
      return `${daemonOrigin}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    },
    [daemonOrigin]
  );

  const streamUrl = isDirectVideo
    ? (() => {
        const base = resolveUrl(activeQuality?.stream_url ?? '');
        if (isTranscodedDirectStream && seekMs !== null && seekMs > 0) {
          return `${base}${base.includes('?') ? '&' : '?'}seek_ms=${Math.floor(seekMs)}`;
        }
        return base;
      })()
    : `${daemonOrigin}/api/dvd/stream?device=${encodeURIComponent(
        devicePath
      )}&title=${titleInfo?.title_number ?? 1}&chapter=${chapter}&audio=${audioIdx}&sub=${encodeURIComponent(
        subIdx
      )}${seekMs !== null && seekMs > 0 ? `&seek_ms=${Math.floor(seekMs)}` : ''}`;

  const totalDurationMs = Math.max(
    1000,
    isDirectVideo
      ? activeEpisode?.duration_ms || nativeDurationMs || 1000
      : titleInfo?.duration_ms ||
          dvdChapters.reduce((acc, ch) => Math.max(acc, ch.start_ms + ch.duration_ms), 0) ||
          1000
  );

  const livePositionMs = Math.min(
    totalDurationMs,
    Math.max(
      0,
      isDirectVideo && !isTranscodedDirectStream
        ? videoElapsedMs
        : baseOffsetMs + videoElapsedMs
    )
  );
  const displayPositionMs = scrubPreviewMs !== null ? scrubPreviewMs : livePositionMs;

  // Keep active chapter badge synchronized as playback progresses across chapter boundaries
  const activeChapterNumber = React.useMemo(() => {
    if (!dvdChapters.length) return chapter;
    let current = dvdChapters[0].chapter_number;
    for (const ch of dvdChapters) {
      if (displayPositionMs >= ch.start_ms) {
        current = ch.chapter_number;
      } else {
        break;
      }
    }
    return current;
  }, [dvdChapters, displayPositionMs, chapter]);

  const wakeHud = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current !== null) {
      window.clearTimeout(hudTimerRef.current);
      hudTimerRef.current = null;
    }
    if (!isPaused) {
      hudTimerRef.current = window.setTimeout(() => {
        setHudVisible(false);
      }, 3500);
    }
  }, [isPaused]);

  useEffect(() => {
    wakeHud();
    return () => {
      if (hudTimerRef.current !== null) {
        window.clearTimeout(hudTimerRef.current);
      }
    };
  }, [isPaused, wakeHud]);

  useEffect(() => {
    setStreamError(null);
    if (!isDirectVideo || isTranscodedDirectStream) {
      setVideoElapsedMs(0);
    }
  }, [streamUrl, isDirectVideo, isTranscodedDirectStream]);

  // Fetch active subtitle track into a same-origin Blob URL so <track> works without crossOrigin on <video>
  useEffect(() => {
    if (!isDirectVideo || subIdx === 'off') {
      setSubBlobUrl(null);
      return;
    }
    const targetSub = activeSubtitles.find((s) => s.id === subIdx);
    if (!targetSub) {
      setSubBlobUrl(null);
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    fetch(resolveUrl(targetSub.vtt_url))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('Subtitle fetch failed'))))
      .then((vttText) => {
        if (cancelled) return;
        const blob = new Blob([vttText], { type: 'text/vtt;charset=utf-8' });
        createdUrl = URL.createObjectURL(blob);
        setSubBlobUrl(createdUrl);
      })
      .catch(() => {
        if (!cancelled) setSubBlobUrl(null);
      });
    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [isDirectVideo, subIdx, activeSubtitles, resolveUrl]);

  // Synchronize HTML5 <track> textTrack mode when subtitle selection changes in direct video mode
  useEffect(() => {
    if (!isDirectVideo || !videoRef.current) return;
    const tracks = videoRef.current.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = subIdx !== 'off' && subBlobUrl ? 'showing' : 'hidden';
    }
  }, [isDirectVideo, subIdx, subBlobUrl, streamUrl]);

  // Place gamepad focus marker on the Play/Pause button when the Theatre Player opens
  useEffect(() => {
    const t = window.setTimeout(() => {
      const defaultBtn = modalRootRef.current?.querySelector<HTMLElement>(
        '[data-default-focus="true"]'
      );
      if (defaultBtn) {
        document
          .querySelectorAll<HTMLElement>('[data-simp-active-focus="true"], .simp-gpfocus')
          .forEach((node) => {
            node.removeAttribute('data-simp-active-focus');
            node.classList.remove('simp-gpfocus');
          });
        defaultBtn.setAttribute('data-simp-active-focus', 'true');
        defaultBtn.classList.add('simp-gpfocus');
      }
    }, 40);
    return () => window.clearTimeout(t);
  }, []);

  const jumpToTimeMs = useCallback(
    (targetMs: number) => {
      wakeHud();
      const clamped = Math.max(0, Math.min(totalDurationMs - 500, Math.floor(targetMs)));
      setScrubPreviewMs(null);
      if (isDirectVideo && !isTranscodedDirectStream) {
        if (videoRef.current) {
          videoRef.current.currentTime = clamped / 1000;
        }
        setVideoElapsedMs(clamped);
      } else {
        setBaseOffsetMs(clamped);
        setVideoElapsedMs(0);
        setSeekMs(clamped);
      }
    },
    [totalDurationMs, isDirectVideo, isTranscodedDirectStream, wakeHud]
  );

  const jumpToChapter = useCallback(
    (chapterNum: number) => {
      wakeHud();
      const chInfo = dvdChapters.find((c) => c.chapter_number === chapterNum);
      setScrubPreviewMs(null);
      setChapter(chapterNum);
      setSeekMs(null);
      setBaseOffsetMs(chInfo?.start_ms ?? 0);
      setVideoElapsedMs(0);
    },
    [dvdChapters, wakeHud]
  );

  const jumpToEpisode = useCallback(
    (nextEpIdx: number) => {
      wakeHud();
      if (nextEpIdx < 0 || nextEpIdx >= episodes.length) return;
      setScrubPreviewMs(null);
      setEpisodeIdx(nextEpIdx);
      setQualityIdx(0);
      setSeekMs(null);
      setBaseOffsetMs(0);
      setVideoElapsedMs(0);
      setNativeDurationMs(0);
      pendingResumeSecRef.current = null;
    },
    [episodes.length, wakeHud]
  );

  const preservePositionForStreamSwitch = useCallback(() => {
    const activeCh = dvdChapters.find((c) => c.chapter_number === activeChapterNumber);
    const chStart = activeCh?.start_ms ?? 0;
    if (livePositionMs - chStart < 6000) {
      setChapter(activeChapterNumber);
      setBaseOffsetMs(chStart);
      setSeekMs(null);
    } else {
      setChapter(activeChapterNumber);
      setBaseOffsetMs(livePositionMs);
      setSeekMs(Math.floor(livePositionMs));
    }
    setVideoElapsedMs(0);
  }, [dvdChapters, activeChapterNumber, livePositionMs]);

  const cycleAudioOrQuality = useCallback(() => {
    wakeHud();
    if (isDirectVideo) {
      if (activeQualities.length <= 1) return;
      const nextIdx = (qualityIdx + 1) % activeQualities.length;
      const nextQual = activeQualities[nextIdx];
      const nextIsTranscoded = Boolean(
        nextQual?.stream_url &&
          (nextQual.stream_url.includes('/api/video/ia_stream') ||
            nextQual.stream_url.includes('transcode=1'))
      );
      if (livePositionMs > 1000) {
        if (nextIsTranscoded) {
          setBaseOffsetMs(livePositionMs);
          setSeekMs(Math.floor(livePositionMs));
          setVideoElapsedMs(0);
          pendingResumeSecRef.current = null;
        } else {
          pendingResumeSecRef.current = livePositionMs / 1000;
          setBaseOffsetMs(0);
          setSeekMs(null);
        }
      } else {
        setBaseOffsetMs(0);
        setSeekMs(null);
        pendingResumeSecRef.current = null;
      }
      setQualityIdx(nextIdx);
      return;
    }
    if (dvdAudioTracks.length <= 1) return;
    const curPos = dvdAudioTracks.findIndex((a) => a.stream_index === audioIdx);
    const nextPos = (curPos + 1) % dvdAudioTracks.length;
    preservePositionForStreamSwitch();
    setAudioIdx(dvdAudioTracks[nextPos].stream_index);
  }, [
    wakeHud,
    isDirectVideo,
    activeQualities,
    qualityIdx,
    livePositionMs,
    dvdAudioTracks,
    audioIdx,
    preservePositionForStreamSwitch,
  ]);

  const cycleSubtitleTrack = useCallback(() => {
    wakeHud();
    if (isDirectVideo) {
      if (activeSubtitles.length === 0) return;
      const options = ['off', ...activeSubtitles.map((s) => s.id)];
      const curPos = options.indexOf(subIdx);
      const nextPos = (curPos + 1) % options.length;
      setSubIdx(options[nextPos]);
      return;
    }
    if (dvdSubtitleTracks.length === 0) return;
    const options = ['off', ...dvdSubtitleTracks.map((s) => String(s.stream_index))];
    const curPos = options.indexOf(subIdx);
    const nextPos = (curPos + 1) % options.length;
    preservePositionForStreamSwitch();
    setSubIdx(options[nextPos]);
  }, [
    wakeHud,
    isDirectVideo,
    activeSubtitles,
    dvdSubtitleTracks,
    subIdx,
    preservePositionForStreamSwitch,
  ]);

  const togglePlayPause = useCallback(() => {
    wakeHud();
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [wakeHud]);

  const toggleMute = useCallback(() => {
    wakeHud();
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setIsMuted(el.muted);
  }, [wakeHud]);

  const toggleFullscreen = useCallback(() => {
    wakeHud();
    const el = modalRootRef.current || videoRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen?.().catch(() => {});
    }
  }, [wakeHud]);

  // Listen for direct controller buttons (`A`, `B`, `X`, `Y`, `L1`, `R1`, `L2`, `R2`, `Select`, Scrubber D-Pad)
  useEffect(() => {
    const onGamepadOp = (ev: Event) => {
      wakeHud();
      const op = (ev as CustomEvent<{ op: string }>).detail?.op;
      switch (op) {
        case 'close':
          onClose();
          break;
        case 'toggle-play':
          togglePlayPause();
          break;
        case 'cycle-audio':
          cycleAudioOrQuality();
          break;
        case 'cycle-subtitles':
          cycleSubtitleTrack();
          break;
        case 'prev-chapter':
          if (isDirectVideo) {
            if (episodes.length > 1) {
              jumpToEpisode(Math.max(0, episodeIdx - 1));
            } else {
              jumpToTimeMs(livePositionMs - 30000);
            }
          } else if (dvdChapters.length > 1) {
            jumpToChapter(Math.max(1, activeChapterNumber - 1));
          } else {
            jumpToTimeMs(livePositionMs - 30000);
          }
          break;
        case 'next-chapter':
          if (isDirectVideo) {
            if (episodes.length > 1) {
              jumpToEpisode(Math.min(episodes.length - 1, episodeIdx + 1));
            } else {
              jumpToTimeMs(livePositionMs + 30000);
            }
          } else if (dvdChapters.length > 1) {
            jumpToChapter(Math.min(dvdChapters.length, activeChapterNumber + 1));
          } else {
            jumpToTimeMs(livePositionMs + 30000);
          }
          break;
        case 'seek-back':
          jumpToTimeMs(livePositionMs - 15000);
          break;
        case 'seek-fwd':
          jumpToTimeMs(livePositionMs + 30000);
          break;
        case 'fullscreen':
          toggleFullscreen();
          break;
        case 'scrub-left':
          setScrubPreviewMs((prev) =>
            Math.max(0, (prev !== null ? prev : livePositionMs) - 15000)
          );
          break;
        case 'scrub-right':
          setScrubPreviewMs((prev) =>
            Math.min(totalDurationMs - 1000, (prev !== null ? prev : livePositionMs) + 15000)
          );
          break;
        case 'scrub-commit':
          if (scrubPreviewMs !== null) {
            jumpToTimeMs(scrubPreviewMs);
          }
          break;
      }
    };
    window.addEventListener('simp-dvd-gamepad-op', onGamepadOp);
    return () => window.removeEventListener('simp-dvd-gamepad-op', onGamepadOp);
  }, [
    wakeHud,
    onClose,
    togglePlayPause,
    cycleAudioOrQuality,
    cycleSubtitleTrack,
    isDirectVideo,
    episodes.length,
    episodeIdx,
    jumpToEpisode,
    jumpToChapter,
    jumpToTimeMs,
    toggleFullscreen,
    dvdChapters.length,
    activeChapterNumber,
    livePositionMs,
    totalDurationMs,
    scrubPreviewMs,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      wakeHud();
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        cycleAudioOrQuality();
      } else if (e.key === 'y' || e.key === 'Y' || e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        cycleSubtitleTrack();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        jumpToTimeMs(livePositionMs - 15000);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        jumpToTimeMs(livePositionMs + 30000);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    onClose,
    togglePlayPause,
    cycleAudioOrQuality,
    cycleSubtitleTrack,
    toggleFullscreen,
    toggleMute,
    jumpToTimeMs,
    livePositionMs,
    wakeHud,
  ]);

  const currentAudioOrQualityLabel = isDirectVideo
    ? `${activeQuality?.label || 'Standard'}${
        activeQualities.length > 1 ? ` (${qualityIdx + 1}/${activeQualities.length})` : ''
      }`
    : dvdAudioTracks.find((a) => a.stream_index === audioIdx)?.label ||
      dvdAudioTracks[0]?.label ||
      'Default';

  const currentSubLabel =
    subIdx === 'off'
      ? 'Off'
      : isDirectVideo
        ? activeSubtitles.find((s) => s.id === subIdx)?.label || 'Captions'
        : dvdSubtitleTracks.find((s) => String(s.stream_index) === subIdx)?.label ||
          `Track ${subIdx}`;

  const progressPct = Math.min(100, Math.max(0, (displayPositionMs / totalDurationMs) * 100));

  const subtitleLabelText = isDirectVideo
    ? activeEpisode
      ? `${activeEpisode.label}${episodes.length > 1 ? ` • Part ${episodeIdx + 1}/${episodes.length}` : ''} • ${formatDuration(displayPositionMs)} / ${formatDuration(totalDurationMs)}`
      : `${formatDuration(displayPositionMs)} / ${formatDuration(totalDurationMs)}`
    : `Title ${titleInfo?.title_number ?? 1} • Chapter ${activeChapterNumber}/${Math.max(1, dvdChapters.length)} • ${titleInfo?.aspect_ratio ?? '16:9'} • ${formatDuration(displayPositionMs)} / ${formatDuration(totalDurationMs)}`;

  const hudTransitionStyle: React.CSSProperties = {
    opacity: hudVisible || isPaused ? 1 : 0,
    pointerEvents: hudVisible || isPaused ? 'auto' : 'none',
    transition: 'opacity 220ms ease',
  };

  return (
    <div
      ref={modalRootRef}
      data-modal-root="true"
      data-dvd-modal="true"
      onMouseMove={wakeHud}
      onClick={wakeHud}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#03050a',
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 18px',
        color: '#f8fafc',
      }}
    >
      {/* Top Theatre Header (Auto-hides after 3.5s during playback) */}
      <div
        style={{
          ...hudTransitionStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          paddingBottom: '10px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <button
            data-gamepad-item
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.18)',
              color: '#f8fafc',
              borderRadius: '7px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Back (B)
          </button>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {discTitle}
              {!isDirectVideo && titleInfo?.label ? ` — ${titleInfo.label}` : ''}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{subtitleLabelText}</div>
          </div>
        </div>

        {/* Clean Typographic Mode Badge (All interactive controls live on the single bottom D-Pad rail) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'monospace',
              fontWeight: 800,
              letterSpacing: '0.06em',
              padding: '3px 8px',
              borderRadius: '5px',
              background:
                mode === 'ia_video'
                  ? 'rgba(245, 158, 11, 0.14)'
                  : mode === 'local_video'
                    ? 'rgba(56, 189, 248, 0.14)'
                    : 'rgba(148, 163, 184, 0.14)',
              border:
                mode === 'ia_video'
                  ? '1px solid rgba(245, 158, 11, 0.38)'
                  : mode === 'local_video'
                    ? '1px solid rgba(56, 189, 248, 0.38)'
                    : '1px solid rgba(148, 163, 184, 0.3)',
              color:
                mode === 'ia_video'
                  ? '#fde68a'
                  : mode === 'local_video'
                    ? '#7dd3fc'
                    : '#cbd5e1',
            }}
          >
            {mode === 'ia_video' ? 'ARCHIVE' : mode === 'local_video' ? 'VIDEO' : 'DVD'}
          </span>
        </div>
      </div>

      {/* Main Video Stage */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          margin: '8px 0',
          background: '#000',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <video
          ref={videoRef}
          key={streamUrl}
          src={streamUrl}
          autoPlay
          playsInline
          onClick={togglePlayPause}
          onPlay={() => setIsPaused(false)}
          onPause={() => setIsPaused(true)}
          onLoadedMetadata={(e) => {
            const dur = e.currentTarget.duration;
            if (Number.isFinite(dur) && dur > 0) {
              setNativeDurationMs(Math.floor(dur * 1000));
            }
            if (!isTranscodedDirectStream && pendingResumeSecRef.current !== null) {
              e.currentTarget.currentTime = pendingResumeSecRef.current;
              pendingResumeSecRef.current = null;
            }
          }}
          onDurationChange={(e) => {
            const dur = e.currentTarget.duration;
            if (Number.isFinite(dur) && dur > 0) {
              setNativeDurationMs(Math.floor(dur * 1000));
            }
          }}
          onTimeUpdate={(e) => {
            const sec = e.currentTarget.currentTime;
            if (Number.isFinite(sec) && sec >= 0) {
              setVideoElapsedMs(Math.floor(sec * 1000));
            }
          }}
          onEnded={() => {
            if (isDirectVideo && episodes.length > 1 && episodeIdx + 1 < episodes.length) {
              jumpToEpisode(episodeIdx + 1);
            }
          }}
          onError={() => {
            if (isDirectVideo && qualityIdx + 1 < activeQualities.length) {
              setQualityIdx((prev) => prev + 1);
              return;
            }
            setStreamError(
              isDirectVideo
                ? activeQualities.length > 1
                  ? 'Video stream unavailable for this format. Press X to switch quality.'
                  : 'Video stream unavailable (check network or install ffmpeg for compatibility).'
                : 'DVD stream interrupted. Select another chapter or verify ffmpeg / libdvdcss.'
            );
          }}
          style={{
            width: '100%',
            height: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            background: '#000',
            cursor: hudVisible ? 'pointer' : 'none',
          }}
        >
          {isDirectVideo && subIdx !== 'off' && subBlobUrl && (
            <track
              key={`${subIdx}-${subBlobUrl}`}
              kind="subtitles"
              src={subBlobUrl}
              srcLang="en"
              label={currentSubLabel}
              default
            />
          )}
        </video>

        {streamError && (
          <div
            style={{
              position: 'absolute',
              bottom: '16px',
              left: '20px',
              right: '20px',
              background: 'rgba(127, 29, 29, 0.92)',
              border: '1px solid rgba(248, 113, 113, 0.4)',
              color: '#fecaca',
              padding: '9px 14px',
              borderRadius: '7px',
              fontSize: '12px',
              textAlign: 'center',
            }}
          >
            {streamError}
          </div>
        )}
      </div>

      {/* Auto-Hiding Bottom Scrubber & Single-Rail Transport Controls */}
      <div
        style={{
          ...hudTransitionStyle,
          display: 'flex',
          flexDirection: 'column',
          gap: '7px',
          padding: '9px 14px',
          background: 'rgba(11, 17, 30, 0.9)',
          border: '1px solid rgba(255,255,255,0.09)',
          borderRadius: '9px',
        }}
      >
        {/* Full-Length Scrubber Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              fontSize: '11px',
              fontFamily: 'monospace',
              fontWeight: 700,
              color: scrubPreviewMs !== null ? '#facc15' : '#38bdf8',
              minWidth: '52px',
              textAlign: 'right',
            }}
          >
            {formatDuration(displayPositionMs)}
          </span>

          <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: '5px',
                borderRadius: '999px',
                background: 'rgba(255,255,255,0.14)',
                overflow: 'hidden',
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  background:
                    scrubPreviewMs !== null
                      ? 'linear-gradient(90deg, #eab308, #facc15)'
                      : 'linear-gradient(90deg, #0ea5e9, #38bdf8)',
                }}
              />
            </div>
            {!isDirectVideo &&
              dvdChapters.slice(1).map((ch) => {
                const pct = Math.min(99.5, Math.max(0.5, (ch.start_ms / totalDurationMs) * 100));
                return (
                  <div
                    key={`tick-${ch.chapter_number}`}
                    title={`Chapter ${ch.chapter_number} (${formatDuration(ch.start_ms)})`}
                    style={{
                      position: 'absolute',
                      left: `${pct}%`,
                      width: '2px',
                      height: '9px',
                      background: 'rgba(255,255,255,0.42)',
                      pointerEvents: 'none',
                    }}
                  />
                );
              })}
            <input
              data-gamepad-item
              data-dvd-scrubber="true"
              type="range"
              min={0}
              max={totalDurationMs}
              step={1000}
              value={Math.floor(displayPositionMs)}
              onChange={(e) => setScrubPreviewMs(Number(e.target.value))}
              onMouseUp={(e) => jumpToTimeMs(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => jumpToTimeMs(Number((e.target as HTMLInputElement).value))}
              style={{
                width: '100%',
                margin: 0,
                cursor: 'pointer',
                accentColor: '#38bdf8',
                position: 'relative',
                zIndex: 2,
              }}
            />
          </div>

          <span
            style={{
              fontSize: '11px',
              fontFamily: 'monospace',
              color: '#94a3b8',
              minWidth: '52px',
            }}
          >
            {formatDuration(totalDurationMs)}
          </span>
        </div>

        {/* Single Horizontal D-Pad Transport Rail */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <button
              data-gamepad-item
              data-default-focus="true"
              onClick={togglePlayPause}
              style={{
                background: 'rgba(56, 189, 248, 0.18)',
                border: '1px solid rgba(56, 189, 248, 0.42)',
                color: '#f8fafc',
                borderRadius: '6px',
                padding: '4px 12px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {isPaused ? 'Play (A)' : 'Pause (A)'}
            </button>
            <button
              data-gamepad-item
              onClick={() => jumpToTimeMs(livePositionMs - 15000)}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.14)',
                color: '#cbd5e1',
                borderRadius: '6px',
                padding: '4px 9px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              -15s (L2)
            </button>
            <button
              data-gamepad-item
              onClick={() => jumpToTimeMs(livePositionMs + 30000)}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.14)',
                color: '#cbd5e1',
                borderRadius: '6px',
                padding: '4px 9px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              +30s (R2)
            </button>

            {isDirectVideo && episodes.length > 1 && (
              <>
                <button
                  data-gamepad-item
                  disabled={episodeIdx <= 0}
                  onClick={() => jumpToEpisode(Math.max(0, episodeIdx - 1))}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    color: episodeIdx <= 0 ? '#475569' : '#cbd5e1',
                    borderRadius: '6px',
                    padding: '4px 9px',
                    fontSize: '11px',
                    cursor: episodeIdx <= 0 ? 'default' : 'pointer',
                  }}
                >
                  Prev Part (L1)
                </button>
                <button
                  data-gamepad-item
                  disabled={episodeIdx >= episodes.length - 1}
                  onClick={() => jumpToEpisode(Math.min(episodes.length - 1, episodeIdx + 1))}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    color: episodeIdx >= episodes.length - 1 ? '#475569' : '#cbd5e1',
                    borderRadius: '6px',
                    padding: '4px 9px',
                    fontSize: '11px',
                    cursor: episodeIdx >= episodes.length - 1 ? 'default' : 'pointer',
                  }}
                >
                  Next Part (R1)
                </button>
              </>
            )}

            {!isDirectVideo && dvdChapters.length > 1 && (
              <>
                <button
                  data-gamepad-item
                  disabled={activeChapterNumber <= 1}
                  onClick={() => jumpToChapter(Math.max(1, activeChapterNumber - 1))}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    color: activeChapterNumber <= 1 ? '#475569' : '#cbd5e1',
                    borderRadius: '6px',
                    padding: '4px 9px',
                    fontSize: '11px',
                    cursor: activeChapterNumber <= 1 ? 'default' : 'pointer',
                  }}
                >
                  Prev Ch (L1)
                </button>
                <button
                  data-gamepad-item
                  disabled={activeChapterNumber >= dvdChapters.length}
                  onClick={() =>
                    jumpToChapter(Math.min(dvdChapters.length, activeChapterNumber + 1))
                  }
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    color: activeChapterNumber >= dvdChapters.length ? '#475569' : '#cbd5e1',
                    borderRadius: '6px',
                    padding: '4px 9px',
                    fontSize: '11px',
                    cursor: activeChapterNumber >= dvdChapters.length ? 'default' : 'pointer',
                  }}
                >
                  Next Ch (R1)
                </button>
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {(isDirectVideo ? activeQualities.length > 0 : dvdAudioTracks.length > 0) && (
              <button
                data-gamepad-item
                onClick={cycleAudioOrQuality}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#e2e8f0',
                  background: 'rgba(255,255,255,0.06)',
                  padding: '4px 9px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.14)',
                  cursor:
                    (isDirectVideo ? activeQualities.length : dvdAudioTracks.length) > 1
                      ? 'pointer'
                      : 'default',
                }}
              >
                <span style={{ color: '#94a3b8' }}>
                  {isDirectVideo ? 'Quality (X):' : 'Audio (X):'}
                </span>
                <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                  {currentAudioOrQualityLabel}
                </span>
              </button>
            )}

            {(isDirectVideo ? activeSubtitles.length > 0 : dvdSubtitleTracks.length > 0) && (
              <button
                data-gamepad-item
                onClick={cycleSubtitleTrack}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#e2e8f0',
                  background:
                    subIdx !== 'off' ? 'rgba(56, 189, 248, 0.14)' : 'rgba(255,255,255,0.06)',
                  padding: '4px 9px',
                  borderRadius: '6px',
                  border:
                    subIdx !== 'off'
                      ? '1px solid rgba(56, 189, 248, 0.42)'
                      : '1px solid rgba(255,255,255,0.14)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ color: '#94a3b8' }}>CC (Y):</span>
                <span
                  style={{
                    color: subIdx !== 'off' ? '#38bdf8' : '#cbd5e1',
                    fontWeight: 700,
                  }}
                >
                  {currentSubLabel}
                </span>
              </button>
            )}

            <button
              data-gamepad-item
              onClick={toggleMute}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.14)',
                color: isMuted ? '#f87171' : '#cbd5e1',
                borderRadius: '6px',
                padding: '4px 9px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              {isMuted ? 'Muted' : 'Mute'}
            </button>

            <button
              data-gamepad-item
              onClick={toggleFullscreen}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.14)',
                color: '#cbd5e1',
                borderRadius: '6px',
                padding: '4px 9px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Fullscreen (SELECT)
            </button>
          </div>
        </div>

        {/* Compact Episode / Chapter Strip when multi-part */}
        {isDirectVideo && episodes.length > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              overflowX: 'auto',
              paddingTop: '2px',
            }}
          >
            <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, flexShrink: 0 }}>
              Parts:
            </span>
            {episodes.map((ep, idx) => {
              const active = idx === episodeIdx;
              return (
                <button
                  key={ep.episode_number}
                  data-gamepad-item
                  onClick={() => jumpToEpisode(idx)}
                  style={{
                    background: active ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.05)',
                    border: active
                      ? '1px solid rgba(56, 189, 248, 0.5)'
                      : '1px solid rgba(255,255,255,0.12)',
                    color: active ? '#38bdf8' : '#cbd5e1',
                    borderRadius: '6px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {idx + 1}. {ep.label}
                </button>
              );
            })}
          </div>
        )}

        {!isDirectVideo && dvdChapters.length > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              overflowX: 'auto',
              paddingTop: '2px',
            }}
          >
            <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, flexShrink: 0 }}>
              Chapters:
            </span>
            {dvdChapters.map((ch) => {
              const active = ch.chapter_number === activeChapterNumber;
              return (
                <button
                  key={ch.chapter_number}
                  data-gamepad-item
                  onClick={() => jumpToChapter(ch.chapter_number)}
                  style={{
                    background: active ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.05)',
                    border: active
                      ? '1px solid rgba(56, 189, 248, 0.5)'
                      : '1px solid rgba(255,255,255,0.12)',
                    color: active ? '#38bdf8' : '#cbd5e1',
                    borderRadius: '6px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Ch {ch.chapter_number} ({formatDuration(ch.start_ms)})
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
