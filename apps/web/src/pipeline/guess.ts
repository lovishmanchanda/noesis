import type { ColumnProfile, DatasetProfile } from '@noesis/engine-client';
import type { Goal, Role } from '../state/project';

export const TASK_OF_GOAL = {
  number: 'regression',
  category: 'classification',
  groups: 'clustering',
} as const;
export const METRIC_OF_GOAL = { number: 'rmse', category: 'f1', groups: 'silhouette' } as const;

/** Starting roles: identifier-like columns are left out, everything else is a feature. */
export function defaultRoles(profile: DatasetProfile): Record<string, Role> {
  return Object.fromEntries(
    profile.columns.map((c) => [c.name, c.idLike ? 'exclude' : 'feature'] as const),
  );
}

/** What is wrong with using this column as the target for this goal, or null if it is fine. */
export function targetProblem(goal: Goal, column: ColumnProfile): string | null {
  const numeric = column.dtype === 'int' || column.dtype === 'float';
  if (goal === 'number') {
    if (!numeric) return 'This column is not numeric, so it cannot be predicted as a number.';
    if (column.unique <= 10)
      return `This column has only ${column.unique} different values. Predicting a category suits it better.`;
    return null;
  }
  if (goal === 'category') {
    if (column.dtype === 'float' && column.unique > 20)
      return 'This column looks like a measured number. Predicting a number suits it better.';
    if (column.unique > 50)
      return `This column has ${column.unique} different values, which is too many classes.`;
    if (column.unique < 2) return 'This column has a single value, so there is nothing to predict.';
    return null;
  }
  return 'Grouping rows does not use a target column.';
}

export function describeGoal(goal: Goal): string {
  return { number: 'a number', category: 'a category', groups: 'groups of similar rows' }[goal];
}
