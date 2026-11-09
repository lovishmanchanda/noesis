import { nodeSpec } from '@noesis/registry';
import type { NodeType } from '@noesis/rules';
import { useEffect, useState } from 'react';
import { Bars } from '../components/train/Bars';
import { CurveChart } from '../components/train/CurveChart';
import { NetworkView } from '../components/train/NetworkView';
import { TreeView } from '../components/train/TreeView';
import { Notice } from '../components/ui';
import { buildTrainingPipeline } from '../pipeline/build';
import { modelInfo } from '../pipeline/models';
import { formatScore, metricInfo } from '../runs/metrics';
import { loadEvents, useRuns } from '../runs/store';
import { useProject } from '../state/project';
import { useCurrentHashes } from '../state/run';
import { findDuplicate, preflight, startTraining, stopTraining } from '../training/run';
import {
  seek,
  setPacing,
  showStoredRun,
  stepForward,
  useTraining,
  type Pacing,
} from '../training/store';
import type { VisualState } from '../training/events';
import type { RunRecord } from '../runs/records';

const PACING: [Pacing, string][] = [
  ['live', 'Live'],
  ['slow', 'Slow'],
  ['step', 'Step'],
];

function Strip({ visual }: { visual: VisualState }) {
  const project = useProject();
  const types = new Map(buildTrainingPipeline(project).pipeline.nodes.map((n) => [n.id, n.type]));
  if (visual.nodes.length === 0) return null;
  return (
    <ol className="strip" aria-label="Steps of this run">
      {visual.nodes.map((n) => {
        const type = (n.type || types.get(n.id) || '') as NodeType;
        return (
          <li key={n.id} className={`strip-node ${n.status}`}>
            <span className="strip-name">{type ? nodeSpec(type).label : n.id}</span>
            <span className="small muted">
              {n.status === 'cached'
                ? 'reused'
                : n.status === 'running'
                  ? 'working…'
                  : n.status === 'failed'
                    ? 'stopped'
                    : n.status === 'done'
                      ? `${Math.round(n.durationMs ?? 0)} ms`
                      : 'waiting'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Picture({ visual }: { visual: VisualState }) {
  const algorithm = visual.algorithm;
  const curve = (
    <CurveChart
      curve={visual.curve}
      total={visual.total}
      kind={visual.curveKind}
      label={visual.curveLabel}
    />
  );
  if (algorithm === 'mlp')
    return (
      <div className="train-grid">
        {visual.structure ? (
          <NetworkView
            structure={visual.structure}
            weights={visual.weights?.layers ?? null}
            epoch={visual.weights?.epoch ?? null}
          />
        ) : (
          <p className="muted">The network appears when training starts.</p>
        )}
        {curve}
      </div>
    );
  if (algorithm === 'random_forest') {
    const first = visual.trees[0] ?? [];
    return (
      <div className="train-grid">
        <div>
          <progress
            className="wide"
            max={visual.total ?? 1}
            value={visual.curve.at(-1)?.x ?? 0}
            aria-label="Trees grown"
          />
          <p className="muted small">
            {visual.curve.at(-1)?.x ?? 0} of {visual.total ?? '…'} trees grown
          </p>
          {curve}
        </div>
        <div>
          <h3>The first tree</h3>
          <div className="scroll-x">
            <TreeView nodes={first} summary={visual.treeSummary[0]} />
          </div>
          {visual.importances && (
            <>
              <h3>Which columns it relies on</h3>
              <Bars items={visual.importances} signed={false} label="Column importance" />
            </>
          )}
        </div>
      </div>
    );
  }
  if (algorithm === 'gradient_boosting')
    return (
      <div className="train-grid">
        {curve}
        {visual.importances && (
          <div>
            <h3>Which columns it relies on</h3>
            <Bars items={visual.importances} signed={false} label="Column importance" />
          </div>
        )}
      </div>
    );
  return (
    <div className="train-grid">
      <div>
        {visual.fitProgress && (
          <p className="muted">
            Solver used {visual.fitProgress.iter} of up to {visual.fitProgress.totalIter} steps
            {visual.fitProgress.converged === false
              ? ' and had not fully settled. Allow more steps in the settings.'
              : ' and settled.'}
          </p>
        )}
        {visual.coefficients ? (
          <>
            <h3>How much each column pushes the prediction</h3>
            <Bars
              items={visual.coefficients.coefficients}
              signed
              animate={visual.coefficients.source === 'replay'}
              label="Column weights"
            />
            <p className="muted small">
              {visual.coefficients.source === 'replay' ? (
                <span className="replay-tag">
                  replay: this model is solved in one step, so the bars grow from zero for the
                  picture
                </span>
              ) : (
                <span className="live-tag">live</span>
              )}
            </p>
          </>
        ) : (
          <p className="muted">The weights appear when training ends.</p>
        )}
      </div>
    </div>
  );
}

function Scores({ record, metric }: { record: RunRecord; metric: string }) {
  const names = [
    metric,
    ...Object.keys(record.metrics.validation ?? {}).filter((n) => n !== metric),
  ];
  return (
    <table className="data-table scores">
      <thead>
        <tr>
          <th>Measure</th>
          <th>On rows it learned from</th>
          <th>On new rows (validation)</th>
        </tr>
      </thead>
      <tbody>
        {names.map((n) => (
          <tr key={n} className={n === metric ? 'primary-row' : ''}>
            <td title={metricInfo(n).meaning}>
              {metricInfo(n).label}
              {n === metric && <span className="tag">main</span>}
            </td>
            <td>{formatScore(record.metrics.train?.[n])}</td>
            <td>{formatScore(record.metrics.validation?.[n])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TrainScreen() {
  const project = useProject();
  const t = useTraining();
  const runs = useRuns((s) => s.runs);
  const hashes = useCurrentHashes((s) => s.hashes);
  const [duplicate, setDuplicate] = useState<RunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { guard, problem } = preflight();

  useEffect(() => setDuplicate(null), [project.model]);

  if (!project.model)
    return <Notice kind="warn">Choose a model first, on the Model screen.</Notice>;
  const info = modelInfo(project.model.algorithm);
  const metric = buildTrainingPipeline(project).pipeline.task.primaryMetric;
  const record = runs.find((r) => r.runId === t.runId);
  const lastDone = [...runs].reverse().find((r) => r.status === 'succeeded');
  const outdated =
    lastDone !== undefined && hashes['m1'] !== undefined && lastDone.modelHash !== hashes['m1'];

  const start = async (force = false): Promise<void> => {
    setError(null);
    try {
      if (!force) {
        const found = await findDuplicate();
        if (found) return setDuplicate(found);
      }
      setDuplicate(null);
      await startTraining();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The run could not start.');
    }
  };
  const replay = async (run: RunRecord): Promise<void> => {
    const events = await loadEvents(run.runId);
    if (events.length === 0) return setError('This run has no stored events to replay.');
    showStoredRun(run.runId, events);
  };

  const elapsed = (t.visual.elapsedMs / 1000).toFixed(1);
  const total = t.events.length;
  const finished = !t.running && t.runId !== null;

  return (
    <div className="stack">
      <div className="train-controls card">
        <div className="row">
          {t.running ? (
            <button type="button" className="primary danger" onClick={() => void stopTraining()}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={problem !== null}
              onClick={() => void start()}
            >
              {runs.some((r) => r.status === 'succeeded') ? 'Train again' : 'Start training'}
            </button>
          )}
          <span className="muted" role="status" aria-live="polite">
            {t.running
              ? `Training ${info?.name ?? ''}… ${elapsed} s`
              : t.replay
                ? 'Replaying a finished run'
                : t.outcome?.status === 'succeeded'
                  ? `Finished in ${(t.outcome.durationMs / 1000).toFixed(1)} s`
                  : t.outcome?.status === 'cancelled'
                    ? 'Stopped'
                    : t.outcome?.status === 'failed'
                      ? 'The run stopped with a problem'
                      : `Ready to train ${info?.name ?? 'the model'}`}
          </span>
        </div>
        <div className="row wrap">
          <span className="field-label">Speed</span>
          <div className="seg" role="group" aria-label="Speed">
            {PACING.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={t.pacing === id}
                className={t.pacing === id ? 'on' : ''}
                onClick={() => setPacing(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {t.pacing === 'step' && (
            <>
              <button
                type="button"
                onClick={() => stepForward('event')}
                disabled={t.cursor >= total}
              >
                Next event
              </button>
              <button
                type="button"
                onClick={() => stepForward('epoch')}
                disabled={t.cursor >= total}
              >
                Next epoch
              </button>
            </>
          )}
          <label className="row small">
            <span className="field-label">Detail</span>
            <select
              value={t.viz}
              disabled={t.running}
              onChange={(e) =>
                useTraining.setState({ viz: e.target.value as 'off' | 'light' | 'full' })
              }
            >
              <option value="full">Everything</option>
              <option value="light">Light</option>
              <option value="off">Basics only</option>
            </select>
          </label>
        </div>
        {(t.replay || t.pacing === 'step') && total > 0 && (
          <label className="row small">
            <span className="field-label">Position</span>
            <input
              type="range"
              min={0}
              max={total}
              value={t.cursor}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Position in the run"
              style={{ flex: 1 }}
            />
            <span className="mono">
              {t.cursor}/{total}
            </span>
          </label>
        )}
      </div>

      {guard.warning && <Notice kind="warn">{guard.warning}</Notice>}
      {problem && <Notice kind="error">{problem}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {outdated && !t.running && (
        <Notice kind="info">
          The model or the steps before it changed since your last run, so that result is out of
          date.
        </Notice>
      )}
      {duplicate && (
        <Notice kind="info">
          You already trained exactly this setup (“{duplicate.label}”,{' '}
          {metricInfo(duplicate.primaryMetric).label}{' '}
          {formatScore(duplicate.metrics.validation?.[duplicate.primaryMetric])} on new rows). Same
          data, same settings, same seed: the answer would be identical.{' '}
          <button
            type="button"
            onClick={() => void replay(duplicate).then(() => setDuplicate(null))}
          >
            Show that result
          </button>{' '}
          <button type="button" onClick={() => void start(true)}>
            Train again anyway
          </button>
        </Notice>
      )}

      <Strip visual={t.visual} />
      {t.runId ? (
        <Picture visual={t.visual} />
      ) : (
        <div className="card muted">
          <p>
            Press <strong>Start training</strong>. You will see the steps run, the model learn, and
            a score on rows it did not learn from.{' '}
            {info ? `With ${info.name} you will see: ${info.watch.toLowerCase()}` : ''}
          </p>
        </div>
      )}

      {t.visual.earlyStop && (
        <Notice kind="info">
          Stopped early at epoch {t.visual.earlyStop.epoch}: the best epoch was{' '}
          {t.visual.earlyStop.bestEpoch}, and the model went back to it.
        </Notice>
      )}
      {t.visual.status === 'failed' && t.visual.error && (
        <Notice kind="error">
          <strong>{t.visual.error.message}</strong> {t.visual.error.hint}{' '}
          <span className="mono small">{t.visual.error.code}</span>
        </Notice>
      )}
      {t.visual.status === 'cancelled' && (
        <Notice kind="warn">
          You stopped this run. The earlier steps are kept, so the next run starts quickly.
        </Notice>
      )}

      {finished && record?.status === 'succeeded' && !t.replay && (
        <section className="card stack">
          <h2>Result</h2>
          <Scores record={record} metric={metric} />
          <p className="muted small">
            The left column is a check on rows the model has already seen, so it flatters the model.
            The right column uses rows it has never seen, and is the one to trust. The test rows are
            untouched.
          </p>
          {record.timings && <p className="muted small">{record.durationMs} ms in total.</p>}
        </section>
      )}

      {runs.length > 0 && (
        <section>
          <h2>Earlier runs</h2>
          <ul className="plain">
            {[...runs].reverse().map((r) => (
              <li key={r.runId} className="row">
                <strong>{r.label}</strong>
                <span className="muted">
                  {r.status === 'succeeded'
                    ? `${metricInfo(r.primaryMetric).label} ${formatScore(r.metrics.validation?.[r.primaryMetric])}`
                    : r.status}
                </span>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => void replay(r)}
                  disabled={t.running}
                >
                  Replay
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
