import {
  BASELINES,
  paramValue,
  SCALE_SENSITIVE,
  algorithmOf,
  modelNodes,
  nodesOfType,
  suggest,
  upstream,
} from '../helpers';
import type { Rule } from '../types';

const has = (list: readonly string[], value: string | undefined): boolean =>
  value !== undefined && list.includes(value);

export const M01: Rule = {
  id: 'M01_needs_scaling',
  group: 'M',
  stage: 'model',
  severity: 'warn',
  priority: 68,
  appliesTo: ['regression', 'classification', 'clustering', 'forecasting'],
  uses: 'none',
  evaluate(ctx) {
    const scaled = (id: string): boolean =>
      upstream(ctx.pipeline, id).some((n) => n.type === 'scale');
    const needy = modelNodes(ctx.pipeline).filter(
      (m) => has(SCALE_SENSITIVE, algorithmOf(m)) && !scaled(m.id),
    );
    const first = needy[0];
    if (!first) return [];
    const algorithm = algorithmOf(first) as string;
    return [
      suggest(M01, {
        target: { kind: 'model', name: first.id },
        message: `A ${algorithm.replaceAll('_', ' ')} model is sensitive to the size of the numbers.`,
        why: 'A column measured in thousands outweighs a column measured in fractions unless both are put on the same scale. Without scaling, the model leans on whichever column has the biggest numbers.',
        evidence: { algorithm },
        actions: [
          {
            label: 'Put the number columns on the same scale',
            patch: [{ op: 'addNode', node: { type: 'scale', params: { method: 'standard' } } }],
          },
        ],
        buckets: algorithm,
      }),
    ];
  },
};

export const M04: Rule = {
  id: 'M04_no_baseline',
  group: 'M',
  stage: 'model',
  severity: 'tip',
  priority: 40,
  appliesTo: ['regression', 'classification'],
  uses: 'none',
  evaluate(ctx) {
    const model = modelNodes(ctx.pipeline)[0];
    if (!model || ctx.runs.some((r) => r.baseline)) return [];
    const algorithm = algorithmOf(model);
    if (!algorithm || has(BASELINES, algorithm)) return [];
    const baseline = ctx.task === 'classification' ? 'logistic_regression' : 'linear_regression';
    // The baseline is a linear model, which needs scaled columns (rule M01), so scale in the same step.
    const scaled = upstream(ctx.pipeline, model.id).some((n) => n.type === 'scale');
    return [
      suggest(M04, {
        target: { kind: 'model', name: model.id },
        message: 'No simple model has been tried yet.',
        why: 'A plain linear model sets the bar. Without it, you cannot tell whether a more complex model is earning its extra cost.',
        evidence: { algorithm },
        actions: [
          {
            label: `Run ${baseline.replaceAll('_', ' ')} first`,
            patch: [
              { op: 'setParam', node: model.id, param: 'algorithm', value: baseline },
              ...(scaled
                ? []
                : [
                    {
                      op: 'addNode' as const,
                      node: { type: 'scale' as const, params: { method: 'standard' } },
                    },
                  ]),
            ],
          },
        ],
        buckets: 'none',
      }),
    ];
  },
};

export const M05: Rule = {
  id: 'M05_neural_net_small_data',
  group: 'M',
  stage: 'model',
  severity: 'warn',
  priority: 66,
  appliesTo: ['regression', 'classification'],
  uses: 'raw',
  evaluate(ctx) {
    const model = nodesOfType(ctx.pipeline, 'model').find((m) => algorithmOf(m) === 'mlp');
    const rows = (ctx.train ?? ctx.raw).rows;
    if (!model || rows >= ctx.thresholds.M05.minRows) return [];
    return [
      suggest(M05, {
        target: { kind: 'model', name: model.id },
        message: `A neural network on ${rows} rows will probably overfit.`,
        why: 'Neural networks need a lot of examples to beat simpler models. With this little data, a random forest or a linear model is the safer choice.',
        evidence: { rows },
        actions: [
          {
            label: 'Use a random forest instead',
            patch: [{ op: 'setParam', node: model.id, param: 'algorithm', value: 'random_forest' }],
          },
        ],
        buckets: 'mlp-small',
      }),
    ];
  },
};

export const M09: Rule = {
  id: 'M09_slow_network_in_browser',
  group: 'M',
  stage: 'model',
  severity: 'tip',
  priority: 45,
  appliesTo: ['regression', 'classification'],
  uses: 'raw',
  evaluate(ctx) {
    if (ctx.settings.engine !== 'browser') return [];
    const model = nodesOfType(ctx.pipeline, 'model').find((m) => algorithmOf(m) === 'mlp');
    if (!model) return [];
    const rows = (ctx.train ?? ctx.raw).rows;
    const epochs = Number(paramValue(model, 'epochs') ?? 100);
    const rowEpochs = rows * epochs;
    if (rowEpochs <= ctx.thresholds.M09.rowEpochs) return [];
    const seconds = Math.round((rowEpochs / 80000 / 20) * 17);
    return [
      suggest(M09, {
        target: { kind: 'model', name: model.id },
        message: `Training this network on ${rows.toLocaleString('en-GB')} rows for ${epochs} epochs may take about ${seconds} seconds here.`,
        why: 'Neural networks run about seven times slower in the browser than in a desktop program. Fewer epochs, fewer rows, or a tree model such as a random forest gets to a similar score much faster.',
        evidence: { rows, epochs, estimatedSeconds: seconds },
        actions: [
          {
            label: 'Use a random forest instead',
            patch: [{ op: 'setParam', node: model.id, param: 'algorithm', value: 'random_forest' }],
          },
        ],
        buckets: String(Math.floor(rowEpochs / 1_600_000)),
      }),
    ];
  },
};

export const M10: Rule = {
  id: 'M10_forest_in_browser',
  group: 'M',
  stage: 'model',
  severity: 'info',
  priority: 30,
  appliesTo: ['regression', 'classification'],
  uses: 'raw',
  evaluate(ctx) {
    if (ctx.settings.engine !== 'browser') return [];
    const model = nodesOfType(ctx.pipeline, 'model').find(
      (m) => algorithmOf(m) === 'random_forest',
    );
    const rows = (ctx.train ?? ctx.raw).rows;
    if (!model || rows <= ctx.thresholds.M10.rows) return [];
    return [
      suggest(M10, {
        target: { kind: 'model', name: model.id },
        message: `A random forest on ${rows.toLocaleString('en-GB')} rows can take minutes here.`,
        why: 'The browser engine uses one processor core. A desktop program would spread the trees over all of them. You can keep working while it trains, and Stop works at any time.',
        evidence: { rows },
        buckets: 'forest-big',
      }),
    ];
  },
};

export const MODEL_RULES: Rule[] = [M01, M04, M05, M09, M10];
