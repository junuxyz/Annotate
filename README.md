# Annotate

<p align="center">
  <img src="assets/annotate-logo.png" alt="Annotate logo" width="160" height="160">
</p>

**Keep context attached to your notes.**

**Annotate** is a desktop Obsidian plugin that lets you select a passage, leave a comment, and click its highlight to revisit it or add a reply. Currently, only macOS on Apple silicon is supported.

https://github.com/user-attachments/assets/b64ded00-4c37-46e0-a9a0-9e790734fa87

## Features

- 💬 **Comment on any passage.** Start a thread, reply, edit, resolve, or reopen it from the highlight or comments list. Quote selected text, copy messages or entire threads, and expand longer conversations. Comments support Obsidian Markdown, note links, code blocks, and LaTeX, and follow text edits and Obsidian renames.
- 🖍️ **Highlight and color text.** Choose highlight and text colors from the selection menu, combine them, or remove them. Customize the highlight palette, opacity, and Rounded, Flat, or Underline shape. Assign a shortcut to reapply your last highlight color. Bold, italics, and strikethrough stay formatted.
- 🤖 **Ask an assistant.** When enabled, messages ask your default assistant. Start with `@comment` to save a comment without an AI reply, or use `@chatgpt` / `@claude` / `@opencode` to choose an assistant. Requests supply the full current note, highlighted passage, question, and conversation, including earlier local comments. Assistant access is optional. ChatGPT can work on notes inside explicitly permitted vault folders. See the setup guide for context and permission controls.
  - Comments stay in your vault without changing your notes. Assistant requests share note content with the selected provider. See [assistant setup and privacy](docs/assistants.md).
- 🎨 **Fit your Obsidian theme.** The interface uses your theme's colors, accent color, and typography to blend into Obsidian in light and dark mode. Highlight colors remain customizable.

Local comments and highlighting work offline without an account. Optional ChatGPT
and Claude replies require an authenticated Codex account or a Claude subscription through
Claude Code. They send the current note and thread context to OpenAI or Anthropic;
OpenCode sends context to the selected model provider and uses its account
requirements. Provider limits apply, and subscriptions are not included. Web search and selected
remote MCP services have separate opt-in controls and can send context or approved
arguments to those services.

Assistant integration runs locally installed CLIs outside the vault. Annotate
locates those executables, reads Codex's model cache and login file, and keeps
isolated Codex state under `~/.annotate/codex/` and temporary working directories
outside the vault. The CLIs also use their provider login data.
See [assistant setup and privacy](docs/assistants.md) for details.

## Install

Requires macOS on Apple silicon and Obsidian 1.14.4 or later.

1. Open the [latest release](https://github.com/junuxyz/Annotate/releases/latest)
   and download `main.js`, `manifest.json`, and `styles.css` from **Assets**.
2. Create `<vault>/.obsidian/plugins/annotate/` and copy all three files into it.
3. In Obsidian, open **Settings → Community plugins**, allow community plugins
   if prompted, then enable **Annotate**. Reload Obsidian if it is not listed yet.

Node.js and an assistant account are not needed for local comments and highlighting.
To update, disable Annotate, replace the same three files with files from one
release, and enable it again. Keep `data.json` and the other plugin data files.

The official build supports ChatGPT, Claude, and OpenCode. See
[assistant setup](docs/assistants.md#connect-an-assistant) to enable optional AI replies.
For building from source, see [source installation](docs/development.md#build-and-install-from-source).

## Quick start

1. Select text and choose **Annotate** from the selection menu.
2. Write a comment and press **Enter** to send. Use **Shift+Enter** for a new line.
3. Click the highlight to reply, or resolve the thread when you're done.

## Documentation

- [Documentation map](docs/README.md): entry points for users, contributors, and agents.
- [Usage](docs/usage.md): comments, highlights, text colors, shortcuts, Markdown, and math.
- [Assistant replies](docs/assistants.md): ChatGPT, Claude, and OpenCode setup, privacy, and recovery.
- [Storage and limits](docs/storage-and-limits.md): backups, missing text, and supported content.
- [Development](docs/development.md): local updates, validation, and releases.
- [Architecture](docs/architecture.md), [agent tools and permissions](docs/agent-tools.md),
  and [testing](docs/testing.md): source ownership, contracts, invariants, and checks.
- [Contributing](CONTRIBUTING.md) and [security reporting](SECURITY.md).

## License

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
