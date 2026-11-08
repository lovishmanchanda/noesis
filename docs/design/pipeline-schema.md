# NOESIS: pipeline schema (draft 0.1)

Status: planning. This is the central format. The wizard, the engine, the rule engine, code export, undo/history and saved projects all read or write it.

## Decisions

| # | Decision |
|---|---|
| 1 | The pipeline is a graph of nodes (`id`, `type`, `params`, `inputs`). The wizard generates a linear chain, the canvas (later) edits the same graph. |
| 2 | Leakage is a hard error. A transform that learns from data (`impute`, `handle_outliers`, `encode`, `scale`, `select_features`) must declare `fit_on: "train"` and must sit downstream of a `split` node. The engine refuses to build or run the graph otherwise. |
| 3 | Large artifacts (datasets, cleaned data, trained models) live in browser storage: IndexedDB for structured data and metadata, Cache Storage API for large blobs. The JSON only holds references (`idb://...`, `cache://...`). |
| 4 | Every parameter records who set it. `value: null` means "not in use": the engine ignores the parameter and the UI shows it as off. |

## Design rules

- Config, data profile and results are separate. The pipeline stores only what the user chose.
- Deterministic: a project-level `seed` is inherited by every node that uses randomness.
- Each node has a content hash that includes the hashes of its upstream nodes. If a node's params change, every downstream hash changes, so the UI marks downstream results "outdated" and the engine re-runs only what changed.
- `schemaVersion` is required so old saved projects can be migrated.
- The dataset itself is never stored in the JSON, only a reference and column metadata.

## Parameter format

Every entry in `params` is an object:

```json
{ "value": "median", "source": "user" }
```

| Field | Meaning |
|---|---|
| `value` | The setting. `null` = not in use. |
| `source` | `"default"` (nothing chosen), `"user"` (chosen by the user), `"suggested"` (applied from a rule-engine suggestion). |

Default parameters are created with `source: "default"`. Editing in the UI flips it to `"user"`. A "reset to default" action restores the default value and source. Code export can use `source` to emit only the parameters the user actually chose.

## Top-level structure

```json
{
  "schemaVersion": "0.1",
  "project": { "name": "House prices", "topic": "real estate", "seed": 42, "mode": "guided" },
  "dataset": {
    "source": { "kind": "local-file", "name": "houses.csv", "ref": "idb://datasets/ds_01" },
    "rows": 12430,
    "columns": [
      { "name": "id",    "dtype": "int",      "role": "exclude" },
      { "name": "area",  "dtype": "float",    "role": "feature" },
      { "name": "city",  "dtype": "category", "role": "feature" },
      { "name": "price", "dtype": "float",    "role": "target" }
    ]
  },
  "task": { "type": "regression", "primaryMetric": "rmse" },
  "nodes": [
    { "id": "n1", "type": "load_csv",
      "params": { "delimiter": { "value": ",", "source": "default" },
                  "header": { "value": true, "source": "default" } } },

    { "id": "n2", "type": "split", "inputs": ["n1"],
      "params": { "ratios": { "value": [0.7, 0.15, 0.15], "source": "default" },
                  "stratify": { "value": null, "source": "default" } } },

    { "id": "n3", "type": "impute", "inputs": ["n2"], "fit_on": "train",
      "params": { "columns": { "value": ["area"], "source": "user" },
                  "strategy": { "value": "median", "source": "suggested" } } }
  ]
}
```

Note the order: `split` comes before `impute`. Putting `impute` upstream of `split` would be rejected by the engine as leakage (decision 2). Here `stratify` is `null`, so it is not in use.

## Sections

| Section | Holds | Notes |
|---|---|---|
| `project` | name, topic, seed, mode (`guided` / `expert`) | Applies to the whole project |
| `dataset` | source reference, row count, column types and roles | Roles: `feature`, `target`, `exclude`, and `reference` (clustering only, see [clustering-variant.md](clustering-variant.md)) |
| `task` | task type and primary metric | Decides which models and metrics are offered |
| `nodes` | the graph | The pipeline itself |
| `runs` (stored separately, in IndexedDB) | scores, timings, model artifact ref, pipeline hash at run time | Many runs per pipeline |

## Node types, version 1 (CSV only)

| Group | Types |
|---|---|
| Data | `load_csv`, `drop_columns`, `drop_duplicates`, `filter_rows` |
| Cleaning | `impute`, `handle_outliers` |
| Features | `encode`, `scale`, `derive_feature`, `select_features` |
| Splitting | `split` |
| Modelling | `model`, `tune` |
| Evaluation | `validate`, `test` |
| Output | `export_model` |

Each type has a parameter definition (name, type, default, allowed range, plain-language description) kept in the code, not in the project file. The same definition drives the wizard form, Expert-mode fields, validation and learn-mode tooltips.

## Validation rules the engine enforces

Hard errors (graph will not run):

1. Graph must be acyclic and every `inputs` id must exist.
2. Exactly one `load_csv` source, exactly one `split` before any `model`.
3. Any node with `fit_on: "train"` must be downstream of `split`. A node that needs fitting but omits `fit_on` is an error.
4. `test` may appear once and only after `validate`. Nothing may feed from `test` back into the graph (no tuning on the test set).
5. A node's `params` must match its type's definition (types, ranges, allowed values).
6. The target column must exist and must not also be a feature.
7. Every feature reaching a `model` node must be numeric. A category or string column that is not encoded (or derived into numbers) upstream of the model is an error. Tree models are not exempt, because the in-browser engines need numeric input.

Warnings (graph runs, user is told):

- Very small dataset, heavy class imbalance, near-constant columns, ID-like columns (rule engine).

## Storage references

| Prefix | Backend | Used for |
|---|---|---|
| `idb://` | IndexedDB | Project JSON, column profiles, run results, small datasets |
| `cache://` | Cache Storage API | Large blobs: cleaned datasets, split files, trained model files |

The JSON stores only these references. Deleting a project removes its referenced entries.

## Training events (live node-graph feed)

The engine posts small events from a Web Worker while a `model` node runs. Each algorithm declares which events it can emit, and the UI chooses the matching visualisation.

```json
{ "type": "epoch_end", "node": "n6", "epoch": 3, "loss": 0.42, "valScore": 0.81 }
{ "type": "tree_split", "node": "n6", "treeId": 12, "feature": "area", "threshold": 85.5, "samples": 340 }
{ "type": "centroid_move", "node": "n6", "iter": 4, "centroids": [[1.2, 3.4], [5.1, 0.9]] }
```

## How other parts use the schema

- Rule engine: reads `dataset.columns` plus the data profile, returns suggestions that add or edit nodes (applied params get `source: "suggested"`).
- Code export: walks nodes in topological order and emits one snippet per node type.
- Undo/history: each version of `nodes` is a snapshot.
- Wizard: each screen edits one or two nodes.
- Canvas (later): edits the same array and adds branching.

## Open items

- Parameter definitions per node type: drafted in [param-definitions.md](param-definitions.md). Model hyperparameters are flattened into `params` there (one entry each, so each keeps its own `source`).
- Profile format for `dataset` (stats per column, used by the rule engine).
- Hashing scheme and the `runs` store: drafted in [hashing-and-runs.md](hashing-and-runs.md).
- Event catalogue per algorithm: drafted in [training-events.md](training-events.md).
