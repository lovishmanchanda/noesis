import type { EngineProgress } from '@noesis/engine-client';

const STEPS = ['Starting Python', 'Loading the data tools', 'Loading NOESIS', 'Ready'];

/** Honest progress for the engine start: what is happening, and what it means for the user. */
export function LoadingCard({
  progress,
  error,
  onRetry,
}: {
  progress: EngineProgress | null;
  error: string | null;
  onRetry: () => void;
}) {
  const current = progress?.step ?? 0;
  return (
    <section className="card loading-card" aria-live="polite" aria-label="Engine status">
      <div className="loading-head">
        <strong>
          {error
            ? 'The engine could not start'
            : current >= STEPS.length
              ? 'Ready'
              : 'Getting the engine ready'}
        </strong>
        <span className="muted">
          {error ? '' : `${Math.min(current, STEPS.length)} of ${STEPS.length}`}
        </span>
      </div>
      <div
        className="bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={STEPS.length}
        aria-valuenow={current}
      >
        <i style={{ width: `${(Math.min(current, STEPS.length) / STEPS.length) * 100}%` }} />
      </div>
      <ul className="load-steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i + 1 < current ? 'ok' : i + 1 === current ? 'on' : ''}>
            {i + 1 < current || current >= STEPS.length ? '✓ ' : i + 1 === current ? '… ' : '· '}
            {label}
          </li>
        ))}
      </ul>
      {error ? (
        <div className="error-panel">
          <p>{error}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        <p className="muted small">
          Your data never leaves this computer. This takes a few seconds, and longer the first time
          the page is opened.
        </p>
      )}
    </section>
  );
}
