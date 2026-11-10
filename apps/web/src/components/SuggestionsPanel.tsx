import {
  DEFAULT_THRESHOLDS,
  describePatch,
  visibleFor,
  type Stage,
  type Suggestion,
} from '@noesis/rules';
import { useState } from 'react';
import { buildEarlyPipeline } from '../pipeline/build';
import type { ScreenId } from '../screens';
import { useProject } from '../state/project';
import {
  applyAction,
  dismiss,
  restoreDismissed,
  undoLast,
  useHistory,
  useSuggestions,
} from '../state/suggestions';
import { useUi } from '../state/ui';

const SEVERITY: Record<Suggestion['severity'], string> = {
  alert: 'Important',
  warn: 'Worth fixing',
  tip: 'Tip',
  info: 'Note',
};

/** Friendly names for the numbers behind a suggestion. Anything unlisted is shown as it is. */
const EVIDENCE: Record<string, (v: number | string | boolean | null) => string | null> = {
  missingPct: (v) => (typeof v === 'number' ? `${Math.round(v * 100)}% empty` : null),
  missing: (v) => (typeof v === 'number' ? `${v} empty cells` : null),
  share: (v) => (typeof v === 'number' ? `${Math.round(v * 1000) / 10}% of rows` : null),
  duplicates: (v) => (typeof v === 'number' ? `${v} copies` : null),
  rows: (v) => (typeof v === 'number' ? `${v} rows` : null),
  unique: (v) => (typeof v === 'number' ? `${v} different values` : null),
  uniquePct: (v) => (typeof v === 'number' ? `${Math.round(v * 1000) / 10}% different` : null),
  minorityShare: (v) =>
    typeof v === 'number' ? `rarest class ${Math.round(v * 1000) / 10}%` : null,
  correlation: (v) => (typeof v === 'number' ? `correlation ${v.toFixed(3)}` : null),
  trend: (v) => (typeof v === 'number' ? `trend ${v.toFixed(2)}` : null),
  skew: (v) => (typeof v === 'number' ? `skew ${v.toFixed(2)}` : null),
  minRows: () => null,
  train: (v) => (typeof v === 'number' ? `learned-rows score ${v.toFixed(3)}` : null),
  validation: (v) => (typeof v === 'number' ? `new-rows score ${v.toFixed(3)}` : null),
  gap: (v) => (typeof v === 'number' ? `gap ${Math.round(v * 100)}%` : null),
  score: (v) => (typeof v === 'number' ? `score ${v.toFixed(3)}` : null),
  baseline: (v) => (typeof v === 'number' ? `simple model ${v.toFixed(3)}` : null),
  bestLoss: (v) => (typeof v === 'number' ? `best loss ${v.toFixed(3)}` : null),
  lastLoss: (v) => (typeof v === 'number' ? `last loss ${v.toFixed(3)}` : null),
  estimatedSeconds: (v) => (typeof v === 'number' ? `about ${v} s` : null),
};

function evidenceLines(s: Suggestion): string[] {
  return Object.entries(s.evidence).flatMap(([key, value]) => {
    const format = EVIDENCE[key];
    if (format) {
      const text = format(value);
      return text ? [text] : [];
    }
    return typeof value === 'number' || typeof value === 'string'
      ? [`${key}: ${String(value)}`]
      : [];
  });
}

function Card({ s, expert }: { s: Suggestion; expert: boolean }) {
  const project = useProject();
  const goTo = useUi((u) => u.goTo);
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const lines = evidenceLines(s);

  const run = async (index: number): Promise<void> => {
    const action = s.actions[index];
    if (!action) return;
    setBusy(true);
    setProblem(null);
    try {
      await applyAction(s, action);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That could not be applied.');
    } finally {
      setBusy(false);
      setChoice(null);
    }
  };
  const pick = (index: number): void => {
    // Expert mode applies at once and relies on Undo; Guided mode shows what will change first.
    if (expert) void run(index);
    else setChoice(index);
  };
  const preview =
    choice !== null && s.actions[choice]
      ? describePatch(buildEarlyPipeline(project).pipeline, s.actions[choice].patch)
      : [];

  return (
    <article className={`suggestion sev-${s.severity}`} aria-label={s.message}>
      <div className="sug-head">
        <span className={`sev-tag sev-${s.severity}`}>{SEVERITY[s.severity]}</span>
        {s.alternativeTo && <span className="tag">another way</span>}
      </div>
      <p className="sug-message">{s.message}</p>
      {expert ? (
        <details>
          <summary>Why</summary>
          <p className="muted">{s.why}</p>
        </details>
      ) : (
        <p className="muted">{s.why}</p>
      )}
      {lines.length > 0 && <p className="sug-evidence small mono">{lines.join(' · ')}</p>}

      {choice !== null ? (
        <div className="sug-preview">
          <strong className="small">This will:</strong>
          <ul>
            {preview.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void run(choice)}
            >
              Apply
            </button>
            <button type="button" disabled={busy} onClick={() => setChoice(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="sug-actions">
          {s.actions.map((a, i) => (
            <button
              key={a.label}
              type="button"
              className={i === 0 ? 'primary' : ''}
              disabled={busy}
              onClick={() => pick(i)}
            >
              {a.label}
            </button>
          ))}
          {s.goTo && (
            <button type="button" onClick={() => goTo(s.goTo as ScreenId)}>
              Go there
            </button>
          )}
          <button type="button" className="quiet" onClick={() => dismiss(s.fingerprint)}>
            Dismiss
          </button>
        </div>
      )}
      {problem && (
        <p className="notice error" role="alert">
          {problem}
        </p>
      )}
    </article>
  );
}

export function SuggestionsPanel({ screen, open }: { screen: ScreenId; open: boolean }) {
  const mode = useUi((s) => s.mode);
  const all = useSuggestions();
  const dismissed = useProject((p) => p.dismissed);
  const { last, stack } = useHistory();
  const expert = mode === 'expert';
  const view = visibleFor(
    all,
    screen as Stage,
    new Set(dismissed),
    mode,
    DEFAULT_THRESHOLDS.noise.expandedPerScreen,
  );

  return (
    <aside className={`suggestions ${open ? 'open' : ''}`} aria-label="Suggestions">
      <div className="stepper-title">Suggestions</div>
      {last && stack.length > 0 && (
        <div className="notice info undo-bar" role="status">
          <span>Applied: {last}</span>
          <button type="button" onClick={() => void undoLast()}>
            Undo
          </button>
        </div>
      )}
      {view.open.length === 0 && (
        <p className="muted">
          {all.length === 0 && !last
            ? 'Nothing to suggest yet. Suggestions appear here as you work, each with the numbers behind it.'
            : 'Nothing to suggest on this screen.'}
        </p>
      )}
      <div className="stack">
        {view.expanded.map((s) => (
          <Card key={s.fingerprint} s={s} expert={expert} />
        ))}
      </div>
      {view.more.length > 0 && (
        <details className="more">
          <summary>More ({view.more.length})</summary>
          <div className="stack">
            {view.more.map((s) => (
              <Card key={s.fingerprint} s={s} expert={expert} />
            ))}
          </div>
        </details>
      )}
      {view.dismissed.length > 0 && (
        <details className="more">
          <summary>Dismissed ({view.dismissed.length})</summary>
          <ul className="plain">
            {view.dismissed.map((s) => (
              <li key={s.fingerprint}>
                <span className="small">{s.message}</span>{' '}
                <button
                  type="button"
                  className="quiet"
                  onClick={() => restoreDismissed(s.fingerprint)}
                >
                  Show again
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
