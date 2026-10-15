# Storage and limits

[Back to README](../README.md)

Comments are stored in `.obsidian/plugins/annotate/data.json`.
Comments do not change your notes. Back up that file to preserve comments.
Text highlights and text colors are saved as inline HTML in the note itself.

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
