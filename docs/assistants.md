# Assistant replies

[Back to README](../README.md)

Local comments do not require an assistant account. In Annotate settings, select
an assistant and enable it to request replies. With assistants disabled, plain
messages stay local. Type `@` for assistant mentions and `@comment`.

The official build supports ChatGPT, Claude, and OpenCode. Each integration uses
a separately installed local CLI, as described below.

For implementation context, see [agent tools and permissions](agent-tools.md)
and [the request flow](architecture.md#assistant-request-flow). For recovery-file
locations, see [storage and limits](storage-and-limits.md).

## Accounts and availability

| Assistant | Account and setup                                                                                                         | Mention     |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | ----------- |
| ChatGPT   | ChatGPT account with Codex access, a compatible Codex CLI, and a file-based login.                                        | `@chatgpt`  |
| Claude    | Claude subscription and Claude Code signed in through `claude auth login`. API-key login is not used.                     | `@claude`   |
| OpenCode  | OpenCode CLI **1.19.2**. Connect a provider account when required by the selected model. Other CLI versions are rejected. | `@opencode` |

Annotate does not include a provider subscription. Provider usage limits and data
policies apply. When requests are available, ChatGPT sends supplied context to
OpenAI and Claude sends it to Anthropic over the network. OpenCode sends context to the model provider selected in Annotate. That provider’s credentials and usage
charges apply. CLI authentication also
contacts the selected provider.

## Connect an assistant

1. Install and sign in to the CLI for the assistant you want to use, as described below.
2. Open **Settings → Annotate** and click **Check** on that assistant's row.
   Wait for **Connected** and **Ready**. This checks the connection without
   enabling assistant replies or sending a note.
3. Choose **Default assistant** and enable **Ask AI in comments**. For ChatGPT,
   also grant access to the folder containing the note you want to send.
4. Try a question in a synthetic note. **Check** alone does not test a full answer.

If the CLI cannot be found, expand **Advanced** and set **ChatGPT command**,
**Claude command**, or **OpenCode command** to its executable path, then click
**Check** again. Bare command names also search common installation directories
when Obsidian's GUI `PATH` differs from Terminal's.

### ChatGPT through Codex

On macOS, the default `codex` command prefers an executable bundled at one of
these locations, in this order:

```text
/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex
/Applications/Codex.app/Contents/Resources/codex
```

If neither is available, Annotate searches for a standalone `codex` executable.
The bundled-CLI preference also applies to standard standalone Codex paths;
entering one of those paths does not force Annotate to use it.

The recorded `0.3.1` integration check used the first path with Codex CLI
`0.162.0-alpha.17.2`. This is a verified environment, not a minimum-version rule.
The code checks capabilities rather than a version number: the CLI must support
strict configuration and Annotate's restrictive permission profile. An older,
newer, or standalone CLI is compatible only if it passes these checks.

Run the chosen executable's `login` command and sign in with a ChatGPT account
that can use Codex. Annotate requires a file-based login. For example, when using
the first bundled path:

```sh
annotate_codex="/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
"$annotate_codex" --version
"$annotate_codex" -c 'cli_auth_credentials_store="file"' login
```

Replace the executable path if your installation differs. The file setting writes
the login to `auth.json` under `CODEX_HOME`, or `~/.codex` by default. See
[OpenAI's credential storage documentation](https://learn.chatgpt.com/docs/auth#credential-storage).
The login contains credentials; keep it private. Annotate links the login file
to its isolated Codex home. Keychain-only logins and API-key logins do not satisfy
this integration. If you use a custom `CODEX_HOME`, it must also be visible to
the Obsidian process; setting it only in a Terminal session does not configure
an already-running Obsidian app.

If **Check** reports that the CLI cannot enforce Annotate note boundaries, use a
compatible CLI and retry. Signing in again does not add missing CLI capabilities.
Annotate refuses the connection before sending note context.

### Claude through Claude Code

Install Claude Code and sign in with your Claude subscription:

```sh
claude --version
claude auth login --claudeai
claude auth status
```

Use **Claude command** in Advanced if `claude` is not found. Annotate requires
the CLI to report a logged-in `claude.ai` account; Anthropic Console/API-key
authentication is not accepted. The recorded `0.3.1` integration check used
Claude Code `2.1.289`. The code does not pin a Claude version.
Annotate removes `CLAUDE_*` environment overrides, including a custom
`CLAUDE_CONFIG_DIR`, so use the standard Claude Code login environment.

### OpenCode

The current code accepts OpenCode CLI `1.19.2` only. Set **OpenCode command** if
needed, click **Check**, and choose an available model. Provider authentication,
when needed, is configured through `opencode auth login`. A free model may be
available without connecting another provider; availability is provider-controlled.

## Files outside the vault

Annotate searches standard executable locations outside the vault to find Codex,
Claude Code, and OpenCode. The ChatGPT model picker reads `~/.codex/models_cache.json`.
When ChatGPT is enabled, Annotate creates a separate Codex home for the vault
under `~/.annotate/codex/` and links its `auth.json` to the existing Codex login
file, using `CODEX_HOME` when configured. Keychain-only Codex logins are not
automatically shared. The isolated home holds Codex's session and runtime data.

The integrations create temporary working directories outside the vault, and
the CLIs access their provider authentication data. These locations support CLI
discovery, authentication, and conversation state; they are separate from the
vault folders granted to assistant note tools.

## OpenCode runtime and models

The main model picker shows DeepSeek V4.1 Flash Free and GLM 5.3 Flash Free
when the CLI makes them available. **Others** opens a searchable list of all
models, grouped under **Free**, **Paid**, or **Price unavailable** using the
CLI’s reported input and output prices. A model chosen in Others remains
visible as the current selection. Automatic selection prefers DeepSeek, then
GLM, then another available free OpenCode model. An explicitly selected model
takes precedence. Free model availability and limits depend on OpenCode.

Model discovery and the **Free** price label do not prove that OpenCode’s
free-tier service will accept a request. This restricted integration has received
HTTP 403 `FreeTierError`. OpenCode also has an
[open report about free-tier failures with restricted tools](https://github.com/anomalyco/opencode/issues/50627).
When rejected, Annotate shows the provider’s error category. Use OpenCode
directly or select another supported provider/model through **Others**.
Synthetic requests to both featured free models succeeded on CLI 1.19.2 with the execution guard. Availability and limits remain provider-controlled.

Before starting its server, Annotate runs `opencode models --refresh --pure`
in the isolated environment so the model picker uses the updated catalog.
If the refresh command fails, it uses the CLI’s cached list and shows a warning.

OpenCode runs a private, password-protected server on the loopback interface.
Annotate gives it temporary configuration, cache, state, and data directories,
and links its `auth.json` to the existing OpenCode login at
`$XDG_DATA_HOME/opencode/auth.json` or `~/.local/share/opencode/auth.json`.
It does not copy the login file. Runtime session data is removed after the
server exits. Existing OpenCode conversations and configuration are not used.
Custom provider endpoints and external authentication plugins from that
configuration are unavailable. Organization credentials that load remote
configuration are rejected.

## What a request shares

An assistant request supplies the complete current note, selected passage,
question, reply quotes, and annotation conversation. The conversation can include
earlier local comments and edited messages.

Start with `@comment` to save without an AI reply. Annotate removes that prefix
from the saved text. This prevents an immediate request. It does not permanently
exclude the comment from later assistant context. Local commenting and manual
highlighting work with assistants disabled.

Do not include information you do not want to share in a note or conversation
you send to an assistant.

Comments and settings live in the vault's plugin data. Your vault's sync and
backup tools may copy that data elsewhere. The provider and CLI may also retain
request data under their own account settings and policies. Annotate's local
history cannot retract information already sent to a provider or another service.

## Access boundaries

Terminal execution is unavailable in this release.

Claude receives supplied context as text with tools disabled. OpenCode keeps its
tool definitions available for free-model compatibility, but an Annotate-owned
local plugin rejects every model tool call before execution. Both integrations
exclude host custom instructions, external plugins, and MCP configuration.
OpenCode verifies the CLI version, effective configuration, and a private guard
registration receipt at connection and for every session before sending context.
Missing or invalid receipts stop the request. The receipt checks registration;
the supported CLI is separately tested with synthetic tool calls. Permission
requests are also rejected. This is an application execution boundary, not an OS
sandbox. Built-in OpenCode authentication plugins remain available.

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
Claude and OpenCode do not expose these note, web, or MCP tools.

## Conversations and recovery

Replies stream into the thread. **Stop** cancels a response. Interrupted requests
are never resent automatically. **Start new conversation** recovers an interrupted
or unavailable session without deleting saved messages. Switching assistants
starts a new provider session and supplies the saved annotation history. Each
saved response keeps its assistant name, including in copied conversations.

Edits, removals, and local comments enter subsequent context. Claude and OpenCode receive the
saved conversation on each request; Codex starts a new session when history changes.

## Skills

Codex skill discovery and execution are unavailable in the first release.
Installed skills do not use Annotate's checked note operations and are not inherited.

Organization-managed Claude policies and hooks may still apply, including hooks
that receive request content. See the [Claude CLI reference](https://code.claude.com/docs/en/cli-reference#cli-flags)
and [managed hook controls](https://code.claude.com/docs/en/hooks#disable-or-remove-hooks).
