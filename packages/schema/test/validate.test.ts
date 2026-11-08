import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ISSUE_CODES,
  validateGraph,
  validatePipeline,
  type NOESISPipeline,
  type PipelineNode as Node,
} from '../src';

const fixtures = path.resolve(import.meta.dirname, '../../../fixtures/pipelines');
const manifest = JSON.parse(fs.readFileSync(path.join(fixtures, 'manifest.json'), 'utf8')) as {
  file: string;
  valid: boolean;
  expect: string[];
}[];
const load = (file: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(fixtures, file), 'utf8'));

describe('golden pipelines', () => {
  for (const entry of manifest) {
    it(`${entry.file} ${entry.valid ? 'is accepted' : `is rejected with ${entry.expect.join(', ')}`}`, () => {
      const result = validatePipeline(load(entry.file));
      const codes = [...new Set(result.issues.map((i) => i.code))].sort();
      expect(codes).toEqual([...entry.expect].sort());
      expect(result.ok).toBe(entry.valid);
    });
  }
});

describe('every issue has a plain explanation', () => {
  for (const entry of manifest.filter((e) => !e.valid)) {
    it(entry.file, () => {
      for (const issue of validatePipeline(load(entry.file)).issues) {
        expect(issue.message.length).toBeGreaterThan(10);
        expect(issue.hint.length).toBeGreaterThan(5);
        expect(issue.message).not.toMatch(/please|successfully/i);
      }
    });
  }
});

describe('coverage of issue codes', () => {
  it('has a golden pipeline for every code except E_MISSING_FIT_ON, which is tested directly below', () => {
    const covered = new Set(manifest.flatMap((e) => e.expect));
    const missing = ISSUE_CODES.filter((c) => !covered.has(c) && c !== 'E_MISSING_FIT_ON');
    expect(missing).toEqual([]);
  });

  it('reports a learning step without fit_on at graph level (the schema normally catches it first)', () => {
    const pipeline = load('valid/classification-full.json') as NOESISPipeline;
    const impute = pipeline.nodes.find((n) => n.id === 'n3');
    if (impute) delete impute.fit_on;
    expect(validateGraph(pipeline).map((i) => i.code)).toEqual(['E_MISSING_FIT_ON']);
  });
});

describe('leakage', () => {
  const learning = [
    'impute',
    'handle_outliers',
    'encode',
    'scale',
    'select_features',
    'reduce_dimensions',
  ] as const;
  for (const type of learning) {
    it(`${type} before the split is rejected`, () => {
      const pipeline = load('valid/regression-minimal.json') as NOESISPipeline;
      const [load_csv, split, model, validate] = pipeline.nodes as [Node, Node, Node, Node];
      const early: Node = { id: 'early', type, inputs: ['n1'], fit_on: 'train', params: {} };
      pipeline.nodes = [load_csv, early, { ...split, inputs: ['early'] }, model, validate];
      const codes = validatePipeline(pipeline).issues.map((i) => i.code);
      expect(codes).toContain('E_LEAK');
    });
  }
});

describe('pipelines used by the Python contract test', () => {
  const dir = path.resolve(import.meta.dirname, '../../../fixtures/contract/pipelines');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    it(`${file} passes the validator`, () => {
      const result = validatePipeline(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
      expect(result.issues).toEqual([]);
    });
  }
});
