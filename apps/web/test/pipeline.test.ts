import type { ColumnProfile, DatasetProfile } from '@noesis/engine-client';
import { describe, expect, it } from 'vitest';
import { buildEarlyPipeline } from '../src/pipeline/build';
import { defaultRoles, targetProblem } from '../src/pipeline/guess';
import { blockedReason } from '../src/state/gates';
import { initialProject, type ProjectState } from '../src/state/project';

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
  uniquePct: 0.5,
  constant: false,
  idLike: false,
  ...extra,
});
const profile = (columns: ColumnProfile[], rows = 600): DatasetProfile => ({
  rows,
  columnCount: columns.length,
  duplicates: 0,
  memoryMB: 1,
  columns,
});

const COLUMNS = [
  col('id', 'int', { idLike: true, unique: 600 }),
  col('area', 'float'),
  col('city', 'category', { unique: 4 }),
  col('price', 'float'),
  col('expensive', 'int', { unique: 2 }),
];

function project(patch: Partial<ProjectState> = {}): ProjectState {
  const p = profile(COLUMNS);
  return {
    ...initialProject(),
    name: 'Homes',
    goal: 'number',
    dataset: { name: 'homes.csv', source: 'file', settings: {}, profile: p },
    roles: { ...defaultRoles(p), price: 'target', expensive: 'exclude' },
    ...patch,
  };
}

describe('pipeline builder', () => {
  it('builds a valid load and split pipeline', () => {
    const { pipeline, issues } = buildEarlyPipeline(project());
    expect(issues).toEqual([]);
    expect(pipeline.nodes.map((n) => n.type)).toEqual(['load_csv', 'split']);
    expect(pipeline.task).toEqual({ type: 'regression', primaryMetric: 'rmse' });
  });

  it('puts the steps that learn nothing before the split, in a fixed order', () => {
    const p = project({
      tidy: { dropDuplicates: true, dropMissingTarget: true, dropColumns: ['city'] },
    });
    const { pipeline, issues } = buildEarlyPipeline(p);
    expect(issues).toEqual([]);
    expect(pipeline.nodes.map((n) => n.type)).toEqual([
      'load_csv',
      'filter_rows',
      'drop_duplicates',
      'drop_columns',
      'split',
    ]);
    expect(pipeline.nodes.map((n) => n.id)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
    expect(pipeline.nodes[4]?.inputs).toEqual(['n3']);
    expect(pipeline.nodes[1]?.params['column']?.value).toBe('price');
  });

  it('writes load settings only when they differ from the defaults', () => {
    const plain = buildEarlyPipeline(project()).pipeline.nodes[0];
    expect(plain?.params).toEqual({});
    const custom = project({
      dataset: {
        name: 'x.csv',
        source: 'file',
        settings: { delimiter: ';', header: false, encoding: 'latin-1' },
        profile: profile(COLUMNS),
      },
    });
    expect(buildEarlyPipeline(custom).pipeline.nodes[0]?.params).toEqual({
      delimiter: { value: ';', source: 'user' },
      header: { value: false, source: 'user' },
      encoding: { value: 'latin-1', source: 'user' },
    });
  });

  it('records the roles and the data types', () => {
    const { pipeline } = buildEarlyPipeline(project());
    const byName = Object.fromEntries(pipeline.dataset.columns.map((c) => [c.name, c]));
    expect(byName['id']?.role).toBe('exclude');
    expect(byName['price']).toEqual({ name: 'price', dtype: 'float', role: 'target' });
  });

  it('builds a clustering pipeline with no target and a split of "none"', () => {
    const p = profile([
      col('cid', 'int', { idLike: true }),
      col('age', 'float'),
      col('spend', 'float'),
      col('segment', 'category', { unique: 4 }),
    ]);
    const built = buildEarlyPipeline(
      project({
        goal: 'groups',
        dataset: { name: 'c.csv', source: 'file', settings: {}, profile: p },
        roles: { cid: 'exclude', age: 'feature', spend: 'feature', segment: 'reference' },
        split: { ratios: [1, 0, 0], strategy: 'none', groupColumn: null, timeColumn: null },
      }),
    );
    expect(built.issues).toEqual([]);
    expect(built.pipeline.task.type).toBe('clustering');
    expect(built.pipeline.nodes[1]?.params['ratios']?.value).toEqual([1, 0, 0]);
  });

  it('passes the group and time columns to the split', () => {
    const grouped = buildEarlyPipeline(
      project({
        split: {
          ratios: [0.7, 0.15, 0.15],
          strategy: 'group',
          groupColumn: 'city',
          timeColumn: null,
        },
      }),
    );
    expect(grouped.issues).toEqual([]);
    expect(grouped.pipeline.nodes[1]?.params['groupColumn']?.value).toBe('city');
  });

  it('reports a pipeline that cannot be valid', () => {
    const { issues } = buildEarlyPipeline(project({ roles: defaultRoles(profile(COLUMNS)) }));
    expect(issues.map((i) => i.code)).toContain('E_TARGET');
  });

  it('needs a goal and a file', () => {
    expect(() => buildEarlyPipeline(initialProject())).toThrow(/goal/);
  });
});

describe('target checks', () => {
  const price = col('price', 'float');
  it('accepts a measured number for "a number" and a few classes for "a category"', () => {
    expect(targetProblem('number', price)).toBeNull();
    expect(targetProblem('category', col('label', 'int', { unique: 2 }))).toBeNull();
  });
  it('explains why a column does not fit', () => {
    expect(targetProblem('number', col('city', 'category', { unique: 4 }))).toMatch(/not numeric/);
    expect(targetProblem('number', col('label', 'int', { unique: 3 }))).toMatch(
      /only 3 different values/,
    );
    expect(targetProblem('category', price)).toMatch(/measured number/);
    expect(targetProblem('category', col('name', 'string', { unique: 500 }))).toMatch(
      /too many classes/,
    );
    expect(targetProblem('groups', price)).toMatch(/does not use a target/);
  });
  it('leaves identifier-like columns out by default', () => {
    expect(defaultRoles(profile(COLUMNS))).toMatchObject({ id: 'exclude', area: 'feature' });
  });
});

describe('screen gates', () => {
  it('asks for a name and a goal', () => {
    expect(blockedReason('project', initialProject())).toMatch(/what you want to find out/);
    expect(blockedReason('project', { ...initialProject(), name: ' ', goal: 'number' })).toMatch(
      /name/,
    );
    expect(blockedReason('project', project())).toBeUndefined();
  });
  it('needs a usable file', () => {
    expect(blockedReason('data', initialProject())).toMatch(/Add a CSV/);
    expect(
      blockedReason(
        'data',
        project({
          dataset: { name: 'x', source: 'file', settings: {}, profile: profile(COLUMNS, 20) },
        }),
      ),
    ).toMatch(/50 rows/);
    expect(
      blockedReason(
        'data',
        project({
          dataset: { name: 'x', source: 'file', settings: {}, profile: profile([col('a', 'int')]) },
        }),
      ),
    ).toMatch(/2 columns/);
  });
  it('needs a valid target, or enough columns for grouping', () => {
    expect(blockedReason('target', project({ roles: defaultRoles(profile(COLUMNS)) }))).toMatch(
      /Choose the column to predict/,
    );
    expect(
      blockedReason(
        'target',
        project({ roles: { ...defaultRoles(profile(COLUMNS)), city: 'target' } }),
      ),
    ).toMatch(/not numeric/);
    expect(blockedReason('target', project())).toBeUndefined();
    expect(
      blockedReason('target', project({ goal: 'groups', roles: { a: 'feature', b: 'exclude' } })),
    ).toMatch(/at least 2/);
  });
  it('checks the split settings', () => {
    expect(blockedReason('split', project())).toBeUndefined();
    expect(
      blockedReason(
        'split',
        project({
          split: {
            ratios: [0.7, 0.2, 0.2],
            strategy: 'random',
            groupColumn: null,
            timeColumn: null,
          },
        }),
      ),
    ).toMatch(/add up to 100%/);
    expect(
      blockedReason(
        'split',
        project({
          split: {
            ratios: [0.7, 0.15, 0.15],
            strategy: 'group',
            groupColumn: null,
            timeColumn: null,
          },
        }),
      ),
    ).toMatch(/identifies each group/);
    expect(
      blockedReason(
        'split',
        project({
          split: { ratios: [1, 0, 0], strategy: 'none', groupColumn: null, timeColumn: null },
        }),
      ),
    ).toBeUndefined();
  });
});
