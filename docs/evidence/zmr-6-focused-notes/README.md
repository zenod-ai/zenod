# ZMR-6 — Focused meaning notes and bounded summaries

Issue: [#1194](https://github.com/zenod-ai/zenod/issues/1194). Parent release: [#1188](https://github.com/zenod-ai/zenod/issues/1188).

Pinned base: `06085df10bb380ef615c6a2ee7e007fd57d6548b` (ZMR-5). Implementation: `4250decd36ea0022beab0e8153d33f5ffeb8e4f7`; subsequent evidence-only commit does not change tested sources. Environment: isolated local macOS worktree `/Users/jordi/Documents/GitHub/wt-zmr-6`, branch `codex/zmr-6`, Node 22.22.3, Vitest 4.1.10. No credentials, external model calls, personal vault writes or deployment.

## Behavior

- Classification reuses existing vault search and frontmatter metadata. At most 24 compact candidates are supplied per call: summary ≤480 Unicode characters, title ≤120, 12 tags, 8 aliases. Explicit caller hints rank first; body-search hits and metadata relevance supply other candidates. A partial catalog yielding uncertain or new-page decisions gets one additional bounded search over omitted candidates, retaining eight initial candidates. Every call explicitly discloses that omitted pages can exist.
- Exact existing paths win before normalized-title/alias matching. A unique existing title/normalized path/recorded alias converts a proposed create into update, preventing straightforward duplicates. Ambiguous matches do not arbitrarily select the first note. An update to a missing target fails safely into the existing pending filing path.
- The existing composer receives only one matching second-level section, capped at 6,000 characters, plus compact frontmatter. If no bounded section matches, it composes an addition without receiving the historical body. Every existing nonblank line in a selected section must remain intact and ordered; other sections are reconstructed directly from the original. A missing new citation, destructive section edit, malformed frontmatter or oversized/multiline summary fails validation and retries through the existing filing seam.
- Summaries are one line and at most 480 Unicode characters, enforced in composition and the vault linter. Original oversized summaries on touched notes are retained under `Previous summary`; compact append operations also bound a touched legacy summary. Untouched notes are not rewritten. Whole-vault lint can now identify oversized historical summaries for a later approved maintenance plan.
- Relevant existing meaning links come from the same retrieval seam; a real folder index or root Index is the fallback. Arbitrary first pages are no longer composer link hints.
- Classifier alias proposals carry exact source quotes. Only a quote present in assigned evidence and containing both canonical title and alias is stored in `aliasEvidence`, with the new citation. Existing raw spellings and evidence remain unchanged. Model-authored alias frontmatter cannot bypass this validation; compact append and composed updates both support records.
- The narrowly delegated ZMR-5 receipt correction mentions an unresolved Inbox record only when the result actually includes a filing-record path. Resolved and evidence-only receipts no longer invent an Inbox record.

## Fixtures and validation

Frozen release manifest: [`packages/server/test/fixtures/zmr/manifest.json`](../../../packages/server/test/fixtures/zmr/manifest.json). Its public baseline continues to use immutable long-log and historical-entry evidence; its old full-summary expectation now checks the 480-character bound. The scripted composer was updated to actually add a cited statement, because returning an unchanged note no longer satisfies filing acceptance.

Additional synthetic fixture: `packages/core/test/meaningNotes.test.ts` seeds 60 pages with 14,000-character summaries, a body-only target at Page59, an explicit Page58 hint and punctuation-colliding filenames. It proves bounded candidate inputs, a fallback call, exact-path precedence, duplicate avoidance and relevant Index fallback. Other cases exercise repeated section updates, long unrelated history/custom metadata, old-summary retention, malformed/destructive output, missing citations and valid/invalid alias records.

`packages/core/test/engine.test.ts` stores three distinct synthetic travel captures through the real engine into a note with a long unrelated mortgage section. Each store files successfully, preserves the mortgage text and old citation, keeps the summary bounded and returns the original new evidence text unchanged. Existing Git and Drive-shaped engine/public cases retain provider revisions and publication URLs. Drive uses the already established local repository double; it is not a remote Drive publication test.

Commands on implementation SHA above:

- `npm run test -w zenod -- test/engine.test.ts test/meaningNotes.test.ts test/schema.test.ts test/schema-llm.test.ts`: 106 tests pass.
- `npm run build -w zenod` and `npm run build -w @zenod/mcp-chassis`: pass.
- `npm run test -w @zenod/server -- test/zmrBaseline.test.ts test/mcp.test.ts`: 37 tests pass, including both provider baseline lanes and three receipt wording cases.
- `npm run typecheck -w @zenod/server`: pass.
- `node scripts/build-tool-output-schemas.mjs --check`: 27 bundled schemas pass; public schemas unchanged.
- `git diff --check`: pass.

Earlier runs caught legacy test doubles that returned unchanged or destructive whole-page content; those doubles now obey the focused, cited contract. No product preservation check was relaxed to accommodate them.

## Measurements and limits

The large-catalog fixture contains at least 840,000 summary characters. The new two-call maximum carries at most 23,040 summary characters (24 ×480 ×2), a ≥97.2% reduction for that synthetic summary payload. The regression additionally asserts observed aggregate summary characters fall below one tenth of the former full index. These are character-derived context comparisons, not provider token billing or whole-prompt cost measurements. Engine estimated-input telemetry now observes the actual bounded classifier/composer inputs instead of the former full index/body. Real-model tokens, dollars, answer quality and p50/p95 latency remain **unmeasured** and belong to ZMR-8.

Candidate retrieval still scans the local vault and uses lexical ranking. One bounded fallback is not exhaustive semantic recall; held-out paraphrase/alias quality and large-vault latency require release evaluation. Section preservation is mechanical text/citation preservation, not universal semantic entailment. Alias equivalence interpretation still depends on the classifier; exact quote validation is provenance evidence, not a proof that arbitrary co-occurring names are equivalent. ZMR-7 should explicitly annotate corrections/current truth while retaining old historical claims. Bulk cleanup/restructuring remains deferred to ZMR-10. No live acceptance or deployment claim follows from these tests.
