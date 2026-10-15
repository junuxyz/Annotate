# Storage and limits

[Back to README](../README.md)

Comments are stored in `.obsidian/plugins/annotate/data.json` with the default
Obsidian configuration folder. A custom configuration folder changes this path.
Comments do not change your notes. Back up that file to preserve comments.
Text highlights and text colors are saved as inline HTML in the note itself.
Assistant note tools can change notes after folder consent and keep separate
recovery data.

## Stored data

| Location                               | Contents                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Plugin `data.json`                     | Threads, anchors, messages, provider/session state, display and highlight settings, folder grants, and selected services |
| Plugin `conflict-*.json`               | Local and incoming comment/settings copies preserved during sync conflicts                                               |
| Plugin `agent-history/`                | Immutable snapshots of assistant note operations, including earlier note text                                            |
| `~/.annotate/codex/<vault-path-hash>/` | Isolated Codex runtime state outside the vault, with a link to an available file-based login                             |

Back up the plugin data directory along with notes. Vault sync may copy comment
and recovery data to other devices or services. These files are not encrypted by
Annotate. The isolated Codex runtime is not included in a vault-only backup.

## Anchors and supported content

Highlights follow edits. If the passage disappears or cannot be located uniquely,
the thread stays in the comments list as **Text missing**. Select replacement text
in editing mode and use **Attach to selection** to repair it. Renames made through
Obsidian preserve threads; renames made outside Obsidian cannot be tracked reliably.

- Markdown notes only; no PDFs, Canvas, attachments, or collaborative editing.
- Reading mode skips passages it cannot map reliably to Markdown, including some
  custom rendering and equations. Use editing mode for those selections.
- Synced comment data reloads when there are no unsaved local changes and the
  comment window is closed. Open composers and message edits stay in place. Conflicting
  changes pause saves and preserve copies in `conflict-*.json` files beside
  `data.json`. Reload Annotate to load the synced copy, then recover local comments
  from each recovery file's `local` field. Back up both files before editing them.
  Annotate does not merge simultaneous edits on multiple devices.
- This release requires desktop Obsidian 1.14.4 or newer. Mobile is unavailable.
- Conflict detection checks external data before saving. Obsidian has no atomic
  compare-and-save API, so truly simultaneous writes from separate devices can
  still race. Keep backups and avoid editing the same comment data on two open devices.

## Recover a comment-data conflict

1. Stop editing the same vault on other devices. Back up `data.json`, every
   `conflict-*.json` file, and the affected notes before attempting recovery.
2. Reload Annotate to load the synced copy. Unsaved local changes are preserved
   in the recovery files, not automatically merged into the synced version.
3. Inspect each recovery file's `local` and `external` fields. Recover the needed
   comments from `local` while retaining the current synced comments. Use copies
   of the files for manual comparison.

There is no automatic conflict-merge interface. Do not replace `data.json` with
an entire recovery envelope; the envelope has a different schema. Invalid saved
data blocks ordinary saves instead of silently resetting all comments.

## Recover assistant note operations

Open assistant change history in Annotate settings to review snapshots or undo
an operation. Undo requires current folder access. It refuses to overwrite notes
that changed since the recorded operation, preserving snapshots for comparison.
History can contain a pending operation if writing was interrupted.

If Annotate reports conflicting or damaged assistant history, preserve every
`agent-history` file and compare against backups before reloading. Do not delete
a branch or reset history merely to make edits resume. There is no automatic
history repair or pruning tool in this release. For the record format and limits,
see [operation history](agent-tools.md#operation-history).

Recoverable history protects local content. It cannot retract content already
sent to a model, search engine, or remote MCP service.
