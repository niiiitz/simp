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
  type TrapperShard,
  type TrapperShapeKind,
} from './classicShared';

export function renderTrapperScene(scene: SceneRenderContext, rt: ClassicSceneRuntimeRefs): void {
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

        // Pure #000000 OLED deep-space backdrop
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        const transWave = trans > 0.005 ? Math.sin(trans * Math.PI) : 0;
        const horizonY = Math.round(
          CANVAS_H * 0.54 + (trans > 0.005 ? Math.sin(trans * Math.PI * 2) * 24 * transWave : 0)
        );

        // 1. Interleaved Amiga Copper Raster Horizon Lines (ultra-fine 1px scanlines, with curtain wipe on track transition!)
        const numRasters = transWave > 0.05 ? 18 : 12;
        for (let b = 0; b < numRasters; b++) {
          const bandAmp = sb[b & 15];
          const phase = timeSec * 2.2 + b * 0.38;
          const transCurtain =
            transWave > 0.05
              ? Math.sin(trans * Math.PI * 2 + b * 0.42) * 85 * transWave
              : 0;
          const ry = Math.round(
            horizonY -
              96 +
              b * 12 +
              Math.sin(phase) * (13 + subBass * 20 + drop * 16) +
              transCurtain
          );
          const barW = Math.round(
            CANVAS_W * Math.min(1, 0.32 + bandAmp * 0.58 + transWave * 0.38)
          );
          const barX = Math.round((CANVAS_W - barW) * 0.5);
          const palC = palette[2 + (b % 6)];
          const barH = transWave > 0.05 ? Math.round(1 + transWave * 3) : 1;
          ctx.fillStyle = rgbToCss(palC, 0.28 + bandAmp * 0.36 + transWave * 0.20);
          ctx.fillRect(barX, ry, barW, barH);
        }

        // 2. Bryce-3D Perspective Neon-Checkerboard Floor
        //    Moves strictly BACKWARD toward the horizon at a smooth integrated rate (never front-to-back!)
        //    with a gentle lateral camera sway.
        trapperFloorZRef.current += dt * (0.92 + subBass * 0.42 + transWave * 2.6);
        const floorScroll = trapperFloorZRef.current;
        // `frac` descends smoothly from 1.0 -> 0.0 so every tile row recedes backward toward horizonY!
        const frac = 1 - (floorScroll % 1);
        const rowParityBase = Math.floor(floorScroll) & 1;
        const floorSwayX = Math.sin(timeSec * 0.52) * 28;

        ctx.save();
        if (transWave > 0.01) {
          const bankAngle = Math.sin(trans * Math.PI * 2) * 0.14 * transWave;
          ctx.translate(CANVAS_W * 0.5, horizonY);
          ctx.rotate(bankAngle);
          ctx.translate(-CANVAS_W * 0.5, -horizonY);
        }

        const numFloorRows = 10;
        const numFloorCols = 12;
        for (let r = 0; r < numFloorRows; r++) {
          const d0 = Math.max(0, (r + frac) / numFloorRows);
          const d1 = Math.min(1, (r + 1 + frac) / numFloorRows);
          const y0 = horizonY + Math.pow(d0, 1.8) * (CANVAS_H - horizonY);
          const y1 = horizonY + Math.pow(d1, 1.8) * (CANVAS_H - horizonY);
          const span0 = 86 + Math.pow(d0, 1.45) * 620;
          const span1 = 86 + Math.pow(d1, 1.45) * 620;
          const sway0 = floorSwayX * (1 - d0 * 0.65);
          const sway1 = floorSwayX * (1 - d1 * 0.65);
          const rowParity = (r - rowParityBase) & 1;

          for (let c = -numFloorCols / 2; c < numFloorCols / 2; c++) {
            const isCheck = ((c + rowParity) & 1) === 0;
            if (!isCheck) continue; // Leave alternating tiles pure #000000 OLED black!
            const u0 = c / (numFloorCols * 0.5);
            const u1 = (c + 1) / (numFloorCols * 0.5);
            const x0a = CANVAS_W * 0.5 + sway0 + u0 * span0;
            const x0b = CANVAS_W * 0.5 + sway0 + u1 * span0;
            const x1b = CANVAS_W * 0.5 + sway1 + u1 * span1;
            const x1a = CANVAS_W * 0.5 + sway1 + u0 * span1;

            const tilePal = palette[3 + (Math.abs(c + r - rowParityBase) % 4)];
            const tileAlpha =
              (0.16 + d0 * 0.44) * (0.72 + subBass * 0.28 + transWave * 0.25);
            ctx.fillStyle = rgbToCss(tilePal, Math.min(0.85, tileAlpha));
            ctx.beginPath();
            ctx.moveTo(x0a, y0);
            ctx.lineTo(x0b, y0);
            ctx.lineTo(x1b, y1);
            ctx.lineTo(x1a, y1);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.restore();

        // 3. 90s Bryce-3D Geometric Arena:
        //    3 Shapes (0 = Chrome Sphere, 1 = Neon Pyramid, 2 = Bryce 3D Cube)
        //    Only 2 are active at once! They periodically clash in Rock-Paper-Scissors combat,
        //    shattering the loser into 3D wireframe shards before the missing 3rd shape warps in!
        const arena = trapperArenaRef.current;
        arena.timer += dt;

        if (arena.phase === 'float') {
          // Collisions occur ~25% as often (~27s cadence, or after 14s on a major beat drop)
          if (arena.timer >= 27.0 || (drop > 0.72 && arena.timer >= 14.0)) {
            arena.phase = 'charge';
            arena.timer = 0;
            arena.loserSide = getRpsLoserSide(arena.leftShape, arena.rightShape);
            arena.incomingShape = ((3 - arena.leftShape - arena.rightShape) % 3) as TrapperShapeKind;
          }
        } else if (arena.phase === 'charge') {
          if (arena.timer >= 1.05) {
            arena.phase = 'clash';
            arena.timer = 0;
            // Spawn 16 3D wireframe shards from the defeated shape at center stage!
            const impactX = CANVAS_W * 0.5 + (arena.loserSide === 'left' ? -24 : 24);
            const impactY = CANVAS_H * 0.36;
            const newShards: TrapperShard[] = [];
            for (let s = 0; s < 16; s++) {
              const ang = (s / 16) * Math.PI * 2 + (s & 1) * 0.2;
              const spd = 95 + (s % 5) * 42;
              newShards.push({
                x: impactX,
                y: impactY,
                vx: Math.cos(ang) * spd + (arena.loserSide === 'left' ? -55 : 55),
                vy: Math.sin(ang) * spd - 45,
                rot: s * 0.5,
                vrot: (s & 1 ? 1 : -1) * (5 + (s % 4) * 2),
                size: 8 + (s % 4) * 4,
                palIdx: 4 + (s & 3),
              });
            }
            arena.shards = newShards;
          }
        } else if (arena.phase === 'clash') {
          if (arena.timer >= 1.1) {
            arena.phase = 'challenger';
            arena.timer = 0;
            arena.challengerBannerCount += 1;
          }
        } else if (arena.phase === 'challenger') {
          if (arena.timer >= 1.55) {
            if (arena.loserSide === 'left') {
              arena.leftShape = arena.incomingShape;
            } else {
              arena.rightShape = arena.incomingShape;
            }
            arena.phase = 'float';
            arena.timer = 0;
            arena.shards = [];
          }
        }

        // Helper to draw any of the 3 Bryce-3D primitives:
        // 0 = Chrome Sphere, 1 = Neon Pyramid + Torus, 2 = Rotating 3D Bryce Cube
        const drawBrycePrimitive = (
          kind: TrapperShapeKind,
          cx: number,
          cy: number,
          scaleFactor: number,
          spinMult: number
        ) => {
          if (scaleFactor <= 0.02) return;
          const baseR = (42 + subBass * 15 + beat * 9) * scaleFactor;

          // Ground shadow on the receding checkerboard floor
          ctx.fillStyle = `rgba(0, 0, 0, ${(0.72 * Math.min(1, scaleFactor)).toFixed(2)})`;
          ctx.beginPath();
          ctx.ellipse(cx, horizonY + 26, baseR * 0.85, baseR * 0.22, 0, 0, Math.PI * 2);
          ctx.fill();

          if (kind === 0) {
            // --- SHAPE 0: BRYCE-3D RAYTRACED CHROME & LAT/LON SPHERE ---
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
            ctx.clip();

            const sGrad = ctx.createRadialGradient(
              cx - baseR * 0.35,
              cy - baseR * 0.35,
              baseR * 0.08,
              cx,
              cy,
              baseR
            );
            sGrad.addColorStop(0, rgbToCss(palette[7], 0.98));
            sGrad.addColorStop(0.45, rgbToCss(palette[5], 0.88));
            sGrad.addColorStop(0.78, rgbToCss(palette[2], 0.92));
            sGrad.addColorStop(1, '#000000');
            ctx.fillStyle = sGrad;
            ctx.fillRect(cx - baseR, cy - baseR, baseR * 2, baseR * 2);

            ctx.strokeStyle = rgbToCss(palette[7], 0.54);
            ctx.lineWidth = 0.9;
            const rotLon = timeSec * 1.45 * spinMult;
            for (let lat = -2; lat <= 2; lat++) {
              const latY = cy + (lat / 3) * baseR;
              const latRx = Math.sqrt(Math.max(0, baseR * baseR - (latY - cy) ** 2));
              ctx.beginPath();
              ctx.ellipse(cx, latY, latRx, latRx * 0.22, 0, 0, Math.PI * 2);
              ctx.stroke();
            }
            for (let lon = 0; lon < 4; lon++) {
              const a = rotLon + (lon * Math.PI) / 4;
              const rx = Math.abs(Math.cos(a)) * baseR;
              ctx.beginPath();
              ctx.ellipse(cx, cy, Math.max(2, rx), baseR, 0, 0, Math.PI * 2);
              ctx.stroke();
            }
            ctx.restore();
          } else if (kind === 1) {
            // --- SHAPE 1: BRYCE-3D SHADED PYRAMID / TRIANGLE & ORBITING TORUS ---
            const coneH = (52 + midEnergy * 20) * scaleFactor;
            const coneW = (40 + subBass * 14) * scaleFactor;
            const spin = timeSec * 1.3 * spinMult;

            const basePts: [number, number][] = [];
            for (let k = 0; k < 4; k++) {
              const ang = spin + k * (Math.PI * 0.5);
              basePts.push([
                cx + Math.cos(ang) * coneW,
                cy + coneH * 0.48 + Math.sin(ang) * coneW * 0.35,
              ]);
            }
            const apexX = cx + Math.sin(timeSec * 1.8) * 8 * scaleFactor;
            const apexY = cy - coneH * 0.65;

            for (let k = 0; k < 4; k++) {
              const p0 = basePts[k];
              const p1 = basePts[(k + 1) & 3];
              const facePal = palette[3 + ((k + Math.floor(timeSec * 2)) & 3)];
              ctx.fillStyle = rgbToCss(facePal, 0.46 + (k & 1) * 0.26);
              ctx.strokeStyle = rgbToCss(palette[7], 0.78);
              ctx.lineWidth = 1.0;
              ctx.beginPath();
              ctx.moveTo(apexX, apexY);
              ctx.lineTo(p0[0], p0[1]);
              ctx.lineTo(p1[0], p1[1]);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }

            ctx.save();
            ctx.translate(cx, cy + 5 * scaleFactor);
            ctx.rotate(Math.sin(timeSec * 1.15) * 0.45);
            ctx.strokeStyle = rgbToCss(palette[6], 0.80);
            ctx.lineWidth = (2.2 + beat * 1.5) * scaleFactor;
            ctx.beginPath();
            ctx.ellipse(0, 0, coneW * 1.42, coneW * 0.40, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = rgbToCss(palette[7], 0.88);
            ctx.lineWidth = 0.9;
            ctx.stroke();
            ctx.restore();
          } else {
            // --- SHAPE 2: BRYCE-3D ROTATING ISOMETRIC CUBE / SQUARE & INNER HYPERCUBE ---
            const cubeR = (36 + subBass * 14 + beat * 8) * scaleFactor;
            const ax = timeSec * 1.05 * spinMult;
            const ay = timeSec * 1.38 * spinMult;
            const az = timeSec * 0.72 * spinMult;
            const cxA = Math.cos(ax), sxA = Math.sin(ax);
            const cyA = Math.cos(ay), syA = Math.sin(ay);
            const czA = Math.cos(az), szA = Math.sin(az);

            const rawVerts: [number, number, number][] = [
              [-1, -1, -1],
              [1, -1, -1],
              [1, 1, -1],
              [-1, 1, -1],
              [-1, -1, 1],
              [1, -1, 1],
              [1, 1, 1],
              [-1, 1, 1],
            ];
            const projVerts: [number, number, number][] = rawVerts.map(([vx, vy, vz]) => {
              // Rotate X
              const y1 = vy * cxA - vz * sxA;
              const z1 = vy * sxA + vz * cxA;
              // Rotate Y
              const x2 = vx * cyA + z1 * syA;
              const z2 = -vx * syA + z1 * cyA;
              // Rotate Z
              const x3 = x2 * czA - y1 * szA;
              const y3 = x2 * szA + y1 * czA;
              const persp = 3.2 / (3.2 - z2 * 0.45);
              return [cx + x3 * cubeR * persp * 0.68, cy + y3 * cubeR * persp * 0.68, z2];
            });

            const faces: [number, number, number, number, number][] = [
              [0, 1, 2, 3, 3],
              [4, 5, 6, 7, 6],
              [0, 1, 5, 4, 4],
              [2, 3, 7, 6, 5],
              [0, 3, 7, 4, 2],
              [1, 2, 6, 5, 7],
            ];
            // Depth-sort faces back-to-front (Painter's Algorithm)
            faces.sort((fa, fb) => {
              const za =
                projVerts[fa[0]][2] +
                projVerts[fa[1]][2] +
                projVerts[fa[2]][2] +
                projVerts[fa[3]][2];
              const zb =
                projVerts[fb[0]][2] +
                projVerts[fb[1]][2] +
                projVerts[fb[2]][2] +
                projVerts[fb[3]][2];
              return za - zb;
            });

            for (let f = 0; f < faces.length; f++) {
              const [i0, i1, i2, i3, palSlot] = faces[f];
              const v0 = projVerts[i0];
              const v1 = projVerts[i1];
              const v2 = projVerts[i2];
              const v3 = projVerts[i3];
              const faceColor = palette[Math.min(7, palSlot)];
              ctx.fillStyle = rgbToCss(faceColor, f >= 3 ? 0.56 : 0.24);
              ctx.strokeStyle = rgbToCss(palette[7], f >= 3 ? 0.85 : 0.42);
              ctx.lineWidth = f >= 3 ? 1.1 : 0.8;
              ctx.beginPath();
              ctx.moveTo(v0[0], v0[1]);
              ctx.lineTo(v1[0], v1[1]);
              ctx.lineTo(v2[0], v2[1]);
              ctx.lineTo(v3[0], v3[1]);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
          }
        };

        // Compute Left & Right arena slot positions based on Rock-Paper-Scissors combat phase
        const homeLeftX = CANVAS_W * 0.27 + Math.sin(timeSec * 0.95) * 44;
        const homeRightX = CANVAS_W * 0.73 + Math.cos(timeSec * 0.85) * 44;
        const dropLift = trans > 0.005 ? Math.pow(trans, 2) * 95 : 0;
        const baseLeftY =
          CANVAS_H * 0.36 +
          Math.cos(timeSec * 1.35) * 18 -
          Math.abs(Math.sin(timeSec * 2.6)) * (14 + subBass * 26) -
          dropLift;
        const baseRightY =
          CANVAS_H * 0.36 +
          Math.sin(timeSec * 1.45) * 18 -
          Math.abs(Math.cos(timeSec * 2.4)) * (14 + subBass * 26) -
          dropLift;

        let leftX = homeLeftX;
        let rightX = homeRightX;
        let leftScale = 1.0;
        let rightScale = 1.0;
        let spinBoost = 1.0 + transWave * 2.5;

        if (arena.phase === 'charge') {
          const p = Math.min(1, arena.timer / 1.05);
          const ease = p * p;
          leftX = homeLeftX + (CANVAS_W * 0.43 - homeLeftX) * ease;
          rightX = homeRightX + (CANVAS_W * 0.57 - homeRightX) * ease;
          spinBoost = 1.0 + ease * 2.8;

          // Crackling RPS Duel Laser Tether between the two charging shapes
          ctx.strokeStyle = rgbToCss(palette[7], 0.65 + ease * 0.35);
          ctx.lineWidth = 1.8 + ease * 2.2;
          ctx.beginPath();
          const segs = 12;
          for (let s = 0; s <= segs; s++) {
            const u = s / segs;
            const lx = leftX + (rightX - leftX) * u;
            const ly =
              baseLeftY +
              (baseRightY - baseLeftY) * u +
              Math.sin(u * Math.PI) * Math.sin(timeSec * 38 + s * 2) * (14 * ease);
            if (s === 0) ctx.moveTo(lx, ly);
            else ctx.lineTo(lx, ly);
          }
          ctx.stroke();
        } else if (arena.phase === 'clash') {
          const p = Math.min(1, arena.timer / 1.1);
          spinBoost = 2.6 - p * 1.4;
          if (arena.loserSide === 'left') {
            leftScale = 0; // Left shape shattered!
            rightX = CANVAS_W * 0.48 + (homeRightX - CANVAS_W * 0.48) * p;
            rightScale = 1.18 - p * 0.18;
          } else {
            rightScale = 0; // Right shape shattered!
            leftX = CANVAS_W * 0.52 + (homeLeftX - CANVAS_W * 0.52) * p;
            leftScale = 1.18 - p * 0.18;
          }

          // Impact Shockwave Ring at center stage
          if (p < 0.65) {
            const shockP = p / 0.65;
            ctx.strokeStyle = rgbToCss(palette[7], (1 - shockP) * 0.9);
            ctx.lineWidth = 3.2 * (1 - shockP);
            ctx.beginPath();
            ctx.arc(CANVAS_W * 0.5, CANVAS_H * 0.36, 18 + shockP * 115, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (arena.phase === 'challenger') {
          const p = Math.min(1, arena.timer / 1.55);
          const warpScale = Math.min(1, p * 1.25);
          if (arena.loserSide === 'left') {
            drawBrycePrimitive(arena.incomingShape, homeLeftX, baseLeftY, warpScale, 2.4);
            leftScale = 0;
          } else {
            drawBrycePrimitive(arena.incomingShape, homeRightX, baseRightY, warpScale, 2.4);
            rightScale = 0;
          }

          // Teleportation Warp Rings & "A CHALLENGER APPROACHES!" Banner
          const spawnX = arena.loserSide === 'left' ? homeLeftX : homeRightX;
          const spawnY = arena.loserSide === 'left' ? baseLeftY : baseRightY;
          ctx.strokeStyle = rgbToCss(palette[6], (1 - p * 0.7) * 0.85);
          ctx.lineWidth = 2.0;
          ctx.beginPath();
          ctx.ellipse(
            spawnX,
            spawnY,
            54 * (1.2 - p * 0.4),
            18 * (1.2 - p * 0.4),
            timeSec * 3,
            0,
            Math.PI * 2
          );
          ctx.stroke();

          // Show the "CHALLENGER APPROACHES" text banner at most 3 times per track (unless Vertigo-style lyric hologram is currently active)
          const trpLyricActive =
            hasScCommentsRef.current &&
            hasLyricsRef.current &&
            Boolean(activeLyricRef.current && activeLyricRef.current.trim().length > 0);
          if (arena.challengerBannerCount <= 3 && !trpLyricActive) {
            const bannerAlpha = Math.sin(p * Math.PI);
            const bannerTopY = Math.round(Math.max(22, cropTopY + 18));
            ctx.save();
            ctx.font = 'bold 13px "JetBrains Mono", "Fira Code", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const bannerText = `⚡ CHALLENGER APPROACHES: ${TRAPPER_SHAPE_NAMES[arena.incomingShape]} ⚡`;
            ctx.fillStyle = `rgba(0, 0, 0, ${(0.72 * bannerAlpha).toFixed(2)})`;
            ctx.fillRect(CANVAS_W * 0.5 - 175, bannerTopY, 350, 24);
            ctx.strokeStyle = rgbToCss(palette[6], 0.85 * bannerAlpha);
            ctx.lineWidth = 1.4;
            ctx.strokeRect(CANVAS_W * 0.5 - 175, bannerTopY, 350, 24);
            ctx.fillStyle = rgbToCss(palette[7], 0.96 * bannerAlpha);
            ctx.fillText(bannerText, CANVAS_W * 0.5, bannerTopY + 12);
            ctx.restore();
          }
        }

        // Render the 2 active Bryce-3D shapes
        if (leftScale > 0.01) {
          drawBrycePrimitive(arena.leftShape, leftX, baseLeftY, leftScale, spinBoost);
        }
        if (rightScale > 0.01) {
          drawBrycePrimitive(arena.rightShape, rightX, baseRightY, rightScale, spinBoost);
        }

        // Step & render 3D Wireframe Shards when a shape is destroyed in RPS combat!
        if (arena.shards.length > 0) {
          for (let s = 0; s < arena.shards.length; s++) {
            const sh = arena.shards[s];
            sh.x += sh.vx * dt;
            sh.y += sh.vy * dt;
            sh.vy += 210 * dt; // Gravity toward checkerboard floor
            sh.rot += sh.vrot * dt;
            const sz = sh.size;
            ctx.save();
            ctx.translate(sh.x, sh.y);
            ctx.rotate(sh.rot);
            ctx.fillStyle = rgbToCss(palette[sh.palIdx], 0.65);
            ctx.strokeStyle = rgbToCss(palette[7], 0.92);
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(0, -sz);
            ctx.lineTo(sz * 0.86, sz * 0.6);
            ctx.lineTo(-sz * 0.86, sz * 0.6);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        }

        // 4. 3D Sine-Wave Demoscene Greetz Scroller near the floor level (when no timed SC comment pop-over is active)
        const scroller = scrollerTextRef.current;
        if (scroller.length > 0 && !effectiveComment) {
          const charW = 14;
          const scrollPx = Math.floor(timeSec * 102);
          const firstCharIdx = Math.floor(scrollPx / charW);
          const pixelRem = scrollPx % charW;
          const visibleChars = Math.ceil(CANVAS_W / charW) + 2;

          ctx.font = 'bold 16px "JetBrains Mono", "Fira Code", monospace';
          ctx.textBaseline = 'middle';

          const waveAmp = 11 + subBass * 16 + beat * 8 + drop * 12 + transWave * 26;
          const baseScrollerY = Math.min(CANVAS_H - 46, cropBottomY - 34);
          for (let c = 0; c < visibleChars; c++) {
            const ch = scroller[(firstCharIdx + c) % scroller.length];
            if (ch === ' ') continue;
            const x = c * charW - pixelRem;
            const sineIdx = (Math.floor(timeSec * 78) + (firstCharIdx + c) * 10) & 255;
            const zWave = COS_F32[sineIdx];
            const y = baseScrollerY + SIN_F32[sineIdx] * waveAmp;
            const cPal = palette[4 + ((firstCharIdx + c) & 3)];
            ctx.fillStyle = rgbToCss(cPal, 0.72 + (zWave * 0.5 + 0.5) * 0.28);
            ctx.fillText(ch, Math.round(x), Math.round(y));
          }
        }

        // 5. Preferred AVS-Style Floating 3D Hologram Lyrics (always used when lyrics are active)
        const trapperLyricText = (activeLyricRef.current || '').trim();
        if (trapperLyricText.length > 0) {
          drawVertigoStyleHologram(
            trapperLyricText,
            Math.sin(timeSec * 0.52) * 4,
            0
          );
        }

        // 6. Micro-Party style SoundCloud timed comment pop-over pill
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
