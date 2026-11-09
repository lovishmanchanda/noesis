import type { ColumnProfile, DatasetProfile } from '@noesis/engine-client';
import { stepFor } from '../pipeline/prepare';
import type { ProjectState } from '../state/project';

/** The profile of the training rows right after the split, or undefined before the split. */
export const trainProfileOf = (p: ProjectState): DatasetProfile | undefined =>
  p.splitResult?.trainProfile;

/** True for columns that will reach a model: feature role, and not removed in Tidy. */
export function isFeature(p: ProjectState, name: string): boolean {
  return (p.roles[name] ?? 'feature') === 'feature' && !p.tidy.dropColumns.includes(name);
}

export function featureColumns(p: ProjectState): ColumnProfile[] {
  return (trainProfileOf(p)?.columns ?? []).filter((c) => isFeature(p, c.name));
}

/** Feature columns that still have empty cells and no step to fill them. */
export function unfilled(p: ProjectState): ColumnProfile[] {
  return featureColumns(p).filter(
    (c) => c.missing > 0 && c.dtype !== 'datetime' && !stepFor(p.prepare, 'impute', c.name),
  );
}

/**
 * Columns that would still reach a model as text or dates, or with empty cells, judged by the
 * training rows as they leave the last step.
 */
export function notReady(p: ProjectState): { text: ColumnProfile[]; empty: ColumnProfile[] } {
  const output = p.splitResult?.outputProfile ?? p.splitResult?.trainProfile;
  const reaching = (output?.columns ?? []).filter(
    (c) => (p.roles[c.name] ?? 'feature') === 'feature' && !p.tidy.dropColumns.includes(c.name),
  );
  return {
    text: reaching.filter(
      (c) => c.dtype === 'category' || c.dtype === 'string' || c.dtype === 'datetime',
    ),
    empty: reaching.filter((c) => c.missing > 0),
  };
}

export const names = (columns: ColumnProfile[], limit = 4): string => {
  const shown = columns.slice(0, limit).map((c) => `“${c.name}”`);
  return columns.length > limit
    ? `${shown.join(', ')} and ${columns.length - limit} more`
    : shown.join(', ');
};
