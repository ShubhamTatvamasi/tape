import type { Quality } from './types';

export const SIZE_PRESETS = [
  { id: 'source', label: 'Source', detail: 'Native', width: 0, height: 0 },
  { id: '4k', label: '4K', detail: '3840 × 2160', width: 3840, height: 2160 },
  { id: 'qhd', label: 'QHD', detail: '2560 × 1440', width: 2560, height: 1440 },
  { id: 'fhd', label: 'Full HD', detail: '1920 × 1080', width: 1920, height: 1080 },
  { id: 'hd', label: 'HD', detail: '1280 × 720', width: 1280, height: 720 },
  { id: 'sd', label: 'SD', detail: '854 × 480', width: 854, height: 480 },
] as const;

export const FRAME_RATES = [24, 30, 60] as const;

export const QUALITIES: ReadonlyArray<{
  id: Quality;
  label: string;
  hint: string;
  multiplier: number;
}> = [
  { id: 'compact', label: 'Compact', hint: 'Smallest files', multiplier: 0.6 },
  { id: 'balanced', label: 'Balanced', hint: 'Everyday use', multiplier: 1 },
  { id: 'sharp', label: 'Sharp', hint: 'Text-heavy demos', multiplier: 1.6 },
];

const MIN_BITRATE = 1_200_000;
const MAX_BITRATE = 40_000_000;
const AUDIO_BITRATE = 128_000;

/** A pragmatic bitrate model for screen content, in bits per second. */
export function bitrateFor(
  width: number,
  height: number,
  frameRate: number,
  quality: Quality,
  audio = true,
): number {
  const w = width > 0 ? width : 1920;
  const h = height > 0 ? height : 1080;
  const fps = frameRate > 0 ? frameRate : 30;
  const multiplier = QUALITIES.find((entry) => entry.id === quality)?.multiplier ?? 1;
  const video = w * h * fps * 0.08 * multiplier;
  const clamped = Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, video));
  return Math.round(clamped + (audio ? AUDIO_BITRATE : 0));
}

export function estimateBytesPerMinute(
  width: number,
  height: number,
  frameRate: number,
  quality: Quality,
  audio = true,
): number {
  return Math.round((bitrateFor(width, height, frameRate, quality, audio) / 8) * 60);
}

/** The aspect-preserving size the browser will produce inside a bounding box. */
export function fitWithin(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
): { width: number; height: number } {
  if (boxWidth <= 0 || boxHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: Math.max(0, boxWidth), height: Math.max(0, boxHeight) };
  }
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight, 1);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

/** 7_000 -> "0:07", 3_725_000 -> "1:02:05" */
export function formatDuration(ms: number, tenths = false): string {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const base = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
  if (!tenths) return base;
  return `${base}.${Math.floor((safe % 1000) / 100)}`;
}

/** Finished takes read better with a one-second floor than "0:00". */
export function formatTakeDuration(ms: number): string {
  return formatDuration(Math.max(1000, ms));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatBitrate(bitsPerSecond: number): string {
  const mbps = bitsPerSecond / 1_000_000;
  return `${mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1)} Mbps`;
}

/** tape-2026-11-24-1432.webm */
export function makeFilename(date: Date, extension: string): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = [
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-'),
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(''),
  ].join('-');
  return `tape-${stamp}.${extension}`;
}

export function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
