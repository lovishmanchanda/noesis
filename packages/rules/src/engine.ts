import { ALL_RULES } from './rules';
import type { PatchOp, Rule, RuleContext, Severity, Stage, Suggestion } from './types';

/** The settings a patch touches, so two suggestions that edit the same setting can be spotted. */
function footprint(patch: PatchOp[]): Set<string> {
  const keys = new Set<string>();
  for (const op of patch) {
    if (op.op === 'setParam') keys.add(`param:${op.node}:${op.param}`);
    else if (op.op === 'setColumnRole') keys.add(`role:${op.column}`);
    else if (op.op === 'setMetric') keys.add('metric');
    else if (op.op === 'removeNode') keys.add(`node:${op.node}`);
    else {
      const columns = op.node.params['columns'];
      const names = Array.isArray(columns) ? columns.map(String) : ['*'];
      for (const c of names) keys.add(`add:${op.node.type}:${c}`);
    }
  }
  return keys;
}

/**
 * Runs every rule that applies. Rules are pure: the same context always gives the same list.
 * A rule that reads the training-rows profile is skipped until the data is split.
 */
export function evaluateRules(ctx: RuleContext, rules: readonly Rule[] = ALL_RULES): Suggestion[] {
  const found: Suggestion[] = [];
  for (const rule of rules) {
    if (ctx.settings.disabledGroups.includes(rule.group)) continue;
    if (!rule.appliesTo.includes(ctx.task)) continue;
    if (rule.uses === 'train' && !ctx.train) continue;
    found.push(...rule.evaluate(ctx));
  }
  const unique = new Map<string, Suggestion>();
  for (const s of found) if (!unique.has(s.fingerprint)) unique.set(s.fingerprint, s);
  return markAlternatives(sortSuggestions([...unique.values()]));
}

const SEVERITY_ORDER: Record<Severity, number> = { alert: 0, warn: 1, tip: 2, info: 3 };

export function sortSuggestions(list: Suggestion[]): Suggestion[] {
  return [...list].sort(
    (a, b) =>
      b.priority - a.priority ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
}

/**
 * When two suggestions edit the same setting, the one with the higher priority stays as it is
 * and the other is shown as an alternative to it. List must already be sorted by priority.
 */
export function markAlternatives(sorted: Suggestion[]): Suggestion[] {
  const claimed = new Map<string, string>();
  return sorted.map((s) => {
    const keys = s.actions.flatMap((a) => [...footprint(a.patch)]);
    const owner = keys.map((k) => claimed.get(k)).find((id) => id !== undefined);
    for (const k of keys) if (!claimed.has(k)) claimed.set(k, s.ruleId);
    return owner && owner !== s.ruleId ? { ...s, alternativeTo: owner } : s;
  });
}

export interface Visible {
  /** Open suggestions for this screen, ranked. */
  open: Suggestion[];
  /** Shown expanded: at most a few, so the screen stays quiet. */
  expanded: Suggestion[];
  /** The rest, in a "More" list. */
  more: Suggestion[];
  /** Hidden because the user dismissed them and the evidence has not moved. */
  dismissed: Suggestion[];
}

/**
 * Picks what a screen shows. Dismissed suggestions stay hidden until their fingerprint changes.
 * Guided mode shows every severity; Expert mode shows warnings and above, and leaves tips and
 * notes in the "More" list.
 */
export function visibleFor(
  all: Suggestion[],
  stage: Stage,
  dismissed: ReadonlySet<string>,
  mode: 'guided' | 'expert',
  expandedLimit: number,
): Visible {
  const forStage = all.filter((s) => s.stage === stage);
  const hidden = forStage.filter((s) => dismissed.has(s.fingerprint));
  const open = forStage.filter((s) => !dismissed.has(s.fingerprint));
  const loud = (s: Suggestion): boolean => s.severity === 'warn' || s.severity === 'alert';
  const candidates = mode === 'expert' ? open.filter(loud) : open;
  const expanded = candidates.filter((s) => !s.alternativeTo).slice(0, expandedLimit);
  const more = open.filter((s) => !expanded.includes(s));
  return { open, expanded, more, dismissed: hidden };
}
