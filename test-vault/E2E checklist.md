# E2E checklist

This checklist is the final gate immediately before creating a version tag.
Ordinary development and PRs use `npm run check:fast`, without Obsidian or real
model requests. Run E2E against the exact release commit and distribution files.

Run these checks against the current build in this vault in the real Obsidian app. Record pass, fail, pending, or not applicable with a reason for each check in [[Validation results]]. Checkboxes alone are not release evidence.

## Loading and annotation workflow

- [ ] Enable the current plugin build and confirm it loads without plugin errors.
- [ ] Confirm a fresh installation has no default Annotate shortcuts. Assign Comment on selection to Cmd+Shift+M, Highlight selection to Cmd+Shift+H and Color selected text to Cmd+Shift+J in the synthetic profile before shortcut scenarios. Verify custom bindings survive reload and clearing them leaves commands unassigned.
- [ ] In Reading mode, Live Preview, and Source mode, select text and open the composer with Cmd+Shift+M on macOS or Ctrl+Shift+M on Windows/Linux. Confirm placement beside the passage and input focus.
- [ ] Confirm selecting text opens the Highlight | Color | Annotate menu. Check each action, the selection context menu, keyboard shortcuts, and command-palette entries.
- [ ] Submit a comment with Enter and with the send button. Confirm Shift+Enter inserts a newline and Korean IME confirmation does not submit.
- [ ] Click the highlight and count badge, reply, and confirm the count and thread contents.
- [ ] Resolve a thread, reopen it from the current-note comment list, and confirm its highlight returns.
- [ ] Delete a thread with one click. Confirm the Undo notification restores the thread and highlight.
- [ ] Check plain-text rendering with HTML-like text, multiline text, Korean text, inline formatting, and repeated passages. Confirm each comment stays on the correct selection.

## Assistant and local-comment dropdown

- [ ] Submit `@chatgpt hi` and a mentioned reply. Confirm the assistant identity and message remain visible after reopening the thread and restarting Obsidian.

- [ ] In new comments and replies in Reading mode, Live Preview, and Source mode, type `@`. Confirm the dropdown offers ChatGPT, Claude, and @comment as appropriate for the current settings. Press Down then Enter and confirm `@chatgpt ` is inserted with focus kept in the input and no submission.
- [ ] Complete a partial name with a mouse click. Confirm existing text before and after the token remains intact and the cursor stays immediately after the inserted mention.
- [ ] Confirm unmatched names and email addresses do not show the dropdown. Confirm a fully typed `@chatgpt` still permits normal submission.
- [ ] Confirm Escape dismisses only the dropdown, Shift+Enter keeps newline behavior, and IME Enter does not choose or submit during composition.

## Anchors and persistence

- [ ] Insert text before a selection, at both boundaries, and inside it. Confirm the anchor follows the passage and excludes boundary insertions.
- [ ] Delete the selected passage, confirm Text missing, then attach the thread to a replacement selection. Confirm undo does not silently reattach a missing anchor.
- [ ] Rename a note and its folder through Obsidian and confirm its threads follow the new path.
- [ ] Close and reopen the note, restart Obsidian, and confirm saved threads, replies, and states persist. Confirm commenting does not modify the note text.
- [ ] Disable and re-enable the plugin. Confirm popups, highlights, commands, and listeners behave correctly without duplicates or errors.

## Assistant integration

Use fixture CLIs and recorded synthetic model streams for the standard offline
release suite. A real account is not required for these replay checks. Live model
calls are separate opt-ins when refreshing a provider protocol trace or explicitly
validating account integration; do not repeat them for every commit or release.
For an authorized live check, use only `Fixtures/Codex context.md` and synthetic
notes in explicitly permitted folders. Enable the selected assistant explicitly
and disable it afterward. Identify fixture, replay and live evidence separately;
do not report a replay as successful real authentication.

- [ ] Submit `@chatgpt What is the test word?` on the selected sentence. Confirm an answer using the full note, streamed into the existing popup.
- [ ] Ask a follow-up in the same annotation and a question in a separate annotation. Confirm conversation separation and retained same-thread context.
- [ ] Keep an unsent draft while a response streams. Close and reopen the popup and confirm the draft and saved response behavior.
- [ ] Cancel a response and confirm the state and partial response. Restart Obsidian and confirm session resume and saved messages.
- [ ] Exercise disconnect or process failure, reconnect, unavailable sessions, and Start new conversation. Confirm unknown or interrupted requests are not resent automatically.
- [ ] Confirm ordinary annotations still work with assistants disabled. Run equivalent streaming, cancellation, recovery, and provider-switch checks for Claude when supported.

Add checks for any changed behavior that this list does not cover. Restore fixture text after testing.

## LaTeX in comments

- [ ] In Reading, Live Preview, and Source modes, submit comments and replies containing `$…$`, `$$…$$`, `\(…\)`, and `\[…\]`. Confirm fractions, matrices and Greek symbols render, and reopen the thread to confirm original LaTeX persists.
- [ ] Confirm native Markdown formatting renders and raw HTML stays inert in comments. Confirm Korean text, escaped dollars, currency, fenced and inline code, and unclosed expressions remain intact. Confirm invalid TeX leaves the thread usable.
- [ ] Stream a response with a complete equation and an incomplete equation. Confirm complete equations remain rendered as text arrives and the incomplete equation renders after its closing delimiter arrives.
- [ ] Check wide display equations scroll inside the comment, the popup fits the viewport, and math remains visible in light and dark themes.
- [ ] Reload the app and confirm saved equations render again.

## Edit and remove comments

- [ ] In Reading, Live Preview and Source modes, confirm edit/remove icons are hidden until their own comment is hovered or keyboard focused. Confirm other comments' icons stay hidden and the header's thread-delete icon appears only when the header is hovered or focused.
- [ ] Edit a comment in place. Confirm raw LaTeX is editable, Enter saves, Shift+Enter inserts a newline, IME Enter does not save, Escape and Cancel discard changes without closing the thread, and empty text cannot be saved.
- [ ] Confirm editing or removing a message preserves an unsent reply. Confirm sending a reply or streaming a response preserves an open edit draft, disables its Save until completion/cancellation, and prevents editing/removing messages while that response is active.
- [ ] Confirm one remove click removes only that message, offers Undo, updates counts, and persists after reopening. Confirm Undo restores the message, and removing the last comment removes the thread and highlight.
- [ ] Edit completed assistant text and verify LaTeX re-renders. Confirm the next Codex turn uses edited history in a new session, and removing a message also clears the prior session.
- [ ] Reload Obsidian and confirm edited bodies and removals persist. Check the compact controls and editor in both light and dark themes.

## Comment Markdown

- [ ] Run `npm run check -- --only smoke,ui,list,markdown --modes live,source,reading --shots --record` for native Markdown rendering in all note modes and both themes.
- [ ] Confirm headings, bold, italics, strikethrough, highlights, code, callouts, nested and task lists, tables, rules, footnotes, tags, wiki links, and math render with Obsidian's renderer.
- [ ] Confirm wiki links resolve relative to the note, edits preserve raw Markdown, reopening renders the saved text, and partial and completed streamed responses use the latest content.

## Privacy, permissions, and recoverable edits

These are release gates for assistant capabilities. Mark an unavailable capability
as not applicable with a concrete reason only when the released plugin does not
expose it. An unverified permission boundary remains pending and blocks release.

- [ ] Confirm assistant access starts disabled. Before enabling it, verify settings explain provider account requirements and that requests share the current note, passage, question, quotes, and conversation, including earlier local comments.
- [ ] Send `@comment` while the assistant is enabled. Confirm it saves without contacting the provider. Send a later assistant request and verify the local comment appears in context, including when added after a provider session started.
- [ ] Inspect the context shown before a request. Verify it identifies the note and conversation supplied to the model. Confirm local notes and comments do not trigger assistant network requests while assistants are disabled.
- [ ] Start with no permitted folders. Confirm note tools cannot read, search, create, edit, or delete notes until a visible vault folder is explicitly selected. Confirm no rename or arbitrary filesystem tool is exposed.
- [ ] Grant one synthetic folder. Exercise note tools inside it and confirm access to sibling folders requires a specific folder grant. Cancel the request and verify access remains denied. Confirm revocation takes effect for existing conversations.
- [ ] Try traversal, absolute paths, encoded paths, symlinks where supported, hidden folders, `.obsidian`, plugin code, and credential-like files. Confirm tools deny access without leaking file contents through errors or search results.
- [ ] Edit and create synthetic notes in permitted folders. Confirm changes appear in a visible history and undo restores the entire operation. Delete a synthetic note and confirm it moves to trash. Test renames made by the user through Obsidian separately as anchor behavior.
- [ ] Confirm terminal commands are unavailable, including through skills and assistant tool requests. A workspace write restriction alone does not prove a private read boundary.
- [ ] Put synthetic MCP, plugin, custom instruction, and web-search settings in the user's CLI configuration. Confirm Annotate does not silently inherit them. Confirm arbitrary command networking is unavailable.
- [ ] Confirm web search starts disabled and requires its own opt-in. Inspect a synthetic search request for disclosure of note content. Confirm disabling search takes effect in an existing session.
- [ ] If connected services are exposed, explicitly enable one synthetic service. Confirm unselected services remain unavailable and messages, uploads, publishing, and other external calls require approval before execution. Deny an approval and confirm no external action occurs.
- [ ] Close and reopen the thread, reconnect, switch providers, and reload the plugin. Confirm permissions, context disclosure, and history retain the documented behavior without broadening access.

## Sync conflicts and persistence

- [ ] Simulate an external `data.json` update while Annotate is idle. Confirm the next local save preserves both independent comments and settings without erasing the external update.
- [ ] Change the same thread in two synthetic copies. Confirm the plugin preserves conflicting data and presents a recovery path. Reload and verify the preserved versions are still recoverable.
- [ ] Repeat external updates during a streamed response and a local edit. Confirm saved messages, drafts, and unrelated annotations survive. Restore fixtures after each check.

## Distribution and first tag

- [ ] Run the full release validation described in the repository instructions against the exact build to be distributed. Record hashes, environment, scenario results, and screenshot evidence in `Validation results.md`.
- [ ] Confirm `manifest.json` declares desktop-only support. Test supported desktop platforms or record the untested platforms as pending without claiming validation there.
- [ ] Inspect the release archive and tag assets. Confirm the plugin ID is `annotate`, the manifest version matches the tag without a `v` prefix, and only the intended current release files are packaged.
- [ ] Inspect `main.js` for the project's license and required third-party notices. Confirm the distributed files retain applicable copyright and license text.
- [ ] Review README, assistant privacy documentation, security reporting, and contribution instructions against the actual build. Confirm they do not promise unavailable permissions or unverified security guarantees.

- [ ] Run `npm run check -- --only resources --modes live,source,reading --record`. Confirm comment images, HTML resources, embeds, and named code processors stay inert, the loopback request trap receives nothing, and original source remains editable.
