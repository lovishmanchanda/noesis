import type { ColumnProfile, DatasetProfile } from '@noesis/engine-client';
import type { NOESISPipeline, PipelineNode } from '@noesis/schema';
import { DEFAULT_THRESHOLDS, type RuleContext, type RunSummary } from '../src';

type Dtype = ColumnProfile['dtype'];
type Role = NOESISPipeline['dataset']['columns'][number]['role'];

/** A column profile with calm defaults; override what the test is about. */
export function col(name: string, dtype: Dtype, extra: Partial<ColumnProfile> = {}): ColumnProfile {
  return {
    name,
    dtype,
    missing: 0,
    missingPct: 0,
    unique: 100,
    uniquePct: 0.1,
    constant: false,
    idLike: false,
    ...extra,
  };
}

export function profileOf(
  columns: ColumnProfile[],
  extra: Partial<DatasetProfile> = {},
): DatasetProfile {
  return { rows: 1000, columnCount: columns.length, duplicates: 0, memoryMB: 1, columns, ...extra };
}

const P = (value: unknown) => ({ value: value as never, source: 'user' as const });

export function pipelineOf(
  columns: { name: string; dtype: Dtype; role?: Role }[],
  options: {
    task?: 'regression' | 'classification' | 'clustering';
    metric?: string;
    split?: Record<string, unknown>;
    model?: string;
    extra?: PipelineNode[];
    load?: Record<string, unknown>;
  } = {},
): NOESISPipeline {
  const task = options.task ?? 'regression';
  const nodes: PipelineNode[] = [
    {
      id: 'n1',
      type: 'load_csv',
      params: Object.fromEntries(Object.entries(options.load ?? {}).map(([k, v]) => [k, P(v)])),
    },
    {
      id: 'n2',
      type: 'split',
      inputs: ['n1'],
      params: Object.fromEntries(
        Object.entries({ strategy: 'random', ratios: [0.7, 0.15, 0.15], ...options.split }).map(
          ([k, v]) => [k, P(v)],
        ),
      ),
    },
  ];
  let last = 'n2';
  for (const node of options.extra ?? []) {
    nodes.push({ ...node, inputs: [last] });
    last = node.id;
  }
  if (options.model) {
    nodes.push({
      id: 'n9',
      type: 'model',
      inputs: [last],
      params: { algorithm: P(options.model) },
    });
    nodes.push({
      id: 'n10',
      type: 'validate',
      inputs: ['n9'],
      params: { method: P('kfold'), k: P(5) },
    });
  }
  return {
    schemaVersion: '0.1',
    project: { name: 'Test', seed: 1, mode: 'guided' },
    dataset: {
      source: { kind: 'local-file', name: 'x.csv' },
      rows: 1000,
      columns: columns.map((c) => ({ name: c.name, dtype: c.dtype, role: c.role ?? 'feature' })),
    },
    task: {
      type: task,
      primaryMetric: (options.metric ?? (task === 'classification' ? 'f1' : 'rmse')) as never,
    },
    nodes,
  } as unknown as NOESISPipeline;
}

export const node = (
  id: string,
  type: PipelineNode['type'],
  params: Record<string, unknown> = {},
): PipelineNode => ({
  id,
  type,
  ...(type === 'impute' || type === 'encode' || type === 'scale' || type === 'handle_outliers'
    ? { fit_on: 'train' as const }
    : {}),
  params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, P(v)])),
});

export function ctxOf(
  pipeline: NOESISPipeline,
  raw: DatasetProfile,
  extra: Partial<RuleContext> = {},
): RuleContext {
  return {
    raw,
    pipeline,
    task: pipeline.task.type,
    runs: [],
    testUsed: false,
    settings: { mode: 'guided', disabledGroups: [], engine: 'browser' },
    thresholds: DEFAULT_THRESHOLDS,
    ...extra,
  };
}

export function run(extra: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'r1',
    modelNode: 'n9',
    algorithm: 'random_forest',
    metric: 'rmse',
    higherIsBetter: false,
    trainScore: 1,
    validationScore: 1,
    settings: {},
    baseline: false,
    ...extra,
  };
}
