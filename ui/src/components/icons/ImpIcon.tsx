import React from 'react';

export type ImpIconName =
  | 'lyrics'
  | 'artwork'
  | 'artwork-missing'
  | 'factoid'
  | 'comments'
  | 'folder'
  | 'folder-plus'
  | 'search'
  | 'pin'
  | 'fork'
  | 'refresh'
  | 'ban'
  | 'clock'
  | 'trash'
  | 'check'
  | 'warning'
  | 'key'
  | 'sliders'
  | 'mic-off'
  | 'sparkles'
  | 'disc'
  | 'cloud'
  | 'archive'
  | 'apple'
  | 'soundcloud'
  | 'local'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-up'
  | 'chevron-down'
  | 'close'
  | 'info'
  | 'music'
  | 'video'
  | 'play'
  | 'pause'
  | 'shuffle'
  | 'plus'
  | 'settings'
  | 'sign-out'
  | 'database'
  | 'bell-off';

export interface ImpIconProps {
  name: ImpIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
  className?: string;
  title?: string;
}

/**
 * Semantic SVG vector icon component for Wave 2+ UI surfaces.
 * Designed around skin-pack ready currentColor / `--imp-accent` strokes.
 */
export const ImpIcon: React.FC<ImpIconProps> = ({
  name,
  size = 15,
  color = 'currentColor',
  strokeWidth = 2,
  style,
  className,
  title,
}) => {
  const renderPaths = () => {
    switch (name) {
      case 'lyrics':
        return (
          <>
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
            <path d="M2 6h4" />
            <path d="M2 10h4" />
          </>
        );
      case 'artwork':
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.75" />
            <path d="M21 15l-5-5L5 21" />
          </>
        );
      case 'artwork-missing':
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="3 2" />
            <path d="M3 3l18 18" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-4-4-2.5 2.5" />
          </>
        );
      case 'factoid':
        return (
          <>
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V18h6v-1.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z" />
          </>
        );
      case 'comments':
        return (
          <>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M8 9h8" />
            <path d="M8 13h5" />
          </>
        );
      case 'folder':
        return (
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        );
      case 'folder-plus':
        return (
          <>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <path d="M12 11v6" />
            <path d="M9 14h6" />
          </>
        );
      case 'search':
        return (
          <>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </>
        );
      case 'pin':
        return (
          <>
            <path d="M12 17v5" />
            <path d="M9 3h6l1 6 3 3v2H5v-2l3-3 1-6z" />
          </>
        );
      case 'fork':
        return (
          <>
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="18" cy="6" r="2.5" />
            <circle cx="12" cy="18" r="2.5" />
            <path d="M6 8.5v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-2" />
            <path d="M12 13.5v2" />
          </>
        );
      case 'refresh':
        return (
          <>
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </>
        );
      case 'ban':
        return (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M5.7 5.7l12.6 12.6" />
          </>
        );
      case 'clock':
        return (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </>
        );
      case 'trash':
        return (
          <>
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </>
        );
      case 'check':
        return <path d="M20 6L9 17l-5-5" />;
      case 'warning':
        return (
          <>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </>
        );
      case 'key':
        return (
          <>
            <circle cx="7.5" cy="15.5" r="4.5" />
            <path d="M21 2l-9.6 9.6" />
            <path d="M15.5 7.5l3 3" />
          </>
        );
      case 'sliders':
        return (
          <>
            <path d="M4 21v-7" />
            <path d="M4 10V3" />
            <path d="M12 21v-9" />
            <path d="M12 8V3" />
            <path d="M20 21v-5" />
            <path d="M20 12V3" />
            <path d="M1 14h6" />
            <path d="M9 8h6" />
            <path d="M17 16h6" />
          </>
        );
      case 'mic-off':
        return (
          <>
            <path d="M2 2l20 20" />
            <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
            <path d="M5 10v2a7 7 0 0 0 12 5" />
            <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
            <path d="M12 19v3" />
            <path d="M8 22h8" />
          </>
        );
      case 'sparkles':
        return (
          <>
            <path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
            <path d="M19 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />
          </>
        );
      case 'disc':
        return (
          <>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="2.5" />
            <path d="M7.5 7.5a6.5 6.5 0 0 1 4.5-2" />
          </>
        );
      case 'cloud':
        return <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />;
      case 'archive':
        return (
          <>
            <path d="M3 21h18" />
            <path d="M3 10h18" />
            <path d="M5 6l7-3 7 3" />
            <path d="M6 10v11" />
            <path d="M10 10v11" />
            <path d="M14 10v11" />
            <path d="M18 10v11" />
          </>
        );
      case 'apple':
        return (
          <>
            <path d="M12 7c-2.5 0-5 2-5 5.8 0 3.5 2.4 7.2 4.4 7.2 1 0 1.5-.6 2.6-.6 1.1 0 1.5.6 2.6.6 2 0 4.4-3.7 4.4-7.2 0-2-.9-3.6-2.3-4.6" />
            <path d="M12 7c0-2 1.5-3.8 3.5-4" />
          </>
        );
      case 'soundcloud':
        return (
          <>
            <path d="M3 14v4" />
            <path d="M6 11v7" />
            <path d="M9 9v9" />
            <path d="M12 18h6a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 12 8v10z" />
          </>
        );
      case 'local':
        return (
          <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 4v5h10V4" />
            <rect x="8" y="13" width="8" height="7" />
          </>
        );
      case 'chevron-right':
        return <path d="M9 18l6-6-6-6" />;
      case 'chevron-left':
        return <path d="M15 18l-6-6 6-6" />;
      case 'chevron-up':
        return <path d="M18 15l-6-6-6 6" />;
      case 'chevron-down':
        return <path d="M6 9l6 6 6-6" />;
      case 'close':
        return (
          <>
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </>
        );
      case 'info':
        return (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </>
        );
      case 'music':
        return (
          <>
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </>
        );
      case 'video':
        return (
          <>
            <rect x="2" y="5" width="14" height="14" rx="2" />
            <path d="M22 7l-6 5 6 5V7z" />
          </>
        );
      case 'play':
        return <polygon points="6 4 20 12 6 20 6 4" fill={color} />;
      case 'pause':
        return (
          <>
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </>
        );
      case 'shuffle':
        return (
          <>
            <path d="M16 3h5v5" />
            <path d="M4 20L21 3" />
            <path d="M21 16v5h-5" />
            <path d="M15 15l6 6" />
            <path d="M4 4l5 5" />
          </>
        );
      case 'plus':
        return (
          <>
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </>
        );
      case 'settings':
        return (
          <>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </>
        );
      case 'sign-out':
        return (
          <>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </>
        );
      case 'database':
        return (
          <>
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </>
        );
      case 'bell-off':
        return (
          <>
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
            <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
            <path d="M18 8a6 6 0 0 0-9.33-5" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </>
        );
      default:
        return <circle cx="12" cy="12" r="6" />;
    }
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
        ...style,
      }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {renderPaths()}
    </svg>
  );
};
