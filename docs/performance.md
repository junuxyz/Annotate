# Rendering performance

Run the synthetic benchmark from the repository root:

```sh
node --expose-gc scripts/benchmark-rendering.mjs
```

It bundles the current highlight module into a temporary directory, runs three
warmups and nine samples per workload, and removes its temporary files. It uses
no vault, provider account, network request or Obsidian process. An optional
absolute path argument loads an earlier bundled module for comparison.

The output includes UTF-16 source length, median wall time and mean immediate
JavaScript heap growth across samples. Garbage collection runs before each
sample. Heap growth is neither peak memory nor retained memory; collection during
a sample can affect it. Compare on the same runtime and machine. These numbers
measure individual functions, not application startup or total Obsidian memory.

## October 19, 2026 comparison

Measured on macOS arm64 with Node v26.0.0, against a bundle of the working source
captured before this refactor, including its pre-existing uncommitted changes.
Both bundles used the same script and synthetic inputs.

| Workload                                  | UTF-16 units | Before median | After median | Before heap growth | After heap growth |
| ----------------------------------------- | -----------: | ------------: | -----------: | -----------------: | ----------------: |
| Discover styles in plain Markdown         |       62,000 |      47.56 ms |      0.01 ms |          13.65 MiB |          0.01 MiB |
| Discover highlight and text-color ranges  |      100,000 |      33.91 ms |     16.30 ms |          31.44 MiB |          8.34 MiB |
| Parse stripped syntax, many styled ranges |      100,000 |       5.48 ms |      4.78 ms |          11.52 MiB |          9.32 MiB |
| Parse stripped syntax, one styled range   |      496,055 |      54.73 ms |     45.88 ms |          38.94 MiB |         35.42 MiB |

Style discovery now skips unstyled documents and shares one Markdown parse between
highlight and text-color scans. Editor consumers share the result through a
`WeakMap` keyed by the immutable CodeMirror document. Cache values hold ranges,
not the document or its syntax tree. Old documents can be collected when their
editor states are released.

Stripped syntax stores source boundaries per styling tag instead of arrays per
character. Source mapping uses binary search over these boundaries. Reading-mode
section bounds stop at the requested line and no longer allocate a list of every
line start. Conversation updates index message elements once per refresh instead
of searching the whole message list for every comment.

Offline tests cover nested tags, uppercase attributes, Korean and surrogate pairs,
source boundaries, immutable-document cache invalidation, Reading selection,
long-conversation updates and renderer cleanup. Native Obsidian layout and
whole-process heap retention require separate measurements under the repository's
explicit native-test policy.

## Follow-up toward tenfold style discovery

A subsequent pass uses a direct scan for canonical Annotate tags in ordinary
paragraphs. It falls back to the Markdown parser for code, math, links, wiki links,
escaped syntax, foreign HTML, standalone HTML tags, lists, indented code and tilde fences.
A differential test compares direct discovery with parser discovery across inline,
block, nested-list and malformed-tag contexts.

The mixed-content workload exposed repeated linear searches through native component
ranges. Exclusion lookup now uses binary search; the style traversal advances past
completed components in source order. Math splitting also skips its parser when
there are no possible math delimiters.

Re-ran all three implementations with the same updated benchmark on the same
runtime and machine. The mixed workload repeats a paragraph containing both
styles, a link, inline code and math.

| Workload                            | Original median | First pass median | Current median |            Original / current |
| ----------------------------------- | --------------: | ----------------: | -------------: | ----------------------------: |
| Plain discovery, 62,000 units       |        43.06 ms |           0.01 ms |        0.01 ms | Below useful timing precision |
| Styled discovery, 100,000 units     |        30.93 ms |          15.53 ms |        0.35 ms |                         88.4× |
| Mixed discovery, 139,000 units      |       251.63 ms |         178.15 ms |       37.95 ms |                          6.6× |
| Stripped syntax, many styled ranges |         5.01 ms |           4.05 ms |        4.58 ms |                          1.1× |
| Stripped syntax, one styled range   |        53.19 ms |          42.58 ms |       46.42 ms |                          1.1× |

The styled-discovery workload exceeds tenfold improvement both against the original
and against the first pass. The mixed workload improves 4.7× over the first pass;
it still requires Markdown parsing. Complete rendering and application performance
have not been shown to improve tenfold.

Mean immediate heap growth in these samples fell from 31.52 to 2.17 MiB for styled
discovery and from 33.80 to 11.98 MiB for mixed discovery. These remain transient
heap observations, not peak or retained-memory measurements.
