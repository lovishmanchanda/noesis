import { useState, type ReactNode } from 'react';
import { screenDef } from '../screens';
import { useUi } from '../state/ui';
import { Stepper } from './Stepper';
import { SuggestionsPanel } from './SuggestionsPanel';
import { TopBar } from './TopBar';

export interface ShellProps {
  projectName: string;
  saveStatus: string;
  engineLabel: string;
  onSaveFile: () => void;
  /** Text for the banner under the top bar, naming the next step. */
  nextStep: string;
  /** Why the Next button is not available yet, if it is not. */
  blocked?: string | undefined;
  /** A problem from the last action, shown above the screen. */
  error?: string | null | undefined;
  busy?: boolean | undefined;
  onNext: () => void;
  children: ReactNode;
}

export function Shell({
  projectName,
  saveStatus,
  engineLabel,
  onSaveFile,
  nextStep,
  blocked,
  error,
  busy,
  onNext,
  children,
}: ShellProps) {
  const { screen, back } = useUi();
  const [panelOpen, setPanelOpen] = useState(false);
  const def = screenDef(screen);
  return (
    <div className="shell">
      <TopBar
        projectName={projectName}
        saveStatus={saveStatus}
        engineLabel={engineLabel}
        onSaveFile={onSaveFile}
      />
      <Stepper />
      <main className="main" id="main">
        <div className="banner" role="note">
          {nextStep}
        </div>
        <div className="main-head">
          <h1>{def.title}</h1>
          <button
            type="button"
            className="panel-toggle"
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
          >
            Suggestions
          </button>
        </div>
        <p className="purpose">{def.purpose}</p>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="screen">{children}</div>
        <div className="bottom-bar">
          <button type="button" onClick={back} disabled={screen === 'project'}>
            Back
          </button>
          <div className="bottom-right">
            {blocked && (
              <span className="blocked-reason" role="status">
                {blocked}
              </span>
            )}
            <button
              type="button"
              className="primary"
              onClick={onNext}
              aria-disabled={Boolean(blocked) || Boolean(busy)}
            >
              {busy ? 'Working…' : 'Next'}
            </button>
          </div>
        </div>
      </main>
      <SuggestionsPanel screen={screen} open={panelOpen} />
    </div>
  );
}
