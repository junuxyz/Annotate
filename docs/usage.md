# Usage

[Back to README](../README.md)

- Select text and press **Cmd+Shift+M** on macOS or **Ctrl+Shift+M** on Windows/Linux.
  The selection context menu and command palette also offer **Comment on selection**.
- Press **Enter** to send; **Shift+Enter** adds a line.
- With AI enabled, messages ask the default assistant. Start with `@comment` to
  save a comment without an AI reply; only the comment text is saved. Use
  `@chatgpt` or `@claude` to choose an assistant. With AI disabled, plain messages
  are local comments.
- Click a highlight or comment count to open its thread and reply.
- Hover over a comment to edit or remove it. **Escape** cancels an edit.
- Resolve a thread to hide its highlight. Open the current note's comments from
  the ribbon or command palette to find resolved threads and reopen them.
- Thread and comment deletion require a second click.

### Markdown and math

Comments use Obsidian's native Markdown renderer, including bold, italics, lists,
tables, code blocks, callouts, highlights, footnotes, links, tags, embeds, and math.
LaTeX supports `$…$`, `$$…$$`, `\(…\)`, and `\[…\]`.

Links and embeds resolve relative to the commented note. Editing keeps the original
Markdown source. HTML follows Obsidian's sanitization rules.
Set your display name in the plugin settings.
