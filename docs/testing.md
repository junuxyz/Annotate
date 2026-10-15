# Test a change

Run commands from the plugin repository root. Use Node.js 22.13 or newer in the
22 series, or Node.js 24 or later. Run `npm ci` if dependencies are missing or the
lockfile changed. Use synthetic notes in `test-vault` and leave assistants
disabled except during explicit integration checks.

## Run automated tests during implementation

`npm test` runs each `tests/*.test.mjs` and `tests/*.test.ts` file separately with
resource and time limits. It stops at the first failed suite. See
[`scripts/test.mjs`](../scripts/test.mjs) for the current limits and overrides.
Do not raise the limits to hide a hang or memory regression.

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
Neither proves behavior in the actual Obsidian app or an installed provider CLI.

## Finish with scoped real-app checks

With Docker running, the default development command is:

```sh
npm run check -- --record
```

[`run-linux.mjs`](../e2e/run-linux.mjs) builds a disposable container, runs lint,
build, and automated tests, then starts actual Obsidian under Xvfb. It does not
mount host credentials or drive the user's native Obsidian window. The runner
copies synthetic fixtures and manages its own app instance. Do not manually copy
builds, create profiles, or write validation entries for this development path.

Choose only the scopes needed for the change. `--modes live,source,reading` selects
Live Preview, Source, and Reading modes. Themes default to light and dark. Use
`--shots` for visible changes and inspect the affected screenshots. The current
default scopes are `smoke,ui,list,polish`; the script defines the authoritative
scope list.

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
scripts, or a new tagged scenario. Do not infer coverage from a scope's name.

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
sentinel read denial. It does not grant production terminal access or copy
credentials into the test vault.
`ANNOTATE_CODEX_EXECUTABLE` and `ANNOTATE_CODEX_MODEL` select the CLI and model.

`check:codex-skills` verifies disabled skill behavior. It is not a supported skill
discovery or execution feature. The `providers` real-app scope uses fixture CLIs;
it must not be reported as a live provider-account test. `claude-live` is a
separate opt-in scope requiring a real Claude login and synthetic context.

The Linux container does not inherit host authentication. Do not mount credentials
to force a live scope to pass. Run a supported live check in the authenticated
host environment and report its environment separately.

## Record what actually ran

The Docker runner saves reports, screenshots, and startup logs under
`e2e/evidence/<timestamp>/`. It appends an available generated report to the
canonical `test-vault/Validation results.md`, using adjacent `../test-vault` when
present and included `test-vault` otherwise. See [Linux setup](../e2e/README-linux.md).

Report the selected scopes, note modes, themes, Obsidian version, platform, and
result. Distinguish synthetic provider fixtures from live account requests. Mark
unavailable required checks as pending. Keep failed evidence when it explains a
fix, then rerun the same affected command after correcting the failure.

Documentation-only changes need source and link review. They do not need a build
or real-app run. Before every commit, including documentation commits, run
`npm run lint:fix` and review any automatic changes.

## Certify a release separately

Development scopes cover the changed behavior. They do not complete the
[full release checklist](../test-vault/E2E%20checklist.md). Before packaging,
publishing, or installing a release into another vault, complete every applicable
release scenario against the same distribution files. Record the version,
SHA-256 hashes, Obsidian version, platform, commands, and real-app evidence.

Passing `release:verify` checks identity and file consistency only. A new build or
behavior change after validation requires rebuilding and revalidating. Follow
the [release procedure](development.md#releases) for staging and exact tag names.
