import { useProject } from '../state/project';
import { StepList } from '../components/StepList';
import { count } from '../components/ui';
import { TYPE_LABEL } from '../components/ColumnTable';
import { setColumnStep, setWholeStep, stepFor } from '../pipeline/prepare';
import { requestRun, useRun } from '../state/run';
import { applyAction, applyPatchAs, recordEdit, useSuggestions } from '../state/suggestions';
import { featureColumns, names, notReady, trainProfileOf } from './shared';

const ENCODINGS = [
  ['onehot', 'A yes-or-no column per value'],
  ['frequency', 'How often each value appears'],
  ['binary', 'Binary digits (few columns)'],
] as const;
const SCALINGS = [
  ['', 'No scaling'],
  ['standard', 'Standard: centre on 0, spread of 1'],
  ['minmax', 'Min-max: squeeze into 0 to 1'],
  ['robust', 'Robust: ignores extreme values'],
  ['maxabs', 'Max-abs: divide by the largest'],
] as const;

function edit(
  label: string,
  fn: (
    p: ReturnType<typeof useProject.getState>['prepare'],
  ) => ReturnType<typeof useProject.getState>['prepare'],
): void {
  recordEdit(label);
  recordEdit(label);
  useProject.setState((s) => ({ prepare: fn(s.prepare) }));
  void requestRun().catch(() => undefined);
}

export function FeaturesScreen() {
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
  const text = features.filter((c) => c.dtype === 'category' || c.dtype === 'string');
  const hasParts = (name: string): boolean =>
    project.prepare.some(
      (s) =>
        s.type === 'derive_feature' &&
        Array.isArray(s.params['sourceColumns']?.value) &&
        (s.params['sourceColumns']?.value as string[]).includes(name),
    );
  const dates = profile.columns.filter(
    (c) =>
      c.dtype === 'datetime' &&
      project.roles[c.name] !== 'target' &&
      !project.tidy.dropColumns.includes(c.name) &&
      ((project.roles[c.name] ?? 'feature') === 'feature' || hasParts(c.name)),
  );
  const scale = String(
    project.prepare.find((s) => s.type === 'scale')?.params['method']?.value ?? '',
  );
  const variance = project.prepare.some((s) => s.type === 'select_features');
  const output = project.splitResult?.outputProfile;
  const { text: stillText, empty } = notReady(project);
  const open = suggestions.filter(
    (s) => s.stage === 'features' && s.actions[0] && /^C0[789]/.test(s.ruleId),
  );

  const addDateParts = (name: string): Promise<void> => {
    const part = (datePart: string) => ({
      op: 'addNode' as const,
      node: {
        type: 'derive_feature' as const,
        params: {
          newName: `${name}_${datePart}`,
          kind: 'date_part',
          sourceColumns: [name],
          datePart,
        },
      },
    });
    return applyPatchAs(`Split “${name}” into year, month and weekday`, [
      part('year'),
      part('month'),
      part('weekday'),
      { op: 'setColumnRole', column: name, role: 'exclude' },
    ]);
  };

  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted">
          A model can only use numbers. Each choice below is learned from the training rows, then
          applied the same way to every part.
        </p>
        {open.length > 0 && (
          <button
            type="button"
            disabled={running}
            onClick={() =>
              void (async () => {
                for (const s of open) if (s.actions[0]) await applyAction(s, s.actions[0]);
              })()
            }
          >
            Use the suggested choices
          </button>
        )}
      </div>
      {runError && (
        <p className="notice error" role="alert">
          {runError}
        </p>
      )}

      <section>
        <h2>Text to numbers</h2>
        {text.length === 0 ? (
          <p className="muted">No text columns reach the model.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Different values</th>
                  <th>Turn into</th>
                </tr>
              </thead>
              <tbody>
                {text.map((c) => {
                  const method = String(
                    stepFor(project.prepare, 'encode', c.name)?.params['method']?.value ?? '',
                  );
                  return (
                    <tr key={c.name}>
                      <td className="mono">{c.name}</td>
                      <td>
                        {count(c.unique)}
                        {c.unique > 50 && (
                          <span
                            className="tag"
                            title="One yes-or-no column per value would be very wide"
                          >
                            many
                          </span>
                        )}
                      </td>
                      <td>
                        <select
                          aria-label={`Turn “${c.name}” into`}
                          value={method}
                          disabled={running}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === 'leave') {
                              recordEdit(`Leave out “${c.name}”`);
                              useProject.setState((s) => ({
                                roles: { ...s.roles, [c.name]: 'exclude' },
                                prepare: setColumnStep(s.prepare, 'encode', c.name, null),
                              }));
                              void requestRun().catch(() => undefined);
                            } else
                              edit(`Turn “${c.name}” into numbers`, (p) =>
                                setColumnStep(p, 'encode', c.name, v ? { method: v } : null),
                              );
                          }}
                        >
                          <option value="">Choose…</option>
                          {ENCODINGS.map(([v, label]) => (
                            <option key={v} value={v}>
                              {label}
                            </option>
                          ))}
                          <option value="leave">Leave the column out</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dates.length > 0 && (
        <section>
          <h2>Dates</h2>
          <ul className="plain">
            {dates.map((c) => (
              <li key={c.name} className="row">
                <span className="mono">{c.name}</span>
                <span className="muted">{TYPE_LABEL[c.dtype]}</span>
                {hasParts(c.name) ? (
                  <span className="after-note">split into year, month and weekday</span>
                ) : (
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => void addDateParts(c.name)}
                  >
                    Split into year, month and weekday
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Number ranges</h2>
        <label className="field" style={{ maxWidth: 360 }}>
          <span className="field-label">Put the number columns on one scale</span>
          <select
            value={scale}
            disabled={running}
            onChange={(e) =>
              edit('Change the scaling', (p) =>
                setWholeStep(p, 'scale', e.target.value ? { method: e.target.value } : null),
              )
            }
          >
            {SCALINGS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <span className="muted small">
            Trees do not need it. Linear models, nearest neighbours and neural networks do.
          </span>
        </label>
      </section>

      <section>
        <h2>Selection</h2>
        <label className="row">
          <input
            type="checkbox"
            checked={variance}
            disabled={running}
            onChange={(e) =>
              edit('Change column selection', (p) =>
                setWholeStep(
                  p,
                  'select_features',
                  e.target.checked ? { method: 'variance', varianceThreshold: 0 } : null,
                ),
              )
            }
          />
          <span>Remove columns that do not change at all in the training rows</span>
        </label>
      </section>

      <section className="card">
        <h2>What the model will receive</h2>
        {output ? (
          <p>
            {count(
              output.columns.filter((c) => (project.roles[c.name] ?? 'feature') === 'feature')
                .length,
            )}{' '}
            columns from {count(output.rows)} training rows.
          </p>
        ) : (
          <p className="muted">Run the steps to see the result.</p>
        )}
        {stillText.length > 0 && (
          <p className="notice warn">
            Still text or dates: {names(stillText)}. Choose how to turn{' '}
            {stillText.length === 1 ? 'it' : 'them'} into numbers.
          </p>
        )}
        {empty.length > 0 && (
          <p className="notice warn">
            Still has empty cells: {names(empty)}. Go back to “Missing values”.
          </p>
        )}
        {output && stillText.length === 0 && empty.length === 0 && (
          <p className="after-note">Every column is a number with no empty cells.</p>
        )}
        {features.length === 0 && <p className="notice warn">No feature columns are left.</p>}
      </section>

      <StepList types={['derive_feature', 'encode', 'scale', 'select_features']} />
    </div>
  );
}
