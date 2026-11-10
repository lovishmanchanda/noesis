import { targetProblem } from '../pipeline/guess';
import type { RunRecord } from '../runs/records';
import { names, notReady, unfilled } from '../screens/shared';
import type { ScreenId } from '../screens';
import type { ProjectState } from './project';

/** Why the user cannot move on from a screen yet, or undefined when they can. */
export function blockedReason(
  screen: ScreenId,
  p: ProjectState,
  runs: readonly RunRecord[] = [],
): string | undefined {
  switch (screen) {
    case 'project':
      if (!p.name.trim()) return 'Give the project a name.';
      if (!p.goal) return 'Choose what you want to find out.';
      return undefined;
    case 'data':
      if (!p.dataset) return 'Add a CSV file first.';
      if (p.dataset.profile.columnCount < 2)
        return 'The file needs at least 2 columns. Check the separator.';
      if (p.dataset.profile.rows < 50) return 'The file needs at least 50 rows.';
      return undefined;
    case 'target': {
      if (!p.dataset || !p.goal) return 'Add a file first.';
      const features = Object.values(p.roles).filter((r) => r === 'feature').length;
      if (p.goal === 'groups')
        return features < 2 ? 'Keep at least 2 columns that describe a row.' : undefined;
      const target = Object.keys(p.roles).find((c) => p.roles[c] === 'target');
      if (!target) return 'Choose the column to predict.';
      const column = p.dataset.profile.columns.find((c) => c.name === target);
      const problem = column ? targetProblem(p.goal, column) : null;
      if (problem) return problem;
      return features < 1 ? 'Keep at least 1 column to learn from.' : undefined;
    }
    case 'split': {
      const [train, validation, test] = p.split.ratios;
      if (p.split.strategy === 'none') return undefined;
      if (
        train <= 0 ||
        test <= 0 ||
        validation < 0 ||
        Math.abs(train + validation + test - 1) > 1e-6
      ) {
        return 'Train and test must each be above 0, and all three must add up to 100%.';
      }
      if (p.split.strategy === 'group' && !p.split.groupColumn)
        return 'Choose the column that identifies each group.';
      if (p.split.strategy === 'time' && !p.split.timeColumn)
        return 'Choose the column that holds the time.';
      return undefined;
    }
    case 'missing': {
      if (!p.splitResult?.trainProfile) return 'Make the split first.';
      const left = unfilled(p);
      return left.length > 0
        ? `${left.length} ${left.length === 1 ? 'column still has' : 'columns still have'} empty cells: ${names(left)}. Fill ${left.length === 1 ? 'it' : 'them'} or remove ${left.length === 1 ? 'it' : 'them'}.`
        : undefined;
    }
    case 'features': {
      if (!p.splitResult?.trainProfile) return 'Make the split first.';
      const { text, empty } = notReady(p);
      if (text.length > 0)
        return `${text.length} ${text.length === 1 ? 'column is' : 'columns are'} still text or dates: ${names(text)}. A model needs numbers.`;
      if (empty.length > 0)
        return `${names(empty)} still ${empty.length === 1 ? 'has' : 'have'} empty cells.`;
      return undefined;
    }
    case 'model':
      if (p.goal === 'groups') return 'Grouping rows arrives in a later version.';
      if (!p.model) return 'Choose a model.';
      return undefined;
    case 'train':
      return runs.some((r) => r.status === 'succeeded')
        ? undefined
        : 'Train at least one model first.';
    case 'compare':
      if (!p.candidate) return 'Choose the run you want to test.';
      return runs.some((r) => r.runId === p.candidate && r.status === 'succeeded')
        ? undefined
        : 'The chosen run is no longer available. Choose another.';
    default:
      return undefined;
  }
}
