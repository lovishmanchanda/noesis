# NOESIS: parameter definitions (draft 0.1)

Companion to [pipeline-schema.md](pipeline-schema.md). The pipeline file stores parameter *values*. This file defines the parameters themselves: what exists, the type, the default, the allowed range, and when it applies. In code these live in a registry (one definition object per node type), not in the project file.

One registry drives: wizard forms, Expert-mode fields, engine validation, learn-mode tooltips, rule-engine targets, and code export.

## Definition format

Each parameter is defined by:

| Field | Meaning |
|---|---|
| `name` | Key in `params` |
| `type` | `int`, `float`, `bool`, `string`, `enum`, `column`, `columns`, `list<float>`, `list<int>`, `list<string>`, `map` |
| `default` | Value used when the user has not chosen. `null` = not in use (decision 4). |
| `required` | If true and the value is `null`, the node is **incomplete** (shown in the UI, blocks run). |
| `min` / `max` | Numeric bounds (inclusive) |
| `options` | Allowed values for `enum` |
| `columnFilter` | For `column(s)`: restrict to dtypes, e.g. `["int","float"]`, or roles |
| `when` | Condition on sibling params. If false, the parameter is hidden and ignored, e.g. `strategy == "constant"` |
| `level` | `basic` (shown in Guided mode) or `advanced` (Expert mode, or Guided "Advanced" drawer) |
| `label` / `help` | Plain-language name and one-sentence explanation for the UI |
| `tuneRange` | (model hyperparameters only) default search space for the `tune` node |

Rules:
- A parameter whose `when` is false is treated as `null` regardless of its stored value.
- A parameter with `required: false` can be switched off in the UI, which sets its value to `null`.
- Column parameters are validated against `dataset.columns` (existence, dtype, role).

## Flattened hyperparameters

Model hyperparameters are stored as individual entries in `params`, not inside one `hyperparams` object, so each carries its own `source`:

```json
{ "id": "n6", "type": "model", "inputs": ["n5"],
  "params": {
    "algorithm":    { "value": "random_forest", "source": "user" },
    "n_estimators": { "value": 200, "source": "user" },
    "max_depth":    { "value": null, "source": "default" }
  } }
```

Which hyperparameters are valid is determined by `algorithm`.

---

## Data nodes

### `load_csv`
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `delimiter` | enum | `","` | `,` `;` `\t` `\|` | basic |
| `header` | bool | `true` | | basic |
| `encoding` | enum | `"utf-8"` | `utf-8`, `latin-1`, `utf-16` | advanced |
| `missingMarkers` | list<string> | `["", "NA", "N/A", "NaN", "null"]` | | advanced |
| `dateColumns` | columns | `null` | | advanced |
| `sampleRows` | int | `null` (use all) | min 100 | advanced |

### `drop_columns`
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `columns` | columns | `null` | required | basic |

### `drop_duplicates`
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `subset` | columns | `null` (all columns) | | advanced |
| `keep` | enum | `"first"` | `first`, `last`, `none` | advanced |

### `filter_rows`
One condition per node. Chain nodes for several conditions.
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `column` | column | `null` | required | basic |
| `operator` | enum | `null` | required; `==` `!=` `>` `>=` `<` `<=` `in` `not_in` `is_null` `not_null` | basic |
| `value` | string / float / list | `null` | `when operator not in (is_null, not_null)` | basic |

---

## Cleaning nodes

### `impute` (`fit_on: train`)
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `columns` | columns | `null` | required | basic |
| `strategy` | enum | `"median"` | `mean`, `median`, `most_frequent`, `constant`, `knn`. `mean`/`median`/`knn` numeric only. | basic |
| `fillValue` | string / float | `null` | required `when strategy == "constant"` | basic |
| `knnNeighbors` | int | `5` | 1 to 50, `when strategy == "knn"` | advanced |
| `addMissingIndicator` | bool | `false` | adds a `<col>_was_missing` column | advanced |

### `handle_outliers` (`fit_on: train`)
Thresholds are learned from the training data, so this needs `fit_on`.
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `columns` | columns | `null` | required, numeric only | basic |
| `method` | enum | `"iqr"` | `iqr`, `zscore`, `percentile` | basic |
| `threshold` | float | `1.5` | 0.5 to 10, `when method in (iqr, zscore)`. Use 3.0 as the usual zscore value. | basic |
| `lowerPercentile` | float | `1` | 0 to 49, `when method == "percentile"` | advanced |
| `upperPercentile` | float | `99` | 51 to 100, `when method == "percentile"` | advanced |
| `action` | enum | `"clip"` | `clip`, `remove`, `flag` | basic |

`remove` on validation/test data would silently change the evaluation set, so with `action: "remove"` rows are only dropped from the train partition.

---

## Feature nodes

### `encode` (`fit_on: train`)
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `columns` | columns | `null` | required, category/string only | basic |
| `method` | enum | `"onehot"` | `onehot`, `ordinal`, `frequency`, `binary` | basic |
| `handleUnknown` | enum | `"ignore"` | `ignore`, `error` | advanced |
| `dropFirst` | bool | `false` | `when method == "onehot"` (set true for linear models) | advanced |
| `maxCategories` | int | `50` | 2 to 1000. Rarer values grouped as `other`. `null` = no limit | advanced |
| `ordinalOrder` | map<column, list<string>> | `null` | `when method == "ordinal"`. `null` = alphabetical | advanced |

Target encoding is deliberately left out of v1: it needs nested cross-validation to avoid leakage inside the train set.

### `scale` (`fit_on: train`)
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `columns` | columns | `null` (all numeric features) | numeric only | basic |
| `method` | enum | `"standard"` | `standard`, `minmax`, `robust`, `maxabs` | basic |
| `featureRange` | list<float> | `[0, 1]` | length 2, `when method == "minmax"` | advanced |

### `derive_feature`
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `newName` | string | `null` | required, unique | basic |
| `kind` | enum | `null` | required; `date_part`, `ratio`, `difference`, `product`, `log`, `bin`, `polynomial` | basic |
| `sourceColumns` | columns | `null` | required. 1 column for `date_part`, `log`, `bin`, `polynomial`; 2 for `ratio`, `difference`, `product` | basic |
| `datePart` | enum | `null` | `year`, `month`, `day`, `weekday`, `hour`; required `when kind == "date_part"` | basic |
| `bins` | int | `5` | 2 to 100, `when kind == "bin"` | advanced |
| `degree` | int | `2` | 2 to 5, `when kind == "polynomial"` | advanced |

Row-wise calculations only (no statistics across rows), so no `fit_on`. Bin edges use fixed-width ranges from the train partition, so if quantile bins are added later this node needs `fit_on`.

### `select_features` (`fit_on: train`)
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `method` | enum | `"variance"` | `variance`, `correlation`, `kbest`, `importance` | basic |
| `varianceThreshold` | float | `0.0` | min 0, `when method == "variance"` | advanced |
| `correlationThreshold` | float | `0.95` | 0.5 to 1, `when method == "correlation"` | advanced |
| `k` | int | `10` | min 1, `when method == "kbest"` | basic |
| `importanceThreshold` | float | `null` | `when method == "importance"` | advanced |

---

## Split

### `split`
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `ratios` | list<float> | `[0.7, 0.15, 0.15]` | train / validation / test. Sum to 1 (tolerance 1e-6). Train and test each > 0. Validation may be 0 only if `validate.method` is a cross-validation method. For clustering, `strategy: none` fixes ratios to `[1, 0, 0]` and skips the train and test checks ([clustering-variant.md](clustering-variant.md)). | basic |
| `strategy` | enum | `"random"` | `random`, `stratified`, `group`, `time` | basic |
| `stratifyColumn` | column | `null` (target) | `when strategy == "stratified"` | advanced |
| `groupColumn` | column | `null` | required `when strategy == "group"` | basic |
| `timeColumn` | column | `null` | required `when strategy == "time"`. Splits in order, never shuffles. | basic |
| `shuffle` | bool | `true` | forced `false` `when strategy == "time"` | advanced |

The rule engine proposes `stratified` for imbalanced classification, `group` when a column looks like a repeated entity ID, and `time` when there is a datetime column.

---

## Modelling

### `model`
`algorithm` options depend on `task.type`.

| Task | Algorithms |
|---|---|
| regression | `linear_regression`, `ridge`, `lasso`, `decision_tree`, `random_forest`, `gradient_boosting`, `knn`, `svm`, `mlp` |
| classification | `logistic_regression`, `decision_tree`, `random_forest`, `gradient_boosting`, `knn`, `svm`, `naive_bayes`, `mlp` |
| clustering | `kmeans`, `dbscan`, `hierarchical` |

| Common param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `algorithm` | enum | `null` | required | basic |
| `preset` | enum | `"balanced"` | `fast`, `balanced`, `accurate`. A shortcut that fills hyperparameters (stored with `source: "suggested"`). | basic |

Hyperparameters (each stored as its own entry, `default` shown is the value used when `null`/unset):

**linear_regression**: `fit_intercept` bool `true`.

**ridge**: `alpha` float `1.0` (0.0001 to 1000, tune log-scale).

**lasso**: `alpha` float `1.0` (0.0001 to 1000, tune log-scale), `max_iter` int `1000` (100 to 100000).

**logistic_regression**: `C` float `1.0` (0.001 to 1000, tune log-scale), `penalty` enum `l2` (`l1`, `l2`, `none`), `max_iter` int `100` (50 to 10000), `class_weight` enum `null` (`balanced`).

**decision_tree**: `max_depth` int `null` (1 to 50, tune 2 to 20), `min_samples_split` int `2` (2 to 100), `min_samples_leaf` int `1` (1 to 100), `criterion` enum `gini` / `squared_error` by task.

**random_forest**: `n_estimators` int `100` (10 to 1000, tune 50 to 500), `max_depth` int `null` (tune 3 to 30), `min_samples_leaf` int `1` (1 to 50), `max_features` enum `sqrt` (`sqrt`, `log2`, `all`), `bootstrap` bool `true`, `class_weight` enum `null` (`balanced`; classification only).

**gradient_boosting**: `n_estimators` int `100` (10 to 2000), `learning_rate` float `0.1` (0.001 to 1, tune log-scale), `max_depth` int `3` (1 to 15), `subsample` float `1.0` (0.3 to 1), `early_stopping_rounds` int `null` (uses the validation partition; 5 to 200).

**knn**: `n_neighbors` int `5` (1 to 100, tune 3 to 30), `weights` enum `uniform` (`uniform`, `distance`), `metric` enum `euclidean` (`euclidean`, `manhattan`, `minkowski`).

**svm**: `C` float `1.0` (0.01 to 1000, tune log-scale), `kernel` enum `rbf` (`linear`, `rbf`, `poly`), `gamma` enum / float `scale` (`scale`, `auto`, or a float), `degree` int `3` (2 to 6, `when kernel == "poly"`).

**naive_bayes**: `var_smoothing` float `1e-9` (1e-12 to 1e-3, tune log-scale).

**mlp** (neural network): `hidden_layers` list<int> `[64, 32]` (1 to 6 layers, 1 to 1024 units each), `activation` enum `relu` (`relu`, `tanh`, `logistic`), `optimizer` enum `adam` (`adam`, `sgd`), `learning_rate` float `0.001` (1e-5 to 0.5, tune log-scale), `batch_size` int `32` (8 to 1024), `epochs` int `100` (1 to 2000), `l2` float `0.0001` (0 to 1), `early_stopping` bool `true`, `patience` int `10` (1 to 100, `when early_stopping`).

**kmeans**: `n_clusters` int `null` (required, 2 to 50), `init` enum `k-means++` (`k-means++`, `random`), `max_iter` int `300`, `n_init` int `10`.

**dbscan**: `eps` float `0.5` (0.01 to 100), `min_samples` int `5` (1 to 100).

**hierarchical**: `n_clusters` int `null` (required), `linkage` enum `ward` (`ward`, `complete`, `average`, `single`).

### `tune`
Wraps the preceding `model` node.
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `method` | enum | `"random"` | `grid`, `random`, `bayesian` | basic |
| `searchSpace` | map<hyperparam, range or list> | `null` (use the algorithm's `tuneRange`) | | advanced |
| `nTrials` | int | `30` | 5 to 500, ignored for `grid` | basic |
| `scoring` | enum | `null` (task's `primaryMetric`) | any metric valid for the task | advanced |
| `timeLimitSeconds` | int | `null` | min 10 | advanced |

Tuning uses the validation scheme set in the `validate` node. It never sees the test partition.

---

## Evaluation

### `validate`
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `method` | enum | `"holdout"` | `holdout`, `kfold`, `stratified_kfold`, `repeated_kfold`, `time_series_split` | basic |
| `k` | int | `5` | 2 to 20, for the k-fold methods and `time_series_split` | basic |
| `repeats` | int | `3` | 2 to 20, `when method == "repeated_kfold"` | advanced |
| `metrics` | list<string> | `null` (task defaults, below) | | advanced |
| `shuffle` | bool | `true` | forced `false` `when method == "time_series_split"` | advanced |

`holdout` scores on the validation partition from `split`. The k-fold methods run inside the train partition. The rule engine proposes `stratified_kfold` for classification and `time_series_split` when `split.strategy` is `time`.

### `test`
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `metrics` | list<string> | `null` (task defaults, below) | | advanced |

Can run once per model per project version. Re-running requires an explicit "unlock test set" action that is logged in run history.

### Metrics by task

| Task | Options | Default `primaryMetric` | Default metric set |
|---|---|---|---|
| regression | `rmse`, `mae`, `r2`, `mape` | `rmse` | `rmse`, `mae`, `r2` |
| classification | `accuracy`, `f1`, `precision`, `recall`, `roc_auc`, `pr_auc`, `log_loss` | `f1` for imbalanced, else `accuracy` | `accuracy`, `f1`, `roc_auc` |
| clustering | `silhouette`, `davies_bouldin`, `inertia` | `silhouette` | `silhouette`, `davies_bouldin` |

---

## Output

### `export_model`
| Param | Type | Default | Constraints | Level |
|---|---|---|---|---|
| `name` | string | `null` (project name) | | basic |
| `format` | enum | `"bundle"` | `bundle` (JSON config + model file), `onnx`, `python_script` | basic |
| `includePreprocessing` | bool | `true` | keeps scalers and encoders with the model | basic |
| `includeMetrics` | bool | `true` | adds the model card (data used, scores, limits) | advanced |

---

## Node status

Derived by the engine, not stored in the project file:

| Status | Meaning |
|---|---|
| `incomplete` | A required param is `null` |
| `invalid` | A param breaks a constraint, or the graph breaks a hard rule |
| `ready` | Valid, not run yet |
| `outdated` | Valid, but an upstream hash changed since the last run |
| `done` | Valid and the stored result matches the current hash |

## Clustering additions

Additional node types (`reduce_dimensions`, `stability_check`), new values (`split.strategy = none`, `tune.method = sweep`, `validate.method = stability`), a new metric (`calinski_harabasz`) and a new column role (`reference`) for the clustering task are defined in [clustering-variant.md](clustering-variant.md).

## Open items

- Confirm the algorithm list for v1. SVM was not benchmarked in the spike and is likely slow in the browser. The in-browser MLP is about 7× slower than native, so cap rows × epochs there (see [spike-results.md](../research/spike-results.md) and rule M09 in [rule-engine.md](rule-engine.md)).
- Decide whether `preset` is stored as a param or only applied once.
- Decide how `searchSpace` is edited in the UI.
- Hashing scheme: which fields (type, params values, `inputs`, `fit_on`, seed) count toward a node hash. `source` should not.
- `gradient_boosting` backend: resolved, use XGBoost. Pyodide's docs list it as a built-in package, and its callbacks allow live events. See [engine-choice.md](../architecture/engine-choice.md).
