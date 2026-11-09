import { NODE_INFO, nodeSpec } from '@noesis/registry';
import type { NOESISPipeline, PipelineNode } from '@noesis/schema';
import type { PatchOp } from './types';

/**
 * Where each kind of step belongs in a pipeline. A new step goes after the last step of the same
 * or an earlier rank, so no suggestion can put a step in an order that would leak test rows.
 */
const RANK: Record<PipelineNode['type'], number> = {
  load_csv: 0,
  filter_rows: 10,
  drop_duplicates: 11,
  drop_columns: 12,
  split: 20,
  impute: 30,
  handle_outliers: 35,
  derive_feature: 40,
  encode: 50,
  scale: 60,
  select_features: 70,
  reduce_dimensions: 80,
  model: 90,
  tune: 95,
  validate: 100,
  stability_check: 105,
  test: 110,
  export_model: 120,
};

/** Steps that can take extra columns instead of a second step. */
const MERGEABLE = new Set<PipelineNode['type']>([
  'impute',
  'handle_outliers',
  'encode',
  'drop_columns',
]);

export function rankOf(type: PipelineNode['type']): number {
  return RANK[type];
}

const clone = <T>(value: T): T => structuredClone(value);

function nextId(p: NOESISPipeline): string {
  let highest = -1;
  for (const n of p.nodes) {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `n${highest + 1}`;
}

const sameWithoutColumns = (a: PipelineNode, b: PipelineNode): boolean => {
  const names = new Set([...Object.keys(a.params), ...Object.keys(b.params)]);
  names.delete('columns');
  for (const name of names) {
    if (
      JSON.stringify(a.params[name]?.value ?? null) !==
      JSON.stringify(b.params[name]?.value ?? null)
    )
      return false;
  }
  return true;
};

function addNode(p: NOESISPipeline, op: Extract<PatchOp, { op: 'addNode' }>): void {
  const { type, params } = op.node;
  const node: PipelineNode = {
    id: '',
    type,
    params: Object.fromEntries(
      Object.entries(params).map(([name, value]) => [
        name,
        { value, source: 'suggested' as const },
      ]),
    ),
  };
  if (NODE_INFO[type].learns) node.fit_on = 'train';

  if (MERGEABLE.has(type) && Array.isArray(params['columns'])) {
    const existing = p.nodes.find((n) => n.type === type && sameWithoutColumns(n, node));
    const have = existing?.params['columns']?.value;
    if (existing && Array.isArray(have)) {
      const merged = [...new Set([...(have as string[]), ...(params['columns'] as string[])])];
      existing.params['columns'] = { value: merged, source: 'suggested' };
      return;
    }
  }

  node.id = nextId(p);
  let index: number;
  if (op.after !== undefined) {
    const at = p.nodes.findIndex((n) => n.id === op.after);
    if (at < 0) throw new Error(`There is no step "${op.after}" to add after`);
    index = at + 1;
  } else {
    let last = 0;
    p.nodes.forEach((n, i) => {
      if (RANK[n.type] <= RANK[type]) last = i;
    });
    index = last + 1;
  }
  const previous = p.nodes[index - 1];
  if (previous) {
    node.inputs = [previous.id];
    for (const later of p.nodes.slice(index)) {
      if (later.inputs?.includes(previous.id))
        later.inputs = later.inputs.map((i) => (i === previous.id ? node.id : i));
    }
  }
  p.nodes.splice(index, 0, node);
}

function removeNode(p: NOESISPipeline, id: string): void {
  const at = p.nodes.findIndex((n) => n.id === id);
  if (at < 0) throw new Error(`There is no step "${id}" to remove`);
  const [removed] = p.nodes.splice(at, 1) as [PipelineNode];
  const feeds = removed.inputs ?? [];
  for (const n of p.nodes) {
    if (n.inputs?.includes(id)) n.inputs = n.inputs.flatMap((i) => (i === id ? feeds : [i]));
    if (n.inputs?.length === 0) delete n.inputs;
  }
}

/** Applies a patch to a copy of the pipeline. The original is left as it was. */
export function applyPatch(pipeline: NOESISPipeline, patch: PatchOp[]): NOESISPipeline {
  const p = clone(pipeline);
  for (const op of patch) {
    switch (op.op) {
      case 'addNode':
        addNode(p, op);
        break;
      case 'removeNode':
        removeNode(p, op.node);
        break;
      case 'setParam': {
        const node = p.nodes.find((n) => n.id === op.node);
        if (!node) throw new Error(`There is no step "${op.node}" to change`);
        node.params[op.param] = { value: op.value, source: 'suggested' };
        break;
      }
      case 'setColumnRole': {
        const column = p.dataset.columns.find((c) => c.name === op.column);
        if (!column) throw new Error(`There is no column "${op.column}"`);
        column.role = op.role;
        break;
      }
      case 'setMetric':
        p.task.primaryMetric = op.metric;
        break;
    }
  }
  return p;
}

const describeValue = (value: unknown): string =>
  Array.isArray(value) ? value.map(String).join(', ') : String(value);

/** One plain line per change, for the before/after preview. */
export function describePatch(pipeline: NOESISPipeline, patch: PatchOp[]): string[] {
  const lines: string[] = [];
  for (const op of patch) {
    switch (op.op) {
      case 'addNode': {
        const { type, params } = op.node;
        const columns = Array.isArray(params['columns'])
          ? ` for ${describeValue(params['columns'])}`
          : '';
        const detail = ['strategy', 'method', 'kind', 'datePart', 'operator']
          .map((k) => params[k])
          .filter((v) => v !== undefined && v !== null)
          .map(describeValue)
          .join(', ');
        lines.push(
          `Add the step "${nodeSpec(type).label}"${columns}${detail ? ` (${detail})` : ''}`,
        );
        break;
      }
      case 'removeNode': {
        const node = pipeline.nodes.find((n) => n.id === op.node);
        lines.push(`Remove the step "${node ? nodeSpec(node.type).label : op.node}"`);
        break;
      }
      case 'setParam': {
        const node = pipeline.nodes.find((n) => n.id === op.node);
        const spec = node ? nodeSpec(node.type) : undefined;
        const label = spec?.params[op.param]?.label ?? op.param;
        lines.push(`Set "${label}" to ${describeValue(op.value)} in "${spec?.label ?? op.node}"`);
        break;
      }
      case 'setColumnRole':
        lines.push(
          op.role === 'exclude'
            ? `Leave "${op.column}" out of the model`
            : `Use "${op.column}" as ${op.role}`,
        );
        break;
      case 'setMetric':
        lines.push(`Judge the model by ${op.metric}`);
        break;
    }
  }
  return lines;
}
