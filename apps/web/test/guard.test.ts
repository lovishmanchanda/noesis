import { describe, expect, it } from 'vitest';
import {
  BLOCK_MB,
  MLP_ROW_EPOCH_LIMIT,
  WARN_MB,
  defaultViz,
  memoryGuard,
} from '../src/training/guard';

describe('the memory guard', () => {
  it('lets small jobs through without a word', () => {
    const g = memoryGuard(10_000, 20, 'random_forest');
    expect(g.blocking).toBeNull();
    expect(g.warning).toBeNull();
    expect(g.estimateMB).toBeLessThan(WARN_MB);
  });

  it('warns before the job is too big, then refuses', () => {
    const warn = memoryGuard(600_000, 50, 'random_forest');
    expect(warn.estimateMB).toBeGreaterThan(WARN_MB);
    expect(warn.estimateMB).toBeLessThan(BLOCK_MB);
    expect(warn.warning).toMatch(/memory/);
    expect(warn.blocking).toBeNull();
    const block = memoryGuard(1_500_000, 50, 'random_forest');
    expect(block.estimateMB).toBeGreaterThan(BLOCK_MB);
    expect(block.blocking).toMatch(/fewer rows or columns/);
  });

  it('counts the extra copies that cross-validation makes', () => {
    expect(memoryGuard(100_000, 50, 'ridge', { folds: 5 }).estimateMB).toBeGreaterThan(
      memoryGuard(100_000, 50, 'ridge').estimateMB,
    );
  });

  it('refuses a neural network bigger than the browser can finish', () => {
    const rows = 100_000;
    const ok = memoryGuard(rows, 10, 'mlp', { epochs: MLP_ROW_EPOCH_LIMIT / rows });
    expect(ok.blocking).toBeNull();
    const big = memoryGuard(rows, 10, 'mlp', { epochs: MLP_ROW_EPOCH_LIMIT / rows + 1 });
    expect(big.blocking).toMatch(/epochs/);
  });

  it('picks the detail level from the size', () => {
    expect(defaultViz(50_000)).toBe('full');
    expect(defaultViz(50_001)).toBe('light');
  });
});
