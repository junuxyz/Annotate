# Testing

Run commands from the repository root. Use synthetic notes in `test-vault`.

## Development checks

```sh
npm run check:fast
```

`npm test` runs each test file separately with time and resource limits. To run
only related suites while retaining those limits:

```sh
npm test -- --files interaction.test.mjs,model.test.ts
```

Use filenames from `tests/`. Unknown or empty selections fail before any test runs.
Node test options such as `--test-name-pattern` can further narrow a selected suite.

## Order checks by cost

During implementation, run related unit tests first, then `npm run check:fast`.
The fast suite runs lint, formatting, build, and every offline unit/integration
suite. It uses synthetic notes, fixture CLIs and recorded streams. It requires
neither Obsidian nor a provider account and makes no real model calls.

The offline suites cover context serialization, streaming, cancellation, recovery,
tool permissions, persistence, sync conflicts, comment interactions and rendering.
They do not prove real Obsidian layout or actual provider login availability.

Use native real-app checks only immediately before a version tag, or when explicitly
diagnosing a failure that offline tests cannot reproduce. Start with the smallest
failing scope or scenario, and only the affected modes and themes. For example:

```sh
npm run check -- --unit-tests offscreen-guards.test.mjs --only smoke --modes live --themes light --record
npm run check -- --unit-tests interaction.test.mjs --only smoke --scenario editing-checks.mjs --modes live --themes light --record
```

When diagnosing an actual UI failure, expand to affected modes, themes and adjacent
scopes after the focused check passes. The scoped runner still lints and builds the current source before launch.
Without `--unit-tests`, it runs all unit tests. Full validation always runs all
unit tests and rejects `--unit-tests`.

Run the full suite once immediately before creating a version tag, on the exact
commit and distribution build to release. Do not use full runs for ordinary PRs,
to debug individual failures, or after each small patch. After a pre-tag failure,
rerun only the affected scope until it is fixed.
Repeat broader passing checks only when subsequent changes could affect them.

The opt-in `npm run check` lints, builds, runs unit tests, and tests real Obsidian in a
private offscreen instance. Default scopes are `smoke,ui,list,polish`, Live
Preview, and both themes. Each run creates its own synthetic vault and profile.
It never drives the user's Obsidian window or sends host keyboard and mouse input.

Choose scopes for the change:

| Change                                | Scope                                                 |
| ------------------------------------- | ----------------------------------------------------- |
| Composer, menus, layout               | Default scopes, `--modes live,source,reading --shots` |
| Shortcuts                             | `shortcuts`, across all modes                         |
| Highlight and text color              | `highlight,palette,formatting,combo`                  |
| Markdown and math                     | `markdown,math`, across all modes                     |
| Copy and quoted replies               | `copy,quote`                                          |
| Resource loading                      | `resources`                                           |
| Consent, tools, approvals, undo       | `access`                                              |
| Assistant question and rendered reply | `providers`                                           |
| External data changes and conflicts   | `storage`                                             |
| Distribution settings                 | `distribution`                                        |
| Development updates and rollback      | `--dev-build --only smoke,sync,auto-update`           |

For example:

```sh
npm run check -- --only access,providers,storage --modes live,source,reading --record
```

Provider scenarios use fixture CLIs without accounts. Test hosts in `tests/host.mjs`
substitute Obsidian APIs for unit tests; the real-app runner uses actual Obsidian.
Documentation-only changes require source and link review.

The `providers` E2E scope sends one question in a fresh thread per provider (ChatGPT, Claude and OpenCode), mode
and theme, then checks that the answer is rendered. It verifies input focus and
readiness before typing and records composer/backend/thread state on failure.
It does not chain local comments, follow-ups, provider switches or recovery in
the UI. Those behaviors belong to the offline interaction and backend suites,
including all three providers' `@comment` completion, no-call behavior and subsequent
plain replies with saved local context. E2E smoke passes do not prove those
individual behaviors by themselves.

The OpenCode transport also has an optional CLI protocol check against a local
synthetic model server. It uses temporary settings and synthetic credentials,
never the host login, and does not call a real model:

```sh
ANNOTATE_OPENCODE_EXECUTABLE=/absolute/path/to/opencode \
node --import tsx --test tests/opencode-protocol.test.mjs
```

This check exercises the installed CLI's effective permissions, session API,
UTF-8 streaming, and pre-execution rejection of every advertised tool, including
redirection-only shell commands. It requires the supported CLI 1.19.2. The ordinary test suite uses a
fixture CLI for cancellation, failures, reconnection, and settings migration.

For the measured free-tier failures and a local permission-boundary probe, see
[OpenCode debugging](opencode-debugging.md).

## Pre-tag E2E validation

```sh
npm run check:release
```

The full run covers all tagged scopes and the core, anchor, editing, math and
menu scenarios in all three modes and both themes. It checks plugin reload,
application reload, persistence and lifecycle. Development-build update checks
run last, followed by restoration of the distribution build.

The runner stops at the first failed suite, prints its scoped rerun command, and
records all remaining suites as `pending` in `summary.json`. Failed-suite reports
are recorded before stopping. Run the printed command while debugging, then run
full validation on the final build before creating the version tag.
Earlier passing reports do not turn unrun scopes into passes.

Use `npm run check:full -- --keep-going` only when explicitly collecting all
failures in one diagnostic run. It still exits unsuccessfully if any suite fails.

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

GitHub Actions runs `check:fast` on Ubuntu for pull requests, pushes to `main`, and manual
dispatch. Only the `check` job is a required PR status check. Feature-branch pushes
do not start a second copy alongside the PR run. A newer push cancels the older
fast run for that PR or branch.

Pre-tag E2E is manual. Dispatch `.github/workflows/e2e.yml` on the branch containing
the exact commit to tag, with its full SHA as the `ref` input. The workflow requires
the dispatch SHA, input SHA and checked-out SHA to match. This also binds the
attestation's source identity to the commit actually validated. For example, after
pushing the final release commit to `main`:

```sh
gh workflow run e2e.yml --ref main -f ref="$(git rev-parse HEAD)"
```

It provisions pinned Obsidian in a disposable macOS VM and runs `check:release`.
After success, it copies the verified distribution without rebuilding, signs a
GitHub build provenance attestation for all three files, and uploads the
`obsidian-e2e-evidence` artifact. The artifact contains `distribution/`,
`validated-build.json`, `validated-commit.txt` and `attestation.jsonl`, alongside
the native reports. Failed runs may upload diagnostic evidence but are not release
approval. Wait for the entire workflow to succeed before creating the version tag.
Publish the downloaded distribution, preserving its hashes. Caches and raw evidence
stay out of Git. See [release verification](development.md#releases).

## Recorded model traces

`tests/traces/codex.json` and `tests/traces/claude.json` contain one successful
synthetic model turn per provider. Their CLI versions and capture dates identify
the observed protocol. The fixture CLIs replay those streaming events through
the production backend adapters in `model-trace.test.mjs`. Existing synthetic
failure cases cover cancellation, crashes, recovery, stale tools and permissions.

Refresh a trace only when the provider protocol changes or the capture is explicitly
requested. Each command makes one short real model request and performs no retry:

```sh
ANNOTATE_CAPTURE_MODEL_TRACE=1 npm run trace:capture -- codex
ANNOTATE_CAPTURE_MODEL_TRACE=1 npm run trace:capture -- claude
npm test -- --files model-trace.test.mjs,codex.test.mjs,assistant.test.mjs
```

Use an authorized existing CLI login and only the built-in synthetic note. The
Codex capture uses a temporary isolated home with a symlink to the selected login,
never a credential copy. Set `ANNOTATE_CODEX_AUTH_FILE`, `ANNOTATE_CODEX_EXECUTABLE`,
`ANNOTATE_CODEX_MODEL`, `ANNOTATE_CLAUDE_EXECUTABLE` or `ANNOTATE_CLAUDE_MODEL` when
needed. Review captures before committing. Only consumed streaming fields are
retained; account records, local paths, provider metadata and runtime IDs are
omitted. Raw temporary wire logs are removed after capture. Trace replay proves
adapter behavior, not current provider availability or real application layout.

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
