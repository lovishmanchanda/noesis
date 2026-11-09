import {
  CancelledError,
  type DatasetProfile,
  type Engine,
  type EarlyRunResult,
  type EngineProgress,
  type LoadSettings,
  type TrainOutcome,
  type TrainRequest,
  type TrainingEvent,
} from '@noesis/engine-client';
import { friendlyError } from './errors';
import type { WorkerMessage, WorkerRequest, WorkerResult } from './protocol';

type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never;
interface Waiting {
  resolve: (value: WorkerResult) => void;
  reject: (reason: Error) => void;
  onEvents?: (events: TrainingEvent[]) => void;
}

/** The in-browser engine: talks to the Python worker. */
export class BrowserEngine implements Engine {
  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<number, Waiting>();
  private onProgress: (progress: EngineProgress) => void = () => undefined;
  private interrupt: Int32Array | null = null;
  private cancelFlag: Int32Array | null = null;
  private buffers: { interrupt: SharedArrayBuffer | null; cancel: SharedArrayBuffer | null } = {
    interrupt: null,
    cancel: null,
  };
  /** The file that is open, so a restarted engine can open it again. */
  private lastOpen: { file: { name: string; bytes: ArrayBuffer }; settings: LoadSettings } | null =
    null;

  constructor() {
    this.spawn();
  }

  private spawn(): void {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        this.onProgress({ stage: message.stage, step: message.step, steps: message.steps });
        return;
      }
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      if (message.type === 'events') {
        waiting.onEvents?.(message.events);
        return;
      }
      this.pending.delete(message.id);
      if (message.type === 'result') waiting.resolve(message.result);
      else
        waiting.reject(
          message.name === 'KeyboardInterrupt'
            ? new CancelledError()
            : new Error(friendlyError(message.name, message.message)),
        );
    };
    this.worker.onerror = (event) => {
      for (const waiting of this.pending.values())
        waiting.reject(new Error(event.message || 'The engine stopped unexpectedly'));
      this.pending.clear();
    };
  }

  private send(
    message: Distribute<WorkerRequest>,
    onEvents?: (events: TrainingEvent[]) => void,
  ): Promise<WorkerResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, ...(onEvents ? { onEvents } : {}) });
      this.worker.postMessage({ ...message, id });
    });
  }

  async init(onProgress: (progress: EngineProgress) => void): Promise<void> {
    this.onProgress = onProgress;
    // Stopping running Python needs shared memory, which needs the page to be cross-origin isolated.
    const shared = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated;
    this.buffers = {
      interrupt: shared ? new SharedArrayBuffer(4) : null,
      cancel: shared ? new SharedArrayBuffer(4) : null,
    };
    this.interrupt = this.buffers.interrupt ? new Int32Array(this.buffers.interrupt) : null;
    this.cancelFlag = this.buffers.cancel ? new Int32Array(this.buffers.cancel) : null;
    await this.send({ type: 'init', ...this.buffers });
  }

  async openCsv(
    file: { name: string; bytes: ArrayBuffer },
    settings: LoadSettings = {},
  ): Promise<DatasetProfile> {
    this.lastOpen = { file: { name: file.name, bytes: file.bytes.slice(0) }, settings };
    return (await this.send({
      type: 'openCsv',
      name: file.name,
      bytes: file.bytes,
      settings,
    })) as DatasetProfile;
  }

  async runEarly(pipeline: string, hashes: Record<string, string> = {}): Promise<EarlyRunResult> {
    return (await this.send({
      type: 'runEarly',
      pipeline,
      hashes: JSON.stringify(hashes),
    })) as EarlyRunResult;
  }

  async train(
    request: TrainRequest,
    onEvents: (events: TrainingEvent[]) => void,
  ): Promise<TrainOutcome> {
    if (this.cancelFlag) Atomics.store(this.cancelFlag, 0, 0);
    return (await this.send(
      {
        type: 'train',
        pipeline: request.pipeline,
        hashes: JSON.stringify(request.hashes),
        runId: request.runId,
        viz: request.viz,
      },
      onEvents,
    )) as TrainOutcome;
  }

  /**
   * Stops the running job. With shared memory the training loop sees a flag at its next step and
   * the interrupt stops long library calls, so the engine keeps its state. Without it, the only
   * way to stop is to throw the worker away and start a new one, which takes a few seconds.
   */
  async cancel(): Promise<void> {
    if (this.pending.size === 0) return;
    if (this.cancelFlag && this.interrupt) {
      Atomics.store(this.cancelFlag, 0, 1);
      Atomics.store(this.interrupt, 0, 2);
      return;
    }
    const waiting = [...this.pending.values()];
    this.pending.clear();
    this.worker.terminate();
    for (const w of waiting) w.reject(new CancelledError());
    this.spawn();
    await this.init(this.onProgress);
    if (this.lastOpen) await this.openCsv(this.lastOpen.file, this.lastOpen.settings);
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
