# NOESIS: training events (draft 0.1)

Companion to [pipeline-schema.md](pipeline-schema.md), [param-definitions.md](param-definitions.md) and [hashing-and-runs.md](hashing-and-runs.md).

While a pipeline runs, the engine streams small typed **events**. The UI turns them into the live node graph, progress, metric curves and logs. The rule engine and the run history also read them. This file defines the envelope, the common events, the per-algorithm events, pacing, and control messages.

## Principles

1. **One event stream, many consumers.** Progress bar, node graph, curves, logs, the rule engine and run replay all read the same events.
2. **Honest visuals.** Each event says whether it came from the real training process (`live`) or was rebuilt afterwards from the fitted model (`replay`). The UI labels replays. Many scikit-learn algorithms do not expose per-step callbacks, so some animations are replays.
3. **The engine never waits for the UI.** The engine emits at its own pace and the UI buffers. Pacing (slow motion, step-by-step) is a UI feature.
4. **Volume is bounded.** Events are classed as must-keep or droppable, high-volume payloads are sampled and capped, and the user can lower the visualisation level.
5. **Forward compatible.** Events carry a version, and the UI ignores event types it does not know.
6. **Same stream for both engines.** The in-browser worker and the optional local companion use the same envelope.

## Transport

| Engine | Channel |
|---|---|
| Browser (Web Worker) | `postMessage`, large arrays as transferable `ArrayBuffer`s |
| Local companion | WebSocket on `localhost`, large arrays as binary frames |

## Envelope

```json
{
  "v": 1,
  "runId": "run_01JB9X",
  "seq": 1042,
  "t": 8412,
  "node": "n6",
  "trial": null,
  "type": "epoch_end",
  "source": "live",
  "data": { "epoch": 3, "totalEpochs": 100, "trainLoss": 0.42, "valLoss": 0.47 }
}
```

| Field | Meaning |
|---|---|
| `v` | Event schema version |
| `runId` | Which run |
| `seq` | Per-run counter, increases by 1. A gap means a dropped droppable event. |
| `t` | Milliseconds since the run started |
| `node` | Pipeline node that emitted it (`null` for run-level events) |
| `trial` | Tuning trial number, or `null` |
| `type` | Event name |
| `source` | `live` (emitted during real training) or `replay` (rebuilt after the fit) |
| `data` | Payload, defined per type |

## Event classes

| Class | Examples | Rule |
|---|---|---|
| **must-keep** | all lifecycle events, `epoch_end`, `boost_round`, `tree_finished`, `fold_finished`, `trial_finished`, `artifact_ready`, errors | Never dropped. Stored in the run's event log. |
| **droppable** | `batch_end`, `weights_snapshot`, `activation_sample`, `sample_rows`, `heartbeat` | May be coalesced or dropped under load. Decimated in the stored log. |

## Common events

### Lifecycle

| Type | Data |
|---|---|
| `run_started` | `targetNode`, `nodes` (ids in execution order), `vizLevel` |
| `node_started` | `type`, `algorithm?`, `totalSteps?` |
| `node_progress` | `phase` (`fit`, `transform`, `predict`), `step`, `totalSteps` |
| `node_finished` | `durationMs`, `cacheHit`, `eventsFrom?` (runId whose stored events can be replayed when the node came from cache) |
| `node_failed` | `error`: `{ code, message, hint }` |
| `run_finished` | `status` (`succeeded`, `failed`, `cancelled`) |
| `artifact_ready` | `name`, `ref` (`idb://` or `cache://`), for results such as confusion matrix and feature importances (large results are artifacts, not events) |
| `heartbeat` | `memoryMB?`, every 2 s. Backs the `interrupted` detection in the run record. |
| `log` | `level` (`info`, `warn`), `message` |

When a node's result comes from the cache, `node_finished` fires immediately with `cacheHit: true`. The UI lights the node up at once, and can replay the original training from `eventsFrom`.

### Generic series

`metric`: `{ name, value, partition, step }`. Any scalar curve that has no dedicated event.

### Data flow ("real data moving through the nodes")

| Type | Data | Notes |
|---|---|---|
| `sample_rows` | `stage` (`input`/`output`), `columns` (up to 12), `rows` (up to 10) | Droppable, at most 2 per second per node. Shows real rows entering and leaving a node, so the user sees what a step does to their data. |
| `projection_ready` | `method: "pca"`, `points` (up to 1000 sampled: `x`, `y`, `label`), `explainedVariance` | Sent once at run start. All 2D visuals (clusters, neighbours, decision boundaries) share these coordinates so they stay consistent. |

All data stays on the device, so sending real values to the UI is not a privacy issue.

## Per-algorithm events

Each algorithm declares in the registry how it is visualised:

```ts
{ algorithm: "random_forest", events: { mode: "replay+live", emits: [...] }, vizType: "ensemble" }
```

| `vizType` | Algorithms |
|---|---|
| `network` | `mlp` |
| `tree` | `decision_tree` |
| `ensemble` | `random_forest`, `gradient_boosting` |
| `fit-line` | `linear_regression`, `ridge`, `lasso`, `logistic_regression`, `svm` |
| `neighbors` | `knn` |
| `clusters` | `kmeans`, `dbscan`, `hierarchical` |
| `stats` | `naive_bayes` |

### Neural network (`mlp`), live

| Type | Data | Class |
|---|---|---|
| `model_structure` | `layers: [{units, activation}]`, `inputUnits`, `outputUnits`, `paramCount` | must-keep, once |
| `epoch_end` | `epoch`, `totalEpochs`, `trainLoss`, `valLoss`, `trainMetric?`, `valMetric?`, `lr`, `durationMs` | must-keep |
| `batch_end` | `epoch`, `batch`, `totalBatches`, `loss` | droppable |
| `weights_snapshot` | per layer: `meanAbs`, `std`, `min`, `max`, and a downsampled weight matrix (capped at 32×32 per layer, `Float32` transferable) | droppable, at most once per epoch or 4 per second |
| `activation_sample` | per layer: mean activation per unit on one fixed sample batch | droppable |
| `early_stop` | `epoch`, `bestEpoch`, `reason` | must-keep |
| `training_diverged` | `epoch`, `loss` (NaN or rising) | must-keep |

Visual: layers of nodes, edge thickness and colour from the downsampled weights, node brightness from activations, loss curve alongside. For layers wider than the display cap, units are grouped and the group size is shown.

### Decision tree

Trees fit in milliseconds, and scikit-learn exposes no growth callback. The tree is **replayed** after the fit by walking the fitted structure in node-creation order, so `source` is `replay`.

| Type | Data | Class |
|---|---|---|
| `tree_started` | `treeId`, `totalTrees?` | must-keep |
| `tree_node_added` | `treeId`, `nodeId`, `parentId`, `side` (`left`/`right`), `feature`, `threshold`, `samples`, `impurity`, `value` (class counts or mean), `isLeaf`, `depth` | must-keep up to the display cap |
| `tree_finished` | `treeId`, `nodes`, `depth`, `leaves`, `trainScore?` | must-keep |

Display cap: nodes down to depth 6 are sent individually. Deeper levels become one `tree_summary` event (`treeId`, `depth`, `nodes`, `leaves`) so a 20-level tree does not flood the UI.

### Random forest and gradient boosting

| Type | Data | Class |
|---|---|---|
| `ensemble_progress` | `done`, `total`, `trainMetric`, `valMetric` | must-keep |
| `boost_round` | `round`, `trainLoss`, `valLoss`, `learningRate` | must-keep (boosting) |
| `tree_*` events | as for the decision tree | detail for the first 5 trees only (configurable), the rest as `ensemble_progress` |
| `feature_importance` | `importances: [{feature, value}]` (top 30) | must-keep, at the end |

Live where possible: grow the forest with increasing `n_estimators` (warm start) to get per-tree progress, or use the library's evaluation callbacks for boosting. Otherwise replay from staged predictions.

### Linear models, logistic regression, SVM

Closed-form fits (linear regression, ridge) finish at once. The UI animates from the initial line to the final one, labelled as a replay. Iterative solvers (lasso, logistic, SVM) report real iterations.

| Type | Data | Class |
|---|---|---|
| `fit_progress` | `iter`, `totalIter`, `loss`, `converged?` | must-keep |
| `coef_update` | `coefficients: [{feature, value}]` (top 50 by absolute value), `intercept` | droppable during fitting, must-keep at the end |
| `fit_line` | `featureX`, `featureY?`, `slope`, `intercept` or `gridProbabilities` (downsampled 40×40) | droppable |
| `support_vectors` | `count`, `sampleIndices` | must-keep (SVM) |

Visual: the sampled real points (from `projection_ready`, or two chosen features) with the line or boundary moving toward its final position, plus a coefficient bar chart.

### KNN

KNN does not train, so the events come from predicting a handful of validation rows.

| Type | Data | Class |
|---|---|---|
| `knn_query` | `queryIndex`, `queryPoint` (2D), `neighbors: [{index, distance, label}]`, `predicted`, `truth?` | must-keep, up to 20 sampled queries per validate |

### Clustering

| Type | Data | Class |
|---|---|---|
| `cluster_init` | `k`, `centroids` (2D) | must-keep |
| `cluster_iter` | `iter`, `centroids` (2D), `inertia`, `shift`, `assignments` (`Uint16` array for the sampled points) | must-keep |
| `cluster_converged` | `iter`, `inertia` | must-keep |
| `cluster_assign` | `assignments`, `noiseCount?` | DBSCAN: final result only, replay |
| `dendrogram_merge` | `step`, `left`, `right`, `distance` | hierarchical: replay of merges |

K-means in scikit-learn gives no per-iteration callback. The engine runs it one iteration at a time (`max_iter=1`, one init, seeded from the previous centres) so the iterations are real. This must be checked to produce the same result as a single normal fit.

### Naive Bayes

Instant. A single `class_stats` event (`class`, `prior`, top per-feature mean and variance) feeds a small summary view.

## Tuning and validation events

| Type | Data | Class |
|---|---|---|
| `tune_started` | `method`, `nTrials`, `space` | must-keep |
| `trial_started` | `trial`, `params` | must-keep |
| `trial_finished` | `trial`, `params`, `score`, `durationMs`, `isBest` | must-keep |
| `tune_finished` | `bestParams`, `bestScore` | must-keep |
| `fold_started` | `fold`, `totalFolds` | must-keep |
| `fold_finished` | `fold`, `scores` | must-keep |
| `validation_result` | `metrics` | must-keep |

During tuning, the inner training events carry `trial`. To limit volume the engine suppresses algorithm-specific events (weights, tree nodes) inside trials and sends only per-epoch or per-round metrics. The user can click "watch this trial" to re-run one trial with full events. The tuning screen shows trial scores as a scatter or parallel-coordinates plot.

## Pacing and playback (UI side)

Training can finish in milliseconds, which is too fast to watch. The UI keeps an **event store** (a buffer with a playback position) and plays it back.

| Mode | Behaviour |
|---|---|
| Live | Render events as they arrive |
| Slow | Minimum 40 to 80 ms between animation events, the rest queue up. Metrics still update at once. |
| Step | Advance one event or one epoch per click |
| Replay | Play a finished run from its stored log |

The stored log is the run's event log in IndexedDB: all must-keep events, droppable events decimated to about one per epoch or per second, capped at roughly 5 MB per run (decimate harder past the cap). A node that came from the cache replays from `eventsFrom`.

## Volume control

Visualisation level, set before or during a run:

| Level | Sends |
|---|---|
| `off` | lifecycle, metrics, errors only |
| `light` | plus coarse structure (epoch metrics, tree summary, cluster steps) |
| `full` | everything above |

Default is `full` up to 50,000 rows and `light` above, or on a slow device. The user can change it mid-run with `setVizLevel`.

Coalescing: droppable events of the same type and node are merged to the latest while the UI is busy, and the engine caps them at 30 messages per second per stream.

## Control messages (UI to engine)

| Message | Effect |
|---|---|
| `start` | `{ pipeline, options: { vizLevel, eventBudget } }` |
| `cancel` | Stop the run |
| `pause` / `resume` | Pause at the next batch or iteration boundary (v1: optional) |
| `setVizLevel` | Change the level mid-run |
| `watchTrial` | Re-run one tuning trial with full events |

**Cancellation:** the engine checks for a cancel request at every batch, epoch or iteration boundary. A single blocking `fit` call cannot be interrupted that way. In Pyodide, an interrupt needs `SharedArrayBuffer`, which requires the site to be served with cross-origin isolation headers (COOP and COEP). The fallback is to terminate the worker (losing its state and reloading the runtime). Spike result ([spike-results.md](../research/spike-results.md)): the interrupt stopped pandas reads, random forest fits and XGBoost training within 0.06 to 1.4 s, but scikit-learn's MLP training catches the interrupt and carries on. So the engine's own cancel-flag check at each epoch, round or tree is required, not optional.

## Errors

`node_failed` and `run_finished` carry an error with a code, a message and a plain-language hint.

| Code | Meaning | Hint example |
|---|---|---|
| `E_INVALID_PARAM` | A value broke a constraint | "max_depth must be between 1 and 50" |
| `E_DATA_TYPE` | A column has the wrong type for this step | "Column 'city' is text, encode it first" |
| `E_NAN_LOSS` | Loss became NaN | "Try a lower learning rate" |
| `E_OOM` | Ran out of memory | "Use a sample, or reduce columns" |
| `E_CANCELLED` | User cancelled | |
| `E_ENGINE` | Unexpected engine error | "Details are in the log" |

An out-of-memory crash can kill the worker with no event at all. The missing heartbeats are detected and the run is marked `interrupted` (see [hashing-and-runs.md](hashing-and-runs.md)).

## Who reads the events

| Consumer | Uses |
|---|---|
| Node-graph UI | lifecycle, algorithm events, `sample_rows`, `projection_ready` |
| Metric curves | `epoch_end`, `boost_round`, `metric`, `fold_finished`, `trial_finished` |
| Rule engine | the stored curves and fold scores for R01 to R08 (see [rule-engine.md](rule-engine.md)): `epoch_end` for overfitting, divergence and early stopping, `fold_finished` for score variance, `trial_finished` for edge-of-range |
| Run history | the downsampled event log, for replay |

## Testing

- **Golden logs:** recorded event logs per algorithm on small fixture datasets, checked for ordering, field presence and bounds.
- **Schema checks:** validate every event against its type definition in development builds.
- **Ordering:** `seq` increases by 1, `node_started` comes before its events, `node_finished` after.
- **Load test:** a million batch events must not freeze the UI. Coalescing and the cap must hold.
- **Cancel test:** cancel at every phase and check the run ends in `cancelled`, not a hang.
- **Replay equivalence:** a replayed tree must match the fitted tree exactly (same splits, same counts).

## Built in Phase 3

| Algorithm | What the engine sends | Live or replay |
|---|---|---|
| Neural network | `model_structure`, `epoch_end` per epoch (both losses and a score), `weights_snapshot` (at most 16 by 16 per layer, at most 4 a second), `early_stop`, `training_diverged` | live |
| Random forest | `model_structure`, `ensemble_progress` about 20 times during growth (the forest grows in chunks of trees, which gives the same forest as growing it at once), `tree_started`, `tree_node_added` and `tree_finished` for the first three trees (top 6 levels, at most 200 nodes), `feature_importance` | progress live, trees replay |
| XGBoost | `model_structure`, `boost_round` per round (training and validation loss), `feature_importance`; Stop takes effect at the next round | live |
| Logistic regression | `fit_progress` (real iteration count and whether it settled), `coef_update` | live |
| Linear and ridge regression | `coef_update` | replay (solved in one step) |

Every other algorithm trains with the lifecycle events only. Decisions made while building it: the screen draws curves, bars, the network and the tree as plain SVG, with no chart library. Events are thinned in the worker (a droppable event replaces an unsent one of the same kind) and the page keeps at most 50,000 events per run (droppable ones are dropped beyond that). The stored log keeps every result event and thins weight pictures to about 8, capped at 1 MB per run. The visualisation level is chosen before the run and cannot change during it. Pause and resume were not built.

The golden logs the tests read are in `fixtures/events/`, recorded by `fixtures/events/generate.py`.

## Open items

- Which algorithms are `live` and which are `replay`: drafted in [engine-choice.md](../architecture/engine-choice.md). Confirmed in the spike for the neural net, forest, XGBoost, K-means. Not yet tested: logistic regression, SVM, KNN, single trees, DBSCAN, hierarchical.
- The K-means one-iteration trick: verified in the spike (identical inertia and iteration count to a normal fit). The warm-started forest and the XGBoost callback were also verified; see [spike-results.md](../research/spike-results.md).
- Cross-origin isolation (COOP and COEP): confirmed working for interrupting Pyodide in the spike. Still open: what it means for hosting and for embedding third-party scripts.
- Binary encoding for the downsampled weight and assignment arrays.
- How `projection_ready` handles mixed-type or very high-dimensional data (PCA after encoding and scaling, on the sample).
- Event budget per run and the exact decimation scheme for the stored log.
- Pause and resume: worth supporting in v1?
