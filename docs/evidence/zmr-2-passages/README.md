# ZMR-2 — Bounded passage retrieval

Issue: [#1190](https://github.com/zenod-ai/zenod/issues/1190). Parent release: [#1188](https://github.com/zenod-ai/zenod/issues/1188).

Pinned base: `c823d06e9cbe279a9a03ebf0e4d6d5e3ad6ba175` (ZMR-1 #1201 integrated). Worker: ZMR-2-passage-worker. Worktree: `/Users/jordi/Documents/GitHub/wt-zmr-2`, branch `codex/zmr-2`. Exact final PR head and checks are recorded in the issue handoff; this document is committed with the implementation it describes.

Environment: isolated local macOS, Node 22.22.3, Vitest 4.1.10, dependencies installed with `npm ci --ignore-scripts`. No live vault, customer tenant, model API, remote Drive publication, credentials or deployed candidate exercised.

## Contract and reuse

The internal `read_note(path, {part?, query?, cursor?, maxChars?})` callback now returns a JSON passage envelope. Public `get_memory` keeps its full note/exact-entry contract and schema. Existing host-preloaded pinned context still takes precedence and remains isolated; its legacy full-block reread response is unchanged.

- `maxChars` bounds body output to 256–8000 UTF-16 units (default 8000); envelope metadata is additional. Surrogate pairs are never split.
- Body reads stop at the current section/evidence boundary. `part=frontmatter` separately traverses metadata within the same size budget; `frontmatterChars` advertises its size and exact anchored requests cannot read file metadata. `readPath` is the path to reuse with `nextCursor`; `identity` identifies the returned anchored evidence or versioned section offset.
- `extent` exposes body offsets, whole-body total, requested scope boundaries and section boundaries. `truncated`/`omittedBefore` disclose text outside this response. Starting again without cursor/query reaches the beginning.
- A literal `query` locates text anywhere within the requested scope. A miss returns `queryMatched: false` with ordinary read/continuation metadata; it is not an absence verdict. Search ranking/semantic retrieval is unchanged.
- Cursor scope binds the vault's real path, provider, note path, requested anchor, selected part and provider revision. A content digest additionally detects local edits; wrong-scope, malformed and stale cursors fail with restart instructions.
- Source revisions and URLs come from the existing repository/source resolver. GitHub URLs are pinned when the engine has its configured GitHub location; otherwise the adapter's existing canonical URL is retained alongside `revisionId`. Drive URLs remain Drive URLs. Content `version` separately identifies the read material.
- Evidence splitting reuses the existing heading parser, extended to recognize legacy single-space anchor separators. Exact anchored traversal cannot include a neighboring entry. General sections work for legacy extensionless notes as well.
- The shared note fetch now rejects machine-directory paths and cross-vault symlinks, and normalizes backslashes before validating traversal.
- Q&A grounding accumulates actual passage bodies across reads and reconstructs each entry by host-verified anchor, source version and offsets before applying question relevance. This preserves heading-free continuation citations without allowing an unrelated traversed entry to validate a narrow answer. Envelope metadata and search snippets are not treated as factual body evidence. Ordinary note citations retain their existing file path; evidence citations carry exact anchors.

This is a BUILD extension of inspected existing primitives: `getNote`, the shared evidence heading parser, `VaultRepository.currentRevision`, source resolution, internal read callbacks, and AI SDK tool registration. No provider-specific replacement subsystem or ZMR-3 structural pagination change is introduced.

## Synthetic acceptance

[Public-seam tests](../../../packages/server/test/zmrPassage.test.ts) reuse the unchanged [ZMR-1 manifest](../../../packages/server/test/fixtures/zmr/manifest.json), generator and GitHub/Drive-shaped fixtures. The earlier [frozen baseline evidence](../zmr-1-baseline/README.md) and its JSON reports are unchanged. The runnable baseline observer now follows continuation and asserts the fixed late-answer outcome; its historical evidence remains attributed to its original SHA.

Both provider lanes call real `ask_brain` and `get_memory` over the in-memory MCP transport and real engine. They recover `cobalt-seventeen` past character 8000, retain `Log/2026-01-01.md#^e-000001` in the answer/citations, traverse that oversized entry within a declared 16-read synthetic budget, preserve source provenance, exclude the neighboring color entry, and preserve pinned rereads and full/exact public gets. The broader baseline traversal uses an explicit 32-read fixture budget. These are scripted access proofs, not autonomous model-quality measurements.

[Reader tests](../../../packages/core/test/passage.test.ts) additionally verify byte-equivalent body reconstruction under 701-unit Unicode chunks, section traversal, missing/legacy anchors, extensionless and empty notes, invalid budgets, corrupt/wrong-source/tenant/stale-version cursors, path traversal and cross-tenant symlink rejection. [AI SDK tests](../../../packages/core/test/aisdk-retrieval-retry.test.ts) verify options are exposed and forwarded through the real answer tool registration.

## Validation

- `npm run build -w zenod`: pass.
- `npm run build -w @zenod/mcp-chassis`: pass.
- `npm run typecheck -w @zenod/server`: pass.
- `npm run test -w @zenod/server -- test/zmrPassage.test.ts test/zmrBaseline.test.ts test/mcp.test.ts`: 35/35 pass.
- `npm run test -w zenod -- test/passage.test.ts test/aisdk-retrieval-retry.test.ts test/memoryEntries.test.ts test/ops.test.ts test/engine.test.ts test/aisdk-budget.test.ts`: 180/180 pass. After adding the metadata case and final cursor/path checks, targeted passage + retry tests pass 12/12, passage + operations pass 23/23, and rebuilt public passage/baseline tests pass 4/4. These follow-up runs overlap the earlier suites; they are not additional distinct test counts.
- `node scripts/build-tool-output-schemas.mjs --check`: all 27 self-contained public schemas pass; no schema changes.
- `git diff --check`: pass.

During development, focused tests identified and corrected ordinary-note citation path drift and an overstrong test assumption that GitHub source URLs are immutable without engine location configuration. Existing scoping tests now request their intended passage explicitly through the bounded interface.

## Limits and next action

The disk reader still loads a whole local note to locate sections; this bounds model input, not disk I/O or repository sync cost. Frontmatter is separately traversable with `part=frontmatter`; public full-note reads retain their original representation. Query location is literal and is not semantic search. Tool rounds remain governed by the existing answer-loop budget, with explicit partial-coverage instructions. Real-model completeness/abstention, latency, cost, remote provider operation and the final live journey remain ZMR-8 measurements/gates. No deployment or human SHIP acceptance is claimed.

Ready for independent review and manager integration after exact-head checks. ZMR-3 remains a separate sequential ticket; no spine changes were made here.


## Independent review corrections — 2026-09-06

Review of `ecc330c4ba39e39b8089c9f31cccc1784cc1f947` identified two P2 regressions; that candidate was not integrated.

1. Exact anchored rereads inside a multi-entry pinned context previously returned all pinned entries, and a missing anchor could return data. Explicit anchors now always use the exact bounded reader and fail for missing anchors. A plain file reread without options retains the legacy concatenated pinned response. File rereads with bounded options traverse only the pinned entries, including across gaps containing unpinned neighbors; query location and cursor scope cannot cross those gaps. File frontmatter remains unavailable through a restricted pinned read.
2. Verified passage identity previously bypassed question relevance. Grounding now groups actual returned chunks by path, anchor and content version, sorts/merges their offsets without filling unread gaps, then applies the existing question-scope filter to each reconstructed evidence entry. Only explicit host-pinned context bypasses that filter. Anchor metadata establishes identity, not factual relevance.

The engine regression now actually traverses the entire target-plus-distractor log with 512-unit cursors, with the target marker and answer separated across chunks. It proves the supported literal/citation survive while the unrelated neighbor's literal and its real valid citation are removed. The pinned regression exercises two selected entries separated by an unpinned neighbor, exact query/continuation budgets, legacy whole-file behavior and a nonexistent anchor. Public MCP checks exercise the multi-pinned exact/missing-anchor behavior on both providers.

Correction validation: engine + passage tests **73/73**; other focused retrieval/entries/operations/model-budget suites **109/109**; public MCP passage/baseline/existing tests **35/35**. Core build passes. Exact corrected head and remaining CI/review status are recorded in #1190. No live changes or deployment.
