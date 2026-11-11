import {
  CANVAS_H,
  CANVAS_W,
  lerpRgb,
  rgbToCss,
  splitIntoBalancedLines,
  type SceneRenderContext,
} from './types';

function ridgeHeight(x: number, seed: number, scale1: number, scale2: number): number {
  return (
    Math.sin(x * scale1 + seed) * 0.55 +
    Math.cos(x * scale2 - seed * 1.7) * 0.30 +
    Math.sin(x * scale1 * 2.3 + seed * 3.1) * 0.15
  );
}

/**
 * Scene `b` — Midnight Mountain Parallax (High-DPI Canvas2D)
 * - True #000000 midnight sky with twinkling stars & sweeping volumetric aurora borealis (`lighter`)
 * - Radial-gradient supermoon with subtle album-art crater luminance relief (`artCanvas`)
 * - Bass-triggered branching vector lightning bolts illuminating the valley peaks
 * - 4-layer vector mountain & pine forest parallax + wind-driven sleet streaks
 * - Scanline-displaced mirror lake reflecting the moon, aurora, mountains & water-surface ripple lyrics/comments
 */
export function renderMidnightScene(s: SceneRenderContext): void {
  const {
    ctx,
    timeSec,
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
    activeComment,
    commentAvatarImg,
  } = s;

  const lakeY = 238;
  const lightningFlash =
    drop > 0.25 || beat > 0.52
      ? Math.min(1, (drop * 0.85 + Math.max(0, beat - 0.45) * 1.5))
      : 0;

  // 1. Deep #000000 Midnight Sky + Subtle Horizon Zenith Glow
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const skyGrad = ctx.createLinearGradient(0, 0, 0, lakeY);
  skyGrad.addColorStop(0, '#000000');
  skyGrad.addColorStop(0.55, rgbToCss(palette[1], 0.32 + lightningFlash * 0.22));
  skyGrad.addColorStop(1, rgbToCss(palette[3], 0.42 + subBass * 0.18 + lightningFlash * 0.28));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, lakeY);

  // Twinkling Zenith Stars
  for (let i = 0; i < 48; i++) {
    const sx = ((i * 137.5) % CANVAS_W);
    const sy = ((i * 73.1) % (lakeY * 0.65));
    const twinkle = 0.25 + 0.75 * Math.abs(Math.sin(timeSec * (1.2 + (i % 5) * 0.4) + i));
    ctx.fillStyle = `rgba(248, 250, 252, ${(twinkle * 0.75).toFixed(2)})`;
    ctx.fillRect(sx, sy, i % 4 === 0 ? 1.8 : 1.1, i % 4 === 0 ? 1.8 : 1.1);
  }

  // 2. Volumetric Aurora Borealis Ribbons (`lighter`)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let a = 0; a < 2; a++) {
    const auroraPal = palette[4 + a * 2];
    ctx.beginPath();
    const baseY = 48 + a * 26;
    for (let x = 0; x <= CANVAS_W; x += 16) {
      const bandVal = sb[(Math.floor(x / 40) + a * 4) & 15];
      const waveY =
        baseY +
        Math.sin(x * 0.012 + timeSec * (0.55 + a * 0.22)) * 18 +
        Math.cos(x * 0.025 - timeSec * 0.4) * (10 + bandVal * 16);
      if (x === 0) ctx.moveTo(x, waveY);
      else ctx.lineTo(x, waveY);
    }
    ctx.lineTo(CANVAS_W, baseY - 38);
    ctx.lineTo(0, baseY - 38);
    ctx.closePath();

    const aurGrad = ctx.createLinearGradient(0, baseY - 36, 0, baseY + 34);
    aurGrad.addColorStop(0, 'rgba(0,0,0,0)');
    aurGrad.addColorStop(0.5, rgbToCss(auroraPal, 0.16 + midEnergy * 0.20 + highEnergy * 0.12));
    aurGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aurGrad;
    ctx.fill();
  }
  ctx.restore();

  // 3. Supermoon with Album-Art Crater Luminance & Radial Corona
  const moonX = CANVAS_W * 0.74 + Math.sin(timeSec * 0.08) * 14;
  const moonY = 76;
  const moonR = 36 + subBass * 5 + beat * 3;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const corona = ctx.createRadialGradient(moonX, moonY, moonR * 0.5, moonX, moonY, moonR * 2.8);
  corona.addColorStop(0, rgbToCss(palette[7], 0.48 + beat * 0.2));
  corona.addColorStop(0.45, rgbToCss(palette[5], 0.18 + subBass * 0.14));
  corona.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = corona;
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR * 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
  ctx.clip();

  const moonSurf = ctx.createRadialGradient(
    moonX - moonR * 0.28,
    moonY - moonR * 0.28,
    moonR * 0.1,
    moonX,
    moonY,
    moonR,
  );
  moonSurf.addColorStop(0, '#fefce8');
  moonSurf.addColorStop(0.65, rgbToCss(palette[7], 0.92));
  moonSurf.addColorStop(1, rgbToCss(palette[4], 0.88));
  ctx.fillStyle = moonSurf;
  ctx.fillRect(moonX - moonR, moonY - moonR, moonR * 2, moonR * 2);

  if (artReady && artCanvas) {
    ctx.globalAlpha = 0.28;
    ctx.drawImage(artCanvas, moonX - moonR, moonY - moonR, moonR * 2, moonR * 2);
    ctx.globalAlpha = 1.0;
  }
  ctx.restore();

  // 4. Bass-Triggered Branching Vector Lightning Bolts
  if (lightningFlash > 0.08) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const boltSeed = Math.floor(timeSec * 12);
    const startX = 120 + ((boltSeed * 97) % 280);
    ctx.strokeStyle = `rgba(240, 249, 255, ${(lightningFlash * 0.95).toFixed(2)})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    let bx = startX;
    let by = 0;
    ctx.moveTo(bx, by);
    for (let seg = 1; seg <= 9; seg++) {
      const ny = (seg / 9) * (lakeY - 35);
      const jitter = Math.sin(boltSeed * 3.7 + seg * 2.3) * 22;
      const nx = bx + jitter;
      ctx.lineTo(nx, ny);
      // Secondary branch fork
      if (seg === 4 || seg === 6) {
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx + jitter * 1.3, ny + 28);
        ctx.moveTo(nx, ny);
      }
      bx = nx;
      by = ny;
    }
    ctx.stroke();
    ctx.restore();
  }

  // 5. 3-Layer Parallax Mountain Ridges + Foreground Pine Silhouette Layer
  const layers = [
    { speed: 6, baseH: 105, amp: 44, palIdx: 2, rimAlpha: 0.45 },
    { speed: 14, baseH: 74, amp: 32, palIdx: 1, rimAlpha: 0.35 },
    { speed: 26, baseH: 44, amp: 20, palIdx: 0, rimAlpha: 0.28 },
  ];

  for (let l = 0; l < layers.length; l++) {
    const lay = layers[l];
    const scrollX = timeSec * lay.speed;
    ctx.beginPath();
    ctx.moveTo(0, lakeY);
    for (let x = 0; x <= CANVAS_W; x += 8) {
      const wx = x + scrollX;
      const h =
        lay.baseH +
        ridgeHeight(wx, l * 4.2 + 1.1, 0.0085, 0.021) * lay.amp +
        sb[(Math.floor(x / 40) + l * 3) & 15] * 8;
      ctx.lineTo(x, lakeY - h);
    }
    ctx.lineTo(CANVAS_W, lakeY);
    ctx.closePath();

    const fillRgb =
      l === 2
        ? ([4, 7, 15] as [number, number, number])
        : lerpRgb([6, 9, 18], palette[lay.palIdx + 1], 0.38);
    ctx.fillStyle = rgbToCss(fillRgb, 0.98);
    ctx.fill();

    // Specular ridge rim-light (brightens during lightning or bass peaks)
    ctx.strokeStyle = rgbToCss(
      palette[5 + (l & 1)],
      lay.rimAlpha + lightningFlash * 0.45 + subBass * 0.18,
    );
    ctx.lineWidth = l === 0 ? 1.5 : 1.0;
    ctx.stroke();
  }

  // Foreground Pine Tree Silhouettes along the shoreline (`lakeY`)
  const pineScroll = timeSec * 42;
  ctx.fillStyle = '#02040a';
  ctx.beginPath();
  for (let px = -16; px <= CANVAS_W + 16; px += 14) {
    const worldIdx = Math.floor((px + pineScroll) / 14);
    const offset = (px + pineScroll) % 14;
    const drawX = px - offset;
    const treeH = 16 + ((Math.abs(worldIdx * 37) % 5) * 4.5);
    ctx.moveTo(drawX - 6, lakeY);
    ctx.lineTo(drawX, lakeY - treeH);
    ctx.lineTo(drawX + 6, lakeY);
  }
  ctx.closePath();
  ctx.fill();

  // 6. Scanline-Displaced Mirror Lake Reflection (`y = lakeY .. CANVAS_H`)
  const lakeH = CANVAS_H - lakeY;
  const lakeGrad = ctx.createLinearGradient(0, lakeY, 0, CANVAS_H);
  lakeGrad.addColorStop(0, rgbToCss(palette[2], 0.42 + lightningFlash * 0.2));
  lakeGrad.addColorStop(0.45, rgbToCss(palette[1], 0.26));
  lakeGrad.addColorStop(1, '#000000');
  ctx.fillStyle = lakeGrad;
  ctx.fillRect(0, lakeY, CANVAS_W, lakeH);

  // Reflected Moon Column & Shimmering Water Ripples (`lighter`)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const numRipples = 32;
  for (let r = 0; r < numRipples; r++) {
    const normD = (r + 0.5) / numRipples;
    const ry = lakeY + normD * lakeH;
    const bandAmp = sb[r & 15];
    const waveShift =
      Math.sin(timeSec * 3.8 + r * 0.75) * (6 + normD * 18 + subBass * 10);
    const shimmerW = (moonR * (0.65 + normD * 1.15) + bandAmp * 26);
    const alpha = (1 - normD * 0.65) * (0.22 + bandAmp * 0.28 + beat * 0.16);

    ctx.fillStyle = rgbToCss(palette[6 - (r & 1)], alpha);
    ctx.fillRect(
      moonX + waveShift - shimmerW * 0.5,
      ry,
      shimmerW,
      1.6 + normD * 1.4,
    );
  }
  ctx.restore();

  // Shoreline mist / horizon separator
  const mistGrad = ctx.createLinearGradient(0, lakeY - 8, 0, lakeY + 10);
  mistGrad.addColorStop(0, 'rgba(0,0,0,0)');
  mistGrad.addColorStop(0.5, rgbToCss(palette[5], 0.28 + subBass * 0.15));
  mistGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mistGrad;
  ctx.fillRect(0, lakeY - 8, CANVAS_W, 18);

  // 7. Wind-Driven Sleet Streaks (steady diagonal velocity so sleet never teleports on bass peaks)
  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.34)';
  ctx.lineWidth = 1.0;
  const sleetCount = 38;
  ctx.beginPath();
  for (let i = 0; i < sleetCount; i++) {
    const speedY = 95 + (i % 5) * 18;
    const speedX = -48;
    const sx =
      (((i * 97.3 + timeSec * speedX) % CANVAS_W) + CANVAS_W) % CANVAS_W;
    const sy = ((i * 53.7 + timeSec * speedY) % CANVAS_H);
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - 6, sy + 10);
  }
  ctx.stroke();
  ctx.restore();

  // 8A. Diegetic Lake-Surface Water Reflection Lyrics (Lower Mirror Lake)
  const cleanLyric = (activeLyric || '').trim();
  if (cleanLyric.length > 0) {
    const lines = splitIntoBalancedLines(cleanLyric, 40);
    const waterCenterY = lakeY + lakeH * 0.52;

    ctx.save();
    ctx.font = '800 13.5px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let li = 0; li < lines.length; li++) {
      const ly = waterCenterY + (li - (lines.length - 1) * 0.5) * 18;
      const rippleX = Math.sin(timeSec * 1.8 + li) * 3.0;

      ctx.fillStyle = 'rgba(2, 6, 18, 0.85)';
      ctx.fillText(lines[li], CANVAS_W * 0.5 + rippleX, ly + 2);

      ctx.fillStyle = rgbToCss(palette[5], 0.42 + beat * 0.25);
      ctx.fillText(
        lines[li],
        CANVAS_W * 0.5 - rippleX * 1.3,
        ly + 7 + Math.sin(timeSec * 3.2) * 1.5,
      );

      ctx.fillStyle = '#fef9c3';
      ctx.fillText(lines[li], CANVAS_W * 0.5 + rippleX, ly);
    }
    ctx.restore();
  }

  // 8B. Separate Diegetic Aurora Constellation Banner for Attributed `@username` Comments (Upper Sky)
  if (activeComment && activeComment.username && activeComment.body) {
    const skyX = CANVAS_W * 0.34 + Math.sin(timeSec * 0.65) * 10;
    const skyY = 54 + Math.cos(timeSec * 0.85) * 4;
    const maxBody = activeComment.body.trim().slice(0, 40);
    const pillW = Math.min(310, Math.max(195, maxBody.length * 6.5 + 56));
    const pillH = 36;

    ctx.save();
    ctx.translate(skyX, skyY);
    ctx.fillStyle = 'rgba(6, 12, 26, 0.82)';
    ctx.strokeStyle = rgbToCss(palette[6], 0.85);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.roundRect(-pillW * 0.5, -pillH * 0.5, pillW, pillH, 18);
    ctx.fill();
    ctx.stroke();

    let textLeft = -pillW * 0.5 + 14;
    if (commentAvatarImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(-pillW * 0.5 + 20, 0, 11, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(commentAvatarImg, -pillW * 0.5 + 9, -11, 22, 22);
      ctx.restore();
      textLeft = -pillW * 0.5 + 37;
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = rgbToCss(palette[7], 0.98);
    ctx.fillText(`★ @${activeComment.username}`, textLeft, -6);

    ctx.font = '700 10.5px Georgia, serif';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(
      `“${maxBody}${activeComment.body.length > 40 ? '…' : ''}”`,
      textLeft,
      7,
    );
    ctx.restore();
  }

  // 9. Rolling Mist & Sleet Wipe Transition (`trans > 0.01`)
  if (trans > 0.01) {
    const mistAlpha = Math.sin(trans * Math.PI) * 0.72;
    const wipeGrad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
    wipeGrad.addColorStop(0, rgbToCss(palette[4], mistAlpha));
    wipeGrad.addColorStop(0.5, rgbToCss(palette[6], mistAlpha * 0.85));
    wipeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = wipeGrad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}
