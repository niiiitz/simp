import {
  CANVAS_H,
  CANVAS_W,
  rgbToCss,
  splitIntoBalancedLines,
  type RgbTuple,
  type SceneRenderContext,
} from './types';

type CosmicPropKind = 'none' | 'planet' | 'spaceship' | 'cow';

/**
 * Draws a 3D Ringed Planet with proper back-ring / planet-sphere / front-ring occlusion
 * so the front half of the rings wraps cleanly across the front of the planet.
 */
function drawRingedPlanet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  timeSec: number,
  subBass: number,
  beat: number,
  sb: Float32Array,
  palette: RgbTuple[],
): void {
  const holeR = 32 + subBass * 6;
  const tilt = -0.26 + Math.sin(timeSec * 0.45) * 0.07;

  ctx.save();
  ctx.translate(x, y);

  // Subtle outer atmospheric glow
  const haloGrad = ctx.createRadialGradient(0, 0, holeR * 0.8, 0, 0, holeR * 2.5);
  haloGrad.addColorStop(0, rgbToCss(palette[6], 0.42 + beat * 0.18));
  haloGrad.addColorStop(0.5, rgbToCss(palette[4], 0.16));
  haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = haloGrad;
  ctx.beginPath();
  ctx.arc(0, 0, holeR * 2.5, 0, Math.PI * 2);
  ctx.fill();

  const drawRingArc = (startAngle: number, endAngle: number, isFront: boolean) => {
    ctx.save();
    ctx.rotate(tilt);
    for (let ring = 0; ring < 5; ring++) {
      const rx = holeR * (1.45 + ring * 0.36) + sb[ring * 2] * 7;
      const ry = rx * 0.28;
      const alpha = (isFront ? 0.92 : 0.55) - ring * 0.08;
      ctx.strokeStyle = rgbToCss(palette[7 - (ring & 3)], Math.max(0.2, alpha));
      ctx.lineWidth = (isFront ? 3.0 : 2.1) - ring * 0.25;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, startAngle, endAngle);
      ctx.stroke();
    }
    ctx.restore();
  };

  // 1. BACK HALF of the planetary rings (occluded behind the planet body)
  drawRingArc(Math.PI, Math.PI * 2, false);

  // 2. PLANET SPHERE (drawn over the back rings)
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, holeR, 0, Math.PI * 2);
  ctx.clip();

  const sphereGrad = ctx.createRadialGradient(
    -holeR * 0.35,
    -holeR * 0.35,
    holeR * 0.1,
    0,
    0,
    holeR * 1.05,
  );
  sphereGrad.addColorStop(0, rgbToCss(palette[7], 0.95));
  sphereGrad.addColorStop(0.45, rgbToCss(palette[5], 0.92));
  sphereGrad.addColorStop(0.82, rgbToCss(palette[2], 0.96));
  sphereGrad.addColorStop(1, '#04060e');
  ctx.fillStyle = sphereGrad;
  ctx.fillRect(-holeR, -holeR, holeR * 2, holeR * 2);

  // Subtle curved latitude cloud bands across the planet surface
  ctx.rotate(tilt * 0.5);
  for (let b = -2; b <= 2; b++) {
    const by = b * (holeR * 0.32);
    ctx.fillStyle =
      b & 1 ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(-holeR * 1.2, by - 3, holeR * 2.4, 5);
  }

  // Crescent night-side terminator shadow on the right edge
  const shadowGrad = ctx.createRadialGradient(
    -holeR * 0.4,
    -holeR * 0.2,
    holeR * 0.4,
    holeR * 0.35,
    holeR * 0.15,
    holeR * 1.1,
  );
  shadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  shadowGrad.addColorStop(0.65, 'rgba(0, 0, 0, 0.45)');
  shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0.88)');
  ctx.fillStyle = shadowGrad;
  ctx.fillRect(-holeR * 1.2, -holeR * 1.2, holeR * 2.4, holeR * 2.4);
  ctx.restore();

  // Crisp planet rim highlight
  ctx.strokeStyle = rgbToCss(palette[6], 0.75);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, holeR, 0, Math.PI * 2);
  ctx.stroke();

  // 3. FRONT HALF of the planetary rings (wrapping cleanly in front of the planet sphere!)
  drawRingArc(0, Math.PI, true);

  ctx.restore();
}

/**
 * Draws a retro 1950s Flash-Gordon / Tin-Toy Finned Rocket Spaceship at (x, y).
 */
function drawRetroSpaceship(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  timeSec: number,
  subBass: number,
  beat: number,
  palette: RgbTuple[],
): void {
  ctx.save();
  ctx.translate(x, y);
  const bankAngle = -0.35 + Math.sin(timeSec * 1.9) * 0.14 + beat * 0.06;
  ctx.rotate(bankAngle);
  const scale = 1.05 + subBass * 0.08;
  ctx.scale(scale, scale);

  // Audio-reactive rocket exhaust flame & sparks at tail (-46, 0)
  const flameLen = 22 + subBass * 28 + beat * 16 + Math.sin(timeSec * 28) * 5;
  const flameGrad = ctx.createLinearGradient(-34, 0, -34 - flameLen, 0);
  flameGrad.addColorStop(0, '#ffffff');
  flameGrad.addColorStop(0.3, '#fde047');
  flameGrad.addColorStop(0.7, '#f97316');
  flameGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
  ctx.fillStyle = flameGrad;
  ctx.beginPath();
  ctx.moveTo(-32, -7);
  ctx.quadraticCurveTo(-34 - flameLen * 0.6, -12, -34 - flameLen, 0);
  ctx.quadraticCurveTo(-34 - flameLen * 0.6, 12, -32, 7);
  ctx.closePath();
  ctx.fill();

  // Swept Crimson Tail Fins (Top & Bottom)
  ctx.fillStyle = '#ef4444';
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 1.3;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-12, dir * 10);
    ctx.lineTo(-34, dir * 26);
    ctx.lineTo(-38, dir * 24);
    ctx.lineTo(-28, dir * 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Brushed Silver Cigar Fuselage
  const bodyGrad = ctx.createLinearGradient(0, -16, 0, 16);
  bodyGrad.addColorStop(0, '#f8fafc');
  bodyGrad.addColorStop(0.45, '#94a3b8');
  bodyGrad.addColorStop(0.8, '#334155');
  bodyGrad.addColorStop(1, '#cbd5e1');
  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(42, 0);
  ctx.bezierCurveTo(24, -17, -18, -16, -34, -9);
  ctx.lineTo(-34, 9);
  ctx.bezierCurveTo(-18, 16, 24, 17, 42, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Red Nosecone Tip + Raygun Antenna Needle
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(42, 0);
  ctx.bezierCurveTo(24, -17, -18, -16, -34, -9);
  ctx.lineTo(-34, 9);
  ctx.bezierCurveTo(-18, 16, 24, 17, 42, 0);
  ctx.clip();
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(20, -20, 26, 40);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(16, -20, 4, 40);
  ctx.restore();

  // Nose Antenna Spike
  ctx.strokeStyle = '#fef08a';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(42, 0);
  ctx.lineTo(54, 0);
  ctx.stroke();
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.arc(54, 0, 2.4, 0, Math.PI * 2);
  ctx.fill();

  // Glowing Cyan Porthole Windows
  for (let w = 0; w < 2; w++) {
    const wx = 4 - w * 16;
    ctx.fillStyle = rgbToCss(palette[6], 0.95);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(wx, -1, w === 0 ? 5.8 : 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draws an Abducted Floating Holstein Dairy Cow tumbling gently inside the UFO tractor beam.
 */
function drawAbductedCow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  timeSec: number,
  subBass: number,
  beat: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  // Gentle zero-gravity tumble in the tractor beam
  const tumble = Math.sin(timeSec * 1.15) * 0.28 + Math.cos(timeSec * 0.6) * 0.12;
  ctx.rotate(tumble);
  const scale = 1.08 + subBass * 0.08 + beat * 0.04;
  ctx.scale(scale, scale);

  // Swishing Tail
  const tailWag = Math.sin(timeSec * 4.5) * 6;
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-26, -4);
  ctx.quadraticCurveTo(-36, -2 + tailWag * 0.5, -38, 6 + tailWag);
  ctx.stroke();
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(-38, 6 + tailWag, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // Back Legs (dangling in zero-G)
  const legKick = Math.sin(timeSec * 3.8) * 3.5;
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 4.2;
  ctx.lineCap = 'round';
  const drawLeg = (lx: number, ly: number, dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + dx, ly + dy);
    ctx.stroke();
    // Dark hoof
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(lx + dx, ly + dy, 2.8, 0, Math.PI * 2);
    ctx.fill();
  };
  drawLeg(-18, 10, -4 - legKick * 0.4, 14 + legKick * 0.3);
  drawLeg(12, 10, 2 + legKick * 0.4, 14 - legKick * 0.3);

  // Pink Udder under belly
  ctx.fillStyle = '#f472b6';
  ctx.beginPath();
  ctx.ellipse(-8, 13, 7.5, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rounded White Cow Torso
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(-27, -14, 48, 26, 12);
  ctx.fill();
  ctx.stroke();

  // Classic Black Holstein Cow Spots (clipped inside torso)
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-27, -14, 48, 26, 12);
  ctx.clip();
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.ellipse(-14, -7, 10, 7, 0.3, 0, Math.PI * 2);
  ctx.ellipse(3, 2, 9, 8, -0.2, 0, Math.PI * 2);
  ctx.ellipse(-4, -12, 6, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Foreground Legs
  drawLeg(-12, 11, -1 + legKick * 0.5, 15);
  drawLeg(17, 11, 5 - legKick * 0.5, 14);

  // Golden Cowbell Collar around neck
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(16, -12);
  ctx.lineTo(22, 6);
  ctx.stroke();
  ctx.fillStyle = '#facc15';
  ctx.strokeStyle = '#ca8a04';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(21, 9, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Cow Head, Horns, Ears & Big Pink Muzzle
  ctx.save();
  ctx.translate(24, -6);

  // Little Curved Cream Horns
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-4, -10);
  ctx.quadraticCurveTo(-8, -17, -3, -19);
  ctx.moveTo(6, -10);
  ctx.quadraticCurveTo(10, -17, 6, -19);
  ctx.stroke();

  // Floppy Ears
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.ellipse(-9, -7, 5, 2.6, -0.4, 0, Math.PI * 2);
  ctx.ellipse(10, -7, 5, 2.6, 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Head Base
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-8, -12, 18, 17, 7);
  ctx.fill();
  ctx.stroke();

  // Wide Surprised Eyes
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(-2.5, -5, 2.1, 0, Math.PI * 2);
  ctx.arc(5.5, -5, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(-3, -5.6, 0.8, 0, Math.PI * 2);
  ctx.arc(5, -5.6, 0.8, 0, Math.PI * 2);
  ctx.fill();

  // Big Pink Snout / Muzzle + Nostrils
  ctx.fillStyle = '#f9a8d4';
  ctx.strokeStyle = '#db2777';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(2, 3, 9.5, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#831843';
  ctx.beginPath();
  ctx.arc(-2, 3, 1.4, 0, Math.PI * 2);
  ctx.arc(6, 3, 1.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.restore();
}

/**
 * Draws the Monty-Python / Stagehand Cutout Hand & Sleeve reaching in from the right edge
 * to place or swap the center stage prop at (handX, handY).
 */
function drawStagehandArm(
  ctx: CanvasRenderingContext2D,
  handX: number,
  handY: number,
  pinchClosed: number,
): void {
  ctx.save();
  const edgeX = CANVAS_W + 40;
  const armY = handY - 6;

  // 1. Dark Theatrical Suit Sleeve extending from right screen edge
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(handX + 34, armY - 19);
  ctx.lineTo(edgeX, armY - 30);
  ctx.lineTo(edgeX, armY + 26);
  ctx.lineTo(handX + 34, armY + 19);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 2. Crisp White Dress Shirt Cuff + Gold Cufflink
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(handX + 22, armY - 17, 16, 34, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.arc(handX + 30, armY + 9, 2.8, 0, Math.PI * 2);
  ctx.fill();

  // 3. Illustrated Stagehand Hand (Palm + Articulated Thumb & Fingers)
  const skinFill = '#fcd34d';
  const skinStroke = '#78350f';
  ctx.fillStyle = skinFill;
  ctx.strokeStyle = skinStroke;
  ctx.lineWidth = 1.6;

  // Palm & Back of Hand
  ctx.beginPath();
  ctx.roundRect(handX - 4, armY - 14, 28, 26, 9);
  ctx.fill();
  ctx.stroke();

  // Curled Top Fingers pinching the prop from above
  const fingerCurl = pinchClosed * 5;
  for (let f = 0; f < 3; f++) {
    const fy = armY - 13 + f * 5.5;
    ctx.beginPath();
    ctx.roundRect(handX - 20 + f * 2, fy + fingerCurl * 0.4, 20, 6.5, 3.2);
    ctx.fill();
    ctx.stroke();
  }

  // Articulated Opposing Thumb underneath
  ctx.beginPath();
  ctx.save();
  ctx.translate(handX + 2, armY + 10);
  ctx.rotate(0.32 - pinchClosed * 0.25);
  ctx.roundRect(-18, -3, 20, 7.5, 3.8);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

/**
 * Scene `c` — Cosmic Warp & 50s Saucer (High-DPI Canvas2D)
 * - Starts (`0%–25%`) with the glowing Light Swirl & Orbiting Light Dots + 3D Starfield
 * - At ~25%: A giant Stagehand Hand reaches in from the side and places a 3D Ringed Planet (with front/back ring occlusion)
 * - At ~50%: The Stagehand Hand reaches back in and swaps the Planet out for a retro 1950s Finned Rocket Spaceship
 * - At ~75%: The Stagehand Hand swaps the Spaceship out for an Abducted Floating Holstein Cow for the final quarter!
 */
export function renderCosmosScene(s: SceneRenderContext): void {
  const {
    ctx,
    timeSec,
    playheadRatio,
    beat,
    subBass,
    highEnergy,
    drop,
    sb,
    palette,
    artCanvas,
    artReady,
    activeLyric,
    activeComment,
    commentAvatarImg,
  } = s;

  const cx = CANVAS_W * 0.5;
  const cy = CANVAS_H * 0.52;

  // Use live track progress (0.0 .. 1.0), falling back to a 90s cycle only if duration is unknown
  const prog =
    playheadRatio > 0.001 ? playheadRatio : (timeSec % 90.0) / 90.0;

  // 1. Pure #000000 OLED Deep Space Abyss
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 2. 3D Perspective Starfield (84 stars, steady forward velocity so stars never jump on bass hits)
  const steadyWarp = 0.32;
  ctx.save();
  for (let i = 0; i < 84; i++) {
    const angle = i * 2.39996 + timeSec * 0.03;
    const radBase = 0.14 + ((i * 19) % 83) / 83;
    const z = Math.max(0.08, 1.5 - ((timeSec * steadyWarp + i * 0.037) % 1.42));
    const projScale = 240 / z;
    const sx = cx + Math.cos(angle) * radBase * projScale;
    const sy = cy + Math.sin(angle) * radBase * projScale * 0.68;

    if (sx < -20 || sx > CANVAS_W + 20 || sy < -20 || sy > CANVAS_H + 20) continue;

    const tailZ =
      z + (drop > 0.2 ? 0.11 + subBass * 0.07 + drop * 0.09 : 0.038 + subBass * 0.04);
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

  // 3. Crisp Glowing Light Swirl & Orbiting Light Dots (Always active background layer, no muddy fog puffs)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const pulseR = 46 + Math.sin(timeSec * 1.4) * 14 + subBass * 24;
  const coreGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, pulseR * 2.1);
  coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  coreGrad.addColorStop(0.24, rgbToCss(palette[7], 0.45));
  coreGrad.addColorStop(0.58, rgbToCss(palette[5], 0.18 + beat * 0.15));
  coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, pulseR * 2.1, 0, Math.PI * 2);
  ctx.fill();

  for (let p = 0; p < 38; p++) {
    const ang = (p / 38) * Math.PI * 2 + timeSec * 0.38 + (p % 3) * 0.2;
    const dist = ((p * 19 + timeSec * 42) % 185) + sb[p & 15] * 18;
    const px = cx + Math.cos(ang) * dist;
    const py = cy + Math.sin(ang) * dist * 0.65;
    ctx.fillStyle = rgbToCss(palette[3 + (p & 3)], 0.78);
    ctx.beginPath();
    ctx.arc(px, py, 2.0 + sb[p & 15] * 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 4. Campy 1950s Plan-9 Metallic Flying Saucer Dangling on a Visible Pendulum String
  const anchorX = cx + Math.sin(timeSec * 0.28) * 95;
  const anchorY = -8;
  const stringLen = 100 + Math.sin(timeSec * 0.9) * 12 - beat * 6;
  const swingAngle =
    Math.sin(timeSec * 1.65) * (0.20 + subBass * 0.12) +
    Math.cos(timeSec * 3.1) * 0.05;
  const ufoX = anchorX + Math.sin(swingAngle) * stringLen;
  const ufoY = anchorY + Math.cos(swingAngle) * stringLen;
  const ufoTilt =
    -swingAngle * 0.75 + Math.sin(timeSec * 5.2) * (0.05 + highEnergy * 0.06);

  const cleanLyric = (activeLyric || '').trim();
  const hasComment = Boolean(activeComment && activeComment.username && activeComment.body);
  const beamActive = prog >= 0.22 || cleanLyric.length > 0 || hasComment || beat > 0.38;

  // 5. Volumetric Tractor-Beam Cone (`lighter`)
  if (beamActive) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beamBottomY = CANVAS_H - 18;
    const beamSpread = 135 + subBass * 35;
    const beamGrad = ctx.createLinearGradient(ufoX, ufoY + 10, cx, beamBottomY);
    const beamColor = palette[6] || [56, 189, 248];
    beamGrad.addColorStop(0, rgbToCss(beamColor, 0.50 + beat * 0.22));
    beamGrad.addColorStop(0.55, rgbToCss(palette[4], 0.20 + subBass * 0.12));
    beamGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(ufoX - 16, ufoY + 10);
    ctx.lineTo(ufoX + 16, ufoY + 10);
    ctx.lineTo(cx + beamSpread, beamBottomY);
    ctx.lineTo(cx - beamSpread, beamBottomY);
    ctx.closePath();
    ctx.fill();

    for (let r = 0; r < 5; r++) {
      const ringProg = (timeSec * 0.72 + r * 0.2) % 1;
      const ry = ufoY + 18 + ringProg * (beamBottomY - ufoY - 36);
      const rx = 18 + ringProg * (beamSpread * 0.82);
      const ringCenter = ufoX + (cx - ufoX) * ringProg;
      ctx.strokeStyle = rgbToCss(palette[7], (1 - ringProg) * 0.42);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(ringCenter, ry, rx, rx * 0.18, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 6. Stagehand Prop Placement & Swap Choreography at ~25%, ~50%, and ~75% of the Track!
  //    - 0.00 .. 0.25: Light Swirl & Dots only ('none')
  //    - 0.25 .. 0.50: 3D Ringed Planet ('planet')
  //    - 0.50 .. 0.75: Retro 1950s Rocket Spaceship ('spaceship')
  //    - 0.75 .. 1.00: Abducted Floating Holstein Cow ('cow')
  const hoverBobY = cy + 16 + Math.sin(timeSec * 1.7) * 6;
  const offRightX = CANVAS_W + 95;
  const swapHalfWindow = 0.022; // ~4.4% total window for the hand reach-in & swap

  let activeProp: CosmicPropKind = 'none';
  let propX = cx;
  const propY = hoverBobY;
  let showHand = false;
  let handX = offRightX;
  let handPinch = 1;

  const evalSwap = (
    milestone: number,
    prevProp: CosmicPropKind,
    nextProp: CosmicPropKind,
  ): boolean => {
    const d = prog - milestone;
    if (Math.abs(d) > swapHalfWindow) return false;
    showHand = true;
    if (prevProp === 'none') {
      // At 25%: Hand brings the Planet in from off-screen right (milestone - w .. milestone),
      // releases it at center, and retracts (milestone .. milestone + w)
      if (d < 0) {
        const u = (d + swapHalfWindow) / swapHalfWindow; // 0 -> 1 approaching center
        const ease = 1 - Math.pow(1 - u, 2.2);
        activeProp = nextProp;
        propX = offRightX + (cx - offRightX) * ease;
        handX = propX + 24;
        handPinch = 1;
      } else {
        const u = d / swapHalfWindow; // 0 -> 1 retracting back to right
        const ease = Math.pow(u, 1.8);
        activeProp = nextProp;
        propX = cx;
        handX = cx + 24 + (offRightX - (cx + 24)) * ease;
        handPinch = Math.max(0, 1 - u * 2.5);
      }
    } else {
      // At 50% & 75%: Hand reaches in & pulls out prevProp (d < 0), then brings in nextProp & retracts (d >= 0)
      if (d < 0) {
        const u = (d + swapHalfWindow) / swapHalfWindow; // 0 -> 1
        if (u < 0.5) {
          // Hand reaches in empty toward center prop
          const reach = u * 2;
          activeProp = prevProp;
          propX = cx;
          handX = offRightX + (cx + 24 - offRightX) * reach;
          handPinch = reach;
        } else {
          // Hand pulls old prop off-screen to the right
          const pull = (u - 0.5) * 2;
          activeProp = prevProp;
          propX = cx + (offRightX - cx) * pull;
          handX = propX + 24;
          handPinch = 1;
        }
      } else {
        const u = d / swapHalfWindow; // 0 -> 1
        if (u < 0.55) {
          // Hand brings new prop in from right to center
          const push = u / 0.55;
          const ease = 1 - Math.pow(1 - push, 2);
          activeProp = nextProp;
          propX = offRightX + (cx - offRightX) * ease;
          handX = propX + 24;
          handPinch = 1;
        } else {
          // Hand releases new prop at center and retracts off-screen
          const ret = (u - 0.55) / 0.45;
          activeProp = nextProp;
          propX = cx;
          handX = cx + 24 + (offRightX - (cx + 24)) * (ret * ret);
          handPinch = Math.max(0, 1 - ret * 2.2);
        }
      }
    }
    return true;
  };

  if (
    !evalSwap(0.25, 'none', 'planet') &&
    !evalSwap(0.5, 'planet', 'spaceship') &&
    !evalSwap(0.75, 'spaceship', 'cow')
  ) {
    if (prog < 0.25) activeProp = 'none';
    else if (prog < 0.5) activeProp = 'planet';
    else if (prog < 0.75) activeProp = 'spaceship';
    else activeProp = 'cow';
  }

  if (activeProp === 'planet') {
    drawRingedPlanet(ctx, propX, propY, timeSec, subBass, beat, sb, palette);
  } else if (activeProp === 'spaceship') {
    drawRetroSpaceship(ctx, propX, propY, timeSec, subBass, beat, palette);
  } else if (activeProp === 'cow') {
    drawAbductedCow(ctx, propX, propY, timeSec, subBass, beat);
  }

  if (showHand) {
    drawStagehandArm(ctx, handX, propY, handPinch);
  }

  // 7. Draw Visible Pendulum String & Raytraced 1950s Plan-9 Flying Saucer
  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.72)';
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY);
  ctx.lineTo(ufoX, ufoY - 18);
  ctx.stroke();

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

  // 8A. Suspended Holographic Lyrics Inside the Tractor Beam
  if (cleanLyric.length > 0) {
    const lines = splitIntoBalancedLines(cleanLyric, 38);
    const hoverY = CANVAS_H - 58 + Math.sin(timeSec * 1.8) * 3;
    const hoverX = ufoX * 0.25 + cx * 0.75;

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

  // 8B. Separate Diegetic UFO Orbital Scanner Transmission Pod for `@username` Comments
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
