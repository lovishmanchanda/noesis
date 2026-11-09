import { isActive, paramSpecs, type NodeType, type TaskType } from '@noesis/registry';
import registry from '../../registry/data/registry.json';
import type { NOESISPipeline, Node as PipelineNode } from './generated/pipeline';

/**
 * Node hashes (see docs/design/hashing-and-runs.md). A node's hash changes when anything that
 * can change its output changes: its own effective settings, or anything upstream. Names, notes
 * and the source of a setting (default, user, suggested) never count.
 */

/** Bumped only when a library or engine change can change numeric results. */
export const ENGINE_EPOCH = '1';

/** Steps whose output depends on the random seed. */
const USES_SEED: ReadonlySet<NodeType> = new Set([
  'split',
  'model',
  'tune',
  'validate',
  'stability_check',
  'reduce_dimensions',
]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function normaliseNumber(n: number): number {
  if (!Number.isFinite(n)) throw new Error('A setting is not a finite number');
  return Object.is(n, -0) ? 0 : n;
}

function normalise(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return normaliseNumber(value);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalise);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => [k, normalise(v)] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  throw new Error('A setting has a value that cannot be hashed');
}

/** Keys sorted at every level, no whitespace: the stable string that gets hashed. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

/**
 * The settings that decide what a node does: values that apply, with defaults filled in, empty
 * ones left out, and lists of columns treated as sets (except where order matters).
 */
export function effectiveParams(node: PipelineNode, task: TaskType): Record<string, Json> {
  const algorithm = node.params['algorithm']?.value;
  const specs = paramSpecs(node.type as NodeType, algorithm, task);
  const valueOf = (name: string): unknown =>
    node.params[name]?.value ?? specs[name]?.default ?? null;
  const out: Record<string, Json> = {};
  for (const [name, spec] of Object.entries(specs)) {
    if (!isActive(spec, valueOf)) continue;
    const value = valueOf(name);
    if (value === null || value === undefined) continue;
    const isSet =
      !spec.ordered && Array.isArray(value) && (spec.type === 'columns' || spec.type === 'strings');
    out[name] = isSet ? ([...(value as unknown[])].map(String).sort() as Json) : normalise(value);
  }
  return out;
}

export async function sha256(text: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The fingerprint of the data a pipeline starts from, for the first node's hash. */
export const datasetKey = (bytes: ArrayBuffer | Uint8Array): Promise<string> => sha256(bytes);

/**
 * The hash of every node, keyed by node id. `dataKey` identifies the file: it goes into the hash of
 * every node that reads the file, so a changed file marks everything outdated.
 */
export async function nodeHashes(
  pipeline: NOESISPipeline,
  dataKey: string,
): Promise<Record<string, string>> {
  const byId = new Map(pipeline.nodes.map((n) => [n.id, n]));
  const done: Record<string, string> = {};
  const visiting = new Set<string>();

  const hashOf = async (id: string): Promise<string> => {
    const known = done[id];
    if (known !== undefined) return known;
    if (visiting.has(id)) throw new Error('The steps form a loop');
    visiting.add(id);
    const node = byId.get(id);
    if (!node) throw new Error(`There is no step "${id}"`);
    const inputs = await Promise.all((node.inputs ?? []).map(hashOf));
    const material: Record<string, unknown> = {
      type: node.type,
      definitionVersion: registry.version,
      params: effectiveParams(node, pipeline.task.type),
      fit_on: node.fit_on ?? null,
      inputs,
      engineEpoch: ENGINE_EPOCH,
    };
    if (inputs.length === 0) material['data'] = dataKey;
    if (USES_SEED.has(node.type as NodeType)) material['seed'] = pipeline.project.seed;
    const hash = await sha256(canonicalJson(material));
    visiting.delete(id);
    done[id] = hash;
    return hash;
  };

  for (const node of pipeline.nodes) await hashOf(node.id);
  return done;
}

export type NodeStatus = 'todo' | 'done' | 'outdated';

/**
 * A node is `done` only if a stored result has the same hash as the node has now. A node with a
 * result under an older hash is `outdated`, and one that never ran is `todo`.
 */
export function nodeStatuses(
  current: Record<string, string>,
  stored: Record<string, string>,
): Record<string, NodeStatus> {
  return Object.fromEntries(
    Object.entries(current).map(([id, hash]) => [
      id,
      stored[id] === undefined ? 'todo' : stored[id] === hash ? 'done' : 'outdated',
    ]),
  );
}

/** Short form for the screen. Compare and store the full value. */
export const shortHash = (hash: string): string => hash.slice(0, 8);
