/// <reference lib="webworker" />
// The in-browser engine: Python (Pyodide) running in a worker, so the page stays responsive.
// It loads the Python runtime and the NOESIS package from this site, never from another host.
import type { TrainingEvent } from '@noesis/engine-client';
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
/** Steps that need scikit-learn. The package is large, so it loads on first use, not at start-up. */
const DROPPABLE = new Set(['batch_end', 'weights_snapshot', 'activation_sample', 'sample_rows']);
const LEARNING_STEPS = [
  'impute',
  'handle_outliers',
  'encode',
  'scale',
  'select_features',
  'reduce_dimensions',
];
let learningLoaded = false;

/** Loads the heavier packages the first time a pipeline needs them (scikit-learn, and pyarrow for the result cache). */
async function ensurePackagesFor(pipelineJson: string): Promise<void> {
  if (learningLoaded || !pyodide) return;
  const nodes = (JSON.parse(pipelineJson) as { nodes: { type: string }[] }).nodes;
  if (!nodes.some((n) => LEARNING_STEPS.includes(n.type))) return;
  await pyodide.loadPackage(['scikit-learn', 'pyarrow']);
  learningLoaded = true;
}

const post = (message: WorkerMessage): void => self.postMessage(message);

/** Runs Python source with named values and returns the text it leaves in `_out`. */
function py(source: string, values: Record<string, unknown> = {}): string {
  if (!pyodide) throw new Error('The engine has not started');
  for (const [name, value] of Object.entries(values)) pyodide.globals.set(name, value);
  pyodide.runPython(source);
  return String(pyodide.globals.get('_out'));
}

async function init(
  interrupt: SharedArrayBuffer | null,
  cancel: SharedArrayBuffer | null,
  id: number,
): Promise<void> {
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
  if (cancel) {
    // The training loops read this flag at every step, because some libraries swallow the interrupt.
    pyodide.globals.set('_cancel_flag', new Int32Array(cancel));
    py("session.set_cancel_flag(_cancel_flag)\n_out = 'ok'");
  }

  progress(4, 'Ready');
  post({ type: 'result', id, result: null });
}

/** Runs a training job. Events leave the worker in batches, so the page is not flooded. */
function runTrain(request: Extract<WorkerRequest, { type: 'train' }>): WorkerResult {
  let queue: TrainingEvent[] = [];
  let lastFlush = performance.now();
  const flush = (): void => {
    if (queue.length === 0) return;
    post({ type: 'events', id: request.id, events: queue });
    queue = [];
    lastFlush = performance.now();
  };
  const send = (text: string): void => {
    const event = JSON.parse(text) as TrainingEvent;
    const previous = queue[queue.length - 1];
    // A droppable event replaces an unsent one of the same kind, so a busy page never falls behind.
    if (
      previous &&
      DROPPABLE.has(event.type) &&
      previous.type === event.type &&
      previous.node === event.node
    )
      queue[queue.length - 1] = event;
    else queue.push(event);
    if (performance.now() - lastFlush >= 33 || queue.length >= 60) flush();
  };
  try {
    const out = py('_out = session.run_train(_pipeline, _hashes, _run_id, _viz, _send)', {
      _pipeline: request.pipeline,
      _hashes: request.hashes,
      _run_id: request.runId,
      _viz: request.viz,
      _send: send,
    });
    return JSON.parse(out) as WorkerResult;
  } finally {
    flush();
  }
}

async function handle(request: WorkerRequest): Promise<void> {
  try {
    let result: WorkerResult = null;
    if (request.type === 'init') {
      await init(request.interrupt, request.cancel, request.id);
      return;
    }
    if (request.type === 'train') {
      await ensurePackagesFor(request.pipeline);
      result = runTrain(request);
      post({ type: 'result', id: request.id, result });
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
      await ensurePackagesFor(request.pipeline);
      result = JSON.parse(
        py('_out = session.run_early(_pipeline, _hashes)', {
          _pipeline: request.pipeline,
          _hashes: request.hashes,
        }),
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
