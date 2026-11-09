import React from 'react';
import { openAppleMusicPermalink } from '../drivers/AppleMusicDriver';

export interface AppleMusicLogoProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  title?: string;
}

/**
 * Vector Apple Music musical-note glyph & attribution badge per Apple Music Identity Guidelines.
 */
export const AppleMusicLogo: React.FC<AppleMusicLogoProps> = ({
  size = 14,
  color = '#FA243C',
  style,
  title = 'Apple Music',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
        ...style,
      }}
    >
      <title>{title}</title>
      <rect width="24" height="24" rx="5.5" fill={color} />
      <path
        d="M16.75 5.25L9.75 6.65C9.31 6.74 9 7.12 9 7.57V15.05C8.58 14.79 8.05 14.66 7.46 14.73C6.24 14.88 5.31 15.86 5.42 16.95C5.53 18.04 6.62 18.81 7.84 18.66C8.96 18.52 9.8 17.64 9.8 16.62V9.85L15.95 8.62V13.65C15.53 13.39 15 13.26 14.41 13.33C13.19 13.48 12.26 14.46 12.37 15.55C12.48 16.64 13.57 17.41 14.79 17.26C15.91 17.12 16.75 16.24 16.75 15.22V5.25Z"
        fill="#FFFFFF"
      />
    </svg>
  );
};

export interface AppleMusicAttributionLinkProps {
  kind?: 'song' | 'album' | 'playlist' | 'artist' | 'station';
  id?: string | null;
  label?: string;
  size?: number;
  style?: React.CSSProperties;
}

export const AppleMusicAttributionLink: React.FC<AppleMusicAttributionLinkProps> = ({
  kind = 'song',
  id,
  label = 'Apple Music',
  size = 14,
  style,
}) => {
  const isEmbeddedConsole = typeof window !== 'undefined' && window.parent !== window;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!isEmbeddedConsole) {
          openAppleMusicPermalink({ kind, id });
        }
      }}
      title={isEmbeddedConsole ? 'Apple Music' : 'Listen on Apple Music'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        borderRadius: 6,
        background: '#1a0c12',
        color: '#fda4af',
        border: '1px solid #4c1d2e',
        fontSize: 11,
        fontWeight: 800,
        cursor: isEmbeddedConsole ? 'default' : 'pointer',
        lineHeight: 1,
        flexShrink: 0,
        ...style,
      }}
    >
      <AppleMusicLogo size={size} />
      <span>{label}</span>
    </button>
  );
};
