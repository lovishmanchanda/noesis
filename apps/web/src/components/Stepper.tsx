import { SCREENS, screenStatus } from '../screens';
import { useUi } from '../state/ui';
import { StatusIcon } from './Icon';

export function Stepper() {
  const { screen, completed, goTo } = useUi();
  return (
    <nav className="stepper" aria-label="Steps">
      <div className="stepper-title">Steps</div>
      <ol>
        {SCREENS.map((s) => {
          const { status, reason } = screenStatus(s.id, screen, completed);
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`step ${status}`}
                aria-current={status === 'current' ? 'step' : undefined}
                aria-disabled={status === 'locked'}
                title={reason}
                onClick={() => goTo(s.id)}
              >
                <span className="step-icon">
                  <StatusIcon status={status} />
                </span>
                <span>{s.title}</span>
                {status === 'locked' && <span className="sr-only"> ({reason})</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
