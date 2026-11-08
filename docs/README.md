# NOESIS: design docs

A browser-based, no-code way to do what people usually do in Jupyter notebooks: load a CSV, clean it, train a model, check it, and export it. The data stays on the user's computer. Suggestions come from explicit rules, not from AI. Status: planning, with one engine experiment run.

## Reading order

| # | Doc | What it answers | Status |
|---|---|---|---|
| 1 | [wizard-screens.md](design/wizard-screens.md) | What the user sees, screen by screen, and what each screen writes | draft |
| 2 | [pipeline-schema.md](design/pipeline-schema.md) + [pipeline.schema.json](../packages/schema/pipeline.schema.json) | The central file format: a graph of nodes, leakage rules, storage references | draft |
| 3 | [param-definitions.md](design/param-definitions.md) | Every parameter: type, default, range, when it applies | draft |
| 4 | [rule-engine.md](design/rule-engine.md) | The "next best step" suggestions (no AI), their format, lifecycle and rule catalogue | draft, thresholds are guesses |
| 5 | [hashing-and-runs.md](design/hashing-and-runs.md) | Outdated detection, caching, run records, reproducibility | draft |
| 6 | [training-events.md](design/training-events.md) | The event stream behind the live training visuals | draft, partly tested |
| 7 | [engine-choice.md](architecture/engine-choice.md) | Why Python in the browser (Pyodide), with an optional local companion | recommendation, tested on one machine |
| 8 | [spike-plan.md](research/spike-plan.md), [spike-results.md](research/spike-results.md) | The experiment that tested the engine choice and what it found | run 1 done (Mac, Chromium) |
| 9 | [companion.md](design/companion.md) | The optional local program for speed, GPU and big files | draft, not built, browser checks pending |
| 10 | [clustering-variant.md](design/clustering-variant.md) | What changes when there is no target (group similar rows) | draft |
| 11 | [visual-design.md](design/visual-design.md) | Layout, colour, components, accessibility, mockup coverage | draft, most screens mocked up for design review |
| 12 | [tech-stack.md](architecture/tech-stack.md) | The chosen stack, repository layout, quality gates | decision record, chart library and hosting still open |
| 13 | [roadmap.md](planning/roadmap.md) | MVP scope, build phases, improvements, risks | proposal, needs your confirmation |

The experiment code is in [experiments/engine-spike](../experiments/engine-spike); run instructions for another machine are in [experiments/engine-spike/WINDOWS.md](../experiments/engine-spike/WINDOWS.md).

## Decisions made so far

1. **Delivery:** a website that runs locally in the browser. An optional installed companion adds speed, GPU and large files.
2. **Engine:** Python (pandas, scikit-learn, XGBoost) in the browser via Pyodide, inside one Web Worker, behind an `Engine` interface.
3. **Data types:** CSV first. Images and text (CNNs, transformers) later, through a second engine behind the same interface.
4. **Flow:** guided wizard first. A canvas mode later, on the same pipeline file.
5. **Users:** professionals, usable by students. Guided and Expert modes.
6. **No AI in the product.** Suggestions are explicit rules with the evidence shown.
7. **The pipeline is a graph of nodes.** The wizard builds a straight chain. Leakage (learning from test rows) is a hard error.
8. **Parameters carry their origin** (default, you, suggestion), and `null` means "not in use".
9. **Storage** is on the device: IndexedDB and Cache Storage, with results cached by a hash of everything that affects them.
10. **GPU use** goes through the companion (CUDA, Apple MPS), chosen by an Auto policy.

## What has been measured and what has not

| Measured (spike run 1: MacBook Air M2, 8 GB, Chromium) | Not measured yet |
|---|---|
| 1M rows × 50 columns loads and profiles in the browser in about 9.5 s at near-native speed | Windows, NVIDIA GPU, Firefox, Safari |
| Tree models run 1.3–1.8× slower than native on one thread; the neural net about 7× slower | The size at which a file fails; real user datasets |
| The browser engine is single-threaded | How browsers treat a website connecting to the companion on localhost |
| Warm start 7.3 s on a calm machine (target was 5 s); memory snapshots failed | Repeated timings on a quiet machine (5 runs); throttled cold loads |
| Live events work and match normal training; cancel works except where library code swallows the interrupt | SVM, logistic, KNN and DBSCAN live/replay modes |
| Feather with lz4 reloads a 100k × 50 table in 0.5 s | Rule thresholds on real data |

Timings varied by up to 7× when the machine was busy, so treat every number as approximate.

## Biggest open items

1. Run the experiment on Windows (and the GPU test), Firefox and Safari.
2. Decide the front-end framework and chart library.
3. Check browser behaviour for the companion's local connection, then review its security.
4. Tune rule thresholds on real datasets.
5. Mock up the clustering stability screen and the error and empty states, and review dark mode.
6. Find the real file-size limit of the browser engine.

## Conventions

- Draft version numbers (0.1) apply to every doc.
- A "rule" means a suggestion rule (D, T, C, S, M, R, K series). A "hard rule" is enforced by the pipeline validator and cannot be dismissed.
- "Partition" means train, validation or test rows.
