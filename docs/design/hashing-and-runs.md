# NOESIS: hashing and runs (draft 0.1)

Companion to [pipeline-schema.md](pipeline-schema.md). Two linked ideas:

- **Hashing** gives every node a fingerprint of everything that can change its output. It powers "outdated" detection, result caching and reproducibility.
- **Runs** are permanent records of executions: what ran, on what data, with what settings, and what came out.

Everything lives on the user's device (IndexedDB and Cache Storage). Nothing is uploaded.

---

## Part 1: Hashing

### Goals

1. Mark a node `outdated` when anything upstream of it changed (and only then).
2. Reuse stored results when nothing changed, including across branches and re-runs.
3. Detect "same pipeline, same data, same seed" so a run can be reproduced or skipped.
4. Detect when the user's CSV changed on disk.

### What goes into a node hash

```
nodeHash = SHA-256(canonical JSON of {
  type,
  definitionVersion,      // version of this node type's param definitions
  params,                 // effective values only (see below)
  fit_on,
  inputs,                 // ordered list of the input nodes' hashes
  seed,                   // only for nodes that use randomness
  engineEpoch             // bumped only when numeric results can change
})
```

| Included | Excluded |
|---|---|
| node `type` | node `id` (ids are labels, renaming must not invalidate) |
| effective param **values** | param `source` (`default` / `user` / `suggested`) |
| `fit_on` | UI data: labels, notes, canvas position |
| upstream hashes, in order | project name, topic, mode |
| seed, for random nodes | progress, status, timings |

This matches the open item in [param-definitions.md](param-definitions.md): `source` never counts toward the hash. Switching a value from `suggested` to `user` without changing it must not invalidate anything.

### Effective params

Before hashing, params are normalised so equal behaviour gives equal hashes:

1. Params whose `when` condition is false become `null`.
2. `null` params are dropped from the hashed object (not in use).
3. Unset hyperparameters with a registry default are replaced by that default, so "unset" and "explicitly set to the default" hash the same. If a future app update changes a default, `definitionVersion` changes and the hash changes with it.
4. `columns` lists are sorted (treated as sets), except params marked `ordered` in the registry (`ratios`, `hidden_layers`, `featureRange`, `ordinalOrder`).
5. Numbers are normalised (`-0` becomes `0`, `1.0` and `1` are the same, no `NaN`/`Infinity`).

### Canonical form

Keys sorted alphabetically at every level, no whitespace, UTF-8, arrays keep order. This is the stable string that gets hashed.

### Root node and the dataset

The `load_csv` node's hash includes:

- the **dataset fingerprint** (below),
- the parse params (delimiter, header, encoding, missing markers, `sampleRows`),
- the **dataset context**: task type, target column, and the role (`feature` / `exclude`) of every column.

Putting the context in the root means changing the target or excluding a column invalidates the whole chain through normal hash propagation, with no special case.

### Dataset fingerprint

| Step | Detail |
|---|---|
| Quick check | file name, size, last-modified time |
| Full fingerprint | content hash of all bytes, computed once at import with an incremental hash (BLAKE3 or SHA-256 compiled to WebAssembly, streamed so a large file never sits fully in memory) |
| Re-open | compare the quick check; if it differs, recompute the full fingerprint |

If the fingerprint changes, the dataset is a new **dataset version**: every node becomes `outdated`, and the old runs stay in history linked to the old fingerprint.

Browsers cannot reopen a path on disk by name. Where supported, the app stores a File System Access handle in IndexedDB and asks for permission again on return. Elsewhere the user re-selects the file and the app checks the fingerprint. If it does not match, the user is told the data changed.

### Pipeline hash

```
pipelineHash = SHA-256(canonical JSON of {
  sinkHashes: sorted hashes of nodes nothing else reads from,
  task: { type, primaryMetric },
  seed
})
```

Two pipelines with different node ids but identical behaviour have the same `pipelineHash`.

### Computing it

- Walk nodes in topological order and memoise. A change recomputes only that node and its descendants.
- Use WebCrypto SHA-256 (`crypto.subtle.digest`, async) for small inputs. Use the incremental hasher for dataset bytes.
- Show a short form (first 8 hex characters) in the UI. Compare and store the full value.

### Staleness

A node is `done` only if a stored result exists whose `hash` equals the node's current hash. Otherwise it is `outdated`. This is the status the engine already derives in [param-definitions.md](param-definitions.md).

### Result cache keyed by hash

Node outputs are stored under their hash, so identical work is never repeated, even after undo or in a different branch:

```
cache://nodes/<hash>/output        (cleaned / transformed data, columnar)
cache://models/<runId>/model       (trained model, pinned for kept runs)
```

If the user edits the last step of the pipeline, every earlier output is found by hash and reused. This is the same idea as build tools such as Bazel or Nx.

Output file format: Feather (Arrow IPC) with lz4 compression, chosen after the spike. It reloaded a 100k × 50 table in about 0.5 s and is about 27% smaller than uncompressed. Parquet works but was slower to write and read ([spike-results.md](../research/spike-results.md)).

### Eviction

- Intermediate node outputs can always be recomputed, so they are **evictable**, least-recently-used first, within a size budget.
- Outputs referenced by a run marked `kept`, and model files of kept runs, are **pinned**.
- Check usage with `navigator.storage.estimate()`, request `navigator.storage.persist()`, show a usage meter, and warn at 80% of quota.

### Determinism caveat

Same hash means "same inputs", not always "bit-identical outputs". Multi-threading and GPU math can cause tiny numeric differences. Each run records `deterministic`:

| Value | Meaning |
|---|---|
| `exact` | CPU, single seed, no GPU, **same engine** (same runtime and library build). Expected bit-identical. The spike showed that the browser and native engines give identical profiling, logistic regression and KNN results but slightly different tree and clustering results, so a run moved between the browser engine and the companion is `approx` ([spike-results.md](../research/spike-results.md)). |
| `approx` | GPU or threaded training. Expected equal within a small tolerance. |

---

## Part 2: Runs

### What a run is

One execution of the pipeline up to a target node (usually `validate` or `test`, or a `model` node for a quick fit). A run record is **append-only**: results never change after the run ends. Only `label`, `notes`, `tags` and `kept` can be edited.

### Run record

```json
{
  "runId": "run_01JB9X...",
  "projectId": "proj_...",
  "createdAt": "2026-11-04T10:21:07Z",
  "status": "succeeded",
  "targetNode": "n7",

  "pipelineSnapshot": { "nodes": [ ... ] },
  "pipelineHash": "9f2c...",
  "nodeHashes": { "n1": "a1b2...", "n2": "c3d4...", "n6": "e5f6..." },

  "dataset": { "fingerprint": "7be1...", "rows": 12430, "name": "houses.csv" },
  "seed": 42,

  "engine": {
    "appVersion": "0.1.0",
    "engineEpoch": 1,
    "backend": "browser",
    "libraries": { "pyodide": "x.y", "scikit-learn": "x.y" },
    "device": "cpu",
    "deterministic": "exact"
  },

  "timing": { "startedAt": "...", "finishedAt": "...", "perNodeMs": { "n6": 8420 } },

  "metrics": {
    "train":      { "rmse": 0.31, "r2": 0.94 },
    "validation": { "rmse": 0.44, "r2": 0.88, "folds": [0.41, 0.46, 0.43, 0.45, 0.45] },
    "test":       null
  },
  "curves": { "loss": "idb://events/run_01JB9X/n6" },
  "artifacts": {
    "model": "cache://models/run_01JB9X/model",
    "featureImportance": "idb://artifacts/run_01JB9X/importance",
    "predictionsSample": "idb://artifacts/run_01JB9X/preds"
  },

  "testAccess": [],
  "parentRunId": null,
  "label": "RF baseline",
  "notes": "",
  "tags": [],
  "kept": false
}
```

| Field group | Why it exists |
|---|---|
| `pipelineSnapshot` + hashes | The exact graph that ran, so the run is reproducible and comparable even after the user keeps editing the live pipeline. It is small JSON. |
| `dataset.fingerprint`, `seed`, `engine` | Everything needed to reproduce or explain a difference. |
| `metrics` per partition | `test` is `null` until the test set is used. |
| `curves`, `artifacts` | References (`idb://`, `cache://`), never inline blobs. |
| `testAccess` | Log of every test-set use: `{ at, runId, reason }`. Backs the "test once per model" rule and its logged "unlock" action. |
| `parentRunId` | Set when a run is a re-run or a tuning child of another. |

### Status

`queued` → `running` → `succeeded` | `failed` | `cancelled` | `interrupted`

A running run writes a heartbeat every few seconds. If the tab closes mid-run, the next open finds a `running` record with an old heartbeat and marks it `interrupted`. v1 does not resume: the user re-runs (finished node outputs are reused from the cache, so little is lost).

### Skipping duplicate runs

Before running, look up an existing succeeded run with the same `pipelineHash`, `targetNode`, dataset fingerprint, seed and `engineEpoch`. If one exists, offer "Use existing result" instead of recomputing. The user can force a fresh run.

### Test-set access

- Each model (by `nodeHashes` of its `model` node) may be tested once per project version.
- Running `test` writes an entry to `testAccess`.
- A second test of the same model needs an explicit "unlock test set" action with a reason, recorded in the log.
- **Leaderboards and rankings use validation metrics only.** Test metrics appear on a run after the final test, and are never used to sort the comparison screen.

### Comparing runs

Because each run keeps its own snapshot, comparison is mechanical:

- **Pipeline diff:** compare `nodeHashes` to find which nodes differ, then show the changed params.
- **Metric table and overlaid curves.**
- **Restore:** "load this run's pipeline" copies its snapshot back as the live pipeline.

### Retention

- Default: keep the last 50 runs per project plus all runs marked `kept`.
- Prune order when over budget: intermediate node outputs, then run artifacts of unkept old runs, then `events` and `predictionsSample`. Metrics and the pipeline snapshot are tiny and are pruned last.
- The user can delete any run. Deleting a run unpins only artifacts that no other run references.

---

## Storage layout

**IndexedDB**, database `noesis`:

| Store | Key | Holds | Indexes |
|---|---|---|---|
| `projects` | `projectId` | current project JSON | |
| `projectVersions` | `projectId + version` | snapshots of `nodes` for undo/history, with a reason ("applied suggestion C04") | `createdAt` |
| `datasets` | `datasetId` | metadata, fingerprint, profile, file handle | `projectId` |
| `runs` | `runId` | run record | `projectId + createdAt`, `pipelineHash`, `status`, `kept` |
| `events` | `runId` | downsampled training events | |
| `artifacts` | `runId + name` | small artifacts (importances, prediction samples) | |

**Cache Storage**, cache `noesis-v1`: large blobs only (`nodes/<hash>/...`, `models/<runId>/...`).

Schema migrations: IndexedDB version plus a migration function per `schemaVersion`. Old run records keep their original `schemaVersion` and are read through a compatibility layer.

Multiple tabs: use the Web Locks API for writes to a project, and `BroadcastChannel` to tell other tabs to refresh.

---

## Export and reproducibility

- A run can be exported as a bundle: pipeline JSON, dataset fingerprint, seed, engine versions and a generated script. It contains no data and no model unless the user asks to include the model.
- A **reproduce check** re-runs a run's snapshot on the same dataset fingerprint and compares metrics. `exact` runs must match exactly. `approx` runs must match within a tolerance (default 1e-6 relative).
- Importing a run on a machine that lacks the CSV shows "dataset not found, expected fingerprint 7be1...".

## Open items

- Cached output format: resolved (Feather with lz4, `pyarrow` works in Pyodide). Remaining: check the same format round-trips between the browser engine and the companion.
- Hash function for the dataset: BLAKE3 or SHA-256 in WebAssembly, and the speed on a 1 GB file.
- Tolerance values for the reproduce check.
- Whether to store full downsampled event logs or only curves.
- Per-node hashing of the profile (links to the rule engine's per-node profile question).
- Which node types are marked as using randomness, for the seed rule (`split` with shuffle, stochastic `model` algorithms, `tune`, shuffled `validate`).
