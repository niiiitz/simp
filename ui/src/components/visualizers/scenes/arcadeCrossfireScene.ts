import {
  CANVAS_H,
  CANVAS_W,
  rgbToCss,
  splitIntoBalancedLines,
  type RgbTuple,
  type SceneRenderContext,
} from './types';

// 8×6 classic alien invader bitmap mask (symmetric)
const INVADER_ROWS = [
  0b00100100,
  0b00111100,
  0b01111110,
  0b11011011,
  0b11111111,
  0b01011010,
];

// Destructible 8×8 Album Art Block Grid + Pong Ball Brickbreaker Physics + Block Shatter Particles
const ART_GRID_N = 8;
const ART_BLOCK_COUNT = ART_GRID_N * ART_GRID_N;
const artBlocksAlive = new Uint8Array(ART_BLOCK_COUNT);
let artBlocksInitialized = false;
let lastTrackSignature = '';
let rebuildWaveUntilSec = -1;

interface PongBallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  colorIdx: number;
}

const pongBalls: PongBallState[] = [
  { x: CANVAS_W * 0.26, y: CANVAS_H * 0.48, vx: 158, vy: -96, colorIdx: 7 },
  { x: CANVAS_W * 0.74, y: CANVAS_H * 0.54, vx: -146, vy: 104, colorIdx: 5 },
];

interface BlockSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  g: number;
  b: number;
  life: number;
  maxLife: number;
}

const MAX_SPARKS = 80;
const blockSparks: BlockSpark[] = [];

// Pac-Man Pellet & Cherry Respawn State along the Inner Maze Loop (28 slots)
const PELLET_COUNT = 28;
const pelletRespawnAt = new Float64Array(PELLET_COUNT);

// 3 Ground Missile Command Silos State (`siloDisabledUntil[i] > timeSec` means hit & inactivated!)
const siloDisabledUntil = new Float64Array([0, 0, 0]);
const siloBlastUntil = new Float64Array([0, 0, 0]);

// Diving Space Invader State (Invaders don't shoot — they descend/dive to blow up silos!)
interface DivingInvaderRun {
  active: boolean;
  slotIndex: number; // 0..17 in the 2×9 formation
  targetSilo: number; // 0, 1, or 2
   firingSilo: number; // Which active silo is firing defensive flak (-1 if none alive)
  progress: number; // 0.0 (top formation) -> 1.0 (silo impact)
  speed: number;
  willHitSilo: boolean; // ~18% low chance the invader slips past flak and blows up the silo!
  interceptProgress: number; // Where defensive flak detonates (~0.52..0.68)
  explodingTimer: number; // > 0 while flak fireball is active
  explosionX: number;
  explosionY: number;
}

const divingRuns: DivingInvaderRun[] = [
  {
    active: false,
    slotIndex: 2,
    targetSilo: 0,
    firingSilo: 0,
    progress: 0,
    speed: 0.42,
    willHitSilo: false,
    interceptProgress: 0.58,
    explodingTimer: 0,
    explosionX: 0,
    explosionY: 0,
  },
  {
    active: false,
    slotIndex: 6,
    targetSilo: 2,
    firingSilo: 2,
    progress: 0,
    speed: 0.38,
    willHitSilo: false,
    interceptProgress: 0.62,
    explodingTimer: 0,
    explosionX: 0,
    explosionY: 0,
  },
];

let diveRandomCounter = 1;

// Joust Knights Hit/Egg Respawn State when caught in a Missile Command flak explosion
const joustHitUntil = new Float64Array([0, 0]);
const joustHitOriginX = new Float64Array([0, 0]);
const joustHitOriginY = new Float64Array([0, 0]);

function resetArtBlocks(): void {
  artBlocksAlive.fill(1);
  artBlocksInitialized = true;
}

function spawnBlockShatter(bx: number, by: number, rgb: RgbTuple, count = 6): void {
  for (let i = 0; i < count; i++) {
    if (blockSparks.length >= MAX_SPARKS) {
      blockSparks.shift();
    }
    const angle = (i / count) * Math.PI * 2 + (i % 2) * 0.35;
    const speed = 38 + (i % 3) * 30;
    blockSparks.push({
      x: bx,
      y: by,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 14,
      r: rgb[0],
      g: rgb[1],
      b: rgb[2],
      life: 0.58,
      maxLife: 0.58,
    });
  }
}

function drawArcadeCherry(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pulse: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  const scale = 1 + pulse * 0.12;
  ctx.scale(scale, scale);

  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-3.2, 1.5);
  ctx.quadraticCurveTo(-1, -4.5, 3.2, -5.5);
  ctx.moveTo(2.8, 2.2);
  ctx.quadraticCurveTo(3.4, -2.2, 3.2, -5.5);
  ctx.stroke();

  ctx.fillStyle = '#86efac';
  ctx.fillRect(2.2, -6.4, 2.4, 1.6);

  const berries: [number, number][] = [
    [-3.2, 2.4],
    [2.6, 3.0],
  ];
  for (const [bx, by] of berries) {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(bx, by, 3.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx - 1.6, by - 1.6, 1.3, 1.3);
  }
  ctx.restore();
}

function drawJoustLedge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: RgbTuple,
): void {
  ctx.save();
  ctx.fillStyle = '#451a03';
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x + w, y + 2);
  ctx.lineTo(x + w - 7, y + h);
  ctx.lineTo(x + w * 0.62, y + h - 2);
  ctx.lineTo(x + w * 0.38, y + h + 1);
  ctx.lineTo(x + 7, y + h);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#78350f';
  ctx.fillRect(x + 3, y + 2, w - 6, h * 0.55);

  ctx.fillStyle = '#d97706';
  ctx.fillRect(x, y, w, 3.2);
  ctx.strokeStyle = rgbToCss(accent, 0.72);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(x, y + 0.5);
  ctx.lineTo(x + w, y + 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawJoustRider(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: 1 | -1,
  wingAngle: number,
  onGround: boolean,
  stridePhase: number,
  mountColor: string,
  knightColor: string,
  lanceColor: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);

  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  if (onGround) {
    const legSwing = Math.sin(stridePhase) * 3.5;
    ctx.beginPath();
    ctx.moveTo(-1, 3);
    ctx.lineTo(-1 + legSwing, 9);
    ctx.moveTo(2, 3);
    ctx.lineTo(2 - legSwing, 9);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-1, 3);
    ctx.lineTo(-3.5, 6.5);
    ctx.moveTo(2, 3);
    ctx.lineTo(0, 6.5);
    ctx.stroke();
  }

  ctx.fillStyle = mountColor;
  ctx.beginPath();
  ctx.ellipse(0, 1.2, 6.8, 3.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-8.5, -0.5, 3.2, 2.2);

  ctx.strokeStyle = mountColor;
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  ctx.moveTo(4.5, 0);
  ctx.lineTo(7.5, -6.5);
  ctx.stroke();
  ctx.fillRect(6.2, -8.2, 4.4, 2.6);
  ctx.fillStyle = '#fde047';
  ctx.fillRect(10.2, -7.6, 2.8, 1.5);

  ctx.fillStyle = '#fef3c7';
  ctx.beginPath();
  ctx.moveTo(1.5, 0.5);
  ctx.lineTo(-4.5, -2.5 + wingAngle * 6.5);
  ctx.lineTo(-6.2, 1.0 + wingAngle * 4.2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = knightColor;
  ctx.fillRect(-2.5, -6.2, 4.4, 5.2);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(-1.8, -9.2, 3.8, 3.2);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0.4, -8.2, 1.8, 1.1);

  ctx.strokeStyle = lanceColor;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-4, -4.2);
  ctx.lineTo(14.5, -4.2);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(13.5, -5.0, 2.2, 1.6);

  ctx.restore();
}

function drawPixelInvader(
  ctx: CanvasRenderingContext2D,
  ix: number,
  iy: number,
  invFrame: number,
  colorCss: string,
  pSize = 1.95,
): void {
  ctx.fillStyle = colorCss;
  for (let r = 0; r < INVADER_ROWS.length; r++) {
    const mask = INVADER_ROWS[r];
    for (let b = 0; b < 8; b++) {
      if ((mask >> (7 - b)) & 1) {
        const legShift = r === 5 ? (invFrame ? 1.0 : -1.0) : 0;
        ctx.fillRect(
          ix + (b - 4) * pSize + legShift,
          iy + (r - 3) * pSize,
          pSize - 0.15,
          pSize - 0.15,
        );
      }
    }
  }
}

/**
 * Mode 20: Arcade Crossfire [Hybrid V1 + V2 Edition]
 * - Retains 100% of V1's Pac-Man Neon Maze, Pellets, Cherries, Chomping Pac-Man & 3 Chasing Ghosts
 * - Retains 100% of V1's 8×8 Destructible Block Album Artwork + Dual Pong Balls Brickbreaker Physics
 * - Adds 3 Ground Missile Command Silos (ALPHA / OMEGA / DELTA) with Active vs. Destroyed/Inactive states
 * - Space Invaders do NOT shoot: instead, individual invaders detach from the upper formation and
 *   kamikaze-dive down toward the silos! Active silos fire counter-flak that usually intercepts them,
 *   but roughly ~18% of dives slip through and blow up a silo, inactivating it for ~20s!
 * - Choreographed Joust Knights on Ostriches/Buzzards get blasted into shrapnel & a bouncing Joust Egg
 *   whenever a Missile Command flak fireball detonates in their flight path!
 */
export function renderArcadeCrossfireScene(s: SceneRenderContext): void {
  const {
    ctx,
    timeSec,
    dt,
    beat,
    subBass,
    midEnergy,
    highEnergy,
    drop,
    trans,
    sb,
    palette,
    artCanvas,
    artReady,
    artRgb,
    activeLyric,
    activeComment,
    commentAvatarImg,
    trackTitle,
    cropTopY,
    cropBottomY,
    cropLeftX,
    cropRightX,
  } = s;

  const safeDt = Math.max(0.001, Math.min(0.05, dt || 1 / 60));
  const cx = CANVAS_W * 0.5;
  const cy = CANVAS_H * 0.5;

  const vLeft = Math.round(cropLeftX ?? 0);
  const vRight = Math.round(cropRightX ?? CANVAS_W);
  const vTop = Math.round(cropTopY ?? 0);
  const vBottom = Math.round(cropBottomY ?? CANVAS_H);

  const wallLeft = vLeft + 8;
  const wallRight = vRight - 8;
  const wallTop = vTop + 8;
  const wallBottom = vBottom - 8;
  const wallW = wallRight - wallLeft;
  const wallH = wallBottom - wallTop;

  // Reset destructible artwork blocks & repair silos on track change
  const sig = `${trackTitle}:${artReady ? 1 : 0}`;
  if (!artBlocksInitialized || sig !== lastTrackSignature) {
    lastTrackSignature = sig;
    resetArtBlocks();
    rebuildWaveUntilSec = timeSec + 0.65;
    siloDisabledUntil.fill(0);
    siloBlastUntil.fill(0);
  }

  // Handle clock seeks backward
  for (let i = 0; i < 3; i++) {
    if (siloDisabledUntil[i] > timeSec + 30) siloDisabledUntil[i] = 0;
    if (siloBlastUntil[i] > timeSec + 5) siloBlastUntil[i] = 0;
  }
  for (let j = 0; j < 2; j++) {
    if (joustHitUntil[j] > timeSec + 5) joustHitUntil[j] = 0;
  }

  // If all 3 silos have been knocked out, trigger a bonus city repair after 4s so the battle continues
  if (
    siloDisabledUntil[0] > timeSec &&
    siloDisabledUntil[1] > timeSec &&
    siloDisabledUntil[2] > timeSec
  ) {
    const earliest = Math.min(siloDisabledUntil[0], siloDisabledUntil[1], siloDisabledUntil[2]);
    if (earliest > timeSec + 4.0) {
      siloDisabledUntil[1] = timeSec + 3.5;
    }
  }

  // 1. Pure #000000 OLED CRT Playfield + Subtle Phosphor Grid
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.strokeStyle = rgbToCss(palette[2], 0.11);
  ctx.lineWidth = 1;
  for (let gx = 32; gx < CANVAS_W; gx += 32) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, CANVAS_H);
    ctx.stroke();
  }
  for (let gy = 32; gy < CANVAS_H; gy += 32) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(CANVAS_W, gy);
    ctx.stroke();
  }

  // 2. Outer Double-Wall Neon Maze Border + Inner Pac-Man Maze Corridors (from V1)
  const mazeWallColor = drop > 0.25 ? palette[7] : palette[4];
  ctx.save();
  ctx.strokeStyle = rgbToCss(mazeWallColor, 0.82 + beat * 0.18);
  ctx.lineWidth = 2.0;

  ctx.beginPath();
  ctx.roundRect(wallLeft, wallTop, wallW, wallH, 8);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(wallLeft + 4, wallTop + 4, wallW - 8, wallH - 8, 6);
  ctx.stroke();

  const artSize = 132;
  const coreX = cx - artSize * 0.5;
  const coreY = cy - artSize * 0.5;

  const innerWallPad = 6;
  const outerCorridorPad = 26;
  const mwInX = coreX - innerWallPad;
  const mwInY = coreY - innerWallPad;
  const mwInW = artSize + innerWallPad * 2;
  const mwInH = artSize + innerWallPad * 2;

  const mwOutX = coreX - outerCorridorPad;
  const mwOutY = coreY - outerCorridorPad;
  const mwOutW = artSize + outerCorridorPad * 2;
  const mwOutH = artSize + outerCorridorPad * 2;

  ctx.strokeStyle = rgbToCss(palette[5], 0.72);
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(mwInX, mwInY + 18);
  ctx.lineTo(mwInX, mwInY);
  ctx.lineTo(mwInX + mwInW, mwInY);
  ctx.lineTo(mwInX + mwInW, mwInY + 18);
  ctx.moveTo(mwInX, mwInY + mwInH - 18);
  ctx.lineTo(mwInX, mwInY + mwInH);
  ctx.lineTo(mwInX + mwInW, mwInY + mwInH);
  ctx.lineTo(mwInX + mwInW, mwInY + mwInH - 18);
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(mazeWallColor, 0.68);
  ctx.lineWidth = 2.0;
  const gateHalfH = 26;
  ctx.beginPath();
  ctx.moveTo(mwOutX, cy - gateHalfH);
  ctx.lineTo(mwOutX, mwOutY);
  ctx.lineTo(mwOutX + mwOutW, mwOutY);
  ctx.lineTo(mwOutX + mwOutW, cy - gateHalfH);
  ctx.moveTo(mwOutX, cy + gateHalfH);
  ctx.lineTo(mwOutX, mwOutY + mwOutH);
  ctx.lineTo(mwOutX + mwOutW, mwOutY + mwOutH);
  ctx.lineTo(mwOutX + mwOutW, cy + gateHalfH);
  ctx.stroke();

  const wingLeftX = Math.max(wallLeft + 44, mwOutX - 42);
  const wingRightX = Math.min(wallRight - 44, mwOutX + mwOutW + 42);
  ctx.beginPath();
  ctx.moveTo(wingLeftX, mwOutY + 6);
  ctx.lineTo(mwOutX - 12, mwOutY + 6);
  ctx.lineTo(mwOutX - 12, mwOutY + 28);
  ctx.moveTo(wingRightX, mwOutY + 6);
  ctx.lineTo(mwOutX + mwOutW + 12, mwOutY + 6);
  ctx.lineTo(mwOutX + mwOutW + 12, mwOutY + 28);
  ctx.moveTo(wingLeftX, mwOutY + mwOutH - 6);
  ctx.lineTo(mwOutX - 12, mwOutY + mwOutH - 6);
  ctx.lineTo(mwOutX - 12, mwOutY + mwOutH - 28);
  ctx.moveTo(wingRightX, mwOutY + mwOutH - 6);
  ctx.lineTo(mwOutX + mwOutW + 12, mwOutY + mwOutH - 6);
  ctx.lineTo(mwOutX + mwOutW + 12, mwOutY + mwOutH - 28);
  ctx.stroke();
  ctx.restore();

  // 3. Center 8×8 Destructible Block Album Artwork (`132×132` px Brickbreaker Grid)
  const blockSize = artSize / ART_GRID_N;
  const blockPad = 0.85;
  const isRebuilding = timeSec < rebuildWaveUntilSec;
  const rebuildProgress = isRebuilding ? 1 - (rebuildWaveUntilSec - timeSec) / 0.65 : 1;

  ctx.save();
  ctx.fillStyle = 'rgba(4, 7, 16, 0.86)';
  ctx.fillRect(coreX - 2, coreY - 2, artSize + 4, artSize + 4);

  let aliveCount = 0;
  for (let row = 0; row < ART_GRID_N; row++) {
    for (let col = 0; col < ART_GRID_N; col++) {
      const idx = row * ART_GRID_N + col;
      if (!artBlocksAlive[idx]) {
        const gx = coreX + col * blockSize + blockPad;
        const gy = coreY + row * blockSize + blockPad;
        const gw = blockSize - blockPad * 2;
        ctx.strokeStyle = rgbToCss(palette[3], 0.14);
        ctx.lineWidth = 0.7;
        ctx.strokeRect(gx + 1, gy + 1, gw - 2, gw - 2);
        continue;
      }
      aliveCount++;

      if (isRebuilding && (row + col) / (ART_GRID_N * 2) > rebuildProgress) {
        continue;
      }

      const bx = coreX + col * blockSize + blockPad;
      const by = coreY + row * blockSize + blockPad;
      const bw = blockSize - blockPad * 2;
      const bh = blockSize - blockPad * 2;

      if (artReady && artCanvas) {
        const srcSize = artCanvas.width / ART_GRID_N;
        ctx.drawImage(
          artCanvas,
          col * srcSize,
          row * srcSize,
          srcSize,
          srcSize,
          bx,
          by,
          bw,
          bh,
        );
      } else {
        const fallbackCol = palette[3 + ((row + col) & 3)];
        ctx.fillStyle = rgbToCss(fallbackCol, 0.85);
        ctx.fillRect(bx, by, bw, bh);
      }

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(bx, by, bw, bh);
    }
  }

  if (aliveCount <= 10 && !isRebuilding) {
    resetArtBlocks();
    rebuildWaveUntilSec = timeSec + 0.65;
  }

  // Pink Pac-Man Ghost-House doorway bar
  ctx.strokeStyle = '#fda4af';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(cx - 18, mwInY);
  ctx.lineTo(cx + 18, mwInY);
  ctx.stroke();
  ctx.restore();

  // 4. Inner Maze Pac-Man, 3 Ghosts, Power Pellets & Bonus Cherries (Orbiting the Art)
  const pacLoopX = coreX - 16;
  const pacLoopY = coreY - 16;
  const pacLoopW = artSize + 32;
  const pacLoopH = artSize + 32;
  const pacPerim = (pacLoopW + pacLoopH) * 2;

  const posOnInnerMaze = (dist: number): [number, number, number] => {
    const d = ((dist % pacPerim) + pacPerim) % pacPerim;
    if (d < pacLoopW) return [pacLoopX + d, pacLoopY, 0];
    if (d < pacLoopW + pacLoopH) {
      return [pacLoopX + pacLoopW, pacLoopY + (d - pacLoopW), Math.PI * 0.5];
    }
    if (d < pacLoopW * 2 + pacLoopH) {
      return [
        pacLoopX + pacLoopW - (d - (pacLoopW + pacLoopH)),
        pacLoopY + pacLoopH,
        Math.PI,
      ];
    }
    return [
      pacLoopX,
      pacLoopY + pacLoopH - (d - (pacLoopW * 2 + pacLoopH)),
      -Math.PI * 0.5,
    ];
  };

  const pacDist = (timeSec * 44) % pacPerim;
  const [pacX, pacY, pacRot] = posOnInnerMaze(pacDist);

  const cherrySlots = new Set([3, 10, 17, 24]);
  for (let p = 0; p < PELLET_COUNT; p++) {
    const slotDist = (p / PELLET_COUNT) * pacPerim;
    const [dotX, dotY] = posOnInnerMaze(slotDist);
    const dx = pacX - dotX;
    const dy = pacY - dotY;
    if (dx * dx + dy * dy < 64) {
      pelletRespawnAt[p] = timeSec + 6.5;
    }
    if (timeSec < pelletRespawnAt[p]) {
      continue;
    }

    if (cherrySlots.has(p)) {
      drawArcadeCherry(ctx, dotX, dotY, Math.sin(timeSec * 4 + p) * 0.5 + 0.5);
    } else {
      const isPower = p % 7 === 0;
      const r = isPower ? 3.2 + Math.sin(timeSec * 4.2 + p) * 0.9 : 1.5;
      ctx.fillStyle = isPower ? '#fde047' : '#fef08a';
      ctx.beginPath();
      ctx.arc(dotX, dotY, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Chomping Pac-Man
  const mouthAngle = 0.08 + Math.abs(Math.sin(timeSec * 6.8)) * 0.55;
  ctx.save();
  ctx.translate(pacX, pacY);
  ctx.rotate(pacRot);
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.arc(0, 0, 7.8, mouthAngle, Math.PI * 2 - mouthAngle);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 3 Chasing Ghosts (Blinky, Inky, Clyde)
  const ghostColors: RgbTuple[] = [
    [244, 63, 94],
    [56, 189, 248],
    [251, 146, 60],
  ];
  for (let g = 0; g < 3; g++) {
    const [gx, gy] = posOnInnerMaze(pacDist - 26 - g * 22);
    const isScared = drop > 0.2;
    const gCol: RgbTuple = isScared ? [59, 130, 246] : ghostColors[g];

    ctx.save();
    ctx.translate(gx, gy);
    ctx.fillStyle = rgbToCss(gCol, 0.95);
    ctx.beginPath();
    ctx.arc(0, -1.5, 6.8, Math.PI, Math.PI * 2);
    ctx.lineTo(6.8, 6.5);
    ctx.lineTo(3.4, 4.4);
    ctx.lineTo(0, 6.5);
    ctx.lineTo(-3.4, 4.4);
    ctx.lineTo(-6.8, 6.5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-2.4, -2, 2.0, 0, Math.PI * 2);
    ctx.arc(2.4, -2, 2.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(-2.0, -2, 1.0, 0, Math.PI * 2);
    ctx.arc(2.8, -2, 1.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 5. Space Invaders Upper Formation + Kamikaze Dive-Runs Toward the 3 Ground Silos!
  const invCols = 9;
  const invSpacingX = 36;
  const invFormationW = (invCols - 1) * invSpacingX;
  const invStepX = Math.sin(timeSec * 0.7) * 28;
  const invFrame = Math.floor(timeSec * 2.0) & 1;
  const invTopY = wallTop + 20;

  const siloXs = [wallLeft + 96, cx, wallRight - 96];
  const siloGroundY = wallBottom - 6;

  // Track which formation slots are currently detached on a dive run
  const divingSlotSet = new Set<number>();
  for (const run of divingRuns) {
    if (run.active) divingSlotSet.add(run.slotIndex);
  }

  // Render the marching upper formation (skipping any invader currently diving at a silo)
  const getFormationSlotPos = (slotIndex: number): [number, number] => {
    const row = Math.floor(slotIndex / invCols);
    const col = slotIndex % invCols;
    const ix = cx - invFormationW * 0.5 + col * invSpacingX + invStepX;
    const iy = invTopY + row * 17 + Math.sin(timeSec * 1.5 + col) * 1.4;
    return [ix, iy];
  };

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < invCols; col++) {
      const slotIdx = row * invCols + col;
      if (divingSlotSet.has(slotIdx)) continue;
      const [ix, iy] = getFormationSlotPos(slotIdx);
      const bandAmp = sb[(col + row * 4) & 15];
      const invColor = palette[4 + ((row + col) & 3)];
      drawPixelInvader(ctx, ix, iy, invFrame, rgbToCss(invColor, 0.8 + bandAmp * 0.2));
    }
  }

  // 6. Step & Render Kamikaze Diving Space Invaders vs. Ground Missile Command Silos!
  const activeFlakExplosions: [number, number, number][] = []; // [x, y, radius]

  for (let rIdx = 0; rIdx < divingRuns.length; rIdx++) {
    const run = divingRuns[rIdx];

    if (!run.active && run.explodingTimer <= 0) {
      // Launch a new kamikaze dive run toward a silo!
      diveRandomCounter = (diveRandomCounter * 1664525 + 1013904223) >>> 0;
      const targetSilo = (diveRandomCounter + rIdx) % 3;
      const slotIndex = (9 + ((diveRandomCounter >> 4) % 9)) % 18; // Prefer front row

      // Find which active silo can defend against this dive run
      let firingSilo = -1;
      if (siloDisabledUntil[targetSilo] <= timeSec) {
        firingSilo = targetSilo;
      } else {
        // Target silo is offline! See if an adjacent active silo can fire cross-screen cover flak
        for (let cand = 0; cand < 3; cand++) {
          if (siloDisabledUntil[cand] <= timeSec) {
            firingSilo = cand;
            break;
          }
        }
      }

      // Roughly ~18% low chance the diving Space Invader slips past flak and blows up the silo
      // (or ~32% if the target silo is already offline and relying on cross-fire)
      const hitRoll = ((diveRandomCounter >> 8) & 255) / 255;
      const threshold = firingSilo === targetSilo ? 0.18 : firingSilo >= 0 ? 0.30 : 1.0;

      run.active = true;
      run.slotIndex = slotIndex;
      run.targetSilo = targetSilo;
      run.firingSilo = firingSilo;
      run.progress = 0;
      run.speed = 0.34 + ((diveRandomCounter & 7) * 0.025) + subBass * 0.08;
      run.willHitSilo = hitRoll < threshold;
      run.interceptProgress = 0.50 + ((diveRandomCounter >> 12) & 15) * 0.012;
      run.explodingTimer = 0;
    }

    if (run.active) {
      run.progress += safeDt * run.speed * (1 + midEnergy * 0.25);

      const [startX, startY] = getFormationSlotPos(run.slotIndex);
      const dstX = siloXs[run.targetSilo];
      const dstY = siloGroundY - 12;

      // Weaving kamikaze dive trajectory from upper formation down toward the target silo
      const weaveX = Math.sin(run.progress * Math.PI * 3 + rIdx * 2.1) * 38 * (1 - run.progress * 0.7);
      const invX = startX + (dstX - startX) * run.progress + weaveX;
      const invY = startY + (dstY - startY) * Math.pow(run.progress, 1.12);

      // Draw the diving Space Invader (tinted hot orange/red on final attack dive!)
      const diveCol = run.progress > 0.6 ? '#fb7185' : rgbToCss(palette[6], 0.96);
      drawPixelInvader(ctx, invX, invY, invFrame, diveCol, 2.2);

      // If an active silo is defending, draw its ascending counter-missile tracking the diving invader!
      if (run.firingSilo >= 0 && siloDisabledUntil[run.firingSilo] <= timeSec) {
        const siloOriginX = siloXs[run.firingSilo];
        const siloOriginY = siloGroundY - 16;
        const missileT = Math.min(1, run.progress / run.interceptProgress);

        // If `willHitSilo` is true, the counter-missile misses slightly to the side!
        const missOffset = run.willHitSilo ? (rIdx === 0 ? -36 : 36) : 0;
        const mCurX = siloOriginX + (invX + missOffset - siloOriginX) * missileT;
        const mCurY = siloOriginY + (invY - siloOriginY) * missileT;

        if (run.progress <= run.interceptProgress) {
          ctx.save();
          ctx.strokeStyle = rgbToCss(palette[5 + rIdx], 0.78);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(siloOriginX, siloOriginY);
          ctx.lineTo(mCurX, mCurY);
          ctx.stroke();
          // Counter-missile warhead tip
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(mCurX - 1.5, mCurY - 1.5, 3, 3);
          ctx.restore();
        }
      }

      // Check if intercepted in mid-air by Silo Flak!
      if (
        !run.willHitSilo &&
        run.firingSilo >= 0 &&
        siloDisabledUntil[run.firingSilo] <= timeSec &&
        run.progress >= run.interceptProgress
      ) {
        run.active = false;
        run.explodingTimer = 0.55;
        run.explosionX = invX;
        run.explosionY = invY;
        spawnBlockShatter(invX, invY, palette[6] || [251, 146, 60], 8);
      } else if (run.progress >= 1.0) {
        // Direct Kamikaze Hit on the Ground Silo! Blow up and INACTIVATE that silo!
        run.active = false;
        run.explodingTimer = 0.75;
        run.explosionX = dstX;
        run.explosionY = dstY;
        siloDisabledUntil[run.targetSilo] = timeSec + 20.0;
        siloBlastUntil[run.targetSilo] = timeSec + 1.1;
        spawnBlockShatter(dstX, dstY, [244, 63, 94], 12);
      }
    }

    // Render active Missile Command Flak Fireball (and record it for Joust collision!)
    if (run.explodingTimer > 0) {
      run.explodingTimer -= safeDt;
      const expP = 1 - Math.max(0, run.explodingTimer) / 0.65;
      const blastR = (10 + Math.sin(expP * Math.PI) * (28 + highEnergy * 14));
      activeFlakExplosions.push([run.explosionX, run.explosionY, blastR]);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const blastGrad = ctx.createRadialGradient(
        run.explosionX,
        run.explosionY,
        1,
        run.explosionX,
        run.explosionY,
        Math.max(4, blastR),
      );
      blastGrad.addColorStop(0, '#ffffff');
      blastGrad.addColorStop(0.45, rgbToCss(palette[7], 0.86));
      blastGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = blastGrad;
      ctx.beginPath();
      ctx.arc(run.explosionX, run.explosionY, Math.max(4, blastR), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 7. Render the 3 Ground Missile Command Silos (`ALPHA`, `OMEGA`, `DELTA` — Active vs. Inactivated Crater)
  const siloNames = ['ALPHA', 'OMEGA', 'DELTA'];
  for (let si = 0; si < 3; si++) {
    const sx = siloXs[si];
    const isInactive = timeSec < siloDisabledUntil[si];
    const isBlasting = timeSec < siloBlastUntil[si];

    ctx.save();
    if (isInactive) {
      // Destroyed / Inactivated Silo Crater with smoking embers & offline badge
      ctx.fillStyle = '#1e1b24';
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(sx - 28, siloGroundY);
      ctx.lineTo(sx - 18, siloGroundY - 6);
      ctx.lineTo(sx - 8, siloGroundY - 2);
      ctx.lineTo(sx + 6, siloGroundY - 5);
      ctx.lineTo(sx + 18, siloGroundY - 2);
      ctx.lineTo(sx + 28, siloGroundY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Rising smoke / ember particles from the ruined silo
      for (let sm = 0; sm < 3; sm++) {
        const smY = siloGroundY - 6 - ((timeSec * 18 + sm * 7) % 18);
        const smX = sx + (sm - 1) * 7 + Math.sin(timeSec * 5 + sm) * 3;
        ctx.fillStyle = isBlasting ? '#fb7185' : 'rgba(148, 163, 184, 0.55)';
        ctx.fillRect(smX - 2, smY - 2, 4, 4);
      }

      ctx.font = '800 7.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fb7185';
      ctx.fillText('OFFLINE', sx, siloGroundY - 12);
    } else {
      // Intact Armored Missile Command Silo Bunker + 3 Ready Warheads
      ctx.fillStyle = rgbToCss(palette[2], 0.94);
      ctx.strokeStyle = rgbToCss(palette[6], 0.92);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx - 28, siloGroundY);
      ctx.lineTo(sx - 16, siloGroundY - 15);
      ctx.lineTo(sx + 16, siloGroundY - 15);
      ctx.lineTo(sx + 28, siloGroundY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 3 Upright Anti-Ballistic Missiles inside the Silo
      ctx.fillStyle = '#fef08a';
      for (let m = -1; m <= 1; m++) {
        ctx.fillRect(sx + m * 7 - 1.5, siloGroundY - 11, 3, 7);
      }
      ctx.font = '800 7px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = rgbToCss(palette[7], 0.78);
      ctx.fillText(siloNames[si], sx, siloGroundY - 18);
    }
    ctx.restore();
  }

  // 8. Williams *Joust* Stone Ledges + 2 Choreographed Jousting Knights (Blasted by Flak!)
  const ledgeW = 78;
  const ledgeH = 9;
  const leftLedgeX = wallLeft + 26;
  const rightLedgeX = wallRight - 26 - ledgeW;
  const topLedgeY = wallTop + 68;
  const botLedgeY = wallBottom - 62;

  const joustLedges: [number, number, number, number][] = [
    [leftLedgeX, topLedgeY, ledgeW, ledgeH],
    [rightLedgeX, topLedgeY, ledgeW, ledgeH],
    [leftLedgeX, botLedgeY, ledgeW, ledgeH],
    [rightLedgeX, botLedgeY, ledgeW, ledgeH],
  ];
  for (const [lx, ly, lw, lh] of joustLedges) {
    drawJoustLedge(ctx, lx, ly, lw, lh, palette[6]);
  }

  // Compute Choreographed Positions for Joust Knight 1 & Joust Knight 2
  const j1Cycle = (timeSec * 0.52) % 2;
  const j1Phase = j1Cycle < 1 ? j1Cycle : 2 - j1Cycle;
  const j1OnLedge = j1Phase < 0.16 || j1Phase > 0.84;
  const j1X = leftLedgeX + 18 + j1Phase * 62 + Math.sin(timeSec * 1.35) * 20;
  const j1BaseY = (botLedgeY - 9) * (1 - j1Phase) + (topLedgeY - 9) * j1Phase;
  const j1Arc = j1OnLedge ? 0 : Math.sin(j1Phase * Math.PI) * 26;
  const j1Y = j1BaseY - j1Arc - Math.abs(Math.sin(timeSec * 6.5)) * (j1OnLedge ? 0 : 4);
  const j1Wing = j1OnLedge ? 0.1 : Math.sin(timeSec * 11.5);
  const j1Facing: 1 | -1 = Math.cos(timeSec * 1.35) >= -0.2 ? 1 : -1;

  const j2Cycle = ((timeSec * 0.56) + 0.85) % 2;
  const j2Phase = j2Cycle < 1 ? j2Cycle : 2 - j2Cycle;
  const j2OnLedge = j2Phase < 0.16 || j2Phase > 0.84;
  const j2X = rightLedgeX + ledgeW - 18 - j2Phase * 62 + Math.cos(timeSec * 1.25) * 20;
  const j2BaseY = (topLedgeY - 9) * (1 - j2Phase) + (botLedgeY - 9) * j2Phase;
  const j2Arc = j2OnLedge ? 0 : Math.sin(j2Phase * Math.PI) * 26;
  const j2Y = j2BaseY - j2Arc - Math.abs(Math.cos(timeSec * 6.8)) * (j2OnLedge ? 0 : 4);
  const j2Wing = j2OnLedge ? 0.1 : Math.sin(timeSec * 12.2 + 1.2);
  const j2Facing: 1 | -1 = Math.sin(timeSec * 1.25) <= 0.2 ? -1 : 1;

  const joustStates = [
    {
      idx: 0,
      x: j1X,
      y: j1Y,
      facing: j1Facing,
      wing: j1Wing,
      onLedge: j1OnLedge,
      stride: timeSec * 10,
      mountCol: '#f59e0b',
      knightCol: '#38bdf8',
      lanceCol: '#fef08a',
      ledgeX: leftLedgeX + ledgeW * 0.5,
      ledgeY: botLedgeY - 4.2,
    },
    {
      idx: 1,
      x: j2X,
      y: j2Y,
      facing: j2Facing,
      wing: j2Wing,
      onLedge: j2OnLedge,
      stride: timeSec * 10.5,
      mountCol: '#dc2626',
      knightCol: '#f43f5e',
      lanceCol: '#fda4af',
      ledgeX: rightLedgeX + ledgeW * 0.68,
      ledgeY: botLedgeY - 4.2,
    },
  ];

  for (const jk of joustStates) {
    // Check if an active Missile Command flak fireball caught this Joust Knight!
    if (timeSec >= joustHitUntil[jk.idx]) {
      for (const [fx, fy, fr] of activeFlakExplosions) {
        if (Math.hypot(jk.x - fx, jk.y - fy) < fr + 22) {
          joustHitUntil[jk.idx] = timeSec + 2.2;
          joustHitOriginX[jk.idx] = jk.x;
          joustHitOriginY[jk.idx] = jk.y;
          spawnBlockShatter(jk.x, jk.y, [245, 158, 11], 10);
          break;
        }
      }
    }

    if (timeSec < joustHitUntil[jk.idx]) {
      // Joust Knight was blasted by Flak! Render a Bouncing Green Joust Egg dropping toward their ledge!
      const hitElapsed = 2.2 - (joustHitUntil[jk.idx] - timeSec);
      const hitT = Math.max(0, Math.min(1, hitElapsed / 2.2));
      const eggX = joustHitOriginX[jk.idx] + (jk.ledgeX - joustHitOriginX[jk.idx]) * hitT;
      const bounceY = Math.abs(Math.sin(hitT * Math.PI * 3.5)) * (26 * (1 - hitT * 0.6));
      const eggY =
        joustHitOriginY[jk.idx] + (jk.ledgeY - joustHitOriginY[jk.idx]) * hitT - bounceY;

      ctx.save();
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.ellipse(eggX, eggY, 3.8, 4.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#bbf7d0';
      ctx.fillRect(eggX - 1.2, eggY - 2.2, 1.5, 1.5);
      ctx.restore();
    } else {
      drawJoustRider(
        ctx,
        jk.x,
        jk.y,
        jk.facing,
        jk.wing,
        jk.onLedge,
        jk.stride,
        jk.mountCol,
        jk.knightCol,
        jk.lanceCol,
      );
    }
  }

  // 9. Pong Paddles & Dual Pong Balls Colliding With and Destroying the Artwork Blocks (Brickbreaker!)
  const leftPadX = wallLeft + 16;
  const rightPadX = wallRight - 21;
  const minPlayY = wallTop + 52;
  const maxPlayY = wallBottom - 52;

  for (let bi = 0; bi < pongBalls.length; bi++) {
    const ball = pongBalls[bi];
    const speedScale = 1 + midEnergy * 0.25 + beat * 0.18;
    ball.x += ball.vx * safeDt * speedScale;
    ball.y += ball.vy * safeDt * speedScale;

    if (ball.y < minPlayY) {
      ball.y = minPlayY;
      ball.vy = Math.abs(ball.vy);
    } else if (ball.y > maxPlayY) {
      ball.y = maxPlayY;
      ball.vy = -Math.abs(ball.vy);
    }

    if (ball.x <= leftPadX + 7) {
      ball.x = leftPadX + 7;
      ball.vx = Math.abs(ball.vx);
      const aimY = cy + Math.sin(timeSec * 1.9 + bi * 2.1) * (artSize * 0.44);
      ball.vy = Math.max(-135, Math.min(135, (aimY - ball.y) * 0.72));
    } else if (ball.x >= rightPadX - 4) {
      ball.x = rightPadX - 4;
      ball.vx = -Math.abs(ball.vx);
      const aimY = cy + Math.cos(timeSec * 1.7 + bi * 1.9) * (artSize * 0.44);
      ball.vy = Math.max(-135, Math.min(135, (aimY - ball.y) * 0.72));
    }

    // Brickbreaker Collision against the 8×8 Destructible Album Artwork Blocks
    if (
      ball.x + 4 >= coreX &&
      ball.x - 4 <= coreX + artSize &&
      ball.y + 4 >= coreY &&
      ball.y - 4 <= coreY + artSize
    ) {
      const col = Math.max(
        0,
        Math.min(ART_GRID_N - 1, Math.floor((ball.x - coreX) / blockSize)),
      );
      const row = Math.max(
        0,
        Math.min(ART_GRID_N - 1, Math.floor((ball.y - coreY) / blockSize)),
      );
      const bIdx = row * ART_GRID_N + col;

      if (artBlocksAlive[bIdx]) {
        artBlocksAlive[bIdx] = 0;

        let sparkRgb: RgbTuple = palette[6] || [56, 189, 248];
        if (artReady && artRgb && artRgb.length >= 128 * 128 * 3) {
          const sx = Math.min(127, Math.floor(((col + 0.5) / ART_GRID_N) * 128));
          const sy = Math.min(127, Math.floor(((row + 0.5) / ART_GRID_N) * 128));
          const pOff = (sy * 128 + sx) * 3;
          sparkRgb = [artRgb[pOff], artRgb[pOff + 1], artRgb[pOff + 2]];
        }

        const blockCx = coreX + (col + 0.5) * blockSize;
        const blockCy = coreY + (row + 0.5) * blockSize;
        spawnBlockShatter(blockCx, blockCy, sparkRgb, 6);

        const dx = ball.x - blockCx;
        const dy = ball.y - blockCy;
        if (Math.abs(dx) >= Math.abs(dy)) {
          ball.vx = dx >= 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx);
        } else {
          ball.vy = dy >= 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy);
        }
      }
    }
  }

  const leftTargetBall = pongBalls[0].vx < 0 ? pongBalls[0] : pongBalls[1];
  const rightTargetBall = pongBalls[0].vx > 0 ? pongBalls[0] : pongBalls[1];
  const leftPadY = Math.max(minPlayY + 18, Math.min(maxPlayY - 18, leftTargetBall.y));
  const rightPadY = Math.max(minPlayY + 18, Math.min(maxPlayY - 18, rightTargetBall.y));

  ctx.fillStyle = rgbToCss(palette[7], 0.94);
  ctx.fillRect(leftPadX, leftPadY - 18, 5, 36);
  ctx.fillRect(rightPadX, rightPadY - 18, 5, 36);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgbToCss(palette[5], 0.5 + midEnergy * 0.28);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let px = leftPadX + 6; px <= rightPadX - 2; px += 8) {
    const bandVal = sb[Math.floor(px / 36) & 15];
    const py =
      cy +
      Math.sin(px * 0.045 + timeSec * 3.5) *
        (6 + bandVal * 18) *
        (1 - Math.min(1, Math.abs(px - pongBalls[0].x) / 220));
    if (px === leftPadX + 6) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  for (const ball of pongBalls) {
    ctx.fillStyle = rgbToCss(palette[ball.colorIdx], 0.45);
    ctx.beginPath();
    ctx.arc(ball.x - ball.vx * 0.025, ball.y - ball.vy * 0.025, 3.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 4.2 + beat * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Render & update album-art block & shrapnel sparks
  for (let i = blockSparks.length - 1; i >= 0; i--) {
    const sp = blockSparks[i];
    sp.x += sp.vx * safeDt;
    sp.y += sp.vy * safeDt;
    sp.vy += 90 * safeDt;
    sp.life -= safeDt;
    if (sp.life <= 0) {
      blockSparks.splice(i, 1);
      continue;
    }
    const alpha = Math.max(0, sp.life / sp.maxLife);
    ctx.fillStyle = `rgba(${sp.r}, ${sp.g}, ${sp.b}, ${alpha.toFixed(2)})`;
    ctx.fillRect(sp.x - 1.8, sp.y - 1.8, 3.6, 3.6);
  }
  ctx.restore();

  // 10A. Diegetic Arcade Stage Briefing Banner for `activeLyric` (Lower Center)
  const cleanLyric = (activeLyric || '').trim();
  if (cleanLyric.length > 0) {
    const lines = splitIntoBalancedLines(`♪ ${cleanLyric.toUpperCase()} ♪`, 38);
    const bannerY = wallBottom - 34;
    const boxW = Math.min(wallW - 40, Math.max(220, lines[0].length * 8.4 + 36));
    const boxH = lines.length * 16 + 12;

    ctx.save();
    ctx.translate(cx, bannerY);
    ctx.fillStyle = 'rgba(4, 7, 16, 0.90)';
    ctx.strokeStyle = rgbToCss(palette[7], 0.95);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(-boxW * 0.5, -boxH * 0.5, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = '900 11.5px "JetBrains Mono", "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fef08a';
    for (let li = 0; li < lines.length; li++) {
      const ly = (li - (lines.length - 1) * 0.5) * 15;
      ctx.fillText(lines[li], 0, ly);
    }
    ctx.restore();
  }

  // 10B. Top Arcade `1UP CHALLENGER @USERNAME` Marquee for SC Comments
  if (activeComment && activeComment.username && activeComment.body) {
    const chalW = 264;
    const chalH = 34;
    const chalX = cx - chalW * 0.5;
    const chalY = wallTop + 46;

    ctx.save();
    ctx.fillStyle = 'rgba(6, 9, 20, 0.92)';
    ctx.strokeStyle = rgbToCss(palette[6], 0.95);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(chalX, chalY, chalW, chalH, 6);
    ctx.fill();
    ctx.stroke();

    let textX = chalX + 12;
    if (commentAvatarImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(chalX + 20, chalY + chalH * 0.5, 10, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(commentAvatarImg, chalX + 10, chalY + chalH * 0.5 - 10, 20, 20);
      ctx.restore();
      textX = chalX + 35;
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '900 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#facc15';
    ctx.fillText(`1UP @${activeComment.username.toUpperCase()}`, textX, chalY + 11);

    ctx.font = '700 10.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#f8fafc';
    const maxBody = activeComment.body.trim().slice(0, 32);
    ctx.fillText(
      `“${maxBody}${activeComment.body.length > 32 ? '…' : ''}”`,
      textX,
      chalY + 24,
    );
    ctx.restore();
  }

  // 11. CRT Degauss Collapse Transition
  if (trans > 0.01) {
    const beamH = Math.max(2, (1 - Math.sin(trans * Math.PI)) * CANVAS_H);
    ctx.fillStyle = `rgba(255, 255, 255, ${(Math.sin(trans * Math.PI) * 0.45).toFixed(2)})`;
    ctx.fillRect(0, cy - beamH * 0.5, CANVAS_W, beamH);
  }
}
