# ZMR-4 — Typed Q&A retrieval and honest coverage

Issue: [#1192](https://github.com/zenod-ai/zenod/issues/1192). Release: [#1188](https://github.com/zenod-ai/zenod/issues/1188).

Pinned base: `dadd88350b2bca896fc8f605bcf4c0f2c2ff261c` (reviewed ZMR-3 #1204 integrated). Worker `/root/zmr_4_typed_retrieval`, branch `codex/zmr-4`, worktree `/Users/jordi/Documents/GitHub/wt-zmr-4`. Exact final head and CI/review disposition are recorded in the issue handoff. This evidence is committed with the implementation it describes. No spine edits.

Environment: isolated local macOS, Node 22.22.3, Vitest 4.1.10, dependencies from `npm ci --ignore-scripts`. Existing local Git fixture and Drive repository double, deterministic scripted LLM seam, unchanged [ZMR-1 manifest](../../../packages/server/test/fixtures/zmr/manifest.json). No model API, customer data, remote Drive operation, credentials, deployment, billing or signup changes.

## Shared behavior

`ask_brain` now provides `search_entries` to its read-only answer loop with typed query, source, sourceId, contentType, capturedAfter/capturedBefore, order, page limit, cursor and exhaustive flag. It reuses the ZMR-3 pagination/selection primitives and ZMR-2 exact bounded passage reader. MCP `search_memory` and MCP-backed `ask_brain` call the **same tenant-scoped catalog helper**, including complete retained-receipt enrichment before filters and pagination. Direct core `engine.ask` has the same entry capability over local vault evidence; without the MCP host adapter, it explicitly reports receipt enrichment unavailable. The normal tasking/chat mutation loop is unchanged.

An exhaustive call enumerates before returning the catalog to the model, up to eight total page attempts per ask and twenty entries per page. All callbacks share the reservation budget, including concurrent calls. Exact body reads have a separate 64-attempt limit and retain the existing 256–8000 UTF-16-unit passage limit. Failed attempts consume reservations. Search result snippets remain discovery metadata; source bodies must be read separately. Final snapshot rechecks are metadata validation reads, one per distinct observed query scope; they do not yield another result page to the model.

`exhaustive: true` is the typed trigger. A conservative English exhaustive/audit-question detector also enables the guard when the model omits the flag. This is not a general natural-language scope parser: the result echoes the actual typed filters, and interpretation of the user's desired scope remains a model-quality evaluation. Date normalization, lexical AND semantics, cursor/vault binding, process affinity and restart rules are the existing ZMR-3 contract.

## Host-owned evidence and coverage

The additive `coverage` object in `ask_brain.structuredContent` separates:

- Exact query/snapshot/local scope, matched versus enumerated entry counts, end-of-catalog state, retained-receipt availability and next cursor.
- Successful body-read identities, content versions and offsets; `complete` on a read record means **that version's evidence block/section** was read contiguously, not the whole file or semantic answer correctness.
- Enumerated entries still requiring complete reads, failed reads, pinned evidence refs and actionable search/read continuation inputs.
- Conversation-history search from durable memory retrieval. Chat search results never become durable source citations.

A bounded audit is complete only after its full matching catalog and every selected entry body have been read. A seek near the end of a long entry cannot stand in for its unread prefix. Source reads made before that catalog's enumeration do not certify its later snapshot; an old complete version cannot fill a newer version's unread gap. The host rechecks each catalog snapshot before returning, invalidating changed scopes and requesting a fresh restart.

If an exhaustive audit is incomplete, the host replaces the draft's potentially false complete answer with an explicit partial-coverage response and continuation. Complete responses state the actual typed scope in prose as well as structured coverage. A continuation into a new ask does not inherit proof of prior-turn reads: a final tail page alone cannot certify the whole catalog. Consumers can follow the same search cursor through public `search_memory`; changed filters, vault or snapshot still fail visibly. Narrow the scope or continue gathering evidence when a request exceeds the turn budget.

Pinned `contextRefs` remain primary host-resolved reads and retain the existing exact-anchor isolation and missing-anchor errors. Broader research stays available when needed. Sources now come only from successful host reads, never model-returned `readPaths` or search-hit fallback. The AI SDK records a read path only after the read succeeds. Search-only/citation-only drafts with no actual source text are replaced by an unverified-answer response. Existing exact-literal/anchor grounding still rejects unsupported fixture claims and unrelated narrow-question entries. Complete typed audits use their explicitly enumerated evidence scope, so generic date/audit words do not strip valid audit citations. The peer adapter preserves coverage while continuing to omit host-only read-only status from model answer content.

The generated `zenod.ask_brain` output schema now reflects the existing direct typed `answer_content` response, its additive coverage and explicit context-ref error, rather than the old unrelated evidence-envelope declaration. Public fixture answers validate against that schema. Public search/get behavior and provider-neutral source revision/URL identity remain intact.

## Synthetic acceptance

[Public MCP tests](../../../packages/server/test/zmrAsk.test.ts), for both GitHub and Drive fixture lanes:

1. A January 1 audit enumerates all five old entries in three two-entry pages, despite 651 newer entries. It fully traverses their exact bodies, recovers `cobalt-seventeen` beyond character 8000 and retains the correct old/current/distractor identities in the explicitly broad audit.
2. An eight-page audit stops after 160/657 entries, rejects the model's false complete claim and returns a cursor that public `search_memory` accepts with the same scope. Concurrent catalog calls cannot exceed eight attempts.
3. A complete catalog with only a late query seek stays partial with five unread entries and a restart for the missing prefix. Sixty-four passage attempts stop explicitly with read continuation.
4. A bounded empty query reports zero matching entries without fabricating a cited fact. Failed reads, fabricated `readPaths` and search-only citations cannot create supporting sources. The unknown exact literal and a narrow-query distractor are rejected.
5. Source/content/date filters find an old voice receipt beneath 510 newer pending jobs through the shared enrichment path; immutable vault content wins. Provider revisions and URLs remain provider-neutral.
6. Current and previous pinned capture followups select violet and amber respectively without broad search or neighbor leakage. Conversation-only evidence is reported separately from durable citations.
7. Normal asks leave the synthetic evidence file byte-identical and repository revision unchanged. A deliberate test-only mutation during synthesis invalidates snapshot completeness and prevents returning the old complete audit.

[Coverage edge tests](../../../packages/core/test/retrievalCoverage.test.ts) additionally cover tail-page incompleteness, pre-enumeration reads, current-version gaps and snapshot restart. AI SDK tests exercise the actual typed tool schema/forwarding, successful read-action timing and removal of the search-hit citation fallback. Existing capture-ticket context, passage isolation, historical traversal and provider-neutral engine suites remain part of validation.

## Validation

Final command results and exact candidate are recorded in issue #1192; the following local suites were run against this implementation:

- `npm run build -w zenod`; `npm run build -w @zenod/mcp-chassis`; `npm run typecheck -w @zenod/server`: pass.
- `npm run test -w zenod -- test/retrievalCoverage.test.ts test/engine.test.ts test/aisdk-retrieval-retry.test.ts test/aisdk-answer-sources.test.ts test/entryPagination.test.ts test/passage.test.ts test/memoryEntries.test.ts test/toolKinds.test.ts test/aisdk-budget.test.ts`: 185/185 pass.
- `npm run test -w zenod -- test/captureContextTicket.test.ts`: 4/4 pass.
- `npm run test -w @zenod/server -- test/zmrAsk.test.ts test/zmrHistory.test.ts test/zmrPassage.test.ts test/zmrBaseline.test.ts test/mcp.test.ts test/peerDiscovery.test.ts test/toolOutput.test.ts`: 86/86 pass.
- `npm run test -w @zenod/server -- test/ringCaptureTicket.test.ts`: 4/4 pass.
- `node --test scripts/build-tool-output-schemas.test.mjs`: 9/9 pass. `npm run schemas:check`: all 27 generated schemas self-contained. `git diff --check`: pass.

The first MCP test run found one old spy expectation that required exactly `{contextRefs}`; it now also verifies the host-only shared catalog callback. No acceptance was weakened. The prior Z-9 source-fallback test now asserts the intended new behavior: search hits are not successful reads.

## Limits and handoff

This is an access/coverage/control proof with scripted model behavior, not a claim of autonomous exhaustive retrieval or general semantic entailment. The existing sanitizer checks exact literals and evidence anchors; it is not a universal claim verifier. A successfully read citation establishes available evidence, not automatic support for every possible prose claim. Semantic answer correctness, abstention, interpretation of paraphrases/date scopes, latency and cost require ZMR-8's real-model runs and held-out evidence. The extra catalog snapshot checks and full-set scans have not been benchmarked on large customer vaults. Stored receipt retention and unsynchronized/deleted history keep their documented limits. No live candidate or human SHIP acceptance is claimed.

Ready for independent exact-head review and CI-gated manager integration. Parent delivery manager owns the merge and ZMR-5 dispatch; worker performs no deployment or live mutations.
