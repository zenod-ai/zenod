# ZMR-5 — Per-topic memory filing

Issue: [#1193](https://github.com/zenod-ai/zenod/issues/1193). Base: `1be97bb8815446fb9d40443f60bac9c5b1dabc71` (ZMR-4 merged). Worktree: `/Users/jordi/Documents/GitHub/wt-zmr-5`, branch `codex/zmr-5`. Validation: 2026-09-06, local macOS / Node 22 / Vitest 4.1.10. No live vault, model API or production mutation.

## Changed behavior

The classifier returns independent topics with confidence, spend disposition, candidate pages and exact source quotes. The engine resolves these quotes inside their original segment to UTF-16 source offsets, rejects missing/ambiguous quotes, and records non-whitespace source content omitted by the classifier as unresolved. Segmentation preserves exact source bytes and supplies bounded neighboring context for reference resolution; neighboring context cannot be assigned as evidence from another segment.

Both synchronous `store` and capture-first `enrichEvidence` use the same topic filing operation. Clear assignments compose only their assigned source excerpts, grouped by normalized destination so duplicate paths compose once. Multiple segments assigned to one page retain source order. A low-confidence or mangled-name topic goes to an evidence-linked Inbox receipt; it does not lower the confidence of unrelated topics or append the full capture to the first candidate page. A later segment classification failure becomes a pending assignment while clear earlier assignments proceed.

A failed page is restored independently. Other successful pages and the original evidence entry remain intact, with no discard/re-append of the raw capture. `topics` on the typed receipt carries proposed `pages`, successful `filedPages`, exact `sourceSpans`, confidence/disposition and filed/uncertain/pending outcomes. Any unresolved assignments receive a stable date-and-anchor-named Inbox record including exact unresolved excerpts. Fully resolved assignments remain in the existing durable job/result receipt; evidence-only enrichment does not create a second publication or spend a composer call. Existing optional backlog digestion on fully filed synchronous stores remains intact.

MCP text, terminal structured evidence, and background filing notifications report partial outcomes. Provider-neutral revisions/URLs, Drive provenance and the synchronous Git evidence line anchor are preserved. Existing durable task-job idempotency keys and restart ownership are unchanged; no new retry queue or autonomous maintenance is introduced. Re-submitting an already accepted key returns the existing job/receipt rather than repeating filing. This does not introduce an exactly-once protocol across the pre-existing publication/job-result crash window.

## Synthetic fixtures and checks

- `packages/core/test/engine.test.ts`: exact mixed Insurance/Axa/Znot text, duplicate `.md`/extensionless candidates, per-topic source offsets, isolated composer input, failed second page, capture-first evidence identity, invalid quote/omitted text, cross-segment references, evidence-only spend gate, and classifier outage after a clear segment.
- `packages/server/test/fixtures/zmr/manifest.json`: unchanged frozen ZMR baseline. `zmrBaseline.test.ts` now expects two clear destination compositions plus isolated uncertainty for both the local Git provider and the existing Drive persistence double. Composer inputs exclude the ambiguous segment; raw capture remains exact. The oversized summary characterization is retained for ZMR-6.
- Public HTTP MCP tests verify typed partial terminal evidence and schema validity. Existing repeated-key and restart tests verify the existing job boundary. Notification tests reject an all-filed claim for a partial result.

Commands/results:

- `npm run test -w zenod -- test/engine.test.ts test/schema-llm.test.ts`: 76/76 passed after the source-assignment, partial filing, classification-failure handling and backlog-preservation implementation. The last line-anchor refinement and two added spend/outage tests were then checked with the targeted command below.
- `npm run test -w zenod -- test/engine.test.ts -t 'files clear topics independently|evidence-only topic enrichment|later segment classifier'`: 3/3 passed (69 unrelated tests skipped).
- `npm run build -w zenod`: passed.
- `npm run build -w @zenod/mcp-chassis`: passed (test prerequisite).
- `npm run typecheck -w @zenod/server`: passed.
- `npm run test -w @zenod/server -- test/zmrBaseline.test.ts test/taskJobStore.test.ts test/mcp.test.ts test/filingReceipt.test.ts`: 59/59 passed on final source, including both provider baseline lanes. An earlier run correctly required updating the exact terminal-evidence expectation for the additive `filing` field.
- `node scripts/build-tool-output-schemas.mjs --check`: 27 schemas, passed.
- `node --test scripts/build-tool-output-schemas.test.mjs`: 9/9 passed.
- `git diff --check`: passed.

## Limits and handoff

Deterministic seams establish control flow, source isolation and receipt truth. They do not establish real-model topic quality, correction of mangled names, semantic entailment, latency or provider cost; those remain ZMR-8 release acceptance. Exact repeated short quotes are conservatively unresolved and may require the model to choose a longer quote. Legacy injected classifiers without topic assignments retain their single-segment compatibility behavior; multi-segment legacy output is mapped to independent segment assignments. The real structured-output classifier requires topic assignments.

Focused update growth and summary bounds remain ZMR-6. No hybrid index, maintenance queue, deployment, signup or billing work was performed. Ready for exact-head independent review and required CI; the manager owns merge and next dispatch.
