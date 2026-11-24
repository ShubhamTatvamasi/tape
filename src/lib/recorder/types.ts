export type CaptureSource = 'screen' | 'window' | 'tab' | 'ask';
export type Quality = 'compact' | 'balanced' | 'sharp';
export type OutputFormat = 'auto' | 'mp4' | 'webm';
export type Destination = 'memory' | 'disk';
export type CursorMode = 'always' | 'never';

export interface Settings {
  source: CaptureSource;
  /** 0 means "native size". */
  width: number;
  height: number;
  customSize: boolean;
  frameRate: number;
  quality: Quality;
  format: OutputFormat;
  cursor: CursorMode;
  systemAudio: boolean;
  microphone: boolean;
  countdown: number;
  destination: Destination;
}

export interface RecordingTake {
  id: string;
  name: string;
  url: string;
  posterUrl: string | null;
  size: number;
  mimeType: string;
  extension: string;
  durationMs: number;
  width: number;
  height: number;
  frameRate: number;
  createdAt: Date;
  destination: Destination;
  sinkName: string | null;
  file: File | null;
}

export interface LiveTrackInfo {
  width: number;
  height: number;
  frameRate: number;
  hasSystemAudio: boolean;
  hasMicrophone: boolean;
}

export type RecorderStatus =
  | 'idle'
  | 'requesting'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'ready'
  | 'error';

export interface RecorderSnapshot {
  status: RecorderStatus;
  elapsedMs: number;
  countdown: number | null;
  bytes: number;
  error: string | null;
  notice: string | null;
  live: LiveTrackInfo | null;
  previewStream: MediaStream | null;
  micLevel: number;
  systemLevel: number;
  micMuted: boolean;
  sinkName: string | null;
  take: RecordingTake | null;
}

export interface StartOptions {
  source: CaptureSource;
  width: number;
  height: number;
  frameRate: number;
  quality: Quality;
  format: OutputFormat;
  cursor: CursorMode;
  systemAudio: boolean;
  microphone: boolean;
  countdown: number;
  destination: Destination;
  sink?: RecordingSink;
  /** Opened lazily, after the audio context was created inside the click gesture. */
  sinkFactory?: () => Promise<RecordingSink>;
}

export interface RecordingSink {
  readonly name: string;
  readonly bytes: number;
  write(chunk: Blob): Promise<void>;
  /** Flushes and closes the sink, returning the finished file when available. */
  close(): Promise<File | Blob | null>;
  abort(): Promise<void>;
}
