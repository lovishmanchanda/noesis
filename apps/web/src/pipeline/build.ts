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
    task: { type: TASK_OF_GOAL[goal], primaryMetric: METRIC_OF_GOAL[goal] },
    nodes: nodes as NOESISPipeline['nodes'],
  };
  return { pipeline, issues: validatePipeline(pipeline).issues };
}
