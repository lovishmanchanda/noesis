import type { DatasetProfile, EarlyRunResult, LoadSettings } from '@noesis/engine-client';
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
