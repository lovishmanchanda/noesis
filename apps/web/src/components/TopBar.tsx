import markUrl from '../../../../brand/noesis-mark.png';
import { useUi, type Mode, type ThemeChoice } from '../state/ui';

export function TopBar({
  projectName,
  saveStatus,
  engineLabel,
}: {
  projectName: string;
  saveStatus: string;
  engineLabel: string;
}) {
  const { mode, setMode, theme, setTheme } = useUi();
  const modes: Mode[] = ['guided', 'expert'];
  return (
    <header className="topbar">
      <div className="brand">
        <img src={markUrl} alt="" width={28} height={16} />
        <span className="wordmark">NOESIS</span>
      </div>
      <div className="project-name" title="Project name">
        {projectName}
      </div>
      <div className="topbar-right">
        <div className="seg" role="group" aria-label="Mode">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? 'on' : ''}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m === 'guided' ? 'Guided' : 'Expert'}
            </button>
          ))}
        </div>
        <label className="theme-picker">
          <span className="sr-only">Theme</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <span className="status-text" role="status">
          {saveStatus}
        </span>
        <span className="pill" title="Where the work runs">
          {engineLabel}
        </span>
      </div>
    </header>
  );
}
