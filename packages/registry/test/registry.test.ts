import { describe, expect, it } from 'vitest';
import {
  ALGORITHMS,
  NODE_TYPES,
  algorithmsFor,
  checkValue,
  isActive,
  nodeSpec,
  paramSpecs,
  type ParamSpec,
} from '../src';

const everySpec = (): [string, string, ParamSpec][] => [
  ...NODE_TYPES.flatMap((t) =>
    Object.entries(nodeSpec(t).params).map(([n, s]): [string, string, ParamSpec] => [t, n, s]),
  ),
  ...Object.entries(ALGORITHMS).flatMap(([a, spec]) =>
    Object.entries(spec.params).map(([n, s]): [string, string, ParamSpec] => [a, n, s]),
  ),
];

describe('registry data', () => {
  it('defines every node type', () => {
    for (const type of NODE_TYPES) expect(nodeSpec(type).label.length).toBeGreaterThan(0);
  });

  it('has a label and a help sentence for every parameter', () => {
    for (const [owner, name, spec] of everySpec()) {
      expect(spec.label, `${owner}.${name} label`).toBeTruthy();
      expect(spec.help, `${owner}.${name} help`).toBeTruthy();
    }
  });

  it('keeps every default valid for its own definition', () => {
    for (const [owner, name, spec] of everySpec()) {
      if (spec.default === null) continue;
      expect(checkValue(spec, spec.default), `${owner}.${name} default`).toBeNull();
    }
  });

  it('has ranges that make sense', () => {
    for (const [owner, name, spec] of everySpec()) {
      if (spec.min !== undefined && spec.max !== undefined) {
        expect(spec.min, `${owner}.${name}`).toBeLessThan(spec.max);
      }
      if (spec.tune)
        expect(spec.tune.range[0], `${owner}.${name} tune`).toBeLessThan(spec.tune.range[1]);
    }
  });

  it('only uses conditions that point at a sibling parameter', () => {
    const groups = [
      ...NODE_TYPES.map((t) => nodeSpec(t).params),
      ...Object.values(ALGORITHMS).map((a) => a.params),
    ];
    for (const params of groups) {
      for (const spec of Object.values(params)) {
        if (spec.when) expect(Object.keys(params)).toContain(spec.when.param);
      }
    }
  });

  it('never marks a parameter required while giving it a non-null default', () => {
    for (const [owner, name, spec] of everySpec()) {
      if (spec.required) expect(spec.default, `${owner}.${name}`).toBeNull();
    }
  });
});

describe('algorithms', () => {
  it('offers the right algorithms per task', () => {
    expect(algorithmsFor('clustering').sort()).toEqual(['dbscan', 'hierarchical', 'kmeans']);
    expect(algorithmsFor('classification')).toContain('logistic_regression');
    expect(algorithmsFor('classification')).not.toContain('ridge');
    expect(algorithmsFor('regression')).toContain('ridge');
  });

  it('merges algorithm settings into the model parameters', () => {
    const specs = paramSpecs('model', 'random_forest', 'classification');
    expect(Object.keys(specs)).toContain('n_estimators');
    expect(Object.keys(specs)).toContain('preset');
    expect(specs['algorithm']?.options).toContain('random_forest');
    expect(specs['algorithm']?.options).not.toContain('kmeans');
  });
});

describe('conditions and values', () => {
  it('applies when conditions to sibling values', () => {
    const fill = nodeSpec('impute').params['fillValue'] as ParamSpec;
    expect(isActive(fill, () => 'constant')).toBe(true);
    expect(isActive(fill, () => 'median')).toBe(false);
    const value = nodeSpec('filter_rows').params['value'] as ParamSpec;
    expect(isActive(value, () => 'is_null')).toBe(false);
    expect(isActive(value, () => '>')).toBe(true);
  });

  it('checks types and ranges', () => {
    const trees = ALGORITHMS['random_forest']?.params['n_estimators'] as ParamSpec;
    expect(checkValue(trees, 200)).toBeNull();
    expect(checkValue(trees, 5)).toMatch(/at least 10/);
    expect(checkValue(trees, 20.5)).toMatch(/whole number/);
    expect(checkValue(trees, '200')).toMatch(/whole number/);
  });
});
