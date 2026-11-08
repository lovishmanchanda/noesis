// Pyodide worker for the spike. Mirrors the planned Engine interface in a minimal way.
import { loadPyodide } from '/public/pyodide/pyodide.mjs';

performance.setResourceTimingBufferSize?.(2000);

const INDEX_URL = '/public/pyodide/';
let pyodide = null;
let eventCount = 0;

// Called from Python through the `js` module: this is the event path from training-events.md.
globalThis.emit_event = (s) => {
  eventCount++;
  postMessage({ kind: 'event', s });
};
globalThis.emit_event_buf = (s, bytes) => {
  eventCount++;
  postMessage({ kind: 'event', s, buf: bytes.buffer }, [bytes.buffer]);
};

const BRIDGE_PY = `
import sys, types, json
import js
from pyodide.ffi import to_js
def emit(t, data=None, buf=None):
    d = {'type': t}
    if data:
        d.update(data)
    if buf is None:
        js.emit_event(json.dumps(d))
    else:
        js.emit_event_buf(json.dumps(d), to_js(buf.astype('float32').tobytes()))
m = types.ModuleType('bridge')
m.emit = emit
sys.modules['bridge'] = m
`;

async function writePyFiles() {
  pyodide.FS.mkdirTree('/py');
  for (const f of ['nodes.py', 'exp.py']) {
    pyodide.FS.writeFile('/py/' + f, await (await fetch('/py/' + f)).text());
  }
  pyodide.runPython("import sys\nif '/py' not in sys.path: sys.path.insert(0, '/py')");
}

const handlers = {
  // stages: [[label, [packages]], ...]. makeSnapshot: create Pyodide so a memory snapshot can be taken.
  // bridge:false skips the JS bridge (a snapshot cannot hold references to JS objects).
  async init({ stages, sab, makeSnapshot = false, bridge = true }) {
    const out = [];
    let seen = performance.getEntriesByType('resource').length;
    for (const [label, pkgs] of stages) {
      const t = performance.now();
      if (!pyodide) pyodide = await loadPyodide({ indexURL: INDEX_URL, _makeSnapshot: makeSnapshot });
      if (pkgs.length) await pyodide.loadPackage(pkgs);
      const entries = performance.getEntriesByType('resource').slice(seen);
      seen += entries.length;
      out.push({
        stage: label,
        ms: Math.round(performance.now() - t),
        bytes: entries.reduce((n, e) => n + (e.encodedBodySize || e.transferSize || 0), 0),
      });
    }
    await writePyFiles();
    if (bridge) pyodide.runPython(BRIDGE_PY);
    if (sab && pyodide.setInterruptBuffer) pyodide.setInterruptBuffer(new Int32Array(sab));
    return { stages: out, version: pyodide.version, interruptBuffer: !!sab };
  },

  async importAll() {
    const t = performance.now();
    pyodide.runPython('import numpy, pandas, sklearn.cluster, sklearn.ensemble, sklearn.linear_model, sklearn.neighbors, sklearn.neural_network, xgboost');
    return Math.round(performance.now() - t);
  },

  // Take a memory snapshot of the current interpreter (after imports). Returned as a transferable buffer.
  async makeSnapshot() {
    const t = performance.now();
    const snap = pyodide.makeMemorySnapshot();
    return { __t: true, value: { ms: Math.round(performance.now() - t), bytes: snap.byteLength }, transfer: [snap.buffer], snap };
  },

  // Start a fresh interpreter from a snapshot, then check that the libraries work without re-importing.
  async restore({ snapshot }) {
    const t = performance.now();
    pyodide = await loadPyodide({ indexURL: INDEX_URL, _loadSnapshot: snapshot });
    const restoreMs = Math.round(performance.now() - t);
    pyodide.runPython("import sys\nif '/py' not in sys.path: sys.path.insert(0, '/py')");
    pyodide.runPython(BRIDGE_PY);
    const t2 = performance.now();
    const r = await pyodide.runPythonAsync(`
import time, json
t = time.perf_counter()
import exp
from sklearn.ensemble import RandomForestClassifier
import numpy as np
X = np.random.default_rng(0).normal(size=(2000, 10)); y = (X[:, 0] > 0).astype(int)
RandomForestClassifier(n_estimators=10, random_state=0).fit(X, y)
import xgboost
json.dumps({'first_use_s': round(time.perf_counter() - t, 3)})
`);
    return { restore_ms: restoreMs, first_use_ms: Math.round(performance.now() - t2), py: JSON.parse(r) };
  },

  async fetchToFS({ url, path }) {
    const t = performance.now();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    pyodide.FS.writeFile(path, buf);
    return { ms: Math.round(performance.now() - t), bytes: buf.length };
  },

  async runPy({ code }) {
    const r = await pyodide.runPythonAsync(code);
    return typeof r === 'string' ? r : String(r);
  },

  async heap() {
    try {
      return pyodide._module.HEAPU8.byteLength;
    } catch {
      return -1;
    }
  },

  async ping() {
    return 'pong';
  },

  async storage({ path }) {
    const bytes = pyodide.FS.readFile(path);
    const out = { bytes: bytes.length };
    let t = performance.now();
    const cache = await caches.open('spike');
    await cache.put('/node', new Response(bytes.slice()));
    out.cache_put_ms = Math.round(performance.now() - t);
    t = performance.now();
    const back = await (await cache.match('/node')).arrayBuffer();
    out.cache_get_ms = Math.round(performance.now() - t);
    out.cache_ok = back.byteLength === bytes.length;
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('spike', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('blobs');
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    t = performance.now();
    await new Promise((res, rej) => {
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put(bytes.slice(), 'node');
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    out.idb_put_ms = Math.round(performance.now() - t);
    t = performance.now();
    const got = await new Promise((res, rej) => {
      const q = db.transaction('blobs').objectStore('blobs').get('node');
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    out.idb_get_ms = Math.round(performance.now() - t);
    out.idb_ok = got.byteLength === bytes.length;
    db.close();
    await caches.delete('spike');
    indexedDB.deleteDatabase('spike');
    return out;
  },
};

self.onmessage = async ({ data: { id, cmd, args } }) => {
  try {
    const result = await handlers[cmd](args || {});
    if (result && result.__t) postMessage({ id, ok: true, result: result.value, snap: result.snap, events: eventCount }, result.transfer);
    else postMessage({ id, ok: true, result, events: eventCount });
  } catch (e) {
    postMessage({ id, ok: false, error: { name: e.type || e.name, message: String(e.message || e).slice(0, 1500) } });
  }
};
