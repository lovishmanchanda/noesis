import { paramSpecs } from '@noesis/registry';
import type { NOESISPipeline, PipelineNode } from '@noesis/schema';
import { TREE_MODELS, algorithmOf, paramValue, suggest } from '../helpers';
import type { PatchOp, Rule, RuleContext, RunSummary, SuggestionAction } from '../types';

const eps = 1e-9;

/** True while the model step still has the settings the run was trained with. */
export function runIsCurrent(
  run: RunSummary,
  pipeline: NOESISPipeline,
  hashes?: Record<string, string>,
): PipelineNode | null {
  const node = pipeline.nodes.find((n) => n.id === run.modelNode && n.type === 'model');
  if (!node) return null;
  const now = hashes?.[run.modelNode];
  if (run.nodeHash !== undefined && now !== undefined && run.nodeHash !== now) return null;
  for (const [name, value] of Object.entries(run.settings)) {
    if (JSON.stringify(paramValue(node, name) ?? null) !== JSON.stringify(value ?? null))
      return null;
  }
  return node;
}

/** The newest run of each model step that is still current. */
function currentRuns(ctx: RuleContext): { run: RunSummary; node: PipelineNode }[] {
  const latest = new Map<string, RunSummary>();
  for (const run of ctx.runs) latest.set(run.modelNode, run);
  return [...latest.values()].flatMap((run) => {
    const node = runIsCurrent(run, ctx.pipeline, ctx.hashes);
    return node ? [{ run, node }] : [];
  });
}

/** The value of a model setting now: the one the user set, or the registry default. */
function currentSetting(node: PipelineNode, ctx: RuleContext, name: string): unknown {
  const set = paramValue(node, name);
  if (set !== undefined && set !== null) return set;
  return paramSpecs('model', algorithmOf(node), ctx.task)[name]?.default ?? null;
}

const gap = (run: RunSummary): number | null => {
  const { trainScore: t, validationScore: v } = run;
  if (t === null || v === null) return null;
  return run.higherIsBetter
    ? (t - v) / Math.max(Math.abs(t), eps)
    : (v - t) / Math.max(Math.abs(v), eps);
};

function overfitActions(node: PipelineNode, ctx: RuleContext): SuggestionAction[] {
  const algorithm = algorithmOf(node) ?? '';
  const specs = paramSpecs('model', algorithm, ctx.task);
  const action = (label: string, patch: PatchOp): SuggestionAction => ({ label, patch: [patch] });
  const out: SuggestionAction[] = [];
  if ((TREE_MODELS as readonly string[]).includes(algorithm)) {
    if (specs['max_depth']) {
      const depth = currentSetting(node, ctx, 'max_depth');
      const next = typeof depth === 'number' ? Math.max(2, Math.floor(depth * 0.6)) : 8;
      out.push(
        action(`Limit the depth to ${next}`, {
          op: 'setParam',
          node: node.id,
          param: 'max_depth',
          value: next,
        }),
      );
    }
    if (specs['min_samples_leaf']) {
      const leaf = Number(currentSetting(node, ctx, 'min_samples_leaf') ?? 1);
      const next = Math.max(5, leaf * 2);
      out.push(
        action(`Require at least ${next} rows per leaf`, {
          op: 'setParam',
          node: node.id,
          param: 'min_samples_leaf',
          value: next,
        }),
      );
    }
  } else if (algorithm === 'ridge' || algorithm === 'lasso') {
    const alpha = Number(currentSetting(node, ctx, 'alpha') ?? 1);
    out.push(
      action(`Raise the penalty to ${alpha * 10}`, {
        op: 'setParam',
        node: node.id,
        param: 'alpha',
        value: alpha * 10,
      }),
    );
  } else if (algorithm === 'logistic_regression' || algorithm === 'svm') {
    const c = Number(currentSetting(node, ctx, 'C') ?? 1);
    out.push(
      action(`Lower C to ${c / 10}`, { op: 'setParam', node: node.id, param: 'C', value: c / 10 }),
    );
  } else if (algorithm === 'mlp') {
    if (specs['early_stopping'] && currentSetting(node, ctx, 'early_stopping') !== true)
      out.push(
        action('Stop early when the validation score stops improving', {
          op: 'setParam',
          node: node.id,
          param: 'early_stopping',
          value: true,
        }),
      );
    if (specs['l2']) {
      const l2 = Number(currentSetting(node, ctx, 'l2') ?? 0.0001);
      out.push(
        action(`Raise the penalty to ${l2 * 10}`, {
          op: 'setParam',
          node: node.id,
          param: 'l2',
          value: l2 * 10,
        }),
      );
    }
  }
  return out;
}

export const R01: Rule = {
  id: 'R01_overfitting',
  group: 'R',
  stage: 'compare',
  severity: 'warn',
  priority: 75,
  appliesTo: ['regression', 'classification'],
  uses: 'none',
  evaluate(ctx) {
    return currentRuns(ctx).flatMap(({ run, node }) => {
      const g = gap(run);
      if (g === null || g <= ctx.thresholds.R01.gap) return [];
      return [
        suggest(R01, {
          target: { kind: 'run', name: run.id },
          message: `The model scored ${run.trainScore?.toFixed(3)} on the rows it learned from but ${run.validationScore?.toFixed(3)} on new rows (${run.metric}).`,
          why: 'A model that does much better on its own training rows than on rows it has not seen has memorised details instead of learning patterns. Making it simpler, or giving it more rows, usually closes the gap.',
          evidence: {
            train: run.trainScore,
            validation: run.validationScore,
            gap: g,
            algorithm: run.algorithm,
          },
          actions: overfitActions(node, ctx),
          buckets: String(Math.floor(g * 10) / 10),
        }),
      ];
    });
  },
};

export const R03: Rule = {
  id: 'R03_not_better_than_baseline',
  group: 'R',
  stage: 'compare',
  severity: 'warn',
  priority: 70,
  appliesTo: ['regression', 'classification'],
  uses: 'none',
  evaluate(ctx) {
    const baselines = ctx.runs.filter((r) => r.baseline && r.validationScore !== null);
    if (baselines.length === 0) return [];
    const best = baselines.reduce((a, b) =>
      (
        a.higherIsBetter
          ? (a.validationScore as number) >= (b.validationScore as number)
          : (a.validationScore as number) <= (b.validationScore as number)
      )
        ? a
        : b,
    );
    const base = best.validationScore as number;
    return currentRuns(ctx).flatMap(({ run }) => {
      if (run.baseline || run.validationScore === null) return [];
      const better = run.higherIsBetter ? run.validationScore - base : base - run.validationScore;
      if (better > ctx.thresholds.R03.margin) return [];
      return [
        suggest(R03, {
          target: { kind: 'run', name: run.id },
          message: `This ${run.algorithm.replaceAll('_', ' ')} model does not beat the simple ${best.algorithm.replaceAll('_', ' ')} model.`,
          why: 'A more complex model is only worth its cost if it scores better on rows it has not seen. Here the simple one does as well or better, so it is the safer pick.',
          evidence: { score: run.validationScore, baseline: base, metric: run.metric },
          buckets: run.algorithm,
        }),
      ];
    });
  },
};

export const R09: Rule = {
  id: 'R09_ready_for_test',
  group: 'R',
  stage: 'compare',
  severity: 'info',
  priority: 30,
  appliesTo: ['regression', 'classification'],
  uses: 'none',
  evaluate(ctx) {
    if (ctx.testUsed) return [];
    const ready = currentRuns(ctx).find(({ run }) => run.validationScore !== null);
    if (!ready) return [];
    return [
      suggest(R09, {
        target: { kind: 'run', name: ready.run.id },
        message: 'A validated model is ready for the final test.',
        why: 'The test rows give one honest score on data the model has never seen. Use them once, when you have chosen your model.',
        evidence: { algorithm: ready.run.algorithm },
        goTo: 'test',
        buckets: 'ready',
      }),
    ];
  },
};

const sliceEnd = (values: number[] | undefined, n: number): number[] => (values ?? []).slice(-n);
const rel = (a: number, b: number): number => (b - a) / Math.max(Math.abs(a), eps);

/** Lowers a model's learning rate tenfold, if it has one. */
function lowerRate(node: PipelineNode, ctx: RuleContext): SuggestionAction[] {
  const specs = paramSpecs('model', algorithmOf(node), ctx.task);
  if (!specs['learning_rate']) return [];
  const rate = Number(currentSetting(node, ctx, 'learning_rate') ?? 0.001);
  const next = Number((rate / 10).toPrecision(2));
  return [
    {
      label: `Lower the learning rate to ${next}`,
      patch: [{ op: 'setParam', node: node.id, param: 'learning_rate', value: next }],
    },
  ];
}

export const R05: Rule = {
  id: 'R05_loss_diverged',
  group: 'R',
  stage: 'train',
  severity: 'warn',
  priority: 80,
  appliesTo: ['regression', 'classification'],
  uses: 'none',
  evaluate(ctx) {
    const { window, rise } = ctx.thresholds.R05;
    return currentRuns(ctx).flatMap(({ run, node }) => {
      const failed = run.status === 'failed' && run.errorCode === 'E_NAN_LOSS';
      const losses = sliceEnd(run.trainLoss, window);
      const rising =
        losses.length === window && rel(losses[0] as number, losses[window - 1] as number) > rise;
      if (!failed && !rising) return [];
      return [
        suggest(R05, {
          target: { kind: 'run', name: run.id },
          message: failed
            ? 'The training loss became invalid, so the run stopped.'
            : `The training loss rose over the last ${window} epochs instead of falling.`,
          why: 'A learning rate that is too high makes each step overshoot, so the model gets worse instead of better. A lower rate takes smaller steps. Scaling the number columns also helps.',
          evidence: { epochs: losses.length, ...(failed ? { error: run.errorCode ?? null } : {}) },
          actions: lowerRate(node, ctx),
          buckets: failed ? 'nan' : 'rising',
        }),
      ];
    });
  },
};

export const R06: Rule = {
  id: 'R06_not_converged',
  group: 'R',
  stage: 'train',
  severity: 'tip',
  priority: 60,
  appliesTo: ['regression', 'classification'],
  uses: 'none',
  evaluate(ctx) {
    const { window, stillFalling } = ctx.thresholds.R06;
    return currentRuns(ctx).flatMap(({ run, node }) => {
      if (run.stopped !== 'max_epochs') return [];
      const losses = sliceEnd(run.validationLoss ?? run.trainLoss, window);
      if (
        losses.length < window ||
        rel(losses[0] as number, losses[window - 1] as number) > -stillFalling
      )
        return [];
      const specs = paramSpecs('model', algorithmOf(node), ctx.task);
      const name = specs['epochs'] ? 'epochs' : specs['max_iter'] ? 'max_iter' : null;
      if (!name) return [];
      const now = Number(currentSetting(node, ctx, name) ?? 100);
      return [
        suggest(R06, {
          target: { kind: 'run', name: run.id },
          message: `The model used all ${now} ${name === 'epochs' ? 'epochs' : 'steps'} while the loss was still falling.`,
          why: 'Training stopped because it ran out of steps, not because it had learned all it could. More steps may improve the score.',
          evidence: { [name]: now },
          actions: [
            {
              label: `Allow ${now * 2} ${name === 'epochs' ? 'epochs' : 'steps'}`,
              patch: [{ op: 'setParam', node: node.id, param: name, value: now * 2 }],
            },
          ],
          buckets: 'more-steps',
        }),
      ];
    });
  },
};

export const R07: Rule = {
  id: 'R07_validation_loss_rising',
  group: 'R',
  stage: 'train',
  severity: 'warn',
  priority: 72,
  appliesTo: ['regression', 'classification'],
  uses: 'none',
  evaluate(ctx) {
    const { window, valRise } = ctx.thresholds.R07;
    return currentRuns(ctx).flatMap(({ run, node }) => {
      const val = run.validationLoss ?? [];
      const train = sliceEnd(run.trainLoss, window);
      if (val.length < window || train.length < window) return [];
      const best = Math.min(...val);
      const rising = rel(best, val[val.length - 1] as number) > valRise;
      const trainFalling = (train[window - 1] as number) < (train[0] as number);
      if (!rising || !trainFalling || run.stopped === 'early_stop') return [];
      const specs = paramSpecs('model', algorithmOf(node), ctx.task);
      const actions: SuggestionAction[] = [];
      if (specs['early_stopping'] && currentSetting(node, ctx, 'early_stopping') !== true)
        actions.push({
          label: 'Stop early when the validation loss stops improving',
          patch: [{ op: 'setParam', node: node.id, param: 'early_stopping', value: true }],
        });
      if (specs['l2']) {
        const l2 = Number(currentSetting(node, ctx, 'l2') ?? 0.0001);
        actions.push({
          label: `Raise the penalty to ${l2 * 10}`,
          patch: [{ op: 'setParam', node: node.id, param: 'l2', value: l2 * 10 }],
        });
      }
      return [
        suggest(R07, {
          target: { kind: 'run', name: run.id },
          message:
            'The loss on new rows started rising while the loss on training rows kept falling.',
          why: 'This is the sign of memorising: after some epoch the model gets better at the rows it has seen and worse at rows it has not. Stopping at the best epoch keeps what it learned and drops what it memorised.',
          evidence: { bestLoss: best, lastLoss: val[val.length - 1] ?? null },
          actions,
          buckets: 'rising',
        }),
      ];
    });
  },
};

export const RUN_RULES: Rule[] = [R01, R03, R05, R06, R07, R09];
