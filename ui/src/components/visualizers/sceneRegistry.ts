export type VisualizerEngine =
  | 'glyph'
  | 'demoscene'
  | 'vertigo'
  | 'trapper'
  | 'midnight'
  | 'cosmos'
  | 'reef3d'
  | 'sanctum_odyssey'
  | 'vaporwave3d'
  | 'rhythm_hologram'
  | 'arcade_crossfire'
  | 'avs_v2';

export type VisualizerMode = VisualizerEngine | 'cycle' | 'shuffle' | 'off';

export type VisualizerCohort = 'original' | 'wave2';

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
  cohort: VisualizerCohort;
  safeZones: SceneSafeZones;
}

export const VISUALIZER_SCENES: VisualizerSceneDescriptor[] = [
  // =========================================================================
  // COHORT 1: ORIGINAL 12 SCENES
  // =========================================================================
  {
    id: 'glyph',
    label: 'Glyph Matrix',
    shortLabel: 'GLYPH',
    subtitle: 'ASCII density grid & album art sampler',
    eraBadge: 'ASCII • 80×45',
    transitionLabel: 'Bayer Dither Dissolve',
    cohort: 'original',
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: true,
    },
  },
  {
    id: 'demoscene',
    label: 'Demoscene 64K',
    shortLabel: '64K',
    subtitle: 'Copper bars, vectorballs & sine scroller',
    eraBadge: 'AMIGA • 64K',
    transitionLabel: 'Copper Raster Curtain',
    cohort: 'original',
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
    subtitle: '3D warp tunnel & targeting reticle',
    eraBadge: 'WARP • 3D',
    transitionLabel: 'Tunnel Depth Iris',
    cohort: 'original',
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
    subtitle: '3-ring binder chrome & neon horizon',
    eraBadge: 'BRYCE • 1995',
    transitionLabel: 'Horizon Raster Sweep',
    cohort: 'original',
    safeZones: {
      lyricAnchor: 'top-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: true,
    },
  },
  {
    id: 'midnight',
    label: 'Midnight Mountain Parallax',
    shortLabel: 'MIDNIGHT',
    subtitle: 'Moonlit aurora, pine ridges & mirror lake',
    eraBadge: 'NATURE • 720P',
    transitionLabel: 'Rolling Mist & Sleet Wipe',
    cohort: 'original',
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
    subtitle: 'Nebula, black hole & 50s UFO on a string',
    eraBadge: 'COSMOS • 720P',
    transitionLabel: 'Hyperspace Event-Horizon Zoom',
    cohort: 'original',
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },

  // =========================================================================
  // COHORT 2: WAVE 2 LOW-POLY / CYBER SCENES (6 CURATED SCENES)
  // =========================================================================
  {
    id: 'reef3d',
    label: 'Coral Reef 3D',
    shortLabel: 'REEF 3D',
    subtitle: 'Low-poly seabed, seahorses & crab rave',
    eraBadge: 'PS1 • 320×180',
    transitionLabel: 'Caustic Raster Wipe',
    cohort: 'wave2',
    safeZones: {
      lyricAnchor: 'top-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'sanctum_odyssey',
    label: '16-Bit Dark Fantasy',
    shortLabel: 'SANCTUM 3D',
    subtitle: 'Clockwork stained glass, 3D coffin & skiff',
    eraBadge: 'PS1 • SANCTUM',
    transitionLabel: '16-Bit RPG Battle Swirl',
    cohort: 'wave2',
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'vaporwave3d',
    label: 'Vaporwave 3D',
    shortLabel: 'VAPOR 3D',
    subtitle: 'Poseidon bust, spinning CRT & Y2K desktop',
    eraBadge: 'Y2K • 3D',
    transitionLabel: 'Solitaire & VHS Tear',
    cohort: 'wave2',
    safeZones: {
      lyricAnchor: 'top-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'rhythm_hologram',
    label: 'Rhythm Stage',
    shortLabel: 'HOLO BAND',
    subtitle: 'Split-flap jumbotron, hologram band & crowd',
    eraBadge: 'STAGE • 3D',
    transitionLabel: 'Laser Strobe Sweep',
    cohort: 'wave2',
    safeZones: {
      lyricAnchor: 'top-center',
      commentAnchor: 'top-left',
      factoidAnchor: 'bottom-right',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'arcade_crossfire',
    label: 'Arcade Crossfire',
    shortLabel: 'CROSSFIRE',
    subtitle: 'Pac-Man, art breakout, missile silos & Joust',
    eraBadge: 'COIN-OP • 3D',
    transitionLabel: 'Flak Shrapnel Burst',
    cohort: 'wave2',
    safeZones: {
      lyricAnchor: 'bottom-center',
      commentAnchor: 'top-right',
      factoidAnchor: 'top-left',
      chyronAnchor: 'bottom-left',
      allowsTickerText: false,
    },
  },
  {
    id: 'avs_v2',
    label: 'Winamp AVS V2',
    shortLabel: 'AVS V2',
    subtitle: 'Feedback tunnel, 3D art icosahedron & scope',
    eraBadge: 'AVS • 3D',
    transitionLabel: 'Geodesic Scope Iris',
    cohort: 'wave2',
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

export const ORIGINAL_COHORT_SCENES: VisualizerEngine[] = VISUALIZER_SCENES.filter(
  (s) => s.cohort === 'original',
).map((s) => s.id);

export const WAVE2_COHORT_SCENES: VisualizerEngine[] = VISUALIZER_SCENES.filter(
  (s) => s.cohort === 'wave2',
).map((s) => s.id);

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

const ENABLED_SCENES_STORAGE_KEY = 'simp_viz_enabled_scenes_v4';

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
