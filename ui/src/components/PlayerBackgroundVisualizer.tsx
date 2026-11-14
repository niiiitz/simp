import React, { useEffect, useRef } from 'react';
import { defaultSimpClient, type SoundCloudComment, type TrackMetadata } from '@simp/client';
import {
  getSceneDescriptor,
  loadEnabledVisualizerScenes,
  saveEnabledVisualizerScenes,
  VISUALIZER_ENGINES,
  VISUALIZER_MODES,
  VISUALIZER_SCENES,
  type VisualizerEngine,
  type VisualizerMode,
} from './visualizers/sceneRegistry';
import { isValidAttributedComment } from './visualizers/VisualizerOverlayHud';
import {
  CANVAS_H,
  CANVAS_W,
  RENDER_SCALE,
  type SceneRenderContext,
} from './visualizers/scenes/types';
import {
  ART_BUF_PIXELS,
  ART_BUF_SIZE,
  type ClassicSceneRuntimeRefs,
  DEFAULT_PALETTE_RGB,
  getGlyphBitmaps,
  GLYPH_RAMP,
  type GlyphMutationPatch,
  GRID_CELLS,
  GRID_COLS,
  GRID_ROWS,
  MAX_MUTATION_PATCHES,
  NUM_PALETTE,
  packAbgr,
  rgbToCss,
  SIN_F32,
  SOUNDCLOUD_PALETTE_RGB,
  type TrapperArenaState,
} from './visualizers/scenes/classicShared';
import { renderGlyphScene } from './visualizers/scenes/glyphScene';
import { renderDemosceneScene } from './visualizers/scenes/demosceneScene';
import { renderVertigoScene } from './visualizers/scenes/vertigoScene';
import { renderTrapperScene } from './visualizers/scenes/trapperScene';
import { renderMidnightScene } from './visualizers/scenes/midnightScene';
import { renderCosmosScene } from './visualizers/scenes/cosmosScene';
import { renderReef3dScene } from './visualizers/scenes/reef3dScene';
import { renderSanctumOdysseyScene } from './visualizers/scenes/sanctumOdysseyScene';
import { renderVaporwave3dScene } from './visualizers/scenes/vaporwave3dScene';
import { renderRhythmHologramScene } from './visualizers/scenes/rhythmHologramScene';
import { renderArcadeCrossfireScene } from './visualizers/scenes/arcadeCrossfireScene';
import { renderAvsV2Scene } from './visualizers/scenes/avsV2Scene';

export {
  getSceneDescriptor,
  loadEnabledVisualizerScenes,
  saveEnabledVisualizerScenes,
  VISUALIZER_ENGINES,
  VISUALIZER_MODES,
  VISUALIZER_SCENES,
  type VisualizerEngine,
  type VisualizerMode,
};

const UNIFIED_SCENE_RENDERERS: Record<
  VisualizerEngine,
  (sceneCtx: SceneRenderContext, rt: ClassicSceneRuntimeRefs) => void
> = {
  glyph: renderGlyphScene,
  demoscene: renderDemosceneScene,
  vertigo: renderVertigoScene,
  trapper: renderTrapperScene,
  midnight: (sceneCtx) => renderMidnightScene(sceneCtx),
  cosmos: (sceneCtx) => renderCosmosScene(sceneCtx),
  reef3d: (sceneCtx) => renderReef3dScene(sceneCtx),
  sanctum_odyssey: (sceneCtx) => renderSanctumOdysseyScene(sceneCtx),
  vaporwave3d: (sceneCtx) => renderVaporwave3dScene(sceneCtx),
  rhythm_hologram: (sceneCtx) => renderRhythmHologramScene(sceneCtx),
  arcade_crossfire: (sceneCtx) => renderArcadeCrossfireScene(sceneCtx),
  avs_v2: renderAvsV2Scene,
};

interface Props {
  mode: VisualizerMode;
  enabledScenes?: VisualizerEngine[];
  preferredScene?: VisualizerEngine | null;
  onActiveEngineChange?: (engine: VisualizerEngine) => void;
  isPlaying: boolean;
  track: TrackMetadata | null;
  artUrl?: string | null;
  bpm?: number | null;
  waveformBars?: number[] | null;
  activeComment?: SoundCloudComment | null;
  comments?: SoundCloudComment[];
  activeChapterLabel?: string | null;
  activeLyricLine?: string | null;
  nextLyricLine?: string | null;
  hasLyrics?: boolean;
  lyricsMarqueeFallback?: string | null;
  hidden?: boolean;
}

export const PlayerBackgroundVisualizer: React.FC<Props> = ({
  mode,
  enabledScenes,
  preferredScene = null,
  onActiveEngineChange,
  isPlaying,
  track,
  artUrl,
  bpm,
  waveformBars,
  activeComment: rawActiveComment,
  comments: rawComments,
  activeChapterLabel,
  activeLyricLine,
  nextLyricLine,
  hasLyrics = false,
  lyricsMarqueeFallback = null,
  hidden = false,
}) => {
  // Strictly enforce SoundCloud comment user attribution before any visualizer consumer sees it
  const activeComment = isValidAttributedComment(rawActiveComment) ? rawActiveComment : null;
  const comments = React.useMemo(
    () => (rawComments ? rawComments.filter(isValidAttributedComment) : []),
    [rawComments],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef<VisualizerMode>(mode);
  modeRef.current = mode;
  const enabledScenesRef = useRef<VisualizerEngine[]>(
    enabledScenes && enabledScenes.length > 0 ? enabledScenes : VISUALIZER_ENGINES,
  );
  enabledScenesRef.current =
    enabledScenes && enabledScenes.length > 0 ? enabledScenes : VISUALIZER_ENGINES;
  const preferredSceneRef = useRef<VisualizerEngine | null>(preferredScene || null);
  preferredSceneRef.current = preferredScene || null;
  const onActiveEngineChangeRef = useRef<((engine: VisualizerEngine) => void) | undefined>(
    onActiveEngineChange,
  );
  onActiveEngineChangeRef.current = onActiveEngineChange;
  const lastReportedEngineRef = useRef<VisualizerEngine | null>(null);
  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;
  const hiddenRef = useRef<boolean>(hidden);
  hiddenRef.current = hidden;
  const trackRef = useRef<TrackMetadata | null>(track);
  trackRef.current = track;
  const activeCommentRef = useRef<SoundCloudComment | null | undefined>(activeComment);
  activeCommentRef.current = activeComment;
  const commentsListRef = useRef<SoundCloudComment[]>(comments);
  commentsListRef.current = comments;
  const avatarImgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const activeLyricRef = useRef<string | null | undefined>(activeLyricLine);
  activeLyricRef.current = activeLyricLine;
  const nextLyricRef = useRef<string | null | undefined>(nextLyricLine);
  nextLyricRef.current = nextLyricLine;
  const hasScCommentsRef = useRef<boolean>(false);
  hasScCommentsRef.current = Boolean((comments && comments.length > 0) || activeComment);
  const hasLyricsRef = useRef<boolean>(false);
  hasLyricsRef.current = Boolean(
    hasLyrics ||
      activeLyricLine ||
      (lyricsMarqueeFallback && lyricsMarqueeFallback.trim().length > 0)
  );
  const lyricsMarqueeFallbackRef = useRef<string | null | undefined>(lyricsMarqueeFallback);
  lyricsMarqueeFallbackRef.current = lyricsMarqueeFallback;
  const prevLyricLineRef = useRef<string | null | undefined>(null);
  const vertigoLyricRevealRef = useRef<number>(1);

  // Offscreen buffers (created lazily once, zero per-frame allocations)
  const imageDataRef = useRef<ImageData | null>(null);
  const u32FrameRef = useRef<Uint32Array | null>(null);
  const lowResBlitCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const feedbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const artCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const artReadyRef = useRef<boolean>(false);
  const artSquareRgbRef = useRef<Uint8Array>(new Uint8Array(ART_BUF_PIXELS * 3));
  const commentAvatarImgRef = useRef<HTMLImageElement | null>(null);
  const paletteRef = useRef<[number, number, number][]>(DEFAULT_PALETTE_RGB);
  const paletteAbgrRef = useRef<Uint32Array>(
    new Uint32Array(DEFAULT_PALETTE_RGB.map(([r, g, b]) => packAbgr(r, g, b)))
  );

  // Unstretched 128x128 square artwork relief & Sobel edge map for slow panning
  const artSquareLumaRef = useRef<Float32Array>(new Float32Array(ART_BUF_PIXELS));
  const artSquareEdgeRef = useRef<Float32Array>(new Float32Array(ART_BUF_PIXELS));
  const avatarLumaGridRef = useRef<Float32Array>(new Float32Array(GRID_CELLS));
  const avatarBlendRef = useRef<number>(0);

  // Unstable Multi-Scale Glyph & Lyric Mutation Patches
  const mutationPatchesRef = useRef<GlyphMutationPatch[]>(
    Array.from({ length: MAX_MUTATION_PATCHES }, () => ({
      active: false,
      col: 0,
      row: 0,
      scale: 2,
      text: '',
      ttl: 0,
      maxTtl: 2.0,
      palIdx: 7,
      vertical: false,
    }))
  );
  // Per-frame cell occupancy map so 2x2 / 3x3 macro-glyph blocks cleanly override 1x1 cells
  const cellSkipMaskRef = useRef<Uint8Array>(new Uint8Array(GRID_CELLS));

  // Glitch & Scanline Tear buffers (zero per-frame heap allocations)
  const rowTearPxRef = useRef<Int16Array>(new Int16Array(GRID_ROWS));
  const rowCorruptMaskRef = useRef<Uint8Array>(new Uint8Array(GRID_ROWS));
  const glitchTimerRef = useRef<number>(0);
  const glitchSeedRef = useRef<number>(1337);
  const phaseAccumRef = useRef<number>(0);
  const simTimeSecRef = useRef<number>(0);
  const lastRenderedModeRef = useRef<VisualizerMode | null>(null);

  // Track transition impulse (1.0 -> 0.0 over ~1.25s when track.uri or mode changes)
  const prevTrackUriRef = useRef<string | undefined>(track?.uri);
  const prevTrackLogicalKeyRef = useRef<string>("");
  const prevModeRef = useRef<VisualizerMode>(mode);
  const cycleIndexRef = useRef<number>(0);
  const transitionImpulseRef = useRef<number>(0);

  // Live audio spectrum + Beat-Drop & Build-Up Detector state
  const targetBandsRef = useRef<Float32Array>(new Float32Array(16));
  const smoothBandsRef = useRef<Float32Array>(new Float32Array(16));
  const lastSpectrumTickPerfRef = useRef<number>(0);
  const rmsRef = useRef<number>(0.15);
  const peakRef = useRef<number>(0.25);
  const beatPulseRef = useRef<number>(0);
  const paletteCycleOffsetRef = useRef<number>(0);
  const playheadRatioRef = useRef<number>(0);

  // Beat-Drop & Breakdown/Build-Up State Machine
  const shortEnergyRef = useRef<number>(0.22);
  const longEnergyRef = useRef<number>(0.22);
  const buildupChargeRef = useRef<number>(0);
  const dropIntensityRef = useRef<number>(0);
  const dropCooldownRef = useRef<number>(0);
  const vertigoRollTargetRef = useRef<number>(0);
  const vertigoRollCurrentRef = useRef<number>(0);
  const vertigoTravelZRef = useRef<number>(0);
  const vertigoPulseZRef = useRef<number>(0);
  const vertigoSmoothSpineXRef = useRef<number>(0);
  const vertigoSmoothSpineYRef = useRef<number>(0);

  // 90s Bryce Trapper steady backward floor scroll & 2-of-3 Rock-Paper-Scissors Arena
  const trapperFloorZRef = useRef<number>(0);
  const trapperArenaRef = useRef<TrapperArenaState>({
    leftShape: 0,
    rightShape: 1,
    phase: 'float',
    timer: 0,
    loserSide: 'right',
    incomingShape: 2,
    challengerBannerCount: 0,
    shards: [],
  });

  // 3D Starfield Structure-of-Arrays (96 stars, zero GC)
  const starCount = 96;
  const starXRef = useRef<Float32Array>(new Float32Array(starCount));
  const starYRef = useRef<Float32Array>(new Float32Array(starCount));
  const starZRef = useRef<Float32Array>(new Float32Array(starCount));

  // Demoscene DYCP Scroller text & live typography strip
  const scrollerTextRef = useRef<string>('SIMP DEMOSCENE ENGINE // READY ');
  const glyphTextStripRef = useRef<string>('SIMP');

  const waveformBarsRef = useRef<number[] | null | undefined>(waveformBars);
  waveformBarsRef.current = waveformBars;
  const bpmRef = useRef<number>(bpm && bpm > 40 ? bpm : 120);
  bpmRef.current = bpm && bpm > 40 ? bpm : 120;

  const updatePaletteAbgr = (pal: [number, number, number][]) => {
    paletteRef.current = pal;
    const out = paletteAbgrRef.current;
    out[0] = 0xff000000; // True OLED #000000 floor in slot 0
    for (let i = 1; i < NUM_PALETTE; i++) {
      const rgb = pal[i] || DEFAULT_PALETTE_RGB[i];
      out[i] = packAbgr(rgb[0], rgb[1], rgb[2]);
    }
  };

  // Spawn an unstable multi-scale (2x2 or 3x3) glyph or lyric mutation patch
  const spawnGlyphMutation = (preferLyric = false, scaleOverride?: 2 | 3) => {
    const patches = mutationPatchesRef.current;
    let slot = patches.find((p) => !p.active);
    if (!slot) {
      slot = patches.reduce((oldest, cur) => (cur.ttl < oldest.ttl ? cur : oldest), patches[0]);
    }
    glitchSeedRef.current = (Math.imul(glitchSeedRef.current, 1664525) + 1013904223) >>> 0;
    const seed = glitchSeedRef.current;

    const lyric = (activeLyricRef.current || '').trim().toUpperCase();
    const titleUpper = (trackRef.current?.title || 'SIMP').trim().toUpperCase();
    const sourceText =
      preferLyric && lyric.length > 0
        ? lyric
        : lyric.length > 0 && (seed & 1) === 0
          ? lyric
          : titleUpper;

    const words = sourceText
      .replace(/[^A-Z0-9 !?#$&*@/-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    const chosenWord =
      words.length > 0
        ? words[(seed >>> 4) % words.length].slice(0, 12)
        : GLYPH_RAMP[8 + (seed & 7)].repeat(2);

    const scale: 2 | 3 = scaleOverride || ((seed & 3) === 0 ? 3 : 2);
    const vertical = (seed & 7) === 0 && chosenWord.length <= 7;
    const maxCol = Math.max(4, GRID_COLS - (vertical ? scale : chosenWord.length * scale) - 2);
    const maxRow = Math.max(4, GRID_ROWS - (vertical ? chosenWord.length * scale : scale) - 2);

    slot.active = true;
    slot.scale = scale;
    slot.vertical = vertical;
    slot.col = 2 + ((seed >>> 8) % maxCol);
    slot.row = 2 + ((seed >>> 16) % maxRow);
    slot.text = chosenWord;
    slot.maxTtl = 1.4 + ((seed >>> 20) & 15) * 0.14; // 1.4s .. 3.5s
    slot.ttl = slot.maxTtl;
    slot.palIdx = 5 + (seed % 3); // Bright palette indices 5..7
  };

  // Trigger a quantized CRT scanline tear + block datamosh burst
  const triggerGlitchBurst = (intensity: number) => {
    glitchTimerRef.current = Math.max(glitchTimerRef.current, Math.min(1, intensity));
    glitchSeedRef.current = (Math.imul(glitchSeedRef.current, 1664525) + 1013904223) >>> 0;
    const tears = rowTearPxRef.current;
    const corrupt = rowCorruptMaskRef.current;
    let seed = glitchSeedRef.current;

    const numSlices = 2 + (seed % 4);
    for (let s = 0; s < numSlices; s++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const startRow = seed % GRID_ROWS;
      const sliceH = 1 + ((seed >>> 8) % 5);
      const shiftCells = (((seed >>> 16) % 13) - 6) * (intensity > 0.6 ? 2 : 1);
      const shiftPx = shiftCells * 8;
      const isCorrupt = ((seed >>> 24) & 3) === 0 ? 1 : 0;
      for (let r = startRow; r < Math.min(GRID_ROWS, startRow + sliceH); r++) {
        tears[r] = shiftPx;
        corrupt[r] = isCorrupt;
      }
    }
    if (intensity > 0.42) {
      spawnGlyphMutation(false);
    }
  };

  // Initialize starfield & warm up 8x8 glyph bitmap LUT once
  useEffect(() => {
    const sx = starXRef.current;
    const sy = starYRef.current;
    const sz = starZRef.current;
    for (let i = 0; i < starCount; i++) {
      sx[i] = (Math.random() - 0.5) * 2.4;
      sy[i] = (Math.random() - 0.5) * 1.6;
      sz[i] = Math.random() * 1.8 + 0.2;
    }
    getGlyphBitmaps();
    updatePaletteAbgr(DEFAULT_PALETTE_RGB);
  }, []);

  // Spawn a lyric mutation whenever the synced lyric line advances
  useEffect(() => {
    if (activeLyricLine && activeLyricLine !== prevLyricLineRef.current) {
      prevLyricLineRef.current = activeLyricLine;
      vertigoLyricRevealRef.current = 0;
      spawnGlyphMutation(true, 3);
      spawnGlyphMutation(true, 2);
    } else if (!activeLyricLine) {
      prevLyricLineRef.current = null;
    }
  }, [activeLyricLine]);

  // Update typography & DYCP Greetz Scroller string when track / comments / chapter / lyrics change
  useEffect(() => {
    if (!track) {
      scrollerTextRef.current = 'SIMP AUDIO ENGINE // INSERT MEDIA ';
      glyphTextStripRef.current = 'SIMP // READY   ';
      return;
    }
    const titleUpper = (track.title || 'UNTITLED').toUpperCase();
    const artistUpper = (track.artists?.join(', ') || 'UNKNOWN ARTIST').toUpperCase();
    const bpmTag = bpm && bpm > 0 ? ` // ${Math.round(bpm)} BPM` : '';
    const chTag = activeChapterLabel ? ` // ${activeChapterLabel.toUpperCase()}` : '';
    glyphTextStripRef.current = activeLyricLine
      ? `>> ♪ ${activeLyricLine.toUpperCase()} ♪ <<      `
      : `// ${titleUpper} :: ${artistUpper}${bpmTag}${chTag} //      `;

    // DEMOSCENE & TRAPPER Bottom Sine-Wave Marquee:
    // Lyrics always render in the top AVS-style floating hologram and timed SoundCloud comments
    // render in the bottom Micro-Party pop-over pill, so the sine scroller stays dedicated to track metadata.
    scrollerTextRef.current = `   *** ${titleUpper} — ${artistUpper}${bpmTag}${chTag} ***   `;
  }, [
    track,
    bpm,
    activeComment,
    comments,
    activeChapterLabel,
    activeLyricLine,
    nextLyricLine,
    hasLyrics,
    lyricsMarqueeFallback,
  ]);

  // Trigger bespoke Track Transition Choreography on URI change OR visualizer mode switch
  useEffect(() => {
    const normalizeTrackLogicalKey = (t: TrackMetadata | null): string => {
      if (!t?.uri) return '';
      const titleKey = (t.title || '').trim().toLowerCase();
      const artistKey = (t.artists?.[0] || '').trim().toLowerCase();
      if (titleKey && artistKey) {
        return `${titleKey}::${artistKey}`;
      }
      return t.uri;
    };
    const nextLogicalKey = normalizeTrackLogicalKey(track);
    const hadPreviousTrack = Boolean(prevTrackUriRef.current);
    const uriChanged = Boolean(
      track?.uri &&
        track.uri !== prevTrackUriRef.current &&
        (!hadPreviousTrack || nextLogicalKey !== prevTrackLogicalKeyRef.current)
    );
    const modeChanged = mode !== prevModeRef.current && mode !== 'off';
    if (track?.uri) {
      prevTrackUriRef.current = track.uri;
      prevTrackLogicalKeyRef.current = nextLogicalKey;
    }
    if (uriChanged && hadPreviousTrack) {
      const pool =
        enabledScenesRef.current.length > 0 ? enabledScenesRef.current : VISUALIZER_ENGINES;
      if (mode === 'shuffle' && pool.length > 1) {
        const currentIdx = cycleIndexRef.current % pool.length;
        const offset = 1 + Math.floor(Math.random() * (pool.length - 1));
        cycleIndexRef.current = (currentIdx + offset) % pool.length;
      } else {
        cycleIndexRef.current = (cycleIndexRef.current + 1) % pool.length;
      }
      // Clear any lingering glyph mutations from the previous track
      for (const p of mutationPatchesRef.current) {
        p.active = false;
      }
      prevLyricLineRef.current = null;
      vertigoLyricRevealRef.current = 0;
      trapperArenaRef.current.challengerBannerCount = 0;
    }
    if ((uriChanged && hadPreviousTrack) || modeChanged) {
      prevModeRef.current = mode;
      transitionImpulseRef.current = 1.0;
      lastRenderedModeRef.current = null;
      triggerGlitchBurst(0.95);
      spawnGlyphMutation(true, 3);
    }
  }, [track?.uri, track?.title, mode]);

  // Sample Album Artwork into an UNSTRETCHED 128x128 Square Relief + Sobel Edge Map + 8-Color Palette
  useEffect(() => {
    const isSc = Boolean(track?.uri?.startsWith('soundcloud:'));
    const fallbackPal = isSc ? SOUNDCLOUD_PALETTE_RGB : DEFAULT_PALETTE_RGB;

    const buildSyntheticRelief = (seedStr: string) => {
      const luma = artSquareLumaRef.current;
      const edge = artSquareEdgeRef.current;
      let h = 2166136261;
      for (let i = 0; i < seedStr.length; i++) {
        h ^= seedStr.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const freqX = 2.0 + ((h >>> 0) % 5) * 0.6;
      const freqY = 2.0 + (((h >>> 8) & 0xff) % 5) * 0.6;
      for (let r = 0; r < ART_BUF_SIZE; r++) {
        const ny = (r + 0.5) / ART_BUF_SIZE - 0.5;
        for (let c = 0; c < ART_BUF_SIZE; c++) {
          const idx = r * ART_BUF_SIZE + c;
          const nx = (c + 0.5) / ART_BUF_SIZE - 0.5;
          const dist = Math.sqrt(nx * nx + ny * ny);
          const radial = Math.max(0, 1 - dist * 1.45);
          const pat =
            0.5 +
            0.25 * Math.cos(nx * freqX * Math.PI * 2) +
            0.25 * Math.sin(ny * freqY * Math.PI * 2);
          luma[idx] = Math.max(0.02, Math.min(1, radial * pat));
          edge[idx] = Math.abs(Math.sin(dist * 16)) * radial * 0.55;
        }
      }
      artCanvasRef.current = null;
      artReadyRef.current = false;
      updatePaletteAbgr(fallbackPal);
    };

    if (!artUrl) {
      buildSyntheticRelief(track?.uri || 'simp');
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const off = document.createElement('canvas');
        off.width = ART_BUF_SIZE;
        off.height = ART_BUF_SIZE;
        const octx = off.getContext('2d', { willReadFrequently: true });
        if (!octx) {
          buildSyntheticRelief(track?.uri || 'simp');
          return;
        }
        // Center-crop square without stretching aspect ratio
        const iw = img.naturalWidth || ART_BUF_SIZE;
        const ih = img.naturalHeight || ART_BUF_SIZE;
        const side = Math.min(iw, ih);
        const sx = Math.floor((iw - side) * 0.5);
        const sy = Math.floor((ih - side) * 0.5);
        octx.drawImage(img, sx, sy, side, side, 0, 0, ART_BUF_SIZE, ART_BUF_SIZE);
        artCanvasRef.current = off;
        artReadyRef.current = true;
        const data = octx.getImageData(0, 0, ART_BUF_SIZE, ART_BUF_SIZE).data;

        const luma = artSquareLumaRef.current;
        const rgbBuf = artSquareRgbRef.current;
        const edge = artSquareEdgeRef.current;
        const colorSamples: { luma: number; sat: number; rgb: [number, number, number] }[] = [];

        for (let i = 0; i < ART_BUF_PIXELS; i++) {
          const p = i * 4;
          const r = data[p];
          const g = data[p + 1];
          const b = data[p + 2];
          rgbBuf[i * 3] = r;
          rgbBuf[i * 3 + 1] = g;
          rgbBuf[i * 3 + 2] = b;
          const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          luma[i] = y;

          if (i % 32 === 0) {
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
            if (y > 0.12 && y < 0.94) {
              const boost = 1.28;
              const avg = (r + g + b) / 3;
              const br = Math.max(12, Math.min(255, Math.round(avg + (r - avg) * boost)));
              const bg = Math.max(12, Math.min(255, Math.round(avg + (g - avg) * boost)));
              const bb = Math.max(12, Math.min(255, Math.round(avg + (b - avg) * boost)));
              colorSamples.push({ luma: y, sat, rgb: [br, bg, bb] });
            }
          }
        }

        // Compute Sobel edge relief on the 128x128 unstretched square buffer
        for (let r = 0; r < ART_BUF_SIZE; r++) {
          for (let c = 0; c < ART_BUF_SIZE; c++) {
            const idx = r * ART_BUF_SIZE + c;
            if (r === 0 || r === ART_BUF_SIZE - 1 || c === 0 || c === ART_BUF_SIZE - 1) {
              edge[idx] = 0;
              continue;
            }
            const gx =
              -luma[(r - 1) * ART_BUF_SIZE + (c - 1)] +
              luma[(r - 1) * ART_BUF_SIZE + (c + 1)] -
              2 * luma[r * ART_BUF_SIZE + (c - 1)] +
              2 * luma[r * ART_BUF_SIZE + (c + 1)] -
              luma[(r + 1) * ART_BUF_SIZE + (c - 1)] +
              luma[(r + 1) * ART_BUF_SIZE + (c + 1)];
            const gy =
              -luma[(r - 1) * ART_BUF_SIZE + (c - 1)] -
              2 * luma[(r - 1) * ART_BUF_SIZE + c] -
              luma[(r - 1) * ART_BUF_SIZE + (c + 1)] +
              luma[(r + 1) * ART_BUF_SIZE + (c - 1)] +
              2 * luma[(r + 1) * ART_BUF_SIZE + c] +
              luma[(r + 1) * ART_BUF_SIZE + (c + 1)];
            edge[idx] = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 1.45);
          }
        }

        if (colorSamples.length >= 16) {
          colorSamples.sort((a, b) => a.luma + a.sat * 0.25 - (b.luma + b.sat * 0.25));
          // Slot 0 is strictly [0, 0, 0] for true OLED black
          const nextPal: [number, number, number][] = [[0, 0, 0]];
          for (let k = 1; k < 7; k++) {
            const pickIdx = Math.min(
              colorSamples.length - 1,
              Math.floor((k / 7) * colorSamples.length)
            );
            nextPal.push(colorSamples[pickIdx].rgb);
          }
          const top = colorSamples[colorSamples.length - 1].rgb;
          nextPal.push([
            Math.min(255, top[0] + 45),
            Math.min(255, top[1] + 45),
            Math.min(255, top[2] + 45),
          ]);
          updatePaletteAbgr(nextPal);
        } else {
          updatePaletteAbgr(fallbackPal);
        }
      } catch {
        buildSyntheticRelief(track?.uri || 'simp');
      }
    };
    img.onerror = () => {
      if (!cancelled) buildSyntheticRelief(track?.uri || 'simp');
    };
    img.src = artUrl;

    return () => {
      cancelled = true;
    };
  }, [artUrl, track?.uri]);

  // Sample SoundCloud commenter avatar into `avatarLumaGridRef` + trigger glitch pop when a timed comment arrives
  useEffect(() => {
    if (!activeComment?.avatar_url) {
      avatarBlendRef.current = 0;
      commentAvatarImgRef.current = null;
      return;
    }
    triggerGlitchBurst(0.65);
    spawnGlyphMutation(false, 2);
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      commentAvatarImgRef.current = img;
      try {
        const off = document.createElement('canvas');
        off.width = GRID_COLS;
        off.height = GRID_ROWS;
        const octx = off.getContext('2d', { willReadFrequently: true });
        if (!octx) return;
        octx.drawImage(img, 0, 0, GRID_COLS, GRID_ROWS);
        const data = octx.getImageData(0, 0, GRID_COLS, GRID_ROWS).data;
        const avGrid = avatarLumaGridRef.current;
        for (let i = 0; i < GRID_CELLS; i++) {
          const p = i * 4;
          avGrid[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
        }
        avatarBlendRef.current = 0.44;
      } catch {
        avatarBlendRef.current = 0;
      }
    };
    img.src = activeComment.avatar_url;
    return () => {
      cancelled = true;
    };
  }, [activeComment?.id, activeComment?.avatar_url]);

  // Subscribe to real-time 16-band AudioSpectrumTick + playhead progress
  useEffect(() => {
    const unsubSpec = defaultSimpClient.subscribeSpectrum((frame) => {
      lastSpectrumTickPerfRef.current = frame.timestamp;
      rmsRef.current = frame.rms;
      peakRef.current = frame.peak;
      if (frame.onset > 0.16) {
        beatPulseRef.current = Math.min(1, Math.max(beatPulseRef.current, frame.onset * 1.25));
        if (frame.onset > 0.34) {
          paletteCycleOffsetRef.current = (paletteCycleOffsetRef.current + 1) & 7;
          triggerGlitchBurst(Math.min(1, frame.onset * 1.35));
          // Trigger Beat-Drop if we had buildup charge or strong onset spike
          if (dropCooldownRef.current <= 0 && (buildupChargeRef.current > 0.25 || frame.onset > 0.48)) {
            dropIntensityRef.current = 1.0;
            dropCooldownRef.current = 3.5;
            buildupChargeRef.current = 0;
            vertigoRollTargetRef.current += (Math.PI * 0.5) * ((glitchSeedRef.current & 1) === 0 ? 1 : -1);
            spawnGlyphMutation(true, 3);
          }
        }
      }
      const tb = targetBandsRef.current;
      const len = Math.min(16, frame.bands.length);
      for (let i = 0; i < len; i++) {
        tb[i] = frame.bands[i] / 255;
      }
    });

    const unsubProg = defaultSimpClient.subscribeProgress((posMs) => {
      const dur = track?.duration_ms || 0;
      playheadRatioRef.current = dur > 0 ? Math.max(0, Math.min(1, posMs / dur)) : 0;
    });

    return () => {
      unsubSpec();
      unsubProg();
    };
  }, [track?.duration_ms]);

  // Main Hardware-Accelerated 30fps Canvas Loop (0 FPS complete freeze when paused, OLED Black Floor)
  useEffect(() => {
    if (mode === 'off' || hidden) {
      return;
    }

    // When playback is paused, freeze the animation completely at 0 FPS.
    // Only render a single static preview frame if the canvas hasn't rendered this mode yet.
    if (!isPlaying && lastRenderedModeRef.current === mode) {
      return;
    }

    let rafId = 0;
    let frameCount = 0;
    let lastFramePerf = performance.now();
    const glyphBitmaps = getGlyphBitmaps();

    const renderFrame = (nowPerf: number) => {
      const playing = isPlayingRef.current;
      if (playing) {
        rafId = requestAnimationFrame(renderFrame);
      }

      if (document.visibilityState === 'hidden' || hiddenRef.current || modeRef.current === 'off') {
        return;
      }

      // Frame rate governor:
      // - 30 FPS (32ms budget) when actively playing
      // - 0 FPS when paused (at most 1 static preview frame if mode changed while paused)
      if (playing) {
        const elapsedMs = nowPerf - lastFramePerf;
        if (elapsedMs < 32.0) {
          return;
        }
        frameCount++;
        const dt = Math.min(0.08, Math.max(0.008, elapsedMs * 0.001));
        lastFramePerf = nowPerf;
        simTimeSecRef.current += dt;
      } else {
        lastFramePerf = nowPerf;
      }

      const dt = playing ? 0.033 : 0;
      const timeSec = simTimeSecRef.current;
      lastRenderedModeRef.current = modeRef.current;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      // Supersample logical 640×360 coordinate space onto the 1280×720 High-DPI backing buffer
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);

      // 1. Update or synthesize 16-band audio spectrum (fallback when Widevine browser worker is active)
      const tb = targetBandsRef.current;
      const sb = smoothBandsRef.current;
      const timeSinceRealSpectrum = nowPerf - lastSpectrumTickPerfRef.current;

      if (!playing) {
        // Freeze existing spectrum bands in place when paused (or seed gentle static values on initial load)
        let hasAnyBand = false;
        for (let b = 0; b < 16; b++) {
          if (sb[b] > 0.01) {
            hasAnyBand = true;
            break;
          }
        }
        if (!hasAnyBand) {
          for (let b = 0; b < 16; b++) {
            tb[b] = 0.12 + 0.06 * SIN_F32[(b * 16) & 255];
            sb[b] = tb[b];
          }
        }
      } else if (timeSinceRealSpectrum > 260) {
        const wf = waveformBarsRef.current;
        const wfIdx =
          wf && wf.length > 0
            ? Math.min(wf.length - 1, Math.floor(playheadRatioRef.current * wf.length))
            : -1;
        const envAmp = wfIdx >= 0 && wf ? wf[wfIdx] : 0.48;
        const prevWfAmp = wfIdx > 2 && wf ? wf[wfIdx - 2] : envAmp;
        const beatHz = (bpmRef.current || 120) / 60;
        const beatPhase = (timeSec * beatHz) % 1;
        const synthKick = Math.pow(Math.max(0, 1 - beatPhase * 3.2), 2.2) * envAmp;
        if (beatPhase < 0.08 && beatPulseRef.current < 0.35) {
          beatPulseRef.current = 0.72 * envAmp;
          if (envAmp > 0.52) {
            triggerGlitchBurst(envAmp * 0.75);
          }
          // Detect waveform beat-drop jump
          if (dropCooldownRef.current <= 0 && envAmp - prevWfAmp > 0.22 && envAmp > 0.62) {
            dropIntensityRef.current = 1.0;
            dropCooldownRef.current = 3.5;
            buildupChargeRef.current = 0;
            vertigoRollTargetRef.current += (Math.PI * 0.5) * ((frameCount & 1) === 0 ? 1 : -1);
            spawnGlyphMutation(true, 3);
          }
        }
        rmsRef.current = envAmp * (0.45 + 0.35 * synthKick);
        peakRef.current = Math.min(1, envAmp * (0.65 + 0.35 * synthKick));
        for (let b = 0; b < 16; b++) {
          const wave =
            0.5 +
            0.5 *
              SIN_F32[
                (Math.floor(timeSec * (28 + b * 7) + b * 23 + wfIdx * 7) & 255)
              ];
          tb[b] = Math.min(
            1,
            envAmp * (b < 4 ? 0.55 + 0.45 * synthKick : 0.25 + 0.65 * wave)
          );
        }
      }

      // Smooth attack / deliberate release for the 16 bands
      let subBass = 0;
      let midEnergy = 0;
      let highEnergy = 0;
      for (let i = 0; i < 16; i++) {
        const target = tb[i];
        const cur = sb[i];
        const next = target > cur ? cur + (target - cur) * 0.48 : cur + (target - cur) * 0.15;
        sb[i] = next;
        if (i < 4) subBass += next;
        else if (i < 10) midEnergy += next;
        else highEnergy += next;
      }
      subBass *= 0.25;
      midEnergy /= 6;
      highEnergy /= 6;

      // Update Beat-Drop & Breakdown/Build-Up Detector
      const instantEnergy = subBass * 0.55 + midEnergy * 0.30 + highEnergy * 0.15;
      shortEnergyRef.current += (instantEnergy - shortEnergyRef.current) * Math.min(1, dt * 3.2);
      longEnergyRef.current += (instantEnergy - longEnergyRef.current) * Math.min(1, dt * 0.35);
      if (dropCooldownRef.current > 0) {
        dropCooldownRef.current = Math.max(0, dropCooldownRef.current - dt);
      }
      if (dropIntensityRef.current > 0) {
        dropIntensityRef.current = Math.max(0, dropIntensityRef.current - dt * 0.32);
      }

      // Breakdown / Build-up charge accumulation when bass drops out or high-frequency risers climb
      const isBreakdownOrRiser =
        shortEnergyRef.current < longEnergyRef.current * 0.78 ||
        (highEnergy > subBass * 1.05 && highEnergy > 0.28);
      if (isBreakdownOrRiser && dropIntensityRef.current < 0.2) {
        buildupChargeRef.current = Math.min(1, buildupChargeRef.current + dt * 0.35);
      } else {
        buildupChargeRef.current = Math.max(0, buildupChargeRef.current - dt * 0.15);
      }

      // Trigger Beat-Drop when sub-bass slams back in after a build-up/breakdown
      if (
        dropCooldownRef.current <= 0 &&
        buildupChargeRef.current > 0.28 &&
        subBass > 0.46 &&
        shortEnergyRef.current > longEnergyRef.current * 1.16
      ) {
        dropIntensityRef.current = 1.0;
        dropCooldownRef.current = 3.8;
        buildupChargeRef.current = 0;
        vertigoRollTargetRef.current += (Math.PI * 0.5) * ((frameCount & 1) === 0 ? 1 : -1);
        triggerGlitchBurst(0.85);
        spawnGlyphMutation(true, 3);
      }

      // Periodic organic mutation & micro-glitch
      if (highEnergy > 0.56 && glitchTimerRef.current <= 0.05 && (frameCount & 7) === 0) {
        triggerGlitchBurst(0.48);
      } else if ((frameCount & 63) === 0 && isPlayingRef.current) {
        spawnGlyphMutation(Boolean(activeLyricRef.current));
      }

      // Music-coupled phase accumulator
      const bpmFactor = Math.max(0.6, Math.min(1.6, (bpmRef.current || 120) / 120));
      phaseAccumRef.current += dt * (14 * bpmFactor + subBass * 38 + beatPulseRef.current * 24);

      // Decay beat pulse, glitch tear timer & transition shatter impulse
      beatPulseRef.current = Math.max(0, beatPulseRef.current - dt * 2.4);
      if (glitchTimerRef.current > 0) {
        glitchTimerRef.current = Math.max(0, glitchTimerRef.current - dt * 3.8);
        if (glitchTimerRef.current <= 0.01) {
          rowTearPxRef.current.fill(0);
          rowCorruptMaskRef.current.fill(0);
        }
      }
      if (transitionImpulseRef.current > 0) {
        transitionImpulseRef.current = Math.max(0, transitionImpulseRef.current - dt * 0.80);
      }
      if (avatarBlendRef.current > 0 && !activeCommentRef.current) {
        avatarBlendRef.current = Math.max(0, avatarBlendRef.current - dt * 0.5);
      }

      const beat = beatPulseRef.current;
      const glitch = glitchTimerRef.current;
      const trans = transitionImpulseRef.current;
      const drop = dropIntensityRef.current;
      const buildup = buildupChargeRef.current;
      const palette = paletteRef.current;
      const palAbgr = paletteAbgrRef.current;
      const pool =
        enabledScenesRef.current.length > 0 ? enabledScenesRef.current : VISUALIZER_ENGINES;
      const activeMode: VisualizerEngine = preferredSceneRef.current
        ? preferredSceneRef.current
        : modeRef.current === 'cycle' || modeRef.current === 'shuffle'
          ? pool[cycleIndexRef.current % pool.length]
          : (modeRef.current as VisualizerEngine);

      if (lastReportedEngineRef.current !== activeMode) {
        lastReportedEngineRef.current = activeMode;
        if (onActiveEngineChangeRef.current) {
          onActiveEngineChangeRef.current(activeMode);
        }
      }

      // Exact viewport crop calculation for `objectFit: 'cover'` on ultra-wide (21:9, 32:9) and tall/16:10 (1280×800 Steam Deck) displays
      const clientW = canvas.clientWidth || CANVAS_W;
      const clientH = canvas.clientHeight || CANVAS_H;
      const visibleCanvasH =
        clientW > 0 && clientH > 0
          ? Math.min(CANVAS_H, CANVAS_W * (clientH / clientW))
          : CANVAS_H;
      const cropTopY = Math.max(0, (CANVAS_H - visibleCanvasH) * 0.5);
      const cropBottomY = CANVAS_H - cropTopY;
      const visibleCanvasW =
        clientW > 0 && clientH > 0
          ? Math.min(CANVAS_W, CANVAS_H * (clientW / clientH))
          : CANVAS_W;
      const cropLeftX = Math.max(0, (CANVAS_W - visibleCanvasW) * 0.5);
      const cropRightX = CANVAS_W - cropLeftX;

      // Shared Vertigo-Style Floating 3D Hologram Lyric Banner
      // Used by VERTIGO (for lyrics/comments) and by DEMOSCENE & TRAPPER when BOTH Lyrics and SC Comments exist
      const drawVertigoStyleHologram = (
        rawText: string,
        targetAnchorX = 0,
        targetAnchorY = 0
      ) => {
        const trimmed = rawText.trim();
        if (trimmed.length === 0) return;

        vertigoLyricRevealRef.current = Math.min(1, vertigoLyricRevealRef.current + dt * 3.6);
        const reveal = vertigoLyricRevealRef.current;

        vertigoSmoothSpineXRef.current +=
          (targetAnchorX - vertigoSmoothSpineXRef.current) * Math.min(1, dt * 5.0);
        vertigoSmoothSpineYRef.current +=
          (targetAnchorY - vertigoSmoothSpineYRef.current) * Math.min(1, dt * 5.0);

        const upperText = trimmed.toUpperCase();
        // Word-wrap long lyric lines into 1 or 2 balanced lines so ZERO characters are ever cut off!
        const lines: string[] = [];
        if (upperText.length <= 36) {
          lines.push(upperText);
        } else {
          const mid = Math.floor(upperText.length * 0.5);
          let splitAt = upperText.lastIndexOf(' ', mid + 8);
          if (splitAt <= 6) splitAt = upperText.indexOf(' ', mid);
          if (splitAt > 0) {
            lines.push(upperText.slice(0, splitAt).trim());
            lines.push(upperText.slice(splitAt + 1).trim());
          } else {
            lines.push(upperText);
          }
        }

        const maxLineChars = Math.max(...lines.map((l) => l.length), 1);
        const maxFontPx = lines.length > 1 ? 14 : 16;
        // Dynamically size font so the full line always fits inside 82% of canvas width
        const fontPx = Math.max(
          11,
          Math.min(maxFontPx, Math.floor((CANVAS_W * 0.82) / (maxLineChars * 0.62)))
        );
        const lineH = fontPx + 4;
        const boxW = Math.min(
          CANVAS_W - 28,
          Math.round(maxLineChars * fontPx * 0.62 + 26)
        );
        const boxH = lines.length * lineH + 10;

        const holoX =
          CANVAS_W * 0.5 +
          vertigoSmoothSpineXRef.current +
          Math.sin(timeSec * 1.1) * 7;
        // Dynamically offset below `cropTopY` so 2-line lyrics are never cropped on ultra-wide (21:9 / 32:9) displays
        const safeTopY = Math.max(28, cropTopY + 18);
        const minCenterY = safeTopY + boxH * 0.5;
        const rawHoloY =
          minCenterY +
          6 +
          vertigoSmoothSpineYRef.current +
          Math.cos(timeSec * 1.25) * 2.5 -
          (1 - reveal) * 5;
        const maxCenterY = Math.max(minCenterY, minCenterY + 22);
        const holoY = Math.max(minCenterY, Math.min(maxCenterY, rawHoloY));

        ctx.save();
        ctx.translate(holoX, holoY);

        // Translucent borderless backing pill (matches AVS lyric style)
        ctx.fillStyle = `rgba(6, 7, 12, ${(0.68 * reveal).toFixed(2)})`;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(-boxW * 0.5, -boxH * 0.5, boxW, boxH, 10);
        } else {
          ctx.rect(-boxW * 0.5, -boxH * 0.5, boxW, boxH);
        }
        ctx.fill();

        ctx.font = `bold ${fontPx}px "JetBrains Mono", "Fira Code", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Subtle upper tunnel-echo ghost stamp (matches AVS tunnel echo depth)
        ctx.fillStyle = rgbToCss(palette[5], (0.18 + beat * 0.12) * reveal);
        for (let li = 0; li < lines.length; li++) {
          const ly = (li - (lines.length - 1) * 0.5) * lineH;
          ctx.fillText(lines[li], 0, ly - 5);
        }

        for (let li = 0; li < lines.length; li++) {
          const ly = (li - (lines.length - 1) * 0.5) * lineH;
          // Subtle cyan/palette drop-shadow for crisp legibility over bright visualizer elements
          ctx.fillStyle = rgbToCss(palette[4], 0.85 * reveal);
          ctx.fillText(lines[li], 1.5, ly + 1.5);
          ctx.fillStyle = rgbToCss(palette[7], (0.92 + beat * 0.08) * reveal);
          ctx.fillText(lines[li], 0, ly);
        }
        ctx.restore();
      };

      // Strictly use the temporal timed comment (`activeCommentRef.current`) so comments
      // appear only during their timed window along the track and never loop endlessly.
      const effectiveComment: SoundCloudComment | null = activeCommentRef.current || null;
      let effectiveAvatarImg: HTMLImageElement | null = null;
      if (effectiveComment?.avatar_url) {
        const avUrl = effectiveComment.avatar_url;
        const cachedAv = avatarImgCacheRef.current.get(avUrl);
        if (cachedAv) {
          effectiveAvatarImg = cachedAv.complete && cachedAv.naturalWidth > 0 ? cachedAv : null;
        } else {
          if (avatarImgCacheRef.current.size > 48) {
            avatarImgCacheRef.current.clear();
          }
          const avImg = new Image();
          avImg.crossOrigin = 'anonymous';
          avatarImgCacheRef.current.set(avUrl, avImg);
          avImg.src = avUrl;
        }
      }


      // =====================================================================
      // UNIFIED 12-SCENE RENDER PIPELINE (Modes 1–12)
      // =====================================================================
      const sceneCtx: SceneRenderContext = {
        ctx,
        timeSec,
        dt,
        playheadRatio: playheadRatioRef.current,
        bpm: bpmRef.current || 120,
        rms: rmsRef.current,
        peak: peakRef.current,
        beat,
        subBass,
        midEnergy,
        highEnergy,
        drop,
        buildup,
        trans,
        sb,
        palette,
        artCanvas: artCanvasRef.current,
        artReady: artReadyRef.current,
        artLuma: artSquareLumaRef.current,
        artRgb: artSquareRgbRef.current,
        activeLyric: activeLyricRef.current || null,
        nextLyric: nextLyricRef.current || null,
        activeComment: effectiveComment,
        commentAvatarImg: effectiveAvatarImg || commentAvatarImgRef.current,
        trackTitle: trackRef.current?.title || '',
        trackArtist: trackRef.current?.artists?.join(', ') || '',
        cropTopY,
        cropBottomY,
        cropLeftX,
        cropRightX,
      };

      const rtCtx: ClassicSceneRuntimeRefs = {
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
        effectiveAvatarImg: effectiveAvatarImg || commentAvatarImgRef.current,
        drawVertigoStyleHologram,
      };

      const renderScene = UNIFIED_SCENE_RENDERERS[activeMode] || renderGlyphScene;
      renderScene(sceneCtx, rtCtx);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [mode, isPlaying, hidden]);

  if (mode === 'off') {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        background: '#000000',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_W * RENDER_SCALE}
        height={CANVAS_H * RENDER_SCALE}
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          objectFit: 'cover',
          opacity: isPlaying ? 0.88 : 0.34,
          transition: 'opacity 320ms ease',
        }}
      />
      {/* Static Zero-CPU True OLED #000000 Center Cushion & Outer Vignette */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background:
            'radial-gradient(ellipse 52% 48% at 56% 52%, rgba(0, 0, 0, 0.58) 0%, rgba(0, 0, 0, 0.28) 55%, rgba(0, 0, 0, 0.82) 100%)',
        }}
      />
    </div>
  );
};
