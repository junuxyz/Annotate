# Assistant replies

[Back to README](../README.md)

On desktop, select an **Assistant** in Annotate settings and enable it.
Messages ask the selected assistant by default. Start with `@comment` to save a comment without an AI reply; the prefix is removed from the saved text. With AI disabled, plain messages stay local. Typing `@` offers assistant mentions and `@comment`.

| Assistant | Subscription login                                                                             | Mention    |
| --------- | ---------------------------------------------------------------------------------------------- | ---------- |
| ChatGPT   | Install Codex CLI and run `codex login`. Uses your existing Codex CLI configuration and login. | `@chatgpt` |
| Claude    | Install Claude Code and run `claude auth login` with a Claude subscription.                    | `@claude`  |

Set the executable path for Codex or Claude if needed, then click **Reconnect**.
Claude's model field accepts aliases such as `sonnet` or `opus`.

Replies stream into the thread. **Stop** cancels a response. Interrupted requests
are never resent automatically. **Start new conversation** recovers an interrupted
or unavailable session without deleting saved messages. Switching assistants
starts a new provider session and supplies the saved annotation history. Each
saved response keeps its assistant name, including in copied conversations.

Asking an assistant sends the complete current note, selected passage, question,
and annotation conversation to that provider, including earlier local comments. `@comment` does not start an AI request.
Codex retains a separate session for each annotation. It uses your normal Codex
configuration, skills, plugins and MCP servers, with live web search and full
filesystem/command access. Commands can read and write outside the vault when
you ask them to. Codex app-only tools that require a desktop client bridge are
not supplied by Annotate.
Claude receives the full saved history on each request. Claude runs outside
the vault with tools, custom instructions, plugins and MCP configuration disabled.

## Codex skills

Type `/` after `@chatgpt` or `@claude` to search installed Codex skills.
A bare `/` does not open the skill picker.
Use the arrow keys to choose a skill, then Enter or Tab to complete its name.
Press Escape to dismiss the menu. Completion does not send the comment.

Send `@chatgpt /skill-name your question` to invoke that skill through ChatGPT. A skill without a question applies to the highlighted passage. Unknown
slash commands are sent as question text. The assistant must be enabled to send
a skill request.

`npm run check:codex-skills` verifies discovery and explicit skill invocation
with the signed-in CLI and a disposable synthetic skill.
