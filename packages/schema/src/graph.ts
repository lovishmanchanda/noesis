import { NON_NUMERIC_DTYPES, learnsFromData } from '@noesis/registry';
import type { NOESISPipeline, Node as PipelineNode } from './generated/pipeline';
import type { Issue, IssueCode } from './issues';

const SUPERVISED = new Set(['regression', 'classification', 'forecasting']);
const EVALUATION_STEPS = new Set(['tune', 'validate', 'test', 'stability_check']);

function paramValue(node: PipelineNode, name: string): unknown {
  return node.params[name]?.value ?? null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function label(node: PipelineNode): string {
  return `"${node.id}" (${node.type})`;
}

/** Ids in an order where every node comes after its inputs, or null if the graph has a cycle. */
function topologicalOrder(nodes: PipelineNode[]): string[] | null {
  const waiting = new Map<string, number>();
  const readers = new Map<string, string[]>();
  for (const node of nodes) {
    const inputs = node.inputs ?? [];
    waiting.set(node.id, inputs.length);
    for (const input of inputs) readers.set(input, [...(readers.get(input) ?? []), node.id]);
  }
  const queue = nodes.filter((n) => (n.inputs ?? []).length === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const reader of readers.get(id) ?? []) {
      const left = (waiting.get(reader) ?? 0) - 1;
      waiting.set(reader, left);
      if (left === 0) queue.push(reader);
    }
  }
  return order.length === nodes.length ? order : null;
}

/**
 * Checks the rules that need the whole graph: one source, one split, nothing that learns from data
 * before the split, the test set used once and never fed back, and only numbers reaching a model.
 * Expects a pipeline that already passed the structural check.
 */
export function validateGraph(pipeline: NOESISPipeline): Issue[] {
  const issues: Issue[] = [];
  const add = (code: IssueCode, message: string, hint: string, node?: PipelineNode): void => {
    issues.push(node ? { code, message, hint, node: node.id } : { code, message, hint });
  };

  const nodes = pipeline.nodes;
  const byId = new Map<string, PipelineNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      add('E_DUP_ID', `Two steps share the id "${node.id}".`, 'Give every step its own id.', node);
    }
    byId.set(node.id, node);
  }
  if (issues.length > 0) return issues;

  for (const node of nodes) {
    for (const input of node.inputs ?? []) {
      if (!byId.has(input)) {
        add(
          'E_UNKNOWN_INPUT',
          `Step ${label(node)} reads from "${input}", which does not exist.`,
          'Point it at an existing step or remove it.',
          node,
        );
      }
    }
  }
  if (issues.length > 0) return issues;

  const order = topologicalOrder(nodes);
  if (order === null) {
    add(
      'E_CYCLE',
      'The steps form a loop, so there is no order to run them in.',
      'Remove one of the connections that points back.',
    );
    return issues;
  }

  const ancestors = new Map<string, Set<string>>();
  for (const id of order) {
    const found = new Set<string>();
    for (const input of (byId.get(id) as PipelineNode).inputs ?? []) {
      found.add(input);
      for (const further of ancestors.get(input) as Set<string>) found.add(further);
    }
    ancestors.set(id, found);
  }
  const hasAncestorOfType = (node: PipelineNode, type: string): boolean =>
    [...(ancestors.get(node.id) as Set<string>)].some((id) => byId.get(id)?.type === type);

  const task = pipeline.task.type;

  // Source and split
  const sources = nodes.filter((n) => n.type === 'load_csv');
  if (sources.length !== 1) {
    add(
      'E_SOURCE_COUNT',
      `A pipeline needs exactly one load_csv step, found ${sources.length}.`,
      'Keep a single step that loads the file.',
    );
  }
  const splits = nodes.filter((n) => n.type === 'split');
  if (splits.length === 0) {
    add(
      'E_NO_SPLIT',
      'The pipeline has no split step.',
      'Add a split before anything that learns from the data.',
    );
  } else if (splits.length > 1) {
    add(
      'E_MULTI_SPLIT',
      `The pipeline has ${splits.length} split steps, it needs exactly one.`,
      'Keep one split and remove the others.',
    );
  }

  // Leakage: anything that learns from data must come after the split and say so
  for (const node of nodes) {
    if (!learnsFromData(node.type)) continue;
    if (!hasAncestorOfType(node, 'split')) {
      add(
        'E_LEAK',
        `Step ${label(node)} learns from the data but runs before the split, so it would see the test rows.`,
        'Move it after the split.',
        node,
      );
    }
    if (node.fit_on !== 'train') {
      add(
        'E_MISSING_FIT_ON',
        `Step ${label(node)} learns from the data but does not say fit_on: "train".`,
        'Set fit_on to "train" so it only learns from training rows.',
        node,
      );
    }
  }
  for (const node of nodes) {
    if (node.type === 'model' && splits.length > 0 && !hasAncestorOfType(node, 'split')) {
      add(
        'E_MODEL_BEFORE_SPLIT',
        `Model ${label(node)} is not downstream of the split.`,
        'Connect the model to a step that comes after the split.',
        node,
      );
    }
    if (EVALUATION_STEPS.has(node.type) && !hasAncestorOfType(node, 'model')) {
      add(
        'E_NO_MODEL_UPSTREAM',
        `Step ${label(node)} has no model before it.`,
        'Connect it to a model step.',
        node,
      );
    }
  }

  // The test set
  const tests = nodes.filter((n) => n.type === 'test');
  if (task === 'clustering') {
    for (const node of tests) {
      add(
        'E_TEST_IN_CLUSTERING',
        `Step ${label(node)}: clustering has no test set.`,
        'Use stability_check instead.',
        node,
      );
    }
  } else {
    if (tests.length > 1) {
      add(
        'E_TEST_TWICE',
        `The pipeline has ${tests.length} test steps. The test set is used once.`,
        'Keep a single test step.',
      );
    }
    for (const node of tests) {
      if (!hasAncestorOfType(node, 'validate')) {
        add(
          'E_TEST_WITHOUT_VALIDATE',
          `Test step ${label(node)} has no validate step before it.`,
          'Validate and choose a model first, then test.',
          node,
        );
      }
    }
    const testIds = new Set(tests.map((n) => n.id));
    for (const node of nodes) {
      const downstreamOfTest = [...(ancestors.get(node.id) as Set<string>)].some((id) =>
        testIds.has(id),
      );
      if (downstreamOfTest && node.type !== 'export_model') {
        add(
          'E_TEST_FEEDBACK',
          `Step ${label(node)} comes after the test step. Tuning on the test set makes its score dishonest.`,
          'Only export_model may follow the test.',
          node,
        );
      }
    }
  }
  for (const node of nodes) {
    if (node.type === 'stability_check' && task !== 'clustering') {
      add(
        'E_TASK_MISMATCH',
        `Step ${label(node)} only applies to clustering.`,
        'Use validate and test for this task.',
        node,
      );
    }
  }

  // Columns and target
  const columns = pipeline.dataset.columns;
  const seen = new Set<string>();
  for (const column of columns) {
    if (seen.has(column.name)) {
      add('E_DUP_COLUMN', `The column "${column.name}" is listed twice.`, 'List each column once.');
    }
    seen.add(column.name);
  }
  const targets = columns.filter((c) => c.role === 'target');
  if (task === 'clustering') {
    if (targets.length > 0) {
      add(
        'E_TARGET_IN_CLUSTERING',
        'Clustering has no target column.',
        'Mark that column as reference to compare against it later.',
      );
    }
  } else {
    if (SUPERVISED.has(task) && targets.length !== 1) {
      add(
        'E_TARGET',
        `A ${task} task needs exactly one target column, found ${targets.length}.`,
        'Mark the column to predict as the target.',
      );
    }
    if (columns.some((c) => c.role === 'reference')) {
      add(
        'E_REFERENCE_ROLE',
        'The reference role only exists for clustering.',
        'Use feature, target or exclude.',
      );
    }
  }

  // Split settings
  for (const node of splits) {
    const strategy = paramValue(node, 'strategy');
    const ratios = paramValue(node, 'ratios');
    if (strategy === 'none') {
      if (task !== 'clustering') {
        add(
          'E_SPLIT_STRATEGY',
          `Split ${label(node)}: "none" is only for clustering.`,
          'Choose random, stratified, group or time.',
          node,
        );
      } else if (Array.isArray(ratios) && ratios.join(',') !== '1,0,0') {
        add(
          'E_SPLIT_RATIOS',
          `Split ${label(node)}: with "none" the ratios must be [1, 0, 0].`,
          'Remove the ratios or use a holdout strategy.',
          node,
        );
      }
    } else if (Array.isArray(ratios)) {
      const [train, validation, test] = ratios as number[];
      const total = (train ?? 0) + (validation ?? 0) + (test ?? 0);
      const valid =
        ratios.length === 3 &&
        Math.abs(total - 1) < 1e-6 &&
        (train ?? 0) > 0 &&
        (test ?? 0) > 0 &&
        (validation ?? 0) >= 0;
      if (!valid) {
        add(
          'E_SPLIT_RATIOS',
          `Split ${label(node)}: train, validation and test must add up to 1, with train and test above 0.`,
          'For example [0.7, 0.15, 0.15].',
          node,
        );
      }
    }
  }

  // Only numbers may reach a model
  const nonNumeric = new Set(
    columns
      .filter(
        (c) => c.role === 'feature' && (NON_NUMERIC_DTYPES as readonly string[]).includes(c.dtype),
      )
      .map((c) => c.name),
  );
  const state = new Map<string, Set<string>>();
  for (const id of order) {
    const node = byId.get(id) as PipelineNode;
    const inputs = node.inputs ?? [];
    const current = new Set<string>(inputs.length === 0 ? nonNumeric : []);
    for (const input of inputs)
      for (const name of state.get(input) as Set<string>) current.add(name);
    if (node.type === 'drop_columns' || node.type === 'encode') {
      for (const name of stringList(paramValue(node, 'columns'))) current.delete(name);
    }
    state.set(id, current);
    if (node.type === 'model' && current.size > 0) {
      const names = [...current].map((n) => `"${n}"`).join(', ');
      add(
        'E_NON_NUMERIC_FEATURE',
        `Model ${label(node)} would receive text or date columns: ${names}.`,
        'Encode them, turn dates into parts, or drop them before the model.',
        node,
      );
    }
  }

  return issues;
}
