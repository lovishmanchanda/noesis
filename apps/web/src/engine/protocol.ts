import type {
  DatasetProfile,
  EarlyRunResult,
  LoadSettings,
  TrainOutcome,
  TrainingEvent,
  VizLevel,
} from '@noesis/engine-client';

/** Messages between the page and the engine worker. */
export type WorkerRequest =
  | {
      id: number;
      type: 'init';
      interrupt: SharedArrayBuffer | null;
      cancel: SharedArrayBuffer | null;
    }
  | { id: number; type: 'openCsv'; name: string; bytes: ArrayBuffer; settings: LoadSettings }
  | { id: number; type: 'runEarly'; pipeline: string; hashes: string }
  | {
      id: number;
      type: 'train';
      pipeline: string;
      hashes: string;
      runId: string;
      viz: VizLevel;
    };

export type WorkerResult = DatasetProfile | EarlyRunResult | TrainOutcome | null;

export type WorkerMessage =
  | { type: 'progress'; stage: string; step: number; steps: number }
  | { type: 'events'; id: number; events: TrainingEvent[] }
  | { type: 'result'; id: number; result: WorkerResult }
  | { type: 'error'; id: number; name: string; message: string };
