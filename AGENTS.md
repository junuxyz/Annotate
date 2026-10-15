# Working on Annotate

Annotate is a desktop Obsidian plugin.

- [Documentation index](docs/README.md)
- [Architecture and source map](docs/architecture.md)
- [Agent tools and permissions](docs/agent-tools.md)
- [Tests and validation scopes](docs/testing.md)

## Repository boundaries

Run commands from this directory. `reference/` in the larger workspace contains
reference repositories. Use synthetic notes in `test-vault` for testing.

## Assistant boundaries

Note tools operate only in granted vault folders. Terminal and native Codex
skills are unavailable. Web search requires opt-in; MCP calls require approval.
See [the permission reference](docs/agent-tools.md) for enforcement and recovery.

## Validate the change

For plugin changes, run relevant automated tests and scoped real-app checks.
`npm run check -- --record` uses Docker and Linux/Xvfb. Never drive the user's
Obsidian window. Documentation-only changes need no build or real-app run.

Before packaging, publishing, or installing a release, complete the
[release checklist](test-vault/E2E%20checklist.md).

## Before committing

Run `npm run lint:fix` before every commit. Review any automatic changes and rerun
affected validation before committing.

Do not use the `codex/` branch prefix.
