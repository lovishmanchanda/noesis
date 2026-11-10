import { useEffect, useMemo, useState } from 'react';
import { LineChart } from '../components/train/CurveChart';
import { Notice } from '../components/ui';
import { buildTrainingPipeline } from '../pipeline/build';
import { formatScore, metricInfo } from '../runs/metrics';
import {
  describeValue,
  diffRuns,
  rankRuns,
  trainScore,
  validationScore,
  type RunRecord,
} from '../runs/records';
import { deleteRun, editRun, loadEvents, useRuns } from '../runs/store';
import { useProject } from '../state/project';
import { useCurrentHashes } from '../state/run';
import { recordEdit } from '../state/suggestions';
import { visualFromEvents, type CurveKind, type CurvePoint } from '../training/events';

const COLOURS = ['train', 'val', 'third'];

export function CompareScreen() {
  const project = useProject();
  const runs = useRuns((s) => s.runs);
  const hashes = useCurrentHashes((s) => s.hashes);
  const [picked, setPicked] = useState<string[]>([]);
  const [curves, setCurves] = useState<
    Record<string, { curve: CurvePoint[]; kind: CurveKind | null }>
  >({});
  const metric = buildTrainingPipeline(project).pipeline.task.primaryMetric;
  const info = metricInfo(metric);
  const ranked = useMemo(() => rankRuns(runs, metric), [runs, metric]);
  const others = runs.filter((r) => !ranked.includes(r));

  useEffect(() => {
    let live = true;
    for (const id of picked) {
      if (curves[id]) continue;
      void loadEvents(id).then((events) => {
        const v = visualFromEvents(events);
        if (live) setCurves((c) => ({ ...c, [id]: { curve: v.curve, kind: v.curveKind } }));
      });
    }
    return () => {
      live = false;
    };
  }, [picked, curves]);

  if (runs.length === 0)
    return (
      <Notice kind="info">
        No runs yet. Train a model on the previous screen, and its result will appear here.
      </Notice>
    );

  const toggle = (id: string): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-3)));
  const best = ranked[0];
  const chosen = runs.find((r) => r.runId === project.candidate);
  const withCurve = picked.filter((id) => (curves[id]?.curve.length ?? 0) > 0);
  const firstKind = curves[withCurve[0] ?? '']?.kind ?? null;
  const overlay = picked
    .filter(
      (id) => curves[id] && curves[id]?.kind === firstKind && (curves[id]?.curve.length ?? 0) > 0,
    )
    .map((id, i) => ({
      name: runs.find((r) => r.runId === id)?.label ?? id,
      className: COLOURS[i] ?? 'val',
      points: (curves[id]?.curve ?? [])
        .filter((p) => p.val !== null)
        .map((p) => ({ x: p.x, y: p.val as number })),
    }));
  const skipped = withCurve.filter((id) => curves[id]?.kind !== firstKind).length;
  const noCurve = picked.filter((id) => curves[id] && (curves[id]?.curve.length ?? 0) === 0).length;
  const [a, b] = picked
    .map((id) => runs.find((r) => r.runId === id))
    .filter((r): r is RunRecord => r !== undefined);
  const diff = a && b && picked.length === 2 ? diffRuns(a, b) : null;
  const setValidation = (change: Partial<typeof project.validation>): void => {
    recordEdit('Change how models are checked');
    useProject.setState({ validation: { ...project.validation, ...change } });
  };
  const stale = (r: RunRecord): boolean =>
    hashes['m1'] !== undefined && r.modelHash !== hashes['m1'];

  return (
    <div className="stack">
      <Notice kind="info">
        Runs are ranked by their score on <strong>validation rows</strong> only: rows the model
        never learned from. The final test set is kept sealed, and no test score appears on this
        screen.
      </Notice>

      <section className="card stack" aria-label="How models are checked">
        <h2>How models are checked</h2>
        <div className="row wrap">
          <label className="field">
            <span className="field-label">Method</span>
            <select
              value={project.validation.method}
              onChange={(e) =>
                setValidation({ method: e.target.value as typeof project.validation.method })
              }
            >
              <option value="holdout">One validation set (fast)</option>
              <option value="kfold">Several rounds (k-fold)</option>
              {project.goal === 'category' && (
                <option value="stratified_kfold">Several rounds, equal class shares</option>
              )}
            </select>
          </label>
          {project.validation.method !== 'holdout' && (
            <label className="field">
              <span className="field-label">Rounds</span>
              <input
                type="number"
                min={2}
                max={10}
                value={project.validation.k}
                onChange={(e) =>
                  setValidation({ k: Math.max(2, Math.min(10, Number(e.target.value) || 5)) })
                }
                style={{ width: 80 }}
              />
            </label>
          )}
        </div>
        <p className="muted small">
          This applies to runs you train from now on. Several rounds take longer but are steadier on
          small files, because every training row gets a turn as a validation row.
        </p>
      </section>

      <section>
        <h2>Leaderboard</h2>
        <p className="muted">
          {info.label}: {info.meaning}
        </p>
        {ranked.length === 0 ? (
          <Notice kind="warn">No run has a validation score yet.</Notice>
        ) : (
          <div className="table-wrap">
            <table className="data-table leaderboard">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Run</th>
                  <th>Model</th>
                  <th>{info.label} on new rows</th>
                  <th>On rows it learned</th>
                  <th>Time</th>
                  <th>Compare</th>
                  <th>Keep</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={r.runId} className={r.runId === project.candidate ? 'chosen' : ''}>
                    <td>{i + 1}</td>
                    <td>
                      <input
                        type="text"
                        className="inline"
                        defaultValue={r.label}
                        aria-label={`Name of ${r.label}`}
                        onBlur={(e) =>
                          e.target.value !== r.label &&
                          void editRun(r.runId, { label: e.target.value })
                        }
                      />
                      {stale(r) && (
                        <span
                          className="tag"
                          title="The settings or earlier steps changed since this run"
                        >
                          older settings
                        </span>
                      )}
                      {r === best && <span className="tag good">best</span>}
                    </td>
                    <td>{r.algorithm.replaceAll('_', ' ')}</td>
                    <td className="strong">{formatScore(validationScore(r))}</td>
                    <td className="muted">{formatScore(trainScore(r))}</td>
                    <td className="muted">{(r.durationMs / 1000).toFixed(1)} s</td>
                    <td>
                      <input
                        type="checkbox"
                        checked={picked.includes(r.runId)}
                        onChange={() => toggle(r.runId)}
                        aria-label={`Compare ${r.label}`}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.kept}
                        onChange={(e) => void editRun(r.runId, { kept: e.target.checked })}
                        aria-label={`Keep ${r.label}`}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={r.runId === project.candidate ? 'primary' : ''}
                        onClick={() => useProject.setState({ candidate: r.runId })}
                      >
                        {r.runId === project.candidate ? 'Chosen' : 'Choose'}
                      </button>
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => void deleteRun(r.runId)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {chosen && (
          <p className="muted">
            Chosen for the final test: <strong>{chosen.label}</strong>.
          </p>
        )}
      </section>

      {picked.length > 0 && (
        <section className="stack">
          <h2>Learning curves</h2>
          <LineChart
            series={overlay}
            total={null}
            label={`${firstKind === 'score' ? 'Validation score' : 'Validation loss'}, run by run`}
            yLabel={firstKind === 'score' ? 'score' : 'loss'}
          />
          {noCurve > 0 && (
            <p className="muted small">
              {noCurve} selected {noCurve === 1 ? 'run has' : 'runs have'} no learning curve,
              because {noCurve === 1 ? 'it is' : 'they are'} solved in one step.
            </p>
          )}
          {skipped > 0 && (
            <p className="muted small">
              {skipped} selected {skipped === 1 ? 'run has' : 'runs have'} a different kind of
              curve, so {skipped === 1 ? 'it is' : 'they are'} not drawn here.
            </p>
          )}
        </section>
      )}

      {diff && a && b && (
        <section className="card stack" aria-label="What differs">
          <h2>
            What differs between “{a.label}” and “{b.label}”
          </h2>
          {diff.length === 0 ? (
            <p className="muted">Nothing: the two runs used the same steps and settings.</p>
          ) : (
            <ul className="plain">
              {diff.map((d) => (
                <li key={d.node}>
                  <strong>{d.label}</strong>{' '}
                  {d.change === 'added' && <span className="muted">only in “{b.label}”</span>}
                  {d.change === 'removed' && <span className="muted">only in “{a.label}”</span>}
                  {d.change === 'changed' && d.params.length === 0 && (
                    <span className="muted">
                      same settings, but something earlier changed its input
                    </span>
                  )}
                  {d.params.map((p) => (
                    <div key={p.name} className="small">
                      {p.label}: <span className="mono">{describeValue(p.from)}</span> →{' '}
                      <span className="mono">{describeValue(p.to)}</span>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h2>Runs without a score</h2>
          <ul className="plain">
            {others.map((r) => (
              <li key={r.runId} className="row">
                <strong>{r.label}</strong>
                <span className="muted">
                  {r.status === 'failed' ? `failed: ${r.error?.message ?? ''}` : r.status}
                </span>
                <button type="button" className="quiet" onClick={() => void deleteRun(r.runId)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
