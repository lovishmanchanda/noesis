import { datasetKey, nodeHashes, nodeStatuses, type NodeStatus } from '@noesis/schema';
import { create } from 'zustand';
import { buildEarlyPipeline, buildTrainingPipeline } from '../pipeline/build';
import { getEngine } from './engine';
import { useProject } from './project';

/** Where the last run of the pipeline stands. Not saved: it describes this visit only. */
interface RunState {
  /** Hash of each step when the pipeline last ran successfully. */
  hashes: Record<string, string>;
  running: boolean;
  error: string | null;
}

export const useRun = create<RunState>(() => ({ hashes: {}, running: false, error: null }));

let key: { bytes: ArrayBuffer; hash: string } | null = null;
let fileBytes: () => ArrayBuffer | null = () => null;

/** Lets the run code ask for the open file's bytes without importing the actions module. */
export function setFileSource(source: () => ArrayBuffer | null): void {
  fileBytes = source;
}

/** The fingerprint of the open file. Computed once per file. */
export async function getDataKey(): Promise<string> {
  const bytes = fileBytes();
  if (!bytes) return 'no-file';
  if (key?.bytes === bytes) return key.hash;
  const hash = await datasetKey(bytes);
  key = { bytes, hash };
  return hash;
}

let inFlight: Promise<void> | null = null;
let again = false;

async function runOnce(): Promise<void> {
  const project = useProject.getState();
  const { pipeline, issues } = buildEarlyPipeline(project);
  if (issues.length > 0)
    throw new Error(issues[0]?.message ?? 'The choices do not make a valid pipeline');
  const hashes = await nodeHashes(pipeline, await getDataKey());
  const result = await getEngine().runEarly(JSON.stringify(pipeline), hashes);
  useProject.setState({ splitResult: result });
  useRun.setState({ hashes });
}

/**
 * Runs the pipeline for the current choices. Calls made while a run is in progress are merged into
 * one more run afterwards, so a burst of edits never queues up a pile of runs.
 */
export function requestRun(): Promise<void> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  useRun.setState({ running: true, error: null });
  inFlight = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } catch (e) {
      useRun.setState({ error: e instanceof Error ? e.message : 'The steps could not be run.' });
      throw e;
    } finally {
      inFlight = null;
      useRun.setState({ running: false });
    }
  })();
  return inFlight;
}

/** The hash of every step as the pipeline stands now. One subscriber keeps it up to date. */
export const useCurrentHashes = create<{ hashes: Record<string, string> }>(() => ({ hashes: {} }));

let hashing = 0;
/** Recomputes the current hashes whenever the project changes. Returns a function that stops it. */
export function startHashing(): () => void {
  const update = (): void => {
    const project = useProject.getState();
    if (!project.dataset || !project.goal) return useCurrentHashes.setState({ hashes: {} });
    const ticket = ++hashing;
    const { pipeline } = buildTrainingPipeline(project);
    void getDataKey()
      .then((k) => nodeHashes(pipeline, k))
      .then((h) => ticket === hashing && useCurrentHashes.setState({ hashes: h }))
      .catch(() => ticket === hashing && useCurrentHashes.setState({ hashes: {} }));
  };
  update();
  return useProject.subscribe(update);
}

/** Status of every step: done, outdated (it changed since it last ran) or todo. */
export function useStepStatuses(): {
  current: Record<string, string>;
  status: Record<string, NodeStatus>;
} {
  const current = useCurrentHashes((s) => s.hashes);
  const last = useRun((s) => s.hashes);
  return { current, status: nodeStatuses(current, last) };
}
