import type { LoadSettings } from '@noesis/engine-client';
import { applyPatch, type PatchOp } from '@noesis/rules';
import type { NOESISPipeline, PipelineNode } from '@noesis/schema';
import {
  PREPARE_TYPES,
  type ModelChoice,
  type PrepareStep,
  type PrepareType,
  type ProjectState,
  type SplitChoices,
  type SplitStrategy,
} from '../state/project';
import { buildTrainingPipeline } from './build';

/** The part of a project that suggestions can change. Kept so one Undo can put it all back. */
export type Editable = Pick<
  ProjectState,
  'roles' | 'tidy' | 'split' | 'metric' | 'prepare' | 'dismissed' | 'model'
> & { loadSettings: LoadSettings };

export function editableOf(project: ProjectState): Editable {
  return {
    roles: project.roles,
    tidy: project.tidy,
    split: project.split,
    metric: project.metric,
    prepare: project.prepare,
    dismissed: project.dismissed,
    model: project.model,
    loadSettings: project.dataset?.settings ?? {},
  };
}

const isPrepare = (type: string): type is PrepareType =>
  (PREPARE_TYPES as readonly string[]).includes(type);

const value = (node: PipelineNode, name: string): unknown => node.params[name]?.value;

/**
 * Reads the choices back out of a pipeline. This is the inverse of `buildEarlyPipeline`: a patch
 * is applied to the pipeline, and the project's own choices are then rebuilt from the result, so
 * the screens and the pipeline can never disagree.
 */
export function choicesFromPipeline(project: ProjectState, next: NOESISPipeline): Editable {
  const target = next.dataset.columns.find((c) => c.role === 'target')?.name;
  const nodes = next.nodes;

  const split = nodes.find((n) => n.type === 'split');
  const splitChoices: SplitChoices = { ...project.split };
  if (split) {
    const strategy = value(split, 'strategy');
    if (typeof strategy === 'string') splitChoices.strategy = strategy as SplitStrategy;
    const ratios = value(split, 'ratios');
    if (Array.isArray(ratios) && ratios.length === 3)
      splitChoices.ratios = ratios as [number, number, number];
    const group = value(split, 'groupColumn');
    splitChoices.groupColumn = typeof group === 'string' ? group : null;
    const time = value(split, 'timeColumn');
    splitChoices.timeColumn = typeof time === 'string' ? time : null;
  }

  const dropped = nodes
    .filter((n) => n.type === 'drop_columns')
    .flatMap((n) => (value(n, 'columns') as string[] | undefined) ?? []);

  const load = nodes.find((n) => n.type === 'load_csv');
  const loadSettings: LoadSettings = { ...(project.dataset?.settings ?? {}) };
  if (load) {
    const delimiter = value(load, 'delimiter');
    if (typeof delimiter === 'string') loadSettings.delimiter = delimiter;
  }

  // Steps added by a patch have generated ids. Give them stable ones that cannot clash.
  let counter = Math.max(0, ...project.prepare.map((s) => Number(/^p(\d+)$/.exec(s.id)?.[1] ?? 0)));
  const prepare: PrepareStep[] = nodes
    .filter((n) => isPrepare(n.type))
    .map((n) => ({
      id: /^p\d+$/.test(n.id) ? n.id : `p${++counter}`,
      type: n.type as PrepareType,
      params: n.params,
    }));

  const modelNode = nodes.find((n) => n.type === 'model');
  const model: ModelChoice | null = modelNode
    ? {
        algorithm: String(value(modelNode, 'algorithm') ?? ''),
        params: Object.fromEntries(
          Object.entries(modelNode.params).filter(([k]) => k !== 'algorithm'),
        ),
        preset: project.model?.preset ?? null,
      }
    : null;

  return {
    model,
    roles: Object.fromEntries(next.dataset.columns.map((c) => [c.name, c.role])),
    tidy: {
      dropDuplicates: nodes.some((n) => n.type === 'drop_duplicates'),
      dropMissingTarget:
        target !== undefined &&
        nodes.some(
          (n) =>
            n.type === 'filter_rows' &&
            value(n, 'column') === target &&
            value(n, 'operator') === 'not_null',
        ),
      dropColumns: [...new Set(dropped)],
    },
    split: splitChoices,
    metric: next.task.primaryMetric,
    prepare,
    dismissed: project.dismissed,
    loadSettings,
  };
}

export interface Applied {
  changes: Editable;
  /** True when the file has to be read again because its load settings changed. */
  reload: boolean;
  pipeline: NOESISPipeline;
}

/** Applies a suggestion's patch to the project's pipeline and works out the new choices. */
export function applyToProject(project: ProjectState, patch: PatchOp[]): Applied {
  const { pipeline } = buildTrainingPipeline(project);
  const next = applyPatch(pipeline, patch);
  const changes = choicesFromPipeline(project, next);
  const before = project.dataset?.settings ?? {};
  const reload = JSON.stringify(changes.loadSettings) !== JSON.stringify(before);
  return { changes, reload, pipeline: next };
}
