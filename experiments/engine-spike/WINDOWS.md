# Running the spike on Windows

Goal: repeat the Mac spike on a Windows machine, and test the GPU if it has an NVIDIA card. Background and the Mac results: [docs/research/spike-results.md](../../docs/research/spike-results.md).

Time needed: about 15 minutes of setup and 40 to 60 minutes of tests. Most of that is waiting.

## What you need

| Item | Notes |
|---|---|
| Windows 10 or 11, 64-bit | |
| Node.js 20.11 or newer | `node --version` to check |
| Conda | Miniconda or Anaconda |
| Chrome or Edge | Both are worth running. Firefox is optional. |
| About 3 GB free disk | The test data is about 580 MB and the Python environment about 450 MB |
| Internet during setup | Downloads the Pyodide files and Python packages |
| NVIDIA GPU with a current driver | Optional, only for the GPU test |

Everything stays inside the `experiments/engine-spike` folder. Nothing is installed system-wide except what Node and Conda already do.

## 1. Get the folder onto the Windows machine

Either clone the repository on the Windows machine and work in `experiments/engine-spike`, or zip the experiment without the big generated parts (they are rebuilt on Windows). From the repository root on the Mac:

```bash
zip -r engine-spike-for-windows.zip experiments/engine-spike -x "experiments/engine-spike/.env/*" "experiments/engine-spike/node_modules/*" "experiments/engine-spike/public/*" "experiments/engine-spike/data/out/*" "experiments/engine-spike/results/*" "experiments/engine-spike/*.log"
```

Copy the zip over (USB, cloud drive, email) and unzip it somewhere with a short path, for example `C:\noesis`. Do the rest in PowerShell from inside the `experiments\engine-spike` folder.

## 2. One-time setup

Run these one at a time.

```powershell
npm install
```

```powershell
node scripts/fetch_pyodide.mjs
```

Expected: a list of 14 packages and "Pyodide 314.0.7: 14 packages, 38.2 MB".

```powershell
conda create -y -p .\.env python=3.14
```

```powershell
.\.env\python.exe -m pip install --no-cache-dir -r native\requirements.txt
```

```powershell
.\.env\python.exe data\gen_data.py
```

Expected: five CSV files written (the last one is about 369 MB). The generator is seeded, so the files match the Mac's.

If a pinned package version is not available for Windows, stop and report which one to the maintainer. Do not change versions, because the browser and native versions must match for the comparison to mean anything.

## 3. Prepare the machine

These make the numbers trustworthy. The Mac results varied by up to 7× when other apps were busy.

- Plug the laptop in and set the power mode to best performance.
- Close browsers, chat apps, sync tools and anything else heavy. No downloads or updates running.
- Antivirus real-time scanning can slow file reads. Leave it on, but note it in your machine notes.
- Do not use the machine while a test runs.

## 4. Native baseline

Pick a short name for the machine, for example `win-desktop`.

```powershell
.\.env\python.exe native\bench.py win-desktop
```

About 3 to 6 minutes. It writes `results\native-win-desktop.json`.

## 5. Browser tests

Start the server in one PowerShell window and leave it running:

```powershell
node server.mjs
```

It prints four addresses (ports 8080 to 8083). It only listens on this machine.

Open Chrome (or Edge) and go to the first address below. Tests start by themselves. Keep that tab in front and wait until the log box at the bottom ends with `all done`. The line at the top of the page must say `crossOriginIsolated=true`.

Use a `label` in the address so results from different browsers do not overwrite each other: `win-chrome`, `win-edge`, `win-firefox`.

| Batch | Address | Time | What it tests |
|---|---|---|---|
| A | `http://localhost:8083/?label=win-chrome&run=e0,e1,e4,e9,e7` | 1–2 min | device info, load time, threads, same-code check, storage |
| B | `http://localhost:8083/?label=win-chrome&run=e2` | 2–4 min | reading and profiling files up to 1M rows |
| C | `http://localhost:8083/?label=win-chrome&run=e3` | 3–6 min | model speed |
| D | `http://localhost:8083/?label=win-chrome&run=e6b,e6` | 6–10 min | live-event overhead and equivalence |
| E | `http://localhost:8083/?label=win-chrome&run=e5` | 5–6 min | cancellation (one case waits 2 minutes by design) |
| F (cold load) | `http://localhost:8082/?label=win-chrome&run=e1` | 1 min | load with no cache |
| G (optional) | `http://localhost:8081/?label=win-chrome&run=e5&cases=rf` | 2 min | cancel fallback without isolation |

Run the batches one after another, never two at once. Repeat the whole set with the next browser using a new label.

Notes:
- If a test says `FAILED`, leave it and carry on. A failure is a result.
- If you touched the machine or something heavy started during a batch, run that batch again once and mention it.
- Results save themselves to the `results` folder next to `server.mjs`. Do not rename that folder while the server runs.

## 6. GPU test (only with an NVIDIA GPU)

Check the card is visible:

```powershell
nvidia-smi
```

Then:

```powershell
.\.env\python.exe native\gpu_bench.py win-desktop
```

It trains XGBoost on 500k rows on the CPU, then with CUDA, and writes `results\gpu-win-desktop.json`. If the CUDA run reports an error, that is useful information. Leave it as it is and send it back. Without an NVIDIA GPU the script records that and skips the CUDA run.

## 7. Send the results back

1. Stop the server with Ctrl+C.
2. Zip the `results` folder.
3. Write a short text file with the machine notes:
   - CPU model, RAM, GPU model and driver version
   - Windows version
   - Chrome and Edge versions (open `chrome://version` and `edge://version`)
   - Power mode, plugged in or on battery
   - Anything else running, and whether antivirus scanning was on
4. Send the zip and notes to the maintainer, for example by placing them in `experiments/engine-spike/results-from-windows/` in the repository. They are compared with the Mac numbers in [docs/research/spike-results.md](../../docs/research/spike-results.md).

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| `crossOriginIsolated=false` on the page | Use `http://localhost:...` exactly, not an IP address or a network name, and use ports 8080, 8082 or 8083 (8081 is meant to be non-isolated). Try a private window without extensions. |
| `import.meta.dirname` or syntax error in Node | Node is older than 20.11. Update Node. |
| Port already in use | Another server is running. Close it, or find it with `netstat -ano \| findstr :8083`. |
| `fetch_pyodide.mjs` fails to download | Proxy or network block. Retry on another network. |
| `pip` cannot find a version | Note the package name and report it. Do not change versions. |
| Page is blank | Press F12 and read the Console tab. Send a screenshot or the text. |
| Results are not saved | The `results` folder was renamed or deleted while the server ran. Restart the server. |
| Very long or stuck batch | Wait for the timeouts in the table. If it is still stuck after twice the listed time, close the tab and note which batch it was. |

## Also useful on the Mac

The built-in browser here only covers Chromium. If you can, run the same batches on the Mac in Firefox and Safari using `label=mac-firefox` and `label=mac-safari`. Safari needs version 16.4 or newer for the isolation features the tests use. Firefox and Safari do not have the File System Access API, which the real app will need a fallback for.
