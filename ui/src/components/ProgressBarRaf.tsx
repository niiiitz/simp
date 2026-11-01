import React, { useEffect, useRef } from 'react';
import { defaultSimpClient } from '@simp/client';

interface Props {
  durationMs: number;
}

/**
 * "Single-Shot" Hardware-Accelerated Tall Progress & Scrub Bar.
 * - Never triggers React `useState` re-renders on 500ms ticks; interpolates bar fill & thumb
 *   at 60/90fps directly in the DOM via `useRef` and `requestAnimationFrame`.
 * - Features a 54px touch hit target with a 22px visual pill bar + glowing playhead thumb
 *   for effortless fat-finger scrubbing on the Steam Deck OLED screen.
 * - Supports both tap-to-seek and continuous pointer-drag scrubbing, plus clickable `-10s` / `+10s` pills.
 */
export const ProgressBarRaf: React.FC<Props> = ({ durationMs }) => {
  const trackContainerRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const timeTextRef = useRef<HTMLSpanElement | null>(null);

  const anchorPosRef = useRef(0);
  const anchorPerfRef = useRef(performance.now());
  const isPlayingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragPreviewMsRef = useRef(0);
  const lastDragSeekSentRef = useRef(0);

  useEffect(() => {
    const unsub = defaultSimpClient.subscribeProgress((posMs, perfNow, playing) => {
      anchorPosRef.current = posMs;
      anchorPerfRef.current = perfNow;
      isPlayingRef.current = playing;
    });

    let rafId = 0;
    const renderLoop = () => {
      let currentMs = anchorPosRef.current;
      if (isDraggingRef.current) {
        currentMs = dragPreviewMsRef.current;
      } else if (isPlayingRef.current) {
        currentMs += performance.now() - anchorPerfRef.current;
      }

      const pct = durationMs > 0 ? Math.max(0, Math.min((currentMs / durationMs) * 100, 100)) : 0;

      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${pct / 100})`;
      }
      if (thumbRef.current) {
        thumbRef.current.style.left = `${pct}%`;
      }
      if (timeTextRef.current) {
        timeTextRef.current.textContent = formatTime(currentMs);
      }
      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => {
      cancelAnimationFrame(rafId);
      unsub();
    };
  }, [durationMs]);

  const computeMsFromPointer = (clientX: number): number => {
    const el = trackContainerRef.current;
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
      anchorPerfRef.current = performance.now();
      defaultSimpClient.seek(finalMs);
    }
  };

  return (
    <div style={{ userSelect: 'none', touchAction: 'none' }}>
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
        {/* 22px Tall Visual Pill Track */}
        <div
          style={{
            width: '100%',
            height: 22,
            background: '#111118',
            borderRadius: 999,
            overflow: 'hidden',
            border: '2px solid #262634',
            position: 'relative',
          }}
        >
          <div
            ref={barRef}
            style={{
              width: '100%',
              height: '100%',
              background: 'linear-gradient(90deg, #00b8d4 0%, #00e5ff 100%)',
              transformOrigin: 'left center',
              transform: 'scaleX(0)',
            }}
          />
        </div>

        {/* High-Contrast Playhead Thumb */}
        <div
          ref={thumbRef}
          style={{
            position: 'absolute',
            left: '0%',
            top: '50%',
            width: 28,
            height: 28,
            borderRadius: 999,
            background: '#ffffff',
            border: '4px solid #00e5ff',
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 2px 10px rgba(0, 229, 255, 0.55)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Clean Elapsed & Total Timestamps */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13,
          fontFamily: 'monospace',
          color: '#a1a1aa',
          marginTop: 2,
        }}
      >
        <span ref={timeTextRef} style={{ fontWeight: 700, color: '#f4f4f6', minWidth: 48 }}>
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
