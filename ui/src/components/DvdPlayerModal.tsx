import React, { useEffect, useRef, useState } from 'react';
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
  const [chapter, setChapter] = useState<number>(initialChapter);
  const [audioIdx, setAudioIdx] = useState<number>(initialAudioIndex);
  const [subIdx, setSubIdx] = useState<string>(initialSubtitleIndex);
  const [streamError, setStreamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const daemonOrigin =
    typeof window !== 'undefined' && window.location.port === '18888'
      ? window.location.origin
      : 'http://127.0.0.1:18888';

  const streamUrl = `${daemonOrigin}/api/dvd/stream?device=${encodeURIComponent(
    devicePath
  )}&title=${titleInfo.title_number}&chapter=${chapter}&audio=${audioIdx}&sub=${encodeURIComponent(
    subIdx
  )}`;

  useEffect(() => {
    setStreamError(null);
  }, [streamUrl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const toggleFullscreen = () => {
    const el = videoRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen?.().catch(() => {});
    }
  };

  return (
    <div
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
              Title {titleInfo.title_number} • Chapter {chapter}/{Math.max(1, titleInfo.chapters.length)} •{' '}
              {titleInfo.aspect_ratio} • {formatDuration(titleInfo.duration_ms)}
            </div>
          </div>
        </div>

        {/* Audio, Subtitle & Fullscreen Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {titleInfo.audio_tracks.length > 0 && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '11px',
                color: '#cbd5e1',
                background: 'rgba(255,255,255,0.06)',
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              🔊 Audio:
              <select
                data-gamepad-item
                value={audioIdx}
                onChange={(e) => setAudioIdx(Number(e.target.value))}
                style={{
                  background: '#0f172a',
                  color: '#f8fafc',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  padding: '2px 6px',
                }}
              >
                {titleInfo.audio_tracks.map((a) => (
                  <option key={a.stream_index} value={a.stream_index}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {titleInfo.subtitle_tracks.length > 0 && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '11px',
                color: '#cbd5e1',
                background: 'rgba(255,255,255,0.06)',
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              💬 Subtitles:
              <select
                data-gamepad-item
                value={subIdx}
                onChange={(e) => setSubIdx(e.target.value)}
                style={{
                  background: '#0f172a',
                  color: '#f8fafc',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  padding: '2px 6px',
                }}
              >
                <option value="off">Off</option>
                {titleInfo.subtitle_tracks.map((s) => (
                  <option key={s.stream_index} value={String(s.stream_index)}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
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
          margin: '10px 0',
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
          controls
          autoPlay
          playsInline
          onError={() =>
            setStreamError(
              'DVD stream failed to start. Ensure ffmpeg is installed and libdvdcss.so.2 is placed in ~/.local/share/simp/lib/ for CSS-encrypted discs.'
            )
          }
          style={{
            width: '100%',
            height: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            background: '#000',
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

      {/* Bottom Chapter Jump Bar */}
      {titleInfo.chapters.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            overflowX: 'auto',
            paddingTop: '4px',
          }}
        >
          <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, flexShrink: 0 }}>
            Chapters:
          </span>
          {titleInfo.chapters.map((ch) => {
            const active = ch.chapter_number === chapter;
            return (
              <button
                key={ch.chapter_number}
                data-gamepad-item
                onClick={() => setChapter(ch.chapter_number)}
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

