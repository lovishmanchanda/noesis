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

## Before you commit

```bash
node scripts/check-links.mjs     # every relative link in the Markdown files must resolve
```

More checks (lint, types, tests, contract tests) are added as the packages are built, and run in CI.

## Rules of the design

- Steps that learn from data must run after the split and fit on the training rows only. The pipeline validator rejects anything else.
- Results are tied to hashes of their inputs; do not cache or compare results without them.
- The test set is used once per model. Unlocking it again needs a written reason that is kept in the run history.

## Documentation

Design documents live in `docs/`. Keep the index in `docs/README.md` current, keep headings in sentence case, and prefer short sentences and plain words.
