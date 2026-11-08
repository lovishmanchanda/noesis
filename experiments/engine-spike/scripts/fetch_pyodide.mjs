// Copies the Pyodide core from node_modules and downloads only the wheels the spike needs
// (plus their dependencies) from the jsDelivr copy of the same Pyodide release.
// Usage: node scripts/fetch_pyodide.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'node_modules', 'pyodide');
const dst = path.join(root, 'public', 'pyodide');
fs.mkdirSync(dst, { recursive: true });

const version = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version;
for (const f of ['pyodide.asm.mjs', 'pyodide.asm.wasm', 'pyodide.mjs', 'pyodide.js', 'python_stdlib.zip', 'pyodide-lock.json']) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
}

const lock = JSON.parse(fs.readFileSync(path.join(src, 'pyodide-lock.json'), 'utf8'));
const wanted = ['numpy', 'pandas', 'scikit-learn', 'xgboost', 'pyarrow'];
const needed = new Set();
(function add(name) {
  const key = name.toLowerCase();
  if (needed.has(key)) return;
  const pkg = lock.packages[key];
  if (!pkg) throw new Error(`package not in lock file: ${name}`);
  needed.add(key);
  for (const d of pkg.depends || []) add(d);
})(wanted.join('') && 'numpy');
for (const w of wanted) (function add(name) {
  const key = name.toLowerCase();
  if (needed.has(key) && name !== w) return;
  needed.add(key);
  for (const d of lock.packages[key].depends || []) if (!needed.has(d.toLowerCase())) add(d);
})(w);

const base = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;
const report = [];
for (const name of [...needed].sort()) {
  const pkg = lock.packages[name];
  const file = pkg.file_name;
  const out = path.join(dst, file);
  if (!fs.existsSync(out)) {
    const res = await fetch(base + file);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  }
  report.push({ name, version: pkg.version, file, bytes: fs.statSync(out).size });
}
const total = report.reduce((s, r) => s + r.bytes, 0);
for (const r of report) console.log(`${r.name.padEnd(22)} ${r.version.padEnd(14)} ${(r.bytes / 1e6).toFixed(2)} MB`);
console.log(`\nPyodide ${version}: ${report.length} packages, ${(total / 1e6).toFixed(1)} MB (core not included)`);
fs.writeFileSync(path.join(dst, 'spike-packages.json'), JSON.stringify({ version, report }, null, 2));
