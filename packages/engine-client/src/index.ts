/**
 * The contract between the app and whatever runs the Python steps: the in-browser worker today,
 * the local companion later. See docs/architecture/engine-choice.md.
 */

export type ColumnDtype = 'int' | 'float' | 'bool' | 'category' | 'string' | 'datetime';

export interface ColumnProfile {
  name: string;
  dtype: ColumnDtype;
  missing: number;
  missingPct: number;
  unique: number;
  uniquePct: number;
  constant: boolean;
  /** Looks like an identifier: nearly every value is different. */
  idLike: boolean;
  /** Text that is really numbers (at least 95% of values parse as numbers). */
  numberLike?: boolean;
  min?: number | string | null;
  max?: number | string | null;
  mean?: number | null;
  median?: number | null;
  std?: number | null;
  skew?: number | null;
  q1?: number | null;
  q3?: number | null;
  outliers?: number;
  /** Correlation with the target (number columns), when the target is a number or has two classes. */
  targetCorr?: number | null;
  /** Correlation of a date column with the target: does the target drift over time? */
  targetTrend?: number | null;
  histogram?: { counts: number[]; min: number | null; max: number | null };
  top?: { value: string; count: number }[];
}

export interface TargetProfile {
  name: string;
  missing: number;
  unique: number;
  classes: { value: string; count: number }[];
  minorityShare?: number | null;
  skew?: number | null;
}

export interface DatasetProfile {
  rows: number;
  columnCount: number;
  duplicates: number;
  memoryMB: number | null;
  columns: ColumnProfile[];
  target?: TargetProfile;
}

/** Rows per part, and the profile of what the early steps produced. */
export interface EarlyRunResult {
  rows: Record<string, number>;
  /** After a split: the profile of the training rows right after the split, before any fill or encode. */
  trainProfile?: DatasetProfile;
  /** The training rows as they leave the last step: what a model would receive. */
  outputProfile?: DatasetProfile;
  /** Which steps ran and which were loaded from the result cache. */
  ran?: { executed: string[]; reused: string[] };
  cache?: { entries: number; megabytes: number; format: string };
  /** Before a split: the profile of the single table. */
  profile?: DatasetProfile;
}

export interface LoadSettings {
  delimiter?: string;
  header?: boolean;
  encoding?: string;
  missingMarkers?: string[];
  sampleRows?: number | null;
}

/** How much detail a training run reports. `full` sends everything, `off` only the basics. */
export type VizLevel = 'off' | 'light' | 'full';

/** One thing that happened during a run (see docs/design/training-events.md). */
export interface TrainingEvent {
  v: 1;
  runId: string;
  /** Counts up by one per event. A gap means a droppable event was dropped. */
  seq: number;
  /** Milliseconds since the run started. */
  t: number;
  node: string | null;
  trial: number | null;
  type: string;
  /** `live` came from the real training process, `replay` was rebuilt from the fitted model. */
  source: 'live' | 'replay';
  data: Record<string, unknown>;
}

export type Scores = Record<string, number | null>;

export interface RunError {
  code: string;
  message: string;
  hint: string;
}

/** What a training run produced. */
export interface TrainOutcome {
  status: 'succeeded' | 'failed' | 'cancelled';
  durationMs: number;
  error?: RunError;
  modelNode?: string;
  algorithm?: string;
  /** Per-algorithm detail from the fit: curves, early stopping, number of trees. */
  fit?: Record<string, unknown> | null;
  train?: Scores | null;
  validation?: Scores | null;
  method?: string;
  spread?: Record<string, { mean: number | null; std: number | null }> | null;
  folds?: Scores[] | null;
  timings?: Record<string, number>;
  ran?: { executed: string[]; reused: string[] };
}

export interface TrainRequest {
  pipeline: string;
  hashes: Record<string, string>;
  runId: string;
  viz: VizLevel;
}

export type EnginePhase = 'idle' | 'loading' | 'ready' | 'error';

export interface EngineProgress {
  /** Plain-language name of what is happening. */
  stage: string;
  step: number;
  steps: number;
}

export interface Engine {
  /** Starts the engine. Resolves when it is ready to work. */
  init(onProgress: (progress: EngineProgress) => void): Promise<void>;
  /** Reads a CSV file the user chose. The bytes stay on this computer. */
  openCsv(
    file: { name: string; bytes: ArrayBuffer },
    settings?: LoadSettings,
  ): Promise<DatasetProfile>;
  /**
   * Runs a pipeline of data and preparation steps on the open file. `pipeline` is the pipeline
   * JSON. `hashes` maps each step id to its hash; steps whose result is cached under that hash
   * are loaded instead of run.
   */
  runEarly(pipeline: string, hashes?: Record<string, string>): Promise<EarlyRunResult>;
  /**
   * Trains the model the pipeline ends with and validates it, streaming events as they happen.
   * `onEvents` gets batches of events (roughly 30 times a second at most).
   */
  train(request: TrainRequest, onEvents: (events: TrainingEvent[]) => void): Promise<TrainOutcome>;
  /** Asks the running job to stop. Resolves when the engine is ready for the next job. */
  cancel(): Promise<void>;
  dispose(): void;
}

/** Thrown when a job was stopped by the user. */
export class CancelledError extends Error {
  constructor() {
    super('Stopped');
    this.name = 'CancelledError';
  }
}
