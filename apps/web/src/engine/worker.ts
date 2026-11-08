/// <reference lib="webworker" />
// The in-browser engine: Python (Pyodide) running in a worker, so the page stays responsive.
// It loads the Python runtime and the NOESIS package from this site, never from another host.
import type { WorkerMessage, WorkerRequest, WorkerResult } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

interface PyodideApi {
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: Uint8Array | string): void };
  loadPackage(names: string | string[]): Promise<void>;
  runPython(code: string): unknown;
  globals: { get(name: string): unknown; set(name: string, value: unknown): void };
  setInterruptBuffer(buffer: Int32Array): void;
}

const BASE = self.location.origin;
let pyodide: PyodideApi | null = null;
let queue: Promise<void> = Promise.resolve();

const post = (message: WorkerMessage): void => self.postMessage(message);

/** Runs Python source with named values and returns the text it leaves in `_out`. */
function py(source: string, values: Record<string, unknown> = {}): string {
  if (!pyodide) throw new Error('The engine has not started');
  for (const [name, value] of Object.entries(values)) pyodide.globals.set(name, value);
  pyodide.runPython(source);
  return String(pyodide.globals.get('_out'));
}

async function init(interrupt: SharedArrayBuffer | null, id: number): Promise<void> {
  const steps = 4;
  const progress = (step: number, stage: string): void =>
    post({ type: 'progress', stage, step, steps });

  progress(1, 'Starting Python');
  const { loadPyodide } = (await import(/* @vite-ignore */ `${BASE}/pyodide/pyodide.mjs`)) as {
    loadPyodide(options: { indexURL: string }): Promise<PyodideApi>;
  };
  pyodide = await loadPyodide({ indexURL: `${BASE}/pyodide/` });

  progress(2, 'Loading the data tools');
  await pyodide.loadPackage(['numpy', 'pandas']);

  progress(3, 'Loading NOESIS');
  const manifest = (await (await fetch(`${BASE}/engine/manifest.json`)).json()) as {
    python: string[];
  };
  pyodide.FS.mkdirTree('/py/noesis_nodes');
  pyodide.FS.mkdirTree('/registry');
  for (const file of manifest.python) {
    pyodide.FS.writeFile(`/py/${file}`, await (await fetch(`${BASE}/engine/${file}`)).text());
  }
  pyodide.FS.writeFile(
    '/registry/registry.json',
    await (await fetch(`${BASE}/engine/registry.json`)).text(),
  );
  py(
    "import os, sys\nos.environ['NOESIS_REGISTRY'] = '/registry/registry.json'\nsys.path.insert(0, '/py')\nfrom noesis_nodes import session\n_out = 'ok'",
  );
  if (interrupt) pyodide.setInterruptBuffer(new Int32Array(interrupt));

  progress(4, 'Ready');
  post({ type: 'result', id, result: null });
}

async function handle(request: WorkerRequest): Promise<void> {
  try {
    let result: WorkerResult = null;
    if (request.type === 'init') {
      await init(request.interrupt, request.id);
      return;
    }
    if (request.type === 'openCsv') {
      pyodide?.FS.mkdirTree('/data');
      const path = `/data/${request.name.replace(/[^\w.-]/g, '_')}`;
      pyodide?.FS.writeFile(path, new Uint8Array(request.bytes));
      result = JSON.parse(
        py('_out = session.open_csv(_path, _settings)', {
          _path: path,
          _settings: JSON.stringify(request.settings),
        }),
      ) as WorkerResult;
    } else {
      result = JSON.parse(
        py('_out = session.run_early(_pipeline)', { _pipeline: request.pipeline }),
      ) as WorkerResult;
    }
    post({ type: 'result', id: request.id, result });
  } catch (error) {
    const e = error as { type?: string; name?: string; message?: string };
    const lines = String(e.message ?? error)
      .trim()
      .split('\n');
    post({
      type: 'error',
      id: request.id,
      name: e.type ?? e.name ?? 'Error',
      message: lines[lines.length - 1] ?? 'Something went wrong',
    });
  }
}

// Jobs run one at a time, in the order they arrive.
self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  queue = queue.then(() => handle(event.data));
};
