// Spike orchestrator (main thread). Each experiment returns a JSON-able object that is shown and saved
// to results/browser-<port>-<experiment>.json through the local server.
const params = new URLSearchParams(location.search);
const port = location.port;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
function log(...a) {
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  lines.push(s);
  $('log').textContent = lines.join('\n');
  console.log(s);
}
async function save(name, data) {
  const label = params.get('label') ? '-' + params.get('label') : '';
  await fetch('/save?name=' + encodeURIComponent(`browser-${port}${label}-${name}`), { method: 'POST', body: JSON.stringify(data, null, 2) });
}

// ---- worker wrapper -------------------------------------------------------------------------
function spawn() {
  const w = new Worker('/harness/engine.worker.js', { type: 'module' });
  let nextId = 0;
  const pending = new Map();
  const events = { count: 0, bytes: 0 };
  w.onmessage = ({ data: m }) => {
    if (m.kind === 'event') {
      events.count++;
      events.bytes += m.s.length + (m.buf ? m.buf.byteLength : 0);
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    m.ok ? p.res(m.snap ? { ...m.result, snap: m.snap } : m.result) : p.rej(Object.assign(new Error(`${m.error.name}: ${m.error.message}`), { pyType: m.error.name }));
  };
  w.onerror = (e) => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.rej(new Error('worker error: ' + (e.message || 'unknown')));
    }
    pending.clear();
  };
  const call = (cmd, args = {}, timeoutMs = 600000, transfer = []) =>
    new Promise((res, rej) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error('timeout after ' + timeoutMs + ' ms'));
      }, timeoutMs);
      pending.set(id, { res, rej, timer });
      w.postMessage({ id, cmd, args }, transfer);
    });
  return { call, events, terminate: () => w.terminate() };
}

function jank() {
  let last = performance.now(), maxGap = 0, frames = 0, run = true;
  const tick = (t) => {
    if (!run) return;
    maxGap = Math.max(maxGap, t - last);
    last = t;
    frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  let tlast = performance.now(), tmax = 0;
  const iv = setInterval(() => {
    const n = performance.now();
    tmax = Math.max(tmax, n - tlast - 20);
    tlast = n;
  }, 20);
  return () => {
    run = false;
    clearInterval(iv);
    return { maxFrameGapMs: Math.round(maxGap), frames, maxTimerDriftMs: Math.round(tmax) };
  };
}

const ST_DATA = [['core', []], ['numpy+pandas', ['numpy', 'pandas']]];
const ST_ML = [...ST_DATA, ['scikit-learn', ['scikit-learn']], ['xgboost', ['xgboost']]];
const ST_ALL = [...ST_ML, ['pyarrow', ['pyarrow']]];
const json = async (s, code, to = 1800000) => JSON.parse(await s.call('runPy', { code }, to));
const mb = (n) => Math.round(n / 1e6);

// ---- experiments ----------------------------------------------------------------------------
async function e0() {
  const i = {
    userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: navigator.deviceMemory ?? null, crossOriginIsolated: self.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined', port, webgpu: null,
  };
  if (navigator.gpu) {
    try {
      const a = await navigator.gpu.requestAdapter();
      if (a) {
        i.webgpu = a.info ? { vendor: a.info.vendor, architecture: a.info.architecture, device: a.info.device, description: a.info.description } : 'adapter (no info)';
        i.webgpuFeatures = [...a.features];
      } else i.webgpu = 'no adapter';
    } catch (e) { i.webgpu = 'error: ' + e.message; }
  } else i.webgpu = 'navigator.gpu missing';
  if (navigator.storage) {
    i.storageEstimate = await navigator.storage.estimate();
    i.storagePersisted = await navigator.storage.persisted();
  }
  return i;
}

async function e1() {
  const runs = [];
  for (const label of ['load-1', 'load-2', 'load-3']) {
    const s = spawn();
    const t0 = performance.now();
    const r = await s.call('init', { stages: ST_ALL });
    const imp = await json(s, 'import exp; exp.warm_imports()');
    runs.push({ label, total_ms: Math.round(performance.now() - t0), stages: r.stages, pyodide: r.version, python_imports_s: imp.import_s });
    log('E1', runs.at(-1));
    s.terminate();
  }
  return { cacheMode: port === '8082' ? 'no-store (cold)' : 'cacheable', runs };
}

// Python import cost per module (separate from downloading the wheels).
async function e1b() {
  const s = spawn();
  await s.call('init', { stages: ST_ALL });
  const imports = [];
  for (const m of ['scipy', 'sklearn', 'sklearn.linear_model', 'sklearn.ensemble', 'sklearn.neighbors', 'sklearn.cluster', 'sklearn.neural_network', 'xgboost', 'pyarrow']) {
    imports.push(await json(s, `import exp; exp.import_one('${m}')`));
    log('E1b', imports.at(-1));
  }
  s.terminate();
  return { imports, total_s: +imports.reduce((n, r) => n + r.s, 0).toFixed(2) };
}

// Does a Pyodide memory snapshot (taken after imports) remove the import cost?
async function e1c() {
  const a = spawn();
  const t0 = performance.now();
  await a.call('init', { stages: ST_ALL, makeSnapshot: true, bridge: false });
  const rec = { init_ms: Math.round(performance.now() - t0) };
  rec.imports_s = +((await a.call('importAll', {}, 600000)) / 1000).toFixed(2);
  let snap;
  try {
    snap = await a.call('makeSnapshot', {}, 600000);
  } catch (e) {
    a.terminate();
    return { ...rec, snapshot_failed: String(e.message) };
  }
  rec.snapshot_mb = +(snap.bytes / 1e6).toFixed(1);
  rec.snapshot_ms = snap.ms;
  a.terminate();
  const b = spawn();
  const t1 = performance.now();
  rec.restore = await b.call('restore', { snapshot: snap.snap }, 600000, [snap.snap.buffer]);
  rec.restore_total_ms = Math.round(performance.now() - t1);
  rec.baseline_init_plus_imports_ms = rec.init_ms + Math.round(rec.imports_s * 1000);
  b.terminate();
  return rec;
}

async function e2One(name, variant) {
  const s = spawn();
  const rec = { file: name, variant };
  const stop = jank();
  try {
    await s.call('init', { stages: ST_DATA });
    const f = await s.call('fetchToFS', { url: `/data/out/${name}.csv`, path: '/tmp/x.csv' });
    rec.csv_mb = +(f.bytes / 1e6).toFixed(1);
    rec.fetch_ms = f.ms;
    Object.assign(rec, await json(s, `import exp; exp.e2('/tmp/x.csv','${variant}')`));
    rec.wasm_heap_mb = mb(await s.call('heap'));
    rec.ok = true;
  } catch (e) {
    rec.ok = false;
    rec.error = String(e.message || e);
    try { await s.call('ping', {}, 5000); rec.worker_alive_after = true; } catch { rec.worker_alive_after = false; }
  }
  rec.jank = stop();
  s.terminate();
  return rec;
}
async function e2() {
  const files = (params.get('sizes') || 'd10k_20,d100k_20,d100k_50,d500k_50,d1000k_50').split(',');
  const rows = [];
  for (const name of files) {
    for (const variant of name === 'd1000k_50' ? ['full', 'sample100k', 'usecols10'] : ['full']) {
      rows.push(await e2One(name, variant));
      log('E2', rows.at(-1));
    }
  }
  return rows;
}

async function loadedWorker(stages, sab = null) {
  const s = spawn();
  await s.call('init', { stages, sab });
  await s.call('fetchToFS', { url: '/data/out/d100k_50.csv', path: '/tmp/d100k.csv' });
  const load = await json(s, "import exp; exp.load_data('/tmp/d100k.csv')");
  return { s, load };
}

async function e3() {
  const { s, load } = await loadedWorker(ST_ML);
  const rec = { load, models: [] };
  const stop = jank();
  for (const name of ['logistic', 'ridge', 'knn', 'kmeans', 'random_forest', 'xgboost', 'mlp']) {
    try {
      rec.models.push(await json(s, `exp.e3_one('${name}')`));
    } catch (e) {
      rec.models.push({ model: name, error: String(e.message) });
    }
    log('E3', rec.models.at(-1));
  }
  rec.jank = stop();
  rec.wasm_heap_mb = mb(await s.call('heap'));
  s.terminate();
  return rec;
}

async function e4() {
  const { s } = await loadedWorker(ST_ML);
  const rec = { hardwareConcurrency: navigator.hardwareConcurrency, crossOriginIsolated: self.crossOriginIsolated };
  rec.python = await json(s, 'exp.e4()');
  s.terminate();
  return rec;
}

async function e5() {
  const canSab = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated;
  const cases = (params.get('cases') || 'read,rf,xgb_plain,xgb_cb,mlp_loop').split(',');
  const rec = { crossOriginIsolated: self.crossOriginIsolated, interruptAvailable: canSab, cases: [] };
  if (canSab) {
    for (const c of cases) {
      const sab = new SharedArrayBuffer(4);
      const flag = new Int32Array(sab);
      const s = spawn();
      const row = { case: c };
      try {
        await s.call('init', { stages: ST_ML, sab });
        await s.call('fetchToFS', { url: '/data/out/d100k_50.csv', path: '/tmp/d100k.csv' });
        if (c === 'read') await s.call('fetchToFS', { url: '/data/out/d500k_50.csv', path: '/tmp/big.csv' });
        await json(s, "import exp; exp.load_data('/tmp/d100k.csv')");
        row.import_s = (await json(s, 'exp.warm_imports()')).import_s;
        const started = performance.now();
        const job = s.call('runPy', { code: `exp.e5_job('${c}')` }, 120000);
        await sleep(4000);
        const t0 = performance.now();
        Atomics.store(flag, 0, 2);
        const outcome = await job.then((r) => ({ result: r }), (e) => ({ error: e.message }));
        row.ran_before_cancel_ms = Math.round(t0 - started);
        row.cancel_to_stop_ms = Math.round(performance.now() - t0);
        row.outcome = outcome;
        row.stopped_by_interrupt = !!outcome.error && /KeyboardInterrupt/.test(outcome.error);
        row.finished_normally = !!outcome.result;
        if (row.stopped_by_interrupt) {
          try { row.worker_usable_after = (await s.call('ping', {}, 5000)) === 'pong'; } catch { row.worker_usable_after = false; }
        }
      } catch (e) {
        row.error = String(e.message);
      }
      s.terminate();
      rec.cases.push(row);
      log('E5', row);
    }
  }
  // Fallback: terminate and restart (warm cache)
  const s1 = spawn();
  await s1.call('init', { stages: ST_ML });
  s1.terminate();
  const t0 = performance.now();
  const s2 = spawn();
  await s2.call('init', { stages: ST_ML });
  rec.terminate_and_restart_ms = Math.round(performance.now() - t0);
  s2.terminate();
  log('E5 restart', rec.terminate_and_restart_ms);
  return rec;
}

async function e6() {
  const { s } = await loadedWorker(ST_ML);
  const rec = {};
  rec.mlp_without_events = await json(s, 'exp.e6_mlp(None)');
  let c0 = s.events.count, b0 = s.events.bytes;
  let stop = jank();
  rec.mlp_with_events = await json(s, 'import bridge; exp.e6_mlp(bridge.emit)');
  rec.mlp_jank = stop();
  rec.mlp_events = { count: s.events.count - c0, bytes: s.events.bytes - b0 };
  rec.mlp_overhead_pct = +(100 * (rec.mlp_with_events.s - rec.mlp_without_events.s) / rec.mlp_without_events.s).toFixed(1);
  rec.mlp_fit_equivalence = await json(s, 'exp.e6_mlp_fit()');
  log('E6 mlp', rec);
  c0 = s.events.count;
  stop = jank();
  rec.rf_warm_start = await json(s, 'exp.e6_rf(bridge.emit)');
  rec.rf_jank = stop();
  rec.rf_events = s.events.count - c0;
  log('E6 rf', rec.rf_warm_start);
  c0 = s.events.count;
  rec.xgb_callback = await json(s, 'exp.e6_xgb(bridge.emit)');
  rec.xgb_events = s.events.count - c0;
  log('E6 xgb', rec.xgb_callback);
  c0 = s.events.count;
  rec.kmeans_stepwise = await json(s, 'exp.e6_kmeans(bridge.emit)');
  rec.kmeans_events = s.events.count - c0;
  log('E6 kmeans', rec.kmeans_stepwise);
  c0 = s.events.count;
  stop = jank();
  const t0 = performance.now();
  rec.event_rate = await json(s, 'exp.e6_rate(bridge.emit, 20000)');
  for (let i = 0; i < 100 && s.events.count - c0 < 20000; i++) await sleep(100);
  rec.event_rate.received = s.events.count - c0;
  rec.event_rate.main_wall_ms = Math.round(performance.now() - t0);
  rec.event_rate.jank = stop();
  log('E6 rate', rec.event_rate);
  s.terminate();
  return rec;
}

// Event overhead measured with repeated alternating runs, so run order and warm-up do not bias it.
async function e6b() {
  const { s } = await loadedWorker(ST_ML);
  await json(s, 'exp.warm_imports()');
  const rec = { xgb: [], mlp: [] };
  for (let i = 0; i < 3; i++) {
    rec.xgb.push(await json(s, 'import bridge; exp.e6_xgb(bridge.emit, 60)'));
    log('E6b xgb', rec.xgb.at(-1));
  }
  for (let i = 0; i < 3; i++) {
    const a = await json(s, 'exp.e6_mlp(None, 3)');
    const b = await json(s, 'exp.e6_mlp(bridge.emit, 3)');
    rec.mlp.push({ without_s: a.s, with_s: b.s, overhead_pct: +(100 * (b.s - a.s) / a.s).toFixed(1) });
    log('E6b mlp', rec.mlp.at(-1));
  }
  s.terminate();
  return rec;
}

async function e7() {
  const { s, load } = await loadedWorker(ST_ALL);
  const rec = { load };
  rec.arrow = await json(s, 'exp.e7_arrow()');
  log('E7 arrow', rec.arrow);
  try { rec.storage = await s.call('storage', { path: '/tmp/node.feather' }); } catch (e) { rec.storage = { error: String(e.message) }; }
  if (navigator.storage) {
    rec.persistGranted = await navigator.storage.persist();
    rec.estimate = await navigator.storage.estimate();
  }
  s.terminate();
  return rec;
}

async function e9() {
  const s = spawn();
  await s.call('init', { stages: ST_ML });
  await s.call('fetchToFS', { url: '/data/out/d10k_20.csv', path: '/tmp/d10k_20.csv' });
  const r = await json(s, "import exp; exp.e9('/tmp/d10k_20.csv')");
  s.terminate();
  return r;
}

const EXPERIMENTS = { e0, e1, e1b, e1c, e2, e3, e4, e5, e6, e6b, e7, e9 };

async function runList(list) {
  window.__status = { running: null, done: [], errors: {} };
  for (const name of list) {
    window.__status.running = name;
    log(`=== ${name} ===`);
    try {
      const t = performance.now();
      const result = await EXPERIMENTS[name]();
      await save(name, { experiment: name, port, seconds: Math.round((performance.now() - t) / 1000), result });
      window.__status.done.push(name);
    } catch (e) {
      log(name, 'FAILED', e.message);
      window.__status.errors[name] = String(e.message);
      await save(name + '-error', { experiment: name, error: String(e.stack || e.message) });
    }
  }
  window.__status.running = null;
  window.__status.finished = true;
  log('all done');
}

for (const name of Object.keys(EXPERIMENTS)) {
  const b = document.createElement('button');
  b.textContent = name.toUpperCase();
  b.onclick = () => runList([name]);
  $('buttons').appendChild(b);
}
$('runAll').onclick = () => runList(Object.keys(EXPERIMENTS));
$('info').textContent = `origin :${port}  crossOriginIsolated=${self.crossOriginIsolated}`;
if (params.get('run')) runList(params.get('run').split(','));
