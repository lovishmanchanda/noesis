import fs from 'node:fs';
import path from 'node:path';
import type { TrainingEvent, TrainOutcome } from '@noesis/engine-client';
import { describe, expect, it } from 'vitest';
import { applyEvent, emptyVisual, visualFromEvents } from '../src/training/events';

const dir = path.resolve(import.meta.dirname, '../../../fixtures/events');
interface Log {
  name: string;
  task: string;
  events: TrainingEvent[];
  outcome: TrainOutcome;
}
const load = (name: string): Log =>
  JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8')) as Log;
const NAMES = [
  'mlp-regression',
  'forest-regression',
  'boosting-regression',
  'logistic-classification',
  'ridge-regression',
];

describe.each(NAMES)('golden event log: %s', (name) => {
  const log = load(name);

  it('is numbered one by one, starts with the run and ends with its result', () => {
    expect(log.events.map((e) => e.seq)).toEqual(log.events.map((_, i) => i + 1));
    expect(log.events[0]?.type).toBe('run_started');
    expect(log.events.at(-1)?.type).toBe('run_finished');
    expect(log.events.at(-1)?.data['status']).toBe('succeeded');
  });

  it('has every step start before its own events and finish after them', () => {
    const start = new Map<string, number>();
    const end = new Map<string, number>();
    log.events.forEach((e, i) => {
      if (e.type === 'node_started' && e.node) start.set(e.node, i);
      if (e.type === 'node_finished' && e.node) end.set(e.node, i);
    });
    log.events.forEach((e, i) => {
      if (e.node && !['node_started', 'node_finished', 'node_failed'].includes(e.type)) {
        expect(start.get(e.node)).toBeLessThan(i);
        expect(end.get(e.node)).toBeGreaterThan(i);
      }
    });
  });

  it('builds a picture that ends in the same state as the run', () => {
    const v = visualFromEvents(log.events);
    expect(v.status).toBe('succeeded');
    expect(v.applied).toBe(log.events.length);
    expect(v.nodes.every((n) => n.status === 'done' || n.status === 'cached')).toBe(true);
    expect(v.algorithm).toBe(log.outcome.algorithm);
  });

  it('builds the same picture however it is cut and replayed', () => {
    const whole = visualFromEvents(log.events);
    const piece = emptyVisual();
    for (const e of log.events) applyEvent(piece, e);
    expect(piece).toEqual(whole);
    expect(visualFromEvents(log.events, 0)).toEqual(emptyVisual());
  });
});

describe('what each algorithm draws', () => {
  it('the network: structure, a loss curve per epoch with both losses, and the weights', () => {
    const v = visualFromEvents(load('mlp-regression').events);
    expect(v.structure?.layers).toHaveLength(2);
    expect(v.curveKind).toBe('loss');
    expect(v.curve.map((p) => p.x)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(v.curve.every((p) => p.train !== null && p.val !== null)).toBe(true);
    expect(v.curve.at(-1)!.train!).toBeLessThan(v.curve[0]!.train!);
    expect(v.weights?.layers.length).toBeGreaterThan(0);
    expect(v.weights!.layers.every((l) => l.matrix.length <= 16)).toBe(true);
  });

  it('the forest: progress by trees, importances and the first trees', () => {
    const v = visualFromEvents(load('forest-regression').events);
    expect(v.curveKind).toBe('score');
    expect(v.curve.at(-1)?.x).toBe(20);
    expect(v.importances?.length).toBeGreaterThan(0);
    expect(Object.keys(v.trees)).toEqual(['0', '1', '2']);
    const tree = v.trees[0]!;
    expect(tree[0]?.parentId).toBeNull();
    expect(tree.every((n) => n.depth <= 6)).toBe(true);
    expect(v.treeSummary[0]?.nodes).toBeGreaterThan(1);
  });

  it('boosting: a loss for every round', () => {
    const v = visualFromEvents(load('boosting-regression').events);
    expect(v.curve).toHaveLength(15);
    expect(v.curve.at(-1)!.train!).toBeLessThan(v.curve[0]!.train!);
    expect(v.total).toBe(15);
  });

  it('logistic regression: iterations and coefficients, live', () => {
    const v = visualFromEvents(load('logistic-classification').events);
    expect(v.fitProgress?.iter).toBeGreaterThan(0);
    expect(v.coefficients?.source).toBe('live');
  });

  it('ridge regression: coefficients labelled as a replay, no curve', () => {
    const v = visualFromEvents(load('ridge-regression').events);
    expect(v.coefficients?.source).toBe('replay');
    expect(v.curve).toEqual([]);
  });
});

describe('unknown and failed runs', () => {
  it('ignores events it does not know', () => {
    const v = emptyVisual();
    applyEvent(v, {
      v: 1,
      runId: 'r',
      seq: 1,
      t: 5,
      node: null,
      trial: null,
      type: 'from_the_future',
      source: 'live',
      data: { x: 1 },
    });
    expect(v.applied).toBe(1);
    expect(v.curve).toEqual([]);
  });

  it('records a failed step and its error', () => {
    const v = visualFromEvents([
      {
        v: 1,
        runId: 'r',
        seq: 1,
        t: 0,
        node: null,
        trial: null,
        type: 'run_started',
        source: 'live',
        data: { nodes: ['n1'], vizLevel: 'full', targetNode: 'n1' },
      },
      {
        v: 1,
        runId: 'r',
        seq: 2,
        t: 1,
        node: 'n1',
        trial: null,
        type: 'node_started',
        source: 'live',
        data: { type: 'model' },
      },
      {
        v: 1,
        runId: 'r',
        seq: 3,
        t: 2,
        node: 'n1',
        trial: null,
        type: 'training_diverged',
        source: 'live',
        data: {},
      },
      {
        v: 1,
        runId: 'r',
        seq: 4,
        t: 3,
        node: 'n1',
        trial: null,
        type: 'node_failed',
        source: 'live',
        data: { error: { code: 'E_NAN_LOSS', message: 'x', hint: 'y' } },
      },
      {
        v: 1,
        runId: 'r',
        seq: 5,
        t: 4,
        node: null,
        trial: null,
        type: 'run_finished',
        source: 'live',
        data: { status: 'failed' },
      },
    ]);
    expect(v.status).toBe('failed');
    expect(v.diverged).toBe(true);
    expect(v.error?.code).toBe('E_NAN_LOSS');
    expect(v.nodes[0]?.status).toBe('failed');
  });
});
