# Usage

[Back to README](../README.md)

- Select text and choose **Annotate** from the selection menu.
  The selection context menu and command palette also offer **Comment on selection**.
- Press **Enter** to send; **Shift+Enter** adds a line.
- With AI enabled, messages ask the default assistant. Start with `@comment` to
  save a comment without an AI reply; the `@comment` prefix is removed. Use
  `@chatgpt` or `@claude` to choose an assistant. With AI disabled, plain messages
  are local comments.
- Click a highlight or comment count to open its thread and reply.
- Hover over a comment to edit or remove it. **Escape** cancels an edit.
- Resolve a thread to hide its highlight. Open the current note's comments from
  the ribbon or command palette to find resolved threads and reopen them.
- Thread and comment deletion take effect immediately. Use **Undo** in the
  notification to restore the deleted thread or comment.

## Pasted images

Paste a copied image or screenshot into the comment input with **Cmd+V** or
**Ctrl+V**. Small previews appear above the input. Use each preview's remove
button to discard it before sending. You can send images with or without text.
PNG, JPEG, GIF, and WebP images are supported, each up to 5 MB. There is no
image-count limit in Annotate.

Sent images remain in the thread. With AI enabled, they are sent to the selected
assistant along with the question. The selected model must support image input.
With AI disabled or `@comment`, images are saved as local comments and can enter
later assistant context. Closing and reopening the composer preserves unsent
attachments during the current plugin session.

## Markdown and math

Comments use Obsidian's native Markdown renderer, including bold, italics, lists,
tables, code blocks, callouts, highlights, footnotes, links, tags, and math.
LaTeX supports `$…$`, `$$…$$`, `\(…\)`, and `\[…\]`.

Note links resolve relative to the commented note. Editing keeps the original
Markdown source. Markdown image links, embeds, and raw HTML display as inert text. Code blocks
display as plain code, without running language-specific plugin processors.
Comment rendering does not automatically load remote resources or embedded notes.
Set your display name in the plugin settings.

## Text highlights and colors

Select note text to open the compact **Highlight | Color | Annotate** menu. Choose
**Highlight** to pick a color or remove an existing highlight. **Annotate** opens
the comment composer. Choose **Color** to change text color or restore the default.
Text colors follow the active theme and can be combined with highlights.

### Keyboard shortcuts

New installations do not assign shortcuts, avoiding conflicts with your existing
Obsidian commands. Assign them under **Settings → Annotate → Advanced → Keyboard
shortcuts**, or **Settings → Hotkeys**. Existing custom shortcuts are preserved.

Click **Set shortcut** to record a binding, an existing shortcut to replace it,
**Add** to assign another, or the remove icon to clear a binding. **Clear custom
shortcuts** removes your overrides and leaves the command unassigned.
Escape cancels recording. Conflicts with another registered Obsidian command are
reported before saving. Changes also appear in **Settings → Hotkeys** and survive reload.

| Command                                       | Suggested shortcut on macOS |
| --------------------------------------------- | --------------------------- |
| Annotate: Comment on selection                | Cmd+Shift+M                 |
| Annotate: Highlight selection with last color | Cmd+Shift+H                 |
| Annotate: Color selected text with last color | Cmd+Shift+J                 |

These are suggestions to assign yourself, not defaults. Annotate currently
supports macOS only.

Under **Settings → Annotate → Advanced**, customize the palette with color names,
color pickers or hex values, and choose Rounded, Flat or Underline. Hex values may
include opacity, such as `#ffe06680`. The default colors are yellow, pink and light blue.
Palette and shape changes update existing Annotate highlights while the plugin is enabled.
In dark mode, highlight backgrounds are dimmer and highlighted text keeps the
surrounding text color, including separately applied text colors.

Highlights are saved as inline `<mark>` elements in the note. Their saved color and
shape remain available in Reading mode without Annotate. Code and HTML tag fragments
are left unchanged. Editor highlighting and recoloring can be undone normally.
Text colors use inline `<span>` elements and can be combined with highlights.
