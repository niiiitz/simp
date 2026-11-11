import type { SoundCloudComment } from '@simp/client';

export const CANVAS_W = 640;
export const CANVAS_H = 360;
export const RENDER_SCALE = 2; // 1280×720 High-DPI backing buffer over logical 640×360 space

export type RgbTuple = [number, number, number];

export interface SceneRenderContext {
  ctx: CanvasRenderingContext2D;
  timeSec: number;
  dt: number;
  playheadRatio: number;
  bpm: number;
  rms: number;
  peak: number;
  beat: number;
  subBass: number;
  midEnergy: number;
  highEnergy: number;
  drop: number;
  buildup: number;
  trans: number;
  /** 16 smoothed FFT frequency bands (0.0 .. 1.0) */
  sb: Float32Array;
  /** 8-color luminance-sorted RGB palette extracted from album artwork */
  palette: RgbTuple[];
  /** Offscreen 128×128 square album artwork canvas (when artReady is true) */
  artCanvas: HTMLCanvasElement | null;
  artReady: boolean;
  /** 128×128 normalized luminance (0.0 .. 1.0) and RGB (0..255) buffers from album artwork */
  artLuma: Float32Array;
  artRgb: Uint8Array;
  /** Active synced lyric line (or null when none is active) */
  activeLyric: string | null;
  /** Next upcoming synced lyric line (or null) */
  nextLyric: string | null;
  /** Attributed SoundCloud timed comment (@username + body + optional avatar_url) */
  activeComment: SoundCloudComment | null;
  /** Loaded HTMLImageElement for activeComment.avatar_url (when ready) */
  commentAvatarImg: HTMLImageElement | null;
  trackTitle: string;
  trackArtist: string;
  cropTopY: number;
  cropBottomY: number;
}

export function rgbToCss(rgb: RgbTuple | undefined, alpha = 1): string {
  const c = rgb || [56, 189, 248];
  if (alpha >= 0.999) {
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

export function lerpRgb(a: RgbTuple, b: RgbTuple, t: number): RgbTuple {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/**
 * Splits a lyric or comment string into 1 or 2 balanced lines for diegetic in-scene banners.
 */
export function splitIntoBalancedLines(text: string, maxSingleLineChars = 38): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxSingleLineChars) return [clean];
  const mid = Math.floor(clean.length * 0.5);
  let splitAt = clean.lastIndexOf(' ', mid + 8);
  if (splitAt <= 6) splitAt = clean.indexOf(' ', mid);
  if (splitAt > 0) {
    const line1 = clean.slice(0, splitAt).trim();
    const line2 = clean.slice(splitAt + 1).trim();
    return line2.length > maxSingleLineChars + 8
      ? [line1, `${line2.slice(0, maxSingleLineChars + 5).trim()}…`]
      : [line1, line2];
  }
  return [`${clean.slice(0, maxSingleLineChars).trim()}…`];
}
