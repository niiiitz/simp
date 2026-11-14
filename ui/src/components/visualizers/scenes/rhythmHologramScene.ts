import { snapPs1 } from './lowPoly3d';
import {
  CANVAS_H,
  CANVAS_W,
  drawMicroPartyCommentPill,
  lerpRgb,
  rgbToCss,
  type SceneRenderContext,
} from './types';

const ART_SAMPLE_SIZE = 128;

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

let lastVestaboardLyric = '';
let vestaboardRowCycle = 0;
let lastLyricChangeAt = -10;

/**
 * Word-wraps uppercase text into balanced Vestaboard rows of at most `maxCols` characters.
 */
function wrapVestaboardLines(raw: string, maxCols: number): string[] {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9 !?'"&#.,-]/g, '')
    .trim();
  if (!cleaned) return [];
  const words = cleaned.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > maxCols) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += maxCols) {
        lines.push(word.slice(i, i + maxCols));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCols) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Draws a 4-panel arcade dance arrow (Left: 0, Down: 1, Up: 2, Right: 3)
 * centered at `(x, y)` with radius `r`.
 */
function drawStepArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  dir: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  const rot =
    dir === 0
      ? -Math.PI * 0.5
      : dir === 1
        ? Math.PI
        : dir === 2
          ? 0
          : Math.PI * 0.5;
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.85, -r * 0.1);
  ctx.lineTo(r * 0.36, -r * 0.1);
  ctx.lineTo(r * 0.36, r * 0.85);
  ctx.lineTo(-r * 0.36, r * 0.85);
  ctx.lineTo(-r * 0.36, -r * 0.1);
  ctx.lineTo(-r * 0.85, -r * 0.1);
  ctx.closePath();
  ctx.restore();
}

let lastDropTriggerAt = -20;
let lastDropHandsUpUntil = -10;

/**
 * Mode 19: Rhythm Stage [Hologram Band & Vestaboard Jumbotron]
 * - Restores the full V1 Micro-Party concert arena: Mode-7 neon floor, 7 volumetric concert
 *   laser cones, Left & Right 4-lane DDR step-arrow highways, CO2 cryo-fog jets, and
 *   thumping dual-woofer Concert Speaker Towers directly flanking the band
 * - Center-Stage Jumbotron rendered with a mechanical "Vestaboard" split-flap tile matrix
 *   that ripples/flips quantized album-art color flaps + split-flap character rows
 * - Hologram Band on center stage deck: dancing articulated lead singer with a 3D album-art
 *   monitor head flanked by 2 hologram bandmates (Keytar & Drums)
 * - Crowd Choreography: Crowd silhouettes stay planted and smoothly sway their hands/glowsticks
 *   side-to-side during normal playback; when the beat drops (with cooldown), they thrust
 *   both hands straight up and jump together for ~2.8 seconds!
 */
export function renderRhythmHologramScene(s: SceneRenderContext): void {
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
    artRgb,
    artReady,
    activeLyric,
    activeComment,
    commentAvatarImg,
    cropTopY,
    cropBottomY,
  } = s;

  // Handle track seek / restart
  if (timeSec < lastDropTriggerAt - 5) {
    lastDropTriggerAt = -20;
    lastDropHandsUpUntil = -10;
  }
  // Trigger beat-drop crowd jump + hands-up only on genuine drops with a 11s cooldown
  // so the crowd sways naturally most of the time and jumps specifically when the beat drops!
  if (
    (drop > 0.45 || (drop > 0.28 && beat > 0.82 && subBass > 0.72)) &&
    timeSec - lastDropTriggerAt > 11.0
  ) {
    lastDropTriggerAt = timeSec;
    lastDropHandsUpUntil = timeSec + 2.8;
  }
  const handsUpActive = timeSec < lastDropHandsUpUntil;

  // 1. Arena Backdrop & Stage Horizon Geometry (Restored from V1 Micro-Party)
  const cx = CANVAS_W * 0.5;
  const horizonY = Math.round(CANVAS_H * 0.47);
  const beatHz = Math.max(1.2, Math.min(3.4, (bpm || 120) / 60));

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Subtle radial stage haze above the horizon
  const hazeGrad = ctx.createRadialGradient(
    cx,
    horizonY,
    12,
    cx,
    horizonY - 40,
    CANVAS_W * 0.62,
  );
  hazeGrad.addColorStop(0, rgbToCss(palette[3], 0.34 + beat * 0.16 + drop * 0.18));
  hazeGrad.addColorStop(0.55, rgbToCss(palette[1], 0.16 + subBass * 0.1));
  hazeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = hazeGrad;
  ctx.fillRect(0, 0, CANVAS_W, horizonY + 24);

  // 2. Mode-7 Perspective Neon Stage Floor (Restored from V1 Micro-Party)
  const floorRows = 10;
  const floorCols = 14;
  const scrollPhase = (timeSec * beatHz * 0.85) % 1;

  ctx.save();
  for (let r = 0; r < floorRows; r++) {
    const t0 = Math.pow((r + scrollPhase) / floorRows, 1.85);
    const t1 = Math.pow((r + 1 + scrollPhase) / floorRows, 1.85);
    const y0 = horizonY + t0 * (CANVAS_H - horizonY);
    const y1 = horizonY + t1 * (CANVAS_H - horizonY);
    const spread0 = 0.28 + t0 * 1.35;
    const spread1 = 0.28 + t1 * 1.35;

    for (let c = 0; c < floorCols; c++) {
      const nx0 = (c / floorCols - 0.5) * 2;
      const nx1 = ((c + 1) / floorCols - 0.5) * 2;

      const x00 = cx + nx0 * (CANVAS_W * 0.58) * spread0;
      const x10 = cx + nx1 * (CANVAS_W * 0.58) * spread0;
      const x01 = cx + nx0 * (CANVAS_W * 0.58) * spread1;
      const x11 = cx + nx1 * (CANVAS_W * 0.58) * spread1;

      const bandIdx = (c + r) & 15;
      const bandEnergy = sb[bandIdx];
      const checker = (c + r + Math.floor(timeSec * beatHz)) & 1;
      const tileColor = checker
        ? lerpRgb(palette[2], palette[5], bandEnergy)
        : lerpRgb(palette[1], palette[4], bandEnergy * 0.7);
      const tileAlpha =
        (0.14 + bandEnergy * 0.36 + (checker ? beat * 0.14 : 0)) *
        Math.min(1, t1 * 1.6);

      ctx.fillStyle = rgbToCss(tileColor, tileAlpha);
      ctx.beginPath();
      ctx.moveTo(x00, y0);
      ctx.lineTo(x10, y0);
      ctx.lineTo(x11, y1);
      ctx.lineTo(x01, y1);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = rgbToCss(palette[5], 0.18 + t1 * 0.28 + beat * 0.12);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }
  ctx.restore();

  // Horizon stage lip beam
  ctx.strokeStyle = rgbToCss(palette[6], 0.72 + beat * 0.25);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(CANVAS_W, horizonY);
  ctx.stroke();

  // 3. Stage-Center "Vestaboard" Split-Flap Jumbotron (Sole Lyrics Container!) + Flanking Speaker Towers
  const jumboPulse = 1 + subBass * 0.04 + beat * 0.03;
  const jumboW = Math.round(236 * jumboPulse);
  const jumboH = Math.round(128 * jumboPulse);
  const jumboX = Math.round(cx - jumboW * 0.5);
  const jumboY = Math.max(
    Math.round(cropTopY + 10),
    Math.round(horizonY - jumboH - 18),
  );

  // Truss support cables from top of frame to the Vestaboard Jumbotron
  ctx.strokeStyle = rgbToCss(palette[2], 0.65);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(jumboX + 18, 0);
  ctx.lineTo(jumboX + 18, jumboY);
  ctx.moveTo(jumboX + jumboW - 18, 0);
  ctx.lineTo(jumboX + jumboW - 18, jumboY);
  ctx.stroke();

  // Outer Vestaboard aluminum/matte-black frame
  ctx.save();
  ctx.fillStyle = '#07090e';
  ctx.strokeStyle = rgbToCss(palette[5], 0.85 + beat * 0.15);
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.roundRect(jumboX - 5, jumboY - 5, jumboW + 10, jumboH + 10, 7);
  ctx.fill();
  ctx.stroke();

  // Mechanical Vestaboard Split-Flap Tile Grid (`22 cols × 9 rows`)
  const vbCols = 22;
  const vbRows = 9;
  const padX = 5;
  const padY = 5;
  const cellW = (jumboW - padX * 2) / vbCols;
  const cellH = (jumboH - padY * 2) / vbRows;

  // Track lyric changes so consecutive lyrics cycle through different vertical row bands on the Vestaboard
  const cleanLyric = (activeLyric || '').trim();
  const activeBoardSource =
    cleanLyric.length > 0
      ? cleanLyric
      : handsUpActive
        ? 'PUT YOUR HANDS UP!'
        : beat > 0.42 || drop > 0.3
          ? MICRO_PROMPTS[Math.floor(timeSec * 0.65) % MICRO_PROMPTS.length]
          : '';

  if (timeSec < lastLyricChangeAt - 5) {
    lastLyricChangeAt = -10;
  }
  if (activeBoardSource && activeBoardSource !== lastVestaboardLyric) {
    lastVestaboardLyric = activeBoardSource;
    vestaboardRowCycle = (vestaboardRowCycle + 1) % 3;
    lastLyricChangeAt = timeSec;
  }

  const allWrappedLines = wrapVestaboardLines(activeBoardSource, vbCols);
  // Display up to 3 wrapped lines at a time; if a lyric has > 3 lines, page through them smoothly
  const maxVisibleLines = 3;
  const pageCount = Math.max(1, Math.ceil(allWrappedLines.length / maxVisibleLines));
  const currentPage =
    pageCount > 1
      ? Math.floor(((timeSec - lastLyricChangeAt) / 2.2) % pageCount)
      : 0;
  const visibleLines = allWrappedLines.slice(
    currentPage * maxVisibleLines,
    (currentPage + 1) * maxVisibleLines,
  );

  // Cycle the starting row across the upper rows (`0`, `1`, `2`) so lyrics shift across rows on the board
  // while staying 100% above the hologram dancers' heads (`rows 0..3`)
  const maxStartRow = Math.max(0, 4 - visibleLines.length);
  const startTextRow = Math.min(maxStartRow, vestaboardRowCycle);

  // Diagonal split-flap mechanical clack wave + rapid clack burst when a new lyric arrives
  const timeSinceLyricChange = timeSec - lastLyricChangeAt;
  const lyricClackWave =
    timeSinceLyricChange >= 0 && timeSinceLyricChange < 0.65
      ? (timeSinceLyricChange / 0.65) * (vbCols + vbRows)
      : -99;
  const ambientWavePos = ((timeSec * 8.5) % (vbCols + vbRows + 10)) - 5;

  ctx.font = `800 ${Math.max(8, Math.floor(cellH * 0.72))}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let r = 0; r < vbRows; r++) {
    const lineIdx = r - startTextRow;
    const rowText =
      lineIdx >= 0 && lineIdx < visibleLines.length ? visibleLines[lineIdx] : null;
    const textStartCol =
      rowText !== null
        ? Math.max(0, Math.floor((vbCols - rowText.length) * 0.5))
        : 999;

    for (let c = 0; c < vbCols; c++) {
      const tx = jumboX + padX + c * cellW + 0.75;
      const ty = jumboY + padY + r * cellH + 0.75;
      const tw = cellW - 1.5;
      const th = cellH - 1.5;

      // Sample corresponding album art color for this split-flap module
      let flapR = palette[2][0];
      let flapG = palette[2][1];
      let flapB = palette[2][2];
      if (artReady && artRgb) {
        const ax = Math.min(
          ART_SAMPLE_SIZE - 1,
          Math.floor(((c + 0.5) / vbCols) * ART_SAMPLE_SIZE),
        );
        const ay = Math.min(
          ART_SAMPLE_SIZE - 1,
          Math.floor(((r + 0.5) / vbRows) * ART_SAMPLE_SIZE),
        );
        const idx = (ay * ART_SAMPLE_SIZE + ax) * 3;
        flapR = artRgb[idx];
        flapG = artRgb[idx + 1];
        flapB = artRgb[idx + 2];
      } else {
        const pal = palette[(c + r) % 7];
        flapR = pal[0];
        flapG = pal[1];
        flapB = pal[2];
      }

      // Check if this cell is part of one of the active multi-row split-flap lyric lines
      const charIdx = c - textStartCol;
      const isActiveLyricSpan =
        rowText !== null && charIdx >= 0 && charIdx < rowText.length;
      const flapChar = isActiveLyricSpan ? rowText[charIdx] : '';

      // Mechanical flap flip animation as `ambientWavePos` or `lyricClackWave` crosses `(c + r)`
      const distAmbient = Math.abs(c + r - ambientWavePos);
      const distLyricClack = Math.abs(c + r * 2 - lyricClackWave);
      const isFlipping =
        distAmbient < 1.35 || (isActiveLyricSpan && distLyricClack < 2.2);
      const flipCos = isFlipping
        ? Math.max(
            0.18,
            Math.abs(
              Math.cos(
                Math.min(distAmbient, distLyricClack) * Math.PI * 0.65,
              ),
            ),
          )
        : 1.0;

      // Recessed dark split-flap slot socket
      ctx.fillStyle = '#04060a';
      ctx.fillRect(tx, ty, tw, th);

      const flapH = th * flipCos;
      const flapY = ty + (th - flapH) * 0.5;

      // Top half of split-flap card (matte charcoal for active lyric span so characters pop cleanly!)
      if (isActiveLyricSpan) {
        ctx.fillStyle =
          flapChar !== ' '
            ? handsUpActive
              ? rgbToCss(palette[6], 0.96)
              : '#111622'
            : '#0a0d15';
      } else {
        ctx.fillStyle = `rgb(${Math.min(255, flapR + 14)}, ${Math.min(255, flapG + 14)}, ${Math.min(255, flapB + 14)})`;
      }
      ctx.fillRect(tx, flapY, tw, flapH * 0.5);

      // Bottom half of split-flap card
      if (isActiveLyricSpan) {
        ctx.fillStyle =
          flapChar !== ' '
            ? handsUpActive
              ? rgbToCss(palette[5], 0.96)
              : '#0b0e17'
            : '#070910';
      } else {
        ctx.fillStyle = `rgb(${Math.max(0, flapR - 12)}, ${Math.max(0, flapG - 12)}, ${Math.max(0, flapB - 12)})`;
      }
      ctx.fillRect(tx, flapY + flapH * 0.5, tw, flapH * 0.5);

      // Character glyph on the split-flap module
      if (flapChar && flapChar !== ' ') {
        ctx.save();
        ctx.translate(tx + tw * 0.5, ty + th * 0.5);
        ctx.scale(1, flipCos);
        ctx.fillStyle = handsUpActive ? '#05070c' : '#f8fafc';
        ctx.fillText(flapChar, 0, 0.5);
        ctx.restore();
      }

      // Signature Vestaboard horizontal center split-flap hinge line
      const midY = Math.round(ty + th * 0.5) + 0.5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.88)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(tx, midY);
      ctx.lineTo(tx + tw, midY);
      ctx.stroke();

      // Subtle border highlight on active lyric letter tiles
      if (isActiveLyricSpan && flapChar !== ' ') {
        ctx.strokeStyle = rgbToCss(palette[6], 0.42);
        ctx.lineWidth = 0.7;
        ctx.strokeRect(tx, flapY, tw, flapH);
      }

      // Flash highlight on the flap edge while actively flipping
      if (isFlipping) {
        ctx.fillStyle = rgbToCss(palette[7], 0.4);
        ctx.fillRect(tx, flapY, tw, 1.5);
      }
    }
  }
  ctx.restore();

  // Flanking Thumping Concert Speaker Towers (Restored from V1 Micro-Party right beside the stage!)
  for (const side of [-1, 1]) {
    const spkX = cx + side * (jumboW * 0.5 + 36);
    const spkY = horizonY - 46;
    const spkW = 36;
    const spkH = 84;
    const tilt = side * (0.04 + subBass * 0.05);

    ctx.save();
    ctx.translate(spkX, spkY);
    ctx.rotate(tilt);

    // Speaker cabinet
    ctx.fillStyle = '#090c14';
    ctx.strokeStyle = rgbToCss(palette[4], 0.8 + subBass * 0.2);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-spkW * 0.5, -spkH * 0.5, spkW, spkH, 5);
    ctx.fill();
    ctx.stroke();

    // Dual pulsing woofer cones (upper mid-high driver + lower sub-bass driver)
    const drivers = [
      { cy: -spkH * 0.23, baseR: 9.5, energy: midEnergy + highEnergy * 0.5 },
      { cy: spkH * 0.21, baseR: 12.0, energy: subBass + beat * 0.5 },
    ];
    for (const d of drivers) {
      const coneR = d.baseR * (1 + d.energy * 0.26);
      ctx.fillStyle = rgbToCss(palette[1], 0.95);
      ctx.strokeStyle = rgbToCss(palette[6], 0.75 + d.energy * 0.25);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, d.cy, coneR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Inner dust cap
      ctx.fillStyle = rgbToCss(palette[5], 0.85);
      ctx.beginPath();
      ctx.arc(0, d.cy, coneR * 0.38, 0, Math.PI * 2);
      ctx.fill();

      // Expanding sonic pressure ring on heavy bass hits
      if (subBass > 0.32) {
        const ringR = coneR + ((timeSec * 52) % 18);
        ctx.strokeStyle = rgbToCss(palette[7], (1 - (ringR - coneR) / 18) * 0.58);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(0, d.cy, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 4. Volumetric Concert Laser Cones (`lighter` blend mode from V1)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const laserCount = 7;
  for (let i = 0; i < laserCount; i++) {
    const frac = i / (laserCount - 1) - 0.5;
    const originX = cx + frac * (CANVAS_W * 0.72);
    const originY = Math.max(8, cropTopY - 6);
    const sweepAngle =
      Math.sin(timeSec * (1.4 + (i % 3) * 0.45) + i * 1.1) * 0.42 +
      frac * 0.35;
    const beamLen = CANVAS_H * 0.95;
    const spread = 16 + sb[(i * 2) & 15] * 28 + (handsUpActive ? 14 : 0);

    const endX = originX + Math.sin(sweepAngle) * beamLen;
    const endY = originY + Math.cos(sweepAngle) * beamLen;

    const laserColor = palette[3 + (i % 4)];
    const laserAlpha = 0.06 + sb[(i * 2) & 15] * 0.14 + beat * 0.07;

    const beamGrad = ctx.createLinearGradient(originX, originY, endX, endY);
    beamGrad.addColorStop(0, rgbToCss(laserColor, laserAlpha * 1.8));
    beamGrad.addColorStop(0.6, rgbToCss(laserColor, laserAlpha));
    beamGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(originX - 2, originY);
    ctx.lineTo(endX - spread, endY);
    ctx.lineTo(endX + spread, endY);
    ctx.lineTo(originX + 2, originY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 5. Center Stage Deck: Hologram Projector Ring & Scanline-Hologram Band
  const pedY = horizonY + 24;
  ctx.save();
  ctx.strokeStyle = rgbToCss(palette[6], 0.88);
  ctx.fillStyle = rgbToCss(palette[2], 0.58);
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const px = cx + Math.cos(a) * 116;
    const py = pedY + Math.sin(a) * 18;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const drawHologramBandmate = (
    bx: number,
    by: number,
    role: 'lead' | 'keytar' | 'drums',
  ) => {
    const dancePhase = timeSec * beatHz * Math.PI;
    const hipSway = snapPs1(
      Math.sin(dancePhase + (role === 'lead' ? 0 : 1.5)) *
        (role === 'lead' ? 10 : 7),
      1,
    );
    const bounce = snapPs1(
      Math.abs(Math.cos(dancePhase)) *
        (6 + subBass * 10 + (handsUpActive ? 8 : 0)),
      1,
    );

    const torsoX = bx + hipSway * 0.5;
    const torsoY = by - 52 - bounce;
    const headX = torsoX + Math.sin(dancePhase * 0.5) * 3.5;
    const headY = torsoY - 34;

    // Upward volumetric hologram projection cone from stage pedestal
    const holoGrad = ctx.createLinearGradient(bx, by, headX, headY - 24);
    holoGrad.addColorStop(0, rgbToCss(palette[5], 0.26 + beat * 0.14));
    holoGrad.addColorStop(1, rgbToCss(palette[3], 0.04));
    ctx.fillStyle = holoGrad;
    ctx.beginPath();
    ctx.moveTo(bx - 22, by);
    ctx.lineTo(bx + 22, by);
    ctx.lineTo(headX + 34, headY - 24);
    ctx.lineTo(headX - 34, headY - 24);
    ctx.closePath();
    ctx.fill();

    // Articulated Low-Poly Hologram Limbs & Torso
    ctx.strokeStyle = rgbToCss(palette[7], 0.94);
    ctx.fillStyle = rgbToCss(palette[5], 0.62);
    ctx.lineWidth = 2.2;

    // Legs (knees bend with the groove)
    const kneeOut = 5 + bounce * 0.38;
    ctx.beginPath();
    ctx.moveTo(bx - 11, by);
    ctx.lineTo(bx - 11 - kneeOut, by - 24 - bounce * 0.5);
    ctx.lineTo(torsoX - 8, torsoY + 16);
    ctx.moveTo(bx + 11, by);
    ctx.lineTo(bx + 11 + kneeOut, by - 24 - bounce * 0.5);
    ctx.lineTo(torsoX + 8, torsoY + 16);
    ctx.stroke();

    // Faceted Hologram Torso Jacket
    ctx.beginPath();
    ctx.moveTo(torsoX - 16, torsoY - 15);
    ctx.lineTo(torsoX + 16, torsoY - 15);
    ctx.lineTo(torsoX + 9, torsoY + 16);
    ctx.lineTo(torsoX - 9, torsoY + 16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Choreographed Dancing Arms
    const leftArmAng =
      Math.sin(dancePhase) * 0.85 - (handsUpActive ? 1.25 : 0.25);
    const rightArmAng =
      Math.cos(dancePhase) * 0.85 - (handsUpActive ? 1.25 : 0.25);
    ctx.beginPath();
    ctx.moveTo(torsoX - 16, torsoY - 11);
    ctx.lineTo(
      torsoX - 16 - Math.cos(leftArmAng) * 24,
      torsoY - 11 + Math.sin(leftArmAng) * 24,
    );
    ctx.moveTo(torsoX + 16, torsoY - 11);
    ctx.lineTo(
      torsoX + 16 + Math.cos(rightArmAng) * 24,
      torsoY - 11 + Math.sin(rightArmAng) * 24,
    );
    ctx.stroke();

    if (role === 'keytar') {
      // Angled Keytar instrument across torso
      ctx.fillStyle = rgbToCss(palette[6], 0.88);
      ctx.beginPath();
      ctx.moveTo(torsoX - 22, torsoY + 4);
      ctx.lineTo(torsoX + 26, torsoY - 9);
      ctx.lineTo(torsoX + 24, torsoY + 2);
      ctx.lineTo(torsoX - 20, torsoY + 13);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (role === 'drums') {
      // Floating holographic roto-tom pads in front of the percussionist
      ctx.fillStyle = rgbToCss(palette[4], 0.72);
      ctx.beginPath();
      ctx.ellipse(torsoX - 14, torsoY + 8, 9, 3.5, -0.2, 0, Math.PI * 2);
      ctx.ellipse(torsoX + 14, torsoY + 8, 9, 3.5, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Head: Lead Singer has a 3D Beveled Monitor/Cube Head displaying the Track's Album Art!
    if (role === 'lead') {
      const boxS = 40 + beat * 5;
      const hx = Math.round(headX - boxS * 0.5);
      const hy = Math.round(headY - boxS * 0.5);

      // 3D Beveled Monitor Head Top Roof
      ctx.fillStyle = rgbToCss(palette[3], 0.85);
      ctx.strokeStyle = rgbToCss(palette[7], 0.95);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + 7, hy - 7);
      ctx.lineTo(hx + boxS + 7, hy - 7);
      ctx.lineTo(hx + boxS, hy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = rgbToCss(palette[1], 0.94);
      ctx.fillRect(hx, hy, boxS, boxS);

      if (artReady && artCanvas) {
        ctx.save();
        ctx.globalAlpha = 0.88 + beat * 0.12;
        ctx.drawImage(artCanvas, hx + 2.5, hy + 2.5, boxS - 5, boxS - 5);
        ctx.restore();
      } else {
        ctx.fillStyle = rgbToCss(palette[6], 0.9);
        ctx.fillRect(hx + 7, hy + 12, 7, 5);
        ctx.fillRect(hx + boxS - 14, hy + 12, 7, 5);
      }

      // Hologram horizontal interference scanlines across the singer's album-art head
      ctx.fillStyle = rgbToCss(palette[6], 0.26);
      const scanOffset = Math.floor(timeSec * 24) & 3;
      for (let sy = hy + scanOffset; sy < hy + boxS; sy += 4) {
        ctx.fillRect(hx, sy, boxS, 1);
      }
      ctx.strokeRect(hx, hy, boxS, boxS);
    } else {
      // Flanking bandmate low-poly diamond hologram head
      ctx.fillStyle = rgbToCss(palette[4], 0.8);
      ctx.beginPath();
      ctx.moveTo(headX, headY - 13);
      ctx.lineTo(headX + 11, headY);
      ctx.lineTo(headX, headY + 11);
      ctx.lineTo(headX - 11, headY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  };

  drawHologramBandmate(cx - 76, pedY - 4, 'keytar');
  drawHologramBandmate(cx + 76, pedY - 4, 'drums');
  drawHologramBandmate(cx, pedY + 4, 'lead');
  ctx.restore();

  // 6. Left & Right DDR / StepMania Step Arrow Highways (Restored from V1 Micro-Party)
  const receptorY = Math.max(cropTopY + 28, 54);
  const highwayBottomY = Math.min(CANVAS_H - 18, cropBottomY - 12);
  const arrowSpacing = 22;
  const arrowR = 8.5;

  for (const side of [-1, 1]) {
    const laneCenterX = side < 0 ? 64 : CANVAS_W - 64;
    const laneW = arrowSpacing * 4 + 10;

    // Translucent dark note highway backing
    ctx.fillStyle = 'rgba(4, 7, 15, 0.62)';
    ctx.strokeStyle = rgbToCss(palette[3], 0.35 + beat * 0.2);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(
      laneCenterX - laneW * 0.5,
      receptorY - 14,
      laneW,
      highwayBottomY - receptorY + 24,
      6,
    );
    ctx.fill();
    ctx.stroke();

    // 4 Receptor Targets at top of highway
    for (let dir = 0; dir < 4; dir++) {
      const colX = laneCenterX + (dir - 1.5) * arrowSpacing;
      const bandEnergy = sb[(dir * 3 + (side > 0 ? 2 : 0)) & 15];
      const hitFlash = bandEnergy > 0.52 || beat > 0.55;

      ctx.strokeStyle = rgbToCss(
        hitFlash ? palette[7] : palette[4],
        hitFlash ? 0.95 : 0.48,
      );
      ctx.fillStyle = rgbToCss(
        palette[3 + (dir & 3)],
        hitFlash ? 0.42 + beat * 0.3 : 0.12,
      );
      ctx.lineWidth = hitFlash ? 2.0 : 1.3;
      drawStepArrow(ctx, colX, receptorY, arrowR, dir);
      ctx.fill();
      ctx.stroke();

      // Hit burst ring when note crosses receptor on beat
      if (hitFlash && beat > 0.45) {
        ctx.strokeStyle = rgbToCss(palette[7], 0.65 * beat);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(colX, receptorY, arrowR + beat * 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Scrolling Rhythm Notes rising toward receptors
    const noteCount = 7;
    const scrollSpeed = 110 + (bpm || 120) * 0.45;
    const spanH = Math.max(80, highwayBottomY - receptorY);

    for (let n = 0; n < noteCount; n++) {
      const seed = n * 3 + (side > 0 ? 5 : 0);
      const dir = (seed + Math.floor((timeSec * scrollSpeed + n * 42) / spanH)) & 3;
      const colX = laneCenterX + (dir - 1.5) * arrowSpacing;
      const rawOffset = (timeSec * scrollSpeed + n * (spanH / noteCount)) % spanH;
      const noteY = highwayBottomY - rawOffset;

      const noteColor = palette[4 + (dir & 3)];
      const prox = 1 - Math.abs(noteY - receptorY) / spanH;

      ctx.fillStyle = rgbToCss(noteColor, 0.78 + prox * 0.2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.1;
      drawStepArrow(ctx, colX, noteY, arrowR * 0.92, dir);
      ctx.fill();
      ctx.stroke();
    }

    // "PERFECT! / FEVER!" Combo Callout under the receptor on strong beats
    if (beat > 0.48 || drop > 0.35 || handsUpActive) {
      const label =
        handsUpActive || drop > 0.35
          ? 'FEVER!'
          : beat > 0.72
            ? 'PERFECT!!'
            : 'GREAT!';
      ctx.font = '800 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = rgbToCss(palette[7], 0.92);
      ctx.fillText(label, laneCenterX, receptorY + 20);
    }
  }

  // 7. Pressurized Stage CO2 / Fog Machine Jets & Rolling Stage Smoke (Restored from V1)
  const fogTrigger = Math.min(
    1,
    subBass * 0.75 + beat * 0.65 + drop * 0.9 + highEnergy * 0.25,
  );
  if (fogTrigger > 0.18) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const fogNozzles = [-176, -108, 108, 176];
    for (let nIdx = 0; nIdx < fogNozzles.length; nIdx++) {
      const nx = cx + fogNozzles[nIdx];
      const nozzleEnergy = sb[(nIdx * 4) & 15];
      const jetIntensity = Math.min(1, fogTrigger * 0.7 + nozzleEnergy * 0.45);
      if (jetIntensity < 0.22) continue;

      const jetH = (42 + jetIntensity * 88) * (0.85 + beat * 0.3);
      const jetSpread = 12 + jetIntensity * 22;
      const sway = Math.sin(timeSec * 5.5 + nIdx * 1.9) * 6;

      const jetGrad = ctx.createLinearGradient(
        nx,
        horizonY,
        nx + sway,
        horizonY - jetH,
      );
      const fogTint = lerpRgb(palette[6], [245, 248, 255], 0.65);
      jetGrad.addColorStop(0, rgbToCss(fogTint, 0.52 * jetIntensity));
      jetGrad.addColorStop(
        0.45,
        rgbToCss(palette[4], 0.24 * jetIntensity),
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
        (p / (puffCount - 1) - 0.5) * (CANVAS_W * 0.85) +
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

  // 8. Mode-7 Perspective Crowd Silhouettes (Swaying Hands Normally vs. Jumping Hands-Up on Beat Drops!)
  const crowdCount = 20;
  for (let i = 0; i < crowdCount; i++) {
    const depth = 0.25 + (i % 3) * 0.28;
    const spreadX = (i / (crowdCount - 1) - 0.5) * (CANVAS_W * 0.92);
    const swayBodyX = handsUpActive
      ? Math.sin(timeSec * 3.2 + i) * 3
      : Math.sin(timeSec * beatHz * Math.PI * 0.5 + i * 0.45) * 7;
    const dancerX = cx + spreadX + swayBodyX;
    const baseY = horizonY + 34 + depth * (CANVAS_H - horizonY - 22);
    const scale = 0.68 + depth * 0.55;

    // During normal groove (`!handsUpActive`), characters stay planted with only a gentle shoulder bob (no jumping!).
    // Only when `handsUpActive` triggers on a beat drop do they jump together for ~2.8s!
    const hopPhase =
      timeSec * beatHz * Math.PI * (handsUpActive ? 1.65 : 0.85) +
      (handsUpActive ? (i % 2) * 0.25 : i * 0.65);
    const hopY = handsUpActive
      ? Math.abs(Math.sin(hopPhase)) * (15 + subBass * 14 + beat * 8) * scale
      : Math.abs(Math.sin(hopPhase)) * (2.2 + subBass * 3.5) * scale;
    const dy = baseY - hopY;

    // Silhouette Head & Shoulders (Restored from V1 Micro-Party)
    const headR = 7.5 * scale;
    ctx.fillStyle = '#04060d';
    ctx.strokeStyle = rgbToCss(
      palette[handsUpActive ? 6 : 3 + (i & 3)],
      handsUpActive ? 0.82 : 0.55,
    );
    ctx.lineWidth = 1.2;

    // Torso
    ctx.beginPath();
    ctx.roundRect(
      dancerX - 10 * scale,
      dy,
      20 * scale,
      28 * scale,
      6 * scale,
    );
    ctx.fill();
    ctx.stroke();

    // Head
    ctx.beginPath();
    ctx.arc(dancerX, dy - headR * 0.9, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Dual Concert Glowsticks / Hands (`lighter`)
    const stickColor = palette[4 + (i % 4)];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgbToCss(stickColor, 0.94);
    ctx.lineWidth = 2.6 * scale;
    ctx.lineCap = 'round';

    if (handsUpActive) {
      // Beat Drop: Both hands point straight UP as the crowd jumps!
      for (let arm = -1; arm <= 1; arm += 2) {
        const shoulderX = dancerX + arm * 9 * scale;
        const shoulderY = dy + 4 * scale;
        const tipX =
          shoulderX +
          arm * 3.5 * scale +
          Math.sin(timeSec * 9 + i) * 2.0 * scale;
        const tipY = shoulderY - 24 * scale;
        ctx.beginPath();
        ctx.moveTo(shoulderX, shoulderY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
      }
    } else {
      // Normal Groove: Smooth, coordinated side-to-side hand & glowstick swaying!
      const swayPhase =
        timeSec * beatHz * Math.PI * 0.5 + (i % 4) * 0.22;
      const waveAng = Math.sin(swayPhase) * 0.78;
      for (let arm = -1; arm <= 1; arm += 2) {
        const shoulderX = dancerX + arm * 9 * scale;
        const shoulderY = dy + 4 * scale;
        const tipX =
          shoulderX + Math.sin(waveAng + arm * 0.22) * 20 * scale;
        const tipY =
          shoulderY - Math.cos(waveAng * 0.65) * 19 * scale;
        ctx.beginPath();
        ctx.moveTo(shoulderX, shoulderY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 9. Diegetic Front-Row Crowd Fan Sign for Attributed `@username` Comments
  // (Lyrics are rendered exclusively inside the multi-row Vestaboard Jumbotron above!)
  drawMicroPartyCommentPill(
    ctx,
    activeComment,
    commentAvatarImg,
    palette,
    timeSec,
    beat,
    cropBottomY,
    true,
  );

  // 11. Arcade Strobe Curtain Transition Effect (`trans > 0.01`)
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
