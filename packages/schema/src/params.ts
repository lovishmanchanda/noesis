import { checkValue, isActive, paramSpecs, type ParamSpec } from '@noesis/registry';
import type { NOESISPipeline, Node as PipelineNode } from './generated/pipeline';
import type { Issue, IssueCode } from './issues';

const label = (node: PipelineNode): string => `"${node.id}" (${node.type})`;

function isColumnType(spec: ParamSpec): boolean {
  return spec.type === 'column' || spec.type === 'columns';
}

/**
 * Checks every setting of every step against the registry: known names, required values,
 * types and ranges, and that named columns exist. Settings that do not apply (their `when`
 * condition is false) are ignored, and `null` means "not in use".
 */
export function validateParams(pipeline: NOESISPipeline): Issue[] {
  const issues: Issue[] = [];
  const add = (code: IssueCode, node: PipelineNode, message: string, hint: string): void => {
    issues.push({ code, message: `Step ${label(node)}: ${message}`, hint, node: node.id });
  };

  const knownColumns = new Set(pipeline.dataset.columns.map((c) => c.name));
  for (const node of pipeline.nodes) {
    const created = node.type === 'derive_feature' ? node.params['newName']?.value : undefined;
    if (typeof created === 'string') knownColumns.add(created);
  }

  for (const node of pipeline.nodes) {
    const given = node.params;
    const specs = paramSpecs(node.type, given['algorithm']?.value, pipeline.task.type);
    const valueOf = (name: string): unknown =>
      name in given ? (given[name]?.value ?? null) : (specs[name]?.default ?? null);

    for (const name of Object.keys(given)) {
      if (!(name in specs)) {
        add(
          'E_PARAM_UNKNOWN',
          node,
          `"${name}" is not a setting of this step.`,
          'Remove it, or check the spelling.',
        );
      }
    }

    for (const [name, spec] of Object.entries(specs)) {
      if (!isActive(spec, valueOf)) continue;
      const value = valueOf(name);
      if (value === null) {
        if (spec.required) {
          add(
            'E_PARAM_REQUIRED',
            node,
            `"${name}" needs a value.`,
            `Set "${spec.label}" in the step's settings.`,
          );
        }
        continue;
      }
      const problem = checkValue(spec, value);
      if (problem) {
        add(
          'E_PARAM_VALUE',
          node,
          `"${name}" ${problem}.`,
          `Change "${spec.label}" to an allowed value.`,
        );
        continue;
      }
      if (isColumnType(spec)) {
        const names = Array.isArray(value) ? (value as string[]) : [value as string];
        const missing = names.filter((n) => !knownColumns.has(n));
        if (missing.length > 0) {
          add(
            'E_PARAM_COLUMN',
            node,
            `"${name}" names columns that do not exist: ${missing.map((m) => `"${m}"`).join(', ')}.`,
            'Pick columns from the data.',
          );
        }
      }
    }
  }
  return issues;
}
