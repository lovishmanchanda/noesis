import { SCREENS, type ScreenId } from '../screens';
import { initialProject, type ProjectState } from '../state/project';

/**
 * The project file: the choices made so far, without the data. Open it, add the same CSV file
 * again, and the choices are back. It is plain JSON, so it can be shared or kept in version control.
 */
export interface ProjectFile {
  noesisProject: 1;
  savedAt: string;
  project: Pick<
    ProjectState,
    'name' | 'topic' | 'goal' | 'roles' | 'tidy' | 'split' | 'seed' | 'metric' | 'prepare'
  > & {
    dataset: { name: string; settings: NonNullable<ProjectState['dataset']>['settings'] } | null;
  };
}

export function toProjectFile(state: ProjectState, now = new Date()): ProjectFile {
  const { name, topic, goal, roles, tidy, split, seed, dataset, metric, prepare } = state;
  return {
    noesisProject: 1,
    savedAt: now.toISOString(),
    project: {
      name,
      topic,
      goal,
      roles,
      tidy,
      split,
      seed,
      metric,
      prepare,
      dataset: dataset ? { name: dataset.name, settings: dataset.settings } : null,
    },
  };
}

export type ParsedProjectFile = { ok: true; file: ProjectFile } | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseProjectFile(text: string): ParsedProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'This is not a NOESIS project file (it is not valid JSON).' };
  }
  if (!isObject(raw) || raw['noesisProject'] !== 1 || !isObject(raw['project'])) {
    return { ok: false, reason: 'This is not a NOESIS project file.' };
  }
  const p = raw['project'];
  if (typeof p['name'] !== 'string') return { ok: false, reason: 'The project file has no name.' };
  if (p['goal'] !== null && !['number', 'category', 'groups'].includes(p['goal'] as string)) {
    return { ok: false, reason: 'The project file has an unknown goal.' };
  }
  if (!isObject(p['roles']) || !isObject(p['tidy']) || !isObject(p['split'])) {
    return { ok: false, reason: 'The project file is missing its choices.' };
  }
  return { ok: true, file: raw as unknown as ProjectFile };
}

/** The state a project file describes: choices restored, data not yet added. */
export function projectFromFile(file: ProjectFile): {
  project: ProjectState;
  completed: ScreenId[];
  screen: ScreenId;
} {
  const base = initialProject();
  const p = file.project;
  const project: ProjectState = {
    ...base,
    name: p.name,
    topic: typeof p.topic === 'string' ? p.topic : '',
    goal: p.goal,
    roles: p.roles,
    tidy: { ...base.tidy, ...p.tidy },
    split: { ...base.split, ...p.split },
    seed: typeof p.seed === 'number' ? p.seed : base.seed,
    metric: typeof p.metric === 'string' ? p.metric : null,
    prepare: Array.isArray(p.prepare) ? p.prepare : [],
    dataset: null,
  };
  // The project screen is done when a goal was chosen; the data must be added again.
  const completed: ScreenId[] = p.goal ? ['project'] : [];
  const screen = SCREENS.find((s) => s.id === (p.goal ? 'data' : 'project'))?.id ?? 'project';
  return { project, completed, screen };
}

export function downloadName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'project'}.noesis.json`;
}
