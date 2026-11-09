import { featureColumns, splitNode, splitStrategy, suggest } from '../helpers';
import type { Rule } from '../types';

export const S01: Rule = {
  id: 'S01_keep_class_shares',
  group: 'S',
  stage: 'split',
  severity: 'tip',
  priority: 55,
  appliesTo: ['classification'],
  uses: 'none',
  evaluate(ctx) {
    const split = splitNode(ctx.pipeline);
    if (!split || splitStrategy(ctx.pipeline) !== 'random') return [];
    return [
      suggest(S01, {
        target: { kind: 'dataset' },
        message: 'The rows are split at random.',
        why: 'A stratified split keeps the share of each class the same in every part, so the validation and test scores are comparable to training.',
        evidence: { strategy: 'random' },
        actions: [
          {
            label: 'Keep class shares equal in every part',
            patch: [{ op: 'setParam', node: split.id, param: 'strategy', value: 'stratified' }],
          },
        ],
        buckets: 'random',
      }),
    ];
  },
};

export const S02: Rule = {
  id: 'S02_split_by_time',
  group: 'S',
  stage: 'split',
  severity: 'tip',
  priority: 60,
  appliesTo: ['regression', 'classification'],
  uses: 'raw',
  evaluate(ctx) {
    const split = splitNode(ctx.pipeline);
    if (!split || splitStrategy(ctx.pipeline) === 'time') return [];
    const limit = ctx.thresholds.S02.trend;
    const dated = featureColumns(ctx.raw, ctx.pipeline)
      .filter(
        (c) => c.dtype === 'datetime' && c.targetTrend !== null && c.targetTrend !== undefined,
      )
      .filter((c) => Math.abs(c.targetTrend as number) >= limit)
      .sort((a, b) => Math.abs(b.targetTrend as number) - Math.abs(a.targetTrend as number))[0];
    if (!dated) return [];
    const trend = dated.targetTrend as number;
    return [
      suggest(S02, {
        target: { kind: 'column', name: dated.name },
        message: `The target changes with "${dated.name}" (correlation ${trend.toFixed(2)}).`,
        why: 'When values drift over time, the model should be tested on later rows than it learned from. A random split would mix past and future and make the score look better than it will be in use.',
        evidence: { trend },
        actions: [
          {
            label: `Test on the latest rows, ordered by "${dated.name}"`,
            patch: [
              { op: 'setParam', node: split.id, param: 'strategy', value: 'time' },
              { op: 'setParam', node: split.id, param: 'timeColumn', value: dated.name },
            ],
          },
        ],
        buckets: trend > 0 ? 'up' : 'down',
      }),
    ];
  },
};

export const SPLIT_RULES: Rule[] = [S01, S02];
