import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DvdTitleInfo } from '@simp/client';

interface DvdPlayerModalProps {
  devicePath: string;
  discTitle: string;
  titleInfo: DvdTitleInfo;
  initialChapter?: number;
  initialAudioIndex?: number;
  initialSubtitleIndex?: string; // 'off' or stream_index string
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
  devicePath,
  discTitle,
  titleInfo,
  initialChapter = 1,
  initialAudioIndex = 0,
  initialSubtitleIndex = 'off',
  onClose,
}) => {
  const initialChapterStartMs =
    titleInfo.chapters.find((c) => c.chapter_number === initialChapter)?.start_ms ?? 0;

  const [chapter, setChapter] = useState<number>(initialChapter);
  const [seekMs, setSeekMs] = useState<number | null>(null);
  const [baseOffsetMs, setBaseOffsetMs] = useState<number>(initialChapterStartMs);
  const [videoElapsedMs, setVideoElapsedMs] = useState<number>(0);
  const [scrubPreviewMs, setScrubPreviewMs] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [audioIdx, setAudioIdx] = useState<number>(
    titleInfo.audio_tracks[0]?.stream_index ?? initialAudioIndex
  );
  const [subIdx, setSubIdx] = useState<string>(initialSubtitleIndex);
  const [streamError, setStreamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const modalRootRef = useRef<HTMLDivElement | null>(null);

  const totalDurationMs = Math.max(
    1000,
    titleInfo.duration_ms ||
      titleInfo.chapters.reduce((acc, ch) => Math.max(acc, ch.start_ms + ch.duration_ms), 0) ||
      1000
  );

  const livePositionMs = Math.min(
    totalDurationMs,
    Math.max(0, baseOffsetMs + videoElapsedMs)
  );
  const displayPositionMs = scrubPreviewMs !== null ? scrubPreviewMs : livePositionMs;

  // Keep active chapter badge synchronized as playback progresses across chapter boundaries
  const activeChapterNumber = React.useMemo(() => {
    if (!titleInfo.chapters.length) return chapter;
    let current = titleInfo.chapters[0].chapter_number;
    for (const ch of titleInfo.chapters) {
      if (displayPositionMs >= ch.start_ms) {
        current = ch.chapter_number;
      } else {
        break;
      }
    }
    return current;
  }, [titleInfo.chapters, displayPositionMs, chapter]);

  const daemonOrigin =
    typeof window !== 'undefined' && window.location.port === '18888'
      ? window.location.origin
      : 'http://127.0.0.1:18888';

  const streamUrl = `${daemonOrigin}/api/dvd/stream?device=${encodeURIComponent(
    devicePath
  )}&title=${titleInfo.title_number}&chapter=${chapter}&audio=${audioIdx}&sub=${encodeURIComponent(
    subIdx
  )}${seekMs !== null && seekMs > 0 ? `&seek_ms=${Math.floor(seekMs)}` : ''}`;

  useEffect(() => {
    setStreamError(null);
    setVideoElapsedMs(0);
  }, [streamUrl]);

  // Place gamepad focus marker on the Play/Pause button when the DVD Player opens
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
      const clamped = Math.max(0, Math.min(totalDurationMs - 500, Math.floor(targetMs)));
      setScrubPreviewMs(null);
      setBaseOffsetMs(clamped);
      setVideoElapsedMs(0);
      setSeekMs(clamped);
    },
    [totalDurationMs]
  );

  const jumpToChapter = useCallback(
    (chapterNum: number) => {
      const chInfo = titleInfo.chapters.find((c) => c.chapter_number === chapterNum);
      setScrubPreviewMs(null);
      setChapter(chapterNum);
      setSeekMs(null);
      setBaseOffsetMs(chInfo?.start_ms ?? 0);
      setVideoElapsedMs(0);
    },
    [titleInfo.chapters]
  );

  const preservePositionForStreamSwitch = useCallback(() => {
    const activeCh = titleInfo.chapters.find((c) => c.chapter_number === activeChapterNumber);
    const chStart = activeCh?.start_ms ?? 0;
    // If within the first 6 seconds of the active chapter, start cleanly from the chapter boundary
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
  }, [titleInfo.chapters, activeChapterNumber, livePositionMs]);

  const cycleAudioTrack = useCallback(() => {
    if (titleInfo.audio_tracks.length <= 1) return;
    const curPos = titleInfo.audio_tracks.findIndex((a) => a.stream_index === audioIdx);
    const nextPos = (curPos + 1) % titleInfo.audio_tracks.length;
    preservePositionForStreamSwitch();
    setAudioIdx(titleInfo.audio_tracks[nextPos].stream_index);
  }, [titleInfo.audio_tracks, audioIdx, preservePositionForStreamSwitch]);

  const cycleSubtitleTrack = useCallback(() => {
    if (titleInfo.subtitle_tracks.length === 0) return;
    const options = ['off', ...titleInfo.subtitle_tracks.map((s) => String(s.stream_index))];
    const curPos = options.indexOf(subIdx);
    const nextPos = (curPos + 1) % options.length;
    preservePositionForStreamSwitch();
    setSubIdx(options[nextPos]);
  }, [titleInfo.subtitle_tracks, subIdx, preservePositionForStreamSwitch]);

  const togglePlayPause = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setIsMuted(el.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = modalRootRef.current || videoRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen?.().catch(() => {});
    }
  }, []);

  // Listen for direct controller buttons (`A`, `B`, `X`, `Y`, `L1`, `R1`, `L2`, `R2`, `Select`, Scrubber D-Pad)
  useEffect(() => {
    const onGamepadOp = (ev: Event) => {
      const op = (ev as CustomEvent<{ op: string }>).detail?.op;
      switch (op) {
        case 'close':
          onClose();
          break;
        case 'toggle-play':
          togglePlayPause();
          break;
        case 'cycle-audio':
          cycleAudioTrack();
          break;
        case 'cycle-subtitles':
          cycleSubtitleTrack();
          break;
        case 'prev-chapter':
          if (titleInfo.chapters.length > 1) {
            jumpToChapter(Math.max(1, activeChapterNumber - 1));
          } else {
            jumpToTimeMs(livePositionMs - 30000);
          }
          break;
        case 'next-chapter':
          if (titleInfo.chapters.length > 1) {
            jumpToChapter(Math.min(titleInfo.chapters.length, activeChapterNumber + 1));
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
    onClose,
    togglePlayPause,
    cycleAudioTrack,
    cycleSubtitleTrack,
    jumpToChapter,
    jumpToTimeMs,
    toggleFullscreen,
    titleInfo.chapters.length,
    activeChapterNumber,
    livePositionMs,
    totalDurationMs,
    scrubPreviewMs,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlayPause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, togglePlayPause]);

  const currentAudioLabel =
    titleInfo.audio_tracks.find((a) => a.stream_index === audioIdx)?.label ||
    titleInfo.audio_tracks[0]?.label ||
    'Default';

  const currentSubLabel =
    subIdx === 'off'
      ? 'Off'
      : titleInfo.subtitle_tracks.find((s) => String(s.stream_index) === subIdx)?.label ||
        `Track ${subIdx}`;

  const progressPct = Math.min(100, Math.max(0, (displayPositionMs / totalDurationMs) * 100));

  return (
    <div
      ref={modalRootRef}
      data-modal-root="true"
      data-dvd-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(4, 6, 12, 0.96)',
        display: 'flex',
        flexDirection: 'column',
        padding: '14px 18px',
        color: '#f8fafc',
      }}
    >
      {/* Top Theatre Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          paddingBottom: '10px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <button
            data-gamepad-item
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#f8fafc',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ← Back (B)
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
              📀 {discTitle} — {titleInfo.label}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
              Title {titleInfo.title_number} • Chapter {activeChapterNumber}/
              {Math.max(1, titleInfo.chapters.length)} • {titleInfo.aspect_ratio} •{' '}
              {formatDuration(displayPositionMs)} / {formatDuration(totalDurationMs)}
            </div>
          </div>
        </div>

        {/* Controller-Friendly Audio (X), Subtitle (Y) & Fullscreen (Select) Cycle Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {titleInfo.audio_tracks.length > 0 && (
            <button
              data-gamepad-item
              onClick={cycleAudioTrack}
              title="Click or press X on controller to cycle audio tracks"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                fontWeight: 600,
                color: '#e2e8f0',
                background: 'rgba(255,255,255,0.08)',
                padding: '5px 10px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.16)',
                cursor: titleInfo.audio_tracks.length > 1 ? 'pointer' : 'default',
              }}
            >
              <span>🔊 Audio (X):</span>
              <span style={{ color: '#38bdf8', fontWeight: 700 }}>{currentAudioLabel}</span>
              {titleInfo.audio_tracks.length > 1 && (
                <span style={{ fontSize: '10px', color: '#94a3b8' }}>▸</span>
              )}
            </button>
          )}

          {titleInfo.subtitle_tracks.length > 0 && (
            <button
              data-gamepad-item
              onClick={cycleSubtitleTrack}
              title="Click or press Y on controller to cycle subtitle tracks"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                fontWeight: 600,
                color: '#e2e8f0',
                background:
                  subIdx !== 'off'
                    ? 'rgba(56, 189, 248, 0.16)'
                    : 'rgba(255,255,255,0.08)',
                padding: '5px 10px',
                borderRadius: '6px',
                border:
                  subIdx !== 'off'
                    ? '1px solid rgba(56, 189, 248, 0.45)'
                    : '1px solid rgba(255,255,255,0.16)',
                cursor: 'pointer',
              }}
            >
              <span>💬 Subtitles (Y):</span>
              <span
                style={{
                  color: subIdx !== 'off' ? '#38bdf8' : '#94a3b8',
                  fontWeight: 700,
                }}
              >
                {currentSubLabel}
              </span>
              <span style={{ fontSize: '10px', color: '#94a3b8' }}>▸</span>
            </button>
          )}

          <button
            data-gamepad-item
            onClick={toggleFullscreen}
            style={{
              background: 'rgba(56, 189, 248, 0.14)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              color: '#38bdf8',
              borderRadius: '6px',
              padding: '5px 10px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ⛶ Fullscreen
          </button>
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
          margin: '10px 0 6px 0',
          background: '#000',
          borderRadius: '10px',
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.08)',
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
          onTimeUpdate={(e) => {
            const sec = e.currentTarget.currentTime;
            if (Number.isFinite(sec) && sec >= 0) {
              setVideoElapsedMs(Math.floor(sec * 1000));
            }
          }}
          onError={() =>
            setStreamError(
              'DVD stream interrupted or failed to start. Try selecting another chapter/track or verify ffmpeg and VLC / libdvdcss are available.'
            )
          }
          style={{
            width: '100%',
            height: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            background: '#000',
            cursor: 'pointer',
          }}
        />
        {streamError && (
          <div
            style={{
              position: 'absolute',
              bottom: '20px',
              left: '20px',
              right: '20px',
              background: 'rgba(127, 29, 29, 0.92)',
              border: '1px solid rgba(248, 113, 113, 0.45)',
              color: '#fecaca',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '12px',
              textAlign: 'center',
            }}
          >
            ⚠️ {streamError}
          </div>
        )}
      </div>

      {/* Full-Duration DVD Timeline Scrubber & Transport Controls */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '8px 12px',
          background: 'rgba(15, 23, 42, 0.85)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '10px',
          marginBottom: titleInfo.chapters.length > 1 ? '8px' : '0',
        }}
      >
        {/* Full-Length Scrubber Bar with Chapter Tick Marks */}
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
            {/* Visual Track Fill + Chapter Markers */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: '6px',
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
            {titleInfo.chapters.slice(1).map((ch) => {
              const pct = Math.min(99.5, Math.max(0.5, (ch.start_ms / totalDurationMs) * 100));
              return (
                <div
                  key={`tick-${ch.chapter_number}`}
                  title={`Chapter ${ch.chapter_number} (${formatDuration(ch.start_ms)})`}
                  style={{
                    position: 'absolute',
                    left: `${pct}%`,
                    width: '2px',
                    height: '10px',
                    background: 'rgba(255,255,255,0.45)',
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

        {/* Transport Buttons Row */}
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
                background: 'rgba(56, 189, 248, 0.2)',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                color: '#f8fafc',
                borderRadius: '6px',
                padding: '4px 12px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {isPaused ? '▶ Play (A)' : '⏸ Pause (A)'}
            </button>
            <button
              data-gamepad-item
              onClick={() => jumpToTimeMs(livePositionMs - 15000)}
              style={{
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#cbd5e1',
                borderRadius: '6px',
                padding: '4px 9px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              ↺ -15s (L2)
            </button>
            <button
              data-gamepad-item
              onClick={() => jumpToTimeMs(livePositionMs + 30000)}
              style={{
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#cbd5e1',
                borderRadius: '6px',
                padding: '4px 9px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              +30s (R2) ↻
            </button>
            {titleInfo.chapters.length > 1 && (
              <>
                <button
                  data-gamepad-item
                  disabled={activeChapterNumber <= 1}
                  onClick={() => jumpToChapter(Math.max(1, activeChapterNumber - 1))}
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: activeChapterNumber <= 1 ? '#475569' : '#cbd5e1',
                    borderRadius: '6px',
                    padding: '4px 9px',
                    fontSize: '11px',
                    cursor: activeChapterNumber <= 1 ? 'default' : 'pointer',
                  }}
                >
                  ⏮ Prev Ch (L1)
                </button>
                <button
                  data-gamepad-item
                  disabled={activeChapterNumber >= titleInfo.chapters.length}
                  onClick={() =>
                    jumpToChapter(Math.min(titleInfo.chapters.length, activeChapterNumber + 1))
                  }
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color:
                      activeChapterNumber >= titleInfo.chapters.length ? '#475569' : '#cbd5e1',
                    borderRadius: '6px',
                    padding: '4px 9px',
                    fontSize: '11px',
                    cursor:
                      activeChapterNumber >= titleInfo.chapters.length ? 'default' : 'pointer',
                  }}
                >
                  Next Ch (R1) ⏭
                </button>
              </>
            )}
          </div>

          <button
            data-gamepad-item
            onClick={toggleMute}
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: isMuted ? '#f87171' : '#cbd5e1',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            {isMuted ? '🔇 Muted' : '🔊 Audio On'}
          </button>
        </div>
      </div>

      {/* Bottom Chapter Jump Bar */}
      {titleInfo.chapters.length > 1 && (
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
          {titleInfo.chapters.map((ch) => {
            const active = ch.chapter_number === activeChapterNumber;
            return (
              <button
                key={ch.chapter_number}
                data-gamepad-item
                onClick={() => jumpToChapter(ch.chapter_number)}
                style={{
                  background: active ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255,255,255,0.06)',
                  border: active
                    ? '1px solid rgba(56, 189, 248, 0.55)'
                    : '1px solid rgba(255,255,255,0.12)',
                  color: active ? '#38bdf8' : '#cbd5e1',
                  borderRadius: '6px',
                  padding: '4px 9px',
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
  );
};
