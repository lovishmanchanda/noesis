# NOESIS: roadmap and improvements (draft 0.1)

Companion to [tech-stack.md](../architecture/tech-stack.md). The design docs describe a lot. This file says what to build first, in what order, and what would make the product better than a notebook replacement.

## Biggest risk to manage: scope

The docs cover 14 screens, about 60 rules, 15 algorithms, clustering, a companion, GPU, and canvas mode. Building all of it before anyone uses it is the likeliest way to fail. So:

- Ship a **small vertical slice** first, with real users and real datasets.
- Keep the rest in the docs as the direction, not as the first release.

## MVP (v1)

| Area | In v1 | Later |
|---|---|---|
| Tasks | classification and regression on CSV | clustering, forecasting, images, text |
| Algorithms | logistic and linear regression, ridge, random forest, XGBoost, neural net (with a size cap) | SVM, KNN, naive Bayes, Lasso, others |
| Engine | browser only | companion and GPU |
| Screens | all supervised screens 1 to 14 | clustering variant, canvas mode |
| Rules | the 15 to 20 highest-value rules (below) | the rest of the catalogue |
| Compare | leaderboard, settings diff, kept runs | tuning sweeps, replay of old runs |
| Export | model bundle, Python script, model card | ONNX, HTML or PDF report |
| Projects | autosave on device, export and import a project file | sharing |
| Modes | Guided, plus a light Expert mode | full Expert mode |
| Theme | light and dark | custom themes |

### Rules to ship first

Chosen because each is common, easy to explain, and cheap to get right: D01, D03, D04, T01, T04, C01, C02, C04 to C06, C07, C08, C09, C12, S01, S02, M01, M04, M05, R01, R03, R09. Everything else waits until real data shows what users hit.

### Definition of done for v1

- A new user trains and exports a model from a sample dataset in under 5 minutes without reading anything.
- Five real datasets from real people run end to end without errors.
- No ordering of steps in the wizard can leak test data.
- Works in Chrome and Edge; Firefox and Safari either work or show a clear message.
- Passes the accessibility checks and a keyboard-only walkthrough.

## Phases

| Phase | Work | Output |
|---|---|---|
| 0. Foundations | monorepo, registry, schema and generated types, Python node package, pipeline validator, golden fixtures, contract-test harness | validator rejects leakage; same node code passes tests in Pyodide and natively |
| 1. Data in | engine worker, loading screen, CSV import, profiling, screens 1 to 5 (Project, Data, Target, Tidy, Split), project save | a user can load a file and split it |
| 2. Prepare | rule engine core, screens 6 to 8 (Explore, Missing values, Features), suggestions with preview and undo | cleaning and features work, suggestions apply cleanly |
| 3. Train | screens 9 to 11 (Model, Train, Compare), event stream, live visuals for the MVP algorithms, cancel flag | live training with working cancel |
| 4. Finish | screens 12 to 14 (Explain, Final test, Export), batch prediction, model card | complete flow end to end |
| 5. Harden | accessibility, cross-browser, error states, performance budget, first-run experience, docs and help | beta-ready |
| 6. Beta | real users and datasets, tune rule thresholds, fix what hurts | v1 release |

No dates are given because the team size and hours are not known yet.

**Clean-up after every phase.** When a phase is merged, run `pnpm clean` and then `pnpm clean:yes` (see [CONTRIBUTING.md](../../CONTRIBUTING.md)), so generated data, caches, logs, archives and scratch files never pile up, and check that nothing was written outside the repository folder.

## Improvements worth adding to the design

These come from the review of the docs and would raise the product's value. Items marked **v1** are cheap and should go into the first release.

### Product

| Improvement | Why | When |
|---|---|---|
| **Predict on a new CSV** (upload new rows, download the predictions, all on the device) | This is why people train a model; without it the app ends at a score | v1 |
| **Notebook export (.ipynb)** next to the Python script | Professionals live in notebooks; the node code is plain pandas, so this is cheap | v1 |
| **Guided first project** with a sample dataset and short callouts | Cuts time to first success, serves students | v1 |
| **Project file** (pipeline, settings, run history; no data) that can be shared | Reproducibility and teamwork without moving data | v1 |
| **Data quality summary** card at the end of Tidy (rows, gaps, duplicates, suspicious columns) | Gives a quick sense of the file before modelling | v1 |
| **HTML or PDF report** from the model card | Something to hand to a manager | 1.1 |
| **Fairness check**: scores by group for a chosen column | Professionals will ask; easy to add once predictions exist | 1.1 |
| **Time series** task with time-ordered splits | Common real need | 1.2 |
| **Images and text** through a second engine | The long-term differentiator | 2 |
| **Canvas mode** on the same pipeline file | For people who outgrow the wizard | 2 |

### Technical

| Improvement | Why |
|---|---|
| **One registry as the source of truth** for forms, schema, types, validation and docs | Prevents drift across a large design |
| **Contract tests** running the same pipelines in the browser and natively | The single-codebase claim only holds if it is tested continuously |
| **Golden datasets and golden event logs** | Makes rule and event changes safe |
| **Autosave and crash recovery** with a visible "saved on this device" indicator | Browser tabs crash; losing work breaks trust |
| **Local debug log and "copy diagnostics" button** | Support without any telemetry |
| **Memory guard**: estimate memory before loading or training, warn before a crash | The spike showed heap growth is predictable |
| **Strict Content Security Policy and no third-party scripts** | Required for cross-origin isolation anyway, and good for privacy |
| **Lazy loading of heavy packages** and a real loading screen | Warm start was 7.3 s; most of it is avoidable for simple paths |
| **Accessibility and keyboard tests in CI** | Cheaper than retrofitting |
| **Version matrix test**: re-run the fixtures when Pyodide or a library is upgraded | The stack is pinned to a very new Python; upgrades will be frequent |

### Process

1. **Test with real people early**, before phase 5. Five users with their own CSVs will find more than another round of design.
2. **Keep a decision log** for rule thresholds and why they changed.
3. **Review the plan every phase** and cut anything that real use does not support.

## Risks and how to reduce them

| Risk | Reduction |
|---|---|
| Too much built before feedback | MVP above; real users from phase 3 |
| Browser engine too slow for some users | Clear size and time warnings; companion in v1.1 |
| Cross-browser gaps (Safari, Firefox) | Run the spike on both now; show a clear message where unsupported |
| Pyodide and Python 3.14 are new, so libraries may lag | Pin versions; contract tests on upgrade; fall back to a prior stable release if needed |
| Rule thresholds are guesses | Ship few rules; log accept and dismiss rates locally; tune on beta data |
| Leakage mistakes erode trust | Hard validator, leakage tests in CI, and the train-partition profile for post-split rules |
| Design drift between docs, UI and engine | One registry and generated artefacts |
| Local storage is limited or evicted | Visible storage meter, easy project export, persistent storage request |

## Decisions needed

1. Confirm the MVP scope above, or move items in or out.
2. Product name and repository licence.
3. First target users (students, analysts, or ML engineers). It changes the default mode and the wording.
4. Whether to start building now or wait for the Windows, Firefox and Safari results first. Suggestion: start phase 0 now, since none of it depends on those results.
