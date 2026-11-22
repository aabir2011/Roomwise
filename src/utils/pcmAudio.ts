/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const TARGET_SAMPLE_RATE = 16000;
const PLAYBACK_SAMPLE_RATE = 24000;

/**
 * Downsamples mono Float32 audio from sourceRate to 16 kHz.
 */
export function downsampleFloat32(
  input: Float32Array,
  sourceRate: number,
  targetRate: number = TARGET_SAMPLE_RATE
): Float32Array {
  if (sourceRate === targetRate) {
    return input;
  }
  if (sourceRate < targetRate) {
    // Linear upsample fallback if a device captures below 16 kHz
    const ratio = sourceRate / targetRate;
    const outLength = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = input[idx] ?? 0;
      const b = input[Math.min(idx + 1, input.length - 1)] ?? a;
      output[i] = a + (b - a) * frac;
    }
    return output;
  }

  const ratio = sourceRate / targetRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < outLength) {
    const nextOffsetBuffer = Math.min(
      input.length,
      Math.round((offsetResult + 1) * ratio)
    );
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += input[i];
      count++;
    }
    output[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return output;
}

/**
 * Converts normalized Float32 (-1..1) samples to signed 16-bit PCM little-endian bytes.
 */
export function float32ToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
  }
  return out;
}

export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

export function computeRmsAmplitude(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  // Boost gently for human speech range so UI waveform stays responsive without clipping
  return Math.min(1, rms * 4.2);
}

/**
 * Plays a short, understated 2-tone acoustic confirmation chime when "Hey ROOMWISE" triggers.
 */
export function playWakeAcknowledgementChime(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.065, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    gain.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.setValueAtTime(880, now + 0.085); // A5
    osc1.connect(gain);

    osc1.start(now);
    osc1.stop(now + 0.25);
    osc1.onended = () => {
      ctx.close().catch(() => undefined);
    };
  } catch {
    // WebAudio chime is non-critical
  }
}

/**
 * Gapless 24 kHz PCM audio player with barge-in cancellation and live output amplitude metering.
 */
export class PcmLivePlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserBuffer: Float32Array<ArrayBuffer> | null = null;
  private nextStartTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private onSpeakingChange?: (speaking: boolean) => void;

  constructor(onSpeakingChange?: (speaking: boolean) => void) {
    this.onSpeakingChange = onSpeakingChange;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx({ sampleRate: PLAYBACK_SAMPLE_RATE });
      this.ctx.onstatechange = () => {
        if (this.ctx && this.ctx.state === 'suspended' && this.activeSources.size > 0) {
          void this.ctx.resume().catch(() => undefined);
        }
      };
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyserBuffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
      this.analyser.connect(this.ctx.destination);
      this.nextStartTime = this.ctx.currentTime;
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  public async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      await Promise.race([
        ctx.resume().catch(() => undefined),
        new Promise<void>((resolve) => window.setTimeout(resolve, 350)),
      ]);
    }
  }

  public enqueueBase64Pcm(base64Pcm: string): void {
    const ctx = this.ensureContext();
    const int16 = base64ToInt16(base64Pcm);
    if (int16.length === 0) return;

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 0x8000;
    }

    const buffer = ctx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (this.analyser) {
      source.connect(this.analyser);
    } else {
      source.connect(ctx.destination);
    }

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.045, this.nextStartTime);
    this.nextStartTime = startAt + buffer.duration;

    const wasEmpty = this.activeSources.size === 0;
    this.activeSources.add(source);
    if (wasEmpty && ctx.state === 'running') {
      this.onSpeakingChange?.(true);
    }

    source.onended = () => {
      this.activeSources.delete(source);
      if (this.activeSources.size === 0) {
        this.lastPlaybackEndedAtMs = Date.now();
        this.nextStartTime = ctx.currentTime;
        this.onSpeakingChange?.(false);
      }
    };

    source.start(startAt);
  }

  private lastPlaybackEndedAtMs = 0;

  /**
   * Pre-creates and resumes the 24 kHz AudioContext inside a direct user click
   * gesture (e.g. enabling wake standby) so subsequent asynchronous wake-word
   * triggers never deadlock on a suspended AudioContext.
   */
  public async preUnlock(): Promise<boolean> {
    try {
      const ctx = this.ensureContext();
      if (ctx.state === 'suspended') {
        await Promise.race([
          ctx.resume(),
          new Promise<void>((resolve) => window.setTimeout(resolve, 400)),
        ]);
      }
      return ctx.state === 'running';
    } catch {
      return false;
    }
  }

  /**
   * Plays a crisp two-tone acknowledgement chime using this player's already-unlocked
   * AudioContext (avoiding untracked/suspended secondary AudioContext instances).
   */
  public playWakeChime(): void {
    try {
      const ctx = this.ensureContext();
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
      if (ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.11, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      gain.connect(ctx.destination);

      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.11);
      osc1.connect(gain);
      osc1.start(now);
      osc1.stop(now + 0.25);
    } catch {
      // ignore if autoplay blocked
    }
  }

  public getLastPlaybackEndedAt(): number {
    return this.lastPlaybackEndedAtMs;
  }

  public stopAll(): void {
    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // ignore stopped nodes
      }
    }
    this.activeSources.clear();
    this.lastPlaybackEndedAtMs = Date.now();
    if (this.ctx) {
      this.nextStartTime = this.ctx.currentTime;
    }
    this.onSpeakingChange?.(false);
  }

  /**
   * Returns true ONLY when the AudioContext is actually running AND has active
   * scheduled audio buffers — prevents a suspended AudioContext from permanently
   * locking the microphone silence gate after an async wake trigger.
   */
  public isPlaying(): boolean {
    if (!this.ctx || this.ctx.state !== 'running') {
      return false;
    }
    return this.activeSources.size > 0;
  }

  public getOutputAmplitude(): number {
    if (!this.analyser || !this.analyserBuffer || !this.isPlaying()) {
      return 0;
    }
    this.analyser.getFloatTimeDomainData(this.analyserBuffer);
    return computeRmsAmplitude(this.analyserBuffer);
  }

  public async dispose(): Promise<void> {
    this.stopAll();
    if (this.ctx && this.ctx.state !== 'closed') {
      await this.ctx.close().catch(() => undefined);
    }
    this.ctx = null;
    this.analyser = null;
    this.analyserBuffer = null;
  }
}

const WORKLET_PROCESSOR_SOURCE = `
class RoomwisePcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i];
      if (this.offset >= this.buffer.length) {
        const copy = new Float32Array(this.buffer);
        this.port.postMessage(copy, [copy.buffer]);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('roomwise-pcm-capture', RoomwisePcmCaptureProcessor);
`;

export interface MicCaptureHandle {
  stop: () => Promise<void>;
  sampleRate: number;
  getContextState: () => AudioContextState;
  resumeContext: () => Promise<AudioContextState>;
}

/**
 * Starts a single-owner microphone capture pipeline that outputs 16 kHz mono Float32 frames.
 */
export async function startMicCapture(params: {
  existingStream?: MediaStream;
  onAudio16kFrame: (samples16k: Float32Array, amplitude: number) => void;
  onContextStateChange?: (state: AudioContextState) => void;
  onTrackEnded?: () => void;
}): Promise<{ handle: MicCaptureHandle; stream: MediaStream }> {
  const stream =
    params.existingStream ||
    (await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        channelCount: 1,
        sampleRate: { ideal: TARGET_SAMPLE_RATE },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    }));

  const audioTrack = stream.getAudioTracks()[0];
  if (audioTrack && params.onTrackEnded) {
    audioTrack.onended = () => {
      params.onTrackEnded?.();
    };
  }

  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx({ sampleRate: TARGET_SAMPLE_RATE });

  const tryResumeContext = async (timeoutMs = 350): Promise<AudioContextState> => {
    if (ctx.state === 'running' || ctx.state === 'closed') {
      return ctx.state;
    }
    try {
      await Promise.race([
        ctx.resume(),
        new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
      ]);
    } catch {
      // Autoplay policy can suspend AudioContext until a user gesture occurs
    }
    return ctx.state;
  };

  ctx.onstatechange = () => {
    params.onContextStateChange?.(ctx.state);
  };

  // Attempt resume with a short timeout so auto-resume without user gesture never hangs forever
  if (ctx.state === 'suspended') {
    await tryResumeContext(350);
  }

  const source = ctx.createMediaStreamSource(stream);
  const silentGain = ctx.createGain();
  silentGain.gain.value = 0;
  silentGain.connect(ctx.destination);

  let cleanupNode: (() => void) | null = null;

  if (ctx.audioWorklet && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const blob = new Blob([WORKLET_PROCESSOR_SOURCE], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      const workletNode = new AudioWorkletNode(ctx, 'roomwise-pcm-capture');
      workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const raw = event.data;
        if (!raw || raw.length === 0) return;
        const pcm16k = downsampleFloat32(raw, ctx.sampleRate, TARGET_SAMPLE_RATE);
        const amp = computeRmsAmplitude(pcm16k);
        params.onAudio16kFrame(pcm16k, amp);
      };
      source.connect(workletNode);
      workletNode.connect(silentGain);
      cleanupNode = () => {
        workletNode.port.onmessage = null;
        workletNode.disconnect();
      };
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
  } else {
    // Fallback for browsers without AudioWorklet
    const scriptNode = ctx.createScriptProcessor(2048, 1, 1);
    scriptNode.onaudioprocess = (event: AudioProcessingEvent) => {
      const raw = event.inputBuffer.getChannelData(0);
      const pcm16k = downsampleFloat32(raw, ctx.sampleRate, TARGET_SAMPLE_RATE);
      const amp = computeRmsAmplitude(pcm16k);
      params.onAudio16kFrame(pcm16k, amp);
    };
    source.connect(scriptNode);
    scriptNode.connect(silentGain);
    cleanupNode = () => {
      scriptNode.onaudioprocess = null;
      scriptNode.disconnect();
    };
  }

  return {
    stream,
    handle: {
      sampleRate: TARGET_SAMPLE_RATE,
      getContextState: () => ctx.state,
      resumeContext: () => tryResumeContext(600),
      stop: async () => {
        ctx.onstatechange = null;
        try {
          cleanupNode?.();
          source.disconnect();
          silentGain.disconnect();
        } catch {
          // ignore disconnect errors
        }
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            // ignore
          }
        });
        if (ctx.state !== 'closed') {
          await ctx.close().catch(() => undefined);
        }
      },
    },
  };
}
