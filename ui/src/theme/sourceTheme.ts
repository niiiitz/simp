import React from 'react';

export type SourceThemeKind = 'soundcloud' | 'apple' | 'ia' | 'local' | 'disc';

export interface ImpSourceTheme {
  kind: SourceThemeKind;
  label: string;
  accent: string;
  accentRgb: string;
  accentGlow: string;
  accentMuted: string;
  accentBorder: string;
  buttonGradient: string;
}

const SOURCE_THEMES: Record<SourceThemeKind, ImpSourceTheme> = {
  soundcloud: {
    kind: 'soundcloud',
    label: 'SoundCloud',
    accent: '#fb923c',
    accentRgb: '251, 146, 60',
    accentGlow: 'rgba(251, 146, 60, 0.36)',
    accentMuted: 'rgba(251, 146, 60, 0.14)',
    accentBorder: 'rgba(251, 146, 60, 0.48)',
    buttonGradient: 'linear-gradient(135deg, rgba(234, 88, 12, 0.32), rgba(251, 146, 60, 0.18))',
  },
  apple: {
    kind: 'apple',
    label: 'Apple Music',
    accent: '#fb7185',
    accentRgb: '251, 113, 133',
    accentGlow: 'rgba(251, 113, 133, 0.36)',
    accentMuted: 'rgba(251, 113, 133, 0.14)',
    accentBorder: 'rgba(251, 113, 133, 0.48)',
    buttonGradient: 'linear-gradient(135deg, rgba(225, 29, 72, 0.32), rgba(251, 113, 133, 0.18))',
  },
  ia: {
    kind: 'ia',
    label: 'Internet Archive',
    accent: '#facc15',
    accentRgb: '250, 204, 21',
    accentGlow: 'rgba(250, 204, 21, 0.34)',
    accentMuted: 'rgba(250, 204, 21, 0.14)',
    accentBorder: 'rgba(250, 204, 21, 0.48)',
    buttonGradient: 'linear-gradient(135deg, rgba(202, 138, 4, 0.32), rgba(250, 204, 21, 0.18))',
  },
  local: {
    kind: 'local',
    label: 'Local Media',
    accent: '#34d399',
    accentRgb: '52, 211, 153',
    accentGlow: 'rgba(52, 211, 153, 0.34)',
    accentMuted: 'rgba(52, 211, 153, 0.14)',
    accentBorder: 'rgba(52, 211, 153, 0.48)',
    buttonGradient: 'linear-gradient(135deg, rgba(5, 150, 105, 0.32), rgba(52, 211, 153, 0.18))',
  },
  disc: {
    kind: 'disc',
    label: 'Optical Disc',
    accent: '#38bdf8',
    accentRgb: '56, 189, 248',
    accentGlow: 'rgba(56, 189, 248, 0.34)',
    accentMuted: 'rgba(56, 189, 248, 0.14)',
    accentBorder: 'rgba(56, 189, 248, 0.48)',
    buttonGradient: 'linear-gradient(135deg, rgba(14, 116, 144, 0.32), rgba(56, 189, 248, 0.18))',
  },
};

export function detectSourceThemeKindFromUri(uri?: string | null, sourceTag?: string | null): SourceThemeKind {
  const u = (uri || '').trim();
  const s = (sourceTag || '').toLowerCase();

  if (u.startsWith('soundcloud:') || s.includes('soundcloud')) {
    return 'soundcloud';
  }
  if (u.startsWith('applemusic:') || s.includes('apple')) {
    return 'apple';
  }
  if (
    u.startsWith('ia:audio:') ||
    u.startsWith('ia://audio/') ||
    u.startsWith('ia:video:') ||
    u.startsWith('ia://video/') ||
    u.startsWith('ia:') ||
    s.includes('archive') ||
    s === 'ia'
  ) {
    return 'ia';
  }
  if (
    u.startsWith('file://') ||
    u.startsWith('/') ||
    u.startsWith('video://local/') ||
    /^[a-zA-Z]:[\\/]/.test(u) ||
    s === 'local'
  ) {
    return 'local';
  }
  return 'disc';
}

export function getSourceThemeForTrack(trackUri?: string | null, sourceTag?: string | null): ImpSourceTheme {
  const kind = detectSourceThemeKindFromUri(trackUri, sourceTag);
  return SOURCE_THEMES[kind];
}

export function getSourceThemeForLibraryFilter(
  sourceFilter?: string | null,
  activePlace?: string | null,
  playingTrackUri?: string | null,
): ImpSourceTheme {
  if (activePlace === 'cd_drive') {
    return SOURCE_THEMES.disc;
  }
  if (activePlace === 'apple_discover') {
    return SOURCE_THEMES.apple;
  }
  if (activePlace === 'soundcloud_discover') {
    return SOURCE_THEMES.soundcloud;
  }
  if (activePlace === 'ia_discover') {
    return SOURCE_THEMES.ia;
  }
  if (activePlace === 'local_albums' || (activePlace && activePlace.startsWith('mount:'))) {
    return SOURCE_THEMES.local;
  }
  if (sourceFilter === 'apple') return SOURCE_THEMES.apple;
  if (sourceFilter === 'soundcloud') return SOURCE_THEMES.soundcloud;
  if (sourceFilter === 'ia') return SOURCE_THEMES.ia;
  if (sourceFilter === 'local') return SOURCE_THEMES.local;

  // When on "All" (`sourceFilter === 'all'`), follow the currently playing track's source (or default cyan)
  if (playingTrackUri) {
    return getSourceThemeForTrack(playingTrackUri);
  }
  return SOURCE_THEMES.disc;
}

export function getSourceThemeCssVars(theme: ImpSourceTheme): React.CSSProperties {
  return {
    '--imp-accent': theme.accent,
    '--imp-accent-rgb': theme.accentRgb,
    '--imp-accent-glow': theme.accentGlow,
    '--imp-accent-muted': theme.accentMuted,
    '--imp-accent-border': theme.accentBorder,
  } as React.CSSProperties;
}
