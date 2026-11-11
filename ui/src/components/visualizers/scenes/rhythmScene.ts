import {
  CANVAS_H,
  CANVAS_W,
  lerpRgb,
  rgbToCss,
  splitIntoBalancedLines,
  type SceneRenderContext,
} from './types';

const MICRO_PROMPTS = [
  'FEVER!!',
  'HANDS UP!',
  'JUMP! JUMP!',
  'MAX COMBO!',
  'BASS DROP!',
  'GROOVE ON!',
  'PERFECT!!',
  'SYNC LOCK!',
];

/**
 * Scene `a` — Rhythm Stage & Micro-Party (High-DPI Canvas2D)
 * - Pure #000000 arena negative space with 7 volumetric concert laser cones (`lighter`)
 * - Stage-center LED Jumbotron displaying live album art (`artCanvas`) with scanline matrix sheen
 * - Perspective Mode-7 neon stage floor with 22 hopping crowd silhouettes & dual glowsticks
 * - 4-lane DDR step arrow highway with beat-synced scrolling step notes & receptor burst rings
 * - Diegetic Concert Truss LED Banner for `activeLyric` and Front-Row Crowd Fan Sign for `@username` comments
 */
export function renderRhythmScene(s: SceneRenderContext): void {
  const {
    ctx,
    timeSec,
    bpm,
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
    activeLyric,
    nextLyric,
    activeComment,
    commentAvatarImg,
    cropTopY,
    cropBottomY,
  } = s;

  const cx = CANVAS_W * 0.5;
  const horizonY = Math.round(CANVAS_H * 0.55);
  const beatHz = Math.max(1.2, Math.min(3.2, (bpm || 120) / 60));
  const beatPhase = (timeSec * beatHz) % 1;
  const bounce = Math.abs(Math.sin(timeSec * beatHz * Math.PI));

  // 1. Pure #000000 OLED Arena Backdrop + Subtle Upper Stage Haze
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const hazeGrad = ctx.createRadialGradient(
    cx,
    horizonY - 40,
    12,
    cx,
    horizonY - 20,
    CANVAS_W * 0.62,
  );
  hazeGrad.addColorStop(0, rgbToCss(palette[5], 0.22 + subBass * 0.18 + drop * 0.15));
  hazeGrad.addColorStop(0.55, rgbToCss(palette[2], 0.10 + midEnergy * 0.10));
  hazeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = hazeGrad;
  ctx.fillRect(0, 0, CANVAS_W, horizonY + 30);

  // 2. Mode-7 Perspective Neon Stage Floor (Receding Checker/Grid Tiles — steady scroll without bass-jump)
  const floorScroll = (timeSec * 0.85) % 1;
  const numRows = 10;
  const numCols = 14;
  for (let r = 0; r < numRows; r++) {
    const d0 = (r + floorScroll) / numRows;
    const d1 = (r + 1 + floorScroll) / numRows;
    const y0 = horizonY + Math.pow(d0, 1.75) * (CANVAS_H - horizonY);
    const y1 = horizonY + Math.pow(d1, 1.75) * (CANVAS_H - horizonY);
    const span0 = 140 + Math.pow(d0, 1.45) * 640;
    const span1 = 140 + Math.pow(d1, 1.45) * 640;
    const rowParity = (r + Math.floor(timeSec * 0.85)) & 1;

    for (let c = -numCols / 2; c < numCols / 2; c++) {
      const bandVal = sb[Math.abs(c * 2 + r) & 15];
      const isLitTile = ((c + rowParity) & 1) === 0;
      if (!isLitTile && bandVal < 0.55) continue;

      const u0 = c / (numCols * 0.5);
      const u1 = (c + 1) / (numCols * 0.5);
      const x0a = cx + u0 * span0;
      const x0b = cx + u1 * span0;
      const x1b = cx + u1 * span1;
      const x1a = cx + u0 * span1;

      const palC = palette[3 + (Math.abs(c + r) % 4)];
      const alpha = (0.14 + d0 * 0.36) * (0.55 + bandVal * 0.65 + beat * 0.25);
      ctx.fillStyle = rgbToCss(palC, Math.min(0.78, alpha));
      ctx.beginPath();
      ctx.moveTo(x0a, y0);
      ctx.lineTo(x0b, y0);
      ctx.lineTo(x1b, y1);
      ctx.lineTo(x1a, y1);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Horizon stage lip neon beam
  ctx.strokeStyle = rgbToCss(palette[7], 0.78 + beat * 0.22);
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(CANVAS_W, horizonY);
  ctx.stroke();

  // 3. Center-Stage Jumbo LED Screen (Album Art Jumbotron + Flanking FFT Speaker Towers)
  const jumboW = 142 + subBass * 10 + beat * 6;
  const jumboH = 96 + subBass * 6 + beat * 4;
  const jumboX = cx - jumboW * 0.5;
  const jumboY = horizonY - jumboH - 12;

  // Flanking Concert Speaker Stacks (Pulsing Dual Woofer / Subwoofer Cabinets + Sonic Rings)
  for (let side = -1; side <= 1; side += 2) {
    const towerW = 38;
    const towerH = jumboH + 10;
    const towerX = side < 0 ? jumboX - towerW - 12 : jumboX + jumboW + 12;
    const towerY = horizonY - towerH - 6;
    const cxTower = towerX + towerW * 0.5;

    // Cabinet enclosure with bevelled acoustic frame
    const cabTilt = side * (subBass * 1.4 + beat * 0.9);
    ctx.save();
    ctx.translate(cxTower, towerY + towerH);
    ctx.scale(1 + subBass * 0.045, 1 + beat * 0.035);
    ctx.rotate(cabTilt * 0.012);
    ctx.translate(-cxTower, -(towerY + towerH));

    ctx.fillStyle = '#070a14';
    ctx.strokeStyle = rgbToCss(palette[4], 0.75 + beat * 0.25);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(towerX, towerY, towerW, towerH, 6);
    ctx.fill();
    ctx.stroke();

    // Inner acoustic grille texture lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 0.8;
    for (let gy = towerY + 6; gy < towerY + towerH - 4; gy += 4) {
      ctx.beginPath();
      ctx.moveTo(towerX + 3, gy);
      ctx.lineTo(towerX + towerW - 3, gy);
      ctx.stroke();
    }

    // Upper Mid-High Woofer Cone + Lower Sub-Bass Woofer Cone
    const drivers = [
      {
        cy: towerY + towerH * 0.29,
        baseR: 11.5,
        amp: Math.max(midEnergy, sb[side < 0 ? 4 : 6]),
        col: palette[5],
      },
      {
        cy: towerY + towerH * 0.71,
        baseR: 14.5,
        amp: Math.max(subBass, sb[side < 0 ? 1 : 2]),
        col: palette[6],
      },
    ];

    for (const drv of drivers) {
      const pump = drv.amp * 3.6 + beat * 2.2 + drop * 2.0;
      const outerR = drv.baseR + pump * 0.45;
      const coneR = drv.baseR * 0.78 + pump * 0.65;
      const capR = drv.baseR * 0.32 + pump * 0.4;

      // Outer rubber surround ring
      ctx.fillStyle = '#03050a';
      ctx.strokeStyle = rgbToCss(drv.col, 0.65 + drv.amp * 0.35);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(cxTower, drv.cy, outerR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Ribbed speaker cone radial gradient
      const coneGrad = ctx.createRadialGradient(
        cxTower - 1.5,
        drv.cy - 1.5,
        1,
        cxTower,
        drv.cy,
        coneR,
      );
      coneGrad.addColorStop(0, rgbToCss(palette[7], 0.55 + drv.amp * 0.4));
      coneGrad.addColorStop(0.55, rgbToCss(drv.col, 0.32 + drv.amp * 0.3));
      coneGrad.addColorStop(1, '#050811');
      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.arc(cxTower, drv.cy, coneR, 0, Math.PI * 2);
      ctx.fill();

      // Center dust-cap dome
      ctx.fillStyle = rgbToCss(palette[7], 0.78 + beat * 0.22);
      ctx.beginPath();
      ctx.arc(cxTower, drv.cy, capR, 0, Math.PI * 2);
      ctx.fill();

      // Expanding sonic pressure wave ring on beats/bass
      if (drv.amp > 0.32 || beat > 0.35) {
        const wavePhase = (timeSec * 3.2 + (side < 0 ? 0 : 0.4)) % 1;
        const waveR = outerR + wavePhase * 18;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgbToCss(drv.col, (1 - wavePhase) * (0.45 + drv.amp * 0.4));
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cxTower, drv.cy, waveR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();
  }

  // Jumbotron Outer Frame & Album Artwork
  ctx.save();
  ctx.fillStyle = '#05070f';
  ctx.strokeStyle = rgbToCss(palette[6], 0.9);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.roundRect(jumboX, jumboY, jumboW, jumboH, 8);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.roundRect(jumboX + 3, jumboY + 3, jumboW - 6, jumboH - 6, 6);
  ctx.clip();

  if (artReady && artCanvas) {
    // Subtle Ken-Burns zoom & pan inside the stage Jumbotron
    const zoom = 1.08 + subBass * 0.12 + Math.sin(timeSec * 0.45) * 0.05;
    const drawSide = Math.max(jumboW, jumboH) * zoom;
    const panX = Math.sin(timeSec * 0.35) * 10;
    const panY = Math.cos(timeSec * 0.28) * 8;
    ctx.drawImage(
      artCanvas,
      cx - drawSide * 0.5 + panX,
      jumboY + jumboH * 0.5 - drawSide * 0.5 + panY,
      drawSide,
      drawSide,
    );
  } else {
    // Dynamic holographic equalizer crest when no cover art is present
    const fallbackGrad = ctx.createLinearGradient(jumboX, jumboY, jumboX, jumboY + jumboH);
    fallbackGrad.addColorStop(0, rgbToCss(palette[3], 0.55));
    fallbackGrad.addColorStop(1, '#04060e');
    ctx.fillStyle = fallbackGrad;
    ctx.fillRect(jumboX, jumboY, jumboW, jumboH);
  }

  // Jumbotron LED scanline grid overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  for (let sy = jumboY; sy < jumboY + jumboH; sy += 3) {
    ctx.fillRect(jumboX, sy, jumboW, 1);
  }
  ctx.restore();

  // 4. Volumetric Concert Laser Cones (`globalCompositeOperation = 'lighter'`)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const numLasers = 7;
  for (let l = 0; l < numLasers; l++) {
    const bandAmp = sb[(l * 2) & 15];
    const originX = 70 + (l / (numLasers - 1)) * (CANVAS_W - 140);
    const originY = Math.max(8, cropTopY + 4);
    const sweepAngle =
      Math.sin(timeSec * (1.35 + (l % 3) * 0.35) + l * 1.1) *
        (0.45 + midEnergy * 0.35 + drop * 0.3) +
      (l - 3) * 0.12;
    const beamLen = 280 + subBass * 60;
    const endX = originX + Math.sin(sweepAngle) * beamLen;
    const endY = originY + Math.cos(sweepAngle) * beamLen;
    const spread = 18 + bandAmp * 32 + beat * 14;

    const laserPal = palette[4 + (l % 4)];
    const laserGrad = ctx.createLinearGradient(originX, originY, endX, endY);
    laserGrad.addColorStop(0, rgbToCss(laserPal, 0.42 + bandAmp * 0.32 + drop * 0.18));
    laserGrad.addColorStop(0.65, rgbToCss(laserPal, 0.14 + bandAmp * 0.14));
    laserGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = laserGrad;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(endX - spread, endY);
    ctx.lineTo(endX + spread, endY);
    ctx.closePath();
    ctx.fill();

    // Crisp center laser filament
    ctx.strokeStyle = rgbToCss(palette[7], 0.55 + bandAmp * 0.4);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }
  ctx.restore();

  // 5. Left & Right Dual DDR Step Arrow Highways (Flanking the Stage Jumbotron)
  const drawStepHighway = (highwayCenterX: number, mirrorOffset: number) => {
    const laneSpacing = 22;
    const receptorY = Math.max(38, cropTopY + 26);
    const bottomY = horizonY - 10;
    const dirs = [Math.PI, Math.PI * 0.5, -Math.PI * 0.5, 0]; // ← ↓ ↑ →

    const drawArrowShape = (ax: number, ay: number, size: number, rotRad: number) => {
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(rotRad);
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(0, -size * 0.85);
      ctx.lineTo(0, -size * 0.35);
      ctx.lineTo(-size * 0.85, -size * 0.35);
      ctx.lineTo(-size * 0.85, size * 0.35);
      ctx.lineTo(0, size * 0.35);
      ctx.lineTo(0, size * 0.85);
      ctx.closePath();
      ctx.restore();
    };

    for (let lane = 0; lane < 4; lane++) {
      const lx = highwayCenterX + (lane - 1.5) * laneSpacing;
      const bandAmp = sb[(lane * 3 + mirrorOffset) & 15];

      // Subtle guide rail
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx, receptorY);
      ctx.lineTo(lx, bottomY);
      ctx.stroke();

      // Receptor target arrow at top
      const isHit = bandAmp > 0.62 || (beat > 0.45 && ((Math.floor(timeSec * beatHz) + lane) & 3) === 0);
      drawArrowShape(lx, receptorY, 7.5 + (isHit ? 2.2 : 0), dirs[lane]);
      ctx.fillStyle = isHit
        ? rgbToCss(palette[7], 0.92)
        : 'rgba(15, 23, 42, 0.75)';
      ctx.strokeStyle = rgbToCss(palette[4 + (lane & 3)], isHit ? 1.0 : 0.65);
      ctx.lineWidth = isHit ? 1.8 : 1.2;
      ctx.fill();
      ctx.stroke();

      // Scrolling step notes rising toward receptorY
      for (let n = 0; n < 3; n++) {
        const noteProgress = ((timeSec * beatHz * 0.5 + n * 0.33 + lane * 0.19 + mirrorOffset * 0.13) % 1);
        const ny = bottomY - noteProgress * (bottomY - receptorY);
        const noteColor = palette[4 + ((lane + n) & 3)];
        drawArrowShape(lx, ny, 6.8, dirs[lane]);
        ctx.fillStyle = rgbToCss(noteColor, 0.85);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.9;
        ctx.fill();
        ctx.stroke();
      }
    }
  };

  drawStepHighway(96, 0);
  drawStepHighway(CANVAS_W - 96, 5);

  // 5b. Stage CO2 / Fog Machine Jets — Fire on Track Start (`timeSec < 7.5s`), Transition (`trans`), and Beat Drops (`drop`)
  const startFogEnv =
    timeSec < 7.5 ? Math.max(0, Math.min(1, (7.5 - timeSec) / 3.5)) : 0;
  const fogTrigger = Math.min(
    1,
    Math.max(
      startFogEnv,
      trans * 1.15,
      drop * 1.25,
      subBass > 0.72 && beat > 0.5 ? (subBass - 0.55) * 1.8 : 0,
    ),
  );

  const fogNozzles = [cx - 128, cx - 58, cx + 58, cx + 128];
  // Nozzle hardware housings on the stage lip
  for (const nx of fogNozzles) {
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = rgbToCss(palette[5], 0.65);
    ctx.lineWidth = 1;
    ctx.fillRect(nx - 5, horizonY - 4, 10, 6);
    ctx.strokeRect(nx - 5, horizonY - 4, 10, 6);
  }

  if (fogTrigger > 0.04) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Vertical pressurized CO2 cryo-plume bursts shooting up from the 4 stage nozzles
    for (let nIdx = 0; nIdx < fogNozzles.length; nIdx++) {
      const nx = fogNozzles[nIdx];
      const jetH = (48 + subBass * 42 + drop * 38) * fogTrigger;
      const jetSpread = 16 + fogTrigger * 22;
      const sway = Math.sin(timeSec * 5.5 + nIdx * 1.4) * 6;

      const jetGrad = ctx.createLinearGradient(nx, horizonY, nx + sway, horizonY - jetH);
      jetGrad.addColorStop(0, `rgba(241, 245, 249, ${(0.52 * fogTrigger).toFixed(3)})`);
      jetGrad.addColorStop(
        0.45,
        rgbToCss(palette[6], 0.28 * fogTrigger),
      );
      jetGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

      ctx.fillStyle = jetGrad;
      ctx.beginPath();
      ctx.moveTo(nx - 3, horizonY - 2);
      ctx.lineTo(nx - jetSpread + sway, horizonY - jetH);
      ctx.lineTo(nx + jetSpread + sway, horizonY - jetH);
      ctx.lineTo(nx + 3, horizonY - 2);
      ctx.closePath();
      ctx.fill();
    }

    // Billowing low-lying stage fog clouds rolling across the stage floor & front row
    const puffCount = 14;
    for (let p = 0; p < puffCount; p++) {
      const seed = p * 1.37;
      const driftX =
        ((p / (puffCount - 1) - 0.5) * (CANVAS_W * 0.85)) +
        Math.sin(timeSec * 0.9 + seed) * 28;
      const px = cx + driftX;
      const riseCycle = (timeSec * 0.55 + p * 0.17) % 1;
      const py = horizonY + 18 - riseCycle * (36 + fogTrigger * 34);
      const pr = (28 + (p % 4) * 14) * (0.7 + fogTrigger * 0.55);

      const puffColor = lerpRgb(palette[5 + (p & 1)], [226, 232, 240], 0.55);
      const puffAlpha = (1 - riseCycle * 0.75) * 0.22 * fogTrigger;
      const puffGrad = ctx.createRadialGradient(px, py, 2, px, py, pr);
      puffGrad.addColorStop(0, rgbToCss(puffColor, puffAlpha));
      puffGrad.addColorStop(0.6, rgbToCss(puffColor, puffAlpha * 0.45));
      puffGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = puffGrad;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // 6. Mode-7 Perspective Dancing Crowd Silhouettes + Dual Concert Glowsticks
  const crowdCount = 20;
  for (let i = 0; i < crowdCount; i++) {
    const depth = 0.25 + ((i % 3) * 0.28);
    const spreadX = (i / (crowdCount - 1) - 0.5) * (CANVAS_W * 0.92);
    const dancerX = cx + spreadX + Math.sin(timeSec * 2.1 + i * 1.7) * 6;
    const baseY = horizonY + 34 + depth * (CANVAS_H - horizonY - 22);
    const scale = 0.68 + depth * 0.55;
    const hopPhase = timeSec * beatHz * Math.PI + i * 0.65;
    const hopY = Math.abs(Math.sin(hopPhase)) * (8 + subBass * 12 + beat * 8) * scale;
    const dy = baseY - hopY;

    // Silhouette Head & Shoulders
    const headR = 7.5 * scale;
    ctx.fillStyle = '#04060d';
    ctx.strokeStyle = rgbToCss(palette[3 + (i & 3)], 0.55);
    ctx.lineWidth = 1.2;

    // Torso
    ctx.beginPath();
    ctx.roundRect(dancerX - 10 * scale, dy, 20 * scale, 28 * scale, 6 * scale);
    ctx.fill();
    ctx.stroke();

    // Head
    ctx.beginPath();
    ctx.arc(dancerX, dy - headR * 0.9, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Waving Dual Neon Glowsticks (`lighter`)
    const waveAng = Math.sin(hopPhase * 1.0) * 0.65;
    const stickColor = palette[4 + (i % 4)];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgbToCss(stickColor, 0.92);
    ctx.lineWidth = 2.6 * scale;
    ctx.lineCap = 'round';

    for (let arm = -1; arm <= 1; arm += 2) {
      const shoulderX = dancerX + arm * 9 * scale;
      const shoulderY = dy + 4 * scale;
      const tipX = shoulderX + Math.sin(waveAng + arm * 0.45) * 18 * scale;
      const tipY = shoulderY - Math.cos(waveAng * 0.7) * 20 * scale;
      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 7. Diegetic Concert Truss LED Lyric Banner OR WarioWare Beat Micro-Prompt
  const cleanLyric = (activeLyric || '').trim();
  if (cleanLyric.length > 0) {
    const lines = splitIntoBalancedLines(cleanLyric.toUpperCase(), 38);
    const bannerY = Math.max(cropTopY + 14, jumboY - 38);
    const boxW = Math.min(CANVAS_W - 60, Math.max(220, lines[0].length * 8.6 + 34));
    const boxH = lines.length > 1 ? 38 : 24;

    ctx.save();
    ctx.fillStyle = 'rgba(5, 8, 18, 0.88)';
    ctx.strokeStyle = rgbToCss(palette[6], 0.92);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(cx - boxW * 0.5, bannerY, boxW, boxH, 7);
    ctx.fill();
    ctx.stroke();

    ctx.font = '900 12.5px "JetBrains Mono", "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fef9c3';
    for (let li = 0; li < lines.length; li++) {
      ctx.fillText(
        `♪ ${lines[li]} ♪`,
        cx,
        bannerY + (lines.length > 1 ? 11 + li * 15 : boxH * 0.5),
      );
    }
    if (nextLyric && lines.length === 1) {
      ctx.font = '700 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = rgbToCss(palette[5], 0.82);
      ctx.fillText(
        nextLyric.trim().slice(0, 48).toUpperCase(),
        cx,
        bannerY + boxH + 10,
      );
    }
    ctx.restore();
  } else if (beat > 0.42 || drop > 0.3) {
    // Autonomous WarioWare / Arcade Fever callout on strong beats when no lyrics are active
    const promptIdx = Math.floor(timeSec * 0.75) % MICRO_PROMPTS.length;
    const promptText = MICRO_PROMPTS[promptIdx];
    const popScale = 1 + beat * 0.18 + drop * 0.22;
    ctx.save();
    ctx.translate(cx, Math.max(cropTopY + 26, jumboY - 22));
    ctx.scale(popScale, popScale);
    ctx.font = '900 14px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeText(promptText, 0, 0);
    ctx.fillStyle = rgbToCss(palette[7], 0.96);
    ctx.fillText(promptText, 0, 0);
    ctx.restore();
  }

  // 8. Diegetic Front-Row Crowd Fan Sign for Attributed `@username` Comments
  if (activeComment && activeComment.username && activeComment.body) {
    const signW = 250;
    const signH = 38;
    const signX = cx + Math.sin(timeSec * 1.8) * 14 - signW * 0.5;
    const signY = Math.min(cropBottomY - 52, CANVAS_H - 64) - bounce * 5;

    ctx.save();
    // Wooden/neon sign posts held up by the crowd
    ctx.strokeStyle = rgbToCss(palette[5], 0.85);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(signX + 36, signY + signH);
    ctx.lineTo(signX + 32, signY + signH + 22);
    ctx.moveTo(signX + signW - 36, signY + signH);
    ctx.lineTo(signX + signW - 32, signY + signH + 22);
    ctx.stroke();

    ctx.fillStyle = 'rgba(8, 10, 22, 0.92)';
    ctx.strokeStyle = rgbToCss(palette[7], 0.95);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(signX, signY, signW, signH, 9);
    ctx.fill();
    ctx.stroke();

    let textStartX = signX + 12;
    if (commentAvatarImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(signX + 21, signY + signH * 0.5, 12, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(commentAvatarImg, signX + 9, signY + signH * 0.5 - 12, 24, 24);
      ctx.restore();
      textStartX = signX + 39;
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = rgbToCss(palette[6], 0.98);
    ctx.fillText(`@${activeComment.username}`, textStartX, signY + 12);

    ctx.font = '700 10.5px sans-serif';
    ctx.fillStyle = '#f8fafc';
    const maxBody = activeComment.body.trim().slice(0, 34);
    ctx.fillText(
      `“${maxBody}${activeComment.body.length > 34 ? '…' : ''}”`,
      textStartX,
      signY + 26,
    );
    ctx.restore();
  }

  // 9. Arcade Strobe Curtain Transition Effect (`trans > 0.01`)
  if (trans > 0.01) {
    const slats = 12;
    const slatW = CANVAS_W / slats;
    ctx.save();
    for (let sIdx = 0; sIdx < slats; sIdx++) {
      const w = slatW * Math.sin(trans * Math.PI);
      ctx.fillStyle = rgbToCss(
        lerpRgb(palette[3], palette[7], (sIdx % 3) * 0.4),
        0.55 * trans,
      );
      ctx.fillRect(sIdx * slatW, 0, w, CANVAS_H);
    }
    ctx.restore();
  }
}
