import React, { useEffect, useRef } from 'react';
import { defaultSimpClient } from '@simp/client';

interface Props {
  durationMs: number;
  trackUri?: string;
  waveformBars?: number[] | null;
  commentTimestampsMs?: number[];
  onPlayheadTick?: (currentMs: number) => void;
}

/**
 * "Single-Shot" Hardware-Accelerated Tall Progress & Scrub Bar.
 * - Never triggers React `useState` re-renders on 500ms ticks; interpolates bar fill & thumb
 *   at 60/90fps directly in the DOM via `useRef` and `requestAnimationFrame`.
 * - Includes monotonic forward anti-jitter clamping so coarse/rounded streaming `timeupdate`
 *   anchors (e.g., Apple MusicKit v3 whole-second `currentPlaybackTime` reports or background
 *   headless worker timer jitter) never cause the playhead to "inchworm" backward and forward.
 * - Insets the horizontal rail (`padding: 0 14px`) so the 26px playhead thumb (`±13px` radius)
 *   stays cleanly inside the column bounds at `0%` and `100%` without clipping or overlapping adjacent art.
 * - Optionally renders a 96-bar SoundCloud beat-drop waveform silhouette and comment cluster micro-dots.
 */
export const ProgressBarRaf: React.FC<Props> = ({
  durationMs,
  trackUri,
  waveformBars,
  commentTimestampsMs,
  onPlayheadTick,
}) => {
  const trackContainerRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const timeTextRef = useRef<HTMLSpanElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformBarsRef = useRef<number[] | null | undefined>(waveformBars);
  waveformBarsRef.current = waveformBars;
  const onPlayheadTickRef = useRef(onPlayheadTick);
  onPlayheadTickRef.current = onPlayheadTick;

  const isSoundCloudTrack = Boolean(trackUri && trackUri.startsWith('soundcloud:'));
  const isSoundCloudRef = useRef(isSoundCloudTrack);
  isSoundCloudRef.current = isSoundCloudTrack;

  const drawWaveformCanvas = (progressRatio: number) => {
    const canvas = waveformCanvasRef.current;
    const bars = waveformBarsRef.current;
    if (!canvas || !bars || bars.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const n = bars.length;
    const step = w / n;
    const barW = Math.max(1.2, step * 0.66);
    const midY = Math.round(h * 0.62);
    const maxTop = midY - 2;
    const maxBottom = h - midY - 2;
    const splitIdx = Math.floor(Math.max(0, Math.min(1, progressRatio)) * n);
    const isSc = isSoundCloudRef.current;

    const playedTop = isSc ? '#fb923c' : '#38bdf8';
    const playedBot = isSc ? 'rgba(234, 88, 12, 0.50)' : 'rgba(14, 165, 233, 0.46)';
    const unplayedTop = isSc ? 'rgba(251, 146, 60, 0.34)' : 'rgba(56, 189, 248, 0.32)';
    const unplayedBot = isSc ? 'rgba(194, 65, 12, 0.18)' : 'rgba(14, 116, 144, 0.18)';

    // Pass 1: Played Top
    ctx.fillStyle = playedTop;
    for (let i = 0; i < splitIdx; i++) {
      const amp = Math.max(0.1, Math.min(1, bars[i]));
      const topH = Math.max(2, Math.round(amp * maxTop));
      const x = Math.round(i * step);
      ctx.fillRect(x, midY - topH, barW, topH);
    }

    // Pass 2: Played Bottom Reflection
    ctx.fillStyle = playedBot;
    for (let i = 0; i < splitIdx; i++) {
      const amp = Math.max(0.1, Math.min(1, bars[i]));
      const botH = Math.max(1, Math.round(amp * maxBottom));
      const x = Math.round(i * step);
      ctx.fillRect(x, midY + 1, barW, botH);
    }

    // Pass 3: Unplayed Top
    ctx.fillStyle = unplayedTop;
    for (let i = splitIdx; i < n; i++) {
      const amp = Math.max(0.1, Math.min(1, bars[i]));
      const topH = Math.max(2, Math.round(amp * maxTop));
      const x = Math.round(i * step);
      ctx.fillRect(x, midY - topH, barW, topH);
    }

    // Pass 4: Unplayed Bottom Reflection
    ctx.fillStyle = unplayedBot;
    for (let i = splitIdx; i < n; i++) {
      const amp = Math.max(0.1, Math.min(1, bars[i]));
      const botH = Math.max(1, Math.round(amp * maxBottom));
      const x = Math.round(i * step);
      ctx.fillRect(x, midY + 1, barW, botH);
    }
  };

  const anchorPosRef = useRef(0);
  const anchorPerfRef = useRef(performance.now());
  const lastRenderedMsRef = useRef(0);
  const isPlayingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragPreviewMsRef = useRef(0);
  const lastDragSeekSentRef = useRef(0);
  const lastTickCallbackPerfRef = useRef(0);
  const prevTrackUriRef = useRef<string | undefined>(trackUri);
  const awaitingFirstStreamTickRef = useRef(false);

  useEffect(() => {
    let rafId = 0;
    let lastDomPct = -1;
    let lastWaveformStep = -1;
    let lastDomTimeText = '';

    // Reset monotonic playhead state when switching tracks or mounting back onto PlayerView
    const snap = defaultSimpClient.getState();
    const initialPos = Math.max(0, snap?.position_ms ?? 0);
    const isProgressiveCloudStream = Boolean(
      trackUri &&
        (trackUri.startsWith('applemusic:') ||
          trackUri.startsWith('soundcloud:') ||
          trackUri.startsWith('ia:audio:') ||
          trackUri.startsWith('ia://audio/'))
    );
    if (prevTrackUriRef.current !== trackUri) {
      prevTrackUriRef.current = trackUri;
      anchorPosRef.current = initialPos;
      lastRenderedMsRef.current = initialPos;
      anchorPerfRef.current = performance.now();
      awaitingFirstStreamTickRef.current = isProgressiveCloudStream && initialPos === 0;
    } else {
      anchorPosRef.current = initialPos;
      lastRenderedMsRef.current = initialPos;
      anchorPerfRef.current = performance.now();
      if (initialPos > 0 || !isProgressiveCloudStream) {
        awaitingFirstStreamTickRef.current = false;
      }
    }
    isPlayingRef.current = !!snap?.is_playing;

    const updateDom = () => {
      let currentMs = anchorPosRef.current;
      if (isDraggingRef.current) {
        currentMs = dragPreviewMsRef.current;
        lastRenderedMsRef.current = currentMs;
      } else if (
        isPlayingRef.current &&
        !awaitingFirstStreamTickRef.current &&
        anchorPosRef.current >= 0 &&
        durationMs > 0
      ) {
        const elapsedSinceTick = Math.min(performance.now() - anchorPerfRef.current, 1500);
        const rawMs = anchorPosRef.current + elapsedSinceTick;
        // Monotonic forward guard during active playback, clamped to track duration
        currentMs = Math.min(durationMs, Math.max(lastRenderedMsRef.current, rawMs));
        lastRenderedMsRef.current = currentMs;
      } else {
        currentMs = durationMs > 0 ? Math.min(durationMs, currentMs) : currentMs;
        lastRenderedMsRef.current = currentMs;
      }

      const pct = durationMs > 0 ? Math.max(0, Math.min((currentMs / durationMs) * 100, 100)) : 0;
      const roundedPct = Math.round(pct * 1000) / 1000;

      if (roundedPct !== lastDomPct) {
        lastDomPct = roundedPct;
        if (barRef.current) {
          barRef.current.style.transform = `scaleX(${roundedPct / 100})`;
        }
        if (thumbRef.current) {
          thumbRef.current.style.left = `${roundedPct}%`;
        }
        const wfStep = Math.round(roundedPct * 3.6);
        if (wfStep !== lastWaveformStep) {
          lastWaveformStep = wfStep;
          drawWaveformCanvas(roundedPct / 100);
        }
      }
      const nextTimeText = formatTime(currentMs);
      if (nextTimeText !== lastDomTimeText) {
        lastDomTimeText = nextTimeText;
        if (timeTextRef.current) {
          timeTextRef.current.textContent = nextTimeText;
        }
      }
      if (onPlayheadTickRef.current) {
        const nowPerf = performance.now();
        if (nowPerf - lastTickCallbackPerfRef.current > 200) {
          lastTickCallbackPerfRef.current = nowPerf;
          onPlayheadTickRef.current(currentMs);
        }
      }
    };

    const unsub = defaultSimpClient.subscribeProgress((rawPosMs, perfNow, playing, isTick) => {
      const posMs = durationMs > 0 ? Math.min(rawPosMs, durationMs) : rawPosMs;
      const wasPlaying = isPlayingRef.current;
      isPlayingRef.current = playing;

      if (awaitingFirstStreamTickRef.current) {
        if (isTick || posMs > 0) {
          awaitingFirstStreamTickRef.current = false;
          anchorPosRef.current = posMs;
          anchorPerfRef.current = perfNow;
          lastRenderedMsRef.current = posMs;
          updateDom();
        }
        return;
      }

      if (!playing || !wasPlaying) {
        anchorPosRef.current = posMs;
        anchorPerfRef.current = perfNow;
        lastRenderedMsRef.current = posMs;
        updateDom();
        return;
      }

      // Compute our current smooth rAF-extrapolated playhead position
      const predictedMs = anchorPosRef.current + (perfNow - anchorPerfRef.current);
      const driftMs = posMs - predictedMs;

      // Track restart or explicit backward seek (> 2.2s backward jump, or reset near 0:00)
      if (posMs <= 600 && predictedMs > 1200) {
        anchorPosRef.current = posMs;
        anchorPerfRef.current = perfNow;
        lastRenderedMsRef.current = posMs;
        updateDom();
        return;
      }
      if (driftMs < -2200 || driftMs > 2200) {
        // Explicit seek or major buffer resync: snap immediately
        anchorPosRef.current = posMs;
        anchorPerfRef.current = perfNow;
        lastRenderedMsRef.current = posMs;
        updateDom();
        return;
      }

      // Normal streaming / playback tick (`|driftMs| <= 2200ms`):
      // Apple MusicKit v3 `playbackTimeDidChange` often reports coarse/truncated timestamps or
      // fires from a throttled headless Chromium worker, arriving 200ms–1100ms behind or ahead
      // of our smooth rAF clock. Never allow a normal tick to pull the playhead backward!
      const nextAnchorMs = Math.max(
        lastRenderedMsRef.current,
        predictedMs + driftMs * 0.25
      );
      anchorPosRef.current = nextAnchorMs;
      anchorPerfRef.current = perfNow;
    });

    const renderLoop = () => {
      if (document.visibilityState !== 'hidden' && (isPlayingRef.current || isDraggingRef.current)) {
        updateDom();
      }
      rafId = requestAnimationFrame(renderLoop);
    };

    updateDom();
    rafId = requestAnimationFrame(renderLoop);
    return () => {
      cancelAnimationFrame(rafId);
      unsub();
    };
  }, [durationMs, trackUri]);

  useEffect(() => {
    if (waveformBars && waveformBars.length > 0) {
      const ratio = durationMs > 0 ? Math.max(0, Math.min(1, lastRenderedMsRef.current / durationMs)) : 0;
      drawWaveformCanvas(ratio);
    }
  }, [waveformBars, durationMs, trackUri]);

  const computeMsFromPointer = (clientX: number): number => {
    const el = railRef.current || trackContainerRef.current;
    if (!el || durationMs <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * durationMs);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (durationMs <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    const targetMs = computeMsFromPointer(e.clientX);
    dragPreviewMsRef.current = targetMs;
    anchorPosRef.current = targetMs;
    lastRenderedMsRef.current = targetMs;
    anchorPerfRef.current = performance.now();
    defaultSimpClient.seek(targetMs);
    lastDragSeekSentRef.current = performance.now();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || durationMs <= 0) return;
    const targetMs = computeMsFromPointer(e.clientX);
    dragPreviewMsRef.current = targetMs;

    // Throttle live audio seek updates during continuous finger drag to ~120ms
    const now = performance.now();
    if (now - lastDragSeekSentRef.current > 120) {
      anchorPosRef.current = targetMs;
      lastRenderedMsRef.current = targetMs;
      anchorPerfRef.current = now;
      defaultSimpClient.seek(targetMs);
      lastDragSeekSentRef.current = now;
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (durationMs > 0) {
      const finalMs = computeMsFromPointer(e.clientX);
      anchorPosRef.current = finalMs;
      lastRenderedMsRef.current = finalMs;
      anchorPerfRef.current = performance.now();
      defaultSimpClient.seek(finalMs);
    }
  };

  return (
    <div style={{ userSelect: 'none', touchAction: 'none', padding: '0 14px', boxSizing: 'border-box' }}>
      {/* 60px Tall Fat-Finger Touch Hit Zone (Waveform expands downward) */}
      <div
        ref={trackContainerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        style={{
          height: 60,
          paddingTop: 14,
          paddingBottom: 6,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'flex-end',
          cursor: 'pointer',
          position: 'relative',
        }}
      >
        <div
          ref={railRef}
          style={{
            width: '100%',
            height: 34,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {/* 34px Tall Visual Pill Track (~50% taller expanding downward) */}
          <div
            style={{
              width: '100%',
              height: 34,
              background: '#0b0c12',
              borderRadius: 17,
              overflow: 'hidden',
              border: '1px solid #2b2d3c',
              boxShadow:
                '0 8px 24px rgba(0, 0, 0, 0.94), 0 2px 8px rgba(0, 0, 0, 0.98), 0 0 0 1px rgba(0, 0, 0, 0.75)',
              position: 'relative',
            }}
          >
            {/* 180-Tick HiDPI Waveform Envelope Canvas (Mirrored Peak-Weighted RMS) */}
            {waveformBars && waveformBars.length > 0 && (
              <canvas
                ref={waveformCanvasRef}
                width={540}
                height={64}
                style={{
                  position: 'absolute',
                  inset: '1px 10px',
                  width: 'calc(100% - 20px)',
                  height: 'calc(100% - 2px)',
                  pointerEvents: 'none',
                  zIndex: 3,
                }}
              />
            )}

            <div
              ref={barRef}
              style={{
                width: '100%',
                height: '100%',
                background: isSoundCloudTrack
                  ? 'linear-gradient(90deg, rgba(124, 45, 18, 0.78) 0%, rgba(234, 88, 12, 0.82) 100%)'
                  : 'linear-gradient(90deg, #164e63 0%, #2aa3c4 100%)',
                opacity: waveformBars && waveformBars.length > 0 ? 0.34 : 1,
                transformOrigin: 'left center',
                transform: 'scaleX(0)',
                position: 'relative',
                zIndex: 2,
              }}
            />

            {/* SoundCloud Timed Comment Cluster Micro-Dots */}
            {durationMs > 0 && commentTimestampsMs && commentTimestampsMs.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  zIndex: 4,
                }}
              >
                {commentTimestampsMs.slice(0, 80).map((ts, idx) => {
                  const pct = Math.max(2, Math.min(98, (ts / durationMs) * 100));
                  return (
                    <div
                      key={`${ts}-${idx}`}
                      style={{
                        position: 'absolute',
                        left: `${pct}%`,
                        bottom: 2,
                        width: 3,
                        height: 3,
                        borderRadius: 99,
                        background: 'rgba(253, 186, 116, 0.78)',
                        transform: 'translateX(-50%)',
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* OLED-Safe Low-Luminance Playhead Thumb */}
          <div
            ref={thumbRef}
            style={{
              position: 'absolute',
              left: '0%',
              top: '50%',
              width: 34,
              height: 34,
              borderRadius: 999,
              background: '#c8c8d2',
              border: isSoundCloudTrack ? '3px solid #fb923c' : '3px solid #2aa3c4',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 1px 6px rgba(0, 0, 0, 0.7)',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          />
        </div>
      </div>

      {/* Clean Elapsed & Total Timestamps */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13,
          fontFamily: 'monospace',
          color: '#d4d4e0',
          marginTop: 2,
        }}
      >
        <span
          ref={timeTextRef}
          style={{
            fontWeight: 800,
            color: '#f0f0f6',
            minWidth: 48,
            padding: '2px 8px',
            borderRadius: 6,
            background: 'rgba(8, 9, 14, 0.78)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.88)',
            textShadow: '0 1px 4px rgba(0, 0, 0, 0.98)',
          }}
        >
          00:00
        </span>
        <span
          style={{
            fontWeight: 800,
            color: '#d4d4e0',
            minWidth: 48,
            textAlign: 'right',
            padding: '2px 8px',
            borderRadius: 6,
            background: 'rgba(8, 9, 14, 0.78)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.88)',
            textShadow: '0 1px 4px rgba(0, 0, 0, 0.98)',
          }}
        >
          {formatTime(durationMs)}
        </span>
      </div>
    </div>
  );
};

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
