import {
  CANVAS_H,
  CANVAS_W,
  COS_F32,
  SIN_F32,
} from './classicShared';
import { lerpRgb, rgbToCss, type RgbTuple } from './types';

/**
 * Low-resolution PS1 / Saturn / Bryce-3D offscreen raster dimensions (320×180 -> 2x nearest-neighbor to 640×360).
 * Rendering into 320×180 with integer vertex snapping and nearest-neighbor upscale gives every polygon edge,
 * wireframe, and dithered surface authentic 90s low-poly crunch rather than smooth high-DPI Canvas2D curves.
 */
export const LOWPOLY_W = 320;
export const LOWPOLY_H = 180;
export const LOWPOLY_SCALE = CANVAS_W / LOWPOLY_W; // 2.0

export type Vec3 = [number, number, number];

export interface LowPolyFace {
  /** Vertex indices (3 for triangle, 4 for quad) */
  indices: number[];
  /** Palette index (0..7) from track artwork palette */
  palIdx: number;
  /** Face fill opacity (0..1) */
  alpha?: number;
  /** Optional wireframe palette index (0..7) */
  wirePalIdx?: number;
  /** Optional wireframe opacity */
  wireAlpha?: number;
}

export interface LowPolyMesh {
  verts: Vec3[];
  faces: LowPolyFace[];
}

let sharedLowPolyCanvas: HTMLCanvasElement | null = null;
let sharedLowPolyCtx: CanvasRenderingContext2D | null = null;

/**
 * Begins a low-resolution PS1/Bryce-3D raster pass (logical coordinates remain 0..640 x 0..360
 * via a 0.5x scale transform onto the 320×180 offscreen buffer, so all scene layout coordinates
 * work seamlessly while rasterizing at chunky 320×180 resolution!).
 */
export function beginLowPolyRasterPass(
  fallbackCtx: CanvasRenderingContext2D,
  clearColor = '#000000',
): CanvasRenderingContext2D {
  if (typeof document === 'undefined') {
    fallbackCtx.fillStyle = clearColor;
    fallbackCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    return fallbackCtx;
  }
  if (!sharedLowPolyCanvas) {
    sharedLowPolyCanvas = document.createElement('canvas');
    sharedLowPolyCanvas.width = LOWPOLY_W;
    sharedLowPolyCanvas.height = LOWPOLY_H;
    sharedLowPolyCtx = sharedLowPolyCanvas.getContext('2d', { alpha: false });
  }
  if (!sharedLowPolyCtx) {
    fallbackCtx.fillStyle = clearColor;
    fallbackCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    return fallbackCtx;
  }
  sharedLowPolyCtx.setTransform(1 / LOWPOLY_SCALE, 0, 0, 1 / LOWPOLY_SCALE, 0, 0);
  sharedLowPolyCtx.imageSmoothingEnabled = false;
  sharedLowPolyCtx.fillStyle = clearColor;
  sharedLowPolyCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  return sharedLowPolyCtx;
}

/**
 * Blits the 320×180 low-poly raster pass onto the main 640×360 canvas using crisp nearest-neighbor
 * pixel scaling, optional VHS horizontal tracking tears, and 90s CRT scanline/dither crunch.
 */
export function commitLowPolyRasterPass(
  targetCtx: CanvasRenderingContext2D,
  lowCtx: CanvasRenderingContext2D,
  options?: {
    scanlineAlpha?: number;
    vhsTearAmount?: number;
    timeSec?: number;
    bayerTintRgb?: RgbTuple;
    bayerAlpha?: number;
  },
): void {
  if (!sharedLowPolyCanvas || lowCtx === targetCtx) return;

  const prevSmooth = targetCtx.imageSmoothingEnabled;
  targetCtx.imageSmoothingEnabled = false;

  const tear = options?.vhsTearAmount ?? 0;
  const timeSec = options?.timeSec ?? 0;

  // Base nearest-neighbor 320×180 -> 640×360 blit
  targetCtx.drawImage(
    sharedLowPolyCanvas,
    0,
    0,
    LOWPOLY_W,
    LOWPOLY_H,
    0,
    0,
    CANVAS_W,
    CANVAS_H,
  );

  // Optional VHS tracking slice displacement on heavy kicks / glitches
  if (tear > 0.02) {
    const numSlices = Math.min(6, Math.ceil(tear * 6));
    for (let s = 0; s < numSlices; s++) {
      const seed = Math.sin(timeSec * 19.7 + s * 4.3);
      const srcY = Math.max(0, Math.min(LOWPOLY_H - 12, Math.floor((seed * 0.5 + 0.5) * (LOWPOLY_H - 12))));
      const sliceH = 4 + (s % 3) * 4;
      const shiftX = Math.round(Math.cos(timeSec * 31.1 + s * 2.1) * tear * 28);
      targetCtx.drawImage(
        sharedLowPolyCanvas,
        0,
        srcY,
        LOWPOLY_W,
        sliceH,
        shiftX,
        srcY * LOWPOLY_SCALE,
        CANVAS_W,
        sliceH * LOWPOLY_SCALE,
      );
    }
  }

  // Subtle 4×4 Bayer ordered dither stipple + CRT scanline grille
  const scanAlpha = options?.scanlineAlpha ?? 0.22;
  if (scanAlpha > 0.01) {
    targetCtx.fillStyle = `rgba(0, 0, 0, ${scanAlpha.toFixed(2)})`;
    for (let y = 0; y < CANVAS_H; y += 3) {
      targetCtx.fillRect(0, y, CANVAS_W, 1);
    }
  }

  if (options?.bayerTintRgb && (options.bayerAlpha ?? 0) > 0.01) {
    const a = options.bayerAlpha ?? 0.06;
    targetCtx.fillStyle = rgbToCss(options.bayerTintRgb, a);
    const phase = Math.floor(timeSec * 12) & 3;
    for (let y = phase; y < CANVAS_H; y += 8) {
      targetCtx.fillRect(0, y, CANVAS_W, 1);
    }
  }

  targetCtx.imageSmoothingEnabled = prevSmooth;
}

/**
 * Snaps a coordinate to the PS1 integer grid (2px logical grid = 1px in 320×180 buffer)
 * for authentic PlayStation 1 / Saturn affine vertex wobble.
 */
export function snapPs1(v: number, snapStep = 2): number {
  return Math.round(v / snapStep) * snapStep;
}

export function fastSin(rad: number): number {
  const idx = Math.floor(((rad % (Math.PI * 2)) + Math.PI * 2) / (Math.PI * 2) * 256) & 255;
  return SIN_F32[idx];
}

export function fastCos(rad: number): number {
  const idx = Math.floor(((rad % (Math.PI * 2)) + Math.PI * 2) / (Math.PI * 2) * 256) & 255;
  return COS_F32[idx];
}

export interface DrawMeshOptions {
  cx: number;
  cy: number;
  scale: number;
  rx: number;
  ry: number;
  rz: number;
  palette: RgbTuple[];
  fov?: number;
  snapStep?: number;
  cullBackfaces?: boolean;
  wireframeOnly?: boolean;
  lightDir?: Vec3;
  alphaBoost?: number;
}

/**
 * Projects and renders a 3D low-poly mesh using Painter's algorithm depth sorting,
 * PS1 integer vertex snapping, directional flat shading mapped strictly to `palette[0..7]`,
 * and crisp faceted wireframe edges.
 */
export function projectAndDrawMesh3D(
  ctx: CanvasRenderingContext2D,
  mesh: LowPolyMesh,
  opts: DrawMeshOptions,
): void {
  const {
    cx,
    cy,
    scale,
    rx,
    ry,
    rz,
    palette,
    fov = 3.4,
    snapStep = 2,
    cullBackfaces = false,
    wireframeOnly = false,
    lightDir = [-0.35, -0.65, 0.67],
    alphaBoost = 1.0,
  } = opts;

  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const cosZ = Math.cos(rz), sinZ = Math.sin(rz);

  const proj: [number, number, number, number, number, number][] = new Array(mesh.verts.length);
  for (let i = 0; i < mesh.verts.length; i++) {
    const [vx, vy, vz] = mesh.verts[i];
    // Rotate X
    const y1 = vy * cosX - vz * sinX;
    const z1 = vy * sinX + vz * cosX;
    // Rotate Y
    const x2 = vx * cosY + z1 * sinY;
    const z2 = -vx * sinY + z1 * cosY;
    // Rotate Z
    const x3 = x2 * cosZ - y1 * sinZ;
    const y3 = x2 * sinZ + y1 * cosZ;

    const denom = Math.max(0.45, fov - z2 * 0.45);
    const persp = fov / denom;
    const sx = snapStep > 0 ? snapPs1(cx + x3 * scale * persp, snapStep) : cx + x3 * scale * persp;
    const sy = snapStep > 0 ? snapPs1(cy + y3 * scale * persp, snapStep) : cy + y3 * scale * persp;
    proj[i] = [sx, sy, z2, x3, y3, z2];
  }

  // Build sortable face list
  const sortedFaces: { face: LowPolyFace; avgZ: number; shade: number }[] = [];
  for (let f = 0; f < mesh.faces.length; f++) {
    const face = mesh.faces[f];
    const idx = face.indices;
    if (idx.length < 3) continue;

    const p0 = proj[idx[0]];
    const p1 = proj[idx[1]];
    const p2 = proj[idx[2]];

    // Screen-space cross product for backface culling & flat shading normal approximation
    const ax = p1[0] - p0[0];
    const ay = p1[1] - p0[1];
    const bx = p2[0] - p0[0];
    const by = p2[1] - p0[1];
    const crossZ = ax * by - ay * bx;
    if (cullBackfaces && crossZ < 0) continue;

    // 3D normal for flat directional lighting
    const ux = p1[3] - p0[3];
    const uy = p1[4] - p0[4];
    const uz = p1[5] - p0[5];
    const vx = p2[3] - p0[3];
    const vy = p2[4] - p0[4];
    const vz = p2[5] - p0[5];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const dot = Math.max(0, Math.min(1, ((nx / nLen) * lightDir[0] + (ny / nLen) * lightDir[1] + (nz / nLen) * lightDir[2]) * 0.5 + 0.5));

    let zSum = 0;
    for (let k = 0; k < idx.length; k++) {
      zSum += proj[idx[k]][2];
    }
    sortedFaces.push({
      face,
      avgZ: zSum / idx.length,
      shade: dot,
    });
  }

  // Painter's algorithm: back-to-front
  sortedFaces.sort((a, b) => a.avgZ - b.avgZ);

  for (let s = 0; s < sortedFaces.length; s++) {
    const { face, shade } = sortedFaces[s];
    const idx = face.indices;
    const basePalIdx = Math.max(0, Math.min(7, face.palIdx));
    const lowPal = palette[Math.max(1, basePalIdx - 1)] || palette[1];
    const highPal = palette[Math.min(7, basePalIdx + 1)] || palette[7];
    const basePal = palette[basePalIdx] || palette[4];
    const shadedRgb = shade > 0.55
      ? lerpRgb(basePal, highPal, (shade - 0.55) * 1.8)
      : lerpRgb(lowPal, basePal, shade * 1.8);

    ctx.beginPath();
    ctx.moveTo(proj[idx[0]][0], proj[idx[0]][1]);
    for (let k = 1; k < idx.length; k++) {
      ctx.lineTo(proj[idx[k]][0], proj[idx[k]][1]);
    }
    ctx.closePath();

    if (!wireframeOnly && (face.alpha ?? 0.85) > 0.01) {
      const fillAlpha = Math.min(1, (face.alpha ?? 0.85) * alphaBoost);
      ctx.fillStyle = rgbToCss(shadedRgb, fillAlpha);
      ctx.fill();
    }

    const wireIdx = face.wirePalIdx ?? Math.min(7, basePalIdx + 2);
    const wireAlpha = Math.min(1, (face.wireAlpha ?? 0.78) * alphaBoost);
    if (wireAlpha > 0.02) {
      ctx.strokeStyle = rgbToCss(palette[wireIdx] || palette[7], wireAlpha);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

/**
 * Draws a Bryce-3D / Mode-7 receding perspective grid floor or ceiling strictly tinted from `palette[0..7]`.
 */
export function drawPerspectiveGridFloor(
  ctx: CanvasRenderingContext2D,
  horizonY: number,
  bottomY: number,
  scrollZ: number,
  swayX: number,
  palette: RgbTuple[],
  checkerboard = true,
  alphaScale = 1.0,
): void {
  const numRows = 9;
  const numCols = 10;
  const frac = 1 - ((scrollZ % 1 + 1) % 1);
  const rowParityBase = Math.floor(scrollZ) & 1;
  const spanH = bottomY - horizonY;

  for (let r = 0; r < numRows; r++) {
    const d0 = Math.max(0, (r + frac) / numRows);
    const d1 = Math.min(1, (r + 1 + frac) / numRows);
    const y0 = snapPs1(horizonY + Math.pow(d0, 1.75) * spanH, 2);
    const y1 = snapPs1(horizonY + Math.pow(d1, 1.75) * spanH, 2);
    const span0 = 76 + Math.pow(d0, 1.42) * 580;
    const span1 = 76 + Math.pow(d1, 1.42) * 580;
    const sw0 = swayX * (1 - d0 * 0.65);
    const sw1 = swayX * (1 - d1 * 0.65);
    const rowParity = (r - rowParityBase) & 1;

    for (let c = -numCols / 2; c < numCols / 2; c++) {
      const isCheck = ((c + rowParity) & 1) === 0;
      const u0 = c / (numCols * 0.5);
      const u1 = (c + 1) / (numCols * 0.5);
      const x0a = snapPs1(CANVAS_W * 0.5 + sw0 + u0 * span0, 2);
      const x0b = snapPs1(CANVAS_W * 0.5 + sw0 + u1 * span0, 2);
      const x1b = snapPs1(CANVAS_W * 0.5 + sw1 + u1 * span1, 2);
      const x1a = snapPs1(CANVAS_W * 0.5 + sw1 + u0 * span1, 2);

      const palSlot = 2 + (Math.abs(c + r - rowParityBase) % 4);
      if (checkerboard) {
        if (!isCheck) continue;
        ctx.fillStyle = rgbToCss(palette[palSlot], Math.min(0.85, (0.16 + d0 * 0.42) * alphaScale));
        ctx.beginPath();
        ctx.moveTo(x0a, y0);
        ctx.lineTo(x0b, y0);
        ctx.lineTo(x1b, y1);
        ctx.lineTo(x1a, y1);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.strokeStyle = rgbToCss(palette[palSlot + 1] || palette[5], Math.min(0.85, (0.22 + d0 * 0.48) * alphaScale));
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x0a, y0);
        ctx.lineTo(x0b, y0);
        ctx.lineTo(x1b, y1);
        ctx.lineTo(x1a, y1);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }
}

// ============================================================================
// PRE-BUILT LOW-POLY 3D MESHES FOR WAVE 2 SCENES
// ============================================================================

/**
 * Classic hexagonal Gothic Coffin 3D mesh (12 vertices: 6 front hexagon + 6 back hexagon).
 */
export const COFFIN_MESH_3D: LowPolyMesh = {
  verts: [
    // Front hexagonal lid (z = -0.32)
    [-0.28, -1.15, -0.32], // 0: top-left head
    [0.28, -1.15, -0.32],  // 1: top-right head
    [0.58, -0.32, -0.32],  // 2: right shoulder
    [0.34, 1.15, -0.32],   // 3: bottom-right toe
    [-0.34, 1.15, -0.32],  // 4: bottom-left toe
    [-0.58, -0.32, -0.32], // 5: left shoulder
    // Back hexagonal base (z = +0.32)
    [-0.24, -1.10, 0.32],  // 6
    [0.24, -1.10, 0.32],   // 7
    [0.50, -0.30, 0.32],   // 8
    [0.28, 1.10, 0.32],    // 9
    [-0.28, 1.10, 0.32],   // 10
    [-0.50, -0.30, 0.32],  // 11
  ],
  faces: [
    // Front lid (split into 2 quads so Painter's sort is clean)
    { indices: [0, 1, 2, 5], palIdx: 4, alpha: 0.90, wirePalIdx: 7 },
    { indices: [5, 2, 3, 4], palIdx: 4, alpha: 0.90, wirePalIdx: 7 },
    // Back base
    { indices: [6, 7, 8, 11], palIdx: 2, alpha: 0.85, wirePalIdx: 5 },
    { indices: [11, 8, 9, 10], palIdx: 2, alpha: 0.85, wirePalIdx: 5 },
    // 6 Beveled coffin side walls
    { indices: [0, 1, 7, 6], palIdx: 3, alpha: 0.88, wirePalIdx: 6 },
    { indices: [1, 2, 8, 7], palIdx: 5, alpha: 0.88, wirePalIdx: 7 },
    { indices: [2, 3, 9, 8], palIdx: 3, alpha: 0.88, wirePalIdx: 6 },
    { indices: [3, 4, 10, 9], palIdx: 2, alpha: 0.88, wirePalIdx: 5 },
    { indices: [4, 5, 11, 10], palIdx: 3, alpha: 0.88, wirePalIdx: 6 },
    { indices: [5, 0, 6, 11], palIdx: 5, alpha: 0.88, wirePalIdx: 7 },
  ],
};

/**
 * 5-Pointed Faceted 3D Starfish Mesh (12 vertices: front & back center hubs + 5 outer tips + 5 inner valleys).
 */
export const STARFISH_MESH_3D: LowPolyMesh = (() => {
  const verts: Vec3[] = [
    [0, 0, -0.28], // 0: front hub
    [0, 0, 0.22],  // 1: back hub
  ];
  for (let i = 0; i < 10; i++) {
    const ang = (i * Math.PI) / 5 - Math.PI * 0.5;
    const r = (i & 1) === 0 ? 1.05 : 0.42;
    verts.push([Math.cos(ang) * r, Math.sin(ang) * r, (i & 1) === 0 ? -0.04 : 0.04]);
  }
  const faces: LowPolyFace[] = [];
  for (let i = 0; i < 10; i++) {
    const cur = 2 + i;
    const next = 2 + ((i + 1) % 10);
    faces.push({
      indices: [0, cur, next],
      palIdx: (i & 1) === 0 ? 5 : 4,
      alpha: 0.90,
      wirePalIdx: 7,
    });
    faces.push({
      indices: [1, next, cur],
      palIdx: 3,
      alpha: 0.78,
      wirePalIdx: 6,
    });
  }
  return { verts, faces };
})();

/**
 * Uncanny PS1 Flat-Shaded Cyber-Avatar Head & Shoulders Mesh (for JACKIE EXTREME Darkweb & Vaporwave Poseidon bust).
 */
export const CYBER_AVATAR_HEAD_MESH: LowPolyMesh = {
  verts: [
    // Crown & Forehead
    [0, -1.25, 0],        // 0: crown apex
    [-0.58, -0.82, -0.45], // 1: left brow
    [0.58, -0.82, -0.45],  // 2: right brow
    [0, -0.78, -0.64],     // 3: glabella (between eyes)
    // Nose & Cheeks
    [0, -0.18, -0.86],     // 4: nose tip
    [-0.74, -0.22, -0.28], // 5: left cheekbone
    [0.74, -0.22, -0.28],  // 6: right cheekbone
    // Jaw & Chin
    [-0.48, 0.52, -0.35],  // 7: left jaw
    [0.48, 0.52, -0.35],   // 8: right jaw
    [0, 0.82, -0.52],      // 9: chin point
    // Back of skull & neck/shoulders
    [-0.62, -0.55, 0.55],  // 10: back-left skull
    [0.62, -0.55, 0.55],   // 11: back-right skull
    [-1.15, 1.18, 0.12],   // 12: left shoulder
    [1.15, 1.18, 0.12],    // 13: right shoulder
    [0, 1.15, -0.28],      // 14: collarbone center
  ],
  faces: [
    // Forehead
    { indices: [0, 1, 3], palIdx: 5, alpha: 0.90, wirePalIdx: 7 },
    { indices: [0, 3, 2], palIdx: 5, alpha: 0.90, wirePalIdx: 7 },
    // Eye sockets & Nose bridge
    { indices: [1, 5, 4, 3], palIdx: 3, alpha: 0.92, wirePalIdx: 7 },
    { indices: [3, 4, 6, 2], palIdx: 4, alpha: 0.92, wirePalIdx: 7 },
    // Lower cheeks & Mouth/Chin
    { indices: [5, 7, 9, 4], palIdx: 4, alpha: 0.90, wirePalIdx: 6 },
    { indices: [4, 9, 8, 6], palIdx: 5, alpha: 0.90, wirePalIdx: 6 },
    // Skull sides
    { indices: [0, 10, 5, 1], palIdx: 3, alpha: 0.85, wirePalIdx: 5 },
    { indices: [0, 2, 6, 11], palIdx: 3, alpha: 0.85, wirePalIdx: 5 },
    { indices: [0, 11, 10], palIdx: 2, alpha: 0.80, wirePalIdx: 4 },
    // Neck & Collarbone
    { indices: [7, 12, 14, 9], palIdx: 3, alpha: 0.86, wirePalIdx: 6 },
    { indices: [9, 14, 13, 8], palIdx: 4, alpha: 0.86, wirePalIdx: 6 },
  ],
};

/**
 * Icosahedron / Geodesic 3D Orb Mesh (for AVS V2, Sanctum Odyssey Orb, and Cosmos God Particle).
 */
export const ICOSAHEDRON_MESH_3D: LowPolyMesh = (() => {
  const t = (1 + Math.sqrt(5)) * 0.5;
  const raw: Vec3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const verts: Vec3[] = raw.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  });
  const triIndices: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const faces: LowPolyFace[] = triIndices.map((indices, idx) => ({
    indices,
    palIdx: 3 + (idx & 3),
    alpha: 0.78,
    wirePalIdx: 7,
  }));
  return { verts, faces };
})();
