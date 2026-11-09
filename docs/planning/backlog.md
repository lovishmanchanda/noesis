# NOESIS: backlog, known limits and future work

Everything that is known to be unfinished, imperfect or untested, in one place, with when it should be dealt with. Companion to [roadmap.md](roadmap.md), which says what each phase builds. This file is updated at the end of every phase: items are added as they are found and removed (with a note in the phase's progress entry) when they are done.

**When** uses the roadmap phases: 4 Finish, 5 Harden, 6 Beta, **v1.1** and **v2** for after the first release, **ask** for a decision the maintainer has to make first.

## 1. Known limits and problems found while building

| ID | Item | Why it matters | When |
|---|---|---|---|
| B01 | **Engine start-up is about 20 s on the Windows laptop** (7 s on the Mac). The cause is not isolated: Windows Defender scanning the Pyodide files is the main suspect, headless browsers and the CPU are others. | The first thing a Windows user sees is a long wait. | 5 (check early: repeat the load test with the folder excluded from Defender, in a normal window) |
| B02 | **Stop without cross-origin isolation restarts the Python engine** (several seconds, reopens the file). The code exists but was never exercised. Hosting must send the isolation headers. | Stop would feel broken on a host without the headers. | 5 |
| B03 | **The first step that learns (fill, encode, scale, train) loads scikit-learn and pyarrow** (about 4 s on the Mac) behind a plain "Working…" label. | The pause looks like a hang. | 5 (show a named loading stage) |
| B04 | **The result cache lives in memory only.** Closing the tab loses it, so prepared steps re-run after a reload. | Slower return visits; the design promised storage by hash. | 4 (with model files, which need the same storage budget and eviction) |
| B05 | **Storage housekeeping is minimal:** no usage meter, no `persist()` request, no warning at 80% of quota, and no protection for two tabs writing at once (Web Locks, BroadcastChannel). Run records keep the last 50 plus kept runs. | Browsers can evict data; two tabs could overwrite each other. | 5 |
| B06 | **The memory guard and the time estimates are rough.** The factors come from one Mac and the 600-row sample; the neural-network speed (about 94,000 row-epochs a second) is from the Mac. Nothing was timed on a big file after Phase 1. | Warnings may be too early or too late. | 5 (calibrate on Windows and on 1M-row files; find the real size limit, 2–3M rows) |
| B07 | **The visualisation level cannot change during a run**, and pause and resume do not exist. | Minor, but the design listed both. | v1.1 |
| B08 | **Only six models are offered.** Decision tree, lasso, KNN, SVM and naive Bayes still train when asked but have no live view and no card on the Model screen. Clustering has no screens at all (grouping rows shows "arrives later"). | Narrower than the registry. | v1.1 (models), v2 (clustering variant) |
| B09 | **Events not built:** `sample_rows` (real rows flowing through each node), `projection_ready`, activations, heartbeat, `artifact_ready`, the per-algorithm live views for the other algorithms. The stored log is capped at 1 MB per run (design said about 5 MB). | The "real data moving through nodes" idea from the first brief is only partly delivered: the pipeline strip shows steps and timings, not rows. | 5 (rows through nodes), v1.1 (rest) |
| B10 | **Rules not built (27 are built):** D02, D05, T02, T03, T05, T06, C03, C10, C11, C13, S03, S04, S05, M02, M03, M06, M07, M08, R02, R04, R08, R10, R11 and the clustering rules K01 to K12. | Waiting for real data to show which matter. | 6 (decide from beta), R10 and R11 in 4 |
| B11 | **Explore has no "explore all rows" switch** for Expert mode, and profiles are kept for three points only (the file, the training rows after the split, the output of the last step), not per step. | Open design questions in [rule-engine.md](../design/rule-engine.md). | ask |
| B12 | **Undo history lives for one visit.** It is not saved with the project, and runs are not part of the project file. | A project file moved to another computer has no run history. | 5 (decide), v1.1 |
| B13 | **Small interface problems seen in testing:** the bottom bar covers content in short windows; the suggestions drawer covers part of wide tables on narrow screens; the Undo bar says "Applied:" even for a manual edit; automatic run names count failed runs; the tree view shows only the top 4 levels; curves of different kinds (loss against score) are not overlaid; the Dates list on Features has no way to undo a split except removing its steps. | Polish. | 5 |
| B14 | **The first-use text is thin:** no guided first project, no callouts, no help drawer content. | The v1 goal is a first model in under 5 minutes without reading anything. | 5 |

## 2. Not tested yet

| ID | Item | When |
|---|---|---|
| B20 | **Firefox and Safari** (no File System Access API there, so file handling needs a fallback; Safari needs 16.4 or newer for the isolation features). Firefox is not installed on the Windows laptop. | 5 |
| B21 | **Chrome and Edge in normal windows on Windows.** All Windows runs were headless, over SSH. | 5 |
| B22 | **Repeated timings:** each Windows timing was run once (load three times), not five. The Windows power mode setting could not be verified from the command line. | 5 |
| B23 | **End-to-end browser tests (Playwright)** were postponed because they download browsers outside the repository folder. The screens are checked by unit tests and by hand. | 5 (decide where the browsers may live) |
| B24 | **Real datasets:** everything ran on two seeded sample files. The rule audit on Iris, Titanic, California housing, Adult income and Telco churn has not been done. | 6 |
| B25 | **Reproducibility across engines:** a run moved from the browser to the companion is `approx`, not `exact`. The reproduce check's tolerance is not chosen. The dataset hash is SHA-256, and its speed on a 1 GB file is unknown. | 4 (reproduce check), v1.1 (companion) |
| B26 | **Accessibility:** no axe run, no keyboard-only walkthrough, charts have text summaries but no data table, no screen-reader pass on the live training status. | 5 |

## 3. Phase 4 and later, already in the roadmap

Listed so nothing is lost; the detail is in [wizard-screens.md](../design/wizard-screens.md).

| ID | Item | When |
|---|---|---|
| B30 | **Explain:** feature importance, confusion matrix or residuals, per-class scores, worst-predicted rows, a what-if form. | 4 |
| B31 | **Final test:** the test set used once per model, with a logged "unlock" and reason; rule R11 (a large gap, explained, no tuning offered). | 4 |
| B32 | **Export:** model bundle, Python script, **notebook (.ipynb)**, model card. | 4 |
| B33 | **Predict on a new CSV, on the device.** | 4 |
| B34 | **Data quality summary** card at the end of Tidy. | 4 |
| B35 | **Decision log** for rule thresholds and why they changed. | 6 |
| B36 | **Five real users with their own files** before release. | 6 |

## 4. After v1

Local companion (speed, GPU, big files; CUDA gave XGBoost a 2.2× speed-up on the RTX 4060 laptop), clustering screens, tuning sweeps and replay of old runs, HTML or PDF report, fairness check, time series, images and text through a second engine, canvas mode, sharing, ONNX export.

## 5. Housekeeping the maintainer should decide on

| ID | Item |
|---|---|
| B40 | **The SSH key for the Windows laptop** is still authorised (`C:\ProgramData\ssh\administrators_authorized_keys`). Remove it when the Windows work is finished. The private key is in `.local/ssh/` on the Mac, which git ignores and `pnpm clean` keeps. |
| B41 | **Shared caches outside the project folder** (npm's and conda's) were not touched, because other projects may use them. `npm cache clean --force` and `conda clean --packages` would clear them. |
| B42 | **Before release:** a strict Content Security Policy, the hosting headers (cross-origin isolation), a dependency licence check, and a review of the companion's security (see [companion.md](../design/companion.md)). |
| B43 | **Wording and naming:** a style guide for suggestion messages, and a rename check if the product name ever changes (it appears in one place in the root package and the README). |
