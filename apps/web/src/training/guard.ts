import type { VizLevel } from '@noesis/engine-client';

/** A rough multiple of the table size that each algorithm needs while it trains. */
const FACTOR: Record<string, number> = {
  linear_regression: 3,
  ridge: 3,
  logistic_regression: 4,
  gradient_boosting: 4,
  random_forest: 6,
  mlp: 5,
};

/** Above this estimate the browser may run out of memory, so the screen warns first. */
export const WARN_MB = 1200;
/** Above this the run would almost certainly fail, so it does not start. */
export const BLOCK_MB = 2800;
/** A neural network in the browser handles about 94,000 row-epochs a second, so this is about a minute. */
export const MLP_ROW_EPOCH_LIMIT = 5_000_000;

export interface Guard {
  estimateMB: number;
  /** Why the run cannot start, or null. */
  blocking: string | null;
  /** A heads-up that does not stop the run, or null. */
  warning: string | null;
}

/**
 * Looks before the run starts: how much memory it will probably need, and whether a neural
 * network is bigger than the browser can finish in a reasonable time. The numbers are estimates
 * from the experiment (docs/research/spike-results.md), not promises.
 */
export function memoryGuard(
  rows: number,
  columns: number,
  algorithm: string,
  settings: { epochs?: number; folds?: number } = {},
): Guard {
  const factor = (FACTOR[algorithm] ?? 4) + (settings.folds ? 1 : 0);
  const estimateMB = Math.round((rows * columns * 8 * factor) / 1e6);
  if (algorithm === 'mlp' && settings.epochs && rows * settings.epochs > MLP_ROW_EPOCH_LIMIT) {
    return {
      estimateMB,
      blocking: `${rows.toLocaleString('en-GB')} rows for ${settings.epochs} epochs is more than the browser can train in a reasonable time. Lower the epochs, use fewer rows, or choose a random forest.`,
      warning: null,
    };
  }
  if (estimateMB > BLOCK_MB) {
    return {
      estimateMB,
      blocking: `This would need about ${estimateMB.toLocaleString('en-GB')} MB of memory, more than the browser can give. Use fewer rows or columns, or a lighter model.`,
      warning: null,
    };
  }
  if (estimateMB > WARN_MB) {
    return {
      estimateMB,
      blocking: null,
      warning: `This may need about ${estimateMB.toLocaleString('en-GB')} MB of memory. If the browser runs out, use fewer rows or columns.`,
    };
  }
  return { estimateMB, blocking: null, warning: null };
}

/** `full` detail up to 50,000 rows, `light` above, as the event design says. */
export const defaultViz = (rows: number): VizLevel => (rows <= 50_000 ? 'full' : 'light');
