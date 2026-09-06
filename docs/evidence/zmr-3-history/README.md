# ZMR-3 — Complete historical entry search

Issue: [#1191](https://github.com/zenod-ai/zenod/issues/1191). Release: [#1188](https://github.com/zenod-ai/zenod/issues/1188).

Pinned base: `e8458a8a5176fb68376b0f9b599c480015a49941` (corrected ZMR-2 #1202 integrated). Assignment: ZMR-3-history-worker, branch `codex/zmr-3`, isolated worktree `/Users/jordi/Documents/GitHub/wt-zmr-3`. Exact review head is recorded in the issue handoff; this document travels with its implementation. No spine edits.

Environment: local macOS, Node 22.22.3 / Vitest 4.1.10, dependencies from `npm ci --ignore-scripts`. Synthetic local Git bare origin and the existing Drive repository snapshot double. No customer vault, model/API calls, new provider, deployment or remote Drive operation.

## Contract

`search_memory` retains `hits` and `entries` and adds `pagination` (null for text-only note search). `sourceId` and `cursor` are additive inputs. The shared gateway input shape and description carry the same behavior. The generated output registry now describes the actual direct MCP response; its prior evidence-envelope declaration did not describe the existing handler.

- `hits` remain independent ranked lexical note paths, capped by the existing note-search top-20 contract. Entry filters, limit and cursor do **not** filter or paginate note hits. This distinction is explicit in tool descriptions, text output and pagination metadata.
- Structural filters, explicit newest/oldest order, no text query, or a cursor enable `entries`. With combined text and structural inputs, **every whitespace-separated query term must occur as a case-insensitive NFKC-normalized substring in the entry's title or content**. This is lexical matching, not semantic search. Query-only clients retain their existing note-only results; use `order: "newest"` to request entries with text terms.
- Every local vault evidence entry and every available retained tenant task receipt is considered before enrichment, filtering, ordering and limiting. Internal `searchEntries({limit: null})` explicitly requests unbounded enumeration; omitted/numeric limits retain the previous 50 default / 500 cap for existing in-process callers. Public page size remains 1–100, default 20.
- All date/source/contentType/sourceId/text filters are applied to the enriched entry set. Vault evidence wins for content; receipts enrich metadata and preserve provider revision/publication URLs. Duplicate receipt refs collapse to one entry; the receipt with greatest updatedAt, then ID, wins deterministically. Exact `get_memory` uses the same complete retained-receipt set so old enrichment agrees between list and read.
- Sorting compares normalized timestamp instants and then exact evidenceRef code-point order, reversing both for newest order. Inclusive bounds accept ISO dates and timestamps with `Z` or offsets. Date-only values mean midnight UTC, including an upper bound; to include a whole day supply its explicit end instant. Legacy zone-less headings/timestamps are interpreted as UTC for deterministic behavior, not recovered historical timezone knowledge. Malformed/impossible timestamps fail loudly rather than silently discarding entries.
- `pagination` reports `hasMore`, `nextCursor`, `snapshot`, exact `matchedEntries`, `scannedEntries`, `scannedVaultEntries`, `scannedReceiptJobs`, and whether receipt enrichment is available. Scope is **local parsed vault evidence plus retained tenant receipts**, not deleted/expired history or remote data that has not synchronized. The snapshot identifies the full observed entry set, not a transactional cross-provider point-in-time backup.

### Traversal

```json
{"capturedAfter":"2026-01-01T00:00:00Z","capturedBefore":"2026-01-01T23:59:59.999Z","order":"oldest","limit":2}
```

Continue with exactly the same query/filters/order plus the returned `pagination.nextCursor`; page size may change. Stop at `hasMore: false`. A continuation is HMAC-authenticated and binds the server-selected vault boundary, canonical query, complete entry-content/metadata digest and last timestamp/ref pair. It works across newly constructed stateless MCP servers/engines for the same vault in the same process. A changed entry set, changed query/vault, forged cursor or process restart rejects continuation. On snapshot change, **discard prior pages and restart without a cursor**. Process-local signing avoids new credentials; cross-process/load-balanced continuation needs affinity or restart and is not silently accepted.

The reusable core `paginateMemoryEntries` / `selectMemoryEntries` helpers are available for ZMR-4's later typed Q&A loop. This ticket does not add that loop or claim model completeness.

## Synthetic evidence

[Public MCP tests](../../../packages/server/test/zmrHistory.test.ts) reuse the unchanged ZMR-1 [manifest](../../../packages/server/test/fixtures/zmr/manifest.json), generator and provider doubles. Frozen [ZMR-1 reports](../zmr-1-baseline/README.md) remain unchanged. Its runnable observer now expects the repaired old range and cursor catalog.

- 657 evidence entries (656 frozen seed entries plus the inherited legacy entry), both provider lanes: all-page oldest/newest traversal returns each expected ref exactly once; old offset-normalized date range returns all five old refs; combined text/date filtering returns the original amber evidence; text-only behavior stays independent.
- Stateless reconnect continues successfully; a foreign vault with identical fixture bytes rejects the cursor. Forgery, changed order and altered evidence content fail visibly.
- 653 retained tenant-A task jobs (two duplicate old terminal receipts, 651 newer pending jobs) enrich the old entry despite the previous 500 cap. A tenant-B receipt in the same SQLite database is absent. Inclusive offset/UTC bounds and exact source ID match one deduplicated entry; receipt content cannot override the immutable body; old exact reads retain receipt provenance; receipt revision changes invalidate a continuation.
- [Core tests](../../../packages/core/test/entryPagination.test.ts) separately traverse 657 equal-instant captures with mixed UTC/offset/zone-less spellings in 17-entry pages both directions; verify every ref and inclusive boundary; reject invalid dates, query/tenant mismatch, altered signed position, malformed cursors, deletion and content changes.
- Existing ZMR-2 passage/pinned isolation regressions and provider-neutral engine tests still pass.

## Validation

- `npm run build -w zenod`, `npm run build -w @zenod/mcp-chassis`, `npm run typecheck -w @zenod/server`: pass.
- `npm run test -w zenod -- test/entryPagination.test.ts test/memoryEntries.test.ts test/passage.test.ts`: 14/14 pass.
- `npm run test -w zenod -- test/engine.test.ts`: 65/65 pass.
- `npm run test -w @zenod/server -- test/zmrHistory.test.ts test/zmrBaseline.test.ts test/zmrPassage.test.ts test/mcp.test.ts`: 38/38 pass after final strict date validation.
- `npm run test -w @zenod/server -- test/taskJobStore.test.ts test/meshGateway.test.ts test/toolOutput.test.ts`: 56/56 pass.
- `node --test scripts/build-tool-output-schemas.test.mjs`: 9/9 pass; `npm run schemas:check`: 27 bundled schemas self-contained.
- `git diff --check`: pass.

Development checks caught two outdated expectations: receipts previously replaced the fake exact-reader content, and raw core list entries do not promise a revisionId without a revision-resolving adapter. The first assertion now verifies immutable evidence precedence; the second compares unchanged provenance against the real core list instead of inventing a revision. The schema test now recognizes search_memory's actual direct response, like the existing direct poll schema exception.

## Limits and handoff

Each entry page currently scans/materializes the full local evidence/receipt set and hashes it. This repairs completeness using existing primitives, but does not reduce disk I/O, database memory use or remote sync cost. Very large vault indexing/caching belongs to later measured work. Concurrent changes can require traversal restart. Expired receipts cannot enrich legacy metadata; coverage discloses the available scope. Real-model correctness, abstention, latency/cost, authenticated live-provider behavior and SHIP acceptance remain ZMR-8 work and human gates.

Ready for independent review and manager integration after exact-head CI. Do not infer deployed behavior from these local proofs.
