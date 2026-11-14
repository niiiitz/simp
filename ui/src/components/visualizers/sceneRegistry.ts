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
    subtitle: '80×45 ASCII optical density grid & Ken-Burns art sampler',
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
    subtitle: 'Amiga copper bars, vectorballs & 3D sine scroller',
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
    subtitle: '60fps octagonal warp tunnel & HUD targeting reticle',
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
    subtitle: 'Mead 3-ring binder chrome & receding neon horizon',
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
    subtitle: 'Moonlit aurora, branching lightning, pine ridges & mirror lake',
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
    subtitle: 'Big Bang nebula, black hole & 1950s tin UFO on a pendulum string',
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
    label: 'Coral Reef 3D [Low-Poly]',
    shortLabel: 'REEF 3D',
    subtitle: 'PS1 seabed, patrolling seahorses, 3D starfish, crab rave & lyric bubbles',
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
    label: '16-Bit Dark Fantasy [Crypt Coffin]',
    shortLabel: 'SANCTUM 3D',
    subtitle: 'Clockwork stained-glass rose cog, rotating 3D coffin & river skiff',
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
    label: 'Vaporwave 3D [Poseidon / CRT]',
    shortLabel: 'VAPOR 3D',
    subtitle: 'Poseidon, spinning CRT computer, iBook G3 mice, Y2K windows & Strudel REPL',
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
    label: 'Rhythm Stage [Hologram Band]',
    shortLabel: 'HOLO BAND',
    subtitle: 'Vestaboard split-flap jumbotron, hologram band & crowd hands-up',
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
    label: 'Arcade Crossfire [Silos vs. Joust]',
    shortLabel: 'CROSSFIRE',
    subtitle: 'Pac-Man maze, art brickbreaker, 3 Missile Command silos & Joust knights',
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
    label: 'Winamp AVS V2 [3D Superscope]',
    shortLabel: 'AVS V2',
    subtitle: 'Feedback zoom tunnel, spinning album art inside 3D icosahedron & scope',
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
