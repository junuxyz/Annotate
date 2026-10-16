# Testing

Run commands from the repository root. Use synthetic notes in `test-vault`.

## Development checks

```sh
npm test
npm run check -- --record
```

`npm test` runs each test file separately with time and resource limits. To run a
single suite, use `node --import tsx --test tests/interaction.test.mjs`.
This direct command does not use the outer resource monitor in `scripts/test.mjs`.

`npm run check` lints, builds, runs unit tests, and tests real Obsidian in a
private offscreen instance. Default scopes are `smoke,ui,list,polish`, Live
Preview, and both themes. Each run creates its own synthetic vault and profile.
It never drives the user's Obsidian window or sends host keyboard and mouse input.

Choose scopes for the change:

| Change                                  | Scope                                                 |
| --------------------------------------- | ----------------------------------------------------- |
| Composer, menus, layout                 | Default scopes, `--modes live,source,reading --shots` |
| Shortcuts                               | `shortcuts`, across all modes                         |
| Highlight and text color                | `highlight,palette,formatting,combo`                  |
| Markdown and math                       | `markdown,math`, across all modes                     |
| Copy and quoted replies                 | `copy,quote`                                          |
| Resource loading                        | `resources`                                           |
| Consent, tools, approvals, undo         | `access`                                              |
| Provider switching, streaming, recovery | `providers`                                           |
| External data changes and conflicts     | `storage`                                             |
| Distribution settings                   | `distribution`                                        |
| Development updates and rollback        | `--dev-build --only smoke,sync,auto-update`           |

For example:

```sh
npm run check -- --only access,providers,storage --modes live,source,reading --record
```

Provider scenarios use fixture CLIs without accounts. Test hosts in `tests/host.mjs`
substitute Obsidian APIs for unit tests; the real-app runner uses actual Obsidian.
Documentation-only changes require source and link review.

## Full offline validation

```sh
npm run check:full -- --shots
```

The full run covers all tagged scopes and the core, anchor, editing, math and
menu scenarios in all three modes and both themes. It checks plugin reload,
application reload, persistence and lifecycle. Development-build update checks
run last, followed by restoration of the distribution build.

The runner saves hashes, results, startup logs, guard probes, isolation
measurements and requested screenshots under `e2e/evidence/<timestamp>/`.
`--record` appends generated reports to `test-vault/Validation results.md`, using
the adjacent `../test-vault` when present, otherwise the included vault.
Inspect screenshots for visual changes. Report scopes, modes, themes and pending
checks. Do not treat a build or unit-test pass as real-app validation.

## Runtime and isolation

Requires macOS Apple silicon, Node.js and Xcode command line tools.

```sh
npm run check:compat
```

This read-only check verifies installed versions and archive hashes against
`e2e/macos/compatibility.json`. A mismatch prevents launch. The offscreen runner
patches a disposable app copy, blocks activation and native prompts, and starts
an independent visibility observer before the app. Any visible or active test
window fails the run. See [runtime details](../e2e/macos/README.md) for debugging
and the compatibility review procedure.

GitHub Actions runs the same suite on a disposable macOS VM with pinned public
application files. Caches and raw evidence stay out of Git.

## Authenticated integration and releases

The offscreen profile contains no host authentication. Run
`npm run check:codex-tools` and `npm run check:codex-skills` separately with an
explicitly authenticated test CLI and synthetic context. `claude-live` requires
an authenticated Claude test environment. Native permission grants, login and
OS shortcut registration success need separate validation because the offscreen
runner denies those operations.

Authenticated real-app checks are explicit opt-ins:

```sh
ANNOTATE_LIVE_ACCOUNT=1 \
ANNOTATE_CODEX_EXECUTABLE=/path/to/codex \
ANNOTATE_CODEX_AUTH_FILE=/path/to/test-account/auth.json \
ANNOTATE_CLAUDE_EXECUTABLE=/path/to/authenticated-claude \
npm run check -- --only codex-live,claude-live --modes live --themes light --record --shots
```

Use an explicitly authorized test account. A personal account requires a specific
exception from the user. The Codex check links the selected login file without
copying it and keeps the app's home and CLI configuration isolated. The Claude
executable must select its authorized authentication environment explicitly;
the runner's private home contains no provider login. Preserve that CLI's original
`HOME`, `USER`, and `CLAUDE_CONFIG_DIR` selection rather than assigning a different
configuration directory, which can select a different Keychain credential.
Both checks use synthetic
notes, keep web search and MCP disabled, and verify answers, streamed-response
cancellation, reload persistence, and recovery on an explicit new request.
They do not exercise new login or OS permission grants.

Before release, complete the [E2E checklist](../test-vault/E2E%20checklist.md)
and [release procedure](development.md#releases) against the exact distribution
files. Full offline validation does not certify authenticated integrations.
