import React, { useEffect, useRef } from 'react';
import { defaultSimpClient } from '@simp/client';

interface Props {
  durationMs: number;
}

/**
 * "Single-Shot" Hardware-Accelerated Progress Bar.
 * Never triggers React `useState` re-renders on 500ms ticks; interpolates width
 * at 60/90fps directly in the DOM via `useRef` and `requestAnimationFrame`.
 */
export const ProgressBarRaf: React.FC<Props> = ({ durationMs }) => {
  const barRef = useRef<HTMLDivElement | null>(null);
  const timeTextRef = useRef<HTMLSpanElement | null>(null);
  const anchorPosRef = useRef(0);
  const anchorPerfRef = useRef(performance.now());
  const isPlayingRef = useRef(false);

  useEffect(() => {
    const unsub = defaultSimpClient.subscribeProgress((posMs, perfNow, playing) => {
      anchorPosRef.current = posMs;
      anchorPerfRef.current = perfNow;
      isPlayingRef.current = playing;
    });

    let rafId = 0;
    const renderLoop = () => {
      let currentMs = anchorPosRef.current;
      if (isPlayingRef.current) {
        currentMs += performance.now() - anchorPerfRef.current;
      }
      if (barRef.current) {
        const pct = durationMs > 0 ? Math.min((currentMs / durationMs) * 100, 100) : 0;
        barRef.current.style.transform = `scaleX(${pct / 100})`;
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

  const handleScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (durationMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    defaultSimpClient.seek(Math.round(ratio * durationMs));
  };

  return (
    <div>
      <div
        onPointerDown={handleScrub}
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
        }}
      >
        <div
          style={{
            width: '100%',
            height: 10,
            background: '#141418',
            borderRadius: 999,
            overflow: 'hidden',
            border: '1px solid #26262e',
          }}
        >
          <div
            ref={barRef}
            style={{
              width: '100%',
              height: '100%',
              background: '#00e5ff',
              transformOrigin: 'left center',
              transform: 'scaleX(0)',
            }}
          />
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          fontFamily: 'monospace',
          color: '#8e8e99',
        }}
      >
        <span ref={timeTextRef}>00:00</span>
        <span>L2 -10s / R2 +10s</span>
        <span>{formatTime(durationMs)}</span>
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

