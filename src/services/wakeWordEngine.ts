/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WakeLoadStage } from '../types/voice';

const WAKE_MODEL_URL = '/models/vosk-wake-roomwise.tar.gz';
const WAKE_WORKER_URL = '/models/vosk-wake-worker.js';
const WAKE_CACHE_NAME = 'roomwise-wake-v2';
const WAKE_SAMPLE_RATE = 16000;
const WAKE_COOLDOWN_MS = 3200;
const MIN_SPEECH_RMS = 0.0065;
const VOICE_ACTIVITY_WINDOW_MS = 2000;
const MAX_IN_FLIGHT_CHUNKS = 8;
const BACKPRESSURE_STALL_RESET_MS = 3000;
const RECOGNIZER_CREATE_TIMEOUT_MS = 10000;

// Kaldi AcceptWaveform(float*, int) expects float32 samples scaled to signed 16-bit PCM range [-32768, 32767]
const KALDI_PCM_SCALE = 32768;

// Focused wake grammar with natural US/Indian-English phonetic variants for "Hey Roomwise"
// Prevents isolated single-word false triggers like bare "room" or "hey"
const WAKE_GRAMMAR = JSON.stringify([
  'hey room wise',
  'okay room wise',
  'ok room wise',
  'hi room wise',
  'a room wise',
  'room wise',
  'hey room eyes',
  'okay room eyes',
  'ok room eyes',
  'hi room eyes',
  'hey room vice',
  'okay room vice',
  'ok room vice',
  'hey room white',
  'hey room mice',
  'hey room was',
  'hey room rise',
  'hey room lies',
  'hey rum wise',
  '[unk]',
]);

const EXACT_WAKE_PATTERN = /(?:^|\s)(?:hey|okay|ok|hi|a)?\s*(?:room\s*wise|roomwise|rum\s*wise)(?:\s|$)/i;
const PREFIXED_PHONETIC_WAKE_PATTERN =
  /(?:^|\s)(?:hey|okay|ok|hi|a)\s+(?:room\s*(?:eyes|vice|white|mice|was|rise|lies|wives|twice)|rum\s*(?:eyes|vice|wise))(?:\s|$)/i;

export interface WakeWordTriggerEvent {
  phrase: string;
  source: 'result' | 'partial';
  timestamp: number;
}

export interface WakeWordStatusUpdate {
  modelReady: boolean;
  stage: WakeLoadStage;
  error?: string;
}

interface WorkerRecognizerCallbacks {
  onPartial: (partial: string) => void;
  onResult: (text: string) => void;
  onCreated?: () => void;
  onError?: (err: string) => void;
}

interface WakeWorkerState {
  worker: Worker;
  ready: boolean;
  callbacks: Map<string, WorkerRecognizerCallbacks>;
  nextRecognizerSeq: number;
  inFlightChunks: number;
  lastChunkSentAt: number;
}

// Module-level cached Worker + Model singleton so re-enabling standby or remounting avoids reloading/re-extracting
let sharedWorkerPromise: Promise<WakeWorkerState> | null = null;
let sharedWorkerState: WakeWorkerState | null = null;
let sharedLoadStage: WakeLoadStage = 'idle';
const sharedStageListeners = new Set<(stage: WakeLoadStage) => void>();
let preloadArchivePromise: Promise<void> | null = null;

function setSharedLoadStage(stage: WakeLoadStage): void {
  if (sharedLoadStage === stage) return;
  sharedLoadStage = stage;
  for (const listener of sharedStageListeners) {
    try {
      listener(stage);
    } catch {
      // ignore listener error
    }
  }
}

function getLoadTimeoutMs(): number {
  if (typeof window === 'undefined') return 60000;
  const coarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const smallViewport = window.innerWidth < 768;
  return coarse || smallViewport ? 120000 : 60000;
}

async function getOrLoadSharedWakeWorker(): Promise<WakeWorkerState> {
  if (sharedWorkerState && sharedWorkerState.ready) {
    setSharedLoadStage('ready');
    return sharedWorkerState;
  }
  if (sharedWorkerPromise) {
    return sharedWorkerPromise;
  }

  setSharedLoadStage('downloading');

  sharedWorkerPromise = new Promise<WakeWorkerState>((resolve, reject) => {
    let settled = false;
    let worker: Worker;

    try {
      worker = new Worker(WAKE_WORKER_URL);
    } catch (err) {
      sharedWorkerPromise = null;
      setSharedLoadStage('error');
      reject(
        err instanceof Error
          ? err
          : new Error('Unable to start offline wake-word background worker.')
      );
      return;
    }

    const state: WakeWorkerState = {
      worker,
      ready: false,
      callbacks: new Map(),
      nextRecognizerSeq: 1,
      inFlightChunks: 0,
      lastChunkSentAt: 0,
    };

    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      sharedWorkerPromise = null;
      sharedWorkerState = null;
      setSharedLoadStage('error');
      try {
        worker.terminate();
      } catch {
        // ignore
      }
      reject(new Error('Local wake-word model timed out while loading.'));
    }, getLoadTimeoutMs());

    worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      const evType = msg.event;
      const recId = typeof msg.recognizerId === 'string' ? msg.recognizerId : '';

      if (evType === 'progress') {
        const rawStage = msg.stage;
        if (
          rawStage === 'downloading' ||
          rawStage === 'extracting' ||
          rawStage === 'initializing'
        ) {
          setSharedLoadStage(rawStage);
        }
        return;
      }

      if (evType === 'load') {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeoutId);
          state.ready = true;
          sharedWorkerState = state;
          setSharedLoadStage('creating_recognizer');
          resolve(state);
        }
        return;
      }

      if (evType === 'error') {
        const errMsg = typeof msg.error === 'string' ? msg.error : 'Wake-word worker error.';
        if (!settled) {
          settled = true;
          window.clearTimeout(timeoutId);
          sharedWorkerPromise = null;
          sharedWorkerState = null;
          setSharedLoadStage('error');
          try {
            worker.terminate();
          } catch {
            // ignore
          }
          reject(new Error(errMsg));
          return;
        }
        if (recId) {
          state.inFlightChunks = Math.max(0, state.inFlightChunks - 1);
          state.callbacks.get(recId)?.onError?.(errMsg);
        }
        return;
      }

      if (evType === 'create' && recId) {
        state.callbacks.get(recId)?.onCreated?.();
        return;
      }

      if (evType === 'partialresult' && recId) {
        state.inFlightChunks = Math.max(0, state.inFlightChunks - 1);
        const res = msg.result as { partial?: unknown } | undefined;
        const partial = res && typeof res.partial === 'string' ? res.partial.trim() : '';
        if (partial) {
          state.callbacks.get(recId)?.onPartial(partial);
        }
        return;
      }

      if (evType === 'result' && recId) {
        state.inFlightChunks = Math.max(0, state.inFlightChunks - 1);
        const res = msg.result as { text?: unknown } | undefined;
        const text = res && typeof res.text === 'string' ? res.text.trim() : '';
        if (text) {
          state.callbacks.get(recId)?.onResult(text);
        }
      }
    };

    worker.onerror = (errEvent) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timeoutId);
        sharedWorkerPromise = null;
        sharedWorkerState = null;
        setSharedLoadStage('error');
        try {
          worker.terminate();
        } catch {
          // ignore
        }
        reject(new Error(errEvent.message || 'Offline wake-word worker crashed.'));
      }
    };

    worker.postMessage({ action: 'set', key: 'logLevel', value: -2 });
    worker.postMessage({ action: 'load', modelUrl: WAKE_MODEL_URL });
  });

  return sharedWorkerPromise;
}

export class LocalWakeWordEngine {
  private workerState: WakeWorkerState | null = null;
  private recognizerId: string | null = null;
  private recognizerReady = false;
  private loadingPromise: Promise<void> | null = null;
  private paused = false;
  private disposed = false;
  private lastTriggerAt = 0;
  private lastVoiceActivityAt = 0;
  private onWakeDetected: (event: WakeWordTriggerEvent) => void;
  private onStatus?: (status: WakeWordStatusUpdate) => void;
  private stageListener: ((stage: WakeLoadStage) => void) | null = null;

  constructor(options: {
    onWakeDetected: (event: WakeWordTriggerEvent) => void;
    onStatus?: (status: WakeWordStatusUpdate) => void;
  }) {
    this.onWakeDetected = options.onWakeDetected;
    this.onStatus = options.onStatus;

    this.stageListener = (stage: WakeLoadStage) => {
      if (this.disposed) return;
      // Only report modelReady=true once this engine's own recognizer has confirmed creation
      const ready = stage === 'ready' && this.recognizerReady;
      this.onStatus?.({ modelReady: ready, stage });
    };
    sharedStageListeners.add(this.stageListener);
  }

  public isReady(): boolean {
    return Boolean(
      this.workerState &&
        this.workerState.ready &&
        this.recognizerId &&
        this.recognizerReady &&
        !this.disposed
    );
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  private createRecognizerInstance(state: WakeWorkerState): {
    recId: string;
    readyPromise: Promise<void>;
  } {
    const recId = `rw-wake-${state.nextRecognizerSeq++}`;
    let fallbackAttempted = false;
    let settled = false;
    let resolveReady!: () => void;
    let rejectReady!: (err: Error) => void;

    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const createTimeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectReady(new Error('Wake-word recognizer initialization timed out.'));
    }, RECOGNIZER_CREATE_TIMEOUT_MS);

    state.callbacks.set(recId, {
      onCreated: () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(createTimeoutId);
        if (!this.disposed && this.recognizerId === recId) {
          this.recognizerReady = true;
        }
        resolveReady();
      },
      onPartial: (partial) => {
        if (this.paused || this.disposed || recId !== this.recognizerId) return;
        this.evaluateTranscript(partial, 'partial');
      },
      onResult: (text) => {
        if (this.paused || this.disposed || recId !== this.recognizerId) return;
        this.evaluateTranscript(text, 'result');
      },
      onError: (errMsg) => {
        // Fallback once without custom grammar if runtime rejects phrase grammar
        if (!fallbackAttempted && !this.disposed && recId === this.recognizerId) {
          fallbackAttempted = true;
          try {
            state.worker.postMessage({
              action: 'create',
              recognizerId: recId,
              sampleRate: WAKE_SAMPLE_RATE,
            });
            return;
          } catch {
            // fall through to reject
          }
        }
        if (!settled) {
          settled = true;
          window.clearTimeout(createTimeoutId);
          rejectReady(new Error(errMsg || 'Wake-word recognizer failed to initialize.'));
        }
      },
    });

    this.recognizerReady = false;
    this.recognizerId = recId;
    state.worker.postMessage({
      action: 'create',
      recognizerId: recId,
      sampleRate: WAKE_SAMPLE_RATE,
      grammar: WAKE_GRAMMAR,
    });

    return { recId, readyPromise };
  }

  private removeRecognizerInstance(recId: string | null): void {
    if (!recId || !this.workerState) return;
    this.workerState.callbacks.delete(recId);
    try {
      this.workerState.worker.postMessage({ action: 'remove', recognizerId: recId });
    } catch {
      // ignore cleanup error
    }
  }

  /**
   * Tears down and recreates the KaldiRecognizer so no buffered
   * wake-phrase tokens, stale backpressure counts, or speaker-echo tail can re-fire when returning to standby.
   */
  public resetRecognizer(): void {
    if (this.disposed || !this.workerState || !this.workerState.ready) {
      return;
    }
    const oldRecId = this.recognizerId;
    this.recognizerId = null;
    this.recognizerReady = false;
    this.lastVoiceActivityAt = 0;
    this.workerState.inFlightChunks = 0;
    this.workerState.lastChunkSentAt = 0;

    this.removeRecognizerInstance(oldRecId);

    try {
      const { readyPromise } = this.createRecognizerInstance(this.workerState);
      void readyPromise.catch(() => {
        // Non-fatal on background reset; next ensureLoaded will retry cleanly
      });
    } catch {
      this.recognizerId = null;
      this.recognizerReady = false;
    }
  }

  public async ensureLoaded(): Promise<void> {
    if (this.disposed) {
      throw new Error('Wake-word engine has been disposed.');
    }
    if (this.isReady()) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      try {
        if (sharedLoadStage !== 'idle' && sharedLoadStage !== 'ready') {
          this.onStatus?.({ modelReady: false, stage: sharedLoadStage });
        } else if (!sharedWorkerState?.ready) {
          this.onStatus?.({ modelReady: false, stage: 'downloading' });
        }

        const state = await getOrLoadSharedWakeWorker();

        if (this.disposed) {
          return;
        }

        this.workerState = state;
        this.onStatus?.({ modelReady: false, stage: 'creating_recognizer' });

        if (this.recognizerId) {
          this.removeRecognizerInstance(this.recognizerId);
          this.recognizerId = null;
          this.recognizerReady = false;
        }

        const { readyPromise } = this.createRecognizerInstance(state);
        await readyPromise;

        if (this.disposed) {
          return;
        }

        setSharedLoadStage('ready');
        this.onStatus?.({ modelReady: true, stage: 'ready' });
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to load offline wake-word model.';
        this.onStatus?.({ modelReady: false, stage: 'error', error: msg });
        throw err;
      } finally {
        this.loadingPromise = null;
      }
    })();

    return this.loadingPromise;
  }

  private evaluateTranscript(text: string, source: 'result' | 'partial'): void {
    const now = Date.now();
    if (now - this.lastTriggerAt < WAKE_COOLDOWN_MS) return;

    // Reject stale worker emissions if no genuine vocal energy arrived recently
    if (now - this.lastVoiceActivityAt > VOICE_ACTIVITY_WINDOW_MS) return;

    const normalized = text.toLowerCase().replace(/\[unk\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) return;

    if (
      EXACT_WAKE_PATTERN.test(normalized) ||
      PREFIXED_PHONETIC_WAKE_PATTERN.test(normalized)
    ) {
      this.lastTriggerAt = now;
      this.paused = true;
      this.resetRecognizer();
      this.onWakeDetected({
        phrase: normalized,
        source,
        timestamp: now,
      });
    }
  }

  public processAudioFrame16k(samples16k: Float32Array): void {
    if (
      this.paused ||
      this.disposed ||
      !this.recognizerId ||
      !this.recognizerReady ||
      !this.workerState?.ready
    ) {
      return;
    }

    const now = Date.now();

    // Track vocal energy so silence/worker flush cannot emit phantom wake triggers
    let sumSq = 0;
    for (let i = 0; i < samples16k.length; i += 4) {
      const s = samples16k[i];
      sumSq += s * s;
    }
    const sampledCount = Math.max(1, Math.ceil(samples16k.length / 4));
    const rms = Math.sqrt(sumSq / sampledCount);
    if (rms >= MIN_SPEECH_RMS) {
      this.lastVoiceActivityAt = now;
    }

    // Backpressure guard for slower mobile devices with automatic stall recovery
    if (this.workerState.inFlightChunks >= MAX_IN_FLIGHT_CHUNKS) {
      if (
        this.workerState.lastChunkSentAt > 0 &&
        now - this.workerState.lastChunkSentAt > BACKPRESSURE_STALL_RESET_MS
      ) {
        this.workerState.inFlightChunks = 0;
      } else {
        return;
      }
    }

    try {
      // Scale normalized WebAudio Float32 [-1, 1] samples into signed 16-bit PCM range [-32768, 32767]
      // required by KaldiRecognizer::AcceptWaveform(float*, int) inside vosk-wake-worker.js
      const scaled = new Float32Array(samples16k.length);
      for (let i = 0; i < samples16k.length; i++) {
        const v = samples16k[i] * KALDI_PCM_SCALE;
        scaled[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
      this.workerState.inFlightChunks += 1;
      this.workerState.lastChunkSentAt = now;
      this.workerState.worker.postMessage(
        {
          action: 'audioChunk',
          recognizerId: this.recognizerId,
          sampleRate: WAKE_SAMPLE_RATE,
          data: scaled,
        },
        [scaled.buffer]
      );
    } catch {
      this.workerState.inFlightChunks = Math.max(0, this.workerState.inFlightChunks - 1);
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.paused = true;
    if (this.stageListener) {
      sharedStageListeners.delete(this.stageListener);
      this.stageListener = null;
    }
    const oldRecId = this.recognizerId;
    this.recognizerId = null;
    this.recognizerReady = false;
    this.removeRecognizerInstance(oldRecId);
    // Keep sharedWorkerState warm so re-enabling standby is near-instant
    this.workerState = null;
    this.loadingPromise = null;
  }
}

async function warmModelArchiveInCacheStorage(): Promise<void> {
  if (typeof window === 'undefined' || typeof caches === 'undefined') return;
  if (preloadArchivePromise) return preloadArchivePromise;

  preloadArchivePromise = (async () => {
    try {
      const fullModelUrl = new URL(WAKE_MODEL_URL, window.location.href).href;
      const cache = await caches.open(WAKE_CACHE_NAME);
      const existing = await cache.match(fullModelUrl);
      if (existing && existing.ok) return;

      const resp = await fetch(fullModelUrl);
      if (resp.ok) {
        await cache.put(fullModelUrl, resp.clone());
      }
    } catch {
      // Non-fatal background cache warm-up
    } finally {
      preloadArchivePromise = null;
    }
  })();

  return preloadArchivePromise;
}

export function preloadWakeEngineAssets(warmWorker = false): void {
  if (typeof window === 'undefined') return;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData && !warmWorker) {
    return;
  }

  if (warmWorker) {
    void getOrLoadSharedWakeWorker().catch(() => {
      // Non-fatal background warm-up
    });
    return;
  }

  try {
    void fetch(WAKE_WORKER_URL, { cache: 'force-cache' }).catch(() => undefined);
    void warmModelArchiveInCacheStorage();
  } catch {
    // Ignore prefetch errors
  }
}
