# Annotate

Desktop Obsidian plugin. Start with the [documentation index](docs/README.md).

## Validation

Use synthetic notes in `test-vault`. For plugin changes, run relevant automated
tests and scoped real-app checks with `npm run check -- --record`.
See [testing](docs/testing.md) for scopes and setup. Never drive the user's
Obsidian window. Documentation-only changes need no build or real-app run.

Validate in increasing cost order:

1. Run static checks and relevant unit tests first. Use
   `npm test -- --files <test-file.mjs,...>` to retain the runner's resource limits.
2. Reproduce and fix the smallest failing real-app scope or scenario. Select only
   the affected modes and themes. Use `--unit-tests <test-file.mjs,...>` on scoped
   `npm run check` runs when a relevant unit-test subset is sufficient.
3. Expand to affected modes, themes and adjacent scopes after the focused check
   passes. Review screenshots for visual checks.
4. Run full offline validation once changes have settled, at the final integration
   or release gate. Do not run it after every small patch or use it as the debug loop.

After a full-run failure, use the printed scoped rerun command to investigate.
Do not rerun already-passing scopes until a new change could affect them. The
default full run stops at the first failure and marks unrun scopes pending.
`--keep-going` is for an explicitly requested diagnostic inventory only.
A final full pass is still required where the release checklist requires it;
focused passes and older reports do not replace validation of the final build.

## Before committing

Run `npm run lint:fix` and review its changes.
