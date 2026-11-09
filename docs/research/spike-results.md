# NOESIS: engine spike results (run 1 Mac, run 2 Windows)

Plan: [spike-plan.md](spike-plan.md). Code and raw JSON: `experiments/engine-spike/` and `experiments/engine-spike/results/`. Reproduce with [experiments/engine-spike/README.md](../../experiments/engine-spike/README.md).

## Verdict

**Go, with adjustments.** Pyodide (Python in WebAssembly) is fast enough for the v1 tabular workflow on this machine, live events work, and cancellation works. Two items missed their proposed criteria as written (warm start time, cancel for scikit-learn's MLP) and have concrete fixes. Run 1 covers one machine and one browser only, so this is a strong first signal, not a final answer. Run 2 (Windows, Chrome and Edge, NVIDIA GPU) is summarised in [Run 2: Windows](#run-2-windows) and confirms the verdict, with a much slower start-up as the main new finding.

## What was and was not tested

| Tested | Not tested yet |
|---|---|
| Mac: MacBook Air, Apple M2, 8 cores, 8 GB RAM, macOS 27.2 | Firefox, Safari |
| Chromium 152 (embedded browser), cross-origin isolated | Real user datasets (only seeded synthetic data) |
| Windows 11 laptop, Core Ultra 9 185H, 15.5 GB RAM, RTX 4060 (run 2): Chrome 157 and Edge 157 headless, native baseline, CUDA | Normal (not headless) Windows browser windows |
| Pyodide 314.0.7 (Python 3.14.2) with numpy 2.4.6, pandas 3.0.2, scikit-learn 1.8.0, scipy 1.18.0, XGBoost 2.1.4, pyarrow 22.0.0 | The point where a big file fails (not reached, see E2) |
| Native baseline: same library versions, Python 3.14.10, in `experiments/engine-spike/.env` | |

**Noise warning.** The Mac was running other apps. The same load took 3.4 s once and 19–24 s when the machine was busy, and one random forest run varied from 31 s to 42 s. Numbers below are from calm runs unless marked. Each timing was run 1 to 3 times, not the 5 the plan asked for.

## Results by experiment

### E1. Load time (criterion: warm start under 5 s; cold under 30 s at 50 Mbit)

| Item | Result |
|---|---|
| Download size, uncompressed | 51.7 MB: core 13.5, numpy+pandas 7.9, scikit-learn+scipy 18.7, XGBoost 1.6, pyarrow 10.0 |
| Package load, warm, calm machine | about 3.3 s (core 1.0, numpy+pandas 0.4, scikit-learn 1.0, XGBoost 0.06, pyarrow 0.85) |
| Python imports on top of that | about 2.4 s (calm). `import sklearn` is the big one. |
| **Total warm start, calm** | **7.3 s** (3 runs: 7.47, 7.32, 7.31) |
| Total warm start, machine busy | 19–24 s |
| Cold start at 50 Mbit | estimate about 16 s (7.3 s plus 51.7 MB at 50 Mbit); not measured with real throttling |

**Result: warm start misses the 5 s target (7.3 s).** Package loading alone (3.3 s) would pass. The time is mostly compiling WebAssembly libraries and importing scikit-learn.

Tried a fix: a Pyodide memory snapshot taken after imports, to skip the import cost. It failed with an internal error ("Unexpected hiwire entry") in this Pyodide build, even with a minimal setup. Not viable without more digging.

Fixes to plan: load pyarrow and XGBoost only when needed, show a proper loading screen, keep Pyodide cacheable so the browser reuses its compiled code, and budget about 7 s for first interaction. Re-test snapshots when Pyodide updates.

### E2. Data scale (criterion: 100k×50 reads and profiles in under 20 s with under 1.5 GB)

| File | CSV size | Read | Profile | WebAssembly heap after | Native read / profile |
|---|---|---|---|---|---|
| 10k × 20 | 1.4 MB | 0.04 s | 0.08 s | 113 MB | 0.03 / 0.04 s |
| 100k × 20 | 13.9 MB | 0.16 s | 0.33 s | 136 MB | 0.18 / 0.20 s |
| 100k × 50 | 36.8 MB | 0.38 s | 0.78 s | 196 MB | 0.46 / 0.62 s |
| 500k × 50 | 184 MB | 1.8 s | 2.8 s | 584 MB | 1.55 / 1.95 s |
| 1M × 50 | 369 MB | 3.7 s | 5.8 s | 1,316 MB | 2.89 / 3.37 s |
| 1M × 50, sample 100k rows | 369 MB | 0.39 s | 0.78 s | 196 MB | |
| 1M × 50, 10 columns only | 369 MB | 1.9 s | 1.1 s | 338 MB | |

**Pass, with room to spare.** pandas in WebAssembly runs close to native speed. The main thread never stalled (longest frame gap 18 ms). No failure up to 1M rows × 50 columns, so the real limit is not found yet: the 4 GB WebAssembly cap and a 2–3M row file still need testing. Selecting columns or sampling cuts memory a lot, as expected. E10 (DuckDB-WASM) is not needed on this evidence.

### E3. Speed against native (criterion: random forest within 5× of single-thread native and under 2 min; XGBoost within 3× and under 1 min)

100k × 50 file (80k training rows, 67 features after encoding), Pyodide single thread against native.

| Model | Pyodide fit | Native 1 thread | Native all threads | Ratio to 1 thread |
|---|---|---|---|---|
| Logistic regression | 1.0 s | 0.29 s | 0.22 s | 3.5× |
| Ridge | 3.5 s | 0.02 s | 0.01 s | about 160× (3.5 s absolute) |
| KNN (predict 2k rows) | 0.72 s | 0.08 s | 0.04 s | 9× |
| K-means (8 clusters) | 1.9 s | 0.40 s | 0.26 s | 4.8× |
| **Random forest (100 trees, depth 12)** | **31–42 s** | 23.7 s | 4.5 s | **1.3–1.8×** |
| **XGBoost (200 rounds)** | **4.6–4.8 s** | 2.86 s | 1.17 s | **1.7×** |
| MLP (64, 32), 20 epochs | 17.5 s (43 s when the machine was busy) | 2.4 s | 2.5 s | 7× |

**Pass for the two criteria models.** Tree models are close to native speed. Against a multi-threaded native run the gap is larger (random forest about 7–9×, XGBoost about 4×) because the browser has no threads (see E4). Anything dominated by dense linear algebra (ridge, the neural network) is much slower than native because WebAssembly has no fast BLAS; fine at this size, but the neural network is the weak spot and will not scale. Scores match native closely (see E9 for the small differences).

### E4. Threads

Python inside Pyodide sees 1 CPU (`os.cpu_count()` is 1), even though the browser reports 8 hardware threads. Starting a thread fails ("can't start new thread"). `n_jobs=4` gave no speedup for random forest (2.87 s against 2.86 s) and almost none for XGBoost (1.00 against 0.93 s). **The browser engine is single-threaded.** Heavy work belongs on the companion.

### E5. Cancellation (criterion: stops within 2 s by interrupt, or within 8 s by terminate and restart)

| Job | Time from cancel to stop | Result |
|---|---|---|
| pandas read of a 184 MB file | 94 ms | stopped |
| Random forest fit (400 trees) | 0.67–1.4 s | stopped (limited by time per tree) |
| XGBoost, no callback | 242 ms | stopped |
| XGBoost, with a Python callback | 59 ms | stopped |
| scikit-learn MLP epoch loop | **not stopped in 116 s** | interrupt was swallowed |
| Terminate worker and restart | 7–15 s (about 7.3 s when calm) | works, state lost |

The interrupt works across pandas, scikit-learn trees and XGBoost, and the worker stays usable afterwards. **The MLP exception:** scikit-learn's own MLP training code catches `KeyboardInterrupt`, prints a warning and carries on (confirmed in its source). So library code can swallow the interrupt. **Rule for the engine: every training loop we own checks our own cancel flag each epoch, round or tree, in addition to the interrupt.** The terminate-and-restart fallback is on the edge of the 8 s criterion.

### E6. Live events (criterion: overhead under 10%, equivalence checks hold, UI responsive at 30 messages per second)

| Check | Result |
|---|---|
| MLP epoch loop (`partial_fit`) against normal `fit` | accuracy 0.8288 against 0.8296: within noise |
| MLP loop with events against without (3 alternating runs) | −1.7%, +0.1%, +0.7% |
| Random forest grown with `warm_start` against one shot | **identical predictions** (difference 0), time +7% |
| XGBoost with a per-round callback against without (3 runs) | −2.4%, +0.2%, −0.3%; same predictions |
| K-means one iteration at a time against normal fit | **identical**: same inertia (8,737,743) and same 69 iterations |
| Event throughput | 20,000 events in 0.12 s (about 6 µs each); main thread longest frame gap 17 ms |
| Payload size | 30 events including 15 weight snapshots (32×32 floats) came to 67 kB |

**Pass.** All four live-event loops work and match the normal fits, and events are effectively free. An earlier run showed a 35% overhead and a 6 s frame gap, but both came from a busy machine and a throttled pane, and the repeated runs above replaced them.

### E7. Storage (criterion: cached 100k×50 output reloads in under 2 s)

| Format (100k × 50) | Size | Write | Read |
|---|---|---|---|
| Feather, uncompressed | 42.8 MB | 0.21 s | 0.94 s |
| **Feather, lz4** | **31.4 MB** | 0.46 s | **0.49 s** |
| Feather, zstd | 28.9 MB | 0.69 s | 0.69 s |
| Parquet, snappy | 31.5 MB | 1.72 s | 1.14 s |
| Parquet, zstd | 30.0 MB | 1.67 s | 0.77 s |

`pyarrow` works in Pyodide with all codecs. Storing the 42.8 MB file: Cache Storage put 164 ms and get 19 ms; IndexedDB put 131 ms and get 43 ms. **Pass.** Recommendation: Feather with lz4 for cached node outputs. The browser reported a storage quota of about 1.56 GB, and `persist()` was not granted, so the eviction rules in [hashing-and-runs.md](../design/hashing-and-runs.md) matter; other browsers may differ.

### E9. Same code in both runtimes

The same `py/nodes.py` ran unchanged in Pyodide and natively. The profile output was identical (hash of the profile rounded to 4 decimals matched). Logistic regression (0.83) and KNN (0.7265) scores were identical. **Tree and clustering results differ slightly:** random forest scored 0.811 against 0.8105 on the 10k file (one test row), 0.82125 against 0.8226 on the 100k file, and K-means inertia differed by 0.2% (14,043,241 against 14,068,480). So the single-codebase argument holds, but results are not bit-identical across runtimes. **`deterministic: "exact"` applies only within one engine;** moving a project between the browser and the companion gives `approx` results. Update the run records accordingly.

### E11. GPU and platform (Mac part)

WebGPU is available in this browser (Apple GPU, Metal 3, 23 features including `shader-f16` and subgroups), so a WebGPU path for the later deep-learning engine is viable on Mac. There is no NVIDIA GPU here, so CPU against CUDA is not measured. `spike/native/gpu_bench.py` is ready to run on the Windows machine.

### E8 and E10

E8 (browser matrix) covered Chromium only. E10 was not triggered because E2 passed.

## Run 2: Windows

Machine: Alienware laptop, Intel Core Ultra 9 185H (22 threads), 15.5 GB RAM, RTX 4060 Laptop GPU, Windows 11. Chrome 157 and Edge 157, both headless, plus native Python 3.14.7. Same Pyodide and library versions as run 1. Machine notes, deviations from the guide and raw JSON: [results-from-windows/](../../experiments/engine-spike/results-from-windows/MACHINE-NOTES.md). The machine was idle and plugged in for the runs and was set to performance power mode by the user. Windows Defender real-time scanning was on. Chrome and Edge numbers agree within about 10%, so Chrome values are quoted below unless stated.

| Experiment | Windows result | Against the Mac run |
|---|---|---|
| **E1 load** | **Warm start 18.8–22.1 s** (Chrome), 18.0–19.4 s (Edge). Cold (no cache, local server) 17.7–21.6 s. Package loading about 8 s of it, Python imports 6.2–6.9 s. | **Fails the 5 s target by a wide margin.** About 2.6× slower than the calm Mac (7.3 s) and the same as the busy Mac (19–24 s). Cause not isolated: Defender scanning WebAssembly and package files is the leading suspect. |
| E2 data scale | All five files pass. 100k × 50: read 0.87 s, profile 1.7 s, 196 MB heap. 1M × 50: read 8.4 s, profile 13.6 s, 1.3 GB heap. 1M rows with 10 columns: 4.2 s read. Longest frame gap at most 33 ms. | Same shape as the Mac; the 1M × 50 case works. |
| E3 speed | Random forest 69.6 s (Chrome), 67.2 s (Edge); native one thread 50.4 s; ratio **1.4×**. XGBoost 10.8 s against 8.7 s native, **1.2×**. Logistic 2.9 s (5×), K-means 5.2 s (11×), MLP 44.9 s (4.9×), ridge 6.6 s (124×). Scores identical to the Mac's to every printed digit. | Browser times are about 1.5–2.6× the Mac's; the native baseline is also slower than the M2 (random forest 50 s against 24 s), so ratios to native are better than on the Mac. Both criteria models pass. |
| E4 threads | Python sees 1 CPU out of 22 threads; starting a thread fails; `n_jobs=4` gives no speedup (5.96 s against 6.10 s). | Same as the Mac: single-threaded. |
| E5 cancel | Interrupt stops pandas read, random forest, plain XGBoost and XGBoost with a callback in **26–57 ms** (Edge random forest 424 ms); the worker stays usable. The scikit-learn MLP loop was **not stopped in 116 s**. Terminate and restart: 5.9–6.0 s. | Same pattern as the Mac. The MLP exception holds on Windows, so the own-cancel-flag rule stands. Restart is inside the 8 s criterion here. |
| E6 live events | MLP loop with events −3.9% (Chrome), −2.3% (Edge); XGBoost callback −1.0%; random forest warm start identical (difference 0); K-means stepped identical (inertia 8,737,743, 69 iterations). 20,000 events in 0.47 s. Longest frame gap 17 ms in every loop. | Pass. Same equivalence results as the Mac. The 6 s frame gaps seen on the Mac came from a throttled pane and do not appear here (headless page, idle machine). |
| E7 storage | Feather lz4 31.4 MB, write 0.26 s, read 0.23 s. Cache Storage put 178 ms, get 61 ms; IndexedDB put 242 ms, get 113 ms. Quota 10.8 GB; `persist()` not granted. | Pass. Feather with lz4 stays the recommendation. Quota is much larger than on the Mac (1.56 GB), but it differs by browser and disk. |
| E9 same code | Profile hash identical to the Mac (`5249abca…`); logistic 0.83, KNN 0.7265, random forest 0.811, all identical. | Identical to the Mac for this file. The 100k-file differences for tree and clustering models noted in E9 were not re-measured across engines. |
| E11 GPU | XGBoost on 500k rows: CPU 14.3 s, **CUDA 6.6 s (2.2× faster)**, no errors, driver 616.56. | CUDA works on Windows with the pinned XGBoost 2.1.4. The speed-up is real but modest at this size, so GPU is worth offering through the companion, not worth a special effort. |

### What run 2 changes

1. **Start-up time is the main risk.** A new user on a typical Windows laptop may wait about 20 s the first time and again after the browser drops its cache. The loading screen and lazy loading are now required, not optional, and the first-load budget in the design should say 20 s on Windows. Next step: measure with Defender scanning excluded for the Pyodide folder, and with a real browser profile (not headless), to see whether this is scanning, headless mode or the CPU.
2. **Everything else holds up.** Cancel, live events, storage, scale limits and same-code checks behave as on the Mac.
3. **Browser results on Windows are not slower in a way that changes the design.** The weak spots are the same as on the Mac: dense linear algebra and the neural network, and no threads.
4. **GPU via the companion is confirmed possible on NVIDIA/Windows**, with a 2× gain on a mid-size XGBoost job.

## Decision matrix outcome

| Rule from the plan | Outcome |
|---|---|
| All critical items pass | Almost: E1 warm start misses its target |
| E5 interrupt only at boundaries | Applies to MLP: add own cancel flag |
| E1 warm start too slow | Work on loading strategy; stays a go because package loading alone is 3.3 s and imports are 2.4 s |
| E6 equivalence checks fail | Did not happen |
| E9 fails | Did not fail; results are close but not bit-identical |

## Adjustments to build into the design

1. **Loading:** lazy-load heavy packages, show a loading screen, keep Pyodide files cacheable, budget about 7 s warm. Re-test memory snapshots later.
2. **Cancellation:** interrupt plus our own cancel flag checked every epoch, round and tree. Never rely on the interrupt alone.
3. **Reproducibility:** `exact` within one engine, `approx` across engines.
4. **Neural networks:** the browser MLP is about 7× slower than native and will not scale. Cap rows × epochs for the in-browser MLP, and send serious neural-network work to the companion or WebGPU.
5. **Linear algebra:** BLAS-heavy models (ridge and similar) are far slower than native; fine at 80k × 67, but re-check on larger data.
6. **Cache format:** Feather with lz4.
7. **Data limits:** start with a soft limit near 1M rows × 50 columns and warn above it, until the real limit is found.
8. **Threads:** document that the browser engine is single-threaded; the companion is the route to speed.

## Still to do

- Find why Windows start-up is about 20 s: repeat E1 with Defender scanning excluded for the Pyodide folder, and in a normal (not headless) browser window.
- Run Firefox and Safari (E8). Firefox is not installed on the Windows machine. The built-in browser only covers Chromium.
- Find the real size limit (2–3M rows, the 4 GB cap).
- Repeat timings 5 times on a quiet machine, and test with real throttled cold loads.
- Real user datasets instead of synthetic ones.
