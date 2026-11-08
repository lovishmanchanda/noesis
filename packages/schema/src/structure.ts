import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import schema from '../pipeline.schema.json';
import type { Issue } from './issues';

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  allowUnionTypes: true,
});
const check = ajv.compile(schema);

/** Node id for an error path such as /nodes/2/params/..., when the data has one. */
function nodeIdAt(data: unknown, path: string): string | undefined {
  const match = /^\/nodes\/(\d+)/.exec(path);
  if (!match || typeof data !== 'object' || data === null) return undefined;
  const nodes = (data as { nodes?: unknown }).nodes;
  const node = Array.isArray(nodes)
    ? (nodes[Number(match[1])] as { id?: unknown } | undefined)
    : undefined;
  return typeof node?.id === 'string' ? node.id : undefined;
}

function toIssue(data: unknown, error: ErrorObject): Issue {
  const where = error.instancePath === '' ? 'the pipeline file' : error.instancePath;
  const issue: Issue = {
    code: 'E_SCHEMA',
    message: `${where}: ${error.message ?? 'is not valid'}.`,
    hint: 'Fix that field. A step that learns from data, for example, must say fit_on: "train".',
  };
  const node = nodeIdAt(data, error.instancePath);
  if (node !== undefined) issue.node = node;
  return issue;
}

/** Checks the shape of a pipeline file against the JSON Schema. */
export function validateStructure(data: unknown): Issue[] {
  if (check(data)) return [];
  return (check.errors ?? []).map((error) => toIssue(data, error));
}
