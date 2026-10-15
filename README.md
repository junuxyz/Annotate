# Annotate

<p align="center">
  <img src="assets/annotate-logo.png" alt="Annotate logo" width="160" height="160">
</p>

**Keep context attached to your notes.**

**Annotate** is a desktop Obsidian plugin that lets you select a passage, leave a comment, and click its highlight to revisit it or add a reply.

https://github.com/user-attachments/assets/b64ded00-4c37-46e0-a9a0-9e790734fa87

## Features

- 💬 **Comment on any passage.** Start a thread, reply, edit, resolve, or reopen it from the highlight or comments list. Quote selected text, copy messages or entire threads, and expand longer conversations. Comments support Obsidian Markdown, note links, embeds, code blocks, and LaTeX, and follow text edits and Obsidian renames.
- 🖍️ **Highlight and color text.** Choose highlight and text colors from the selection menu, combine them, or remove them. Customize the highlight palette, opacity, and Rounded, Flat, or Underline shape. **Cmd/Ctrl+Shift+H** reapplies your last highlight color. Bold, italics, and strikethrough stay formatted.
- 🤖 **Ask an assistant.** When enabled, messages ask your default assistant. Start with `@comment` to save a comment without an AI reply, or use `@chatgpt` / `@claude` to choose an assistant. Requests supply the full current note, highlighted passage, question, and conversation, including earlier local comments. Assistant access is optional. ChatGPT can work on notes inside explicitly permitted vault folders. See the setup guide for context and permission controls.
  - Comments stay in your vault without changing your notes. Assistant requests share note content with the selected provider. See [assistant setup and privacy](docs/assistants.md).
- 🎨 **Fit your Obsidian theme.** The interface uses your theme's colors, accent color, and typography to blend into Obsidian in light and dark mode. Highlight colors remain customizable.

## Install

Build from source with Node.js 22.13 or newer in the 22 series, or Node.js 24 or later:

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

## Assistant privacy

Local comments work without an assistant account. Enabling Claude requires a
Claude subscription login through Claude Code and sends supplied context to
Anthropic. ChatGPT uses an authenticated Codex account and sends supplied context
to OpenAI when its integration is available. Annotate does not include a provider
subscription. Provider account limits and data policies apply.

`@comment` saves without starting an AI request. That comment can still become
context in a later assistant request. Do not include information you do not want
to share in a note or conversation you send to an assistant.

Terminal commands and Codex skills are unavailable in the first release. Web
search and selected remote MCP services have separate opt-in controls. Read
[assistant setup and privacy](docs/assistants.md) for the current tool limitations,
context disclosure, and folder-scoped note access.

## Documentation

- [Usage](docs/usage.md): editing, resolving, Markdown, and math.
- [Assistant replies](docs/assistants.md): ChatGPT and Claude setup, privacy, and recovery.
- [Storage and limits](docs/storage-and-limits.md): backups, missing text, and supported content.
- [Development](docs/development.md): local updates, validation, and releases.
- [Contributing](CONTRIBUTING.md) and [security reporting](SECURITY.md).

## License

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
