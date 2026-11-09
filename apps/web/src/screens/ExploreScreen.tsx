import { CorrelationBar, Histogram } from '../components/Charts';
import { TYPE_LABEL } from '../components/ColumnTable';
import { Bar, count, percent } from '../components/ui';
import { useProject } from '../state/project';
import { featureColumns, trainProfileOf } from './shared';

export function ExploreScreen() {
  const project = useProject();
  const profile = trainProfileOf(project);
  if (!profile)
    return (
      <p className="notice warn">
        Make the split first. This screen looks at the training rows only.
      </p>
    );
  const columns = featureColumns(project);
  const target = profile.target;
  const classification = project.goal === 'category';
  const total = target ? target.classes.reduce((a, c) => a + c.count, 0) : 0;
  const hasCorr = columns.some((c) => c.targetCorr !== undefined);
  const skewed = columns.filter((c) => Math.abs(c.skew ?? 0) > 1);

  return (
    <div className="stack">
      <p className="notice info">
        <strong>Training rows only.</strong> You are looking at {count(profile.rows)} rows. The
        validation and test rows are kept out of sight, so nothing you notice here can leak into the
        final score.
      </p>

      {target && classification && (
        <section className="card">
          <h2>What you want to predict: “{target.name}”</h2>
          <p className="muted">
            How many rows belong to each class. A very small class is harder for a model to learn.
          </p>
          <ul className="classes">
            {target.classes.map((c) => (
              <li key={c.value}>
                <span className="mono">{c.value}</span>
                <Bar value={total ? c.count / total : 0} />
                <span>
                  {count(c.count)} ({percent(total ? c.count / total : 0)})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {target && !classification && project.goal === 'number' && (
        <section className="card">
          <h2>What you want to predict: “{target.name}”</h2>
          <p className="muted">
            {target.skew != null && Math.abs(target.skew) > 1
              ? `Its values are lopsided (skew ${target.skew.toFixed(1)}): a few very large values pull the average. Large errors on those rows will dominate the score.`
              : 'Its values are fairly evenly spread.'}
          </p>
        </section>
      )}

      <section>
        <h2>The columns the model will learn from</h2>
        <p className="muted">
          Each row shows a column’s shape
          {hasCorr ? ' and how closely it moves with what you want to predict' : ''}. A long bar in
          the last column is a strong hint, and a bar that is almost full is worth a second look.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
                <th>Shape</th>
                <th>Empty</th>
                <th>Different values</th>
                {hasCorr && <th>Moves with the target</th>}
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => (
                <tr key={c.name}>
                  <td className="mono">{c.name}</td>
                  <td>{TYPE_LABEL[c.dtype]}</td>
                  <td>
                    {c.histogram ? (
                      <Histogram counts={c.histogram.counts} label={`Spread of ${c.name}`} />
                    ) : (
                      <span className="mono muted">
                        {c.top?.[0] ? `mostly “${c.top[0].value}”` : ''}
                      </span>
                    )}
                  </td>
                  <td>
                    <Bar value={c.missingPct} label={percent(c.missingPct)} />{' '}
                    {c.missing > 0 ? percent(c.missingPct) : ''}
                  </td>
                  <td>{count(c.unique)}</td>
                  {hasCorr && (
                    <td>
                      {c.dtype === 'int' || c.dtype === 'float' ? (
                        <CorrelationBar value={c.targetCorr} />
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {skewed.length > 0 && (
        <p className="muted">
          <strong>Lopsided columns:</strong> {skewed.map((c) => `“${c.name}”`).join(', ')}. A few
          very large values pull their averages, so medians are safer than means when you fill gaps.
        </p>
      )}
    </div>
  );
}
