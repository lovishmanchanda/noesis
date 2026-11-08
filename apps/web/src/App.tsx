import { Shell } from './components/Shell';
import { screenDef, SCREENS, screenIndex } from './screens';
import { useUi } from './state/ui';

export function App() {
  const { screen, markDone, next } = useUi();
  const following = SCREENS[screenIndex(screen) + 1];
  return (
    <Shell
      projectName="Untitled project"
      saveStatus="Not saved yet"
      engineLabel="Browser · CPU"
      nextStep={following ? `Next step: ${following.title.toLowerCase()}` : 'Last step'}
      onNext={() => {
        markDone(screen);
        next();
      }}
    >
      <p className="muted">The “{screenDef(screen).title}” screen is built in the next steps.</p>
    </Shell>
  );
}
