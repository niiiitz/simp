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
  | 'bell-off'
  | 'bolt'
  | 'globe'
  | 'gamepad'
  | 'heart'
  | 'star'
  | 'radio'
  | 'flame'
  | 'eye'
  | 'eye-off'
  | 'palette'
  | 'help'
  | 'repeat'
  | 'user'
  | 'tv'
  | 'external'
  | 'power'
  | 'moon'
  | 'sun'
  | 'shield'
  | 'eject'
  | 'alert'
  | 'cpu';

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
      case 'bolt':
        return <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />;
      case 'globe':
        return (
          <>
            <circle cx="12" cy="12" r="9" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <path d="M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9z" />
          </>
        );
      case 'gamepad':
        return (
          <>
            <line x1="6" y1="12" x2="10" y2="12" />
            <line x1="8" y1="10" x2="8" y2="14" />
            <circle cx="15" cy="13" r="1" fill={color} />
            <circle cx="17" cy="11" r="1" fill={color} />
            <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
          </>
        );
      case 'heart':
        return (
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        );
      case 'star':
        return (
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        );
      case 'radio':
        return (
          <>
            <circle cx="12" cy="12" r="2" />
            <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
          </>
        );
      case 'flame':
        return (
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
        );
      case 'eye':
        return (
          <>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </>
        );
      case 'eye-off':
        return (
          <>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </>
        );
      case 'palette':
        return (
          <>
            <circle cx="13.5" cy="6.5" r=".5" fill={color} />
            <circle cx="17.5" cy="10.5" r=".5" fill={color} />
            <circle cx="8.5" cy="7.5" r=".5" fill={color} />
            <circle cx="6.5" cy="12.5" r=".5" fill={color} />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
          </>
        );
      case 'help':
        return (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </>
        );
      case 'repeat':
        return (
          <>
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </>
        );
      case 'user':
        return (
          <>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </>
        );
      case 'tv':
        return (
          <>
            <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
            <polyline points="17 2 12 7 7 2" />
          </>
        );
      case 'external':
        return (
          <>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </>
        );
      case 'power':
        return (
          <>
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
          </>
        );
      case 'moon':
        return <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />;
      case 'sun':
        return (
          <>
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </>
        );
      case 'shield':
        return <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
      case 'eject':
        return (
          <>
            <polygon points="12 5 4 15 20 15 12 5" />
            <line x1="4" y1="19" x2="20" y2="19" />
          </>
        );
      case 'alert':
        return (
          <>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </>
        );
      case 'cpu':
        return (
          <>
            <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
            <rect x="9" y="9" width="6" height="6" />
            <line x1="9" y1="1" x2="9" y2="4" />
            <line x1="15" y1="1" x2="15" y2="4" />
            <line x1="9" y1="20" x2="9" y2="23" />
            <line x1="15" y1="20" x2="15" y2="23" />
            <line x1="20" y1="9" x2="23" y2="9" />
            <line x1="20" y1="14" x2="23" y2="14" />
            <line x1="1" y1="9" x2="4" y2="9" />
            <line x1="1" y1="14" x2="4" y2="14" />
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
