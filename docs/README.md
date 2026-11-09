# NOESIS: design docs

A browser-based, no-code way to do what people usually do in Jupyter notebooks: load a CSV, clean it, train a model, check it, and export it. The data stays on the user's computer. Suggestions come from explicit rules, not from AI. Status: building. Phases 0 to 3 (foundations, data in, prepare, train) are done; the engine experiment has run on a Mac and a Windows laptop.

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
| 12 | [tech-stack.md](architecture/tech-stack.md) | The chosen stack, repository layout, quality gates | decision record, hosting still open (charts decided: plain SVG) |
| 13 | [roadmap.md](planning/roadmap.md) | MVP scope, build phases, improvements, risks | phases 0 to 3 built |
| 14 | [backlog.md](planning/backlog.md) | Every known limit, untested area and future item, with when to deal with it | updated every phase |

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

| Measured | Not measured yet |
|---|---|
| Mac (MacBook Air M2) and Windows (Core Ultra 9, RTX 4060) in Chrome and Edge: 1M rows × 50 columns loads and profiles in the browser; tree models run 1.2–1.8× slower than native on one thread; the neural net 5–7× slower | Firefox, Safari, and Chrome or Edge in normal windows on Windows |
| The browser engine is single-threaded; live events match normal training; cancel works except where library code swallows the interrupt (handled by the engine's own flag) | The point where a big file fails; real user datasets |
| Warm start 7.3 s on the Mac and about 20 s on Windows (target was 5 s); memory snapshots failed | Why Windows is slower (see backlog B01); repeated timings on a quiet machine |
| CUDA: XGBoost on 500k rows 14.3 s on CPU, 6.6 s on the GPU | How browsers treat a website connecting to the companion on localhost |
| Phase 3 in the browser: a neural-network run of 743 epochs kept the main thread free of tasks over 50 ms; Stop took 57 ms | Rule thresholds on real data; the Windows interface in normal windows |

Timings varied by up to 7× when the Mac was busy, so treat every number as approximate.

## Biggest open items

The full list, with when to deal with each, is in [backlog.md](planning/backlog.md). The ones that matter most:

1. Windows start-up time (about 20 s) and the cross-browser runs (Firefox, Safari).
2. Phase 4: Explain, Final test, Export, notebook export and predicting on a new CSV.
3. Tune rule thresholds on real datasets and audit the rules on public ones.
4. Persist the result cache, and calibrate the memory guard on big files.
5. Check browser behaviour for the companion's local connection, then review its security.
6. Accessibility and first-use polish before the beta.

## Conventions

- Draft version numbers (0.1) apply to every doc.
- A "rule" means a suggestion rule (D, T, C, S, M, R, K series). A "hard rule" is enforced by the pipeline validator and cannot be dismissed.
- "Partition" means train, validation or test rows.
