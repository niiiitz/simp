import {
  CANVAS_H,
  CANVAS_W,
  drawMicroPartyCommentPill,
  RENDER_SCALE,
  rgbToCss,
  SIN_F32,
  type ClassicSceneRuntimeRefs,
  type SceneRenderContext,
} from './classicShared';
import { ICOSAHEDRON_MESH_3D } from './lowPoly3d';

/**
 * Mode 21: Winamp AVS V2 [Feedback Tunnel + 3D Polyhedron Cage with Spinning Inner Artwork]
 * - Uses V1's clean Winamp AVS feedback zoom/rotation tunnel (`feedbackCanvasRef`), concentric
 *   beat-locked wireframe rings, and single horizontal dual-trace oscilloscope ribbon (zero noisy clutter)
 * - Centerpiece: A 2-pass (back-hemisphere -> spinning 3D album artwork -> front-hemisphere)
 *   translucent 3D polyhedron die cage so the album artwork visibly spins INSIDE the 3D wireframe die!
 */
export function renderAvsV2Scene(scene: SceneRenderContext, rt: ClassicSceneRuntimeRefs): void {
  const {
    ctx,
    dt,
    timeSec,
    beat,
    trans,
    drop,
    subBass,
    midEnergy,
    sb,
    palette,
    artCanvas,
    artReady,
    cropTopY,
    cropBottomY,
  } = scene;
  const {
    activeLyricRef,
    commentAvatarImgRef,
    feedbackCanvasRef,
    vertigoLyricRevealRef,
    effectiveComment,
    effectiveAvatarImg,
  } = rt;

  if (!feedbackCanvasRef.current) {
    feedbackCanvasRef.current = document.createElement('canvas');
    feedbackCanvasRef.current.width = CANVAS_W * RENDER_SCALE;
    feedbackCanvasRef.current.height = CANVAS_H * RENDER_SCALE;
  }
  const fb = feedbackCanvasRef.current;
  const fbCtx = fb.getContext('2d');

  // 1. Pure #000000 OLED floor clear + V1 Winamp AVS Feedback Zoom/Rotate Pass
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  let zoom = 1.016 + subBass * 0.028 + beat * 0.022 + drop * 0.032;
  let rot = SIN_F32[Math.floor(timeSec * 19) & 255] * (0.011 + midEnergy * 0.016);

  if (trans > 0.55) {
    const imp = (trans - 0.55) / 0.45;
    zoom = 0.91 - imp * 0.05;
    rot += imp * 0.16;
  } else if (trans > 0.005) {
    const burst = trans / 0.55;
    zoom = 1.02 + burst * 0.085;
    rot -= burst * 0.09;
  }

  ctx.save();
  ctx.translate(CANVAS_W * 0.5, CANVAS_H * 0.5);
  ctx.rotate(rot);
  ctx.scale(zoom, zoom);
  ctx.globalAlpha = 0.84;
  ctx.drawImage(fb, -CANVAS_W * 0.5, -CANVAS_H * 0.5, CANVAS_W, CANVAS_H);
  ctx.restore();
  ctx.globalAlpha = 1.0;

  // Black-floor crush pass so old trails fade cleanly to pure #000000 without buildup noise
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const cx = CANVAS_W * 0.5;
  const cy = CANVAS_H * 0.5;

  // 2. V1 Outer Concentric Beat-Locked Polygons (2 clean outer rings framing the center die)
  const sides = drop > 0.3 ? 6 : 8;
  const baseRadius = 64 + subBass * 54 + beat * 28 + drop * 22;

  for (let ring = 0; ring < 2; ring++) {
    const r = baseRadius * (0.85 + ring * 0.48);
    const palColor = palette[Math.min(7, 3 + ring * 2)];
    ctx.strokeStyle = rgbToCss(palColor, 0.52 - ring * 0.14);
    ctx.lineWidth = ring === 0 ? 1.8 : 1.2;
    ctx.beginPath();
    for (let s = 0; s <= sides; s++) {
      const bandMod = sb[(s * 2 + ring) & 15] * 22;
      const theta = (s / sides) * Math.PI * 2 + timeSec * (ring % 2 === 0 ? 0.38 : -0.28);
      const px = cx + Math.cos(theta) * (r + bandMod);
      const py = cy + Math.sin(theta) * (r + bandMod) * 0.72;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // 3. V1 Classic Winamp Dual-Trace Oscilloscope Ribbon
  const scopePal = palette[6] || [56, 189, 248];
  ctx.strokeStyle = rgbToCss(scopePal, 0.82);
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  const points = 64;
  for (let p = 0; p < points; p++) {
    const x = (p / (points - 1)) * CANVAS_W;
    const bVal = sb[p & 15];
    const wave1 = SIN_F32[(Math.floor(timeSec * 90) + p * 9) & 255];
    const wave2 = SIN_F32[(Math.floor(timeSec * 145) + p * 17) & 255];
    // Attenuate oscilloscope amplitude slightly right through the center die so the spinning artwork stays clear
    const centerAtten = 0.45 + 0.55 * Math.min(1, Math.abs(x - cx) / 96);
    const yOffset = (wave1 * 0.6 + wave2 * 0.4) * (16 + bVal * 68 + beat * 26) * centerAtten;
    const y = cy + yOffset;
    if (p === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 4. Project the 3D Polyhedron Die (`ICOSAHEDRON_MESH_3D`) so we can split Back vs. Front Hemispheres
  const dieScale = 58 + subBass * 16 + beat * 10;
  const rx = timeSec * 0.62;
  const ry = timeSec * 0.88;
  const rz = timeSec * 0.42;
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const cosZ = Math.cos(rz), sinZ = Math.sin(rz);
  const fov = 3.4;

  const projVerts: [number, number, number][] = ICOSAHEDRON_MESH_3D.verts.map(([vx, vy, vz]) => {
    const y1 = vy * cosX - vz * sinX;
    const z1 = vy * sinX + vz * cosX;
    const x2 = vx * cosY + z1 * sinY;
    const z2 = -vx * sinY + z1 * cosY;
    const x3 = x2 * cosZ - y1 * sinZ;
    const y3 = x2 * sinZ + y1 * cosZ;
    const persp = fov / Math.max(0.5, fov - z2 * 0.45);
    return [cx + x3 * dieScale * persp, cy + y3 * dieScale * persp, z2];
  });

  const sortedFaces = ICOSAHEDRON_MESH_3D.faces
    .map((face) => {
      const [i0, i1, i2] = face.indices;
      const avgZ = (projVerts[i0][2] + projVerts[i1][2] + projVerts[i2][2]) / 3;
      return { face, avgZ };
    })
    .sort((a, b) => a.avgZ - b.avgZ);

  // Draw the BACK hemisphere of the 3D Die into the feedback buffer so it trails softly
  for (const { face, avgZ } of sortedFaces) {
    if (avgZ > 0) continue; // Front hemisphere is drawn AFTER the inner spinning artwork!
    const [i0, i1, i2] = face.indices;
    ctx.strokeStyle = rgbToCss(palette[3], 0.34);
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(projVerts[i0][0], projVerts[i0][1]);
    ctx.lineTo(projVerts[i1][0], projVerts[i1][1]);
    ctx.lineTo(projVerts[i2][0], projVerts[i2][1]);
    ctx.closePath();
    ctx.stroke();
  }

  // 5. Lyric Tunnel-Echo Stamp + Capture Feedback Buffer (`fbCtx`)
  //    (Captured BEFORE drawing the inner spinning artwork & front die cage so the artwork stays razor-sharp!)
  const lyricText = (activeLyricRef.current || '').trim();
  let avsLines: string[] = [];
  let avsFontPx = 15;
  let avsLineH = 19;
  let avsBoxW = 0;
  let avsBoxH = 0;
  let avsLyricY = 0;

  if (lyricText.length > 0) {
    vertigoLyricRevealRef.current = Math.min(1, vertigoLyricRevealRef.current + dt * 3.6);
    const upperLyric = lyricText.toUpperCase();
    if (upperLyric.length <= 36) {
      avsLines.push(upperLyric);
    } else {
      const mid = Math.floor(upperLyric.length * 0.5);
      let splitAt = upperLyric.lastIndexOf(' ', mid + 8);
      if (splitAt <= 6) splitAt = upperLyric.indexOf(' ', mid);
      if (splitAt > 0) {
        avsLines.push(upperLyric.slice(0, splitAt).trim());
        avsLines.push(upperLyric.slice(splitAt + 1).trim());
      } else {
        avsLines.push(upperLyric);
      }
    }
    const maxLineChars = Math.max(...avsLines.map((l) => l.length), 1);
    const maxFontPx = avsLines.length > 1 ? 14 : 16;
    avsFontPx = Math.max(
      11,
      Math.min(maxFontPx, Math.floor((CANVAS_W * 0.82) / (maxLineChars * 0.62))),
    );
    avsLineH = avsFontPx + 4;
    avsBoxW = Math.min(CANVAS_W - 28, Math.round(maxLineChars * avsFontPx * 0.62 + 26));
    avsBoxH = avsLines.length * avsLineH + 10;

    const safeTopY = Math.max(28, cropTopY + 18);
    const minCenterY = safeTopY + avsBoxH * 0.5;
    avsLyricY = Math.max(
      minCenterY,
      Math.min(cy - 68, minCenterY + 10) + Math.cos(timeSec * 1.1) * 2.0,
    );

    ctx.font = `bold ${avsFontPx}px "JetBrains Mono", "Fira Code", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgbToCss(palette[5], 0.16 + beat * 0.14);
    for (let li = 0; li < avsLines.length; li++) {
      const ly = avsLyricY + (li - (avsLines.length - 1) * 0.5) * avsLineH;
      ctx.fillText(avsLines[li], cx, ly);
    }
  }

  if (fbCtx) {
    fbCtx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    fbCtx.fillStyle = '#000000';
    fbCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    fbCtx.drawImage(ctx.canvas, 0, 0, CANVAS_W, CANVAS_H);
  }

  // 6. Spinning 3D Album Artwork Suspended INSIDE the Polyhedron Die!
  //    Drawn after feedback capture so the album cover never smears into the background tunnel,
  //    and drawn BEFORE the front hemisphere of the die so the wireframe struts pass in front of the art!
  const innerArtRadius = dieScale * 0.62;
  const spinYCos = Math.cos(timeSec * 0.95);
  const spinXScale = Math.sign(spinYCos || 1) * Math.max(0.22, Math.abs(spinYCos));
  const spinTilt = Math.sin(timeSec * 0.55) * 0.22;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spinTilt);
  ctx.scale(spinXScale, 1);

  // Octagonal bevel clip so the spinning artwork sits naturally inside the 3D polyhedron cavity
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const px = Math.cos(a) * innerArtRadius;
    const py = Math.sin(a) * innerArtRadius;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(4, 6, 12, 0.82)';
  ctx.fill();

  if (artReady && artCanvas) {
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.88 + beat * 0.12;
    ctx.drawImage(
      artCanvas,
      -innerArtRadius,
      -innerArtRadius,
      innerArtRadius * 2,
      innerArtRadius * 2,
    );
    ctx.restore();
  }

  // Crisp inner octagonal rim around the spinning album cover
  ctx.strokeStyle = rgbToCss(palette[6], 0.85);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();

  // 7. Front Hemisphere of the 3D Polyhedron Die (Wraps IN FRONT OF the Spinning Artwork!)
  for (const { face, avgZ } of sortedFaces) {
    if (avgZ <= 0) continue;
    const [i0, i1, i2] = face.indices;
    // Ultra-subtle glass facet glint + crisp front wireframe struts
    ctx.fillStyle = rgbToCss(palette[face.palIdx], 0.07 + beat * 0.05);
    ctx.strokeStyle = rgbToCss(palette[7], 0.78 + beat * 0.18);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(projVerts[i0][0], projVerts[i0][1]);
    ctx.lineTo(projVerts[i1][0], projVerts[i1][1]);
    ctx.lineTo(projVerts[i2][0], projVerts[i2][1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Glowing vertex nodes on the front-facing polyhedron corners
  ctx.fillStyle = rgbToCss(palette[7], 0.95);
  for (const [vx, vy, vz] of projVerts) {
    if (vz > 0) {
      ctx.fillRect(vx - 1.8, vy - 1.8, 3.6, 3.6);
    }
  }

  // 8. Crisp Foreground AVS Lyric Overlay & SoundCloud Comment Pill
  if (avsLines.length > 0) {
    const reveal = vertigoLyricRevealRef.current;
    ctx.save();
    ctx.translate(cx + Math.sin(timeSec * 0.95) * 4, avsLyricY);
    ctx.fillStyle = `rgba(6, 7, 12, ${(0.68 * reveal).toFixed(2)})`;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(-avsBoxW * 0.5, -avsBoxH * 0.5, avsBoxW, avsBoxH, 10);
    } else {
      ctx.rect(-avsBoxW * 0.5, -avsBoxH * 0.5, avsBoxW, avsBoxH);
    }
    ctx.fill();

    ctx.font = `bold ${avsFontPx}px "JetBrains Mono", "Fira Code", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let li = 0; li < avsLines.length; li++) {
      const ly = (li - (avsLines.length - 1) * 0.5) * avsLineH;
      ctx.fillStyle = rgbToCss(palette[4], 0.85 * reveal);
      ctx.fillText(avsLines[li], 1.5, ly + 1.5);
      ctx.fillStyle = rgbToCss(palette[7], (0.92 + beat * 0.08) * reveal);
      ctx.fillText(avsLines[li], 0, ly);
    }
    ctx.restore();
  }

  drawMicroPartyCommentPill(
    ctx,
    effectiveComment,
    effectiveAvatarImg || commentAvatarImgRef.current,
    palette,
    timeSec,
    beat,
    cropBottomY,
    false,
  );
}
