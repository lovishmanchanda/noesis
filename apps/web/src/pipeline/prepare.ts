import type { Param } from '@noesis/schema';
import type { PrepareStep, PrepareType } from '../state/project';

type Values = Record<string, unknown>;

const same = (a: Values, b: Values): boolean => JSON.stringify(a) === JSON.stringify(b);
const plain = (step: PrepareStep): Values =>
  Object.fromEntries(
    Object.entries(step.params)
      .filter(([k]) => k !== 'columns')
      .map(([k, p]) => [k, p.value]),
  );
const columnsOf = (step: PrepareStep): string[] => {
  const v = step.params['columns']?.value;
  return Array.isArray(v) ? (v as string[]) : [];
};
const toParams = (values: Values, source: Param['source']): Record<string, Param> =>
  Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, { value: v as Param['value'], source }]),
  );

/** The step of this type that handles a column, if any. */
export function stepFor(
  prepare: PrepareStep[],
  type: PrepareType,
  column: string,
): PrepareStep | undefined {
  return prepare.find((s) => s.type === type && columnsOf(s).includes(column));
}

/**
 * Sets what happens to one column for one kind of step: `values` are the settings (without
 * `columns`), or null to leave the column alone. A column joins an existing step with the same
 * settings, so ten columns filled the same way make one step, not ten.
 */
export function setColumnStep(
  prepare: PrepareStep[],
  type: PrepareType,
  column: string,
  values: Values | null,
  source: Param['source'] = 'user',
): PrepareStep[] {
  // Take the column out of every step of this type first.
  let next = prepare
    .map((s) => {
      if (s.type !== type || !columnsOf(s).includes(column)) return s;
      return {
        ...s,
        params: {
          ...s.params,
          columns: { value: columnsOf(s).filter((c) => c !== column), source: 'user' as const },
        },
      };
    })
    .filter((s) => s.type !== type || columnsOf(s).length > 0);
  if (values === null) return next;
  const home = next.find((s) => s.type === type && same(plain(s), values));
  if (home) {
    next = next.map((s) =>
      s === home
        ? { ...s, params: { ...s.params, columns: { value: [...columnsOf(s), column], source } } }
        : s,
    );
  } else {
    const used = new Set(next.map((s) => s.id));
    let n = 1;
    while (used.has(`p${n}`)) n++;
    next = [
      ...next,
      {
        id: `p${n}`,
        type,
        params: { ...toParams(values, source), columns: { value: [column], source } },
      },
    ];
  }
  return next;
}

/** Sets a step that applies to every column (scaling) or removes it. */
export function setWholeStep(
  prepare: PrepareStep[],
  type: PrepareType,
  values: Values | null,
): PrepareStep[] {
  const rest = prepare.filter((s) => s.type !== type);
  if (values === null) return rest;
  const used = new Set(rest.map((s) => s.id));
  let n = 1;
  while (used.has(`p${n}`)) n++;
  return [...rest, { id: `p${n}`, type, params: toParams(values, 'user') }];
}

/** Removes a step by id. */
export const removeStep = (prepare: PrepareStep[], id: string): PrepareStep[] =>
  prepare.filter((s) => s.id !== id);

/** Changes one setting of one step. */
export function setStepParam(
  prepare: PrepareStep[],
  id: string,
  name: string,
  value: Param['value'],
): PrepareStep[] {
  return prepare.map((s) =>
    s.id === id ? { ...s, params: { ...s.params, [name]: { value, source: 'user' } } } : s,
  );
}
