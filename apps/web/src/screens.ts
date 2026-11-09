export type ScreenId =
  | 'project'
  | 'data'
  | 'target'
  | 'tidy'
  | 'split'
  | 'explore'
  | 'missing'
  | 'features'
  | 'model'
  | 'train'
  | 'compare'
  | 'explain'
  | 'test'
  | 'export';

export interface ScreenDef {
  id: ScreenId;
  title: string;
  purpose: string;
  /** False for screens that arrive in a later phase of the build. */
  available: boolean;
}

/** The wizard, in order. See docs/design/wizard-screens.md. */
export const SCREENS: ScreenDef[] = [
  {
    id: 'project',
    title: 'Project',
    purpose: 'Name your project and say what you want to find out.',
    available: true,
  },
  {
    id: 'data',
    title: 'Data',
    purpose: 'Add your CSV file. It stays on this computer.',
    available: true,
  },
  {
    id: 'target',
    title: 'Target',
    purpose: 'Choose what to predict, and which columns to leave out.',
    available: true,
  },
  {
    id: 'tidy',
    title: 'Tidy',
    purpose: 'Remove rows and columns that only get in the way.',
    available: true,
  },
  {
    id: 'split',
    title: 'Split',
    purpose: 'Keep some rows aside so the model can be checked fairly.',
    available: true,
  },
  {
    id: 'explore',
    title: 'Explore',
    purpose: 'Look around before changing anything.',
    available: true,
  },
  {
    id: 'missing',
    title: 'Missing values',
    purpose: 'Fill the gaps and handle extreme values.',
    available: true,
  },
  {
    id: 'features',
    title: 'Features',
    purpose: 'Turn text into numbers and scale the columns.',
    available: true,
  },
  { id: 'model', title: 'Model', purpose: 'Choose how to learn from the data.', available: false },
  { id: 'train', title: 'Train', purpose: 'Watch the model learn.', available: false },
  {
    id: 'compare',
    title: 'Compare',
    purpose: 'Compare runs and tune the settings.',
    available: false,
  },
  {
    id: 'explain',
    title: 'Explain',
    purpose: 'See what the model relies on and where it fails.',
    available: false,
  },
  {
    id: 'test',
    title: 'Final test',
    purpose: 'One honest score on rows the model has never seen.',
    available: false,
  },
  { id: 'export', title: 'Export', purpose: 'Take the model and the code away.', available: false },
];

export function screenIndex(id: ScreenId): number {
  return SCREENS.findIndex((s) => s.id === id);
}

export function screenDef(id: ScreenId): ScreenDef {
  const def = SCREENS[screenIndex(id)];
  if (!def) throw new Error(`Unknown screen ${id}`);
  return def;
}

export type ScreenStatus = 'current' | 'done' | 'todo' | 'locked';

/** A screen unlocks once every available screen before it is done. Done screens stay open. */
export function screenStatus(
  id: ScreenId,
  current: ScreenId,
  completed: readonly ScreenId[],
): {
  status: ScreenStatus;
  reason?: string;
} {
  const def = screenDef(id);
  if (id === current) return { status: 'current' };
  if (completed.includes(id)) return { status: 'done' };
  if (!def.available) return { status: 'locked', reason: 'Coming in a later version.' };
  const firstUndone = SCREENS.slice(0, screenIndex(id)).find(
    (s) => s.available && !completed.includes(s.id),
  );
  if (firstUndone) return { status: 'locked', reason: `Finish "${firstUndone.title}" first.` };
  return { status: 'todo' };
}
