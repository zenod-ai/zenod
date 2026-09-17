# Comparable recall scorecard

Status: final candidate 620716f passed all 36 isolated M2 v1.1 cells, is deployed, and passed the six-case production MCP smoke. No monitoring schedule created.
Audit date: 2026-09-16.

## What exists

- [Original battery #831](https://github.com/zenod-ai/zenod/issues/831): 17 live tests, 12 PASS / 5 FAIL. The later 3/3 targeted remediation retest is not a full-suite pass. The parent issue remains open.
- `scripts/zmr-memory-baseline.mjs`, `scripts/zmr-release-validation.mjs`, and the ZMR fixture tests: deterministic model substitutes test access, identity and protocol behavior. Their real-model quality and cost fields are explicitly unmeasured.
- `scripts/zmr-pipeline-eval/`: actual candidate engine/adapter/job-queue evaluation, frozen inputs, private artifacts, request limits, usage and cost reservations. Reuse this machinery; it currently emphasizes ingestion and fresh-session asks rather than a stable conversational health history.
- `scripts/memory-eval/`: eight synthetic model reconciliation cases, not an end-to-end recall score.

We have not established a continuously comparable real-model recall score across released versions. Recent original-note acceptance and isolated model runs cannot be combined into one historical score because their scope/configuration differs.

## Next milestone

One command runs a frozen conversational recall suite against an exact candidate and produces a version-comparable report. Reuse the existing runner, budget ledger and synthetic chat seam. No new service, provider switch, production writes or deployment is required to build it.

Preserve the original battery's meaningful coverage and add the observed conversation failures. Freeze case IDs, prompts, seed vault, starting conversation state and expected facts before evaluating candidates. Use an isolated synthetic vault of realistic size; do not seed test facts into the owner's brain. Maintain separate held-out cases and add real-incident regressions as a new suite version.

Required cases include exact/paraphrased recall, newest evidence, bounded date enumeration, long-note beginning/middle/tail, cross-memory synthesis, correction versus history, distractors, unknown facts, valid citations and ingestion/readback. Conversational cases must include summary then a tail-detail follow-up, pronouns such as "that note", and capture-context followed by "what do you think about it?". The latter should identify the subject, ground recalled premises, and clearly distinguish analysis from source statements; a generic evidence refusal fails usefulness.

Use the actual chat loop for conversational cases, preserving context within each case and resetting it between cases. Do not substitute direct ask calls or provide hidden evidence links/expected answers to the model. Run three independent trials per case when comparing a release; label a cheaper single-trial smoke separately.

## Result contract

Every run records candidate SHA, actual environment, suite/fixture/question/rubric hashes, answer and organizer models separately, reasoning/provider settings, budget and timestamps. The September 15 configuration used Luna for organizing and Grok for answers; organizer changes must not be mistaken for answer-model changes.

Each case/trial retains prompt sequence, actual answers, source reads and coverage, citations, tool/provider errors, latency, input/output/reasoning tokens and correlated cost. Score required facts, forbidden claims, source support, completeness and useful response behavior. A valid JSON result, HTTP200, nonempty citation list, or honest-but-unnecessary refusal is not sufficient for PASS. Use deterministic checks where appropriate plus a fixed semantic rubric; preserve review evidence, and version any model judge separately. Expected answers never enter the agent's context.

Report strict case pass rate with numerator/denominator, per-category scores, unsupported claims, false absences, citation support, p50/p95 latency with sample counts, total actual reported cost, cost per attempted case and cost per passed case. Include failed attempts/retries in cost. Unknown costs remain unknown with an explicit coverage count; budget reservations are exposure, not billed cost. Record setup/ingestion and recall costs separately.

Compare runs only with matching suite, fixture and rubric hashes. Show changed configuration and per-case gains/regressions beside aggregate score and cost. A cheaper run that refuses useful questions is a regression, not an efficiency win. A hard budget interruption is incomplete, not a pass over a reduced denominator.

## Initial known failures and limits

- September15 production MCP: standalone latest-note summary passed with complete reads; follow-up about researcher/creator direction failed after stopping at offset12014/17321. Private exact results: `~/.local/state/zenod-zmr-20260915/mcp-whatsapp-recheck-20260915-a/results.json`.
- September16 user screenshot: a preceding Macro Dashboard voice note followed by "what do you think about it?" received a generic evidence-verification refusal. This is an observed user-facing failure; its specific runtime cause has not yet been traced.
- No current full-battery score or comparable cost total is claimed. Stabilizing and running this suite precedes further quality-tuning claims.

## Completion criteria

The same frozen suite produces a complete scored and cost-accounted baseline plus one repeat on the same candidate; an offline comparator shows per-case and aggregate differences without mutating prior results. The known follow-up/opinion failures appear explicitly. There is a documented bounded command for the next candidate. Release-triggered or scheduled execution is a separate wiring step once this baseline is reproducible.

## Recorded M2 batches

The fixed M2 baseline now uses the actual chat loop with 12 scenarios and three planned trials each. [HTML results](zenod-basics-test-results.html) and [versioned result receipt](../evidence/m2-basics/baseline-3.json) retain the full denominator and exact source/configuration hashes. Private wire traces remain outside the repository.

| Batch | Candidate | Reviewed pass/fail | Incomplete / unrun | Actual cost | Scope |
|---|---|---|---|---|---|
| baseline-3 | 2a4ff66 | 6 / 4 | 1 / 25 | $0.26551404 | v1.1 isolated real-agent baseline; stopped at80 requests |

Earlier diagnostic attempts cost $0.10040743; invalid seed envelopes prevent using their filing outcomes for quality comparison. Their costs and original evidence are retained. A selected-case repair batch must never replace this baseline or be presented as a full-suite score.

Capture repair `66d6a5f`, harness `9a671b2`: B01/B04 each3/3 PASS, six selected trials,30 other trials unmeasured. Actual cost $0.06352236, unknown0. [Exact result receipt](../evidence/m2-basics/capture-candidate-1.json). Do not compare its partial aggregate against the broader baseline as an accuracy improvement.

Baseline continuation `baseline-5` (same source2a4, fixture/rubric; reviewed legacy-compatible harness9a671b2) completes B11/B12 trial1: both PASS, cost $0.03755837. [Receipt](../evidence/m2-basics/baseline-5.json). Across baseline3 and5, each of12 cases now has one completed trial:8 PASS/4 FAIL; the remaining24 trials are unrun. This is not3/3 acceptance. Earlier stopped B11 attempts remain archived. Baseline4 stopped on conservative cost reservation before any answer and cost $0.00202629. Total all completed attempts, including the capture candidate, is $0.46902849, unknown0.

Answer candidate `d6f052d`, harness9a671b2: B10 opinion3/3 PASS; B06 long summary1/3 PASS,2/3 FAIL. Six selected trials,30 unmeasured. Actual cost $0.20337097, unknown0. [Result receipt](../evidence/m2-basics/answer-candidate-2.json). The failed summaries read only a first chunk without the optional full-read flag. A bounded default-source-read repair is required; no passing reinterpretation or same-version reroll. The preceding budget-stopped answer-candidate-1 had no completed answer and cost $0.02442628. All completed M2 attempts now total $0.69682574.

Integrated `final-summary-1` candidate `c2f8100` (capture, answer, live sign-in/MCP and spinner ancestry, plus a default complete-source read): B06 long summary1/3 PASS,2/3 FAIL;33 unmeasured. The first failure explicitly opted out of the default full read, and the third read the complete source but echoed a host instruction in place of the requested summary. The second trial passed. Actual cost $0.13622806, unknown0, 23 model requests. [Hash-bound review receipt](../evidence/m2-basics/final-summary-1.json); private wire evidence remains outside the repository. This batch is red and is not a deployment or a full-suite score. Total actual cost across all completed/stopped M2 attempts is now $0.83305380, unknown0.

Integrated `final-summary-2` candidate `66907d2` (model opt-out removed; summary hint has no procedural excerpt): B06 2/3 PASS,1/3 FAIL;33 unmeasured. All three trials read the complete source. Trial1 still omitted the explicitly requested unconfirmed 280-euro estimate while selecting the source-level summary handle for the closing only. Trial3 included the required facts but attached broader claims to unrelated sentence-level support IDs; the frozen rubric records PASS and the independent review separately records this support-scope risk. Actual cost $0.12155211, unknown0. [Hash-bound review receipt](../evidence/m2-basics/final-summary-2.json). No same-version reroll or passing reinterpretation; a general answer-support contract repair is active. Cumulative actual cost through this batch is $0.95460591, unknown0. The B06 result remains red and M2 is not deployed.


## Final isolated candidate and deployment — 2026-09-16

`final-summary-3`, candidate `d6e148cfa77f0ff74b4f9406aac8c7644487f481`: B06 **3/3 PASS**, three selected cells and 33 unmeasured. All summaries used a valid whole-source handle after complete reads and preserved beginning, unconfirmed cost and conditional closing arrangements. Cost **$0.13460107**, 27 requests, unknown0. [Versioned receipt](../evidence/m2-basics/final-summary-3.json). This targeted result did not itself establish full-suite acceptance. Later full-d6 testing remained 27/36; the subsequent repairs were measured on new exact candidates, with prior failures retained.

Final candidate **`620716fcc8ed547fec937d90ad4e9090ba9588d3`** passed **36/36** frozen M2 v1.1 cells: all 12 cases, each 3/3. Seven isolated batches used the same fixture/rubric, actual chat loop and harness `9a671b2`, with **GPT-5.6 Luna (low)** organizing and **Grok 4.3** answering. [Sanitized versioned receipt and all cell/batch hashes](../evidence/m2-basics/full-620-final-v1.json).

| Accounting | Requests | Provider-reported cost |
|---|---:|---:|
| 36 scored cells | 230 | $0.75945611 |
| Retained incomplete B06:2 attempt | 5 | $0.00931346 |
| All final-suite attempts | 235 | $0.76876957 |

Unknown-cost requests: **0**. B06:2 is scored from batch b4; the budget-stopped b3 attempt remains archived and paid. These totals cover the seven final-suite batches, not all earlier development experiments. The finite isolated result does not prove universal reliability, production MCP behavior or WhatsApp delivery.

**LIVE; representative production MCP smoke passed.** At 2026-09-16 04:22 UTC, source/health/OCI revision matched `620716fcc8ed547fec937d90ad4e9090ba9588d3`; immutable image: `ghcr.io/zenod-ai/zenod@sha256:5358d9eca1dcaa4527484dffb903384f132aacf5c524332ee2389ea829559ed4`. One replica, preserved mount and non-GIT_SHA environment, empty queue. Postflight receipt SHA256: `a15070800f9d38d5d6662a1c03d9c4d7efaedc69d1f687954a5574632246e54f`.

Backup archive SHA256: `278abfb0869ebf25ffa141f7b7132afd7b00b6dca5532a9555f92c70892352f6`. Restore verification passed at 04:19:25 UTC: 958 files, 40 JSON and 79 SQLite files. Operational deployment and restore proof are distinct from semantic acceptance.

Production MCP smoke passed **6/6 measured cells**: B01 capture, B06 complete long-source summary, B09 conversation/thread isolation, B10 capture followed by grounded opinion, B11 correction/history, and B12 uncertainty/unknown. All 15 semantic checks and all custody gates passed. The runner made 63 MCP calls with 351.972 seconds of summed case latency. Reserved exposure was $4.00; actual provider billing is unavailable on this path and remains `null`. Every disposable tenant was deleted, its tenant-only credentials cleared and bearer rejected with 401; every private synthetic repository was archived. Owner/shared settings hashes and vault heads remained unchanged. [Sanitized production receipt](../evidence/m2-basics/production-620-smoke-v1.json), consolidated private receipt SHA256 `abb8c6aa32322e431b6fbd9159ed9c90f652a57a6f5f358876ed7822c127890a`.

This is a representative production smoke, not a second full-suite run: the production matrix is 6 PASS / 30 UNRUN. B05 fault injection remains isolated-only. ASR/WhatsApp delivery and repeated capture replay are separate transport checks. B10–B12 answers were correct but carried repetitive source/history excerpts and generic caveats, retained as a presentation follow-up.

## 2026-09-16 — production MCP evaluation of `764149b` (deployed promotion)

Promoted `main` to production after the 36/36 isolated suite and the 6-cell smoke. Live source/OCI/health now match `764149ba0bb2a14b580917e102ba44b852efe579` (image `ghcr.io/zenod-ai/zenod@sha256:a3e801bb2f04e9f3328bb5e69aee93b2e97cfe4d2e4c604d94ab95ca0626e787`); Dokploy deployment `eULZa7c9gvvuYpFaMdya2` ("ZMR deploy 764149b", 2026-09-16T21:02:11Z, done). Models unchanged: organizer `openai/gpt-5.6-luna` (reasoning low), answer `x-ai/grok-4.3` via OpenRouter.

Ran the fixed basic-memory batch **through production MCP**, one trial per case (B01–B12 × trial 1), against disposable tenant/private-repo pairs: **12/12 RECORDED, all custody gates PASS, 11 PASS / 0 FAIL / 1 PARTIAL**. The partial is B05, whose duplicate-replay/idempotency leg passed (same job, same result, unchanged pages) while the forced-fault interruption check remains isolated-only by the frozen contract. Reserved exposure **$7.75** (provider billing reconciled separately, `null` here).

[HTML report](zenod-production-eval-764149b.html) · [Durable receipt](../evidence/m2-basics/PRODUCTION-12-764149b.json). Reviewer: independent agent review of each actual answer and persisted effect. This is one trial per case (12 cells), not the full 36-cell matrix; ASR/WhatsApp delivery remains out of scope.

## 2026-09-17 — snapshot-bound production MCP run with cost/tokens/time

First run where the eval harness is **bound to the deployed snapshot** (candidate SHA, image digest, and the live model snapshot) and captures per-element cost, tokens and time from the disposable tenant's durable usage ledger. Live deployment `fee95a77` (Dokploy `gV_BHTLYSTmINQE_vEgGJ`), models `openai/gpt-5.6-luna` (low) on **both** organizing and answering. 12 cells (B01–B12, trial 1).

| | 764149b (baseline, grok answer) | fee95a7 (Luna both) |
|---|---|---|
| Actual cost | $0.9392 | $0.9728 |
| LLM calls | 58 | 57 |
| Input / output / cached tokens | 531,487 / 33,824 / 112,489 | 536,434 / 26,457 / 301,246 |
| Semantic score | 11 PASS · 1 partial · 0 FAIL | **10 PASS · 1 partial · 1 FAIL** |
| Reserved exposure | $7.75 | $7.75 |

Per-cell actual cost ranged **$0.029–$0.179**. Luna caches ~2.7× more and emits ~22% fewer output tokens at ~3.6% higher cost. **Regression**: B11 (correction/history) — the Luna-both run reported the prior 12 but did **not** surface the correcting memory ("not 12, but 19"), where the grok run passed. B05's forced-fault leg remains isolated-only by contract.

[Comparison report](zenod-production-eval-comparison.html) · [Luna run](../evidence/m2-basics/run-fee95a7-luna.json) · [grok baseline](../evidence/m2-basics/run-764149b-grok.json). Scored by independent agent review of each literal answer and persisted effect; not a provider invoice (MCP path returns no billed cost; the ledger is server pricing × tokens).
