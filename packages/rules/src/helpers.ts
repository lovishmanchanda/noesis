import type { ColumnProfile, DatasetProfile } from '@noesis/engine-client';
import type { NOESISPipeline, PipelineNode } from '@noesis/schema';
import type {
  Evidence,
  Role,
  Rule,
  RuleContext,
  Severity,
  Suggestion,
  SuggestionAction,
} from './types';

export const TREE_MODELS = ['decision_tree', 'random_forest', 'gradient_boosting'] as const;
/** Models whose results change when columns have very different ranges. */
export const SCALE_SENSITIVE = [
  'linear_regression',
  'ridge',
  'lasso',
  'logistic_regression',
  'knn',
  'svm',
  'mlp',
  'kmeans',
  'dbscan',
  'hierarchical',
] as const;
export const BASELINES = ['linear_regression', 'logistic_regression'] as const;

export const NUMERIC = ['int', 'float'] as const;
export const isNumeric = (c: ColumnProfile): boolean => c.dtype === 'int' || c.dtype === 'float';
export const isTextual = (c: ColumnProfile): boolean =>
  c.dtype === 'category' || c.dtype === 'string' || c.dtype === 'bool';

export function nodesOfType(p: NOESISPipeline, type: PipelineNode['type']): PipelineNode[] {
  return p.nodes.filter((n) => n.type === type);
}

export function paramValue(node: PipelineNode, name: string): unknown {
  return node.params[name]?.value;
}

/** The columns a step lists, or null when it lists none (some steps then mean "all"). */
export function listedColumns(node: PipelineNode): string[] | null {
  const value = paramValue(node, 'columns');
  return Array.isArray(value) ? (value as string[]) : null;
}

export function roleOf(p: NOESISPipeline, column: string): Role | undefined {
  return p.dataset.columns.find((c) => c.name === column)?.role;
}

export function isDropped(p: NOESISPipeline, column: string): boolean {
  return nodesOfType(p, 'drop_columns').some((n) => listedColumns(n)?.includes(column));
}

/** True when a step of this type already names the column. */
export function covers(p: NOESISPipeline, type: PipelineNode['type'], column: string): boolean {
  return nodesOfType(p, type).some((n) => listedColumns(n)?.includes(column));
}

export function targetName(p: NOESISPipeline): string | undefined {
  return p.dataset.columns.find((c) => c.role === 'target')?.name;
}

/** Columns that will reach a model: not the target, not left out, not removed by a step. */
export function featureColumns(profile: DatasetProfile, p: NOESISPipeline): ColumnProfile[] {
  return profile.columns.filter(
    (c) => (roleOf(p, c.name) ?? 'feature') === 'feature' && !isDropped(p, c.name),
  );
}

export function splitNode(p: NOESISPipeline): PipelineNode | undefined {
  return nodesOfType(p, 'split')[0];
}

export function splitStrategy(p: NOESISPipeline): string {
  const node = splitNode(p);
  const value = node ? paramValue(node, 'strategy') : undefined;
  return typeof value === 'string' ? value : 'random';
}

export function modelNodes(p: NOESISPipeline): PipelineNode[] {
  return nodesOfType(p, 'model');
}

export function algorithmOf(node: PipelineNode): string | undefined {
  const value = paramValue(node, 'algorithm');
  return typeof value === 'string' ? value : undefined;
}

/** Nodes on the way from the source to this node, this node excluded. */
export function upstream(p: NOESISPipeline, nodeId: string): PipelineNode[] {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const stack = [...(byId.get(nodeId)?.inputs ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(byId.get(id)?.inputs ?? []));
  }
  return p.nodes.filter((n) => seen.has(n.id));
}

export const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** Puts a share in a bucket (0.38 with width 0.1 gives "0.3"), for the dismissal fingerprint. */
export function bucket(value: number | null | undefined, width = 0.1): string {
  if (value === null || value === undefined) return 'none';
  const scaled = Math.floor(Math.round((value / width) * 1e6) / 1e6);
  return String(Math.round(scaled * width * 1e6) / 1e6);
}

export interface Draft {
  target: Suggestion['target'];
  message: string;
  why: string;
  evidence: Evidence;
  actions?: SuggestionAction[];
  goTo?: Suggestion['goTo'];
  /** Evidence reduced to buckets. A dismissal is forgotten only when this changes. */
  buckets?: string;
  severity?: Severity;
}

export function suggest(
  rule: Pick<Rule, 'id' | 'stage' | 'severity' | 'priority'>,
  draft: Draft,
): Suggestion {
  const name = draft.target.name ?? '-';
  return {
    ruleId: rule.id,
    stage: rule.stage,
    severity: draft.severity ?? rule.severity,
    priority: rule.priority,
    target: draft.target,
    message: draft.message,
    why: draft.why,
    evidence: draft.evidence,
    actions: draft.actions ?? [],
    ...(draft.goTo ? { goTo: draft.goTo } : {}),
    fingerprint: `${rule.id}|${name}|${draft.buckets ?? ''}`,
  };
}

/** The profile a rule reads, or undefined when it is not available yet. */
export function profileFor(rule: Rule, ctx: RuleContext): DatasetProfile | undefined {
  if (rule.uses === 'train') return ctx.train;
  return ctx.raw;
}
