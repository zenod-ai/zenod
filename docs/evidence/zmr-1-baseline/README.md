# ZMR-1 — Memory Reliability baseline

Issue: [#1189](https://github.com/zenod-ai/zenod/issues/1189). Release: [#1188](https://github.com/zenod-ai/zenod/issues/1188).

Product base: `b9dd9f0ef739a23e8438d550794b1e8400df8782`, merged control-plane PR #1199. Prior review: `ca39aa968cc8560925d027c74c28b742a3aa8805`. This change adds fixtures, tests, a demo and evidence only. No product fixes or spine edits.

Environment: isolated local macOS worktree `/Users/jordi/Documents/GitHub/wt-zmr-1`, branch `codex/zmr-1`, Node 22.22.3 / Vitest 4.1.10, dependencies from `npm ci --ignore-scripts`. Final fixture run recorded 2026-09-06 00:49 CEST. Public read-only `https://cloud.zenod.dev/api/health` reported `fb8b07c5910b3424c4a15da4e1cfaa920cee4e22` at approximately 00:42 CEST. That is a **health-reported SHA**, not an independently verified running image/digest. No authenticated live memory test, personal vault access or production mutation was performed.

## Run the demo

From the repository root, after `npm ci --ignore-scripts`:

```sh
node scripts/zmr-memory-baseline.mjs
```

It runs real `search_memory`, `get_memory`, `ask_brain` and synchronous `store_memory` MCP handlers over an in-memory MCP transport and the real core engine. Temporary vaults and reports are removed afterward. To retain JSON reports, create an output directory and set `ZMR_BASELINE_OUTPUT_DIR` to its absolute path. [GitHub report](github.json) and [Drive-shaped report](google_drive.json) contain the captured results and per-file SHA-256 fixture hashes.

The GitHub lane uses the real `VaultRepo` with a local bare Git origin; no GitHub network call is made. The Drive lane duplicates the existing `FakeDriveVaultRepository` test double from `packages/core/test/engine.test.ts`, preserving its revision/publication interface. It exercises provider-neutral core/MCP behavior, **not remote Drive publication or latency**. Neither lane uses credentials, an LLM API, ingest workers, durable async queue or customer HTTP authentication.

## Frozen fixture and expectations

[Manifest](../../../packages/server/test/fixtures/zmr/manifest.json) freezes the marker, dates, IDs, expected answers, repeated-run policy and model setting. [Generator](../../../packages/server/test/fixtures/zmr/fixture.ts) defines exact bytes; reports freeze their hashes. There are 656 synthetic entries (651 newer fillers plus five old entries) and one inherited evidence entry retaining the base fixture's valid citations. The multi-topic input also goes through public `store_memory`; that new receipt uses a normal random evidence ID and is verified against the full input before temporary cleanup. Its seeded counterpart has the fixed `e-000005` ground-truth ref.

| Question/case | Expected | Actual deterministic observer / public seam |
|---|---|---|
| ORCHID access word, after body character 8000 | `cobalt-seventeen`, `Log/2026-01-01.md#^e-000001` | Search finds the log; unpinned ask receives a truncated body without the fact. Exact get and pinned ask recover it. |
| All captures on 2026-01-01 | Five exact refs, `e-000001`–`e-000005` | Core filtered search returns five; MCP structural search returns zero. |
| Original ORCHID launch color | `amber`, `#^e-000002` | Exact get recovers it; scripted unpinned read cannot see it beyond prefix. Temporal reasoning remains unmeasured. |
| ORCHID launch color now | `violet`, `#^e-000003` | Exact get recovers correction/supersession text; scripted unpinned read cannot see it. |
| Similar project distractor | ORCHARD is `green`, `#^e-000004`; never substitute for ORCHID | Exact correction read excludes ORCHARD; model distractor resistance remains unmeasured. |
| ORCHID payroll provider | Unknown, no supporting ref | Lexical search returns no hits; observer abstains by script. This is not model abstention proof. |
| Held-out paraphrase: hue replacing earlier shade for flower launch | `violet`, correction ref | Direct lexical query returns zero; scripted unpinned ask cannot recover fact. Autonomous query reformulation remains unmeasured. |
| Long multi-topic filing | Two clear pages; only third topic uncertain | Four scripted classifications, including 0.4 confidence; zero composer calls, entire capture appended uncertain to `Areas/Insurance.md` alone. Raw evidence remains exact. |
| Oversized summary input | Bounded concise classifier inputs | Full 14,000-character summary reaches classifier. No numeric future limit is invented. |

The observer scripts search and read calls, then extracts literal values from supplied bodies. It intentionally does not answer from search snippets. Its hard-coded note choice and abstention are a controlled access probe, **not an autonomous model or a model-quality benchmark**. Exact reads retain source IDs and provider-shaped URLs and exclude neighboring content; source `revisionId` is currently optional and absent. Publication revisions remain provider-specific. All read calls preserve the full Markdown hash snapshot and repository revision.

## September review reconciliation and reuse inventory

| Review finding | Classification on pinned base | Implementation / consequence |
|---|---|---|
| 8,000-character internal read prefix | **Reproduced** through MCP ask + real read tools | `core/src/engine/engine.ts` readTools. ZMR-2 should reuse `getEvidenceEntry` and provider source resolver. |
| Newest 500 entries selected before structural filtering | **Reproduced** through MCP | `server/src/mcp.ts` calls `engine.searchEntries({limit:500,order:'newest'})`, then filters. Core filters first but also clamps requested limit to 500. Neither public schema has a cursor. ZMR-3 should extend existing evidence query/MCP seam. |
| One uncertain segment lowers all filing confidence; first candidate only | **Reproduced with scripted classifications** | `mergeSegmentClassifications` + low-confidence store branch. The confidence selection is real product behavior; classification quality is not assessed. ZMR-5. |
| Entire summary index fed to classifier | **Reproduced** | `scanVault`/`classify` receive full summary; briefing separately truncates its display summaries. ZMR-6 should not confuse that existing briefing bound with classifier bounds. |
| Full-page composer creates cumulative page growth or loses content | **Unverified as a model outcome** | `aisdk.ts` supplies `currentContent` and requests whole-page replacement. This baseline takes the uncertainty branch, so it makes no composer execution or growth claim. ZMR-6 needs focused preservation tests. |
| Lexical whole-file top-20 search misses paraphrases | **Reproduced for frozen direct query** | `ops/search.ts` still uses lexical whole-file ranking, now with exact-phrase/all-terms ranking bands. Claims that repetition always dominates are **unverified**, not assumed from the older review. Hybrid work remains ZMR-9/deferred. |
| Universal factual entailment/current-state checks absent | **Unverified as real-model answer failure** | `answerGrounding.ts` checks selected literals/anchors; `vault/lint.ts` validates structural/citation integrity, not general temporal truth. Exact correction fixture is ready for ZMR-7; no invented quality score. |
| Exact anchored reads / pinned context missing | **Already fixed / existing capability** (not an outstanding review defect) | `getEntry`, `get_memory` and `ask(contextRefs)` recover the intact block. Preserve these contracts and provider metadata in ZMR-2–4. |
| Internal ask lacks typed entry query/coverage tools | **Reproduced tool inventory** | Only `searchVault`, `readNote`, `listPages`, `searchChats` are offered. ZMR-4 should reuse public entry primitives. |

Inspected reuse surfaces: core `engine.ts`, `evidence.ts`, `ops/search.ts`, `llm/aisdk.ts`, `llm/types.ts`, `answerGrounding.ts`, `vault/{pages,lint,repository,source}.ts`; server `mcp.ts`, its schemas, `ingestQueue.ts` and `taskJobQueue.ts`; existing engine, entry and MCP tests. Ingest already carries source/content type/source ID to capture/enrichment; this ticket does not replace it. Provider-neutral architecture from #1171 is retained; no stale #1160 code is imported. Fixture base and Git setup reuse the existing engine fixture; Drive snapshot double is explicitly copied from that working test unit.

Historical overlap, inspected read-only:

- **#1059 / ZAL-2 is OPEN/testing**, with #1067 integrated as `0bb5b3df740be9e8f026dba8a19cd9076fb7de44`. Its recent-recap/Ring deployment replay remains its owner's acceptance. This baseline does not reopen that repair, claim it deployed, or close the issue.
- **#831–#834 remain OPEN**. Their July synthetic acceptance lanes already cover durable receipts, narrow recall, paraphrase/synthesis, corrections, distractors and unknowns. This frozen local battery adds reproducible access boundaries; it is not completion of their live real-model acceptance.
- August exact-read evidence records a historical deployed `d4eaac46f3322840c8c28c1bd64929e1fa68cd53`; do not confuse it with today's health result or ZMR candidate.

## Measurements and validation

No model configured; zero external API calls. Model token counts, dollars, quality, latency p50/p95 and remote provider costs are **unmeasured** (`null`, never zero). The JSON records one wall-clock sample per local seam operation: useful for reproduction overhead only, not a distribution, SLA, or comparison of live GitHub versus Drive. Three independent conversations per fixed case and separate held-out reporting remain release acceptance work; deterministic single-run success does not satisfy them.

Commands and final results are recorded below. Initial setup probes found an outdated shared `node_modules` and a missing chassis build; the shared dependency symlink was removed, lockfile dependencies installed locally, and core/chassis built. Those were harness prerequisites, not product defects.

- `node scripts/zmr-memory-baseline.mjs`: 2/2 provider characterization tests pass; expected failures above reproduced.
- `npm run test -w zenod -- test/memoryEntries.test.ts test/aisdk-retrieval-retry.test.ts test/engine.test.ts`: 69/69 pass (48.18 seconds).
- `npm run build -w zenod` and `npm run build -w @zenod/mcp-chassis`: pass.
- `npm run test -w @zenod/server -- test/mcp.test.ts`: 31/31 pass.
- `npm run typecheck -w @zenod/server`: pass (production sources; Vitest runs the new test).
- `node scripts/build-tool-output-schemas.mjs --check`: 27 bundled self-contained schemas, pass; no schema changes.
- `git diff --check`: pass.

Baseline assertions intentionally characterize current defects. When a fix lands, its ticket must replace the corresponding failure expectation with the desired outcome and refresh evidence; a newly failing characterization assertion alone is not a product regression.

## Handoff / dependency readiness

Ready for manager review and integration. Once this baseline is integrated, **ZMR-2 and ZMR-3 are ready in parallel** from the same fresh base: distinct core read versus structural pagination surfaces. Coordinate shared type edits through the manager. ZMR-4 waits for both; ZMR-5 waits for ZMR-4; ZMR-6 waits for ZMR-5; ZMR-7 waits for ZMR-4/6; ZMR-8 waits for fixes and approved live acceptance. ZMR-9/10 remain deferred until Jordi's SHIP acceptance. No production or data-processing permission is implied.
