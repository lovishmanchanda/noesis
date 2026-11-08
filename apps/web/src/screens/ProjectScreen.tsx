import { Field } from '../components/ui';
import { useProject, type Goal } from '../state/project';
import { invalidateSplit } from '../state/actions';

const GOALS: { id: Goal; label: string; example: string }[] = [
  {
    id: 'number',
    label: 'A number',
    example: 'For example a price, a temperature or how many will sell.',
  },
  {
    id: 'category',
    label: 'A category',
    example: 'For example yes or no, which type, or whether a customer will leave.',
  },
  {
    id: 'groups',
    label: 'Groups of similar rows',
    example: 'For example types of customer. There is no right answer to predict.',
  },
];

export function ProjectScreen() {
  const { name, topic, goal, update } = useProject();
  return (
    <div className="stack">
      <Field label="Project name">
        <input type="text" value={name} onChange={(e) => update({ name: e.target.value })} />
      </Field>
      <Field label="Topic (optional)" hint="A few words to help you find this project later.">
        <input
          type="text"
          value={topic}
          onChange={(e) => update({ topic: e.target.value })}
          placeholder="Home prices in the north"
        />
      </Field>
      <fieldset className="choices">
        <legend>What do you want to find out?</legend>
        {GOALS.map((g) => (
          <label key={g.id} className={`choice ${goal === g.id ? 'on' : ''}`}>
            <input
              type="radio"
              name="goal"
              checked={goal === g.id}
              onChange={() => {
                update({ goal: g.id });
                invalidateSplit();
              }}
            />
            <span>
              <strong>{g.label}</strong>
              <span className="muted"> {g.example}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
