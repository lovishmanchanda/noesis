import { create } from 'zustand';
import { getKv } from '../state/persist';
import type { RunRecord } from './records';
import type { TrainingEvent } from '@noesis/engine-client';

const INDEX = 'runs:index';
const recordKey = (id: string): string => `run:${id}`;
const eventsKey = (id: string): string => `events:${id}`;
/** The newest runs kept besides the ones marked as kept. */
export const KEEP_RECENT = 50;

interface RunsState {
  runs: RunRecord[];
  loaded: boolean;
}
export const useRuns = create<RunsState>(() => ({ runs: [], loaded: false }));

async function writeIndex(runs: RunRecord[]): Promise<void> {
  await getKv().set(
    INDEX,
    runs.map((r) => r.runId),
  );
}

/**
 * Reads the saved runs. A run still marked `running` belongs to a tab that was closed or crashed,
 * so it is marked `interrupted`; nothing resumes, and the prepared steps are reused on the next run.
 */
export async function loadRuns(): Promise<void> {
  const kv = getKv();
  try {
    const ids = (await kv.get<string[]>(INDEX)) ?? [];
    const loaded = (await Promise.all(ids.map((id) => kv.get<RunRecord>(recordKey(id))))).filter(
      (r): r is RunRecord => r !== undefined,
    );
    const runs: RunRecord[] = [];
    for (const r of loaded) {
      if (r.status === 'running') {
        const fixed: RunRecord = { ...r, status: 'interrupted' };
        await kv.set(recordKey(r.runId), fixed);
        runs.push(fixed);
      } else runs.push(r);
    }
    useRuns.setState({ runs, loaded: true });
  } catch {
    useRuns.setState({ runs: [], loaded: true });
  }
}

/** Saves a record, adding it to the list if it is new. */
export async function saveRun(record: RunRecord, events?: TrainingEvent[]): Promise<void> {
  const kv = getKv();
  const known = useRuns.getState().runs.some((r) => r.runId === record.runId);
  const runs = known
    ? useRuns.getState().runs.map((r) => (r.runId === record.runId ? record : r))
    : [...useRuns.getState().runs, record];
  useRuns.setState({ runs });
  try {
    await kv.set(recordKey(record.runId), record);
    if (events) await kv.set(eventsKey(record.runId), events);
    await writeIndex(runs);
  } catch {
    /* The run is still in memory for this visit; the save indicator already warns about storage. */
  }
  await prune();
}

/** Drops the oldest runs beyond the limit, except runs the user kept. */
export async function prune(limit = KEEP_RECENT): Promise<void> {
  const { runs } = useRuns.getState();
  const recent = [...runs]
    .filter((r) => !r.kept)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const drop = new Set(recent.slice(limit).map((r) => r.runId));
  if (drop.size === 0) return;
  const next = runs.filter((r) => !drop.has(r.runId));
  useRuns.setState({ runs: next });
  const kv = getKv();
  try {
    for (const id of drop) {
      await kv.del(recordKey(id));
      await kv.del(eventsKey(id));
    }
    await writeIndex(next);
  } catch {
    /* nothing to do */
  }
}

/** Changes the fields a user may edit after a run: its name, notes and the kept mark. */
export async function editRun(
  id: string,
  change: Partial<Pick<RunRecord, 'label' | 'notes' | 'kept'>>,
): Promise<void> {
  const run = useRuns.getState().runs.find((r) => r.runId === id);
  if (run) await saveRun({ ...run, ...change });
}

export async function deleteRun(id: string): Promise<void> {
  const runs = useRuns.getState().runs.filter((r) => r.runId !== id);
  useRuns.setState({ runs });
  const kv = getKv();
  try {
    await kv.del(recordKey(id));
    await kv.del(eventsKey(id));
    await writeIndex(runs);
  } catch {
    /* nothing to do */
  }
}

export async function loadEvents(id: string): Promise<TrainingEvent[]> {
  try {
    return (await getKv().get<TrainingEvent[]>(eventsKey(id))) ?? [];
  } catch {
    return [];
  }
}

/** Forgets every run, for a new project. */
export async function clearRuns(): Promise<void> {
  const ids = useRuns.getState().runs.map((r) => r.runId);
  useRuns.setState({ runs: [] });
  const kv = getKv();
  try {
    for (const id of ids) {
      await kv.del(recordKey(id));
      await kv.del(eventsKey(id));
    }
    await kv.del(INDEX);
  } catch {
    /* nothing to do */
  }
}
