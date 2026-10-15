# Development

[Back to README](../README.md)

Run these commands from the repository root.

Start with [architecture](architecture.md) for source ownership and request flow.
Read [agent tools and permissions](agent-tools.md) before changing assistant
capabilities. [Testing](testing.md) maps changed behavior to checks.

```sh
npm ci
npm run lint
npm run build
npm test
npm run format:check
npm run dev
```

`npm run lint` checks plugin source, tests, and development scripts with ESLint.
TypeScript checks include unhandled promises and exhaustive switches.
`npm run lint:fix` applies available automatic fixes. Prettier handles formatting
separately. CI and `npm run check` run lint before building.
Use Node.js 22.13 or newer in the 22 series, or Node.js 24 or later.

Obsidian and CodeMirror are provided by the host and excluded from the bundle.
The [source map](architecture.md#source-map) includes both provider transports,
permission enforcement, note tools, recovery history, and development updates.

## Fast development updates

Install the development build once into your development vault:

```sh
npm run dev:install -- "/absolute/path/to/your/vault"
```

Enable or reload Annotate once after the first installation. Development settings
show **Development · Automatic local updates enabled**. Later successful builds
apply automatically without restarting Obsidian or visiting settings.

Every `npm run build` produces the distribution files at the repository root and
a separate development snapshot in `.development/`. `npm run build:dev` also makes
the root build a development build. Both publish the development snapshot only
when compilation succeeds. Manual Sync and automatic updates read that snapshot,
so a distribution build cannot remove development controls through Sync.

The development plugin checks the snapshot once per second. Updates wait while
a comment is open, an assistant is responding, or text composition is active.
They also wait briefly after typing. Reload preserves saved settings, comments,
unsent drafts, and the selected Annotate settings page. A failed revision rolls
back and is not automatically retried until a newer build is available. The
command palette's **Annotate: Sync latest local development build** remains
available for a manual retry.

For continuous source, CSS and manifest updates, leave this running:

```sh
npm run dev
```

`npm run dev:vault -- "/absolute/path/to/your/vault"` bootstraps a development
installation once and watches source changes. Later updates use the plugin's own
update mechanism; no external Hot-Reload plugin is needed. Sync never replaces
`data.json`, and development snapshots are excluded from Git and release files.

Validate development updates with:

```sh
npm run check -- --dev-build --only smoke,sync,auto-update --record
```

## Validation

Unit and interaction tests use a substituted Obsidian host. With Docker running,
run real-app development checks in a disposable Linux container with a virtual display:

```sh
npm run check -- --modes live,source,reading --shots --record
```

The runner uses the adjacent `../test-vault/` when present, otherwise the included
`test-vault/`. It creates fresh settings and synthetic comment data when needed.
See [the E2E checklist](../test-vault/E2E%20checklist.md) for full release validation.
See [Linux E2E setup](../e2e/README-linux.md) for prerequisites and evidence output.
See [testing](testing.md) for focused suites, permission checks, provider fixtures,
and live account checks.
Development checks alone do not certify a release. The older `e2e/run-*.mjs`
scripts require the isolated instance's `CDP_PORT` and run from `e2e/`.

## Releases

Update versions without creating a tag first:

```sh
npm version patch --no-git-tag-version
npm run build
npm run release:verify
```

Use `minor` or `major` instead of `patch` when appropriate. The version command
updates `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`.
Review and commit those changes. Distribution `main.js` includes Annotate's MIT
license and the third-party notices. The development snapshot has a separate
build marker and must never be released.

Complete the full [release validation checklist](../test-vault/E2E%20checklist.md)
against the current distribution files before packaging, installing into another
vault, or publishing. Record the three validated SHA-256 hashes in the validation
report. Save a machine-readable copy outside the release directory:

```sh
node scripts/release.mjs > /path/to/validated-build.json
```

This command checks artifact identity and prints hashes. It does not run or
certify release validation. After validation, check the exact tag and compare
the current files with the saved hash record:

```sh
npm run release:verify -- --tag 0.3.1 --hashes /path/to/validated-build.json
```

Replace `0.3.1` with the manifest version. Obsidian tags use that exact version,
without a `v` prefix. The verifier rejects inconsistent versions, stale manifests
or styles, development bundles, missing notices, and changed validated files.
Any change after validation requires rebuilding and repeating affected validation.

Create any package from a fresh empty staging directory containing only the
verified `main.js`, `manifest.json`, and `styles.css`. Never reuse an old `release/`
directory or ZIP. Check the staged files against the saved hashes before uploading
those three files to the matching tag. Local `release/` and ZIP files are ignored
by Git and may contain obsolete plugin identities or old builds.

## Assistant implementation

The implementation borrows OpenCode's separation of provider identity,
authentication and transport. One `AssistantBackend` interface covers connection,
session, streaming, cancellation and cleanup. `CodexBackend` handles Codex RPC,
and `ClaudeBackend` handles the official CLI. A small registry
provides names, mentions and defaults. OpenCode is reference material only.
There is no provider marketplace, model catalog service or new SDK dependency.

The existing `codex` storage fields remain compatible with older comment data.
New settings select the assistant; new messages and session records store their
provider identity. Missing provider fields mean ChatGPT.

Sources reviewed:
[OpenCode provider definitions](https://github.com/anomalyco/opencode/blob/bcf23b6775c79a429b1511b255d6d88ab0248d4a/packages/ai/src/provider.ts),
[Claude programmatic CLI](https://code.claude.com/docs/en/headless).

[Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/)
includes Google AI Pro and Ultra accounts, but its headless setup documentation
recommends API-key or Vertex authentication. Gemini is deferred until a cached
Google subscription login can be verified in an isolated headless request.
It is not offered in settings yet.

Development validation uses synthetic notes in the hidden `test-vault` instance.
The `providers` scope covers UI, Claude's synthetic CLI, and Codex regression checks. `claude-live`
sends a synthetic note through the Claude subscription login.
Full release validation is separate.

### Live Codex tool verification

Run `npm run check:codex-tools` to verify the signed-in Codex CLI with a synthetic
note. The check verifies the restrictive named filesystem profile, execution of
an Annotate host note tool, unavailable native tools, and the streamed answer. Production terminal access
remains disabled. It never copies credentials into test-vault.
On macOS it also directly verifies denial of an outside synthetic sentinel read.
`ANNOTATE_CODEX_EXECUTABLE` and `ANNOTATE_CODEX_MODEL` override automatic CLI
selection and the account's model for this check. On macOS, automatic discovery
and saved standard Homebrew or user-local Codex paths prefer the CLI shipped
with ChatGPT/Codex when installed. Custom executable paths remain unchanged.

`npm run check:codex-skills` checks that native skills stay unavailable. See
[testing](testing.md#verify-the-installed-codex-boundary) for environment limits.
