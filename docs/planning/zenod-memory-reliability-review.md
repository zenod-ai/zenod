# Zenod memory reliability review — release input

Reviewed 2026-09-05/06 at local ca39aa968cc8560925d027c74c28b742a3aa8805.
Release authority: [Memory Reliability EpicSpine](../EPIC-ZENOD-MEMORY-RELIABILITY.md).
This is historical review evidence, not a claim about remote main or production.

## Observed implementation

- engine.ts readTools truncates note bodies at 8000 characters while ops/search.ts scans complete files.
- server mcp.ts search_memory obtains the newest 500 entries before date/source filtering; typed query and text hits are separate outputs.
- segment classifications merge with the minimum confidence; low-confidence store fallback uses the first candidate.
- classify sees the complete page-summary index; compose rewrites complete pages.
- lexical search uses weighted substring matching and top-20 whole-file results.
- lint validates structure/link targets/citation anchors, not universal claim entailment; answerGrounding sanitizes selected exact literals and anchors.
- Typed entry search, exact MCP reads and pinned contextRefs already exist and should be reused.

## Evidence limits

Live read-only search/get/ask successfully retrieved relevant project memories. One returned summary was a very large accumulated history. ask_brain described historical failures as current and said fixes were not recorded in its sources; newer repo evidence exists. This demonstrates scope/freshness limits of that answer, not proof that all historical defects remain deployed.

Command: `npm run test -w zenod -- test/memoryEntries.test.ts test/aisdk-retrieval-retry.test.ts test/engine.test.ts`.
Result: 3 files, 60 tests passed in 38.95 seconds, isolated local fixtures. No new release tests were added, no production SHA verified, and no user vault mutations performed.
Remote main observed during planning: fb8b07c5910b3424c4a15da4e1cfaa920cee4e22; ZMR-1 must reconcile before implementation.

## Source map

- [Engine](../../packages/core/src/engine/engine.ts)
- [Search](../../packages/core/src/ops/search.ts)
- [Evidence](../../packages/core/src/engine/evidence.ts)
- [MCP](../../packages/server/src/mcp.ts)
- [Classifier/composer](../../packages/core/src/llm/aisdk.ts)
- [Grounding](../../packages/core/src/engine/answerGrounding.ts)
- [Linter](../../packages/core/src/vault/lint.ts)
- [Existing deployed exact-read evidence](../evidence/generic-entry-retrieval-2026-08-01/README.md)
- [Anthropic contextual retrieval research](https://www.anthropic.com/engineering/contextual-retrieval): input to optional hybrid evaluation, not an adoption decision.
- [LongMemEval](https://arxiv.org/abs/2410.10813): evaluation dimensions including temporal reasoning, knowledge updates and abstention.

## Proposed sequence

Baseline → passage access + historical pagination → internal typed Q&A/coverage → per-topic filing → focused meaning updates → current/historical facts → release acceptance.
After human SHIP acceptance: hybrid search evaluation and an approved-plan filing maintenance queue.
