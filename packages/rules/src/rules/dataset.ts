import { nodesOfType, paramValue, percent, suggest } from '../helpers';
import type { Rule } from '../types';

const ALL = ['regression', 'classification', 'clustering', 'forecasting'] as const;
const DELIMITERS = [';', '\t', '|'] as const;

export const D01: Rule = {
  id: 'D01_few_rows',
  group: 'D',
  stage: 'data',
  severity: 'warn',
  priority: 60,
  appliesTo: ALL,
  uses: 'raw',
  evaluate(ctx) {
    const rows = ctx.raw.rows;
    if (rows >= ctx.thresholds.D01.minRows) return [];
    return [
      suggest(D01, {
        target: { kind: 'dataset' },
        message: `This file has only ${rows} rows.`,
        why: 'With so few rows, scores swing a lot from one split to the next. Prefer simple models, avoid neural networks, and read the scores with caution.',
        evidence: { rows, minRows: ctx.thresholds.D01.minRows },
        buckets: rows < ctx.thresholds.D01.minRows / 2 ? 'tiny' : 'small',
      }),
    ];
  },
};

export const D03: Rule = {
  id: 'D03_duplicate_rows',
  group: 'D',
  stage: 'tidy',
  severity: 'warn',
  priority: 50,
  appliesTo: ALL,
  uses: 'raw',
  evaluate(ctx) {
    const { rows, duplicates } = ctx.raw;
    if (rows === 0 || duplicates / rows <= ctx.thresholds.D03.duplicateShare) return [];
    if (nodesOfType(ctx.pipeline, 'drop_duplicates').length > 0) return [];
    const share = duplicates / rows;
    return [
      suggest(D03, {
        target: { kind: 'dataset' },
        message: `${duplicates} rows (${percent(share)}) are exact copies of another row.`,
        why: 'Copies can land in both the training and the test rows, which makes the score look better than it is.',
        evidence: { duplicates, share },
        actions: [
          {
            label: 'Remove duplicate rows',
            patch: [{ op: 'addNode', node: { type: 'drop_duplicates', params: {} } }],
          },
        ],
        buckets: String(Math.floor(share * 10) / 10),
      }),
    ];
  },
};

export const D04: Rule = {
  id: 'D04_wrong_separator',
  group: 'D',
  stage: 'data',
  severity: 'warn',
  priority: 90,
  appliesTo: ALL,
  uses: 'raw',
  evaluate(ctx) {
    const first = ctx.raw.columns[0];
    if (ctx.raw.columnCount !== 1 || !first) return [];
    const found = DELIMITERS.find((d) => first.name.includes(d));
    const load = nodesOfType(ctx.pipeline, 'load_csv')[0];
    if (!found || !load || paramValue(load, 'delimiter') === found) return [];
    const label = found === '\t' ? 'a tab' : `"${found}"`;
    return [
      suggest(D04, {
        target: { kind: 'dataset' },
        message: `The whole header was read as one column, and it contains ${label}.`,
        why: 'The file probably uses that character as its separator, not a comma.',
        evidence: { columns: 1, separator: found },
        actions: [
          {
            label: `Use ${label} as the separator`,
            patch: [{ op: 'setParam', node: load.id, param: 'delimiter', value: found }],
          },
        ],
        buckets: found,
      }),
    ];
  },
};

export const DATASET_RULES: Rule[] = [D01, D03, D04];
