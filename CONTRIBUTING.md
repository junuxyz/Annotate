# Contributing

Describe the problem, resulting behavior, and validation in your pull request.
Report vulnerabilities through [SECURITY.md](SECURITY.md).

Use [development](docs/development.md) for setup and local updates,
[architecture](docs/architecture.md) for source ownership, and
[testing](docs/testing.md) to select checks. Agents start with [AGENTS.md](AGENTS.md).

Run `npm run lint:fix` before committing and review its changes. Update docs when
changing tool contracts, saved-data compatibility, or user-visible behavior.

Tests use synthetic notes in `test-vault`. Live assistant checks require your own
account and send synthetic context to the provider. Keep credentials and personal
notes out of fixtures and evidence.

Permission enforcement and recovery behavior are described in
[agent tools and permissions](docs/agent-tools.md).
