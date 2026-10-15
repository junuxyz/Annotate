# Assistant replies

[Back to README](../README.md)

Local comments do not require an assistant account. In Annotate settings, select
an assistant and enable it to request replies. With assistants disabled, plain
messages stay local. Type `@` for assistant mentions and `@comment`.

For implementation context, see [agent tools and permissions](agent-tools.md)
and [the request flow](architecture.md#assistant-request-flow). For recovery-file
locations, see [storage and limits](storage-and-limits.md).

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
earlier local comments and edited messages. The composer identifies the note and
explains that earlier thread messages are included.

Start with `@comment` to save without an AI reply. Annotate removes that prefix
from the saved text. This prevents an immediate request. It does not permanently
exclude the comment from later assistant context. Local commenting and manual
highlighting work with assistants disabled.

Comments and settings live in the vault's plugin data. Your vault's sync and
backup tools may copy that data elsewhere. The provider and CLI may also retain
request data under their own account settings and policies. Annotate's local
history cannot retract information already sent to a provider or another service.

## Access boundaries

Terminal execution is unavailable in this release.

Claude receives supplied context as text and runs with its tools, custom
instructions, plugins, and MCP configuration disabled. It cannot perform note
operations or use web search through Annotate.

ChatGPT uses an isolated Annotate configuration and a restrictive permission
profile. It does not inherit the user's Codex plugins, skills, instructions, or
MCP services. If the installed CLI cannot apply the required profile, requests
fail before Annotate sends note context.

### Note folders and history

Select the visible vault folders ChatGPT may use in settings. Selecting `.` grants
access to visible notes throughout the vault. With no folders granted, note tools
have no note access. Sending the current note also requires a grant for its
folder. Access to another folder asks for that specific folder; cancelling leaves
it inaccessible. Review and remove folder grants in settings.

Annotate handles note operations through Obsidian APIs and checks each path.
Within permitted folders, ChatGPT may read, search, create, edit, and trash notes
without asking for each edit. Deletion moves a note to trash.
Hidden folders, `.obsidian`, plugin code, credentials, and unrelated folders are
excluded. External filesystem folders are unavailable.

Other installed Obsidian plugins are trusted code and may process note contents
after an edit. Annotate's permissions do not sandbox those plugins. Comment
rendering itself makes automatic media, embeds, HTML, and named code processors
inert.

Agent writes save local snapshots in Annotate's plugin data folder. Open change
history in settings to review and undo a grouped operation. Snapshots can contain
earlier note text. See [storage and recovery](storage-and-limits.md).

### Web search and connected services

Web search starts disabled and has its own opt-in. Search queries can disclose
information from supplied context.

MCP services start disabled. Annotate accepts explicitly selected public HTTPS
remote services, without inherited credentials. It does not launch local stdio
servers. Redirects are denied. Review the destination, tool, and complete
arguments in each external tool-call approval before allowing it. Denying the
approval prevents that call. Messages, file uploads, publishing, and other
external actions require approval, even within a permitted note folder.

A remote service receives approved arguments under its own retention policies.
Claude does not expose these note, web, or MCP tools.

## Conversations and recovery

Replies stream into the thread. **Stop** cancels a response. Interrupted requests
are never resent automatically. **Start new conversation** recovers an interrupted
or unavailable session without deleting saved messages. Switching assistants
starts a new provider session and supplies the saved annotation history. Each
saved response keeps its assistant name, including in copied conversations.

Edits, removals, and local comments enter subsequent context. Claude receives the
saved conversation on each request; Codex starts a new session when history changes.

## Skills

Codex skill discovery and execution are unavailable in the first release.
Installed skills do not use Annotate's checked note operations and are not inherited.

Organization-managed Claude policies and hooks may still apply, including hooks
that receive request content. See the [Claude CLI reference](https://code.claude.com/docs/en/cli-reference#cli-flags)
and [managed hook controls](https://code.claude.com/docs/en/hooks#disable-or-remove-hooks).
