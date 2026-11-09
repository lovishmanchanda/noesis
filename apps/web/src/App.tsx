import { useEffect, useState } from 'react';
import { Shell } from './components/Shell';
import { defaultRoles } from './pipeline/guess';
import { downloadName, parseProjectFile, projectFromFile, toProjectFile } from './project/file';
import { SCREENS, screenIndex } from './screens';
import { renderScreen } from './screens/index';
import { Startup, type SampleInfo } from './screens/Startup';
import { openFile, runSplit } from './state/actions';
import { useEngine } from './state/engine';
import { blockedReason } from './state/gates';
import {
  discardSaved,
  loadSaved,
  restore,
  saveNow,
  startAutosave,
  useSave,
  type SavedProject,
} from './state/persist';
import { initialProject, useProject } from './state/project';
import { useRun } from './state/run';
import { useSuggestions } from './state/suggestions';
import { useUi } from './state/ui';

async function fetchSampleBytes(id: string): Promise<ArrayBuffer> {
  const samples = (await (await fetch('/samples/samples.json')).json()) as SampleInfo[];
  const sample = samples.find((s) => s.id === id);
  if (!sample) throw new Error('That sample is no longer available.');
  return (await fetch(`/samples/${sample.file}`)).arrayBuffer();
}

function saveLabel(status: ReturnType<typeof useSave.getState>['status']): string {
  if (status === 'saving') return 'Saving…';
  if (status === 'saved') return 'Saved on this device';
  if (status === 'error') return 'Not saved: browser storage is unavailable';
  return 'Not saved yet';
}

export function App() {
  const [started, setStarted] = useState(false);
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [saved, setSaved] = useState<SavedProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startupMessage, setStartupMessage] = useState<string | null>(null);
  const { screen, markDone, next, goTo } = useUi();
  const project = useProject();
  const enginePhase = useEngine((s) => s.phase);
  const saveStatus = useSave((s) => s.status);
  const running = useRun((r) => r.running);
  const suggestions = useSuggestions();
  const dismissed = project.dismissed;

  useEffect(() => {
    fetch('/samples/samples.json')
      .then((r) => (r.ok ? (r.json() as Promise<SampleInfo[]>) : []))
      .then(setSamples)
      .catch(() => setSamples([]));
    void loadSaved().then(setSaved);
    return startAutosave();
  }, []);
  useEffect(() => setError(null), [screen]);

  const fail = (e: unknown, fallback: string): void =>
    setStartupMessage(e instanceof Error ? e.message : fallback);

  /** Opens a sample file and fills in the choices that go with it. */
  const loadSample = async (sample: SampleInfo, jump: boolean): Promise<void> => {
    const response = await fetch(`/samples/${sample.file}`);
    if (!response.ok) throw new Error('The sample file could not be loaded.');
    await openFile({
      name: sample.file,
      bytes: await response.arrayBuffer(),
      source: 'sample',
      sampleId: sample.id,
    });
    const { dataset, goal } = useProject.getState();
    if (!dataset) return;
    const roles = defaultRoles(dataset.profile);
    for (const name of sample.exclude ?? []) roles[name] = 'exclude';
    if (sample.target) roles[sample.target] = 'target';
    if (sample.reference) roles[sample.reference] = 'reference';
    useProject.setState({
      roles,
      goal: jump ? sample.goal : (goal ?? sample.goal),
      ...(jump ? { name: sample.name } : {}),
    });
    if (jump) {
      markDone('project');
      markDone('data');
      goTo('target');
    }
  };

  const startFresh = (): void => {
    useProject.setState(initialProject());
    useUi.setState({ completed: [], screen: 'project' });
    setStarted(true);
  };

  const saveProjectFile = (): void => {
    const text = JSON.stringify(toProjectFile(useProject.getState()), null, 2);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    link.download = downloadName(useProject.getState().name);
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (!started) {
    return (
      <Startup
        samples={samples}
        saved={saved}
        message={startupMessage}
        onNew={() => {
          void discardSaved();
          setSaved(null);
          startFresh();
        }}
        onSample={(s) => {
          setStartupMessage(null);
          useProject.setState(initialProject());
          useUi.setState({ completed: [], screen: 'project' });
          setStarted(true);
          void loadSample(s, true).catch((e: unknown) =>
            setError(e instanceof Error ? e.message : 'The sample could not be opened.'),
          );
        }}
        onContinue={() => {
          if (!saved) return;
          setStartupMessage(null);
          restore(saved, fetchSampleBytes)
            .then(() => setStarted(true))
            .catch((e: unknown) => fail(e, 'The saved project could not be opened.'));
        }}
        onDiscard={() => {
          void discardSaved();
          setSaved(null);
        }}
        onOpenFile={(file) => {
          void file.text().then((text) => {
            const parsed = parseProjectFile(text);
            if (!parsed.ok) return setStartupMessage(parsed.reason);
            const restored = projectFromFile(parsed.file);
            useProject.setState(restored.project);
            useUi.setState({ completed: restored.completed, screen: restored.screen });
            setStartupMessage(null);
            setStarted(true);
            void saveNow();
          });
        }}
      />
    );
  }

  const blocked = blockedReason(screen, project);
  const following = SCREENS[screenIndex(screen) + 1];
  const topSuggestion = suggestions.find(
    (x) => x.stage === screen && !x.alternativeTo && !dismissed.includes(x.fingerprint),
  );
  const onNext = async (): Promise<void> => {
    if (blocked || busy) return;
    if (screen === 'split') {
      setBusy(true);
      try {
        await runSplit();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The split could not be made.');
        return;
      } finally {
        setBusy(false);
      }
    }
    markDone(screen);
    next();
  };

  return (
    <Shell
      projectName={project.name || 'Untitled project'}
      saveStatus={saveLabel(saveStatus)}
      engineLabel={enginePhase === 'ready' ? 'Browser · CPU' : 'Engine starting'}
      onSaveFile={saveProjectFile}
      nextStep={
        (following?.available === false
          ? project.splitResult
            ? 'Your data is prepared. The model, training and the steps after it arrive in a later version.'
            : 'Next step: make the split. The steps after it arrive in a later version.'
          : following
            ? `Next step: ${following.title.toLowerCase()}`
            : 'Last step') + (topSuggestion ? ` · Suggested: ${topSuggestion.message}` : '')
      }
      blocked={blocked}
      error={error}
      busy={busy || running}
      onNext={() => void onNext()}
    >
      {renderScreen(screen, samples, (s) => loadSample(s, false))}
    </Shell>
  );
}
