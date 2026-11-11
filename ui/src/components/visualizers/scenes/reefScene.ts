import {
  CANVAS_H,
  CANVAS_W,
  rgbToCss,
  splitIntoBalancedLines,
  type SceneRenderContext,
} from './types';

/**
 * Scene `d` — Coral Reef & Water Caustics (High-DPI Canvas2D)
 * - Deep-abyss bioluminescent reef with slow, tranquil surface wave heightfield & volumetric caustic rays (`lighter`)
 * - Sunken Nautilus/Atlantis bronze porthole framing `artCanvas` on the mid-ground reef wall
 * - Gently swaying Bezier kelp forests, branching staghorn coral, drifting jellyfish
 * - Unhurried rising bubble streams & a beat-snapping neon reef crab on the seabed
 * - Separate diegetic slots for `activeLyric` (Upper Current) and `@username` comments (Lower Sonar Pearl Capsule)
 */
export function renderReefScene(s: SceneRenderContext): void {
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

  const seabedY = 296;

  // 1. Deep-Abyss Ocean Gradient (#000000 Trench Floor -> Bioluminescent Surface)
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const waterGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  waterGrad.addColorStop(0, rgbToCss(palette[4], 0.44 + highEnergy * 0.15));
  waterGrad.addColorStop(0.38, rgbToCss(palette[2], 0.34 + midEnergy * 0.12));
  waterGrad.addColorStop(0.78, rgbToCss(palette[1], 0.25));
  waterGrad.addColorStop(1, '#000000');
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 2. Slow, Tranquil Ocean Surface Wave Heightfield & Volumetric Caustic God-Rays (`lighter`)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const numRays = 9;
  for (let r = 0; r < numRays; r++) {
    const bandVal = sb[(r * 2) & 15];
    const topX = 45 + (r / (numRays - 1)) * (CANVAS_W - 90) + Math.sin(timeSec * 0.24 + r) * 14;
    const botX = topX + Math.sin(timeSec * 0.16 + r * 0.7) * 42 - 12;
    const topW = 14 + bandVal * 14;
    const botW = 36 + bandVal * 32 + beat * 10;

    const rayGrad = ctx.createLinearGradient(topX, 14, botX, seabedY + 20);
    rayGrad.addColorStop(0, rgbToCss(palette[6], 0.24 + bandVal * 0.18 + beat * 0.10));
    rayGrad.addColorStop(0.55, rgbToCss(palette[4], 0.10 + bandVal * 0.08));
    rayGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = rayGrad;
    ctx.beginPath();
    ctx.moveTo(topX - topW * 0.5, 10);
    ctx.lineTo(topX + topW * 0.5, 10);
    ctx.lineTo(botX + botW * 0.5, seabedY + 20);
    ctx.lineTo(botX - botW * 0.5, seabedY + 20);
    ctx.closePath();
    ctx.fill();
  }

  // Gentle surface wave crest ribbon
  ctx.strokeStyle = rgbToCss(palette[7], 0.65 + beat * 0.2);
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  for (let x = 0; x <= CANVAS_W; x += 10) {
    const wy =
      18 +
      Math.sin(x * 0.022 + timeSec * 0.72) * (3.5 + subBass * 3.5) +
      Math.cos(x * 0.048 - timeSec * 0.95) * 2.0;
    if (x === 0) ctx.moveTo(x, wy);
    else ctx.lineTo(x, wy);
  }
  ctx.stroke();
  ctx.restore();

  // 3. Mid-Ground Reef Cliff & Sunken Nautilus Album-Art Porthole Medallion
  ctx.fillStyle = '#040814';
  ctx.strokeStyle = rgbToCss(palette[3], 0.55);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, seabedY);
  for (let x = 0; x <= CANVAS_W; x += 16) {
    const mound =
      Math.sin(x * 0.012 + 0.8) * 26 +
      Math.cos(x * 0.028 - 1.4) * 14 +
      (Math.abs(x - CANVAS_W * 0.78) < 95 ? 48 : 0);
    ctx.lineTo(x, seabedY - 22 - Math.max(0, mound));
  }
  ctx.lineTo(CANVAS_W, seabedY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Sunken Nautilus Porthole Framing Album Art (`artCanvas`) on Right Reef Mound
  const portX = CANVAS_W * 0.78;
  const portY = seabedY - 58;
  const portR = 32 + subBass * 3;

  ctx.save();
  ctx.beginPath();
  ctx.arc(portX, portY, portR, 0, Math.PI * 2);
  ctx.clip();

  if (artReady && artCanvas) {
    ctx.drawImage(artCanvas, portX - portR, portY - portR, portR * 2, portR * 2);
    ctx.fillStyle = rgbToCss(palette[4], 0.24);
    ctx.fillRect(portX - portR, portY - portR, portR * 2, portR * 2);
  } else {
    const pGrad = ctx.createRadialGradient(portX, portY, 4, portX, portY, portR);
    pGrad.addColorStop(0, rgbToCss(palette[6], 0.75));
    pGrad.addColorStop(1, '#020610');
    ctx.fillStyle = pGrad;
    ctx.fillRect(portX - portR, portY - portR, portR * 2, portR * 2);
  }
  ctx.restore();

  ctx.strokeStyle = rgbToCss(palette[5], 0.85);
  ctx.lineWidth = 3.0;
  ctx.beginPath();
  ctx.arc(portX, portY, portR, 0, Math.PI * 2);
  ctx.stroke();

  // 4. Seabed Floor & Slow-Drifting Voronoi/Sine Water Caustic Mesh (`lighter`)
  ctx.fillStyle = '#030611';
  ctx.fillRect(0, seabedY, CANVAS_W, CANVAS_H - seabedY);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const causticRows = 5;
  const causticCols = 14;
  for (let r = 0; r < causticRows; r++) {
    const d0 = r / causticRows;
    const ry = seabedY + 6 + d0 * (CANVAS_H - seabedY - 10);
    for (let c = 0; c < causticCols; c++) {
      const cxCell =
        (c / (causticCols - 1)) * CANVAS_W +
        Math.sin(timeSec * 0.58 + r * 1.3 + c * 0.9) * 14;
      const cellR = 14 + d0 * 18 + sb[(c + r) & 15] * 8;
      ctx.strokeStyle = rgbToCss(palette[5 + (r & 1)], 0.14 + sb[c & 15] * 0.18);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(cxCell, ry, cellR, cellR * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  // 5. Gently Swaying Bezier Kelp Blades & Bioluminescent Coral Polyps
  const kelpClusters = [42, 96, 168, 254, 372, 468, 594];
  for (let k = 0; k < kelpClusters.length; k++) {
    const baseX = kelpClusters[k];
    const bandAmp = sb[(k * 2) & 15];
    const kelpH = 72 + (k % 3) * 28 + bandAmp * 18;
    const sway1 = Math.sin(timeSec * 0.55 + k) * (12 + subBass * 6);
    const sway2 = Math.cos(timeSec * 0.72 + k * 1.4) * 14;

    const kelpPal = palette[3 + (k % 4)];
    ctx.strokeStyle = rgbToCss(kelpPal, 0.82);
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(baseX, seabedY + 4);
    ctx.bezierCurveTo(
      baseX + sway1,
      seabedY - kelpH * 0.45,
      baseX - sway2,
      seabedY - kelpH * 0.78,
      baseX + sway1 * 0.8,
      seabedY - kelpH,
    );
    ctx.stroke();

    const tipX = baseX + sway1 * 0.8;
    const tipY = seabedY - kelpH;
    ctx.fillStyle = rgbToCss(palette[7], 0.85 + beat * 0.15);
    ctx.beginPath();
    ctx.arc(tipX, tipY, 3.2 + bandAmp * 2.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6. Slow-Drifting Bioluminescent Jellyfish
  for (let j = 0; j < 4; j++) {
    const jx =
      (((j * 165 + timeSec * (6 + j * 1.5)) % (CANVAS_W + 60)) - 30);
    const jy =
      88 +
      (j % 2) * 58 +
      Math.sin(timeSec * 0.65 + j * 2.1) * 16;
    const pulse = 0.84 + 0.20 * Math.sin(timeSec * 1.35 + j);
    const bellR = (13 + (j % 2) * 4) * pulse;
    const jellyColor = palette[4 + (j % 4)];

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const jGrad = ctx.createRadialGradient(jx, jy - 3, 2, jx, jy, bellR * 1.3);
    jGrad.addColorStop(0, '#ffffff');
    jGrad.addColorStop(0.45, rgbToCss(jellyColor, 0.75));
    jGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = jGrad;
    ctx.beginPath();
    ctx.arc(jx, jy, bellR, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = rgbToCss(jellyColor, 0.62);
    ctx.lineWidth = 1.1;
    for (let t = -2; t <= 2; t++) {
      ctx.beginPath();
      ctx.moveTo(jx + t * 3.5, jy);
      ctx.quadraticCurveTo(
        jx + t * 4.5 + Math.sin(timeSec * 1.6 + t + j) * 6,
        jy + 14,
        jx + t * 3.5 - Math.cos(timeSec * 1.3 + t) * 7,
        jy + 28,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // 7. Slow, Steady Rising Bubble Streams (No `bandVal * timeSec` position jumping!)
  ctx.save();
  for (let b = 0; b < 28; b++) {
    const bandVal = sb[b & 15];
    const steadyRiseSpeed = 10 + (b % 5) * 2.6;
    const bx =
      ((b * 41.7) % (CANVAS_W - 24)) +
      12 +
      Math.sin(timeSec * 0.75 + b) * 5;
    const by =
      seabedY - ((timeSec * steadyRiseSpeed + b * 29) % (seabedY - 22));
    const br = 1.8 + (b % 3) * 1.1 + bandVal * 1.8;

    ctx.strokeStyle = rgbToCss(palette[6 + (b & 1)], 0.48 + bandVal * 0.32);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // 8. Foreground Beat-Snapping Neon Reef Crab (`seabedY + 26`)
  const crabX =
    CANVAS_W * 0.30 +
    Math.sin(timeSec * 0.38) * 58;
  const crabY = seabedY + 24 - Math.abs(Math.sin(timeSec * 1.8)) * 2.5;
  const clawSnap = beat > 0.35 || drop > 0.2 ? 0.08 : 0.42 + Math.sin(timeSec * 2.5) * 0.16;

  ctx.save();
  ctx.translate(crabX, crabY);
  const crabColor = palette[6] || [251, 113, 133];

  ctx.strokeStyle = rgbToCss(crabColor, 0.9);
  ctx.lineWidth = 1.8;
  for (let side = -1; side <= 1; side += 2) {
    for (let leg = 0; leg < 3; leg++) {
      const legWave = Math.sin(timeSec * 3.8 + leg * 1.4 + side) * 2.8;
      ctx.beginPath();
      ctx.moveTo(side * 10, 2 + leg * 2);
      ctx.lineTo(side * (18 + leg * 2), -2 + leg * 3 + legWave);
      ctx.lineTo(side * (22 + leg * 2), 7 + leg * 2);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(side * 13, -7);
    ctx.rotate(side * -0.45);
    ctx.fillStyle = rgbToCss(palette[7], 0.95);
    ctx.beginPath();
    ctx.arc(0, -6, 6.5, clawSnap, Math.PI * 2 - clawSnap);
    ctx.lineTo(0, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = rgbToCss(crabColor, 0.96);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 8.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.arc(-4.5, -9.5, 2.2, 0, Math.PI * 2);
  ctx.arc(4.5, -9.5, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 9A. Diegetic Upper Bioluminescent Current Text for `activeLyric`
  const cleanLyric = (activeLyric || '').trim();
  if (cleanLyric.length > 0) {
    const lines = splitIntoBalancedLines(cleanLyric, 38);
    const currentY = 122 + Math.sin(timeSec * 0.85) * 4;
    const boxW = Math.min(CANVAS_W - 64, Math.max(210, lines[0].length * 8.4 + 34));
    const boxH = lines.length * 18 + 14;

    ctx.save();
    ctx.translate(CANVAS_W * 0.5, currentY);
    ctx.fillStyle = 'rgba(3, 10, 24, 0.78)';
    ctx.strokeStyle = rgbToCss(palette[6], 0.85);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-boxW * 0.5, -boxH * 0.5, boxW, boxH, 16);
    ctx.fill();
    ctx.stroke();

    ctx.font = '800 12.5px "JetBrains Mono", "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ecfeff';
    for (let li = 0; li < lines.length; li++) {
      const ly = (li - (lines.length - 1) * 0.5) * 17;
      ctx.fillText(`♪ ${lines[li]} ♪`, 0, ly);
    }
    ctx.restore();
  }

  // 9B. Separate Diegetic Lower Sonar Pearl Capsule for Attributed `@username` Comments
  if (activeComment && activeComment.username && activeComment.body) {
    const capW = 248;
    const capH = 38;
    const capX = CANVAS_W * 0.54 - capW * 0.5;
    const capY = seabedY - 52 + Math.sin(timeSec * 0.95) * 3;

    ctx.save();
    ctx.fillStyle = 'rgba(4, 14, 28, 0.88)';
    ctx.strokeStyle = rgbToCss(palette[7], 0.9);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(capX, capY, capW, capH, 19);
    ctx.fill();
    ctx.stroke();

    let textX = capX + 14;
    if (commentAvatarImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(capX + 21, capY + capH * 0.5, 11, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(commentAvatarImg, capX + 10, capY + capH * 0.5 - 11, 22, 22);
      ctx.restore();
      textX = capX + 38;
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = rgbToCss(palette[6], 0.98);
    ctx.fillText(`@${activeComment.username}`, textX, capY + 12);

    ctx.font = '700 10.5px sans-serif';
    ctx.fillStyle = '#f8fafc';
    const maxBody = activeComment.body.trim().slice(0, 33);
    ctx.fillText(
      `“${maxBody}${activeComment.body.length > 33 ? '…' : ''}”`,
      textX,
      capY + 26,
    );
    ctx.restore();
  }

  // 10. Rising Bubble Wall Transition (`trans > 0.01`)
  if (trans > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 28; i++) {
      const bx = ((i * 53) % CANVAS_W);
      const by = (1 - trans) * CANVAS_H + ((i * 29) % 80) - 40;
      ctx.fillStyle = rgbToCss(palette[5 + (i & 1)], Math.sin(trans * Math.PI) * 0.55);
      ctx.beginPath();
      ctx.arc(bx, by, 8 + (i % 5) * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
