import type { Rule } from '../types';
import { COLUMN_RULES } from './columns';
import { DATASET_RULES } from './dataset';
import { MODEL_RULES } from './model';
import { RUN_RULES } from './runs';
import { SPLIT_RULES } from './split';
import { TARGET_RULES } from './target';

/** The rules in the first release, in the order of the catalogue in docs/design/rule-engine.md. */
export const ALL_RULES: readonly Rule[] = [
  ...DATASET_RULES,
  ...TARGET_RULES,
  ...COLUMN_RULES,
  ...SPLIT_RULES,
  ...MODEL_RULES,
  ...RUN_RULES,
];
