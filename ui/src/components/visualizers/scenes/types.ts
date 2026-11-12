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

/**
 * Renders the preferred AVS-style floating 3D lyric overlay (unboxed soft dark backing pill,
 * subtle upper tunnel-echo ghost stamp, palette[4] chromatic shadow, and crisp palette[7] uppercase text).
 */
export function drawAvsFloatingLyric(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  palette: RgbTuple[],
  timeSec: number,
  beat: number,
  cropTopY: number,
  reveal = 1,
  offsetX = 0,
  offsetY = 0,
): void {
  const trimmed = rawText.trim();
  if (trimmed.length === 0) return;

  const upperText = trimmed.toUpperCase();
  const lines: string[] = [];
  if (upperText.length <= 36) {
    lines.push(upperText);
  } else {
    const mid = Math.floor(upperText.length * 0.5);
    let splitAt = upperText.lastIndexOf(' ', mid + 8);
    if (splitAt <= 6) splitAt = upperText.indexOf(' ', mid);
    if (splitAt > 0) {
      lines.push(upperText.slice(0, splitAt).trim());
      lines.push(upperText.slice(splitAt + 1).trim());
    } else {
      lines.push(upperText);
    }
  }

  const maxLineChars = Math.max(...lines.map((l) => l.length), 1);
  const maxFontPx = lines.length > 1 ? 14 : 16;
  const fontPx = Math.max(
    11,
    Math.min(maxFontPx, Math.floor((CANVAS_W * 0.82) / (maxLineChars * 0.62))),
  );
  const lineH = fontPx + 4;
  const boxW = Math.min(CANVAS_W - 28, Math.round(maxLineChars * fontPx * 0.62 + 26));
  const boxH = lines.length * lineH + 10;

  const cx = CANVAS_W * 0.5;
  const cy = CANVAS_H * 0.5;
  const safeTopY = Math.max(28, cropTopY + 18);
  const minCenterY = safeTopY + boxH * 0.5;
  const lyricY = Math.max(
    minCenterY,
    Math.min(cy - 64, minCenterY + 10 + offsetY) + Math.cos(timeSec * 1.1) * 2.0,
  );
  const lyricX = cx + offsetX + Math.sin(timeSec * 0.95) * 4;

  ctx.save();
  ctx.translate(lyricX, lyricY);

  // Soft translucent borderless backing pill (matches AVS foreground overlay)
  ctx.fillStyle = `rgba(6, 7, 12, ${(0.68 * reveal).toFixed(2)})`;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(-boxW * 0.5, -boxH * 0.5, boxW, boxH, 10);
  } else {
    ctx.rect(-boxW * 0.5, -boxH * 0.5, boxW, boxH);
  }
  ctx.fill();

  ctx.font = `bold ${fontPx}px "JetBrains Mono", "Fira Code", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Subtle upper tunnel-echo ghost stamp (gives AVS depth feel across non-feedback scenes)
  ctx.fillStyle = rgbToCss(palette[5], (0.18 + beat * 0.12) * reveal);
  for (let li = 0; li < lines.length; li++) {
    const ly = (li - (lines.length - 1) * 0.5) * lineH;
    ctx.fillText(lines[li], 0, ly - 5);
  }

  // Crisp foreground text with palette[4] chromatic shadow + palette[7] primary fill
  for (let li = 0; li < lines.length; li++) {
    const ly = (li - (lines.length - 1) * 0.5) * lineH;
    ctx.fillStyle = rgbToCss(palette[4], 0.85 * reveal);
    ctx.fillText(lines[li], 1.5, ly + 1.5);
    ctx.fillStyle = rgbToCss(palette[7], (0.92 + beat * 0.08) * reveal);
    ctx.fillText(lines[li], 0, ly);
  }

  ctx.restore();
}

/**
 * Renders the preferred Micro-Party style SoundCloud timed comment pop-over pill
 * (rounded dark card with palette[7] border, circular clipped user avatar, `@username`, and quoted comment).
 */
export function drawMicroPartyCommentPill(
  ctx: CanvasRenderingContext2D,
  activeComment: SoundCloudComment | null | undefined,
  commentAvatarImg: HTMLImageElement | null | undefined,
  palette: RgbTuple[],
  timeSec: number,
  beat: number,
  cropBottomY: number,
  showCrowdSticks = false,
): void {
  if (!activeComment || !activeComment.username || !activeComment.body) return;

  const cleanBody = activeComment.body.trim();
  const maxBody = cleanBody.slice(0, 40);
  const displayBody = `“${maxBody}${cleanBody.length > 40 ? '…' : ''}”`;

  const signW = Math.min(CANVAS_W - 80, Math.max(250, Math.round(displayBody.length * 6.0 + 54)));
  const signH = 38;
  const cx = CANVAS_W * 0.5;
  const bounce = Math.abs(Math.sin(timeSec * 3.2)) * (0.35 + beat * 0.65);
  const signX = cx + Math.sin(timeSec * 1.8) * 12 - signW * 0.5;
  const signY = Math.min(cropBottomY - 52, CANVAS_H - 64) - bounce * 4;

  ctx.save();
  if (showCrowdSticks) {
    ctx.strokeStyle = rgbToCss(palette[5], 0.85);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(signX + 36, signY + signH);
    ctx.lineTo(signX + 32, signY + signH + 22);
    ctx.moveTo(signX + signW - 36, signY + signH);
    ctx.lineTo(signX + signW - 32, signY + signH + 22);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(8, 10, 22, 0.92)';
  ctx.strokeStyle = rgbToCss(palette[7], 0.95);
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(signX, signY, signW, signH, 9);
  } else {
    ctx.rect(signX, signY, signW, signH);
  }
  ctx.fill();
  ctx.stroke();

  let textStartX = signX + 12;
  if (commentAvatarImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(signX + 21, signY + signH * 0.5, 12, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(commentAvatarImg, signX + 9, signY + signH * 0.5 - 12, 24, 24);
    ctx.restore();
    textStartX = signX + 39;
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '800 9.5px "JetBrains Mono", monospace';
  ctx.fillStyle = rgbToCss(palette[6], 0.98);
  ctx.fillText(`@${activeComment.username}`, textStartX, signY + 12);

  ctx.font = '700 10.5px sans-serif';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(displayBody, textStartX, signY + 26);
  ctx.restore();
}
