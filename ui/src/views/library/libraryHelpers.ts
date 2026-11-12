import React from 'react';
import { PlaylistRecord } from '@simp/client';

export const CLOUD_PAGE_SIZE = 50;

export type AlphaBucket = 'all' | 'num' | 'a_f' | 'g_l' | 'm_r' | 's_z';

export function matchesAlphaBucket(name: string, bucket: AlphaBucket): boolean {
  if (bucket === 'all') return true;
  const cleaned = name.replace(/^[\s🍎☁️📌🎵💿]+/u, '').trim();
  const first = (cleaned[0] || '').toUpperCase();
  if (!first || first < 'A' || first > 'Z') {
    return bucket === 'num';
  }
  if (bucket === 'a_f') return first >= 'A' && first <= 'F';
  if (bucket === 'g_l') return first >= 'G' && first <= 'L';
  if (bucket === 'm_r') return first >= 'M' && first <= 'R';
  if (bucket === 's_z') return first >= 'S' && first <= 'Z';
  return true;
}

export const iaItemCountCache = new Map<string, number>();
export const iaItemCountPending = new Set<string>();

export function extractAudioFormat(uri?: string | null): string | null {
  if (!uri || !uri.startsWith('file://')) return null;
  const m = uri.match(/\.([a-zA-Z0-9]{2,5})(?:$|[?#])/);
  if (!m) return null;
  const ext = m[1].toUpperCase();
  if (
    ext === 'FLAC' ||
    ext === 'MP3' ||
    ext === 'WAV' ||
    ext === 'OGG' ||
    ext === 'OPUS' ||
    ext === 'M4A' ||
    ext === 'AAC' ||
    ext === 'ALAC' ||
    ext === 'AIFF'
  ) {
    return ext;
  }
  return null;
}

export function cleanCollectionTitle(raw: string): string {
  return raw.replace(/^[\s📌💾🍎☁️🏛️🎵💿]+/u, '').trim() || raw;
}

export function formatPlaylistSourceBadge(pl: PlaylistRecord): string {
  if (pl.origin === 'local_pinned') {
    return '💾';
  }
  if (pl.origin === 'soundcloud_remote') {
    return '☁️';
  }
  if (pl.origin === 'archive_remote') {
    return '🏛️';
  }
  if (pl.origin !== 'simp_local') {
    return '🍎';
  }
  const parts: string[] = [];
  if (pl.has_local) parts.push('💾');
  if (pl.has_apple) parts.push('🍎');
  if (pl.has_soundcloud) parts.push('☁️');
  if (pl.has_archive) parts.push('🏛️');
  if (parts.length > 0) {
    return parts.join(' + ');
  }
  return '★ SIMP';
}

// Responsive Tile Grid Style (4 columns on Steam Deck 1280x800, up to 6 columns on ultrawide displays)
export const tileGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(max(162px, calc((100% - 50px) / 6)), 1fr))',
  gap: 10,
  width: '100%',
  minWidth: 0,
};
