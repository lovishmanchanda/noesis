import { useEffect } from 'react';
import { Field, Notice, count } from '../components/ui';
import { invalidateSplit } from '../state/actions';
import { DEFAULT_SPLIT, useProject, type SplitStrategy } from '../state/project';

const STRATEGIES: { id: SplitStrategy; label: string; hint: string }[] = [
  { id: 'random', label: 'Random', hint: 'Rows are shuffled, then divided.' },
  {
    id: 'stratified',
    label: 'Keep class shares',
    hint: 'Every part has the same share of each class.',
  },
  {
    id: 'group',
    label: 'Keep groups together',
    hint: 'All rows of one customer, patient or store stay in one part.',
  },
  { id: 'time', label: 'By time', hint: 'Earlier rows train, later rows test.' },
];

export function SplitScreen() {
  const { dataset, goal, tidy, roles, split, splitResult, update } = useProject();

  // Sensible starting choices for the goal, applied once while the split is still untouched.
  useEffect(() => {
    if (
      split.strategy !== DEFAULT_SPLIT.strategy ||
      split.ratios.join() !== DEFAULT_SPLIT.ratios.join()
    )
      return;
    if (goal === 'category') update({ split: { ...split, strategy: 'stratified' } });
    if (goal === 'groups') update({ split: { ...split, strategy: 'none', ratios: [1, 0, 0] } });
  }, [goal]);

  if (!dataset || !goal) return <p className="muted">Add a file first.</p>;
  const targetName = Object.keys(roles).find((c) => roles[c] === 'target');
  const targetMissing = dataset.profile.columns.find((c) => c.name === targetName)?.missing ?? 0;
  const rows =
    dataset.profile.rows -
    (tidy.dropDuplicates ? dataset.profile.duplicates : 0) -
    (tidy.dropMissingTarget ? targetMissing : 0);
  const change = (patch: Partial<typeof split>): void => {
    update({ split: { ...split, ...patch } });
    invalidateSplit();
  };

  if (goal === 'groups') {
    const holdout = split.strategy !== 'none';
    return (
      <div className="stack">
        <p className="muted">
          Grouping has no right answer to protect, so by default every row is used. You can keep a
          few rows aside to check afterwards that new rows land in the same groups.
        </p>
        <label className="choice">
          <input
            type="checkbox"
            checked={holdout}
            onChange={(e) =>
              change(
                e.target.checked
                  ? { strategy: 'random', ratios: [0.8, 0, 0.2] }
                  : { strategy: 'none', ratios: [1, 0, 0] },
              )
            }
          />
          <span>
            <strong>Keep 20% of rows aside</strong>
            <span className="muted"> to check that new rows get the same groups.</span>
          </span>
        </label>
        {splitResult && <Result rows={splitResult.rows} />}
      </div>
    );
  }

  const [train, , test] = split.ratios;
  const setShares = (nextTrain: number, nextTest: number): void =>
    change({
      ratios: [
        nextTrain,
        Math.max(0, Math.round((1 - nextTrain - nextTest) * 100) / 100),
        nextTest,
      ],
    });
  const validation = Math.max(0, Math.round((1 - train - test) * 100) / 100);
  const columns = dataset.profile.columns;
  return (
    <div className="stack">
      <p className="muted">
        Part of the data is kept aside so the model can be checked on rows it has never seen. The
        test part is locked after this step and used once, at the end.
      </p>
      <div
        className="partbar"
        role="img"
        aria-label={`Train ${Math.round(train * 100)}%, validation ${Math.round(validation * 100)}%, test ${Math.round(test * 100)}%`}
      >
        <div className="p-train" style={{ width: `${train * 100}%` }}>
          Train {Math.round(train * 100)}%
        </div>
        {validation > 0 && (
          <div className="p-validation" style={{ width: `${validation * 100}%` }}>
            Validation
          </div>
        )}
        <div className="p-test" style={{ width: `${test * 100}%` }}>
          Test
        </div>
      </div>
      <div className="partcounts">
        <span>{count(Math.round(rows * train))} rows</span>
        <span>{count(Math.round(rows * validation))} rows</span>
        <span>{count(Math.round(rows * test))} rows</span>
      </div>
      <div className="grid-2">
        <Field label={`Train: ${Math.round(train * 100)}%`}>
          <input
            type="range"
            min={50}
            max={90}
            step={5}
            value={Math.round(train * 100)}
            onChange={(e) => setShares(Number(e.target.value) / 100, test)}
          />
        </Field>
        <Field label={`Test: ${Math.round(test * 100)}%`}>
          <input
            type="range"
            min={5}
            max={30}
            step={5}
            value={Math.round(test * 100)}
            onChange={(e) => setShares(train, Number(e.target.value) / 100)}
          />
        </Field>
      </div>
      <Field
        label="How to divide the rows"
        hint={STRATEGIES.find((s) => s.id === split.strategy)?.hint ?? ''}
      >
        <select
          value={split.strategy}
          onChange={(e) => change({ strategy: e.target.value as SplitStrategy })}
        >
          {STRATEGIES.filter((s) => s.id !== 'stratified' || goal === 'category').map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
              {s.id === 'stratified' ? ' (recommended)' : ''}
            </option>
          ))}
        </select>
      </Field>
      {split.strategy === 'group' && (
        <Field label="Column that identifies each group">
          <select
            value={split.groupColumn ?? ''}
            onChange={(e) => change({ groupColumn: e.target.value || null })}
          >
            <option value="">Choose a column</option>
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {split.strategy === 'time' && (
        <Field label="Column that holds the time">
          <select
            value={split.timeColumn ?? ''}
            onChange={(e) => change({ timeColumn: e.target.value || null })}
          >
            <option value="">Choose a column</option>
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Notice kind="info">
        Test data is locked after this step. It is used once, at the very end.
      </Notice>
      {splitResult && <Result rows={splitResult.rows} />}
    </div>
  );
}

function Result({ rows }: { rows: Record<string, number> }) {
  return (
    <section className="card" aria-label="Split result">
      <h2>Split done</h2>
      <p>
        {Object.entries(rows)
          .filter(([, n]) => n > 0)
          .map(([name, n]) => `${name} ${count(n)}`)
          .join(' · ')}
      </p>
    </section>
  );
}
