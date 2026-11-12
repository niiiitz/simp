import {
  CANVAS_H,
  CANVAS_W,
  rgbToCss,
  splitIntoBalancedLines,
  type SceneRenderContext,
} from './types';

/**
 * Scene `h` — 16-Bit Dark Fantasy Sanctum (High-DPI Canvas2D)
 * - Vaulted gothic cathedral arches with flickering torchlight (`lighter`) & rising embers
 * - Stained-Glass Rose Window high in the nave illuminating live album art (`artCanvas`)
 * - Subterranean mist-shrouded river with cloaked ferryman boat, rising bats & armored guardians
 * - Levitating raytraced Arcane Orb & counter-rotating Runic Portal above the central altar
 * - Diegetic 16-Bit JRPG Gold-Filigree Dialogue Scroll for `activeLyric` & `@username` comments
 */
export function renderSanctumScene(s: SceneRenderContext): void {
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

  const cx = CANVAS_W * 0.5;
  const riverY = 266;

  // 1. Pure #000000 Subterranean Gothic Abyss + Deep Crimson/Indigo Nave Glow
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const naveGlow = ctx.createRadialGradient(cx, 152, 12, cx, 160, 290);
  naveGlow.addColorStop(0, rgbToCss(palette[4], 0.32 + subBass * 0.18 + drop * 0.15));
  naveGlow.addColorStop(0.55, rgbToCss(palette[1], 0.22));
  naveGlow.addColorStop(1, '#000000');
  ctx.fillStyle = naveGlow;
  ctx.fillRect(0, 0, CANVAS_W, riverY);

  // 2. High Cathedral Stained-Glass Rose Window Framing Album Art (`artCanvas`)
  const roseY = 74;
  const roseR = 38 + subBass * 4;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, roseY, roseR, 0, Math.PI * 2);
  ctx.clip();

  if (artReady && artCanvas) {
    ctx.drawImage(artCanvas, cx - roseR, roseY - roseR, roseR * 2, roseR * 2);
    ctx.fillStyle = rgbToCss(palette[5], 0.22 + beat * 0.15);
    ctx.fillRect(cx - roseR, roseY - roseR, roseR * 2, roseR * 2);
  } else {
    const rGrad = ctx.createRadialGradient(cx, roseY, 4, cx, roseY, roseR);
    rGrad.addColorStop(0, rgbToCss(palette[7], 0.9));
    rGrad.addColorStop(0.6, rgbToCss(palette[4], 0.75));
    rGrad.addColorStop(1, '#090d16');
    ctx.fillStyle = rGrad;
    ctx.fillRect(cx - roseR, roseY - roseR, roseR * 2, roseR * 2);
  }

  // Lead-came stained-glass radial spokes & trefoil rings
  ctx.strokeStyle = '#020617';
  ctx.lineWidth = 1.8;
  for (let sp = 0; sp < 8; sp++) {
    const ang = (sp / 8) * Math.PI * 2 + timeSec * 0.08;
    ctx.beginPath();
    ctx.moveTo(cx, roseY);
    ctx.lineTo(cx + Math.cos(ang) * roseR, roseY + Math.sin(ang) * roseR);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, roseY, roseR * 0.56, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = rgbToCss(palette[6], 0.78);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(cx, roseY, roseR, 0, Math.PI * 2);
  ctx.stroke();

  // 3. Vaulted Pointed Gothic Stone Arches & Pillars
  const pillarXPositions = [58, 146, CANVAS_W - 146, CANVAS_W - 58];
  ctx.fillStyle = '#070a14';
  ctx.strokeStyle = rgbToCss(palette[3], 0.55);
  ctx.lineWidth = 1.4;

  for (let p = 0; p < pillarXPositions.length; p++) {
    const px = pillarXPositions[p];
    const pw = p === 0 || p === 3 ? 28 : 22;
    ctx.fillRect(px - pw * 0.5, 24, pw, riverY - 24);
    ctx.strokeRect(px - pw * 0.5, 24, pw, riverY - 24);
  }

  // Pointed Gothic Vault Ribbing Connecting the Pillars
  ctx.strokeStyle = rgbToCss(palette[4], 0.48);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(58, 86);
  ctx.quadraticCurveTo(cx * 0.55, 10, cx, 18);
  ctx.quadraticCurveTo(CANVAS_W - cx * 0.55, 10, CANVAS_W - 58, 86);
  ctx.stroke();

  // 4. Flickering Wall-Sconce Torches & Rising Fire Embers (`lighter`)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let p = 0; p < pillarXPositions.length; p++) {
    const tx = pillarXPositions[p];
    const ty = 138;
    const flicker =
      0.82 +
      Math.sin(timeSec * 14 + p * 2.1) * 0.14 +
      Math.cos(timeSec * 23 + p) * 0.08 +
      beat * 0.25;
    const glowR = (34 + sb[(p * 3) & 15] * 18) * flicker;

    const torchGrad = ctx.createRadialGradient(tx, ty - 6, 2, tx, ty - 6, glowR);
    torchGrad.addColorStop(0, '#ffffff');
    torchGrad.addColorStop(0.28, 'rgba(253, 224, 71, 0.85)');
    torchGrad.addColorStop(0.62, 'rgba(249, 115, 22, 0.36)');
    torchGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = torchGrad;
    ctx.beginPath();
    ctx.arc(tx, ty - 6, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Sconce bracket
    ctx.fillStyle = '#334155';
    ctx.fillRect(tx - 3, ty, 6, 12);
  }

  // Rising Fire Embers
  for (let e = 0; e < 24; e++) {
    const ex = 70 + ((e * 47 + Math.sin(timeSec * 2 + e) * 14) % (CANVAS_W - 140));
    const ey = riverY - ((timeSec * (28 + (e % 5) * 9) + e * 19) % (riverY - 20));
    ctx.fillStyle = (e & 1) === 0 ? 'rgba(251, 146, 60, 0.78)' : rgbToCss(palette[7], 0.72);
    ctx.beginPath();
    ctx.arc(ex, ey, 1.4 + (e % 3) * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 5. Inner Sanctum Altar, Guardian Silhouettes & Raytraced Arcane Orb + Runic Portal
  const altarY = riverY - 12;
  ctx.fillStyle = '#090d1a';
  ctx.strokeStyle = rgbToCss(palette[5], 0.7);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 68, riverY);
  ctx.lineTo(cx - 52, altarY - 16);
  ctx.lineTo(cx + 52, altarY - 16);
  ctx.lineTo(cx + 68, riverY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Flanking Armored Halberdier Guardians
  for (let side = -1; side <= 1; side += 2) {
    const gx = cx + side * 88;
    const gy = riverY - 4;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.fillStyle = '#050812';
    ctx.strokeStyle = rgbToCss(palette[4], 0.68);
    ctx.lineWidth = 1.2;

    // Cloak & Armor Silhouette
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(-9, -34);
    ctx.lineTo(0, -44);
    ctx.lineTo(9, -34);
    ctx.lineTo(12, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Halberd Polearm + Glowing Runic Blade
    ctx.strokeStyle = rgbToCss(palette[7], 0.85);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(side * -10, 0);
    ctx.lineTo(side * -10, -58 - beat * 4);
    ctx.stroke();
    ctx.restore();
  }

  // Levitating Audio-Reactive Arcane Orb & Counter-Rotating Runic Portal (`lighter`)
  const orbY = 176 + Math.sin(timeSec * 2.1) * 6;
  const orbR = 24 + subBass * 10 + beat * 7 + drop * 8;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(cx, orbY);

  // Outer Counter-Rotating Runic Portal Rings
  for (let ring = 0; ring < 2; ring++) {
    const rr = orbR * (1.45 + ring * 0.38);
    ctx.save();
    ctx.rotate(timeSec * (ring === 0 ? 0.75 : -0.55));
    ctx.strokeStyle = rgbToCss(palette[5 + ring * 2], 0.68);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 16-Band Arcane Energy Tendrils Radiating from the Orb
  for (let b = 0; b < 16; b++) {
    const bandAmp = sb[b];
    const ang = (b / 16) * Math.PI * 2 + timeSec * 0.6;
    const len = orbR + 6 + bandAmp * 32;
    ctx.strokeStyle = rgbToCss(palette[4 + (b & 3)], 0.45 + bandAmp * 0.5);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang) * (orbR * 0.7), Math.sin(ang) * (orbR * 0.7));
    ctx.lineTo(Math.cos(ang) * len, Math.sin(ang) * len);
    ctx.stroke();
  }

  // Raytraced Arcane Orb Sphere
  const orbGrad = ctx.createRadialGradient(-orbR * 0.3, -orbR * 0.3, 2, 0, 0, orbR * 1.2);
  orbGrad.addColorStop(0, '#ffffff');
  orbGrad.addColorStop(0.35, rgbToCss(palette[7], 0.95));
  orbGrad.addColorStop(0.75, rgbToCss(palette[4], 0.72));
  orbGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = orbGrad;
  ctx.beginPath();
  ctx.arc(0, 0, orbR * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 6. Flapping Bats Rising Past the Cathedral Arches
  for (let b = 0; b < 6; b++) {
    const bx =
      (((b * 113 + timeSec * (34 + (b % 3) * 12)) % (CANVAS_W - 80)) + 40);
    const by =
      42 + ((b * 37 + Math.sin(timeSec * 2.8 + b) * 18) % 95);
    const wingY = Math.sin(timeSec * 14 + b * 1.7) * 5.5;

    ctx.strokeStyle = rgbToCss(palette[6], 0.78 + highEnergy * 0.2);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx - 8, by + wingY);
    ctx.quadraticCurveTo(bx - 4, by - 4, bx, by);
    ctx.quadraticCurveTo(bx + 4, by - 4, bx + 8, by + wingY);
    ctx.stroke();
  }

  // 7. Subterranean Mist-Shrouded River & Cloaked Ferryman Boat (`y = riverY .. CANVAS_H`)
  const riverGrad = ctx.createLinearGradient(0, riverY, 0, CANVAS_H);
  riverGrad.addColorStop(0, rgbToCss(palette[2], 0.38));
  riverGrad.addColorStop(0.5, rgbToCss(palette[1], 0.22));
  riverGrad.addColorStop(1, '#000000');
  ctx.fillStyle = riverGrad;
  ctx.fillRect(0, riverY, CANVAS_W, CANVAS_H - riverY);

  // Reflected Arcane Orb Shimmer on the River Surface (`lighter`)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let r = 0; r < 14; r++) {
    const norm = r / 14;
    const ry = riverY + 5 + norm * (CANVAS_H - riverY - 10);
    const rw = (28 + norm * 45 + sb[r & 15] * 22);
    const shiftX = Math.sin(timeSec * 3.4 + r) * 8;
    ctx.fillStyle = rgbToCss(palette[5 + (r & 1)], (1 - norm * 0.6) * 0.26);
    ctx.fillRect(cx + shiftX - rw * 0.5, ry, rw, 2.0);
  }
  ctx.restore();

  // Gliding Cloaked Traveler Boat on the Underground River
  const boatX =
    cx - 135 + Math.sin(timeSec * 0.38) * 95;
  const boatY = riverY + 24 + Math.sin(timeSec * 2.2) * 2.5;

  ctx.save();
  ctx.translate(boatX, boatY);
  // Gondola / Skiff Hull
  ctx.fillStyle = '#040711';
  ctx.strokeStyle = rgbToCss(palette[5], 0.82);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-28, 0);
  ctx.quadraticCurveTo(-34, -9, -30, -12);
  ctx.lineTo(-22, -4);
  ctx.lineTo(22, -4);
  ctx.lineTo(30, -12);
  ctx.quadraticCurveTo(34, -9, 28, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cloaked Traveler Silhouette + Glowing Prow Lantern
  ctx.beginPath();
  ctx.moveTo(-8, -4);
  ctx.lineTo(-4, -22);
  ctx.arc(0, -24, 4, Math.PI, Math.PI * 2);
  ctx.lineTo(5, -4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Prow Lantern Glow
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.arc(27, -10, 2.8 + beat * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 8A. Diegetic 16-Bit JRPG Ornate Obsidian & Gold-Filigree Dialogue Box for `activeLyric`
  const cleanLyric = (activeLyric || '').trim();
  if (cleanLyric.length > 0) {
    const lines = splitIntoBalancedLines(`♪ ${cleanLyric} ♪`, 38);
    const boxW = Math.min(CANVAS_W - 68, Math.max(248, lines[0].length * 8.4 + 48));
    const boxH = lines.length * 18 + 20;
    const boxX = cx - boxW * 0.5;
    const boxY = CANVAS_H - boxH - 16;

    ctx.save();
    const dlgGrad = ctx.createLinearGradient(boxX, boxY, boxX, boxY + boxH);
    dlgGrad.addColorStop(0, 'rgba(15, 23, 52, 0.92)');
    dlgGrad.addColorStop(1, 'rgba(4, 7, 18, 0.95)');
    ctx.fillStyle = dlgGrad;
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 7);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(254, 240, 138, 0.42)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.roundRect(boxX + 3, boxY + 3, boxW - 6, boxH - 6, 5);
    ctx.stroke();

    ctx.font = '700 13px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fef9c3';
    for (let li = 0; li < lines.length; li++) {
      const ly = boxY + boxH * 0.5 + (li - (lines.length - 1) * 0.5) * 17;
      ctx.fillText(lines[li], cx, ly);
    }
    ctx.restore();
  }

  // 8B. Separate Diegetic Floating Runic Whisper Scroll for Attributed `@username` Comments
  if (activeComment && activeComment.username && activeComment.body) {
    const whisperW = 248;
    const whisperH = 38;
    const whisperX = CANVAS_W - whisperW - 26;
    const whisperY = 34 + Math.sin(timeSec * 0.95) * 3;

    ctx.save();
    ctx.fillStyle = 'rgba(12, 16, 36, 0.90)';
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(whisperX, whisperY, whisperW, whisperH, 7);
    ctx.fill();
    ctx.stroke();

    let textX = whisperX + 12;
    if (commentAvatarImg) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(whisperX + 9, whisperY + 7, 24, 24, 4);
      ctx.clip();
      ctx.drawImage(commentAvatarImg, whisperX + 9, whisperY + 7, 24, 24);
      ctx.restore();
      textX = whisperX + 38;
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#fde047';
    ctx.fillText(`✦ @${activeComment.username}`, textX, whisperY + 12);

    ctx.font = 'italic 700 11px Georgia, serif';
    ctx.fillStyle = '#f8fafc';
    const maxBody = activeComment.body.trim().slice(0, 32);
    ctx.fillText(
      `“${maxBody}${activeComment.body.length > 32 ? '…' : ''}”`,
      textX,
      whisperY + 26,
    );
    ctx.restore();
  }

  // 9. SNES RPG Battle Swirl Transition (`trans > 0.01`)
  if (trans > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, CANVAS_H * 0.5);
    ctx.rotate(trans * Math.PI * 3);
    ctx.strokeStyle = rgbToCss(palette[7], Math.sin(trans * Math.PI) * 0.72);
    ctx.lineWidth = 4;
    for (let arm = 0; arm < 4; arm++) {
      ctx.rotate(Math.PI * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, trans * 280, 0, Math.PI * 0.75);
      ctx.stroke();
    }
    ctx.restore();
  }
}
