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
  /** After a split: the profile of the training rows only. */
  trainProfile?: DatasetProfile;
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
  /** Runs a pipeline of data steps on the open file. `pipeline` is the pipeline JSON. */
  runEarly(pipeline: string): Promise<EarlyRunResult>;
  /** Asks the running job to stop. */
  cancel(): void;
  dispose(): void;
}

/** Thrown when a job was stopped by the user. */
export class CancelledError extends Error {
  constructor() {
    super('Stopped');
    this.name = 'CancelledError';
  }
}
