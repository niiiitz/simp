import {
  ASCII_COUNT,
  ASCII_MAX,
  ASCII_MIN,
  ART_BUF_SIZE,
  CANVAS_H,
  CANVAS_W,
  CELL_BAYER,
  CELL_COL,
  CELL_H,
  CELL_NORM_X,
  CELL_NORM_Y,
  CELL_RADIAL_ANGLE,
  CELL_RADIAL_DIST,
  CELL_ROW,
  CELL_W,
  CELL_X,
  CELL_Y,
  COS_F32,
  drawMicroPartyCommentPill,
  getRpsLoserSide,
  GRID_CELLS,
  GRID_COLS,
  GRID_ROWS,
  NUM_GLYPHS,
  NUM_PALETTE,
  packAbgr,
  RENDER_SCALE,
  rgbToCss,
  SIN_F32,
  SIN_U8,
  TRAPPER_SHAPE_NAMES,
  type ClassicSceneRuntimeRefs,
  type SceneRenderContext,
  type TrapperShapeKind,
} from './classicShared';

export function renderVertigoScene(scene: SceneRenderContext, rt: ClassicSceneRuntimeRefs): void {
  const {
    ctx,
    dt,
    timeSec,
    beat,
    trans,
    drop,
    buildup,
    subBass,
    midEnergy,
    highEnergy,
    sb,
    palette,
    cropTopY,
    cropBottomY,
  } = scene;
  const {
    activeLyricRef,
    artSquareEdgeRef,
    artSquareLumaRef,
    avatarBlendRef,
    avatarLumaGridRef,
    cellSkipMaskRef,
    commentAvatarImgRef,
    feedbackCanvasRef,
    glitchSeedRef,
    glyphTextStripRef,
    hasLyricsRef,
    hasScCommentsRef,
    imageDataRef,
    lowResBlitCanvasRef,
    mutationPatchesRef,
    paletteCycleOffsetRef,
    phaseAccumRef,
    rowCorruptMaskRef,
    rowTearPxRef,
    scrollerTextRef,
    starXRef,
    starYRef,
    starZRef,
    trapperArenaRef,
    trapperFloorZRef,
    u32FrameRef,
    vertigoLyricRevealRef,
    vertigoPulseZRef,
    vertigoRollCurrentRef,
    vertigoRollTargetRef,
    vertigoTravelZRef,
    glitch,
    palAbgr,
    glyphBitmaps,
    frameCount,
    effectiveComment,
    effectiveAvatarImg,
    drawVertigoStyleHologram,
  } = rt;
  void highEnergy;
  void ASCII_COUNT;
  void CELL_H;
  void CELL_W;
  void NUM_PALETTE;
  void SIN_U8;
  void packAbgr;

        // Pure #000000 OLED abyss
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        const transWave = trans > 0.005 ? Math.sin(trans * Math.PI) : 0;
        const transCorkscrew =
          trans > 0.45
            ? Math.sin(((trans - 0.45) / 0.55) * Math.PI) * Math.PI * 0.95
            : 0;
        const transShockZ =
          trans > 0.005 && trans <= 0.45 ? (1 - trans / 0.45) * 3.4 : -1;

        // Advance corridor travel speed: glides smoothly during breakdowns ("Runaway"),
        // surges into hyper-velocity on the Beat Drop or Track Transition ("Thumper" / "Descent")
        const speed =
          0.90 + subBass * 1.9 + drop * 2.8 + transWave * 3.4 - buildup * 0.30;
        vertigoTravelZRef.current += dt * speed;
        const travelZ = vertigoTravelZRef.current;

        // Forward-chasing tunnel pulse wave (moves strictly forward into the tunnel!)
        vertigoPulseZRef.current += dt * (4.8 + subBass * 3.8 + drop * 4.5 + transWave * 6.0);
        const pulseZ = vertigoPulseZRef.current;

        // Smoothly bank camera roll toward 90-degree corner turns on beat drops ("Maze 3D" / "Descent")
        vertigoRollCurrentRef.current +=
          (vertigoRollTargetRef.current - vertigoRollCurrentRef.current) * Math.min(1, dt * 4.5);
        const camRoll =
          vertigoRollCurrentRef.current +
          transCorkscrew +
          Math.sin(timeSec * 0.85) * (0.14 + subBass * 0.16) +
          (drop > 0.1 ? Math.sin(timeSec * 6.5) * drop * 0.22 : 0);
        const cosR = Math.cos(camRoll);
        const sinR = Math.sin(camRoll);

        const numRings = 20;
        const maxDepth = 3.4;
        const stepZ = maxDepth / numRings;
        const fracZ = travelZ % stepZ;
        const isMonochromeStrobe = buildup > 0.25 && drop < 0.15;

        // Precompute projected ring centers and vertices (Octagonal Descent corridor)
        const ringCx = new Float32Array(numRings);
        const ringCy = new Float32Array(numRings);
        const ringScale = new Float32Array(numRings);
        const ringZArr = new Float32Array(numRings);

        const fov = 268 + drop * 72 + transWave * 65 - buildup * 26;
        for (let r = 0; r < numRings; r++) {
          const z = Math.max(0.11, maxDepth - r * stepZ - fracZ);
          ringZArr[r] = z;
          const worldZ = travelZ + z;
          // Winding subterranean corridor spine
          const spineX =
            Math.sin(worldZ * 1.12) * (0.40 + drop * 0.24 + transWave * 0.30) +
            Math.cos(worldZ * 0.52) * 0.20;
          const spineY =
            Math.cos(worldZ * 0.92) * 0.26 +
            Math.sin(worldZ * 1.55) * (0.12 + subBass * 0.14);

          const irisPinch =
            trans > 0.45
              ? Math.max(0.35, 1 - Math.sin(((trans - 0.45) / 0.55) * Math.PI) * 0.42 * (z / maxDepth))
              : 1.0;
          const invZ = (fov / z) * irisPinch;
          ringCx[r] = CANVAS_W * 0.5 + (spineX * cosR - spineY * sinR) * invZ;
          ringCy[r] = CANVAS_H * 0.5 + (spineX * sinR + spineY * cosR) * invZ;
          ringScale[r] = invZ;
        }

        // 8 primary octagonal vertices + 8 mid-face structural ribs (16 rails total)
        const corners: [number, number][] = [
          [-1.0, -0.68],
          [-0.44, -0.90],
          [0.44, -0.90],
          [1.0, -0.68],
          [1.0, 0.68],
          [0.44, 0.90],
          [-0.44, 0.90],
          [-1.0, 0.68],
        ];

        for (let r = 0; r < numRings - 1; r++) {
          const z0 = ringZArr[r];
          const z1 = ringZArr[r + 1];
          const s0 = ringScale[r];
          const s1 = ringScale[r + 1];
          const cx0 = ringCx[r];
          const cy0 = ringCy[r];
          const cx1 = ringCx[r + 1];
          const cy1 = ringCy[r + 1];

          const worldRingIdx = Math.floor((travelZ + z0) / stepZ);
          const bandAmp = sb[Math.abs(worldRingIdx) & 15];
          const depthFade = Math.pow(Math.max(0, Math.min(1, 1 - z0 / maxDepth)), 0.72);

          // Forward-travelling tunnel chaser light wave (races from foreground z=0.1 deep into z=maxDepth!)
          const wavePhase = z0 * 3.1 - pulseZ;
          const forwardPulse = Math.pow(0.5 + 0.5 * Math.cos(wavePhase), 5);
          const shockHit =
            transShockZ > 0 && Math.abs(z0 - transShockZ) < 0.38
              ? 1 - Math.abs(z0 - transShockZ) / 0.38
              : 0;
          const ringBoost = Math.min(1, forwardPulse * 0.85 + shockHit * 1.1 + drop * 0.35);

          // 1. Strobe & Pulse-Wave Wall Bays (Left & Right walls + Ceiling/Floor panels on pulse crests)
          if (((worldRingIdx & 1) === 0 || ringBoost > 0.35) && depthFade > 0.08) {
            const wallColor: [number, number, number] = isMonochromeStrobe
              ? [215, 225, 240]
              : shockHit > 0.2
                ? palette[7]
                : ringBoost > 0.45
                  ? palette[6]
                  : palette[2 + (Math.abs(worldRingIdx) % 4)];
            const panelAlpha =
              depthFade *
              (0.11 + bandAmp * 0.20 + ringBoost * 0.28 + (isMonochromeStrobe ? 0.14 : 0));
            ctx.fillStyle = rgbToCss(wallColor, Math.min(0.65, panelAlpha));

            for (const side of [0, 3, 4, 7]) {
              if ((side === 0 || side === 4) && ringBoost < 0.3) continue;
              const cA = corners[side];
              const cB = corners[(side + 1) & 7];
              const x0a = cx0 + (cA[0] * cosR - cA[1] * sinR) * s0;
              const y0a = cy0 + (cA[0] * sinR + cA[1] * cosR) * s0;
              const x0b = cx0 + (cB[0] * cosR - cB[1] * sinR) * s0;
              const y0b = cy0 + (cB[0] * sinR + cB[1] * cosR) * s0;
              const x1b = cx1 + (cB[0] * cosR - cB[1] * sinR) * s1;
              const y1b = cy1 + (cB[0] * sinR + cB[1] * cosR) * s1;
              const x1a = cx1 + (cA[0] * cosR - cA[1] * sinR) * s1;
              const y1a = cy1 + (cA[0] * sinR + cA[1] * cosR) * s1;
              ctx.beginPath();
              ctx.moveTo(x0a, y0a);
              ctx.lineTo(x0b, y0b);
              ctx.lineTo(x1b, y1b);
              ctx.lineTo(x1a, y1a);
              ctx.closePath();
              ctx.fill();
            }
          }

          // 2. Longitudinal Rails (8 primary corner rails + 8 mid-wall structural ribs + diagonal trusses)
          for (let c = 0; c < 8; c++) {
            const ptA = corners[c];
            const ptB = corners[(c + 1) & 7];
            const midPt: [number, number] = [(ptA[0] + ptB[0]) * 0.5, (ptA[1] + ptB[1]) * 0.5];

            const x0 = cx0 + (ptA[0] * cosR - ptA[1] * sinR) * s0;
            const y0 = cy0 + (ptA[0] * sinR + ptA[1] * cosR) * s0;
            const x1 = cx1 + (ptA[0] * cosR - ptA[1] * sinR) * s1;
            const y1 = cy1 + (ptA[0] * sinR + ptA[1] * cosR) * s1;

            const isThumperRail = c === 5 || c === 6;
            const railCol: [number, number, number] = isMonochromeStrobe
              ? [240, 245, 255]
              : isThumperRail || ringBoost > 0.55
                ? palette[7]
                : palette[5];

            // Outer neon halo stroke
            ctx.strokeStyle = rgbToCss(
              palette[4],
              depthFade * (0.22 + ringBoost * 0.35 + subBass * 0.2)
            );
            ctx.lineWidth = isThumperRail ? 4.8 : 3.4;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();

            // Crisp bright core rail stroke
            ctx.strokeStyle = rgbToCss(
              railCol,
              Math.min(1, depthFade * (isThumperRail ? 0.94 : 0.62 + bandAmp * 0.32 + ringBoost * 0.35))
            );
            ctx.lineWidth = isThumperRail ? 2.4 : 1.6;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();

            // Secondary mid-face longitudinal rib
            const mx0 = cx0 + (midPt[0] * cosR - midPt[1] * sinR) * s0;
            const my0 = cy0 + (midPt[0] * sinR + midPt[1] * cosR) * s0;
            const mx1 = cx1 + (midPt[0] * cosR - midPt[1] * sinR) * s1;
            const my1 = cy1 + (midPt[0] * sinR + midPt[1] * cosR) * s1;
            ctx.strokeStyle = rgbToCss(
              palette[3 + (c & 3)],
              depthFade * (0.30 + ringBoost * 0.40)
            );
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(mx0, my0);
            ctx.lineTo(mx1, my1);
            ctx.stroke();
          }

          // 3. Thumper Forward-Chasing Floor Chevron (`^`) on the bottom track
          const flL = corners[6];
          const flR = corners[5];
          const flMidX = (cx0 + cx1) * 0.5;
          const flMidY = (cy0 + cy1) * 0.5;
          const flMidS = (s0 + s1) * 0.5;
          const chvLx = cx1 + (flL[0] * cosR - flL[1] * sinR) * s1;
          const chvLy = cy1 + (flL[0] * sinR + flL[1] * cosR) * s1;
          const chvRx = cx1 + (flR[0] * cosR - flR[1] * sinR) * s1;
          const chvRy = cy1 + (flR[0] * sinR + flR[1] * cosR) * s1;
          const chvTipX = flMidX + (0 * cosR - 0.92 * sinR) * flMidS;
          const chvTipY = flMidY + (0 * sinR + 0.92 * cosR) * flMidS;
          ctx.strokeStyle = rgbToCss(
            ringBoost > 0.4 ? palette[7] : palette[6],
            depthFade * (0.45 + ringBoost * 0.52)
          );
          ctx.lineWidth = 1.5 + ringBoost * 1.8;
          ctx.beginPath();
          ctx.moveTo(chvLx, chvLy);
          ctx.lineTo(chvTipX, chvTipY);
          ctx.lineTo(chvRx, chvRy);
          ctx.stroke();

          // 4. Draw Octagonal Descent / Thumper Gate Frame (Dual-Pass Glow + Crisp Core)
          const isMajorGate = (worldRingIdx & 3) === 0 || ringBoost > 0.5;
          const gateCol: [number, number, number] = isMonochromeStrobe
            ? [230, 240, 255]
            : shockHit > 0.2 || ringBoost > 0.55
              ? palette[7]
              : palette[4 + (Math.abs(worldRingIdx) % 4)];

          // Outer glow pass
          ctx.strokeStyle = rgbToCss(
            palette[5],
            depthFade * (0.24 + bandAmp * 0.25 + ringBoost * 0.42)
          );
          ctx.lineWidth = isMajorGate ? 4.8 + ringBoost * 2.2 : 2.8;
          ctx.beginPath();
          for (let c = 0; c <= 8; c++) {
            const pt = corners[c & 7];
            const gx = cx1 + (pt[0] * cosR - pt[1] * sinR) * s1;
            const gy = cy1 + (pt[0] * sinR + pt[1] * cosR) * s1;
            if (c === 0) ctx.moveTo(gx, gy);
            else ctx.lineTo(gx, gy);
          }
          ctx.stroke();

          // Crisp inner core pass
          ctx.strokeStyle = rgbToCss(
            gateCol,
            Math.min(1, depthFade * (0.64 + bandAmp * 0.36 + ringBoost * 0.40))
          );
          ctx.lineWidth = isMajorGate ? 2.5 : 1.4;
          ctx.stroke();
        }

        // 5. Vanishing-Point Descent Vector Target Reticle (always active, pulses on beat & chaser waves)
        const vpX = ringCx[0];
        const vpY = ringCy[0];
        const retR = 14 + subBass * 16 + beat * 12 + transWave * 28;
        ctx.save();
        ctx.translate(vpX, vpY);
        ctx.rotate(-camRoll * 1.2 + timeSec * 0.8);
        ctx.strokeStyle = rgbToCss(palette[7], 0.72 + beat * 0.25);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-retR, 0);
        ctx.lineTo(-retR * 0.4, 0);
        ctx.moveTo(retR * 0.4, 0);
        ctx.lineTo(retR, 0);
        ctx.moveTo(0, -retR);
        ctx.lineTo(0, -retR * 0.4);
        ctx.moveTo(0, retR * 0.4);
        ctx.lineTo(0, retR);
        ctx.stroke();
        ctx.strokeStyle = rgbToCss(palette[6], 0.65);
        ctx.beginPath();
        ctx.arc(0, 0, retR * 0.65, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 6. Stable, Un-Clipped Floating 3D Hologram Lyric Banner (ONLY when synced lyrics exist — never unattributed comments!)
        const rawOverlayText = (activeLyricRef.current || '').trim();

        if (rawOverlayText.length > 0) {
          drawVertigoStyleHologram(
            rawOverlayText,
            (ringCx[6] - CANVAS_W * 0.5) * 0.24,
            (ringCy[6] - CANVAS_H * 0.5) * 0.05
          );
        }

        // 7. Micro-Party style SoundCloud timed comment pop-over pill
        drawMicroPartyCommentPill(
          ctx,
          effectiveComment,
          effectiveAvatarImg || commentAvatarImgRef.current,
          palette,
          timeSec,
          beat,
          cropBottomY,
          false
        );
}
