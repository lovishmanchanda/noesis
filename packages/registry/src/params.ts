import data from '../data/registry.json';
import type { NodeType, TaskType } from './node-types';

export type ParamType =
  | 'int'
  | 'float'
  | 'number'
  | 'bool'
  | 'string'
  | 'enum'
  | 'column'
  | 'columns'
  | 'floats'
  | 'ints'
  | 'strings'
  | 'scalar'
  | 'map'
  | 'any';

/** Shows a parameter only when a sibling parameter has a given value. */
export interface Condition {
  param: string;
  equals?: unknown;
  in?: unknown[];
  notIn?: unknown[];
}

export interface ParamSpec {
  type: ParamType;
  /** Used when the file does not set the parameter. `null` means "not in use". */
  default: unknown;
  /** The step is incomplete while this is null. */
  required?: boolean;
  min?: number;
  max?: number;
  options?: unknown[];
  when?: Condition;
  /** The order of the values matters (ratios, layer sizes). Other lists are treated as sets. */
  ordered?: boolean;
  level: 'basic' | 'advanced';
  label: string;
  help: string;
  /** Default search range for tuning (model settings only). */
  tune?: { range: [number, number]; scale?: 'log' };
}

export interface NodeSpec {
  label: string;
  params: Record<string, ParamSpec>;
}

export interface AlgorithmSpec {
  label: string;
  tasks: TaskType[];
  params: Record<string, ParamSpec>;
}

interface RegistryData {
  version: string;
  nodes: Record<string, NodeSpec>;
  algorithms: Record<string, AlgorithmSpec>;
}

const registry = data as unknown as RegistryData;

export const REGISTRY_VERSION = registry.version;
export const ALGORITHMS = registry.algorithms;
export const ALGORITHM_NAMES = Object.keys(registry.algorithms);

export function nodeSpec(type: NodeType): NodeSpec {
  const spec = registry.nodes[type];
  if (!spec) throw new Error(`No parameter definitions for node type ${type}`);
  return spec;
}

/** Algorithms that can run a task. */
export function algorithmsFor(task: TaskType): string[] {
  return ALGORITHM_NAMES.filter((name) => ALGORITHMS[name]?.tasks.includes(task));
}

/**
 * Parameters a node accepts. For a model, that is its common settings plus those of the chosen
 * algorithm (when it is a known one).
 */
export function paramSpecs(
  type: NodeType,
  algorithm?: unknown,
  task?: TaskType,
): Record<string, ParamSpec> {
  const base = { ...nodeSpec(type).params };
  if (type !== 'model') return base;
  const algorithmParam = base['algorithm'];
  if (algorithmParam) {
    base['algorithm'] = {
      ...algorithmParam,
      options: task ? algorithmsFor(task) : ALGORITHM_NAMES,
    };
  }
  const chosen = typeof algorithm === 'string' ? ALGORITHMS[algorithm] : undefined;
  return chosen && (!task || chosen.tasks.includes(task)) ? { ...base, ...chosen.params } : base;
}

/** True when a parameter applies, given the values of its sibling parameters. */
export function isActive(spec: ParamSpec, valueOf: (name: string) => unknown): boolean {
  const c = spec.when;
  if (!c) return true;
  const actual = valueOf(c.param);
  if (c.equals !== undefined) return actual === c.equals;
  if (c.in) return c.in.includes(actual);
  if (c.notIn) return !c.notIn.includes(actual);
  return true;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

function inRange(spec: ParamSpec, v: number): string | null {
  if (spec.min !== undefined && v < spec.min) return `must be at least ${spec.min}`;
  if (spec.max !== undefined && v > spec.max) return `must be at most ${spec.max}`;
  return null;
}

/** Returns what is wrong with a non-null value, or null when it is acceptable. */
export function checkValue(spec: ParamSpec, value: unknown): string | null {
  switch (spec.type) {
    case 'int':
      if (!isNumber(value) || !Number.isInteger(value)) return 'must be a whole number';
      return inRange(spec, value);
    case 'float':
    case 'number':
      if (!isNumber(value)) return 'must be a number';
      return inRange(spec, value);
    case 'bool':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'string':
    case 'column':
      return typeof value === 'string' && value.length > 0 ? null : 'must be text';
    case 'enum':
      return spec.options?.includes(value)
        ? null
        : `must be one of ${(spec.options ?? []).map(String).join(', ')}`;
    case 'columns':
    case 'strings':
      return isStringArray(value) ? null : 'must be a list of names';
    case 'floats':
      return Array.isArray(value) && value.every(isNumber) ? null : 'must be a list of numbers';
    case 'ints':
      return Array.isArray(value) && value.every((x) => isNumber(x) && Number.isInteger(x))
        ? null
        : 'must be a list of whole numbers';
    case 'scalar':
      return ['string', 'number', 'boolean'].includes(typeof value)
        ? null
        : 'must be text or a number';
    case 'map':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? null
        : 'must be a mapping';
    case 'any':
      return null;
  }
}
