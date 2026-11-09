import {
  modelNodes,
  nodesOfType,
  paramValue,
  percent,
  splitNode,
  splitStrategy,
  suggest,
  targetName,
  algorithmOf,
  bucket,
} from '../helpers';
import type { PatchOp, Rule } from '../types';
import { paramSpecs } from '@noesis/registry';

const SUPERVISED = ['regression', 'classification'] as const;
const RARE_CLASS_METRICS = ['f1', 'pr_auc', 'recall', 'balanced_accuracy'];

export const T01: Rule = {
  id: 'T01_target_missing',
  group: 'T',
  stage: 'target',
  severity: 'warn',
  priority: 80,
  appliesTo: SUPERVISED,
  uses: 'raw',
  evaluate(ctx) {
    const target = ctx.raw.target;
    const name = targetName(ctx.pipeline);
    if (!target || !name || target.missing === 0) return [];
    const handled = nodesOfType(ctx.pipeline, 'filter_rows').some(
      (n) => paramValue(n, 'column') === name && paramValue(n, 'operator') === 'not_null',
    );
    if (handled) return [];
    const share = target.missing / Math.max(1, ctx.raw.rows);
    return [
      suggest(T01, {
        target: { kind: 'column', name },
        message: `${target.missing} rows (${percent(share)}) have no value for "${name}", the column you want to predict.`,
        why: 'A model cannot learn from a row that has no answer. These rows would also make the final score meaningless.',
        evidence: { missing: target.missing, share },
        actions: [
          {
            label: 'Remove those rows',
            patch: [
              {
                op: 'addNode',
                node: { type: 'filter_rows', params: { column: name, operator: 'not_null' } },
              },
            ],
          },
        ],
        buckets: bucket(share, 0.1),
      }),
    ];
  },
};

export const T04: Rule = {
  id: 'T04_rare_class',
  group: 'T',
  stage: 'target',
  severity: 'warn',
  priority: 65,
  appliesTo: ['classification'],
  uses: 'raw',
  evaluate(ctx) {
    const target = ctx.raw.target;
    const name = targetName(ctx.pipeline);
    const share = target?.minorityShare;
    if (!target || !name || share === null || share === undefined) return [];
    if (share >= ctx.thresholds.T04.minorityShare || target.classes.length < 2) return [];

    const patch: PatchOp[] = [];
    const split = splitNode(ctx.pipeline);
    if (split && splitStrategy(ctx.pipeline) !== 'stratified')
      patch.push({ op: 'setParam', node: split.id, param: 'strategy', value: 'stratified' });
    if (!RARE_CLASS_METRICS.includes(ctx.pipeline.task.primaryMetric))
      patch.push({ op: 'setMetric', metric: 'f1' });
    for (const model of modelNodes(ctx.pipeline)) {
      const algorithm = algorithmOf(model);
      const hasWeights = algorithm && paramSpecs('model', algorithm, ctx.task)['class_weight'];
      if (hasWeights && paramValue(model, 'class_weight') !== 'balanced')
        patch.push({ op: 'setParam', node: model.id, param: 'class_weight', value: 'balanced' });
    }
    if (patch.length === 0) return [];
    const rare = target.classes.reduce((a, b) => (a.count <= b.count ? a : b));
    return [
      suggest(T04, {
        target: { kind: 'column', name },
        message: `The rarest class, "${rare.value}", is only ${percent(share)} of the rows.`,
        why: 'A model can look accurate by always guessing the common class. Keeping class shares equal in every part, and judging by F1 instead of accuracy, shows whether the rare class is found.',
        evidence: { minorityShare: share, rarestClass: rare.value },
        actions: [{ label: 'Balance the split and judge by F1', patch }],
        buckets: bucket(share, 0.05),
      }),
    ];
  },
};

export const TARGET_RULES: Rule[] = [T01, T04];
