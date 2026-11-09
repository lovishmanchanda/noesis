import { CancelledError } from '@noesis/engine-client';
import { nodeHashes } from '@noesis/schema';
import { buildTrainingPipeline } from '../pipeline/build';
import {
  decimateEvents,
  finishedRecord,
  newRunId,
  startedRecord,
  type RunRecord,
} from '../runs/records';
import { saveRun, useRuns } from '../runs/store';
import { getEngine } from '../state/engine';
import { useProject } from '../state/project';
import { getDataKey } from '../state/run';
import { defaultViz, memoryGuard, type Guard } from './guard';
import { beginRun, finishRun, pushEvents, useTraining } from './store';

/** Everything to check before a run: the memory guard, and the problems of the pipeline itself. */
export function preflight(): { guard: Guard; problem: string | null } {
  const project = useProject.getState();
  if (!project.model)
    return {
      guard: { estimateMB: 0, blocking: null, warning: null },
      problem: 'Choose a model first.',
    };
  const { issues } = buildTrainingPipeline(project);
  const output = project.splitResult?.outputProfile ?? project.splitResult?.trainProfile;
  const rows = project.splitResult?.rows['train'] ?? 0;
  const columns = Math.max(
    1,
    (output?.columns ?? []).filter((c) => (project.roles[c.name] ?? 'feature') === 'feature')
      .length,
  );
  const epochs = project.model.params['epochs']?.value;
  const guard = memoryGuard(rows, columns, project.model.algorithm, {
    ...(typeof epochs === 'number' ? { epochs } : {}),
    ...(project.validation.method !== 'holdout' ? { folds: project.validation.k } : {}),
  });
  return { guard, problem: issues[0]?.message ?? guard.blocking };
}

/** An earlier succeeded run of exactly this pipeline on this file, if there is one. */
export async function findDuplicate(): Promise<RunRecord | null> {
  const project = useProject.getState();
  const { pipeline } = buildTrainingPipeline(project);
  const hashes = await nodeHashes(pipeline, await getDataKey());
  const last = pipeline.nodes[pipeline.nodes.length - 1];
  if (!last) return null;
  const hash = hashes[last.id];
  return (
    useRuns
      .getState()
      .runs.find(
        (r) =>
          r.status === 'succeeded' && r.pipelineHash === hash && r.seed === pipeline.project.seed,
      ) ?? null
  );
}

/**
 * Trains the chosen model. Events stream into the training store as they arrive; when the run ends
 * its record is saved with a thinned copy of the events, so it can be replayed later.
 */
export async function startTraining(label?: string): Promise<RunRecord> {
  const project = useProject.getState();
  if (useTraining.getState().running) throw new Error('A model is already training.');
  const { problem } = preflight();
  if (problem) throw new Error(problem);
  const { pipeline } = buildTrainingPipeline(project);
  const hashes = await nodeHashes(pipeline, await getDataKey());
  const rows = project.dataset?.profile.rows ?? 0;
  const viz =
    useTraining.getState().viz === 'light' && rows <= 50_000 ? 'light' : useTraining.getState().viz;
  const runId = newRunId();
  const number = useRuns.getState().runs.length + 1;
  const started = startedRecord({
    runId,
    pipeline,
    nodeHashes: hashes,
    modelNode: 'm1',
    dataset: { name: project.dataset?.name ?? '', fingerprint: await getDataKey(), rows },
    primaryMetric: pipeline.task.primaryMetric,
    vizLevel: viz,
    label: label ?? `${project.model?.algorithm.replaceAll('_', ' ') ?? 'model'} #${number}`,
  });
  beginRun(runId, viz);
  await saveRun(started);
  let outcome;
  try {
    outcome = await getEngine().train(
      { pipeline: JSON.stringify(pipeline), hashes, runId, viz },
      pushEvents,
    );
  } catch (error) {
    outcome =
      error instanceof CancelledError
        ? { status: 'cancelled' as const, durationMs: 0 }
        : {
            status: 'failed' as const,
            durationMs: 0,
            error: {
              code: 'E_ENGINE',
              message: error instanceof Error ? error.message : 'The run failed.',
              hint: 'The details are in the log.',
            },
          };
  }
  finishRun(outcome);
  const done = finishedRecord(started, outcome, useTraining.getState().events.length);
  await saveRun(done, decimateEvents(useTraining.getState().events));
  return done;
}

/** Stops the run in progress. The run ends as cancelled, and the engine is ready again. */
export async function stopTraining(): Promise<void> {
  await getEngine().cancel();
}

/** What a good default detail level is for the open file. */
export function suggestedViz(): ReturnType<typeof defaultViz> {
  return defaultViz(useProject.getState().splitResult?.rows['train'] ?? 0);
}
