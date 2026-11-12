import {
  CANVAS_H,
  CANVAS_W,
  rgbToCss,
  splitIntoBalancedLines,
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

/**
 * Scene `e` — Retro Arcade Remix (High-DPI Canvas2D)
 * - Deep-OLED CRT arcade playfield combining Pac-Man neon maze, Space Invaders formations,
 *   Oscilloscope Pong rally, and Missile Command counter-battery bursts at classic coin-op speed
 * - Center Boss Core / Ghost House frames live album art (`artCanvas`)
 * - Separate diegetic slots for `activeLyric` (Bottom Stage Briefing) and `@username` comments (Top 1UP Challenger Marquee)
 */
export function renderArcadeScene(s: SceneRenderContext): void {
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

  // 1. Pure #000000 OLED CRT Playfield + Subtle Phosphor Grid
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.strokeStyle = rgbToCss(palette[2], 0.12);
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

  // 2. Pac-Man Double-Wall Neon Maze Corridors & Ghost House Album-Art Core
  const mazeWallColor = drop > 0.25 ? palette[7] : palette[4];
  ctx.save();
  ctx.strokeStyle = rgbToCss(mazeWallColor, 0.78 + beat * 0.2);
  ctx.lineWidth = 2.2;

  ctx.strokeRect(26, 26, CANVAS_W - 52, CANVAS_H - 52);
  ctx.strokeRect(30, 30, CANVAS_W - 60, CANVAS_H - 60);

  const cornerBoxes = [
    [54, 52, 86, 34],
    [CANVAS_W - 140, 52, 86, 34],
    [54, CANVAS_H - 86, 86, 34],
    [CANVAS_W - 140, CANVAS_H - 86, 86, 34],
  ];
  for (const [bx, by, bw, bh] of cornerBoxes) {
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.stroke();
  }
  ctx.restore();

  // Center Ghost House / Boss Core Framing Album Art (`artCanvas`)
  const coreW = 88 + subBass * 6;
  const coreH = 68 + subBass * 5;
  const coreX = cx - coreW * 0.5;
  const coreY = cy - coreH * 0.5;

  ctx.save();
  ctx.fillStyle = '#050814';
  ctx.strokeStyle = rgbToCss(palette[6], 0.92);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.roundRect(coreX, coreY, coreW, coreH, 8);
  ctx.fill();
  ctx.stroke();

  if (artReady && artCanvas) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(coreX + 4, coreY + 4, coreW - 8, coreH - 8, 5);
    ctx.clip();
    ctx.drawImage(artCanvas, coreX + 4, coreY + 4, coreW - 8, coreH - 8);
    ctx.restore();
  }

  ctx.strokeStyle = '#fda4af';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(cx - 16, coreY);
  ctx.lineTo(cx + 16, coreY);
  ctx.stroke();
  ctx.restore();

  // 3. Space Invaders Upper Formation Marching at a Classic Coin-Op Cadence
  const invCols = 8;
  const invStepX = Math.sin(timeSec * 0.65) * 26;
  const invFrame = Math.floor(timeSec * 1.8) & 1;

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < invCols; col++) {
      const ix = 162 + col * 42 + invStepX;
      const iy = 44 + row * 22 + Math.sin(timeSec * 1.4 + col) * 1.8;
      const bandAmp = sb[(col + row * 4) & 15];
      const invColor = palette[4 + ((row + col) & 3)];
      ctx.fillStyle = rgbToCss(invColor, 0.78 + bandAmp * 0.22);

      const pSize = 2.1;
      for (let r = 0; r < INVADER_ROWS.length; r++) {
        const mask = INVADER_ROWS[r];
        for (let b = 0; b < 8; b++) {
          if ((mask >> (7 - b)) & 1) {
            const legShift = r === 5 ? (invFrame ? 1.1 : -1.1) : 0;
            ctx.fillRect(
              ix + (b - 4) * pSize + legShift,
              iy + (r - 3) * pSize,
              pSize - 0.2,
              pSize - 0.2,
            );
          }
        }
      }
    }
  }

  // 4. Pac-Man & Chasing Ghosts Orbiting the Outer Perimeter at Smooth, Readable Speed (`36px/s`)
  const trackW = CANVAS_W - 88;
  const trackH = CANVAS_H - 88;
  const perim = (trackW + trackH) * 2;
  const posOnPerim = (dist: number): [number, number, number] => {
    const d = ((dist % perim) + perim) % perim;
    if (d < trackW) return [44 + d, 40, 0];
    if (d < trackW + trackH) return [44 + trackW, 40 + (d - trackW), Math.PI * 0.5];
    if (d < trackW * 2 + trackH) {
      return [44 + trackW - (d - (trackW + trackH)), 40 + trackH, Math.PI];
    }
    return [44, 40 + trackH - (d - (trackW * 2 + trackH)), -Math.PI * 0.5];
  };

  // Power Pellets along the perimeter
  ctx.fillStyle = '#fef08a';
  for (let p = 0; p < 28; p++) {
    const [dotX, dotY] = posOnPerim((p / 28) * perim);
    const isPower = p % 7 === 0;
    const r = isPower ? 3.2 + Math.sin(timeSec * 3.5) * 0.9 : 1.6;
    ctx.beginPath();
    ctx.arc(dotX, dotY, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Smooth, steady 36px/sec Pac-Man (zero `subBass * timeSec` jumping!)
  const pacDist = timeSec * 36;
  const [pacX, pacY, pacRot] = posOnPerim(pacDist);
  const mouthAngle = 0.08 + Math.abs(Math.sin(timeSec * 6.2)) * 0.55;

  ctx.save();
  ctx.translate(pacX, pacY);
  ctx.rotate(pacRot);
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.arc(0, 0, 9.5, mouthAngle, Math.PI * 2 - mouthAngle);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 3 Chasing Arcade Ghosts
  const ghostColors: [number, number, number][] = [
    [244, 63, 94],
    [56, 189, 248],
    [251, 146, 60],
  ];
  for (let g = 0; g < 3; g++) {
    const [gx, gy] = posOnPerim(pacDist - 34 - g * 28);
    const isScared = drop > 0.2;
    const gCol = isScared ? ([59, 130, 246] as [number, number, number]) : ghostColors[g];

    ctx.save();
    ctx.translate(gx, gy);
    ctx.fillStyle = rgbToCss(gCol, 0.95);
    ctx.beginPath();
    ctx.arc(0, -2, 8.5, Math.PI, Math.PI * 2);
    ctx.lineTo(8.5, 8);
    ctx.lineTo(4.2, 5.5);
    ctx.lineTo(0, 8);
    ctx.lineTo(-4.2, 5.5);
    ctx.lineTo(-8.5, 8);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-3, -2.5, 2.4, 0, Math.PI * 2);
    ctx.arc(3, -2.5, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(-2.5, -2.5, 1.2, 0, Math.PI * 2);
    ctx.arc(3.5, -2.5, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 5. Mid-Field Oscilloscope Pong Rally (Smooth, Unhurried Rally)
  const pongProgress = (Math.sin(timeSec * 0.72) + 1) * 0.5;
  const ballX = 72 + pongProgress * (CANVAS_W - 144);
  const ballY = cy + Math.sin(timeSec * 1.25) * 52;
  const leftPadY = cy + Math.sin(timeSec * 1.25 - 0.3) * 48;
  const rightPadY = cy + Math.sin(timeSec * 1.25 + 0.3) * 48;

  ctx.fillStyle = rgbToCss(palette[7], 0.92);
  ctx.fillRect(62, leftPadY - 18, 5, 36);
  ctx.fillRect(CANVAS_W - 67, rightPadY - 18, 5, 36);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgbToCss(palette[5], 0.55 + midEnergy * 0.25);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let px = 68; px <= CANVAS_W - 68; px += 8) {
    const bandVal = sb[Math.floor(px / 36) & 15];
    const py =
      cy +
      Math.sin(px * 0.04 + timeSec * 3.5) * (8 + bandVal * 20) *
        (1 - Math.min(1, Math.abs(px - ballX) / 220));
    if (px === 68) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ballX, ballY, 4.5 + beat * 2.0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 6. Missile Command Counter-Battery Firework Bursts on Lower Horizon
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const batteries = [148, cx, CANVAS_W - 148];
  for (let b = 0; b < 3; b++) {
    const bx = batteries[b];
    const by = CANVAS_H - 34;
    const targetX = 110 + ((b * 185 + Math.floor(timeSec * 0.45) * 73) % (CANVAS_W - 220));
    const targetY = 96 + ((b * 47) % 120);
    const flight = ((timeSec * (0.38 + b * 0.08) + b * 0.33) % 1);
    const curX = bx + (targetX - bx) * flight;
    const curY = by + (targetY - by) * flight;

    ctx.strokeStyle = rgbToCss(palette[4 + b], 0.68);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(curX, curY);
    ctx.stroke();

    if (flight > 0.74 || beat > 0.46) {
      const blastR = (flight > 0.74 ? (flight - 0.74) / 0.26 : beat) * (20 + highEnergy * 15);
      const blastGrad = ctx.createRadialGradient(
        curX,
        curY,
        1,
        curX,
        curY,
        Math.max(4, blastR),
      );
      blastGrad.addColorStop(0, '#ffffff');
      blastGrad.addColorStop(0.45, rgbToCss(palette[7], 0.85));
      blastGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = blastGrad;
      ctx.beginPath();
      ctx.arc(curX, curY, Math.max(4, blastR), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // 7A. Diegetic Arcade Stage Briefing Banner for `activeLyric` (Lower Center)
  const cleanLyric = (activeLyric || '').trim();
  if (cleanLyric.length > 0) {
    const lines = splitIntoBalancedLines(`♪ ${cleanLyric.toUpperCase()} ♪`, 38);
    const bannerY = CANVAS_H - 68;
    const boxW = Math.min(CANVAS_W - 72, Math.max(220, lines[0].length * 8.4 + 36));
    const boxH = lines.length * 18 + 14;

    ctx.save();
    ctx.translate(cx, bannerY);
    ctx.fillStyle = 'rgba(4, 7, 16, 0.90)';
    ctx.strokeStyle = rgbToCss(palette[7], 0.95);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(-boxW * 0.5, -boxH * 0.5, boxW, boxH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = '900 12px "JetBrains Mono", "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fef08a';
    for (let li = 0; li < lines.length; li++) {
      const ly = (li - (lines.length - 1) * 0.5) * 16;
      ctx.fillText(lines[li], 0, ly);
    }
    ctx.restore();
  }

  // 7B. Separate Diegetic Top Arcade `1UP CHALLENGER @USERNAME` Marquee for SC Comments
  if (activeComment && activeComment.username && activeComment.body) {
    const chalW = 264;
    const chalH = 36;
    const chalX = cx - chalW * 0.5;
    const chalY = 82;

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
      chalY + 25,
    );
    ctx.restore();
  }

  // 8. CRT Degauss Collapse Transition (`trans > 0.01`)
  if (trans > 0.01) {
    const beamH = Math.max(2, (1 - Math.sin(trans * Math.PI)) * CANVAS_H);
    ctx.fillStyle = `rgba(255, 255, 255, ${(Math.sin(trans * Math.PI) * 0.45).toFixed(2)})`;
    ctx.fillRect(0, cy - beamH * 0.5, CANVAS_W, beamH);
  }
}
