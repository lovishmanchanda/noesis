// Contract test: runs the same pipelines natively and inside Pyodide (the in-browser engine's
// runtime) and checks that the results agree.
//   Usage: NOESIS_PYTHON=/path/to/python node packages/nodes-py/contract/run.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadPyodide } from 'pyodide';

const root = path.resolve(import.meta.dirname, '../../..');
const src = path.join(root, 'packages/nodes-py/src/noesis_nodes');
const registry = path.join(root, 'packages/registry/data/registry.json');
const contract = path.join(root, 'fixtures/contract');
const python = process.env.NOESIS_PYTHON ?? 'python';
const cases = JSON.parse(fs.readFileSync(path.join(contract, 'cases.json'), 'utf8'));

function native(pipelineFile, dataFile) {
  const out = execFileSync(python, ['-m', 'noesis_nodes.contract', pipelineFile, dataFile], {
    env: { ...process.env, PYTHONPATH: path.join(root, 'packages/nodes-py/src') },
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.toString());
}

console.log('Starting Pyodide and loading packages (first run downloads them)...');
const py = await loadPyodide({ packageCacheDir: path.join(root, '.local', 'pyodide-cache') });
await py.loadPackage(['numpy', 'pandas', 'scipy', 'scikit-learn', 'xgboost']);
py.FS.mkdirTree('/py/noesis_nodes');
for (const file of fs.readdirSync(src).filter((f) => f.endsWith('.py'))) {
  py.FS.writeFile(`/py/noesis_nodes/${file}`, fs.readFileSync(path.join(src, file), 'utf8'));
}
py.FS.mkdirTree('/registry/data');
py.FS.writeFile('/registry/data/registry.json', fs.readFileSync(registry, 'utf8'));
py.runPython(
  "import os, sys, json\nos.environ['NOESIS_REGISTRY'] = '/registry/data/registry.json'\nsys.path.insert(0, '/py')\nfrom noesis_nodes.contract import summarize",
);

function browser(pipelineFile, dataFile) {
  py.globals.set('pipeline_json', fs.readFileSync(pipelineFile, 'utf8'));
  py.globals.set('csv_text', fs.readFileSync(dataFile, 'utf8'));
  py.runPython('result_json = json.dumps(summarize(pipeline_json, csv_text))');
  return JSON.parse(py.globals.get('result_json'));
}

/** Largest relative difference between two result trees, and where structure or text differs. */
function compare(a, b, pathName = '', out = { max: 0, problems: [] }) {
  if (typeof a === 'number' && typeof b === 'number') {
    out.max = Math.max(out.max, Math.abs(a - b) / Math.max(1, Math.abs(a)));
  } else if (a === null || b === null || typeof a !== 'object') {
    if (a !== b) out.problems.push(`${pathName}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  } else if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length)
      out.problems.push(`${pathName}: list length differs`);
    else a.forEach((v, i) => compare(v, b[i], `${pathName}[${i}]`, out));
  } else {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b ?? {})])) {
      if (!(key in (b ?? {})) || !(key in a))
        out.problems.push(`${pathName}.${key}: only on one side`);
      else compare(a[key], b[key], `${pathName}.${key}`, out);
    }
  }
  return out;
}

let failed = 0;
for (const c of cases) {
  const pipelineFile = path.join(contract, c.pipeline);
  const dataFile = path.resolve(contract, c.data);
  const a = native(pipelineFile, dataFile);
  const b = browser(pipelineFile, dataFile);
  const structure = { rows: a.rows, columns: a.columns, frameHash: a.frameHash };
  const same = compare(
    structure,
    { rows: b.rows, columns: b.columns, frameHash: b.frameHash },
    'prepared data',
  );
  const scores = compare(a.results, b.results, 'results');
  const ok =
    same.problems.length === 0 && scores.problems.length === 0 && scores.max <= c.tolerance;
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(28)} prepared data identical: ${same.problems.length === 0 ? 'yes' : 'NO'}  largest relative score difference: ${scores.max.toExponential(2)} (allowed ${c.tolerance})`,
  );
  for (const p of [...same.problems, ...scores.problems].slice(0, 5)) console.log(`      ${p}`);
}
console.log(failed === 0 ? '\nAll contract cases agree.' : `\n${failed} case(s) differ.`);
process.exit(failed === 0 ? 0 : 1);
