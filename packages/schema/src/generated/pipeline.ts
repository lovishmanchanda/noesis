/* Generated from pipeline.schema.json. Do not edit by hand: run `pnpm --filter @noesis/schema generate`. */

export type StorageRef = string;
export type Node = {
  id: string;
  type:
    | 'load_csv'
    | 'drop_columns'
    | 'drop_duplicates'
    | 'filter_rows'
    | 'impute'
    | 'handle_outliers'
    | 'encode'
    | 'scale'
    | 'derive_feature'
    | 'select_features'
    | 'reduce_dimensions'
    | 'split'
    | 'model'
    | 'tune'
    | 'validate'
    | 'test'
    | 'stability_check'
    | 'export_model';
  inputs?: string[];
  fit_on?: 'train';
  params: {
    [k: string]: Param;
  };
} & {
  id: string;
  type:
    | 'load_csv'
    | 'drop_columns'
    | 'drop_duplicates'
    | 'filter_rows'
    | 'impute'
    | 'handle_outliers'
    | 'encode'
    | 'scale'
    | 'derive_feature'
    | 'select_features'
    | 'reduce_dimensions'
    | 'split'
    | 'model'
    | 'tune'
    | 'validate'
    | 'test'
    | 'stability_check'
    | 'export_model';
  inputs?: string[];
  fit_on?: 'train';
  params: {
    [k: string]: Param;
  };
};

/**
 * Draft 0.1. Structural checks only. Graph rules (acyclic, leakage, single split, test-once) are enforced by the engine, see pipeline-schema.md.
 */
export interface NOESISPipeline {
  schemaVersion: '0.1';
  project: {
    name: string;
    topic?: string;
    seed: number;
    mode: 'guided' | 'expert';
  };
  dataset: {
    source: {
      kind: 'local-file';
      name: string;
      ref?: StorageRef;
    };
    rows?: number;
    columns: {
      name: string;
      dtype: 'int' | 'float' | 'bool' | 'category' | 'string' | 'datetime';
      role: 'feature' | 'target' | 'exclude' | 'reference';
    }[];
  };
  task: {
    type: 'regression' | 'classification' | 'clustering' | 'forecasting';
    primaryMetric: string;
  };
  /**
   * @minItems 1
   */
  nodes: [Node, ...Node[]];
}
export interface Param {
  /**
   * null means the parameter is not in use.
   */
  value: string | number | boolean | unknown[] | {} | null;
  source: 'default' | 'user' | 'suggested';
}
