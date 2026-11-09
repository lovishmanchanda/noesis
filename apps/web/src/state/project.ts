import type { DatasetProfile, EarlyRunResult, LoadSettings } from '@noesis/engine-client';
import type { Param } from '@noesis/schema';
import { create } from 'zustand';

export type Goal = 'number' | 'category' | 'groups';
export type Role = 'feature' | 'target' | 'exclude' | 'reference';
export type SplitStrategy = 'random' | 'stratified' | 'group' | 'time' | 'none';

export interface DatasetInfo {
  name: string;
  source: 'sample' | 'file';
  sampleId?: string;
  settings: LoadSettings;
  profile: DatasetProfile;
}

export interface TidyChoices {
  dropDuplicates: boolean;
  dropMissingTarget: boolean;
  dropColumns: string[];
}

export interface SplitChoices {
  ratios: [number, number, number];
  strategy: SplitStrategy;
  groupColumn: string | null;
  timeColumn: string | null;
}

/** Step types that learn from the training rows and come after the split. */
export const PREPARE_TYPES = [
  'impute',
  'handle_outliers',
  'derive_feature',
  'encode',
  'scale',
  'select_features',
  'reduce_dimensions',
] as const;
export type PrepareType = (typeof PREPARE_TYPES)[number];

/** A step the user added after the split. The builder puts it where its kind belongs. */
export interface PrepareStep {
  id: string;
  type: PrepareType;
  params: Record<string, Param>;
}

/** The model chosen on the Model screen: an algorithm and its settings. */
export interface ModelChoice {
  algorithm: string;
  /** Hyperparameters the user (or a preset) set. Everything else uses the registry default. */
  params: Record<string, Param>;
  preset: 'fast' | 'balanced' | 'accurate' | null;
}

/** How a model is checked while it is being chosen. The test rows are never used for this. */
export interface ValidationChoice {
  method: 'holdout' | 'kfold' | 'stratified_kfold';
  k: number;
}

export interface ProjectState {
  name: string;
  topic: string;
  goal: Goal | null;
  dataset: DatasetInfo | null;
  roles: Record<string, Role>;
  tidy: TidyChoices;
  split: SplitChoices;
  splitResult: EarlyRunResult | null;
  seed: number;
  /** The metric the model is judged by. Null means the default for the goal. */
  metric: string | null;
  /** Steps after the split: fill gaps, outliers, new columns, encodings, scaling, selection. */
  prepare: PrepareStep[];
  /** Fingerprints of suggestions the user dismissed. */
  dismissed: string[];
  model: ModelChoice | null;
  validation: ValidationChoice;
  /** The run chosen on the Compare screen as the one to test and export. */
  candidate: string | null;
}

export const DEFAULT_SPLIT: SplitChoices = {
  ratios: [0.7, 0.15, 0.15],
  strategy: 'random',
  groupColumn: null,
  timeColumn: null,
};
export const DEFAULT_TIDY: TidyChoices = {
  dropDuplicates: false,
  dropMissingTarget: false,
  dropColumns: [],
};

export const initialProject = (): ProjectState => ({
  name: 'Untitled project',
  topic: '',
  goal: null,
  dataset: null,
  roles: {},
  tidy: { ...DEFAULT_TIDY },
  split: { ...DEFAULT_SPLIT },
  splitResult: null,
  seed: 42,
  metric: null,
  prepare: [],
  dismissed: [],
  model: null,
  validation: { method: 'holdout', k: 5 },
  candidate: null,
});

interface ProjectActions {
  update: (patch: Partial<ProjectState>) => void;
  setRole: (column: string, role: Role) => void;
  reset: () => void;
  load: (state: ProjectState) => void;
}

export const useProject = create<ProjectState & ProjectActions>((set) => ({
  ...initialProject(),
  update: (patch) => set(patch),
  setRole: (column, role) => set((s) => ({ roles: { ...s.roles, [column]: role } })),
  reset: () => set(initialProject()),
  load: (state) => set(state),
}));
