# Assistant replies

[Back to README](../README.md)

Local comments do not require an assistant account. In Annotate settings, select
an assistant and enable it to request replies. With assistants disabled, plain
messages stay local. Type `@` for assistant mentions and `@comment`.

## Accounts and availability

| Assistant | Account and setup                                                                                                                                                                              | Mention    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| ChatGPT   | Install Codex CLI and run `codex login` with an account that can use Codex. The CLI must support Annotate's restrictive permission profile; incompatible versions fail before sending context. | `@chatgpt` |
| Claude    | Install Claude Code and run `claude auth login` with a Claude subscription. API keys are not used by this integration.                                                                         | `@claude`  |

Annotate does not include a provider subscription. Provider usage limits and data
policies apply. When requests are available, ChatGPT sends supplied context to
OpenAI and Claude sends it to Anthropic over the network. CLI authentication also
contacts the selected provider.

Set the executable path if needed, then click **Reconnect**. Claude's model field
accepts aliases such as `sonnet` or `opus`.

## What a request shares

An assistant request supplies the complete current note, selected passage,
question, reply quotes, and annotation conversation. The conversation can include
earlier local comments and edited messages. Open the context preview before
sending to review the current note and prior messages. Remove sensitive information from the supplied note or conversation.

Start with `@comment` to save without an AI reply. Annotate removes that prefix
from the saved text. This prevents an immediate request. It does not permanently
exclude the comment from later assistant context. Local commenting and manual
highlighting work with assistants disabled.

Comments and settings live in the vault's plugin data. Your vault's sync and
backup tools may copy that data elsewhere. The provider and CLI may also retain
request data under their own account settings and policies. Annotate's local
history cannot retract information already sent to a provider or another service.

## Access boundaries

Terminal execution is unavailable in this release. Annotate does not offer an
exception that grants access to the whole computer. A write sandbox alone does
not prevent reads outside a selected folder.

Claude receives supplied context as text and runs with its tools, custom
instructions, plugins, and MCP configuration disabled. It cannot perform note
operations or use web search through Annotate.

ChatGPT uses an isolated Annotate configuration and a restrictive permission
profile. It does not inherit the user's Codex plugins, skills, instructions, or
MCP services. If the installed CLI cannot apply the required profile, requests
fail before Annotate sends note context. Your Codex login authenticates requests;
isolating tool configuration does not make the provider request anonymous.

### Note folders and history

Select the visible vault folders ChatGPT may use in settings. Selecting `.` grants
access to visible notes throughout the vault. With no folders granted, note tools
have no note access. Sending the current note also requires a grant for its
folder. Access to another folder asks for that specific folder; cancelling leaves
it inaccessible. Review and remove folder grants in settings.

Annotate handles note operations through Obsidian APIs and checks each path.
Within permitted folders, ChatGPT may read, search, create, edit, rename, and
reorganize notes without asking for each edit. Deletion moves a note to trash.
Hidden folders, `.obsidian`, plugin code, credentials, and unrelated folders are
excluded. External filesystem folders are unavailable.

Agent writes save local snapshots in Annotate's plugin data folder. Open change
history in settings to review and undo a grouped operation. History is recovery
data and may contain earlier note text; protect it with the same care as notes.
Undo can restore local content. It cannot retract information sent externally.

### Web search and connected services

Web search starts disabled and has its own opt-in. Search queries can disclose
information from supplied context. Permission to read a note does not make it
safe to include private information in a search query.

MCP services start disabled. Annotate accepts explicitly selected public HTTPS
remote services, without inherited credentials. It does not launch local stdio
servers. Redirects are denied. Review the destination, tool, and complete
arguments in each external tool-call approval before allowing it. Denying the
approval prevents that call. Messages, file uploads, publishing, and other
external actions require approval, even within a permitted note folder.

Enabling one service does not enable another. Enable only services you trust with
the arguments you approve. A remote service receives those arguments under its
own privacy and retention policies. Claude's context-only integration does not
expose these note, web, or MCP tools.

## Conversations and recovery

Replies stream into the thread. **Stop** cancels a response. Interrupted requests
are never resent automatically. **Start new conversation** recovers an interrupted
or unavailable session without deleting saved messages. Switching assistants
starts a new provider session and supplies the saved annotation history. Each
saved response keeps its assistant name, including in copied conversations.

Claude receives the saved conversation on each request. Edits, removals, and local
comments must appear in subsequent context. A saved Codex session does not grant
permission to bypass an unavailable or revoked capability.

## Skills

Codex skill discovery and execution are unavailable in the first release. Native
skills can read files outside Annotate's checked note operations, so Annotate does
not inherit installed skills. A slash command in a comment cannot grant file,
terminal, web, or service permissions. Claude's context-only integration does not
gain tools from a slash command.
