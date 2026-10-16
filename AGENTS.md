# Annotate

Desktop Obsidian plugin. Start with the [documentation index](docs/README.md).

## Validation

Use synthetic notes in `test-vault`. Normal development and PR validation use
`npm run check:fast`: lint, formatting, build, and offline unit/integration tests.
Do not launch Obsidian or call real models as part of ordinary validation.
See [testing](docs/testing.md). Never drive the user's Obsidian window.
Documentation-only changes need source, formatting and link review.

Validate in increasing cost order:

1. Run static checks and relevant unit tests first. Use
   `npm test -- --files <test-file.mjs,...>` to retain the runner's resource limits.
2. Reproduce failures with the relevant offline unit/integration suite. Assistant
   tests use fixture CLIs and recorded synthetic model streams, never a real login.
3. Run `npm run check:fast` after the focused checks pass. Keep cancellation,
   recovery, permissions, persistence and rendering covered by offline tests.
4. Immediately before creating a version tag, run `npm run check:release` on the
   exact release commit/build, or dispatch Pre-tag E2E for that commit. This is
   the full native offscreen gate. Do not run it on ordinary PRs or after small patches.

If a provider protocol changes, explicitly capture one short synthetic model turn
with `trace:capture`, review the sanitized fixture, and test by replaying it.
Do not repeatedly call models to debug or validate unrelated changes. Live account
checks remain explicit opt-ins and must not run inside the fast or release suites.
Use scoped real-app checks only when explicitly diagnosing an issue that offline
tests cannot reproduce, or investigating a pre-tag E2E failure. Review screenshots
for visual checks and record precisely what was and was not tested.

After a full-run failure, use the printed scoped rerun command to investigate.
Do not rerun already-passing scopes until a new change could affect them. The
default full run stops at the first failure and marks unrun scopes pending.
`--keep-going` is for an explicitly requested diagnostic inventory only.
A final full pass is still required before the version tag/release;
focused passes and older reports do not replace validation of the final build.

## Before committing

Run `npm run lint:fix` and review its changes.
