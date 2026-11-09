// Prepares the files the web app serves for the in-browser engine. The output is generated and
// git-ignored; run it again after changing the Python package or the registry.
//   node scripts/prepare-engine.mjs
//
// apps/web/public/pyodide   the Python runtime and the packages (numpy, pandas, scikit-learn, ...)
// apps/web/public/engine    the NOESIS Python package, the shared registry, and a file list
// apps/web/public/samples   small example datasets
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const web = path.join(root, 'apps/web/public');
const pyodideSrc = path.join(root, 'node_modules/pyodide');
const version = JSON.parse(fs.readFileSync(path.join(pyodideSrc, 'package.json'), 'utf8')).version;

// 1. Pyodide runtime and wheels
const py = path.join(web, 'pyodide');
fs.mkdirSync(py, { recursive: true });
for (const f of [
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'pyodide.mjs',
  'python_stdlib.zip',
  'pyodide-lock.json',
]) {
  fs.copyFileSync(path.join(pyodideSrc, f), path.join(py, f));
}
const lock = JSON.parse(fs.readFileSync(path.join(pyodideSrc, 'pyodide-lock.json'), 'utf8'));
const needed = new Set();
const add = (name) => {
  const key = name.toLowerCase();
  if (needed.has(key)) return;
  if (!lock.packages[key]) throw new Error(`Not in the Pyodide lock file: ${name}`);
  needed.add(key);
  for (const dep of lock.packages[key].depends ?? []) add(dep);
};
['numpy', 'pandas', 'scipy', 'scikit-learn', 'xgboost', 'pyarrow'].forEach(add);
let downloaded = 0;
for (const name of needed) {
  const file = lock.packages[name].file_name;
  const out = path.join(py, file);
  if (fs.existsSync(out)) continue;
  const res = await fetch(`https://cdn.jsdelivr.net/pyodide/v${version}/full/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  downloaded++;
}

// 2. The NOESIS Python package and the registry
const engine = path.join(web, 'engine');
fs.rmSync(engine, { recursive: true, force: true });
fs.mkdirSync(path.join(engine, 'noesis_nodes'), { recursive: true });
const pkg = path.join(root, 'packages/nodes-py/src/noesis_nodes');
const files = fs.readdirSync(pkg).filter((f) => f.endsWith('.py'));
for (const f of files) fs.copyFileSync(path.join(pkg, f), path.join(engine, 'noesis_nodes', f));
fs.copyFileSync(
  path.join(root, 'packages/registry/data/registry.json'),
  path.join(engine, 'registry.json'),
);
fs.writeFileSync(
  path.join(engine, 'manifest.json'),
  JSON.stringify({ pyodide: version, python: files.map((f) => `noesis_nodes/${f}`) }, null, 2),
);

// 3. Sample datasets
const samples = path.join(web, 'samples');
fs.rmSync(samples, { recursive: true, force: true });
fs.mkdirSync(samples, { recursive: true });
const list = [
  {
    id: 'housing',
    file: 'housing_small.csv',
    name: 'Home prices',
    description: 'Predict a price (a number) or whether a home is expensive (a category).',
    goal: 'number',
    target: 'price',
    exclude: ['id', 'expensive', 'moved_in'],
  },
  {
    id: 'customers',
    file: 'customers_small.csv',
    name: 'Customers',
    description: 'Group similar customers. There is no right answer to predict.',
    goal: 'groups',
    exclude: ['customer_id'],
    reference: 'segment',
  },
];
for (const s of list)
  fs.copyFileSync(path.join(root, 'fixtures/data', s.file), path.join(samples, s.file));
fs.writeFileSync(path.join(samples, 'samples.json'), JSON.stringify(list, null, 2));

console.log(
  `engine files ready: Pyodide ${version}, ${needed.size} packages (${downloaded} downloaded), ${files.length} Python files, ${list.length} samples`,
);
