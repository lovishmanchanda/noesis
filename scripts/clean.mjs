// Removes generated and scratch files from the repository folder.
//   node scripts/clean.mjs            show what would be removed (nothing is deleted)
//   node scripts/clean.mjs --yes      remove it
//   node scripts/clean.mjs --deep     also include the installed tools and dependencies
//   node scripts/clean.mjs --deep --yes
//
// Run it after every phase. By default it keeps the working development setup (node_modules,
// the package store, and the tools and Python environment in .local) so checks keep running;
// --deep removes those too, and they are recreated by the setup steps in CONTRIBUTING.md.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const deep = process.argv.includes('--deep');
const apply = process.argv.includes('--yes');
const KEEP_WHEN_SCANNING = new Set([
  'node_modules',
  '.git',
  '.pnpm-store',
  'env',
  '.env',
  'tools',
  'pyodide-cache',
]);
const JUNK_NAMES = new Set([
  '.DS_Store',
  '__pycache__',
  '.pytest_cache',
  'dist',
  'build',
  'coverage',
  'Thumbs.db',
]);

const targets = new Set();
const add = (p) => {
  if (fs.existsSync(p)) targets.add(p);
};

function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (
      JUNK_NAMES.has(entry.name) ||
      entry.name.endsWith('.tsbuildinfo') ||
      entry.name.endsWith('.egg-info')
    ) {
      targets.add(full);
    } else if (entry.isDirectory() && !KEEP_WHEN_SCANNING.has(entry.name)) {
      scan(full);
    }
  }
}
scan(root);

// Archives and logs at any depth outside dependencies
const stack = [root];
while (stack.length) {
  const dir = stack.pop();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git', '.pnpm-store', 'env', '.env'].includes(entry.name))
        stack.push(full);
    } else if (/\.(zip|log)$/.test(entry.name)) {
      targets.add(full);
    }
  }
}

// Files the experiment generates and that its README recreates
const spike = path.join(root, 'experiments/engine-spike');
for (const p of ['node_modules', 'public', 'data/out', '.env']) add(path.join(spike, p));

// Files the web app generates (recreated by `pnpm dev` or `pnpm build:web`)
for (const p of ['pyodide', 'engine', 'samples']) add(path.join(root, 'apps/web/public', p));

// Scratch files in .local (everything except the tools, the environment and the package cache)
const local = path.join(root, '.local');
if (fs.existsSync(local)) {
  for (const name of fs.readdirSync(local)) {
    if (!['tools', 'env', 'pyodide-cache'].includes(name)) targets.add(path.join(local, name));
  }
}

if (deep) {
  for (const p of [
    'node_modules',
    '.pnpm-store',
    '.local/tools',
    '.local/env',
    '.local/pyodide-cache',
  ])
    add(path.join(root, p));
  for (const group of ['apps', 'packages']) {
    const base = path.join(root, group);
    if (fs.existsSync(base))
      for (const name of fs.readdirSync(base)) add(path.join(base, name, 'node_modules'));
  }
}

function size(p) {
  const stat = fs.lstatSync(p);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(p).reduce((sum, name) => sum + size(path.join(p, name)), 0);
}

let total = 0;
// drop entries that sit inside another entry already being removed
const list = [...targets]
  .filter((p) => ![...targets].some((q) => q !== p && p.startsWith(q + path.sep)))
  .sort();
for (const p of list) {
  if (!p.startsWith(root + path.sep))
    throw new Error(`Refusing to touch ${p}: outside the repository`);
  const bytes = size(p);
  total += bytes;
  console.log(`${(bytes / 1e6).toFixed(1).padStart(8)} MB  ${path.relative(root, p)}`);
  if (apply) fs.rmSync(p, { recursive: true, force: true });
}
console.log(
  `\n${list.length} items, ${(total / 1e6).toFixed(1)} MB ${apply ? 'removed' : 'would be removed (run with --yes to delete)'}`,
);
