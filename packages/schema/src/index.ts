import { validateGraph } from './graph';
import type { ValidationResult } from './issues';
import { validateStructure } from './structure';
import type { NOESISPipeline } from './generated/pipeline';

export type { NOESISPipeline, Node as PipelineNode, Param } from './generated/pipeline';
export { ISSUE_CODES, type Issue, type IssueCode, type ValidationResult } from './issues';
export { validateGraph } from './graph';
export { validateStructure } from './structure';

/**
 * Checks a pipeline file completely: first its shape, then the rules that need the whole graph.
 * Graph rules only run on a file whose shape is valid.
 */
export function validatePipeline(data: unknown): ValidationResult {
  const structural = validateStructure(data);
  if (structural.length > 0) return { ok: false, issues: structural };
  const issues = validateGraph(data as NOESISPipeline);
  return { ok: issues.length === 0, issues };
}
