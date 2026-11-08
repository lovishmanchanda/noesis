/**
 * Node types of the pipeline graph (see docs/design/pipeline-schema.md and param-definitions.md).
 * `learns` marks steps that compute statistics from data. They must run after the split and
 * declare `fit_on: "train"`, otherwise they could see test rows.
 */
export const NODE_INFO = {
  load_csv: { group: 'data', learns: false },
  drop_columns: { group: 'data', learns: false },
  drop_duplicates: { group: 'data', learns: false },
  filter_rows: { group: 'data', learns: false },
  impute: { group: 'clean', learns: true },
  handle_outliers: { group: 'clean', learns: true },
  encode: { group: 'feature', learns: true },
  scale: { group: 'feature', learns: true },
  derive_feature: { group: 'feature', learns: false },
  select_features: { group: 'feature', learns: true },
  reduce_dimensions: { group: 'feature', learns: true },
  split: { group: 'split', learns: false },
  model: { group: 'model', learns: false },
  tune: { group: 'model', learns: false },
  validate: { group: 'evaluate', learns: false },
  test: { group: 'evaluate', learns: false },
  stability_check: { group: 'evaluate', learns: false },
  export_model: { group: 'output', learns: false },
} as const;

export type NodeType = keyof typeof NODE_INFO;
export type NodeGroup = (typeof NODE_INFO)[NodeType]['group'];

export const NODE_TYPES = Object.keys(NODE_INFO) as NodeType[];

export function isNodeType(value: string): value is NodeType {
  return Object.prototype.hasOwnProperty.call(NODE_INFO, value);
}

/** True for steps that learn from data and therefore need `fit_on: "train"`. */
export function learnsFromData(type: NodeType): boolean {
  return NODE_INFO[type].learns;
}

/** Tasks the pipeline supports. Clustering has no target column. */
export const TASK_TYPES = ['regression', 'classification', 'clustering', 'forecasting'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** Column types that cannot reach a model without being encoded or dropped. */
export const NON_NUMERIC_DTYPES = ['category', 'string', 'datetime'] as const;
