import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImpIcon } from './icons/ImpIcon';

export interface DspConfigState {
  eq_enabled: boolean;
  eq_preset: string;
  preamp_db: number;
  bands_db: number[];
  vocal_mode: 'off' | 'vocal_remover' | 'vocal_isolate';
  vocal_strength: number;
}

export interface EqPresetOption {
  id: string;
  label: string;
  preamp_db: number;
  bands_db: number[];
}

export const DEFAULT_DSP_STATE: DspConfigState = {
  eq_enabled: false,
  eq_preset: 'flat',
  preamp_db: 0,
  bands_db: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  vocal_mode: 'off',
  vocal_strength: 0.9,
};

export const EQ_BAND_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

export const BUILTIN_PRESETS: EqPresetOption[] = [
  { id: 'flat', label: 'Flat', preamp_db: 0.0, bands_db: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  {
    id: 'bass_boost',
    label: 'Bass Boost',
    preamp_db: -2.5,
    bands_db: [6.0, 5.0, 3.5, 1.5, 0.0, 0.0, 0.0, 0.5, 1.0, 1.0],
  },
  {
    id: 'vocal_presence',
    label: 'Vocal Presence',
    preamp_db: -1.5,
    bands_db: [-2.0, -1.5, -0.5, 1.5, 3.5, 4.5, 4.0, 2.0, 0.5, 0.0],
  },
  {
    id: 'treble_sparkle',
    label: 'Treble Sparkle',
    preamp_db: -2.0,
    bands_db: [0.0, 0.0, 0.0, 0.0, 0.5, 1.5, 3.0, 4.5, 5.5, 6.0],
  },
  {
    id: 'late_night',
    label: 'Late Night',
    preamp_db: -2.0,
    bands_db: [4.5, 3.5, 1.5, -0.5, -1.5, -1.0, 0.5, 2.5, 4.0, 4.5],
  },
  {
    id: 'v_shape',
    label: 'V-Shape',
    preamp_db: -2.5,
    bands_db: [5.5, 4.5, 2.0, -1.5, -2.5, -1.5, 1.5, 3.5, 5.0, 5.5],
  },
  {
    id: 'handheld_speakers',
    label: 'Handheld Deck',
    preamp_db: -1.5,
    bands_db: [3.5, 4.5, 3.0, 1.0, -0.5, 1.0, 2.5, 3.0, 2.5, 2.0],
  },
];

interface EqualizerModalProps {
  open: boolean;
  onClose: () => void;
  dspState: DspConfigState;
  onUpdateDsp: (patch: Partial<DspConfigState>) => void;
  karaokeLyricsEnabled: boolean;
  onToggleKaraokeMode: (enableKaraoke: boolean) => void;
}

export const EqualizerModal: React.FC<EqualizerModalProps> = ({
  open,
  onClose,
  dspState,
  onUpdateDsp,
  karaokeLyricsEnabled,
  onToggleKaraokeMode,
}) => {
  // `-1` = preamp slider engaged; `0..9` = EQ band slider engaged; `null` = normal spatial navigation
  const [engagedSlider, setEngagedSlider] = useState<number | null>(null);
  const engagedSliderRef = useRef<number | null>(null);
  engagedSliderRef.current = engagedSlider;

  const previousFocusRef = useRef<HTMLElement | null>(null);
  const draggingSliderRef = useRef<number | null>(null);
  const faderTrackRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Focus capture & restoration on modal open/close
  useEffect(() => {
    if (!open) {
      setEngagedSlider(null);
      return;
    }
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      const btn =
        document.querySelector<HTMLElement>(
          '[data-equalizer-modal="true"] button[data-default-focus="true"]:not([disabled])'
        ) ||
        document.querySelector<HTMLElement>(
          '[data-equalizer-modal="true"] button:not([disabled]):not([data-equalizer-close="true"])'
        );
      if (btn) {
        btn.focus({ preventScroll: true });
      }
    }, 35);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  const handleCloseModal = useCallback(() => {
    setEngagedSlider(null);
    onClose();
    window.setTimeout(() => {
      const prev = previousFocusRef.current;
      if (prev && document.body.contains(prev)) {
        prev.focus({ preventScroll: true });
      }
    }, 35);
  }, [onClose]);

  const adjustSliderByDelta = useCallback(
    (sliderIdx: number, deltaDb: number) => {
      if (sliderIdx === -1) {
        const nextPreamp = Math.max(-12, Math.min(12, Math.round((dspState.preamp_db + deltaDb) * 2) / 2));
        onUpdateDsp({ eq_enabled: true, preamp_db: nextPreamp });
      } else if (sliderIdx >= 0 && sliderIdx < 10) {
        const nextBands = [...dspState.bands_db];
        while (nextBands.length < 10) nextBands.push(0);
        const cur = nextBands[sliderIdx] || 0;
        nextBands[sliderIdx] = Math.max(-12, Math.min(12, Math.round((cur + deltaDb) * 2) / 2));
        onUpdateDsp({
          eq_enabled: true,
          eq_preset: 'custom',
          bands_db: nextBands,
        });
      }
    },
    [dspState.bands_db, dspState.preamp_db, onUpdateDsp]
  );

  // Intercept Up/Down/Back when a vertical fader is engaged (for both Keyboard and Gamepad)
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const engaged = engagedSliderRef.current;
      if (engaged !== null) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          adjustSliderByDelta(engaged, 0.5);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          adjustSliderByDelta(engaged, -0.5);
          return;
        }
        if (e.key === 'PageUp') {
          e.preventDefault();
          e.stopPropagation();
          adjustSliderByDelta(engaged, 2.0);
          return;
        }
        if (e.key === 'PageDown') {
          e.preventDefault();
          e.stopPropagation();
          adjustSliderByDelta(engaged, -2.0);
          return;
        }
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          setEngagedSlider(null);
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          const nextIdx =
            e.key === 'ArrowRight' ? Math.min(9, engaged + 1) : Math.max(-1, engaged - 1);
          setEngagedSlider(nextIdx);
          const nextBtn = document.querySelector<HTMLElement>(
            `[data-equalizer-modal="true"] button[data-eq-slider-index="${nextIdx}"]`
          );
          nextBtn?.focus({ preventScroll: true });
          return;
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleCloseModal();
      }
    };

    const onGamepadCapture = (ev: Event) => {
      const customEv = ev as CustomEvent<{ action?: string }>;
      const action = customEv.detail?.action;
      const engaged = engagedSliderRef.current;
      if (engaged === null || !action) return;

      if (action === 'up') {
        ev.stopImmediatePropagation();
        adjustSliderByDelta(engaged, 0.5);
      } else if (action === 'down') {
        ev.stopImmediatePropagation();
        adjustSliderByDelta(engaged, -0.5);
      } else if (action === 'left' || action === 'right') {
        ev.stopImmediatePropagation();
        const nextIdx =
          action === 'right' ? Math.min(9, engaged + 1) : Math.max(-1, engaged - 1);
        setEngagedSlider(nextIdx);
        const nextBtn = document.querySelector<HTMLElement>(
          `[data-equalizer-modal="true"] button[data-eq-slider-index="${nextIdx}"]`
        );
        nextBtn?.focus({ preventScroll: true });
      } else if (action === 'back' || action === 'activate') {
        ev.stopImmediatePropagation();
        setEngagedSlider(null);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('simp-gamepad-action', onGamepadCapture, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('simp-gamepad-action', onGamepadCapture, true);
    };
  }, [open, adjustSliderByDelta, handleCloseModal]);

  const applyPointerYToSlider = useCallback(
    (sliderIdx: number, clientY: number) => {
      const trackEl = faderTrackRefs.current.get(sliderIdx);
      if (!trackEl) return;
      const rect = trackEl.getBoundingClientRect();
      if (rect.height <= 0) return;
      const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const rawDb = -12 + ratio * 24;
      const snappedDb = Math.max(-12, Math.min(12, Math.round(rawDb * 2) / 2));

      if (sliderIdx === -1) {
        onUpdateDsp({ eq_enabled: true, preamp_db: snappedDb });
      } else {
        const nextBands = [...dspState.bands_db];
        while (nextBands.length < 10) nextBands.push(0);
        nextBands[sliderIdx] = snappedDb;
        onUpdateDsp({
          eq_enabled: true,
          eq_preset: 'custom',
          bands_db: nextBands,
        });
      }
    },
    [dspState.bands_db, onUpdateDsp]
  );

  useEffect(() => {
    if (!open) return;
    const onPointerMove = (e: PointerEvent) => {
      if (draggingSliderRef.current === null) return;
      applyPointerYToSlider(draggingSliderRef.current, e.clientY);
    };
    const onPointerUp = () => {
      draggingSliderRef.current = null;
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [open, applyPointerYToSlider]);

  if (!open) return null;

  const isKaraokeActive = dspState.vocal_mode === 'vocal_remover' && karaokeLyricsEnabled;
  const bands =
    dspState.bands_db && dspState.bands_db.length === 10
      ? dspState.bands_db
      : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  // Build SVG polyline points for the 10-band response curve preview
  const svgWidth = 540;
  const svgHeight = 56;
  const curvePoints = bands
    .map((db, idx) => {
      const x = 18 + (idx / 9) * (svgWidth - 36);
      const y = svgHeight / 2 - (Math.max(-12, Math.min(12, db)) / 12) * (svgHeight / 2 - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div
      data-modal-root="true"
      data-equalizer-modal="true"
      role="dialog"
      aria-modal="true"
      aria-label="Audio DSP, 10-Band Equalizer & Vocal Isolation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleCloseModal();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9600,
        background: 'rgba(2, 6, 14, 0.84)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          width: 'min(920px, 96vw)',
          maxHeight: '92vh',
          overflowY: 'auto',
          borderRadius: 16,
          background: 'linear-gradient(180deg, #0b111e 0%, #060911 100%)',
          border: '1px solid rgba(56, 189, 248, 0.28)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.85)',
          padding: '18px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          color: '#f1f5f9',
        }}
      >
        {/* Header Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ImpIcon name="sliders" size={18} color="#38bdf8" />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.02em', color: '#f8fafc' }}>
                AUDIO DSP // 10-BAND BIQUAD EQ & VOCAL STAGE
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                Lock-free stereo biquad cascade (32 Hz – 16 kHz) + Band-limited Mid/Side Vocal Isolation (130 Hz – 4.5 kHz)
              </div>
            </div>
          </div>

          <button
            data-equalizer-close="true"
            onClick={handleCloseModal}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#cbd5e1',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ImpIcon name="close" size={13} color="#cbd5e1" />
            <span>Close (B / Esc)</span>
          </button>
        </div>

        {/* Section 1: Vocal Isolation & 1-Click Karaoke Mode */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            background: 'rgba(15, 23, 42, 0.72)',
            border:
              dspState.vocal_mode !== 'off'
                ? '1px solid rgba(52, 211, 153, 0.45)'
                : '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ImpIcon
                name={dspState.vocal_mode === 'vocal_remover' ? 'mic-off' : 'mic'}
                size={15}
                color={dspState.vocal_mode !== 'off' ? '#34d399' : '#94a3b8'}
              />
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', color: '#e2e8f0' }}>
                MID/SIDE VOCAL ISOLATION & KARAOKE MODE
              </span>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                (Preserves &lt; 130 Hz center sub-bass/kick &amp; stereo width)
              </span>
            </div>

            {/* 1-Click Karaoke Mode Button */}
            <button
              data-default-focus="true"
              onClick={() => onToggleKaraokeMode(!isKaraokeActive)}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                background: isKaraokeActive
                  ? 'linear-gradient(90deg, rgba(16, 185, 129, 0.28), rgba(56, 189, 248, 0.24))'
                  : 'rgba(255, 255, 255, 0.06)',
                border: isKaraokeActive
                  ? '1px solid #34d399'
                  : '1px solid rgba(255, 255, 255, 0.16)',
                color: isKaraokeActive ? '#6ee7b7' : '#e2e8f0',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
              }}
            >
              <ImpIcon name="lyrics" size={14} color={isKaraokeActive ? '#34d399' : '#94a3b8'} />
              <span>KARAOKE MODE: {isKaraokeActive ? 'ACTIVE (VOCAL REMOVER + LRC)' : 'OFF'}</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {(
                [
                  { id: 'off', label: 'Original Mix (Bypass)', icon: 'music' as const },
                  { id: 'vocal_remover', label: 'Vocal Remover (Instrumental)', icon: 'mic-off' as const },
                  { id: 'vocal_isolate', label: 'Vocal Isolate (Lead Focus)', icon: 'mic' as const },
                ] as const
              ).map((m) => {
                const active = dspState.vocal_mode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => onUpdateDsp({ vocal_mode: m.id })}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      background: active ? 'rgba(56, 189, 248, 0.18)' : '#090d16',
                      border: active ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                      color: active ? '#38bdf8' : '#94a3b8',
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <ImpIcon name={m.icon} size={13} color={active ? '#38bdf8' : '#64748b'} />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Vocal Suppression / Isolation Strength Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>
                DEPTH: {Math.round((dspState.vocal_strength || 0.9) * 100)}%
              </span>
              <button
                onClick={() =>
                  onUpdateDsp({
                    vocal_strength: Math.max(0.4, Math.round((dspState.vocal_strength - 0.05) * 20) / 20),
                  })
                }
                style={{
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: '#090d16',
                  border: '1px solid rgba(255,255,255,0.14)',
                  color: '#cbd5e1',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                -5%
              </button>
              <button
                onClick={() =>
                  onUpdateDsp({
                    vocal_strength: Math.min(1.0, Math.round((dspState.vocal_strength + 0.05) * 20) / 20),
                  })
                }
                style={{
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: '#090d16',
                  border: '1px solid rgba(255,255,255,0.14)',
                  color: '#cbd5e1',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                +5%
              </button>
            </div>
          </div>
        </div>

        {/* Section 2: Equalizer Enable + Presets + Live Frequency Curve */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            background: 'rgba(15, 23, 42, 0.72)',
            border: dspState.eq_enabled
              ? '1px solid rgba(56, 189, 248, 0.4)'
              : '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => onUpdateDsp({ eq_enabled: !dspState.eq_enabled })}
                style={{
                  padding: '5px 12px',
                  borderRadius: 8,
                  background: dspState.eq_enabled ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255,255,255,0.06)',
                  border: dspState.eq_enabled
                    ? '1px solid #38bdf8'
                    : '1px solid rgba(255,255,255,0.16)',
                  color: dspState.eq_enabled ? '#38bdf8' : '#94a3b8',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <ImpIcon name="sliders" size={13} color={dspState.eq_enabled ? '#38bdf8' : '#64748b'} />
                <span>10-BAND EQ: {dspState.eq_enabled ? 'ENABLED' : 'BYPASSED'}</span>
              </button>

              {BUILTIN_PRESETS.map((preset) => {
                const active = dspState.eq_preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() =>
                      onUpdateDsp({
                        eq_enabled: true,
                        eq_preset: preset.id,
                        preamp_db: preset.preamp_db,
                        bands_db: [...preset.bands_db],
                      })
                    }
                    style={{
                      padding: '5px 10px',
                      borderRadius: 7,
                      background: active ? 'rgba(56, 189, 248, 0.16)' : '#090d16',
                      border: active ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                      color: active ? '#7dd3fc' : '#94a3b8',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}

              <button
                onClick={() =>
                  onUpdateDsp({
                    eq_preset: 'flat',
                    preamp_db: 0,
                    bands_db: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                  })
                }
                style={{
                  padding: '5px 10px',
                  borderRadius: 7,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#cbd5e1',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <ImpIcon name="refresh" size={11} color="#94a3b8" />
                <span>Zero All</span>
              </button>
            </div>

            {/* Live Response Curve Mini-Plot */}
            <svg
              width={180}
              height={36}
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              style={{
                borderRadius: 6,
                background: '#050811',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <line
                x1={0}
                y1={svgHeight / 2}
                x2={svgWidth}
                y2={svgHeight / 2}
                stroke="rgba(148, 163, 184, 0.25)"
                strokeDasharray="4 4"
              />
              <polyline
                fill="none"
                stroke={dspState.eq_enabled ? '#38bdf8' : '#475569'}
                strokeWidth={3}
                points={curvePoints}
              />
            </svg>
          </div>

          {/* Controller / Keyboard Hint Banner */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '5px 10px',
              borderRadius: 7,
              background:
                engagedSlider !== null
                  ? 'rgba(52, 211, 153, 0.14)'
                  : 'rgba(255, 255, 255, 0.03)',
              border:
                engagedSlider !== null
                  ? '1px solid rgba(52, 211, 153, 0.45)'
                  : '1px solid rgba(255, 255, 255, 0.06)',
              fontSize: 11,
              color: engagedSlider !== null ? '#6ee7b7' : '#94a3b8',
            }}
          >
            <span>
              {engagedSlider !== null
                ? `SLIDER ENGAGED (${engagedSlider === -1 ? 'PREAMP' : `${EQ_BAND_LABELS[engagedSlider]} Hz`}): Use UP / DOWN to adjust ±0.5 dB, LEFT / RIGHT to switch band, or press A / B / Enter to release.`
                : 'GAMEPAD / KEYBOARD: Select any fader and press A / Enter to engage UP/DOWN adjustment, or drag directly with Mouse/Touch.'}
            </span>
            <span style={{ fontWeight: 700, color: '#cbd5e1' }}>
              PREAMP: {dspState.preamp_db >= 0 ? `+${dspState.preamp_db.toFixed(1)}` : dspState.preamp_db.toFixed(1)} dB
            </span>
          </div>

          {/* 11 Vertical Faders: Preamp (-1) + 10 Bands (0..9) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(11, minmax(0, 1fr))',
              gap: 8,
              paddingTop: 4,
            }}
          >
            {[-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((sliderIdx) => {
              const isPreamp = sliderIdx === -1;
              const valDb = isPreamp ? dspState.preamp_db : bands[sliderIdx] || 0;
              const isEngaged = engagedSlider === sliderIdx;
              const norm = (Math.max(-12, Math.min(12, valDb)) + 12) / 24; // 0..1
              const label = isPreamp ? 'PRE' : EQ_BAND_LABELS[sliderIdx];
              const accentColor = isEngaged
                ? '#34d399'
                : isPreamp
                  ? '#f59e0b'
                  : dspState.eq_enabled
                    ? '#38bdf8'
                    : '#64748b';

              return (
                <div
                  key={sliderIdx}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 4px',
                    borderRadius: 10,
                    background: isEngaged ? 'rgba(52, 211, 153, 0.1)' : '#070b13',
                    border: isEngaged
                      ? '1px solid #34d399'
                      : isPreamp
                        ? '1px solid rgba(245, 158, 11, 0.25)'
                        : '1px solid rgba(255, 255, 255, 0.07)',
                  }}
                >
                  {/* dB Readout */}
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      fontFamily: 'monospace',
                      color: valDb === 0 ? '#64748b' : '#f8fafc',
                    }}
                  >
                    {valDb > 0 ? `+${valDb.toFixed(1)}` : valDb.toFixed(1)}
                  </div>

                  {/* Interactive Vertical Fader Button */}
                  <button
                    data-eq-slider-index={sliderIdx}
                    onClick={() =>
                      setEngagedSlider((prev) => (prev === sliderIdx ? null : sliderIdx))
                    }
                    onDoubleClick={() => {
                      if (isPreamp) {
                        onUpdateDsp({ preamp_db: 0 });
                      } else {
                        const nextBands = [...bands];
                        nextBands[sliderIdx] = 0;
                        onUpdateDsp({ eq_preset: 'custom', bands_db: nextBands });
                      }
                    }}
                    title={`${label} Hz (${valDb >= 0 ? '+' : ''}${valDb.toFixed(1)} dB) — Press A/Enter to adjust with Up/Down, or drag`}
                    style={{
                      width: '100%',
                      height: 138,
                      padding: 0,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'ns-resize',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    <div
                      ref={(el) => {
                        if (el) faderTrackRefs.current.set(sliderIdx, el);
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        draggingSliderRef.current = sliderIdx;
                        applyPointerYToSlider(sliderIdx, e.clientY);
                      }}
                      style={{
                        width: 10,
                        height: 124,
                        borderRadius: 999,
                        background: '#111827',
                        border: '1px solid rgba(255, 255, 255, 0.14)',
                        position: 'relative',
                      }}
                    >
                      {/* 0 dB center tick */}
                      <div
                        style={{
                          position: 'absolute',
                          left: -5,
                          right: -5,
                          top: '50%',
                          height: 1,
                          background: 'rgba(148, 163, 184, 0.35)',
                        }}
                      />

                      {/* Active fill bar from 0 dB center */}
                      <div
                        style={{
                          position: 'absolute',
                          left: 1,
                          right: 1,
                          top: valDb >= 0 ? `${(1 - norm) * 100}%` : '50%',
                          bottom: valDb >= 0 ? '50%' : `${norm * 100}%`,
                          borderRadius: 999,
                          background: accentColor,
                          opacity: 0.75,
                        }}
                      />

                      {/* Thumb Cap */}
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: `${(1 - norm) * 100}%`,
                          transform: 'translate(-50%, -50%)',
                          width: 22,
                          height: 11,
                          borderRadius: 4,
                          background: isEngaged ? '#34d399' : '#f8fafc',
                          border: `2px solid ${accentColor}`,
                          boxShadow: '0 2px 6px rgba(0,0,0,0.65)',
                        }}
                      />
                    </div>
                  </button>

                  {/* Frequency Label */}
                  <div
                    style={{
                      fontSize: 10.5,
                      fontWeight: 800,
                      color: isPreamp ? '#fbbf24' : '#cbd5e1',
                    }}
                  >
                    {label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
