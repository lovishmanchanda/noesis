/** Codes for everything the pipeline validator can report. Each one is a hard error. */
export const ISSUE_CODES = [
  'E_SCHEMA',
  'E_DUP_ID',
  'E_UNKNOWN_INPUT',
  'E_CYCLE',
  'E_SOURCE_COUNT',
  'E_NO_SPLIT',
  'E_MULTI_SPLIT',
  'E_MODEL_BEFORE_SPLIT',
  'E_LEAK',
  'E_MISSING_FIT_ON',
  'E_NO_MODEL_UPSTREAM',
  'E_TEST_WITHOUT_VALIDATE',
  'E_TEST_TWICE',
  'E_TEST_FEEDBACK',
  'E_TEST_IN_CLUSTERING',
  'E_TASK_MISMATCH',
  'E_DUP_COLUMN',
  'E_TARGET',
  'E_TARGET_IN_CLUSTERING',
  'E_REFERENCE_ROLE',
  'E_SPLIT_RATIOS',
  'E_SPLIT_STRATEGY',
  'E_NON_NUMERIC_FEATURE',
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

/** One problem found in a pipeline: what is wrong, and the one thing to do about it. */
export interface Issue {
  code: IssueCode;
  message: string;
  hint: string;
  /** Id of the node the problem belongs to, when there is one. */
  node?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
}
