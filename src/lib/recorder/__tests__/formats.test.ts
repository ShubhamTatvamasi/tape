import { describe, expect, it } from 'vitest';
import {
  chooseMimeType,
  extensionForFormat,
  preferredFormat,
  supportsMp4,
  supportsWebm,
  type SupportProbe,
} from '../formats';
import { isMobileUserAgent } from '../support';

const onlyWebm: SupportProbe = (mime) => mime.startsWith('video/webm');
const onlyMp4: SupportProbe = (mime) => mime.startsWith('video/mp4');
const nothing: SupportProbe = () => false;
const everything: SupportProbe = () => true;

describe('chooseMimeType', () => {
  it('prefers MP4 on auto when it is available', () => {
    const choice = chooseMimeType('auto', everything);
    expect(choice?.container).toBe('MP4');
    expect(choice?.extension).toBe('mp4');
    expect(choice?.mimeType.startsWith('video/mp4')).toBe(true);
  });

  it('falls back to WebM when MP4 is missing', () => {
    const choice = chooseMimeType('auto', onlyWebm);
    expect(choice?.container).toBe('WebM');
    expect(choice?.extension).toBe('webm');
    expect(choice?.mimeType.startsWith('video/webm')).toBe(true);
  });

  it('honours an explicit format', () => {
    expect(chooseMimeType('webm', everything)?.extension).toBe('webm');
    expect(chooseMimeType('mp4', everything)?.extension).toBe('mp4');
  });

  it('returns null when the requested format cannot be recorded', () => {
    expect(chooseMimeType('mp4', onlyWebm)).toBeNull();
    expect(chooseMimeType('webm', onlyMp4)).toBeNull();
    expect(chooseMimeType('auto', nothing)).toBeNull();
  });
});

describe('format support', () => {
  it('detects containers', () => {
    expect(supportsMp4(onlyMp4)).toBe(true);
    expect(supportsMp4(onlyWebm)).toBe(false);
    expect(supportsWebm(onlyWebm)).toBe(true);
    expect(supportsWebm(onlyMp4)).toBe(false);
  });

  it('picks a preferred container', () => {
    expect(preferredFormat(everything)).toBe('mp4');
    expect(preferredFormat(onlyWebm)).toBe('webm');
    expect(preferredFormat(nothing)).toBeNull();
  });

  it('suggests an extension for a save dialog', () => {
    expect(extensionForFormat('auto', everything)).toBe('mp4');
    expect(extensionForFormat('auto', onlyWebm)).toBe('webm');
    expect(extensionForFormat('mp4', onlyWebm)).toBe('mp4');
    expect(extensionForFormat('webm', onlyMp4)).toBe('webm');
  });
});

describe('isMobileUserAgent', () => {
  it('recognises phones and tablets', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true);
    expect(isMobileUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 9) Mobile')).toBe(true);
    expect(isMobileUserAgent('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe(true);
  });

  it('keeps desktops on the desktop path', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false);
    expect(isMobileUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false);
  });
});
