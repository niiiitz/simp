import React from 'react';
import { formatContentRatingBadge } from './libraryHelpers';

export interface ContentRatingBadgeProps {
  rating?: string | null;
  style?: React.CSSProperties;
}

const TONE_STYLES: Record<
  'explicit' | 'clean' | 'mature' | 'film' | 'stars',
  { background: string; border: string; color: string; minWidth?: number }
> = {
  explicit: {
    background: 'rgba(225, 29, 72, 0.18)',
    border: '1px solid rgba(251, 113, 133, 0.55)',
    color: '#fda4af',
    minWidth: 16,
  },
  clean: {
    background: 'rgba(56, 189, 248, 0.14)',
    border: '1px solid rgba(125, 211, 252, 0.45)',
    color: '#bae6fd',
  },
  mature: {
    background: 'rgba(185, 28, 28, 0.22)',
    border: '1px solid rgba(248, 113, 113, 0.55)',
    color: '#fecaca',
  },
  film: {
    background: 'rgba(217, 119, 6, 0.18)',
    border: '1px solid rgba(251, 191, 36, 0.5)',
    color: '#fde68a',
  },
  stars: {
    background: 'rgba(161, 98, 7, 0.18)',
    border: '1px solid rgba(250, 204, 21, 0.45)',
    color: '#fef08a',
  },
};

export const ContentRatingBadge: React.FC<ContentRatingBadgeProps> = ({ rating, style }) => {
  const badge = formatContentRatingBadge(rating);
  if (!badge) return null;
  const palette = TONE_STYLES[badge.tone];
  return (
    <span
      title={badge.title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 9,
        fontFamily: 'monospace',
        fontWeight: 800,
        lineHeight: 1.1,
        letterSpacing: badge.label === 'E' ? 0 : 0.3,
        padding: badge.label === 'E' ? '1px 4px' : '1px 5px',
        borderRadius: 4,
        background: palette.background,
        border: palette.border,
        color: palette.color,
        minWidth: palette.minWidth,
        flexShrink: 0,
        verticalAlign: 'middle',
        ...style,
      }}
    >
      {badge.label}
    </span>
  );
};
