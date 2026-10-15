# Annotate

<p align="center">
  <img src="assets/annotate-logo.png" alt="Annotate logo" width="160" height="160">
</p>

**Keep context attached to your notes.**

**Annotate** is an obsidian plugin that lets you select a passage, leave a comment, and click its highlight to revisit it or add a reply.

## Features

- 💬 **Comment on any passage.** Start a thread, reply, edit, resolve, or reopen it from the highlight or comments list. Quote selected text, copy messages or entire threads, and expand longer conversations. Comments support Obsidian Markdown, note links, embeds, code blocks, and LaTeX, and follow text edits and Obsidian renames.
- 🖍️ **Highlight and color text.** Choose highlight and text colors from the selection menu, combine them, or remove them. Customize the highlight palette, opacity, and Rounded, Flat, or Underline shape. **Cmd/Ctrl+Shift+H** reapplies your last highlight color. Bold, italics, and strikethrough stay formatted.
- 🤖 **Ask an assistant.** When enabled, messages ask your default assistant. Start with `@comment` to save a comment without an AI reply, or use `@chatgpt` / `@claude` to choose an assistant. Answers use your current note and highlighted passage as context. Optional, desktop only.
  - Comments stay in your vault without changing your notes. Assistant requests share note content with the selected provider. See [assistant setup and privacy](docs/assistants.md).
- 🛠️ **Use Codex skills.** Type `/` after mentioning an assistant to search installed skills, then send `@chatgpt /skill-name your question` to run one. Desktop only.
- 🎨 **Fit your Obsidian theme.** The interface uses your theme's colors, accent color, and typography to blend into Obsidian in light and dark mode. Highlight colors remain customizable.

## Install

Build from source with Node.js 22 or newer:

```sh
git clone https://github.com/junuxyz/Annotate.git
cd Annotate
npm ci
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into
`<vault>/.obsidian/plugins/annotate/`, then enable **Annotate** in
**Settings → Community plugins**.

## Quick start

1. Select text and press **Cmd+Shift+M** on macOS or **Ctrl+Shift+M** on Windows/Linux.
2. Write a comment and press **Enter** to send. Use **Shift+Enter** for a new line.
3. Click the highlight to reply, or resolve the thread when you're done.

## Text highlights

Select note text to open the compact **Highlight | Color | Annotate** menu. Choose
**Highlight** to pick a color or remove an existing highlight. **Cmd+Shift+H**
on macOS, or **Ctrl+Shift+H** on Windows/Linux, applies the last chosen color.
**Cmd+Shift+M** on macOS, or **Ctrl+Shift+M** on Windows/Linux, opens the comment composer.
Reassign either shortcut in Obsidian Hotkeys.

Under **Settings → Annotate → Advanced**, customize the palette with color names,
color pickers or hex values, and choose Rounded, Flat or Underline. Hex values may
include opacity, such as `#ffe06680`. The default colors are yellow, pink and light blue.
Palette and shape changes update existing Annotate highlights while the plugin is enabled.

Choose **Color** in the selection menu to change text color or restore the default.
Text colors follow the active theme and can be combined with highlights.
The command palette also offers **Annotate: Color selected text with last color**;
assign a shortcut in Obsidian Hotkeys if you use it often.

Highlights are saved as inline `<mark>` elements in the note. Their saved color and
shape remain available in Reading mode without Annotate. Code and HTML tag fragments
are left unchanged. Text colors are saved as inline `<span>` elements.
Editor highlighting and recoloring can be undone normally.

## Documentation

- [Usage](docs/usage.md): editing, resolving, Markdown, and math.
- [Assistant replies](docs/assistants.md): ChatGPT and Claude setup, privacy, and recovery.
- [Storage and limits](docs/storage-and-limits.md): backups, missing text, and supported content.
- [Development](docs/development.md): local updates, validation, and releases.

## License

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
