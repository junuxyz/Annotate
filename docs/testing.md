# Test a change

Run commands from the plugin repository root with dependencies installed.
Use synthetic notes in `test-vault`; enable assistants only for integration checks.

## Run automated tests during implementation

`npm test` runs each `tests/*.test.mjs` and `tests/*.test.ts` file separately with
resource and time limits. It stops at the first failed suite. See
[`scripts/test.mjs`](../scripts/test.mjs) for the current limits and overrides.

For a focused suite, use the same TypeScript loader directly:

```sh
node --import tsx --test tests/note-tools.test.mjs
```

This focused command does not use the outer process-tree resource monitor.
`npm test -- --test-name-pattern='pattern'` forwards the name filter to each
discovered suite; it does not select one file.

| Changed area                            | Automated suites                                             |
| --------------------------------------- | ------------------------------------------------------------ |
| Anchors, stored schemas, context        | `model.test.ts`, `interaction.test.mjs`                      |
| Selection, composer, comments, settings | `interaction.test.mjs`                                       |
| Reading-mode mapping                    | `reading.test.mjs`                                           |
| Highlights and text color               | `highlight.test.ts`, `interaction.test.mjs`                  |
| Markdown, math, streamed rendering      | `markdown.test.mjs`, `math.test.mjs`, `interaction.test.mjs` |
| Provider routing and Claude transport   | `assistant.test.mjs`, `interaction.test.mjs`                 |
| Codex sessions and host dispatch        | `codex.test.mjs`, `interaction.test.mjs`                     |
| Note tools, editor text, grouped undo   | `note-tools.test.mjs`, `interaction.test.mjs`                |
| Durable agent history                   | `operation-history.test.mjs`, `note-tools.test.mjs`          |
| Remote MCP                              | `mcp.test.mjs`, `interaction.test.mjs`                       |
| Local development updates               | `sync.test.mjs`                                              |
| Release identity and notices            | `release.test.mjs`                                           |

[`tests/host.mjs`](../tests/host.mjs) substitutes Obsidian APIs for interaction
tests. Provider fixture CLIs exercise transport behavior without real accounts.

## Finish with scoped real-app checks

With Docker running, the default development command is:

```sh
npm run check -- --record
```

[`run-linux.mjs`](../e2e/run-linux.mjs) builds a disposable container, runs lint,
build, and automated tests, then starts actual Obsidian under Xvfb. It does not
mount host credentials or drive the user's native Obsidian window. The runner
copies fixtures and manages its own build, profile, and reports.

`--modes live,source,reading` selects Live Preview, Source, and Reading modes.
Themes default to light and dark. Use
`--shots` to save screenshots for visual review. Default scopes are
`smoke,ui,list,polish`.

| Change                                                    | Additional or selected real-app scope                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| CSS, composer, menus, layout                              | Default scopes with `--shots`; all modes for UI behavior                              |
| Highlight or text color                                   | `highlight`, `palette`, `formatting`, or `combo`, according to the changed behavior   |
| Copy or quoted replies                                    | `copy` or `quote`                                                                     |
| Markdown or math                                          | `markdown` or `math`, across all modes and themes                                     |
| Automatic resource loading or code processors             | `resources`                                                                           |
| Consent, note tools, editor preservation, approvals, undo | `access`                                                                              |
| Provider switching, streaming, cancellation, recovery     | `providers` with synthetic providers; matching live checks when the transport changes |
| External comment-data changes or conflicts                | `storage`                                                                             |
| Development update or rollback                            | `--dev-build --only smoke,sync,auto-update`                                           |
| Distribution-only UI                                      | `distribution`                                                                        |

For example, validate a permissions change with:

```sh
npm run check -- --only access,providers,storage,resources,distribution --modes live,source,reading --record
```

Some behaviors need scenarios outside `dev-check.mjs`. Anchor relocation, rename,
restart, and lifecycle changes must use matching scenarios from the
[E2E checklist](../test-vault/E2E%20checklist.md) and existing `e2e/run-*.mjs`
scripts, or a new tagged scenario.

Older scripts require an isolated instance and its `CDP_PORT`, and run from
`e2e/`. Follow the workspace's hidden-instance instructions for native checks.
Never reuse a debugging port started by another session or expose a test window.

### Verify the installed Codex boundary

```sh
npm run check:codex-tools
```

This opt-in check uses the real signed-in CLI with synthetic content. It verifies
the named filesystem profile, host note-tool execution, unavailable native tools,
and a streamed answer. On macOS it also directly probes an outside synthetic
sentinel read denial. It does not grant production terminal access.
`ANNOTATE_CODEX_EXECUTABLE` and `ANNOTATE_CODEX_MODEL` select the CLI and model.

`check:codex-skills` verifies disabled skill behavior. The `providers` scope uses
fixture CLIs. `claude-live` requires a real Claude login and synthetic context.

The Linux container has no host authentication. Live CLI checks run separately
in an authenticated host environment.

## Record what actually ran

The Docker runner saves reports, screenshots, and startup logs under
`e2e/evidence/<timestamp>/`. It appends an available generated report to the
canonical `test-vault/Validation results.md`, using adjacent `../test-vault` when
present and included `test-vault` otherwise. See [Linux setup](../e2e/README-linux.md).

Report scopes, modes, themes, environment, and results, distinguishing fixture
providers from live accounts. Mark unavailable required checks as pending.

Documentation-only changes need source and link review, not a build or real-app run.

## Certify a release separately

Development scopes do not complete the
[release checklist](../test-vault/E2E%20checklist.md). See the
[release procedure](development.md#releases) for validation, hashes, and staging.
