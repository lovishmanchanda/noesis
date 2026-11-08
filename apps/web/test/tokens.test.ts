import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve(import.meta.dirname, '../src/styles/tokens.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1] as string,
      (m[2] as string).trim(),
    ]),
  );
}

const light = block(':root {');
const dark = { ...light, ...block(":root[data-theme='dark']") };

function luminance(hex: string): number {
  const channel = (i: number): number => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT: [string, string, number][] = [
  ['text-primary', 'surface-0', 7],
  ['text-primary', 'surface-1', 7],
  ['text-primary', 'surface-3', 7],
  ['text-secondary', 'surface-0', 4.5],
  ['text-secondary', 'surface-1', 4.5],
  ['text-muted', 'surface-0', 4.5],
  ['text-muted', 'surface-1', 4.5],
  ['accent-text', 'surface-0', 4.5],
  ['accent-text', 'surface-1', 4.5],
  ['accent-on', 'accent-fill', 4.5],
  ['accent-soft-text', 'accent-soft', 4.5],
  ['success-text', 'surface-1', 4.5],
  ['success-text', 'success-soft', 4.5],
  ['warning-text', 'surface-1', 4.5],
  ['warning-text', 'warning-soft', 4.5],
  ['danger-text', 'surface-1', 4.5],
  ['danger-text', 'danger-soft', 4.5],
];
// Borders that mark the edge of a control must be visible (WCAG 1.4.11, 3:1).
const BOUNDARIES: [string, string, number][] = [
  ['border-strong', 'surface-1', 3],
  ['border-strong', 'surface-0', 3],
];

for (const [name, theme] of [
  ['light', light],
  ['dark', dark],
] as const) {
  describe(`${name} theme contrast`, () => {
    for (const [fg, bg, min] of [...TEXT, ...BOUNDARIES]) {
      it(`${fg} on ${bg} is at least ${min}:1`, () => {
        expect(contrast(theme[fg] as string, theme[bg] as string)).toBeGreaterThanOrEqual(min);
      });
    }
  });
}

describe('tokens', () => {
  it('defines every colour in both themes', () => {
    for (const key of Object.keys(light).filter((k) =>
      /^(surface|text|border|accent|success|warning|danger)/.test(k),
    )) {
      expect(dark[key], key).toBeDefined();
    }
  });
});
