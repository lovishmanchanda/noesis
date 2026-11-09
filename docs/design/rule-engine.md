# NOESIS: rule engine (draft 0.1)

Companion to [pipeline-schema.md](pipeline-schema.md) and [param-definitions.md](param-definitions.md).

The rule engine produces the "next best step" suggestions. It contains no AI: it is a set of explicit, readable rules that look at the data profile, the pipeline graph and the run results, and return suggestions the user can apply or dismiss.

## Principles

1. **Every suggestion explains itself.** It shows the evidence in numbers ("38% of `age` is missing"), not just an instruction.
2. **Never act silently.** The engine only proposes. A suggestion changes the pipeline only when the user clicks Apply.
3. **Rules are pure functions.** Same inputs, same outputs, no side effects, no network. This makes them testable and reproducible.
4. **Hard errors and suggestions are different.** Hard errors (leakage, missing split, unencoded text reaching a model) are enforced by the pipeline validator and cannot be dismissed. Rules only advise.
5. **Quiet by default.** Show a few relevant suggestions per screen, not every possible one.
6. **Thresholds are data, not code.** All numbers (for example "30% missing") live in one config file so they can be tuned without touching rule logic.

## Inputs (the context every rule receives)

```
ctx = { profile, pipeline, task, runs, settings }
```

### Data profile

Computed once per dataset version, in a Web Worker, on a sample if the file is large.

| Level | Stats |
|---|---|
| Dataset | rows, columns, duplicate-row count, estimated memory, delimiter-check result |
| Column | inferred dtype, null count and %, unique count and %, top values and their share, min, max, mean, median, std, skew, quantiles, IQR outlier count and %, parse-as-number % (for string columns), date range (datetime) |
| Relationships | pairwise correlation for numeric columns (sampled), each numeric feature's correlation with the target |
| Target | class counts and balance (classification), skew and range (regression) |

Profile of data *as it arrives at a node* (after earlier cleaning) is computed lazily and cached by the node's hash, so a rule on the encode screen sees the cleaned data, not the raw upload. v1 can start with the raw profile only for rules that fire before the Split screen (duplicates, ID-like and constant columns, target nulls, file size), because those state facts about the file and learn nothing from it. **Rules that fire after the split must read a profile of the train partition only** (missing share, skew, outliers, correlations, class balance used for later steps). Otherwise a suggestion such as "fill with the median" would be chosen from numbers that include the test rows, which is the leakage the pipeline rules are meant to prevent. So the train-partition profile is required in v1, not optional, and the raw profile is a separate cheaper one used only by the early stages.

### Other inputs
- `pipeline`: the node graph and node statuses.
- `task`: type and primary metric.
- `runs`: stored results, including per-epoch loss curves, per-fold scores and per-class metrics.
- `settings`: mode (`guided` / `expert`), disabled rule groups.

## Rule format

```ts
{
  id: "C04_high_missing",
  stage: "clean",                 // which wizard screen shows it
  severity: "warn",               // info | tip | warn | alert
  appliesTo: ["regression", "classification", "clustering"],
  priority: 70,                   // higher = shown first
  evaluate(ctx) {                 // returns [] or one suggestion per target
    ...
  }
}
```

### Suggestion (rule output)

```json
{
  "ruleId": "C04_high_missing",
  "target": { "kind": "column", "name": "age" },
  "severity": "warn",
  "message": "38% of 'age' is missing.",
  "why": "Models cannot use empty cells. Filling with the median keeps all rows and is robust to outliers.",
  "evidence": { "nullPct": 0.38, "skew": 1.4 },
  "actions": [
    {
      "label": "Fill with median",
      "patch": [
        { "op": "addNode", "after": "n2", "node": { "type": "impute",
            "params": { "columns": ["age"], "strategy": "median" } } }
      ]
    },
    { "label": "Drop this column",
      "patch": [ { "op": "addNode", "after": "n2", "node": { "type": "drop_columns",
            "params": { "columns": ["age"] } } } ] }
  ],
  "fingerprint": "C04_high_missing|age|nullPct:0.35-0.40"
}
```

### Patch operations

A small closed set, so every suggestion is previewable and undoable:

| Op | Effect |
|---|---|
| `addNode` | Insert a node after a given node (inputs rewired) |
| `setParam` | Change one param on a node |
| `removeNode` | Remove a node (inputs rewired) |
| `setColumnRole` | Change a column's role (`feature`, `target`, `exclude`) |
| `setMetric` | Change the primary metric (used by T04, which asks for F1 on a rare class) |

A new step goes where its kind belongs, not necessarily right after the node named: steps that learn from data always land after the split, in a fixed order (fill, outliers, new features, encode, scale, select). A step added for more columns joins an existing step of the same kind and settings instead of creating a second one.

Params set by a patch are stored with `source: "suggested"`. The user sees a before/after preview before confirming, and one Undo reverts the whole patch.

## Lifecycle

```
trigger → evaluate rules → merge/dedupe → filter by dismissed → rank → show
```

**Triggers:** profile finished, any node edited, run finished, mode changed.

**Suggestion states:**

| State | Meaning |
|---|---|
| `open` | Shown to the user |
| `applied` | User applied it. The rule will not fire again because its condition no longer holds. |
| `dismissed` | User dismissed it. Stays hidden until its **fingerprint** changes. |
| `stale` | The pipeline changed so it no longer applies. Removed automatically. |

The fingerprint is `ruleId + target + bucketed evidence`. A dismissed suggestion comes back only if the evidence moves materially (for example missing 5% → 40%), not on every small change.

**Conflicts:** if two suggestions patch the same param, the higher priority wins and the other is shown as "alternative".

**No loops:** after a patch is applied, the rule's own condition must be false for the new pipeline. A rule that would re-fire after its own fix is a bug and is caught in testing.

**Noise limit:** at most 3 open suggestions per screen are expanded. Others sit in a "More" list. Guided mode shows all severities, Expert mode shows `warn` and above and collapses `tip`/`info`.

## Next best step

The wizard stages, in canonical order: goal, data, target, health, explore, features, split, model, train, compare, explain, test, export.

Algorithm:
1. Compute each stage's state from node statuses: `todo`, `incomplete`, `done`, `outdated`.
2. The **next step** is the first required stage that is not `done`.
3. A **recommended** badge is added to optional stages that have an open suggestion with severity `warn` or higher.
4. A **blocked** badge is shown on stages that cannot run (for example Train before Split). The reason is stated in one line.

The side panel shows this checklist. The top banner shows the single next step plus the highest-priority open suggestion for the current screen.

## Rule catalogue (v1)

Thresholds shown are defaults in the config file.

### Dataset and loading

| ID | Condition | Suggestion |
|---|---|---|
| D01 | rows < 500 | Warn: results will be unstable. Use cross-validation, prefer simple models, avoid neural nets. |
| D02 | rows × columns > 20M cells | Tip: explore on a sample (`load_csv.sampleRows`), train on full data later. This is a comfort threshold, not a limit: the spike loaded 50M cells (1M × 50) in the browser with a 1.3 GB heap. |
| D03 | duplicate rows > 1% | Add `drop_duplicates`. |
| D04 | file parsed to 1 column and header contains `;` `\t` or `\|` | Change `load_csv.delimiter`. |
| D05 | column dtype inferred as string but ≥ 95% of values parse as numbers | Tip: treat as numeric, check the odd values. |

### Target and task

| ID | Condition | Suggestion |
|---|---|---|
| T01 | target has nulls | Warn: add `filter_rows` (target not null). Models cannot learn without a label. |
| T02 | numeric target with ≤ 10 unique integer values but task is regression | Tip: this looks like classes, consider classification. |
| T03 | classification and target has > 50 unique values and rows per class < 20 | Warn: probably regression, or classes need merging. |
| T04 | classification, minority class < 10% | Suggest `split.strategy = stratified`, primary metric `f1` or `pr_auc`, and `class_weight = balanced` on the model. |
| T05 | regression and \|target skew\| > 1 | Info: errors may be dominated by large values, consider the metric (`mae`, `mape`). |
| T06 | primary metric is `accuracy` and minority class < 10% | Warn: accuracy hides failure on the rare class. |

### Columns and features

| ID | Condition | Suggestion |
|---|---|---|
| C01 | unique % > 98% and (name matches `id\|uuid\|key\|index` or unique % = 100%) and not target | Set role to `exclude`. It looks like an identifier. |
| C02 | column has ≤ 1 unique value | Drop it (no information). |
| C03 | top value share > 99% | Warn: near-constant, consider dropping. |
| C04 | null % > 40% | Offer: drop column, or impute plus missing-indicator. |
| C05 | 0% < null % ≤ 40%, numeric | Offer `impute`: `median` if \|skew\| > 0.5 else `mean`. |
| C06 | 0% < null % ≤ 40%, category/string | Offer `impute` with `most_frequent`. |
| C07 | datetime column present | Offer `derive_feature` `date_part` (year, month, weekday). Raw datetimes cannot enter most models. |
| C08 | category with unique count ≤ 15 | Suggest `encode` `onehot`. |
| C09 | category with unique count > 50 | Warn: one-hot would add many columns. Suggest `encode` `frequency`, or set `maxCategories`. |
| C10 | numeric feature with IQR outliers > 1% | Info: consider `handle_outliers` with `clip`. |
| C11 | numeric feature, all values > 0, skew > 2 | Tip: `derive_feature` `log`. |
| C12 | feature \|correlation\| with target > 0.98 | Warn: possible target leakage. Check the column is available at prediction time. |
| C13 | two features with \|correlation\| > 0.95 | Tip: redundant. `select_features` `correlation`, or drop one. |

### Split

| ID | Condition | Suggestion |
|---|---|---|
| S01 | classification and `split.strategy == random` | Suggest `stratified`. |
| S02 | datetime column exists and target changes over time | Suggest `split.strategy = time` so the model is tested on later rows. |
| S03 | column name matches `customer\|user\|patient\|store\|session` and repeats across rows | Info: rows from one entity in both train and test inflate scores. Consider `group` split. |
| S04 | rows < 2000 | Suggest ratios `[0.8, 0, 0.2]` with k-fold validation. |
| S05 | test partition < 30 rows, or any class < 10 rows in test | Warn: test score will be too noisy to trust. |

### Model choice and preprocessing

| ID | Condition | Suggestion |
|---|---|---|
| M01 | model is linear, logistic, knn, svm, mlp or kmeans and there is no `scale` upstream | Warn: these models are sensitive to feature ranges. Add `scale` `standard`. |
| M02 | model is tree-based and a `scale` node exists | Info: not needed for trees, harmless. |
| M03 | linear or logistic model and `encode.method == onehot` with `dropFirst` off | Tip: set `dropFirst`. |
| M04 | no baseline run exists yet | Suggest running `linear_regression` or `logistic_regression` first, so every later model has something to beat. |
| M05 | `mlp` and rows < 1000 | Warn: neural nets usually need more data. Trees or linear models are safer here. |
| M06 | `svm` and rows > 20,000 | Warn: slow in the browser. Suggest `gradient_boosting` or a sample. |
| M07 | `knn` and (columns > 50 or rows > 50,000) | Warn: slow and distances become unreliable in many dimensions. |
| M08 | task is clustering and no `scale` upstream | Warn: large-range columns will dominate the clusters. |
| M09 | `mlp`, engine is the browser, and rows × epochs > 1.6M (for example 80k rows × 20 epochs took about 17 s; it scales linearly) | Tip: the browser neural net is about 7× slower than native. Lower epochs or rows, use a tree model, or connect the companion. |
| M10 | engine is the browser and the chosen model is `random_forest` with rows > 200k | Info: the browser engine is single-threaded, so expect minutes. The companion uses all cores. |

### Training and results (run-based)

| ID | Condition | Suggestion |
|---|---|---|
| R01 | train score better than validation by > 10% (relative) | Overfitting. Per algorithm: lower `max_depth`, raise `min_samples_leaf`, raise `alpha`/lower `C`, enable `early_stopping`, or add more rows. |
| R02 | validation score within 2% of baseline, train score also poor | Underfitting. More capable model, more features, less regularisation. |
| R03 | model does not beat the baseline run | Warn: the extra complexity is not earning anything. |
| R04 | fold-score std > 10% of the mean | Scores are unstable. Use `repeated_kfold`, or note the dataset is small. |
| R05 | `mlp` loss becomes NaN or rises over several epochs | Lower `learning_rate`. |
| R06 | `mlp` or iterative model hit `epochs` / `max_iter` with loss still falling | Raise `epochs` / `max_iter`. |
| R07 | `mlp` validation loss rising while train loss falls | Enable `early_stopping`, lower `epochs`, or add `l2`. |
| R08 | tuned best value sits on the edge of its search range | Widen that range and re-tune. |
| R09 | a validated model exists and the test set has not been used | Info: ready for the final test. |
| R10 | classification and one class has recall < 20% | Suggest `class_weight = balanced`, check class balance. |
| R11 | after test run, test score much worse than validation | Info only: no further tuning offered, since that would use the test set. Explain variance and possible leakage. |

### Clustering

Clustering rules K01 to K12 are in [clustering-variant.md](clustering-variant.md). For clustering, the T-rules, S-rules and most R-rules do not apply (no target, no test set).

## Mode behaviour

| | Guided | Expert |
|---|---|---|
| Severities shown | all | `warn` and above, `tip`/`info` collapsed |
| Wording | plain language, with "why" always visible | compact, "why" on expand |
| Apply | with before/after preview | one click, with Undo |
| Rule groups | all on | can be switched off per group in settings |

## Implementation notes

- The profile and the pipeline are both JSON, so rules are pure functions over JSON and can be written in the same language as the UI, independent of the training engine (Pyodide or native).
- Rules run in a Web Worker. Profile computation is the expensive part, and it runs once per dataset version.
- Rules are re-evaluated incrementally: only rules in the stage affected by a change.
- Rule metadata (`id`, `stage`, `severity`, thresholds, text templates) is kept apart from the `evaluate` function, so wording can change without touching logic.

## Testing

- **Fixture tests:** for every rule, small profile + pipeline fixtures with the expected suggestions (fires, does not fire, boundary values).
- **Idempotence test:** apply each suggestion's patch, then re-run all rules. The rule must not fire again, and no other rule may fire as a direct result.
- **Dataset audit:** run all rules over public datasets (Iris, Titanic, California housing, Adult income, Telco churn) and review every suggestion by hand for false positives.
- **Schema test:** every patch must produce a pipeline that passes the validator.

## Open items

- Final threshold values (these defaults are starting guesses, to be tuned on real datasets).
- Whether S03 (group split) and C12 (leakage) are accurate enough to ship, since name matching is heuristic.
- Per-node profiles (data as it arrives at each node) in v1, or only the raw and train-partition profiles. The train-partition profile itself is required.
- Wording style guide for `message` and `why`.
- Whether users can write their own rules (plugin system), and if so the rule format must become declarative JSON, not code.
