import type React from 'react';
import type { SoundCloudComment } from '@simp/client';
import { CANVAS_H, CANVAS_W, drawMicroPartyCommentPill, RENDER_SCALE, type SceneRenderContext } from './types';

export { CANVAS_H, CANVAS_W, drawMicroPartyCommentPill, RENDER_SCALE, type SceneRenderContext };

// High-density 80x45 micro-glyph grid (3,600 cells, 8x8px per cell on 640x360 canvas)
export const GRID_COLS = 80;
export const GRID_ROWS = 45;
export const GRID_CELLS = GRID_COLS * GRID_ROWS; // 3,600 cells
export const CELL_W = 8;
export const CELL_H = 8;

// Unstretched square artwork sampling buffer (128x128) for slow Ken-Burns panning
export const ART_BUF_SIZE = 128;
export const ART_BUF_PIXELS = ART_BUF_SIZE * ART_BUF_SIZE;

// 16 typographic ASCII ramp glyphs ordered by optical density
export const GLYPH_RAMP = [' ', '·', '.', ':', '-', '~', '=', '+', '*', 'x', 'z', '#', '%', '&', '@', '$'];
export const NUM_GLYPHS = GLYPH_RAMP.length; // 16
export const NUM_PALETTE = 8;

// Printable ASCII strip (charCode 32..95) baked into the 8x8 bitmap LUT (indices 16..79)
export const ASCII_MIN = 32;
export const ASCII_MAX = 95;
export const ASCII_COUNT = ASCII_MAX - ASCII_MIN + 1; // 64 chars
export const TOTAL_LUT_GLYPHS = NUM_GLYPHS + ASCII_COUNT; // 80 glyphs total, 64 bytes each = 5,120 bytes

// Pre-computed 256-entry Sine Lookup Table (-1.0 .. +1.0) & Uint8 (0 .. 255)
export const SIN_F32 = new Float32Array(256);
export const COS_F32 = new Float32Array(256);
export const SIN_U8 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const rad = (i / 256) * Math.PI * 2;
  const s = Math.sin(rad);
  SIN_F32[i] = s;
  COS_F32[i] = Math.cos(rad);
  SIN_U8[i] = Math.max(0, Math.min(255, Math.round((s * 0.5 + 0.5) * 255)));
}

// Pre-computed 4x4 Bayer Ordered Dithering Matrix normalized to (-0.10 .. +0.10)
export const BAYER_4X4 = new Float32Array([
   0 / 16 - 0.5,  8 / 16 - 0.5,  2 / 16 - 0.5, 10 / 16 - 0.5,
  12 / 16 - 0.5,  4 / 16 - 0.5, 14 / 16 - 0.5,  6 / 16 - 0.5,
   3 / 16 - 0.5, 11 / 16 - 0.5,  1 / 16 - 0.5,  9 / 16 - 0.5,
  15 / 16 - 0.5,  7 / 16 - 0.5, 13 / 16 - 0.5,  5 / 16 - 0.5,
]).map((v) => v * 0.20);

// Pre-computed cell coordinates and base polar distance/angle LUTs for the 80x45 grid
export const CELL_X = new Int16Array(GRID_CELLS);
export const CELL_Y = new Int16Array(GRID_CELLS);
export const CELL_ROW = new Uint8Array(GRID_CELLS);
export const CELL_COL = new Uint8Array(GRID_CELLS);
export const CELL_NORM_X = new Float32Array(GRID_CELLS);
export const CELL_NORM_Y = new Float32Array(GRID_CELLS);
export const CELL_BAYER = new Float32Array(GRID_CELLS);
export const CELL_RADIAL_DIST = new Float32Array(GRID_CELLS);
export const CELL_RADIAL_ANGLE = new Uint8Array(GRID_CELLS);

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
export const DEFAULT_PALETTE_RGB: [number, number, number][] = [
  [0, 0, 0],
  [12, 28, 48],
  [20, 78, 110],
  [42, 163, 196],
  [56, 189, 248],
  [168, 85, 247],
  [251, 146, 60],
  [240, 249, 255],
];

export const SOUNDCLOUD_PALETTE_RGB: [number, number, number][] = [
  [0, 0, 0],
  [44, 16, 6],
  [124, 45, 18],
  [194, 65, 12],
  [234, 88, 12],
  [251, 146, 60],
  [253, 186, 116],
  [255, 247, 237],
];

export function rgbToCss(rgb: [number, number, number], alpha = 1): string {
  if (alpha >= 0.999) {
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(2)})`;
}

export function packAbgr(r: number, g: number, b: number): number {
  return (0xff000000 | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
}

// Pre-bake 80 glyphs (16 ramp + 64 ASCII) as 8x8 1-bit pixel masks once at startup
let cachedGlyphBitmaps: Uint8Array | null = null;
export function getGlyphBitmaps(): Uint8Array {
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

export interface GlyphMutationPatch {
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

export const MAX_MUTATION_PATCHES = 10;

// 0 = Chrome Sphere (Rock), 1 = Neon Pyramid/Triangle (Scissors), 2 = Bryce 3D Cube/Square (Paper)
// RPS Rules: Sphere (0) crushes Pyramid (1); Pyramid (1) slices Cube (2); Cube (2) traps Sphere (0)
export type TrapperShapeKind = 0 | 1 | 2;
export const TRAPPER_SHAPE_NAMES: Record<TrapperShapeKind, string> = {
  0: 'CHROME SPHERE',
  1: 'NEON PYRAMID',
  2: 'BRYCE CUBE',
};

export interface TrapperShard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  palIdx: number;
}

export interface TrapperArenaState {
  leftShape: TrapperShapeKind;
  rightShape: TrapperShapeKind;
  phase: 'float' | 'charge' | 'clash' | 'challenger';
  timer: number;
  loserSide: 'left' | 'right';
  incomingShape: TrapperShapeKind;
  challengerBannerCount: number;
  shards: TrapperShard[];
}

export function getRpsLoserSide(left: TrapperShapeKind, right: TrapperShapeKind): 'left' | 'right' {
  // 0 beats 1, 1 beats 2, 2 beats 0
  if ((left === 0 && right === 1) || (left === 1 && right === 2) || (left === 2 && right === 0)) {
    return 'right';
  }
  return 'left';
}


export interface ClassicSceneRuntimeRefs {
  activeLyricRef: React.MutableRefObject<string | null | undefined>;
  artSquareEdgeRef: React.MutableRefObject<Float32Array>;
  artSquareLumaRef: React.MutableRefObject<Float32Array>;
  avatarBlendRef: React.MutableRefObject<number>;
  avatarLumaGridRef: React.MutableRefObject<Float32Array>;
  cellSkipMaskRef: React.MutableRefObject<Uint8Array>;
  commentAvatarImgRef: React.MutableRefObject<HTMLImageElement | null>;
  feedbackCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  glitchSeedRef: React.MutableRefObject<number>;
  glyphTextStripRef: React.MutableRefObject<string>;
  hasLyricsRef: React.MutableRefObject<boolean>;
  hasScCommentsRef: React.MutableRefObject<boolean>;
  imageDataRef: React.MutableRefObject<ImageData | null>;
  lowResBlitCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  mutationPatchesRef: React.MutableRefObject<GlyphMutationPatch[]>;
  paletteCycleOffsetRef: React.MutableRefObject<number>;
  phaseAccumRef: React.MutableRefObject<number>;
  rowCorruptMaskRef: React.MutableRefObject<Uint8Array>;
  rowTearPxRef: React.MutableRefObject<Int16Array>;
  scrollerTextRef: React.MutableRefObject<string>;
  starXRef: React.MutableRefObject<Float32Array>;
  starYRef: React.MutableRefObject<Float32Array>;
  starZRef: React.MutableRefObject<Float32Array>;
  trapperArenaRef: React.MutableRefObject<TrapperArenaState>;
  trapperFloorZRef: React.MutableRefObject<number>;
  u32FrameRef: React.MutableRefObject<Uint32Array | null>;
  vertigoLyricRevealRef: React.MutableRefObject<number>;
  vertigoPulseZRef: React.MutableRefObject<number>;
  vertigoRollCurrentRef: React.MutableRefObject<number>;
  vertigoRollTargetRef: React.MutableRefObject<number>;
  vertigoTravelZRef: React.MutableRefObject<number>;
  glitch: number;
  palAbgr: Uint32Array;
  glyphBitmaps: Uint8Array;
  frameCount: number;
  effectiveComment: SoundCloudComment | null;
  effectiveAvatarImg: HTMLImageElement | null;
  drawVertigoStyleHologram: (rawText: string, targetAnchorX?: number, targetAnchorY?: number) => void;
}
