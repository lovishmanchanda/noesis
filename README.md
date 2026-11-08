<p align="center"><img src="brand/noesis-mark.png" alt="NOESIS" width="120"></p>

# NOESIS

A browser-based, no-code way to do what people usually do in notebooks: load a CSV, clean it, train a model, check it honestly, and export it. Your data stays on your computer. Suggestions for the next step come from explicit, explainable rules, and training is shown live as it happens.

**Status:** the design is written down and the first two build phases are done: the pipeline validator and the Python steps (Phase 0), and the web app with its first five screens (Phase 1: start, project, data, target, tidy and split, with autosave). Exploring, cleaning, modelling and exporting come next; see the [roadmap](docs/planning/roadmap.md).

## What it will do

- A guided wizard from CSV to exported model, with an Expert mode for people who want every parameter.
- Everything runs locally in the browser (Python in WebAssembly). An optional local companion program adds speed, GPU use and larger files.
- Leakage protection built in: steps that learn from data cannot see the test rows, and the test set can be used once per model.
- Live training views that match what the algorithm is really doing (neural net layers, tree growth, ensembles, cluster centres).
- Reproducible: every result is tied to a hash of the data, the settings and the engine version.

## Where things are

| Path | What it holds |
|---|---|
| [docs/](docs/README.md) | Design documents, architecture decisions, research and the roadmap. Start with the index. |
| [experiments/engine-spike/](experiments/engine-spike/README.md) | The experiment that tested running Python in the browser, with results |
| [packages/schema/](packages/schema) | The pipeline JSON Schema |
| `packages/*`, `apps/web` | Product code (being built, see the roadmap) |
| [brand/](brand/README.md) | Logo mark and colour notes |
| [scripts/](scripts) | Repository tooling (link checker) |

## Roadmap

See [docs/planning/roadmap.md](docs/planning/roadmap.md) and the tech stack in [docs/architecture/tech-stack.md](docs/architecture/tech-stack.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE)
