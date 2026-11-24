import { describe, expect, it } from 'vitest';
import {
  bitrateFor,
  estimateBytesPerMinute,
  fitWithin,
  formatBitrate,
  formatBytes,
  formatDuration,
  formatTakeDuration,
  makeFilename,
  QUALITIES,
  SIZE_PRESETS,
} from '../presets';

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(7_000)).toBe('0:07');
    expect(formatDuration(12 * 60_000 + 34_000)).toBe('12:34');
  });

  it('rolls over into hours', () => {
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });

  it('can show tenths', () => {
    expect(formatDuration(12_400, true)).toBe('0:12.4');
  });

  it('gives finished takes a one-second floor', () => {
    expect(formatTakeDuration(0)).toBe('0:01');
    expect(formatTakeDuration(915)).toBe('0:01');
    expect(formatTakeDuration(12_400)).toBe('0:12');
  });

  it('clamps negative values', () => {
    expect(formatDuration(-500)).toBe('0:00');
  });
});

describe('formatBytes', () => {
  it('uses KB, MB and GB', () => {
    expect(formatBytes(512)).toBe('1 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });

  it('handles empty values', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(Number.NaN)).toBe('0 MB');
  });
});

describe('bitrateFor', () => {
  it('scales with resolution and frame rate', () => {
    const hd = bitrateFor(1280, 720, 30, 'balanced');
    const fhd = bitrateFor(1920, 1080, 30, 'balanced');
    const fhd60 = bitrateFor(1920, 1080, 60, 'balanced');
    expect(hd).toBeLessThan(fhd);
    expect(fhd).toBeLessThan(fhd60);
  });

  it('applies the quality multiplier', () => {
    const compact = bitrateFor(1920, 1080, 30, 'compact');
    const balanced = bitrateFor(1920, 1080, 30, 'balanced');
    const sharp = bitrateFor(1920, 1080, 30, 'sharp');
    expect(compact).toBeLessThan(balanced);
    expect(balanced).toBeLessThan(sharp);
    expect(QUALITIES).toHaveLength(3);
  });

  it('falls back to 1080p when the size is native/unknown', () => {
    expect(bitrateFor(0, 0, 30, 'balanced')).toBe(bitrateFor(1920, 1080, 30, 'balanced'));
  });

  it('keeps the bitrate inside sane bounds', () => {
    expect(bitrateFor(7680, 4320, 60, 'sharp')).toBeLessThanOrEqual(40_128_000);
    expect(bitrateFor(320, 240, 24, 'compact')).toBeGreaterThanOrEqual(1_328_000);
  });

  it('reports bytes per minute from the bitrate', () => {
    const bits = bitrateFor(1920, 1080, 30, 'balanced');
    expect(estimateBytesPerMinute(1920, 1080, 30, 'balanced')).toBe(Math.round((bits / 8) * 60));
  });
});

describe('formatBitrate', () => {
  it('formats megabits', () => {
    expect(formatBitrate(5_000_000)).toBe('5.0 Mbps');
    expect(formatBitrate(12_400_000)).toBe('12 Mbps');
  });
});

describe('fitWithin', () => {
  it('downscales while preserving aspect ratio', () => {
    expect(fitWithin(2560, 1600, 1920, 1080)).toEqual({ width: 1728, height: 1080 });
    expect(fitWithin(1920, 1080, 1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('never upscales', () => {
    expect(fitWithin(1280, 720, 1920, 1080)).toEqual({ width: 1280, height: 720 });
  });

  it('returns the box for unknown sources', () => {
    expect(fitWithin(0, 0, 1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });
});

describe('makeFilename', () => {
  it('builds a sortable, dated name', () => {
    const name = makeFilename(new Date(2026, 10, 24, 14, 32, 9), 'mp4');
    expect(name).toBe('tape-2026-11-24-143209.mp4');
  });
});

describe('size presets', () => {
  it('starts with native and ends with 480p', () => {
    expect(SIZE_PRESETS[0]?.width).toBe(0);
    expect(SIZE_PRESETS[SIZE_PRESETS.length - 1]?.height).toBe(480);
  });
});
