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
- There is no merge protocol for simultaneous edits on multiple devices.
- Mobile is permitted by the manifest but has not been validated.
