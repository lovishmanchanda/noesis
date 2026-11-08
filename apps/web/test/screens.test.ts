import { describe, expect, it } from 'vitest';
import { SCREENS, screenStatus } from '../src/screens';

describe('screen status', () => {
  it('marks the current screen and keeps later ones locked until the earlier ones are done', () => {
    expect(screenStatus('project', 'project', []).status).toBe('current');
    expect(screenStatus('data', 'project', [])).toMatchObject({
      status: 'locked',
      reason: 'Finish "Project" first.',
    });
    expect(screenStatus('data', 'project', ['project']).status).toBe('todo');
  });

  it('keeps finished screens open', () => {
    expect(screenStatus('project', 'data', ['project']).status).toBe('done');
  });

  it('locks screens that arrive in a later version', () => {
    const done = SCREENS.filter((s) => s.available).map((s) => s.id);
    expect(screenStatus('explore', 'split', done)).toMatchObject({
      status: 'locked',
      reason: 'Coming in a later version.',
    });
  });

  it('lists the fourteen screens in order', () => {
    expect(SCREENS.map((s) => s.id).slice(0, 5)).toEqual([
      'project',
      'data',
      'target',
      'tidy',
      'split',
    ]);
    expect(SCREENS).toHaveLength(14);
  });
});
