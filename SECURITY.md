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
or sensitive data. Private reporting availability has not been verified.

Describe the affected version, operating system, Obsidian version, prerequisites,
and the smallest reproduction using synthetic notes. Explain what an attacker
can read, change, or send. Redact logs and screenshots before sharing them.

## Supported releases

No security support window or response-time guarantee has been established.
Use the latest published release and review its release notes. A successful build
or dependency audit does not establish that a release is secure.

## Security boundaries

Assistant permissions must be enforced by Annotate's tool handlers and provider
configuration. Instructions in a note, assistant response, or skill cannot grant
access. Hidden vault configuration, plugin code, credentials, and unrelated
folders must remain outside ordinary note tools.

Recoverable note history helps undo local changes. It cannot undo information
already sent to an assistant, a search service, or another external service.
