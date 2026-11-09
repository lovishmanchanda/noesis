import type { ColumnProfile, DatasetProfile } from '@noesis/engine-client';
import { applyPatch, type PatchOp } from '@noesis/rules';
import { validatePipeline } from '@noesis/schema';
import { describe, expect, it } from 'vitest';
import { applyToProject } from '../src/pipeline/apply';
import { buildEarlyPipeline } from '../src/pipeline/build';
import { setColumnStep, setWholeStep, stepFor } from '../src/pipeline/prepare';
import { blockedReason } from '../src/state/gates';
import { initialProject, type ProjectState } from '../src/state/project';
import { suggestionsFor } from '../src/state/suggestions';

const col = (
  name: string,
  dtype: ColumnProfile['dtype'],
  extra: Partial<ColumnProfile> = {},
): ColumnProfile => ({
  name,
  dtype,
  missing: 0,
  missingPct: 0,
  unique: 100,
  uniquePct: 0.1,
  constant: false,
  idLike: false,
  ...extra,
});
const profileOf = (
  columns: ColumnProfile[],
  extra: Partial<DatasetProfile> = {},
): DatasetProfile => ({
  rows: 1000,
  columnCount: columns.length,
  duplicates: 0,
  memoryMB: 1,
  columns,
  ...extra,
});

const COLUMNS = [
  col('age', 'float', { missing: 100, missingPct: 0.1, skew: 1.2, outliers: 12 }),
  col('income', 'float', { missing: 50, missingPct: 0.05, skew: 0.1 }),
  col('city', 'category', { unique: 4 }),
  col('joined', 'datetime'),
  col('price', 'float'),
];

function project(patch: Partial<ProjectState> = {}): ProjectState {
  const raw = profileOf(COLUMNS, { duplicates: 30 });
  return {
    ...initialProject(),
    name: 'Homes',
    goal: 'number',
    dataset: { name: 'homes.csv', source: 'file', settings: {}, profile: raw },
    roles: {
      age: 'feature',
      income: 'feature',
      city: 'feature',
      joined: 'feature',
      price: 'target',
    },
    splitResult: { rows: { train: 700, validation: 150, test: 150 }, trainProfile: raw },
    ...patch,
  };
}

/** Node types and settings, without ids and without where a setting came from. */
const shape = (p: ReturnType<typeof buildEarlyPipeline>['pipeline']) =>
  p.nodes.map((n) => [
    n.type,
    n.fit_on ?? null,
    Object.fromEntries(Object.entries(n.params).map(([k, v]) => [k, v.value])),
  ]);

describe('steps per column', () => {
  const median = { strategy: 'median' };
  it('put columns with the same settings in one step', () => {
    let s = setColumnStep([], 'impute', 'a', median);
    s = setColumnStep(s, 'impute', 'b', median);
    expect(s).toHaveLength(1);
    expect(s[0]?.params['columns']?.value).toEqual(['a', 'b']);
  });

  it('keep columns with different settings apart', () => {
    let s = setColumnStep([], 'impute', 'a', median);
    s = setColumnStep(s, 'impute', 'b', { strategy: 'mean' });
    expect(s).toHaveLength(2);
  });

  it('move a column when its setting changes, and drop a step that ends up empty', () => {
    let s = setColumnStep([], 'impute', 'a', median);
    s = setColumnStep(s, 'impute', 'a', { strategy: 'mean' });
    expect(s).toHaveLength(1);
    expect(s[0]?.params['strategy']?.value).toBe('mean');
    expect(setColumnStep(s, 'impute', 'a', null)).toEqual([]);
  });

  it('find the step of a column', () => {
    const s = setColumnStep([], 'encode', 'city', { method: 'onehot' });
    expect(stepFor(s, 'encode', 'city')?.type).toBe('encode');
    expect(stepFor(s, 'impute', 'city')).toBeUndefined();
  });

  it('keep whole-table steps single', () => {
    let s = setWholeStep([], 'scale', { method: 'standard' });
    s = setWholeStep(s, 'scale', { method: 'minmax' });
    expect(s).toHaveLength(1);
    expect(setWholeStep(s, 'scale', null)).toEqual([]);
  });
});

describe('the pipeline with steps after the split', () => {
  it('puts each step after the split in its place, whatever order they were added in', () => {
    let prepare = setWholeStep([], 'scale', { method: 'standard' });
    prepare = setColumnStep(prepare, 'encode', 'city', { method: 'onehot' });
    prepare = setColumnStep(prepare, 'impute', 'age', { strategy: 'median' });
    const { pipeline, issues } = buildEarlyPipeline(project({ prepare }));
    expect(pipeline.nodes.map((n) => n.type)).toEqual([
      'load_csv',
      'split',
      'impute',
      'encode',
      'scale',
    ]);
    expect(issues).toEqual([]);
    for (const n of pipeline.nodes.slice(2)) expect(n.fit_on).toBe('train');
    expect(pipeline.nodes[3]?.inputs).toEqual([pipeline.nodes[2]?.id]);
  });

  it('uses the chosen metric', () => {
    expect(buildEarlyPipeline(project({ metric: 'mae' })).pipeline.task.primaryMetric).toBe('mae');
  });
});

describe('applying a suggestion to the project', () => {
  const patches: [string, PatchOp[]][] = [
    ['remove duplicates', [{ op: 'addNode', node: { type: 'drop_duplicates', params: {} } }]],
    [
      'remove rows without a target',
      [
        {
          op: 'addNode',
          node: { type: 'filter_rows', params: { column: 'price', operator: 'not_null' } },
        },
      ],
    ],
    [
      'remove a column',
      [{ op: 'addNode', node: { type: 'drop_columns', params: { columns: ['city'] } } }],
    ],
    ['leave a column out', [{ op: 'setColumnRole', column: 'city', role: 'exclude' }]],
    ['stratify', [{ op: 'setParam', node: 'n1', param: 'strategy', value: 'stratified' }]],
    [
      'split by time',
      [
        { op: 'setParam', node: 'n1', param: 'strategy', value: 'time' },
        { op: 'setParam', node: 'n1', param: 'timeColumn', value: 'joined' },
      ],
    ],
    ['change the metric', [{ op: 'setMetric', metric: 'mae' }]],
    [
      'fill',
      [
        {
          op: 'addNode',
          node: { type: 'impute', params: { columns: ['age'], strategy: 'median' } },
        },
      ],
    ],
    [
      'encode and scale',
      [
        {
          op: 'addNode',
          node: { type: 'encode', params: { columns: ['city'], method: 'onehot' } },
        },
        { op: 'addNode', node: { type: 'scale', params: { method: 'standard' } } },
      ],
    ],
  ];

  for (const [label, patch] of patches) {
    it(`gives the same pipeline as patching it directly: ${label}`, () => {
      const p = project();
      const direct = applyPatch(buildEarlyPipeline(p).pipeline, patch);
      const { changes } = applyToProject(p, patch);
      const rebuilt = buildEarlyPipeline({ ...p, ...changes }).pipeline;
      expect(shape(rebuilt)).toEqual(shape(direct));
      expect(validatePipeline(rebuilt).issues).toEqual([]);
    });
  }

  it('keeps the ids of steps it already has and gives new ones fresh ids', () => {
    const p = project({ prepare: setColumnStep([], 'impute', 'age', { strategy: 'median' }) });
    const first = p.prepare[0]?.id;
    const { changes } = applyToProject(p, [
      { op: 'addNode', node: { type: 'scale', params: { method: 'standard' } } },
    ]);
    expect(changes.prepare.map((s) => s.id)).toEqual([first, 'p2']);
  });

  it('marks what it writes as suggested', () => {
    const { changes } = applyToProject(project(), [
      { op: 'addNode', node: { type: 'impute', params: { columns: ['age'], strategy: 'median' } } },
    ]);
    expect(changes.prepare[0]?.params['strategy']?.source).toBe('suggested');
  });

  it('asks for the file to be read again when the separator changes', () => {
    const applied = applyToProject(project(), [
      { op: 'setParam', node: 'n0', param: 'delimiter', value: ';' },
    ]);
    expect(applied.reload).toBe(true);
    expect(applied.changes.loadSettings.delimiter).toBe(';');
    expect(applyToProject(project(), [{ op: 'setMetric', metric: 'mae' }]).reload).toBe(false);
  });
});

describe('suggestions in the app', () => {
  it('fire from the training profile and stop after being applied', () => {
    let p = project();
    const first = suggestionsFor(p, 'guided').find(
      (s) => s.ruleId.startsWith('C05') && s.target.name === 'age',
    );
    expect(first).toBeDefined();
    const action = first?.actions[0];
    const { changes } = applyToProject(p, action?.patch ?? []);
    p = { ...p, ...changes };
    const after = suggestionsFor(p, 'guided');
    expect(after.filter((s) => s.fingerprint === first?.fingerprint)).toEqual([]);
    // Applying the second fill must merge into the same step when the settings match.
    expect(p.prepare).toHaveLength(1);
  });

  it('give every applied action a project that no rule asks to fix again', () => {
    const base = project();
    const open = suggestionsFor(base, 'guided');
    expect(open.length).toBeGreaterThan(3);
    for (const s of open) {
      for (const a of s.actions) {
        const { changes } = applyToProject(base, a.patch);
        const next = suggestionsFor({ ...base, ...changes }, 'guided');
        expect(
          next.filter((x) => x.fingerprint === s.fingerprint),
          `${s.ruleId} / ${a.label}`,
        ).toEqual([]);
      }
    }
  });

  it('only show training-profile rules once the data is split', () => {
    const before = suggestionsFor(project({ splitResult: null }), 'guided');
    expect(before.some((s) => s.ruleId.startsWith('C05'))).toBe(false);
    expect(before.some((s) => s.ruleId.startsWith('D03'))).toBe(true);
  });
});

describe('gates for the new screens', () => {
  it('block Missing values until every column with empty cells is filled or removed', () => {
    expect(blockedReason('missing', project())).toMatch(
      /2 columns still have empty cells.*age.*income/,
    );
    let prepare = setColumnStep([], 'impute', 'age', { strategy: 'median' });
    expect(blockedReason('missing', project({ prepare }))).toMatch(
      /1 column still has empty cells.*income/,
    );
    prepare = setColumnStep(prepare, 'impute', 'income', { strategy: 'mean' });
    expect(blockedReason('missing', project({ prepare }))).toBeUndefined();
  });

  it('count a removed column as handled', () => {
    const p = project({
      prepare: setColumnStep([], 'impute', 'age', { strategy: 'median' }),
      tidy: { dropDuplicates: false, dropMissingTarget: false, dropColumns: ['income'] },
    });
    expect(blockedReason('missing', p)).toBeUndefined();
  });

  it('block Features while columns are still text or dates', () => {
    const output = profileOf([
      col('age', 'float'),
      col('city', 'category'),
      col('joined', 'datetime'),
      col('price', 'float'),
    ]);
    const p = project({
      splitResult: { rows: {}, trainProfile: profileOf(COLUMNS), outputProfile: output },
    });
    expect(blockedReason('features', p)).toMatch(/2 columns are still text or dates.*city.*joined/);
  });

  it('let Features through when every column is a number', () => {
    const output = profileOf([col('age', 'float'), col('city_a', 'float'), col('price', 'float')]);
    const p = project({
      splitResult: { rows: {}, trainProfile: profileOf(COLUMNS), outputProfile: output },
      roles: { age: 'feature', price: 'target', joined: 'exclude', city: 'exclude' },
    });
    expect(blockedReason('features', p)).toBeUndefined();
  });

  it('ask for the split first', () => {
    expect(blockedReason('missing', project({ splitResult: null }))).toBe('Make the split first.');
  });
});
