import React, { useEffect, useRef } from 'react';
import { defaultSimpClient, type SoundCloudComment, type TrackMetadata } from '@simp/client';

export type VisualizerMode = 'glyph' | 'avs' | 'demoscene' | 'off';

export const VISUALIZER_MODES: { id: VisualizerMode; label: string; shortLabel: string }[] = [
  { id: 'glyph', label: 'GLYPH MATRIX (Micro-ASCII + Glitch)', shortLabel: 'GLYPH' },
  { id: 'avs', label: 'WINAMP AVS (Feedback + Rez Wireframe)', shortLabel: 'AVS' },
  { id: 'demoscene', label: 'DEMOSCENE 64K (Copper + DYCP Scroller)', shortLabel: '64K' },
  { id: 'off', label: 'OFF (Static Minimal)', shortLabel: 'OFF' },
];

interface Props {
  mode: VisualizerMode;
  isPlaying: boolean;
  track: TrackMetadata | null;
  artUrl?: string | null;
  bpm?: number | null;
  waveformBars?: number[] | null;
  activeComment?: SoundCloudComment | null;
  comments?: SoundCloudComment[];
  activeChapterLabel?: string | null;
}

const CANVAS_W = 640;
const CANVAS_H = 360;

// High-density 80x45 micro-glyph grid (3,600 cells, 8x8px per cell on 640x360 canvas)
const GRID_COLS = 80;
const GRID_ROWS = 45;
const GRID_CELLS = GRID_COLS * GRID_ROWS; // 3,600 cells
const CELL_W = CANVAS_W / GRID_COLS; // 8.0px
const CELL_H = CANVAS_H / GRID_ROWS; // 8.0px

// 16 typographic ASCII ramp glyphs ordered by optical density (no solid block chars so glyphs never fuse into solid bars)
const GLYPH_RAMP = [' ', '·', '.', ':', '-', '~', '=', '+', '*', 'x', 'z', '#', '%', '&', '@', '$'];
const NUM_GLYPHS = GLYPH_RAMP.length; // 16
const NUM_PALETTE = 8;
const ATLAS_CELL = 10; // 10x10px sprite cells for crisp 8x8px micro-glyph blits

// Printable ASCII strip (charCode 32..95) baked into rows 8..9 of the atlas for live terminal text decoding
const ASCII_MIN = 32;
const ASCII_MAX = 95;
const ASCII_COUNT = ASCII_MAX - ASCII_MIN + 1; // 64 chars

// Pre-computed 256-entry Sine Lookup Table (-1.0 .. +1.0) & Uint8 (0 .. 255)
const SIN_F32 = new Float32Array(256);
const SIN_U8 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const s = Math.sin((i / 256) * Math.PI * 2);
  SIN_F32[i] = s;
  SIN_U8[i] = Math.max(0, Math.min(255, Math.round((s * 0.5 + 0.5) * 255)));
}

// Pre-computed 4x4 Bayer Ordered Dithering Matrix normalized to (-0.10 .. +0.10)
const BAYER_4X4 = new Float32Array([
   0 / 16 - 0.5,  8 / 16 - 0.5,  2 / 16 - 0.5, 10 / 16 - 0.5,
  12 / 16 - 0.5,  4 / 16 - 0.5, 14 / 16 - 0.5,  6 / 16 - 0.5,
   3 / 16 - 0.5, 11 / 16 - 0.5,  1 / 16 - 0.5,  9 / 16 - 0.5,
  15 / 16 - 0.5,  7 / 16 - 0.5, 13 / 16 - 0.5,  5 / 16 - 0.5,
]).map((v) => v * 0.20);

// Pre-computed cell coordinates and base polar distance/angle LUTs for the 80x45 grid
const CELL_X = new Int16Array(GRID_CELLS);
const CELL_Y = new Int16Array(GRID_CELLS);
const CELL_ROW = new Uint8Array(GRID_CELLS);
const CELL_COL = new Uint8Array(GRID_CELLS);
const CELL_NORM_X = new Float32Array(GRID_CELLS);
const CELL_NORM_Y = new Float32Array(GRID_CELLS);
const CELL_BAYER = new Float32Array(GRID_CELLS);
const CELL_RADIAL_DIST = new Float32Array(GRID_CELLS);
const CELL_RADIAL_ANGLE = new Uint8Array(GRID_CELLS);

for (let r = 0; r < GRID_ROWS; r++) {
  for (let c = 0; c < GRID_COLS; c++) {
    const idx = r * GRID_COLS + c;
    CELL_X[idx] = Math.round(c * CELL_W);
    CELL_Y[idx] = Math.round(r * CELL_H);
    CELL_ROW[idx] = r;
    CELL_COL[idx] = c;
    const nx = (c + 0.5) / GRID_COLS - 0.5;
    const ny = (r + 0.5) / GRID_ROWS - 0.5;
    CELL_NORM_X[idx] = nx;
    CELL_NORM_Y[idx] = ny;
    CELL_BAYER[idx] = BAYER_4X4[(r & 3) * 4 + (c & 3)];
    const dist = Math.sqrt(nx * nx * 1.77 + ny * ny);
    CELL_RADIAL_DIST[idx] = dist;
    const ang = Math.atan2(ny, nx);
    CELL_RADIAL_ANGLE[idx] = Math.round(((ang + Math.PI) / (Math.PI * 2)) * 255) & 255;
  }
}

// Default 8-color cyberpunk / demoscene indexed palette (used before artwork loads or as fallback)
const DEFAULT_PALETTE_RGB: [number, number, number][] = [
  [10, 14, 24],
  [18, 38, 64],
  [20, 78, 110],
  [42, 163, 196],
  [56, 189, 248],
  [168, 85, 247],
  [251, 146, 60],
  [240, 249, 255],
];

const SOUNDCLOUD_PALETTE_RGB: [number, number, number][] = [
  [16, 10, 8],
  [58, 22, 10],
  [124, 45, 18],
  [194, 65, 12],
  [234, 88, 12],
  [251, 146, 60],
  [253, 186, 116],
  [255, 247, 237],
];

function rgbToCss(rgb: [number, number, number], alpha = 1): string {
  if (alpha >= 0.999) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(2)})`;
}

/**
 * Bakes an offscreen Micro-Glyph & Terminal Character Sprite Atlas (`640x100`, 10x10px per cell):
 * - Rows `0..7`: 16 density ramp glyphs (`GLYPH_RAMP`) across the 8 indexed palette colors.
 * - Rows `8..9`: 64 printable ASCII characters (`charCode 32..95`) in bright accent & peak phosphor
 *   so live track titles, SoundCloud comments, and glitch hex dumps blit via `drawImage` with zero `fillText`!
 */
function bakeGlyphAtlas(
  atlasCanvas: HTMLCanvasElement,
  palette: [number, number, number][]
): void {
  atlasCanvas.width = ASCII_COUNT * ATLAS_CELL; // 640px
  atlasCanvas.height = (NUM_PALETTE + 2) * ATLAS_CELL; // 100px
  const ctx = atlasCanvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  ctx.font = 'bold 8.5px "JetBrains Mono", "Fira Code", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let p = 0; p < NUM_PALETTE; p++) {
    const rgb = palette[p] || DEFAULT_PALETTE_RGB[p];
    const cy = p * ATLAS_CELL + ATLAS_CELL * 0.5;
    const glowAlpha = p >= 4 ? 0.36 : 0.18;
    const coreAlpha = p === 0 ? 0.32 : Math.min(1, 0.52 + p * 0.07);

    for (let g = 1; g < NUM_GLYPHS; g++) {
      const ch = GLYPH_RAMP[g];
      const cx = g * ATLAS_CELL + ATLAS_CELL * 0.5;

      if (p >= 4) {
        ctx.fillStyle = rgbToCss(rgb, glowAlpha * 0.5);
        ctx.fillText(ch, cx - 0.8, cy);
        ctx.fillText(ch, cx + 0.8, cy);
      }
      ctx.fillStyle = rgbToCss(rgb, coreAlpha);
      ctx.fillText(ch, cx, cy);
    }
  }

  // Row 8 (palette[5] accent) & Row 9 (palette[7] bright phosphor): Printable ASCII 32..95
  for (let rIdx = 0; rIdx < 2; rIdx++) {
    const rgb = palette[rIdx === 0 ? 5 : 7] || DEFAULT_PALETTE_RGB[rIdx === 0 ? 5 : 7];
    const cy = (NUM_PALETTE + rIdx) * ATLAS_CELL + ATLAS_CELL * 0.5;
    for (let c = 1; c < ASCII_COUNT; c++) {
      const ch = String.fromCharCode(ASCII_MIN + c);
      const cx = c * ATLAS_CELL + ATLAS_CELL * 0.5;
      ctx.fillStyle = rgbToCss(rgb, 0.32);
      ctx.fillText(ch, cx - 0.8, cy);
      ctx.fillText(ch, cx + 0.8, cy);
      ctx.fillStyle = rgbToCss(rgb, 0.95);
      ctx.fillText(ch, cx, cy);
    }
  }
}

export const PlayerBackgroundVisualizer: React.FC<Props> = ({
  mode,
  isPlaying,
  track,
  artUrl,
  bpm,
  waveformBars,
  activeComment,
  comments,
  activeChapterLabel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef<VisualizerMode>(mode);
  modeRef.current = mode;
  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;

  // Offscreen buffers (created lazily once, zero per-frame allocations)
  const glyphAtlasRef = useRef<HTMLCanvasElement | null>(null);
  const feedbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef<[number, number, number][]>(DEFAULT_PALETTE_RGB);

  // Artwork & Avatar 80x45 relief map + Sobel edge map
  const artLumaGridRef = useRef<Float32Array>(new Float32Array(GRID_CELLS));
  const artEdgeGridRef = useRef<Float32Array>(new Float32Array(GRID_CELLS));
  const avatarLumaGridRef = useRef<Float32Array>(new Float32Array(GRID_CELLS));
  const avatarBlendRef = useRef<number>(0);

  // Glitch & Scanline Tear buffers (zero per-frame heap allocations)
  const rowTearPxRef = useRef<Int16Array>(new Int16Array(GRID_ROWS));
  const rowCorruptMaskRef = useRef<Uint8Array>(new Uint8Array(GRID_ROWS));
  const glitchTimerRef = useRef<number>(0);
  const glitchSeedRef = useRef<number>(1337);
  const phaseAccumRef = useRef<number>(0);

  // Track transition impulse (1.0 -> 0.0 over ~1.25s when track.uri or mode changes)
  const prevTrackUriRef = useRef<string | undefined>(track?.uri);
  const prevModeRef = useRef<VisualizerMode>(mode);
  const transitionImpulseRef = useRef<number>(0);

  // Live audio spectrum state (updated by `subscribeSpectrum` or synthesized from waveform/BPM)
  const targetBandsRef = useRef<Float32Array>(new Float32Array(16));
  const smoothBandsRef = useRef<Float32Array>(new Float32Array(16));
  const lastSpectrumTickPerfRef = useRef<number>(0);
  const rmsRef = useRef<number>(0.15);
  const peakRef = useRef<number>(0.25);
  const beatPulseRef = useRef<number>(0);
  const paletteCycleOffsetRef = useRef<number>(0);
  const playheadRatioRef = useRef<number>(0);

  // 3D Starfield Structure-of-Arrays (96 stars, zero GC)
  const starCount = 96;
  const starXRef = useRef<Float32Array>(new Float32Array(starCount));
  const starYRef = useRef<Float32Array>(new Float32Array(starCount));
  const starZRef = useRef<Float32Array>(new Float32Array(starCount));

  // Demoscene DYCP Scroller text & live typography strip
  const scrollerTextRef = useRef<string>('SIMP DEMOSCENE ENGINE // READY ');
  const glyphTextStripRef = useRef<string>('SIMP');

  const waveformBarsRef = useRef<number[] | null | undefined>(waveformBars);
  waveformBarsRef.current = waveformBars;
  const bpmRef = useRef<number>(bpm && bpm > 40 ? bpm : 120);
  bpmRef.current = bpm && bpm > 40 ? bpm : 120;

  // Trigger a quantized CRT scanline tear + block datamosh burst
  const triggerGlitchBurst = (intensity: number) => {
    glitchTimerRef.current = Math.max(glitchTimerRef.current, Math.min(1, intensity));
    glitchSeedRef.current = (Math.imul(glitchSeedRef.current, 1664525) + 1013904223) >>> 0;
    const tears = rowTearPxRef.current;
    const corrupt = rowCorruptMaskRef.current;
    let seed = glitchSeedRef.current;

    const numSlices = 2 + (seed % 4);
    for (let s = 0; s < numSlices; s++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const startRow = seed % GRID_ROWS;
      const sliceH = 1 + ((seed >>> 8) % 5);
      const shiftCells = (((seed >>> 16) % 13) - 6) * (intensity > 0.6 ? 2 : 1);
      const shiftPx = shiftCells * 8;
      const isCorrupt = ((seed >>> 24) & 3) === 0 ? 1 : 0;
      for (let r = startRow; r < Math.min(GRID_ROWS, startRow + sliceH); r++) {
        tears[r] = shiftPx;
        corrupt[r] = isCorrupt;
      }
    }
  };

  // Initialize starfield & initial glyph atlas once
  useEffect(() => {
    const sx = starXRef.current;
    const sy = starYRef.current;
    const sz = starZRef.current;
    for (let i = 0; i < starCount; i++) {
      sx[i] = (Math.random() - 0.5) * 2.4;
      sy[i] = (Math.random() - 0.5) * 1.6;
      sz[i] = Math.random() * 1.8 + 0.2;
    }
    if (!glyphAtlasRef.current) {
      glyphAtlasRef.current = document.createElement('canvas');
      bakeGlyphAtlas(glyphAtlasRef.current, paletteRef.current);
    }
  }, []);

  // Update typography & DYCP Greetz Scroller string when track / comments / chapter change
  useEffect(() => {
    if (!track) {
      scrollerTextRef.current = 'SIMP AUDIO ENGINE // INSERT MEDIA ';
      glyphTextStripRef.current = 'SIMP // READY   ';
      return;
    }
    const titleUpper = (track.title || 'UNTITLED').toUpperCase();
    const artistUpper = (track.artists?.join(', ') || 'UNKNOWN ARTIST').toUpperCase();
    const bpmTag = bpm && bpm > 0 ? ` // ${Math.round(bpm)} BPM` : '';
    const chTag = activeChapterLabel ? ` // ${activeChapterLabel.toUpperCase()}` : '';
    const activeCommentTag = activeComment
      ? ` ★ @${activeComment.username.toUpperCase()}: "${activeComment.body.toUpperCase()}" ★ `
      : '';

    glyphTextStripRef.current = activeComment
      ? `>> @${activeComment.username.toUpperCase()}: ${activeComment.body.toUpperCase()} <<      `
      : `// ${titleUpper} :: ${artistUpper}${bpmTag}${chTag} //      `;

    let greetz = '';
    if (comments && comments.length > 0) {
      const sample = comments
        .slice(0, 12)
        .map((c) => `@${c.username.toUpperCase()}: "${c.body.toUpperCase()}"`)
        .join('  ///  ');
      greetz = `  ///  SOUNDCLOUD SHOUTOUTS: ${sample}`;
    }

    scrollerTextRef.current = `   *** NOW PLAYING: ${titleUpper} — ${artistUpper}${bpmTag}${chTag}${activeCommentTag}${greetz}   `;
  }, [track, bpm, activeComment, comments, activeChapterLabel]);

  // Trigger bespoke Track Transition Choreography on URI change OR visualizer mode switch
  useEffect(() => {
    const uriChanged = Boolean(track?.uri && track.uri !== prevTrackUriRef.current);
    const modeChanged = mode !== prevModeRef.current && mode !== 'off';
    if (uriChanged || modeChanged) {
      prevTrackUriRef.current = track?.uri;
      prevModeRef.current = mode;
      transitionImpulseRef.current = 1.0;
      triggerGlitchBurst(0.95);
    }
  }, [track?.uri, mode]);

  // Sample Album Artwork into an 80x45 3D Luminance Relief + Sobel Edge Map + 8-Color Indexed Palette
  useEffect(() => {
    const isSc = Boolean(track?.uri?.startsWith('soundcloud:'));
    const fallbackPal = isSc ? SOUNDCLOUD_PALETTE_RGB : DEFAULT_PALETTE_RGB;

    const buildSyntheticRelief = (seedStr: string) => {
      const luma = artLumaGridRef.current;
      const edge = artEdgeGridRef.current;
      let h = 2166136261;
      for (let i = 0; i < seedStr.length; i++) {
        h ^= seedStr.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const freqX = 2.0 + ((h >>> 0) % 5) * 0.6;
      const freqY = 2.0 + (((h >>> 8) & 0xff) % 5) * 0.6;
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const idx = r * GRID_COLS + c;
          const nx = CELL_NORM_X[idx];
          const ny = CELL_NORM_Y[idx];
          const radial = Math.max(0, 1 - CELL_RADIAL_DIST[idx] * 1.45);
          const pat =
            0.5 +
            0.25 * Math.cos(nx * freqX * Math.PI * 2) +
            0.25 * Math.sin(ny * freqY * Math.PI * 2);
          luma[idx] = Math.max(0.05, Math.min(1, radial * pat));
          edge[idx] = Math.abs(Math.sin(CELL_RADIAL_DIST[idx] * 14)) * radial * 0.55;
        }
      }
      paletteRef.current = fallbackPal;
      if (glyphAtlasRef.current) {
        bakeGlyphAtlas(glyphAtlasRef.current, fallbackPal);
      }
    };

    if (!artUrl) {
      buildSyntheticRelief(track?.uri || 'simp');
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const off = document.createElement('canvas');
        off.width = GRID_COLS;
        off.height = GRID_ROWS;
        const octx = off.getContext('2d', { willReadFrequently: true });
        if (!octx) {
          buildSyntheticRelief(track?.uri || 'simp');
          return;
        }
        octx.drawImage(img, 0, 0, GRID_COLS, GRID_ROWS);
        const data = octx.getImageData(0, 0, GRID_COLS, GRID_ROWS).data;

        const luma = artLumaGridRef.current;
        const edge = artEdgeGridRef.current;
        const colorSamples: { luma: number; sat: number; rgb: [number, number, number] }[] = [];

        for (let i = 0; i < GRID_CELLS; i++) {
          const p = i * 4;
          const r = data[p];
          const g = data[p + 1];
          const b = data[p + 2];
          const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          luma[i] = y;

          if (i % 14 === 0) {
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
            if (y > 0.12 && y < 0.94) {
              const boost = 1.25;
              const avg = (r + g + b) / 3;
              const br = Math.max(12, Math.min(255, Math.round(avg + (r - avg) * boost)));
              const bg = Math.max(12, Math.min(255, Math.round(avg + (g - avg) * boost)));
              const bb = Math.max(12, Math.min(255, Math.round(avg + (b - avg) * boost)));
              colorSamples.push({ luma: y, sat, rgb: [br, bg, bb] });
            }
          }
        }

        // Compute Sobel edge relief so album cover silhouettes stand out in 80x45 micro-ASCII
        for (let r = 0; r < GRID_ROWS; r++) {
          for (let c = 0; c < GRID_COLS; c++) {
            const idx = r * GRID_COLS + c;
            if (r === 0 || r === GRID_ROWS - 1 || c === 0 || c === GRID_COLS - 1) {
              edge[idx] = 0;
              continue;
            }
            const gx =
              -luma[(r - 1) * GRID_COLS + (c - 1)] +
              luma[(r - 1) * GRID_COLS + (c + 1)] -
              2 * luma[r * GRID_COLS + (c - 1)] +
              2 * luma[r * GRID_COLS + (c + 1)] -
              luma[(r + 1) * GRID_COLS + (c - 1)] +
              luma[(r + 1) * GRID_COLS + (c + 1)];
            const gy =
              -luma[(r - 1) * GRID_COLS + (c - 1)] -
              2 * luma[(r - 1) * GRID_COLS + c] -
              luma[(r - 1) * GRID_COLS + (c + 1)] +
              luma[(r + 1) * GRID_COLS + (c - 1)] +
              2 * luma[(r + 1) * GRID_COLS + c] +
              luma[(r + 1) * GRID_COLS + (c + 1)];
            edge[idx] = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 1.45);
          }
        }

        if (colorSamples.length >= 16) {
          colorSamples.sort((a, b) => a.luma + a.sat * 0.25 - (b.luma + b.sat * 0.25));
          const nextPal: [number, number, number][] = [[10, 12, 20]];
          for (let k = 1; k < 7; k++) {
            const pickIdx = Math.min(
              colorSamples.length - 1,
              Math.floor((k / 7) * colorSamples.length)
            );
            nextPal.push(colorSamples[pickIdx].rgb);
          }
          const top = colorSamples[colorSamples.length - 1].rgb;
          nextPal.push([
            Math.min(255, top[0] + 45),
            Math.min(255, top[1] + 45),
            Math.min(255, top[2] + 45),
          ]);
          paletteRef.current = nextPal;
        } else {
          paletteRef.current = fallbackPal;
        }

        if (glyphAtlasRef.current) {
          bakeGlyphAtlas(glyphAtlasRef.current, paletteRef.current);
        }
      } catch {
        buildSyntheticRelief(track?.uri || 'simp');
      }
    };
    img.onerror = () => {
      if (!cancelled) buildSyntheticRelief(track?.uri || 'simp');
    };
    img.src = artUrl;

    return () => {
      cancelled = true;
    };
  }, [artUrl, track?.uri]);

  // Sample SoundCloud commenter avatar into `avatarLumaGridRef` + trigger glitch pop when a timed comment arrives
  useEffect(() => {
    if (!activeComment?.avatar_url) {
      avatarBlendRef.current = 0;
      return;
    }
    triggerGlitchBurst(0.65);
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const off = document.createElement('canvas');
        off.width = GRID_COLS;
        off.height = GRID_ROWS;
        const octx = off.getContext('2d', { willReadFrequently: true });
        if (!octx) return;
        octx.drawImage(img, 0, 0, GRID_COLS, GRID_ROWS);
        const data = octx.getImageData(0, 0, GRID_COLS, GRID_ROWS).data;
        const avGrid = avatarLumaGridRef.current;
        for (let i = 0; i < GRID_CELLS; i++) {
          const p = i * 4;
          avGrid[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
        }
        avatarBlendRef.current = 0.44;
      } catch {
        avatarBlendRef.current = 0;
      }
    };
    img.src = activeComment.avatar_url;
    return () => {
      cancelled = true;
    };
  }, [activeComment?.id, activeComment?.avatar_url]);

  // Subscribe to real-time 16-band AudioSpectrumTick + playhead progress
  useEffect(() => {
    const unsubSpec = defaultSimpClient.subscribeSpectrum((frame) => {
      lastSpectrumTickPerfRef.current = frame.timestamp;
      rmsRef.current = frame.rms;
      peakRef.current = frame.peak;
      if (frame.onset > 0.16) {
        beatPulseRef.current = Math.min(1, Math.max(beatPulseRef.current, frame.onset * 1.25));
        if (frame.onset > 0.34) {
          paletteCycleOffsetRef.current = (paletteCycleOffsetRef.current + 1) & 7;
          triggerGlitchBurst(Math.min(1, frame.onset * 1.35));
        }
      }
      const tb = targetBandsRef.current;
      const len = Math.min(16, frame.bands.length);
      for (let i = 0; i < len; i++) {
        tb[i] = frame.bands[i] / 255;
      }
    });

    const unsubProg = defaultSimpClient.subscribeProgress((posMs) => {
      const dur = track?.duration_ms || 0;
      playheadRatioRef.current = dur > 0 ? Math.max(0, Math.min(1, posMs / dur)) : 0;
    });

    return () => {
      unsubSpec();
      unsubProg();
    };
  }, [track?.duration_ms]);

  // Main Hardware-Accelerated 60fps Canvas Loop (Zero-Allocation, Auto-Throttling)
  useEffect(() => {
    if (mode === 'off' || !isPlaying) {
      return;
    }

    let rafId = 0;
    let frameCount = 0;
    let skipOddFrames = false;
    let rollingCostMs = 0.4;
    let lastFramePerf = performance.now();

    const renderFrame = (nowPerf: number) => {
      rafId = requestAnimationFrame(renderFrame);

      if (document.visibilityState === 'hidden' || !isPlayingRef.current || modeRef.current === 'off') {
        return;
      }

      frameCount++;
      if (skipOddFrames && (frameCount & 1) === 1) {
        return;
      }

      const dt = Math.min(0.05, Math.max(0.005, (nowPerf - lastFramePerf) * 0.001));
      lastFramePerf = nowPerf;
      const t0 = performance.now();
      const timeSec = nowPerf * 0.001;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      // 1. Update or synthesize 16-band audio spectrum (fallback when Widevine browser worker is active)
      const tb = targetBandsRef.current;
      const sb = smoothBandsRef.current;
      const timeSinceRealSpectrum = nowPerf - lastSpectrumTickPerfRef.current;

      if (timeSinceRealSpectrum > 260) {
        const wf = waveformBarsRef.current;
        const wfIdx =
          wf && wf.length > 0
            ? Math.min(wf.length - 1, Math.floor(playheadRatioRef.current * wf.length))
            : -1;
        const envAmp = wfIdx >= 0 && wf ? wf[wfIdx] : 0.48;
        const beatHz = (bpmRef.current || 120) / 60;
        const beatPhase = (timeSec * beatHz) % 1;
        const synthKick = Math.pow(Math.max(0, 1 - beatPhase * 3.2), 2.2) * envAmp;
        if (beatPhase < 0.06 && beatPulseRef.current < 0.35) {
          beatPulseRef.current = 0.72 * envAmp;
          if (envAmp > 0.52) {
            triggerGlitchBurst(envAmp * 0.75);
          }
        }
        rmsRef.current = envAmp * (0.45 + 0.35 * synthKick);
        peakRef.current = Math.min(1, envAmp * (0.65 + 0.35 * synthKick));
        for (let b = 0; b < 16; b++) {
          const wave =
            0.5 +
            0.5 *
              SIN_F32[
                (Math.floor(timeSec * (28 + b * 7) + b * 23 + wfIdx * 7) & 255)
              ];
          tb[b] = Math.min(
            1,
            envAmp * (b < 4 ? 0.55 + 0.45 * synthKick : 0.25 + 0.65 * wave)
          );
        }
      }

      // Smooth attack / deliberate release for the 16 bands
      let subBass = 0;
      let midEnergy = 0;
      let highEnergy = 0;
      for (let i = 0; i < 16; i++) {
        const target = tb[i];
        const cur = sb[i];
        const next = target > cur ? cur + (target - cur) * 0.45 : cur + (target - cur) * 0.12;
        sb[i] = next;
        if (i < 4) subBass += next;
        else if (i < 10) midEnergy += next;
        else highEnergy += next;
      }
      subBass *= 0.25;
      midEnergy /= 6;
      highEnergy /= 6;

      // Occasional organic micro-glitch on high-frequency transients or every ~4.5s
      if (highEnergy > 0.58 && glitchTimerRef.current <= 0.05 && (frameCount & 7) === 0) {
        triggerGlitchBurst(0.48);
      } else if ((frameCount & 255) === 0 && rmsRef.current > 0.12) {
        triggerGlitchBurst(0.35);
      }

      // Music-coupled phase accumulator: calm/hypnotic when quiet, accelerates with bass & BPM
      const bpmFactor = Math.max(0.6, Math.min(1.6, (bpmRef.current || 120) / 120));
      phaseAccumRef.current += dt * (14 * bpmFactor + subBass * 38 + beatPulseRef.current * 24);

      // Decay beat pulse, glitch tear timer & transition shatter impulse
      beatPulseRef.current = Math.max(0, beatPulseRef.current - dt * 2.4);
      if (glitchTimerRef.current > 0) {
        glitchTimerRef.current = Math.max(0, glitchTimerRef.current - dt * 3.8);
        if (glitchTimerRef.current <= 0.01) {
          rowTearPxRef.current.fill(0);
          rowCorruptMaskRef.current.fill(0);
        }
      }
      if (transitionImpulseRef.current > 0) {
        // 1.25-second (0.80/sec) multi-stage track transition envelope
        transitionImpulseRef.current = Math.max(0, transitionImpulseRef.current - dt * 0.80);
      }
      if (avatarBlendRef.current > 0 && !activeComment) {
        avatarBlendRef.current = Math.max(0, avatarBlendRef.current - dt * 0.5);
      }

      const beat = beatPulseRef.current;
      const glitch = glitchTimerRef.current;
      const trans = transitionImpulseRef.current;
      const palette = paletteRef.current;
      const activeMode = modeRef.current;

      // =======================================================================
      // MODE 1: GLYPH MATRIX (80x45 Micro-ASCII + Artwork Relief + Glitch Tear)
      // =======================================================================
      if (activeMode === 'glyph') {
        ctx.fillStyle = '#06070b';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        const atlas = glyphAtlasRef.current;
        if (atlas) {
          const artLuma = artLumaGridRef.current;
          const artEdge = artEdgeGridRef.current;
          const avLuma = avatarLumaGridRef.current;
          const avWeight = avatarBlendRef.current;
          const rowTearPx = rowTearPxRef.current;
          const rowCorrupt = rowCorruptMaskRef.current;
          const gSeed = glitchSeedRef.current;

          // Slower, hypnotic plasma attractors (orbiting ~3x more deliberately)
          const tByte1 = Math.floor(timeSec * 13) & 255;
          const tByte2 = Math.floor(timeSec * 19) & 255;
          const cx1 = SIN_F32[tByte1] * 0.30;
          const cy1 = SIN_F32[(tByte1 + 64) & 255] * 0.24;
          const cx2 = SIN_F32[(256 - tByte2) & 255] * 0.34;
          const cy2 = SIN_F32[(tByte2 + 110) & 255] * 0.26;

          const ripplePhase = Math.floor(phaseAccumRef.current) & 255;
          const palCycle = paletteCycleOffsetRef.current;
          const strip = glyphTextStripRef.current;
          const stripLen = strip.length || 1;
          // Deliberate terminal text crawl (~4.5 chars/sec)
          const scrollColShift = Math.floor(timeSec * 4.5);

          for (let i = 0; i < GRID_CELLS; i++) {
            const row = CELL_ROW[i];
            const col = CELL_COL[i];
            const nx = CELL_NORM_X[i];
            const ny = CELL_NORM_Y[i];
            const rDist = CELL_RADIAL_DIST[i];
            const rAng = CELL_RADIAL_ANGLE[i];

            const bandIdx = ((rAng >>> 4) + (col >>> 1)) & 15;
            const bandVal = sb[bandIdx];

            // 1. Artwork + Commenter Avatar 3D luminance & Sobel edge relief
            const baseArt = artLuma[i] * (1 - avWeight) + avLuma[i] * avWeight;
            const relief = baseArt * 0.42 + artEdge[i] * (0.48 + midEnergy * 0.42);

            // 2. Dual-center LUT Moiré plasma + music-coupled radial wave
            const d1 = Math.sqrt((nx - cx1) * (nx - cx1) + (ny - cy1) * (ny - cy1));
            const d2 = Math.sqrt((nx - cx2) * (nx - cx2) + (ny - cy2) * (ny - cy2));
            const lut1 = SIN_U8[(Math.floor(d1 * 240) - ripplePhase) & 255];
            const lut2 = SIN_U8[(Math.floor(d2 * 190) + (ripplePhase >>> 1)) & 255];
            const plasma = ((lut1 + lut2) * 0.00196) * (0.20 + subBass * 0.42 + beat * 0.25);

            // 3. Combine with 4x4 Bayer Ordered Dither and shape contrast curve for crisp negative space
            const rawEnergy =
              relief +
              plasma +
              bandVal * 0.24 +
              (1 - Math.min(1, rDist * 1.45)) * beat * 0.22 +
              CELL_BAYER[i] -
              0.08;

            const clamped = Math.pow(Math.max(0, Math.min(0.999, rawEnergy)), 1.38);
            let glyphIdx = Math.floor(clamped * NUM_GLYPHS);
            const isCorruptRow = rowCorrupt[row] === 1 && glitch > 0.12;

            if (glyphIdx <= 0 && !isCorruptRow) continue;

            // Palette index with beat-onset cycling
            const basePal = Math.min(NUM_PALETTE - 1, Math.floor(clamped * NUM_PALETTE));
            let palIdx =
              basePal >= 2 ? 2 + ((basePal - 2 + (beat > 0.38 ? palCycle : 0)) % 6) : basePal;

            // Check if this cell sits on one of the 3 terminal data-stream scanlines
            const isTextRow = row === 8 || row === 22 || row === 36;
            let useAsciiAtlasRow = -1;
            let asciiColIdx = 0;

            if (isTextRow && glyphIdx >= 5 && stripLen > 0) {
              const rowShift = row * 11;
              const rawCode = strip.charCodeAt((col + scrollColShift + rowShift) % stripLen);
              // Glitch-decode effect: occasionally scramble characters during glitch bursts
              const code =
                glitch > 0.25 && ((col + gSeed) & 3) === 0
                  ? 33 + ((col * 17 + gSeed) & 31)
                  : rawCode;
              if (code >= ASCII_MIN && code <= ASCII_MAX) {
                asciiColIdx = code - ASCII_MIN;
                useAsciiAtlasRow = NUM_PALETTE + (clamped > 0.68 || beat > 0.4 ? 1 : 0);
              }
            } else if (isCorruptRow && ((col + (gSeed >>> 3)) & 3) === 0) {
              // Datamosh block corruption burst: inject crisp hex/terminal symbols on torn scanlines
              glyphIdx = 7 + ((i ^ gSeed) & 8);
              palIdx = 6 + (col & 1);
            }

            // 3D Z-elevation + Quantized Scanline Tear + 3-Stage Track Transition:
            // Stage A (1.0..0.55): Vortex swirl decompile
            // Stage B (0.55..0.15): Staggered Matrix/Terminal column waterfall cascade
            // Stage C (0.15..0.0): Magnetic shockwave snap into new artwork relief
            const zLift = (clamped - 0.35) * (7 + subBass * 12 + beat * 8);
            const tearOffset = glitch > 0.05 ? Math.round(rowTearPx[row] * glitch) : 0;
            let dx = CELL_X[i] + nx * zLift + tearOffset;
            let dy = CELL_Y[i] + ny * zLift;

            if (trans > 0.005) {
              const p = 1 - trans; // 0.0 (start) -> 1.0 (end)
              const colSpeed = 1 + ((col * 37 + 13) & 7) * 0.28;
              if (trans > 0.45) {
                // Vortex swirl + digital rain drop
                const swirl = Math.sin(((trans - 0.45) / 0.55) * Math.PI);
                const curlAngle = rAng * 0.0245 + trans * 7.5;
                dx += (nx * 140 + Math.cos(curlAngle) * 64) * swirl;
                dy += ((ny * 90 + Math.sin(curlAngle) * 48) * swirl + p * colSpeed * 180) % CANVAS_H;
                if (((col + row + Math.floor(trans * 30)) & 3) === 0) {
                  useAsciiAtlasRow = NUM_PALETTE + 1;
                  asciiColIdx = (col * 13 + row * 7 + Math.floor(trans * 60)) & 63;
                }
              } else {
                // Magnetic snap-in with expanding shockwave ring
                const snapEase = trans / 0.45; // 1.0 -> 0.0
                const shockRadius = (1 - snapEase) * 0.95;
                const ringDelta = Math.abs(rDist - shockRadius);
                if (ringDelta < 0.09) {
                  palIdx = 7;
                  glyphIdx = Math.min(NUM_GLYPHS - 1, glyphIdx + 5);
                }
                dy -= snapEase * snapEase * colSpeed * 75;
              }
            }

            const rx = (Math.round(dx) + CANVAS_W) % CANVAS_W;
            const ry = (Math.round(dy) + CANVAS_H) % CANVAS_H;

            if (useAsciiAtlasRow >= 0) {
              ctx.drawImage(
                atlas,
                asciiColIdx * ATLAS_CELL,
                useAsciiAtlasRow * ATLAS_CELL,
                ATLAS_CELL,
                ATLAS_CELL,
                rx,
                ry,
                8,
                8
              );
            } else {
              ctx.drawImage(
                atlas,
                glyphIdx * ATLAS_CELL,
                palIdx * ATLAS_CELL,
                ATLAS_CELL,
                ATLAS_CELL,
                rx,
                ry,
                8,
                8
              );

              // Chromatic ASCII ghosting on strong glitch/beat spikes for high-relief edges
              if (glitch > 0.32 && artEdge[i] > 0.35 && (i & 1) === 0) {
                const ghostPal = (palIdx + 3) & 7;
                ctx.drawImage(
                  atlas,
                  glyphIdx * ATLAS_CELL,
                  ghostPal * ATLAS_CELL,
                  ATLAS_CELL,
                  ATLAS_CELL,
                  (rx + 12) % CANVAS_W,
                  ry,
                  8,
                  8
                );
              }
            }
          }
        }
      }

      // =======================================================================
      // MODE 2: WINAMP AVS (Feedback Zoom/Rotate Tunnel + Rez Wireframe + Scope)
      // =======================================================================
      else if (activeMode === 'avs') {
        if (!feedbackCanvasRef.current) {
          feedbackCanvasRef.current = document.createElement('canvas');
          feedbackCanvasRef.current.width = CANVAS_W;
          feedbackCanvasRef.current.height = CANVAS_H;
        }
        const fb = feedbackCanvasRef.current;
        const fbCtx = fb.getContext('2d');

        // 1. Ping-pong feedback zoom & rotation (classic Winamp Geiss / MilkDrop warp)
        // During Track Transition (`trans > 0`):
        // - Phase A (`trans > 0.55`): Gravity implosion (`zoom < 1.0`) + barrel spin into singularity
        // - Phase B (`trans <= 0.55`): Supernova portal burst (`zoom > 1.08`) + Rez lock-on reticle
        ctx.fillStyle = '#05060a';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        let zoom = 1.014 + subBass * 0.028 + beat * 0.022;
        let rot = SIN_F32[Math.floor(timeSec * 19) & 255] * (0.012 + midEnergy * 0.018);

        if (trans > 0.55) {
          const imp = (trans - 0.55) / 0.45; // 1.0 -> 0.0
          zoom = 0.91 - imp * 0.05;
          rot += imp * 0.16;
        } else if (trans > 0.005) {
          const burst = trans / 0.55; // 1.0 -> 0.0
          zoom = 1.02 + burst * 0.085;
          rot -= burst * 0.09;
        }

        ctx.save();
        ctx.translate(CANVAS_W * 0.5, CANVAS_H * 0.5);
        ctx.rotate(rot);
        ctx.scale(zoom, zoom);
        ctx.globalAlpha = trans > 0.01 ? 0.92 : 0.88;
        ctx.drawImage(fb, -CANVAS_W * 0.5, -CANVAS_H * 0.5, CANVAS_W, CANVAS_H);
        ctx.restore();
        ctx.globalAlpha = 1.0;

        // 2. Rez / Vectrex Beat-Locked Concentric Wireframe Polygons
        const cx = CANVAS_W * 0.5;
        const cy = CANVAS_H * 0.5;
        const sides = 8;
        const baseRadius = 38 + subBass * 65 + beat * 35;

        for (let ring = 0; ring < 3; ring++) {
          const r = baseRadius * (0.55 + ring * 0.45);
          const palColor = palette[Math.min(7, 3 + ring * 2)];
          ctx.strokeStyle = rgbToCss(palColor, 0.55 - ring * 0.12);
          ctx.lineWidth = ring === 0 ? 2.2 : 1.3;
          ctx.beginPath();
          for (let s = 0; s <= sides; s++) {
            const bandMod = sb[(s * 2 + ring) & 15] * 26;
            const theta = (s / sides) * Math.PI * 2 + timeSec * (ring % 2 === 0 ? 0.45 : -0.35);
            const px = cx + Math.cos(theta) * (r + bandMod);
            const py = cy + Math.sin(theta) * (r + bandMod) * 0.72;
            if (s === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }

        // 2b. Playful Rez Area-Transition Vector Portal & Lock-On Crosshair Reticle (`trans > 0.01`)
        if (trans > 0.01) {
          const portalProg = 1 - trans; // 0.0 -> 1.0
          for (let pRing = 0; pRing < 4; pRing++) {
            const ringZ = ((portalProg * 1.8 + pRing * 0.25) % 1);
            const pr = 16 + Math.pow(ringZ, 2.1) * 340;
            const pAlpha = (1 - ringZ) * Math.sin(trans * Math.PI) * 0.85;
            ctx.strokeStyle = rgbToCss(palette[7], pAlpha);
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            for (let s = 0; s <= 4; s++) {
              const ang = (s / 4) * Math.PI * 2 + portalProg * Math.PI * (pRing % 2 === 0 ? 1 : -1);
              const vx = cx + Math.cos(ang) * pr * 1.35;
              const vy = cy + Math.sin(ang) * pr * 0.85;
              if (s === 0) ctx.moveTo(vx, vy);
              else ctx.lineTo(vx, vy);
            }
            ctx.stroke();
          }

          // Rotating Rez Target Lock-On brackets around center singularity
          const lockR = 28 + trans * 95;
          const lockAngle = trans * Math.PI * 1.5;
          ctx.strokeStyle = rgbToCss(palette[6], Math.min(1, trans * 1.4));
          ctx.lineWidth = 2.0;
          for (let q = 0; q < 4; q++) {
            const a0 = lockAngle + q * (Math.PI * 0.5) - 0.28;
            const a1 = a0 + 0.56;
            ctx.beginPath();
            ctx.arc(cx, cy, lockR, a0, a1);
            ctx.stroke();
          }
        }

        // 3. Classic Winamp Dual-Trace Oscilloscope Ribbon
        const scopePal = palette[6] || [56, 189, 248];
        ctx.strokeStyle = rgbToCss(scopePal, 0.85);
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        const points = 64;
        for (let p = 0; p < points; p++) {
          const x = (p / (points - 1)) * CANVAS_W;
          const bVal = sb[p & 15];
          const wave1 = SIN_F32[(Math.floor(timeSec * 90) + p * 9) & 255];
          const wave2 = SIN_F32[(Math.floor(timeSec * 145) + p * 17) & 255];
          const yOffset = (wave1 * 0.6 + wave2 * 0.4) * (18 + bVal * 75 + beat * 30);
          const y = cy + yOffset;
          if (p === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Copy current frame into feedback buffer for next frame's tunnel pass
        if (fbCtx) {
          fbCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
          fbCtx.drawImage(canvas, 0, 0);
        }
      }

      // =======================================================================
      // MODE 3: DEMOSCENE 64K (Amiga Copper Bars + 3D Synth Grid + DYCP Scroller)
      // =======================================================================
      else if (activeMode === 'demoscene') {
        ctx.fillStyle = '#05060c';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        // During Track Transition (`trans > 0`):
        // - Horizon barrel-roll camera bank + Millennium Falcon hyperspace star streaks
        // - Amiga Copper Venetian-Blind Raster Curtain Wipe across the screen
        // - Celebratory 2.5x DYCP Sine-Wave Scroller bounce
        const transWave = trans > 0.005 ? Math.sin(trans * Math.PI) : 0;
        const horizonY = Math.round(
          CANVAS_H * 0.46 + (trans > 0.005 ? Math.sin(trans * Math.PI * 2) * 28 * transWave : 0)
        );

        // 1. 3D Warp ASCII Starfield in upper sky (stretches into hyperspace streaks on transition!)
        const sx = starXRef.current;
        const sy = starYRef.current;
        const sz = starZRef.current;
        const warpSpeed = dt * (0.45 + subBass * 1.6 + transWave * 5.2);
        ctx.fillStyle = rgbToCss(palette[7], 0.78);
        ctx.strokeStyle = rgbToCss(palette[6], 0.75);
        ctx.lineWidth = 1.4;

        for (let i = 0; i < starCount; i++) {
          const prevZ = sz[i];
          sz[i] -= warpSpeed;
          if (sz[i] <= 0.08) {
            sx[i] = (Math.random() - 0.5) * 2.4;
            sy[i] = (Math.random() - 0.5) * 1.4;
            sz[i] = 1.9;
            continue;
          }
          const projX = Math.round(CANVAS_W * 0.5 + (sx[i] / sz[i]) * 260);
          const projY = Math.round(horizonY * 0.75 + (sy[i] / sz[i]) * 140);
          if (projX >= 0 && projX < CANVAS_W && projY >= 0 && projY < horizonY + 30) {
            if (transWave > 0.15) {
              const tailZ = Math.min(2.2, prevZ + transWave * 0.35);
              const tailX = Math.round(CANVAS_W * 0.5 + (sx[i] / tailZ) * 260);
              const tailY = Math.round(horizonY * 0.75 + (sy[i] / tailZ) * 140);
              ctx.beginPath();
              ctx.moveTo(tailX, tailY);
              ctx.lineTo(projX, projY);
              ctx.stroke();
            } else {
              const szPx = sz[i] < 0.6 ? 3 : sz[i] < 1.2 ? 2 : 1;
              ctx.fillRect(projX, projY, szPx, szPx);
            }
          }
        }

        // 2. Amiga-style Horizontal Copper Raster Spectrum Bars (+ Venetian Curtain Wipe on track change)
        const rasterCount = transWave > 0.05 ? 16 : 10;
        for (let b = 0; b < rasterCount; b++) {
          const bandAmp = sb[b & 15];
          const wipeOffset =
            transWave > 0.05
              ? Math.sin(trans * Math.PI * 2 + b * 0.45) * 95 * transWave
              : 0;
          const yBase =
            24 +
            b * (transWave > 0.05 ? 20 : 12) +
            SIN_F32[(Math.floor(timeSec * 48) + b * 19) & 255] * (6 + subBass * 10) +
            wipeOffset;
          const barW = Math.round(
            Math.min(1, 0.18 + bandAmp * 0.78 + transWave * 0.45) * CANVAS_W
          );
          const barX = Math.round((CANVAS_W - barW) * 0.5);
          const palC = palette[2 + (b % 6)];
          const barH = transWave > 0.05 ? Math.round(4 + transWave * 8) : 4;
          ctx.fillStyle = rgbToCss(palC, 0.28 + bandAmp * 0.42 + transWave * 0.22);
          ctx.fillRect(barX, Math.round(yBase), barW, barH);
        }

        // 3. 3D Perspective Scrolling Vector Synth Grid (with camera bank tilt on transition)
        const gridPal = palette[4] || [42, 163, 196];
        ctx.save();
        if (transWave > 0.01) {
          const bankAngle = Math.sin(trans * Math.PI * 2) * 0.16 * transWave;
          ctx.translate(CANVAS_W * 0.5, horizonY);
          ctx.rotate(bankAngle);
          ctx.translate(-CANVAS_W * 0.5, -horizonY);
        }
        ctx.strokeStyle = rgbToCss(gridPal, 0.38 + subBass * 0.32 + transWave * 0.25);
        ctx.lineWidth = 1.2;
        ctx.beginPath();

        const vpx = CANVAS_W * 0.5 + SIN_F32[Math.floor(timeSec * 22) & 255] * 36;
        for (let v = -8; v <= 8; v++) {
          ctx.moveTo(vpx + v * 12, horizonY);
          ctx.lineTo(CANVAS_W * 0.5 + v * 78, CANVAS_H + 30);
        }

        const zScroll = (timeSec * (1.8 + subBass * 2.2 + transWave * 5.0)) % 1;
        for (let h = 0; h < 8; h++) {
          const normD = (h + zScroll) / 8;
          const y = horizonY + Math.pow(normD, 1.85) * (CANVAS_H - horizonY);
          ctx.moveTo(-40, y);
          ctx.lineTo(CANVAS_W + 40, y);
        }
        ctx.stroke();

        // 4. 16-Band Mirrored Spectrum Analyzer Pillars on the Horizon
        const pillarZoneW = CANVAS_W * 0.64;
        const pillarStartX = (CANVAS_W - pillarZoneW) * 0.5;
        const pillarStep = pillarZoneW / 16;
        for (let b = 0; b < 16; b++) {
          const h = Math.round(sb[b] * 68 + beat * 14 + transWave * 28);
          if (h <= 1) continue;
          const px = Math.round(pillarStartX + b * pillarStep);
          const pw = Math.max(4, Math.round(pillarStep - 4));
          ctx.fillStyle = rgbToCss(palette[Math.min(7, 3 + (b >>> 2))], 0.68);
          ctx.fillRect(px, horizonY - h, pw, h);
        }
        ctx.restore();

        // 5. Classic DYCP (Different Y Character Position) Sine-Wave "Greetz" Scroller
        const scroller = scrollerTextRef.current;
        if (scroller.length > 0) {
          const charW = 13;
          const scrollPx = Math.floor(timeSec * 95);
          const firstCharIdx = Math.floor(scrollPx / charW);
          const pixelRem = scrollPx % charW;
          const visibleChars = Math.ceil(CANVAS_W / charW) + 2;

          ctx.font = 'bold 15px "JetBrains Mono", "Fira Code", monospace';
          ctx.textBaseline = 'middle';

          const bounceAmp = 12 + subBass * 18 + beat * 8 + transWave * 34;
          for (let c = 0; c < visibleChars; c++) {
            const ch = scroller[(firstCharIdx + c) % scroller.length];
            if (ch === ' ') continue;
            const x = c * charW - pixelRem;
            const sineIdx = (Math.floor(timeSec * 85) + (firstCharIdx + c) * 11) & 255;
            const y = CANVAS_H - 48 + SIN_F32[sineIdx] * bounceAmp;
            const cPal = palette[4 + ((firstCharIdx + c) & 3)];
            ctx.fillStyle = rgbToCss(cPal, 0.90);
            ctx.fillText(ch, Math.round(x), Math.round(y));
          }
        }
      }

      // Center-Stage Contrast Cushion: softly attenuates the canvas directly behind the foreground
      // track metadata, scrub bar, and transport controls while leaving the outer visualizer frame vivid.
      const centerGrad = ctx.createRadialGradient(
        CANVAS_W * 0.56,
        CANVAS_H * 0.52,
        CANVAS_H * 0.08,
        CANVAS_W * 0.56,
        CANVAS_H * 0.52,
        CANVAS_W * 0.48
      );
      centerGrad.addColorStop(0, 'rgba(6, 7, 11, 0.56)');
      centerGrad.addColorStop(0.65, 'rgba(6, 7, 11, 0.34)');
      centerGrad.addColorStop(1, 'rgba(6, 7, 11, 0.10)');
      ctx.fillStyle = centerGrad;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Frame-time governor: auto-step to 30fps if draw cost ever exceeds 1.5ms
      const frameCost = performance.now() - t0;
      rollingCostMs = rollingCostMs * 0.9 + frameCost * 0.1;
      if (rollingCostMs > 1.5 && !skipOddFrames) {
        skipOddFrames = true;
      } else if (rollingCostMs < 0.9 && skipOddFrames) {
        skipOddFrames = false;
      }
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [mode, isPlaying, activeComment]);

  if (mode === 'off') {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        pointerEvents: 'none',
        zIndex: 0,
        opacity: isPlaying ? 0.88 : 0.32,
        transition: 'opacity 320ms ease',
      }}
    />
  );
};
