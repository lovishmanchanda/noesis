import type { Stage, Suggestion } from './types';

export type StageState = 'todo' | 'incomplete' | 'done' | 'outdated';

export interface StageInfo {
  id: Stage;
  /** A required stage must be done before the ones after it can run. */
  required: boolean;
  state: StageState;
  /** Why the stage cannot run yet, in one line. */
  blockedBy?: string;
}

export interface NextStep {
  /** The first required stage that is not done. */
  next: Stage | null;
  /** Optional stages with an open warning. */
  recommended: Stage[];
  blocked: Partial<Record<Stage, string>>;
}

/**
 * The next best step: the first required stage that is not done. Optional stages get a
 * "recommended" mark when they have an open suggestion of severity warn or higher.
 */
export function nextBestStep(stages: StageInfo[], open: Suggestion[]): NextStep {
  const next = stages.find((s) => s.required && s.state !== 'done')?.id ?? null;
  const loud = new Set(
    open.filter((s) => s.severity === 'warn' || s.severity === 'alert').map((s) => s.stage),
  );
  return {
    next,
    recommended: stages
      .filter((s) => !s.required && s.state !== 'done' && loud.has(s.id))
      .map((s) => s.id),
    blocked: Object.fromEntries(stages.filter((s) => s.blockedBy).map((s) => [s.id, s.blockedBy])),
  };
}
