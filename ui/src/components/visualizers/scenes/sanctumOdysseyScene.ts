import {
  beginLowPolyRasterPass,
  COFFIN_MESH_3D,
  commitLowPolyRasterPass,
  projectAndDrawMesh3D,
  snapPs1,
} from './lowPoly3d';
import {
  CANVAS_H,
  CANVAS_W,
  drawMicroPartyCommentPill,
  rgbToCss,
  splitIntoBalancedLines,
  type SceneRenderContext,
} from './types';

/**
 * Mode 14 & 15: Dark Fantasy Sanctum & Crypt Coffin (Revamped Unified Scene)
 * Combines the best elements of:
 * 1. Original `sanctumScene`: Vaulted gothic cathedral stone pillars & pointed arches,
 *    stained-glass rose window high in the nave, flickering wall-sconce torches,
 *    rising embers, armored halberdier guardians, and 16-bit JRPG gold-filigree lyric scroll
 * 2. `16-Bit Dark Fantasy` Boat Scene: Starry night sky, low-poly moon, distant jagged castle
 *    silhouette, subterranean scanline river with rolling mist, flapping 16-bit bats, and the
 *    wooden skiff carrying 2 hooded dark-cloaked travelers with a flickering prow torch aura
 * 3. `King's Field` Low-Poly 3D Coffin (`COFFIN_MESH_3D`): Levitates and rotates slowly and
 *    majestically above the central altar, periodically dropping the track's album artwork
 *    out from beneath the coffin on glowing arcane chains!
 */
export function renderSanctumOdysseyScene(s: SceneRenderContext): void {
  const {
    ctx: mainCtx,
    timeSec,
    beat,
    subBass,
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

  const ctx = beginLowPolyRasterPass(mainCtx, '#000000');
  const cx = CANVAS_W * 0.5;
  const riverY = 248;

  // 1. Subterranean Gothic Abyss + Deep Nave Radial Glow (from `sanctumScene`)
  const naveGlow = ctx.createRadialGradient(cx, 138, 12, cx, 148, 290);
  naveGlow.addColorStop(0, rgbToCss(palette[4], 0.3 + subBass * 0.12));
  naveGlow.addColorStop(0.55, rgbToCss(palette[1], 0.22));
  naveGlow.addColorStop(1, '#000000');
  ctx.fillStyle = naveGlow;
  ctx.fillRect(0, 0, CANVAS_W, riverY);

  // 2. Starry Night Sky, Low-Poly Moon & Distant Jagged Castle Ridge (visible through the arches)
  for (let st = 0; st < 24; st++) {
    const sx = ((st * 173 + 19) % (CANVAS_W - 20)) + 10;
    const sy = ((st * 79 + 14) % (riverY - 70)) + 12;
    const twinkle = ((Math.floor(timeSec * 3) + st) & 3) === 0 ? 3 : 2;
    ctx.fillStyle = rgbToCss(palette[3 + (st & 3)], 0.65);
    ctx.fillRect(sx, sy, twinkle, 2);
  }

  // Faceted Low-Poly Moon visible in the upper-right arch bay
  const moonX = snapPs1(CANVAS_W * 0.74, 2);
  const moonY = snapPs1(Math.max(52, cropTopY + 28), 2);
  const moonR = 20;
  ctx.fillStyle = rgbToCss(palette[6], 0.82);
  ctx.strokeStyle = rgbToCss(palette[7], 0.9);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const px = moonX + Math.cos(a) * moonR;
    const py = moonY + Math.sin(a) * moonR;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Distant Craggy Castle Cliff Silhouette along the River Horizon (Stationary / Stable!)
  ctx.fillStyle = rgbToCss(palette[1], 0.92);
  ctx.strokeStyle = rgbToCss(palette[3], 0.62);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, riverY);
  const ridgePts: [number, number][] = [
    [0, riverY - 22],
    [82, riverY - 48],
    [132, riverY - 34],
    [176, riverY - 78],
    [194, riverY - 96], // Distant gothic keep spire
    [212, riverY - 74],
    [275, riverY - 30],
    [365, riverY - 30],
    [438, riverY - 62],
    [526, riverY - 38],
    [CANVAS_W, riverY - 24],
  ];
  for (const [rx, ry] of ridgePts) {
    ctx.lineTo(snapPs1(rx, 2), snapPs1(ry, 2));
  }
  ctx.lineTo(CANVAS_W, riverY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 3. Left-of-Center Gothic Clock-Tower Cog & Rotating Stained-Glass Rose Window Configuration
  const roseX = 204;
  const roseY = 76;
  const roseR = 38;
  const clockAng = timeSec * 0.15;

  const drawClockworkCog = (
    gx: number,
    gy: number,
    r: number,
    teeth: number,
    toothH: number,
    ang: number,
    fillSlot: number,
    strokeSlot: number,
  ) => {
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(ang);
    ctx.fillStyle = rgbToCss(palette[fillSlot], 0.88);
    ctx.strokeStyle = rgbToCss(palette[strokeSlot], 0.88);
    ctx.lineWidth = 1.3;

    // Gear teeth ring
    ctx.beginPath();
    const step = (Math.PI * 2) / teeth;
    for (let t = 0; t < teeth; t++) {
      const a0 = t * step;
      const a1 = a0 + step * 0.18;
      const a2 = a0 + step * 0.45;
      const a3 = a0 + step * 0.63;
      const rIn = r;
      const rOut = r + toothH;
      if (t === 0) ctx.moveTo(Math.cos(a0) * rIn, Math.sin(a0) * rIn);
      else ctx.lineTo(Math.cos(a0) * rIn, Math.sin(a0) * rIn);
      ctx.lineTo(Math.cos(a1) * rOut, Math.sin(a1) * rOut);
      ctx.lineTo(Math.cos(a2) * rOut, Math.sin(a2) * rOut);
      ctx.lineTo(Math.cos(a3) * rIn, Math.sin(a3) * rIn);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner cutout ring & spokes
    ctx.fillStyle = '#050811';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    for (let sp = 0; sp < 4; sp++) {
      const sa = (sp / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(sa) * (r * 0.72), Math.sin(sa) * (r * 0.72));
      ctx.stroke();
    }

    // Center axle hub
    ctx.fillStyle = rgbToCss(palette[strokeSlot], 0.92);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Swinging Clock-Tower Pendulum hanging behind the Stained-Glass Clock Cog
  const pendSwing = Math.sin(timeSec * 1.8) * 0.28;
  const pendLen = 58;
  const pendBobX = roseX + Math.sin(pendSwing) * pendLen;
  const pendBobY = roseY + Math.cos(pendSwing) * pendLen;
  ctx.strokeStyle = rgbToCss(palette[5], 0.75);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(roseX, roseY);
  ctx.lineTo(pendBobX, pendBobY);
  ctx.stroke();
  ctx.fillStyle = rgbToCss(palette[6], 0.9);
  ctx.beginPath();
  ctx.arc(pendBobX, pendBobY, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Interlocking Meshed Companion Cogs (Upper-Left & Lower-Right)
  drawClockworkCog(
    roseX - 45,
    roseY - 28,
    17,
    10,
    4,
    -clockAng * (roseR / 17),
    2,
    5,
  );
  drawClockworkCog(
    roseX + 47,
    roseY + 24,
    15,
    8,
    4,
    -clockAng * (roseR / 15) + 0.3,
    2,
    6,
  );

  // Outer Brass/Stone Gear Teeth Ring of the Main Stained-Glass Rose Clock
  drawClockworkCog(roseX, roseY, roseR, 16, 5, clockAng, 2, 6);
  // (The high-res stained-glass artwork, lead-came spokes, and clock hands are rendered on `mainCtx`
  //  right after `commitLowPolyRasterPass` so the stained-glass artwork stays crisp and detailed!)

  // 4. Vaulted Pointed Gothic Stone Arches, Pillars & Flickering Wall-Sconce Torches
  const pillarXPositions = [52, 138, CANVAS_W - 138, CANVAS_W - 52];
  ctx.fillStyle = '#070a14';
  ctx.strokeStyle = rgbToCss(palette[3], 0.58);
  ctx.lineWidth = 1.4;

  for (let p = 0; p < pillarXPositions.length; p++) {
    const px = pillarXPositions[p];
    const pw = p === 0 || p === 3 ? 26 : 20;
    ctx.fillRect(px - pw * 0.5, 20, pw, riverY - 20);
    ctx.strokeRect(px - pw * 0.5, 20, pw, riverY - 20);
  }

  // Pointed Gothic Vault Ribbing Connecting the Pillars
  ctx.strokeStyle = rgbToCss(palette[4], 0.52);
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(52, 82);
  ctx.quadraticCurveTo(cx * 0.55, 8, cx, 16);
  ctx.quadraticCurveTo(CANVAS_W - cx * 0.55, 8, CANVAS_W - 52, 82);
  ctx.stroke();

  // Wall-Sconce Torches & Rising Embers (`lighter`)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let p = 0; p < pillarXPositions.length; p++) {
    const tx = pillarXPositions[p];
    const ty = 132;
    const flicker =
      0.84 +
      Math.sin(timeSec * 11 + p * 2.1) * 0.1 +
      Math.cos(timeSec * 17 + p) * 0.06;
    const glowR = (28 + sb[(p * 3) & 15] * 10) * flicker;

    const torchGrad = ctx.createRadialGradient(
      tx,
      ty - 6,
      2,
      tx,
      ty - 6,
      glowR,
    );
    torchGrad.addColorStop(0, '#ffffff');
    torchGrad.addColorStop(0.28, 'rgba(253, 224, 71, 0.82)');
    torchGrad.addColorStop(0.62, 'rgba(249, 115, 22, 0.34)');
    torchGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = torchGrad;
    ctx.beginPath();
    ctx.arc(tx, ty - 6, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#334155';
    ctx.fillRect(tx - 3, ty, 6, 11);
  }

  // Rising Fire Embers
  for (let e = 0; e < 18; e++) {
    const ex =
      64 + ((e * 47 + Math.sin(timeSec * 1.6 + e) * 12) % (CANVAS_W - 128));
    const ey =
      riverY - ((timeSec * (22 + (e % 5) * 7) + e * 19) % (riverY - 24));
    ctx.fillStyle =
      (e & 1) === 0
        ? 'rgba(251, 146, 60, 0.74)'
        : rgbToCss(palette[7], 0.68);
    ctx.fillRect(snapPs1(ex, 2), snapPs1(ey, 2), 2, 2);
  }
  ctx.restore();

  // 5. Inner Sanctum Altar & Flanking Armored Halberdier Guardians
  const altarY = riverY - 10;
  ctx.fillStyle = '#090d1a';
  ctx.strokeStyle = rgbToCss(palette[5], 0.72);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 66, riverY);
  ctx.lineTo(cx - 50, altarY - 14);
  ctx.lineTo(cx + 50, altarY - 14);
  ctx.lineTo(cx + 66, riverY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  for (const side of [-1, 1]) {
    const gx = cx + side * 86;
    const gy = riverY - 2;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.fillStyle = '#050812';
    ctx.strokeStyle = rgbToCss(palette[4], 0.72);
    ctx.lineWidth = 1.3;

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

    // Halberd Polearm + Blade
    ctx.strokeStyle = rgbToCss(palette[7], 0.86);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(side * -10, 0);
    ctx.lineTo(side * -10, -58);
    ctx.lineTo(side * -18, -48);
    ctx.lineTo(side * -10, -42);
    ctx.stroke();
    ctx.restore();
  }

  // 6.Flapping 16-Bit Bats Rising Past the Cathedral Arches
  for (let b = 0; b < 6; b++) {
    const bx = snapPs1(
      ((b * 97 + timeSec * (28 + (b % 3) * 8)) % (CANVAS_W - 80)) + 40,
      2,
    );
    const by = snapPs1(
      riverY - 36 - ((timeSec * 22 + b * 31) % 135),
      2,
    );
    const wingY = Math.sin(timeSec * 14 + b * 2.1) * 6;
    ctx.strokeStyle = rgbToCss(palette[6], 0.8);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(bx - 8, by + wingY);
    ctx.lineTo(bx - 3, by - 2);
    ctx.lineTo(bx, by + 2);
    ctx.lineTo(bx + 3, by - 2);
    ctx.lineTo(bx + 8, by + wingY);
    ctx.stroke();
  }

  // 7. Center-Sanctum Slowly Rotating Low-Poly 3D Coffin (`COFFIN_MESH_3D`)
  const coffinX = snapPs1(cx, 2);
  const coffinY = snapPs1(152 + Math.sin(timeSec * 1.1) * 4, 2);

  // Counter-Rotating Runic Summoning Rings Behind the Coffin
  ctx.save();
  ctx.translate(coffinX, coffinY);
  for (let ring = 0; ring < 2; ring++) {
    const rr = 48 + ring * 16 + subBass * 6;
    ctx.save();
    ctx.rotate(timeSec * (ring === 0 ? 0.35 : -0.25));
    ctx.strokeStyle = rgbToCss(palette[5 + ring], 0.52);
    ctx.lineWidth = 1.3;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // Draw the Slowly Rotating 3D Low-Poly Coffin (`COFFIN_MESH_3D`)
  // Note: Strictly monotonic `ry = timeSec * 0.36` so it never speeds up or reverses on bass hits!
  const coffinScale = 46 + subBass * 4;
  projectAndDrawMesh3D(ctx, COFFIN_MESH_3D, {
    cx: coffinX,
    cy: coffinY,
    scale: coffinScale,
    rx: Math.sin(timeSec * 0.32) * 0.15,
    ry: timeSec * 0.36,
    rz: Math.cos(timeSec * 0.26) * 0.08,
    palette,
    alphaBoost: 0.94,
  });

  // 8. Subterranean Midnight River, Rolling Mist & 16-Bit Dark Fantasy Boat Scene (`y = riverY .. CANVAS_H`)
  const riverGrad = ctx.createLinearGradient(0, riverY, 0, CANVAS_H);
  riverGrad.addColorStop(0, rgbToCss(palette[2], 0.42));
  riverGrad.addColorStop(0.55, rgbToCss(palette[1], 0.28));
  riverGrad.addColorStop(1, '#000000');
  ctx.fillStyle = riverGrad;
  ctx.fillRect(0, riverY, CANVAS_W, CANVAS_H - riverY);

  // Midnight River Scanline Reflections (from 16-Bit Dark Fantasy Act I)
  for (let ry = riverY; ry < CANVAS_H; ry += 4) {
    const d = (ry - riverY) / (CANVAS_H - riverY);
    const wave = Math.sin(timeSec * 2.4 + d * 10) * 10;
    ctx.fillStyle = rgbToCss(
      palette[2 + (Math.floor(ry / 4) & 1)],
      0.28 + d * 0.28,
    );
    ctx.fillRect(0, ry, CANVAS_W, 2);

    // Center Sanctum Coffin shimmer reflection on the river
    const centerGlowW = Math.round(36 * (1 - d * 0.35));
    ctx.fillStyle = rgbToCss(
      palette[5 + (Math.floor(ry / 4) & 1)],
      0.28 * (1 - d * 0.4),
    );
    ctx.fillRect(
      snapPs1(cx + wave * 0.6 - centerGlowW * 0.5, 2),
      ry,
      centerGlowW,
      2,
    );

    // Moon reflection strip on the right
    ctx.fillStyle = rgbToCss(palette[6], 0.36 * (1 - d * 0.5));
    ctx.fillRect(
      snapPs1(moonX + wave - 16 * d, 2),
      ry,
      Math.round(32 * (1 - d * 0.4)),
      2,
    );
  }

  // Rolling Mist Ribbons drifting steadily across the subterranean river
  for (let m = 0; m < 4; m++) {
    const mx = ((timeSec * (18 + m * 6) + m * 165) % (CANVAS_W + 220)) - 110;
    const my = riverY + 6 + m * 16;
    ctx.fillStyle = rgbToCss(palette[4 + (m & 1)], 0.16);
    ctx.fillRect(snapPs1(mx, 2), snapPs1(my, 2), 150, 7);
  }

  // Wooden Skiff + 2 Hooded Dark-Cloaked Travelers + Flickering Torch at Prow (from 16-Bit Dark Fantasy Boat Scene!)
  const boatX = snapPs1(cx - 95 + Math.sin(timeSec * 0.52) * 115, 2);
  const boatY = snapPs1(riverY + 34 + Math.sin(timeSec * 2.1) * 3.5, 2);

  // Torchlight radial polygon aura at prow
  const torchX = boatX + 52;
  const torchY = boatY - 28 + Math.sin(timeSec * 12) * 1.5;
  for (let ring = 3; ring >= 1; ring--) {
    const tr = ring * (13 + beat * 5 + Math.sin(timeSec * 15 + ring) * 2);
    ctx.fillStyle = rgbToCss(
      palette[Math.min(7, 8 - ring)] || palette[6],
      0.15 * (4 - ring),
    );
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const px = torchX + Math.cos(a) * tr;
      const py = torchY + Math.sin(a) * tr;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Skiff hull
  ctx.fillStyle = rgbToCss(palette[2], 0.96);
  ctx.strokeStyle = rgbToCss(palette[6], 0.92);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(boatX - 54, boatY - 6);
  ctx.lineTo(boatX + 58, boatY - 10);
  ctx.lineTo(boatX + 42, boatY + 11);
  ctx.lineTo(boatX - 40, boatY + 11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 2 Hooded Cloaked Figures in the boat
  for (let fig = 0; fig < 2; fig++) {
    const fx = boatX - 20 + fig * 34;
    const fy = boatY - 6;
    ctx.fillStyle = rgbToCss(palette[1], 0.98);
    ctx.strokeStyle = rgbToCss(palette[5 + fig], 0.9);
    ctx.beginPath();
    ctx.moveTo(fx - 11, fy);
    ctx.lineTo(fx - 7, fy - 22);
    ctx.lineTo(fx + 2, fy - 30); // Pointed dark hood
    ctx.lineTo(fx + 9, fy - 20);
    ctx.lineTo(fx + 11, fy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Torch pole & polygonal flame at prow
  ctx.strokeStyle = rgbToCss(palette[5], 0.95);
  ctx.beginPath();
  ctx.moveTo(boatX + 44, boatY - 6);
  ctx.lineTo(torchX, torchY + 5);
  ctx.stroke();
  ctx.fillStyle = rgbToCss(palette[7], 0.98);
  ctx.beginPath();
  ctx.moveTo(torchX, torchY - 9 - beat * 4);
  ctx.lineTo(torchX + 5, torchY + 2);
  ctx.lineTo(torchX - 5, torchY + 2);
  ctx.closePath();
  ctx.fill();

  // Commit low-poly raster pass with subtle scanlines and zero tearing
  commitLowPolyRasterPass(mainCtx, ctx, {
    scanlineAlpha: 0.16,
    vhsTearAmount: drop * 0.08,
    timeSec,
    bayerTintRgb: palette[3],
    bayerAlpha: 0.05,
  });

  // 8B. High-Resolution Rotating Stained-Glass Rose Window & Clock-Face Overlay on `mainCtx`
  mainCtx.save();
  mainCtx.translate(roseX, roseY);
  mainCtx.beginPath();
  mainCtx.arc(0, 0, roseR - 2, 0, Math.PI * 2);
  mainCtx.clip();

  mainCtx.save();
  mainCtx.rotate(clockAng);
  mainCtx.imageSmoothingEnabled = true;
  mainCtx.imageSmoothingQuality = 'high';
  if (artReady && artCanvas) {
    mainCtx.globalAlpha = 0.86;
    mainCtx.drawImage(artCanvas, -roseR, -roseR, roseR * 2, roseR * 2);
    mainCtx.globalAlpha = 1;
    mainCtx.fillStyle = rgbToCss(palette[4], 0.16);
    mainCtx.fillRect(-roseR, -roseR, roseR * 2, roseR * 2);
  } else {
    const rGrad = mainCtx.createRadialGradient(0, 0, 4, 0, 0, roseR);
    rGrad.addColorStop(0, rgbToCss(palette[7], 0.85));
    rGrad.addColorStop(0.6, rgbToCss(palette[4], 0.7));
    rGrad.addColorStop(1, '#090d16');
    mainCtx.fillStyle = rGrad;
    mainCtx.fillRect(-roseR, -roseR, roseR * 2, roseR * 2);
  }

  // Crisp stained-glass radial lead-came spokes & inner trefoil rings rotating with the glass
  mainCtx.strokeStyle = 'rgba(2, 6, 23, 0.82)';
  mainCtx.lineWidth = 1.4;
  for (let sp = 0; sp < 8; sp++) {
    const ang = (sp / 8) * Math.PI * 2;
    mainCtx.beginPath();
    mainCtx.moveTo(0, 0);
    mainCtx.lineTo(Math.cos(ang) * roseR, Math.sin(ang) * roseR);
    mainCtx.stroke();
  }
  mainCtx.beginPath();
  mainCtx.arc(0, 0, roseR * 0.56, 0, Math.PI * 2);
  mainCtx.stroke();
  mainCtx.restore();

  // 12 Clock-Face Hour Tick Marks + Ornate Gothic Clock Hands
  mainCtx.strokeStyle = rgbToCss(palette[7], 0.9);
  mainCtx.lineWidth = 1.2;
  for (let h = 0; h < 12; h++) {
    const ha = (h / 12) * Math.PI * 2;
    const r0 = (h % 3 === 0 ? 0.74 : 0.82) * (roseR - 2);
    const r1 = 0.94 * (roseR - 2);
    mainCtx.beginPath();
    mainCtx.moveTo(Math.cos(ha) * r0, Math.sin(ha) * r0);
    mainCtx.lineTo(Math.cos(ha) * r1, Math.sin(ha) * r1);
    mainCtx.stroke();
  }

  const minAng = timeSec * 0.45 - Math.PI * 0.5;
  const hrAng = timeSec * 0.08 - Math.PI * 0.5;
  mainCtx.strokeStyle = rgbToCss(palette[7], 0.96);
  mainCtx.lineWidth = 1.8;
  mainCtx.beginPath();
  mainCtx.moveTo(0, 0);
  mainCtx.lineTo(
    Math.cos(minAng) * (roseR * 0.74),
    Math.sin(minAng) * (roseR * 0.74),
  );
  mainCtx.moveTo(0, 0);
  mainCtx.lineTo(
    Math.cos(hrAng) * (roseR * 0.48),
    Math.sin(hrAng) * (roseR * 0.48),
  );
  mainCtx.stroke();

  mainCtx.fillStyle = rgbToCss(palette[6], 0.96);
  mainCtx.beginPath();
  mainCtx.arc(0, 0, 3, 0, Math.PI * 2);
  mainCtx.fill();
  mainCtx.restore();

  mainCtx.strokeStyle = rgbToCss(palette[6], 0.9);
  mainCtx.lineWidth = 2.0;
  mainCtx.beginPath();
  mainCtx.arc(roseX, roseY, roseR - 2, 0, Math.PI * 2);
  mainCtx.stroke();

  // 9. Diegetic 16-Bit JRPG Ornate Obsidian & Gold-Filigree Dialogue Box for `activeLyric`
  const cleanLyric = (activeLyric || '').trim();
  if (cleanLyric.length > 0) {
    const lines = splitIntoBalancedLines(cleanLyric, 38);
    const boxW = Math.min(
      CANVAS_W - 68,
      Math.max(248, lines[0].length * 8.4 + 48),
    );
    const boxH = lines.length * 18 + 20;
    const boxX = cx - boxW * 0.5;
    const boxY = Math.min(CANVAS_H - boxH - 14, cropBottomY - boxH - 10);

    mainCtx.save();
    const dlgGrad = mainCtx.createLinearGradient(boxX, boxY, boxX, boxY + boxH);
    dlgGrad.addColorStop(0, 'rgba(15, 23, 52, 0.92)');
    dlgGrad.addColorStop(1, 'rgba(4, 7, 18, 0.95)');
    mainCtx.fillStyle = dlgGrad;
    mainCtx.strokeStyle = rgbToCss(palette[6], 0.95);
    mainCtx.lineWidth = 2.0;
    mainCtx.beginPath();
    mainCtx.roundRect(boxX, boxY, boxW, boxH, 6);
    mainCtx.fill();
    mainCtx.stroke();

    mainCtx.strokeStyle = rgbToCss(palette[5], 0.45);
    mainCtx.lineWidth = 1.0;
    mainCtx.beginPath();
    mainCtx.roundRect(boxX + 3, boxY + 3, boxW - 6, boxH - 6, 4);
    mainCtx.stroke();

    mainCtx.font = '700 12.5px "JetBrains Mono", Georgia, serif';
    mainCtx.textAlign = 'center';
    mainCtx.textBaseline = 'middle';
    mainCtx.fillStyle = rgbToCss(palette[7], 0.98);
    for (let i = 0; i < lines.length; i++) {
      mainCtx.fillText(lines[i], cx, boxY + 16 + i * 18);
    }
    mainCtx.restore();
  }

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
