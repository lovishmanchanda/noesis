import fs from 'node:fs';
import path from 'node:path';
import type { TrainingEvent } from '@noesis/engine-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_EVENTS,
  REPLAY_MS,
  SLOW_MS,
  beginRun,
  clearTraining,
  finishRun,
  pushEvents,
  seek,
  setPacing,
  showStoredRun,
  stepForward,
  useTraining,
} from '../src/training/store';

const dir = path.resolve(import.meta.dirname, '../../../fixtures/events');
const log = (
  JSON.parse(fs.readFileSync(path.join(dir, 'mlp-regression.json'), 'utf8')) as {
    events: TrainingEvent[];
  }
).events;
const epochs = log.filter((e) => e.type === 'epoch_end').length;

beforeEach(() => {
  vi.useFakeTimers();
  clearTraining();
  useTraining.setState({ pacing: 'live' });
});
afterEach(() => {
  clearTraining();
  vi.useRealTimers();
});

describe('live pacing', () => {
  it('shows events a moment after they arrive, in one update per frame', async () => {
    beginRun('r', 'full');
    let updates = 0;
    const stop = useTraining.subscribe(() => updates++);
    pushEvents(log.slice(0, 10));
    pushEvents(log.slice(10, 20));
    expect(useTraining.getState().cursor).toBe(0);
    await vi.advanceTimersByTimeAsync(20);
    stop();
    expect(useTraining.getState().cursor).toBe(20);
    expect(updates).toBe(1);
  });

  it('builds the same picture as applying the whole log at once', async () => {
    beginRun('r', 'full');
    for (let i = 0; i < log.length; i += 7) pushEvents(log.slice(i, i + 7));
    await vi.advanceTimersByTimeAsync(50);
    const v = useTraining.getState().visual;
    expect(v.curve).toHaveLength(epochs);
    expect(v.status).toBe('succeeded');
  });
});

describe('a flood of events', () => {
  it('is thinned to a bound and never freezes the page', async () => {
    beginRun('flood', 'full');
    const flood = (i: number): TrainingEvent => ({
      v: 1,
      runId: 'flood',
      seq: i,
      t: i,
      node: 'n',
      trial: null,
      type: i % 1000 === 0 ? 'epoch_end' : 'weights_snapshot',
      source: 'live',
      data: { epoch: i / 1000, totalEpochs: 500, trainLoss: 1, valLoss: 1 },
    });
    const started = performance.now();
    for (let i = 0; i < 40; i++)
      pushEvents(Array.from({ length: 5000 }, (_, j) => flood(i * 5000 + j + 1)));
    await vi.advanceTimersByTimeAsync(50);
    expect(useTraining.getState().events.length).toBeLessThanOrEqual(MAX_EVENTS + 200);
    // every result event is still there
    expect(useTraining.getState().events.filter((e) => e.type === 'epoch_end')).toHaveLength(200);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('slow motion', () => {
  it('shows one animated event at a time while metrics keep arriving', async () => {
    setPacing('slow');
    beginRun('r', 'full');
    useTraining.setState({ pacing: 'slow' });
    pushEvents(log);
    await vi.advanceTimersByTimeAsync(SLOW_MS * 3);
    const early = useTraining.getState().visual.curve.length;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(epochs);
    expect(useTraining.getState().events.length).toBe(log.length); // nothing is lost, it only waits
    finishRun({ status: 'succeeded', durationMs: 1 });
    await vi.advanceTimersByTimeAsync(SLOW_MS * log.length);
    expect(useTraining.getState().visual.curve).toHaveLength(epochs);
  });

  it('jumps to the end when switched back to live', async () => {
    beginRun('r', 'full');
    useTraining.setState({ pacing: 'slow' });
    pushEvents(log);
    setPacing('live');
    expect(useTraining.getState().cursor).toBe(log.length);
  });
});

describe('step by step', () => {
  it('moves one event, or one epoch, per click and never runs on its own', async () => {
    beginRun('r', 'full');
    useTraining.setState({ pacing: 'step' });
    pushEvents(log);
    await vi.advanceTimersByTimeAsync(500);
    expect(useTraining.getState().cursor).toBe(0);
    stepForward('event');
    expect(useTraining.getState().cursor).toBe(1);
    stepForward('epoch');
    expect(useTraining.getState().visual.curve).toHaveLength(1);
    stepForward('epoch');
    expect(useTraining.getState().visual.curve).toHaveLength(2);
  });
});

describe('replaying a stored run', () => {
  it('plays from the start by itself and can be scrubbed backwards', async () => {
    showStoredRun('old', log);
    expect(useTraining.getState().replay).toBe(true);
    await vi.advanceTimersByTimeAsync(REPLAY_MS * log.length);
    expect(useTraining.getState().visual.curve).toHaveLength(epochs);
    const afterFourthEpoch =
      log.findIndex((e) => e.type === 'epoch_end' && e.data['epoch'] === 4) + 1;
    seek(afterFourthEpoch);
    const half = useTraining.getState().visual.curve.length;
    expect(half).toBe(4);
    seek(0);
    expect(useTraining.getState().visual.curve).toEqual([]);
    seek(log.length);
    expect(useTraining.getState().visual.curve).toHaveLength(epochs);
  });

  it('shows the same final picture as the live run did', () => {
    showStoredRun('old', log, false);
    seek(log.length);
    const replayed = useTraining.getState().visual;
    beginRun('live', 'full');
    pushEvents(log);
    setPacing('live');
    expect(useTraining.getState().visual).toEqual(replayed);
  });
});
