# Annotate

<p align="center">
  <img src="assets/annotate-logo.png" alt="Annotate logo" width="160" height="160">
</p>

Threaded comments on selected text in Obsidian. Select a passage, leave a comment,
and click its highlight to continue the conversation. Works in Live Preview,
Source mode, and Reading mode.

## Install

Build from source with Node.js 22 or newer:

```sh
git clone https://github.com/junuxyz/Annotate.git
cd Annotate
npm ci
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into
`<vault>/.obsidian/plugins/annotate/`. Enable **Annotate** in
**Settings → Community plugins**.

To replace **Selection Comments**, disable it, install Annotate in
`.obsidian/plugins/annotate/`, and enable Annotate. On first launch, it imports
comments from the old plugin automatically and keeps the old data file untouched.
Codex threads keep their comment history, but start a fresh Codex conversation.

## Fast development updates

For a dedicated development vault, install the [Hot-Reload plugin](https://github.com/pjeby/hot-reload) once, then run:

```sh
npm run dev:vault -- "/absolute/path/to/your/vault"
```

Leave it running while you edit. Annotate rebuilds and copies the three plugin files into the vault after each successful change; Hot-Reload applies them in Obsidian. The vault must already have an `.obsidian` folder. The first run enables Annotate and disables Selection Comments in Obsidian’s plugin list; reload Obsidian to apply the switch.

## Use

- Select text and press **Cmd+Shift+M** on macOS or **Ctrl+Shift+M** on Windows/Linux.
  The selection context menu and command palette also offer **Comment on selection**.
- Press **Enter** to send; **Shift+Enter** adds a line.
- Click a highlight or comment count to open its thread and reply.
- Hover over a comment to edit or remove it. **Escape** cancels an edit.
- Resolve a thread to hide its highlight. Open the current note's comments from
  the ribbon or command palette to find resolved threads and reopen them.
- Thread and comment deletion require a second click.

Comments support LaTeX with `$…$`, `$$…$$`, `\(…\)`, and `\[…\]`.
Comments use Obsidian's native Markdown renderer, including bold, italics, lists,
tables, code blocks, callouts, highlights, footnotes, links, tags, embeds, and math.
Links and embeds resolve relative to the commented note. Editing keeps the original
Markdown source. HTML follows Obsidian's sanitization rules.
Set your display name in the plugin settings.

## Optional ChatGPT replies

On desktop, install the Codex CLI and sign in with `codex login` using a ChatGPT
account. This integration requires file-based credentials (`auth.json`);
keychain-only credentials and API keys are not supported.

Enable Codex in the plugin settings. If `codex` is not on Obsidian's PATH, set
**Codex executable** to its full path, then click **Reconnect**. Type
`@chatgpt` followed by a question in a comment or reply. Typing `@` opens completion.

Each thread has its own conversation. Replies stream into the thread; **Stop**
cancels a response. Interrupted requests are never resent automatically.
Use **Start new conversation** to recover an interrupted or unavailable session.
Editing or removing a message starts a fresh Codex conversation on the next question.

When you ask ChatGPT, the complete current note, selected passage, question, and
thread history are sent to OpenAI through Codex. Answers use the note as their primary
context; Codex can search the web when current or specialized information would help.
Ordinary comments stay local.
The backend uses `~/.annotate-codex` for its configuration and sessions,
links to the CLI's login file, and disables tools and global instructions.
Codex is off by default and is not available on mobile.

## Storage and limits

Comments are stored in `.obsidian/plugins/annotate/data.json`.
The plugin does not change your notes. Back up that file to preserve comments.

Highlights follow edits. If the passage disappears or cannot be located uniquely,
the thread stays in the comments list as **Text missing**. Select replacement text
in editing mode and use **Attach to selection** to repair it. Renames made through
Obsidian preserve threads; renames made outside Obsidian cannot be tracked reliably.

- Markdown notes only; no PDFs, Canvas, attachments, or collaborative editing.
- Reading mode skips passages it cannot map reliably to Markdown, including some
  custom rendering and equations. Use editing mode for those selections.
- There is no merge protocol for simultaneous edits on multiple devices.
- Mobile is permitted by the manifest but has not been validated.

## Development

```sh
npm ci
npm run build
npm test
npm run format:check
npm run dev
```

Source files cover the plugin UI (`main.ts`), anchors and storage (`model.ts`),
Reading mode mapping (`reading.ts`), mentions (`mentions.ts`), comment Markdown (`markdown.ts`), LaTeX delimiters (`math.ts`),
and the Codex app-server connection (`codex.ts`). Obsidian and CodeMirror are
provided by the host and excluded from the bundle.

Unit and interaction tests use a substituted Obsidian host. With Docker running,
run real-app development checks in a disposable Linux container with a virtual display:

```sh
npm run check -- --modes live,source,reading --shots --record
```

The runner uses the adjacent `../test-vault/` when present, otherwise the included
`test-vault/`. It creates fresh settings and synthetic comment data when needed.
See [the E2E checklist](test-vault/E2E%20checklist.md) for full release validation.
See [Linux E2E setup](e2e/README-linux.md) for prerequisites and evidence output.
Development checks alone do not certify a release. The older `e2e/run-*.mjs`
scripts require the isolated instance's `CDP_PORT` and run from `e2e/`.

Use `npm version patch`, `npm version minor`, or `npm version major` to update
`package.json`, `manifest.json`, and `versions.json` together. Obsidian release tags
use the manifest version without a `v` prefix; attach `main.js`, `manifest.json`,
and `styles.css` only after full release validation.

## License

[MIT](LICENSE) · junuxyz
