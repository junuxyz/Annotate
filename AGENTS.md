# Annotate

Desktop Obsidian plugin. Start with the [documentation index](docs/README.md).

## Validation

Use synthetic notes in `test-vault`. For plugin changes, run relevant automated
tests and scoped real-app checks with `npm run check -- --record`.
See [testing](docs/testing.md) for scopes and setup. Never drive the user's
Obsidian window. Documentation-only changes need no build or real-app run.

## Before committing

Run `npm run lint:fix` and review its changes.
