# NOESIS: tech stack (decision record, draft 0.1)

Status per row: **tested** (checked in the engine spike), **chosen** (decided here, not yet tried), **open**.

## Stack

| Layer | Choice | Status | Notes |
|---|---|---|---|
| In-browser Python | Pyodide 314.0.7 (Python 3.14.2), pinned | tested | Self-hosted, never from a public CDN (cross-origin isolation) |
| Data and ML libraries | pandas 3.0.2, scikit-learn 1.8.0, XGBoost 2.1.4, numpy 2.4.6, scipy 1.18.0, pyarrow 22.0.0 | tested | Native environments must use the same versions |
| Execution | one Web Worker, job queue, cancel flag plus interrupt | tested | `SharedArrayBuffer` needs COOP and COEP headers |
| Local storage | IndexedDB (metadata, runs) and Cache Storage (data, models) | tested | Quota was about 1.5 GB in the test browser; eviction rules in [hashing-and-runs.md](../design/hashing-and-runs.md) |
| Cached tables | Feather with lz4 | tested | |
| Pipeline file | JSON, checked by JSON Schema | chosen | [pipeline.schema.json](../../packages/schema/pipeline.schema.json) |
| Front end | TypeScript 6.0, React, Vite | chosen | TypeScript is pinned to 6.0 because the lint tooling does not support 7 yet |
| State | Zustand | chosen | The pipeline is plain data, so a small store is enough |
| Charts | Observable Plot or D3 for most; canvas for dense scatter plots | open | Needs a quick test: 1,000-point scatter and a 64-unit network at smooth frame rate while the engine runs |
| Node-graph editor (canvas mode, later) | React Flow | chosen | Not in v1 |
| Styling | CSS variables for colour, spacing and type tokens | chosen | Light, dark and system modes |
| Schema validation in the browser | Ajv | chosen | Same schema file as the docs |
| Dataset hashing | WebAssembly BLAKE3, node hashes with WebCrypto SHA-256 | chosen | Speed on a 1 GB file still to measure |
| Offline and caching | service worker (PWA) | chosen | Caches the engine files |
| Companion | Python package (`pip install`), WebSocket server, same node package | chosen | Library for the server is open (a small async WebSocket library; avoid a heavy web framework) |
| GPU | XGBoost with CUDA (NVIDIA), PyTorch with MPS on Apple Silicon, WebGPU for the later deep-learning engine | chosen | CUDA not tested yet |
| Later: images and text | ONNX Runtime Web, transformers.js or TensorFlow.js | open | Decide when the time comes |
| Tests (front end) | Vitest, Playwright, axe for accessibility | chosen | |
| Tests (Python nodes) | pytest | chosen | Same fixtures run in Pyodide and natively |
| Hosting | static host that can set response headers (Cloudflare Pages, Netlify or Vercel) | open | Must support COOP and COEP and large static files |
| Package managers | pnpm 12 (JavaScript), conda environment (Python) | tested | pnpm is installed inside the repository (`.local/tools`) and its store is `.pnpm-store`, both git-ignored, so nothing is installed system-wide |

## Repository layout

```
noesis/
  README.md  LICENSE  CONTRIBUTING.md  SECURITY.md
  .github/             CI workflow, pull request and issue templates
  apps/
    web/               React application
  packages/
    registry/          node types, parameters, defaults, rules metadata (data files)
    schema/            pipeline JSON Schema and generated TypeScript types
    rules/             rule engine and rule definitions
    engine-client/     the Engine interface in TypeScript (browser worker and companion implement it)
    nodes-py/          plain pandas / scikit-learn node functions (shared by browser and companion)
    companion/         the optional local server
  fixtures/            small seeded datasets, golden pipelines, golden event logs
  experiments/
    engine-spike/      the experiment that tested the engine choice (kept for reference)
  brand/               logo mark and colour notes
  docs/                design, architecture, research, planning
  scripts/             repository tooling
```

## Single source of truth

One **registry** (data files) defines node types, parameters, ranges, defaults, `when` conditions, help text and algorithm event modes. From it we generate or drive:

- the wizard forms and Expert-mode fields,
- the JSON Schema and TypeScript types,
- engine-side validation,
- learn-mode tooltips,
- the parameter tables in the docs.

This stops the docs, the UI and the engine from drifting apart, which is the most likely long-term problem with a design this size.

## Quality gates

- **Contract tests:** run the same golden pipelines in the browser engine and natively. Expect identical results for profiling, linear and KNN, and close results for tree and clustering models (as measured in the spike).
- **Leakage tests:** the validator must reject every ordering that learns from test rows.
- **Rule tests:** fixtures for every rule (fires, does not fire, boundary), plus an idempotence test: applying a suggestion must not make it fire again.
- **Event tests:** golden event logs per algorithm; ordering and bounds checks.
- **Accessibility:** axe checks in CI, plus a manual keyboard pass.
- **Performance budget:** warm start to interactive about 7 s on a calm laptop; no main-thread stall over 50 ms during training.

## Versions and licences

- Pin every runtime version and record it in each run (already part of the run record).
- Before release, review licences of Pyodide, scikit-learn, pandas, XGBoost, React, D3 and any chart or graph library, and the terms of the sample datasets. The libraries named here are open source with permissive or weak-copyleft terms; check each when the final list is fixed.

## Open decisions

1. Chart library, after the scatter and network test.
2. Hosting provider.
3. Server library for the companion.
4. Product name, repository licence (open source or not), and first target users.
