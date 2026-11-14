import {
  beginLowPolyRasterPass,
  commitLowPolyRasterPass,
  drawPerspectiveGridFloor,
  projectAndDrawMesh3D,
  snapPs1,
  STARFISH_MESH_3D,
} from './lowPoly3d';
import {
  CANVAS_H,
  CANVAS_W,
  drawMicroPartyCommentPill,
  rgbToCss,
  type SceneRenderContext,
} from './types';

let lastCrabRaveTriggerAt = -20;
let crabRaveUntil = -10;

/**
 * Mode 13: Reef 3D [Low-Poly PS1 Abyss] (Wave 2 — Hybrid V1/V2)
 * - Stable, tranquil deep-abyss lighting & ocean surface wave ribbon from V1 (`reefScene`)
 *   paired with V2's polygonal 3D creatures & artifacts
 * - Strictly monotonic, single-direction receding seabed checkerboard floor (no back-and-forth lurching)
 * - Articulated low-poly Seahorses, 5-pointed 3D Starfish, low-poly Staghorn Coral & Sunken Relic Tablet
 * - Crab Rave Beat-Drop Event (~3.5s): When the beat drops, the foreground low-poly Reef Crabs
 *   raise both pincer claws overhead, hop side-to-side in unison, and snap to the rhythm!
 * - Bespoke Lyric Cascade: Splits active synced lyric into 1–2 words per rising octagonal bubble
 */
export function renderReef3dScene(s: SceneRenderContext): void {
  const {
    ctx: mainCtx,
    timeSec,
    bpm,
    beat,
    subBass,
    midEnergy,
    highEnergy,
    drop,
    sb,
    palette,
    artCanvas,
    artReady,
    activeLyric,
    activeComment,
    commentAvatarImg,
    cropTopY,
    cropBottomY,
  } = s;

  // Handle track seek / restart
  if (timeSec < lastCrabRaveTriggerAt - 5) {
    lastCrabRaveTriggerAt = -20;
    crabRaveUntil = -10;
  }
  // Trigger ~3.5s Crab Rave on beat drops (with an 11s cooldown so it's a special drop event)
  if (
    (drop > 0.42 || (drop > 0.26 && beat > 0.8 && subBass > 0.7)) &&
    timeSec - lastCrabRaveTriggerAt > 11.0
  ) {
    lastCrabRaveTriggerAt = timeSec;
    crabRaveUntil = timeSec + 3.5;
  }
  const crabRaveActive = timeSec < crabRaveUntil;
  const tempoHz = Math.max(1.2, Math.min(3.2, (bpm || 120) / 60));

  const ctx = beginLowPolyRasterPass(mainCtx, '#000000');
  const horizonY = Math.round(CANVAS_H * 0.58);
  const surfaceY = Math.max(20, cropTopY + 10);

  // Smooth 0..1 envelope for Crab Rave so lights fan out and fold back smoothly without popping
  const raveRemaining = crabRaveUntil - timeSec;
  const raveElapsed = timeSec - lastCrabRaveTriggerAt;
  const raveFanProgress = crabRaveActive
    ? Math.min(1, Math.min(raveElapsed / 0.45, raveRemaining / 0.55))
    : 0;

  // 1. Stable Deep-Abyss Ocean Gradient & Continuously Swaying Caustic Light Shafts
  const waterGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  waterGrad.addColorStop(0, rgbToCss(palette[4], 0.38));
  waterGrad.addColorStop(0.42, rgbToCss(palette[2], 0.28));
  waterGrad.addColorStop(0.8, rgbToCss(palette[1], 0.22));
  waterGrad.addColorStop(1, '#000000');
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const numRays = 7;
  for (let r = 0; r < numRays; r++) {
    // Anchor point on the water surface sways gently and continuously (never pops in/out)
    const topX =
      58 +
      (r / (numRays - 1)) * (CANVAS_W - 116) +
      Math.sin(timeSec * 0.32 + r * 1.1) * 18;
    const baseSwayX =
      topX + Math.sin(timeSec * 0.48 + r * 0.85) * 44 - 8;

    // During normal playback: 1 steady swaying beam per anchor.
    // During Crab Rave (`raveFanProgress > 0`): each beam fans out prismatically into 3 swaying sub-rays!
    const subRayOffsets = raveFanProgress > 0.01 ? [-1, 0, 1] : [0];
    for (const subDir of subRayOffsets) {
      const isSideFan = subDir !== 0;
      const fanAlphaScale = isSideFan ? raveFanProgress * 0.85 : 1.0;
      const raveSweep =
        raveFanProgress *
        Math.sin(timeSec * tempoHz * Math.PI + r * 0.7 + subDir) *
        28;
      const fanSpreadX = subDir * (56 * raveFanProgress) + raveSweep;

      const botX = baseSwayX + fanSpreadX;
      const topW = isSideFan ? 8 : 14;
      const botW = isSideFan ? 22 + raveFanProgress * 12 : 34;

      const rayColor = isSideFan
        ? palette[5 + ((r + (subDir > 0 ? 1 : 0)) & 2)]
        : palette[6];
      const baseAlpha = 0.21 * fanAlphaScale;

      const rayGrad = ctx.createLinearGradient(
        topX,
        surfaceY,
        botX,
        horizonY + 52,
      );
      rayGrad.addColorStop(0, rgbToCss(rayColor, baseAlpha));
      rayGrad.addColorStop(
        0.55,
        rgbToCss(palette[4 + (r & 1)], baseAlpha * 0.48),
      );
      rayGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = rayGrad;
      ctx.beginPath();
      ctx.moveTo(topX - topW * 0.5, surfaceY);
      ctx.lineTo(topX + topW * 0.5, surfaceY);
      ctx.lineTo(botX + botW * 0.5, horizonY + 52);
      ctx.lineTo(botX - botW * 0.5, horizonY + 52);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Calm, Stable Faceted Ocean Surface Wave Ribbon (Unhurried drift, no erratic subBass spikes)
  const waveCols = 24;
  const colW = CANVAS_W / waveCols;
  ctx.strokeStyle = rgbToCss(palette[7], 0.62);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let c = 0; c <= waveCols; c++) {
    const x = c * colW;
    const wy = snapPs1(
      surfaceY +
        Math.sin(x * 0.02 + timeSec * 0.68) * 3.5 +
        Math.cos(x * 0.045 - timeSec * 0.85) * 2.0,
      2,
    );
    if (c === 0) ctx.moveTo(0, wy);
    else ctx.lineTo(snapPs1(x, 2), wy);
  }
  ctx.stroke();
  ctx.restore();

  // 2. Distant Low-Poly Reef Ridge Silhouette Along the Horizon
  ctx.fillStyle = rgbToCss(palette[1], 0.78);
  ctx.strokeStyle = rgbToCss(palette[3], 0.55);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  const ridgePts: [number, number][] = [
    [0, horizonY - 14],
    [64, horizonY - 28],
    [138, horizonY - 16],
    [220, horizonY - 32],
    [320, horizonY - 20],
    [418, horizonY - 34],
    [512, horizonY - 18],
    [584, horizonY - 28],
    [CANVAS_W, horizonY - 14],
  ];
  for (const [rx, ry] of ridgePts) {
    ctx.lineTo(rx, ry);
  }
  ctx.lineTo(CANVAS_W, horizonY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 3. Strictly Single-Direction Receding Seabed Checkerboard Floor
  // (`timeSec * 0.28` is strictly monotonic with `camSwayX = 0`, so it never reverses or sloshes!)
  drawPerspectiveGridFloor(
    ctx,
    horizonY,
    CANVAS_H,
    timeSec * 0.28,
    0,
    palette,
    true,
    0.72,
  );

  // Subtle Drifting Seabed Caustic Rings over the Floor (from V1)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let r = 0; r < 3; r++) {
    const d0 = (r + 0.5) / 3;
    const ry = horizonY + 12 + d0 * (CANVAS_H - horizonY - 20);
    for (let c = 0; c < 8; c++) {
      const cxCell =
        ((c + 0.5) / 8) * CANVAS_W +
        Math.sin(timeSec * 0.45 + r * 1.3 + c * 0.9) * 12;
      const cellR = 14 + d0 * 16;
      ctx.strokeStyle = rgbToCss(palette[5 + (r & 1)], 0.12 + sb[(c + r) & 15] * 0.1);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(cxCell, ry, cellR, cellR * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  // 4. Sunken Low-Poly Album-Art Relic Tablet / Octagonal Medallion on the Horizon
  const tabletX = snapPs1(CANVAS_W * 0.5, 2);
  const tabletY = snapPs1(horizonY - 26 + Math.sin(timeSec * 0.55) * 3, 2);
  const tabletS = 68 + beat * 4;
  ctx.save();
  ctx.translate(tabletX, tabletY);
  ctx.rotate(Math.sin(timeSec * 0.25) * 0.04);

  // Chiseled low-poly stone border
  ctx.fillStyle = rgbToCss(palette[2], 0.9);
  ctx.strokeStyle = rgbToCss(palette[crabRaveActive ? 7 : 6], 0.88);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-tabletS * 0.62, -tabletS * 0.48);
  ctx.lineTo(0, -tabletS * 0.64);
  ctx.lineTo(tabletS * 0.62, -tabletS * 0.48);
  ctx.lineTo(tabletS * 0.56, tabletS * 0.56);
  ctx.lineTo(-tabletS * 0.56, tabletS * 0.56);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (artReady && artCanvas) {
    ctx.globalAlpha = 0.84 + beat * 0.14;
    ctx.drawImage(
      artCanvas,
      -tabletS * 0.42,
      -tabletS * 0.42,
      tabletS * 0.84,
      tabletS * 0.84,
    );
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // 5. Low-Poly Branching Staghorn Coral & Swaying Polygonal Kelp Ribbons
  const drawLowPolyCoral = (
    baseX: number,
    baseY: number,
    dir: number,
    palSlot: number,
  ) => {
    const branches = 5;
    for (let b = 0; b < branches; b++) {
      const ang =
        -Math.PI * 0.5 +
        (b - 2) * 0.31 +
        Math.sin(timeSec * 0.75 + b) * 0.06 * dir;
      const len = 38 + (b % 3) * 14 + sb[(b * 3) & 15] * 14;
      const tipX = snapPs1(baseX + Math.cos(ang) * len, 2);
      const tipY = snapPs1(baseY + Math.sin(ang) * len, 2);
      ctx.fillStyle = rgbToCss(palette[palSlot], 0.8);
      ctx.strokeStyle = rgbToCss(palette[Math.min(7, palSlot + 2)], 0.88);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(baseX - 6, baseY);
      ctx.lineTo(tipX - 3, tipY);
      ctx.lineTo(tipX + 4, tipY - 3);
      ctx.lineTo(baseX + 6, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  };
  drawLowPolyCoral(88, horizonY + 32, 1, 3);
  drawLowPolyCoral(552, horizonY + 36, -1, 4);
  drawLowPolyCoral(172, horizonY + 10, 1, 2);
  drawLowPolyCoral(468, horizonY + 12, -1, 5);

  // Polygonal Segmented Kelp Stalks on Far Left & Right Edges
  for (const kBaseX of [38, 128, 512, 602]) {
    const segs = 4;
    let kx = kBaseX;
    let ky = horizonY + 22;
    for (let sIdx = 0; sIdx < segs; sIdx++) {
      const nextX = snapPs1(
        kBaseX + Math.sin(timeSec * 0.65 + sIdx * 0.7 + kBaseX * 0.02) * (6 + sIdx * 3),
        2,
      );
      const nextY = ky - 22;
      ctx.fillStyle = rgbToCss(palette[3 + (sIdx & 1)], 0.76);
      ctx.strokeStyle = rgbToCss(palette[6], 0.82);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(kx - 4, ky);
      ctx.lineTo(nextX - 3, nextY);
      ctx.lineTo(nextX + 3, nextY);
      ctx.lineTo(kx + 4, ky);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      kx = nextX;
      ky = nextY;
    }
  }

  // 6. Patrolling 3D Faceted Seahorses (Drift Left/Right & Up/Down, Facing Their Travel Direction!)
  const drawPatrollingSeahorse = (
    homeX: number,
    homeY: number,
    rangeX: number,
    rangeY: number,
    speedX: number,
    speedY: number,
    scale: number,
    phase: number,
  ) => {
    const thetaX = timeSec * speedX + phase;
    const thetaY = timeSec * speedY + phase * 1.6;

    const curX = snapPs1(homeX + Math.sin(thetaX) * rangeX, 2);
    const curY = snapPs1(homeY + Math.sin(thetaY) * rangeY, 2);

    // Velocity derivatives determine which way the seahorse is currently swimming
    const vx = Math.cos(thetaX) * speedX * rangeX;
    const vy = Math.cos(thetaY) * speedY * rangeY;
    const facing = vx >= 0 ? 1 : -1;
    // Subtle forward/upward pitch tilt based on vertical climb/dive velocity
    const pitch = Math.max(-0.22, Math.min(0.22, (vy / 18) * 0.12));

    ctx.save();
    ctx.translate(curX, curY);
    ctx.scale(facing * scale, scale);
    ctx.rotate(pitch);

    const segs: [number, number, number][] = [
      [0, -28, 9], // Head crown
      [14, -24, 5], // Tubular snout tip
      [-4, -14, 7], // Neck
      [-10, 0, 12], // Arched chest
      [-6, 14, 9], // Lower belly
      [2, 26, 5], // Tail upper curl
      [10, 30, 3], // Tail inner curl
      [6, 22, 2], // Tail tip
    ];

    // Fluttering dorsal fin on the back of the chest
    const finFlutter = Math.sin(timeSec * 8.5 + phase) * 4.5;
    ctx.fillStyle = rgbToCss(palette[6], 0.74);
    ctx.strokeStyle = rgbToCss(palette[7], 0.9);
    ctx.beginPath();
    ctx.moveTo(-10, -8);
    ctx.lineTo(-24, -14 + finFlutter);
    ctx.lineTo(-22, 8 - finFlutter);
    ctx.lineTo(-8, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Faceted body armor plates
    for (let i = 0; i < segs.length - 1; i++) {
      const [x0, y0, r0] = segs[i];
      const [x1, y1, r1] = segs[i + 1];
      ctx.fillStyle = rgbToCss(palette[3 + (i & 3)], 0.88);
      ctx.strokeStyle = rgbToCss(palette[7], 0.85);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x0 - r0, y0);
      ctx.lineTo(x0 + r0, y0);
      ctx.lineTo(x1 + r1, y1);
      ctx.lineTo(x1 - r1, y1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Glowing polygon eye
    ctx.fillStyle = rgbToCss(palette[7], 0.98);
    ctx.fillRect(0, -26, 3, 3);
    ctx.restore();
  };

  drawPatrollingSeahorse(148, horizonY - 46, 62, 26, 0.34, 0.58, 1.0, 0.0);
  drawPatrollingSeahorse(492, horizonY - 38, 66, 28, 0.31, 0.52, 0.96, 2.4);
  drawPatrollingSeahorse(296, horizonY - 82, 78, 20, 0.26, 0.46, 0.72, 4.5);

  // 7. Tumbling 5-Pointed 3D Starfish (`STARFISH_MESH_3D`)
  projectAndDrawMesh3D(ctx, STARFISH_MESH_3D, {
    cx: 224 + Math.sin(timeSec * 0.45) * 18,
    cy: horizonY + 52,
    scale: 22 + beat * 4,
    rx: 0.88 + Math.sin(timeSec * 0.6) * 0.18,
    ry: timeSec * 0.48,
    rz: timeSec * 0.35,
    palette,
  });
  projectAndDrawMesh3D(ctx, STARFISH_MESH_3D, {
    cx: 418 + Math.cos(timeSec * 0.42) * 18,
    cy: horizonY + 66,
    scale: 19 + subBass * 4,
    rx: 0.92,
    ry: -timeSec * 0.44,
    rz: -timeSec * 0.32,
    palette,
  });

  // 8. Articulated Low-Poly Reef Crabs (Calm Seabed Walk vs. ~3.5s Beat-Drop "CRAB RAVE"!)

  const drawLowPolyCrab = (
    baseX: number,
    baseY: number,
    scale: number,
    seed: number,
  ) => {
    const ravePhase = timeSec * tempoHz * Math.PI * 2;
    const scuttleX = crabRaveActive
      ? snapPs1(baseX + Math.sin(ravePhase * 0.5) * 28, 2)
      : snapPs1(baseX + Math.sin(timeSec * 0.65 + seed) * 32, 2);
    const bounceY = crabRaveActive
      ? snapPs1(
          baseY - Math.abs(Math.sin(ravePhase + seed * 0.3)) * (14 + subBass * 10),
          2,
        )
      : snapPs1(baseY - Math.abs(Math.sin(timeSec * 1.8 + seed)) * 2.5, 2);
    const bodyTilt = crabRaveActive
      ? Math.sin(ravePhase * 0.5) * 0.16
      : 0;
    const clawSnap = crabRaveActive
      ? Math.abs(Math.sin(ravePhase * 1.5)) * 0.85
      : (beat * 0.45 + sb[4] * 0.35) * 0.45;

    ctx.save();
    ctx.translate(scuttleX, bounceY);
    ctx.rotate(bodyTilt);
    ctx.scale(scale, scale);

    // 6 Jointed Low-Poly Legs (3 per side)
    ctx.strokeStyle = rgbToCss(palette[crabRaveActive ? 7 : 6], 0.92);
    ctx.lineWidth = 2.0;
    for (const side of [-1, 1]) {
      for (let leg = 0; leg < 3; leg++) {
        const stepSpeed = crabRaveActive ? 14.0 : 4.2;
        const step = Math.sin(timeSec * stepSpeed + leg * 1.4 + side) * (crabRaveActive ? 6 : 3);
        const lx0 = side * (16 + leg * 4);
        const ly0 = 2 + leg * 3;
        const kneeX = side * (30 + leg * 6);
        const kneeY = -6 + leg * 3 + step * 0.5;
        const footX = side * (38 + leg * 7);
        const footY = 14 + leg * 2 + step;
        ctx.beginPath();
        ctx.moveTo(lx0, ly0);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(footX, footY);
        ctx.stroke();
      }
    }

    // Faceted Hexagonal Carapace Shell
    const shellColor = crabRaveActive
      ? palette[5 + (Math.floor(timeSec * 8 + seed) & 2)]
      : palette[4];
    ctx.fillStyle = rgbToCss(shellColor, 0.94);
    ctx.strokeStyle = rgbToCss(palette[7], 0.94);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-16, -12);
    ctx.lineTo(16, -12);
    ctx.lineTo(26, 0);
    ctx.lineTo(18, 12);
    ctx.lineTo(-18, 12);
    ctx.lineTo(-26, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner Carapace Facet
    ctx.fillStyle = rgbToCss(palette[crabRaveActive ? 6 : 5], 0.82);
    ctx.beginPath();
    ctx.moveTo(-10, -6);
    ctx.lineTo(10, -6);
    ctx.lineTo(14, 5);
    ctx.lineTo(-14, 5);
    ctx.closePath();
    ctx.fill();

    // Eye Stalks
    ctx.fillStyle = rgbToCss(palette[7], 0.98);
    ctx.fillRect(-8, -19, 3, 7);
    ctx.fillRect(5, -19, 3, 7);

    // Snapping Low-Poly Pincer Claws:
    // During Crab Rave (`crabRaveActive`), both claws are thrust high overhead and pump to the beat!
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 20, crabRaveActive ? -12 : -8);
      const raveLift = crabRaveActive
        ? side * (-1.15 - Math.sin(ravePhase + side) * 0.28)
        : side * (-0.32 - beat * 0.18);
      ctx.rotate(raveLift);

      // Upper & Lower Pincer Jaws
      ctx.fillStyle = rgbToCss(palette[crabRaveActive ? 6 : 5], 0.94);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(side * 14, -14 - clawSnap * 10);
      ctx.lineTo(side * 22, -6 - clawSnap * 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.lineTo(side * 16, -2 + clawSnap * 8);
      ctx.lineTo(side * 22, -6 + clawSnap * 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  };

  const safeCrabY = Math.min(CANVAS_H - 34, cropBottomY - 24);
  drawLowPolyCrab(CANVAS_W * 0.5, safeCrabY, 1.02, 0);
  drawLowPolyCrab(CANVAS_W * 0.21, safeCrabY - 22, 0.72, 2.1);
  drawLowPolyCrab(CANVAS_W * 0.79, safeCrabY - 20, 0.74, 4.2);

  // Commit the PS1 raster pass with calm, stable underwater scanlines (zero VHS tearing!)
  commitLowPolyRasterPass(mainCtx, ctx, {
    scanlineAlpha: 0.12,
    vhsTearAmount: 0,
    timeSec,
    bayerTintRgb: palette[3],
    bayerAlpha: 0.04,
  });

  // 9. Bespoke Rising Bubble Lyric Cascade (1–2 words per bubble, floating upward!)
  const rawWords = (activeLyric || '')
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  const wordPairs: string[] = [];
  for (let i = 0; i < rawWords.length; i += 2) {
    wordPairs.push(rawWords.slice(i, i + 2).join(' '));
  }

  const numBubbles = Math.max(10, wordPairs.length);
  mainCtx.save();
  mainCtx.font = 'bold 11px "JetBrains Mono", "Fira Code", monospace';
  mainCtx.textAlign = 'center';
  mainCtx.textBaseline = 'middle';

  for (let b = 0; b < numBubbles; b++) {
    const wordChunk =
      wordPairs.length > 0 ? wordPairs[b % wordPairs.length] : null;
    const isLyricBubble = wordPairs.length > 0 && b < wordPairs.length;

    const cycle =
      (timeSec * (isLyricBubble ? 0.22 : 0.3) + b * (1 / numBubbles)) % 1;
    const by = snapPs1(
      cropBottomY - 24 - cycle * (cropBottomY - Math.max(36, cropTopY + 24)),
      2,
    );
    const spreadX = isLyricBubble
      ? CANVAS_W * 0.22 +
        ((b * 137) % Math.max(1, Math.floor(CANVAS_W * 0.56)))
      : ((b * 97 + 40) % (CANVAS_W - 80)) + 40;
    const bx = snapPs1(spreadX + Math.sin(timeSec * 1.4 + b * 1.3) * 14, 2);

    const r =
      isLyricBubble && wordChunk
        ? Math.max(22, Math.min(54, wordChunk.length * 3.8 + 12))
        : 6 + (b % 4) * 3;

    // Octagonal low-poly bubble ring
    mainCtx.fillStyle = rgbToCss(palette[1], isLyricBubble ? 0.72 : 0.28);
    mainCtx.strokeStyle = rgbToCss(
      palette[isLyricBubble ? 6 : 4],
      isLyricBubble ? 0.92 : 0.52,
    );
    mainCtx.lineWidth = isLyricBubble ? 1.6 : 1.0;
    mainCtx.beginPath();
    const sides = 8;
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const px = bx + Math.cos(a) * r;
      const py = by + Math.sin(a) * (isLyricBubble ? r * 0.62 : r);
      if (k === 0) mainCtx.moveTo(px, py);
      else mainCtx.lineTo(px, py);
    }
    mainCtx.closePath();
    mainCtx.fill();
    mainCtx.stroke();

    // Specular pixel highlight
    mainCtx.fillStyle = rgbToCss(palette[7], 0.85);
    mainCtx.fillRect(bx - r * 0.45, by - r * 0.32, 3, 3);

    if (isLyricBubble && wordChunk) {
      mainCtx.fillStyle = rgbToCss(palette[3], 0.85);
      mainCtx.fillText(wordChunk, bx + 1, by + 1);
      mainCtx.fillStyle = rgbToCss(palette[7], 0.98);
      mainCtx.fillText(wordChunk, bx, by);
    }
  }
  mainCtx.restore();

  // 10. SoundCloud Timed Comment Pill
  drawMicroPartyCommentPill(
    mainCtx,
    activeComment,
    commentAvatarImg,
    palette,
    timeSec,
    beat,
    cropBottomY,
    false,
  );
}
