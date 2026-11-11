import {
  CANVAS_H,
  CANVAS_W,
  rgbToCss,
  splitIntoBalancedLines,
  type RgbTuple,
  type SceneRenderContext,
} from './types';

/**
 * Draws an anatomically sculpted Bottlenose Dolphin silhouette facing right (+X):
 * - Distinct Bottlenose rostrum/beak & rounded melon forehead
 * - Swept falcate dorsal fin at mid-back
 * - Ventral pectoral flipper
 * - Arched peduncle tail stock & notched tail flukes + specular highlight line
 */
function drawBottlenoseDolphin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  pitchRad: number,
  topRgb: RgbTuple,
  bellyRgb: RgbTuple,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(pitchRad);
  ctx.scale(scale, scale);

  const bodyGrad = ctx.createLinearGradient(0, -14, 0, 12);
  bodyGrad.addColorStop(0, rgbToCss(topRgb, 0.96));
  bodyGrad.addColorStop(0.65, 'rgba(56, 189, 248, 0.92)');
  bodyGrad.addColorStop(1, rgbToCss(bellyRgb, 0.95));

  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 1.05;
  ctx.lineJoin = 'round';

  ctx.beginPath();
  // 1. Tip of Bottlenose beak (rostrum)
  ctx.moveTo(24, 2.5);
  // Upper beak shelf into rounded melon forehead
  ctx.quadraticCurveTo(20, 0.5, 17.5, -1.5);
  ctx.bezierCurveTo(13, -6.5, 5, -9.5, -1.5, -9.0);
  // 2. Swept falcate dorsal fin rising from mid-back
  ctx.quadraticCurveTo(-3.5, -15.5, -9.5, -17.0);
  ctx.quadraticCurveTo(-7.0, -11.5, -7.8, -8.2);
  // 3. Tapered dorsal tail stock (peduncle) down to tail flukes
  ctx.bezierCurveTo(-14, -6.5, -20, -2.5, -25, 0.5);
  // 4. Split tail flukes (upper & lower lobes)
  ctx.lineTo(-31.5, -4.8);
  ctx.quadraticCurveTo(-28.5, 0.8, -27.2, 1.8);
  ctx.quadraticCurveTo(-29.0, 4.2, -31.0, 7.5);
  ctx.lineTo(-24.2, 3.2);
  // 5. Ventral arch & belly
  ctx.bezierCurveTo(-18, 2.0, -10, 4.8, -2, 5.2);
  // 6. Swept pectoral flipper beneath chest
  ctx.lineTo(1.5, 12.2);
  ctx.quadraticCurveTo(5.8, 10.2, 6.2, 5.0);
  // 7. Throat & lower jaw back to beak tip
  ctx.quadraticCurveTo(14, 4.8, 19.5, 3.8);
  ctx.quadraticCurveTo(22.5, 3.6, 24, 2.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Airbrushed lateral specular highlight streak & eye
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.68)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(15, -1.2);
  ctx.quadraticCurveTo(2, -5.8, -14, -2.2);
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(14.5, 0.8, 1.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Scene `g` — Y2K / Vaporwave Odyssey (High-DPI Canvas2D)
 * - Receding 3D perspective neon outrun grid (#000000 tiles + magenta/cyan rails)
 * - Sliced Outrun Sunset Sphere on the horizon + 2 speeding Tron Lightcycles with additive trails
 * - 3D shaded/wireframe Marble Helios Bust (left) & Translucent Fiji Bottle framing `artCanvas` (right)
 * - Anatomically sculpted Bottlenose Dolphins leaping over the sunset & Win95 Solitaire card cascade
 * - Separate Win95 `IMP_LYRICS.EXE` dialog (top) and Y2K `AIM_95.EXE - @username` buddy window (bottom-right)
 */
export function renderVaporwaveScene(s: SceneRenderContext): void {
  const {
    ctx,
    timeSec,
    beat,
    subBass,
    drop,
    palette,
    artCanvas,
    artReady,
    activeLyric,
    activeComment,
    commentAvatarImg,
  } = s;

  const cx = CANVAS_W * 0.5;
  const horizonY = 186;

  // 1. Deep #000000 Sky + Outrun Horizon Glow
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0, '#000000');
  skyGrad.addColorStop(0.55, 'rgba(46, 16, 101, 0.48)');
  skyGrad.addColorStop(1, rgbToCss(palette[5], 0.55 + subBass * 0.2));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, horizonY);

  // 2. Sliced Outrun Sunset Sphere on the Horizon
  const sunR = 66 + subBass * 6 + beat * 3;
  const sunY = horizonY - 12;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, sunY, sunR, Math.PI, Math.PI * 2.15);
  ctx.clip();

  const sunGrad = ctx.createLinearGradient(cx, sunY - sunR, cx, sunY + 14);
  sunGrad.addColorStop(0, '#fef08a');
  sunGrad.addColorStop(0.48, '#fb7185');
  sunGrad.addColorStop(1, '#c026d3');
  ctx.fillStyle = sunGrad;
  ctx.fillRect(cx - sunR, sunY - sunR, sunR * 2, sunR + 18);

  // Horizontal scanline cutouts slicing the lower half of the sunset
  ctx.fillStyle = '#000000';
  for (let slice = 0; slice < 7; slice++) {
    const sy = sunY - 28 + slice * 6.5 + ((timeSec * 3.5) % 6.5);
    const sh = 1.2 + slice * 0.55;
    ctx.fillRect(cx - sunR, sy, sunR * 2, sh);
  }
  ctx.restore();

  // 3. Receding 3D Perspective Neon Outrun Grid Floor (Steady scroll without bass-jump!)
  const floorScroll = (timeSec * 0.68) % 1;
  const numRows = 11;
  const numCols = 14;

  for (let r = 0; r < numRows; r++) {
    const d0 = (r + floorScroll) / numRows;
    const d1 = (r + 1 + floorScroll) / numRows;
    const y0 = horizonY + Math.pow(d0, 1.8) * (CANVAS_H - horizonY);
    const y1 = horizonY + Math.pow(d1, 1.8) * (CANVAS_H - horizonY);
    const span0 = 110 + Math.pow(d0, 1.45) * 660;
    const span1 = 110 + Math.pow(d1, 1.45) * 660;
    const rowParity = (r + Math.floor(timeSec * 0.68)) & 1;

    for (let c = -numCols / 2; c < numCols / 2; c++) {
      const isCheck = ((c + rowParity) & 1) === 0;
      if (!isCheck) continue;
      const u0 = c / (numCols * 0.5);
      const u1 = (c + 1) / (numCols * 0.5);
      const x0a = cx + u0 * span0;
      const x0b = cx + u1 * span0;
      const x1b = cx + u1 * span1;
      const x1a = cx + u0 * span1;

      const tilePal = (c & 1) === 0 ? palette[4] : palette[6];
      ctx.fillStyle = rgbToCss(tilePal, (0.12 + d0 * 0.34) * (0.75 + subBass * 0.25));
      ctx.beginPath();
      ctx.moveTo(x0a, y0);
      ctx.lineTo(x0b, y0);
      ctx.lineTo(x1b, y1);
      ctx.lineTo(x1a, y1);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Glowing Magenta/Cyan Perspective Grid Rails (`lighter`)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgbToCss(palette[6], 0.55 + beat * 0.25);
  ctx.lineWidth = 1.2;
  for (let v = -7; v <= 7; v++) {
    ctx.beginPath();
    ctx.moveTo(cx + v * 15, horizonY);
    ctx.lineTo(cx + v * 92, CANVAS_H);
    ctx.stroke();
  }
  ctx.restore();

  // 4. Speeding Tron Lightcycles with Additive Neon Ribbon Trails (`lighter`)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let lc = 0; lc < 2; lc++) {
    const sign = lc === 0 ? -1 : 1;
    const laneU = sign * (0.24 + Math.sin(timeSec * 0.85 + lc * 2.1) * 0.14);
    const bikeY = horizonY + 88 + lc * 28;
    const bikeX = cx + laneU * 380;
    const bikeColor: [number, number, number] =
      lc === 0 ? [56, 189, 248] : [244, 114, 182];

    const trailGrad = ctx.createLinearGradient(cx + laneU * 95, horizonY, bikeX, bikeY);
    trailGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    trailGrad.addColorStop(1, rgbToCss(bikeColor, 0.85));
    ctx.strokeStyle = trailGrad;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(cx + laneU * 95, horizonY + 4);
    ctx.lineTo(bikeX, bikeY);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = rgbToCss(bikeColor, 0.98);
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.roundRect(bikeX - 10, bikeY - 5, 20, 9, 4);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // 5. Left Arena: 3D Shaded Marble & Wireframe Classical Helios Bust on Pedestal
  const bustX = 112 + Math.sin(timeSec * 0.55) * 6;
  const bustY = 148 + Math.cos(timeSec * 0.75) * 5;

  ctx.save();
  ctx.translate(bustX, bustY);

  const pedGrad = ctx.createLinearGradient(-22, 24, 22, 24);
  pedGrad.addColorStop(0, '#334155');
  pedGrad.addColorStop(0.45, '#f8fafc');
  pedGrad.addColorStop(1, '#1e293b');
  ctx.fillStyle = pedGrad;
  ctx.fillRect(-20, 26, 40, 6);
  ctx.fillRect(-15, 32, 30, 42);
  ctx.fillRect(-22, 74, 44, 6);

  const marbleGrad = ctx.createRadialGradient(-10, -14, 4, 0, 0, 38);
  marbleGrad.addColorStop(0, '#ffffff');
  marbleGrad.addColorStop(0.55, '#e2e8f0');
  marbleGrad.addColorStop(0.85, rgbToCss(palette[5], 0.88));
  marbleGrad.addColorStop(1, '#334155');

  ctx.fillStyle = marbleGrad;
  ctx.strokeStyle = rgbToCss(palette[7], 0.78);
  ctx.lineWidth = 1.2;

  ctx.beginPath();
  ctx.moveTo(-26, 26);
  ctx.quadraticCurveTo(-24, 8, -9, 6);
  ctx.lineTo(-8, -4);
  ctx.lineTo(8, -4);
  ctx.lineTo(9, 6);
  ctx.quadraticCurveTo(24, 8, 26, 26);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(0, -16, 15, 19, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = rgbToCss(palette[6], 0.55);
  ctx.lineWidth = 0.9;
  for (let lat = -1; lat <= 1; lat++) {
    ctx.beginPath();
    ctx.ellipse(0, -16 + lat * 6, 14 - Math.abs(lat) * 2, 3.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // 6. Right Arena: Translucent Fiji / Y2K Aqua Bottle Framing Live Album Art (`artCanvas`)
  const botX = CANVAS_W - 112 + Math.cos(timeSec * 0.58) * 6;
  const botY = 148 + Math.sin(timeSec * 0.82) * 5;

  ctx.save();
  ctx.translate(botX, botY);
  ctx.rotate(Math.sin(timeSec * 0.65) * 0.06);

  ctx.fillStyle = '#ec4899';
  ctx.strokeStyle = '#fbcfe8';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(-10, -44, 20, 9, 2);
  ctx.fill();
  ctx.stroke();

  const aquaGrad = ctx.createLinearGradient(-24, -30, 24, 36);
  aquaGrad.addColorStop(0, 'rgba(186, 230, 253, 0.78)');
  aquaGrad.addColorStop(0.5, 'rgba(14, 165, 233, 0.55)');
  aquaGrad.addColorStop(1, 'rgba(30, 58, 138, 0.82)');
  ctx.fillStyle = aquaGrad;
  ctx.strokeStyle = '#e0f2fe';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-9, -35);
  ctx.lineTo(9, -35);
  ctx.lineTo(22, -22);
  ctx.lineTo(22, 36);
  ctx.lineTo(-22, 36);
  ctx.lineTo(-22, -22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-17, -14, 34, 36, 4);
  ctx.clip();
  if (artReady && artCanvas) {
    ctx.drawImage(artCanvas, -17, -14, 34, 36);
  } else {
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(-17, -14, 34, 36);
  }
  ctx.restore();

  ctx.strokeStyle = '#f472b6';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(-17, -14, 34, 36);
  ctx.restore();

  // 7. Anatomically Sculpted Bottlenose Dolphins Leaping Over the Sunset Horizon
  for (let d = 0; d < 2; d++) {
    const leapProg = ((timeSec * 0.28 + d * 0.5) % 1);
    const dx = cx - 92 + d * 78 + (leapProg - 0.5) * 145;
    const arcY = Math.sin(leapProg * Math.PI) * 64;
    const dy = horizonY - 4 - arcY;
    // Tangent angle of the parabolic arc so the dolphin dives nose-first along its trajectory
    const pitch = Math.atan2(-Math.cos(leapProg * Math.PI) * 64 * Math.PI, 145);

    if (arcY > 3) {
      drawBottlenoseDolphin(
        ctx,
        dx,
        dy,
        1.12,
        pitch,
        palette[6] || [56, 189, 248],
        palette[7] || [244, 114, 182],
      );

      // Splash droplets at entry/exit near the horizon
      if (leapProg < 0.16 || leapProg > 0.84) {
        ctx.fillStyle = 'rgba(224, 242, 254, 0.78)';
        for (let sp = -2; sp <= 2; sp++) {
          ctx.beginPath();
          ctx.arc(dx + sp * 6, horizonY - 4 - Math.abs(sp) * 2, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // 8. Win95 Solitaire Bouncing Card Cascade on Beat Drops (`drop > 0.12` or periodic cascade)
  const cascadeActive = drop > 0.12 || ((timeSec % 24) > 19.5);
  if (cascadeActive) {
    const numCards = 9;
    for (let c = 0; c < numCards; c++) {
      const tCard = timeSec * 2.2 - c * 0.14;
      const cardX = 80 + ((tCard * 62) % (CANVAS_W - 160));
      const bounceY = Math.abs(Math.sin(tCard * 2.1)) * 88;
      const cardY = CANVAS_H - 42 - bounceY;

      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, 28, 38, 3);
      ctx.fill();
      ctx.stroke();

      const isRed = (c & 1) === 0;
      ctx.fillStyle = isRed ? '#e11d48' : '#0f172a';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(isRed ? 'A♥' : 'K♠', cardX + 4, cardY + 11);
      ctx.restore();
    }
  }

  // 9A. Diegetic Bevelled Win95 `IMP_LYRICS.EXE` Dialog for `activeLyric` (Upper Center)
  const cleanLyric = (activeLyric || '').trim();
  if (cleanLyric.length > 0) {
    const lines = splitIntoBalancedLines(`♪ ${cleanLyric} ♪`, 38);
    const winW = Math.min(CANVAS_W - 80, Math.max(248, lines[0].length * 8.2 + 44));
    const winH = 26 + lines.length * 18 + 16;
    const winX = cx - winW * 0.5;
    const winY = 24 + Math.sin(timeSec * 0.95) * 2.5;

    ctx.save();
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(winX, winY, winW, winH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(winX + 1, winY + 1, winW - 2, winH - 2);
    ctx.strokeStyle = '#1e293b';
    ctx.strokeRect(winX, winY, winW, winH);

    const titleGrad = ctx.createLinearGradient(winX + 3, winY + 3, winX + winW - 3, winY + 3);
    titleGrad.addColorStop(0, '#000080');
    titleGrad.addColorStop(1, '#1084d0');
    ctx.fillStyle = titleGrad;
    ctx.fillRect(winX + 3, winY + 3, winW - 6, 16);

    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('IMP_LYRICS.EXE', winX + 8, winY + 11);

    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(winX + winW - 17, winY + 5, 12, 12);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('×', winX + winW - 14, winY + 11);

    ctx.fillStyle = '#090d16';
    ctx.fillRect(winX + 5, winY + 22, winW - 10, winH - 27);

    ctx.font = '800 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#67e8f9';
    for (let li = 0; li < lines.length; li++) {
      const ly = winY + 22 + (winH - 27) * 0.5 + (li - (lines.length - 1) * 0.5) * 16;
      ctx.fillText(lines[li], cx, ly);
    }
    ctx.restore();
  }

  // 9B. Separate Diegetic Y2K `AIM_CHAT95.EXE - @username` Buddy Window for SC Comments (Bottom Right)
  if (activeComment && activeComment.username && activeComment.body) {
    const msgW = 256;
    const msgH = 54;
    const msgX = CANVAS_W - msgW - 22;
    const msgY = CANVAS_H - msgH - 20;

    ctx.save();
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(msgX, msgY, msgW, msgH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(msgX + 1, msgY + 1, msgW - 2, msgH - 2);

    const chatTitleGrad = ctx.createLinearGradient(msgX + 3, msgY + 3, msgX + msgW - 3, msgY + 3);
    chatTitleGrad.addColorStop(0, '#701a75');
    chatTitleGrad.addColorStop(1, '#db2777');
    ctx.fillStyle = chatTitleGrad;
    ctx.fillRect(msgX + 3, msgY + 3, msgW - 6, 15);

    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`CHAT_95.EXE - @${activeComment.username}`, msgX + 7, msgY + 10.5);

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(msgX + 4, msgY + 20, msgW - 8, msgH - 24);

    let textLeft = msgX + 10;
    if (commentAvatarImg) {
      ctx.drawImage(commentAvatarImg, msgX + 8, msgY + 24, 22, 22);
      textLeft = msgX + 35;
    }

    ctx.font = '700 10.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#f472b6';
    const maxBody = activeComment.body.trim().slice(0, 31);
    ctx.fillText(
      `“${maxBody}${activeComment.body.length > 31 ? '…' : ''}”`,
      textLeft,
      msgY + 35,
    );
    ctx.restore();
  }
}
