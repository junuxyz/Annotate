# Architecture

Annotate runs inside desktop Obsidian. Obsidian and CodeMirror are host-provided
dependencies, excluded from the bundle. Node APIs are available in the desktop
host. The manifest declares desktop-only support.

## Source map

| File                                                             | Responsibility                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`main.ts`](../src/main.ts)                                      | Plugin lifecycle, CodeMirror extension, selections, composer and thread UI, settings, request orchestration, comment persistence, and sync conflict handling |
| [`model.ts`](../src/model.ts)                                    | Zod schemas, defaults, anchors, rename mapping, and conversation context                                                                                     |
| [`reading.ts`](../src/reading.ts)                                | Map rendered Reading-mode text to Markdown offsets and decorate mapped passages                                                                              |
| [`highlight.ts`](../src/highlight.ts)                            | Highlight palette, text colors, inline HTML edits, and parsed spans                                                                                          |
| [`mentions.ts`](../src/mentions.ts)                              | Mention completion and input interaction                                                                                                                     |
| [`markdown.ts`](../src/markdown.ts), [`math.ts`](../src/math.ts) | Safe comment Markdown, render lifecycle, math delimiters, and streamed rendering                                                                             |
| [`ai.ts`](../src/ai.ts)                                          | Provider registry, executable resolution, invocation parsing, and `AssistantBackend` interface                                                               |
| [`codex.ts`](../src/codex.ts)                                    | Codex app-server RPC, restrictive configuration, sessions, host-tool dispatch, and cancellation                                                              |
| [`claude.ts`](../src/claude.ts)                                  | Context-only Claude CLI transport, streaming, and cancellation                                                                                               |
| [`agent-access.ts`](../src/agent-access.ts)                      | Folder consent, context checks, settings, external approvals, history UI, and host-tool wiring                                                               |
| [`agent-settings.ts`](../src/agent-settings.ts)                  | Folder, web-search, MCP, and consent-version settings                                                                                                        |
| [`note-tools.ts`](../src/note-tools.ts)                          | Checked note operations, current-editor access, snapshots, and grouped undo                                                                                  |
| [`operation-history.ts`](../src/operation-history.ts)            | Immutable history snapshots and ancestry conflict detection                                                                                                  |
| [`mcp.ts`](../src/mcp.ts)                                        | Explicit remote-service discovery, protocol validation, and approved external calls                                                                          |
| [`sync.ts`](../src/sync.ts)                                      | Local development-build installation, watching, and rollback. This is separate from comment-data synchronization.                                            |
| [`styles.css`](../styles.css)                                    | Plugin UI, editor marks, Reading-mode marks, and theme behavior                                                                                              |

## Annotation flow

Selections become a target with a note path, Markdown offsets, and selected text.
In editing modes, CodeMirror changes map anchor positions as the note changes.
Reading mode maps rendered text back to Markdown before creating a target.

`makeAnchor` stores the quote and surrounding context. `locateAnchor` searches
for a unique quote or a unique contextual match. Ambiguous or deleted passages
become orphaned rather than attaching to an arbitrary occurrence. They remain
available as **Text missing** in the comment list. An explicit replacement
selection can reattach them. Obsidian rename events update thread paths.

Comments live in plugin data and do not alter note text. Highlight and text-color
actions do alter note text, using inline `<mark>` and `<span>` elements. Assistant
note operations can also alter notes after folder consent. These are separate
storage paths with different recovery behavior.

## Assistant request flow

1. `record` parses the invocation. `@comment` saves locally. A plain message uses
   the enabled default provider, and an explicit mention selects one provider.
2. `requestCodex` orchestrates either backend. Its legacy name does not mean that
   all requests use ChatGPT. Provider changes replace the saved session identity.
3. `AgentAccess.ensureContext` checks the note path and asks for its folder if
   needed. Cancellation stops context delivery. Authentication or connection
   setup can occur before this prompt; note context is sent afterward.
4. The plugin persists the pending assistant message before sending. `questionContext`
   supplies the full current note, selected passage, question, and reply quote.
   New sessions receive saved conversation history. Existing Codex sessions retain
   it, while Claude receives history on each request.
5. Deltas update the same saved message. The terminal state records completion,
   cancellation, failure, or an unknown outcome. Startup and incoming synced data
   run through `recoverConversations`; interrupted responses are never resent.

Editing or removing conversation messages invalidates the old session. A local
comment added to an existing conversation marks `historyDirty`, so the next
request starts with the updated saved history. Session reuse must not bypass
current folder grants or tool settings.

## Persistence and recovery

`dataSchema` in `model.ts` defines the saved format. `version` remains `1`.
Legacy `codex` fields still hold the shared enable switch and thread session
state. `assistant` selects the provider, and messages retain their own provider
identity. Missing historical provider values mean ChatGPT.

New settings use `emptyAgentSettings` with consent version `1`. Missing settings
parse with consent version `0`; `recoverConversations` disables AI, clears grants,
services, and old session IDs, then requires the user to review access again.
Replacing that migration default with the fresh-install default would bypass
renewed consent.

Comment saves run through a queue and compare the current external data with the
last observed fingerprint. Clean incoming data can reload after a popup closes.
Conflicting changes pause saves and create recovery files. There is no atomic
cross-device compare-and-save operation. See [storage](storage-and-limits.md).

Assistant note history uses a different queue and an immutable ancestry chain.
Do not put snapshots in agent-readable note folders or merge them as if they
were ordinary comment settings. See [agent tools](agent-tools.md#operation-history).

## Rendering and lifecycle

`CommentMarkdown` retains raw saved text but passes a safe rendering form to
Obsidian. `safeCommentMarkdown` disarms images, raw HTML, wiki embeds, and fenced
code language labels before native rendering. Both streamed and completed
responses use the same renderer. Math parsing preserves code and incomplete
expressions while a response arrives.

Rendering owns Obsidian components that must unload when a panel or render is
replaced. Plugin unload also stops backends, cancels approvals and pending context
requests, removes UI and listeners, and stops development watching. Changes to
these lifecycles need disable/re-enable or reload coverage.

## Build outputs

`esbuild.config.mjs` produces the root distribution and a separate `.development/`
snapshot after successful compilation. Development snapshots include a build
identity used by `syncLocalBuild` and `watchDevelopmentBuild`. The watcher waits
for idle UI, preserves data, and rolls back a failed revision without retry loops.

The distribution banner carries license notices and manifest/style hashes.
`release:verify` checks artifact identity and consistency; it does not prove that
the source was tested. Full release validation must cover the exact staged files.
