import { isActive, nodeSpec, paramSpecs, type ParamSpec } from '@noesis/registry';
import { rankOf } from '@noesis/rules';
import { shortHash } from '@noesis/schema';
import { removeStep, setStepParam } from '../pipeline/prepare';
import { useProject, type PrepareStep } from '../state/project';
import { requestRun, useRun, useStepStatuses } from '../state/run';
import { useUi } from '../state/ui';

const MARKER: Record<string, string> = { default: 'default', user: 'you', suggested: 'suggestion' };

function valueText(value: unknown): string {
  if (value === null || value === undefined) return 'not set';
  return Array.isArray(value) ? value.map(String).join(', ') : String(value);
}

function Editor({
  step,
  name,
  spec,
  value,
}: {
  step: PrepareStep;
  name: string;
  spec: ParamSpec;
  value: unknown;
}) {
  const change = (next: unknown): void => {
    useProject.setState((p) => ({
      prepare: setStepParam(p.prepare, step.id, name, next as never),
    }));
    void requestRun().catch(() => undefined);
  };
  const id = `${step.id}-${name}`;
  if (spec.type === 'enum')
    return (
      <select id={id} value={String(value ?? '')} onChange={(e) => change(e.target.value)}>
        {(spec.options ?? []).map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    );
  if (spec.type === 'bool')
    return (
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        onChange={(e) => change(e.target.checked)}
      />
    );
  if (spec.type === 'int' || spec.type === 'float' || spec.type === 'number')
    return (
      <input
        id={id}
        type="number"
        value={value === null || value === undefined ? '' : Number(value)}
        {...(spec.min !== undefined ? { min: spec.min } : {})}
        {...(spec.max !== undefined ? { max: spec.max } : {})}
        step={spec.type === 'int' ? 1 : 'any'}
        onChange={(e) => e.target.value !== '' && change(Number(e.target.value))}
        style={{ width: 90 }}
      />
    );
  return <span className="mono">{valueText(value)}</span>;
}

/**
 * The steps added after the split, in the order they run. Each shows its settings with a marker for
 * where each value came from (default, you, suggestion). Expert mode makes the settings editable.
 */
export function StepList({ types }: { types?: PrepareStep['type'][] }) {
  const prepare = useProject((p) => p.prepare);
  const task = useProject((p) =>
    p.goal === 'number' ? 'regression' : p.goal === 'category' ? 'classification' : 'clustering',
  );
  const mode = useUi((u) => u.mode);
  const running = useRun((r) => r.running);
  const { current, status } = useStepStatuses();
  const steps = prepare
    .filter((s) => !types || types.includes(s.type))
    .map((step, i) => ({ step, i }))
    .sort((a, b) => rankOf(a.step.type) - rankOf(b.step.type) || a.i - b.i)
    .map((x) => x.step);

  if (steps.length === 0) return null;
  return (
    <section aria-label="Steps you have added">
      <h2>Steps you have added</h2>
      <ul className="steps-list">
        {steps.map((step) => {
          const specs = paramSpecs(step.type, undefined, task);
          const valueOf = (n: string): unknown =>
            step.params[n]?.value ?? specs[n]?.default ?? null;
          const shown = Object.entries(specs).filter(
            ([, spec]) => isActive(spec, valueOf) && (mode === 'expert' || spec.level === 'basic'),
          );
          const state = running ? 'outdated' : (status[step.id] ?? 'todo');
          return (
            <li key={step.id} className="step-row">
              <span
                className={`dot ${state}`}
                role="img"
                aria-label={
                  state === 'done'
                    ? 'Up to date'
                    : state === 'outdated'
                      ? 'Needs re-running'
                      : 'Not run yet'
                }
              />
              <div>
                <strong>{nodeSpec(step.type).label}</strong>{' '}
                {current[step.id] && (
                  <span
                    className="mono small muted"
                    title="Changes whenever this step or an earlier one changes"
                  >
                    {shortHash(current[step.id] as string)}
                  </span>
                )}
                <div className="params">
                  {shown.map(([n, spec]) => {
                    const source = step.params[n]?.source ?? 'default';
                    return (
                      <label key={n} className="param" htmlFor={`${step.id}-${n}`}>
                        <span className="muted">{spec.label}:</span>
                        {mode === 'expert' && n !== 'columns' ? (
                          <Editor step={step} name={n} spec={spec} value={valueOf(n)} />
                        ) : (
                          <span className="mono">{valueText(valueOf(n))}</span>
                        )}
                        <span
                          className={`marker ${source}`}
                          title={`Value comes from: ${MARKER[source]}`}
                        >
                          {MARKER[source]}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  useProject.setState((p) => ({ prepare: removeStep(p.prepare, step.id) }));
                  void requestRun().catch(() => undefined);
                }}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
