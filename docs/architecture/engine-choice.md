# NOESIS: engine choice (draft 0.1)

Companion to all earlier docs. The "engine" is whatever actually loads the CSV, profiles it, runs each node and trains the model, then emits the events in [training-events.md](../design/training-events.md).

## Recommendation

**Run Python (pandas, scikit-learn, XGBoost) in the browser with Pyodide, inside one Web Worker, behind an `Engine` interface. Use the same Python code in the optional local companion.**

Why this is the main argument: the browser engine and the native companion run the **same node implementations**, written as plain pandas/scikit-learn functions. There is one engine codebase, two runtimes, and the code the user exports is the code that ran.

Revisit the choice if the spike (end of this file) fails its criteria.

## Options considered

| | A. Pyodide (Python in WebAssembly) | B. JavaScript-native libraries | C. Custom Rust/C++ to WebAssembly | D. Native Python companion only |
|---|---|---|---|---|
| Algorithm coverage | Wide: full scikit-learn, XGBoost, LightGBM | Thin and uneven | Whatever we build | Full |
| Matches professionals' expectations | Yes, same library as their notebooks | No, numerics and defaults differ | Partly | Yes |
| Code export fidelity | Exact | Needs a translation layer | Needs a translation layer | Exact |
| Speed | Slower than native, single-threaded in practice | Good for small models | Best in browser | Native speed, GPU |
| First-load size | Large, cached afterwards | Small | Medium | Install step |
| Build effort | Low (reuse libraries) | Medium | Very high | Low |
| Live training events | Mixed, see table below | Easy, we own the loops | Easy | Same as A |
| Deep learning later | Not in Pyodide (no PyTorch) | TF.js, ONNX Runtime Web | Hard | PyTorch |
| Install needed | No | No | No | Yes |

Option D alone breaks the "just open a website" goal. Option C is a long project with little gain for tabular data. Option B loses fidelity with notebooks. A is the best fit, with D as the optional power-up.

## Verified facts (from the docs, checked November 2026)

- **Libraries.** The current Pyodide documentation lists scikit-learn 1.8.0, pandas 3.0.2, LightGBM 4.6.0 and XGBoost 2.1.4 as built-in packages. Older Pyodide releases ship earlier versions. We pin one Pyodide release and re-check its package page.
- **Cancelling.** Interrupting running Python needs Pyodide inside a Web Worker and a `SharedArrayBuffer`, which in turn needs the site served with cross-origin isolation headers. (MDN documents the exact headers, normally `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Confirm in the spike.)
- **DuckDB-WASM limits.** WebAssembly memory is capped at 4 GB, browsers may enforce less, and DuckDB-WASM runs single-threaded by default. Large results should be streamed, not materialised. One community report puts a CSV tool built on it at roughly 500 MB to 1 GB of file size, anecdotal and not a benchmark.

Checked in spike run 1 (details in [spike-results.md](../research/spike-results.md)): Pyodide is single-threaded (`n_jobs` has no effect), the first-load download is 51.7 MB uncompressed for the full package set, `pyarrow` is available, and speed ratios against native are 1.3–1.8× for tree models and up to about 7× for the neural net.

## Architecture

```
UI (main thread)
   │  events, control messages (training-events.md)
   ▼
Engine interface ──► Pyodide worker  (browser engine, default)
                 └─► Companion      (native Python, optional, same node code)
                 └─► JS/ONNX worker (later: CNN, transformer inference and small training)
```

### Engine interface

```ts
interface Engine {
  capabilities(): { nodeTypes, algorithms: { id, events: "live" | "replay" | "none" }[], limits }
  init(opts): Promise<void>
  loadDataset(file | handle): Promise<DatasetRef>          // fingerprint, parse, profile
  profile(datasetRef, nodeHash?): Promise<Profile>
  run(pipeline, targetNode, opts, onEvent): RunHandle       // events as in training-events.md
  cancel(runId): Promise<void>
  predict(modelRef, rows): Promise<Predictions>
}
```

`capabilities()` is a handshake. The UI hides algorithms the connected engine cannot run, and the companion advertises more (bigger data, GPU, PyTorch).

Different backends can sit behind one interface, so the later CNN and transformer work adds a JavaScript engine and does not touch the wizard.

### Python node implementations

- One package of plain functions, one per node type, using only pandas and scikit-learn (or XGBoost). Shared by Pyodide and the companion.
- Code export copies those function sources plus a short generated main script. The exported file has no dependency on NOESIS.
- Each function takes `(frames, params, ctx)` and returns outputs. Events are emitted through a small `ctx.emit(...)` hook, so node code stays readable.

### Worker layout

- **One worker, one Pyodide instance, a job queue.** A second worker doubles memory use, which is the scarce resource. Profiling runs when a dataset is imported, before any training.
- The main thread never imports data or runs ML.
- Large arrays go to the UI as transferable buffers, never as JSON.

### Data layer

- **v1: pandas inside Pyodide.** Read the CSV there (with column selection and chunked reading for big files), profile there, and keep one copy of the data.
- **Interchange format:** Arrow (via `pyarrow`, if available in Pyodide) for cached node outputs and hand-off to the UI. This resolves the "Arrow or Parquet" item in [hashing-and-runs.md](../design/hashing-and-runs.md) pending the check.
- **Possible v1.1: DuckDB-WASM for ingest of very large CSVs only.** It would sample and project columns before pandas ever sees the file. It adds a second data stack and a copy of the data in memory, so we only add it if the spike shows pandas cannot handle the target file sizes.
- **Size limits by design.** Show a clear message by file size ("this file is large, load a sample, or use the companion") instead of crashing the tab. Thresholds come from the spike.

### Models under Pyodide: which events are live

This resolves the first open item in [training-events.md](../design/training-events.md).

| Algorithm | Backend | Events | How |
|---|---|---|---|
| `mlp` | scikit-learn MLP | **live** | Own loop over `partial_fit`, reading `coefs_` between epochs. Verified in the spike (pass `classes` by keyword: the third positional argument is `sample_weight`). We handle validation and early stopping in the loop, and the exported code contains the same loop. |
| `decision_tree` | scikit-learn | replay | Walk the fitted tree in creation order. |
| `random_forest` | scikit-learn | **live** | Grow with `warm_start` and rising `n_estimators`. |
| `gradient_boosting` | **XGBoost** | **live** | XGBoost training callbacks give per-round losses. |
| `linear_regression`, `ridge` | scikit-learn | replay | Closed form. |
| `lasso` | scikit-learn | replay | No iteration callback. |
| `logistic_regression` | scikit-learn | live (approx.) | `warm_start` with stepped `max_iter`. Not tested in the spike. |
| `svm` | scikit-learn | replay | After the fit: show support vectors. |
| `knn` | scikit-learn | live | On sampled validation queries. |
| `naive_bayes` | scikit-learn | instant | Single stats event. |
| `kmeans` | scikit-learn | **live** | One-iteration steps (`max_iter=1`, seeded from previous centres). Must match a normal fit. |
| `dbscan`, `hierarchical` | scikit-learn | replay | From fitted labels and merge order. |

`gradient_boosting` in the parameter definitions is backend-neutral. Choose XGBoost as the v1 backend for its callbacks. `early_stopping_rounds` maps onto it directly.

### Cancellation

1. Preferred: `SharedArrayBuffer` interrupt, which needs cross-origin isolation headers.
2. Fallback: terminate the worker and start a new one (loses state, reloads Pyodide from cache).
3. Between iterations, nodes also check a cancel flag at their own boundaries. **This is required, not optional:** the spike found that scikit-learn's MLP training catches the interrupt and carries on, so the interrupt alone is not enough ([spike-results.md](../research/spike-results.md)).

### Hosting requirements

- A static host that can set response headers (for the isolation headers).
- **Self-host the Pyodide files.** With cross-origin isolation on, third-party scripts and files must also be served in a compatible way, so a public CDN for Pyodide may not work. This costs bandwidth.
- A service worker caches the engine files so only the first visit pays the download. The app works offline afterwards (PWA).
- Review any third-party script (analytics, fonts, embeds), since isolation can block them.

### The optional companion

- A small installable Python program (`pip install`) exposing the same `Engine` interface over a WebSocket on `localhost`.
- Runs the same node package at native speed, with threads, large files and GPU.
- The page connects only to localhost, checks a pairing token, and the user can see the connection status. The full design (pairing, origin checks, threat model, protocol, jobs, cache) is in [companion.md](../design/companion.md).

### GPU and other hardware

The browser engine (Pyodide) is CPU-only: WebAssembly cannot run CUDA, and scikit-learn has no GPU path. "Use the GPU when available" therefore means switching engines, not a flag:

| Hardware | How it is used |
|---|---|
| NVIDIA GPU (Windows, Linux) | The companion runs XGBoost or LightGBM with GPU training, and PyTorch with CUDA for deep learning later |
| Apple Silicon (Mac) | PyTorch with the MPS (Metal) backend in the companion. XGBoost has no Metal path. |
| Any GPU, in the browser | WebGPU, for TF.js and ONNX Runtime Web (the later deep-learning engine), where the browser supports it |

Policy:
- `capabilities()` reports the available devices (`cpu`, `cuda`, `mps`, `webgpu`).
- Setting: **Auto** (default), **Always CPU**, **Prefer GPU**. Auto picks the fastest connected engine and device that supports the chosen algorithm. If the companion is not connected, it runs on the browser CPU engine and tells the user a faster option exists.
- The header shows the active device. Each run records it in `engine.device`.
- If a GPU run fails (for example out of GPU memory), it falls back to CPU and says so.
- Results can differ slightly between CPU and GPU, so a run's `deterministic` flag is `approx` on GPU (see [hashing-and-runs.md](../design/hashing-and-runs.md)).
- v1 supports NVIDIA (CUDA) and Apple (MPS). AMD and Intel GPUs are out of scope for now.

### Later: deep learning

CNN and transformer support is a separate engine behind the same interface:

| Need | Candidate |
|---|---|
| Run pretrained models in the browser | ONNX Runtime Web, transformers.js (WebGPU where available) |
| Train or fine-tune small models in the browser | TensorFlow.js |
| Serious training | the companion with PyTorch |

Pyodide stays the engine for tabular data.

## Spike findings (run 1, Mac and Chromium only)

Full numbers and caveats in [spike-results.md](../research/spike-results.md). Verdict: **go, with adjustments.**

- **Data:** pandas in the browser runs close to native speed. 1M rows × 50 columns (369 MB CSV) read and profiled in about 9.5 s with a 1.3 GB heap, and no UI stall.
- **Models:** random forest and XGBoost run 1.3–1.8× slower than single-thread native. The browser engine is single-threaded (Python sees 1 CPU, threads cannot start). Dense linear algebra is much slower (the MLP is about 7× slower than native).
- **Load time:** 7.3 s warm on a calm machine (3.3 s of package loading plus 2.4 s of Python imports), which misses the 5 s target. A Pyodide memory snapshot failed with an internal error.
- **Events:** MLP, warm-started forest, XGBoost callback and stepwise K-means all work live and match normal fits (forest and K-means exactly). Event overhead is about 0%.
- **Cancel:** the interrupt stops pandas, forest and XGBoost within 0.06–1.4 s. scikit-learn's MLP swallows it, so an own cancel flag is required.
- **Storage:** `pyarrow` works. Feather with lz4 reloads a 100k × 50 table in 0.5 s. This resolves the Arrow or Parquet item.
- **Cross-engine results:** the same Python file gives identical results for profiling, logistic regression and KNN, and slightly different results for tree and clustering models.
- **GPU:** the browser engine is CPU only. WebGPU is available on this Mac for a later deep-learning engine.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Single-threaded, slower than native | Long runs on mid-size data | Presets, row limits with clear messages, the companion |
| First load is large | Poor first impression | Cache, progress screen, load core first and packages on demand |
| Memory (about 4 GB WebAssembly cap, less in some browsers) | Tab crash on big data | Sampling, column selection, size warnings, `E_OOM` handling, heartbeat detection |
| Cross-origin isolation breaks third-party embeds | Hosting constraints | Self-host everything, audit scripts |
| Pyodide version drift | Results change between releases | Pin the version, include it in `engine` info on each run, bump `engineEpoch` when results can change |
| No threads | `n_jobs` and parallel forests do nothing | Document, benchmark honestly |

## Spike plan (before committing)

A short experiment, with pass criteria agreed first. The detailed plan, thresholds, decision matrix and schedule are in [spike-plan.md](../research/spike-plan.md). Summary:

1. **Load time and size:** cold and warm load of Pyodide with pandas, scikit-learn and XGBoost. Pass: warm start under a few seconds on a typical laptop.
2. **Data scale:** read and profile CSVs of 10k, 100k, 500k and 1M rows (about 20 to 50 columns). Record peak memory and time. Pass: 100k×50 comfortable, and a graceful limit message for larger files.
3. **Speed against native:** random forest (100 trees), XGBoost, logistic regression, MLP on the same data in Pyodide and native Python. Record the ratio and decide which preset sizes are realistic.
4. **Threads:** confirm whether any library uses more than one thread.
5. **Cancellation:** interrupt with `SharedArrayBuffer`, and the terminate-and-restart fallback. Measure cancel latency.
6. **Events:** build the MLP epoch loop, the warm-start forest and the XGBoost callback, and the K-means one-step loop. Check K-means matches a normal fit. Measure event overhead.
7. **Arrow:** check `pyarrow` availability and Arrow or Parquet round-trip speed for cached node outputs.
8. **Browsers:** run the above in Chrome, Firefox and Safari. Record the gaps.
9. **Same code, two runtimes:** run one Python node file in Pyodide and natively and compare outputs.
10. **DuckDB-WASM comparison:** only if the data-scale test fails.
11. **GPU and platform:** device detection, CPU against GPU, and Windows against Mac.

Outcome: confirm A, or move specific workloads to the companion by default, or add DuckDB-WASM. **Status:** run 1 (Mac, Chromium) is done with the verdict "go, with adjustments". Windows, NVIDIA, Firefox and Safari are pending.

## References

- Pyodide, packages built in Pyodide: https://pyodide.org/en/latest/usage/packages-in-pyodide.html
- Pyodide, interrupting execution: https://pyodide.readthedocs.io/en/latest/usage/keyboard-interrupts.html
- DuckDB-WASM overview and limits: https://duckdb.org/docs/stable/clients/wasm/overview

## Open items

- Spike run 1 is done ([spike-results.md](../research/spike-results.md)). Still to run: Windows, NVIDIA GPU, Firefox, Safari, plus the real size limit and repeated timings on a quiet machine. Those set the final file-size limits and preset sizes.
- A loading plan: the full set is 51.7 MB uncompressed and warm start was 7.3 s on a calm machine; lazy-load heavy packages.
- Whether the companion ships in v1 or later.
- Companion security design: drafted in [companion.md](../design/companion.md), needs a review and the browser checks listed there.
- DuckDB-WASM: not needed on run-1 evidence (1M × 50 loaded in the browser). Revisit if the real limit on other machines is lower.
- Browser support matrix: Chromium only so far.
