import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  describePatch,
  evaluateRules,
  nextBestStep,
  visibleFor,
  type RuleContext,
  type StageInfo,
  type Suggestion,
} from '../src';
import { col, ctxOf, node, pipelineOf, profileOf } from './fixtures';

const cols = [
  { name: 'a', dtype: 'float' as const },
  { name: 'b', dtype: 'float' as const },
  { name: 'y', dtype: 'float' as const, role: 'target' as const },
];

function twoGaps(extra = {}): RuleContext {
  const profile = profileOf([
    col('a', 'float', { missing: 100, missingPct: 0.1, skew: 2 }),
    col('b', 'float', { missing: 50, missingPct: 0.05, skew: 0 }),
    col('y', 'float'),
  ]);
  return ctxOf(pipelineOf(cols), profile, { train: profile, ...extra });
}

describe('evaluating the rules', () => {
  it('gives the same answer for the same input', () => {
    expect(evaluateRules(twoGaps())).toEqual(evaluateRules(twoGaps()));
  });

  it('ranks the higher priority first', () => {
    const list = evaluateRules(twoGaps());
    const priorities = list.map((s) => s.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });

  it('skips rule groups the user switched off', () => {
    const ctx = twoGaps();
    ctx.settings = { ...ctx.settings, disabledGroups: ['C'] };
    expect(evaluateRules(ctx).filter((s) => s.ruleId.startsWith('C'))).toEqual([]);
  });

  it('skips rules that do not apply to the task', () => {
    const profile = profileOf([col('a', 'float'), col('y', 'float')], { duplicates: 100 });
    const pipeline = pipelineOf(
      [
        { name: 'a', dtype: 'float' },
        { name: 'y', dtype: 'float', role: 'target' },
      ],
      { task: 'classification' },
    );
    const ids = evaluateRules(ctxOf(pipeline, profile)).map((s) => s.ruleId);
    expect(ids).toContain('S01_keep_class_shares');
    expect(ids).not.toContain('C12_too_good_to_be_true');
  });

  it('can be told to change nothing: evaluating never edits the pipeline', () => {
    const ctx = twoGaps();
    const before = JSON.stringify(ctx.pipeline);
    evaluateRules(ctx);
    expect(JSON.stringify(ctx.pipeline)).toBe(before);
  });
});

describe('conflicts', () => {
  it('shows the lower-priority suggestion as an alternative when both edit the same setting', () => {
    const columns = [col('a', 'float'), col('y', 'category', { unique: 2 })];
    const profile = profileOf(columns, {
      target: {
        name: 'y',
        missing: 0,
        unique: 2,
        classes: [
          { value: 'a', count: 950 },
          { value: 'b', count: 50 },
        ],
        minorityShare: 0.05,
      },
    });
    const pipeline = pipelineOf(
      [
        { name: 'a', dtype: 'float' },
        { name: 'y', dtype: 'category', role: 'target' },
      ],
      { task: 'classification', metric: 'accuracy' },
    );
    const list = evaluateRules(ctxOf(pipeline, profile));
    const t04 = list.find((s) => s.ruleId.startsWith('T04'));
    const s01 = list.find((s) => s.ruleId.startsWith('S01'));
    expect(t04?.alternativeTo).toBeUndefined();
    expect(s01?.alternativeTo).toBe('T04_rare_class');
  });
});

describe('visibility, dismissal and noise', () => {
  const list = evaluateRules(twoGaps());
  const missing = list.filter((s) => s.stage === 'missing');

  it('shows only the suggestions of the screen', () => {
    const v = visibleFor(list, 'missing', new Set(), 'guided', 3);
    expect(v.open.every((s) => s.stage === 'missing')).toBe(true);
    expect(v.open).toHaveLength(missing.length);
  });

  it('hides a dismissed suggestion until its fingerprint changes', () => {
    const first = missing[0] as Suggestion;
    const v = visibleFor(list, 'missing', new Set([first.fingerprint]), 'guided', 3);
    expect(v.open.map((s) => s.fingerprint)).not.toContain(first.fingerprint);
    expect(v.dismissed.map((s) => s.fingerprint)).toContain(first.fingerprint);
  });

  it('brings a dismissed suggestion back when the evidence moves a lot', () => {
    const now = evaluateRules(twoGaps()).find(
      (s) => s.ruleId.startsWith('C05') && s.target.name === 'a',
    ) as Suggestion;
    const worse = profileOf([
      col('a', 'float', { missing: 350, missingPct: 0.35, skew: 2 }),
      col('b', 'float'),
      col('y', 'float'),
    ]);
    const later = evaluateRules(ctxOf(pipelineOf(cols), worse, { train: worse })).find(
      (s) => s.ruleId.startsWith('C05') && s.target.name === 'a',
    ) as Suggestion;
    expect(later.fingerprint).not.toBe(now.fingerprint);
    const v = visibleFor([later], 'missing', new Set([now.fingerprint]), 'guided', 3);
    expect(v.open).toHaveLength(1);
  });

  it('keeps a dismissed suggestion hidden for a small change in the evidence', () => {
    const slightly = profileOf([
      col('a', 'float', { missing: 105, missingPct: 0.105, skew: 2 }),
      col('b', 'float'),
      col('y', 'float'),
    ]);
    const a = list.find((s) => s.ruleId.startsWith('C05') && s.target.name === 'a') as Suggestion;
    const b = evaluateRules(ctxOf(pipelineOf(cols), slightly, { train: slightly })).find(
      (s) => s.ruleId.startsWith('C05') && s.target.name === 'a',
    ) as Suggestion;
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it('expands at most the limit and puts the rest under More', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      ...(missing[0] as Suggestion),
      fingerprint: `x${i}`,
    }));
    const v = visibleFor(many, 'missing', new Set(), 'guided', 3);
    expect(v.expanded).toHaveLength(3);
    expect(v.more).toHaveLength(4);
  });

  it('in Expert mode leaves tips and notes under More', () => {
    const tip: Suggestion = { ...(missing[0] as Suggestion), severity: 'tip', fingerprint: 't' };
    const warn: Suggestion = { ...(missing[0] as Suggestion), severity: 'warn', fingerprint: 'w' };
    const v = visibleFor([tip, warn], 'missing', new Set(), 'expert', 3);
    expect(v.expanded.map((s) => s.fingerprint)).toEqual(['w']);
    expect(v.more.map((s) => s.fingerprint)).toEqual(['t']);
  });
});

describe('next best step', () => {
  const stage = (id: StageInfo['id'], state: StageInfo['state'], required = true): StageInfo => ({
    id,
    required,
    state,
  });

  it('is the first required stage that is not done', () => {
    const result = nextBestStep(
      [stage('data', 'done'), stage('target', 'incomplete'), stage('split', 'todo')],
      [],
    );
    expect(result.next).toBe('target');
  });

  it('is null when every required stage is done', () => {
    expect(nextBestStep([stage('data', 'done')], []).next).toBeNull();
  });

  it('treats an outdated stage as not done', () => {
    expect(nextBestStep([stage('data', 'done'), stage('split', 'outdated')], []).next).toBe(
      'split',
    );
  });

  it('recommends an optional stage that has an open warning', () => {
    const warn = evaluateRules(twoGaps())[0] as Suggestion;
    const result = nextBestStep(
      [stage('split', 'done'), stage(warn.stage, 'todo', false)],
      [{ ...warn, severity: 'warn' }],
    );
    expect(result.recommended).toContain(warn.stage);
  });

  it('does not recommend a stage with only tips', () => {
    const tip = {
      ...(evaluateRules(twoGaps())[0] as Suggestion),
      severity: 'tip' as const,
      stage: 'explore' as const,
    };
    expect(nextBestStep([stage('explore', 'todo', false)], [tip]).recommended).toEqual([]);
  });

  it('reports why a stage is blocked', () => {
    const result = nextBestStep(
      [{ id: 'model', required: true, state: 'todo', blockedBy: 'Needs a split first.' }],
      [],
    );
    expect(result.blocked).toEqual({ model: 'Needs a split first.' });
  });
});

describe('patches', () => {
  const base = pipelineOf(cols);

  it('leave the original pipeline untouched', () => {
    const before = JSON.stringify(base);
    applyPatch(base, [
      { op: 'addNode', node: { type: 'impute', params: { columns: ['a'], strategy: 'median' } } },
    ]);
    expect(JSON.stringify(base)).toBe(before);
  });

  it('put each new step where its kind belongs, after the split for steps that learn', () => {
    let p = pipelineOf(cols, { extra: [node('n3', 'scale', { method: 'standard' })] });
    p = applyPatch(p, [
      { op: 'addNode', node: { type: 'impute', params: { columns: ['a'], strategy: 'median' } } },
    ]);
    expect(p.nodes.map((n) => n.type)).toEqual(['load_csv', 'split', 'impute', 'scale']);
    const impute = p.nodes.find((n) => n.type === 'impute');
    expect(impute?.fit_on).toBe('train');
    expect(p.nodes.find((n) => n.type === 'scale')?.inputs).toEqual([impute?.id]);
  });

  it('put a stateless step before the split', () => {
    const p = applyPatch(base, [{ op: 'addNode', node: { type: 'drop_duplicates', params: {} } }]);
    expect(p.nodes.map((n) => n.type)).toEqual(['load_csv', 'drop_duplicates', 'split']);
    expect(p.nodes[2]?.inputs).toEqual([p.nodes[1]?.id]);
  });

  it('mark settings they write as suggested', () => {
    const p = applyPatch(base, [{ op: 'setParam', node: 'n2', param: 'strategy', value: 'time' }]);
    expect(p.nodes[1]?.params['strategy']).toEqual({ value: 'time', source: 'suggested' });
  });

  it('add columns to an existing step of the same kind instead of a second one', () => {
    let p = applyPatch(base, [
      { op: 'addNode', node: { type: 'impute', params: { columns: ['a'], strategy: 'median' } } },
    ]);
    p = applyPatch(p, [
      { op: 'addNode', node: { type: 'impute', params: { columns: ['b'], strategy: 'median' } } },
    ]);
    expect(p.nodes.filter((n) => n.type === 'impute')).toHaveLength(1);
    expect(p.nodes.find((n) => n.type === 'impute')?.params['columns']?.value).toEqual(['a', 'b']);
  });

  it('keep steps with different settings apart', () => {
    let p = applyPatch(base, [
      { op: 'addNode', node: { type: 'impute', params: { columns: ['a'], strategy: 'median' } } },
    ]);
    p = applyPatch(p, [
      { op: 'addNode', node: { type: 'impute', params: { columns: ['b'], strategy: 'mean' } } },
    ]);
    expect(p.nodes.filter((n) => n.type === 'impute')).toHaveLength(2);
  });

  it('remove a step and reconnect its neighbours', () => {
    const p = pipelineOf(cols, {
      extra: [
        node('n3', 'impute', { columns: ['a'], strategy: 'median' }),
        node('n4', 'scale', { method: 'standard' }),
      ],
    });
    const out = applyPatch(p, [{ op: 'removeNode', node: 'n3' }]);
    expect(out.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n4']);
    expect(out.nodes[2]?.inputs).toEqual(['n2']);
  });

  it('change a column role and the metric', () => {
    const p = applyPatch(base, [
      { op: 'setColumnRole', column: 'a', role: 'exclude' },
      { op: 'setMetric', metric: 'mae' },
    ]);
    expect(p.dataset.columns.find((c) => c.name === 'a')?.role).toBe('exclude');
    expect(p.task.primaryMetric).toBe('mae');
  });

  it('refuse to edit a step or column that does not exist', () => {
    expect(() => applyPatch(base, [{ op: 'setParam', node: 'zzz', param: 'x', value: 1 }])).toThrow(
      /zzz/,
    );
    expect(() =>
      applyPatch(base, [{ op: 'setColumnRole', column: 'nope', role: 'exclude' }]),
    ).toThrow(/nope/);
  });

  it('are described in plain words for the preview', () => {
    const lines = describePatch(base, [
      { op: 'addNode', node: { type: 'impute', params: { columns: ['a'], strategy: 'median' } } },
      { op: 'setColumnRole', column: 'b', role: 'exclude' },
    ]);
    expect(lines).toEqual([
      'Add the step "Fill missing values" for a (median)',
      'Leave "b" out of the model',
    ]);
  });
});
