import {
  ASCII_COUNT,
  CANVAS_H,
  CANVAS_W,
  CELL_H,
  CELL_W,
  drawMicroPartyCommentPill,
  NUM_PALETTE,
  packAbgr,
  rgbToCss,
  SIN_F32,
  SIN_U8,
  type ClassicSceneRuntimeRefs,
  type SceneRenderContext,
} from './classicShared';

export function renderDemosceneScene(scene: SceneRenderContext, rt: ClassicSceneRuntimeRefs): void {
  const {
    ctx,
    dt,
    timeSec,
    beat,
    trans,
    drop,
    subBass,
    highEnergy,
    sb,
    palette,
    cropBottomY,
  } = scene;
  const {
    activeLyricRef,
    commentAvatarImgRef,
    scrollerTextRef,
    starXRef,
    starYRef,
    starZRef,
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

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        const transWave = trans > 0.005 ? Math.sin(trans * Math.PI) : 0;
        const horizonY = Math.round(
          CANVAS_H * 0.46 + (trans > 0.005 ? Math.sin(trans * Math.PI * 2) * 28 * transWave : 0)
        );

        // 1. 3D Warp Starfield over pure #000000 sky
        const sx = starXRef.current;
        const sy = starYRef.current;
        const sz = starZRef.current;
        const warpSpeed = dt * (0.45 + subBass * 1.6 + drop * 2.2 + transWave * 5.2);
        ctx.fillStyle = rgbToCss(palette[7], 0.82);
        ctx.strokeStyle = rgbToCss(palette[6], 0.78);
        ctx.lineWidth = 1.4;

        const starCount = starXRef.current.length;
        for (let i = 0; i < starCount; i++) {
          const prevZ = sz[i];
          sz[i] -= warpSpeed;
          if (sz[i] <= 0.08) {
            sx[i] = (Math.random() - 0.5) * 2.4;
            sy[i] = (Math.random() - 0.5) * 1.4;
            sz[i] = 1.9;
            continue;
          }
          const projX = Math.round(CANVAS_W * 0.5 + (sx[i] / sz[i]) * 260);
          const projY = Math.round(horizonY * 0.75 + (sy[i] / sz[i]) * 140);
          if (projX >= 0 && projX < CANVAS_W && projY >= 0 && projY < horizonY + 30) {
            if (transWave > 0.15 || drop > 0.35) {
              const tailZ = Math.min(2.2, prevZ + (transWave + drop * 0.5) * 0.35);
              const tailX = Math.round(CANVAS_W * 0.5 + (sx[i] / tailZ) * 260);
              const tailY = Math.round(horizonY * 0.75 + (sy[i] / tailZ) * 140);
              ctx.beginPath();
              ctx.moveTo(tailX, tailY);
              ctx.lineTo(projX, projY);
              ctx.stroke();
            } else {
              const szPx = sz[i] < 0.6 ? 3 : sz[i] < 1.2 ? 2 : 1;
              ctx.fillRect(projX, projY, szPx, szPx);
            }
          }
        }

        // 2. Amiga-style Horizontal Copper Raster Spectrum Bars
        const rasterCount = transWave > 0.05 ? 16 : 10;
        for (let b = 0; b < rasterCount; b++) {
          const bandAmp = sb[b & 15];
          const wipeOffset =
            transWave > 0.05
              ? Math.sin(trans * Math.PI * 2 + b * 0.45) * 95 * transWave
              : 0;
          const yBase =
            24 +
            b * (transWave > 0.05 ? 20 : 12) +
            SIN_F32[(Math.floor(timeSec * 48) + b * 19) & 255] * (6 + subBass * 10) +
            wipeOffset;
          const barW = Math.round(
            Math.min(1, 0.18 + bandAmp * 0.78 + transWave * 0.45) * CANVAS_W
          );
          const barX = Math.round((CANVAS_W - barW) * 0.5);
          const palC = palette[2 + (b % 6)];
          const barH = transWave > 0.05 ? Math.round(4 + transWave * 8) : 4;
          ctx.fillStyle = rgbToCss(palC, 0.32 + bandAmp * 0.45 + transWave * 0.22);
          ctx.fillRect(barX, Math.round(yBase), barW, barH);
        }

        // 3. 3D Perspective Scrolling Vector Synth Grid
        const gridPal = palette[4] || [42, 163, 196];
        ctx.save();
        if (transWave > 0.01 || drop > 0.1) {
          const bankAngle = Math.sin((trans + drop * 0.3) * Math.PI * 2) * 0.14 * (transWave + drop * 0.4);
          ctx.translate(CANVAS_W * 0.5, horizonY);
          ctx.rotate(bankAngle);
          ctx.translate(-CANVAS_W * 0.5, -horizonY);
        }
        ctx.strokeStyle = rgbToCss(gridPal, 0.40 + subBass * 0.32 + transWave * 0.25);
        ctx.lineWidth = 1.2;
        ctx.beginPath();

        const vpx = CANVAS_W * 0.5 + SIN_F32[Math.floor(timeSec * 22) & 255] * 36;
        for (let v = -8; v <= 8; v++) {
          ctx.moveTo(vpx + v * 12, horizonY);
          ctx.lineTo(CANVAS_W * 0.5 + v * 78, CANVAS_H + 30);
        }

        const zScroll = (timeSec * (1.8 + subBass * 2.2 + transWave * 5.0)) % 1;
        for (let h = 0; h < 8; h++) {
          const normD = (h + zScroll) / 8;
          const y = horizonY + Math.pow(normD, 1.85) * (CANVAS_H - horizonY);
          ctx.moveTo(-40, y);
          ctx.lineTo(CANVAS_W + 40, y);
        }
        ctx.stroke();

        // 4. 16-Band Spectrum Pillars on the Horizon
        const pillarZoneW = CANVAS_W * 0.64;
        const pillarStartX = (CANVAS_W - pillarZoneW) * 0.5;
        const pillarStep = pillarZoneW / 16;
        for (let b = 0; b < 16; b++) {
          const h = Math.round(sb[b] * 68 + beat * 14 + transWave * 28);
          if (h <= 1) continue;
          const px = Math.round(pillarStartX + b * pillarStep);
          const pw = Math.max(4, Math.round(pillarStep - 4));
          ctx.fillStyle = rgbToCss(palette[Math.min(7, 3 + (b >>> 2))], 0.72);
          ctx.fillRect(px, horizonY - h, pw, h);
        }
        ctx.restore();

        // 5. Classic DYCP Sine-Wave Scroller (track title/artist/BPM when no timed SC comment pop-over is active)
        const scroller = scrollerTextRef.current;
        if (scroller.length > 0 && !effectiveComment) {
          const charW = 13;
          const scrollPx = Math.floor(timeSec * 95);
          const firstCharIdx = Math.floor(scrollPx / charW);
          const pixelRem = scrollPx % charW;
          const visibleChars = Math.ceil(CANVAS_W / charW) + 2;

          ctx.font = 'bold 15px "JetBrains Mono", "Fira Code", monospace';
          ctx.textBaseline = 'middle';

          const bounceAmp = 12 + subBass * 18 + beat * 8 + transWave * 34;
          const baseScrollerY = Math.min(CANVAS_H - 48, cropBottomY - 36);
          for (let c = 0; c < visibleChars; c++) {
            const ch = scroller[(firstCharIdx + c) % scroller.length];
            if (ch === ' ') continue;
            const x = c * charW - pixelRem;
            const sineIdx = (Math.floor(timeSec * 85) + (firstCharIdx + c) * 11) & 255;
            const y = baseScrollerY + SIN_F32[sineIdx] * bounceAmp;
            const cPal = palette[4 + ((firstCharIdx + c) & 3)];
            ctx.fillStyle = rgbToCss(cPal, 0.92);
            ctx.fillText(ch, Math.round(x), Math.round(y));
          }
        }

        // 6. Preferred AVS-Style Floating 3D Hologram Lyrics (always used when lyrics are active)
        const demoLyricText = (activeLyricRef.current || '').trim();
        if (demoLyricText.length > 0) {
          drawVertigoStyleHologram(
            demoLyricText,
            SIN_F32[Math.floor(timeSec * 22) & 255] * 4,
            0
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
