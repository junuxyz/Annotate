# Agent tools and permissions

Tools exposed to assistants inside Annotate. For account setup and context
sharing, see [Assistant replies](assistants.md).

## Capability matrix

| Capability                                                   | ChatGPT                                      | Claude                        |
| ------------------------------------------------------------ | -------------------------------------------- | ----------------------------- |
| Supplied current note and conversation                       | Requires context-folder grant                | Requires context-folder grant |
| Search, read, create, edit, and trash notes                  | Annotate host tools in granted vault folders | Unavailable                   |
| Request one additional vault folder                          | Explicit folder approval                     | No note tool                  |
| Web search                                                   | Separate opt-in, disabled by default         | Unavailable                   |
| Remote MCP                                                   | Selected services, approval for each call    | Unavailable                   |
| Terminal, native file tools, native skills, external folders | Unavailable                                  | Unavailable                   |

The note-folder boundary is inside the open vault. `.` explicitly grants visible
Markdown notes across the vault. It never grants hidden folders or the vault's
configuration directory.

## Host tool contracts

`NOTE_TOOL_DEFINITIONS` and the strict schemas in
[`note-tools.ts`](../src/note-tools.ts) define the callable note tools.

| Tool                  | Arguments                            | Result or behavior                                                                       |
| --------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `search_notes`        | `query`                              | Case-insensitive content search, returns at most 50 matching paths within current grants |
| `read_note`           | `path`                               | Returns path and current content, including unflushed editor text                        |
| `create_note`         | `path`, `content`                    | Creates an absent Markdown note in an existing folder, with a recovery snapshot          |
| `edit_note`           | `path`, `content`, `expectedContent` | Replaces content only if current text exactly matches `expectedContent`                  |
| `delete_note`         | `path`, `expectedContent`            | Uses `FileManager.trashFile` after the exact-content check                               |
| `request_note_folder` | `folder`                             | Requests approval for one existing vault folder; denial leaves access unchanged          |
| `list_mcp_tools`      | Empty object                         | Discovers tools only from enabled services, without supplying note content               |
| `call_mcp_tool`       | `name`, `arguments`                  | Resolves an enabled remote tool and requests approval of its complete arguments          |

There is no rename, directory-creation, arbitrary filesystem, or terminal tool.
Note content is limited to 1,000,000 JavaScript string code units per value.
Queries are limited to 500 code units.

### Path checks

`normalizeNoteFolder` accepts literal vault-relative paths. It rejects absolute
or ambiguous paths, hidden segments, traversal, backslashes, colons, percent
encoding, control characters, trailing dots or spaces, and the configured
Obsidian directory. `assertAllowed` also requires a Markdown extension and a
current folder grant.

Physical metadata checks require a local `FileSystemAdapter`. Each path segment
is checked with `lstat`; symlinks and multiply linked files are rejected. Unknown
adapters fail closed. Note content reads and mutations use Obsidian APIs. These
checks do not sandbox other Obsidian plugins or defend against arbitrary code
already running in the host and replacing filesystem entries concurrently.

### Writes and cancellation

`AgentAccess` binds host calls to a provider thread and turn. The operation ID is
`threadId:turnId`, so edits in one turn share a history operation. `NoteTools`
serializes calls and rechecks access and cancellation around asynchronous work.

Writes persist a pending snapshot before mutation, then record completion.
Open notes use the current editor and `replaceRange`. Closed notes use
`Vault.process` with an exact-content check. The active editor takes precedence
when multiple Markdown views exist.

Cancellation denies pending approvals and aborts host calls. An already dispatched
Obsidian create or OS trash operation cannot be rolled back by an abort signal.

## Operation history

`NoteOperation` records `id`, `createdAt`, `status`, and ordered changes. A change
stores `path`, `before`, and `after`. A null value represents an absent note.
Statuses are `pending`, `complete`, and `undone`.

`OperationHistoryStore` writes under the plugin's `agent-history/` directory.
Each immutable JSON snapshot has `format: 1`, a `parent` filename or null, and
only the changed operation records. Loading reconstructs one complete ancestry
chain. Multiple roots, branches, missing parents, cycles, invalid records, or
concurrent changes block further history writes and preserve the files.

History has limits of 1,000 operations and 20,000,000 serialized characters.
Reaching a limit blocks further agent edits; it does not silently prune recovery
data. Snapshots include earlier note contents and may be copied by vault sync
or backups.

Undo checks current grants and preflights every affected note against the saved
state before restoring the operation. Intervening edits stop undo and preserve
the snapshot. Restoration across several notes is not an atomic transaction;
later I/O failures can leave a partially restored operation.

## Codex isolation

`AgentAccess.codexHome` selects `~/.annotate/codex/<vault-path-hash>` outside the
vault. `CodexBackend` uses that separate `CODEX_HOME` and an empty temporary working
directory. It shares an existing file-based `auth.json` through a symlink, not a
copy of personal settings. Keychain-only logins are not automatically shared and
fail to connect.

The child receives an environment allowlist, excluding inherited API keys and
transport overrides. `codexConfig` disables native shell and execution tools,
skills, hooks, plugins, apps, connectors, browser tools, and other bypass routes.
MCP configuration starts empty. Web search is enabled only from Annotate's setting.

The named `annotate` permission profile denies the filesystem root, allows reads
of the empty scratch directory, and disables command networking. Startup checks
the effective configuration and permission-profile support. Session responses
must confirm the active profile. An unsupported CLI fails before note context
is sent. Unlike this profile, `workspace-write` does not restrict outside reads.

Native command, file, and permission callbacks are denied. Host dispatch checks
the registered tool, namespace, active turn, and call ID; duplicate or stale calls
are rejected. Abort controllers cover stop, disconnect, completion, and turn-start
failure. Unknown outcomes do not trigger automatic resubmission.

## Remote services

`mcpServiceSchema` defines an ID, display name, HTTPS URL, and enabled flag.
Settings allow at most 20 services. Endpoint URLs cannot contain username,
password, or fragment values. This release supplies no OAuth, inherited cookies,
credential headers, or local stdio servers. Public here means that the endpoint
requires no authentication; the HTTPS validator does not establish that a host
belongs to the public internet.

`McpServices` uses dedicated Node HTTPS transport with certificate validation and
rejects redirects. It accepts the implemented JSON and SSE response forms and
negotiates supported protocol versions. Responses and tool lists are bounded.
Initialization and discovery contact the enabled endpoint before any tool-call
approval, but do not include note context.

Each actual `tools/call` requires approval showing the service endpoint, tool,
and immutable arguments. Cancellation or changed service settings invalidate a
pending call. No automatic retry repeats an external mutation. Web-search opt-in
is a separate channel and does not require an MCP approval per query.

## Claude boundary

`ClaudeBackend` uses safe mode, empty setting sources, strict empty MCP config,
an empty tool set, and no persistent CLI session. It strips inherited API-key
credentials and supplies saved history as text. Organization-managed hooks or
policies can still receive request content.
