import type { OutputFormat } from './types';

export interface MimeChoice {
  mimeType: string;
  extension: 'mp4' | 'webm';
  container: 'MP4' | 'WebM';
}

const MP4_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
];

const WEBM_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export type SupportProbe = (mimeType: string) => boolean;

export function browserMimeProbe(): SupportProbe {
  return (mimeType: string) => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return false;
    }
    try {
      return MediaRecorder.isTypeSupported(mimeType);
    } catch {
      return false;
    }
  };
}

export function supportsMp4(probe: SupportProbe): boolean {
  return MP4_CANDIDATES.some((candidate) => probe(candidate));
}

export function supportsWebm(probe: SupportProbe): boolean {
  return WEBM_CANDIDATES.some((candidate) => probe(candidate));
}

export function preferredFormat(probe: SupportProbe): 'mp4' | 'webm' | null {
  if (supportsMp4(probe)) return 'mp4';
  if (supportsWebm(probe)) return 'webm';
  return null;
}

/**
 * Picks the first supported container/codec pair. MP4 wins when available because
 * the resulting file opens everywhere (QuickTime, iOS, Slack, editors); WebM is the
 * reliable fallback for browsers without a local H.264 encoder.
 */
export function chooseMimeType(format: OutputFormat, probe: SupportProbe): MimeChoice | null {
  const order = format === 'webm'
    ? WEBM_CANDIDATES
    : format === 'mp4'
      ? MP4_CANDIDATES
      : [...MP4_CANDIDATES, ...WEBM_CANDIDATES];

  for (const candidate of order) {
    if (probe(candidate)) {
      const isMp4 = candidate.startsWith('video/mp4');
      return {
        mimeType: candidate,
        extension: isMp4 ? 'mp4' : 'webm',
        container: isMp4 ? 'MP4' : 'WebM',
      };
    }
  }
  return null;
}

export function extensionForFormat(format: OutputFormat, probe: SupportProbe): 'mp4' | 'webm' {
  if (format === 'mp4') return 'mp4';
  if (format === 'webm') return 'webm';
  return preferredFormat(probe) ?? 'webm';
}
