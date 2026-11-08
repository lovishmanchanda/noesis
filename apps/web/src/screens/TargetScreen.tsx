import { ColumnTable } from '../components/ColumnTable';
import { Bar, Notice, count, percent } from '../components/ui';
import { targetProblem } from '../pipeline/guess';
import { invalidateSplit } from '../state/actions';
import { useProject, type Role } from '../state/project';

const SUPERVISED: [Role, string][] = [
  ['feature', 'Learn from this'],
  ['target', 'Predict this'],
  ['exclude', 'Leave out'],
];
const GROUPING: [Role, string][] = [
  ['feature', 'Describes a row'],
  ['reference', 'Compare to (optional)'],
  ['exclude', 'Leave out'],
];

export function TargetScreen() {
  const { dataset, goal, roles, setRole } = useProject();
  if (!dataset || !goal) return <p className="muted">Add a file first.</p>;
  const grouping = goal === 'groups';
  const options = grouping ? GROUPING : SUPERVISED;
  const targetName = Object.keys(roles).find((c) => roles[c] === 'target');
  const target = dataset.profile.columns.find((c) => c.name === targetName);
  const problem = target ? targetProblem(goal, target) : null;

  const choose = (column: string, role: Role): void => {
    // There is only ever one target and one reference column.
    if (role === 'target' || role === 'reference') {
      for (const [other, current] of Object.entries(roles))
        if (other !== column && current === role) setRole(other, 'feature');
    }
    setRole(column, role);
    invalidateSplit();
  };

  return (
    <div className="stack">
      <p className="muted">
        {grouping
          ? 'Choose the columns that describe each row. Rows with similar values end up in the same group. You can pick one column you already trust to compare the groups against later; it is not used to make the groups.'
          : 'Pick the column you want to predict. Identifier-like columns (nearly every value different) are left out for you, because they carry no pattern to learn.'}
      </p>
      <ColumnTable
        columns={dataset.profile.columns}
        extra={{
          head: grouping ? 'Use' : 'Role',
          cell: (c) => (
            <select
              aria-label={`Role of ${c.name}`}
              value={roles[c.name] ?? 'feature'}
              onChange={(e) => choose(c.name, e.target.value as Role)}
            >
              {options.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          ),
        }}
      />
      {!grouping && target && (
        <section className="card">
          <h2>
            Predicting <span className="mono">{target.name}</span>
          </h2>
          {problem ? (
            <Notice kind="error">{problem}</Notice>
          ) : (
            <Notice kind="info">
              This column suits “{goal === 'number' ? 'a number' : 'a category'}”.
            </Notice>
          )}
          {target.missing > 0 && (
            <p className="muted">
              {count(target.missing)} rows have no value here ({percent(target.missingPct)}). The
              next step can remove them.
            </p>
          )}
          {goal === 'category' && target.top && (
            <ul className="classes">
              {target.top.map((t) => (
                <li key={t.value}>
                  <span className="mono">{t.value}</span>
                  <Bar value={t.count / Math.max(1, dataset.profile.rows)} /> {count(t.count)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
