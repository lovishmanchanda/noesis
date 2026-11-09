import { validatePipeline } from '@noesis/schema';
import { describe, expect, it } from 'vitest';
import { applyPatch, evaluateRules, type RuleContext, type Suggestion } from '../src';
import { col, ctxOf, node, pipelineOf, profileOf, run } from './fixtures';

const num = (name: string, extra = {}) => col(name, 'float', extra);
const cat = (name: string, extra = {}) => col(name, 'category', extra);

const fired = (ctx: RuleContext, prefix: string): Suggestion[] =>
  evaluateRules(ctx).filter((s) => s.ruleId.startsWith(prefix));

/** A regression pipeline over the given columns plus a target "y", with the data already split. */
function regression(
  features: ReturnType<typeof col>[],
  options: Parameters<typeof pipelineOf>[1] = {},
  profileExtra = {},
  { split = true } = {},
): RuleContext {
  const columns = [...features, num('y')];
  const pipeline = pipelineOf(
    columns.map((c) => ({
      name: c.name,
      dtype: c.dtype,
      role: c.name === 'y' ? ('target' as const) : ('feature' as const),
    })),
    options,
  );
  const profile = profileOf(columns, profileExtra);
  return ctxOf(pipeline, profile, split ? { train: profile } : {});
}

function classification(
  features: ReturnType<typeof col>[],
  options: Parameters<typeof pipelineOf>[1] = {},
  targetProfile = {
    name: 'y',
    missing: 0,
    unique: 2,
    classes: [
      { value: 'a', count: 500 },
      { value: 'b', count: 500 },
    ],
    minorityShare: 0.5,
  },
): RuleContext {
  const columns = [...features, cat('y', { unique: 2 })];
  const pipeline = pipelineOf(
    columns.map((c) => ({
      name: c.name,
      dtype: c.dtype,
      role: c.name === 'y' ? ('target' as const) : ('feature' as const),
    })),
    { task: 'classification', ...options },
  );
  const profile = profileOf(columns, { target: targetProfile });
  return ctxOf(pipeline, profile, { train: profile });
}

/** Sets settings on the model step of a context, as the Model screen would. */
function withModel(ctx: RuleContext, params: Record<string, unknown>): RuleContext {
  const pipeline = structuredClone(ctx.pipeline);
  const model = pipeline.nodes.find((n) => n.type === 'model');
  for (const [k, v] of Object.entries(params))
    if (model) model.params[k] = { value: v as never, source: 'user' };
  return { ...ctx, pipeline };
}

const falling = (from: number, to: number, n = 10): number[] =>
  Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

interface Case {
  rule: string;
  label: string;
  ctx: RuleContext;
  count: number;
}

const CASES: Case[] = [
  // D01: fewer than 500 rows
  { rule: 'D01', label: '499 rows', ctx: regression([num('a')], {}, { rows: 499 }), count: 1 },
  {
    rule: 'D01',
    label: '500 rows is the boundary',
    ctx: regression([num('a')], {}, { rows: 500 }),
    count: 0,
  },
  // D03: more than 1% duplicate rows
  {
    rule: 'D03',
    label: '1.1% duplicates',
    ctx: regression([num('a')], {}, { duplicates: 11 }),
    count: 1,
  },
  {
    rule: 'D03',
    label: '1.0% duplicates is the boundary',
    ctx: regression([num('a')], {}, { duplicates: 10 }),
    count: 0,
  },
  {
    rule: 'D03',
    label: 'already handled',
    ctx: regression([num('a')], { extra: [node('n3', 'drop_duplicates')] }, { duplicates: 100 }),
    count: 0,
  },
  // D04: one column whose header holds a separator
  {
    rule: 'D04',
    label: 'semicolon header',
    ctx: ctxOf(
      pipelineOf([{ name: 'a;b;c', dtype: 'string', role: 'target' }]),
      profileOf([col('a;b;c', 'string')], { columnCount: 1 }),
    ),
    count: 1,
  },
  {
    rule: 'D04',
    label: 'separator already chosen',
    ctx: ctxOf(
      pipelineOf([{ name: 'a;b;c', dtype: 'string', role: 'target' }], {
        load: { delimiter: ';' },
      }),
      profileOf([col('a;b;c', 'string')], { columnCount: 1 }),
    ),
    count: 0,
  },
  {
    rule: 'D04',
    label: 'a plain one-column file',
    ctx: ctxOf(
      pipelineOf([{ name: 'price', dtype: 'float', role: 'target' }]),
      profileOf([num('price')], { columnCount: 1 }),
    ),
    count: 0,
  },
  // T01: the target has empty cells
  {
    rule: 'T01',
    label: 'target missing',
    ctx: regression([num('a')], {}, { target: { name: 'y', missing: 5, unique: 50, classes: [] } }),
    count: 1,
  },
  {
    rule: 'T01',
    label: 'no missing target',
    ctx: regression([num('a')], {}, { target: { name: 'y', missing: 0, unique: 50, classes: [] } }),
    count: 0,
  },
  {
    rule: 'T01',
    label: 'rows already removed',
    ctx: regression(
      [num('a')],
      { extra: [node('n3', 'filter_rows', { column: 'y', operator: 'not_null' })] },
      { target: { name: 'y', missing: 5, unique: 50, classes: [] } },
    ),
    count: 0,
  },
  // T04: a rare class
  {
    rule: 'T04',
    label: 'minority 9%',
    ctx: classification(
      [num('a')],
      { split: { strategy: 'stratified' }, metric: 'accuracy' },
      {
        name: 'y',
        missing: 0,
        unique: 2,
        classes: [
          { value: 'a', count: 910 },
          { value: 'b', count: 90 },
        ],
        minorityShare: 0.09,
      },
    ),
    count: 1,
  },
  {
    rule: 'T04',
    label: 'minority 10% is the boundary',
    ctx: classification(
      [num('a')],
      {},
      {
        name: 'y',
        missing: 0,
        unique: 2,
        classes: [
          { value: 'a', count: 900 },
          { value: 'b', count: 100 },
        ],
        minorityShare: 0.1,
      },
    ),
    count: 0,
  },
  {
    rule: 'T04',
    label: 'already stratified and judged by F1',
    ctx: classification(
      [num('a')],
      { split: { strategy: 'stratified' }, metric: 'f1' },
      {
        name: 'y',
        missing: 0,
        unique: 2,
        classes: [
          { value: 'a', count: 950 },
          { value: 'b', count: 50 },
        ],
        minorityShare: 0.05,
      },
    ),
    count: 0,
  },
  // C01: identifier-like columns
  {
    rule: 'C01',
    label: 'named like an id',
    ctx: regression([col('customer_id', 'int', { uniquePct: 0.99, unique: 990 })]),
    count: 1,
  },
  {
    rule: 'C01',
    label: 'every value different',
    ctx: regression([col('code', 'string', { uniquePct: 1, unique: 1000 })]),
    count: 1,
  },
  {
    rule: 'C01',
    label: 'a measured number that is nearly unique',
    ctx: regression([col('weight', 'float', { uniquePct: 1, unique: 1000 })]),
    count: 0,
  },
  {
    rule: 'C01',
    label: 'a nearly unique column that is not named like an id',
    ctx: regression([col('name', 'string', { uniquePct: 0.99, unique: 990 })]),
    count: 0,
  },
  // C02: constant columns
  {
    rule: 'C02',
    label: 'one value',
    ctx: regression([col('flag', 'category', { unique: 1, constant: true })]),
    count: 1,
  },
  {
    rule: 'C02',
    label: 'two values',
    ctx: regression([col('flag', 'category', { unique: 2 })]),
    count: 0,
  },
  // C04 to C06: missing values, read from the training rows
  {
    rule: 'C04',
    label: '41% missing',
    ctx: regression([num('a', { missing: 410, missingPct: 0.41 })]),
    count: 1,
  },
  {
    rule: 'C04',
    label: '40% missing is the boundary',
    ctx: regression([num('a', { missing: 400, missingPct: 0.4 })]),
    count: 0,
  },
  {
    rule: 'C05',
    label: '40% missing, number',
    ctx: regression([num('a', { missing: 400, missingPct: 0.4, skew: 1 })]),
    count: 1,
  },
  {
    rule: 'C05',
    label: '41% belongs to C04',
    ctx: regression([num('a', { missing: 410, missingPct: 0.41 })]),
    count: 0,
  },
  { rule: 'C05', label: 'nothing missing', ctx: regression([num('a')]), count: 0 },
  {
    rule: 'C05',
    label: 'already filled',
    ctx: regression([num('a', { missing: 100, missingPct: 0.1 })], {
      extra: [node('n3', 'impute', { columns: ['a'], strategy: 'median' })],
    }),
    count: 0,
  },
  {
    rule: 'C06',
    label: 'text, 10% missing',
    ctx: regression([cat('c', { missing: 100, missingPct: 0.1 })]),
    count: 1,
  },
  {
    rule: 'C06',
    label: 'a number is C05, not C06',
    ctx: regression([num('a', { missing: 100, missingPct: 0.1 })]),
    count: 0,
  },
  // C07: dates
  { rule: 'C07', label: 'a date column', ctx: regression([col('day', 'datetime')]), count: 1 },
  {
    rule: 'C07',
    label: 'dates already split into parts',
    ctx: regression([col('day', 'datetime')], {
      extra: [
        node('n3', 'derive_feature', {
          newName: 'day_year',
          kind: 'date_part',
          sourceColumns: ['day'],
          datePart: 'year',
        }),
      ],
    }),
    count: 0,
  },
  // C08 and C09: text columns
  { rule: 'C08', label: '15 values', ctx: regression([cat('c', { unique: 15 })]), count: 1 },
  { rule: 'C08', label: '16 values', ctx: regression([cat('c', { unique: 16 })]), count: 0 },
  {
    rule: 'C08',
    label: 'already encoded',
    ctx: regression([cat('c', { unique: 5 })], {
      extra: [node('n3', 'encode', { columns: ['c'], method: 'onehot' })],
    }),
    count: 0,
  },
  {
    rule: 'C09',
    label: '51 values',
    ctx: regression([col('city', 'string', { unique: 51 })]),
    count: 1,
  },
  {
    rule: 'C09',
    label: '50 values is the boundary',
    ctx: regression([col('city', 'string', { unique: 50 })]),
    count: 0,
  },
  // C12: a column that tracks the target too closely
  {
    rule: 'C12',
    label: 'correlation 0.99',
    ctx: regression([num('a', { targetCorr: 0.99 })]),
    count: 1,
  },
  {
    rule: 'C12',
    label: 'negative 0.99 counts too',
    ctx: regression([num('a', { targetCorr: -0.99 })]),
    count: 1,
  },
  {
    rule: 'C12',
    label: '0.98 is the boundary',
    ctx: regression([num('a', { targetCorr: 0.98 })]),
    count: 0,
  },
  // S01 and S02: the split
  { rule: 'S01', label: 'random split, classes', ctx: classification([num('a')]), count: 1 },
  {
    rule: 'S01',
    label: 'already stratified',
    ctx: classification([num('a')], { split: { strategy: 'stratified' } }),
    count: 0,
  },
  { rule: 'S01', label: 'regression has no classes', ctx: regression([num('a')]), count: 0 },
  {
    rule: 'S02',
    label: 'the target drifts with time',
    ctx: regression([col('day', 'datetime', { targetTrend: 0.6 })]),
    count: 1,
  },
  {
    rule: 'S02',
    label: 'no drift',
    ctx: regression([col('day', 'datetime', { targetTrend: 0.1 })]),
    count: 0,
  },
  {
    rule: 'S02',
    label: 'already split by time',
    ctx: regression([col('day', 'datetime', { targetTrend: 0.6 })], {
      split: { strategy: 'time', timeColumn: 'day' },
    }),
    count: 0,
  },
  // M01, M04, M05: the model
  {
    rule: 'M01',
    label: 'knn without scaling',
    ctx: regression([num('a')], { model: 'knn' }),
    count: 1,
  },
  {
    rule: 'M01',
    label: 'a forest needs no scaling',
    ctx: regression([num('a')], { model: 'random_forest' }),
    count: 0,
  },
  {
    rule: 'M01',
    label: 'scaling already there',
    ctx: regression([num('a')], {
      model: 'knn',
      extra: [node('n3', 'scale', { method: 'standard' })],
    }),
    count: 0,
  },
  {
    rule: 'M04',
    label: 'a forest with no baseline run',
    ctx: regression([num('a')], { model: 'random_forest' }),
    count: 1,
  },
  {
    rule: 'M04',
    label: 'the model is already a baseline',
    ctx: regression([num('a')], { model: 'linear_regression' }),
    count: 0,
  },
  {
    rule: 'M04',
    label: 'a baseline run exists',
    ctx: {
      ...regression([num('a')], { model: 'random_forest' }),
      runs: [run({ baseline: true, modelNode: 'n8' })],
    },
    count: 0,
  },
  {
    rule: 'M05',
    label: 'a neural net on 999 rows',
    ctx: regression([num('a')], { model: 'mlp' }, { rows: 999 }),
    count: 1,
  },
  {
    rule: 'M05',
    label: '1000 rows is the boundary',
    ctx: regression([num('a')], { model: 'mlp' }, { rows: 1000 }),
    count: 0,
  },
  // R01, R03, R09: results
  {
    rule: 'R01',
    label: 'train 1.0 against validation 1.2 (lower is better)',
    ctx: {
      ...regression([num('a')], { model: 'random_forest' }),
      runs: [run({ trainScore: 1, validationScore: 1.2 })],
    },
    count: 1,
  },
  {
    rule: 'R01',
    label: 'a gap of exactly 10% is the boundary',
    ctx: {
      ...regression([num('a')], { model: 'random_forest' }),
      runs: [run({ trainScore: 1, validationScore: 1.1 })],
    },
    count: 0,
  },
  {
    rule: 'R01',
    label: 'higher is better: train 0.95 against validation 0.8',
    ctx: {
      ...classification([num('a')], { model: 'random_forest' }),
      runs: [run({ metric: 'f1', higherIsBetter: true, trainScore: 0.95, validationScore: 0.8 })],
    },
    count: 1,
  },
  {
    rule: 'R01',
    label: 'a run made with other settings does not count',
    ctx: {
      ...regression([num('a')], { model: 'random_forest' }),
      runs: [run({ trainScore: 1, validationScore: 1.5, settings: { max_depth: 3 } })],
    },
    count: 0,
  },
  {
    rule: 'R03',
    label: 'no better than the baseline',
    ctx: {
      ...regression([num('a')], { model: 'random_forest' }),
      runs: [
        run({
          id: 'b',
          modelNode: 'n8',
          algorithm: 'linear_regression',
          baseline: true,
          validationScore: 1,
        }),
        run({ validationScore: 1.05 }),
      ],
    },
    count: 1,
  },
  {
    rule: 'R03',
    label: 'better than the baseline',
    ctx: {
      ...regression([num('a')], { model: 'random_forest' }),
      runs: [
        run({
          id: 'b',
          modelNode: 'n8',
          algorithm: 'linear_regression',
          baseline: true,
          validationScore: 1,
        }),
        run({ validationScore: 0.8 }),
      ],
    },
    count: 0,
  },
  {
    rule: 'R09',
    label: 'a validated model and an unused test set',
    ctx: { ...regression([num('a')], { model: 'random_forest' }), runs: [run()] },
    count: 1,
  },
  {
    rule: 'R09',
    label: 'the test set was used',
    ctx: { ...regression([num('a')], { model: 'random_forest' }), runs: [run()], testUsed: true },
    count: 0,
  },
  // M09 and M10: the browser engine is slow for some jobs
  {
    rule: 'M09',
    label: 'a network that would take a while',
    ctx: withModel(regression([num('a')], { model: 'mlp' }, { rows: 100000 }), { epochs: 100 }),
    count: 1,
  },
  {
    rule: 'M09',
    label: '1.6 million row-epochs is the boundary',
    ctx: withModel(regression([num('a')], { model: 'mlp' }, { rows: 16000 }), { epochs: 100 }),
    count: 0,
  },
  {
    rule: 'M09',
    label: 'on the local companion it is fast',
    ctx: (() => {
      const c = withModel(regression([num('a')], { model: 'mlp' }, { rows: 100000 }), {
        epochs: 100,
      });
      return { ...c, settings: { ...c.settings, engine: 'companion' as const } };
    })(),
    count: 0,
  },
  {
    rule: 'M10',
    label: '200,001 rows',
    ctx: regression([num('a')], { model: 'random_forest' }, { rows: 200001 }),
    count: 1,
  },
  {
    rule: 'M10',
    label: '200,000 rows is the boundary',
    ctx: regression([num('a')], { model: 'random_forest' }, { rows: 200000 }),
    count: 0,
  },
  // R05 to R07: how an iterative fit went
  {
    rule: 'R05',
    label: 'the loss became invalid',
    ctx: {
      ...regression([num('a')], { model: 'mlp' }),
      runs: [
        run({
          algorithm: 'mlp',
          status: 'failed',
          errorCode: 'E_NAN_LOSS',
          trainScore: null,
          validationScore: null,
          settings: { learning_rate: null },
        }),
      ],
    },
    count: 1,
  },
  {
    rule: 'R05',
    label: 'the loss rose over five epochs',
    ctx: {
      ...regression([num('a')], { model: 'mlp' }),
      runs: [
        run({
          algorithm: 'mlp',
          trainLoss: [1, 1.1, 1.3, 1.6, 2.0],
          settings: { learning_rate: null },
        }),
      ],
    },
    count: 1,
  },
  {
    rule: 'R05',
    label: 'a loss that keeps falling',
    ctx: {
      ...regression([num('a')], { model: 'mlp' }),
      runs: [
        run({ algorithm: 'mlp', trainLoss: falling(2, 1), settings: { learning_rate: null } }),
      ],
    },
    count: 0,
  },
  {
    rule: 'R06',
    label: 'all epochs used and still falling',
    ctx: {
      ...regression([num('a')], { model: 'mlp' }),
      runs: [
        run({
          algorithm: 'mlp',
          stopped: 'max_epochs',
          validationLoss: falling(2, 1),
          settings: { epochs: null },
        }),
      ],
    },
    count: 1,
  },
  {
    rule: 'R06',
    label: 'stopped early on purpose',
    ctx: {
      ...regression([num('a')], { model: 'mlp' }),
      runs: [
        run({
          algorithm: 'mlp',
          stopped: 'early_stop',
          validationLoss: falling(2, 1),
          settings: { epochs: null },
        }),
      ],
    },
    count: 0,
  },
  {
    rule: 'R06',
    label: 'all epochs used but the loss has levelled off',
    ctx: {
      ...regression([num('a')], { model: 'mlp' }),
      runs: [
        run({
          algorithm: 'mlp',
          stopped: 'max_epochs',
          validationLoss: [1, 1, 1, 1, 1, 1],
          settings: { epochs: null },
        }),
      ],
    },
    count: 0,
  },
  {
    rule: 'R07',
    label: 'validation loss rising while training loss falls',
    ctx: {
      ...regression([num('a')], { model: 'mlp' }),
      runs: [
        run({
          algorithm: 'mlp',
          stopped: 'max_epochs',
          trainLoss: falling(1, 0.2),
          validationLoss: [1, 0.8, 0.7, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95],
          settings: { early_stopping: null, l2: null },
        }),
      ],
    },
    count: 1,
  },
  {
    rule: 'R07',
    label: 'already stopped early',
    ctx: {
      ...regression([num('a')], { model: 'mlp' }),
      runs: [
        run({
          algorithm: 'mlp',
          stopped: 'early_stop',
          trainLoss: falling(1, 0.2),
          validationLoss: [1, 0.8, 0.7, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95],
          settings: { early_stopping: null, l2: null },
        }),
      ],
    },
    count: 0,
  },
  {
    rule: 'R05',
    label: 'a run from before the steps ahead of the model changed',
    ctx: {
      ...regression([num('a')], { model: 'mlp' }),
      hashes: { n9: 'new' },
      runs: [
        run({
          algorithm: 'mlp',
          status: 'failed',
          errorCode: 'E_NAN_LOSS',
          nodeHash: 'old',
          settings: { learning_rate: null },
        }),
      ],
    },
    count: 0,
  },
];

describe('rules: fires, does not fire, boundary', () => {
  for (const c of CASES) {
    it(`${c.rule}: ${c.label}`, () => {
      expect(fired(c.ctx, c.rule)).toHaveLength(c.count);
    });
  }

  it('has a case that fires and one that does not for every rule in the first release', () => {
    const ids = [
      'D01',
      'D03',
      'D04',
      'T01',
      'T04',
      'C01',
      'C02',
      'C04',
      'C05',
      'C06',
      'C07',
      'C08',
      'C09',
      'C12',
      'S01',
      'S02',
      'M01',
      'M04',
      'M05',
      'R01',
      'R03',
      'R09',
    ];
    for (const id of ids) {
      const mine = CASES.filter((c) => c.rule === id);
      expect(
        mine.some((c) => c.count > 0),
        `${id} never fires`,
      ).toBe(true);
      expect(
        mine.some((c) => c.count === 0),
        `${id} never stays quiet`,
      ).toBe(true);
    }
  });
});

describe('rules read the training rows after the split', () => {
  const cols = [num('a', { missing: 0, missingPct: 0 })];
  it('wait for the split: no statistic-based rule fires on the raw profile alone', () => {
    const ctx = regression([num('a', { missing: 500, missingPct: 0.5 })], {}, {}, { split: false });
    expect(
      evaluateRules(ctx).filter((s) =>
        ['C04', 'C05', 'C06', 'C08', 'C09', 'C12'].some((p) => s.ruleId.startsWith(p)),
      ),
    ).toEqual([]);
  });

  it('use the training profile, not the profile of the whole file', () => {
    const full = profileOf([num('a', { missing: 500, missingPct: 0.5 }), num('y')]);
    const train = profileOf([...cols, num('y')]);
    const pipeline = pipelineOf([
      { name: 'a', dtype: 'float' },
      { name: 'y', dtype: 'float', role: 'target' },
    ]);
    // Half of the whole file is empty, but none of the training rows are: nothing to fill.
    expect(fired(ctxOf(pipeline, full, { train }), 'C0')).toEqual([]);
  });

  it('are driven by the training rows even when the whole file looks fine', () => {
    const full = profileOf([num('a'), num('y')]);
    const train = profileOf([num('a', { missing: 200, missingPct: 0.2, skew: 0 }), num('y')]);
    const pipeline = pipelineOf([
      { name: 'a', dtype: 'float' },
      { name: 'y', dtype: 'float', role: 'target' },
    ]);
    const found = fired(ctxOf(pipeline, full, { train }), 'C05');
    expect(found).toHaveLength(1);
    expect(found[0]?.actions[0]?.patch[0]).toMatchObject({
      node: { params: { strategy: 'mean' } },
    });
  });
});

describe('suggestions explain themselves', () => {
  const sample = CASES.filter((c) => c.count > 0).flatMap((c) =>
    evaluateRules(c.ctx).filter((s) => s.ruleId.startsWith(c.rule)),
  );
  it('every suggestion has a message, a reason and evidence', () => {
    expect(sample.length).toBeGreaterThan(20);
    for (const s of sample) {
      expect(s.message.length, s.ruleId).toBeGreaterThan(10);
      expect(s.why.length, s.ruleId).toBeGreaterThan(20);
      expect(Object.keys(s.evidence).length, s.ruleId).toBeGreaterThan(0);
      expect(s.fingerprint.startsWith(s.ruleId), s.ruleId).toBe(true);
      expect(s.message + s.why, s.ruleId).not.toMatch(/\bplease\b|successfully|oops/i);
    }
  });
});

describe('applying a suggestion', () => {
  const actionable = CASES.filter((c) => c.count > 0).flatMap((c) =>
    evaluateRules(c.ctx)
      .filter((s) => s.ruleId.startsWith(c.rule))
      .flatMap((s) => s.actions.map((a) => ({ c, s, a }))),
  );

  it('has actions to test', () => {
    expect(actionable.length).toBeGreaterThan(20);
  });

  for (const { c, s, a } of actionable) {
    const name = `${s.ruleId} "${a.label}" (${c.label})`;
    it(`${name} leaves a valid pipeline`, () => {
      const before = validatePipeline(c.ctx.pipeline).issues.map((i) => i.code);
      const after = applyPatch(c.ctx.pipeline, a.patch);
      const codes = validatePipeline(after).issues.map((i) => i.code);
      // A patch may not add a hard error. (Some test pipelines are incomplete on purpose.)
      expect(codes.filter((code) => !before.includes(code))).toEqual([]);
    });

    it(`${name} does not trigger itself or anything else again`, () => {
      const pipeline = applyPatch(c.ctx.pipeline, a.patch);
      // Settings change, so earlier runs no longer describe the model.
      const next: RuleContext = { ...c.ctx, pipeline, runs: [] };
      const beforeIds = new Set(evaluateRules({ ...c.ctx, runs: [] }).map((x) => x.fingerprint));
      const again = evaluateRules(next);
      expect(again.filter((x) => x.fingerprint === s.fingerprint)).toEqual([]);
      // Nothing new appears as a direct result of the change.
      expect(again.filter((x) => !beforeIds.has(x.fingerprint)).map((x) => x.ruleId)).toEqual([]);
    });
  }
});
