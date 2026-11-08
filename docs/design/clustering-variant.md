# NOESIS: clustering variant (draft 0.1)

Companion to [wizard-screens.md](wizard-screens.md), [param-definitions.md](param-definitions.md), [rule-engine.md](rule-engine.md) and [training-events.md](training-events.md). This file lists what changes when the task is **group similar rows** (clustering) instead of predicting a target. Anything not mentioned here stays the same.

## Why it differs

Supervised tasks have a target, a score on unseen data, and a test set to protect. Clustering has none of these:

| Supervised | Clustering |
|---|---|
| A target column says what is right | No right answer exists, only structure that is more or less useful |
| Validation and test scores compare predictions with the target | Scores are internal (how tight and separated the groups are) |
| A locked test set gives an honest final number | Nothing to lock; the honest question is "are the groups stable?" |
| Success is a number to maximise | Success is "the groups make sense to the person who knows the data" |

So the variant leans on **understanding the clusters** (profiles, names, comparison with what the user already knows) more than on a leaderboard.

## Summary of changes

| Area | Change |
|---|---|
| Column roles | `target` is not allowed. New optional role `reference` (a column used only to compare clusters with, never to train). |
| Split | Optional. Default "use all rows". A holdout can be turned on to check that new rows land in the same groups. |
| Scaling | On by default, because distance-based methods are sensitive to ranges. |
| New nodes | `reduce_dimensions` (PCA), `stability_check` |
| Model | Choosing the number of groups (k) is a guided step. |
| Compare | k sweep and several internal metrics. No single "best". |
| Explain | Cluster profiles, projection, comparison with the reference column. |
| Final test | Replaced by a stability and sanity check. |
| Export | Adds a CSV with each row's cluster. |
| Rules | New K-rules. Target, test-set and overfitting rules do not apply. |

## Screens

Numbers match [wizard-screens.md](wizard-screens.md).

| # | Supervised | Clustering |
|---|---|---|
| 1 | Project | Same, with the task "group similar rows" |
| 2 | Data | Same |
| 3 | Target | **Columns**: choose which columns describe a row (features), mark IDs and names as excluded, and optionally pick a `reference` column (for example a known category) to compare against later |
| 4 | Tidy | Same. Duplicate rows matter more, because they pull clusters toward themselves. |
| 5 | Split | **Optional**. Default "Use all rows" (no holdout). The user can choose a holdout (for example 80/20) to check that new rows get the same groups. |
| 6 | Explore | Same, plus a **clustering tendency** card (does the data have groups at all) and a 2D PCA scatter. Target relationships are removed. |
| 7 | Missing and outliers | Same. Outliers are flagged more strongly, since K-means is sensitive to them. |
| 8 | Features | Scaling **on by default**. New optional step: reduce dimensions (PCA). Encoding stays, with a warning for category-heavy data. |
| 9 | Model | K-means, DBSCAN, hierarchical. A **"how many groups?"** helper replaces blind hyperparameter entry. |
| 10 | Train | Same live visualisation (centroids moving, DBSCAN as a replay, hierarchical merges as a replay). |
| 11 | Compare and tune | **k sweep** and metric comparison. Stability check available here too. |
| 12 | Explain | **Cluster profiles** (below). |
| 13 | Final test | **Stability and sanity check**. |
| 14 | Export | Model plus a **cluster assignment CSV** and a way to assign new rows. |

### 3. Columns

- Lists every column with its type, missing share and distinct count.
- One click per column: use / exclude. ID-like columns are excluded by default (rule C01).
- Optional **reference column**: a column the user already trusts (a known segment, a product type). It is held out of training. It appears later in Explain as "how do my clusters line up with this?".
- Continue when at least 2 usable feature columns remain.

### 5. Split (optional)

- Default: **Use all rows**. There is no test set to protect, so the whole table is used for fitting.
- Alternative: a holdout (default 80/20). Used only for the consistency check on the final screen.
- Because the pipeline's leakage rule needs a `split` node before any learned step, the builder inserts a `split` with `strategy: "none"` when the user keeps "use all rows". Learned steps then fit on all rows, which is correct here.

### 9. Model: how many groups

A helper above the algorithm list:

1. **Try several k at once** (a sweep, default 2 to 10) and plot the results.
2. Show the elbow curve (inertia) and the silhouette curve side by side, with the suggested k marked by the rule engine (K04), and a plain sentence on what each means.
3. For DBSCAN, show a distance plot to suggest `eps`, and let the user set `min_samples`.
4. The user can accept the suggestion or pick any k.

### 11. Compare

- A table of runs with several metrics side by side: silhouette, Davies-Bouldin, Calinski-Harabasz, inertia, cluster count, noise share (DBSCAN), smallest and largest cluster size.
- **No single winner is declared.** Internal metrics cannot compare fairly across different algorithms or scalings (DBSCAN removes noise points, for instance). The rule engine says so when the user compares across algorithms.
- Stability check can be started from here.

### 12. Explain: cluster profiles

- **Overview:** number of clusters, size of each, share of rows.
- **Profile per cluster:** for each feature, the cluster's mean compared with the overall mean as a standardised difference, with the top distinguishing features listed first in plain words ("higher income, much lower age").
- **Names:** the user can type a name for each cluster ("budget buyers"). Names are stored with the run. No AI is used; names come from the user.
- **Projection:** 2D scatter (PCA) coloured by cluster, using the shared `projection_ready` points.
- **Representative rows:** the rows closest to each centre, so the user can look at real examples.
- **Silhouette plot** per cluster, and a **dendrogram** for hierarchical clustering.
- **Reference comparison:** if a reference column was chosen, a contingency table and an adjusted Rand index.
- **Outliers:** rows far from every centre (or DBSCAN noise), listed.

### 13. Stability and sanity check

Replaces the final test. Nothing is locked, so there is no one-shot rule.

- **Stability:** re-run the clustering on random subsamples (default 10 runs on 80% of rows) and compare each result with the main one using the adjusted Rand index. Report the average and spread.
- **Consistency on holdout** (if a holdout was chosen): assign held-out rows to the nearest cluster and check how similar their cluster profiles are to the main groups.
- **Sanity checks:** warns about one cluster holding most rows, tiny clusters, or clusters that differ only in one feature.
- Can be repeated freely, since no hidden data is being protected.

### 14. Export

Adds **Download assignments**: the original CSV with one extra column holding each row's cluster number or name. The model bundle can also assign new rows (`predict`), unless the algorithm cannot (hierarchical and DBSCAN have no native way to place new rows; the app uses nearest-cluster assignment for these and says so).

## Pipeline differences

### Column roles

`dataset.columns[].role` gains `reference`. For `task.type == "clustering"`, `target` is not allowed.

### New and changed node types

**`reduce_dimensions`** (`fit_on: train`), placed after `scale`:

| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `method` | enum | `"pca"` | `pca` | basic |
| `n_components` | float or int | `0.95` | float 0 to 1 = share of variance to keep; int = number of components | basic |
| `whiten` | bool | `false` | | advanced |

**`stability_check`** (clustering only, replaces `test` on the last screens):

| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `runs` | int | `10` | 3 to 50 | basic |
| `sampleFraction` | float | `0.8` | 0.5 to 0.95 | advanced |
| `metric` | enum | `"adjusted_rand"` | `adjusted_rand`, `adjusted_mutual_info` | advanced |

**`split`**: `strategy` gains `none`. With `none`, `ratios` are fixed to `[1, 0, 0]` and the usual "train and test each greater than 0" check is skipped. With a holdout, ratios may be `[0.8, 0, 0.2]`.

**`validate`**: for clustering, `method` is `none`, `stability` or `holdout`; k-fold methods are not offered.

**`tune`**: `method` gains `sweep`, which runs one model per value of `n_clusters` (or `eps`) over a range:

| Param | Type | Default | Constraints |
|---|---|---|---|
| `sweepParam` | enum | `"n_clusters"` | `n_clusters`, `eps` |
| `sweepRange` | list<float> | `[2, 10]` | min, max |
| `scoring` | enum | `"silhouette"` | `silhouette`, `davies_bouldin`, `calinski_harabasz` |

**`test`**: not used. **`export_model`** gains `includeAssignments` (bool, default `true` for clustering).

**Metrics:** `calinski_harabasz` is added alongside `silhouette`, `davies_bouldin` and `inertia`. `primaryMetric` default stays `silhouette`.

### Example

```json
{
  "task": { "type": "clustering", "primaryMetric": "silhouette" },
  "nodes": [
    { "id": "n1", "type": "load_csv", "params": { } },
    { "id": "n2", "type": "split", "inputs": ["n1"],
      "params": { "strategy": { "value": "none", "source": "default" } } },
    { "id": "n3", "type": "impute", "inputs": ["n2"], "fit_on": "train",
      "params": { "columns": { "value": ["income"], "source": "user" },
                  "strategy": { "value": "median", "source": "suggested" } } },
    { "id": "n4", "type": "scale", "inputs": ["n3"], "fit_on": "train",
      "params": { "method": { "value": "standard", "source": "default" } } },
    { "id": "n5", "type": "reduce_dimensions", "inputs": ["n4"], "fit_on": "train",
      "params": { "n_components": { "value": 0.95, "source": "default" } } },
    { "id": "n6", "type": "model", "inputs": ["n5"],
      "params": { "algorithm": { "value": "kmeans", "source": "user" },
                  "n_clusters": { "value": 4, "source": "suggested" } } },
    { "id": "n7", "type": "stability_check", "inputs": ["n6"], "params": { } }
  ]
}
```

## Hard rules for clustering

1. No `target` role; a column marked `reference` cannot also be a feature.
2. Every learned step fits on the `split` node's train partition, which with `strategy: none` is all rows.
3. A `reference` column never enters any node as input to a model.
4. `stability_check` may run any number of times; there is no locked data.
5. A clustering model needs at least 2 numeric features after encoding.

## Rules (new, K-series)

Thresholds are starting guesses, to be tuned on real datasets like the supervised rules.

| ID | Condition | Suggestion |
|---|---|---|
| K01 | clustering tendency (Hopkins statistic) below 0.6 on a sample | Warn: this data may have no natural groups. Results below will look arbitrary. |
| K02 | no `scale` upstream | Warn: large-range columns will dominate (already M08). |
| K03 | more than 30 features after encoding | Tip: distances get less meaningful in many dimensions. Add `reduce_dimensions` or `select_features`. |
| K04 | a k sweep exists | Suggest k at the silhouette peak, noting the elbow position. If the two disagree, say so and show both. |
| K05 | one cluster holds more than 80% of rows | Warn: try more clusters, a different algorithm, or remove outliers. |
| K06 | DBSCAN noise share above 30% | Warn: `eps` is probably too small. Suggest the value from the distance plot. |
| K07 | DBSCAN puts everything in one cluster | Warn: `eps` is probably too large. |
| K08 | more than half of the features are categories | Warn: distance on one-hot columns is crude. Consider using only numeric columns, or fewer categories. |
| K09 | silhouette below 0.25 | Info: the groups overlap a lot. Structure is weak, treat the clusters as rough. |
| K10 | stability (average adjusted Rand index) below 0.6 | Warn: the groups change a lot between samples. Try fewer clusters, more rows, or scaling and outlier handling. |
| K11 | engine is the browser, algorithm is k-means or hierarchical, and rows above 100k | Tip: hierarchical clustering is quadratic in memory and will not fit. For k-means use the companion for very large data. |
| K12 | comparing runs of different algorithms by one metric | Info: internal metrics are not comparable across algorithms (noise points, different scaling). Judge by the cluster profiles. |

Existing rules that apply unchanged: D01 to D05, C01 to C11, C13 and M08.

Rules that do **not** apply to clustering: all T-rules (no target), C12 (target leakage), S01 to S05, M01 to M07 as written for supervised models (M08 covers scaling), and R-rules R01 to R04, R08 to R11. R05 to R07 (training divergence) are not relevant to K-means.

## Events

The events already defined in [training-events.md](training-events.md) cover clustering: `projection_ready`, `cluster_init`, `cluster_iter`, `cluster_converged`, `cluster_assign`, `dendrogram_merge`. Added:

| Type | Data | Class |
|---|---|---|
| `cluster_summary` | `sizes`, `centroids` (in feature space, top features), `inertia?`, `noiseCount?` | must-keep, at the end of a model node |
| `sweep_progress` | `param`, `value`, `score`, `done`, `total` | must-keep. The sweep reuses `trial_started` / `trial_finished` with `trial` set to the swept value, so the existing tuning view works. |
| `stability_run` | `run`, `totalRuns`, `ari` | must-keep |

## Performance in the browser

From the spike ([spike-results.md](../research/spike-results.md)): K-means on 80k rows × 67 features took 1.9 s in the browser (0.4 s native), and the stepwise K-means used for live events gave identical results to a normal fit. A sweep of 9 values of k therefore takes roughly 20 s in the browser at that size. Hierarchical clustering is quadratic in rows, so cap it (rule K11). DBSCAN needs a neighbour search and slows down with rows and features. These cases are good candidates for the companion.

## Open items

- Mixed-type data: a proper method (such as k-prototypes) is not in scikit-learn. v1 warns instead (K08).
- Gaussian mixtures: soft assignments and uncertainty, a natural next algorithm.
- Mini-batch K-means for very large data in the browser.
- Anomaly detection (isolation forest and similar) as a related task type that reuses most of this variant.
- Better 2D projections (UMAP and t-SNE are slow or unavailable in the browser); v1 uses PCA only.
- Clustering time series and text are separate problems for later.
- Threshold values for K01 and K09 to K10 need tuning on real data.
- Whether `reference` should also allow several columns.
