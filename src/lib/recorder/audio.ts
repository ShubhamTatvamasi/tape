/**
 * Mixes system audio and microphone audio into one track. MediaRecorder only
 * records the first audio track it is given, so two sources have to be summed
 * through the Web Audio graph.
 */
export interface AudioMixerOptions {
  systemTrack?: MediaStreamTrack | null;
  micStream?: MediaStream | null;
}

export interface AudioLevels {
  mic: number;
  system: number;
}

export function createAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    // Created from the start-button click so autoplay policy lets it run.
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
}

export class AudioMixer {
  readonly stream: MediaStream;

  private readonly context: AudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly nodes: AudioNode[] = [];
  private readonly micGain: GainNode | null = null;
  private readonly micAnalyser: AnalyserNode | null = null;
  private readonly systemAnalyser: AnalyserNode | null = null;
  private readonly sampleBuffer = new Float32Array(1024);
  private disposed = false;

  constructor(context: AudioContext, options: AudioMixerOptions) {
    this.context = context;
    this.destination = context.createMediaStreamDestination();
    this.stream = this.destination.stream;

    if (options.systemTrack) {
      const source = context.createMediaStreamSource(new MediaStream([options.systemTrack]));
      const gain = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(gain).connect(analyser).connect(this.destination);
      this.nodes.push(source, gain, analyser);
      this.systemAnalyser = analyser;
    }

    if (options.micStream) {
      const source = context.createMediaStreamSource(options.micStream);
      const gain = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(gain).connect(analyser).connect(this.destination);
      this.nodes.push(source, gain, analyser);
      this.micGain = gain;
      this.micAnalyser = analyser;
    }

    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }
  }

  setMicMuted(muted: boolean): void {
    this.micGain?.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.02);
  }

  setMicVolume(volume: number): void {
    this.micGain?.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
  }

  levels(): AudioLevels {
    return {
      mic: this.micAnalyser ? this.readLevel(this.micAnalyser) : 0,
      system: this.systemAnalyser ? this.readLevel(this.systemAnalyser) : 0,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.nodes.length = 0;
    void this.context.close().catch(() => undefined);
    this.destination.stream.getTracks().forEach((track) => track.stop());
  }

  private readLevel(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.sampleBuffer);
    let sum = 0;
    for (let index = 0; index < this.sampleBuffer.length; index += 1) {
      const value = this.sampleBuffer[index] ?? 0;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / this.sampleBuffer.length);
    return Math.min(1, Math.sqrt(rms) * 1.8);
  }
}
