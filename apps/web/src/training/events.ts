import type { RunError, TrainingEvent } from '@noesis/engine-client';

/** The picture of a run built from its events: everything the Train screen draws. */

export type NodeStatus = 'waiting' | 'running' | 'done' | 'cached' | 'failed';
export interface NodeView {
  id: string;
  type: string;
  status: NodeStatus;
  algorithm?: string;
  durationMs?: number;
}
export interface LayerSpec {
  units: number;
  activation: string;
}
export interface Structure {
  layers: LayerSpec[];
  inputUnits: number;
  outputUnits: number;
  paramCount: number;
}
export interface WeightLayer {
  meanAbs: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
  matrix: number[][];
}
export interface TreeNodeView {
  nodeId: number;
  parentId: number | null;
  side: 'left' | 'right' | null;
  feature: string | null;
  threshold: number | null;
  samples: number;
  impurity: number | null;
  value: number[];
  isLeaf: boolean;
  depth: number;
}
export interface CurvePoint {
  /** Epoch, boosting round or number of trees grown. */
  x: number;
  train: number | null;
  val: number | null;
}
export type CurveKind = 'loss' | 'score';

export interface VisualState {
  runId: string | null;
  status: 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  vizLevel: string;
  nodes: NodeView[];
  algorithm: string | null;
  structure: Structure | null;
  /** What the curve measures: a loss (lower is better) or a score (higher is better). */
  curveKind: CurveKind | null;
  curveLabel: string;
  curve: CurvePoint[];
  total: number | null;
  weights: { epoch: number; layers: WeightLayer[] } | null;
  trees: Record<number, TreeNodeView[]>;
  treeSummary: Record<number, { nodes: number; depth: number; leaves: number }>;
  importances: { feature: string; value: number | null }[] | null;
  coefficients: {
    coefficients: { feature: string; value: number | null }[];
    intercept: number | null;
    source: string;
  } | null;
  fitProgress: { iter: number; totalIter: number; converged: boolean | null } | null;
  earlyStop: { epoch: number; bestEpoch: number; reason: string } | null;
  diverged: boolean;
  error: RunError | null;
  elapsedMs: number;
  applied: number;
}

export function emptyVisual(): VisualState {
  return {
    runId: null,
    status: 'idle',
    vizLevel: 'full',
    nodes: [],
    algorithm: null,
    structure: null,
    curveKind: null,
    curveLabel: '',
    curve: [],
    total: null,
    weights: null,
    trees: {},
    treeSummary: {},
    importances: null,
    coefficients: null,
    fitProgress: null,
    earlyStop: null,
    diverged: false,
    error: null,
    elapsedMs: 0,
    applied: 0,
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Applies one event to the picture. It changes `state` in place and returns it, because a long
 * run applies thousands of events and copying every curve each time would be wasteful. Events of
 * a type the screen does not know are ignored, so a newer engine never breaks an older page.
 */
export function applyEvent(state: VisualState, e: TrainingEvent): VisualState {
  const d = e.data;
  state.elapsedMs = Math.max(state.elapsedMs, e.t);
  state.applied++;
  const node = (): NodeView | undefined => state.nodes.find((n) => n.id === e.node);
  switch (e.type) {
    case 'run_started': {
      const ids = (d['nodes'] as string[]) ?? [];
      Object.assign(state, emptyVisual(), {
        runId: e.runId,
        status: 'running',
        vizLevel: String(d['vizLevel'] ?? 'full'),
        nodes: ids.map((id) => ({ id, type: '', status: 'waiting' as NodeStatus })),
        applied: 1,
      });
      break;
    }
    case 'node_started': {
      const n = node();
      if (n) {
        n.status = 'running';
        n.type = String(d['type'] ?? '');
        if (typeof d['algorithm'] === 'string') {
          n.algorithm = d['algorithm'];
          state.algorithm = d['algorithm'];
        }
      }
      break;
    }
    case 'node_finished': {
      const n = node();
      if (n) {
        n.status = d['cacheHit'] ? 'cached' : 'done';
        n.durationMs = num(d['durationMs']) ?? 0;
      }
      break;
    }
    case 'node_failed': {
      const n = node();
      if (n) n.status = 'failed';
      state.error = (d['error'] as RunError | undefined) ?? state.error;
      break;
    }
    case 'model_structure': {
      if (Array.isArray(d['layers'])) {
        state.structure = {
          layers: d['layers'] as LayerSpec[],
          inputUnits: Number(d['inputUnits']),
          outputUnits: Number(d['outputUnits']),
          paramCount: Number(d['paramCount']),
        };
      }
      state.total = num(d['totalTrees']) ?? num(d['totalRounds']) ?? state.total;
      state.algorithm = String(d['algorithm'] ?? state.algorithm ?? '');
      break;
    }
    case 'epoch_end': {
      state.curveKind = 'loss';
      state.curveLabel = 'Loss by epoch';
      state.total = num(d['totalEpochs']);
      state.curve.push({
        x: Number(d['epoch']),
        train: num(d['trainLoss']),
        val: num(d['valLoss']),
      });
      break;
    }
    case 'boost_round': {
      state.curveKind = 'loss';
      state.curveLabel = 'Loss by boosting round';
      state.total = num(d['totalRounds']);
      state.curve.push({
        x: Number(d['round']),
        train: num(d['trainLoss']),
        val: num(d['valLoss']),
      });
      break;
    }
    case 'ensemble_progress': {
      state.curveKind = 'score';
      state.curveLabel = 'Score by number of trees';
      state.total = num(d['total']);
      state.curve.push({
        x: Number(d['done']),
        train: num(d['trainMetric']),
        val: num(d['valMetric']),
      });
      break;
    }
    case 'weights_snapshot':
      state.weights = { epoch: Number(d['epoch']), layers: d['layers'] as WeightLayer[] };
      break;
    case 'tree_started':
      state.trees[Number(d['treeId'])] = [];
      break;
    case 'tree_node_added': {
      const id = Number(d['treeId']);
      (state.trees[id] ??= []).push({
        nodeId: Number(d['nodeId']),
        parentId: num(d['parentId']),
        side: (d['side'] as 'left' | 'right' | null) ?? null,
        feature: (d['feature'] as string | null) ?? null,
        threshold: num(d['threshold']),
        samples: Number(d['samples']),
        impurity: num(d['impurity']),
        value: (d['value'] as number[]) ?? [],
        isLeaf: Boolean(d['isLeaf']),
        depth: Number(d['depth']),
      });
      break;
    }
    case 'tree_finished':
      state.treeSummary[Number(d['treeId'])] = {
        nodes: Number(d['nodes']),
        depth: Number(d['depth']),
        leaves: Number(d['leaves']),
      };
      break;
    case 'feature_importance':
      state.importances = d['importances'] as VisualState['importances'];
      break;
    case 'coef_update':
      state.coefficients = {
        coefficients: d['coefficients'] as { feature: string; value: number | null }[],
        intercept: num(d['intercept']),
        source: e.source,
      };
      break;
    case 'fit_progress':
      state.fitProgress = {
        iter: Number(d['iter']),
        totalIter: Number(d['totalIter']),
        converged: typeof d['converged'] === 'boolean' ? d['converged'] : null,
      };
      break;
    case 'early_stop':
      state.earlyStop = {
        epoch: Number(d['epoch']),
        bestEpoch: Number(d['bestEpoch']),
        reason: String(d['reason'] ?? ''),
      };
      break;
    case 'training_diverged':
      state.diverged = true;
      break;
    case 'run_finished':
      state.status = d['status'] as VisualState['status'];
      break;
    default:
      break;
  }
  return state;
}

/** The picture after the first `count` events. */
export function visualFromEvents(
  events: readonly TrainingEvent[],
  count = events.length,
): VisualState {
  const state = emptyVisual();
  for (let i = 0; i < Math.min(count, events.length); i++)
    applyEvent(state, events[i] as TrainingEvent);
  return state;
}

/** Events that carry something to watch, as opposed to bookkeeping. Slow motion paces these. */
export const ANIMATED = new Set([
  'epoch_end',
  'boost_round',
  'ensemble_progress',
  'weights_snapshot',
  'tree_node_added',
  'coef_update',
]);

/** Events that close one step of training, for "next epoch" in step mode. */
export const EPOCH_EVENTS = new Set([
  'epoch_end',
  'boost_round',
  'ensemble_progress',
  'fit_progress',
  'coef_update',
]);

/** Events the user can lose without harm (see docs/design/training-events.md). */
export const DROPPABLE = new Set([
  'batch_end',
  'weights_snapshot',
  'activation_sample',
  'sample_rows',
  'heartbeat',
]);
