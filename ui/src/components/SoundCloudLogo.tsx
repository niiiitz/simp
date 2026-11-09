import React from 'react';
import { openSoundCloudPermalink } from '../drivers/SoundCloudDriver';

export interface SoundCloudLogoProps {
  /** Horizontal width in px; enforced `>= 30` per SoundCloud Attribution Guidelines. */
  width?: number;
  /** Fill color (`#FFFFFF` on dark `#121212` surfaces, `#000000` on `#FF5500` orange). */
  color?: string;
  style?: React.CSSProperties;
  title?: string;
}

/**
 * Official 7-Bar SoundCloud Cloudmark SVG (`>= 30px` horizontal width).
 * Follows SoundCloud's "How to Properly Attribute in Your App" guidelines:
 * https://developers.soundcloud.com/docs/api/buttons-logos#how-to-properly-attribute-in-your-app
 */
export const SoundCloudLogo: React.FC<SoundCloudLogoProps> = ({
  width = 30,
  color = '#FFFFFF',
  style,
  title = 'SoundCloud',
}) => {
  const safeWidth = Math.max(30, width);
  const height = Math.round((safeWidth * 28) / 64);

  return (
    <svg
      width={safeWidth}
      height={height}
      viewBox="0 0 64 28"
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
      {/* 7 vertical waveform bars of the official SoundCloud Cloudmark */}
      <rect x="0.5" y="15.0" width="2.2" height="9.5" rx="1.1" fill={color} />
      <rect x="4.5" y="11.5" width="2.2" height="13.5" rx="1.1" fill={color} />
      <rect x="8.5" y="13.0" width="2.2" height="12.0" rx="1.1" fill={color} />
      <rect x="12.5" y="8.5" width="2.2" height="16.5" rx="1.1" fill={color} />
      <rect x="16.5" y="5.5" width="2.2" height="19.5" rx="1.1" fill={color} />
      <rect x="20.5" y="7.0" width="2.2" height="18.0" rx="1.1" fill={color} />
      <rect x="24.5" y="4.0" width="2.2" height="21.0" rx="1.1" fill={color} />
      {/* Solid right-hand cloud body */}
      <path
        d="M29.2 4.2C31.3 2.7 33.9 1.8 36.8 1.8C43.6 1.8 49.2 6.9 50.0 13.5C50.9 13.1 52.0 12.9 53.1 12.9C57.6 12.9 61.2 16.5 61.2 21.0C61.2 23.2 59.4 25.0 57.2 25.0H29.8C29.1 25.0 28.6 24.5 28.6 23.8V5.3C28.6 4.8 28.8 4.4 29.2 4.2Z"
        fill={color}
      />
    </svg>
  );
};

export interface SoundCloudAttributionLinkProps {
  permalinkUrl?: string | null;
  kind?: 'track' | 'playlist' | 'user';
  id?: string | null;
  label?: string;
  width?: number;
  variant?: 'dark' | 'orange';
  style?: React.CSSProperties;
}

/**
 * Clickable SoundCloud attribution pill with the official 7-bar Cloudmark that opens
 * the track, set, or creator's original `permalink_url` on SoundCloud.
 */
export const SoundCloudAttributionLink: React.FC<SoundCloudAttributionLinkProps> = ({
  permalinkUrl,
  kind = 'track',
  id,
  label,
  width = 30,
  variant = 'dark',
  style,
}) => {
  const isOrange = variant === 'orange';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openSoundCloudPermalink({ permalinkUrl, kind, id });
      }}
      title="Open on SoundCloud"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        borderRadius: 6,
        background: isOrange ? '#FF5500' : '#121212',
        color: isOrange ? '#000000' : '#FFFFFF',
        border: isOrange ? '1px solid #FF5500' : '1px solid rgba(255,255,255,0.18)',
        fontSize: 11,
        fontWeight: 800,
        cursor: 'pointer',
        lineHeight: 1,
        flexShrink: 0,
        ...style,
      }}
    >
      <SoundCloudLogo
        width={width}
        color={isOrange ? '#000000' : '#FFFFFF'}
        title="View on SoundCloud"
      />
      {label ? <span>{label}</span> : null}
    </button>
  );
};
