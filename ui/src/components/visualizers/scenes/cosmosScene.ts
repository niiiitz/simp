import {
  CANVAS_H,
  CANVAS_W,
  rgbToCss,
  splitIntoBalancedLines,
  type SceneRenderContext,
} from './types';

/**
 * Scene `c` — Cosmic Warp & 50s Saucer (High-DPI Canvas2D)
 * - Autonomous 4-phase space odyssey:
 *   0: Big Bang Singularity & Radial Shockwave
 *   1: Swirling Volumetric Spiral Nebula (`lighter`)
 *   2: Event-Horizon Black Hole & Gravitational Lensing Accretion Disk
 *   3: Hyperspace Star-Streak Warp Tunnel
 * - Raytraced 1950s Plan-9 metallic flying saucer visibly dangling from a pendulum string
 * - Volumetric tractor-beam cone suspending holographic lyrics & `@username` comments
 */
export function renderCosmosScene(s: SceneRenderContext): void {
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
  const cy = CANVAS_H * 0.5;

  // 1. Pure #000000 OLED Deep Space Abyss
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Autonomous 4-phase space cycle (~20s per phase, crossfaded smoothly)
  const phaseDuration = 20.0;
  const totalCycle = phaseDuration * 4;
  const cycleT = timeSec % totalCycle;
  const phaseIdx = Math.floor(cycleT / phaseDuration);

  // 2. 3D Perspective Starfield (84 stars, steady forward velocity so stars never jump on bass hits)
  const steadyWarp = phaseIdx === 3 ? 0.58 : 0.28;

  ctx.save();
  for (let i = 0; i < 84; i++) {
    const angle = i * 2.39996 + timeSec * 0.03; // Golden angle distribution
    const radBase = 0.14 + ((i * 19) % 83) / 83;
    const z = Math.max(0.08, 1.5 - ((timeSec * steadyWarp + i * 0.037) % 1.42));
    const projScale = 240 / z;
    const sx = cx + Math.cos(angle) * radBase * projScale;
    const sy = cy + Math.sin(angle) * radBase * projScale * 0.68;

    if (sx < -20 || sx > CANVAS_W + 20 || sy < -20 || sy > CANVAS_H + 20) continue;

    const tailZ =
      z + (phaseIdx === 3 || drop > 0.2 ? 0.12 + subBass * 0.08 + drop * 0.10 : 0.035 + subBass * 0.04);
    const tailScale = 240 / tailZ;
    const tx = cx + Math.cos(angle) * radBase * tailScale;
    const ty = cy + Math.sin(angle) * radBase * tailScale * 0.68;

    const starPal = palette[4 + (i & 3)];
    const alpha = Math.min(0.95, (1.5 - z) * 0.72);
    ctx.strokeStyle = rgbToCss(starPal, alpha);
    ctx.lineWidth = Math.max(1.0, (1.6 - z) * 1.6);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(sx, sy);
    ctx.stroke();
  }
  ctx.restore();

  // 3. Autonomous Cosmic Centerpiece (Nebula / Black Hole / Big Bang Shockwave)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  if (phaseIdx === 0) {
    // PHASE 0: Big Bang Singularity & Expanding Particle Shockwave Rings
    const pulseR = 24 + ((cycleT % phaseDuration) / phaseDuration) * 185 + subBass * 28;
    const coreGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, pulseR);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.22, rgbToCss(palette[7], 0.72));
    coreGrad.addColorStop(0.55, rgbToCss(palette[5], 0.28 + beat * 0.2));
    coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
    ctx.fill();

    for (let p = 0; p < 36; p++) {
      const ang = (p / 36) * Math.PI * 2 + timeSec * 0.4;
      const dist = ((p * 17 + timeSec * 68) % 190) + sb[p & 15] * 24;
      const px = cx + Math.cos(ang) * dist;
      const py = cy + Math.sin(ang) * dist * 0.65;
      ctx.fillStyle = rgbToCss(palette[3 + (p & 3)], 0.78);
      ctx.beginPath();
      ctx.arc(px, py, 1.8 + sb[p & 15] * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (phaseIdx === 1 || phaseIdx === 3) {
    // PHASE 1 & 3: Swirling Multi-Arm Volumetric Spiral Nebula
    const arms = 3;
    for (let arm = 0; arm < arms; arm++) {
      for (let k = 0; k < 14; k++) {
        const norm = k / 14;
        const theta =
          norm * Math.PI * 2.6 +
          (arm * Math.PI * 2) / arms -
          timeSec * (0.45 + midEnergy * 0.2);
        const r = 14 + norm * 165;
        const nx = cx + Math.cos(theta) * r;
        const ny = cy + Math.sin(theta) * r * 0.58;
        const puffR = 26 + norm * 48 + sb[(k + arm) & 15] * 22;

        const nebGrad = ctx.createRadialGradient(nx, ny, 2, nx, ny, puffR);
        nebGrad.addColorStop(
          0,
          rgbToCss(palette[3 + ((k + arm) % 4)], 0.22 + sb[k & 15] * 0.16),
        );
        nebGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = nebGrad;
        ctx.beginPath();
        ctx.arc(nx, ny, puffR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    // PHASE 2: Event-Horizon Black Hole & Gravitational Lensing Accretion Disk
    const holeR = 34 + subBass * 10;
    // Relativistic Photon Halo
    const haloGrad = ctx.createRadialGradient(
      cx,
      cy,
      holeR * 0.85,
      cx,
      cy,
      holeR * 3.1,
    );
    haloGrad.addColorStop(0, rgbToCss(palette[7], 0.92));
    haloGrad.addColorStop(0.28, rgbToCss(palette[5], 0.48 + beat * 0.25));
    haloGrad.addColorStop(0.65, rgbToCss(palette[3], 0.18));
    haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, holeR * 3.1, 0, Math.PI * 2);
    ctx.fill();

    // Tilted Accretion Disk Rings
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.26 + Math.sin(timeSec * 0.35) * 0.08);
    for (let ring = 0; ring < 5; ring++) {
      const rx = holeR * (1.45 + ring * 0.42);
      const ry = rx * 0.26;
      ctx.strokeStyle = rgbToCss(palette[7 - (ring & 3)], 0.72 - ring * 0.1);
      ctx.lineWidth = 2.6 - ring * 0.3;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx + sb[ring * 2] * 14, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Pure #000000 Singularity Event Horizon Core
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = rgbToCss(palette[7], 0.9);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, holeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // 4. Campy 1950s Plan-9 Metallic Flying Saucer Dangling on a Visible Pendulum String
  const anchorX = cx + Math.sin(timeSec * 0.28) * 95;
  const anchorY = -8;
  const stringLen = 104 + Math.sin(timeSec * 0.9) * 14 - beat * 8;
  const swingAngle =
    Math.sin(timeSec * 1.65) * (0.22 + subBass * 0.14) +
    Math.cos(timeSec * 3.1) * 0.06;
  const ufoX = anchorX + Math.sin(swingAngle) * stringLen;
  const ufoY = anchorY + Math.cos(swingAngle) * stringLen;
  const ufoTilt =
    -swingAngle * 0.75 + Math.sin(timeSec * 5.2) * (0.06 + highEnergy * 0.08);

  const cleanLyric = (activeLyric || '').trim();
  const hasComment = Boolean(activeComment && activeComment.username && activeComment.body);
  const beamActive = cleanLyric.length > 0 || hasComment || beat > 0.38;

  // 5. Volumetric Tractor-Beam Cone & Diegetic Hologram Projection (`lighter`)
  if (beamActive) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beamBottomY = CANVAS_H - 18;
    const beamSpread = 135 + subBass * 35;
    const beamGrad = ctx.createLinearGradient(ufoX, ufoY + 10, cx, beamBottomY);
    const beamColor = palette[6] || [56, 189, 248];
    beamGrad.addColorStop(0, rgbToCss(beamColor, 0.52 + beat * 0.25));
    beamGrad.addColorStop(0.55, rgbToCss(palette[4], 0.22 + subBass * 0.14));
    beamGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(ufoX - 16, ufoY + 10);
    ctx.lineTo(ufoX + 16, ufoY + 10);
    ctx.lineTo(cx + beamSpread, beamBottomY);
    ctx.lineTo(cx - beamSpread, beamBottomY);
    ctx.closePath();
    ctx.fill();

    // Horizontal tractor-beam scan rings descending down the cone
    for (let r = 0; r < 5; r++) {
      const ringProg = ((timeSec * 0.85 + r * 0.2) % 1);
      const ry = ufoY + 18 + ringProg * (beamBottomY - ufoY - 36);
      const rx = 18 + ringProg * (beamSpread * 0.82);
      const ringCenter = ufoX + (cx - ufoX) * ringProg;
      ctx.strokeStyle = rgbToCss(palette[7], (1 - ringProg) * 0.45);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(ringCenter, ry, rx, rx * 0.18, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Draw Visible Pendulum String Holding the 1950s Tin Saucer
  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.72)';
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY);
  ctx.lineTo(ufoX, ufoY - 18);
  ctx.stroke();

  // Draw Raytraced 1950s Plan-9 Flying Saucer
  ctx.translate(ufoX, ufoY);
  ctx.rotate(ufoTilt);

  // Little tin-toy suspension eyelet ring at top of dome
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, -21, 3.2, 0, Math.PI * 2);
  ctx.stroke();

  // Glass Cockpit Dome (with subtle album-art reflection inside)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, -6, 26, 15, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  const domeGrad = ctx.createRadialGradient(-8, -14, 2, 0, -6, 26);
  domeGrad.addColorStop(0, '#f8fafc');
  domeGrad.addColorStop(0.45, rgbToCss(palette[6], 0.85));
  domeGrad.addColorStop(1, rgbToCss(palette[2], 0.92));
  ctx.fillStyle = domeGrad;
  ctx.fillRect(-28, -24, 56, 22);

  if (artReady && artCanvas) {
    ctx.globalAlpha = 0.38;
    ctx.drawImage(artCanvas, -22, -22, 44, 22);
    ctx.globalAlpha = 1.0;
  }
  ctx.restore();

  // Metallic Brushed-Chrome Saucer Hull Disc
  const hullGrad = ctx.createLinearGradient(-56, -6, 56, 10);
  hullGrad.addColorStop(0, '#475569');
  hullGrad.addColorStop(0.28, '#f1f5f9');
  hullGrad.addColorStop(0.52, '#64748b');
  hullGrad.addColorStop(0.78, '#e2e8f0');
  hullGrad.addColorStop(1, '#1e293b');

  ctx.fillStyle = hullGrad;
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, 2, 54, 11.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Undercarriage Tractor Emitter Ring
  ctx.fillStyle = rgbToCss(palette[7], 0.9 + beat * 0.1);
  ctx.beginPath();
  ctx.ellipse(0, 9.5, 18, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Spinning Rim Lights around the Saucer Equator
  const numLights = 7;
  for (let l = 0; l < numLights; l++) {
    const lPhase = (l / numLights) * Math.PI + ((timeSec * 3.2) % Math.PI);
    const lx = Math.cos(lPhase) * 44;
    const ly = 2 + Math.sin(lPhase) * 4.5;
    const isBright = ((l + Math.floor(timeSec * 8)) % 3) === 0;
    ctx.fillStyle = isBright ? '#fef08a' : rgbToCss(palette[5], 0.85);
    ctx.beginPath();
    ctx.arc(lx, ly, isBright ? 3.0 : 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 6A. Suspended Holographic Lyrics Inside the Tractor Beam
  if (cleanLyric.length > 0) {
    const lines = splitIntoBalancedLines(cleanLyric, 38);
    const hoverY = ufoY + 116 + Math.sin(timeSec * 1.8) * 4;
    const hoverX = ufoX * 0.35 + cx * 0.65;

    ctx.save();
    ctx.translate(hoverX, hoverY);

    const boxW = Math.min(CANVAS_W - 64, Math.max(210, lines[0].length * 8.4 + 32));
    const boxH = lines.length * 18 + 12;
    ctx.fillStyle = 'rgba(4, 9, 20, 0.82)';
    ctx.strokeStyle = rgbToCss(palette[6], 0.88);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.roundRect(-boxW * 0.5, -boxH * 0.5, boxW, boxH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = '800 12.5px "JetBrains Mono", "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fef9c3';
    for (let li = 0; li < lines.length; li++) {
      const ly = (li - (lines.length - 1) * 0.5) * 17;
      ctx.fillText(`♪ ${lines[li]} ♪`, 0, ly);
    }
    ctx.restore();
  }

  // 6B. Separate Diegetic UFO Orbital Scanner Transmission Pod for `@username` Comments
  if (hasComment && activeComment) {
    const podW = 248;
    const podH = 38;
    const podX = CANVAS_W - podW - 26;
    const podY = 38 + Math.sin(timeSec * 1.2) * 3;

    ctx.save();
    ctx.fillStyle = 'rgba(5, 10, 24, 0.88)';
    ctx.strokeStyle = rgbToCss(palette[7], 0.9);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(podX, podY, podW, podH, 8);
    ctx.fill();
    ctx.stroke();

    let textX = podX + 12;
    if (commentAvatarImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(podX + 20, podY + podH * 0.5, 11, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(commentAvatarImg, podX + 9, podY + podH * 0.5 - 11, 22, 22);
      ctx.restore();
      textX = podX + 37;
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = rgbToCss(palette[6], 0.98);
    ctx.fillText(`UFO SCAN // @${activeComment.username}`, textX, podY + 12);

    ctx.font = '700 10.5px sans-serif';
    ctx.fillStyle = '#f8fafc';
    const maxBody = activeComment.body.trim().slice(0, 32);
    ctx.fillText(
      `“${maxBody}${activeComment.body.length > 32 ? '…' : ''}”`,
      textX,
      podY + 26,
    );
    ctx.restore();
  }
}
