# Contributing

Use a feature branch and describe the problem, expected behavior, and validation
in your pull request. For security reports, follow [SECURITY.md](SECURITY.md).

Agents start with [AGENTS.md](AGENTS.md). Use the [documentation map](docs/README.md)
to find the relevant reference. Read [architecture](docs/architecture.md) before
changing a subsystem and [agent tools](docs/agent-tools.md) for permission changes.

## Set up

Use Node.js 22.13 or newer in the 22 series, or Node.js 24 or later.
Run commands from the plugin repository root:

```sh
npm ci
npm run lint
npm run build
npm test
npm run format:check
```

Before every commit, run `npm run lint:fix`, review its changes, and rerun affected
validation. Prettier handles formatting separately. See
[development](docs/development.md) for build, local installation, and real-app
validation instructions.
The [testing guide](docs/testing.md) maps source changes to automated suites and
real-app scopes. Update the relevant docs alongside behavior changes, especially
tool contracts, saved-data compatibility, defaults, and visible shortcuts.

## Test data and assistant access

Use the dedicated `test-vault` and synthetic notes. Do not copy personal notes,
credentials, provider configuration, or private logs into fixtures, screenshots,
issues, or commits. Keep assistants disabled except during explicit integration
checks. Those checks may send their synthetic context to the selected provider
and require your own authenticated account.

Unit tests use a substituted Obsidian host. Completed plugin changes also need
scoped checks in a real, isolated Obsidian instance. Record checks that could not
run as pending. Full release validation is required before packaging, publishing,
or installing a release into another vault. See
[the E2E checklist](test-vault/E2E%20checklist.md).

## Permission changes

Treat paths, note text, assistant output, and tool arguments as untrusted input.
Check allowed folders for every note operation. Preserve recoverable history for
agent writes and use trash for deletion. Do not broaden access to fix a test or
silently inherit services from a user's CLI configuration.

Terminal execution is unavailable in the first release. Adding terminal access,
external folders, network channels, or connected services requires a defined
boundary, explicit user controls, and tests that prove denied access stays denied.
