# Zenod memory upgrade — complete handoff and lessons

Recorded: September 15, 2026, 02:00 Europe/Paris. This is a checkpoint, not a deployment receipt.

## Read this first

**Current update:5e0dcf1 is deployed and independently verified, but live filing/natural-chat acceptance failed.** The original-note recovery ended with0filed,13pending,1uncertain; raw evidence/capture remain unchanged. Confirmed blockers are truncated classification output, existing overlong Housing metadata rejecting atomic edits, long read-lock waits during organizing, and a guard mistaking quoted artifact URLs for mutation claims. Exact-source six-bullet summarization passed after filing stopped. Candidate f89fc554 passes CI/image publication, but merge and deployment are held for isolated original-note acceptance. See [regroup decision and contracts](zenod-memory-regroup-2026-09-15.md) and [live release evidence](../evidence/zmr-live-a43f7ee/README.md). Earlier checkpoints below are historical, not current completion claims.

**Resumed September 15 at Jordi's explicit request to complete without deviating.** The earlier pause is over. Follow the active spine for fresh deployment evidence; this note preserves the investigation checkpoint.

The standing delivery direction is to **separate model performance experiments from shipping the ingestion/retrieval upgrade, retain MiniMax M3, and get the existing product working in production**. Provider experiments are stopped. Do not restart them as a deployment prerequisite. Do not ask again for the already-authorized bounded Zenod deployment, testing, or recovery of the single original voice note.

The delivery mistake was coupling an authorized upgrade to repeated DeepSeek evaluations and expanding the repair loop without completing the production handoff. Useful bugs were found, but tests, merged PRs and published images were repeatedly substituted for progress toward a live result. There was no outstanding user approval or unavailable key justifying this delay.

Authoritative delivery spine: [Zenod Memory Reliability](../EPIC-ZENOD-MEMORY-RELIABILITY.md). Earlier research and target flow: [memory reconciliation research](zenod-memory-reconciliation/README.md). Earlier operational lessons: [release learnings](zenod-memory-release-learnings.md).

## Intended architecture

1. Capture the original binary and exact transcript durably. Create a Log evidence entry with their pointers, source identity and timestamp. A capture receipt must distinguish archived/transcribed from semantically filed.
2. Process the saved evidence in the background. Identify topics and their existing destinations using bounded context. Keep unknown destinations pending instead of guessing.
3. Compare each proposition with existing knowledge. Add new information, link another source to equivalent knowledge, preserve explicitly corrected history, and retain unresolved conflicts and qualifications.
4. Publish through the existing page transaction and durable receipt. Retry unfinished work without duplicating completed work.
5. Retrieve actual evidence before answering. Search is discovery; a search hit or citation is not itself claim support.

The implementation still uses the existing engine, queue, vault/Git/Drive storage, SQLite state and publication mechanism. No second memory system, translation model, vector database or separate judge service was introduced. The latest grouped-operation and pending-discovery fixes add no model call.

## What caused the reported incident

- The original long voice note had archived audio and a transcript. This was not proof that its ideas had been filed.
- Its organizing job finished with a pending result and `classification_unavailable`; the historical classifier failures did not retain enough detail to assign a more specific cause confidently.
- The subsequent WhatsApp summary and retry failures returned an OpenRouter 403 explicitly identifying the key's monthly spending limit. Jordi restored the limit. A later read-only summary call succeeded, but that was not proof of WhatsApp delivery or completed semantic filing.
- Restoring quota did not automatically retry the already-completed/pending organizing job. A deliberate recovery of that one existing job remains necessary. Resending or retranscribing the note is not required.
- Detailed original-note identifiers, private evidence, diagnostic output and the reviewed single-job recovery helper are kept in the private operator evidence directory, not reproduced in this document.

## Implemented repairs and what they establish

| Area | Repair | Important limit |
| --- | --- | --- |
| Raw evidence | Preserve exact supplied transcript bytes; stable source identity; unique source quotes and adjacent passage references | Addresses prove where text came from, not whether the model understood it |
| ASR quotes | Map only unique whitespace changes back to exact raw UTF-16 spans | No fuzzy case, punctuation, number, accent or negation rewriting; no global rescue of a wrong passage address |
| Classification | Per-topic destinations, owned-window source validation, and assigned-passage coverage checked through the existing bounded retry | Invalid or unknown topics remain pending; valid siblings can proceed |
| Minimal updates | Source-native ADD, LINK_SOURCE, SUPERSEDE, CONFLICT and CLARIFY decisions against pre-batch targets | A familiar subject does not make a new qualification equivalent |
| Corrections | Preserve complete correction reports and old history; distinguish an unconfirmed alternative from a correction | Unknown effective dates and verification scope stay unknown |
| Numeric guard | Compare numeric target literals only when comparable literals exist | A spelled-out Spanish date must not be rejected merely because the correction uses digits |
| Durability | Prepared/ready receipts, exact publication plans, completed idea/page outcomes, generation fencing and vault write serialization | Old and new writers must not overlap; incomplete publication must not be discarded during rollback |
| Retrieval | Bounded read packets, source-derived claim previews, complete list/sentence supports, navigation excluded from claim handles | Qualification and clipping boundaries remain significant |
| Answer protocol | Host-owned support IDs and typed final submission; render only validated selected support | Valid IDs do not establish that the selection completely answers the question |
| Search/read boundary | Search no longer automatically loads unrelated fact projections or enables premature claim submission | Actual note/fact/evidence reads are required |
| ZMR-37 | Multiple atomic operations may belong to a coarse classified idea; connected groups validate together before contributing edits | This permits the correct decomposition; it cannot guarantee that every model chooses it |
| ZMR-38 | Matching pending-topic labels expose a bounded pointer to validated original evidence | Receipt internals remain excluded; this is discovery, not generated claim evidence or automatic translation |

### Why grouped operations were necessary

The old contract demanded exactly one reconciliation operation per classified idea. Actual tests repeatedly combined an existing assignment with a new rain condition, then selected LINK_SOURCE for the dominant existing assignment. The new condition disappeared despite the idea being marked filed.

ZMR-37 keeps the existing flat, bounded operation array and page receipt. Operations sharing idea IDs, exact claims or target resources form a group. Invalid or clarification operations prevent the entire group from contributing edits; healthy unrelated groups can succeed. Targets refer to the original snapshot. Duplicate effects render once while accounting for all idea outcomes. Conflicting replacements and correction fields are checked. Completed-idea and changed-wording replay protections remain.

Independent review found and repaired two real defects in the first draft: duplicate ADD effects under different idea IDs, and supersession compatibility that ignored replacement/correction fields. Final reviewed source is `6f21a43c8ed2b15d4c9e281f346b49c7fe76bf66`. Worker validation included 81 focused tests, 112 engine tests, five queue-recovery tests and a full build; independent reviewers also ran targeted suites. These are code correctness results, not model-quality or deployment proof.

### Why pending-topic discovery was necessary

Two failed English recall attempts searched for a library topic in a Spanish recording. The English topic label existed in a pending filing receipt, which search intentionally excluded. Raw lexical search did not match the English query. The model read an unrelated cooking page and submitted an empty answer. A successful repeat explicitly read the Log and found the answer.

ZMR-38 reuses the receipt envelope validator and raw evidence parser. It limits receipt count, total bytes, topic count and raw reads; validates canonical receipt filename/evidence-ref identity, realpath containment, source spans and exact quote support; and returns only a pending label plus the original raw ref. Strict replay fingerprint validation remains unchanged. Search itself creates no answer-support handles. A real engine test follows search → raw read → supported selection.

Final reviewed source is `a43f7eecce496b09b89462cee95fef15fde30376`. Worker checks passed 29 focused tests and core build; independent review passed 28 helper/receipt tests and 20 filtered engine/receipt tests. No blocking finding remained. Cross-language discovery improves only where an existing pending label matches; no universal multilingual semantic-search claim is justified.

## Model experiments — parked, not a release gate

Requested candidate: `deepseek/deepseek-v4.1-flash` through OpenRouter. Existing organizer: `minimax/minimax-m3`. Ask/compose remained `x-ai/grok-4.3`; production transcription was not switched. Local real-ASR tests used a separately verified Whisper large-v3-turbo asset and do not prove phone ingestion.

Both Together and Modal were tested through explicit provider routing. Together-first runs encountered request deadlines and an upstream error. Modal-first sometimes fell back to Together, so configured order must not be reported as the actual serving provider.

Reasoning disabled produced cheaper complete responses but sometimes bundled new details into false reinforcement. Low reasoning sometimes preserved more distinctions, but frequently used large reasoning budgets, truncated structured output or returned low-confidence repair output. Increasing low classifier output to 16,384 solved one observed truncation; a later run still used 13,995 reasoning tokens and truncated at that larger ceiling. **Do not keep raising output limits as a substitute for a cost/reliability decision.**

[DeepSeek's official encoding documentation](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/encoding/README.md) maps the string low to native effort 50/100. It is not a hard reasoning-token cap. OpenRouter model metadata advertised low/high/max and did not advertise direct reasoning-token budgeting. No unverified numeric-effort passthrough was implemented. [OpenRouter's reasoning documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) explains that reasoning consumes billed output tokens.

Observed model prices must remain separate from evaluation reservation ceilings:

| Model | Advertised input/output per million | Conservative evaluation reservation |
| --- | --- | --- |
| DeepSeek V4.1 Flash, reviewed Together/Modal routes | $0.30 / $1.20 | $0.375 / $1.50; output ceiling 8,192, later a separate 16,384 artifact |
| MiniMax M3 | $0.30 / $1.20 | Unpinned endpoint maxima $0.75 / $3.00, 8,192 ceiling |
| Existing Grok ask stage | Not reselected in this work | Existing conservative $5 / $10 ceiling retained |

These are dated observations, not permanent prices or a completed apples-to-apples quality comparison. The later MiniMax packet was read-only preparation; no new MiniMax performance run had been executed at this checkpoint. Do not describe DeepSeek as proven cheaper in the complete workflow merely from list prices.

### Selected actual-run results

The text case contains ten expected meaning outcomes plus an intentionally ambiguous destination. Recall uses six questions in three fresh sessions, with 48 required subclaims. Audio cases use separately frozen Spanish and English recordings. Once used to diagnose failures, these became development regressions, not held-out evidence.

| Exact candidate/run | Result | Reported cost |
| --- | --- | --- |
| `66f84a9`, text | 10/10 meaning, 18/18 answers, 48/48 subclaims; ASR subsequently exposed separate failures | $0.25614 |
| `108ecb1`, text | 10/10 meaning; 16/18 answers | $0.21680 |
| `10019d8`, low, Modal-first text | 9/10 meaning; 12/18 complete answers | $0.24786 |
| `c19eec1`, low, Modal-first text | Independent 10/10 meaning, 18/18 answers, 48/48 subclaims; byte-identical replay | $0.24855 |
| `c19eec1`, Spanish low | Output exhaustion followed by zero-confidence classification; 6/9 recalls | $0.11408 |
| `c19eec1`, Spanish none | Partial filing; rain/pump qualifiers lost or pending; 6/9 recalls | $0.09781 |
| `15d249e`, Spanish low | Classification completed; pump cost preserved, rain condition lost; 7/9 recalls | $0.08724 |
| `6f21a43`, Spanish low | Rain now preserved; another pump qualification still collapsed; 8/9 recalls | $0.11617 |

These are selected runs, **not total investigation spend**. Earlier quota/deadline attempts include unresolved cost reservations and are recorded privately; do not add this table and call it the total. Runs were bounded by request/deadline/cost policies. A provider timeout does not establish zero billing or cancellation. No later English/text run was silently claimed after a held Spanish failure.

Repeatedly passing custody, source fidelity and replay tests did not mean semantic completeness passed. Likewise, a correct answer found in the raw transcript did not prove the information had been integrated into the organized page.

## Exact delivery state at this checkpoint

- Production: source `631f85109dfa45fed95394a1e94d2d709c373fe6`, image `ghcr.io/zenod-ai/zenod@sha256:081c15fd9570e0c49d3361128e69cf1d533cb8fab500ca2648d71c80192375b1`.
- Latest verified production observations were healthy, one replica, expected volume/environment, and an empty deployment queue. These observations must be refreshed for an actual deployment; they are not proof of a deployment now.
- ZMR-37 [PR1305](https://github.com/zenod-ai/zenod/pull/1305) is merged at `db3fbbdde3b992630e74f897157b529fa738b745`, with green CI. Its product source matches `6f21a43`.
- ZMR-38 [PR1307](https://github.com/zenod-ai/zenod/pull/1307) is reviewed. Product candidate `a43f7ee`; release integration `29226aa224ceaa01752b6b705bd2267cfd0b957e` preserves that non-document source tree and current-main docs. Its CI was still running at the final handoff; refresh its status when resuming.
- The exact `a43f7ee` image publication run `34911274663` succeeded. Release preflight verified Linux/amd64 OCI revision `a43f7eecce496b09b89462cee95fef15fde30376` for `ghcr.io/zenod-ai/zenod@sha256:ef633ca327c397629e455010dfbd91d3e5dd147bd33422b6e10de3be61d1aa8a`. Private proof: `publish-a43f7ee-proof.json`. This image is published, **not deployed**.
- Final prepared operator packet: `/Users/jordi/.local/state/zenod-zmr-20260915/operator/a43f7ee-recovery-command-packet.md`, SHA256 `53e29206a2d744af2e22149c12cae2dbc471123136d83dddde29103ca7c6d6c4`. Prepared only; refresh baseline and queue checks when resuming.
- No fresh deployment backup, production deployment, owner setting change or original-job requeue has occurred.
- Current approved delivery configuration is **existing MiniMax M3 with existing reasoning/provider settings preserved**, not the prepared DeepSeek setter configuration.

## Operational recovery already prepared

Use [the existing deployment runbook](../runbooks/zmr-production-image.md), `scripts/zenod-volume-backup.sh`, and `scripts/zmr-production-image.py`. Do not build another deployment framework.

Required before deployment: exact reviewed image/revision, fresh protected app/service/container/image snapshots, quiesced backup, successful disposable restore verification, verified independent offhost copy, recovery manifest, and current deployment-queue clearance. The existing helper stops old/new writer overlap, verifies actual image/OCI/health/environment/mounts, and has a receipt-based rollback path. Do not reuse an old intent or invent a successful restore receipt.

The only existing database schema addition identified in the release is nullable `task_jobs.claim_token`. Existing rows/settings remain compatible. The prior binary can read the additive column, but cannot enforce the new writer fence. An old binary must not resume an incomplete new filing/publication receipt blindly. Preserve unpublished vault state.

Private operator tools were prepared and reviewed for isolated testing, owner model configuration, and the one original VN recovery. **The owner DeepSeek setter must not run under the current delivery decision.** The original recovery helper requires the new runtime migration, fresh exact source/job/settings/custody checks and a quiescent single-job compare-and-set. It preserves job input, archived evidence, raw Log content and idempotency identity. Remote archive URLs are verified from the receipt; fresh remote file-byte verification was not performed and must not be claimed.

## Where the detailed evidence lives

- Private run evidence: `/Users/jordi/.local/state/zenod-zmr-20260913/`, `zenod-zmr-20260914/`, and `zenod-zmr-20260915/`.
- Each run directory contains frozen inputs, raw wire requests/responses, before/after/replay pages, usage and independent review receipts. These include private source material; do not publish them wholesale.
- Private operator preparation: `/Users/jordi/.local/state/zenod-zmr-20260915/operator/` and the earlier September 13 operator directory. Check artifact hashes and current assumptions before execution.
- Frozen latest product worktree: `/Users/jordi/Documents/GitHub/wt-zmr-38-pending-discovery`.
- Delivery notes/steward worktree: `/Users/jordi/Documents/GitHub/wt-zmr-delivery-receipts`.
- Leave `/Users/jordi/Documents/GitHub/zenod` and unrelated worktrees' existing changes alone. PR integration branches may differ in docs while their non-doc source equals the tested candidate; verify both identities rather than assuming drift.

## Next actions and deferred work

Finish the reviewed ingestion/retrieval release, retain MiniMax, deploy with the existing recovery process, and verify actual production behavior including the preserved original note. Report exact deployed source and actual filing/recall evidence. Model performance studies are a separate follow-up, not a prerequisite for this release.

Deferred architectural simplification: classifier temporal facts are partly duplicated and partly still consumed. Effective-date and verification metadata currently pass through a host-only fact-key plus exact-statement match; correction semantics come from reconciliation and host targets. Removing classifier facts outright would lose metadata. A future simplification could move necessary temporal metadata into the existing reconciliation result, preserve legacy compatibility and measure cost/quality. No savings or implementation are claimed now.

Do not add more release requirements, provider experiments, new services, broad historical refiling, sibling deployment, billing/signup changes or outbound WhatsApp messages to finish this scoped delivery.

## September 15 continuation — concrete integration lessons

The organizer target is `openai/gpt-5.6-luna`, low reasoning, existing OpenRouter key, 8192 output cap. Production remains `5e0dcf1` with MiniMax while acceptance is incomplete. Model selection itself is a settings change; the additional work has been repair of observed pipeline contracts, not a provider benchmark.

- Send the existing destination title/scope to the organizer. Dropping it caused semantic misrouting despite correct source text. Restoring it stopped the observed Family/Positioning misroutes; genuine unknown destinations stay in review.
- Prefer issued source identifiers to freely generated identifiers. Request-specific enums constrain assignment and operation references without a storage migration.
- Validate and render canonical raw bytes. The observed source quote differed only by a space after a period; narrow, unique punctuation-spacing normalization fixes that formatting error while retaining word/number/punctuation, ownership, gap and ambiguity checks. Independently reviewed in `1e9102b` with131 focused tests.
- A valid tool submission is not a useful answer. Making summaryText explicitly nullable revealed that Grok intentionally selected excerpts; the JSON schema was not losing a summary.
- Reading coverage and citation scope are separate. In d68, a corrupted continuation cursor prevented full natural reading. A pinned summary selected only a metadata paragraph as its support, so rendering success did not prove grounded whole-note summarization. Short model-facing cursor aliases and a strictly complete-source summary handle are the next bounded implementation, not yet deployed.
- Keep acceptance collection under one ledger. The d68 run spent16 requests/$0.10135297 across initial filing, one partial retry and two asks. The retry preserved completed operations and raw evidence but added no meaningful-page content. Preserve this partial result; do not turn a pinned answer or a filed count into acceptance.

Current source ticket remains #1310 / PR1311. Root is sole production operator. No new service, taxonomy rewrite, bulk refiling, provider comparison or outbound message is part of this work. Exact current evidence and next action remain in the Memory Reliability spine and release evidence file.


## September 15 production update — supersedes earlier deployment/model status

Reviewed source961793e2f81a5ba6c9fa72636d0e3a6ff1592c5a is deployed at cloud.zenod.dev; PR1311 is merged as411aba520a7a901f82d56394d5ebf4bb89769b86 with identical tree. Organizer is now openai/gpt-5.6-luna with low reasoning using the existing OpenRouter credential. Ordinary ask remains x-ai/grok-4.3. The switch is complete, not blocked on benchmark work.

The original-note live retry preserved raw content exactly and produced12filed13uncertain5pending. Post-filing ordinary latest-note chat found the original source without a pinned reference, read its full transcript in three bounded reads, and returned a useful cited summary including housing uncertainty and researcher/creator direction. This is verified retrieval success, not proof all semantic filing is complete.

Operational lessons: bound SSH subprocesses with connection/liveness and process timeouts; a read-only SSH stall after configuration update must be distinguished from an ambiguous deployment POST. Retain the original intent and inspect actual service/deployment state before completing a missing step. There is no public terminal enrich_memory retry API: get_task_result only polls, store_memory would create a different capture operation, and ingest-file retry targets another queue. A future simple owner retry control belongs in backlog; current original-note recovery uses a narrowly reviewed same-row CAS without resetting the receipt or completed effects.

Remaining filing limitations at this checkpoint: creator source-support rejection, context-budget pending work/travel and visit details, one clarification, assigned salary urgency omitted from saved prose, and overlapping unresolved reports sometimes labelled conflicts without an actual contradiction. Model substitution does not prove these host/model contract problems resolved. Finish only the bounded pending retry and review its preservation evidence; avoid another unbounded synthesis or provider experiment loop.


Final bounded M1 result: accepted after one selective retry at f522887e9f129cf602cd809590facc9b326bf764.15filed13uncertain2clarification-pending, with no remaining technical source/context failures; all27 earlier operations and exact source/legacy/citation preservation pass. Two genuine destination questions remain. Specific Taya visit and salary urgency are not represented in meaning prose despite preserved evidence; these and overlapping conflict labels remain follow-ups. Current source/model deployment is complete; do not resume provider switching, redeploy or repeat the original-note retry merely because broader semantic polish remains.
