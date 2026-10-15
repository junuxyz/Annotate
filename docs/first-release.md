# First-release changes and readiness

This is a record of the first-release hardening merged on 2026-10-15 at
`fefbfa4`. The manifest version at that merge is `0.3.1`. This record is not a
claim that a tag was published or that later builds have passed validation.

## Changes included

| Area                   | Result                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Note autonomy          | ChatGPT host tools can search, read, create, edit, and trash Markdown notes inside explicitly granted vault folders. External folders remain unavailable.                                                                                   |
| Permission enforcement | Codex uses an isolated configuration and restrictive named filesystem profile. Terminal, native file tools, native skills, inherited plugins, and inherited services are unavailable. Incompatible CLIs fail before receiving note context. |
| Context disclosure     | Folder consent and the composer identify current-note sharing and earlier conversation context. Legacy settings require renewed consent. Local comments enter later requests correctly.                                                     |
| External actions       | Web search has separate opt-in. Selected unauthenticated HTTPS MCP services require approval for every actual tool call. Discovery contacts only enabled endpoints.                                                                         |
| Recovery               | Agent writes have durable snapshots and grouped undo. Edits preserve unflushed editor text and reject stale content. Deletes use trash. Conflicting operation-history branches stop further edits.                                          |
| Comment-data sync      | Clean incoming changes reload safely. Unsaved editors stay open. Conflicts preserve local and external copies, and interrupted responses do not resend.                                                                                     |
| Rendering              | Automatic media, note embeds, raw HTML, and named code processors are inert in comments. Raw source, ordinary formatting, links, and math remain available.                                                                                 |
| Distribution           | Desktop-only support, minimum Obsidian 1.14.4, embedded license notices, artifact identity verification, pinned CI actions, dependency review, and security/contribution documentation                                                      |
| Usage context          | Text color has a command-palette action with no default shortcut. Highlight uses Cmd/Ctrl+Shift+H; comment uses Cmd/Ctrl+Shift+M.                                                                                                           |

See [architecture](architecture.md) for implementation ownership and
[agent tools](agent-tools.md) for contracts, enforcement, and limitations.
Commit history retains the individual worktree changes and the earlier sync fix.

## Development evidence at the merge

Lint, formatting, build, automated tests, and artifact verification passed. The
final hidden real-Obsidian runs used Obsidian 1.14.4 on Linux/Xvfb:

| Scope                                                                                                         | Result              |
| ------------------------------------------------------------------------------------------------------------- | ------------------- |
| Access, smoke, UI, list, distribution; all note modes and both themes                                         | 29/29 checks passed |
| Storage, synthetic providers, Markdown, math, resources, access, distribution; all note modes and both themes | 56/56 checks passed |
| Live signed-in Codex boundary and host-tool check                                                             | Passed              |

The evidence directories are
`e2e/evidence/2026-10-15T09-43-33.158Z/` and
`e2e/evidence/2026-10-15T09-49-04.226Z/` in the integration checkout used for those
runs. Evidence is local and ignored by Git; a fresh clone will not contain it.
Generated reports also record the tested file hashes. Do not recreate reports or
infer the same results for a newer build. One macOS-specific automated test was
skipped in the Linux environment. Windows and a live Claude subscription were
not validated in this work.

## Remaining release gates

The repository was not pushed, tagged, published, or made public by this work.
The complete release checklist remains pending. Follow
[the release procedure](development.md#releases) and record all applicable
[release scenarios](../test-vault/E2E%20checklist.md) against the final files.

Repository-hosting settings, including visibility and private vulnerability
reporting, require separate review before public launch. Check that security
reporting instructions match the actual hosting configuration.

Do not upload a preexisting ignored `release/` directory or ZIP. Such files can
contain an obsolete plugin identity or build. Stage only the three verified
distribution files in a fresh directory. Development snapshots and local test
settings are excluded from release assets.
