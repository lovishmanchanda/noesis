import type { ColumnProfile } from '@noesis/engine-client';
import {
  bucket,
  covers,
  featureColumns,
  isDropped,
  isNumeric,
  isTextual,
  nodesOfType,
  paramValue,
  percent,
  roleOf,
  suggest,
} from '../helpers';
import type { Rule, RuleContext, Suggestion } from '../types';

const ALL = ['regression', 'classification', 'clustering', 'forecasting'] as const;
const SUPERVISED = ['regression', 'classification'] as const;

function perColumn(
  ctx: RuleContext,
  profile: 'raw' | 'train',
  make: (column: ColumnProfile) => Suggestion | null,
): Suggestion[] {
  const source = profile === 'train' ? ctx.train : ctx.raw;
  if (!source) return [];
  return featureColumns(source, ctx.pipeline).flatMap((c) => {
    const s = make(c);
    return s ? [s] : [];
  });
}

export const C01: Rule = {
  id: 'C01_looks_like_id',
  group: 'C',
  stage: 'target',
  severity: 'warn',
  priority: 70,
  appliesTo: ALL,
  uses: 'raw',
  evaluate(ctx) {
    const pattern = new RegExp(ctx.thresholds.C01.namePattern, 'i');
    return perColumn(ctx, 'raw', (c) => {
      const text = c.dtype === 'int' || c.dtype === 'string' || c.dtype === 'category';
      const mostlyUnique = c.uniquePct > ctx.thresholds.C01.uniqueShare;
      if (!text || !mostlyUnique || !(pattern.test(c.name) || c.uniquePct >= 1)) return null;
      return suggest(C01, {
        target: { kind: 'column', name: c.name },
        message: `"${c.name}" looks like an identifier: almost every row has a different value.`,
        why: 'A column that is different on every row cannot help predict a new row. It only lets the model memorise the rows it has seen.',
        evidence: { uniquePct: c.uniquePct, unique: c.unique },
        actions: [
          {
            label: 'Leave it out',
            patch: [{ op: 'setColumnRole', column: c.name, role: 'exclude' }],
          },
        ],
        buckets: 'id',
      });
    });
  },
};

export const C02: Rule = {
  id: 'C02_constant_column',
  group: 'C',
  stage: 'tidy',
  severity: 'warn',
  priority: 55,
  appliesTo: ALL,
  uses: 'raw',
  evaluate(ctx) {
    return perColumn(ctx, 'raw', (c) => {
      if (c.unique > 1 || c.missingPct >= 1) return null;
      return suggest(C02, {
        target: { kind: 'column', name: c.name },
        message: `"${c.name}" has the same value on every row.`,
        why: 'A column that never changes carries no information for the model.',
        evidence: { unique: c.unique },
        actions: [
          {
            label: 'Remove the column',
            patch: [
              { op: 'addNode', node: { type: 'drop_columns', params: { columns: [c.name] } } },
            ],
          },
        ],
        buckets: 'constant',
      });
    });
  },
};

const fillStrategy = (c: ColumnProfile, skewLimit: number): 'median' | 'mean' | 'most_frequent' =>
  isNumeric(c) ? (Math.abs(c.skew ?? 0) > skewLimit ? 'median' : 'mean') : 'most_frequent';

const strategyWhy = (strategy: string): string =>
  strategy === 'median'
    ? 'The median is a safe choice when a few values are very large or very small.'
    : strategy === 'mean'
      ? 'The values are fairly balanced, so the average is a fair stand-in for a missing value.'
      : 'The most common value is the usual stand-in for a missing category.';

const strategyName = (s: string): string =>
  ({ median: 'the median', mean: 'the average', most_frequent: 'the most common value' })[s] ?? s;

export const C04: Rule = {
  id: 'C04_mostly_missing',
  group: 'C',
  stage: 'missing',
  severity: 'warn',
  priority: 75,
  appliesTo: ALL,
  uses: 'train',
  evaluate(ctx) {
    return perColumn(ctx, 'train', (c) => {
      if (c.missingPct <= ctx.thresholds.C04.missingShare || c.dtype === 'datetime') return null;
      if (covers(ctx.pipeline, 'impute', c.name)) return null;
      const strategy = fillStrategy(c, ctx.thresholds.C05.skewForMedian);
      return suggest(C04, {
        target: { kind: 'column', name: c.name },
        message: `${percent(c.missingPct)} of "${c.name}" is missing in the training rows.`,
        why: 'When most of a column is empty, filling it invents most of its values. Dropping it, or filling it and adding a was-missing marker so the model knows which values were invented, are the two honest options.',
        evidence: { missingPct: c.missingPct, missing: c.missing },
        actions: [
          {
            label: 'Remove the column',
            patch: [
              { op: 'addNode', node: { type: 'drop_columns', params: { columns: [c.name] } } },
            ],
          },
          {
            label: `Fill with ${strategyName(strategy)} and add a was-missing marker`,
            patch: [
              {
                op: 'addNode',
                node: {
                  type: 'impute',
                  params: { columns: [c.name], strategy, addMissingIndicator: true },
                },
              },
            ],
          },
        ],
        buckets: bucket(c.missingPct, 0.1),
      });
    });
  },
};

function fillRule(
  rule: Rule,
  applies: (c: ColumnProfile) => boolean,
): (ctx: RuleContext) => Suggestion[] {
  return (ctx) =>
    perColumn(ctx, 'train', (c) => {
      if (!applies(c) || c.missingPct <= 0 || c.missingPct > ctx.thresholds.C04.missingShare)
        return null;
      if (covers(ctx.pipeline, 'impute', c.name)) return null;
      const strategy = fillStrategy(c, ctx.thresholds.C05.skewForMedian);
      return suggest(rule, {
        target: { kind: 'column', name: c.name },
        message: `${c.missing} rows (${percent(c.missingPct)}) of "${c.name}" are empty in the training rows.`,
        why: `Most models cannot use empty cells. Filling with ${strategyName(strategy)} keeps every row. ${strategyWhy(strategy)}`,
        evidence: { missingPct: c.missingPct, missing: c.missing, skew: c.skew ?? null },
        actions: [
          {
            label: `Fill with ${strategyName(strategy)}`,
            patch: [
              {
                op: 'addNode',
                node: { type: 'impute', params: { columns: [c.name], strategy } },
              },
            ],
          },
          {
            label: 'Remove the column',
            patch: [
              { op: 'addNode', node: { type: 'drop_columns', params: { columns: [c.name] } } },
            ],
          },
        ],
        buckets: bucket(c.missingPct, 0.1),
      });
    });
}

export const C05: Rule = {
  id: 'C05_some_missing_number',
  group: 'C',
  stage: 'missing',
  severity: 'warn',
  priority: 70,
  appliesTo: ALL,
  uses: 'train',
  evaluate: (ctx) => fillRule(C05, isNumeric)(ctx),
};

export const C06: Rule = {
  id: 'C06_some_missing_category',
  group: 'C',
  stage: 'missing',
  severity: 'warn',
  priority: 69,
  appliesTo: ALL,
  uses: 'train',
  evaluate: (ctx) => fillRule(C06, isTextual)(ctx),
};

export const C07: Rule = {
  id: 'C07_dates',
  group: 'C',
  stage: 'features',
  severity: 'tip',
  priority: 66,
  appliesTo: ALL,
  uses: 'train',
  evaluate(ctx) {
    return perColumn(ctx, 'train', (c) => {
      if (c.dtype !== 'datetime') return null;
      const used = nodesOfType(ctx.pipeline, 'derive_feature').some((n) => {
        const sources = paramValue(n, 'sourceColumns');
        return Array.isArray(sources) && sources.includes(c.name);
      });
      if (used) return null;
      const part = (datePart: string) => ({
        op: 'addNode' as const,
        node: {
          type: 'derive_feature' as const,
          params: {
            newName: `${c.name}_${datePart}`,
            kind: 'date_part',
            sourceColumns: [c.name],
            datePart,
          },
        },
      });
      return suggest(C07, {
        target: { kind: 'column', name: c.name },
        message: `"${c.name}" holds dates.`,
        why: 'Models cannot read a date as it is. Splitting it into year, month and weekday turns it into numbers a model can use, and the original date column is then left out.',
        evidence: { dtype: c.dtype },
        actions: [
          {
            label: 'Add year, month and weekday',
            patch: [
              part('year'),
              part('month'),
              part('weekday'),
              { op: 'setColumnRole', column: c.name, role: 'exclude' },
            ],
          },
        ],
        buckets: 'date',
      });
    });
  },
};

export const C08: Rule = {
  id: 'C08_few_categories',
  group: 'C',
  stage: 'features',
  severity: 'tip',
  priority: 64,
  appliesTo: ALL,
  uses: 'train',
  evaluate(ctx) {
    return perColumn(ctx, 'train', (c) => {
      if ((c.dtype !== 'category' && c.dtype !== 'string') || c.unique < 2) return null;
      if (c.unique > ctx.thresholds.C08.maxCategories) return null;
      if (covers(ctx.pipeline, 'encode', c.name)) return null;
      return suggest(C08, {
        target: { kind: 'column', name: c.name },
        message: `"${c.name}" holds text with ${c.unique} different values.`,
        why: 'Models need numbers. One-hot encoding turns each value into its own yes-or-no column, which suits a column with few values.',
        evidence: { unique: c.unique },
        actions: [
          {
            label: 'Turn into yes-or-no columns',
            patch: [
              {
                op: 'addNode',
                node: { type: 'encode', params: { columns: [c.name], method: 'onehot' } },
              },
            ],
          },
        ],
        buckets: 'few',
      });
    });
  },
};

export const C09: Rule = {
  id: 'C09_many_categories',
  group: 'C',
  stage: 'features',
  severity: 'warn',
  priority: 72,
  appliesTo: ALL,
  uses: 'train',
  evaluate(ctx) {
    return perColumn(ctx, 'train', (c) => {
      if (c.dtype !== 'category' && c.dtype !== 'string') return null;
      if (c.unique <= ctx.thresholds.C09.minCategories) return null;
      if (covers(ctx.pipeline, 'encode', c.name)) return null;
      return suggest(C09, {
        target: { kind: 'column', name: c.name },
        message: `"${c.name}" holds text with ${c.unique} different values.`,
        why: 'One-hot encoding would add one column for each value, which makes the table very wide and slow. Replacing each value by how often it appears keeps a single column.',
        evidence: { unique: c.unique },
        actions: [
          {
            label: 'Replace each value by how often it appears',
            patch: [
              {
                op: 'addNode',
                node: { type: 'encode', params: { columns: [c.name], method: 'frequency' } },
              },
            ],
          },
          {
            label: 'Keep the 20 most common values as yes-or-no columns',
            patch: [
              {
                op: 'addNode',
                node: {
                  type: 'encode',
                  params: { columns: [c.name], method: 'onehot', maxCategories: 20 },
                },
              },
            ],
          },
        ],
        buckets: 'many',
      });
    });
  },
};

export const C12: Rule = {
  id: 'C12_too_good_to_be_true',
  group: 'C',
  stage: 'explore',
  severity: 'warn',
  priority: 85,
  appliesTo: SUPERVISED,
  uses: 'train',
  evaluate(ctx) {
    return perColumn(ctx, 'train', (c) => {
      const r = c.targetCorr;
      if (r === null || r === undefined || Math.abs(r) <= ctx.thresholds.C12.correlation)
        return null;
      if (roleOf(ctx.pipeline, c.name) !== 'feature' || isDropped(ctx.pipeline, c.name))
        return null;
      return suggest(C12, {
        target: { kind: 'column', name: c.name },
        message: `"${c.name}" and the target move almost together (correlation ${r.toFixed(2)}).`,
        why: 'A column that tracks the answer this closely is often something that is only known after the answer is. If it will not be available when you predict a new row, the model will look excellent here and fail in use.',
        evidence: { correlation: r },
        actions: [
          {
            label: 'Leave it out',
            patch: [{ op: 'setColumnRole', column: c.name, role: 'exclude' }],
          },
        ],
        buckets: 'leak',
      });
    });
  },
};

export const COLUMN_RULES: Rule[] = [C01, C02, C04, C05, C06, C07, C08, C09, C12];
