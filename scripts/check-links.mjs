// Checks that every relative link in every Markdown file points at something that exists.
// Usage: node scripts/check-links.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const skip = new Set([
  'node_modules',
  '.git',
  '.env',
  'public',
  'data',
  'results',
  'dist',
  'build',
]);
const link = /\]\(([^)\s#]+)(#[^)\s]*)?\)/g;

function* markdown(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* markdown(full);
    else if (entry.name.endsWith('.md')) yield full;
  }
}

let broken = 0;
let checked = 0;
for (const file of markdown(root)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(link)) {
    const target = m[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    checked++;
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
      broken++;
      console.log(`broken: ${path.relative(root, file)} -> ${target}`);
    }
  }
}
console.log(`${checked} relative links checked, ${broken} broken`);
process.exit(broken ? 1 : 0);
