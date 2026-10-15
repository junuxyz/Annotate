# Storage and limits

[Back to README](../README.md)

Comments live in the plugin data directory, normally
`.obsidian/plugins/annotate/`. A custom Obsidian configuration folder changes this
path. Comments leave note text unchanged; highlights and text colors use inline
HTML. Assistant note tools can change notes after folder consent.

## Stored data

| Location                               | Contents                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Plugin `data.json`                     | Threads, anchors, messages, provider/session state, display and highlight settings, folder grants, and selected services |
| Plugin `conflict-*.json`               | Local and incoming comment/settings copies preserved during sync conflicts                                               |
| Plugin `agent-history/`                | Immutable snapshots of assistant note operations, including earlier note text                                            |
| `~/.annotate/codex/<vault-path-hash>/` | Isolated Codex runtime state outside the vault, with a link to an available file-based login                             |

A complete vault backup includes notes and the plugin data directory. Vault sync
may copy recovery data too. Annotate does not encrypt these files. The isolated
Codex runtime is outside vault-only backups.

## Anchors and supported content

Highlights follow edits. If the passage disappears or cannot be located uniquely,
the thread stays in the comments list as **Text missing**. Select replacement text
in editing mode and use **Attach to selection** to repair it. Renames made through
Obsidian preserve threads; renames made outside Obsidian cannot be tracked reliably.

- Markdown notes only; no PDFs, Canvas, attachments, or collaborative editing.
- Reading mode skips passages it cannot map reliably to Markdown, including some
  custom rendering and equations. Use editing mode for those selections.
- This release requires desktop Obsidian 1.14.4 or newer. Mobile is unavailable.

## Comment-data sync

Clean incoming data reloads when the comment window closes. Open composers and
message edits stay in place. Conflicting changes pause saves and preserve copies
in `conflict-*.json` beside `data.json`; Annotate does not merge them automatically.
Obsidian has no atomic compare-and-save API, so simultaneous device writes can
still race.

## Recover a comment-data conflict

1. Stop editing the same vault on other devices. Back up `data.json`, every
   `conflict-*.json` file, and the affected notes before attempting recovery.
2. Reload Annotate to load the synced copy. Unsaved local changes are preserved
   in the recovery files, not automatically merged into the synced version.
3. Inspect each recovery file's `local` and `external` fields. Recover the needed
   comments from `local` while retaining the current synced comments.

Recovery files wrap `local` and `external` data and cannot replace `data.json`
directly. Invalid saved data blocks ordinary saves.

## Recover assistant note operations

Open assistant change history in Annotate settings to review snapshots or undo
an operation. Undo requires current folder access. It refuses to overwrite notes
that changed since the recorded operation, preserving snapshots for comparison.
History can contain a pending operation if writing was interrupted.

If Annotate reports conflicting or damaged assistant history, preserve every
`agent-history` file and compare against backups before reloading. Automatic
history repair and pruning are unavailable. For the record format and limits,
see [operation history](agent-tools.md#operation-history).

Recoverable history protects local content. It cannot retract content already
sent to a model, search engine, or remote MCP service.
