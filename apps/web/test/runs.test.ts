import fs from 'node:fs';
import path from 'node:path';
import type { ColumnProfile, TrainOutcome, TrainingEvent } from '@noesis/engine-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTrainingPipeline } from '../src/pipeline/build';
import { setColumnStep } from '../src/pipeline/prepare';
import {
  decimateEvents,
  diffRuns,
  finishedRecord,
  rankRuns,
  startedRecord,
  summaryOf,
  type RunRecord,
} from '../src/runs/records';
import { isBetter, formatScore } from '../src/runs/metrics';
import {
  clearRuns,
  deleteRun,
  editRun,
  loadRuns,
  prune,
  saveRun,
  useRuns,
} from '../src/runs/store';
import { useStorage } from '../src/state/persist';
import { initialProject, type ProjectState } from '../src/state/project';
import { memoryKv } from '../src/state/storage';

const col = (name: string, dtype: ColumnProfile['dtype']): ColumnProfile => ({
  name,
  dtype,
  missing: 0,
  missingPct: 0,
  unique: 100,
  uniquePct: 0.1,
  constant: false,
  idLike: false,
});
const COLUMNS = [col('area', 'float'), col('age', 'float'), col('price', 'float')];

function project(patch: Partial<ProjectState> = {}): ProjectState {
  return {
    ...initialProject(),
    name: 'Homes',
    goal: 'number',
    dataset: {
      name: 'homes.csv',
      source: 'file',
      settings: {},
      profile: { rows: 600, columnCount: 3, duplicates: 0, memoryMB: 1, columns: COLUMNS },
    },
    roles: { area: 'feature', age: 'feature', price: 'target' },
    model: {
      algorithm: 'random_forest',
      params: { max_depth: { value: 6, source: 'user' } },
      preset: null,
    },
    ...patch,
  };
}

let counter = 0;
function record(p: ProjectState, over: Partial<TrainOutcome> = {}, label = 'run'): RunRecord {
  const { pipeline } = buildTrainingPipeline(p);
  const hashes = Object.fromEntries(
    pipeline.nodes.map((n) => [n.id, `${n.id}:${JSON.stringify(n.params)}`]),
  );
  const started = startedRecord({
    runId: `run_${++counter}`,
    pipeline,
    nodeHashes: hashes,
    modelNode: 'm1',
    dataset: { name: 'homes.csv', fingerprint: 'f', rows: 600 },
    primaryMetric: 'rmse',
    vizLevel: 'full',
    label,
    now: new Date(2026, 10, 10, 0, counter),
  });
  return finishedRecord(
    started,
    {
      status: 'succeeded',
      durationMs: 100,
      algorithm: 'random_forest',
      train: { rmse: 1 },
      validation: { rmse: 2 },
      ...over,
    },
    0,
  );
}

describe('the training pipeline', () => {
  it('adds the model and the check after the prepared steps, and is valid', () => {
    const { pipeline, issues } = buildTrainingPipeline(project());
    expect(pipeline.nodes.map((n) => n.type)).toEqual(['load_csv', 'split', 'model', 'validate']);
    expect(issues).toEqual([]);
    expect(pipeline.nodes[2]?.params['algorithm']?.value).toBe('random_forest');
  });
});

describe('the leaderboard', () => {
  it('ranks by validation score, lower first for an error and higher first for a score', () => {
    const a = record(project(), { validation: { rmse: 3 } });
    const b = record(project(), { validation: { rmse: 1 } });
    expect(rankRuns([a, b], 'rmse').map((r) => r.runId)).toEqual([b.runId, a.runId]);
    const c = record(project(), { validation: { r2: 0.5 } });
    const d = record(project(), { validation: { r2: 0.9 } });
    expect(rankRuns([c, d], 'r2').map((r) => r.runId)).toEqual([d.runId, c.runId]);
  });

  it('never looks at the test score', () => {
    const a = record(project(), { validation: { rmse: 3 } });
    const b = record(project(), { validation: { rmse: 1 } });
    a.metrics.test = { rmse: 0.001 };
    b.metrics.test = { rmse: 99 };
    expect(rankRuns([a, b], 'rmse')[0]?.runId).toBe(b.runId);
  });

  it('leaves out runs that failed, were stopped or have no validation score', () => {
    const ok = record(project());
    const failed = record(project(), { status: 'failed', validation: null });
    const stopped = record(project(), { status: 'cancelled', validation: null });
    const unvalidated = record(project(), { validation: null });
    expect(rankRuns([ok, failed, stopped, unvalidated], 'rmse')).toEqual([ok]);
  });

  it('knows which direction is better', () => {
    expect(isBetter(1, 2, 'rmse')).toBe(true);
    expect(isBetter(2, 1, 'r2')).toBe(true);
    expect(isBetter(null, 1, 'rmse')).toBe(false);
    expect(isBetter(1, null, 'rmse')).toBe(true);
    expect(formatScore(0.123456)).toBe('0.123');
    expect(formatScore(null)).toBe('–');
  });
});

describe('comparing two runs', () => {
  it('lists only the settings that differ, in words', () => {
    const a = record(project());
    const b = record(
      project({
        model: {
          algorithm: 'random_forest',
          params: { max_depth: { value: 12, source: 'user' } },
          preset: null,
        },
      }),
    );
    const diff = diffRuns(a, b);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ type: 'model', change: 'changed' });
    expect(diff[0]?.params).toEqual([
      { name: 'max_depth', label: expect.any(String), from: 6, to: 12 },
    ]);
  });

  it('shows a step that was added or removed', () => {
    const a = record(project());
    const b = record(
      project({ prepare: setColumnStep([], 'impute', 'age', { strategy: 'median' }) }),
    );
    const diff = diffRuns(a, b);
    expect(diff.find((d) => d.type === 'impute')?.change).toBe('added');
    expect(diffRuns(b, a).find((d) => d.type === 'impute')?.change).toBe('removed');
  });

  it('is empty for identical runs', () => {
    expect(diffRuns(record(project()), record(project()))).toEqual([]);
  });
});

describe('what the rules see of a run', () => {
  it('carries the curves, how the fit ended and the model hash', () => {
    const r = record(project({ model: { algorithm: 'mlp', params: {}, preset: null } }), {
      algorithm: 'mlp',
      fit: { trainLoss: [3, 2], valLoss: [3, 2.5], stopped: 'max_epochs' },
    });
    const s = summaryOf(r, ['linear_regression']);
    expect(s).toMatchObject({
      algorithm: 'mlp',
      baseline: false,
      trainLoss: [3, 2],
      stopped: 'max_epochs',
      status: 'succeeded',
      higherIsBetter: false,
      validationScore: 2,
      trainScore: 1,
    });
    expect(s.nodeHash).toBe(r.modelHash);
    expect(summaryOf(r, ['mlp']).baseline).toBe(true);
  });

  it('reports a failed run with its error code', () => {
    const r = record(project(), {
      status: 'failed',
      error: { code: 'E_NAN_LOSS', message: 'x', hint: 'y' },
      validation: null,
    });
    expect(summaryOf(r, [])).toMatchObject({ status: 'failed', errorCode: 'E_NAN_LOSS' });
  });
});

const dir = path.resolve(import.meta.dirname, '../../../fixtures/events');
const golden = (name: string): TrainingEvent[] =>
  (
    JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8')) as {
      events: TrainingEvent[];
    }
  ).events;

describe('keeping the event log', () => {
  const event = (type: string, i: number): TrainingEvent => ({
    v: 1,
    runId: 'r',
    seq: i,
    t: i,
    node: 'n',
    trial: null,
    type,
    source: 'live',
    data: { i },
  });

  it('keeps every result event and thins the weight pictures to a handful', () => {
    const events = [
      ...Array.from({ length: 100 }, (_, i) => event('epoch_end', i)),
      ...Array.from({ length: 100 }, (_, i) => event('weights_snapshot', 100 + i)),
    ];
    const kept = decimateEvents(events);
    expect(kept.filter((e) => e.type === 'epoch_end')).toHaveLength(100);
    expect(kept.filter((e) => e.type === 'weights_snapshot').length).toBeLessThanOrEqual(10);
    expect(kept.filter((e) => e.type === 'weights_snapshot').length).toBeGreaterThan(0);
  });

  it('keeps a real log intact when it is small', () => {
    const log = golden('mlp-regression');
    expect(decimateEvents(log)).toEqual(log);
  });

  it('drops pictures, then deep tree nodes, to stay under the cap', () => {
    const big = Array.from({ length: 4000 }, (_, i) => ({
      ...event('weights_snapshot', i),
      data: { pad: 'x'.repeat(2000) },
    }));
    expect(
      JSON.stringify(decimateEvents([...big, event('epoch_end', 9999)], 50_000)).length,
    ).toBeLessThan(50_000);
    const trees = Array.from({ length: 500 }, (_, i) => ({
      ...event('tree_node_added', i),
      data: { pad: 'y'.repeat(500) },
    }));
    expect(decimateEvents(trees, 40_000).length).toBeLessThanOrEqual(100);
  });
});

describe('saved runs', () => {
  let kv = memoryKv();
  beforeEach(() => {
    kv = memoryKv();
    useStorage(kv);
    useRuns.setState({ runs: [], loaded: false });
  });

  it('are saved, loaded again and editable only in label, notes and kept', async () => {
    const r = record(project());
    await saveRun(r, golden('mlp-regression'));
    useRuns.setState({ runs: [], loaded: false });
    await loadRuns();
    expect(useRuns.getState().runs.map((x) => x.runId)).toEqual([r.runId]);
    await editRun(r.runId, { label: 'Baseline', kept: true });
    const edited = useRuns.getState().runs[0]!;
    expect(edited).toMatchObject({ label: 'Baseline', kept: true });
    expect(edited.metrics).toEqual(r.metrics);
  });

  it('mark a run left running by a closed tab as interrupted', async () => {
    const r = { ...record(project()), status: 'running' as const };
    await saveRun(r);
    useRuns.setState({ runs: [], loaded: false });
    await loadRuns();
    expect(useRuns.getState().runs[0]?.status).toBe('interrupted');
  });

  it('keep the newest runs and every kept run, and drop the rest with their events', async () => {
    const runs = Array.from({ length: 6 }, (_, i) => record(project(), {}, `r${i}`));
    for (const r of runs) await saveRun({ ...r, kept: r === runs[0] }, golden('ridge-regression'));
    await prune(2);
    const left = useRuns.getState().runs.map((r) => r.label);
    expect(left).toEqual(['r0', 'r4', 'r5']);
    expect(kv.data.has(`events:${runs[1]!.runId}`)).toBe(false);
    expect(kv.data.has(`events:${runs[0]!.runId}`)).toBe(true);
  });

  it('can be deleted and cleared', async () => {
    const a = record(project());
    const b = record(project());
    await saveRun(a);
    await saveRun(b);
    await deleteRun(a.runId);
    expect(useRuns.getState().runs.map((r) => r.runId)).toEqual([b.runId]);
    await clearRuns();
    expect(useRuns.getState().runs).toEqual([]);
    expect(kv.data.has(`run:${b.runId}`)).toBe(false);
  });
});
