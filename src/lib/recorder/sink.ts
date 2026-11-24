import type { RecordingSink } from './types';

export interface WritableFileStream {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface SaveFileHandle {
  readonly name: string;
  createWritable(options?: { keepExistingData?: boolean }): Promise<WritableFileStream>;
  getFile(): Promise<File>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}

type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>;

export function fileSystemAccessAvailable(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

export async function pickRecordingFile(
  extension: 'mp4' | 'webm',
  suggestedName: string,
): Promise<SaveFileHandle | null> {
  if (!fileSystemAccessAvailable()) return null;
  const picker = (window as unknown as { showSaveFilePicker: SaveFilePicker }).showSaveFilePicker;
  const mime = extension === 'mp4' ? 'video/mp4' : 'video/webm';
  try {
    return await picker({
      suggestedName,
      types: [{ description: `${extension.toUpperCase()} video`, accept: { [mime]: [`.${extension}`] } }],
    });
  } catch (error) {
    if ((error as DOMException | undefined)?.name === 'AbortError') return null;
    throw error;
  }
}

export class MemorySink implements RecordingSink {
  readonly name: string;
  private readonly mimeType: string;
  private readonly chunks: Blob[] = [];
  private total = 0;

  constructor(name: string, mimeType: string) {
    this.name = name;
    this.mimeType = mimeType;
  }

  get bytes(): number {
    return this.total;
  }

  async write(chunk: Blob): Promise<void> {
    if (!chunk.size) return;
    this.chunks.push(chunk);
    this.total += chunk.size;
  }

  async close(): Promise<Blob> {
    const blob = new Blob(this.chunks, { type: this.mimeType });
    this.chunks.length = 0;
    return blob;
  }

  async abort(): Promise<void> {
    this.chunks.length = 0;
    this.total = 0;
  }
}

export class FileSink implements RecordingSink {
  readonly name: string;
  private readonly handle: SaveFileHandle;
  private readonly writable: WritableFileStream;
  private queue: Promise<void> = Promise.resolve();
  private total = 0;
  private failure: unknown = null;
  private closed = false;

  constructor(handle: SaveFileHandle, writable: WritableFileStream) {
    this.handle = handle;
    this.writable = writable;
    this.name = handle.name;
  }

  get bytes(): number {
    return this.total;
  }

  write(chunk: Blob): Promise<void> {
    if (!chunk.size) return this.queue;
    this.total += chunk.size;
    const task = this.queue.then(async () => {
      if (this.failure) throw this.failure;
      await this.writable.write(chunk);
    });
    // Keep the chain usable after a failure; the error is still reported to the caller.
    this.queue = task.catch((error: unknown) => {
      this.failure ??= error;
    });
    return task;
  }

  async close(): Promise<File | null> {
    if (this.closed) return null;
    this.closed = true;
    await this.queue;
    if (this.failure) throw this.failure;
    await this.writable.close();
    return this.handle.getFile();
  }

  async abort(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.queue;
      await this.writable.abort();
    } catch {
      // Nothing else to do — the partial file is all we have.
    }
  }
}

export async function createFileSink(handle: SaveFileHandle): Promise<FileSink> {
  const writable = await handle.createWritable();
  return new FileSink(handle, writable);
}
