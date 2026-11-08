import { useState } from 'react';
import { Shell } from './components/Shell';
import { screenDef, SCREENS, screenIndex } from './screens';
import { Startup } from './screens/Startup';
import { useEngine } from './state/engine';
import { useUi } from './state/ui';

export function App() {
  const [started, setStarted] = useState(false);
  const { screen, markDone, next } = useUi();
  const engine = useEngine();
  const following = SCREENS[screenIndex(screen) + 1];

  if (!started) return <Startup onNew={() => setStarted(true)} onSample={() => setStarted(true)} />;
  return (
    <Shell
      projectName="Untitled project"
      saveStatus="Not saved yet"
      engineLabel={engine.phase === 'ready' ? 'Browser · CPU' : 'Engine starting'}
      nextStep={following ? `Next step: ${following.title.toLowerCase()}` : 'Last step'}
      onNext={() => {
        markDone(screen);
        next();
      }}
    >
      <p className="muted">The "{screenDef(screen).title}" screen is built in the next steps.</p>
    </Shell>
  );
}
