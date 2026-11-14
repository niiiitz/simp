import {
  CYBER_AVATAR_HEAD_MESH,
  type LowPolyMesh,
  projectAndDrawMesh3D,
  snapPs1,
} from './lowPoly3d';
import {
  CANVAS_H,
  CANVAS_W,
  lerpRgb,
  rgbToCss,
  splitIntoBalancedLines,
  type RgbTuple,
  type SceneRenderContext,
} from './types';

/**
 * 3D Vintage CRT Monitor + Desktop Pizza-Box Base + Rear Cathode Tube Mesh
 * Spins smoothly in 3D space!
 */
const CRT_COMPUTER_MESH_3D: LowPolyMesh = {
  verts: [
    // Front monitor bezel (0..3) at +Z (facing camera when ry = 0)
    [-0.95, -0.78, 0.65],
    [0.95, -0.78, 0.65],
    [0.95, 0.52, 0.65],
    [-0.95, 0.52, 0.65],
    // Rear tapered CRT cathode housing (4..7) at -Z (back of monitor)
    [-0.52, -0.46, -0.68],
    [0.52, -0.46, -0.68],
    [0.52, 0.32, -0.68],
    [-0.52, 0.32, -0.68],
    // Desktop Pizza-Box CPU Base underneath (8..15)
    [-1.08, 0.56, 0.75],
    [1.08, 0.56, 0.75],
    [1.08, 0.92, 0.75],
    [-1.08, 0.92, 0.75],
    [-1.08, 0.56, -0.55],
    [1.08, 0.56, -0.55],
    [1.08, 0.92, -0.55],
    [-1.08, 0.92, -0.55],
  ],
  faces: [
    // Monitor Casing Sides & Rear Tube
    { indices: [0, 1, 5, 4], palIdx: 5, alpha: 0.90, wirePalIdx: 7 },
    { indices: [2, 3, 7, 6], palIdx: 2, alpha: 0.88, wirePalIdx: 5 },
    { indices: [0, 3, 7, 4], palIdx: 3, alpha: 0.90, wirePalIdx: 6 },
    { indices: [1, 2, 6, 5], palIdx: 4, alpha: 0.90, wirePalIdx: 6 },
    { indices: [4, 5, 6, 7], palIdx: 2, alpha: 0.88, wirePalIdx: 5 },
    // Front CRT Bezel Face
    { indices: [0, 1, 2, 3], palIdx: 6, alpha: 0.92, wirePalIdx: 7 },
    // Desktop CPU Base
    { indices: [8, 9, 10, 11], palIdx: 4, alpha: 0.92, wirePalIdx: 7 },
    { indices: [12, 13, 14, 15], palIdx: 2, alpha: 0.85, wirePalIdx: 5 },
    { indices: [8, 9, 13, 12], palIdx: 5, alpha: 0.88, wirePalIdx: 6 },
    { indices: [8, 11, 15, 12], palIdx: 3, alpha: 0.88, wirePalIdx: 6 },
    { indices: [9, 10, 14, 13], palIdx: 3, alpha: 0.88, wirePalIdx: 6 },
  ],
};

/**
 * 3D Spinning Cube / Mainframe Totem Mesh (from WannaCry / CSIRAC)
 */
const SPINNING_CUBE_MESH: LowPolyMesh = {
  verts: [
    [-0.75, -0.75, -0.75],
    [0.75, -0.75, -0.75],
    [0.75, 0.75, -0.75],
    [-0.75, 0.75, -0.75],
    [-0.75, -0.75, 0.75],
    [0.75, -0.75, 0.75],
    [0.75, 0.75, 0.75],
    [-0.75, 0.75, 0.75],
  ],
  faces: [
    { indices: [0, 1, 2, 3], palIdx: 4, alpha: 0.82, wirePalIdx: 7 },
    { indices: [4, 5, 6, 7], palIdx: 2, alpha: 0.78, wirePalIdx: 5 },
    { indices: [0, 1, 5, 4], palIdx: 5, alpha: 0.84, wirePalIdx: 7 },
    { indices: [2, 3, 7, 6], palIdx: 2, alpha: 0.78, wirePalIdx: 5 },
    { indices: [0, 3, 7, 4], palIdx: 3, alpha: 0.84, wirePalIdx: 6 },
    { indices: [1, 2, 6, 5], palIdx: 6, alpha: 0.84, wirePalIdx: 7 },
  ],
};

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
  bodyGrad.addColorStop(0.6, rgbToCss(lerpRgb(topRgb, bellyRgb, 0.5), 0.92));
  bodyGrad.addColorStop(1, rgbToCss(bellyRgb, 0.95));

  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = rgbToCss(bellyRgb, 0.95);
  ctx.lineWidth = 1.05;
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(24, 2.5);
  ctx.quadraticCurveTo(20, 0.5, 17.5, -1.5);
  ctx.bezierCurveTo(13, -6.5, 5, -9.5, -1.5, -9.0);
  ctx.quadraticCurveTo(-3.5, -15.5, -9.5, -17.0);
  ctx.quadraticCurveTo(-7.0, -11.5, -7.8, -8.2);
  ctx.bezierCurveTo(-14, -6.5, -20, -2.5, -25, 0.5);
  ctx.lineTo(-31.5, -4.8);
  ctx.quadraticCurveTo(-28.5, 0.8, -27.2, 1.8);
  ctx.quadraticCurveTo(-29.0, 4.2, -31.0, 7.5);
  ctx.lineTo(-24.2, 3.2);
  ctx.bezierCurveTo(-18, 2.0, -10, 4.8, -2, 5.2);
  ctx.lineTo(1.5, 12.2);
  ctx.quadraticCurveTo(5.8, 10.2, 6.2, 5.0);
  ctx.quadraticCurveTo(14, 4.8, 19.5, 3.8);
  ctx.quadraticCurveTo(22.5, 3.6, 24, 2.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Mode 16: Vaporwave 3D [Unified Y2K / WannaCry / Algorave / Spinning CRT Odyssey]
 * Combines the strongest elements of V1 Vaporwave, WannaCry OS, Algorave Live-Coding, and V2 3D:
 * - Pixel-sorted album art backdrop strips + Palette-driven Sliced Sunset & Receding Outrun Grid
 * - Speeding Tron Lightcycles, Leaping Bottlenose Dolphins, Hanging Tropical Vines & Fiji Bottle
 * - Low-Poly Poseidon Greek God Bust + 3-Pronged Trident (Left) & Spinning 3D Cubes
 * - 3D Spinning Vintage CRT Desktop Computer at Center Stage (with live album art on its rotating screen!)
 * - Cascading Tiling Y2K Dialog Windows + Swarm of Chaotic Mouse Cursors
 * - Pop-In / Pop-Out Algorave Live-Coding Terminal (`STRUDEL_REPL.EXE`) that pops open, executes beat-synced
 *   code patterns, and closes!
 */
export function renderVaporwave3dScene(s: SceneRenderContext): void {
  const {
    ctx,
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
    trackTitle,
    cropTopY,
    cropBottomY,
  } = s;

  const cx = CANVAS_W * 0.5;
  const horizonY = 186;

  // 1. Deep #000000 Sky + Album-Palette Horizon Gradient + Pixel-Sorted Album Art Backdrop (from WannaCry!)
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0, '#000000');
  skyGrad.addColorStop(0.5, rgbToCss(palette[2], 0.48));
  skyGrad.addColorStop(1, rgbToCss(palette[5], 0.58 + subBass * 0.22));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, horizonY);

  // Pixel-sorted vertical album art strips shimmering across the sky backdrop
  if (artReady && artCanvas) {
    const numStrips = 24;
    const stripW = CANVAS_W / numStrips;
    for (let st = 0; st < numStrips; st++) {
      const bandAmp = sb[st & 15] || 0;
      const sortShiftY = Math.sin(timeSec * 2.6 + st * 0.65) * (10 + bandAmp * 32 + drop * 26);
      const srcX = Math.floor((st / numStrips) * 128);
      ctx.save();
      ctx.globalAlpha = 0.22 + bandAmp * 0.22;
      ctx.drawImage(
        artCanvas,
        srcX,
        0,
        Math.max(1, Math.floor(128 / numStrips)),
        128,
        st * stripW,
        sortShiftY,
        stripW + 1,
        horizonY + 16,
      );
      ctx.restore();
    }
  }

  // 2. Palette-Driven Sliced Sunset Sphere on the Horizon
  const sunR = 64 + subBass * 6 + beat * 3;
  const sunY = horizonY - 12;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, sunY, sunR, Math.PI, Math.PI * 2.15);
  ctx.clip();

  const sunGrad = ctx.createLinearGradient(cx, sunY - sunR, cx, sunY + 14);
  sunGrad.addColorStop(0, rgbToCss(palette[7], 0.96));
  sunGrad.addColorStop(0.5, rgbToCss(palette[6], 0.92));
  sunGrad.addColorStop(1, rgbToCss(palette[4], 0.90));
  ctx.fillStyle = sunGrad;
  ctx.fillRect(cx - sunR, sunY - sunR, sunR * 2, sunR + 18);

  ctx.fillStyle = '#000000';
  for (let slice = 0; slice < 7; slice++) {
    const sy = sunY - 28 + slice * 6.5 + ((timeSec * 3.5) % 6.5);
    const sh = 1.2 + slice * 0.55;
    ctx.fillRect(cx - sunR, sy, sunR * 2, sh);
  }
  ctx.restore();

  // 3. Receding 3D Perspective Grid Floor + Speeding Tron Lightcycles (Palette-Tinted!)
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

      const tilePal = (c & 1) === 0 ? palette[3] : palette[5];
      ctx.fillStyle = rgbToCss(tilePal, (0.14 + d0 * 0.36) * (0.75 + subBass * 0.25));
      ctx.beginPath();
      ctx.moveTo(x0a, y0);
      ctx.lineTo(x0b, y0);
      ctx.lineTo(x1b, y1);
      ctx.lineTo(x1a, y1);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgbToCss(palette[6], 0.52 + beat * 0.25);
  ctx.lineWidth = 1.2;
  for (let v = -7; v <= 7; v++) {
    ctx.beginPath();
    ctx.moveTo(cx + v * 15, horizonY);
    ctx.lineTo(cx + v * 92, CANVAS_H);
    ctx.stroke();
  }

  // Speeding iBook G3 / iMac G3 Translucent "Hockey Puck" One-Button USB Mice (M4848)
  for (let lc = 0; lc < 2; lc++) {
    const sign = lc === 0 ? -1 : 1;
    const laneU = sign * (0.24 + Math.sin(timeSec * 0.85 + lc * 2.1) * 0.14);
    const originX = cx + laneU * 95;
    const originY = horizonY + 4;
    const puckY = horizonY + 88 + lc * 28;
    const puckX = cx + laneU * 380;
    const puckColor = palette[5 + lc] || palette[6];

    // Glowing translucent USB cord trailing back to the horizon
    const trailGrad = ctx.createLinearGradient(originX, originY, puckX, puckY);
    trailGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    trailGrad.addColorStop(1, rgbToCss(puckColor, 0.90));
    ctx.strokeStyle = trailGrad;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.quadraticCurveTo(
      (originX + puckX) * 0.5 + Math.sin(timeSec * 4 + lc) * 8,
      (originY + puckY) * 0.5,
      puckX,
      puckY - 7,
    );
    ctx.stroke();

    // Draw the circular two-tone translucent Apple USB "Hockey Puck" One-Button Mouse
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.translate(puckX, puckY);
    // Slight bank angle as it swerves across the Outrun grid
    const steerAngle = Math.cos(timeSec * 0.85 + lc * 2.1) * sign * 0.22;
    ctx.rotate(steerAngle);

    const rx = 14;
    const ry = 11.5; // Foreshortened 3D perspective disc on the grid floor

    // Drop shadow / neon underglow ring
    ctx.fillStyle = rgbToCss(puckColor, 0.35 + beat * 0.2);
    ctx.beginPath();
    ctx.ellipse(0, 2.5, rx + 2, ry + 1.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // USB cord strain-relief grommet nub at the front/top of the mouse
    ctx.fillStyle = rgbToCss(palette[7], 0.92);
    ctx.strokeStyle = rgbToCss(puckColor, 0.95);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.roundRect(-2.5, -ry - 3.5, 5, 4.5, 1.5);
    ctx.fill();
    ctx.stroke();

    // Outer translucent polycarbonate puck shell (Frosted Ice White base)
    ctx.fillStyle = 'rgba(241, 245, 249, 0.88)';
    ctx.strokeStyle = rgbToCss(palette[7], 0.96);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Translucent colored single-button front cap & side grip panels (Bondi / Tangerine / Palette)
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx - 0.8, ry - 0.8, 0, 0, Math.PI * 2);
    ctx.clip();

    // Front single-button wedge (upper half of the puck where the cord attaches)
    ctx.fillStyle = rgbToCss(puckColor, 0.86);
    ctx.beginPath();
    ctx.moveTo(-rx - 2, -ry - 2);
    ctx.lineTo(rx + 2, -ry - 2);
    ctx.lineTo(rx + 2, -0.5);
    ctx.quadraticCurveTo(0, 3.2, -rx - 2, -0.5);
    ctx.closePath();
    ctx.fill();

    // Translucent colored left & right side grip scallops on the lower palm shell
    ctx.fillStyle = rgbToCss(puckColor, 0.72);
    ctx.beginPath();
    ctx.ellipse(-rx * 0.82, 3, 5.5, 6.5, 0.2, 0, Math.PI * 2);
    ctx.ellipse(rx * 0.82, 3, 5.5, 6.5, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Visible internal trackball housing ring seen dimly through the translucent plastic
    ctx.strokeStyle = rgbToCss(palette[2], 0.45);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 1.5, 4.8, 3.8, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Curved seam dividing the single top mouse button from the palm shell
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-rx, -0.5);
    ctx.quadraticCurveTo(0, 3.2, rx, -0.5);
    ctx.stroke();

    // Signature tactile finger-indent dimple on the single mouse button (flashes on beat clicks!)
    ctx.fillStyle = beat > 0.45 ? '#ffffff' : rgbToCss(palette[7], 0.75);
    ctx.beginPath();
    ctx.ellipse(0, -ry * 0.46, 3.2, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Specular polycarbonate dome highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.ellipse(-4, -3.5, 4.5, 2.2, -0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }
  ctx.restore();

  // 4. Leaping Bottlenose Dolphins Over the Horizon
  for (let d = 0; d < 2; d++) {
    const leapProg = ((timeSec * 0.28 + d * 0.5) % 1);
    const dx = cx - 92 + d * 78 + (leapProg - 0.5) * 145;
    const arcY = Math.sin(leapProg * Math.PI) * 64;
    const dy = horizonY - 4 - arcY;
    const pitch = Math.atan2(-Math.cos(leapProg * Math.PI) * 64 * Math.PI, 145);

    if (arcY > 3) {
      drawBottlenoseDolphin(ctx, dx, dy, 1.08, pitch, palette[6], palette[4]);
    }
  }

  // 5. Left Flank: Low-Poly Poseidon Statue (`CYBER_AVATAR_HEAD_MESH`) + 3-Pronged Trident
  const posX = 96 + Math.sin(timeSec * 0.55) * 6;
  const posY = 152 + Math.cos(timeSec * 0.75) * 5;
  projectAndDrawMesh3D(ctx, CYBER_AVATAR_HEAD_MESH, {
    cx: posX,
    cy: posY,
    scale: 38 + subBass * 6,
    rx: 0.12,
    ry: Math.sin(timeSec * 0.65) * 0.45,
    rz: 0,
    palette,
    snapStep: 1,
    alphaBoost: 0.92,
  });

  // Poseidon's Golden/Palette 3-Pronged Trident
  const tridX = posX + 46;
  const tridY = posY + Math.cos(timeSec * 1.6) * 6;
  ctx.save();
  ctx.strokeStyle = rgbToCss(palette[7], 0.94);
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(tridX, tridY + 46);
  ctx.lineTo(tridX, tridY - 38 - beat * 6);
  ctx.moveTo(tridX - 14, tridY - 20);
  ctx.lineTo(tridX + 14, tridY - 20);
  ctx.moveTo(tridX - 14, tridY - 20);
  ctx.lineTo(tridX - 14, tridY - 36 - beat * 6);
  ctx.moveTo(tridX + 14, tridY - 20);
  ctx.lineTo(tridX + 14, tridY - 36 - beat * 6);
  ctx.stroke();
  ctx.restore();

  // 6. Right Flank: Translucent Fiji Water Bottle + Orbiting 3D Spinning Cubes (from WannaCry!)
  const botX = CANVAS_W - 92 + Math.cos(timeSec * 0.58) * 6;
  const botY = 154 + Math.sin(timeSec * 0.82) * 5;

  // Spinning 3D Cubes orbiting high in the upper left & right sky
  projectAndDrawMesh3D(ctx, SPINNING_CUBE_MESH, {
    cx: 178,
    cy: 78 + Math.sin(timeSec * 1.3) * 8,
    scale: 18 + beat * 5,
    rx: timeSec * 1.1,
    ry: timeSec * 1.5,
    rz: timeSec * 0.7,
    palette,
    snapStep: 1,
  });
  projectAndDrawMesh3D(ctx, SPINNING_CUBE_MESH, {
    cx: CANVAS_W - 178,
    cy: 78 + Math.cos(timeSec * 1.3) * 8,
    scale: 18 + beat * 5,
    rx: -timeSec * 1.2,
    ry: timeSec * 1.4,
    rz: -timeSec * 0.8,
    palette,
    snapStep: 1,
  });

  // Fiji Water Bottle on Right Flank
  ctx.save();
  ctx.translate(botX, botY);
  ctx.rotate(Math.sin(timeSec * 0.65) * 0.06);
  ctx.fillStyle = rgbToCss(palette[6], 0.92);
  ctx.strokeStyle = rgbToCss(palette[7], 0.92);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(-10, -44, 20, 9, 2);
  ctx.fill();
  ctx.stroke();

  const aquaGrad = ctx.createLinearGradient(-24, -30, 24, 36);
  aquaGrad.addColorStop(0, rgbToCss(palette[6], 0.72));
  aquaGrad.addColorStop(0.5, rgbToCss(palette[4], 0.55));
  aquaGrad.addColorStop(1, rgbToCss(palette[2], 0.82));
  ctx.fillStyle = aquaGrad;
  ctx.strokeStyle = rgbToCss(palette[7], 0.90);
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

  if (artReady && artCanvas) {
    ctx.drawImage(artCanvas, -16, -14, 32, 34);
  }
  ctx.strokeStyle = rgbToCss(palette[6], 0.92);
  ctx.strokeRect(-16, -14, 32, 34);
  ctx.restore();

  // 7. Centerpiece: 3D Spinning Vintage CRT Desktop Computer (`CRT_COMPUTER_MESH_3D`)!
  const compX = cx;
  const compY = horizonY + 34 + Math.sin(timeSec * 1.6) * 6;
  const compSpinY = timeSec * 0.85;
  const compTiltX = 0.14 + Math.sin(timeSec * 0.7) * 0.08;
  const compRollZ = Math.sin(timeSec * 0.5) * 0.05;
  const compScale = 44 + subBass * 10 + beat * 6;

  projectAndDrawMesh3D(ctx, CRT_COMPUTER_MESH_3D, {
    cx: compX,
    cy: compY,
    scale: compScale,
    rx: compTiltX,
    ry: compSpinY,
    rz: compRollZ,
    palette,
    snapStep: 1,
    alphaBoost: 0.94,
  });

  // Project the exact 3D front screen corners (`z = +0.66`) using the same 3D transform as `projectAndDrawMesh3D`
  // so the album artwork sits locked onto the front monitor bezel and disappears when the back cathode tube faces us!
  const projectCompPt = (vx: number, vy: number, vz: number): [number, number, number] => {
    const cosX = Math.cos(compTiltX), sinX = Math.sin(compTiltX);
    const cosY = Math.cos(compSpinY), sinY = Math.sin(compSpinY);
    const cosZ = Math.cos(compRollZ), sinZ = Math.sin(compRollZ);
    const y1 = vy * cosX - vz * sinX;
    const z1 = vy * sinX + vz * cosX;
    const x2 = vx * cosY + z1 * sinY;
    const z2 = -vx * sinY + z1 * cosY;
    const x3 = x2 * cosZ - y1 * sinZ;
    const y3 = x2 * sinZ + y1 * cosZ;
    const persp = 3.4 / Math.max(0.45, 3.4 - z2 * 0.45);
    return [compX + x3 * compScale * persp, compY + y3 * compScale * persp, z2];
  };

  const scrCenter = projectCompPt(0, -0.13, 0.66);
  const scrLeft = projectCompPt(-0.76, -0.13, 0.66);
  const scrRight = projectCompPt(0.76, -0.13, 0.66);
  const scrTop = projectCompPt(0, -0.62, 0.66);
  const scrBot = projectCompPt(0, 0.36, 0.66);

  // `scrRight[0] > scrLeft[0] + 6` is true if and only if the front monitor bezel is facing the camera!
  const projScreenW = scrRight[0] - scrLeft[0];
  const projScreenH = Math.abs(scrBot[1] - scrTop[1]);
  if (projScreenW > 6 && scrCenter[2] > 0) {
    ctx.save();
    ctx.translate(scrCenter[0], scrCenter[1]);
    ctx.rotate(compRollZ);
    ctx.fillStyle = '#000000';
    ctx.fillRect(-projScreenW * 0.5, -projScreenH * 0.5, projScreenW, projScreenH);
    if (artReady && artCanvas) {
      ctx.globalAlpha = 0.90;
      ctx.drawImage(
        artCanvas,
        -projScreenW * 0.5 + 2,
        -projScreenH * 0.5 + 2,
        Math.max(2, projScreenW - 4),
        Math.max(2, projScreenH - 4),
      );
    }
    ctx.strokeStyle = rgbToCss(palette[7], 0.95);
    ctx.lineWidth = 1.4;
    ctx.strokeRect(-projScreenW * 0.5, -projScreenH * 0.5, projScreenW, projScreenH);
    ctx.restore();
  }

  // 8. Cascading Tiling Y2K Warning / Progress Windows (from WannaCry!)
  const cascadeCount = 5;
  const activeStep = Math.floor(timeSec * (3.2 + drop * 5)) % cascadeCount;
  for (let w = 0; w <= activeStep; w++) {
    const wx = snapPs1(36 + w * 18 + Math.sin(timeSec * 1.8 + w) * 4, 1);
    const wy = snapPs1(horizonY + 26 + w * 14, 1);
    const ww = 136;
    const wh = 54;

    ctx.fillStyle = rgbToCss(palette[1], 0.92);
    ctx.fillRect(wx, wy, ww, wh);
    ctx.strokeStyle = rgbToCss(palette[6], 0.94);
    ctx.lineWidth = 1.4;
    ctx.strokeRect(wx, wy, ww, wh);

    // Title bar
    ctx.fillStyle = rgbToCss(palette[4 + (w & 1)], 0.95);
    ctx.fillRect(wx + 2, wy + 2, ww - 4, 10);
    ctx.fillStyle = rgbToCss(palette[7], 0.98);
    ctx.fillRect(wx + ww - 11, wy + 3, 7, 7);

    // Looping segmented progress bar inside each tiled window
    const progW = ww - 18;
    ctx.strokeStyle = rgbToCss(palette[5], 0.88);
    ctx.strokeRect(wx + 9, wy + 30, progW, 10);
    const fillRatio = ((timeSec * 0.95 + w * 0.21) % 1);
    const blocks = Math.floor(fillRatio * 8);
    ctx.fillStyle = rgbToCss(palette[6], 0.95);
    for (let b = 0; b < blocks; b++) {
      ctx.fillRect(wx + 11 + b * 14, wy + 32, 11, 6);
    }
  }

  // 9. Pop-In / Pop-Out Algorave "Live-Coding" Terminal Window (`STRUDEL_REPL.EXE`)!
  //    Pops open periodically (for ~9s out of every 20s cycle, or whenever `drop > 0.22`) and disappears cleanly!
  const replCycle = timeSec % 20.0;
  const replShouldShow = (replCycle >= 5.0 && replCycle <= 14.5) || drop > 0.22;
  if (replShouldShow) {
    let popScale = 1.0;
    if (replCycle >= 5.0 && replCycle < 5.45) {
      popScale = (replCycle - 5.0) / 0.45;
    } else if (replCycle > 14.0 && replCycle <= 14.5 && drop <= 0.22) {
      popScale = Math.max(0, (14.5 - replCycle) / 0.5);
    }

    if (popScale > 0.05) {
      const termW = 248;
      const termH = 114;
      const termCx = CANVAS_W - 148;
      const termCy = horizonY + 74;

      ctx.save();
      ctx.translate(termCx, termCy);
      ctx.scale(popScale, popScale);

      const tx = -termW * 0.5;
      const ty = -termH * 0.5;
      ctx.fillStyle = rgbToCss(palette[0], 0.90);
      ctx.fillRect(tx, ty, termW, termH);
      ctx.strokeStyle = rgbToCss(palette[7], 0.95);
      ctx.lineWidth = 1.6;
      ctx.strokeRect(tx, ty, termW, termH);

      // Terminal title bar
      ctx.fillStyle = rgbToCss(palette[5], 0.95);
      ctx.fillRect(tx + 2, ty + 2, termW - 4, 13);
      ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
      ctx.fillStyle = rgbToCss(palette[0], 0.98);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const shortTitle = (trackTitle || 'VAPOR_REPL').slice(0, 14).toUpperCase();
      ctx.fillText(`ALGORAVE // ${shortTitle} [${Math.round(bpm || 120)}BPM]`, tx + 6, ty + 8.5);

      const step16 = Math.floor((timeSec * Math.max(60, bpm || 120)) / 15) & 15;
      const kickHit = subBass > 0.36 || (step16 & 3) === 0;
      const snareHit = midEnergy > 0.34 || (step16 & 7) === 4;
      const hatHit = highEnergy > 0.26 || (step16 & 1) === 1;
      const lpfVal = Math.round(320 + midEnergy * 3200);

      const codeLines: { code: string; active: boolean; palIdx: number }[] = [
        { code: `d1 $ stack [`, active: false, palIdx: 6 },
        { code: `  s "bd*4" # gain ${(1 + subBass * 0.5).toFixed(1)},`, active: kickHit, palIdx: 7 },
        { code: `  s "~ cp" # crush 4,`, active: snareHit, palIdx: 6 },
        { code: `  s "hh*8" # lpf ${lpfVal}`, active: hatHit, palIdx: 5 },
        { code: `] # room ${(0.3 + beat * 0.5).toFixed(2)}`, active: drop > 0.2, palIdx: 7 },
      ];

      ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
      for (let i = 0; i < codeLines.length; i++) {
        const row = codeLines[i];
        const ry = ty + 24 + i * 17;
        if (row.active) {
          const highlightW = Math.min(termW - 14, row.code.length * 6.0 + 8);
          ctx.fillStyle = rgbToCss(palette[row.palIdx], 0.92);
          ctx.fillRect(tx + 7, ry - 7, highlightW, 14);
          ctx.fillStyle = rgbToCss(palette[0], 0.98);
          ctx.fillText(row.code, tx + 10, ry);
        } else {
          ctx.fillStyle = rgbToCss(palette[row.palIdx], 0.88);
          ctx.fillText(row.code, tx + 10, ry);
        }
      }
      ctx.restore();
    }
  }

  // 10. Win95 Solitaire Bouncing Card Cascade on Beat Drops (`drop > 0.12` or periodic cascade)
  const cascadeActive = drop > 0.12 || ((timeSec % 24) > 19.5);
  if (cascadeActive) {
    const numCards = 8;
    for (let c = 0; c < numCards; c++) {
      const tCard = timeSec * 2.2 - c * 0.14;
      const cardX = 80 + ((tCard * 62) % (CANVAS_W - 160));
      const bounceY = Math.abs(Math.sin(tCard * 2.1)) * 84;
      const cardY = CANVAS_H - 42 - bounceY;

      ctx.save();
      ctx.fillStyle = rgbToCss(palette[7], 0.96);
      ctx.strokeStyle = rgbToCss(palette[1], 0.96);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, 26, 36, 3);
      ctx.fill();
      ctx.stroke();

      const isAlt = (c & 1) === 0;
      ctx.fillStyle = rgbToCss(palette[isAlt ? 5 : 1], 0.98);
      ctx.font = 'bold 9px monospace';
      ctx.fillText(isAlt ? 'A♥' : 'K♠', cardX + 4, cardY + 11);
      ctx.restore();
    }
  }

  // 11. Hanging Botanical Vines & Tropical Monstera Leaves from the Top Canopy (Strictly `palette[2..6]`)
  const numVines = 7;
  for (let v = 0; v < numVines; v++) {
    if (v === 3) continue; // Keep upper-center clear for `IMP_LYRICS.EXE` window
    const vxBase = (v + 0.5) * (CANVAS_W / numVines);
    const vineLen = 44 + (v % 3) * 22 + (v === 0 || v === numVines - 1 ? 48 : 0);
    const sway = Math.sin(timeSec * 1.4 + v * 0.9) * 9;

    ctx.strokeStyle = rgbToCss(palette[3 + (v & 3)], 0.85);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(vxBase, 0);
    for (let seg = 1; seg <= 4; seg++) {
      const u = seg / 4;
      const sx = vxBase + sway * u;
      const sy = u * vineLen;
      ctx.lineTo(sx, sy);

      const leafSide = (seg & 1) === 0 ? 1 : -1;
      ctx.fillStyle = rgbToCss(palette[4 + ((v + seg) & 2)], 0.80);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + leafSide * 13, sy - 4);
      ctx.lineTo(sx + leafSide * 18, sy + 5);
      ctx.lineTo(sx + leafSide * 5, sy + 7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();
  }

  // 12. Swarm of Chaotic Pixel Mouse Cursors Darting Across the Scene (from WannaCry!)
  for (let c = 0; c < 5; c++) {
    const curX = cx + Math.sin(timeSec * (2.1 + c * 0.35) + c * 1.7) * 220;
    const curY = CANVAS_H * 0.5 + Math.cos(timeSec * (1.8 + c * 0.45) + c * 2.1) * 115;
    ctx.fillStyle = rgbToCss(palette[7], 0.98);
    ctx.strokeStyle = rgbToCss(palette[0], 0.98);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(curX, curY);
    ctx.lineTo(curX, curY + 13);
    ctx.lineTo(curX + 4, curY + 9);
    ctx.lineTo(curX + 7, curY + 15);
    ctx.lineTo(curX + 9, curY + 13);
    ctx.lineTo(curX + 6, curY + 7);
    ctx.lineTo(curX + 10, curY + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 13A. Palette-Tinted Win95 `IMP_LYRICS.EXE` Dialog for `activeLyric` (Upper Center)
  const cleanLyric = (activeLyric || '').trim();
  if (cleanLyric.length > 0) {
    const lines = splitIntoBalancedLines(`♪ ${cleanLyric} ♪`, 38);
    const winW = Math.min(CANVAS_W - 80, Math.max(248, lines[0].length * 8.2 + 44));
    const winH = 26 + lines.length * 18 + 16;
    const winX = cx - winW * 0.5;
    const winY = Math.max(22, cropTopY + 10) + Math.sin(timeSec * 0.95) * 2.5;

    ctx.save();
    ctx.fillStyle = rgbToCss(palette[1], 0.94);
    ctx.fillRect(winX, winY, winW, winH);
    ctx.strokeStyle = rgbToCss(palette[7], 0.96);
    ctx.lineWidth = 1.6;
    ctx.strokeRect(winX, winY, winW, winH);

    const titleGrad = ctx.createLinearGradient(winX + 3, winY + 3, winX + winW - 3, winY + 3);
    titleGrad.addColorStop(0, rgbToCss(palette[3], 0.98));
    titleGrad.addColorStop(1, rgbToCss(palette[5], 0.98));
    ctx.fillStyle = titleGrad;
    ctx.fillRect(winX + 3, winY + 3, winW - 6, 16);

    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgbToCss(palette[7], 0.98);
    ctx.fillText('IMP_LYRICS.EXE', winX + 8, winY + 11);

    ctx.fillStyle = rgbToCss(palette[6], 0.95);
    ctx.fillRect(winX + winW - 17, winY + 5, 12, 12);

    ctx.fillStyle = rgbToCss(palette[0], 0.95);
    ctx.fillRect(winX + 6, winY + 22, winW - 12, winH - 28);

    ctx.textAlign = 'center';
    ctx.font = 'bold 12px "JetBrains Mono", "Fira Code", monospace';
    ctx.fillStyle = rgbToCss(palette[7], 0.98);
    for (let li = 0; li < lines.length; li++) {
      ctx.fillText(lines[li], cx, winY + 33 + li * 17);
    }
    ctx.restore();
  }

  // 13B. Y2K `AIM_95.EXE - @username` Instant Messenger Buddy Window for SC Comments
  if (activeComment && activeComment.username && activeComment.body) {
    const aimW = 248;
    const aimH = 44;
    const aimX = CANVAS_W - aimW - 18;
    const aimY = Math.min(CANVAS_H - aimH - 14, cropBottomY - aimH - 10);

    ctx.save();
    ctx.fillStyle = rgbToCss(palette[1], 0.94);
    ctx.fillRect(aimX, aimY, aimW, aimH);
    ctx.strokeStyle = rgbToCss(palette[7], 0.96);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(aimX, aimY, aimW, aimH);

    ctx.fillStyle = rgbToCss(palette[4], 0.96);
    ctx.fillRect(aimX + 2, aimY + 2, aimW - 4, 13);
    ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
    ctx.fillStyle = rgbToCss(palette[7], 0.98);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`AIM_95.EXE - @${activeComment.username}`, aimX + 6, aimY + 8.5);

    let textX = aimX + 10;
    if (commentAvatarImg) {
      ctx.drawImage(commentAvatarImg, aimX + 6, aimY + 18, 20, 20);
      textX = aimX + 32;
    }

    ctx.font = '700 10px "JetBrains Mono", monospace';
    ctx.fillStyle = rgbToCss(palette[7], 0.96);
    const maxBody = activeComment.body.trim().slice(0, 28);
    ctx.fillText(
      `“${maxBody}${activeComment.body.length > 28 ? '…' : ''}”`,
      textX,
      aimY + 28,
    );
    ctx.restore();
  }
}
