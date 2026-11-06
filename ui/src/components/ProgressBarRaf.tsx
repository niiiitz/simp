import React, { useEffect, useRef } from 'react';
import { defaultSimpClient } from '@simp/client';

interface Props {
  durationMs: number;
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
 */
export const ProgressBarRaf: React.FC<Props> = ({ durationMs }) => {
  const trackContainerRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const timeTextRef = useRef<HTMLSpanElement | null>(null);

  const anchorPosRef = useRef(0);
  const anchorPerfRef = useRef(performance.now());
  const lastRenderedMsRef = useRef(0);
  const isPlayingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragPreviewMsRef = useRef(0);
  const lastDragSeekSentRef = useRef(0);

  useEffect(() => {
    let rafId = 0;
    let lastDomPct = -1;
    let lastDomTimeText = '';

    const updateDom = () => {
      let currentMs = anchorPosRef.current;
      if (isDraggingRef.current) {
        currentMs = dragPreviewMsRef.current;
        lastRenderedMsRef.current = currentMs;
      } else if (isPlayingRef.current && anchorPosRef.current > 0) {
        const elapsedSinceTick = Math.min(performance.now() - anchorPerfRef.current, 1500);
        const rawMs = anchorPosRef.current + elapsedSinceTick;
        // Monotonic forward guard during active playback
        currentMs = Math.max(lastRenderedMsRef.current, rawMs);
        lastRenderedMsRef.current = currentMs;
      } else {
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
      }
      const nextTimeText = formatTime(currentMs);
      if (nextTimeText !== lastDomTimeText) {
        lastDomTimeText = nextTimeText;
        if (timeTextRef.current) {
          timeTextRef.current.textContent = nextTimeText;
        }
      }
    };

    const unsub = defaultSimpClient.subscribeProgress((posMs, perfNow, playing) => {
      const wasPlaying = isPlayingRef.current;
      isPlayingRef.current = playing;

      if (!playing) {
        anchorPosRef.current = posMs;
        anchorPerfRef.current = perfNow;
        lastRenderedMsRef.current = posMs;
        updateDom();
        return;
      }

      // Compute our current smooth rAF-extrapolated playhead position
      const predictedMs = wasPlaying
        ? anchorPosRef.current + (perfNow - anchorPerfRef.current)
        : anchorPosRef.current;
      const driftMs = posMs - predictedMs;

      // Track restart or explicit backward seek (> 2.2s backward jump, or reset near 0:00)
      if (posMs <= 400 && predictedMs > 1200) {
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
  }, [durationMs]);

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
      {/* 54px Tall Fat-Finger Touch Hit Zone */}
      <div
        ref={trackContainerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        style={{
          height: 54,
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          position: 'relative',
        }}
      >
        <div
          ref={railRef}
          style={{
            width: '100%',
            height: 22,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {/* 22px Tall Visual Pill Track */}
          <div
            style={{
              width: '100%',
              height: 22,
              background: '#0d0d12',
              borderRadius: 999,
              overflow: 'hidden',
              border: '1px solid #1e1e28',
              position: 'relative',
            }}
          >
            <div
              ref={barRef}
              style={{
                width: '100%',
                height: '100%',
                background: 'linear-gradient(90deg, #164e63 0%, #2aa3c4 100%)',
                transformOrigin: 'left center',
                transform: 'scaleX(0)',
              }}
            />
          </div>

          {/* OLED-Safe Low-Luminance Playhead Thumb */}
          <div
            ref={thumbRef}
            style={{
              position: 'absolute',
              left: '0%',
              top: '50%',
              width: 26,
              height: 26,
              borderRadius: 999,
              background: '#c8c8d2',
              border: '3px solid #2aa3c4',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 1px 6px rgba(0, 0, 0, 0.7)',
              pointerEvents: 'none',
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
          color: '#8a8a96',
          marginTop: 2,
        }}
      >
        <span ref={timeTextRef} style={{ fontWeight: 700, color: '#c8c8d2', minWidth: 48 }}>
          00:00
        </span>
        <span style={{ fontWeight: 700, minWidth: 48, textAlign: 'right' }}>
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
