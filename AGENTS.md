# Working on Annotate

Annotate is a desktop Obsidian plugin. Read [the documentation index](docs/README.md)
for task-specific context. Start with [architecture](docs/architecture.md) before
changing runtime behavior. For assistant changes, also read
[agent tools and permissions](docs/agent-tools.md). The source and its tests define
current behavior; update these references when behavior changes.

## Repository boundaries

Run commands from this directory, the plugin repository root. In the larger
workspace, `reference/` contains reference repositories, not code to ship.
Use only synthetic notes in the dedicated `test-vault`. Never use a personal
vault for tests or copy credentials into fixtures, logs, or evidence.

## Preserve these decisions

- Local comments work with assistants disabled. `@comment` prevents an immediate
  AI request but can enter a later request's conversation history.
- Assistant note access is limited to explicitly granted folders inside the open
  vault. Obsidian configuration, hidden paths, linked files, and external folders
  remain inaccessible through note tools.
- Terminal access and native Codex skills are unavailable. Do not weaken the
  permission profile or inherit CLI services to make an integration test pass.
- Web search has separate opt-in. MCP services require explicit enablement and
  each external tool call requires approval of its complete arguments.
- Agent writes require durable recovery snapshots. Deletes use Obsidian trash.
  Preserve current editor text and reject edits based on stale content.
- Do not automatically retry an assistant request with an unknown outcome.
  Do not discard conflicting comment or operation-history copies.
- Comment rendering must not automatically fetch media, embed notes, run raw
  HTML, or invoke named code processors. Keep the original Markdown source.
- Distribution files are `main.js`, `manifest.json`, and `styles.css`. Never ship
  `.development/`, test settings, authentication files, or an old release ZIP.

## Validate the change

See [testing](docs/testing.md) for commands and the change-to-check mapping.
Run relevant automated tests during implementation. Finish plugin behavior or
styling changes with scoped checks in a real, isolated Obsidian instance. The
default is `npm run check -- --record`, which requires Docker and uses Linux/Xvfb.
Never drive the user's Obsidian window. Documentation-only changes require a
documentation review, not a build or real-app run.

Development checks do not certify a release. Packaging, publishing, and release
installation require the full [release checklist](test-vault/E2E%20checklist.md).
Report unavailable required checks as pending. Do not substitute unit tests for
real-app validation or broaden test scope without a reason.

## Before committing

Run `npm run lint:fix` before every commit. Review any automatic changes and rerun
affected validation before committing.

Keep runtime changes and unrelated user work separate. Do not use the `codex/`
branch prefix. For parallel work, use separate worktrees and integrate only
reviewed changes. Update the relevant documentation in the same change as the
behavior it describes.
