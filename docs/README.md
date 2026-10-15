# Documentation map

Annotate attaches comment threads to selected passages in Markdown notes. It also
supports note highlights, text colors, and optional assistant replies. The current
release target is desktop Obsidian 1.14.4 or later.

## Use Annotate

| Task                                                     | Read                                        |
| -------------------------------------------------------- | ------------------------------------------- |
| Install and create a first comment                       | [Project README](../README.md)              |
| Comment, resolve, format, highlight, or assign shortcuts | [Usage](usage.md)                           |
| Connect an assistant and understand what it receives     | [Assistant replies](assistants.md)          |
| Back up data or recover missing text and sync conflicts  | [Storage and limits](storage-and-limits.md) |

## Change Annotate

Read [AGENTS.md](../AGENTS.md) first when working as an agent. These references
describe the implementation and the decisions that future changes must preserve.

| Question                                                  | Read                                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Where does a feature live, and how does a request flow?   | [Architecture](architecture.md)                                                                     |
| What can an assistant do, and where is access enforced?   | [Agent tools and permissions](agent-tools.md)                                                       |
| How do I build and update a development vault?            | [Development](development.md)                                                                       |
| Which tests cover my change, and what counts as evidence? | [Testing](testing.md)                                                                               |
| What changed in the first-release hardening work?         | [First-release changes and readiness](first-release.md)                                             |
| How do I prepare the exact files for a tag?               | [Release procedure](development.md#releases) and [full checklist](../test-vault/E2E%20checklist.md) |
| How do I contribute or report a vulnerability?            | [Contributing](../CONTRIBUTING.md) and [security reporting](../SECURITY.md)                         |

## Keep context current

Use source symbols and repository-relative file links in technical docs. Avoid
machine-specific paths, model availability claims, or a second copy of a schema.
Link to the schema or command that defines a changing value. Historical validation
results describe one build and environment; they do not certify later changes.

When changing a tool, update its permission reference and tests. When changing
saved data, document compatibility and recovery. When changing a visible command,
update usage and its default shortcut. Update the test mapping if coverage moves.
