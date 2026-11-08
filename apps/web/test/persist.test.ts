import { beforeEach, describe, expect, it } from 'vitest';
import { discardSaved, loadSaved, saveNow, useSave, useStorage } from '../src/state/persist';
import { initialProject, useProject } from '../src/state/project';
import { useUi } from '../src/state/ui';
import { memoryKv } from '../src/state/storage';

let kv = memoryKv();
beforeEach(() => {
  kv = memoryKv();
  useStorage(kv);
  useProject.setState(initialProject());
  useUi.setState({ completed: [], screen: 'project' });
  useSave.setState({ status: 'nothing', at: null });
});

describe('autosave', () => {
  it('does not save an untouched project', async () => {
    await saveNow();
    expect(kv.data.size).toBe(0);
    expect(useSave.getState().status).toBe('nothing');
  });

  it('saves the choices and the position, and loads them back', async () => {
    useProject.setState({ name: 'Homes', goal: 'category' });
    useUi.setState({ completed: ['project', 'data'], screen: 'target' });
    await saveNow();
    expect(useSave.getState().status).toBe('saved');
    const saved = await loadSaved();
    expect(saved?.project).toMatchObject({ name: 'Homes', goal: 'category' });
    expect(saved?.ui).toEqual({ completed: ['project', 'data'], screen: 'target' });
  });

  it('keeps functions out of the saved data', async () => {
    useProject.setState({ goal: 'number' });
    await saveNow();
    const stored = JSON.stringify((await loadSaved())?.project);
    expect(stored).not.toContain('update');
  });

  it('discards the saved project', async () => {
    useProject.setState({ goal: 'number' });
    await saveNow();
    await discardSaved();
    expect(await loadSaved()).toBeNull();
    expect(useSave.getState().status).toBe('nothing');
  });

  it('reports when storage fails, instead of failing silently', async () => {
    useStorage({
      get: () => Promise.reject(new Error('blocked')),
      set: () => Promise.reject(new Error('blocked')),
      del: () => Promise.reject(new Error('blocked')),
    });
    useProject.setState({ goal: 'number' });
    await saveNow();
    expect(useSave.getState().status).toBe('error');
    expect(await loadSaved()).toBeNull();
  });
});
