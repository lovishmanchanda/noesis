import { useEffect, useState } from 'react';
import { Shell } from './components/Shell';
import { defaultRoles } from './pipeline/guess';
import { SCREENS, screenIndex } from './screens';
import { renderScreen } from './screens/index';
import { Startup, type SampleInfo } from './screens/Startup';
import { openFile, runSplit } from './state/actions';
import { useEngine } from './state/engine';
import { blockedReason } from './state/gates';
import { useProject } from './state/project';
import { useUi } from './state/ui';

export function App() {
  const [started, setStarted] = useState(false);
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { screen, markDone, next, goTo } = useUi();
  const project = useProject();
  const enginePhase = useEngine((s) => s.phase);

  useEffect(() => {
    fetch('/samples/samples.json')
      .then((r) => (r.ok ? (r.json() as Promise<SampleInfo[]>) : []))
      .then(setSamples)
      .catch(() => setSamples([]));
  }, []);
  useEffect(() => setError(null), [screen]);

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

  if (!started) {
    return (
      <Startup
        onNew={() => setStarted(true)}
        onSample={(s) => {
          setStarted(true);
          void loadSample(s, true).catch((e: unknown) =>
            setError(e instanceof Error ? e.message : 'The sample could not be opened.'),
          );
        }}
      />
    );
  }

  const blocked = blockedReason(screen, project);
  const following = SCREENS[screenIndex(screen) + 1];
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
      saveStatus="Not saved yet"
      engineLabel={enginePhase === 'ready' ? 'Browser · CPU' : 'Engine starting'}
      nextStep={
        following?.available === false
          ? project.splitResult
            ? 'The data is split and ready. The next steps (explore, missing values, features and the model) arrive in a later version.'
            : 'Next step: make the split. The steps after it arrive in a later version.'
          : following
            ? `Next step: ${following.title.toLowerCase()}`
            : 'Last step'
      }
      blocked={blocked}
      error={error}
      busy={busy}
      onNext={() => void onNext()}
    >
      {renderScreen(screen, samples, (s) => loadSample(s, false))}
    </Shell>
  );
}
