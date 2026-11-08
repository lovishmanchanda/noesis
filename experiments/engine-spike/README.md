# Engine spike harness

Throwaway code that tests the engine choice. Plan: [../docs/spike-plan.md](../../docs/research/spike-plan.md). Everything lives in this folder, including the Python environment (`.env`) and the downloaded Pyodide files (`public/pyodide`).

Windows machine? Follow [WINDOWS.md](WINDOWS.md). Add `?label=<name>` to the browser address so results from different browsers do not overwrite each other.

## Setup (once per machine)

Needs Node 20+ and conda.

```bash
npm install
node scripts/fetch_pyodide.mjs
conda create -y -p ./.env python=3.14
./.env/bin/python -m pip install --no-cache-dir -r native/requirements.txt
./.env/bin/python data/gen_data.py
```

Windows (PowerShell or cmd): use `.\.env\python.exe` instead of `./.env/bin/python`.

## Run the browser experiments

```bash
node server.mjs
```

Open one of these in Chrome (also try Firefox and Safari) and click **Run all**, or add `?run=e1,e2,e3,e4,e5,e6,e7,e9`:

| URL | Purpose |
|---|---|
| http://localhost:8080/ | normal run (cross-origin isolated, cacheable) |
| http://localhost:8081/ | not isolated (fallback test for cancel) |
| http://localhost:8082/ | cold load (no cache), use `?run=e1` |

Results are saved automatically to `results/browser-<port>-<experiment>.json`.

Run one machine at a time and keep the browser tab in the foreground. Background tabs get throttled and distort timings.

## Run the native baseline and E9 (same code)

```bash
./.env/bin/python native/bench.py <label>
```

## GPU (E11)

```bash
./.env/bin/python native/gpu_bench.py <label>
```

On a machine with an NVIDIA GPU, install the CUDA-capable XGBoost wheel (the pinned pip wheel on Windows and Linux includes it) and make sure `nvidia-smi` works. Without a GPU the script records that and skips.

## Send results back

Zip the `results` folder from each machine (label the files with the machine name) and share it.
