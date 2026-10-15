# Security policy

Annotate stores comments and settings in the vault's plugin data. Assistant replies
are optional and send note content to an external provider. Read
[assistant setup and privacy](docs/assistants.md) before enabling them.

## Reporting a vulnerability

Do not put private notes, access tokens, account details, or a working exploit
against another user's vault in a public issue.

If GitHub offers **Report a vulnerability** in this repository's Security tab,
use it to contact the maintainer privately. If private reporting is unavailable,
open an issue asking for a private contact method without publishing the exploit
or sensitive data.

Describe the affected version, operating system, Obsidian version, prerequisites,
and the smallest reproduction using synthetic notes. Explain what an attacker
can read, change, or send. Redact logs and screenshots before sharing them.

## Supported releases

No security support window or response-time guarantee has been established.

## Security boundaries

[Agent tools and permissions](docs/agent-tools.md) describes the enforced
boundaries and their limits.

Recoverable note history helps undo local changes. It cannot undo information
already sent to an assistant, a search service, or another external service.
