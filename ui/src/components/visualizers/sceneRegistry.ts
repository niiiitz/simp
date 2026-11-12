export type VisualizerEngine =
  | 'glyph'
  | 'avs'
  | 'demoscene'
  | 'vertigo'
  | 'trapper'
  | 'rhythm'
  | 'midnight'
  | 'cosmos'
  | 'reef'
  | 'arcade'
  | 'vaporwave'
  | 'sanctum';

export type VisualizerMode = VisualizerEngine | 'cycle' | 'shuffle' | 'off';

export type SafeAnchorPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface SceneSafeZones {
  lyricAnchor: SafeAnchorPosition;
  commentAnchor: SafeAnchorPosition;
  factoidAnchor: SafeAnchorPosition;
  chyronAnchor: SafeAnchorPosition;
  allowsTickerText: boolean;
}

export interface VisualizerSceneDescriptor {
  id: VisualizerEngine;
  label: string;
  shortLabel: string;
  subtitle: string;
  eraBadge: string;
  transitionLabel: string;
  wasmSceneId: number | null; // null = existing TS engine (0..4), 0..6 = Rust/WASM Smol Engine scene
  safeZones: SceneSafeZones;
}

export const VISUALIZER_SCENES: VisualizerSceneDescriptor[] = [
  {
    id: 'glyph',
    label: 'Glyph Matrix',
    shortLabel: 'GLYPH',
    subtitle: '80×45 ASCII optical density grid & Ken-Burns art sampler',
    eraBadge: 'ASCII • 80×45',
    transitionLabel: 'Bayer Dither Dissolve',
    wasmSceneId: null,
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: true,
    },
  },
  {
    id: 'avs',
    label: 'Winamp AVS',
    shortLabel: 'AVS',
    subtitle: 'Superscope Lissajous ribbons & radial spectrum rings',
    eraBadge: 'WINAMP • 1999',
    transitionLabel: 'Radial Scope Wipe',
    wasmSceneId: null,
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'demoscene',
    label: 'Demoscene 64K',
    shortLabel: '64K',
    subtitle: 'Amiga copper bars, vectorballs & 3D sine scroller',
    eraBadge: 'AMIGA • 64K',
    transitionLabel: 'Copper Raster Curtain',
    wasmSceneId: null,
    safeZones: {
      lyricAnchor: 'top-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: true,
    },
  },
  {
    id: 'vertigo',
    label: 'Vertigo Corridor',
    shortLabel: 'VERTIGO',
    subtitle: '60fps octagonal warp tunnel & HUD targeting reticle',
    eraBadge: 'WARP • 3D',
    transitionLabel: 'Tunnel Depth Iris',
    wasmSceneId: null,
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'trapper',
    label: '90s Bryce Trapper',
    shortLabel: 'TRAPPER',
    subtitle: 'Mead 3-ring binder chrome & receding neon horizon',
    eraBadge: 'BRYCE • 1995',
    transitionLabel: 'Horizon Raster Sweep',
    wasmSceneId: null,
    safeZones: {
      lyricAnchor: 'top-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: true,
    },
  },
  {
    id: 'rhythm',
    label: 'Rhythm Stage & Micro-Party',
    shortLabel: 'RHYTHM',
    subtitle: 'DDR step arrows, Miku lasers, Mode-7 crowd & Jumbotron art',
    eraBadge: 'STAGE • 720P',
    transitionLabel: 'Arcade Strobe Curtain',
    wasmSceneId: null,
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-left',
      factoidAnchor: 'bottom-right',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'midnight',
    label: 'Midnight Mountain Parallax',
    shortLabel: 'MIDNIGHT',
    subtitle: 'Moonlit aurora, branching lightning, pine ridges & mirror lake',
    eraBadge: 'NATURE • 720P',
    transitionLabel: 'Rolling Mist & Sleet Wipe',
    wasmSceneId: null,
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'cosmos',
    label: 'Cosmic Warp & 50s Saucer',
    shortLabel: 'SAUCER',
    subtitle: 'Big Bang nebula, black hole & 1950s tin UFO on a pendulum string',
    eraBadge: 'COSMOS • 720P',
    transitionLabel: 'Hyperspace Event-Horizon Zoom',
    wasmSceneId: null,
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'reef',
    label: 'Coral Reef & Water Caustics',
    shortLabel: 'REEF',
    subtitle: 'Volumetric water caustics, kelp, jellyfish, bubbles & snapping crab',
    eraBadge: 'ABYSS • 720P',
    transitionLabel: 'Rising Bubble Wall & Ripple',
    wasmSceneId: null,
    safeZones: {
      lyricAnchor: 'top-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'arcade',
    label: 'Retro Arcade Remix',
    shortLabel: 'ARCADE',
    subtitle: 'Pac-Man neon maze, Pong waveform, Space Invaders & Missile Command',
    eraBadge: 'COIN-OP • 720P',
    transitionLabel: 'CRT Degauss Collapse',
    wasmSceneId: null,
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'vaporwave',
    label: 'Y2K / Vaporwave Odyssey',
    shortLabel: 'VAPOR',
    subtitle: 'Marble Helios bust, Fiji bottle, Tron lightcycles, dolphins & Solitaire',
    eraBadge: 'Y2K • 720P',
    transitionLabel: 'Win95 Card Cascade & VHS Wipe',
    wasmSceneId: null,
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'sanctum',
    label: '16-Bit Dark Fantasy Sanctum',
    shortLabel: 'SANCTUM',
    subtitle: 'Gothic stained-glass rose window, river boat, torchlight & Arcane Orb',
    eraBadge: 'SNES RPG • 720P',
    transitionLabel: 'SNES RPG Battle Swirl',
    wasmSceneId: null,
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
];

export const VISUALIZER_ENGINES: VisualizerEngine[] = VISUALIZER_SCENES.map((s) => s.id);

export const CORE_POLISHED_SCENES: VisualizerEngine[] = [...VISUALIZER_ENGINES];

export const VISUALIZER_MODES: { id: VisualizerMode; label: string; shortLabel: string }[] = [
  ...VISUALIZER_SCENES.map((s) => ({
    id: s.id as VisualizerMode,
    label: s.label,
    shortLabel: s.shortLabel,
  })),
  { id: 'cycle', label: 'Cycle Enabled on Track Change', shortLabel: 'CYCLE' },
  { id: 'shuffle', label: 'Shuffle Enabled on Track Change', shortLabel: 'SHUFFLE' },
  { id: 'off', label: 'Off', shortLabel: 'OFF' },
];

const ENABLED_SCENES_STORAGE_KEY = 'simp_viz_enabled_scenes_v3';

export function loadEnabledVisualizerScenes(): VisualizerEngine[] {
  try {
    const raw = window.localStorage.getItem(ENABLED_SCENES_STORAGE_KEY);
    if (!raw) return [...CORE_POLISHED_SCENES];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((id): id is VisualizerEngine =>
        VISUALIZER_ENGINES.includes(id as VisualizerEngine),
      );
      if (valid.length > 0) return valid;
    }
  } catch {
    // ignore storage errors
  }
  return [...CORE_POLISHED_SCENES];
}

export function saveEnabledVisualizerScenes(scenes: VisualizerEngine[]): void {
  try {
    const next = scenes.length > 0 ? scenes : [...CORE_POLISHED_SCENES];
    window.localStorage.setItem(ENABLED_SCENES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

export function getSceneDescriptor(engine: VisualizerEngine): VisualizerSceneDescriptor {
  return VISUALIZER_SCENES.find((s) => s.id === engine) || VISUALIZER_SCENES[0];
}
