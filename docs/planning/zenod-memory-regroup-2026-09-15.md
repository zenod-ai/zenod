# Memory delivery regroup — September 15, 2026

## Active milestone M1 — dependable capture, filing and recall

Owner: /root, delivery manager. Goal activated September 15, 2026 at Jordi's request. This milestone narrows the first working release; earlier failed runs remain failures.

**Simple mechanic:** immutable evidence → bounded idea proposals → independent validation per idea → small cited addition or source link to an existing page → durable per-idea receipt. An invalid idea cannot discard valid siblings. An optional refinement cannot replace accepted work with invalid output. Retry only unresolved work within the existing retry/cost limits. If the destination or support is uncertain, retain the idea and its precise reason in the existing review inbox; do not invent a destination or silently drop it. Answers resolve the saved evidence directly and do not require perfect organization.

**Done means all six checks pass on one reviewed production version:**

1. Original audio/transcript pointers, source identity and raw Log bytes remain unchanged.
2. The original September 14 note produces useful source-backed filing covering housing options, home/location requirements and researcher/creator direction. Preserve uncertainty and corrected arithmetic. Partial filing alone is not a pass; explicitly account for remaining ideas.
3. A mixed valid/invalid input proves valid ideas survive; unresolved work stays visible with a precise reason. No technical failure is relabelled as semantic uncertainty, and no unlimited retries occur.
4. Repeating the same input preserves completed work without duplicate prose/citations. Legacy page content survives. Replaying completed work requires no new model calls for that work.
5. An ordinary latest-note summary selects the original evidence and covers beginning, middle and end with citations. Concurrent filing yields a prompt honest busy response if necessary, then succeeds after filing finishes; pinned-only success is insufficient.
6. First prove the isolated original-note case, then deploy the exact reviewed image to public Zenod and repeat the live checks. Record exact deployed SHA, receipt and limitations. Existing captured note is reused; no new phone recording or external message is required.

**Allowed simplifications:** a short sourced bullet or excerpt is sufficient where it accurately conveys one idea; a polished merged narrative is not required. Existing pages plus the existing review inbox are sufficient; perfect project creation and tree design are deferred. Genuine uncertain destinations can remain for review, but core source-grounded content and usable recall must work.

**Delivery discipline:** one implementation ticket, one independent reviewer, then root-owned acceptance/deployment. First repair the measured classifier/retry isolation failure. After each test fix only its first named blocker. After two failed acceptance laps on the same blocker, stop speculative edits and record the cause and simplest within-scope alternative before another attempt. Report each phase as implementation, isolated proof, deployment or live verification; never conflate them.

**Deferred:** broader provider/model comparisons, higher global token limits, perfect synthesis, automatic taxonomy redesign, new services/storage, bulk historical refiling, sibling deployments, billing/signup and UI redesign. Carry these forward without making them release gates.

## Decision

Stop the open-ended production patch cycle. Keep MiniMax M3 for organizing and the current ask model. Freeze candidate `f89fc55414dcb97d9bfb2a291e18296a587b860a`; let its CI/image builds finish, but hold PR1309 merge and deployment until one isolated end-to-end replay passes. The live service remains on `5e0dcf1`; capture is preserved, but automatic filing and ordinary latest-note chat have not passed acceptance.

This is a narrower delivery checkpoint, not a new architecture, provider evaluation, general benchmark or expanding backlog. The parent is the sole production operator. Subagents prepare and independently review the isolated proof.

## The four units and their contracts

| Unit | Input → output | Invariant |
| --- | --- | --- |
| Capture | Received audio → archived binary/transcript + immutable Log reference | Exact evidence, source identity and timestamps survive; captured does not mean organized. |
| Organize | Saved evidence + bounded relevant page context → source-backed proposed operations per idea | Every clear idea gets a disposition; uncertainty and alternatives remain qualified. |
| Publish | Validated operations + expected page revision → durable page/receipt publication | Preserve existing material; no half-published success, duplicate effects or lost retry state. |
| Retrieve | Question → selected evidence → supported answer | Resolve the referenced latest item correctly; read adequate evidence; never substitute an action receipt or older note for the requested summary. |

The concept is coherent. The implementation still couples these units: model calls occur inside the vault writer lock; whole-page rules can reject an otherwise valid atomic edit; source-address contracts control downstream availability; answer guards can misread quoted artifact metadata. The immediate busy response is a bounded mitigation, not a claim that reading and organizing are fully independent.

## One acceptance case, fixed before running it

Use the preserved September14 voice note `Log/2026-09-14.md#^e-cd4853`, the exact existing Housing page with its oversized legacy summary, and sufficient unchanged brain context for real destination selection. Make an isolated copy. No production writes, remote vault pushes, new capture/transcription or model switch. Use existing adapters and test mechanisms; do not create a parallel memory implementation to make the test pass.

Independently enumerate expected propositions from the whole source before scoring. They include the tentative cash/build versus mortgage alternatives, risk and corrected exit arithmetic, desired home characteristics, unresolved location, home-base/travel tradeoff and researcher/creator direction. Exact topic labels/counts are not the criterion.

The combined run must show:

1. **Custody:** input, raw transcript and archive-reference hashes unchanged.
2. **Meaning:** clearly routable propositions represented once, with valid source citations; qualifications retained. Genuine unknown destinations remain explicitly pending. Technical failures cannot be relabelled as harmless uncertainty.
3. **Publication:** legacy summary/body/history preserved; touched page validates; local isolated publication and its receipt agree. Production GitHub publication requires a subsequent live check and is not implied by a local test.
4. **Retry:** same input/fingerprint; completed work is skipped; no duplicate prose or citations. A complete replay adds no model work. No unlimited retry loop.
5. **Reading:** a concurrent question gets a prompt explicit busy response rather than a timeout or invented answer. After completion, the ordinary latest-note request selects this note and produces a concise cited summary covering beginning, middle and end. A manually pinned summary alone does not satisfy this condition.

## Evidence and stopping rule

Record exact source, fixture hashes, adapters/models, call/token/cost counts, per-idea dispositions, changed pages, publication/retry proof and the natural answer. Keep transcript, credentials and private page content out of public evidence.

If the isolated replay fails, name the failing unit/contract and fix only that failure before repeating. Do not deploy speculative prompt changes and use production as the next debugging fixture. If it passes, integrate/deploy the exact tested candidate using the already-authorized bounded release procedure, then verify the same outcome live.

Unit/fake-SDK tests establish individual guarantees. This isolated replay establishes this combined case. Neither proves universal model quality, historical vault coverage, new handset/ASR behavior or production delivery by itself.

Full history: [handoff](zenod-memory-upgrade-handoff-2026-09-15.md). Actual deployment and failed checks: [release evidence](../evidence/zmr-live-a43f7ee/README.md).

## First isolated result

FAIL:3filed,12pending,1uncertain;6calls,$0.03563911. Raw evidence and local publication invariants passed. One invalid subset of assignments caused whole-window rejection; a truncated retry and destination/assignment failures in later refinement left organizing incomplete. The three applied topics came from valid preserved receipt entries. This demonstrates inadequate failure isolation inside organizing. Next design checkpoint: retain valid per-idea results while rejecting/retrying only invalid work, without weakening evidence validation. No additional production rollout is justified yet.

## Model decision superseding the earlier MiniMax freeze

Jordi explicitly requested GPT-5.6 Luna on September 15. Public OpenRouter catalog confirms exact `openai/gpt-5.6-luna` with structured output support. Root changed only owner organizing configuration (`model_classify`) to that model and set supported reasoning `none`, leaving Grok4.3 ask, provider/key,8192 output cap, deployed image and all other service settings unchanged. No active task jobs existed at the update. Prior config is backed up privately; existing authenticated empty settings PUT returned200 and invalidated cached runtime. No application deployment/restart was required. The original-note Luna isolated test is next; config success does not prove filing success. This user decision supersedes the goal text's earlier keep-existing-models constraint; M1 acceptance remains unchanged.

Operational correction after Luna proof: root restored the exact previous M3/unset-reasoning live setting while the strict-schema compatibility repair is validated. The Luna configuration caused deterministic reconciliation HTTP400s; keeping it active before the repaired application is released would break ordinary filing too. No active task jobs existed at rollback; private before/rollback receipts retained and authenticated runtime invalidation returned200. **Current effective organizer: MiniMax M3. Target release organizer: GPT-5.6 Luna/none.** Grok ask unchanged. Restore Luna with the tested compatible release; this is not abandonment of the user-requested model change.

## Acceptance consistency clarification — independent audit

The private runner's zero-technical-pending prerequisite is stronger than M1 and must not prevent collecting replay or recall evidence. This does not change the required useful source-backed coverage: clearly routable housing/options, home/location and researcher/creator propositions must be represented with qualifications and corrected arithmetic, and every remaining idea must be explicitly accounted for. Technical failures remain technical failures; marking omitted core content pending is not a pass. Completed work must not be regenerated or duplicated while unresolved siblings retry within existing bounds. A completed-only replay requires zero model calls; a partial retry may call only for unresolved work. Ordinary full-note summary and exact live deployment remain mandatory. Earlier runs remain failed because useful core coverage and the ordinary summary are missing. Measure these units independently and retain a combined acceptance decision grounded in all six criteria.

## Luna reasoning diagnostic decision

After selector repairs, NONE produced14filed ideas but failed semantic coverage and routed dating content to a family-specific page. Root will test LOW reasoning on independently approvedac9cd4126942f7b818226193858b65fa25b14fbc against the same original note before adding more routing rules. The user requested Luna, not a specific effort; NONE was an operator choice. Existing request caps,120s deadline,$1/40-call test budget and8192maximum price reservation remain. The existing adapter uses8192forLOW reconciliation versus4000forNONE, within that already reserved maximum; actual cost/latency must be reported. This is isolated acceptance/configuration, not a provider comparison or production switch. Current production remains5e0dcf1/M3; required release model remainsLuna with tested effort to be recorded. Prior NONE failures remain unchanged.


### Source accounting decision — 2026-09-15

The ea0b2a run passed the core qualified housing/home/location filing and both full-source summaries, but a September salary decision disappeared from filing accounting: the model marked a passage assigned after extracting a different idea from it. Passage review is discovery metadata, not proof every clause was represented. Receipt accounting will therefore use exact validated topic support plus explicit, unambiguous evidence-only reviews of owned source passages. Remaining text stays in the existing source_not_assigned review outcome; expanded qualifier context cannot erase it. Legacy ambiguous reviewedSourceSpans are not upgraded into evidence-only authority.

This preserves the existing M1 rule that unhandled material stays visible; it does not claim the skipped salary idea was extracted or filed. The temporary tradeoff is that conversational filler can remain in review. There are no extra model calls or automatic retries for this remainder, no new storage or schema, and no blanket historical refiling. Verify this host-only correction deterministically against the saved original classifier output, then retain production verification of the complete journey.
