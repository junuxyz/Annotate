# Release readiness

The first-release hardening was merged at `fefbfa4` on 2026-10-15, targeting
version `0.3.1`. Current behavior is described in [architecture](architecture.md)
and [agent tools](agent-tools.md).

Development validation at that merge passed two real-Obsidian runs, 29/29 and
56/56 checks on Obsidian 1.14.4 under Linux/Xvfb, plus a live Codex boundary check.
The reports are in the integration checkout's ignored `e2e/evidence/` directories
`2026-10-15T09-43-33.158Z` and `2026-10-15T09-49-04.226Z`. They cover that build
only. Windows and a live Claude subscription were not validated.

Full release validation remained pending at that merge. Use the
[release procedure](development.md#releases) and
[checklist](../test-vault/E2E%20checklist.md) for a new release. Repository visibility
and private vulnerability reporting were not changed by the hardening work.
