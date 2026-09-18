# M2 — Dependable basic memory and conversation

Status: active, establish the fixed baseline before changing product behavior.
Owner: current ZMR delivery manager (/root).
Authority: user's2026-09-16 request for stable basic storage, retrieval and natural recent-context conversation in production. Existing production authorization remains applicable to reviewed bounded repairs.
Parent: [Memory Reliability spine](../EPIC-ZENOD-MEMORY-RELIABILITY.md).
Current deployment observed: `2a4ff6623fc6efa48355c5e697dd38c9c4833f67`. Re-pin the actual candidate at dispatch and verify deployment identity independently.

## Outcome

A user can save a short memory or a multi-topic note, retrieve the right information later, and continue discussing it naturally. We demonstrate this on a small fixed set of real-agent scenarios on the deployed version. We do not equate passing storage guards with good service or promise universal reliability from finite tests.

The previous M1 proved storage/retry preservation and a standalone summary. Its acceptance did not establish reliable multi-turn follow-ups. That gap is the explicit starting point for M2, not an assumed solved prerequisite.

## Working contract

[Prompt/context/tool explanation and slide](librarian-model/README.md). One source of conversational focus, one evidence-first store path, one source-reading answer path. Keep existing stores, queues and models. Reuse the existing runner and synthetic chat seam. Tool schemas, prompts and limits are versioned alongside the code.

## Fixed basic scenarios

These are scenario specifications. Concrete synthetic fixtures, exact prompts and expected facts must be frozen before the first scored candidate run. Expected answers never enter model requests.

| ID | Scenario | Pass condition |
|---|---|---|
| B01 | Save a short fact | Immutable source, terminal durable receipt and truthful acknowledgement |
| B02 | Recall it in a fresh conversation | Correct fact, relevant readable citation |
| B03 | Recall using different wording | Same fact found without supplying a hidden source reference |
| B04 | Save a note with three independent ideas | Each required idea correctly filed or explicitly unresolved for a genuine reason; raw source retained |
| B05 | Retry interrupted filing and repeat the same capture | Valid siblings survive, original input unchanged, no duplicate evidence or completed effects |
| B06 | Summarize a long note | Beginning, middle, tail and required qualifications covered |
| B07 | Find the latest voice note among distractors | Category and source capture chronology select the correct note |
| B08 | Follow a summary with a question about its tail | Same conversation resolves the note and reads the required passage |
| B09 | Discuss two subjects, then ask about the second | Correct recent referent, without mixing another thread |
| B10 | Ask "what do you think about it?" after a note | Resolves the note, answers usefully, separates sourced premises from analysis |
| B11 | Correct a fact, then ask current and previous values | Explicit correction and history preserved and distinguished |
| B12 | Ask about an uncertain estimate and an unknown fact | Preserves uncertainty and honestly identifies the missing information |

## Additive regression suite — v1.2

The 2026-09-18 ordinary-use incident `how many voicenotes did we store last 10 days? length of each?` is pinned as **B13** in the additive `m2-basics-v1.2` suite. The v1.1 12-case/36-outcome fixture and rubric remain frozen and unchanged. B13 uses a synthetic date frame, separates `voice_note` from ordinary `audio` and text, and requires a typed bounded inventory count plus transcript-character lengths with an explicit statement that audio duration is unavailable in the memory MCP. It rejects the live broad lexical partial-coverage failure. The suite is selectable with `--suite v1.2 --select B13:1`; exposing audio duration through a typed memory field remains a separate product decision and ticket.

## Score and finish line

Run three independent trials per scenario on the same candidate: 36 outcomes in v1.1 and 39 in the additive v1.2 suite. Retain dialogue within each scenario and reset fixture/state between trials. Every case must pass3/3 for this small foundation gate; critical custody, duplicate and isolation failures always block. This measures the specified cases, not a universal accuracy guarantee.

Use actual `engine.chat`/synthetic chat for conversational cases. Direct `engine.ask`, scripted model outputs and hand-pinned source references cannot substitute. Keep existing deterministic unit tests as a separate fast layer.

Record code SHA, actual deployed SHA, harness/prompt/tool/fixture/rubric hashes, both model configurations, per-case result, read coverage, citations, latency, requests/tokens and provider-reported cost. Failures and retries count. Unknown cost stays unknown; reservations are exposure. Incomplete/budget-stopped runs never become a pass over a smaller denominator. Show case-level regressions beside overall score and cost per passed scenario.

After isolated acceptance, verify the same candidate through production MCP in an isolated test tenant/fixture to avoid test facts in the user's brain. Also replay the known original-note summary/follow-up read-only against the owner's current data. A fresh WhatsApp journey must be named separately: MCP does not prove phone delivery. Use a real user-sent note/message when available; outbound sending requires the existing explicit message authorization.

No release is "done" from unit tests, one successful prompt, a pinned summary, a partial run or a process exit code. Record the exact production results and retain every failing attempt.

## Delivery order and scope

1. EXTEND `scripts/zmr-pipeline-eval` and `packages/server/src/testHarness.ts`: freeze the12 cases and scorer, add retained conversation trials and a per-version report. Produce current-version baseline including known failures.
2. EXTEND existing prompt/context/read/submission units: fix only observed failures, one small reviewed change at a time. Repeat affected cases, then run the full fixed suite on the selected candidate.
3. REUSE the established backup/deploy/rollback mechanism: deploy the reviewed candidate, run production acceptance, record exact SHA and hand off limitations.

No provider comparisons, storage redesign, new services, broad taxonomy cleanup, bulk historical refiling or UI expansion. Do not add more cases mid-comparison to turn this into an open-ended benchmark project. Future cases get a new suite version.

## Decisions

| ID | Decision |
|---|---|
| M2-D1 | Preserve existing model configuration while establishing this baseline. Changes must be explicit comparison dimensions later. |
| M2-D2 | Score meaningful user answers; citations or successful tools alone never imply correctness. |
| M2-D3 | Opinion requests need grounded premises and labelled analysis, not blanket evidence refusals. |
| M2-D4 | Existing production changes from other tasks must be reconciled before implementation/deployment; do not overwrite or falsely attribute them. |
| M2-D5 | Missing fixtures/cost telemetry are harness defects to expose, not reasons to silently score a substitute. |
| M2-D6 | No recurring monitor or paid evaluation has been started by this planning step. Use existing bounded budgets when executing; never silently raise them. |

Next action: bind [the single harness ticket #1313](https://github.com/zenod-ai/zenod/issues/1313), freeze its fixture/rubric and produce a complete current-version baseline. The slide and audit are available now; M2 is not yet implemented or production-accepted.

## Results artifact

User requested2026-09-16: publish a durable standalone HTML slide in this repository when the test batch finishes. Show case/trial pass/fail/incomplete states, exact candidate/harness/fixture/models, total known cost and unknown exposure, and next fixes. Distinguish isolated engine, production MCP and WhatsApp evidence. Target: `docs/planning/zenod-basics-test-results.html`. Retain failed attempts in version/cost history; no optimistic passing denominator.
