import { isActive, paramSpecs } from '@noesis/registry';
import { ParamEditor } from '../components/ParamEditor';
import { Notice } from '../components/ui';
import { MODELS, asParams, choose, modelInfo, modelsFor, type Preset } from '../pipeline/models';
import { useProject, type ModelChoice } from '../state/project';
import { recordEdit } from '../state/suggestions';
import { useUi } from '../state/ui';
import { preflight } from '../training/run';

const PRESETS: [Preset, string][] = [
  ['fast', 'Fast'],
  ['balanced', 'Balanced'],
  ['accurate', 'Accurate'],
];
const MARKER: Record<string, string> = { default: 'default', user: 'you', suggested: 'suggestion' };

const show = (v: unknown): string =>
  v === null || v === undefined ? 'not set' : Array.isArray(v) ? v.join(', ') : String(v);

export function ModelScreen() {
  const project = useProject();
  const mode = useUi((u) => u.mode);
  const { goal, model } = project;
  const task = goal === 'number' ? 'regression' : 'classification';

  if (goal === 'groups')
    return (
      <Notice kind="info">
        Grouping rows by similarity arrives in a later version. For now this tool predicts a number
        or a category. Go back to the first screen to change what you want to find out.
      </Notice>
    );

  const options = modelsFor(goal);
  const info = model ? modelInfo(model.algorithm) : undefined;
  const set = (change: ModelChoice | null, label: string): void => {
    recordEdit(label);
    useProject.setState({ model: change });
  };

  const setPreset = (preset: Preset): void => {
    if (!model || !info) return;
    const keep = Object.fromEntries(
      Object.entries(model.params).filter(
        ([k, p]) => p.source === 'user' && !(k in info.presets[preset]),
      ),
    );
    set(
      { ...model, preset, params: { ...keep, ...asParams(info.presets[preset], 'suggested') } },
      `Use the ${preset} preset`,
    );
  };

  const specs = model ? paramSpecs('model', model.algorithm, task) : {};
  const valueOf = (name: string): unknown =>
    model?.params[name]?.value ?? specs[name]?.default ?? null;
  const shown = Object.entries(specs).filter(
    ([name, spec]) =>
      name !== 'algorithm' &&
      name !== 'preset' &&
      isActive(spec, valueOf) &&
      (mode === 'expert' || spec.level === 'basic'),
  );
  const { guard } = preflight();

  return (
    <div className="stack">
      <p className="muted">
        Start with a simple model: it sets the bar the others have to beat. You can train as many as
        you like and compare them on the next screens.
      </p>
      <div className="choices" role="radiogroup" aria-label="Model">
        {options.map((m) => {
          const on = model?.algorithm === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`choice model-choice ${on ? 'on' : ''}`}
              onClick={() => set(choose(m.id), `Choose ${m.name}`)}
            >
              <strong>
                {m.name}
                {m.baseline && <span className="tag">recommended first run</span>}
              </strong>
              <span className="muted">{m.strength}</span>
              <span className="muted small">Suits: {m.suits}</span>
              <span className="muted small">You will see: {m.watch}</span>
            </button>
          );
        })}
      </div>
      {options.length === 0 && <Notice kind="warn">Choose what you want to find out first.</Notice>}

      {model && info && (
        <section className="card stack" aria-label="Settings">
          <div className="row-between">
            <h2>Settings for {info.name}</h2>
            {Object.keys(info.presets.balanced).length > 0 && (
              <div className="seg" role="group" aria-label="Preset">
                {PRESETS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={model.preset === id ? 'on' : ''}
                    onClick={() => setPreset(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="muted">
              This model has no settings to choose. It fits the best straight line it can.
            </p>
          ) : (
            <div className="param-grid">
              {shown.map(([name, spec]) => {
                const source = model.params[name]?.source ?? 'default';
                return (
                  <div key={name} className="param-row">
                    <label htmlFor={`m-${name}`}>
                      <strong>{spec.label}</strong>
                      <span className="muted small block">{spec.help}</span>
                    </label>
                    <ParamEditor
                      id={`m-${name}`}
                      spec={spec}
                      value={valueOf(name)}
                      onChange={(v) =>
                        set(
                          {
                            ...model,
                            params: {
                              ...model.params,
                              [name]: { value: v as never, source: 'user' },
                            },
                          },
                          `Change “${spec.label}”`,
                        )
                      }
                    />
                    <span
                      className={`marker ${source}`}
                      title={`Value comes from: ${MARKER[source]}`}
                    >
                      {MARKER[source]}
                    </span>
                    {mode === 'expert' && (
                      <span className="muted small mono">default {show(spec.default)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {guard.warning && <Notice kind="warn">{guard.warning}</Notice>}
          {guard.blocking && <Notice kind="error">{guard.blocking}</Notice>}
        </section>
      )}
      <p className="muted small">
        {MODELS.length} models are available in this version. Others, such as support vector
        machines and nearest neighbours, arrive later.
      </p>
    </div>
  );
}
