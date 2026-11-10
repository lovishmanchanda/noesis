import {
  DEFAULT_THRESHOLDS,
  evaluateRules,
  type PatchOp,
  type RuleContext,
  type Suggestion,
  type SuggestionAction,
} from '@noesis/rules';
import { useMemo } from 'react';
import { create } from 'zustand';
import { applyToProject, editableOf, type Editable } from '../pipeline/apply';
import { buildTrainingPipeline } from '../pipeline/build';
import { summaryOf, type RunRecord } from '../runs/records';
import { useRuns } from '../runs/store';
import { reloadWithSettings } from './actions';
import { useProject, type ProjectState } from './project';
import { requestRun, useCurrentHashes } from './run';
import { useUi, type Mode } from './ui';

/** What the rules see: the file as loaded, the training rows once split, and the pipeline. */
const BASELINES = ['linear_regression', 'logistic_regression'];

export function ruleContext(
  project: ProjectState,
  mode: Mode,
  extra: { runs?: RunRecord[]; hashes?: Record<string, string> } = {},
): RuleContext | null {
  if (!project.dataset || !project.goal) return null;
  const { pipeline } = buildTrainingPipeline(project);
  return {
    ...(extra.hashes ? { hashes: extra.hashes } : {}),
    raw: project.dataset.profile,
    ...(project.splitResult?.trainProfile ? { train: project.splitResult.trainProfile } : {}),
    pipeline,
    task: pipeline.task.type,
    runs: (extra.runs ?? []).map((r) => summaryOf(r, BASELINES)),
    testUsed: false,
    settings: { mode, disabledGroups: [], engine: 'browser' },
    thresholds: DEFAULT_THRESHOLDS,
  };
}

export function suggestionsFor(
  project: ProjectState,
  mode: Mode,
  extra: { runs?: RunRecord[]; hashes?: Record<string, string> } = {},
): Suggestion[] {
  const ctx = ruleContext(project, mode, extra);
  return ctx ? evaluateRules(ctx) : [];
}

/** All suggestions for the project as it is now. Recomputed when the project or mode changes. */
export function useSuggestions(): Suggestion[] {
  const project = useProject();
  const mode = useUi((s) => s.mode);
  const runs = useRuns((s) => s.runs);
  const hashes = useCurrentHashes((s) => s.hashes);
  return useMemo(
    () => suggestionsFor(project, mode, { runs, hashes }),
    // The rules read these parts of the project only.
    [
      project.dataset,
      project.goal,
      project.roles,
      project.tidy,
      project.split,
      project.metric,
      project.prepare,
      project.splitResult,
      project.model,
      project.validation,
      runs,
      hashes,
      mode,
    ],
  );
}

interface Snapshot {
  label: string;
  before: Editable;
}
interface History {
  stack: Snapshot[];
  /** Text for the "Applied ..." bar, until the next action. */
  last: string | null;
}
export const useHistory = create<History>(() => ({ stack: [], last: null }));
const KEEP = 30;

async function commit(next: Editable, reload: boolean): Promise<void> {
  useProject.setState({
    roles: next.roles,
    tidy: next.tidy,
    split: next.split,
    metric: next.metric,
    prepare: next.prepare,
    model: next.model,
  });
  const hadRun = useProject.getState().splitResult !== null;
  if (reload) await reloadWithSettings(next.loadSettings);
  if (hadRun || reload) await requestRun();
}

/** Notes the current choices so one Undo can bring them back. Call it just before an edit. */
export function recordEdit(label: string): void {
  const before = editableOf(useProject.getState());
  useHistory.setState((h) => ({
    stack: [...h.stack, { label, before }].slice(-KEEP),
    last: label,
  }));
}

/** Applies a patch as one step that one Undo puts back. */
export async function applyPatchAs(label: string, patch: PatchOp[]): Promise<void> {
  const project = useProject.getState();
  const applied = applyToProject(project, patch);
  const before = editableOf(project);
  useHistory.setState((h) => ({
    stack: [...h.stack, { label, before }].slice(-KEEP),
    last: label,
  }));
  await commit(applied.changes, applied.reload);
}

/** Applies one way of acting on a suggestion. */
export async function applyAction(
  _suggestion: Suggestion,
  action: SuggestionAction,
): Promise<void> {
  await applyPatchAs(action.label, action.patch);
}

export async function undoLast(): Promise<void> {
  const { stack } = useHistory.getState();
  const snapshot = stack[stack.length - 1];
  if (!snapshot) return;
  const current = editableOf(useProject.getState());
  const reload =
    JSON.stringify(current.loadSettings) !== JSON.stringify(snapshot.before.loadSettings);
  useHistory.setState({
    stack: stack.slice(0, -1),
    last: null,
  });
  await commit(snapshot.before, reload);
}

export function dismiss(fingerprint: string): void {
  const { dismissed } = useProject.getState();
  if (!dismissed.includes(fingerprint))
    useProject.setState({ dismissed: [...dismissed, fingerprint] });
}

export function restoreDismissed(fingerprint: string): void {
  useProject.setState({
    dismissed: useProject.getState().dismissed.filter((f) => f !== fingerprint),
  });
}

export function clearHistory(): void {
  useHistory.setState({ stack: [], last: null });
}
