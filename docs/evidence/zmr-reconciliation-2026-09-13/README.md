# First real-model reconciliation acceptance: failed

Observed 2026-09-13, 18:41–18:45 UTC. This is a failed candidate receipt, not release or production evidence. [Acceptance #1241](https://github.com/zenod-ai/zenod/issues/1241) remains open; bounded repairs are #1254–#1256.

Candidate: `6e0af0c0f93d8320eb83effca519b015ea456a6c`. Comparator: `9ce6e747d463f249cae657ef6ecfadff24fa279d`, derived from production `631f85109dfa45fed95394a1e94d2d709c373fe6` with only explicit 8192-token output caps added to classification/composition for budget enforcement. This is a capped baseline variant, not a byte-identical production benchmark.

Both used actual engine, durable queue and OpenRouter adapters with MiniMax M3 classification and Grok 4.3 answers. They used independent local Git/SQLite/archive workspaces, the same frozen synthetic Spanish/English transcript, and six frozen questions repeated in three fresh sessions. The archive input was valid silence WAV plus a **provided transcript**: evidence custody was exercised, but this does not prove speech recognition or phone ingress. No production data was modified and no model was switched.

Fixture SHA256: `9f4730688c2d94212d6d9daeecdf9285eedc4d5f924c25721e820438d37aeb21`. The fixture has 26,346 codepoints and 11 ground-truth idea rows, including independent claims sharing a source passage. Expected results were withheld from model input. After this failure it is a development regression; separately frozen Spanish/English speech fixtures remain for independent acceptance.

| Result | Candidate | Capped baseline |
|---|---:|---:|
| Complete correct recall answers | 3/18 | 4/18 |
| Evidence/preservation invariants | 12/12 | 11/12 |
| Actual HTTP attempts | 71 | 72 |
| Reported total cost | $0.20395703 | $0.19226709 |
| Ingestion/reconciliation cost, including replay | $0.01392383 | $0.01077814 |
| Answer cost across 18 sessions | $0.19003320 | $0.18148895 |
| HTTP latency p50 / p95 | 2.164s / 6.540s | 2.201s / 10.679s |

Latency samples are requests, not complete user interactions or streaming first-token measurements. This is one paired run with variable provider routing and caching, not a statistically stable model comparison. Reported usage cost replaces conservative reservations; absent usage retains the reservation. No DeepSeek calls were made.

Candidate classification recognized 11/11 intended ideas, but deterministic host resolution accepted spans for only 4/11. Among ten meaning-target rows, only one received the correct minimal operation. Three writes were made: one correct negative claim and two duplicate additions that should have linked new evidence to existing claims. Correction, conflict, ownership and late ideas remained unfiled. An unknown-project clarification existed but had invalid source binding. No unsupported novel meaning claim was observed; this does not compensate for missing or incorrectly maintained knowledge.

The measured failure boundaries are:

1. Exact unique quotes with redundant occurrence numbering, or exact sentences crossing adjacent addressed passages, were rejected by source binding (#1254).
2. Tiny target pages supplied only introductory text or no statements to reconciliation, excluding equivalent existing bullets. Explicit correction qualification handling also rejected the date update (#1255).
3. Host current-fact projection replaced a supported model answer about a hypothesis and restriction with less relevant facts, dropping part of the answer (#1256).

Candidate raw bytes, archive pointers, identities, unrelated pages and replay protections passed. The baseline failed exact archived-transcript fidelity because it trimmed the final CRLF; the candidate preserved it. Private complete wire traces, before/after pages, frozen inputs and independent semantic row-by-row review are retained outside Git at `/Users/jordi/.local/state/zenod-zmr-20260913/`. They contain no original user voice-note transcript. The public runtime remains at the recorded production baseline; no deployment follows from these results.

## Second candidate regression: still failed

Candidate `b183806fd7a994eaaa8088ce600319042f2c815e` completed at 2026-09-13T19:20:39Z after the first three repairs passed independent review and CI. This is a development regression on the consumed fixture, not a new held-out result.

All 11 expected idea rows now have valid source addresses. Initial meaning had seven of ten correct minimal outcomes; after direct partial replay, six of ten remained correct because a correction was duplicated. Capacity was added twice instead of linking its existing equivalent; the visitor-distribution requirement was shortened to an artifact description; the unconfirmed collaborator date stayed outside meaning. Complete recall was 5/18 (19/48 required subclaims); ten otherwise complete model answers lost requested content in host finalization.

The 12 reported invariants pass, but they do not prove partial-replay semantic idempotence: the manual before/after review identified duplicated meaning writes. Exact archived WAV and transcript bytes, including final CRLF, remain preserved. The Log read API trims trailing whitespace as existing behavior; archive equality is evaluated independently. Total reported cost was $0.17521696 across 63 requests; ingestion/reconciliation including replay was $0.00991026. No ASR fixture, production deployment or provider/model switch occurred.

[Second independent failure receipt](https://github.com/zenod-ai/zenod/issues/1241#issuecomment-5655538280) binds the private row-by-row report in `candidate-repaired-regression/independent-semantic-review.json`. Repairs #1261–#1263 tighten complete source propositions, atomic per-idea decisions and explicit answer support selection. Acceptance remains unchanged and deployment stays blocked.

## Third candidate: semantic failures and provider quota interruption

Candidate `1b9eb7c6d2611b4d9ad8b3273fed402c79cbe682` completed 2026-09-14T01:26:40Z. Same consumed development fixture/models; independent ASR remains untouched. All repair PR heads passed review and CI; combined build and 22 provider/chat/queue tests passed before the run. Actual performance still fails acceptance.

Five of ten meaning outcomes pass. Capacity and torque now link without duplicate prose; recipient obligation and both owners are retained. Scale-method reinforcement and the late free-place idea were classified evidence-only. Valid correction/hypothesis paraphrases fail language-based qualification comparisons; a conflict with null target passes model schema but fails host requirements. Partial replay changes only the receipt, not meaning pages. Exact archived audio/transcript remain preserved.

Only two answer trials completed: both had the correct source available and generated supported prose, but ignored the prompt-only JSON contract, so the host rejected them. Observed correctness is 0/2 final answers and 0/4 subclaims. Sixteen answers/44 subclaims are **unmeasured**, not semantic-quality observations: eight requests received provider monthly-limit 403 and the remainder stopped on local retained reservations. End-to-end acceptance is not met.

Provider-reported usage is $0.04603331 (classification $0.00883197; reconciliation $0.00483619; answers $0.03236515). Reserved exposure is $0.94351331, including $0.89748 retained for failed requests; it is not a charged-cost claim. No quota increase, key change or further paid call is authorized by this receipt. [Independent failure report](https://github.com/zenod-ai/zenod/issues/1241#issuecomment-5657790142) binds private evidence in `candidate-contract-regression/independent-semantic-review.json`.

Offline actual recorded-operation replay before this run is preserved at the local combined commit `c3a9e6a`: mixed decisions reject wholly while valid siblings apply; a crossing hypothesis becomes source-valid. That replay remaps only verified source/target identities and does not prove new semantic choices or receipt idempotence. Answer replay used evaluator-selected IDs and likewise did not establish actual model protocol compliance. Repairs #1268–#1269 address these newly observed contract failures, with terminal-provider handling in #1241. Production remains unchanged.


## Offline contract repairs after the quota interruption

ZMR-24 [PR #1273](https://github.com/zenod-ai/zenod/pull/1273), reviewed head `74dbefd30dea777480a773b132dbb19a95968937`, retains complete exact source propositions instead of generated translations. Explicit known destinations proceed to reconciliation, which owns novelty decisions; missing destinations and routing confidence are not guessed. A correction stores its exact standalone replacement or complete correction report with existing target/history checks. An untargeted uncertain report remains a conflict, never current truth. Independent review caught an 800/1600-character round-trip mismatch; new facts omit the redundant legacy display field and long ADD/conflict/correction regressions pass. CI run `34797336298` passed before merge.

ZMR-25 [PR #1272](https://github.com/zenod-ai/zenod/pull/1272), reviewed head `e6cdc63e95fcc21918ba43ae4558be683333c508`, uses an internal typed terminal submission in the existing answer loop. It ends without a recovery completion, preserves support identity/mode/snapshot validation, and keeps authorized action receipts intact. Independent review found and repaired final-round submission in mixed chat. A fabricated late action remains blocked at execution. Actual SDK tests cover streaming, pinned reads and round boundaries; none proves fresh model selection quality.

The evaluation safeguard [PR #1271](https://github.com/zenod-ai/zenod/pull/1271), head `d2ae95dad22d98091a870acedbd5bd3c5495b493`, passed independent review, 18 offline checks and CI `34796910545`. A terminal provider quota response now prevents subsequent retry/trial transports, retains partial evidence and reports unstarted trials separately. Reported usage and unknown-cost reservations remain separate. Production billing and credentials are unchanged.

Combined local source `b013b8ae284b9c85102b9a8f92115cda64ad0a9e` passed the full monorepo build, 107 focused product tests across nine files, 18 evaluation tests and 27 schema checks. This is offline integration evidence. Recorded source-operation replay applies eight of eight previously routed branch decisions; two previously omitted classifier ideas still require a fresh model run. Replaying historical prose through the typed protocol correctly reports missing submission, not successful semantic acceptance.

Architecture remains the existing raw archive/Log, durable enrichment queue, bounded branch context, cited Markdown meaning and answer loop. No new service, vector database, model switch or extra judge call is introduced. Exact source custody does not establish complete idea selection, correct semantic equivalence or adequate qualifications across adjacent sentences. Those are mandatory actual-model acceptance checks. Source-native output can remain in the original language.

Paid regression is paused pending restoration of the existing OpenRouter key's quota. Independent Spanish/English ASR fixtures remain unconsumed. No production deployment, historical bulk repair, new credential, quota increase or billing change occurred. The next release gate remains fresh semantic acceptance, independent ASR, verified recovery, then the authorized bounded production rollout and isolated live tests.

CI note: ZMR-25 run `34797572743` first failed on temporary Git pack-directory cleanup (`ENOTEMPTY`) in the engine suite, with 802 core tests passed and no assertion failure reported. The two affected parametrized cases passed independently against combined source. The same exact head passed rerun attempt 2 and was merged. No assertion was weakened or fixture changed.

Final integration source `56c2308ebb4ccf180776a3500f4e457e7d912db8` is tree-identical to the tested combined commit above. All three PRs are merged after exact-head review and CI; ZMR-25 passed run `34797572743` attempt 2. Frozen clean checkout: `/Users/jordi/Documents/GitHub/wt-zmr-final-contract-check`. This remains an unaccepted production candidate pending actual model/ASR evidence; image publication is not deployment proof.
