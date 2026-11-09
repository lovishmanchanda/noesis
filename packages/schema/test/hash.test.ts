import { describe, expect, it } from 'vitest';
import { canonicalJson, nodeHashes, nodeStatuses, shortHash, type NOESISPipeline } from '../src';

const P = (value: unknown, source = 'user') => ({ value, source }) as never;

function pipeline(
  overrides: {
    impute?: Record<string, unknown>;
    seed?: number;
    split?: Record<string, unknown>;
  } = {},
): NOESISPipeline {
  return {
    schemaVersion: '0.1',
    project: { name: 'a', seed: overrides.seed ?? 1, mode: 'guided' },
    dataset: {
      source: { kind: 'local-file', name: 'x.csv' },
      rows: 100,
      columns: [
        { name: 'a', dtype: 'float', role: 'feature' },
        { name: 'b', dtype: 'float', role: 'feature' },
        { name: 'y', dtype: 'float', role: 'target' },
      ],
    },
    task: { type: 'regression', primaryMetric: 'rmse' },
    nodes: [
      { id: 'n1', type: 'load_csv', params: {} },
      {
        id: 'n2',
        type: 'split',
        inputs: ['n1'],
        params: Object.fromEntries(
          Object.entries({ strategy: 'random', ratios: [0.7, 0.15, 0.15], ...overrides.split }).map(
            ([k, v]) => [k, P(v)],
          ),
        ),
      },
      {
        id: 'n3',
        type: 'impute',
        fit_on: 'train',
        inputs: ['n2'],
        params: Object.fromEntries(
          Object.entries({ columns: ['a', 'b'], strategy: 'median', ...overrides.impute }).map(
            ([k, v]) => [k, P(v)],
          ),
        ),
      },
      {
        id: 'n4',
        type: 'scale',
        fit_on: 'train',
        inputs: ['n3'],
        params: { method: P('standard') },
      },
    ],
  } as unknown as NOESISPipeline;
}

const hashes = (p: NOESISPipeline, data = 'file1') => nodeHashes(p, data);

describe('node hashes', () => {
  it('are 64 hex characters and stable', async () => {
    const a = await hashes(pipeline());
    const b = await hashes(pipeline());
    expect(a).toEqual(b);
    expect(a['n1']).toMatch(/^[0-9a-f]{64}$/);
    expect(shortHash(a['n1'] as string)).toHaveLength(8);
  });

  it('do not change when a step is renamed', async () => {
    const original = await hashes(pipeline());
    const renamed = pipeline();
    renamed.nodes[2]!.id = 'fill';
    renamed.nodes[3]!.inputs = ['fill'];
    const after = await hashes(renamed);
    expect(after['fill']).toBe(original['n3']);
    expect(after['n4']).toBe(original['n4']);
  });

  it('do not change when only the source of a setting changes', async () => {
    const original = await hashes(pipeline());
    const changed = pipeline();
    changed.nodes[2]!.params['strategy'] = P('median', 'suggested');
    expect(await hashes(changed)).toEqual(original);
  });

  it('treat a setting left at its default and one set to the default as the same', async () => {
    const left = pipeline();
    delete left.nodes[2]!.params['strategy'];
    expect(await hashes(left)).toEqual(await hashes(pipeline()));
  });

  it('ignore a setting that does not apply', async () => {
    const original = await hashes(pipeline());
    // fillValue only applies when the strategy is "constant".
    const extra = pipeline({ impute: { fillValue: 7 } });
    expect(await hashes(extra)).toEqual(original);
  });

  it('treat a list of columns as a set', async () => {
    const a = await hashes(pipeline({ impute: { columns: ['a', 'b'] } }));
    const b = await hashes(pipeline({ impute: { columns: ['b', 'a'] } }));
    expect(b).toEqual(a);
  });

  it('treat the split ratios as ordered', async () => {
    const a = await hashes(pipeline({ split: { ratios: [0.7, 0.15, 0.15] } }));
    const b = await hashes(pipeline({ split: { ratios: [0.15, 0.7, 0.15] } }));
    expect(b['n2']).not.toBe(a['n2']);
  });

  it('change for the edited step and every step after it, but not before', async () => {
    const a = await hashes(pipeline());
    const b = await hashes(pipeline({ impute: { strategy: 'mean' } }));
    expect(b['n1']).toBe(a['n1']);
    expect(b['n2']).toBe(a['n2']);
    expect(b['n3']).not.toBe(a['n3']);
    expect(b['n4']).not.toBe(a['n4']);
  });

  it('change for everything when the file changes', async () => {
    const a = await hashes(pipeline(), 'file1');
    const b = await hashes(pipeline(), 'file2');
    for (const id of ['n1', 'n2', 'n3', 'n4']) expect(b[id]).not.toBe(a[id]);
  });

  it('depend on the seed only for steps that use randomness', async () => {
    const a = await hashes(pipeline({ seed: 1 }));
    const b = await hashes(pipeline({ seed: 2 }));
    expect(b['n1']).toBe(a['n1']);
    expect(b['n2']).not.toBe(a['n2']);
    expect(b['n3']).not.toBe(a['n3']); // downstream of the split
  });

  it('are the same for 1 and 1.0 and for -0 and 0', () => {
    expect(canonicalJson({ a: 1.0 })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson({ a: -0 })).toBe(canonicalJson({ a: 0 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('refuse values that cannot be reproduced', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});

describe('node statuses', () => {
  it('are done, outdated and todo', () => {
    const now = { a: 'h1', b: 'h2', c: 'h3' };
    expect(nodeStatuses(now, { a: 'h1', b: 'old' })).toEqual({
      a: 'done',
      b: 'outdated',
      c: 'todo',
    });
  });

  it('mark every step after an edit as outdated', async () => {
    const before = await hashes(pipeline());
    const after = await hashes(pipeline({ impute: { strategy: 'mean' } }));
    expect(nodeStatuses(after, before)).toEqual({
      n1: 'done',
      n2: 'done',
      n3: 'outdated',
      n4: 'outdated',
    });
  });
});
