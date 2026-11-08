# NOESIS: local companion (draft 0.1)

Companion to [engine-choice.md](../architecture/engine-choice.md) and [spike-results.md](../research/spike-results.md). The companion is an optional program the user installs. The website then sends heavy work to it, and it runs the same Python node code natively: all CPU cores, optional GPU, and files larger than a browser tab can hold.

## Why it exists (from the spike)

| Browser engine limit | Companion answer |
|---|---|
| Single-threaded (Python sees 1 CPU) | all cores: random forest about 5× faster than the browser on the same Mac (4.5 s against 23.7 s on one thread) |
| Dense math is slow (MLP about 7× slower than native) | native BLAS, later PyTorch |
| No CUDA from WebAssembly | XGBoost GPU, PyTorch CUDA on NVIDIA; MPS on Apple Silicon |
| Memory cap of a tab, 7 s warm start | no tab limit, no warm start for the page |
| Results differ slightly from native (tree and clustering models) | one native engine for everything |

It is not required. Everything works without it, and the app says plainly when it would help.

## Principles

1. **Local only.** It listens on `127.0.0.1`, never on the network. No cloud, no telemetry, no accounts.
2. **Same code.** It runs the same node package as the browser engine (plain pandas and scikit-learn functions), so exported scripts and results match what the user saw.
3. **The page stays in charge.** The page sends a pipeline and receives events. The companion holds no project state beyond jobs and cached outputs.
4. **Safe by default.** Only the real app origin can use it, and only after the user pairs it. Any other website must be unable to use it, because it can read files and run code.
5. **Visible.** The header shows connected / not connected, the device in use, and a button to disconnect.

## Install and run

| Step | Detail |
|---|---|
| Install | `pip install noesis-companion` (or `pipx`, or a conda package). A single-file download for people without Python is a later option. |
| Start | `noesis-companion` in a terminal. v1 is a foreground program, not a hidden background service. A start-at-login option comes later. |
| First run | Prints a pairing code and the local address. Creates a config file in the user's app-data folder. |
| Update | The page shows "companion update available" when versions differ (see Versioning). Updating is the same pip command. |
| Uninstall | `pip uninstall`, delete the config and cache folders. Nothing else is touched. |

## Connection and pairing

```
page (https://app) ──WebSocket──► ws://127.0.0.1:<port>   (companion)
```

1. The companion picks a default port (and the next free one if taken) and writes it to its config. The page tries the default first, then a short list.
2. The page opens a WebSocket and sends `hello` with the app version and its origin.
3. **Origin check:** the companion accepts a connection only if the `Origin` header is on its allow-list (the real app origin, plus `http://localhost` origins when run in development mode). Everything else is closed immediately.
4. **Pairing:** the first time, the companion shows a short code in the terminal. The user types it into the page. The page receives a long random token, stores it (IndexedDB), and sends it on every later connection. The user can revoke by deleting the token from the config or running `noesis-companion --reset-pairing`.
5. **Handshake reply:** `capabilities` (see below) plus the protocol version.

Browser behaviour to verify in the spike, because it differs by browser and changes often:

- An HTTPS page connecting to `ws://127.0.0.1` is generally allowed in Chromium and Firefox (loopback counts as trustworthy), but Safari has been stricter about this kind of mixed content.
- Recent Chrome versions may ask the user for a "local network access" permission when a public website talks to a local address, and may require specific preflight response headers.
- Browsers may block or prompt differently when the page is not served over HTTPS.

If a browser blocks the connection, the page shows exactly which browser behaviour is in the way and what to do (for example "allow local network access for this site").

## Threat model

| Threat | Mitigation |
|---|---|
| Another website tries to use the companion | Origin allow-list plus pairing token. A page that is not the app has neither. |
| A malicious page guesses the port and sends requests | Same: every connection needs a valid token, and requests without one are dropped. No plain HTTP endpoints that act without the token. |
| DNS rebinding | The companion checks the `Host` header is `127.0.0.1` or `localhost` and the `Origin` is allowed. |
| Another local user or process on the machine | Token stored in a file readable only by the current user. The port accepts the connection but nothing without the token. This does not defend against malware running as the same user, which is outside scope. |
| Reading arbitrary files | The companion reads only files the user picked (see Files). No "read any path" request. |
| Running arbitrary code | The protocol accepts only a pipeline (the node types in the schema), never source code. Node implementations come from the installed package. |
| Data leaves the machine | The companion makes no outbound connections of its own. No update checks without the user asking. |
| Stolen token | Revoke by reset. Tokens are bound to one origin. |

A short security review before release is required (open item).

## Files

Browsers cannot hand a file's full path to a website, and the companion should not receive paths from web pages anyway. Two options:

| Option | How | Use |
|---|---|---|
| Native file picker in the companion | The page asks, the companion opens an OS file dialog (or reads the path from its terminal), returns a **file id**. The page only ever sees ids and metadata. | Default for big files |
| Upload through the socket | The page streams the bytes to the companion, which writes them to its own cache folder. | Fallback, and for files that already live in the browser (sample datasets) |

Both give the same result: a dataset id with a fingerprint (the same hash described in [hashing-and-runs.md](hashing-and-runs.md)), name, size and parsed column info. The companion keeps a mapping from id to path; if the file moves or changes, the fingerprint check catches it and the page asks the user to pick it again.

## Protocol

Same shape as the browser engine's `Engine` interface, carried over the WebSocket.

| Direction | Message | Purpose |
|---|---|---|
| page → companion | `hello`, `auth` | origin, app version, token |
| companion → page | `capabilities` | protocol version, node-package version, `engineEpoch`, node types, algorithms with live/replay modes, devices (`cpu`, `cuda`, `mps`), core count, free memory, limits |
| page → companion | `pickFile`, `uploadStart` / binary chunks / `uploadEnd` | add data |
| companion → page | `dataset` | id, fingerprint, columns, profile |
| page → companion | `profile`, `run`, `cancel`, `setVizLevel`, `watchTrial` | same meaning as in [training-events.md](training-events.md) |
| companion → page | events | exactly the envelope in [training-events.md](training-events.md); large arrays as binary frames |
| page → companion | `predict`, `export` | use a trained model |
| companion → page | `artifact` | results, models, cached node outputs (by hash id, with a `fetch` message to download) |
| both | `ping` / `pong` | liveness, replaces the heartbeat for this engine |

Messages are JSON text frames, plus binary frames for arrays and files. Every message has an id, so replies match requests.

## Jobs

- **One training job at a time per companion** in v1. Others wait in a queue, shown in the UI. Profiling and prediction can run alongside it with a small reserve of resources.
- **Cancel:** the runner sets a cancel flag that node loops check every epoch, round or tree, and sends an interrupt signal as a backup. This is the same rule as in the browser engine (the spike showed library code can swallow an interrupt).
- **Resource limits:** the companion reports available memory and refuses a run it can predict will not fit, with the same plain-language error codes (`E_OOM`).
- **Disconnects:** if the page disconnects, a running job continues for a grace period (default 2 minutes), then stops. On reconnect the page asks for the job's status and the missed must-keep events, which the companion keeps for each job.
- **Crashes:** the process logs to a local file, and restarts cleanly. Jobs that were running are marked `interrupted` (see [hashing-and-runs.md](hashing-and-runs.md)).

## Cache and storage

- Node outputs are stored under their node hash in the companion's own cache folder (Arrow Feather with lz4, the format the spike favoured), mirroring the browser's cache design.
- A size budget with least-recently-used eviction, and a setting for the folder location. The page can ask for a clear-cache.
- Trained models for kept runs are pinned. Cached data never leaves the machine.

## Devices and GPU

- At start it detects CPU cores, memory, NVIDIA GPUs (`nvidia-smi` and the library's own check) and Apple MPS, and reports them in `capabilities`.
- The policy in [engine-choice.md](../architecture/engine-choice.md) applies: Auto picks the fastest device that supports the algorithm, with Always CPU and Prefer GPU overrides, and falls back to CPU with a message if a GPU run fails.
- Runs record `engine.kind: "companion"`, the device, and library versions. A run from the companion is `approx` when compared with a browser run, `exact` against another companion run on the same machine.

## Versioning

Three numbers, all in `capabilities`:

| Number | Meaning |
|---|---|
| `protocolVersion` | message format. The page and companion must agree on the major version, or the page asks the user to update one of them. |
| node-package version | which node implementations are installed. Shown in run records. |
| `engineEpoch` | bumped only when numeric results can change (see [hashing-and-runs.md](hashing-and-runs.md)); part of node hashes |

## Build and test

- Package layout: the node package (shared with the browser build), a thin server, and the CLI.
- Tests: the same fixture suites as the node package; a protocol conformance test that runs the same pipeline against the browser engine and the companion and compares results (expect `approx` for tree and clustering models, exact for profiling, linear and KNN, as measured in the spike).
- A fake-page test client that exercises origin checks, pairing, bad tokens, cancel, disconnect and reconnect.

## Open items

- Browser behaviour on local connections (Safari mixed content, Chrome local network prompt): check in the spike on Windows, Mac Chrome, Firefox and Safari.
- Packaging: pip first, then a single-file installer for people without Python.
- Whether the file picker lives in the companion (native dialog) or only via upload for v1.
- Whether to support more than one concurrent job.
- Security review before release.
- Start-at-login and menu-bar or tray status.
- Whether the companion should offer a plain HTTP fallback if WebSockets are blocked by some setups.
