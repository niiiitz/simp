import { ImpIconName } from '../components/icons/ImpIcon';

export type SkinPackId =
  | 'imp-portal-dark'
  | 'classic-clickwheel'
  | 'demoscene-phosphor';

export interface SkinPackDefinition {
  id: SkinPackId;
  name: string;
  tagline: string;
  badge: string;
  tokens: {
    bgCanvas: string;
    surfaceCard: string;
    surfaceElevated: string;
    borderSubtle: string;
    textPrimary: string;
    textSecondary: string;
    brandPrimary: string;
    brandSecondary: string;
    iconStrokeWidth: number;
  };
  iconOverrides?: Partial<Record<ImpIconName, ImpIconName>>;
}

export const SKIN_PACK_REGISTRY: SkinPackDefinition[] = [
  {
    id: 'imp-portal-dark',
    name: 'IMP Portal Dark',
    tagline: 'Pure #000000 OLED black with electric portal orange & cyan accents',
    badge: 'DEFAULT • OLED',
    tokens: {
      bgCanvas: '#000000',
      surfaceCard: 'rgba(13, 16, 23, 0.92)',
      surfaceElevated: 'rgba(20, 26, 38, 0.96)',
      borderSubtle: 'rgba(255, 255, 255, 0.12)',
      textPrimary: '#f8fafc',
      textSecondary: '#94a3b8',
      brandPrimary: '#38bdf8',
      brandSecondary: '#fb923c',
      iconStrokeWidth: 2,
    },
  },
  {
    id: 'classic-clickwheel',
    name: 'Classic Click-Wheel',
    tagline: 'Anodized slate & brushed silver tribute to the classic pocket MP3 player',
    badge: 'RETRO • MP3',
    tokens: {
      bgCanvas: '#090d14',
      surfaceCard: 'rgba(22, 29, 41, 0.95)',
      surfaceElevated: 'rgba(30, 41, 59, 0.98)',
      borderSubtle: 'rgba(148, 163, 184, 0.25)',
      textPrimary: '#f1f5f9',
      textSecondary: '#cbd5e1',
      brandPrimary: '#38bdf8',
      brandSecondary: '#4ade80',
      iconStrokeWidth: 2.1,
    },
  },
  {
    id: 'demoscene-phosphor',
    name: 'Demoscene CRT Phosphor',
    tagline: 'High-contrast emerald & amber vector CRT terminal aesthetic',
    badge: '64K • CRT',
    tokens: {
      bgCanvas: '#020804',
      surfaceCard: 'rgba(6, 20, 12, 0.94)',
      surfaceElevated: 'rgba(10, 31, 19, 0.98)',
      borderSubtle: 'rgba(74, 222, 128, 0.24)',
      textPrimary: '#ecfdf5',
      textSecondary: '#86efac',
      brandPrimary: '#4ade80',
      brandSecondary: '#facc15',
      iconStrokeWidth: 1.9,
    },
  },
];

const SKIN_STORAGE_KEY = 'imp_active_skin_pack';

export function loadActiveSkinPackId(): SkinPackId {
  try {
    const raw = window.localStorage.getItem(SKIN_STORAGE_KEY);
    if (raw && SKIN_PACK_REGISTRY.some((s) => s.id === raw)) {
      return raw as SkinPackId;
    }
  } catch {
    // ignore storage errors
  }
  return 'imp-portal-dark';
}

export function getSkinPack(id: SkinPackId): SkinPackDefinition {
  return SKIN_PACK_REGISTRY.find((s) => s.id === id) || SKIN_PACK_REGISTRY[0];
}

export function applySkinPackToDocument(id: SkinPackId): SkinPackDefinition {
  const pack = getSkinPack(id);
  try {
    window.localStorage.setItem(SKIN_STORAGE_KEY, pack.id);
  } catch {
    // ignore
  }
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.setAttribute('data-imp-skin', pack.id);
    root.style.setProperty('--imp-bg-canvas', pack.tokens.bgCanvas);
    root.style.setProperty('--imp-surface-card', pack.tokens.surfaceCard);
    root.style.setProperty('--imp-surface-elevated', pack.tokens.surfaceElevated);
    root.style.setProperty('--imp-border-subtle', pack.tokens.borderSubtle);
    root.style.setProperty('--imp-text-primary', pack.tokens.textPrimary);
    root.style.setProperty('--imp-text-secondary', pack.tokens.textSecondary);
    root.style.setProperty('--imp-brand-primary', pack.tokens.brandPrimary);
    root.style.setProperty('--imp-brand-secondary', pack.tokens.brandSecondary);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('imp-skin-pack-changed', { detail: pack }));
  }
  return pack;
}
