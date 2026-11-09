import type { ScreenId } from '../screens';
import { getOpenFile, openFile } from './actions';
import { initialProject, useProject, type ProjectState } from './project';
import { browserKv, type Kv } from './storage';
import { useUi } from './ui';
import { create } from 'zustand';

export interface SavedProject {
  version: 1;
  savedAt: string;
  project: ProjectState;
  ui: { completed: ScreenId[]; screen: ScreenId };
}

export type SaveStatus = 'nothing' | 'saving' | 'saved' | 'error';
export const useSave = create<{ status: SaveStatus; at: string | null }>(() => ({
  status: 'nothing',
  at: null,
}));

const PROJECT_KEY = 'project:current';
const FILE_KEY = 'file:current';

let kv: Kv = browserKv;
/** For tests: use another store. */
export function useStorage(store: Kv): void {
  kv = store;
}

let lastFileSaved: ArrayBuffer | null = null;

export async function saveNow(): Promise<void> {
  const project = useProject.getState();
  if (!project.dataset && !project.goal && project.name === 'Untitled project') return;
  useSave.setState({ status: 'saving' });
  try {
    const { name, topic, goal, dataset, roles, tidy, split, splitResult, seed } = project;
    const { metric, prepare, dismissed } = project;
    const state: ProjectState = {
      name,
      topic,
      goal,
      dataset,
      roles,
      tidy,
      split,
      splitResult,
      seed,
      metric,
      prepare,
      dismissed,
    };
    const ui = useUi.getState();
    const saved: SavedProject = {
      version: 1,
      savedAt: new Date().toISOString(),
      project: state,
      ui: { completed: ui.completed, screen: ui.screen },
    };
    const file = getOpenFile();
    if (file && file.source === 'file' && file.bytes !== lastFileSaved) {
      await kv.set(FILE_KEY, new Blob([file.bytes]));
      lastFileSaved = file.bytes;
    }
    await kv.set(PROJECT_KEY, saved);
    useSave.setState({ status: 'saved', at: saved.savedAt });
  } catch {
    useSave.setState({ status: 'error' });
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Saves a moment after every change. */
export function startAutosave(): () => void {
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void saveNow(), 600);
  };
  const stops = [useProject.subscribe(schedule), useUi.subscribe(schedule)];
  return () => {
    clearTimeout(timer);
    stops.forEach((stop) => stop());
  };
}

export async function loadSaved(): Promise<SavedProject | null> {
  try {
    const saved = await kv.get<SavedProject>(PROJECT_KEY);
    return saved && saved.version === 1 ? saved : null;
  } catch {
    return null;
  }
}

export async function discardSaved(): Promise<void> {
  lastFileSaved = null;
  try {
    await kv.del(PROJECT_KEY);
    await kv.del(FILE_KEY);
  } catch {
    /* nothing to discard */
  }
  useSave.setState({ status: 'nothing', at: null });
}

/** Brings a saved project back: reads the file again, then restores the choices and the position. */
export async function restore(
  saved: SavedProject,
  fetchSample: (id: string) => Promise<ArrayBuffer>,
): Promise<void> {
  const dataset = saved.project.dataset;
  if (dataset) {
    let bytes: ArrayBuffer | undefined;
    if (dataset.source === 'sample' && dataset.sampleId)
      bytes = await fetchSample(dataset.sampleId);
    else {
      const blob = await kv.get<Blob>(FILE_KEY);
      bytes = blob ? await blob.arrayBuffer() : undefined;
    }
    if (bytes) {
      await openFile(
        {
          name: dataset.name,
          bytes,
          source: dataset.source,
          ...(dataset.sampleId ? { sampleId: dataset.sampleId } : {}),
        },
        dataset.settings,
      );
      lastFileSaved = bytes;
    }
  }
  const { update } = useProject.getState();
  // Projects saved by an earlier version lack the newer fields; start those empty.
  update({
    ...initialProject(),
    ...saved.project,
    dataset: useProject.getState().dataset ?? saved.project.dataset,
  });
  useUi.setState({ completed: saved.ui.completed, screen: saved.ui.screen });
}
