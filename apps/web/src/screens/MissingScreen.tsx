import type { ColumnProfile } from '@noesis/engine-client';
import { StepList } from '../components/StepList';
import { Bar, count, percent } from '../components/ui';
import { TYPE_LABEL } from '../components/ColumnTable';
import { setColumnStep, stepFor } from '../pipeline/prepare';
import { useProject } from '../state/project';
import { requestRun, useRun } from '../state/run';
import { applyAction, useSuggestions } from '../state/suggestions';
import { featureColumns, trainProfileOf, unfilled } from './shared';

const isNumber = (c: ColumnProfile): boolean => c.dtype === 'int' || c.dtype === 'float';

const FILL_NUMBER = [
  ['median', 'Median (the middle value)'],
  ['mean', 'Average'],
  ['most_frequent', 'Most common value'],
  ['constant', 'A fixed value (0)'],
  ['knn', 'Look at similar rows'],
] as const;
const FILL_TEXT = [
  ['most_frequent', 'Most common value'],
  ['constant', 'The word “missing”'],
] as const;

function edit(
  fn: (
    prepare: ReturnType<typeof useProject.getState>['prepare'],
  ) => ReturnType<typeof useProject.getState>['prepare'],
): void {
  useProject.setState((s) => ({ prepare: fn(s.prepare) }));
  void requestRun().catch(() => undefined);
}

export function MissingScreen() {
  const project = useProject();
  const running = useRun((r) => r.running);
  const runError = useRun((r) => r.error);
  const suggestions = useSuggestions();
  const profile = trainProfileOf(project);
  if (!profile)
    return (
      <p className="notice warn">Make the split first. These steps learn from the training rows.</p>
    );

  const features = featureColumns(project);
  const rows = features.filter((c) => c.missing > 0 || (c.outliers ?? 0) > 0);
  const output = project.splitResult?.outputProfile;
  const left = unfilled(project);
  const fills = suggestions.filter(
    (s) => s.stage === 'missing' && (s.ruleId.startsWith('C05') || s.ruleId.startsWith('C06')),
  );

  const setFill = (c: ColumnProfile, value: string): void => {
    if (value === 'remove') {
      useProject.setState((s) => ({
        prepare: setColumnStep(s.prepare, 'impute', c.name, null),
        tidy: { ...s.tidy, dropColumns: [...new Set([...s.tidy.dropColumns, c.name])] },
      }));
      void requestRun().catch(() => undefined);
      return;
    }
    if (value === '') return edit((p) => setColumnStep(p, 'impute', c.name, null));
    const values: Record<string, unknown> =
      value === 'constant'
        ? { strategy: 'constant', fillValue: isNumber(c) ? 0 : 'missing' }
        : { strategy: value };
    edit((p) => setColumnStep(p, 'impute', c.name, values));
  };
  const setOutliers = (c: ColumnProfile, value: string): void =>
    edit((p) =>
      setColumnStep(
        p,
        'handle_outliers',
        c.name,
        value === 'clip' ? { method: 'iqr', action: 'clip' } : null,
      ),
    );

  if (rows.length === 0) {
    return (
      <div className="stack">
        <p className="notice info">
          None of the columns have empty cells or extreme values in the training rows. You can
          continue.
        </p>
        <StepList types={['impute', 'handle_outliers']} />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted">
          The fill values are worked out from the {count(profile.rows)} training rows only, then
          used for every part. That is what keeps the test rows honest.
        </p>
        {fills.length > 0 && (
          <button
            type="button"
            disabled={running}
            onClick={() =>
              void (async () => {
                for (const s of fills) if (s.actions[0]) await applyAction(s, s.actions[0]);
              })()
            }
          >
            Use the suggested fills
          </button>
        )}
      </div>
      {runError && (
        <p className="notice error" role="alert">
          {runError}
        </p>
      )}
      {left.length > 0 && (
        <p className="notice warn">
          {left.length} {left.length === 1 ? 'column' : 'columns'} left to fill or remove before you
          can continue.
        </p>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>Empty</th>
              <th>Extreme values</th>
              <th>Fill empty cells with</th>
              <th>Extreme values</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const fill = String(
                stepFor(project.prepare, 'impute', c.name)?.params['strategy']?.value ?? '',
              );
              const clip = stepFor(project.prepare, 'handle_outliers', c.name) ? 'clip' : 'leave';
              const after = output?.columns.find((o) => o.name === c.name);
              return (
                <tr key={c.name}>
                  <td className="mono">{c.name}</td>
                  <td>{TYPE_LABEL[c.dtype]}</td>
                  <td>
                    <Bar value={c.missingPct} label={percent(c.missingPct)} />{' '}
                    {c.missing > 0 ? `${count(c.missing)} (${percent(c.missingPct)})` : ''}
                  </td>
                  <td>{isNumber(c) && (c.outliers ?? 0) > 0 ? count(c.outliers ?? 0) : ''}</td>
                  <td>
                    {c.missing > 0 && c.dtype !== 'datetime' ? (
                      <select
                        aria-label={`Fill “${c.name}” with`}
                        value={fill}
                        disabled={running}
                        onChange={(e) => setFill(c, e.target.value)}
                      >
                        <option value="">Choose…</option>
                        {(isNumber(c) ? FILL_NUMBER : FILL_TEXT).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                        <option value="remove">Remove the column</option>
                      </select>
                    ) : (
                      ''
                    )}
                  </td>
                  <td>
                    {isNumber(c) && (c.outliers ?? 0) > 0 ? (
                      <select
                        aria-label={`Extreme values in “${c.name}”`}
                        value={clip}
                        disabled={running}
                        onChange={(e) => setOutliers(c, e.target.value)}
                      >
                        <option value="leave">Leave as they are</option>
                        <option value="clip">Pull in to the usual range</option>
                      </select>
                    ) : (
                      ''
                    )}
                  </td>
                  <td>
                    {fill && after ? (
                      <span className={after.missing === 0 ? 'after-note' : 'partial'}>
                        {after.missing === 0
                          ? 'no empty cells'
                          : `${count(after.missing)} still empty`}
                      </span>
                    ) : (
                      ''
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <StepList types={['impute', 'handle_outliers']} />
    </div>
  );
}
