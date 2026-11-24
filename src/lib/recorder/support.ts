import type { OutputFormat, Settings } from './types';
import { extensionForFormat, preferredFormat, supportsMp4, supportsWebm } from './formats';

export interface SupportReport {
  secureContext: boolean;
  displayMedia: boolean;
  mediaRecorder: boolean;
  /** null when MediaRecorder does not exist. */
  preferred: 'mp4' | 'webm' | null;
  mp4: boolean;
  webm: boolean;
  fileSystemAccess: boolean;
  wakeLock: boolean;
  mobile: boolean;
  ready: boolean;
}

export function isMobileUserAgent(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

export function detectSupport(): SupportReport {
  const displayMedia = typeof navigator !== 'undefined'
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getDisplayMedia === 'function';
  const mediaRecorder = typeof MediaRecorder !== 'undefined';
  const probe = (mimeType: string) => {
    try {
      return mediaRecorder && MediaRecorder.isTypeSupported(mimeType);
    } catch {
      return false;
    }
  };
  const preferred = mediaRecorder ? preferredFormat(probe) : null;
  const fileSystemAccess = typeof window !== 'undefined'
    && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
  const wakeLock = typeof navigator !== 'undefined'
    && 'wakeLock' in navigator;
  const mobile = typeof navigator !== 'undefined' && isMobileUserAgent(navigator.userAgent);
  const secureContext = typeof window !== 'undefined' && window.isSecureContext;

  return {
    secureContext,
    displayMedia,
    mediaRecorder,
    preferred,
    mp4: supportsMp4(probe),
    webm: supportsWebm(probe),
    fileSystemAccess,
    wakeLock,
    mobile,
    ready: secureContext && displayMedia && mediaRecorder && preferred !== null,
  };
}

export const DEFAULT_SETTINGS: Settings = {
  source: 'screen',
  width: 1920,
  height: 1080,
  customSize: false,
  frameRate: 30,
  quality: 'balanced',
  format: 'auto',
  cursor: 'always',
  systemAudio: true,
  microphone: true,
  countdown: 3,
  destination: 'memory',
};

export function describeFormat(format: OutputFormat, support: SupportReport | null): string {
  if (format === 'mp4') return support?.mp4 ? 'MP4 · H.264' : 'MP4 unavailable';
  if (format === 'webm') return support?.webm ? 'WebM · VP9' : 'WebM unavailable';
  if (!support) return 'Auto';
  if (support.preferred === 'mp4') return 'Auto · MP4';
  if (support.preferred === 'webm') return 'Auto · WebM';
  return 'Auto';
}

export function suggestedExtension(format: OutputFormat): 'mp4' | 'webm' {
  const probe = (mimeType: string) => {
    try {
      return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType);
    } catch {
      return false;
    }
  };
  return extensionForFormat(format, probe);
}
