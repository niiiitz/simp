import React, { useEffect, useRef } from 'react';
import { defaultSimpClient, type SoundCloudComment, type TrackMetadata } from '@simp/client';
import {
  getSceneDescriptor,
  loadEnabledVisualizerScenes,
   saveEnabledVisualizerScenes,
  VISUALIZER_ENGINES,
  VISUALIZER_MODES,
  VISUALIZER_SCENES,
  type VisualizerEngine,
  type VisualizerMode,
} from './visualizers/sceneRegistry';
import { isValidAttributedComment } from './visualizers/VisualizerOverlayHud';
import {
  ensureWasmVizEngineLoaded,
  getLoadedWasmVizEngine,
} from './visualizers/wasmVizBridge';

export {
  getSceneDescriptor,
  loadEnabledVisualizerScenes,
  saveEnabledVisualizerScenes,
  VISUALIZER_ENGINES,
  VISUALIZER_MODES,
  VISUALIZER_SCENES,
  type VisualizerEngine,
  type VisualizerMode,
};

interface Props {
  mode: VisualizerMode;
  enabledScenes?: VisualizerEngine[];
  preferredScene?: VisualizerEngine | null;
  onActiveEngineChange?: (engine: VisualizerEngine) => void;
  isPlaying: boolean;
  track: TrackMetadata | null;
  artUrl?: string | null;
  bpm?: number | null;
  waveformBars?: number[] | null;
  activeComment?: SoundCloudComment | null;
  comments?: SoundCloudComment[];
  activeChapterLabel?: string | null;
  activeLyricLine?: string | null;
  nextLyricLine?: string | null;
  hasLyrics?: boolean;
  lyricsMarqueeFallback?: string | null;
  hidden?: boolean;
}

const CANVAS_W = 640;
const CANVAS_H = 360;

// High-density 80x45 micro-glyph grid (3,600 cells, 8x8px per cell on 640x360 canvas)
const GRID_COLS = 80;
const GRID_ROWS = 45;
const GRID_CELLS = GRID_COLS * GRID_ROWS; // 3,600 cells
const CELL_W = 8;
const CELL_H = 8;

// Unstretched square artwork sampling buffer (128x128) for slow Ken-Burns panning
const ART_BUF_SIZE = 128;
const ART_BUF_PIXELS = ART_BUF_SIZE * ART_BUF_SIZE;

// 16 typographic ASCII ramp glyphs ordered by optical density
const GLYPH_RAMP = [' ', '·', '.', ':', '-', '~', '=', '+', '*', 'x', 'z', '#', '%', '&', '@', '$'];
const NUM_GLYPHS = GLYPH_RAMP.length; // 16
const NUM_PALETTE = 8;

// Printable ASCII strip (charCode 32..95) baked into the 8x8 bitmap LUT (indices 16..79)
const ASCII_MIN = 32;
const ASCII_MAX = 95;
const ASCII_COUNT = ASCII_MAX - ASCII_MIN + 1; // 64 chars
const TOTAL_LUT_GLYPHS = NUM_GLYPHS + ASCII_COUNT; // 80 glyphs total, 64 bytes each = 5,120 bytes

// Pre-computed 256-entry Sine Lookup Table (-1.0 .. +1.0) & Uint8 (0 .. 255)
const SIN_F32 = new Float32Array(256);
const COS_F32 = new Float32Array(256);
const SIN_U8 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const rad = (i / 256) * Math.PI * 2;
  const s = Math.sin(rad);
  SIN_F32[i] = s;
  COS_F32[i] = Math.cos(rad);
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
    CELL_X[idx] = c * CELL_W;
    CELL_Y[idx] = r * CELL_H;
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

// True OLED Black Floor Palettes (Slot 0 is always pure #000000)
const DEFAULT_PALETTE_RGB: [number, number, number][] = [
  [0, 0, 0],
  [12, 28, 48],
  [20, 78, 110],
  [42, 163, 196],
  [56, 189, 248],
  [168, 85, 247],
  [251, 146, 60],
  [240, 249, 255],
];

const SOUNDCLOUD_PALETTE_RGB: [number, number, number][] = [
  [0, 0, 0],
  [44, 16, 6],
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

function packAbgr(r: number, g: number, b: number): number {
  return (0xff000000 | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
}

// Pre-bake 80 glyphs (16 ramp + 64 ASCII) as 8x8 1-bit pixel masks once at startup
let cachedGlyphBitmaps: Uint8Array | null = null;
function getGlyphBitmaps(): Uint8Array {
  if (cachedGlyphBitmaps) return cachedGlyphBitmaps;
  const buf = new Uint8Array(TOTAL_LUT_GLYPHS * 64);
  if (typeof document === 'undefined') {
    cachedGlyphBitmaps = buf;
    return buf;
  }
  const c = document.createElement('canvas');
  c.width = TOTAL_LUT_GLYPHS * 8;
  c.height = 8;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    cachedGlyphBitmaps = buf;
    return buf;
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 7.5px "JetBrains Mono", "Fira Code", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let g = 1; g < NUM_GLYPHS; g++) {
    ctx.fillText(GLYPH_RAMP[g], g * 8 + 4, 4.5);
  }
  for (let a = 1; a < ASCII_COUNT; a++) {
    ctx.fillText(String.fromCharCode(ASCII_MIN + a), (NUM_GLYPHS + a) * 8 + 4, 4.5);
  }

  const imgData = ctx.getImageData(0, 0, c.width, 8).data;
  for (let idx = 0; idx < TOTAL_LUT_GLYPHS; idx++) {
    const baseOffset = idx * 64;
    const startX = idx * 8;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const p = (py * c.width + (startX + px)) * 4;
        buf[baseOffset + py * 8 + px] = imgData[p + 1] > 76 ? 1 : 0;
      }
    }
  }
  cachedGlyphBitmaps = buf;
  return buf;
}

interface GlyphMutationPatch {
  active: boolean;
  col: number;
  row: number;
  scale: 2 | 3;
  text: string;
  ttl: number;
  maxTtl: number;
  palIdx: number;
  vertical: boolean;
}

const MAX_MUTATION_PATCHES = 10;

// 0 = Chrome Sphere (Rock), 1 = Neon Pyramid/Triangle (Scissors), 2 = Bryce 3D Cube/Square (Paper)
// RPS Rules: Sphere (0) crushes Pyramid (1); Pyramid (1) slices Cube (2); Cube (2) traps Sphere (0)
type TrapperShapeKind = 0 | 1 | 2;
const TRAPPER_SHAPE_NAMES: Record<TrapperShapeKind, string> = {
  0: 'CHROME SPHERE',
  1: 'NEON PYRAMID',
  2: 'BRYCE CUBE',
};

interface TrapperShard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  palIdx: number;
}

interface TrapperArenaState {
  leftShape: TrapperShapeKind;
  rightShape: TrapperShapeKind;
  phase: 'float' | 'charge' | 'clash' | 'challenger';
  timer: number;
  loserSide: 'left' | 'right';
  incomingShape: TrapperShapeKind;
  challengerBannerCount: number;
  shards: TrapperShard[];
}

function getRpsLoserSide(left: TrapperShapeKind, right: TrapperShapeKind): 'left' | 'right' {
  // 0 beats 1, 1 beats 2, 2 beats 0
  if ((left === 0 && right === 1) || (left === 1 && right === 2) || (left === 2 && right === 0)) {
    return 'right';
  }
  return 'left';
}

export const PlayerBackgroundVisualizer: React.FC<Props> = ({
  mode,
  enabledScenes,
  preferredScene = null,
  onActiveEngineChange,
  isPlaying,
  track,
  artUrl,
  bpm,
  waveformBars,
  activeComment: rawActiveComment,
  comments: rawComments,
  activeChapterLabel,
  activeLyricLine,
  nextLyricLine,
  hasLyrics = false,
  lyricsMarqueeFallback = null,
  hidden = false,
}) => {
  // Strictly enforce SoundCloud comment user attribution before any visualizer consumer sees it
  const activeComment = isValidAttributedComment(rawActiveComment) ? rawActiveComment : null;
  const comments = React.useMemo(
    () => (rawComments ? rawComments.filter(isValidAttributedComment) : []),
    [rawComments],
  );

  useEffect(() => {
    ensureWasmVizEngineLoaded();
  }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef<VisualizerMode>(mode);
  modeRef.current = mode;
  const enabledScenesRef = useRef<VisualizerEngine[]>(
    enabledScenes && enabledScenes.length > 0 ? enabledScenes : VISUALIZER_ENGINES,
  );
  enabledScenesRef.current =
    enabledScenes && enabledScenes.length > 0 ? enabledScenes : VISUALIZER_ENGINES;
  const preferredSceneRef = useRef<VisualizerEngine | null>(preferredScene || null);
  preferredSceneRef.current = preferredScene || null;
  const onActiveEngineChangeRef = useRef<((engine: VisualizerEngine) => void) | undefined>(
    onActiveEngineChange,
  );
  onActiveEngineChangeRef.current = onActiveEngineChange;
  const lastReportedEngineRef = useRef<VisualizerEngine | null>(null);
  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;
  const hiddenRef = useRef<boolean>(hidden);
  hiddenRef.current = hidden;
  const trackRef = useRef<TrackMetadata | null>(track);
  trackRef.current = track;
  const activeCommentRef = useRef<SoundCloudComment | null | undefined>(activeComment);
  activeCommentRef.current = activeComment;
  const activeLyricRef = useRef<string | null | undefined>(activeLyricLine);
  activeLyricRef.current = activeLyricLine;
  const nextLyricRef = useRef<string | null | undefined>(nextLyricLine);
  nextLyricRef.current = nextLyricLine;
  const hasScCommentsRef = useRef<boolean>(false);
  hasScCommentsRef.current = Boolean((comments && comments.length > 0) || activeComment);
  const hasLyricsRef = useRef<boolean>(false);
  hasLyricsRef.current = Boolean(
    hasLyrics ||
      activeLyricLine ||
      (lyricsMarqueeFallback && lyricsMarqueeFallback.trim().length > 0)
  );
  const lyricsMarqueeFallbackRef = useRef<string | null | undefined>(lyricsMarqueeFallback);
  lyricsMarqueeFallbackRef.current = lyricsMarqueeFallback;
  const prevLyricLineRef = useRef<string | null | undefined>(null);
  const vertigoLyricRevealRef = useRef<number>(1);

  // Offscreen buffers (created lazily once, zero per-frame allocations)
  const imageDataRef = useRef<ImageData | null>(null);
  const u32FrameRef = useRef<Uint32Array | null>(null);
  const feedbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef<[number, number, number][]>(DEFAULT_PALETTE_RGB);
  const paletteAbgrRef = useRef<Uint32Array>(
    new Uint32Array(DEFAULT_PALETTE_RGB.map(([r, g, b]) => packAbgr(r, g, b)))
  );

  // Unstretched 128x128 square artwork relief & Sobel edge map for slow panning
  const artSquareLumaRef = useRef<Float32Array>(new Float32Array(ART_BUF_PIXELS));
  const artSquareEdgeRef = useRef<Float32Array>(new Float32Array(ART_BUF_PIXELS));
  const avatarLumaGridRef = useRef<Float32Array>(new Float32Array(GRID_CELLS));
  const avatarBlendRef = useRef<number>(0);

  // Unstable Multi-Scale Glyph & Lyric Mutation Patches
  const mutationPatchesRef = useRef<GlyphMutationPatch[]>(
    Array.from({ length: MAX_MUTATION_PATCHES }, () => ({
      active: false,
      col: 0,
      row: 0,
      scale: 2,
      text: '',
      ttl: 0,
      maxTtl: 2.0,
      palIdx: 7,
      vertical: false,
    }))
  );
  // Per-frame cell occupancy map so 2x2 / 3x3 macro-glyph blocks cleanly override 1x1 cells
  const cellSkipMaskRef = useRef<Uint8Array>(new Uint8Array(GRID_CELLS));

  // Glitch & Scanline Tear buffers (zero per-frame heap allocations)
  const rowTearPxRef = useRef<Int16Array>(new Int16Array(GRID_ROWS));
  const rowCorruptMaskRef = useRef<Uint8Array>(new Uint8Array(GRID_ROWS));
  const glitchTimerRef = useRef<number>(0);
  const glitchSeedRef = useRef<number>(1337);
  const phaseAccumRef = useRef<number>(0);
  const simTimeSecRef = useRef<number>(0);
  const lastRenderedModeRef = useRef<VisualizerMode | null>(null);

  // Track transition impulse (1.0 -> 0.0 over ~1.25s when track.uri or mode changes)
  const prevTrackUriRef = useRef<string | undefined>(track?.uri);
  const prevModeRef = useRef<VisualizerMode>(mode);
  const cycleIndexRef = useRef<number>(0);
  const transitionImpulseRef = useRef<number>(0);

  // Live audio spectrum + Beat-Drop & Build-Up Detector state
  const targetBandsRef = useRef<Float32Array>(new Float32Array(16));
  const smoothBandsRef = useRef<Float32Array>(new Float32Array(16));
  const lastSpectrumTickPerfRef = useRef<number>(0);
  const rmsRef = useRef<number>(0.15);
  const peakRef = useRef<number>(0.25);
  const beatPulseRef = useRef<number>(0);
  const paletteCycleOffsetRef = useRef<number>(0);
  const playheadRatioRef = useRef<number>(0);

  // Beat-Drop & Breakdown/Build-Up State Machine
  const shortEnergyRef = useRef<number>(0.22);
  const longEnergyRef = useRef<number>(0.22);
  const buildupChargeRef = useRef<number>(0);
  const dropIntensityRef = useRef<number>(0);
  const dropCooldownRef = useRef<number>(0);
  const vertigoRollTargetRef = useRef<number>(0);
  const vertigoRollCurrentRef = useRef<number>(0);
  const vertigoTravelZRef = useRef<number>(0);
  const vertigoPulseZRef = useRef<number>(0);
  const vertigoSmoothSpineXRef = useRef<number>(0);
  const vertigoSmoothSpineYRef = useRef<number>(0);

  // 90s Bryce Trapper steady backward floor scroll & 2-of-3 Rock-Paper-Scissors Arena
  const trapperFloorZRef = useRef<number>(0);
  const trapperArenaRef = useRef<TrapperArenaState>({
    leftShape: 0,
    rightShape: 1,
    phase: 'float',
    timer: 0,
    loserSide: 'right',
    incomingShape: 2,
    challengerBannerCount: 0,
    shards: [],
  });

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

  const updatePaletteAbgr = (pal: [number, number, number][]) => {
    paletteRef.current = pal;
    const out = paletteAbgrRef.current;
    out[0] = 0xff000000; // True OLED #000000 floor in slot 0
    for (let i = 1; i < NUM_PALETTE; i++) {
      const rgb = pal[i] || DEFAULT_PALETTE_RGB[i];
      out[i] = packAbgr(rgb[0], rgb[1], rgb[2]);
    }
  };

  // Spawn an unstable multi-scale (2x2 or 3x3) glyph or lyric mutation patch
  const spawnGlyphMutation = (preferLyric = false, scaleOverride?: 2 | 3) => {
    const patches = mutationPatchesRef.current;
    let slot = patches.find((p) => !p.active);
    if (!slot) {
      slot = patches.reduce((oldest, cur) => (cur.ttl < oldest.ttl ? cur : oldest), patches[0]);
    }
    glitchSeedRef.current = (Math.imul(glitchSeedRef.current, 1664525) + 1013904223) >>> 0;
    const seed = glitchSeedRef.current;

    const lyric = (activeLyricRef.current || '').trim().toUpperCase();
    const titleUpper = (trackRef.current?.title || 'SIMP').trim().toUpperCase();
    const sourceText =
      preferLyric && lyric.length > 0
        ? lyric
        : lyric.length > 0 && (seed & 1) === 0
          ? lyric
          : titleUpper;

    const words = sourceText
      .replace(/[^A-Z0-9 !?#$&*@/-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    const chosenWord =
      words.length > 0
        ? words[(seed >>> 4) % words.length].slice(0, 12)
        : GLYPH_RAMP[8 + (seed & 7)].repeat(2);

    const scale: 2 | 3 = scaleOverride || ((seed & 3) === 0 ? 3 : 2);
    const vertical = (seed & 7) === 0 && chosenWord.length <= 7;
    const maxCol = Math.max(4, GRID_COLS - (vertical ? scale : chosenWord.length * scale) - 2);
    const maxRow = Math.max(4, GRID_ROWS - (vertical ? chosenWord.length * scale : scale) - 2);

    slot.active = true;
    slot.scale = scale;
    slot.vertical = vertical;
    slot.col = 2 + ((seed >>> 8) % maxCol);
    slot.row = 2 + ((seed >>> 16) % maxRow);
    slot.text = chosenWord;
    slot.maxTtl = 1.4 + ((seed >>> 20) & 15) * 0.14; // 1.4s .. 3.5s
    slot.ttl = slot.maxTtl;
    slot.palIdx = 5 + (seed % 3); // Bright palette indices 5..7
  };

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
    if (intensity > 0.42) {
      spawnGlyphMutation(false);
    }
  };

  // Initialize starfield & warm up 8x8 glyph bitmap LUT once
  useEffect(() => {
    const sx = starXRef.current;
    const sy = starYRef.current;
    const sz = starZRef.current;
    for (let i = 0; i < starCount; i++) {
      sx[i] = (Math.random() - 0.5) * 2.4;
      sy[i] = (Math.random() - 0.5) * 1.6;
      sz[i] = Math.random() * 1.8 + 0.2;
    }
    getGlyphBitmaps();
    updatePaletteAbgr(DEFAULT_PALETTE_RGB);
  }, []);

  // Spawn a lyric mutation whenever the synced lyric line advances
  useEffect(() => {
    if (activeLyricLine && activeLyricLine !== prevLyricLineRef.current) {
      prevLyricLineRef.current = activeLyricLine;
      vertigoLyricRevealRef.current = 0;
      spawnGlyphMutation(true, 3);
      spawnGlyphMutation(true, 2);
    } else if (!activeLyricLine) {
      prevLyricLineRef.current = null;
    }
  }, [activeLyricLine]);

  // Update typography & DYCP Greetz Scroller string when track / comments / chapter / lyrics change
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

    glyphTextStripRef.current = activeLyricLine
      ? `>> ♪ ${activeLyricLine.toUpperCase()} ♪ <<      `
      : activeComment
        ? `>> @${activeComment.username.toUpperCase()}: ${activeComment.body.toUpperCase()} <<      `
        : `// ${titleUpper} :: ${artistUpper}${bpmTag}${chTag} //      `;

    const hasScComments = Boolean((comments && comments.length > 0) || activeComment);
    const hasTrackLyrics = Boolean(
      hasLyrics ||
        activeLyricLine ||
        (lyricsMarqueeFallback && lyricsMarqueeFallback.trim().length > 0)
    );

    const shoutoutsSample =
      comments && comments.length > 0
        ? comments
            .slice(0, 15)
            .map((c) => `@${c.username.toUpperCase()}: "${c.body.toUpperCase()}"`)
            .join('   ///   ')
        : '';

    // DEMOSCENE & TRAPPER Marquee Priority Logic:
    // 1. If Lyrics found AND SC comments found -> Marquee displays SC shoutouts (while Lyrics render in Vertigo-style hologram)
    // 2. If Lyrics found AND NO SC comments -> Marquee displays Lyrics
    // 3. If NO SC comments AND NO Lyrics found -> Marquee displays Track Title
    // 4. If SC comments found AND NO Lyrics found -> Marquee displays SC shoutouts
    if (hasScComments && hasTrackLyrics) {
      scrollerTextRef.current = activeCommentTag
        ? `   ${activeCommentTag.trim()}   ${shoutoutsSample ? `///   SHOUTOUTS: ${shoutoutsSample}   ` : ''}`
        : `   SHOUTOUTS: ${shoutoutsSample}   `;
    } else if (!hasScComments && hasTrackLyrics) {
      const lyricMarqueeBody = activeLyricLine
        ? nextLyricLine
          ? `♪ ${activeLyricLine.toUpperCase()} ♪   //   ♪ ${nextLyricLine.toUpperCase()} ♪`
          : `♪ ${activeLyricLine.toUpperCase()} ♪`
        : `♪ ${(lyricsMarqueeFallback || titleUpper).toUpperCase()} ♪`;
      scrollerTextRef.current = `   ${lyricMarqueeBody}   `;
    } else if (!hasScComments && !hasTrackLyrics) {
      scrollerTextRef.current = `   *** ${titleUpper} — ${artistUpper}${bpmTag}${chTag} ***   `;
    } else {
      scrollerTextRef.current = activeCommentTag
        ? `   ${activeCommentTag.trim()}   ${shoutoutsSample ? `///   SHOUTOUTS: ${shoutoutsSample}   ` : ''}`
        : `   SHOUTOUTS: ${shoutoutsSample}   ///   ${titleUpper} — ${artistUpper}   `;
    }
  }, [
    track,
    bpm,
    activeComment,
    comments,
    activeChapterLabel,
    activeLyricLine,
    nextLyricLine,
    hasLyrics,
    lyricsMarqueeFallback,
  ]);

  // Trigger bespoke Track Transition Choreography on URI change OR visualizer mode switch
  useEffect(() => {
    const uriChanged = Boolean(track?.uri && track.uri !== prevTrackUriRef.current);
    const modeChanged = mode !== prevModeRef.current && mode !== 'off';
    if (uriChanged) {
      const pool =
        enabledScenesRef.current.length > 0 ? enabledScenesRef.current : VISUALIZER_ENGINES;
      if (mode === 'shuffle' && pool.length > 1) {
        let nextIdx = Math.floor(Math.random() * pool.length);
        if (nextIdx === cycleIndexRef.current % pool.length) {
          nextIdx = (nextIdx + 1) % pool.length;
        }
        cycleIndexRef.current = nextIdx;
      } else {
        cycleIndexRef.current = (cycleIndexRef.current + 1) % pool.length;
      }
      // Clear any lingering glyph mutations from the previous track
      for (const p of mutationPatchesRef.current) {
        p.active = false;
      }
      prevLyricLineRef.current = null;
      vertigoLyricRevealRef.current = 0;
      trapperArenaRef.current.challengerBannerCount = 0;
    }
    if (uriChanged || modeChanged) {
      prevTrackUriRef.current = track?.uri;
      prevModeRef.current = mode;
      transitionImpulseRef.current = 1.0;
      lastRenderedModeRef.current = null;
      triggerGlitchBurst(0.95);
      spawnGlyphMutation(true, 3);
    }
  }, [track?.uri, mode]);

  // Sample Album Artwork into an UNSTRETCHED 128x128 Square Relief + Sobel Edge Map + 8-Color Palette
  useEffect(() => {
    const isSc = Boolean(track?.uri?.startsWith('soundcloud:'));
    const fallbackPal = isSc ? SOUNDCLOUD_PALETTE_RGB : DEFAULT_PALETTE_RGB;

    const buildSyntheticRelief = (seedStr: string) => {
      const luma = artSquareLumaRef.current;
      const edge = artSquareEdgeRef.current;
      let h = 2166136261;
      for (let i = 0; i < seedStr.length; i++) {
        h ^= seedStr.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const freqX = 2.0 + ((h >>> 0) % 5) * 0.6;
      const freqY = 2.0 + (((h >>> 8) & 0xff) % 5) * 0.6;
      for (let r = 0; r < ART_BUF_SIZE; r++) {
        const ny = (r + 0.5) / ART_BUF_SIZE - 0.5;
        for (let c = 0; c < ART_BUF_SIZE; c++) {
          const idx = r * ART_BUF_SIZE + c;
          const nx = (c + 0.5) / ART_BUF_SIZE - 0.5;
          const dist = Math.sqrt(nx * nx + ny * ny);
          const radial = Math.max(0, 1 - dist * 1.45);
          const pat =
            0.5 +
            0.25 * Math.cos(nx * freqX * Math.PI * 2) +
            0.25 * Math.sin(ny * freqY * Math.PI * 2);
          luma[idx] = Math.max(0.02, Math.min(1, radial * pat));
          edge[idx] = Math.abs(Math.sin(dist * 16)) * radial * 0.55;
        }
      }
      updatePaletteAbgr(fallbackPal);
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
        off.width = ART_BUF_SIZE;
        off.height = ART_BUF_SIZE;
        const octx = off.getContext('2d', { willReadFrequently: true });
        if (!octx) {
          buildSyntheticRelief(track?.uri || 'simp');
          return;
        }
        // Center-crop square without stretching aspect ratio
        const iw = img.naturalWidth || ART_BUF_SIZE;
        const ih = img.naturalHeight || ART_BUF_SIZE;
        const side = Math.min(iw, ih);
        const sx = Math.floor((iw - side) * 0.5);
        const sy = Math.floor((ih - side) * 0.5);
        octx.drawImage(img, sx, sy, side, side, 0, 0, ART_BUF_SIZE, ART_BUF_SIZE);
        const data = octx.getImageData(0, 0, ART_BUF_SIZE, ART_BUF_SIZE).data;

        const luma = artSquareLumaRef.current;
        const edge = artSquareEdgeRef.current;
        const colorSamples: { luma: number; sat: number; rgb: [number, number, number] }[] = [];

        for (let i = 0; i < ART_BUF_PIXELS; i++) {
          const p = i * 4;
          const r = data[p];
          const g = data[p + 1];
          const b = data[p + 2];
          const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          luma[i] = y;

          if (i % 32 === 0) {
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
            if (y > 0.12 && y < 0.94) {
              const boost = 1.28;
              const avg = (r + g + b) / 3;
              const br = Math.max(12, Math.min(255, Math.round(avg + (r - avg) * boost)));
              const bg = Math.max(12, Math.min(255, Math.round(avg + (g - avg) * boost)));
              const bb = Math.max(12, Math.min(255, Math.round(avg + (b - avg) * boost)));
              colorSamples.push({ luma: y, sat, rgb: [br, bg, bb] });
            }
          }
        }

        // Compute Sobel edge relief on the 128x128 unstretched square buffer
        for (let r = 0; r < ART_BUF_SIZE; r++) {
          for (let c = 0; c < ART_BUF_SIZE; c++) {
            const idx = r * ART_BUF_SIZE + c;
            if (r === 0 || r === ART_BUF_SIZE - 1 || c === 0 || c === ART_BUF_SIZE - 1) {
              edge[idx] = 0;
              continue;
            }
            const gx =
              -luma[(r - 1) * ART_BUF_SIZE + (c - 1)] +
              luma[(r - 1) * ART_BUF_SIZE + (c + 1)] -
              2 * luma[r * ART_BUF_SIZE + (c - 1)] +
              2 * luma[r * ART_BUF_SIZE + (c + 1)] -
              luma[(r + 1) * ART_BUF_SIZE + (c - 1)] +
              luma[(r + 1) * ART_BUF_SIZE + (c + 1)];
            const gy =
              -luma[(r - 1) * ART_BUF_SIZE + (c - 1)] -
              2 * luma[(r - 1) * ART_BUF_SIZE + c] -
              luma[(r - 1) * ART_BUF_SIZE + (c + 1)] +
              luma[(r + 1) * ART_BUF_SIZE + (c - 1)] +
              2 * luma[(r + 1) * ART_BUF_SIZE + c] +
              luma[(r + 1) * ART_BUF_SIZE + (c + 1)];
            edge[idx] = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 1.45);
          }
        }

        if (colorSamples.length >= 16) {
          colorSamples.sort((a, b) => a.luma + a.sat * 0.25 - (b.luma + b.sat * 0.25));
          // Slot 0 is strictly [0, 0, 0] for true OLED black
          const nextPal: [number, number, number][] = [[0, 0, 0]];
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
          updatePaletteAbgr(nextPal);
        } else {
          updatePaletteAbgr(fallbackPal);
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
    spawnGlyphMutation(false, 2);
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
          // Trigger Beat-Drop if we had buildup charge or strong onset spike
          if (dropCooldownRef.current <= 0 && (buildupChargeRef.current > 0.25 || frame.onset > 0.48)) {
            dropIntensityRef.current = 1.0;
            dropCooldownRef.current = 3.5;
            buildupChargeRef.current = 0;
            vertigoRollTargetRef.current += (Math.PI * 0.5) * ((glitchSeedRef.current & 1) === 0 ? 1 : -1);
            spawnGlyphMutation(true, 3);
          }
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

  // Main Hardware-Accelerated 30fps Canvas Loop (0 FPS complete freeze when paused, OLED Black Floor)
  useEffect(() => {
    if (mode === 'off' || hidden) {
      return;
    }

    // When playback is paused, freeze the animation completely at 0 FPS.
    // Only render a single static preview frame if the canvas hasn't rendered this mode yet.
    if (!isPlaying && lastRenderedModeRef.current === mode) {
      return;
    }

    let rafId = 0;
    let frameCount = 0;
    let lastFramePerf = performance.now();
    const glyphBitmaps = getGlyphBitmaps();

    const renderFrame = (nowPerf: number) => {
      const playing = isPlayingRef.current;
      if (playing) {
        rafId = requestAnimationFrame(renderFrame);
      }

      if (document.visibilityState === 'hidden' || hiddenRef.current || modeRef.current === 'off') {
        return;
      }

      // Frame rate governor:
      // - 30 FPS (32ms budget) when actively playing
      // - 0 FPS when paused (at most 1 static preview frame if mode changed while paused)
      if (playing) {
        const elapsedMs = nowPerf - lastFramePerf;
        if (elapsedMs < 32.0) {
          return;
        }
        frameCount++;
        const dt = Math.min(0.08, Math.max(0.008, elapsedMs * 0.001));
        lastFramePerf = nowPerf;
        simTimeSecRef.current += dt;
      } else {
        lastFramePerf = nowPerf;
      }

      const dt = playing ? 0.033 : 0;
      const timeSec = simTimeSecRef.current;
      lastRenderedModeRef.current = modeRef.current;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;

      // 1. Update or synthesize 16-band audio spectrum (fallback when Widevine browser worker is active)
      const tb = targetBandsRef.current;
      const sb = smoothBandsRef.current;
      const timeSinceRealSpectrum = nowPerf - lastSpectrumTickPerfRef.current;

      if (!playing) {
        // Freeze existing spectrum bands in place when paused (or seed gentle static values on initial load)
        let hasAnyBand = false;
        for (let b = 0; b < 16; b++) {
          if (sb[b] > 0.01) {
            hasAnyBand = true;
            break;
          }
        }
        if (!hasAnyBand) {
          for (let b = 0; b < 16; b++) {
            tb[b] = 0.12 + 0.06 * SIN_F32[(b * 16) & 255];
            sb[b] = tb[b];
          }
        }
      } else if (timeSinceRealSpectrum > 260) {
        const wf = waveformBarsRef.current;
        const wfIdx =
          wf && wf.length > 0
            ? Math.min(wf.length - 1, Math.floor(playheadRatioRef.current * wf.length))
            : -1;
        const envAmp = wfIdx >= 0 && wf ? wf[wfIdx] : 0.48;
        const prevWfAmp = wfIdx > 2 && wf ? wf[wfIdx - 2] : envAmp;
        const beatHz = (bpmRef.current || 120) / 60;
        const beatPhase = (timeSec * beatHz) % 1;
        const synthKick = Math.pow(Math.max(0, 1 - beatPhase * 3.2), 2.2) * envAmp;
        if (beatPhase < 0.08 && beatPulseRef.current < 0.35) {
          beatPulseRef.current = 0.72 * envAmp;
          if (envAmp > 0.52) {
            triggerGlitchBurst(envAmp * 0.75);
          }
          // Detect waveform beat-drop jump
          if (dropCooldownRef.current <= 0 && envAmp - prevWfAmp > 0.22 && envAmp > 0.62) {
            dropIntensityRef.current = 1.0;
            dropCooldownRef.current = 3.5;
            buildupChargeRef.current = 0;
            vertigoRollTargetRef.current += (Math.PI * 0.5) * ((frameCount & 1) === 0 ? 1 : -1);
            spawnGlyphMutation(true, 3);
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
        const next = target > cur ? cur + (target - cur) * 0.48 : cur + (target - cur) * 0.15;
        sb[i] = next;
        if (i < 4) subBass += next;
        else if (i < 10) midEnergy += next;
        else highEnergy += next;
      }
      subBass *= 0.25;
      midEnergy /= 6;
      highEnergy /= 6;

      // Update Beat-Drop & Breakdown/Build-Up Detector
      const instantEnergy = subBass * 0.55 + midEnergy * 0.30 + highEnergy * 0.15;
      shortEnergyRef.current += (instantEnergy - shortEnergyRef.current) * Math.min(1, dt * 3.2);
      longEnergyRef.current += (instantEnergy - longEnergyRef.current) * Math.min(1, dt * 0.35);
      if (dropCooldownRef.current > 0) {
        dropCooldownRef.current = Math.max(0, dropCooldownRef.current - dt);
      }
      if (dropIntensityRef.current > 0) {
        dropIntensityRef.current = Math.max(0, dropIntensityRef.current - dt * 0.32);
      }

      // Breakdown / Build-up charge accumulation when bass drops out or high-frequency risers climb
      const isBreakdownOrRiser =
        shortEnergyRef.current < longEnergyRef.current * 0.78 ||
        (highEnergy > subBass * 1.05 && highEnergy > 0.28);
      if (isBreakdownOrRiser && dropIntensityRef.current < 0.2) {
        buildupChargeRef.current = Math.min(1, buildupChargeRef.current + dt * 0.35);
      } else {
        buildupChargeRef.current = Math.max(0, buildupChargeRef.current - dt * 0.15);
      }

      // Trigger Beat-Drop when sub-bass slams back in after a build-up/breakdown
      if (
        dropCooldownRef.current <= 0 &&
        buildupChargeRef.current > 0.28 &&
        subBass > 0.46 &&
        shortEnergyRef.current > longEnergyRef.current * 1.16
      ) {
        dropIntensityRef.current = 1.0;
        dropCooldownRef.current = 3.8;
        buildupChargeRef.current = 0;
        vertigoRollTargetRef.current += (Math.PI * 0.5) * ((frameCount & 1) === 0 ? 1 : -1);
        triggerGlitchBurst(0.85);
        spawnGlyphMutation(true, 3);
      }

      // Periodic organic mutation & micro-glitch
      if (highEnergy > 0.56 && glitchTimerRef.current <= 0.05 && (frameCount & 7) === 0) {
        triggerGlitchBurst(0.48);
      } else if ((frameCount & 63) === 0 && isPlayingRef.current) {
        spawnGlyphMutation(Boolean(activeLyricRef.current));
      }

      // Music-coupled phase accumulator
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
        transitionImpulseRef.current = Math.max(0, transitionImpulseRef.current - dt * 0.80);
      }
      if (avatarBlendRef.current > 0 && !activeComment) {
        avatarBlendRef.current = Math.max(0, avatarBlendRef.current - dt * 0.5);
      }

      const beat = beatPulseRef.current;
      const glitch = glitchTimerRef.current;
      const trans = transitionImpulseRef.current;
      const drop = dropIntensityRef.current;
      const buildup = buildupChargeRef.current;
      const palette = paletteRef.current;
      const palAbgr = paletteAbgrRef.current;
      const pool =
        enabledScenesRef.current.length > 0 ? enabledScenesRef.current : VISUALIZER_ENGINES;
      const activeMode: VisualizerEngine = preferredSceneRef.current
        ? preferredSceneRef.current
        : modeRef.current === 'cycle' || modeRef.current === 'shuffle'
          ? pool[cycleIndexRef.current % pool.length]
          : (modeRef.current as VisualizerEngine);

      if (lastReportedEngineRef.current !== activeMode) {
        lastReportedEngineRef.current = activeMode;
        if (onActiveEngineChangeRef.current) {
          onActiveEngineChangeRef.current(activeMode);
        }
      }

      // Exact viewport crop calculation for `objectFit: 'cover'` on ultra-wide displays (21:9, 32:9, etc.)
      const clientW = canvas.clientWidth || CANVAS_W;
      const clientH = canvas.clientHeight || CANVAS_H;
      const visibleCanvasH =
        clientW > 0 && clientH > 0
          ? Math.min(CANVAS_H, CANVAS_W * (clientH / clientW))
          : CANVAS_H;
      const cropTopY = Math.max(0, (CANVAS_H - visibleCanvasH) * 0.5);
      const cropBottomY = CANVAS_H - cropTopY;

      // Shared Vertigo-Style Floating 3D Hologram Lyric Banner
      // Used by VERTIGO (for lyrics/comments) and by DEMOSCENE & TRAPPER when BOTH Lyrics and SC Comments exist
      const drawVertigoStyleHologram = (
        rawText: string,
        targetAnchorX = 0,
        targetAnchorY = 0
      ) => {
        const trimmed = rawText.trim();
        if (trimmed.length === 0) return;

        vertigoLyricRevealRef.current = Math.min(1, vertigoLyricRevealRef.current + dt * 3.6);
        const reveal = vertigoLyricRevealRef.current;

        vertigoSmoothSpineXRef.current +=
          (targetAnchorX - vertigoSmoothSpineXRef.current) * Math.min(1, dt * 5.0);
        vertigoSmoothSpineYRef.current +=
          (targetAnchorY - vertigoSmoothSpineYRef.current) * Math.min(1, dt * 5.0);

        const upperText = trimmed.toUpperCase();
        // Word-wrap long lyric lines into 1 or 2 balanced lines so ZERO characters are ever cut off!
        const lines: string[] = [];
        if (upperText.length <= 36) {
          lines.push(upperText);
        } else {
          const mid = Math.floor(upperText.length * 0.5);
          let splitAt = upperText.lastIndexOf(' ', mid + 8);
          if (splitAt <= 6) splitAt = upperText.indexOf(' ', mid);
          if (splitAt > 0) {
            lines.push(upperText.slice(0, splitAt).trim());
            lines.push(upperText.slice(splitAt + 1).trim());
          } else {
            lines.push(upperText);
          }
        }

        const maxLineChars = Math.max(...lines.map((l) => l.length), 1);
        const maxFontPx = lines.length > 1 ? 14 : 16;
        // Dynamically size font so the full line always fits inside 82% of canvas width
        const fontPx = Math.max(
          11,
          Math.min(maxFontPx, Math.floor((CANVAS_W * 0.82) / (maxLineChars * 0.62)))
        );
        const lineH = fontPx + 4;
        const boxW = Math.min(
          CANVAS_W - 28,
          Math.round(maxLineChars * fontPx * 0.62 + 26)
        );
        const boxH = lines.length * lineH + 10;

        const holoX =
          CANVAS_W * 0.5 +
          vertigoSmoothSpineXRef.current +
          Math.sin(timeSec * 1.1) * 7;
        // Dynamically offset below `cropTopY` so 2-line lyrics are never cropped on ultra-wide (21:9 / 32:9) displays
        const safeTopY = Math.max(28, cropTopY + 18);
        const minCenterY = safeTopY + boxH * 0.5;
        const rawHoloY =
          minCenterY +
          6 +
          vertigoSmoothSpineYRef.current +
          Math.cos(timeSec * 1.25) * 2.5 -
          (1 - reveal) * 5;
        const maxCenterY = Math.max(minCenterY, minCenterY + 22);
        const holoY = Math.max(minCenterY, Math.min(maxCenterY, rawHoloY));

        ctx.save();
        ctx.translate(holoX, holoY);
        // Gentle, readable perspective float (never full camRoll spin!)
        ctx.rotate(Math.sin(timeSec * 0.9) * 0.025);

        // Translucent borderless backing pill (no hard border lines)
        ctx.fillStyle = `rgba(6, 7, 12, ${(0.72 * reveal).toFixed(2)})`;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(-boxW * 0.5, -boxH * 0.5, boxW, boxH, 10);
        } else {
          ctx.rect(-boxW * 0.5, -boxH * 0.5, boxW, boxH);
        }
        ctx.fill();

        ctx.font = `bold ${fontPx}px "JetBrains Mono", "Fira Code", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (let li = 0; li < lines.length; li++) {
          const ly = (li - (lines.length - 1) * 0.5) * lineH;
          // Subtle cyan/palette drop-shadow for crisp legibility over bright visualizer elements
          ctx.fillStyle = rgbToCss(palette[4], 0.85 * reveal);
          ctx.fillText(lines[li], 1.5, ly + 1.5);
          ctx.fillStyle = rgbToCss(palette[7], 0.96 * reveal);
          ctx.fillText(lines[li], 0, ly);
        }
        ctx.restore();
      };

      // =======================================================================
      // MODE 1: GLYPH MATRIX (Single-Shot Uint32Array + Unstretched Panning Art
      //         + Unstable Multi-Scale 2x2 / 3x3 Font & Lyric Mutations)
      // =======================================================================
      if (activeMode === 'glyph') {
        if (!imageDataRef.current) {
          imageDataRef.current = ctx.createImageData(CANVAS_W, CANVAS_H);
          u32FrameRef.current = new Uint32Array(imageDataRef.current.data.buffer);
        }
        const imgData = imageDataRef.current;
        const u32 = u32FrameRef.current!;
        // Fill entire 640x360 canvas with TRUE OLED BLACK (#000000 -> 0xFF000000)
        u32.fill(0xff000000);

        const artSqLuma = artSquareLumaRef.current;
        const artSqEdge = artSquareEdgeRef.current;
        const avLuma = avatarLumaGridRef.current;
        const avWeight = avatarBlendRef.current;
        const rowTearPx = rowTearPxRef.current;
        const rowCorrupt = rowCorruptMaskRef.current;
        const gSeed = glitchSeedRef.current;
        const skipMask = cellSkipMaskRef.current;
        skipMask.fill(0);

        // Slow, hypnotic unstretched artwork panning (80x45 window gliding over 128x128 square art)
        // Never hits a hard corner bounce; drifts organically along a slow Lissajous path
        const maxPanX = ART_BUF_SIZE - GRID_COLS; // 48
        const maxPanY = ART_BUF_SIZE - GRID_ROWS; // 83
        const panX = Math.round(maxPanX * (0.5 + 0.46 * Math.sin(timeSec * 0.085)));
        const panY = Math.round(maxPanY * (0.5 + 0.46 * Math.cos(timeSec * 0.062)));

        // Step & render unstable multi-scale (2x2 and 3x3) font/lyric mutation patches first
        const patches = mutationPatchesRef.current;
        for (let pIdx = 0; pIdx < patches.length; pIdx++) {
          const patch = patches[pIdx];
          if (!patch.active) continue;
          patch.ttl -= dt;
          if (patch.ttl <= 0) {
            patch.active = false;
            continue;
          }
          // Unstable adaptation: jitter character or scale slightly near expiration or on beat spikes
          const scale = patch.scale;
          const charPixels = scale * 8;
          const colorAbgr = palAbgr[Math.min(7, patch.palIdx)];
          const len = patch.text.length;

          for (let cIdx = 0; cIdx < len; cIdx++) {
            const cellCol = patch.vertical ? patch.col : patch.col + cIdx * scale;
            const cellRow = patch.vertical ? patch.row + cIdx * scale : patch.row;
            if (cellCol + scale >= GRID_COLS || cellRow + scale >= GRID_ROWS) break;

            // Mark covered 1x1 cells so background matrix doesn't overwrite the macro-glyph
            for (let sr = 0; sr < scale; sr++) {
              const rOff = (cellRow + sr) * GRID_COLS;
              for (let sc = 0; sc < scale; sc++) {
                skipMask[rOff + cellCol + sc] = 1;
              }
            }

            let code = patch.text.charCodeAt(cIdx);
            if (glitch > 0.3 && ((cIdx + frameCount) & 3) === 0) {
              code = 35 + ((cIdx * 13 + frameCount) & 31);
            }
            if (code < ASCII_MIN || code > ASCII_MAX) continue;
            const lutIdx = NUM_GLYPHS + (code - ASCII_MIN);
            const bmpBase = lutIdx * 64;
            const screenX = cellCol * 8 + (glitch > 0.1 ? rowTearPx[cellRow] : 0);
            const screenY = cellRow * 8;

            for (let gy = 0; gy < 8; gy++) {
              for (let gx = 0; gx < 8; gx++) {
                if (glyphBitmaps[bmpBase + gy * 8 + gx] === 0) continue;
                for (let sy = 0; sy < scale; sy++) {
                  const py = screenY + gy * scale + sy;
                  if (py < 0 || py >= CANVAS_H) continue;
                  const rowBase = py * CANVAS_W;
                  for (let sx = 0; sx < scale; sx++) {
                    const px = (screenX + gx * scale + sx + CANVAS_W) % CANVAS_W;
                    u32[rowBase + px] = colorAbgr;
                  }
                }
              }
            }
            // Subtle unstable outline frame on 3x3 mutations
            if (scale === 3 && cIdx === 0 && patch.ttl > patch.maxTtl * 0.7) {
              const topY = Math.max(0, screenY - 1);
              const botY = Math.min(CANVAS_H - 1, screenY + charPixels);
              for (let x = 0; x < charPixels * len; x++) {
                const px = (screenX + x + CANVAS_W) % CANVAS_W;
                u32[topY * CANVAS_W + px] = palAbgr[4];
                u32[botY * CANVAS_W + px] = palAbgr[4];
              }
            }
          }
        }

        // Slower, hypnotic plasma attractors
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
        const scrollColShift = Math.floor(timeSec * 4.5);

        for (let i = 0; i < GRID_CELLS; i++) {
          if (skipMask[i] === 1) continue;

          const row = CELL_ROW[i];
          const col = CELL_COL[i];
          const nx = CELL_NORM_X[i];
          const ny = CELL_NORM_Y[i];
          const rDist = CELL_RADIAL_DIST[i];
          const rAng = CELL_RADIAL_ANGLE[i];

          const bandIdx = ((rAng >>> 4) + (col >>> 1)) & 15;
          const bandVal = sb[bandIdx];

          // 1. Sample from unstretched 128x128 square artwork at slow pan offset (panX, panY)
          const artIdx = (row + panY) * ART_BUF_SIZE + (col + panX);
          const baseArt = artSqLuma[artIdx] * (1 - avWeight) + avLuma[i] * avWeight;
          const artEdgeVal = artSqEdge[artIdx];
          const relief = baseArt * 0.38 + artEdgeVal * (0.50 + midEnergy * 0.42 + drop * 0.25);

          // 2. Dual-center LUT Moiré plasma + music-coupled radial wave
          const d1 = Math.sqrt((nx - cx1) * (nx - cx1) + (ny - cy1) * (ny - cy1));
          const d2 = Math.sqrt((nx - cx2) * (nx - cx2) + (ny - cy2) * (ny - cy2));
          const lut1 = SIN_U8[(Math.floor(d1 * 240) - ripplePhase) & 255];
          const lut2 = SIN_U8[(Math.floor(d2 * 190) + (ripplePhase >>> 1)) & 255];
          const plasma = ((lut1 + lut2) * 0.00196) * (0.16 + subBass * 0.40 + beat * 0.25);

          // 3. Combine with 4x4 Bayer Ordered Dither and shape contrast curve for true OLED negative space
          const rawEnergy =
            relief +
            plasma +
            bandVal * 0.22 +
            (1 - Math.min(1, rDist * 1.45)) * (beat * 0.22 + drop * 0.20) +
            CELL_BAYER[i] -
            0.12;

          const clamped = Math.pow(Math.max(0, Math.min(0.999, rawEnergy)), 1.45);
          let glyphIdx = Math.floor(clamped * NUM_GLYPHS);
          const isCorruptRow = rowCorrupt[row] === 1 && glitch > 0.12;

          if (glyphIdx <= 0 && !isCorruptRow) continue;

          // Palette index with beat-onset cycling
          const basePal = Math.min(NUM_PALETTE - 1, Math.max(1, Math.floor(clamped * NUM_PALETTE)));
          let palIdx =
            basePal >= 2 ? 2 + ((basePal - 2 + (beat > 0.38 || drop > 0.4 ? palCycle : 0)) % 6) : basePal;

          const isTextRow = row === 8 || row === 22 || row === 36;
          let lutGlyphIdx = glyphIdx;

          if (isTextRow && glyphIdx >= 4 && stripLen > 0) {
            const rowShift = row * 11;
            const rawCode = strip.charCodeAt((col + scrollColShift + rowShift) % stripLen);
            const code =
              glitch > 0.25 && ((col + gSeed) & 3) === 0
                ? 33 + ((col * 17 + gSeed) & 31)
                : rawCode;
            if (code >= ASCII_MIN && code <= ASCII_MAX) {
              lutGlyphIdx = NUM_GLYPHS + (code - ASCII_MIN);
              palIdx = clamped > 0.65 || beat > 0.4 ? 7 : 5;
            }
          } else if (isCorruptRow && ((col + (gSeed >>> 3)) & 3) === 0) {
            lutGlyphIdx = 7 + ((i ^ gSeed) & 8);
            palIdx = 6 + (col & 1);
          }

          const zLift = (clamped - 0.35) * (6 + subBass * 11 + beat * 8);
          const tearOffset = glitch > 0.05 ? Math.round(rowTearPx[row] * glitch) : 0;
          let dx = CELL_X[i] + nx * zLift + tearOffset;
          let dy = CELL_Y[i] + ny * zLift;

          if (trans > 0.005) {
            const p = 1 - trans;
            const colSpeed = 1 + ((col * 37 + 13) & 7) * 0.28;
            if (trans > 0.45) {
              const swirl = Math.sin(((trans - 0.45) / 0.55) * Math.PI);
              const curlAngle = rAng * 0.0245 + trans * 7.5;
              dx += (nx * 140 + Math.cos(curlAngle) * 64) * swirl;
              dy += ((ny * 90 + Math.sin(curlAngle) * 48) * swirl + p * colSpeed * 180) % CANVAS_H;
            } else {
              const snapEase = trans / 0.45;
              const shockRadius = (1 - snapEase) * 0.95;
              if (Math.abs(rDist - shockRadius) < 0.09) {
                palIdx = 7;
                lutGlyphIdx = Math.min(NUM_GLYPHS - 1, glyphIdx + 5);
              }
              dy -= snapEase * snapEase * colSpeed * 75;
            }
          }

          const rx = (Math.round(dx) + CANVAS_W) % CANVAS_W;
          const ry = (Math.round(dy) + CANVAS_H) % CANVAS_H;
          const colorAbgr = palAbgr[palIdx];
          const bmpOffset = lutGlyphIdx * 64;

          for (let gy = 0; gy < 8; gy++) {
            const py = ry + gy;
            if (py >= CANVAS_H) continue;
            const rowBase = py * CANVAS_W;
            const bmpRow = bmpOffset + gy * 8;
            for (let gx = 0; gx < 8; gx++) {
              if (glyphBitmaps[bmpRow + gx] === 1) {
                const px = rx + gx;
                if (px < CANVAS_W) {
                  u32[rowBase + px] = colorAbgr;
                }
              }
            }
          }
        }

        // Single-shot flush of all 3,600 cells + multi-scale mutations!
        ctx.putImageData(imgData, 0, 0);
      }

      // =======================================================================
      // MODE 2: WINAMP AVS (True OLED Black Floor Tunnel + Rez Wireframe + Lyrics)
      // =======================================================================
      else if (activeMode === 'avs') {
        if (!feedbackCanvasRef.current) {
          feedbackCanvasRef.current = document.createElement('canvas');
          feedbackCanvasRef.current.width = CANVAS_W;
          feedbackCanvasRef.current.height = CANVAS_H;
        }
        const fb = feedbackCanvasRef.current;
        const fbCtx = fb.getContext('2d');

        // Pure #000000 OLED floor clear
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        let zoom = 1.016 + subBass * 0.030 + beat * 0.024 + drop * 0.035;
        let rot = SIN_F32[Math.floor(timeSec * 19) & 255] * (0.012 + midEnergy * 0.018);

        if (trans > 0.55) {
          const imp = (trans - 0.55) / 0.45;
          zoom = 0.91 - imp * 0.05;
          rot += imp * 0.16;
        } else if (trans > 0.005) {
          const burst = trans / 0.55;
          zoom = 1.02 + burst * 0.085;
          rot -= burst * 0.09;
        }

        ctx.save();
        ctx.translate(CANVAS_W * 0.5, CANVAS_H * 0.5);
        ctx.rotate(rot);
        ctx.scale(zoom, zoom);
        ctx.globalAlpha = 0.84;
        ctx.drawImage(fb, -CANVAS_W * 0.5, -CANVAS_H * 0.5, CANVAS_W, CANVAS_H);
        ctx.restore();
        ctx.globalAlpha = 1.0;

        // Black-floor crush pass so old trails snap cleanly to pure #000000
        ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        // Rez / Vectrex Beat-Locked Concentric Wireframe Polygons
        const cx = CANVAS_W * 0.5;
        const cy = CANVAS_H * 0.5;
        const sides = drop > 0.3 ? 6 : 8;
        const baseRadius = 38 + subBass * 65 + beat * 35 + drop * 28;

        for (let ring = 0; ring < 3; ring++) {
          const r = baseRadius * (0.55 + ring * 0.45);
          const palColor = palette[Math.min(7, 3 + ring * 2)];
          ctx.strokeStyle = rgbToCss(palColor, 0.62 - ring * 0.12);
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

        // Classic Winamp Dual-Trace Oscilloscope Ribbon
        const scopePal = palette[6] || [56, 189, 248];
        ctx.strokeStyle = rgbToCss(scopePal, 0.88);
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

        // Stable Synced Lyric Rendering for AVS:
        // 1. Subtle low-alpha echo stamp at a steady Y position BEFORE feedback capture so the tunnel trails softly without strobing
        // 2. Crisp, steady foreground lyric banner drawn AFTER feedback capture so it never flickers between beats or jitters with subBass
        const lyricText = (activeLyricRef.current || '').trim();
        let avsLines: string[] = [];
        let avsFontPx = 15;
        let avsLineH = 19;
        let avsBoxW = 0;
        let avsBoxH = 0;
        let avsLyricY = 0;

        if (lyricText.length > 0) {
          vertigoLyricRevealRef.current = Math.min(1, vertigoLyricRevealRef.current + dt * 3.6);
          const upperLyric = lyricText.toUpperCase();
          if (upperLyric.length <= 36) {
            avsLines.push(upperLyric);
          } else {
            const mid = Math.floor(upperLyric.length * 0.5);
            let splitAt = upperLyric.lastIndexOf(' ', mid + 8);
            if (splitAt <= 6) splitAt = upperLyric.indexOf(' ', mid);
            if (splitAt > 0) {
              avsLines.push(upperLyric.slice(0, splitAt).trim());
              avsLines.push(upperLyric.slice(splitAt + 1).trim());
            } else {
              avsLines.push(upperLyric);
            }
          }
          const maxLineChars = Math.max(...avsLines.map((l) => l.length), 1);
          const maxFontPx = avsLines.length > 1 ? 14 : 16;
          avsFontPx = Math.max(
            11,
            Math.min(maxFontPx, Math.floor((CANVAS_W * 0.82) / (maxLineChars * 0.62)))
          );
          avsLineH = avsFontPx + 4;
          avsBoxW = Math.min(CANVAS_W - 28, Math.round(maxLineChars * avsFontPx * 0.62 + 26));
          avsBoxH = avsLines.length * avsLineH + 10;

          const safeTopY = Math.max(28, cropTopY + 18);
          const minCenterY = safeTopY + avsBoxH * 0.5;
          avsLyricY = Math.max(
            minCenterY,
            Math.min(cy - 64, minCenterY + 10) + Math.cos(timeSec * 1.1) * 2.0
          );

          // Soft tunnel-echo stamp into feedback buffer (steady position, gentle alpha)
          ctx.font = `bold ${avsFontPx}px "JetBrains Mono", "Fira Code", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = rgbToCss(palette[5], 0.16 + beat * 0.14);
          for (let li = 0; li < avsLines.length; li++) {
            const ly = avsLyricY + (li - (avsLines.length - 1) * 0.5) * avsLineH;
            ctx.fillText(avsLines[li], cx, ly);
          }
        }

        if (fbCtx) {
          fbCtx.fillStyle = '#000000';
          fbCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
          fbCtx.drawImage(canvas, 0, 0);
        }

        // Crisp, flicker-free foreground AVS lyric overlay (drawn after feedback capture)
        if (avsLines.length > 0) {
          const reveal = vertigoLyricRevealRef.current;
          ctx.save();
          ctx.translate(cx + Math.sin(timeSec * 0.95) * 4, avsLyricY);
          ctx.fillStyle = `rgba(6, 7, 12, ${(0.68 * reveal).toFixed(2)})`;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(-avsBoxW * 0.5, -avsBoxH * 0.5, avsBoxW, avsBoxH, 10);
          } else {
            ctx.rect(-avsBoxW * 0.5, -avsBoxH * 0.5, avsBoxW, avsBoxH);
          }
          ctx.fill();

          ctx.font = `bold ${avsFontPx}px "JetBrains Mono", "Fira Code", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (let li = 0; li < avsLines.length; li++) {
            const ly = (li - (avsLines.length - 1) * 0.5) * avsLineH;
            ctx.fillStyle = rgbToCss(palette[4], 0.85 * reveal);
            ctx.fillText(avsLines[li], 1.5, ly + 1.5);
            ctx.fillStyle = rgbToCss(palette[7], (0.92 + beat * 0.08) * reveal);
            ctx.fillText(avsLines[li], 0, ly);
          }
          ctx.restore();
        }
      }

      // =======================================================================
      // MODE 3: DEMOSCENE 64K (Amiga Copper Bars + 3D Synth Grid + DYCP Scroller)
      // =======================================================================
      else if (activeMode === 'demoscene') {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        const transWave = trans > 0.005 ? Math.sin(trans * Math.PI) : 0;
        const horizonY = Math.round(
          CANVAS_H * 0.46 + (trans > 0.005 ? Math.sin(trans * Math.PI * 2) * 28 * transWave : 0)
        );

        // 1. 3D Warp Starfield over pure #000000 sky
        const sx = starXRef.current;
        const sy = starYRef.current;
        const sz = starZRef.current;
        const warpSpeed = dt * (0.45 + subBass * 1.6 + drop * 2.2 + transWave * 5.2);
        ctx.fillStyle = rgbToCss(palette[7], 0.82);
        ctx.strokeStyle = rgbToCss(palette[6], 0.78);
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
            if (transWave > 0.15 || drop > 0.35) {
              const tailZ = Math.min(2.2, prevZ + (transWave + drop * 0.5) * 0.35);
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

        // 2. Amiga-style Horizontal Copper Raster Spectrum Bars
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
          ctx.fillStyle = rgbToCss(palC, 0.32 + bandAmp * 0.45 + transWave * 0.22);
          ctx.fillRect(barX, Math.round(yBase), barW, barH);
        }

        // 3. 3D Perspective Scrolling Vector Synth Grid
        const gridPal = palette[4] || [42, 163, 196];
        ctx.save();
        if (transWave > 0.01 || drop > 0.1) {
          const bankAngle = Math.sin((trans + drop * 0.3) * Math.PI * 2) * 0.14 * (transWave + drop * 0.4);
          ctx.translate(CANVAS_W * 0.5, horizonY);
          ctx.rotate(bankAngle);
          ctx.translate(-CANVAS_W * 0.5, -horizonY);
        }
        ctx.strokeStyle = rgbToCss(gridPal, 0.40 + subBass * 0.32 + transWave * 0.25);
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

        // 4. 16-Band Spectrum Pillars on the Horizon
        const pillarZoneW = CANVAS_W * 0.64;
        const pillarStartX = (CANVAS_W - pillarZoneW) * 0.5;
        const pillarStep = pillarZoneW / 16;
        for (let b = 0; b < 16; b++) {
          const h = Math.round(sb[b] * 68 + beat * 14 + transWave * 28);
          if (h <= 1) continue;
          const px = Math.round(pillarStartX + b * pillarStep);
          const pw = Math.max(4, Math.round(pillarStep - 4));
          ctx.fillStyle = rgbToCss(palette[Math.min(7, 3 + (b >>> 2))], 0.72);
          ctx.fillRect(px, horizonY - h, pw, h);
        }
        ctx.restore();

        // 5. Classic DYCP Sine-Wave Scroller (with live synced lyrics!)
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
          const baseScrollerY = Math.min(CANVAS_H - 48, cropBottomY - 36);
          for (let c = 0; c < visibleChars; c++) {
            const ch = scroller[(firstCharIdx + c) % scroller.length];
            if (ch === ' ') continue;
            const x = c * charW - pixelRem;
            const sineIdx = (Math.floor(timeSec * 85) + (firstCharIdx + c) * 11) & 255;
            const y = baseScrollerY + SIN_F32[sineIdx] * bounceAmp;
            const cPal = palette[4 + ((firstCharIdx + c) & 3)];
            ctx.fillStyle = rgbToCss(cPal, 0.92);
            ctx.fillText(ch, Math.round(x), Math.round(y));
          }
        }

        // 6. Vertigo-Style Floating 3D Hologram Lyrics when BOTH Lyrics AND SC Comments are present
        if (hasScCommentsRef.current && hasLyricsRef.current) {
          const demoLyricText = (activeLyricRef.current || '').trim();
          if (demoLyricText.length > 0) {
            drawVertigoStyleHologram(
              demoLyricText,
              SIN_F32[Math.floor(timeSec * 22) & 255] * 8,
              0
            );
          }
        }
      }

      // =======================================================================
      // MODE 4: VERTIGO CORRIDOR (Descent / Win95 3D Maze / Thumper / Ladytron "Runaway")
      // =======================================================================
      else if (activeMode === 'vertigo') {
        // Pure #000000 OLED abyss
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        const transWave = trans > 0.005 ? Math.sin(trans * Math.PI) : 0;
        const transCorkscrew =
          trans > 0.45
            ? Math.sin(((trans - 0.45) / 0.55) * Math.PI) * Math.PI * 0.95
            : 0;
        const transShockZ =
          trans > 0.005 && trans <= 0.45 ? (1 - trans / 0.45) * 3.4 : -1;

        // Advance corridor travel speed: glides smoothly during breakdowns ("Runaway"),
        // surges into hyper-velocity on the Beat Drop or Track Transition ("Thumper" / "Descent")
        const speed =
          0.90 + subBass * 1.9 + drop * 2.8 + transWave * 3.4 - buildup * 0.30;
        vertigoTravelZRef.current += dt * speed;
        const travelZ = vertigoTravelZRef.current;

        // Forward-chasing tunnel pulse wave (moves strictly forward into the tunnel!)
        vertigoPulseZRef.current += dt * (4.8 + subBass * 3.8 + drop * 4.5 + transWave * 6.0);
        const pulseZ = vertigoPulseZRef.current;

        // Smoothly bank camera roll toward 90-degree corner turns on beat drops ("Maze 3D" / "Descent")
        vertigoRollCurrentRef.current +=
          (vertigoRollTargetRef.current - vertigoRollCurrentRef.current) * Math.min(1, dt * 4.5);
        const camRoll =
          vertigoRollCurrentRef.current +
          transCorkscrew +
          Math.sin(timeSec * 0.85) * (0.14 + subBass * 0.16) +
          (drop > 0.1 ? Math.sin(timeSec * 6.5) * drop * 0.22 : 0);
        const cosR = Math.cos(camRoll);
        const sinR = Math.sin(camRoll);

        const numRings = 20;
        const maxDepth = 3.4;
        const stepZ = maxDepth / numRings;
        const fracZ = travelZ % stepZ;
        const isMonochromeStrobe = buildup > 0.25 && drop < 0.15;

        // Precompute projected ring centers and vertices (Octagonal Descent corridor)
        const ringCx = new Float32Array(numRings);
        const ringCy = new Float32Array(numRings);
        const ringScale = new Float32Array(numRings);
        const ringZArr = new Float32Array(numRings);

        const fov = 268 + drop * 72 + transWave * 65 - buildup * 26;
        for (let r = 0; r < numRings; r++) {
          const z = Math.max(0.11, maxDepth - r * stepZ - fracZ);
          ringZArr[r] = z;
          const worldZ = travelZ + z;
          // Winding subterranean corridor spine
          const spineX =
            Math.sin(worldZ * 1.12) * (0.40 + drop * 0.24 + transWave * 0.30) +
            Math.cos(worldZ * 0.52) * 0.20;
          const spineY =
            Math.cos(worldZ * 0.92) * 0.26 +
            Math.sin(worldZ * 1.55) * (0.12 + subBass * 0.14);

          const irisPinch =
            trans > 0.45
              ? Math.max(0.35, 1 - Math.sin(((trans - 0.45) / 0.55) * Math.PI) * 0.42 * (z / maxDepth))
              : 1.0;
          const invZ = (fov / z) * irisPinch;
          ringCx[r] = CANVAS_W * 0.5 + (spineX * cosR - spineY * sinR) * invZ;
          ringCy[r] = CANVAS_H * 0.5 + (spineX * sinR + spineY * cosR) * invZ;
          ringScale[r] = invZ;
        }

        // 8 primary octagonal vertices + 8 mid-face structural ribs (16 rails total)
        const corners: [number, number][] = [
          [-1.0, -0.68],
          [-0.44, -0.90],
          [0.44, -0.90],
          [1.0, -0.68],
          [1.0, 0.68],
          [0.44, 0.90],
          [-0.44, 0.90],
          [-1.0, 0.68],
        ];

        for (let r = 0; r < numRings - 1; r++) {
          const z0 = ringZArr[r];
          const z1 = ringZArr[r + 1];
          const s0 = ringScale[r];
          const s1 = ringScale[r + 1];
          const cx0 = ringCx[r];
          const cy0 = ringCy[r];
          const cx1 = ringCx[r + 1];
          const cy1 = ringCy[r + 1];

          const worldRingIdx = Math.floor((travelZ + z0) / stepZ);
          const bandAmp = sb[Math.abs(worldRingIdx) & 15];
          const depthFade = Math.pow(Math.max(0, Math.min(1, 1 - z0 / maxDepth)), 0.72);

          // Forward-travelling tunnel chaser light wave (races from foreground z=0.1 deep into z=maxDepth!)
          const wavePhase = z0 * 3.1 - pulseZ;
          const forwardPulse = Math.pow(0.5 + 0.5 * Math.cos(wavePhase), 5);
          const shockHit =
            transShockZ > 0 && Math.abs(z0 - transShockZ) < 0.38
              ? 1 - Math.abs(z0 - transShockZ) / 0.38
              : 0;
          const ringBoost = Math.min(1, forwardPulse * 0.85 + shockHit * 1.1 + drop * 0.35);

          // 1. Strobe & Pulse-Wave Wall Bays (Left & Right walls + Ceiling/Floor panels on pulse crests)
          if (((worldRingIdx & 1) === 0 || ringBoost > 0.35) && depthFade > 0.08) {
            const wallColor: [number, number, number] = isMonochromeStrobe
              ? [215, 225, 240]
              : shockHit > 0.2
                ? palette[7]
                : ringBoost > 0.45
                  ? palette[6]
                  : palette[2 + (Math.abs(worldRingIdx) % 4)];
            const panelAlpha =
              depthFade *
              (0.11 + bandAmp * 0.20 + ringBoost * 0.28 + (isMonochromeStrobe ? 0.14 : 0));
            ctx.fillStyle = rgbToCss(wallColor, Math.min(0.65, panelAlpha));

            for (const side of [0, 3, 4, 7]) {
              if ((side === 0 || side === 4) && ringBoost < 0.3) continue;
              const cA = corners[side];
              const cB = corners[(side + 1) & 7];
              const x0a = cx0 + (cA[0] * cosR - cA[1] * sinR) * s0;
              const y0a = cy0 + (cA[0] * sinR + cA[1] * cosR) * s0;
              const x0b = cx0 + (cB[0] * cosR - cB[1] * sinR) * s0;
              const y0b = cy0 + (cB[0] * sinR + cB[1] * cosR) * s0;
              const x1b = cx1 + (cB[0] * cosR - cB[1] * sinR) * s1;
              const y1b = cy1 + (cB[0] * sinR + cB[1] * cosR) * s1;
              const x1a = cx1 + (cA[0] * cosR - cA[1] * sinR) * s1;
              const y1a = cy1 + (cA[0] * sinR + cA[1] * cosR) * s1;
              ctx.beginPath();
              ctx.moveTo(x0a, y0a);
              ctx.lineTo(x0b, y0b);
              ctx.lineTo(x1b, y1b);
              ctx.lineTo(x1a, y1a);
              ctx.closePath();
              ctx.fill();
            }
          }

          // 2. Longitudinal Rails (8 primary corner rails + 8 mid-wall structural ribs + diagonal trusses)
          for (let c = 0; c < 8; c++) {
            const ptA = corners[c];
            const ptB = corners[(c + 1) & 7];
            const midPt: [number, number] = [(ptA[0] + ptB[0]) * 0.5, (ptA[1] + ptB[1]) * 0.5];

            const x0 = cx0 + (ptA[0] * cosR - ptA[1] * sinR) * s0;
            const y0 = cy0 + (ptA[0] * sinR + ptA[1] * cosR) * s0;
            const x1 = cx1 + (ptA[0] * cosR - ptA[1] * sinR) * s1;
            const y1 = cy1 + (ptA[0] * sinR + ptA[1] * cosR) * s1;

            const isThumperRail = c === 5 || c === 6;
            const railCol: [number, number, number] = isMonochromeStrobe
              ? [240, 245, 255]
              : isThumperRail || ringBoost > 0.55
                ? palette[7]
                : palette[5];

            // Outer neon halo stroke
            ctx.strokeStyle = rgbToCss(
              palette[4],
              depthFade * (0.22 + ringBoost * 0.35 + subBass * 0.2)
            );
            ctx.lineWidth = isThumperRail ? 4.8 : 3.4;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();

            // Crisp bright core rail stroke
            ctx.strokeStyle = rgbToCss(
              railCol,
              Math.min(1, depthFade * (isThumperRail ? 0.94 : 0.62 + bandAmp * 0.32 + ringBoost * 0.35))
            );
            ctx.lineWidth = isThumperRail ? 2.4 : 1.6;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();

            // Secondary mid-face longitudinal rib
            const mx0 = cx0 + (midPt[0] * cosR - midPt[1] * sinR) * s0;
            const my0 = cy0 + (midPt[0] * sinR + midPt[1] * cosR) * s0;
            const mx1 = cx1 + (midPt[0] * cosR - midPt[1] * sinR) * s1;
            const my1 = cy1 + (midPt[0] * sinR + midPt[1] * cosR) * s1;
            ctx.strokeStyle = rgbToCss(
              palette[3 + (c & 3)],
              depthFade * (0.30 + ringBoost * 0.40)
            );
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(mx0, my0);
            ctx.lineTo(mx1, my1);
            ctx.stroke();
          }

          // 3. Thumper Forward-Chasing Floor Chevron (`^`) on the bottom track
          const flL = corners[6];
          const flR = corners[5];
          const flMidX = (cx0 + cx1) * 0.5;
          const flMidY = (cy0 + cy1) * 0.5;
          const flMidS = (s0 + s1) * 0.5;
          const chvLx = cx1 + (flL[0] * cosR - flL[1] * sinR) * s1;
          const chvLy = cy1 + (flL[0] * sinR + flL[1] * cosR) * s1;
          const chvRx = cx1 + (flR[0] * cosR - flR[1] * sinR) * s1;
          const chvRy = cy1 + (flR[0] * sinR + flR[1] * cosR) * s1;
          const chvTipX = flMidX + (0 * cosR - 0.92 * sinR) * flMidS;
          const chvTipY = flMidY + (0 * sinR + 0.92 * cosR) * flMidS;
          ctx.strokeStyle = rgbToCss(
            ringBoost > 0.4 ? palette[7] : palette[6],
            depthFade * (0.45 + ringBoost * 0.52)
          );
          ctx.lineWidth = 1.5 + ringBoost * 1.8;
          ctx.beginPath();
          ctx.moveTo(chvLx, chvLy);
          ctx.lineTo(chvTipX, chvTipY);
          ctx.lineTo(chvRx, chvRy);
          ctx.stroke();

          // 4. Draw Octagonal Descent / Thumper Gate Frame (Dual-Pass Glow + Crisp Core)
          const isMajorGate = (worldRingIdx & 3) === 0 || ringBoost > 0.5;
          const gateCol: [number, number, number] = isMonochromeStrobe
            ? [230, 240, 255]
            : shockHit > 0.2 || ringBoost > 0.55
              ? palette[7]
              : palette[4 + (Math.abs(worldRingIdx) % 4)];

          // Outer glow pass
          ctx.strokeStyle = rgbToCss(
            palette[5],
            depthFade * (0.24 + bandAmp * 0.25 + ringBoost * 0.42)
          );
          ctx.lineWidth = isMajorGate ? 4.8 + ringBoost * 2.2 : 2.8;
          ctx.beginPath();
          for (let c = 0; c <= 8; c++) {
            const pt = corners[c & 7];
            const gx = cx1 + (pt[0] * cosR - pt[1] * sinR) * s1;
            const gy = cy1 + (pt[0] * sinR + pt[1] * cosR) * s1;
            if (c === 0) ctx.moveTo(gx, gy);
            else ctx.lineTo(gx, gy);
          }
          ctx.stroke();

          // Crisp inner core pass
          ctx.strokeStyle = rgbToCss(
            gateCol,
            Math.min(1, depthFade * (0.64 + bandAmp * 0.36 + ringBoost * 0.40))
          );
          ctx.lineWidth = isMajorGate ? 2.5 : 1.4;
          ctx.stroke();
        }

        // 5. Vanishing-Point Descent Vector Target Reticle (always active, pulses on beat & chaser waves)
        const vpX = ringCx[0];
        const vpY = ringCy[0];
        const retR = 14 + subBass * 16 + beat * 12 + transWave * 28;
        ctx.save();
        ctx.translate(vpX, vpY);
        ctx.rotate(-camRoll * 1.2 + timeSec * 0.8);
        ctx.strokeStyle = rgbToCss(palette[7], 0.72 + beat * 0.25);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-retR, 0);
        ctx.lineTo(-retR * 0.4, 0);
        ctx.moveTo(retR * 0.4, 0);
        ctx.lineTo(retR, 0);
        ctx.moveTo(0, -retR);
        ctx.lineTo(0, -retR * 0.4);
        ctx.moveTo(0, retR * 0.4);
        ctx.lineTo(0, retR);
        ctx.stroke();
        ctx.strokeStyle = rgbToCss(palette[6], 0.65);
        ctx.beginPath();
        ctx.arc(0, 0, retR * 0.65, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 6. Stable, Un-Clipped Floating 3D Hologram Lyric Banner (ONLY when synced lyrics exist — never unattributed comments!)
        const rawOverlayText = (activeLyricRef.current || '').trim();

        if (rawOverlayText.length > 0) {
          drawVertigoStyleHologram(
            rawOverlayText,
            (ringCx[6] - CANVAS_W * 0.5) * 0.24,
            (ringCy[6] - CANVAS_H * 0.5) * 0.05
          );
        }
      }

      // =======================================================================
      // MODE 5: 90s BRYCE TRAPPER (Mead 3-Ring Binder / Bryce-3D Chrome &
      //         2-of-3 Rock-Paper-Scissors Arena + Steady Receding Floor + Sine Scroller)
      // =======================================================================
      else if (activeMode === 'trapper') {
        // Pure #000000 OLED deep-space backdrop
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        const transWave = trans > 0.005 ? Math.sin(trans * Math.PI) : 0;
        const horizonY = Math.round(
          CANVAS_H * 0.54 + (trans > 0.005 ? Math.sin(trans * Math.PI * 2) * 24 * transWave : 0)
        );

        // 1. Interleaved Amiga Copper Raster Horizon Lines (ultra-fine 1px scanlines, with curtain wipe on track transition!)
        const numRasters = transWave > 0.05 ? 18 : 12;
        for (let b = 0; b < numRasters; b++) {
          const bandAmp = sb[b & 15];
          const phase = timeSec * 2.2 + b * 0.38;
          const transCurtain =
            transWave > 0.05
              ? Math.sin(trans * Math.PI * 2 + b * 0.42) * 85 * transWave
              : 0;
          const ry = Math.round(
            horizonY -
              96 +
              b * 12 +
              Math.sin(phase) * (13 + subBass * 20 + drop * 16) +
              transCurtain
          );
          const barW = Math.round(
            CANVAS_W * Math.min(1, 0.32 + bandAmp * 0.58 + transWave * 0.38)
          );
          const barX = Math.round((CANVAS_W - barW) * 0.5);
          const palC = palette[2 + (b % 6)];
          const barH = transWave > 0.05 ? Math.round(1 + transWave * 3) : 1;
          ctx.fillStyle = rgbToCss(palC, 0.28 + bandAmp * 0.36 + transWave * 0.20);
          ctx.fillRect(barX, ry, barW, barH);
        }

        // 2. Bryce-3D Perspective Neon-Checkerboard Floor
        //    Moves strictly BACKWARD toward the horizon at a smooth integrated rate (never front-to-back!)
        //    with a gentle lateral camera sway.
        trapperFloorZRef.current += dt * (0.92 + subBass * 0.42 + transWave * 2.6);
        const floorScroll = trapperFloorZRef.current;
        // `frac` descends smoothly from 1.0 -> 0.0 so every tile row recedes backward toward horizonY!
        const frac = 1 - (floorScroll % 1);
        const rowParityBase = Math.floor(floorScroll) & 1;
        const floorSwayX = Math.sin(timeSec * 0.52) * 28;

        ctx.save();
        if (transWave > 0.01) {
          const bankAngle = Math.sin(trans * Math.PI * 2) * 0.14 * transWave;
          ctx.translate(CANVAS_W * 0.5, horizonY);
          ctx.rotate(bankAngle);
          ctx.translate(-CANVAS_W * 0.5, -horizonY);
        }

        const numFloorRows = 10;
        const numFloorCols = 12;
        for (let r = 0; r < numFloorRows; r++) {
          const d0 = Math.max(0, (r + frac) / numFloorRows);
          const d1 = Math.min(1, (r + 1 + frac) / numFloorRows);
          const y0 = horizonY + Math.pow(d0, 1.8) * (CANVAS_H - horizonY);
          const y1 = horizonY + Math.pow(d1, 1.8) * (CANVAS_H - horizonY);
          const span0 = 86 + Math.pow(d0, 1.45) * 620;
          const span1 = 86 + Math.pow(d1, 1.45) * 620;
          const sway0 = floorSwayX * (1 - d0 * 0.65);
          const sway1 = floorSwayX * (1 - d1 * 0.65);
          const rowParity = (r - rowParityBase) & 1;

          for (let c = -numFloorCols / 2; c < numFloorCols / 2; c++) {
            const isCheck = ((c + rowParity) & 1) === 0;
            if (!isCheck) continue; // Leave alternating tiles pure #000000 OLED black!
            const u0 = c / (numFloorCols * 0.5);
            const u1 = (c + 1) / (numFloorCols * 0.5);
            const x0a = CANVAS_W * 0.5 + sway0 + u0 * span0;
            const x0b = CANVAS_W * 0.5 + sway0 + u1 * span0;
            const x1b = CANVAS_W * 0.5 + sway1 + u1 * span1;
            const x1a = CANVAS_W * 0.5 + sway1 + u0 * span1;

            const tilePal = palette[3 + (Math.abs(c + r - rowParityBase) % 4)];
            const tileAlpha =
              (0.16 + d0 * 0.44) * (0.72 + subBass * 0.28 + transWave * 0.25);
            ctx.fillStyle = rgbToCss(tilePal, Math.min(0.85, tileAlpha));
            ctx.beginPath();
            ctx.moveTo(x0a, y0);
            ctx.lineTo(x0b, y0);
            ctx.lineTo(x1b, y1);
            ctx.lineTo(x1a, y1);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.restore();

        // 3. 90s Bryce-3D Geometric Arena:
        //    3 Shapes (0 = Chrome Sphere, 1 = Neon Pyramid, 2 = Bryce 3D Cube)
        //    Only 2 are active at once! They periodically clash in Rock-Paper-Scissors combat,
        //    shattering the loser into 3D wireframe shards before the missing 3rd shape warps in!
        const arena = trapperArenaRef.current;
        arena.timer += dt;

        if (arena.phase === 'float') {
          // Collisions occur ~25% as often (~27s cadence, or after 14s on a major beat drop)
          if (arena.timer >= 27.0 || (drop > 0.72 && arena.timer >= 14.0)) {
            arena.phase = 'charge';
            arena.timer = 0;
            arena.loserSide = getRpsLoserSide(arena.leftShape, arena.rightShape);
            arena.incomingShape = ((3 - arena.leftShape - arena.rightShape) % 3) as TrapperShapeKind;
          }
        } else if (arena.phase === 'charge') {
          if (arena.timer >= 1.05) {
            arena.phase = 'clash';
            arena.timer = 0;
            // Spawn 16 3D wireframe shards from the defeated shape at center stage!
            const impactX = CANVAS_W * 0.5 + (arena.loserSide === 'left' ? -24 : 24);
            const impactY = CANVAS_H * 0.36;
            const newShards: TrapperShard[] = [];
            for (let s = 0; s < 16; s++) {
              const ang = (s / 16) * Math.PI * 2 + (s & 1) * 0.2;
              const spd = 95 + (s % 5) * 42;
              newShards.push({
                x: impactX,
                y: impactY,
                vx: Math.cos(ang) * spd + (arena.loserSide === 'left' ? -55 : 55),
                vy: Math.sin(ang) * spd - 45,
                rot: s * 0.5,
                vrot: (s & 1 ? 1 : -1) * (5 + (s % 4) * 2),
                size: 8 + (s % 4) * 4,
                palIdx: 4 + (s & 3),
              });
            }
            arena.shards = newShards;
          }
        } else if (arena.phase === 'clash') {
          if (arena.timer >= 1.1) {
            arena.phase = 'challenger';
            arena.timer = 0;
            arena.challengerBannerCount += 1;
          }
        } else if (arena.phase === 'challenger') {
          if (arena.timer >= 1.55) {
            if (arena.loserSide === 'left') {
              arena.leftShape = arena.incomingShape;
            } else {
              arena.rightShape = arena.incomingShape;
            }
            arena.phase = 'float';
            arena.timer = 0;
            arena.shards = [];
          }
        }

        // Helper to draw any of the 3 Bryce-3D primitives:
        // 0 = Chrome Sphere, 1 = Neon Pyramid + Torus, 2 = Rotating 3D Bryce Cube
        const drawBrycePrimitive = (
          kind: TrapperShapeKind,
          cx: number,
          cy: number,
          scaleFactor: number,
          spinMult: number
        ) => {
          if (scaleFactor <= 0.02) return;
          const baseR = (42 + subBass * 15 + beat * 9) * scaleFactor;

          // Ground shadow on the receding checkerboard floor
          ctx.fillStyle = `rgba(0, 0, 0, ${(0.72 * Math.min(1, scaleFactor)).toFixed(2)})`;
          ctx.beginPath();
          ctx.ellipse(cx, horizonY + 26, baseR * 0.85, baseR * 0.22, 0, 0, Math.PI * 2);
          ctx.fill();

          if (kind === 0) {
            // --- SHAPE 0: BRYCE-3D RAYTRACED CHROME & LAT/LON SPHERE ---
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
            ctx.clip();

            const sGrad = ctx.createRadialGradient(
              cx - baseR * 0.35,
              cy - baseR * 0.35,
              baseR * 0.08,
              cx,
              cy,
              baseR
            );
            sGrad.addColorStop(0, rgbToCss(palette[7], 0.98));
            sGrad.addColorStop(0.45, rgbToCss(palette[5], 0.88));
            sGrad.addColorStop(0.78, rgbToCss(palette[2], 0.92));
            sGrad.addColorStop(1, '#000000');
            ctx.fillStyle = sGrad;
            ctx.fillRect(cx - baseR, cy - baseR, baseR * 2, baseR * 2);

            ctx.strokeStyle = rgbToCss(palette[7], 0.54);
            ctx.lineWidth = 0.9;
            const rotLon = timeSec * 1.45 * spinMult;
            for (let lat = -2; lat <= 2; lat++) {
              const latY = cy + (lat / 3) * baseR;
              const latRx = Math.sqrt(Math.max(0, baseR * baseR - (latY - cy) ** 2));
              ctx.beginPath();
              ctx.ellipse(cx, latY, latRx, latRx * 0.22, 0, 0, Math.PI * 2);
              ctx.stroke();
            }
            for (let lon = 0; lon < 4; lon++) {
              const a = rotLon + (lon * Math.PI) / 4;
              const rx = Math.abs(Math.cos(a)) * baseR;
              ctx.beginPath();
              ctx.ellipse(cx, cy, Math.max(2, rx), baseR, 0, 0, Math.PI * 2);
              ctx.stroke();
            }
            ctx.restore();
          } else if (kind === 1) {
            // --- SHAPE 1: BRYCE-3D SHADED PYRAMID / TRIANGLE & ORBITING TORUS ---
            const coneH = (52 + midEnergy * 20) * scaleFactor;
            const coneW = (40 + subBass * 14) * scaleFactor;
            const spin = timeSec * 1.3 * spinMult;

            const basePts: [number, number][] = [];
            for (let k = 0; k < 4; k++) {
              const ang = spin + k * (Math.PI * 0.5);
              basePts.push([
                cx + Math.cos(ang) * coneW,
                cy + coneH * 0.48 + Math.sin(ang) * coneW * 0.35,
              ]);
            }
            const apexX = cx + Math.sin(timeSec * 1.8) * 8 * scaleFactor;
            const apexY = cy - coneH * 0.65;

            for (let k = 0; k < 4; k++) {
              const p0 = basePts[k];
              const p1 = basePts[(k + 1) & 3];
              const facePal = palette[3 + ((k + Math.floor(timeSec * 2)) & 3)];
              ctx.fillStyle = rgbToCss(facePal, 0.46 + (k & 1) * 0.26);
              ctx.strokeStyle = rgbToCss(palette[7], 0.78);
              ctx.lineWidth = 1.0;
              ctx.beginPath();
              ctx.moveTo(apexX, apexY);
              ctx.lineTo(p0[0], p0[1]);
              ctx.lineTo(p1[0], p1[1]);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }

            ctx.save();
            ctx.translate(cx, cy + 5 * scaleFactor);
            ctx.rotate(Math.sin(timeSec * 1.15) * 0.45);
            ctx.strokeStyle = rgbToCss(palette[6], 0.80);
            ctx.lineWidth = (2.2 + beat * 1.5) * scaleFactor;
            ctx.beginPath();
            ctx.ellipse(0, 0, coneW * 1.42, coneW * 0.40, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = rgbToCss(palette[7], 0.88);
            ctx.lineWidth = 0.9;
            ctx.stroke();
            ctx.restore();
          } else {
            // --- SHAPE 2: BRYCE-3D ROTATING ISOMETRIC CUBE / SQUARE & INNER HYPERCUBE ---
            const cubeR = (36 + subBass * 14 + beat * 8) * scaleFactor;
            const ax = timeSec * 1.05 * spinMult;
            const ay = timeSec * 1.38 * spinMult;
            const az = timeSec * 0.72 * spinMult;
            const cxA = Math.cos(ax), sxA = Math.sin(ax);
            const cyA = Math.cos(ay), syA = Math.sin(ay);
            const czA = Math.cos(az), szA = Math.sin(az);

            const rawVerts: [number, number, number][] = [
              [-1, -1, -1],
              [1, -1, -1],
              [1, 1, -1],
              [-1, 1, -1],
              [-1, -1, 1],
              [1, -1, 1],
              [1, 1, 1],
              [-1, 1, 1],
            ];
            const projVerts: [number, number, number][] = rawVerts.map(([vx, vy, vz]) => {
              // Rotate X
              const y1 = vy * cxA - vz * sxA;
              const z1 = vy * sxA + vz * cxA;
              // Rotate Y
              const x2 = vx * cyA + z1 * syA;
              const z2 = -vx * syA + z1 * cyA;
              // Rotate Z
              const x3 = x2 * czA - y1 * szA;
              const y3 = x2 * szA + y1 * czA;
              const persp = 3.2 / (3.2 - z2 * 0.45);
              return [cx + x3 * cubeR * persp * 0.68, cy + y3 * cubeR * persp * 0.68, z2];
            });

            const faces: [number, number, number, number, number][] = [
              [0, 1, 2, 3, 3],
              [4, 5, 6, 7, 6],
              [0, 1, 5, 4, 4],
              [2, 3, 7, 6, 5],
              [0, 3, 7, 4, 2],
              [1, 2, 6, 5, 7],
            ];
            // Depth-sort faces back-to-front (Painter's Algorithm)
            faces.sort((fa, fb) => {
              const za =
                projVerts[fa[0]][2] +
                projVerts[fa[1]][2] +
                projVerts[fa[2]][2] +
                projVerts[fa[3]][2];
              const zb =
                projVerts[fb[0]][2] +
                projVerts[fb[1]][2] +
                projVerts[fb[2]][2] +
                projVerts[fb[3]][2];
              return za - zb;
            });

            for (let f = 0; f < faces.length; f++) {
              const [i0, i1, i2, i3, palSlot] = faces[f];
              const v0 = projVerts[i0];
              const v1 = projVerts[i1];
              const v2 = projVerts[i2];
              const v3 = projVerts[i3];
              const faceColor = palette[Math.min(7, palSlot)];
              ctx.fillStyle = rgbToCss(faceColor, f >= 3 ? 0.56 : 0.24);
              ctx.strokeStyle = rgbToCss(palette[7], f >= 3 ? 0.85 : 0.42);
              ctx.lineWidth = f >= 3 ? 1.1 : 0.8;
              ctx.beginPath();
              ctx.moveTo(v0[0], v0[1]);
              ctx.lineTo(v1[0], v1[1]);
              ctx.lineTo(v2[0], v2[1]);
              ctx.lineTo(v3[0], v3[1]);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
          }
        };

        // Compute Left & Right arena slot positions based on Rock-Paper-Scissors combat phase
        const homeLeftX = CANVAS_W * 0.27 + Math.sin(timeSec * 0.95) * 44;
        const homeRightX = CANVAS_W * 0.73 + Math.cos(timeSec * 0.85) * 44;
        const dropLift = trans > 0.005 ? Math.pow(trans, 2) * 95 : 0;
        const baseLeftY =
          CANVAS_H * 0.36 +
          Math.cos(timeSec * 1.35) * 18 -
          Math.abs(Math.sin(timeSec * 2.6)) * (14 + subBass * 26) -
          dropLift;
        const baseRightY =
          CANVAS_H * 0.36 +
          Math.sin(timeSec * 1.45) * 18 -
          Math.abs(Math.cos(timeSec * 2.4)) * (14 + subBass * 26) -
          dropLift;

        let leftX = homeLeftX;
        let rightX = homeRightX;
        let leftScale = 1.0;
        let rightScale = 1.0;
        let spinBoost = 1.0 + transWave * 2.5;

        if (arena.phase === 'charge') {
          const p = Math.min(1, arena.timer / 1.05);
          const ease = p * p;
          leftX = homeLeftX + (CANVAS_W * 0.43 - homeLeftX) * ease;
          rightX = homeRightX + (CANVAS_W * 0.57 - homeRightX) * ease;
          spinBoost = 1.0 + ease * 2.8;

          // Crackling RPS Duel Laser Tether between the two charging shapes
          ctx.strokeStyle = rgbToCss(palette[7], 0.65 + ease * 0.35);
          ctx.lineWidth = 1.8 + ease * 2.2;
          ctx.beginPath();
          const segs = 12;
          for (let s = 0; s <= segs; s++) {
            const u = s / segs;
            const lx = leftX + (rightX - leftX) * u;
            const ly =
              baseLeftY +
              (baseRightY - baseLeftY) * u +
              Math.sin(u * Math.PI) * Math.sin(timeSec * 38 + s * 2) * (14 * ease);
            if (s === 0) ctx.moveTo(lx, ly);
            else ctx.lineTo(lx, ly);
          }
          ctx.stroke();
        } else if (arena.phase === 'clash') {
          const p = Math.min(1, arena.timer / 1.1);
          spinBoost = 2.6 - p * 1.4;
          if (arena.loserSide === 'left') {
            leftScale = 0; // Left shape shattered!
            rightX = CANVAS_W * 0.48 + (homeRightX - CANVAS_W * 0.48) * p;
            rightScale = 1.18 - p * 0.18;
          } else {
            rightScale = 0; // Right shape shattered!
            leftX = CANVAS_W * 0.52 + (homeLeftX - CANVAS_W * 0.52) * p;
            leftScale = 1.18 - p * 0.18;
          }

          // Impact Shockwave Ring at center stage
          if (p < 0.65) {
            const shockP = p / 0.65;
            ctx.strokeStyle = rgbToCss(palette[7], (1 - shockP) * 0.9);
            ctx.lineWidth = 3.2 * (1 - shockP);
            ctx.beginPath();
            ctx.arc(CANVAS_W * 0.5, CANVAS_H * 0.36, 18 + shockP * 115, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (arena.phase === 'challenger') {
          const p = Math.min(1, arena.timer / 1.55);
          const warpScale = Math.min(1, p * 1.25);
          if (arena.loserSide === 'left') {
            drawBrycePrimitive(arena.incomingShape, homeLeftX, baseLeftY, warpScale, 2.4);
            leftScale = 0;
          } else {
            drawBrycePrimitive(arena.incomingShape, homeRightX, baseRightY, warpScale, 2.4);
            rightScale = 0;
          }

          // Teleportation Warp Rings & "A CHALLENGER APPROACHES!" Banner
          const spawnX = arena.loserSide === 'left' ? homeLeftX : homeRightX;
          const spawnY = arena.loserSide === 'left' ? baseLeftY : baseRightY;
          ctx.strokeStyle = rgbToCss(palette[6], (1 - p * 0.7) * 0.85);
          ctx.lineWidth = 2.0;
          ctx.beginPath();
          ctx.ellipse(
            spawnX,
            spawnY,
            54 * (1.2 - p * 0.4),
            18 * (1.2 - p * 0.4),
            timeSec * 3,
            0,
            Math.PI * 2
          );
          ctx.stroke();

          // Show the "CHALLENGER APPROACHES" text banner at most 3 times per track (unless Vertigo-style lyric hologram is currently active)
          const trpLyricActive =
            hasScCommentsRef.current &&
            hasLyricsRef.current &&
            Boolean(activeLyricRef.current && activeLyricRef.current.trim().length > 0);
          if (arena.challengerBannerCount <= 3 && !trpLyricActive) {
            const bannerAlpha = Math.sin(p * Math.PI);
            const bannerTopY = Math.round(Math.max(22, cropTopY + 18));
            ctx.save();
            ctx.font = 'bold 13px "JetBrains Mono", "Fira Code", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const bannerText = `⚡ CHALLENGER APPROACHES: ${TRAPPER_SHAPE_NAMES[arena.incomingShape]} ⚡`;
            ctx.fillStyle = `rgba(0, 0, 0, ${(0.72 * bannerAlpha).toFixed(2)})`;
            ctx.fillRect(CANVAS_W * 0.5 - 175, bannerTopY, 350, 24);
            ctx.strokeStyle = rgbToCss(palette[6], 0.85 * bannerAlpha);
            ctx.lineWidth = 1.4;
            ctx.strokeRect(CANVAS_W * 0.5 - 175, bannerTopY, 350, 24);
            ctx.fillStyle = rgbToCss(palette[7], 0.96 * bannerAlpha);
            ctx.fillText(bannerText, CANVAS_W * 0.5, bannerTopY + 12);
            ctx.restore();
          }
        }

        // Render the 2 active Bryce-3D shapes
        if (leftScale > 0.01) {
          drawBrycePrimitive(arena.leftShape, leftX, baseLeftY, leftScale, spinBoost);
        }
        if (rightScale > 0.01) {
          drawBrycePrimitive(arena.rightShape, rightX, baseRightY, rightScale, spinBoost);
        }

        // Step & render 3D Wireframe Shards when a shape is destroyed in RPS combat!
        if (arena.shards.length > 0) {
          for (let s = 0; s < arena.shards.length; s++) {
            const sh = arena.shards[s];
            sh.x += sh.vx * dt;
            sh.y += sh.vy * dt;
            sh.vy += 210 * dt; // Gravity toward checkerboard floor
            sh.rot += sh.vrot * dt;
            const sz = sh.size;
            ctx.save();
            ctx.translate(sh.x, sh.y);
            ctx.rotate(sh.rot);
            ctx.fillStyle = rgbToCss(palette[sh.palIdx], 0.65);
            ctx.strokeStyle = rgbToCss(palette[7], 0.92);
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(0, -sz);
            ctx.lineTo(sz * 0.86, sz * 0.6);
            ctx.lineTo(-sz * 0.86, sz * 0.6);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        }

        // 4. 3D Sine-Wave Demoscene Lyric & Greetz Scroller near the floor level (matching Demoscene 64K)
        const scroller = scrollerTextRef.current;
        if (scroller.length > 0) {
          const charW = 14;
          const scrollPx = Math.floor(timeSec * 102);
          const firstCharIdx = Math.floor(scrollPx / charW);
          const pixelRem = scrollPx % charW;
          const visibleChars = Math.ceil(CANVAS_W / charW) + 2;

          ctx.font = 'bold 16px "JetBrains Mono", "Fira Code", monospace';
          ctx.textBaseline = 'middle';

          const waveAmp = 11 + subBass * 16 + beat * 8 + drop * 12 + transWave * 26;
          const baseScrollerY = Math.min(CANVAS_H - 46, cropBottomY - 34);
          for (let c = 0; c < visibleChars; c++) {
            const ch = scroller[(firstCharIdx + c) % scroller.length];
            if (ch === ' ') continue;
            const x = c * charW - pixelRem;
            const sineIdx = (Math.floor(timeSec * 78) + (firstCharIdx + c) * 10) & 255;
            const zWave = COS_F32[sineIdx];
            const y = baseScrollerY + SIN_F32[sineIdx] * waveAmp;
            const cPal = palette[4 + ((firstCharIdx + c) & 3)];
            ctx.fillStyle = rgbToCss(cPal, 0.72 + (zWave * 0.5 + 0.5) * 0.28);
            ctx.fillText(ch, Math.round(x), Math.round(y));
          }
        }

        // 5. Vertigo-Style Floating 3D Hologram Lyrics when BOTH Lyrics AND SC Comments are present
        if (hasScCommentsRef.current && hasLyricsRef.current) {
          const trapperLyricText = (activeLyricRef.current || '').trim();
          if (trapperLyricText.length > 0) {
            drawVertigoStyleHologram(
              trapperLyricText,
              Math.sin(timeSec * 0.52) * 7,
              0
            );
          }
        }
      } else {
        // =====================================================================
        // MODES 6–12: RUST + WASM "SMOL ENGINE" MOODBOARD SCENES (a through h)
        // =====================================================================
        const sceneDesc = getSceneDescriptor(activeMode);
        const wasm = getLoadedWasmVizEngine();
        if (wasm && sceneDesc.wasmSceneId !== null) {
          wasm.viz_set_bands(
            Math.round(sb[0] * 255),
            Math.round(sb[1] * 255),
            Math.round(sb[2] * 255),
            Math.round(sb[3] * 255),
            Math.round(sb[4] * 255),
            Math.round(sb[5] * 255),
            Math.round(sb[6] * 255),
            Math.round(sb[7] * 255),
            Math.round(sb[8] * 255),
            Math.round(sb[9] * 255),
            Math.round(sb[10] * 255),
            Math.round(sb[11] * 255),
            Math.round(sb[12] * 255),
            Math.round(sb[13] * 255),
            Math.round(sb[14] * 255),
            Math.round(sb[15] * 255),
          );
          wasm.viz_render_frame(
            sceneDesc.wasmSceneId,
            timeSec,
            playheadRatioRef.current,
            rmsRef.current,
            peakRef.current,
            beat,
            bpmRef.current || 120,
            trans,
          );
          const ptr = wasm.viz_frame_ptr();
          const wasmPixels = new Uint8ClampedArray(
            wasm.memory.buffer,
            ptr,
            CANVAS_W * CANVAS_H * 4,
          );
          const imgData = new ImageData(wasmPixels, CANVAS_W, CANVAS_H);
          ctx.putImageData(imgData, 0, 0);
        }
      }
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [mode, isPlaying, activeComment, hidden]);

  if (mode === 'off') {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        background: '#000000',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: isPlaying ? 0.88 : 0.34,
          transition: 'opacity 320ms ease',
        }}
      />
      {/* Static Zero-CPU True OLED #000000 Center Cushion & Outer Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 52% 48% at 56% 52%, rgba(0, 0, 0, 0.58) 0%, rgba(0, 0, 0, 0.28) 55%, rgba(0, 0, 0, 0.82) 100%)',
        }}
      />
    </div>
  );
};
