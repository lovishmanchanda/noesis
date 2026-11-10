import type { RunError, Scores, TrainOutcome, TrainingEvent } from '@noesis/engine-client';
import { nodeSpec, paramSpecs } from '@noesis/registry';
import type { RunSummary } from '@noesis/rules';
import { effectiveParams, type NOESISPipeline } from '@noesis/schema';
import { DROPPABLE } from '../training/events';
import { isBetter, metricInfo } from './metrics';

/** One training run, as it is kept on this device. Results never change after the run ends. */
export interface RunRecord {
  runId: string;
  createdAt: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  algorithm: string;
  /** What the user calls it. Editable, like `notes` and `kept`. */
  label: string;
  notes: string;
  kept: boolean;
  /** The exact pipeline that ran, so the run can be explained after the live pipeline moves on. */
  pipelineSnapshot: NOESISPipeline;
  nodeHashes: Record<string, string>;
  pipelineHash: string;
  modelNode: string;
  modelHash: string;
  dataset: { name: string; fingerprint: string; rows: number };
  seed: number;
  engine: { backend: 'browser'; engineEpoch: string; device: 'cpu'; deterministic: 'exact' };
  primaryMetric: string;
  durationMs: number;
  timings: Record<string, number>;
  metrics: {
    train: Scores | null;
    validation: Scores | null;
    spread: TrainOutcome['spread'] | null;
    folds: Scores[] | null;
    /** Stays null until the final test (Phase 4). */
    test: Scores | null;
  };
  /** Curves and how the fit ended, in the engine's own words. */
  fit: Record<string, unknown> | null;
  error: RunError | null;
  testAccess: { at: string; reason: string }[];
  parentRunId: string | null;
  vizLevel: string;
  eventCount: number;
}

export const newRunId = (): string =>
  `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface RunInputs {
  runId: string;
  pipeline: NOESISPipeline;
  nodeHashes: Record<string, string>;
  modelNode: string;
  dataset: RunRecord['dataset'];
  primaryMetric: string;
  vizLevel: string;
  label: string;
  now?: Date;
}

/** The record written when a run starts, so a closed tab can be noticed later. */
export function startedRecord(i: RunInputs): RunRecord {
  const last = i.pipeline.nodes[i.pipeline.nodes.length - 1];
  const model = i.pipeline.nodes.find((n) => n.id === i.modelNode);
  return {
    runId: i.runId,
    createdAt: (i.now ?? new Date()).toISOString(),
    status: 'running',
    algorithm: String(model?.params['algorithm']?.value ?? ''),
    label: i.label,
    notes: '',
    kept: false,
    pipelineSnapshot: i.pipeline,
    nodeHashes: i.nodeHashes,
    pipelineHash: last ? (i.nodeHashes[last.id] ?? '') : '',
    modelNode: i.modelNode,
    modelHash: i.nodeHashes[i.modelNode] ?? '',
    dataset: i.dataset,
    seed: i.pipeline.project.seed,
    engine: { backend: 'browser', engineEpoch: '1', device: 'cpu', deterministic: 'exact' },
    primaryMetric: i.primaryMetric,
    durationMs: 0,
    timings: {},
    metrics: { train: null, validation: null, spread: null, folds: null, test: null },
    fit: null,
    error: null,
    testAccess: [],
    parentRunId: null,
    vizLevel: i.vizLevel,
    eventCount: 0,
  };
}

/** The record once the run has ended. */
export function finishedRecord(
  started: RunRecord,
  outcome: TrainOutcome,
  eventCount: number,
): RunRecord {
  return {
    ...started,
    status: outcome.status,
    durationMs: outcome.durationMs,
    timings: outcome.timings ?? {},
    metrics: {
      train: outcome.train ?? null,
      validation: outcome.validation ?? null,
      spread: outcome.spread ?? null,
      folds: outcome.folds ?? null,
      test: null,
    },
    fit: outcome.fit ?? null,
    error: outcome.error ?? null,
    eventCount,
  };
}

export const validationScore = (r: RunRecord): number | null =>
  r.metrics.validation?.[r.primaryMetric] ?? null;
export const trainScore = (r: RunRecord): number | null =>
  r.metrics.train?.[r.primaryMetric] ?? null;

/**
 * The leaderboard: succeeded runs ranked by their validation score only. The test score never
 * appears here, and a run that was never validated cannot rank.
 */
export function rankRuns(runs: readonly RunRecord[], metric: string): RunRecord[] {
  const score = (r: RunRecord): number | null => r.metrics.validation?.[metric] ?? null;
  return runs
    .filter((r) => r.status === 'succeeded' && score(r) !== null)
    .sort((a, b) => {
      if (isBetter(score(a), score(b), metric)) return -1;
      if (isBetter(score(b), score(a), metric)) return 1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
}

/** What the rules need to know about a run. */
export function summaryOf(r: RunRecord, baselineAlgorithms: readonly string[]): RunSummary {
  const fit = r.fit ?? {};
  const train = (fit['trainLoss'] as number[] | undefined) ?? undefined;
  const val = (fit['valLoss'] as number[] | undefined) ?? undefined;
  return {
    id: r.runId,
    modelNode: r.modelNode,
    algorithm: r.algorithm,
    metric: r.primaryMetric,
    higherIsBetter: metricInfo(r.primaryMetric).higherIsBetter,
    trainScore: trainScore(r),
    validationScore: validationScore(r),
    settings: {},
    baseline: baselineAlgorithms.includes(r.algorithm),
    status: r.status === 'failed' ? 'failed' : 'succeeded',
    ...(r.error ? { errorCode: r.error.code } : {}),
    ...(typeof fit['stopped'] === 'string' ? { stopped: fit['stopped'] } : {}),
    ...(train ? { trainLoss: train } : {}),
    ...(val ? { validationLoss: val } : {}),
    nodeHash: r.modelHash,
  };
}

export interface StepDiff {
  node: string;
  type: string;
  label: string;
  change: 'changed' | 'added' | 'removed';
  params: { name: string; label: string; from: unknown; to: unknown }[];
}

const show = (v: unknown): string =>
  v === null || v === undefined ? 'not set' : Array.isArray(v) ? v.join(', ') : String(v);
export const describeValue = show;

/**
 * What differs between two runs: for every step whose hash differs, which settings changed. The
 * run records keep their own pipeline, so this works even after the live pipeline moved on.
 */
export function diffRuns(a: RunRecord, b: RunRecord): StepDiff[] {
  const out: StepDiff[] = [];
  const nodesA = new Map(a.pipelineSnapshot.nodes.map((n) => [n.id, n]));
  const nodesB = new Map(b.pipelineSnapshot.nodes.map((n) => [n.id, n]));
  for (const id of new Set([...nodesA.keys(), ...nodesB.keys()])) {
    const na = nodesA.get(id);
    const nb = nodesB.get(id);
    const node = (nb ?? na)!;
    const label = nodeSpec(node.type).label;
    if (na && !nb) out.push({ node: id, type: node.type, label, change: 'removed', params: [] });
    else if (!na && nb) out.push({ node: id, type: node.type, label, change: 'added', params: [] });
    else if (na && nb && a.nodeHashes[id] !== b.nodeHashes[id]) {
      const pa = effectiveParams(na, a.pipelineSnapshot.task.type);
      const pb = effectiveParams(nb, b.pipelineSnapshot.task.type);
      const specs = paramSpecs(
        nb.type,
        pb['algorithm'] ?? pa['algorithm'],
        b.pipelineSnapshot.task.type,
      );
      const names = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort();
      const params = names
        .filter((n) => JSON.stringify(pa[n] ?? null) !== JSON.stringify(pb[n] ?? null))
        .map((n) => ({
          name: n,
          label: specs[n]?.label ?? n,
          from: pa[n] ?? null,
          to: pb[n] ?? null,
        }));
      // Same settings but a different hash means something earlier changed.
      out.push({ node: id, type: nb.type, label, change: 'changed', params });
    }
  }
  // A step whose settings are the same but whose hash differs only follows from an earlier change.
  // Show it only when nothing else explains the difference.
  const explained = out.filter((d) => d.change !== 'changed' || d.params.length > 0);
  return explained.length > 0 ? explained : out;
}

const CAP_BYTES = 1_000_000;

/**
 * The events worth keeping for a replay. Every event that carries a result stays. Events the user
 * could lose without harm (weight pictures) are thinned to a handful, and if the log is still
 * over the cap they are dropped, then the deeper tree nodes after them.
 */
export function decimateEvents(events: readonly TrainingEvent[], cap = CAP_BYTES): TrainingEvent[] {
  const keepEvery = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const e of events) if (DROPPABLE.has(e.type)) seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
  for (const [type, n] of seen) keepEvery.set(type, Math.max(1, Math.ceil(n / 8)));
  const counter = new Map<string, number>();
  let kept = events.filter((e) => {
    if (!DROPPABLE.has(e.type)) return true;
    const i = counter.get(e.type) ?? 0;
    counter.set(e.type, i + 1);
    return i % (keepEvery.get(e.type) ?? 1) === 0;
  });
  const size = (list: readonly TrainingEvent[]): number => JSON.stringify(list).length;
  if (size(kept) > cap) kept = kept.filter((e) => !DROPPABLE.has(e.type));
  if (size(kept) > cap) {
    let trees = 0;
    kept = kept.filter((e) => e.type !== 'tree_node_added' || ++trees <= 100);
  }
  return kept;
}
