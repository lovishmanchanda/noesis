import type { DatasetProfile } from '@noesis/engine-client';
import type { NOESISPipeline, Param } from '@noesis/schema';
import type { TaskType } from '@noesis/registry';
import type thresholds from './thresholds.json';

export type Thresholds = typeof thresholds;
export type Role = 'feature' | 'target' | 'exclude' | 'reference';
export type ParamValue = Param['value'];
export type NodeType = NOESISPipeline['nodes'][number]['type'];

/** `info` and `tip` are quiet, `warn` should be read, `alert` says a result cannot be trusted. */
export type Severity = 'info' | 'tip' | 'warn' | 'alert';

/** The wizard stage a suggestion belongs to (the screen that shows it). */
export type Stage =
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

export type Evidence = Record<string, number | string | boolean | null>;

/** A small closed set of edits, so every suggestion can be previewed and undone. */
export type PatchOp =
  | {
      op: 'addNode';
      node: { type: NodeType; params: Record<string, ParamValue> };
      /** Place the node after this node. Left out, the node goes where its type belongs. */
      after?: string;
    }
  | { op: 'setParam'; node: string; param: string; value: ParamValue }
  | { op: 'removeNode'; node: string }
  | { op: 'setColumnRole'; column: string; role: Role }
  | { op: 'setMetric'; metric: string };

export interface SuggestionAction {
  label: string;
  patch: PatchOp[];
}

export interface Suggestion {
  ruleId: string;
  stage: Stage;
  severity: Severity;
  priority: number;
  target: { kind: 'dataset' | 'column' | 'model' | 'run'; name?: string };
  message: string;
  why: string;
  evidence: Evidence;
  /** Ways to act on it. Empty when the suggestion is advice only. */
  actions: SuggestionAction[];
  /** Opens this stage instead of changing the pipeline. */
  goTo?: Stage;
  /** Same rule and target, and the evidence put in broad buckets. Used to remember dismissals. */
  fingerprint: string;
  /** Set when a higher-priority suggestion edits the same setting. */
  alternativeTo?: string;
}

/** What the rules know about a finished training run (see docs/design/hashing-and-runs.md). */
export interface RunSummary {
  id: string;
  /** Id of the model node that was trained. */
  modelNode: string;
  algorithm: string;
  metric: string;
  higherIsBetter: boolean;
  trainScore: number | null;
  validationScore: number | null;
  /** The settings the model had when it was trained. A run only counts while they still match. */
  settings: Record<string, unknown>;
  /** A simple first model every later model has to beat. */
  baseline: boolean;
  /** Per-epoch losses, for the iterative models. */
  trainLoss?: number[];
  validationLoss?: number[];
  /** `failed` runs have no scores but can still explain what went wrong. */
  status?: 'succeeded' | 'failed';
  errorCode?: string;
  /** How an iterative fit ended: `max_epochs` (used them all) or `early_stop`. */
  stopped?: string;
  /** Hash of the model step when it ran. A run only counts while the steps before it are unchanged. */
  nodeHash?: string;
}

export interface RuleSettings {
  mode: 'guided' | 'expert';
  /** Rule groups switched off by the user (the letter of the rule id: D, T, C, S, M, R). */
  disabledGroups: string[];
  engine: 'browser' | 'companion';
}

export interface RuleContext {
  /** The file as loaded. Facts about the file (duplicates, identifiers, size) come from here. */
  raw: DatasetProfile;
  /**
   * The profile of the training rows only, once the data is split. Every rule that chooses a
   * method from statistics (fill values, encodings, correlations) must read this one, so no
   * number from the test rows reaches a suggestion.
   */
  train?: DatasetProfile;
  pipeline: NOESISPipeline;
  /** Current hash of each step (see hashing-and-runs.md), used to tell whether a run is still current. */
  hashes?: Record<string, string>;
  task: TaskType;
  runs: RunSummary[];
  /** Set once the test set has been used. */
  testUsed: boolean;
  settings: RuleSettings;
  thresholds: Thresholds;
}

export interface Rule {
  id: string;
  group: 'D' | 'T' | 'C' | 'S' | 'M' | 'R';
  stage: Stage;
  severity: Severity;
  priority: number;
  appliesTo: readonly TaskType[];
  /** Which profile the rule reads. A rule on `train` waits until the data is split. */
  uses: 'raw' | 'train' | 'none';
  evaluate(ctx: RuleContext): Suggestion[];
}

export type SuggestionState = 'open' | 'applied' | 'dismissed' | 'stale';
