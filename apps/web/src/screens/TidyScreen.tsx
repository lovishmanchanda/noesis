import type { ColumnProfile } from '@noesis/engine-client';
import { count, percent } from '../components/ui';
import { invalidateSplit } from '../state/actions';
import { useProject } from '../state/project';

interface Card {
  key: string;
  title: string;
  detail: string;
  on: boolean;
  toggle: (on: boolean) => void;
  apply: () => void;
}

export function TidyScreen() {
  const { dataset, roles, goal, tidy, update } = useProject();
  if (!dataset) return <p className="muted">Add a file first.</p>;
  const { profile } = dataset;
  const targetName = Object.keys(roles).find((c) => roles[c] === 'target');
  const target = profile.columns.find((c) => c.name === targetName);
  const set = (patch: Partial<typeof tidy>): void => {
    update({ tidy: { ...tidy, ...patch } });
    invalidateSplit();
  };
  const dropColumn = (name: string, on: boolean): string[] =>
    on ? [...new Set([...tidy.dropColumns, name])] : tidy.dropColumns.filter((c) => c !== name);

  const cards: Card[] = [];
  if (profile.duplicates > 0) {
    cards.push({
      key: 'dupes',
      title: `${count(profile.duplicates)} duplicate rows`,
      detail: `Identical rows count twice and can end up on both sides of the split. Removing them leaves ${count(profile.rows - profile.duplicates)} rows.`,
      on: tidy.dropDuplicates,
      toggle: (on) => set({ dropDuplicates: on }),
      apply: () => set({ dropDuplicates: true }),
    });
  }
  if (goal !== 'groups' && target && target.missing > 0) {
    cards.push({
      key: 'target',
      title: `${count(target.missing)} rows have no value to predict`,
      detail: `${percent(target.missingPct)} of the rows. A model cannot learn from a row with no answer.`,
      on: tidy.dropMissingTarget,
      toggle: (on) => set({ dropMissingTarget: on }),
      apply: () => set({ dropMissingTarget: true }),
    });
  }
  const droppable = (c: ColumnProfile): boolean =>
    roles[c.name] !== 'target' && roles[c.name] !== 'reference';
  for (const c of profile.columns.filter((x) => x.constant && droppable(x))) {
    cards.push({
      key: `const-${c.name}`,
      title: `“${c.name}” has the same value in every row`,
      detail: 'A column that never changes tells the model nothing.',
      on: tidy.dropColumns.includes(c.name),
      toggle: (on) => set({ dropColumns: dropColumn(c.name, on) }),
      apply: () => set({ dropColumns: dropColumn(c.name, true) }),
    });
  }
  for (const c of profile.columns.filter(
    (x) => !x.constant && x.missingPct > 0.6 && droppable(x),
  )) {
    cards.push({
      key: `empty-${c.name}`,
      title: `“${c.name}” is ${percent(c.missingPct)} empty`,
      detail:
        'Too little is known to learn from it. Removing the column is usually safer than guessing the rest.',
      on: tidy.dropColumns.includes(c.name),
      toggle: (on) => set({ dropColumns: dropColumn(c.name, on) }),
      apply: () => set({ dropColumns: dropColumn(c.name, true) }),
    });
  }

  if (cards.length === 0) {
    return (
      <p className="notice info">
        Nothing needs tidying. Duplicates, empty rows and columns that never change were not found.
        You can continue.
      </p>
    );
  }
  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted">
          These fixes do not learn anything from the data, so they are safe to do before the split.
          Each one is optional.
        </p>
        <button type="button" onClick={() => cards.forEach((c) => c.apply())}>
          Apply all suggested
        </button>
      </div>
      {cards.map((c) => (
        <label key={c.key} className={`card tidy-card ${c.on ? 'on' : ''}`}>
          <input type="checkbox" checked={c.on} onChange={(e) => c.toggle(e.target.checked)} />
          <span>
            <strong>{c.title}</strong>
            <span className="muted block">{c.detail}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
