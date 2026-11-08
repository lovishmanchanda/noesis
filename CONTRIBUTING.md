# Contributing

## Workflow

- Small, focused changes (a doc fix, a single rule, one component) are committed straight to `main`.
- Larger pieces of work (a whole build phase, a new package) go on a branch named `phase-<n>-<short-name>` or `feature/<short-name>` and are merged through a pull request.
- Each pull request describes the scope, how it was tested, and anything left undone.

## Commit messages

Short imperative subject with a type prefix: `feat`, `fix`, `docs`, `chore`, `test`, `ci`, `refactor`.

```
docs: describe the clustering variant
feat(schema): add reference column role
fix(nodes): pass class labels by keyword to partial_fit
```

Add a body only when it explains something the diff cannot.

## Setup

Node 20.11 or newer and a conda environment for the Python parts. The JavaScript tooling uses pnpm 12. If pnpm is not installed on your machine, install it inside the repository so nothing leaves the folder:

```bash
mkdir -p .local/tools && npm install --prefix .local/tools pnpm
.local/tools/node_modules/.bin/pnpm install
```

The pnpm store is `.pnpm-store` (set in `pnpm-workspace.yaml`). Both folders are git-ignored.

## Before you commit

```bash
pnpm check          # links, types, lint, format and the TypeScript tests
python -m pytest packages/nodes-py   # the Python step tests (use an environment with packages/nodes-py/requirements-dev.txt)
pnpm contract       # the same pipelines natively and in Pyodide (set NOESIS_PYTHON to your Python)
pnpm fixtures       # rewrite the golden pipelines after changing fixtures/pipelines/generate.mjs
pnpm --filter @noesis/schema generate   # regenerate types after changing the JSON Schema
```

CI runs the same checks.

## After every phase

Everything the project produces stays inside the repository folder. After each phase is merged:

```bash
pnpm clean          # lists generated and scratch files that would be removed
pnpm clean:yes      # removes them (caches, logs, archives, scratch files, the experiment's generated data)
pnpm clean:deep     # lists everything above plus the installed tools and dependencies
```

`pnpm clean` keeps the working setup (`node_modules`, `.pnpm-store`, and the tools and Python environment in `.local`) so the checks keep running. `node scripts/clean.mjs --deep --yes` removes those too, and the setup steps above recreate them.

Then check that nothing untracked is left behind:

```bash
git status --ignored --short
```

Tools outside the folder keep their own caches (npm's and conda's package caches, for example). The project does not write anywhere else: the pnpm store is set in `pnpm-workspace.yaml` and the Python environment is created with `conda create -p .local/env`.

## Rules of the design

- Steps that learn from data must run after the split and fit on the training rows only. The pipeline validator rejects anything else.
- Results are tied to hashes of their inputs; do not cache or compare results without them.
- The test set is used once per model. Unlocking it again needs a written reason that is kept in the run history.

## Documentation

Design documents live in `docs/`. Keep the index in `docs/README.md` current, keep headings in sentence case, and prefer short sentences and plain words.
