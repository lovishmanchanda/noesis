# NOESIS: wizard screens (draft 0.1)

Companion to all earlier docs. This file defines the **structure** of the wizard: which screens exist, in what order, what each one reads and writes, and how they connect to the pipeline, the rule engine and the engine. It does not define visual design (layout, colours, components), which comes later.

## Principles

1. **Screens are views over nodes.** A screen edits one or more pipeline nodes. It does not own state. Everything lives in the pipeline JSON.
2. **Screen order is not node order.** The user sees a friendly sequence. A **graph builder** places each node in its correct position (stateless steps before the split, learned steps after it), so leakage cannot happen however the user clicks.
3. **Every screen works with one click on Next** (defaults), and everything else is optional.
4. **Free navigation backwards, gated navigation forwards.** The user can return to any visited screen. Unvisited screens unlock when their prerequisites are done.
5. **Changes ripple visibly.** Editing an earlier screen marks later results `outdated` and says what needs re-running.

## Screen order and why

| # | Screen | Pipeline effect |
|---|---|---|
| 1 | Project | task type, topic |
| 2 | Data | `load_csv`, dataset fingerprint, profile |
| 3 | Target | column roles |
| 4 | Tidy | stateless nodes: `drop_columns`, `drop_duplicates`, `filter_rows` |
| 5 | Split | `split` (the test set is locked here) |
| 6 | Explore | none (read-only), train partition only |
| 7 | Missing and outliers | `impute`, `handle_outliers` |
| 8 | Features | `encode`, `scale`, `derive_feature`, `select_features` |
| 9 | Model | `model` |
| 10 | Train | a run, live visualisation |
| 11 | Compare and tune | `validate`, `tune`, run leaderboard |
| 12 | Explain | read-only results |
| 13 | Final test | `test` |
| 14 | Export | `export_model` |

Two ordering choices deserve a reason:

- **Split comes before Explore.** Looking at all the data before splitting lets the test set influence decisions. Exploring the **train partition only** keeps the test set untouched. Duplicates, wrong rows and obvious ID columns are fixed before the split, in Tidy, because they are safe (no statistics learned) and duplicates must not land on both sides of the split.
- **Missing values, outliers and encoding come after the split.** They learn from the data, so they are fitted on train only (`fit_on: "train"`).

## Shell (present on every screen)

| Element | Purpose |
|---|---|
| Stepper (left) | The 14 screens with state: `todo`, `incomplete`, `done`, `outdated`, `blocked` (with the reason on hover) |
| Main panel | The current screen |
| Suggestions panel (right) | Open suggestions from the rule engine for this screen, with Apply and Dismiss. At most 3 expanded. |
| Next-step banner (top) | The single next step, plus the top suggestion |
| Bottom bar | Back, Next, and "Skip" where a screen is optional |
| Header | Project name, Guided / Expert toggle, run history, save status, engine status (browser or companion) |
| Pipeline view (drawer) | Read-only graph of the nodes. This is the bridge to the canvas mode later. |
| Help (drawer) | Plain-language explanations for the current screen (Learn mode) |

## Screens

Each screen below lists: what the user sees and does, what it writes, which rules fire, what must be true to continue, and special states.

### 0. Startup (before screen 1)

- Shows engine load progress (Pyodide download on first visit, cached afterwards). Budget about 7 s for a warm start on a calm laptop (spike measurement), so this screen is a real loading screen. Heavy packages (pyarrow, XGBoost) load only when first needed.
- Offers: **New project**, **Open recent**, **Try a sample dataset** (for example Iris, Titanic, a housing set) so a first-time user can run the whole wizard without a CSV.
- Requests persistent storage and explains why in one line.

### 1. Project

- **User does:** names the project and optionally types a topic. Chooses what to predict, in plain words: *a number*, *a category*, *group similar rows*. (Forecasting is later.)
- **Writes:** `project.name`, `project.topic`, `task.type`, `task.primaryMetric` (default per task).
- **Rules:** none yet.
- **Continue when:** a task type is chosen.
- **Expert:** can set the seed and the primary metric here.

### 2. Data

- **Sees:** a drop zone for the CSV, a preview (first rows), detected delimiter, header, row and column counts, and a column list with inferred types.
- **User does:** adds the file, corrects the delimiter or header, fixes a column's type, and optionally limits to a sample for big files.
- **Writes:** `load_csv` params, `dataset.source` and fingerprint, column dtypes.
- **Rules:** D01 to D05 (small data, big data, duplicates, delimiter, numbers stored as text).
- **Continue when:** the file parsed with at least 2 columns and 50 rows.
- **States:** loading with progress, file too large (message offers sample or companion; start with a soft limit near 1M rows × 50 columns until the real limit is found, see [spike-results.md](../research/spike-results.md)), parse error with the offending line, file changed on disk since last time (fingerprint mismatch warning).
- **Expert:** encoding, missing markers, date columns.

### 3. Target

- **Sees:** the column list with a one-click "this is what I want to predict", the target's distribution, and a plain-language check against the task from screen 1.
- **User does:** picks the target column, optionally marks columns as excluded.
- **Writes:** column `role` values (`target`, `feature`, `exclude`).
- **Rules:** T01 to T06, C01 (ID-like columns, offered as one-click exclude), C02, C03.
- **Continue when:** a target is chosen that fits the task type.
- **States:** mismatch (for example a text column chosen for a regression) shows an error with the fix.

### 4. Tidy (stateless fixes, before the split)

- **Sees:** cards for duplicates, columns to drop (constant, ID-like, almost-all-missing), and rows to remove (for example missing target). Each card shows the number affected.
- **User does:** accepts or rejects each fix, optionally adds a custom row filter.
- **Writes:** `drop_columns`, `drop_duplicates`, `filter_rows` (placed before `split` by the builder).
- **Rules:** D03, T01, C02, C03, C04 when the column is mostly empty.
- **Continue when:** always (optional screen, Next is allowed even with nothing done).
- **Why here:** none of these learn statistics, so they cannot leak.

### 5. Split

- **Sees:** a single slider for train / validation / test with the default 70/15/15, row counts for each part, the split strategy (random, stratified, group, time), and a warning if the test part is tiny.
- **User does:** adjusts the ratio, picks a strategy if the data suggests one.
- **Writes:** `split` params.
- **Rules:** S01 to S05, with one-click patches (for example stratified, or `[0.8, 0, 0.2]` with k-fold).
- **Continue when:** ratios are valid.
- **Effect:** the test partition is locked and hidden from every later screen. A badge says "Test data locked".
- **Changing the split later** invalidates everything after it, and the screen says so before saving.

### 6. Explore (read-only, train partition only)

- **Sees:** a header "Train data only" and charts: distributions, correlations, target relationships, class balance, missingness map. A column inspector opens details for one column.
- **User does:** looks around. Every chart has a one-line "what this tells you". Any chart insight with a rule behind it shows a suggestion chip (for example "highly skewed, try log").
- **Writes:** nothing directly. Suggestions it surfaces edit nodes on other screens.
- **Rules:** C10 to C13, T05, S02, S03 evidence.
- **Continue when:** always. Skipping is allowed.
- **Expert:** an optional "explore all data" switch with a warning that it can bias the final test. This is an open item.

### 7. Missing values and outliers (learned from train)

- **Sees:** one row per column with missing values or outliers, a before/after preview, and a suggested strategy.
- **User does:** per column picks fill method (median, mean, most frequent, constant, nearest neighbours) or drops the column, and outlier handling (leave, clip, remove from train, flag).
- **Writes:** `impute`, `handle_outliers` (with `fit_on: "train"`, placed after `split`).
- **Rules:** C04, C05, C06, C10.
- **Continue when:** no column that will reach a model still has missing values (the model would fail). The screen counts what remains.
- **Expert:** per-column strategy table with all parameters, missing-indicator columns.

### 8. Features

- **Sees:** every feature with its type and what will happen to it. Groups: text to numbers (encoding), numeric ranges (scaling), new features (dates, ratios, logs), and feature selection. The preview shows the resulting columns and their count.
- **User does:** accepts encoding per category column, picks a scaling method (or none), adds derived features from a short menu, optionally enables selection.
- **Writes:** `encode`, `scale`, `derive_feature`, `select_features`.
- **Rules:** C07 to C09, C11 to C13, M01 to M03 (these also depend on the model, so they re-evaluate when the user picks one on screen 9).
- **Continue when:** every feature that reaches the model is numeric (hard rule 7 in [pipeline-schema.md](pipeline-schema.md)). The screen shows how many are not yet.
- **States:** a very wide result (for example one-hot of a high-cardinality column) shows a warning with the column count.

### 9. Model

- **Sees:** three presets (Fast, Balanced, Accurate) and an algorithm list filtered by task, each with one line on strengths and the data size it suits. A baseline option is pre-selected as the recommended first run.
- **User does:** picks a preset or an algorithm, and optionally edits hyperparameters.
- **Writes:** `model` params (flat hyperparameters, each with its own `source`).
- **Rules:** M01 to M08, with warnings tied to the chosen algorithm and data size.
- **Continue when:** an algorithm is chosen and its required parameters are filled.
- **Expert:** all hyperparameters, with defaults shown and a "not in use" toggle per parameter.

### 10. Train

- **Sees:** the node-graph visualisation for the chosen algorithm ([training-events.md](training-events.md)), live loss or score curves, a table of real rows flowing through, elapsed time, and a Start / Stop control. A label says "live" or "replay of the learned structure" per animation.
- **User does:** starts and stops the run, switches pacing (Live, Slow, Step) and visualisation level, and replays finished runs.
- **Writes:** a run record. `validate` runs automatically after training with the default scheme.
- **Rules:** R05 to R07 (divergence, not converged, validation loss rising) appear during or right after the run.
- **Continue when:** at least one run succeeded.
- **States:** cached node (instant, offers replay), running, cancelled, failed with the error code and hint, interrupted (tab closed earlier).

### 11. Compare and tune

- **Sees:** a leaderboard of runs ranked by **validation** score only, side-by-side metrics, overlaid curves, and a pipeline diff between any two runs. A tuning panel shows the search space and a live trial plot.
- **User does:** trains more models, starts tuning (method, number of trials, time limit), sets the validation scheme (holdout, k-fold, repeated, time-series), marks runs as kept, picks the winner.
- **Writes:** `validate`, `tune`, run flags (`kept`, labels).
- **Rules:** R01 to R04, R08, R10, M04 (no baseline yet).
- **Continue when:** one run is chosen as the candidate.
- **Note:** the test score never appears here.

### 12. Explain

- **Sees:** feature importance, a confusion matrix (classification) or residual plots (regression), per-class scores, and "where does the model fail" (the worst-predicted validation rows). A "what-if" form lets the user change input values and see the prediction.
- **User does:** inspects and optionally goes back to fix issues.
- **Writes:** nothing.
- **Rules:** R10 and leakage hints (C12).
- **Continue when:** always.

### 13. Final test

- **Sees:** a clear explanation that this uses the locked test set, once, and a single confirm button for the chosen model.
- **User does:** confirms. The result shows test metrics next to validation metrics, with the gap explained.
- **Writes:** `test`, an entry in the run's `testAccess` log.
- **Rules:** R09 (ready for the final test), R11 (a large gap, explained, with no tuning offered).
- **Re-testing:** requires an explicit "unlock test set" action with a reason, which is logged.
- **Continue when:** the test has run.

### 14. Export

- **Sees:** options: download the model (bundle or ONNX), generated Python script, and a model card (data used, metrics, limits). A "try it" form uses the model.
- **User does:** picks formats and downloads. Nothing is uploaded.
- **Writes:** `export_model`.
- **Expert:** copy the pipeline JSON, export the whole project, reproduce check.

## Cross-cutting behaviour

### Ripple and "outdated"

When a node changes, every downstream node's hash changes ([hashing-and-runs.md](hashing-and-runs.md)). The stepper marks affected screens `outdated`. A banner on the next affected screen reads "3 steps need re-running", with a **Re-run affected** button. Earlier results stay in history as old runs.

### Undo and history

Every applied suggestion and every confirmed edit writes a project version. Undo and redo step through versions. The header shows save status ("Saved on this device").

### Mode toggle

| | Guided | Expert |
|---|---|---|
| Per-screen explanation | visible | collapsed |
| Parameters | basic only, "Advanced" drawer for the rest | all visible |
| Suggestions | all severities | warnings and above |
| Confirmations | extra ("this will change later steps") | minimal |
| Navigation | the stepper unlocks in order | the stepper is open to any screen whose prerequisites are met |

### Blocking and gating

- Next is disabled while a required parameter is `null` or a hard rule fails, with the reason in one line.
- A locked step in the stepper explains what unlocks it ("Needs a split first").
- The user can always leave and return. Work is saved automatically.

### Errors

Every error shows a plain-language sentence, the error code, and the specific fix. Out-of-memory suggests sampling or the companion. File problems point at the cause.

### Leaving and returning

Closing the tab mid-run marks the run `interrupted`. Reopening shows the project at the last screen with a note, and offers the sample or the saved file handle again if browser permission lapsed.

## Open items

- Whether "explore all data" exists at all, even in Expert mode.
- Whether Tidy and Missing/outliers should merge into one screen, with the builder still separating the nodes.
- Clustering variant (no target screen, optional split, different compare and explain screens): drafted in [clustering-variant.md](clustering-variant.md).
- Whether sample datasets ship with the app or load on demand.
- How the canvas mode attaches (the Pipeline view drawer is the starting point).
- Accessibility, keyboard navigation and responsive behaviour: drafted in [visual-design.md](visual-design.md).
