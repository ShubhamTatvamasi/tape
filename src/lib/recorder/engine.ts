import { AudioMixer, createAudioContext } from './audio';
import { browserMimeProbe, chooseMimeType } from './formats';
import { createPoster } from './media';
import { bitrateFor, makeFilename } from './presets';
import { MemorySink } from './sink';
import type {
  LiveTrackInfo,
  RecorderSnapshot,
  RecordingSink,
  RecordingTake,
  StartOptions,
} from './types';

export interface EngineCallbacks {
  onUpdate?: (snapshot: RecorderSnapshot) => void;
  onTake?: (take: RecordingTake) => void;
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

interface ContainerInfo {
  mimeType: string;
  extension: 'mp4' | 'webm';
}

const EMPTY: RecorderSnapshot = {
  status: 'idle',
  elapsedMs: 0,
  countdown: null,
  bytes: 0,
  error: null,
  notice: null,
  live: null,
  previewStream: null,
  micLevel: 0,
  systemLevel: 0,
  micMuted: false,
  sinkName: null,
  take: null,
};

const wait = (ms: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, ms);
});

function describeCaptureError(error: unknown): string {
  const name = (error as DOMException | undefined)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Screen sharing was cancelled or blocked. Nothing was recorded.';
    case 'NotFoundError':
      return 'There was no screen, window or tab available to share.';
    case 'NotReadableError':
      return 'The screen could not be read. Another app may be capturing it.';
    case 'OverconstrainedError':
      return 'This display cannot meet the selected size. Try “Source” size.';
    case 'AbortError':
      return 'The sharing picker was closed.';
    case 'NotSupportedError':
      return 'Screen recording is not supported in this browser.';
    default: {
      const message = (error as Error | undefined)?.message;
      return message ? `Could not start: ${message}` : 'Could not start the recording.';
    }
  }
}

function buildDisplayMediaOptions(options: StartOptions): DisplayMediaStreamOptions {
  const video: Record<string, unknown> = {
    frameRate: { ideal: options.frameRate, max: options.frameRate },
    cursor: options.cursor,
  };

  if (options.width > 0 && options.height > 0) {
    // Screen capture constraints never crop and never upscale, so these act as a
    // bounding box: the browser downscales the shared surface to fit.
    video.width = { max: options.width };
    video.height = { max: options.height };
  }

  const audio = options.systemAudio
    ? {
        suppressLocalAudioPlayback: false,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    : false;

  const request: Record<string, unknown> = {
    video,
    audio,
    surfaceSwitching: 'include',
    systemAudio: options.systemAudio ? 'include' : 'exclude',
  };

  if (options.source === 'screen') {
    request.displaySurface = 'monitor';
    request.monitorTypeSurfaces = 'include';
  } else if (options.source === 'window') {
    request.displaySurface = 'window';
  } else if (options.source === 'tab') {
    request.displaySurface = 'browser';
    request.selfBrowserSurface = 'exclude';
  }

  return request as unknown as DisplayMediaStreamOptions;
}

export class RecorderEngine {
  private snapshot: RecorderSnapshot = { ...EMPTY };
  private readonly callbacks: EngineCallbacks;

  private options: StartOptions | null = null;
  private displayStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private outputStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private sink: RecordingSink | null = null;
  private container: ContainerInfo | null = null;
  private hasSystemAudio = false;
  private recordedSystemAudio = false;
  private recordedMicrophone = false;

  private audioContext: AudioContext | null = null;
  private mixer: AudioMixer | null = null;

  private segmentStart: number | null = null;
  private elapsedBase = 0;
  private timer: number | null = null;
  private tickCount = 0;

  private cancelled = false;
  private stopping = false;
  private finalized = false;
  private stopResolve: (() => void) | null = null;
  private sinkError: unknown = null;
  private writes: Promise<void> = Promise.resolve();
  private wakeLock: WakeLockSentinelLike | null = null;
  private noticeParts: string[] = [];

  constructor(callbacks: EngineCallbacks = {}) {
    this.callbacks = callbacks;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  getSnapshot(): RecorderSnapshot {
    return this.snapshot;
  }

  isBusy(): boolean {
    const status = this.snapshot.status;
    return status === 'requesting'
      || status === 'countdown'
      || status === 'recording'
      || status === 'paused'
      || status === 'stopping';
  }

  async start(options: StartOptions): Promise<void> {
    if (this.isBusy()) return;

    this.options = options;
    this.cancelled = false;
    this.stopping = false;
    this.finalized = false;
    this.stopResolve = null;
    this.sinkError = null;
    this.writes = Promise.resolve();
    this.elapsedBase = 0;
    this.segmentStart = null;
    this.noticeParts = [];
    this.tickCount = 0;
    this.hasSystemAudio = false;
    this.recordedSystemAudio = false;
    this.recordedMicrophone = false;

    this.update({
      ...EMPTY,
      status: 'requesting',
    });

    // Must be created synchronously inside the click handler, otherwise the
    // autoplay policy can leave the audio graph suspended and record silence.
    if (options.systemAudio || options.microphone) {
      this.audioContext = createAudioContext();
      if (this.audioContext?.state === 'suspended') {
        void this.audioContext.resume().catch(() => undefined);
      }
    }

    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaOptions(options));
    } catch (error) {
      this.audioContext?.close().catch(() => undefined);
      this.audioContext = null;
      this.update({
        ...EMPTY,
        status: 'error',
        error: describeCaptureError(error),
      });
      return;
    }

    if (this.cancelled) {
      display.getTracks().forEach((track) => track.stop());
      this.resetToIdle('Recording cancelled.');
      return;
    }

    this.displayStream = display;
    const videoTrack = display.getVideoTracks()[0];
    if (!videoTrack) {
      this.fail('The shared surface did not include a video track.');
      return;
    }
    videoTrack.addEventListener('ended', this.handleTrackEnded);
    this.update({ previewStream: display });

    let micStream: MediaStream | null = null;
    if (options.microphone) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
      } catch {
        this.noticeParts.push('Microphone unavailable — recording without narration.');
      }
    }
    this.micStream = micStream;

    const systemTrack = display.getAudioTracks()[0] ?? null;
    this.hasSystemAudio = !!systemTrack && options.systemAudio;
    if (systemTrack && !options.systemAudio) {
      systemTrack.stop();
      display.removeTrack(systemTrack);
    }
    if (options.systemAudio && !systemTrack) {
      this.noticeParts.push('No system audio came through the share picker.');
    }

    const audioTracks: MediaStreamTrack[] = [];
    if (systemTrack || micStream) {
      if (this.audioContext) {
        if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume().catch(() => undefined);
        }
        try {
          this.mixer = new AudioMixer(this.audioContext, {
            systemTrack: options.systemAudio ? systemTrack : null,
            micStream,
          });
          audioTracks.push(...this.mixer.stream.getAudioTracks());
        } catch {
          this.noticeParts.push('Audio mixing was unavailable, so only one source was captured.');
        }
      }
      if (audioTracks.length === 0) {
        const fallback = (options.systemAudio ? systemTrack : null)
          ?? micStream?.getAudioTracks()[0]
          ?? null;
        if (fallback) audioTracks.push(fallback);
      }
    }

    if (this.mixer) {
      this.recordedSystemAudio = this.hasSystemAudio;
      this.recordedMicrophone = !!micStream;
    } else if (audioTracks.length > 0) {
      this.recordedSystemAudio = this.hasSystemAudio
        && (systemTrack ? audioTracks.includes(systemTrack) : false);
      this.recordedMicrophone = !!micStream
        && micStream.getAudioTracks().some((track) => audioTracks.includes(track));
    }

    this.refreshLiveInfo(true);

    const probe = browserMimeProbe();
    let choice = chooseMimeType(options.format, probe);
    if (!choice && options.format !== 'auto') {
      choice = chooseMimeType('auto', probe);
      if (choice) {
        this.noticeParts.push(`${options.format.toUpperCase()} is not supported here — using ${choice.container}.`);
      }
    }
    if (!choice) {
      this.fail('This browser cannot record video in MP4 or WebM.');
      return;
    }

    const live = this.snapshot.live;
    const bits = bitrateFor(
      live?.width ?? options.width,
      live?.height ?? options.height,
      options.frameRate,
      options.quality,
      audioTracks.length > 0,
    );

    try {
      this.recorder = new MediaRecorder(new MediaStream([videoTrack, ...audioTracks]), {
        mimeType: choice.mimeType,
        videoBitsPerSecond: bits,
        ...(audioTracks.length > 0 ? { audioBitsPerSecond: 128_000 } : {}),
      });
    } catch {
      try {
        this.recorder = new MediaRecorder(new MediaStream([videoTrack, ...audioTracks]));
      } catch (error) {
        this.fail(describeCaptureError(error));
        return;
      }
    }

    this.outputStream = this.recorder.stream;
    const effectiveMime = this.recorder.mimeType || choice.mimeType;
    const extension: 'mp4' | 'webm' = effectiveMime.includes('mp4') ? 'mp4' : 'webm';
    this.container = { mimeType: effectiveMime, extension };

    const baseMime = effectiveMime.split(';')[0]?.trim() || 'video/webm';
    if (options.destination === 'disk') {
      if (options.sink) {
        this.sink = options.sink;
      } else if (options.sinkFactory) {
        try {
          this.sink = await options.sinkFactory();
        } catch (error) {
          const message = (error as Error | undefined)?.message;
          this.fail(`Could not open the destination file${message ? ` (${message})` : ''}.`);
          return;
        }
      }
      if (!this.sink) {
        this.fail('Choose where to save the file before recording to disk.');
        return;
      }
      this.update({ sinkName: this.sink.name });
    } else {
      this.sink = new MemorySink(makeFilename(new Date(), extension), baseMime);
    }

    this.recorder.addEventListener('dataavailable', this.handleDataAvailable);
    this.recorder.addEventListener('error', this.handleRecorderError);
    this.recorder.addEventListener('stop', this.handleRecorderStop);

    if (this.noticeParts.length > 0) {
      this.update({ notice: this.noticeParts.join(' ') });
    }

    if (options.countdown > 0) {
      this.update({ status: 'countdown', countdown: options.countdown });
      for (let remaining = options.countdown; remaining > 0; remaining -= 1) {
        const deadline = performance.now() + 1000;
        while (performance.now() < deadline) {
          await wait(50);
          if (this.cancelled) {
            await this.abortStart();
            return;
          }
        }
        this.update({ countdown: remaining - 1 });
      }
    }

    if (this.cancelled) {
      await this.abortStart();
      return;
    }

    try {
      this.segmentStart = performance.now();
      this.elapsedBase = 0;
      this.recorder.start(1000);
    } catch (error) {
      this.fail(describeCaptureError(error));
      return;
    }

    this.update({ status: 'recording', countdown: null, elapsedMs: 0 });
    this.startTimer();
    void this.acquireWakeLock();
  }

  cancelCountdown(): void {
    if (this.snapshot.status === 'countdown' || this.snapshot.status === 'requesting') {
      this.cancelled = true;
    }
  }

  pause(): void {
    if (this.snapshot.status !== 'recording' || this.recorder?.state !== 'recording') return;
    try {
      this.recorder.pause();
    } catch {
      return;
    }
    this.accumulateElapsed();
    this.update({ status: 'paused', elapsedMs: this.elapsedBase });
  }

  resume(): void {
    if (this.snapshot.status !== 'paused' || this.recorder?.state !== 'paused') return;
    try {
      this.recorder.resume();
    } catch {
      return;
    }
    this.segmentStart = performance.now();
    this.update({ status: 'recording' });
  }

  setMicMuted(muted: boolean): void {
    this.update({ micMuted: muted });
    if (this.mixer) {
      this.mixer.setMicMuted(muted);
    } else {
      this.micStream?.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  /** Drops the finished take from the stage without revoking its URL. */
  dismissTake(): void {
    if (this.snapshot.status === 'ready') {
      this.update({ ...EMPTY, status: 'idle' });
    }
  }

  async stop(): Promise<void> {
    const status = this.snapshot.status;
    if (status !== 'recording' && status !== 'paused') return;
    if (this.stopping) return;
    this.stopping = true;

    this.update({ status: 'stopping' });
    if (status === 'recording') this.accumulateElapsed();
    const durationMs = this.elapsedBase;
    this.stopTimer();

    const stopped = new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });

    try {
      if (this.recorder && this.recorder.state !== 'inactive') {
        this.recorder.stop();
      } else {
        this.stopResolve?.();
      }
    } catch {
      this.stopResolve?.();
    }

    await Promise.race([stopped, wait(5000)]);
    await this.finalize(durationMs);
  }

  async destroy(): Promise<void> {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.stopTimer();
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        // Already gone.
      }
    }
    const sink = this.sink;
    this.sink = null;
    await sink?.abort().catch(() => undefined);
    this.cleanupCapture();
    this.update({ ...EMPTY, status: 'idle' });
  }

  private update(patch: Partial<RecorderSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.callbacks.onUpdate?.(this.snapshot);
  }

  private resetToIdle(notice: string | null): void {
    this.cleanupCapture();
    this.update({
      ...EMPTY,
      status: 'idle',
      notice,
    });
  }

  private async abortStart(): Promise<void> {
    const sink = this.sink;
    this.sink = null;
    this.cleanupCapture();
    await sink?.abort().catch(() => undefined);
    this.resetToIdle('Recording cancelled.');
  }

  private fail(message: string): void {
    const sink = this.sink;
    this.sink = null;
    void sink?.abort().catch(() => undefined);
    this.cleanupCapture();
    this.update({
      ...EMPTY,
      status: 'error',
      error: message,
    });
  }

  private readonly handleDataAvailable = (event: BlobEvent): void => {
    const chunk = event.data;
    const sink = this.sink;
    if (!chunk?.size || !sink) return;
    this.writes = this.writes.then(() => sink.write(chunk)).catch((error: unknown) => {
      this.sinkError = error;
    });
    this.update({ bytes: sink.bytes });
  };

  private readonly handleRecorderError = (event: Event): void => {
    const error = (event as unknown as { error?: DOMException }).error;
    this.noticeParts.push(error?.message ?? 'The recorder stopped unexpectedly.');
    if (this.snapshot.status === 'recording' || this.snapshot.status === 'paused') {
      void this.stop();
    }
  };

  private readonly handleRecorderStop = (): void => {
    this.stopResolve?.();
    this.stopResolve = null;
  };

  private readonly handleTrackEnded = (): void => {
    if (this.snapshot.status === 'recording' || this.snapshot.status === 'paused') {
      void this.stop();
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible'
      && (this.snapshot.status === 'recording' || this.snapshot.status === 'paused')) {
      void this.acquireWakeLock();
    }
  };

  private async finalize(durationMs: number): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    this.stopTimer();

    await this.writes.catch(() => undefined);

    let blob: Blob | File | null = null;
    let closeError: unknown = null;
    try {
      blob = await this.sink?.close() ?? null;
    } catch (error) {
      closeError = error;
    }

    const sink = this.sink;
    this.sink = null;
    const container = this.container ?? { mimeType: 'video/webm', extension: 'webm' as const };
    const live = this.snapshot.live;

    this.cleanupCapture();

    if (!blob || blob.size === 0 || closeError) {
      const reason = closeError instanceof Error && closeError.message
        ? ` (${closeError.message})`
        : this.sinkError instanceof Error && this.sinkError.message
          ? ` (${this.sinkError.message})`
          : '';
      this.update({
        ...EMPTY,
        status: 'error',
        error: `The recording could not be finished${reason}.`,
      });
      return;
    }

    const file = blob instanceof File ? blob : null;
    const extension = blob.type.includes('mp4') ? 'mp4' : container.extension;
    const name = file?.name ?? sink?.name ?? makeFilename(new Date(), extension);
    const url = URL.createObjectURL(blob);
    const poster = await createPoster(url);

    const take: RecordingTake = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      url,
      posterUrl: poster,
      size: blob.size,
      mimeType: container.mimeType,
      extension,
      durationMs,
      width: live?.width ?? this.options?.width ?? 0,
      height: live?.height ?? this.options?.height ?? 0,
      frameRate: live?.frameRate ?? this.options?.frameRate ?? 30,
      createdAt: new Date(),
      destination: this.options?.destination ?? 'memory',
      sinkName: this.options?.destination === 'disk' ? name : null,
      file,
    };

    this.update({
      ...EMPTY,
      status: 'ready',
      take,
      bytes: blob.size,
      elapsedMs: durationMs,
      live,
    });
    this.callbacks.onTake?.(take);
  }

  private refreshLiveInfo(force = false): void {
    const track = this.displayStream?.getVideoTracks()[0];
    if (!track) return;
    const settings = track.getSettings();
    const next: LiveTrackInfo = {
      width: Math.round(settings.width ?? this.options?.width ?? 0),
      height: Math.round(settings.height ?? this.options?.height ?? 0),
      frameRate: Math.round(settings.frameRate ?? this.options?.frameRate ?? 30),
      hasSystemAudio: this.recordedSystemAudio,
      hasMicrophone: this.recordedMicrophone,
    };
    const current = this.snapshot.live;
    if (!force
      && current
      && current.width === next.width
      && current.height === next.height
      && current.frameRate === next.frameRate
      && current.hasSystemAudio === next.hasSystemAudio
      && current.hasMicrophone === next.hasMicrophone) {
      return;
    }
    this.update({ live: next });
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = window.setInterval(this.tick, 250);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private readonly tick = (): void => {
    this.tickCount += 1;
    if (this.tickCount % 4 === 0) this.refreshLiveInfo();
    const running = this.snapshot.status === 'recording' && this.segmentStart !== null;
    const elapsed = this.elapsedBase + (running ? performance.now() - (this.segmentStart ?? 0) : 0);
    const levels = this.mixer?.levels() ?? { mic: 0, system: 0 };
    this.update({
      elapsedMs: elapsed,
      bytes: this.sink?.bytes ?? 0,
      micLevel: levels.mic,
      systemLevel: levels.system,
    });
  };

  private accumulateElapsed(): void {
    if (this.segmentStart === null) return;
    this.elapsedBase += performance.now() - this.segmentStart;
    this.segmentStart = null;
  }

  private cleanupCapture(): void {
    this.stopTimer();
    if (this.displayStream) {
      const video = this.displayStream.getVideoTracks()[0];
      video?.removeEventListener('ended', this.handleTrackEnded);
      this.displayStream.getTracks().forEach((track) => track.stop());
      this.displayStream = null;
    }
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    this.outputStream?.getTracks().forEach((track) => track.stop());
    this.outputStream = null;
    if (this.mixer) {
      this.mixer.dispose();
      this.mixer = null;
      this.audioContext = null;
    } else if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
    this.releaseWakeLock();
    this.segmentStart = null;
  }

  private async acquireWakeLock(): Promise<void> {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    if (this.wakeLock) return;
    try {
      const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
      if (!wakeLock) return;
      const sentinel = await wakeLock.request('screen');
      this.wakeLock = sentinel;
      sentinel.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      // Wake lock is a progressive enhancement.
    }
  }

  private releaseWakeLock(): void {
    const current = this.wakeLock;
    this.wakeLock = null;
    if (current) {
      void current.release().catch(() => undefined);
    }
  }
}
