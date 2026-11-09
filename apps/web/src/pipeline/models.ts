import type { Param } from '@noesis/schema';
import type { ModelChoice, Goal } from '../state/project';

export type Preset = 'fast' | 'balanced' | 'accurate';

export interface ModelInfo {
  id: string;
  name: string;
  /** One line on what it is good at. */
  strength: string;
  /** One line on the data size and shape it suits. */
  suits: string;
  /** What the Train screen can show while it learns. */
  watch: string;
  /** A simple first model to measure the others against. */
  baseline: boolean;
  tasks: readonly ('regression' | 'classification')[];
  presets: Record<Preset, Record<string, Param['value']>>;
}

const same = (v: Record<string, Param['value']>): ModelInfo['presets'] => ({
  fast: v,
  balanced: v,
  accurate: v,
});

/** The models in the first release. Each preset fills in a handful of settings. */
export const MODELS: ModelInfo[] = [
  {
    id: 'linear_regression',
    name: 'Linear regression',
    strength: 'Fits a straight-line relationship. Fast, and easy to read.',
    suits: 'Any size. A good first model for predicting a number.',
    watch: 'The weight of each column.',
    baseline: true,
    tasks: ['regression'],
    presets: same({}),
  },
  {
    id: 'logistic_regression',
    name: 'Logistic regression',
    strength: 'Draws a straight boundary between classes. Fast, and gives probabilities.',
    suits: 'Any size. A good first model for predicting a category.',
    watch: 'The weight of each column.',
    baseline: true,
    tasks: ['classification'],
    presets: {
      fast: { C: 0.1, max_iter: 100 },
      balanced: { C: 1, max_iter: 200 },
      accurate: { C: 10, max_iter: 500 },
    },
  },
  {
    id: 'ridge',
    name: 'Ridge regression',
    strength: 'Linear regression that resists overfitting when columns overlap.',
    suits: 'Any size, especially many related columns.',
    watch: 'The weight of each column.',
    baseline: false,
    tasks: ['regression'],
    presets: { fast: { alpha: 10 }, balanced: { alpha: 1 }, accurate: { alpha: 0.1 } },
  },
  {
    id: 'random_forest',
    name: 'Random forest',
    strength: 'Many decision trees that vote. Strong on mixed, messy tables.',
    suits: 'Up to a few hundred thousand rows. Needs no scaling.',
    watch: 'Trees being added, and the first trees themselves.',
    baseline: false,
    tasks: ['regression', 'classification'],
    presets: {
      fast: { n_estimators: 30, max_depth: 8 },
      balanced: { n_estimators: 100, max_depth: null },
      accurate: { n_estimators: 300, max_depth: null },
    },
  },
  {
    id: 'gradient_boosting',
    name: 'Gradient boosting (XGBoost)',
    strength:
      'Trees added one at a time, each fixing the last one’s mistakes. Often the most accurate on tables.',
    suits: 'Thousands to hundreds of thousands of rows.',
    watch: 'The loss after every round.',
    baseline: false,
    tasks: ['regression', 'classification'],
    presets: {
      fast: { n_estimators: 50, learning_rate: 0.2, max_depth: 3 },
      balanced: { n_estimators: 100, learning_rate: 0.1, max_depth: 3 },
      accurate: { n_estimators: 300, learning_rate: 0.05, max_depth: 5 },
    },
  },
  {
    id: 'mlp',
    name: 'Neural network',
    strength: 'Layers of units that learn patterns. Can model curved relationships.',
    suits: 'Thousands of rows or more, on scaled columns. Slower in the browser than the others.',
    watch: 'The layers, how strong each connection is, and the loss after every epoch.',
    baseline: false,
    tasks: ['regression', 'classification'],
    presets: {
      fast: { hidden_layers: [32], epochs: 30 },
      balanced: { hidden_layers: [64, 32], epochs: 100 },
      accurate: { hidden_layers: [128, 64, 32], epochs: 200 },
    },
  },
];

export const modelInfo = (id: string): ModelInfo | undefined => MODELS.find((m) => m.id === id);

const TASK = { number: 'regression', category: 'classification' } as const;

/** The models that suit what the user wants to find out. Grouping rows has none in this release. */
export function modelsFor(goal: Goal | null): ModelInfo[] {
  if (goal === null || goal === 'groups') return [];
  return MODELS.filter((m) => m.tasks.includes(TASK[goal]));
}

export const asParams = (
  values: Record<string, Param['value']>,
  source: Param['source'],
): Record<string, Param> =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, source }]));

/** A model with the settings of a preset, written as suggestions. */
export function choose(algorithm: string, preset: Preset | null = 'balanced'): ModelChoice {
  const info = modelInfo(algorithm);
  return {
    algorithm,
    preset,
    params: preset && info ? asParams(info.presets[preset], 'suggested') : {},
  };
}
