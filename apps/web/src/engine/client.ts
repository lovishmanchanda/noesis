import {
  CancelledError,
  type DatasetProfile,
  type Engine,
  type EarlyRunResult,
  type EngineProgress,
  type LoadSettings,
} from '@noesis/engine-client';
import type { WorkerMessage, WorkerRequest, WorkerResult } from './protocol';

type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never;

/** The in-browser engine: talks to the Python worker. */
export class BrowserEngine implements Engine {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: WorkerResult) => void; reject: (reason: Error) => void }
  >();
  private onProgress: (progress: EngineProgress) => void = () => undefined;
  private interrupt: Int32Array | null = null;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        this.onProgress({ stage: message.stage, step: message.step, steps: message.steps });
        return;
      }
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.type === 'result') waiting.resolve(message.result);
      else
        waiting.reject(
          message.name === 'KeyboardInterrupt' ? new CancelledError() : new Error(message.message),
        );
    };
    this.worker.onerror = (event) => {
      for (const waiting of this.pending.values())
        waiting.reject(new Error(event.message || 'The engine stopped unexpectedly'));
      this.pending.clear();
    };
  }

  private send(message: Distribute<WorkerRequest>): Promise<WorkerResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id });
    });
  }

  async init(onProgress: (progress: EngineProgress) => void): Promise<void> {
    this.onProgress = onProgress;
    // Stopping running Python needs shared memory, which needs the page to be cross-origin isolated.
    const shared = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated;
    const buffer = shared ? new SharedArrayBuffer(4) : null;
    this.interrupt = buffer ? new Int32Array(buffer) : null;
    await this.send({ type: 'init', interrupt: buffer });
  }

  async openCsv(
    file: { name: string; bytes: ArrayBuffer },
    settings: LoadSettings = {},
  ): Promise<DatasetProfile> {
    return (await this.send({
      type: 'openCsv',
      name: file.name,
      bytes: file.bytes,
      settings,
    })) as DatasetProfile;
  }

  async runEarly(pipeline: string): Promise<EarlyRunResult> {
    return (await this.send({ type: 'runEarly', pipeline })) as EarlyRunResult;
  }

  cancel(): void {
    if (this.interrupt) Atomics.store(this.interrupt, 0, 2);
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
