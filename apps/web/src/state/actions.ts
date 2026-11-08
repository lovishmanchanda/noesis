import type { LoadSettings } from '@noesis/engine-client';
import { buildEarlyPipeline } from '../pipeline/build';
import { defaultRoles } from '../pipeline/guess';
import { getEngine } from './engine';
import { DEFAULT_SPLIT, DEFAULT_TIDY, useProject, type DatasetInfo } from './project';
import { useUi } from './ui';

/** Bytes of the open file, kept so changing the load settings can read it again. */
let openFileBytes: {
  name: string;
  bytes: ArrayBuffer;
  source: DatasetInfo['source'];
  sampleId?: string;
} | null = null;

/** Anything changed before the split makes the earlier split result stale. */
export function invalidateSplit(): void {
  useProject.setState({ splitResult: null });
  useUi.getState().markUndone('split');
}

export async function openFile(
  file: { name: string; bytes: ArrayBuffer; source: DatasetInfo['source']; sampleId?: string },
  settings: LoadSettings = {},
): Promise<void> {
  const profile = await getEngine().openCsv(
    { name: file.name, bytes: file.bytes.slice(0) },
    settings,
  );
  openFileBytes = file;
  const previous = useProject.getState();
  const sameShape =
    previous.dataset?.profile.columns.map((c) => c.name).join('|') ===
    profile.columns.map((c) => c.name).join('|');
  useProject.setState({
    dataset: {
      name: file.name,
      source: file.source,
      ...(file.sampleId ? { sampleId: file.sampleId } : {}),
      settings,
      profile,
    },
    roles: sameShape ? previous.roles : defaultRoles(profile),
    ...(sameShape ? {} : { tidy: { ...DEFAULT_TIDY }, split: { ...DEFAULT_SPLIT } }),
  });
  invalidateSplit();
}

export async function reloadWithSettings(settings: LoadSettings): Promise<void> {
  if (!openFileBytes) return;
  await openFile(openFileBytes, settings);
}

/** Runs the early steps for the current choices and stores the resulting part sizes. */
export async function runSplit(): Promise<void> {
  const { pipeline, issues } = buildEarlyPipeline(useProject.getState());
  if (issues.length > 0)
    throw new Error(issues[0]?.message ?? 'The choices do not make a valid pipeline');
  const result = await getEngine().runEarly(JSON.stringify(pipeline));
  useProject.setState({ splitResult: result });
}
