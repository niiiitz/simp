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

// Destructible 8×8 Album Art Block Grid + Pong Ball Physics + Block Shatter Particles
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

const MAX_SPARKS = 64;
const blockSparks: BlockSpark[] = [];

// Pac-Man Pellet & Cherry Respawn State along the Inner Maze Loop (28 slots)
const PELLET_COUNT = 28;
const pelletRespawnAt = new Float64Array(PELLET_COUNT);

function resetArtBlocks(): void {
  artBlocksAlive.fill(1);
  artBlocksInitialized = true;
}

function spawnBlockShatter(
  bx: number,
  by: number,
  rgb: RgbTuple,
): void {
  for (let i = 0; i < 6; i++) {
    if (blockSparks.length >= MAX_SPARKS) {
      blockSparks.shift();
    }
    const angle = (i / 6) * Math.PI * 2 + (i % 2) * 0.35;
    const speed = 36 + (i % 3) * 28;
    blockSparks.push({
      x: bx,
      y: by,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 14,
      r: rgb[0],
      g: rgb[1],
      b: rgb[2],
      life: 0.55,
      maxLife: 0.55,
    });
  }
}

/**
 * Draws a classic Arcade Bonus Cherry pair (🍒) with dual red berries, specular shine, and green stems.
 */
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

  // Curved green stems meeting at top-right leaf node
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-3.2, 1.5);
  ctx.quadraticCurveTo(-1, -4.5, 3.2, -5.5);
  ctx.moveTo(2.8, 2.2);
  ctx.quadraticCurveTo(3.4, -2.2, 3.2, -5.5);
  ctx.stroke();

  // Stem tip highlight
  ctx.fillStyle = '#86efac';
  ctx.fillRect(2.2, -6.4, 2.4, 1.6);

  // Left and Right Red Cherries
  const berries: [number, number][] = [
    [-3.2, 2.4],
    [2.6, 3.0],
  ];
  for (const [bx, by] of berries) {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(bx, by, 3.1, 0, Math.PI * 2);
    ctx.fill();

    // Crisp white arcade pixel shine
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx - 1.6, by - 1.6, 1.3, 1.3);
  }

  ctx.restore();
}

/**
 * Draws a textured Williams *Joust* floating stone ledge with chiseled rock bevels.
 */
function drawJoustLedge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: RgbTuple,
): void {
  ctx.save();
  // Chiseled underside rock strata
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

  // Mid bronze crag layer
  ctx.fillStyle = '#78350f';
  ctx.fillRect(x + 3, y + 2, w - 6, h * 0.55);

  // Top glowing runway surface
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

/**
 * Draws an animated Williams *Joust* Flying Ostrich / Buzzard Rider with flapping wings,
 * striding/tucked legs, knight helmet, and horizontal jousting lance.
 */
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

  // Legs (striding on ledge vs. tucked in flight)
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

  // Bird torso & tail feathers
  ctx.fillStyle = mountColor;
  ctx.beginPath();
  ctx.ellipse(0, 1.2, 6.8, 3.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-8.5, -0.5, 3.2, 2.2);

  // Neck & head + beak
  ctx.strokeStyle = mountColor;
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  ctx.moveTo(4.5, 0);
  ctx.lineTo(7.5, -6.5);
  ctx.stroke();
  ctx.fillRect(6.2, -8.2, 4.4, 2.6);
  ctx.fillStyle = '#fde047';
  ctx.fillRect(10.2, -7.6, 2.8, 1.5);

  // Flapping wing
  ctx.fillStyle = '#fef3c7';
  ctx.beginPath();
  ctx.moveTo(1.5, 0.5);
  ctx.lineTo(-4.5, -2.5 + wingAngle * 6.5);
  ctx.lineTo(-6.2, 1.0 + wingAngle * 4.2);
  ctx.closePath();
  ctx.fill();

  // Jousting Knight torso + visored helmet sitting in saddle
  ctx.fillStyle = knightColor;
  ctx.fillRect(-2.5, -6.2, 4.4, 5.2);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(-1.8, -9.2, 3.8, 3.2);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0.4, -8.2, 1.8, 1.1);

  // Horizontal Jousting Lance (couching forward)
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

/**
 * Scene `e` — Retro Arcade Remix (High-DPI Canvas2D)
 * - Full-viewport double-wall arcade playfield adapted to `cropLeftX..cropRightX` & `cropTopY..cropBottomY`
 *   (eliminates the top/side black border on 1280×800 Steam Deck and ultrawide panels)
 * - Large 8×8 Destructible Block Album Artwork (`132×132` logical px) in center: Pong balls physically
 *   collide with and shatter individual artwork blocks into color-matched pixel sparks!
 * - Inner Pac-Man Neon Maze & Bonus Cherries (`🍒`) around the inside of the artwork so Pac-Man & Ghosts
 *   navigate their own dedicated maze corridors instead of overlapping the Space Invaders
 * - 4 Williams *Joust* stone ledges + 2 flying/jumping Jousting Knights on flapping Ostriches/Buzzards
 */
export function renderArcadeScene(s: SceneRenderContext): void {
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

  // Visible viewport bounds (handles 1280×800 16:10 Steam Deck, 16:9, and 21:9 ultrawide)
  const vLeft = Math.round(cropLeftX ?? 0);
  const vRight = Math.round(cropRightX ?? CANVAS_W);
  const vTop = Math.round(cropTopY ?? 0);
  const vBottom = Math.round(cropBottomY ?? CANVAS_H);

  // Outer double-wall cabinet border pushed right out near the visible screen edges
  const wallLeft = vLeft + 8;
  const wallRight = vRight - 8;
  const wallTop = vTop + 8;
  const wallBottom = vBottom - 8;
  const wallW = wallRight - wallLeft;
  const wallH = wallBottom - wallTop;

  // Reset destructible artwork blocks on first run or track change
  const sig = `${trackTitle}:${artReady ? 1 : 0}`;
  if (!artBlocksInitialized || sig !== lastTrackSignature) {
    lastTrackSignature = sig;
    resetArtBlocks();
    rebuildWaveUntilSec = timeSec + 0.65;
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

  // 2. Expanded Outer Double-Wall Neon Maze Border + Inner Pac-Man Maze Corridors
  const mazeWallColor = drop > 0.25 ? palette[7] : palette[4];
  ctx.save();
  ctx.strokeStyle = rgbToCss(mazeWallColor, 0.82 + beat * 0.18);
  ctx.lineWidth = 2.0;

  // Outer double-wall frame tight to the visible viewport
  ctx.beginPath();
  ctx.roundRect(wallLeft, wallTop, wallW, wallH, 8);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(wallLeft + 4, wallTop + 4, wallW - 8, wallH - 8, 6);
  ctx.stroke();

  // Large Central Destructible Album Artwork Bounds (`132×132` square, 8×8 blocks)
  const artSize = 132;
  const coreX = cx - artSize * 0.5;
  const coreY = cy - artSize * 0.5;

  // Inner Pac-Man Maze Track surrounding the Album Artwork
  // Inner wall hugs the artwork; outer corridor wall sits 22px outside it with side gates for Pong balls
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

  // Inner maze frame around the destructible art (with side openings so Pong balls hit the blocks!)
  ctx.strokeStyle = rgbToCss(palette[5], 0.72);
  ctx.lineWidth = 1.8;
  // Top cap of inner art frame
  ctx.beginPath();
  ctx.moveTo(mwInX, mwInY + 18);
  ctx.lineTo(mwInX, mwInY);
  ctx.lineTo(mwInX + mwInW, mwInY);
  ctx.lineTo(mwInX + mwInW, mwInY + 18);
  // Bottom cap of inner art frame
  ctx.moveTo(mwInX, mwInY + mwInH - 18);
  ctx.lineTo(mwInX, mwInY + mwInH);
  ctx.lineTo(mwInX + mwInW, mwInY + mwInH);
  ctx.lineTo(mwInX + mwInW, mwInY + mwInH - 18);
  ctx.stroke();

  // Outer Pac-Man maze corridor walls (top & bottom brackets + 4 classic T-bar maze dividers)
  ctx.strokeStyle = rgbToCss(mazeWallColor, 0.68);
  ctx.lineWidth = 2.0;
  const gateHalfH = 26;
  // Upper outer maze bracket around Pac-Man's track
  ctx.beginPath();
  ctx.moveTo(mwOutX, cy - gateHalfH);
  ctx.lineTo(mwOutX, mwOutY);
  ctx.lineTo(mwOutX + mwOutW, mwOutY);
  ctx.lineTo(mwOutX + mwOutW, cy - gateHalfH);
  // Lower outer maze bracket around Pac-Man's track
  ctx.moveTo(mwOutX, cy + gateHalfH);
  ctx.lineTo(mwOutX, mwOutY + mwOutH);
  ctx.lineTo(mwOutX + mwOutW, mwOutY + mwOutH);
  ctx.lineTo(mwOutX + mwOutW, cy + gateHalfH);
  ctx.stroke();

  // Classic Pac-Man L-channel maze islands flanking the corridor
  const wingLeftX = Math.max(wallLeft + 44, mwOutX - 42);
  const wingRightX = Math.min(wallRight - 44, mwOutX + mwOutW + 42);
  ctx.beginPath();
  // Upper-left & upper-right L-bars
  ctx.moveTo(wingLeftX, mwOutY + 6);
  ctx.lineTo(mwOutX - 12, mwOutY + 6);
  ctx.lineTo(mwOutX - 12, mwOutY + 28);
  ctx.moveTo(wingRightX, mwOutY + 6);
  ctx.lineTo(mwOutX + mwOutW + 12, mwOutY + 6);
  ctx.lineTo(mwOutX + mwOutW + 12, mwOutY + 28);
  // Lower-left & lower-right L-bars
  ctx.moveTo(wingLeftX, mwOutY + mwOutH - 6);
  ctx.lineTo(mwOutX - 12, mwOutY + mwOutH - 6);
  ctx.lineTo(mwOutX - 12, mwOutY + mwOutH - 28);
  ctx.moveTo(wingRightX, mwOutY + mwOutH - 6);
  ctx.lineTo(mwOutX + mwOutW + 12, mwOutY + mwOutH - 6);
  ctx.lineTo(mwOutX + mwOutW + 12, mwOutY + mwOutH - 28);
  ctx.stroke();
  ctx.restore();

  // 3. Center 8×8 Destructible Block Album Artwork (`132×132` px)
  const blockSize = artSize / ART_GRID_N; // 16.5px per block
  const blockPad = 0.85;
  const isRebuilding = timeSec < rebuildWaveUntilSec;
  const rebuildProgress = isRebuilding
    ? 1 - (rebuildWaveUntilSec - timeSec) / 0.65
    : 1;

  // Dark recessed Ghost-House / Breakout socket behind the blocks
  ctx.save();
  ctx.fillStyle = 'rgba(4, 7, 16, 0.86)';
  ctx.fillRect(coreX - 2, coreY - 2, artSize + 4, artSize + 4);

  let aliveCount = 0;
  for (let row = 0; row < ART_GRID_N; row++) {
    for (let col = 0; col < ART_GRID_N; col++) {
      const idx = row * ART_GRID_N + col;
      if (!artBlocksAlive[idx]) {
        // Subtle ghost grid outline where a block was destroyed
        const gx = coreX + col * blockSize + blockPad;
        const gy = coreY + row * blockSize + blockPad;
        const gw = blockSize - blockPad * 2;
        ctx.strokeStyle = rgbToCss(palette[3], 0.14);
        ctx.lineWidth = 0.7;
        ctx.strokeRect(gx + 1, gy + 1, gw - 2, gw - 2);
        continue;
      }
      aliveCount++;

      // Rebuild wave animation from top-left to bottom-right
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

      // Crisp Breakout-style arcade block bevel
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(bx, by, bw, bh);
    }
  }

  // Trigger stage-clear block regeneration when most blocks have been smashed by Pong balls
  if (aliveCount <= 10 && !isRebuilding) {
    resetArtBlocks();
    rebuildWaveUntilSec = timeSec + 0.65;
  }

  // Pink Pac-Man Ghost-House doorway bar at the top center of the art frame
  ctx.strokeStyle = '#fda4af';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(cx - 18, mwInY);
  ctx.lineTo(cx + 18, mwInY);
  ctx.stroke();
  ctx.restore();

  // 4. Inner Maze Pac-Man, Ghosts, Power Pellets & Bonus Cherries (Orbiting Around the Art)
  const pacLoopX = coreX - 16;
  const pacLoopY = coreY - 16;
  const pacLoopW = artSize + 32; // 164
  const pacLoopH = artSize + 32; // 164
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

  // Pac-Man travels smoothly around the inside maze loop around the album art
  const pacDist = (timeSec * 44) % pacPerim;
  const [pacX, pacY, pacRot] = posOnInnerMaze(pacDist);

  // Check pellet/cherry eating along the inner maze loop
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

  // Draw Pac-Man on the inner maze track
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

  // 3 Chasing Arcade Ghosts following Pac-Man in the inner maze
  const ghostColors: RgbTuple[] = [
    [244, 63, 94], // Blinky (Red)
    [56, 189, 248], // Inky (Cyan)
    [251, 146, 60], // Clyde (Orange)
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

  // 5. Space Invaders Upper Formation Marching Cleanly in the Top Sky Zone
  const invCols = 9;
  const invSpacingX = 36;
  const invFormationW = (invCols - 1) * invSpacingX;
  const invStepX = Math.sin(timeSec * 0.7) * 28;
  const invFrame = Math.floor(timeSec * 2.0) & 1;
  const invTopY = wallTop + 20;

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < invCols; col++) {
      const ix = cx - invFormationW * 0.5 + col * invSpacingX + invStepX;
      const iy = invTopY + row * 17 + Math.sin(timeSec * 1.5 + col) * 1.4;
      const bandAmp = sb[(col + row * 4) & 15];
      const invColor = palette[4 + ((row + col) & 3)];
      ctx.fillStyle = rgbToCss(invColor, 0.8 + bandAmp * 0.2);

      const pSize = 1.95;
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
  }

  // 6. Williams *Joust* Stone Ledges + 2 Flying/Jumping Jousting Knights
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

  // Joust Knight 1 (Left Patrol & Mid-Air Joust Leap — Gold Ostrich + Cyan Knight)
  const j1Cycle = (timeSec * 0.52) % 2; // 0..1: jump from bottom-left to top-left & mid-field; 1..2: swoop back
  const j1Phase = j1Cycle < 1 ? j1Cycle : 2 - j1Cycle;
  const j1OnLedge = j1Phase < 0.16 || j1Phase > 0.84;
  const j1X =
    leftLedgeX +
    18 +
    j1Phase * 52 +
    Math.sin(timeSec * 1.35) * 18;
  const j1BaseY =
    (botLedgeY - 9) * (1 - j1Phase) + (topLedgeY - 9) * j1Phase;
  const j1Arc = j1OnLedge ? 0 : Math.sin(j1Phase * Math.PI) * 26;
  const j1Y = j1BaseY - j1Arc - Math.abs(Math.sin(timeSec * 6.5)) * (j1OnLedge ? 0 : 4);
  const j1Wing = j1OnLedge ? 0.1 : Math.sin(timeSec * 11.5);
  const j1Facing: 1 | -1 = Math.cos(timeSec * 1.35) >= -0.2 ? 1 : -1;

  drawJoustRider(
    ctx,
    j1X,
    j1Y,
    j1Facing,
    j1Wing,
    j1OnLedge,
    timeSec * 10,
    '#f59e0b',
    '#38bdf8',
    '#fef08a',
  );

  // Joust Knight 2 (Right Patrol & Mid-Air Joust Leap — Crimson Buzzard + Red Shadow Knight)
  const j2Cycle = ((timeSec * 0.56) + 0.85) % 2;
  const j2Phase = j2Cycle < 1 ? j2Cycle : 2 - j2Cycle;
  const j2OnLedge = j2Phase < 0.16 || j2Phase > 0.84;
  const j2X =
    rightLedgeX +
    ledgeW -
    18 -
    j2Phase * 52 +
    Math.cos(timeSec * 1.25) * 18;
  const j2BaseY =
    (topLedgeY - 9) * (1 - j2Phase) + (botLedgeY - 9) * j2Phase;
  const j2Arc = j2OnLedge ? 0 : Math.sin(j2Phase * Math.PI) * 26;
  const j2Y = j2BaseY - j2Arc - Math.abs(Math.cos(timeSec * 6.8)) * (j2OnLedge ? 0 : 4);
  const j2Wing = j2OnLedge ? 0.1 : Math.sin(timeSec * 12.2 + 1.2);
  const j2Facing: 1 | -1 = Math.sin(timeSec * 1.25) <= 0.2 ? -1 : 1;

  drawJoustRider(
    ctx,
    j2X,
    j2Y,
    j2Facing,
    j2Wing,
    j2OnLedge,
    timeSec * 10.5,
    '#dc2626',
    '#f43f5e',
    '#fda4af',
  );

  // Collectible Green Joust Egg sitting on the lower-right ledge (pulses on beat)
  const eggX = rightLedgeX + ledgeW * 0.68;
  const eggY = botLedgeY - 4.2 - Math.abs(Math.sin(timeSec * 3.2)) * 2.5;
  ctx.save();
  ctx.fillStyle = '#4ade80';
  ctx.beginPath();
  ctx.ellipse(eggX, eggY, 3.2, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#bbf7d0';
  ctx.fillRect(eggX - 1.2, eggY - 2.2, 1.4, 1.4);
  ctx.restore();

  // 7. Pong Paddles & Dual Pong Balls Colliding With and Destroying the Artwork Blocks
  const leftPadX = wallLeft + 16;
  const rightPadX = wallRight - 21;
  const minPlayY = wallTop + 52;
  const maxPlayY = wallBottom - 52;

  // Update both Pong balls and test collisions against paddles & the 8×8 album art block grid
  for (let bi = 0; bi < pongBalls.length; bi++) {
    const ball = pongBalls[bi];
    const speedScale = 1 + midEnergy * 0.25 + beat * 0.18;
    ball.x += ball.vx * safeDt * speedScale;
    ball.y += ball.vy * safeDt * speedScale;

    // Top / Bottom playfield bounce
    if (ball.y < minPlayY) {
      ball.y = minPlayY;
      ball.vy = Math.abs(ball.vy);
    } else if (ball.y > maxPlayY) {
      ball.y = maxPlayY;
      ball.vy = -Math.abs(ball.vy);
    }

    // Left / Right Paddle bounce (aims back toward the center artwork blocks!)
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

    // Check collision with the 8×8 Destructible Album Artwork Blocks
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

        // Sample block color from `artRgb` (128×128 buffer) or palette
        let sparkRgb: RgbTuple = palette[6] || [56, 189, 248];
        if (artReady && artRgb && artRgb.length >= 128 * 128 * 3) {
          const sx = Math.min(127, Math.floor(((col + 0.5) / ART_GRID_N) * 128));
          const sy = Math.min(127, Math.floor(((row + 0.5) / ART_GRID_N) * 128));
          const pOff = (sy * 128 + sx) * 3;
          sparkRgb = [artRgb[pOff], artRgb[pOff + 1], artRgb[pOff + 2]];
        }

        const blockCx = coreX + (col + 0.5) * blockSize;
        const blockCy = coreY + (row + 0.5) * blockSize;
        spawnBlockShatter(blockCx, blockCy, sparkRgb);

        // Reflect Pong ball along dominant penetration axis
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

  // Left paddle tracks whichever ball is heading left; right paddle tracks whichever ball is heading right
  const leftTargetBall = pongBalls[0].vx < 0 ? pongBalls[0] : pongBalls[1];
  const rightTargetBall = pongBalls[0].vx > 0 ? pongBalls[0] : pongBalls[1];
  const leftPadY = Math.max(minPlayY + 18, Math.min(maxPlayY - 18, leftTargetBall.y));
  const rightPadY = Math.max(minPlayY + 18, Math.min(maxPlayY - 18, rightTargetBall.y));

  ctx.fillStyle = rgbToCss(palette[7], 0.94);
  ctx.fillRect(leftPadX, leftPadY - 18, 5, 36);
  ctx.fillRect(rightPadX, rightPadY - 18, 5, 36);

  // Oscilloscope waveform beam + glowing Pong balls
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

  // Render & update album-art block shatter sparks
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

  // 8. Missile Command Counter-Battery Firework Bursts on Lower Horizon
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const batteries = [wallLeft + 92, cx, wallRight - 92];
  for (let b = 0; b < 3; b++) {
    const bx = batteries[b];
    const by = wallBottom - 10;
    const targetX =
      wallLeft + 70 + ((b * 185 + Math.floor(timeSec * 0.45) * 73) % Math.max(120, wallW - 140));
    const targetY = wallTop + 72 + ((b * 47) % 110);
    const flight = (timeSec * (0.38 + b * 0.08) + b * 0.33) % 1;
    const curX = bx + (targetX - bx) * flight;
    const curY = by + (targetY - by) * flight;

    ctx.strokeStyle = rgbToCss(palette[4 + b], 0.62);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(curX, curY);
    ctx.stroke();

    if (flight > 0.74 || beat > 0.48) {
      const blastR =
        (flight > 0.74 ? (flight - 0.74) / 0.26 : beat) * (18 + highEnergy * 14);
      const blastGrad = ctx.createRadialGradient(
        curX,
        curY,
        1,
        curX,
        curY,
        Math.max(4, blastR),
      );
      blastGrad.addColorStop(0, '#ffffff');
      blastGrad.addColorStop(0.45, rgbToCss(palette[7], 0.82));
      blastGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = blastGrad;
      ctx.beginPath();
      ctx.arc(curX, curY, Math.max(4, blastR), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // 9A. Diegetic Arcade Stage Briefing Banner for `activeLyric` (Lower Center)
  const cleanLyric = (activeLyric || '').trim();
  if (cleanLyric.length > 0) {
    const lines = splitIntoBalancedLines(`♪ ${cleanLyric.toUpperCase()} ♪`, 38);
    const bannerY = wallBottom - 28;
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

  // 9B. Separate Diegetic Top Arcade `1UP CHALLENGER @USERNAME` Marquee for SC Comments
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

  // 10. CRT Degauss Collapse Transition (`trans > 0.01`)
  if (trans > 0.01) {
    const beamH = Math.max(2, (1 - Math.sin(trans * Math.PI)) * CANVAS_H);
    ctx.fillStyle = `rgba(255, 255, 255, ${(Math.sin(trans * Math.PI) * 0.45).toFixed(2)})`;
    ctx.fillRect(0, cy - beamH * 0.5, CANVAS_W, beamH);
  }
}
