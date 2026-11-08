# NOESIS: visual design (draft 0.1)

Companion to [wizard-screens.md](wizard-screens.md), [training-events.md](training-events.md) and [clustering-variant.md](clustering-variant.md). This is direction and rules, not final artwork. Two mockups were reviewed during design: the wizard shell with the Split screen, and the Train screen with the live node graph. Their structure is described here.

## Personality

A tidy lab notebook for people who know their data. Calm, precise, quiet. It should feel like a professional tool that a student can also follow, not a toy and not a wall of controls.

| It is | It is not |
|---|---|
| Plain-language, short sentences | Jargon-first or chatty |
| Mostly neutral, with one accent | Colourful or decorated |
| Dense when asked (Expert), roomy by default (Guided) | Always dense, or always spacious |
| Honest: "live", "replay", "estimated" are labelled | Slick animation that hides what is real |

## Principles

1. **Default first.** Every screen works with one click on Next. Advanced options live in a drawer, not on the main surface.
2. **Show the data.** Prefer a chart, a preview or a before/after over a description.
3. **One accent.** One colour means "current / primary action". Other colours carry fixed meanings (below) and are never decorative.
4. **Nothing silent.** Every automatic change is visible, labelled with where it came from (default, you, suggestion) and undoable.
5. **Motion explains.** Animation shows what the algorithm is really doing, and nothing else.
6. **Same meaning everywhere.** A partition, a status or a cluster has one colour and one icon across all screens.
7. **Keyboard and screen reader first-class.** Not an afterthought.
8. **Quiet on errors.** Say what happened, why, and the one thing to do next.

## Layout

Desktop-first, three regions plus a top bar.

```
┌──────────────────────────────────────────────────────────────┐
│ Top bar: project · Guided/Expert · save status · engine · runs │
├───────────┬──────────────────────────────────┬───────────────┤
│ Stepper   │ Banner: next step                 │ Suggestions   │
│ 220 px    │ Screen title + one-line purpose   │ 320 px        │
│           │ Main content                      │               │
│           │ ─────────────────────────────────│               │
│           │ Back                      Next    │               │
└───────────┴──────────────────────────────────┴───────────────┘
```

| Width | Behaviour |
|---|---|
| 1280 px and up | all three regions visible. Main content is capped at about 960 px and centred. |
| 1024 to 1279 px | suggestions become a drawer with a badge count |
| 720 to 1023 px | stepper collapses to a horizontal step bar at the top; suggestions as a drawer |
| below 720 px | building is not supported in v1. Viewing a finished run and the prediction form should work read-only. |

The bottom bar (Back and Next) is pinned to the bottom of the main region. Next is the only filled primary button on a screen.

## Colour

The interactive mockups used a blue accent. The product accent is now the logo violet; mockups are otherwise still valid for structure.

Everything uses named tokens, never raw hex, so light, dark and system modes all work. Dark mode is part of v1.

| Token group | Purpose |
|---|---|
| `surface-0..3` | page, card, panel, popover (0 darkest, 3 lightest in both modes) |
| `text-primary / secondary / muted` | body, supporting, hints. Never use opacity to dim text. |
| `border`, `border-strong` | hairlines (0.5 px) and emphasis |
| `accent` | the single primary colour, a violet taken from the NOESIS logo (see [brand/README.md](../../brand/README.md)): current step, primary button, focus ring, selection |
| `success / warning / danger` | status only |
| chart palette | separate, validated set (below) |

### Fixed meanings

| Meaning | Colour | Also shown with |
|---|---|---|
| Current step, primary action | accent (violet) | arrow icon |
| Done | success (green) | check icon |
| Needs attention, caution | warning (amber) | alert icon |
| Error, blocked by a hard rule | danger (red) | x icon |
| Outdated result | warning (amber) | refresh icon |
| Locked / not yet available | muted grey | lock icon |
| Train partition | accent (violet) | label "Train" |
| Validation partition | success (green) | label "Validation" |
| Test partition | warning (amber) | lock icon and label "Test" |
| Suggestion origin | none (outlined marker) | see parameter markers |

Colour is never the only signal: every status also has an icon and a text label, and partitions carry labels on the bar.

### Chart palette

- Categorical (cluster colours, model lines): up to 8 distinct, colour-blind-safe hues. A ninth series falls back to patterns or direct labels. DBSCAN noise is always neutral grey.
- Sequential (heatmaps, confusion matrix): one hue, light to dark.
- Diverging (correlations, cluster profile z-scores): two hues meeting at a neutral midpoint.
- "Activity" in the node-graph visual is a warm amber ramp (cool/grey = dormant, warm = strong or active), as sketched in the Train mockup.
- The palette is validated for contrast against both light and dark surfaces before use.

## Typography

| Use | Style |
|---|---|
| Interface | system UI sans-serif, two weights (regular and medium) only |
| Column names, code, IDs | monospace |
| Metrics and tables | tabular (equal-width) numerals so columns line up |
| Sizes | 11 / 12 / 13 / 14 / 16 / 20 / 24 px. Nothing below 11 px. |

Sentence case everywhere. No ALL CAPS labels. Long text is capped at about 70 characters per line.

## Spacing and density

- 4 px base unit. Component gaps of 8, 12 and 16 px.
- **Guided** is comfortable: larger rows (about 36 px), explanations visible, one column of controls.
- **Expert** is compact: smaller rows (about 28 px), explanations collapsed, parameters shown in two columns where they fit.
- Switching mode changes density and visible detail only. It never changes what is possible.

## Core components

| Component | Notes |
|---|---|
| **Stepper** | one row per screen with a status icon: done, current, todo, outdated, and locked (the `blocked` state in [wizard-screens.md](wizard-screens.md), drawn with a lock icon). Locked rows explain what unlocks them on hover or focus. |
| **Next-step banner** | one line, accent tint, names the next step and, when relevant, the top suggestion |
| **Suggestion card** | title, one-line evidence with the actual numbers, Apply and Dismiss. Apply opens a before/after preview. At most 3 expanded; the rest under "More". |
| **Parameter field** | label, control, help text. A small marker shows the source: no marker for default, a filled dot for "you set this", an outlined dot for "applied from a suggestion". A toggle turns an optional parameter off (value `null`), greying the field. Reset returns it to the default. |
| **Partition bar** | train / validation / test segments in their fixed colours with row counts, labelled, with the lock on test |
| **Metric tile** | small label above, one rounded number below, optional change indicator |
| **Column table** | name (monospace), type, missing share, distinct count, role chip, mini distribution. Sortable, filterable, keyboard navigable. |
| **Before/after preview** | two small tables or charts side by side with changed cells highlighted |
| **Chart set** | loss curve, score curve, confusion matrix, residual plot, feature importance, silhouette, PCA scatter, dendrogram. Every chart has a one-line "what this tells you", a data-table toggle and a text summary. |
| **Live graph** | the per-algorithm visual (below) |
| **Run card / leaderboard row** | label, model, validation score, key settings, time, device, kept star |
| **Pipeline view drawer** | read-only node graph of the pipeline. Nodes use status colours and show their hash prefix on hover. |
| **Help drawer** | "What is this?", "Why it matters", "Default and why", linked from every field |
| **Toast** | for save and apply confirmations, short and self-dismissing, never for errors |
| **Dialog** | only for irreversible or costly actions: unlocking the test set, discarding a project, re-running after a split change |
| **Error panel** | plain sentence, error code in small type, the one fix, and a "details" fold for the log |
| **Engine badge** | in the top bar: "Browser · CPU" or "Companion · RTX …", with a click to switch or connect |
| **Loading screen** | first run: honest progress for the engine download and start (about 7 s warm), with what is happening in plain words |

## Screen templates

Fourteen screens fall into six layouts, so the app stays consistent.

| Template | Screens | Layout |
|---|---|---|
| **Form** | Project, Data, Target/Columns, Split, Model | title and purpose, a short form, a live preview on the right or below |
| **Review and decide** | Tidy, Missing/outliers, Features | list of cards (one per column or issue), each with a preview and a choice; "Apply all suggested" at the top |
| **Explore** | Explore | grid of charts with a column inspector panel |
| **Run** | Train | live graph, curves, real-rows table, elapsed and metrics, pacing and start/stop |
| **Compare** | Compare and tune | leaderboard on top, overlaid curves and a diff view below |
| **Report** | Explain, Final test, Export | sections with charts and a short text summary each; one primary action at the end |

## The Train screen

Structure shown in the second mockup:

1. **Header row:** algorithm name, a `live` or `replay` pill (so the user always knows whether they are watching real training or a reconstruction), and the pacing control (Live, Slow, Step) beside Start and Stop.
2. **Main visual:** the algorithm's graph. For the neural net: layers of units, connection thickness from weight size, unit brightness from activation, grouped units if a layer is wider than the display cap.
3. **Side stack:** loss curve (and validation score), and a small table of real rows currently entering.
4. **Metric strip:** epoch, train loss, validation score, elapsed time.
5. **Hint line:** one sentence on what the user is seeing; changes with state (running, finished, cancelled).

Per algorithm ([training-events.md](training-events.md)):

| Algorithm family | Visual |
|---|---|
| Neural net | layers and weights as above |
| Tree | tree grows node by node, node shows feature, threshold, sample count; deep levels collapse into a summary node |
| Forest and boosting | small trees appear one by one with a score curve rising |
| Linear, logistic, SVM | scatter of sampled real points with the line or boundary moving; coefficient bars |
| KNN | one query point with lines to its neighbours |
| Clustering | scatter with centroids moving and points changing colour |

Budgets: show at most 64 units per network layer and 500 drawn elements before switching from SVG to canvas rendering. High-volume detail is grouped and labelled, never silently dropped.

## Motion

- Durations: 120 ms for hover and focus, 200 ms for panels, no longer than 300 ms for layout changes.
- Training visuals update at epoch, round or tree boundaries, with a minimum gap set by the pacing control.
- No looping decoration. Nothing moves unless data changed.
- `prefers-reduced-motion`: the graph shows a static snapshot per event and advances with Step or at epoch boundaries without transitions.

## Accessibility

- WCAG AA contrast in light and dark, tested for text, borders, chart palette and focus rings.
- Everything works by keyboard: stepper, sliders, tables, suggestion actions, pacing controls. Visible focus ring on every control.
- Sliders also accept typed numbers.
- Training progress is announced politely once per epoch, not per event.
- Charts have a text summary and a data-table view. The graph visual has a text "what is happening" line.
- Colour is never the only signal (icons, labels, patterns).
- Minimum 32 px hit areas on desktop, 44 px on touch.
- Copy is plain language at a reading level a student can follow, and the Help drawer explains terms.

## Voice

- Sentence case, no terminal punctuation on labels, contractions are fine.
- Verb-first buttons: "Create project", "Apply", "Start training".
- No "please", "successfully", "simply" or exclamation marks on system text.
- Errors: what happened, then what to do. "That file has no header row. Turn on 'First row has names' or add one."
- Suggestions always cite the evidence: "38% of age is missing", not "age has missing values".
- Never "I" in system text. The product speaks without a persona.
- Model names are user-typed. The interface does not invent personality.

## Iconography

One outline icon set at one size family (16 and 20 px). Status icons are fixed: check, arrow-right, alert, x, refresh, lock. No emoji.

## Theming

Light, dark and follow-system, remembered per device. All colours come from tokens. Charts re-read tokens when the mode changes. Print and export of the model card use a light, high-contrast variant.

## Mockup coverage

| Screen | Status |
|---|---|
| Wizard shell + Split | interactive mockup reviewed during design |
| Train | interactive mockup reviewed during design |
| Missing values (Review-and-decide template) | interactive mockup reviewed during design. Shows per-column cards, source markers, Next blocked until every gap is handled. |
| Compare | interactive mockup reviewed during design. Leaderboard ranked by validation only, locked test score, rule-engine note, two-run settings diff, kept stars. |
| Startup and Data | interactive mockup reviewed during design. Honest loading steps, start options, sample datasets, column preview. |
| Explore | interactive mockup reviewed during design. "Train rows only" badge, column list, distribution with plain-words reading, correlation grid, outcome by group, a suggestion chip. |
| Explain (supervised) | interactive mockup reviewed during design. Feature importance, confusion matrix in words, precision/recall/F1, a what-if form. |
| Final test and Export | interactive mockup reviewed during design. One-time confirm, validation against test, unlock with a required reason, export options. |
| Clustering: Columns and "how many groups?" | interactive mockup reviewed during design. Feature picker with a reference column, elbow and silhouette curves with a suggested k. |
| Clustering: Explain the groups | interactive mockup reviewed during design. Scatter, editable group names, distinguishing features, stability and reference scores. |
| Clustering: Stability and sanity check screen | not yet mocked up (its scores appear in the Explain mockup) |
| Dark mode | the mockups follow the host theme, but the dedicated review is still to do |
| Dark mode | tokens defined, not reviewed visually |

## Open items

- Front-end framework and chart library (candidates: SVG with D3 or Observable Plot for charts, canvas for dense scatter plots). Needs a short spike for 1,000-point scatter and 64-unit networks at 30 fps in a single-threaded page while the engine worker runs.
- Final accent shades: validate the derived text and button violet for contrast in light and dark, and replace the raster logo mark with a vector file.
- Visual validation of the categorical palette for colour-blind users and in dark mode.
- Mockups for the remaining templates, especially Review-and-decide and Compare.
- Whether Expert mode gets a keyboard command palette.
- Print layout of the model card.
- Localisation: copy is English only in v1, with strings kept out of the layout code.
