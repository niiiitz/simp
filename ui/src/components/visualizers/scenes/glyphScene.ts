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

export function renderGlyphScene(scene: SceneRenderContext, rt: ClassicSceneRuntimeRefs): void {
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

        if (!imageDataRef.current) {
          imageDataRef.current = ctx.createImageData(CANVAS_W, CANVAS_H);
          u32FrameRef.current = new Uint32Array(imageDataRef.current.data.buffer);
        }
        const imgData = imageDataRef.current;
        const u32 = u32FrameRef.current!;
        // Fill entire 640x360 canvas with TRUE OLED BLACK (#000000 -> 0xFF000000)
        u32.fill(0xff000000);

        const artSqLuma = artSquareLumaRef.current;
        const artSqEdge = artSquareEdgeRef.current;
        const avLuma = avatarLumaGridRef.current;
        const avWeight = avatarBlendRef.current;
        const rowTearPx = rowTearPxRef.current;
        const rowCorrupt = rowCorruptMaskRef.current;
        const gSeed = glitchSeedRef.current;
        const skipMask = cellSkipMaskRef.current;
        skipMask.fill(0);

        // Slow, hypnotic unstretched artwork panning (80x45 window gliding over 128x128 square art)
        // Never hits a hard corner bounce; drifts organically along a slow Lissajous path
        const maxPanX = ART_BUF_SIZE - GRID_COLS; // 48
        const maxPanY = ART_BUF_SIZE - GRID_ROWS; // 83
        const panX = Math.round(maxPanX * (0.5 + 0.46 * Math.sin(timeSec * 0.085)));
        const panY = Math.round(maxPanY * (0.5 + 0.46 * Math.cos(timeSec * 0.062)));

        // Step & render unstable multi-scale (2x2 and 3x3) font/lyric mutation patches first
        const patches = mutationPatchesRef.current;
        for (let pIdx = 0; pIdx < patches.length; pIdx++) {
          const patch = patches[pIdx];
          if (!patch.active) continue;
          patch.ttl -= dt;
          if (patch.ttl <= 0) {
            patch.active = false;
            continue;
          }
          // Unstable adaptation: jitter character or scale slightly near expiration or on beat spikes
          const scale = patch.scale;
          const charPixels = scale * 8;
          const colorAbgr = palAbgr[Math.min(7, patch.palIdx)];
          const len = patch.text.length;

          for (let cIdx = 0; cIdx < len; cIdx++) {
            const cellCol = patch.vertical ? patch.col : patch.col + cIdx * scale;
            const cellRow = patch.vertical ? patch.row + cIdx * scale : patch.row;
            if (cellCol + scale >= GRID_COLS || cellRow + scale >= GRID_ROWS) break;

            // Mark covered 1x1 cells so background matrix doesn't overwrite the macro-glyph
            for (let sr = 0; sr < scale; sr++) {
              const rOff = (cellRow + sr) * GRID_COLS;
              for (let sc = 0; sc < scale; sc++) {
                skipMask[rOff + cellCol + sc] = 1;
              }
            }

            let code = patch.text.charCodeAt(cIdx);
            if (glitch > 0.3 && ((cIdx + frameCount) & 3) === 0) {
              code = 35 + ((cIdx * 13 + frameCount) & 31);
            }
            if (code < ASCII_MIN || code > ASCII_MAX) continue;
            const lutIdx = NUM_GLYPHS + (code - ASCII_MIN);
            const bmpBase = lutIdx * 64;
            const screenX = cellCol * 8 + (glitch > 0.1 ? rowTearPx[cellRow] : 0);
            const screenY = cellRow * 8;

            for (let gy = 0; gy < 8; gy++) {
              for (let gx = 0; gx < 8; gx++) {
                if (glyphBitmaps[bmpBase + gy * 8 + gx] === 0) continue;
                for (let sy = 0; sy < scale; sy++) {
                  const py = screenY + gy * scale + sy;
                  if (py < 0 || py >= CANVAS_H) continue;
                  const rowBase = py * CANVAS_W;
                  for (let sx = 0; sx < scale; sx++) {
                    const px = (screenX + gx * scale + sx + CANVAS_W) % CANVAS_W;
                    u32[rowBase + px] = colorAbgr;
                  }
                }
              }
            }
            // Subtle unstable outline frame on 3x3 mutations
            if (scale === 3 && cIdx === 0 && patch.ttl > patch.maxTtl * 0.7) {
              const topY = Math.max(0, screenY - 1);
              const botY = Math.min(CANVAS_H - 1, screenY + charPixels);
              for (let x = 0; x < charPixels * len; x++) {
                const px = (screenX + x + CANVAS_W) % CANVAS_W;
                u32[topY * CANVAS_W + px] = palAbgr[4];
                u32[botY * CANVAS_W + px] = palAbgr[4];
              }
            }
          }
        }

        // Slower, hypnotic plasma attractors
        const tByte1 = Math.floor(timeSec * 13) & 255;
        const tByte2 = Math.floor(timeSec * 19) & 255;
        const cx1 = SIN_F32[tByte1] * 0.30;
        const cy1 = SIN_F32[(tByte1 + 64) & 255] * 0.24;
        const cx2 = SIN_F32[(256 - tByte2) & 255] * 0.34;
        const cy2 = SIN_F32[(tByte2 + 110) & 255] * 0.26;

        const ripplePhase = Math.floor(phaseAccumRef.current) & 255;
        const palCycle = paletteCycleOffsetRef.current;
        const strip = glyphTextStripRef.current;
        const stripLen = strip.length || 1;
        const scrollColShift = Math.floor(timeSec * 4.5);

        for (let i = 0; i < GRID_CELLS; i++) {
          if (skipMask[i] === 1) continue;

          const row = CELL_ROW[i];
          const col = CELL_COL[i];
          const nx = CELL_NORM_X[i];
          const ny = CELL_NORM_Y[i];
          const rDist = CELL_RADIAL_DIST[i];
          const rAng = CELL_RADIAL_ANGLE[i];

          const bandIdx = ((rAng >>> 4) + (col >>> 1)) & 15;
          const bandVal = sb[bandIdx];

          // 1. Sample from unstretched 128x128 square artwork at slow pan offset (panX, panY)
          const artIdx = (row + panY) * ART_BUF_SIZE + (col + panX);
          const baseArt = artSqLuma[artIdx] * (1 - avWeight) + avLuma[i] * avWeight;
          const artEdgeVal = artSqEdge[artIdx];
          const relief = baseArt * 0.38 + artEdgeVal * (0.50 + midEnergy * 0.42 + drop * 0.25);

          // 2. Dual-center LUT Moiré plasma + music-coupled radial wave
          const d1 = Math.sqrt((nx - cx1) * (nx - cx1) + (ny - cy1) * (ny - cy1));
          const d2 = Math.sqrt((nx - cx2) * (nx - cx2) + (ny - cy2) * (ny - cy2));
          const lut1 = SIN_U8[(Math.floor(d1 * 240) - ripplePhase) & 255];
          const lut2 = SIN_U8[(Math.floor(d2 * 190) + (ripplePhase >>> 1)) & 255];
          const plasma = ((lut1 + lut2) * 0.00196) * (0.16 + subBass * 0.40 + beat * 0.25);

          // 3. Combine with 4x4 Bayer Ordered Dither and shape contrast curve for true OLED negative space
          const rawEnergy =
            relief +
            plasma +
            bandVal * 0.22 +
            (1 - Math.min(1, rDist * 1.45)) * (beat * 0.22 + drop * 0.20) +
            CELL_BAYER[i] -
            0.12;

          const clamped = Math.pow(Math.max(0, Math.min(0.999, rawEnergy)), 1.45);
          let glyphIdx = Math.floor(clamped * NUM_GLYPHS);
          const isCorruptRow = rowCorrupt[row] === 1 && glitch > 0.12;

          if (glyphIdx <= 0 && !isCorruptRow) continue;

          // Palette index with beat-onset cycling
          const basePal = Math.min(NUM_PALETTE - 1, Math.max(1, Math.floor(clamped * NUM_PALETTE)));
          let palIdx =
            basePal >= 2 ? 2 + ((basePal - 2 + (beat > 0.38 || drop > 0.4 ? palCycle : 0)) % 6) : basePal;

          const isTextRow = row === 8 || row === 22 || row === 36;
          let lutGlyphIdx = glyphIdx;

          if (isTextRow && glyphIdx >= 4 && stripLen > 0) {
            const rowShift = row * 11;
            const rawCode = strip.charCodeAt((col + scrollColShift + rowShift) % stripLen);
            const code =
              glitch > 0.25 && ((col + gSeed) & 3) === 0
                ? 33 + ((col * 17 + gSeed) & 31)
                : rawCode;
            if (code >= ASCII_MIN && code <= ASCII_MAX) {
              lutGlyphIdx = NUM_GLYPHS + (code - ASCII_MIN);
              palIdx = clamped > 0.65 || beat > 0.4 ? 7 : 5;
            }
          } else if (isCorruptRow && ((col + (gSeed >>> 3)) & 3) === 0) {
            lutGlyphIdx = 7 + ((i ^ gSeed) & 8);
            palIdx = 6 + (col & 1);
          }

          const zLift = (clamped - 0.35) * (6 + subBass * 11 + beat * 8);
          const tearOffset = glitch > 0.05 ? Math.round(rowTearPx[row] * glitch) : 0;
          let dx = CELL_X[i] + nx * zLift + tearOffset;
          let dy = CELL_Y[i] + ny * zLift;

          if (trans > 0.005) {
            const p = 1 - trans;
            const colSpeed = 1 + ((col * 37 + 13) & 7) * 0.28;
            if (trans > 0.45) {
              const swirl = Math.sin(((trans - 0.45) / 0.55) * Math.PI);
              const curlAngle = rAng * 0.0245 + trans * 7.5;
              dx += (nx * 140 + Math.cos(curlAngle) * 64) * swirl;
              dy += ((ny * 90 + Math.sin(curlAngle) * 48) * swirl + p * colSpeed * 180) % CANVAS_H;
            } else {
              const snapEase = trans / 0.45;
              const shockRadius = (1 - snapEase) * 0.95;
              if (Math.abs(rDist - shockRadius) < 0.09) {
                palIdx = 7;
                lutGlyphIdx = Math.min(NUM_GLYPHS - 1, glyphIdx + 5);
              }
              dy -= snapEase * snapEase * colSpeed * 75;
            }
          }

          const rx = (Math.round(dx) + CANVAS_W) % CANVAS_W;
          const ry = (Math.round(dy) + CANVAS_H) % CANVAS_H;
          const colorAbgr = palAbgr[palIdx];
          const bmpOffset = lutGlyphIdx * 64;

          for (let gy = 0; gy < 8; gy++) {
            const py = ry + gy;
            if (py >= CANVAS_H) continue;
            const rowBase = py * CANVAS_W;
            const bmpRow = bmpOffset + gy * 8;
            for (let gx = 0; gx < 8; gx++) {
              if (glyphBitmaps[bmpRow + gx] === 1) {
                const px = rx + gx;
                if (px < CANVAS_W) {
                  u32[rowBase + px] = colorAbgr;
                }
              }
            }
          }
        }

        // Single-shot flush of all 3,600 cells + multi-scale mutations onto 1280×720 via crisp 2× nearest-neighbor blit!
        if (!lowResBlitCanvasRef.current) {
          lowResBlitCanvasRef.current = document.createElement('canvas');
          lowResBlitCanvasRef.current.width = CANVAS_W;
          lowResBlitCanvasRef.current.height = CANVAS_H;
        }
        const blitCanvas = lowResBlitCanvasRef.current;
        const blitCtx = blitCanvas.getContext('2d');
        if (blitCtx) {
          blitCtx.putImageData(imgData, 0, 0);
          const prevSmooth = ctx.imageSmoothingEnabled;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(blitCanvas, 0, 0, CANVAS_W, CANVAS_H);
          ctx.imageSmoothingEnabled = prevSmooth;
        }

        // Micro-Party style SoundCloud timed comment pop-over pill on Glyph Matrix
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
