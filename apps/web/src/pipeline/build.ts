import { NODE_INFO } from '@noesis/registry';
import { rankOf } from '@noesis/rules';
import {
  validatePipeline,
  type Issue,
  type NOESISPipeline,
  type Param,
  type PipelineNode,
} from '@noesis/schema';
import type { ProjectState } from '../state/project';
import { METRIC_OF_GOAL, TASK_OF_GOAL } from './guess';

type Params = PipelineNode['params'];
const user = (value: Param['value']): Param => ({ value, source: 'user' });

export interface Built {
  pipeline: NOESISPipeline;
  issues: Issue[];
}

/**
 * Turns the choices made on the first five screens into a pipeline file.
 * Steps that learn nothing from the data come first, then the split. The screens are not the
 * order of the steps: the builder puts each step where it belongs.
 */
export function buildEarlyPipeline(project: ProjectState): Built {
  if (!project.dataset || !project.goal) throw new Error('Choose a goal and open a file first');
  const { dataset, goal, roles, tidy, split } = project;
  const target = Object.keys(roles).find((c) => roles[c] === 'target');

  const nodes: PipelineNode[] = [];
  const add = (type: PipelineNode['type'], params: Params = {}): void => {
    const id = `n${nodes.length}`;
    nodes.push(
      nodes.length === 0
        ? { id, type, params }
        : { id, type, inputs: [`n${nodes.length - 1}`], params },
    );
  };

  const load: Params = {};
  const s = dataset.settings;
  if (s.delimiter !== undefined && s.delimiter !== ',') load['delimiter'] = user(s.delimiter);
  if (s.header === false) load['header'] = user(false);
  if (s.encoding !== undefined && s.encoding !== 'utf-8') load['encoding'] = user(s.encoding);
  add('load_csv', load);

  if (tidy.dropMissingTarget && target)
    add('filter_rows', { column: user(target), operator: user('not_null') });
  if (tidy.dropDuplicates) add('drop_duplicates');
  if (tidy.dropColumns.length > 0) add('drop_columns', { columns: user(tidy.dropColumns) });

  const strategy = split.strategy;
  const params: Params = {
    strategy: user(strategy),
    ratios: user(strategy === 'none' ? [1, 0, 0] : split.ratios),
  };
  if (strategy === 'group' && split.groupColumn) params['groupColumn'] = user(split.groupColumn);
  if (strategy === 'time' && split.timeColumn) params['timeColumn'] = user(split.timeColumn);
  add('split', params);

  // Steps after the split, each where its kind belongs; steps of one kind keep the order they were added in.
  const ordered = project.prepare
    .map((step, index) => ({ step, index }))
    .sort((a, b) => rankOf(a.step.type) - rankOf(b.step.type) || a.index - b.index);
  for (const { step } of ordered) {
    const previous = nodes[nodes.length - 1];
    nodes.push({
      id: step.id,
      type: step.type,
      ...(NODE_INFO[step.type].learns ? { fit_on: 'train' as const } : {}),
      ...(previous ? { inputs: [previous.id] } : {}),
      params: step.params,
    });
  }

  const pipeline: NOESISPipeline = {
    schemaVersion: '0.1',
    project: {
      name: project.name,
      ...(project.topic ? { topic: project.topic } : {}),
      seed: project.seed,
      mode: 'guided',
    },
    dataset: {
      source: { kind: 'local-file', name: dataset.name },
      rows: dataset.profile.rows,
      columns: dataset.profile.columns.map((c) => ({
        name: c.name,
        dtype: c.dtype,
        role: roles[c.name] ?? 'feature',
      })),
    },
    task: { type: TASK_OF_GOAL[goal], primaryMetric: project.metric ?? METRIC_OF_GOAL[goal] },
    nodes: nodes as NOESISPipeline['nodes'],
  };
  return { pipeline, issues: validatePipeline(pipeline).issues };
}

/**
 * The early pipeline plus the chosen model and the check that scores it. This is what a training
 * run executes. The steps before the model hash exactly as they do in the early pipeline, so
 * the prepared data is reused from the cache.
 */
export function buildTrainingPipeline(project: ProjectState): Built {
  const { pipeline } = buildEarlyPipeline(project);
  const model = project.model;
  if (model) {
    const last = pipeline.nodes[pipeline.nodes.length - 1] as PipelineNode;
    const modelId = 'm1';
    pipeline.nodes.push({
      id: modelId,
      type: 'model',
      inputs: [last.id],
      params: { algorithm: user(model.algorithm), ...model.params },
    });
    const { method, k } = project.validation;
    pipeline.nodes.push({
      id: 'v1',
      type: 'validate',
      inputs: [modelId],
      params: { method: user(method), ...(method === 'holdout' ? {} : { k: user(k) }) },
    });
  }
  return { pipeline, issues: validatePipeline(pipeline).issues };
}
