import type { DatasetProfile, EarlyRunResult, LoadSettings } from '@noesis/engine-client';

/** Messages between the page and the engine worker. */
export type WorkerRequest =
  | { id: number; type: 'init'; interrupt: SharedArrayBuffer | null }
  | { id: number; type: 'openCsv'; name: string; bytes: ArrayBuffer; settings: LoadSettings }
  | { id: number; type: 'runEarly'; pipeline: string };

export type WorkerResult = DatasetProfile | EarlyRunResult | null;

export type WorkerMessage =
  | { type: 'progress'; stage: string; step: number; steps: number }
  | { type: 'result'; id: number; result: WorkerResult }
  | { type: 'error'; id: number; name: string; message: string };
