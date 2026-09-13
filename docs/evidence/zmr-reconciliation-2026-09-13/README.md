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
