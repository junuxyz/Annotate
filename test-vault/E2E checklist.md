# E2E checklist

Run these checks against the current build in this vault in the real Obsidian app. Record pass, fail, pending, or not applicable with a reason for each check in [[Validation results]]. Checkboxes alone are not release evidence.

## Loading and annotation workflow

- [ ] Enable the current plugin build and confirm it loads without plugin errors.
- [ ] In Reading mode, Live Preview, and Source mode, select text and open the composer with Cmd+Shift+M on macOS or Ctrl+Shift+M on Windows/Linux. Confirm placement beside the passage and input focus.
- [ ] Confirm selecting text alone does not show a floating button. Check the selection context menu and command-palette entry.
- [ ] Submit a comment with Enter and with the send button. Confirm Shift+Enter inserts a newline and Korean IME confirmation does not submit.
- [ ] Click the highlight and count badge, reply, and confirm the count and thread contents.
- [ ] Resolve a thread, reopen it from the current-note comment list, and confirm its highlight returns.
- [ ] Delete a thread and confirm deletion requires the second confirmation click.
- [ ] Check plain-text rendering with HTML-like text, multiline text, Korean text, inline formatting, and repeated passages. Confirm each comment stays on the correct selection.

## ChatGPT mention dropdown

- [ ] Submit `@chatgpt hi` and a mentioned reply. Confirm the full mention remains visible and saved after reopening the thread and restarting Obsidian.

- [ ] In new comments and replies in Reading mode, Live Preview, and Source mode, type `@`. Confirm the dropdown lists only ChatGPT. Press Down then Enter and confirm `@chatgpt ` is inserted with focus kept in the input and no submission.
- [ ] Complete a partial name with a mouse click. Confirm existing text before and after the token remains intact and the cursor stays immediately after the inserted mention.
- [ ] Confirm unmatched names and email addresses do not show the dropdown. Confirm a fully typed `@chatgpt` still permits normal submission.
- [ ] Confirm Escape dismisses only the dropdown, Shift+Enter keeps newline behavior, and IME Enter does not choose or submit during composition.

## Anchors and persistence

- [ ] Insert text before a selection, at both boundaries, and inside it. Confirm the anchor follows the passage and excludes boundary insertions.
- [ ] Delete the selected passage, confirm Text missing, then attach the thread to a replacement selection. Confirm undo does not silently reattach a missing anchor.
- [ ] Rename a note and its folder through Obsidian and confirm its threads follow the new path.
- [ ] Close and reopen the note, restart Obsidian, and confirm saved threads, replies, and states persist. Confirm commenting does not modify the note text.
- [ ] Disable and re-enable the plugin. Confirm popups, highlights, commands, and listeners behave correctly without duplicates or errors.

## Codex integration

Use only `Fixtures/Codex context.md`. Enable Codex explicitly for these checks and disable it afterward. Record unavailable prerequisites as pending.

- [ ] Submit `@chatgpt What is the test word?` on the selected sentence. Confirm an answer using the full note, streamed into the existing popup.
- [ ] Ask a follow-up in the same annotation and a question in a separate annotation. Confirm conversation separation and retained same-thread context.
- [ ] Keep an unsent draft while a response streams. Close and reopen the popup and confirm the draft and saved response behavior.
- [ ] Cancel a response and confirm the state and partial response. Restart Obsidian and confirm session resume and saved messages.
- [ ] Exercise disconnect or process failure, reconnect, unavailable sessions, and Start new Codex conversation. Confirm unknown or interrupted requests are not resent automatically.
- [ ] Confirm ordinary annotations still work with Codex disabled.

Add checks for any changed behavior that this list does not cover. Restore fixture text after testing.

## LaTeX in comments

- [ ] In Reading, Live Preview, and Source modes, submit comments and replies containing `$…$`, `$$…$$`, `\(…\)`, and `\[…\]`. Confirm fractions, matrices and Greek symbols render, and reopen the thread to confirm original LaTeX persists.
- [ ] Confirm native Markdown formatting and sanitized HTML render in comments. Confirm Korean text, escaped dollars, currency, fenced and inline code, and unclosed expressions remain intact. Confirm invalid TeX leaves the thread usable.
- [ ] Stream a response with a complete equation and an incomplete equation. Confirm complete equations remain rendered as text arrives and the incomplete equation renders after its closing delimiter arrives.
- [ ] Check wide display equations scroll inside the comment, the popup fits the viewport, and math remains visible in light and dark themes.
- [ ] Reload the app and confirm saved equations render again.

## Edit and remove comments

- [ ] In Reading, Live Preview and Source modes, confirm edit/remove icons are hidden until their own comment is hovered or keyboard focused. Confirm other comments' icons stay hidden and the header's thread-delete icon appears only when the header is hovered or focused.
- [ ] Edit a comment in place. Confirm raw LaTeX is editable, Enter saves, Shift+Enter inserts a newline, IME Enter does not save, Escape and Cancel discard changes without closing the thread, and empty text cannot be saved.
- [ ] Confirm editing or removing a message preserves an unsent reply. Confirm sending a reply or streaming a response preserves an open edit draft, disables its Save until completion/cancellation, and prevents editing/removing messages while that response is active.
- [ ] Confirm the first remove click only arms removal, the second removes only that message, counts update, reopening preserves the result, and removing the last comment removes the thread and highlight.
- [ ] Edit completed assistant text and verify LaTeX re-renders. Confirm the next Codex turn uses edited history in a new session, and removing a message also clears the prior session.
- [ ] Reload Obsidian and confirm edited bodies and removals persist. Check the compact controls and editor in both light and dark themes.

## Comment Markdown

- [ ] Run `npm run check -- --only smoke,ui,list,markdown --modes live,source,reading --shots --record` for native Markdown rendering in all note modes and both themes.
- [ ] Confirm headings, bold, italics, strikethrough, highlights, code, callouts, nested and task lists, tables, rules, footnotes, tags, wiki links, embeds, and math render with Obsidian's renderer.
- [ ] Confirm wiki links resolve relative to the note, edits preserve raw Markdown, reopening renders the saved text, and partial and completed streamed responses use the latest content.
