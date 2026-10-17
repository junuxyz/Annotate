# OpenCode free-tier investigation

[Assistant setup](assistants.md) · [Testing](testing.md)

The investigation on October 16, 2026 used short synthetic messages, no
OpenCode account credentials, and no personal notes. The initial production configuration denied all tools. Later implementation
uses the execution guard described at the end of this report.

## Measured results

| Probe                                                                                                       | Result                   |
| ----------------------------------------------------------------------------------------------------------- | ------------------------ |
| Installed CLI 1.14.21, Annotate agent, all tools denied                                                     | HTTP 403 `FreeTierError` |
| Same, explicitly sending the actual CLI version as User-Agent                                               | Same rejection           |
| Shell tool requiring approval, every approval rejected, shell executable unavailable                        | Same rejection           |
| Built-in build agent instead of Annotate's system prompt, same restrictions                                 | Same rejection           |
| Temporary CLI 1.19.2, built-in build agent, same restrictions                                               | Same rejection           |
| Documented inference endpoint, GLM 5.3 Flash Free, no Authorization, truthful Annotate User-Agent, no tools | HTTP 403 `FreeTierError` |

The temporary 1.19.2 binary was downloaded from the official npm package and its
SHA-512 integrity checked against registry metadata. The installed CLI was not
replaced. These probes do not establish which complete combination of request
fields the hosted service accepts.

## Approval rejection is insufficient

A local synthetic model explicitly requested two operations against disposable
files in the CLI's temporary working directory:

- `printf synthetic > annotate-command-probe` was rejected without creating a file.
- `> annotate-redirection-probe` created a file without a permission event.

OpenCode 1.14.21's [shell tool](https://github.com/anomalyco/opencode/blob/v1.14.21/packages/opencode/src/tool/bash.ts)
returns from its approval helper when no command patterns are collected. A
redirection-only expression can reach shell execution through that path.
Consequently, retaining the shell tool and rejecting approval events does not
preserve Annotate's prohibition on command and filesystem operations.

Pointing the isolated child's `SHELL` to a nonexistent path blocked both probes,
but did not restore free-model access. It is an experiment, not a supported
plugin configuration or a general sandbox guarantee.

The historical permission-only probe has been replaced by the supported CLI's
local execution-guard protocol test:

```sh
ANNOTATE_OPENCODE_EXECUTABLE=/absolute/path/to/opencode \
node --import tsx --test tests/opencode-protocol.test.mjs
```

It uses only synthetic credentials, notes, and a local model server.

## Upstream evidence and remaining uncertainty

- [#50627](https://github.com/anomalyco/opencode/issues/50627) reports free-tier
  failures with restricted tools across V1 and V2.
- [#54744](https://github.com/anomalyco/opencode/issues/54744) reports failure
  in V2.0.27 even with eight tools including shell and read. Merely retaining
  one tool is not a demonstrated general fix.
- [#49756](https://github.com/anomalyco/opencode/issues/49756) was initially
  attributed to User-Agent, but later comparisons found identical headers on
  successful and failing requests. Its V1 closure does not establish a fix.
- [#55432](https://github.com/anomalyco/opencode/issues/55432) and
  [#55619](https://github.com/anomalyco/opencode/issues/55619) report that
  `opencode auth login opencode` fixed separate V2 cases. Authentication has
  not been tested here and does not establish compatibility with denied tools.
- The [official inference documentation](https://opencode.ai/v2/docs/console/api/inference/)
  says free chat supports requests without Authorization. The measured direct
  request was nevertheless rejected. This mismatch remains unresolved.

The configured CLI auth file contained no OpenCode provider credential. For the
installed V1 CLI, `opencode auth login --provider opencode` selects that provider;
the positional `opencode` command in the V2 reports should not be assumed to be
the equivalent V1 syntax. Account entry must happen outside the synthetic test
profile.

After the user registered an OpenCode API credential, the unchanged backend was
probed again with a short synthetic prompt and its normal tool restrictions.
The CLI reached `ready`, but both `opencode/deepseek-v4.1-flash-free` and
`opencode/glm-5.3-flash-free` returned `FreeTierError` with no response text.
Credential presence and type were checked without printing its value. This
does not independently establish credential validity; registration alone did
not resolve the observed rejection. No credential was copied into test fixtures
or reports.

A successful request with Annotate's exact restrictions remains unverified.
Logging in, upgrading, and changing transport must not be presented as confirmed
fixes without that test. This investigation does not verify free-account
onboarding or any billing requirements.

## Working experimental combination

Further synthetic probes after credential registration found a working
combination. This is not the current production configuration:

- Official npm CLI **1.19.2**, downloaded temporarily and SHA-512 checked against
  registry integrity metadata; the installed 1.14.21 CLI was not replaced.
- Built-in `build` agent, without Annotate's custom system message.
- Tool permissions set to `ask`, preserving the CLI-generated tool definitions.
- An explicit local plugin whose `tool.execute.before` hook always throws.
  `--pure` was removed in the experimental backend so this plugin could load.
  A private marker confirmed plugin initialization before sending the prompt.
- The existing OpenCode credential, linked by the normal runtime backend;
  no credential value was printed or copied into fixtures.

Both `opencode/deepseek-v4.1-flash-free` and
`opencode/glm-5.3-flash-free` completed a synthetic request, each returning two
characters. The same agent/hook combination on 1.14.21 still returned
`FreeTierError` for both models. These comparisons establish a working
combination, not which individual change is necessary or the server's predicate.

Before the live probes, a local synthetic model on 1.14.21 requested ordinary
shell execution, redirection-only shell execution, and reading a synthetic file.
All three were intercepted by the hook; no shell sentinel file was created,
and the model received the hook's denial. Eleven tool definitions were present.
Equivalent adversarial execution checks on **1.19.2** remain pending. The plugin
initialization marker alone is not proof that every execution path is blocked.

Do not ship this experiment without failing closed on missing or failed plugin
loading, checking actual interception on the supported CLI, and retaining
private configuration, loopback authentication, and context-only behavior.
Plugin loading failure is swallowed by OpenCode, so a healthy server or a
plugin entry in config is insufficient. The hook is not an OS sandbox.

Other transport comparisons did not produce an answer: current documented
inference HTTP requests with the registered key returned `FreeTierError` for
both models; ACP initialized and created a session with all tools denied but
returned zero answer characters for both. The ACP probe did not capture a
structured provider error, so it does not establish the same cause.

Relevant sources:

- [Official editor integration through ACP](https://opencode.ai/docs/acp/).
- [Official pre-execution denial example](https://opencode.ai/docs/plugins/#env-protection).
- [Maintainer statement about third-party free-tier restrictions](https://github.com/anomalyco/opencode/issues/49621#issuecomment-5723383322).
- [V1 plugin loading and hook dispatch](https://github.com/anomalyco/opencode/blob/v1.14.21/packages/opencode/src/plugin/index.ts).

This is technical evidence of successful requests through an official CLI,
not confirmation that OpenCode endorses this integration or guarantees future
free-tier access.

## Minimal-change follow-up

A later controlled probe changed **only the executable to 1.19.2**, retaining
the production all-denied configuration, custom Annotate agent, system message,
and `--pure`. Both featured free models still returned `FreeTierError`.
Updating alone therefore did not resolve this reproduction.

With the same 1.19.2 executable, preserving the **original custom Annotate agent
and original system message**, changing permissions to `ask` and adding the
explicit local execution-denial hook produced completed responses from both
featured free models. The initialization marker was checked before each live
backend was used. Switching to the built-in `build` agent and removing
Annotate's system message are therefore unnecessary for this observed working
combination. Full execution-interception checks were still pending at that stage; the implemented guard below has since passed them.

The local approval-rejection probe was also repeated with 1.19.2. Both the
ordinary and nonexistent-`SHELL` profiles executed the redirection-only command
without a permission request. The script correctly failed its safety assertion
for the latter profile. The earlier nonexistent-`SHELL` result on 1.14.21 must
not be generalized to 1.19.2. No host credential or real model was used for
these local execution probes.

## Implemented execution guard

The backend now supports exactly CLI 1.19.2, preserves the Annotate agent and
system message, and registers one dependency-free local plugin. Tool permissions
are `ask`, while `tool.execute.before` rejects every model tool execution. The
server omits `--pure` only to load this private guard; its isolated config has no
other external plugin or MCP entries. Catalog refresh still uses `--pure`.

OpenCode can swallow plugin registration failures. A private per-session receipt
from the registered event hook is therefore required both during connection and
before each context request. An absent or mismatched receipt fails closed. This
receipt proves registration, not universal execution interception. The real
1.19.2 protocol test separately requested every advertised tool plus a
redirection-only shell command and verified rejection before execution, unchanged
synthetic files, and no synthetic file content in the model's tool results.
The hook does not sandbox OS activity or unrelated OpenCode API endpoints.

Catalog refresh and server state are also separated. A killed refresh process
left a dependency-install lock owned by a dead PID; the next server's `/config`
request waited about 59 seconds for it. A fresh final-code connection using
separate config, data, and state directories for the catalog completed in about
3.4 seconds in one diagnostic run. This is a startup diagnosis, not a performance
benchmark. Only the model cache is shared. The fixture leaves a synthetic stale
lock and verifies that it cannot affect the response server; the catalog process
also receives no host authentication.

The final product build passed offline lint/build/unit checks and the native
macOS offscreen `access,providers` scopes in Live Preview with the light theme
(31/31). Earlier runs exposed an Obsidian metadata-read race when an access test
created and deleted the same temporary file rapidly. The grouped-operation
fixture now uses separate creation and deletion notes and waits for indexing;
no console errors were filtered. Real login and OS permission grants were not
tested in that profile.

Final source probes through the normal backend received exactly `OK` from both
featured free models. The separate GLM confirmation completed in about 24
seconds using the backend's normal response deadline. Only a synthetic prompt
was sent; no personal note or credential value was logged. The installed
Homebrew CLI remains 1.14.21: Homebrew refused to load the untrusted
`anomalyco/tap` formula, so its trust settings and installation were not changed.
