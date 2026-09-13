# EPIC: Zenod Memory Reliability

Status: active
Created: 2026-09-06
Updated: 2026-09-13
Repository: zenod-ai/zenod
Primary document: docs/EPIC-ZENOD-MEMORY-RELIABILITY.md
Spine ID: ZMR
Spine Type: branch
Root spine: [Foundation](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [Foundation](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
GitHub issues: https://github.com/zenod-ai/zenod/issues/1188
Integration branch: main
Active spine steward: ZMR-reconciliation-delivery-manager (current task /root)
Steward since: 2026-09-13T16:44:41.746725+00:00
Last reconciled commit: b183806fd7a994eaaa8088ce600319042f2c815e; second actual semantic run failed; next bounded contract repair wave active
Planner: Jordi + ZMR-release-planner
Worker: /root/zmr11_worker ZMR-21; /root/zmr12_worker ZMR-22; /root/zmr_acceptance_design ZMR-23
Tester: /root owns next independent ZMR-15 acceptance after worker repairs; ZMR-17 pending candidate

## Role Bindings

Current delivery manager/steward: ZMR-reconciliation-delivery-manager (/root). ZMR-11–14 and 18–20 are integrated with review/CI. Second actual-model run still failed; ZMR-21–23 repair complete propositions, atomic per-idea decisions and explicit answer support. Parent alone stewards spines and integrates. Production remains unchanged. Earlier bindings below are historical.

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Planner | ZMR-release-planner (handed off 2026-09-06 Europe/Paris) | Release planning | Planning complete; stewardship transferred to ZMR-delivery-manager. | Connected epic and dependency-ordered backlog. |
| Epic worker | ZMR-delivery-manager (parent task /root) | ZMR release | MANAGER: dispatch bounded ticket subagents after control-plane integration, coordinate/report to Jordi, reconcile dependencies, integrate reviewed work, and personally walk acceptance after deployment approval. | Exact candidate, evidence, human test package. |
| Ticket worker | unassigned | One ZMR issue | FIRST ACTION: git worktree add dedicated worktree from pinned SHA; never checkout/switch shared clone. Inspect reuse sources first; scratch duplication fails review. | Issue handoff with PR, SHA, evidence, blocker, next action. |
| Tester | unassigned | ZMR-8 | Validate exact candidate; write detailed evidence to issue. | Pass/fail and human test package. |

## Write Scope

Bound spine: docs/EPIC-ZENOD-MEMORY-RELIABILITY.md
Active steward: ZMR-reconciliation-delivery-manager (current task /root)

The user requested this new release epic and backlog, then explicitly authorized delivery management and ticket subagents on 2026-09-06. ZMR-delivery-manager is the sole steward and remains primarily available for coordination and reporting. Ticket execution proceeds in dependency order after control-plane integration; ZMR-9/10 remain deferred until human SHIP acceptance. Parent edits are limited to lineage metadata and a compact new-child rollup. Existing Phylax delivery and Alpha launch state, gates and linked issues remain read-only. No sibling implementation ownership is transferred. Record outgoing/incoming steward, absolute time, base and next action at handoff. Book binding: inactive.

September 13 authority: Jordi approved the target flow and requested creation of its backlog, including production deployment and testing. Jordi subsequently instructed “ok implement” and “use subagents remain the delivery manager for me”; implementation, integration, bounded production deployment and testing are authorized. Deployment/testing belongs to the planned bounded release scope once exact candidate, recovery and target prerequisites pass. Earlier authorizations persist; do not repeat permission requests for unchanged approved scope. No model switch, historical bulk repair, billing/signup or unrelated channel change is included.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This spine | Release scope, dependencies, decisions and acceptance |
| GitHub issues | Detailed execution records |
| Code / PR | Actual implementation |
| Exact-SHA evidence | Validation and deployed truth |
| Foundation | Canonical parent and cross-release priorities |

## Spine Map

Canonical lineage: Foundation -> ZMR

No child spines.

Cross-links: [Alpha Launch](EPIC-ZENOD-ALPHA-LAUNCH.md) owns existing launch gates; [Mechanical Capture](EPIC-MECHANICAL-CAPTURE.md) owns capture history. This release extends the existing memory product and does not supersede either.

## Mission

Make Zenod reliably retrieve what the user saved, organize multi-topic memories into focused pages, and distinguish current knowledge from historical evidence. A saved memory must remain reachable regardless of its position in a long log or its age. Preserve immutable raw evidence and the user's Markdown/Git ownership.

Release name: **Memory Reliability**. No semantic version or launch date is invented.

## Definition Of Done

### SHIP: September 13 reconciliation increment

1. Submit a representative long mixed-topic VN through existing supported production phone ingestion under a designated test identity.
2. Open the archived audio, separate transcript and exact Log entry; verify identity, timestamps and unchanged source.
3. Wait for enrichment; inspect all substantive idea outcomes, including explicit uncertainty without blocking clear topics.
4. Verify existing-idea source linking, a new cited statement and a correction with history on the correct branches.
5. Replay the capture/job identity and verify no duplicate evidence, claims or source links.
6. Retrieve beginning/middle/end details and current/prior knowledge in three fresh conversations with exact citations.
7. Hand Jordi the same deployed build, actual source refs, UI screenshots/MCP traces, measured tokens/cost, rollback and remaining risks after operator pass.

ZMR-15 proves the integrated candidate before ZMR-16 deployment; ZMR-17 owns this live journey. No full-release success claim follows from this increment alone. Existing broader acceptance below remains open.

### Earlier SHIP acceptance retained


SHIP — exercise the exact approved live candidate through direct Zenod MCP, as Jordi explicitly authorized on 2026-09-06. The existing customer portal has no chat composer; a new browser surface or test environment is not a prerequisite. Use isolated conversation keys and clearly named test captures. Reuse existing components; BUILD means a bounded extension where the reviewed implementation lacks the behavior, subject to ZMR-1 current-main verification.

- [ ] 1. Open the existing customer surface and capture a synthetic long, multi-topic memory; wait for the terminal receipt and open its evidence. BUILD extension of existing store/chat surfaces.
- [ ] 2. Inspect filing: clear subjects reach focused meaning pages; only the ambiguous topic is marked uncertain; raw content remains intact. BUILD extension of existing classifier/composer.
- [ ] 3. Ask for a detail beyond character 8000 in a long daily log and open the exact cited passage with no neighboring-entry leakage. BUILD extension of existing read tools.
- [ ] 4. Ask for all captures in an older bounded date range within a seeded 650+ entry test vault; traverse coverage and reconcile exact expected refs/counts. BUILD extension of existing structural search.
- [ ] 5. Supply an explicit correction, then ask what is true now and what was true before; both answers cite the appropriate evidence. BUILD extension of existing meaning/ask pipeline.
- [ ] 6. Ask a paraphrase and an unsupported question; recover the supported fact and admit the unknown, with zero fabricated supporting evidence. BUILD extension of existing search/grounding.
- [ ] 7. Test package: record actual deployed SHA, live MCP inputs/results, source refs, rollback and remaining risks. Claim full acceptance only after the relevant journey passes; screenshots are optional when the tested surface is MCP. Jordi retains final SHIP acceptance.

The manager tests, repairs observed failures and repeats affected live checks. Jordi explicitly authorized this production rollout and bounded fixes, including direct MCP testing; do not re-request that approval or restart unrelated checks after each small repair. Local tests do not substitute for actual live evidence.

Mandatory supporting gates: 100% deterministic pagination/identity/isolation cases pass; every fixed SHIP answer is correct and evidence-supported in three independent conversations; no false exhaustive claims or unsupported current-state claims in the fixed cases. Freeze ground truth before tuning. Report held-out retrieval recall, answer correctness, abstention, citation support, p50/p95 latency and costs separately, including any regressions. These are targets, not achieved results.

HARDEN — deferred until Jordi accepts SHIP:

- ZMR-9: evaluate hybrid retrieval and reranking against the frozen baseline before adopting it.
- ZMR-10: approved-plan maintenance for historical uncertain filings, duplicate pages and oversized summaries.
- Bulk historical backfill, automatic restructuring and any new paid embedding service are outside SHIP.

## Non-Goals

Replacing Markdown/Git, rebuilding the portal or transport, executing tasks from stored memories, inventing a new pricing plan, opening signup, bulk reorganizing the live vault, or declaring historical defects live without current evidence.

## Current State

Phase: second semantic acceptance failed; bounded contract repairs active
Last verified: 2026-09-13 Europe/Paris
Integration target: main
Fresh base commit: b183806fd7a994eaaa8088ce600319042f2c815e (frozen second candidate and new repair-wave base)
Next action: review/integrate ZMR-21–23, replay recorded model failures through the actual host before another paid regression, then preserve independent Spanish/English ASR for a passing candidate.
Blockers: partial retries duplicated capacity/correction claims; short source fragments lost a requirement; uncertain known-project claim stayed outside meaning; lexical answer selection still discarded correct bilingual answers. Production requires semantic acceptance and verified recovery. Genuine phone acceptance still needs an isolated route.
Acceptance boundary: existing evidence/enrichment pipeline and current models; no new service, provider switch or historical refiling. ZMR-8 broader acceptance remains open; ZMR-9/10 deferred. Public runtime remains 631f85109dfa45fed95394a1e94d2d709c373fe6; no new rollout.

### Historical production and repair state


2026-09-08 bounded repair: [#1231](https://github.com/zenod-ai/zenod/issues/1231), owner current parent task. PRs [#1232](https://github.com/zenod-ai/zenod/pull/1232), [#1233](https://github.com/zenod-ai/zenod/pull/1233) and [#1234](https://github.com/zenod-ai/zenod/pull/1234) are merged; final implementation source `631f85109dfa45fed95394a1e94d2d709c373fe6`, dedicated worktree `/Users/jordi/Documents/GitHub/wt-voice-note-identity`, branch `codex/voice-note-grounded-recall`. Jordi authorized deployment/testing and required simple source-derived labels and general log-based retrieval. The historical source audit proved 11 PTT notes and three ordinary audio attachments; bounded metadata correction restored all five September VNs without changing transcript bodies. The source capture fix is deployed in default Phylax at `d02493cc0a7cb658ee5eedeea57039dd6fc264cb`. The final public retrieval rollout at `631f851` is verified: actual OCI/health, retained environment/mount, and all three fresh unhinted live recalls return the correct latest five September refs. The source capture companion remains connected/ready. Fresh phone acceptance passed at 19:25:42 UTC: original PTT identity, raw log voice_note/source timestamp, archive/transcription, completed enrichment, one newest entry and exact conversational recall all verified without correction. Remaining limitation: one earlier free-form summary used processing times despite correct source timestamps/order. Next action: retain the narrow prose-time limitation in #1231; no additional deployment is required for this passing capture test. No phrase-specific routing, new storage or separate VN index. [Evidence](evidence/voice-note-recency-2026-09-08/README.md). Prior release state below is historical.

Phase: bounded production upgrade and observed repair loop complete; broader release acceptance remains open
Last verified: 2026-09-07 00:19 UTC
Integration target: main
Fresh base commit: 29ddb62d349d9f3bd9c5b471848a4ef775155827 (PR #1226), actual deployed source
Pinned-base rule: pin reconciled main at dispatch; re-pin after integrated waves.
Dispatch condition: ZMR-1–7 integrated; no further production repair dispatched after the passing affected checks.
Next action: finish the durable handoff; retain broader ZMR-8 acceptance and ZMR-9/10 follow-ups without starting another deployment loop.
Blockers: none for the bounded upgrade. Full original release benchmarks and human SHIP acceptance are not claimed complete.

Live receipt: source 29ddb62d349d9f3bd9c5b471848a4ef775155827, image sha256:fab0414121a6912ace825f3cdf07fc5f508944afc3cafec7352660db32a83042, actual task/OCI/health verified after update completed 2026-09-07 00:17:23 UTC. All three fresh boundary recalls passed and cited the current saved evidence. Filing had passed on c5da66f and remains included. [Exact final evidence](evidence/zmr-live-29ddb62/README.md). Original rollback and verified backup retained; no storage migration.

## Execution Cursor

Last attempted: second actual current-model regression on b183806, after reviewed ZMR-18–20 and green CI.
Result: source addresses cover all 11 expected idea rows; 12 reported preservation invariants pass, but manual partial-replay review finds duplicate meaning writes. Final strict minimal operations 6/10; complete recall 5/18 (19/48 answer subclaims). Ten otherwise complete model answers lost content in host finalization. Total $0.17521696 across 63 requests; ingestion/reconciliation including replay $0.00991026. Semantic FAIL; no ASR acceptance consumed or deployment performed.
Execution status: first repair wave integrated. ZMR-21 source-proposition/routing contract, ZMR-22 atomic decisions/retry and ZMR-23 explicit answer support dispatched at pinned b183806.
Waiting on: contract repairs and recorded-output regression before the next actual-model run.
Approved work: continue bounded implementation/test/deployment scope with subagents; /root remains delivery manager. No paid model comparison, model switch or new storage authority.
Next action: review complete decisions and explicit support selection, test new frozen candidate, then independent ASR and production recovery/live testing. [Evidence](evidence/zmr-reconciliation-2026-09-13/README.md).

### Contract repair wave — 2026-09-13

Pinned b183806fd7a994eaaa8088ce600319042f2c815e, no rebases during wave. ZMR-21 owns classifier/source proposition support; ZMR-22 owns reconciliation and filing retry; ZMR-23 owns answer support/result and finalization. Workers coordinate distinct engine/adapter sections and do not share working directories. This repairs the same acceptance; its gates are unchanged. Explicit support IDs replace failed lexical answer selection without another model service. Per-idea decisions reuse the existing receipt/publication transaction. Independent ASR cases stay unavailable to implementation tuning.

### Acceptance repair wave — 2026-09-13

Pinned base 6e0af0c0f93d8320eb83effca519b015ea456a6c, no rebases during this wave. ZMR-18 owns deterministic source resolution, ZMR-19 owns meaning context/correction validation, ZMR-20 owns answer projection. Each has a dedicated worktree and issue; parent alone owns integration and spine edits. This is correction of measured acceptance failures, not changed acceptance or scope. The existing capture and durable transaction boundaries remain intact.

### Delivery stewardship transfer — 2026-09-13T16:44:41.746725+00:00

Outgoing ZMR-reconciliation-planner -> incoming ZMR-reconciliation-delivery-manager (/root), base 4b90068, planning PR #1244. Parent remains sole spine steward and integration manager. Independent reviewer approved planning; two pre-existing productionReadiness tests expired against the real clock. Reviewer is bound to a test-only clock repair; release preflight is read-only. Production baseline reverified at 631f85109dfa45fed95394a1e94d2d709c373fe6; fresh candidate recovery is required before rollout. Next: pass planning CI, merge, dispatch ZMR-11 from fresh main.

### ZMR-11 dispatch sequencing exception — 2026-09-13T16:57Z

Manager authorized isolated implementation from reviewed PR1244 head e3c6ed324a7255cef2ef2a49540eaab031afed54 while its CI reruns unrelated timeout flakes. All build/package checks passed. Four affected suites pass together locally (112 tests); date fixture tests pass and production behavior is unchanged. Planning must merge and implementation checks/review must pass before ZMR-11 integration. Owner /root/zmr11_worker, branch codex/zmr-11, dedicated worktree /Users/jordi/Documents/GitHub/wt-zmr-11. No production scope change. Dispatch recorded in #1237. This supersedes the earlier requirement to delay all local work until planning merge, without waiving integration checks.

### Planning integrated and parallel local work — 2026-09-13T17:02Z

PR1244 merged at 74e1414a28ef38994b6aedf3cfff70005c242a5e; required CI green. Local preparatory work in independent modules is permitted while integration dependencies remain: ZMR12 /root/zmr12_worker owns catalog/context in wt-zmr-12, avoids source-mapping edits; ZMR16 /root/zmr_acceptance_design is rebound to offline operator helper repair in wt-zmr-16, with no production action authority. Both started from reviewed e3c6ed3 and must rebase/revalidate completed dependencies. ZMR11 baseline regression ab5873c demonstrates wrapper contamination. Issue comments own details. Parent remains integration manager and sole spine steward.

### Integrated source/catalog; atomic and durability work — 2026-09-13T17:38Z

PR1247 source identity merged after exact-head independent review, full build, engine84, focused/schema/archive tests and CI. PR1246 catalog merged at f4bf9bb after exact-head independent review, combined source/catalog build +21 tests and CI. ZMR13 /root/zmr12_worker now owns atomic semantic updates; ZMR14 /root/zmr11_worker owns durable receipts, bounded resume and guarded publication. ZMR15 harness PR1248 exercises actual engine/queue plumbing without external calls; real semantic/cost evaluation is still pending. It exposed exact supplied-transcript trailing-byte loss, assigned narrowly to14. ZMR16 helper PR1245 passes13 offline tests and CI; no production action. Known recovery risks are explicitly tested: local-only commit versus published revision, crash before/after publication, stale worker fencing, and known-plan-only recovery. In-flight network publication cannot be retroactively revoked; lock/CAS/ledger recovery must make completion safe. No new memory service or storage authority.

### Atomic updates integrated — 2026-09-13T17:51Z

PR1249 merged at 121fa348 after final5d84eed independent review, 19 focused tests and CI. Known incomplete source blocks the affected idea before any write, while complete siblings may proceed. ZMR14 local integration onto exact5d84eed was authorized while CI finished; final proof re-pins to main. The evaluator now requires actual wire output caps; missing production classifier output bounds are a narrow follow-up before paid testing. Runtime remains631f851; no deployment claim.

### Evaluation and rollout preparation — 2026-09-13T17:57Z

Preparatory evaluator PR1248 integrated at5ebbb56 after policy review and CI; this sequencing exception does not close ZMR15 or authorize an early quality claim. Every wire request must include an output cap. Follow-up PR1250 integrated atf19c29c adds8192 classifier ceiling; reconciliation stays4000. PR1245 integrated at99847d7 verifies actual image config ID against the reviewed digest, with15 offline tests and CI. ZMR14 review found no-op checkpoint recovery and copied-receipt search pollution defects; both are assigned before final proof. Public source/digest remains631f851/081c15fd. Read-only preflight found testtenant model overrides absent (defaults differ from owner); live test setup will snapshot/temporarily use owner-observed M3/Grok4.3 for the designated isolatedtenant and restore afterward, never change owner/global model. Existing Whisper weights enable isolated candidate-container ASR without a new model download.

### Recovery review candidate — 2026-09-13T18:05Z

ZMR14 candidate3f0a5b includes mainf19c29c. Worker and independent reviewer resolved no-op checkpoint mismatch, canonical receipt search pollution, unsafe edited receipt paths and Drive read/reopen loss of unpublished filing state. Targeted crash, queue, stale-worker and reopen regressions pass; final exact-head review and CI remain pending. Runtime queue schema adds a claim token with old-column reader/writer compatibility tests; rollback preserves data, never deletes the new ledger. Primary held-out evaluation and separate long Spanish/English audio fixtures are frozen privately. Candidate-container ASR will reuse the existing Whisper weights read-only with isolated data; this is not phone acceptance. Direct Dokploy curl read confirms baseline pinnedimage, autoDeploytrue and no September13deployment record; urllib403 was Cloudflare1010, not expired credentials. No setting or deployment changed.

### Historical execution receipts


Historical filing receipt: `c5da66f00ec6125e7e6f268d0d49291ac6ee8502` live at 22:36:24.878 UTC, image `sha256:d1b4b7448f9e681ef750710a6fd11d2f7368fe6dc717a35e0f1f60ad2f76561d`, actual OCI/task/health and preservation checks pass. Job `31c1d895-d5bb-4b06-9129-65bf9b109796` filed the exact repository boundary to Projects/Zenod.md (revision c906053f), one topic and zero uncertainty/pending. Natural recall audit `test_86c1f595cebc4d9ea46822a0bb9031b0` nevertheless returned obsolete Herald scope from old body text. Five correct new frontmatter memoryFacts verified; worker is reusing verified-fact projection on ordinary unpinned page reads. See `docs/evidence/zmr-live-c5da66f/`.

Prior repair receipt: `56c815f38aab6790b8afc165a8001e8fc0b5732b` verified by actual task/OCI/health, immutable image `ghcr.io/zenod-ai/zenod@sha256:4baf0239c48c0aba3acbab797d3ba441c5f10bee2bc1c82a1f5bb388a623e342`; queue empty after job 10083. Jordi authorized clearing the backlog: our main merges had triggered legacy sibling autoDeploy builds with no path filters. Four triggers paused with private backups; ten unrelated pending jobs removed, running services/data preserved. See the deployments leaf. MCP recall `test_867984e3691a49ae932909e3cf4488aa` recovered the saved preferences but mislabelled input channel and made an unqualified absence claim; stress log read `test_47ee05569fe44dfeac6cf123827a2d85` returned partial coverage. Filing job `02ee721e-8c9c-4be7-9e07-ca00e440f114` saved intact at revision `415b42a92d16b846ad5175c065e2e3260391d8ab` with classification_unavailable. Metered calls show an initial success followed by optional fallback failures; worker confirmed this discards the valid first result. No provider/schema change is needed for the assigned correction.

Historical queued repair receipt (completed at 22:15:07.905 UTC): reviewed/CI-green PRs #1219 and #1220 merged; candidate `56c815f38aab6790b8afc165a8001e8fc0b5732b`, published image `ghcr.io/zenod-ai/zenod@sha256:4baf0239c48c0aba3acbab797d3ba441c5f10bee2bc1c82a1f5bb388a623e342`. Dokploy desired configuration is updated, but actual production remains `392d058`. HTTP 200 acknowledged enqueue; deployment history shows worker-started records only. Read-only BullMQ inspection confirmed the requests waiting. Only duplicate jobs 10084/10085/10086 were removed through Job.remove after exact app/state checks; 10083 retained. No forced Swarm update, shared service restart or speculative endpoint correction. If undoing before execution, first cancel exact pending candidate job 10083 after checking app/state, otherwise it may execute after rollback.


Last attempted: deploy tested public candidate with preserved config and verified recovery, then test real MCP capture and recall.
Result: 29ddb62 deployed and verified; all three fresh boundary recalls passed. Bounded repair loop complete; broader release acceptance remains open.
Execution status: bounded upgrade complete; broader acceptance pending
Waiting on: no production action or worker; final durable receipt integration only.
Approved work: this production upgrade, bounded live memory tests and fixes, and reusable undo procedure are explicitly authorized. Preserve data/configuration; no provider overhaul, billing/signup change or destructive restore. Human SHIP acceptance remains separate.
Next action: integrate final evidence; retain named broader acceptance limitations and defer ZMR-9/10 until human SHIP.





## Bootstrap Map

Current increment: [approved target-flow research](planning/zenod-memory-reconciliation/README.md), [editable slide](planning/zenod-memory-reconciliation/slides/zenod-target-flow.pptx), [slide preview](planning/zenod-memory-reconciliation/slides/zenod-target-flow.png). These are required reads for ZMR-11–17. The standalone synthetic harness is not production replay or acceptance proof.

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | [Foundation](EPIC-0-FOUNDATION-SPINE.md) | Parent and existing priorities | Always |
| 2 | This spine | Release authority and cursor | Always |
| 3 | [Review](planning/zenod-memory-reliability-review.md) | Findings and limits of proof | Always |
| 4 | [Phylax](EPIC-P-PHYLAX-SPRINT.md), [Alpha](EPIC-ZENOD-ALPHA-LAUNCH.md) and [readiness](PRODUCTION-READINESS.md) | Current Phylax gate routing and historical Alpha production evidence | Manager/tester |
| 5 | [Entry retrieval evidence](evidence/generic-entry-retrieval-2026-08-01/README.md) | Existing exact-read contract | Worker/tester |
| 6 | [EpicSpine skill](../skills/epic-spine/SKILL.md) | Worktree, authority and handoff rules | Always |

## Architecture And Context

Reuse inventory from the review: core engine store/ask/readTools; evidence entry parser and exact reads; deterministic search; classifier/composer; vault frontmatter/linter; MCP structural search and receipt enrichment; existing tasking proposal/approval seam. No new service is needed for SHIP. ZMR-1 rechecks current main and relevant existing units/services before marking absent capabilities BUILD; no claim that every unrelated repository or live service was audited.

Current-main trap for ZMR-1: open #1160 is superseded by completed [#1171](https://github.com/zenod-ai/zenod/issues/1171), merged at d77ea431. Provider-neutral engine/search/get/evidence capabilities already exist on this base; preserve source revisions, source URLs and Drive provenance when extending retrieval. Reconcile this against current code before proposing replacement primitives. ZMR-8 must reconcile the deployment runbook’s public/private ordering inconsistency before any deployment preflight; this control-plane change does not resolve or mutate live topology.

Known traps: whole-file search versus prefix reads; limit-before-filter; one confidence across topics; unbounded summaries; citation existence mistaken for entailment; old reports mistaken for current verification. See the review and individual tickets.

Wave 1: ZMR-1 runnable baseline. Wave 2: ZMR-2 and ZMR-3 have related core evidence surfaces and therefore run sequentially unless the manager proves disjoint ownership. Wave 3: ZMR-4; wave 4: ZMR-5; wave 5: ZMR-6; wave 6: ZMR-7; wave 7: ZMR-8 then manager journey. No automatic parallel dispatch.

During active execution, heartbeat every 30 min: `lap/state | blocker | ETA`; two consecutive ETA slips trigger a scope/status review. The manager resumed the quiet 15-minute same-task coordination heartbeat `coordinate-zenod-memory-reliability`; it reconciles existing assignments without duplicating workers and reports only meaningful changes. The parent owns reviews and integration.
Live customer data changes require snapshot + checksum + one restore drill per mechanism; isolated synthetic fixtures use snapshot-and-go; docs require no backup ceremony.

## Decisions

| ID | Date | Outcome | Decision / Attempt | Durable Summary | Rule / Absence Rule | Evidence | Revisit When |
|---|---|---|---|---|---|---|---|
| D1 | 2026-09-06 | accepted | Release boundary | Retrieval completeness and categorization/current-state accuracy are SHIP; hybrid search and cleanup follow. | Do not expand SHIP to a database/platform rewrite. | User review and release request | Explicit scope change |
| D2 | 2026-09-06 | accepted | Evidence authority | Preserve raw capture and derive meaning/indexes from it. | Never rewrite evidence to repair meaning. | Existing capture contract | Never |
| D3 | 2026-09-06 | accepted | Freshness | Review findings concern ca39aa9; current main is newer. | Reproduce before fixing; close as already resolved only with exact evidence. | ZMR-1 | Each dispatch |
| D4 | 2026-09-06 | accepted | Version and scheduling | Working title Memory Reliability; no version/date assigned. | Use existing release/version practice at acceptance. | User request | Release packaging |
| D5 | 2026-09-06 | accepted | Credentials and rollout | Existing Keychain dokploy-env source and readiness procedure remain authoritative. | No new credentials, provider or live changes in planning; do not print secrets. | AGENTS.md and readiness | Exact rollout gate |
| D6 | 2026-09-06 | rejected | Models as first fix | A larger model cannot read inaccessible passages or excluded entries. | Fix access/coverage before optional retrieval infrastructure. | Code review | Evidence of a model-bound residual issue |
| D7 | 2026-09-06 | accepted | Existing issue overlap | #1059 and #831–#834 remain historical/Alpha authorities. | Cross-link and reconcile in ZMR-1; do not silently close or duplicate their acceptance claims. | Read-only issue inventory | Baseline reconciliation |
| D8 | 2026-09-06 | accepted | Anything unanswered | Simplest option, journal it, keep moving within scope. | Human gates remain gates; absent approval never authorizes production. | This spine | Material scope decision |
| D9 | 2026-09-06 | accepted | In-place work | BUILD rows mean extending inspected existing primitives; PORT/DUPLICATE only when actually moving/copying proven code. | Do not label an in-place algorithm fix a wholesale port. | Reuse inventory | ZMR-1 inventory |

| D10 | 2026-09-13 | accepted | Minimal reconciliation | One immutable voice note may update several branches. Group related ideas and apply the smallest cited change. | Reuse capture/enrichment; no second pipeline. | Approved target-flow slide and this conversation | Acceptance failure |
| D11 | 2026-09-13 | accepted | Context and cost | Stable source passages, complete bounded branch discovery, batched atomic operations and explicit pending work. | A one-second latency or fixed cost is not promised; measure real calls. | Research note | Measured cost/quality |
| D12 | 2026-09-13 | accepted | Model scope | Live configured classifier observed as MiniMax M3; DeepSeek comparison requested as price delta only. | No model switch or paid A/B is required for this release. | Read-only settings and pricing research | Explicit model-change request |
| D13 | 2026-09-13 | accepted | Production and test scope | Backlog includes bounded Zenod-only production rollout, verified backups/rollback and live VN/MCP acceptance. | Prepare exact candidate/targets/delta before action; seek new approval only for material expansion. | Jordi approved backlog including deployment and test | New service/data/provider scope |
| D14 | 2026-09-13 | accepted | Live test boundary | Use an existing supported test identity and synthetic source; inspect real phone ingress plus MCP evidence/recall. | No new browser chat product; no unrelated personal-page pollution or automatic historical repair. | Existing ZMR MCP acceptance decision and current target | Test-identity blocker |

## Issue Ledger

### Current approved increment: multi-idea reconciliation

Dependencies control delivery. #1237–#1243 are approved; #1254–#1256 repair measured failures within that acceptance. The current contract repair wave #1261–#1263 is pinned to b183806; re-pin after integration, not during worker proofs.

| Issue | Wave | Method | Budget | Role | Owner / Assignment | Title | Status | Depends On | Worktree | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [ZMR-11 #1237](https://github.com/zenod-ai/zenod/issues/1237) | 1 | BUILD extension; reuse existing pipeline | 90 min checkpoint | Ticket worker | completed source assignment | Preserve source identity while extracting every voice-note idea | integrated; PR1247 | none | /Users/jordi/Documents/GitHub/wt-zmr-11 | codex/zmr-11 | 463759f | independent review + CI + build/engine pass | 2026-09-13 | Real-model acceptance in ZMR-15 |
| [ZMR-12 #1238](https://github.com/zenod-ai/zenod/issues/1238) | 2 | BUILD extension; reuse existing pipeline | 90 min checkpoint | Ticket worker | completed catalog assignment | Find complete branch context with a bounded memory catalog | integrated; PR1246 | ZMR-11 | ../wt-zmr-12 at dispatch | codex/zmr-12 | f4bf9bb | independent review + CI + 21 combined tests | 2026-09-13 | Real-model routing in ZMR-15 |
| [ZMR-13 #1239](https://github.com/zenod-ai/zenod/issues/1239) | 3 | BUILD extension; reuse existing pipeline | 90 min checkpoint | Ticket worker | /root/zmr12_worker | Apply minimal cited changes to existing knowledge | integrated; PR1249 | ZMR-11, ZMR-12 | ../wt-zmr-13 at dispatch | codex/zmr-13 | 121fa34 | independent final5d84eed review + 19 focused tests + CI | 2026-09-13 | Real semantic evaluation in ZMR-15 |
| [ZMR-14 #1240](https://github.com/zenod-ai/zenod/issues/1240) | 4 | BUILD extension; existing pipeline | 90 min checkpoint | Ticket worker | completed | Truthful durable receipts and retries | integrated; PR1251 | ZMR-13 | ../wt-zmr-14 | codex/zmr-14 | 6e0af0c | independent 36 critical tests, build and CI; actual preservation pass | 2026-09-13 | Retain quality gate |
| [ZMR-15 #1241](https://github.com/zenod-ai/zenod/issues/1241) | 5 | BUILD evaluation; actual pipeline | 90 min checkpoint | Tester | /root | Prove multi-idea reconciliation and cost | semantic FAIL on two candidates | ZMR-21–23 repairs | ../wt-zmr-candidate-repair | detached | b183806 | independent 6/10 minimal operations, 5/18 complete recall | 2026-09-13 | Recorded-output repair, regression, then independent ASR |
| [ZMR-16 #1242](https://github.com/zenod-ai/zenod/issues/1242) | 6 | BUILD helper; existing deployment | 90 min checkpoint | Operator | /root | Deploy reviewed candidate | helper PR1245/1253 integrated; deployment gated | ZMR-15 | ../wt-zmr-16-quiesce | codex/zmr-16-quiesce | 9e032af | 23 offline tests, installed Dokploy review, CI | 2026-09-13 | Fresh recovery packet after quality pass |
| [ZMR-17 #1243](https://github.com/zenod-ai/zenod/issues/1243) | 7 | BUILD extension; reuse existing pipeline | 90 min checkpoint | Tester | unassigned | Run production voice-note acceptance and hand off human testing | approved, dependency waiting | ZMR-16 | ../wt-zmr-17 at dispatch | codex/zmr-17 | pin fresh main | approved target flow | 2026-09-13 | Wait for dependencies |
| [ZMR-18 #1254](https://github.com/zenod-ai/zenod/issues/1254) | repair A | BUILD repair; reuse existing pipeline | 90 min checkpoint | Ticket worker | /root/zmr11_worker | Resolve exact source references safely | integrated PR1258; second semantic gate failed | measured ZMR-15 failure | /Users/jordi/Documents/GitHub/wt-zmr-18 | codex/zmr-18 | 6e0af0c | issue reproducer and frozen failed run | 2026-09-13 | Follow measured contract repairs |
| [ZMR-19 #1255](https://github.com/zenod-ai/zenod/issues/1255) | repair A | BUILD repair; reuse existing pipeline | 90 min checkpoint | Ticket worker | /root/zmr12_worker | Supply existing statements and correction context | integrated PR1259; second semantic gate failed | measured ZMR-15 failure | /Users/jordi/Documents/GitHub/wt-zmr-19 | codex/zmr-19 | 6e0af0c | issue reproducer and frozen failed run | 2026-09-13 | Follow measured contract repairs |
| [ZMR-20 #1256](https://github.com/zenod-ai/zenod/issues/1256) | repair A | BUILD repair; reuse existing pipeline | 90 min checkpoint | Ticket worker | /root/zmr_acceptance_design | Preserve supported question-relevant answers | integrated PR1260; second semantic gate failed | measured ZMR-15 failure | /Users/jordi/Documents/GitHub/wt-zmr-20 | codex/zmr-20 | 6e0af0c | issue reproducer and frozen failed run | 2026-09-13 | Follow measured contract repairs |
| [ZMR-21 #1261](https://github.com/zenod-ai/zenod/issues/1261) | repair B | BUILD contract repair; existing pipeline | 90 min checkpoint | Ticket worker | /root/zmr11_worker | Complete source propositions and routing certainty | active | second ZMR-15 failure | /Users/jordi/Documents/GitHub/wt-zmr-21 | codex/zmr-21 | b183806 | recorded actual failures in #1241 | 2026-09-13 | Implement generic recorded-output regressions, review and CI |
| [ZMR-22 #1262](https://github.com/zenod-ai/zenod/issues/1262) | repair B | BUILD contract repair; existing pipeline | 90 min checkpoint | Ticket worker | /root/zmr12_worker | Atomic per-idea decisions and partial retries | active | second ZMR-15 failure | /Users/jordi/Documents/GitHub/wt-zmr-22 | codex/zmr-22 | b183806 | recorded actual failures in #1241 | 2026-09-13 | Implement generic recorded-output regressions, review and CI |
| [ZMR-23 #1263](https://github.com/zenod-ai/zenod/issues/1263) | repair B | BUILD contract repair; existing pipeline | 90 min checkpoint | Ticket worker | /root/zmr_acceptance_design | Explicit bounded answer support selection | active | second ZMR-15 failure | /Users/jordi/Documents/GitHub/wt-zmr-23 | codex/zmr-23 | b183806 | recorded actual failures in #1241 | 2026-09-13 | Implement generic recorded-output regressions, review and CI |

### Earlier release ledger (historical assignments)

Bound repair: [#1231](https://github.com/zenod-ai/zenod/issues/1231) — current worker; deployed, recent-entry recall passes; fresh phone acceptance passes; prose-time limitation remains; PRs #1232/#1233/#1234 merged through `631f851`; reuse existing transport/ingestion/evidence/receipt components. Acceptance: source PTT survives restart, timestamps/identity preserved, mixed-format newest-first retrieval and exact reads pass, arbitrary audio stays audio, deployment/live checks recorded. Existing release tickets below remain in their recorded state.

ZMR-1–7 are integrated; ZMR-8 validation is active. ZMR-9/10 remain deferred until human SHIP acceptance. Dependencies refer to ZMR IDs resolved to GitHub links in each issue. Detailed acceptance lives in issues; this ledger owns scope and dependency rollup.

| Issue | Wave | Method | Budget | Role | Owner / Assignment | Title | Status | Depends On | Worktree | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [ZMR-1 #1189](https://github.com/zenod-ai/zenod/issues/1189) | 1 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | ZMR-1-baseline-worker /root/zmr_1_baseline | Establish the runnable memory-recall baseline demo | done — deterministic baseline | none | /Users/jordi/Documents/GitHub/wt-zmr-1 | [PR #1201](https://github.com/zenod-ai/zenod/pull/1201) / codex/zmr-1 | b9dd9f0ef739a23e8438d550794b1e8400df8782 | c823d06 merged; 102 focused tests; independent review + CI pass | 2026-09-06 01:11 CEST | Integrated c823d06; real-model metrics carried to ZMR-8 |
| [ZMR-2 #1190](https://github.com/zenod-ai/zenod/issues/1190) | 2 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | ZMR-2-passage-worker /root/zmr_2_passage | Retrieve answer-bearing passages beyond the note prefix | done | ZMR-1 | /Users/jordi/Documents/GitHub/wt-zmr-2 | [PR #1202](https://github.com/zenod-ai/zenod/pull/1202) / codex/zmr-2 | c823d06e9cbe279a9a03ebf0e4d6d5e3ad6ba175 | e8458a8 merged; 182 core +35 MCP; corrected review and CI pass | 2026-09-06 02:05 CEST | Integrated; preserve pinned/distractor regressions |
| [ZMR-3 #1191](https://github.com/zenod-ai/zenod/issues/1191) | 2 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | ZMR-3-history-worker /root/zmr_3_history | Make historical entry search complete and paginated | done | ZMR-1 | /Users/jordi/Documents/GitHub/wt-zmr-3 | [PR #1204](https://github.com/zenod-ai/zenod/pull/1204) / codex/zmr-3 | e8458a8a5176fb68376b0f9b599c480015a49941 | dadd883 merged; corrected 8712fc3 review and CI pass; 36 focused +5 independent tests | 2026-09-06 14:24 CEST | Integrated; ZMR-4 dispatched |
| [ZMR-4 #1192](https://github.com/zenod-ai/zenod/issues/1192) | 3 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | ZMR-4-typed-retrieval-worker /root/zmr_4_typed_retrieval | Give ask_brain typed retrieval and explicit coverage | done | ZMR-2, ZMR-3 | /Users/jordi/Documents/GitHub/wt-zmr-4 | [PR #1206](https://github.com/zenod-ai/zenod/pull/1206) / codex/zmr-4 | dadd88350b2bca896fc8f605bcf4c0f2c2ff261c | 1be97bb merged; corrected3bb8 re-review and CI pass; 88 focused+6 independent checks | 2026-09-06 | Integrated; ZMR-5 dispatched |
| [ZMR-5 #1193](https://github.com/zenod-ai/zenod/issues/1193) | 4 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | ZMR-5-topic-filing-worker /root/zmr_5_topic_filing | File multi-topic memories with per-topic confidence | done | ZMR-1, ZMR-4 | /Users/jordi/Documents/GitHub/wt-zmr-5 | [PR #1208](https://github.com/zenod-ai/zenod/pull/1208) / codex/zmr-5 | 1be97bb8815446fb9d40443f60bac9c5b1dabc71 | 06085df merged; e458 review/CI pass; 15 independent checks | 2026-09-06 | Integrated; minor receipt wording delegated to ZMR-6 |
| [ZMR-6 #1194](https://github.com/zenod-ai/zenod/issues/1194) | 5 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | ZMR-6-focused-notes-worker /root/zmr_6_focused_notes | Keep meaning notes focused and summaries bounded | done | ZMR-5 | /Users/jordi/Documents/GitHub/wt-zmr-6 | [PR #1210](https://github.com/zenod-ai/zenod/pull/1210) / codex/zmr-6 | 06085df10bb380ef615c6a2ee7e007fd57d6548b | fd6063b merged; 030a41 review/CI pass; 8 independent checks | 2026-09-06 | Integrated; ZMR-7 dispatched |
| [ZMR-7 #1195](https://github.com/zenod-ai/zenod/issues/1195) | 6 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | ZMR-7-current-facts-worker /root/zmr_7_current_facts | Distinguish current facts, corrections and historical evidence | done | ZMR-4, ZMR-6 | /Users/jordi/Documents/GitHub/wt-zmr-7 | [PR #1212](https://github.com/zenod-ai/zenod/pull/1212) / codex/zmr-7 | fd6063bf39cc0973d04c4420bfdffbdaa52b88d5 | 3f5ba09 merged; b963 re-review and CI pass; 10 independent checks | 2026-09-06 | Integrated; conservative phrasing limits carried to ZMR-8 |
| [ZMR-8 #1196](https://github.com/zenod-ai/zenod/issues/1196) | 7 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Tester | ZMR live repair /root/zmr_8_chat_review; deploy /root/zmr_deploy_audit | Prove the Memory Reliability release journey | active — live repair | ZMR-2, ZMR-3, ZMR-4, ZMR-5, ZMR-6, ZMR-7 | /Users/jordi/Documents/GitHub/wt-zmr-8 | codex/zmr-8 | 392d058a599bdf5fc69d17157282b8f9154dcf28 | 392d058 live; exact recall+abstention pass; filing/natural recall fail | 2026-09-06 | Fix live failures, incremental deploy and direct MCP retest |
| [ZMR-9 #1197](https://github.com/zenod-ai/zenod/issues/1197) | follow-up | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | unassigned | Evaluate a rebuildable hybrid retrieval index | proposed / deferred | ZMR-8 | ../wt-zmr-9 at dispatch | codex/zmr-9 | pin at dispatch | Review only | 2026-09-06 | Wait for dependencies |
| [ZMR-10 #1198](https://github.com/zenod-ai/zenod/issues/1198) | follow-up | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | unassigned | Add an evidence-backed filing maintenance queue | proposed / deferred | ZMR-8 | ../wt-zmr-10 at dispatch | codex/zmr-10 | pin at dispatch | Review only | 2026-09-06 | Wait for dependencies |

## Branch And Integration

One ticket, one dedicated branch/worktree; manager records owner, absolute worktree, base/latest SHA and next action at dispatch. Shared clone is never switched for a worker. Review requires focused acceptance checks and PR review; testing names exact candidate/environment; done requires evidence and reconciled handoff. Integrate small reviewed changes into main and re-pin dependents. Implementation is authorized through bounded ticket workers after the control-plane merge; production deployment is separately gated.

## Human Gates

For the September 13 increment, Jordi approved inclusion of production deployment and testing in the backlog. The exact candidate/target/delta, backup/restore and rollback are mandatory work before action, not a reason to repeat approval for unchanged scope. No production action occurs during backlog creation. Material destructive changes, a model/provider switch, sibling service/session changes or public/billing changes still require their exact separate gate. Historical deployment approvals above remain valid for their recorded scope.


| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Deploy candidate | Jordi | ZMR-15 passes and ZMR-16 packet is concrete | Bounded rollout/test scope approved 2026-09-13; record immutable image/target/delta and verified recovery. Material scope expansion needs exact approval. | Local fixtures, review and packet preparation |
| Bulk vault changes | Jordi | Maintenance proposal | Exact plan/diff and recovery path | Read-only proposal |
| Provider/data-processing change | Jordi | Optional external index/provider | Named provider, data handling and cost terms | Offline/local evaluation |
| Release acceptance | Jordi | Manager clean live journey | Same-candidate experiential acceptance | Prepare evidence |
| Public launch | Jordi | Separate launch readiness | Existing signup/billing/promotion gates | Closed testing |

If blocked by a gate, the affected worker's entire next status is “BLOCKED ON Jordi: [exact missing decision and recommendation]”; it must not execute the gated action. Independent authorized work remains governed by existing repository instructions.

## Recovery And Takeover

At 2026-09-06 21:08 CEST, repair completed and sole ownership transferred to /root/zmr_8_candidate_retest, same wt-zmr-8/codex/zmr-8, explicitly repinned to 392d058a599bdf5fc69d17157282b8f9154dcf28. Prior tester and repair history remain preserved. Tester has now completed local evidence PR #1216 and released write ownership. The manager reassigns workers silent past budget after inspecting their issue/branch evidence. Preserve previous identity/history; record incoming owner, exact SHA, unverified work and next action before resuming. Ninety minutes is a checkpoint, not a completion claim.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-09-13 | Approved reconciliation backlog | main base 4b90068 plus planning branch | isolated worktree / GitHub | strict spine validator, six offline harness tests, issue link verification and diff check | ZMR strict passes; six tests pass. Extended graph validator reports no ZMR errors, historical Foundation schema errors and an omitted sibling input; no full-graph pass claimed. No paid inference or production changes. | #1237–#1243 and research note |
| 2026-09-06 | Prior review | ca39aa9 local | local checkout | npm run test -w zenod -- test/memoryEntries.test.ts test/aisdk-retrieval-retry.test.ts test/engine.test.ts | 60 tests passed; not release acceptance | [Review](planning/zenod-memory-reliability-review.md) |
| 2026-09-06 | Release planning | working tree | local documents / GitHub | validate_spine.py --strict on ZMR; issue-body/link reconciliation | ZMR passes strict validation; #1188 tracker and #1189–#1198 created and linked | This task |
| 2026-09-06 | Parent graph | working tree | Foundation + ZMR | validate_spine.py --graph | ZMR has no errors/warnings and reciprocal registration resolves; whole-family validation fails on Foundation's pre-existing missing Execution Cursor and legacy Decisions columns | Parent migration deferred to Foundation steward |
| 2026-09-06 | Control-plane integration | base fb8b07c5910b3424c4a15da4e1cfaa920cee4e22 | isolated worktree / local documents | Shared updated validator: strict ZMR and Foundation+ZMR graph; git diff --check | ZMR strict and reciprocal graph checks pass; Foundation retains 11 pre-existing structural errors and 27 v2 warnings | No product or deployed behavior validated |

## Handoff Journal

### 2026-09-13 — Approved reconciliation backlog and stewardship handoff

Outgoing recorded steward: voice-note-identity delivery worker; earlier worker bindings are historical. Incoming: ZMR-reconciliation-planner (current /root), planning only, from main 4b90068. Seven tickets #1237–#1243 cover source mapping, complete context, atomic writes, receipts/retries, candidate proof, production rollout and live acceptance. No implementation dispatched and no production action performed. #1188 tracker and #1196 acceptance are reconciled rather than duplicated. Root edits are restricted to the ZMR rollup. Planning branch: codex/zmr-reconciliation-backlog. Next: integrate planning PR and bind ZMR-11.

Tooling: Zenod create_issue returned silent_ack; read-only GitHub verification recovered #1237. Remaining ticket creation used gh with exact body files, avoiding duplicate creation. This is the previously recorded receipt gap, not an ingestion regression.


### User-authorized production rollout and reversibility

Jordi explicitly requested deployment to existing single-user production, live testing and fixes, plus registered learnings; then requested easy undo. This supersedes waiting for separate local provider/staging setup. /root/zmr_deploy_audit is sole production mutation owner; parent tests the browser and records learning. Plan minimal public Zenod-only392d058 rollout, preserving private Phylax, signup/config/credentials/volumes and raw memory. Fresh verified backup, off-host recovery copy, previous image/config and runnable rollback are required implementation work within this authorization, not a repeated permission question.

### 2026-09-06 21:08 CEST — Manager — Chat repair integrated; candidate retest dispatched

Corrected #1214 head d336698da39eb37b8ed7dbbc9d84c4a33cf955f6 passed re-review and exact CI; merged392d058a599bdf5fc69d17157282b8f9154dcf28. Independent HTTP replay confirms explicit-memory no-tool answers do not leak into streaming, nonstreaming or persisted history. Tester takeover /root/zmr_8_candidate_retest now solely owns wt-zmr-8/codex/zmr-8 and explicitly repins to392d058, preserving prior tester and repair commits. Previous validation does not prove this new candidate. English intent heuristic, semantic grounding and real-model/live acceptance limitations remain. No deployment.

### 2026-09-06 19:52 CEST — Manager — Release failures and repair takeover

Tester reproduced authenticated customer chat gaps on 3f5ba09: searchEntries absent and unsupported fabricated-read answer bypasses ask_brain safeguards. Full suite has only these two new failures; MCP scripted frozen trials pass, which does not establish real-model quality. Tester committed f850aa0/2f42748 and then errored on model capacity. Assigned /root/zmr_8_chat_repair sole write ownership of same wt-zmr-8/codex/zmr-8; tester stays paused. No duplicate writers or deployment.

Tester read-only evidence reconciles #1112 commercial approval already completed and existing private Phylax; stale Foundation pending-commercial text must not cause re-requesting old approval. Current exact rollback images and backup-proof gaps live in docs/evidence/zmr-8-release-validation/README.md on tester branch. This does not authorize a new deployment or credentials.

### 2026-09-06 19:35 CEST — Manager — Current facts integrated; release validation dispatched

Corrected #1212 head b9636d5b5f9250c409d6416a28e35b7f1a74dbe4 passed re-review and CI, merged 3f5ba097a8d287cdb9ae4468251bc42563e7e7a3. Directional correction and statement-bound verification fixes independently passed 10 tests. Dispatched /root/zmr_8_release_validation for #1196 in wt-zmr-8 on codex/zmr-8 pinned to that merge. Tester owns local integrated proof and concrete gate package; parent owns approved live browser journey. Real-model quality/cost, conservative language support and live acceptance remain unproven. No deployment.

### 2026-09-06 18:15 CEST — Manager — Focused notes integrated; current facts dispatched

ZMR-6 #1210 head 030a41fb88c009ae7190f2c15c8902c9e7eec453 passed independent review and exact CI; merged as fd6063bf39cc0973d04c4420bfdffbdaa52b88d5. Dispatched /root/zmr_7_current_facts for #1195 in wt-zmr-7 on codex/zmr-7 pinned to that merge. Preservation is mechanical; lexical candidate recall, alias semantic equivalence and real-model quality/cost remain release checks. No deployment.

### 2026-09-06 17:40 CEST — Manager — Topic filing integrated; focused notes dispatched

ZMR-5 #1208 head e458e48 passed independent review and exact CI, merged as 06085df10bb380ef615c6a2ee7e007fd57d6548b. Dispatched /root/zmr_6_focused_notes for #1194 on codex/zmr-6 in /Users/jordi/Documents/GitHub/wt-zmr-6, pinned to that merge. Narrow carry-forward: conditional Inbox wording in fully resolved/evidence-only receipts, identified as nonblocking by reviewer. Real-model categorization and existing publication/result crash window remain disclosed; no deployment. Status #1207 also merged after corrected-cursor review and CI.

### 2026-09-06 15:39 CEST — Manager — Typed retrieval integrated; topic filing dispatched

Corrected #1206 head 3bb8d102 passed independent re-review (4 coverage +2 public tests) and exact CI, merged as 1be97bb8815446fb9d40443f60bac9c5b1dabc71. Dispatched /root/zmr_5_topic_filing for #1193 in /Users/jordi/Documents/GitHub/wt-zmr-5 on codex/zmr-5 pinned to that merge. Real-model quality and large-vault performance remain ZMR-8 release checks; no deployment.

### 2026-09-06 15:36 CEST — Manager — Corrected typed retrieval passes CI

Worker fixed unversioned pinned evidence incorrectly certifying a newer catalog, with mutation/fresh-read regression, and replaced two invented-read Drive stubs with actual reads. Corrected #1206 head 3bb8d1026261b2559f70217cf48678324e61fd74 passes 53 core/Drive and 35 public tests plus CI run 34035304503. Explicitly resumed independent reviewer for corrected head; notification to a completed agent alone had not restarted review. Re-review remains the only integration gate before dispatching ZMR-5.

### 2026-09-06 15:05 CEST — Manager — Typed retrieval review and CI diagnosis

Worker completed PR #1206 at 2617e0273439861eb2ee34d581253c340407b120 with 279 focused and 9 schema tests passing locally. Required CI run 34034214736 failed; resumed the same worker to diagnose, with no blind retry. Independent reviewer /root/zmr_release_preflight confirmed running on submitted head; agents instructed to coordinate before edits. ZMR-5 waits for reviewed CI-green integration. Status PR #1205 merged as 54050a3 after review and CI. No deployment.

### 2026-09-06 14:24 CEST — Manager — History integrated; typed retrieval dispatched

Corrected #1204 head 8712fc3 passed independent review and required CI. Merged as dadd88350b2bca896fc8f605bcf4c0f2c2ff261c. Dispatched /root/zmr_4_typed_retrieval for #1192 in /Users/jordi/Documents/GitHub/wt-zmr-4 on codex/zmr-4, pinned to that merge. ZMR-5–8 remain dependency ordered; ZMR-9/10 deferred until human acceptance. No deployment.

### 2026-09-06 14:16 CEST — Manager — Resume interrupted ZMR-3 correction

Usage limit interrupted /root/zmr_3_history before its correction was committed. On user “continue”, verified PR #1204 remains bec3c6e and only mcp.ts/zmrHistory.test.ts carry uncommitted correction work in wt-zmr-3. Reused the same agent/worktree; it confirmed the winning-receipt selection and different-content regression survived and resumed verification. No duplicate worker, reset, merge or deployment. The prior CI pass does not validate the uncommitted fix. Next: corrected exact-head review and CI, then ZMR-4.

### 2026-09-06 02:05 CEST — Manager — Passage fix integrated; history worker dispatched

ZMR-2 initial ecc330c review found exact pinned-anchor isolation and unrelated-entry grounding regressions. Worker corrected both at 1aea39803ea15ded0d3d67d5ee924491a3537834 with multi-pinned exact/missing-anchor and full target-plus-distractor traversal regressions. Independent re-review passed 14 focused core +2 public provider tests; worker reported 182 core +35 MCP checks; required CI passed on the exact corrected head. PR #1202 merged as e8458a8a5176fb68376b0f9b599c480015a49941. No deployment performed.

Dispatched /root/zmr_3_history for #1191 on codex/zmr-3 in /Users/jordi/Documents/GitHub/wt-zmr-3, exact e8458a8 base. Core goal: old entries remain discoverable and cursor traversal proves complete scope. ZMR-4 waits for this integration. Prior manager status PR #1200 merged as 86a7f1; current manager branch batches this next rollup. Production and real-model acceptance remain outstanding.

### 2026-09-06 01:11 CEST — Manager — Baseline integrated; passage worker dispatched

PR #1201 head 34319e3 passed independent review and required CI, then merged as c823d06e9cbe279a9a03ebf0e4d6d5e3ad6ba175. It reproduces all four deterministic gaps and verifies existing exact/pinned reads and provider identities. 102 focused checks passed; independent reviewer reran the two-provider MCP demo. Model responses and Drive persistence are test doubles: real-model quality/latency/cost were not measured. ZMR-8 owns that outstanding release proof; no release-quality claim follows from baseline acceptance.

Dispatched /root/zmr_2_passage for #1190 in /Users/jordi/Documents/GitHub/wt-zmr-2, branch codex/zmr-2, exact c823d06 base. ZMR-3 remains sequential to prevent simultaneous edits of shared types/evidence/baseline surfaces. Manager status PR #1200 prior failure was ENOTEMPTY in existing test cleanup; a558d07 CI passed without product fixes. No deployment performed.

### 2026-09-06 00:40 CEST — Manager — Control plane integrated; baseline dispatched

Reviewed corrected PR #1199 head 6901ec87f4edac2986ff296edcf675f17f257a29 independently; required ci passed. Squash merge is b9dd9f0ef739a23e8438d550794b1e8400df8782. Merged source inspected and ZMR strict document validation passes. No production deployment performed or inferred from image publication.

Dispatched /root/zmr_1_baseline as ZMR-1-baseline-worker for #1189, branch codex/zmr-1, absolute worktree /Users/jordi/Documents/GitHub/wt-zmr-1, pinned base b9dd9f0. Worker confirmed startup. Scope is synthetic baseline/demo and evidence, no product fixes or live data. Next: review its exact-head PR, resolve findings and integrate before dependent workers.

Manager worktree: /Users/jordi/Documents/GitHub/wt-zmr-manager on codex/zmr-manager; current source of unmerged coordination updates. Shared original checkout remains untouched. Quiet heartbeat remains active; no other ticket worker is running.

### 2026-09-06 — Planner — Memory Reliability release authored

Last attempted: create release epic and scoped proposed backlog from the prior review.
Result: [#1188](https://github.com/zenod-ai/zenod/issues/1188) tracks 8 SHIP tickets (#1189–#1196) plus 2 deferred follow-ups (#1197–#1198), with dependencies, synthetic-first proof and named release gates. All are proposed, not queued. Local planning documents are not yet committed or pushed.
Tooling observation: Zenod create_issue returned silent_ack even though #1188 was created. Read-only GitHub verification recovered the exact issue; remaining creation and linking used gh with body files. Related existing tooling issue: #835. No duplicate epic was created.
Next: integrate control-plane files, then assign ZMR-1 upon implementation request.
Waiting on: no active worker; execution not requested in this planning turn.
Approved work: planning and GitHub issue creation.
Risks: main/deployed drift, historical issue overlap, unmeasured model behavior and provider cost.
Assignment identity: ZMR-release-planner.
Branch / latest commit: current checkout ca39aa9 plus scoped planning documents; unrelated dirty files untouched.

### 2026-09-06 — Delivery stewardship authorized

Outgoing steward: ZMR-release-planner. Incoming steward: ZMR-delivery-manager (parent task /root). Transfer recorded: 2026-09-06 00:19 CEST (2026-09-05 22:19 UTC). Control-plane base: fb8b07c5910b3424c4a15da4e1cfaa920cee4e22.
User authorized the parent to lead and discuss work with ticket subagents while remaining primarily available for coordination and reporting. The control-plane worker has narrow document integration authority only; it launches no ticket workers and does not merge its PR.
Next: manager reviews and merges control-plane changes, records the merged SHA, then dispatches ZMR-1. No ticket assignment exists yet. Dependencies, deferred ZMR-9/10 scope, deployment approval and human SHIP gates remain unchanged.

## Open Questions

None permitted as silent blockers. Decisions provide defaults; materially new scope or live approvals use Human Gates.

## Proposed Cross-Spine Updates

Foundation receives atomic child registration only. Alpha's current status and priority remain untouched; its steward should consume any overlap findings from ZMR-1.

## Appendix

Human inputs and absence rule: semantic version/date follow existing release practice; absent input uses the working title and no deadline. Production approval absent means remain local/closed and report the exact gate.

### Worker Dispatch Prompts

The self-contained dispatch preamble below is committed with this spine. At dispatch the manager fills every placeholder with the bound ticket's exact values and records the completed prompt in its issue. No separate preamble asset is required.

```text
Use EpicSpine.
Identity: <ticket worker or tester; never a second delivery manager>.
Assignment identity: <ZMR-N and stable agent/task name>.
Bound issue: <exact GitHub issue URL from the Issue Ledger>.
Bound spine: docs/EPIC-ZENOD-MEMORY-RELIABILITY.md.
Spine steward: ZMR-delivery-manager (parent task /root).
Branch: <dedicated codex/zmr-N branch>.
Pinned base: <exact merged main SHA; dependencies integrated and verified>.
Absolute worktree: <dedicated absolute path>.
Integration target: main.
Budget: 90-minute checkpoint; report state, blocker and options at expiry.
Book binding: inactive.

FIRST ACTION: git worktree add <absolute-worktree> -b <branch> <pinned-base>.
Work only there. Record the absolute path, base, branch and assignment in the
issue. Never git checkout or git switch in the shared clone; it is read-only
for workers. Pin the base; do not rebase until the wave's journey passes and
the manager explicitly re-pins.

Read AGENTS.md, Foundation, this spine, the bound issue, the review, the
existing entry-retrieval evidence and repository skills/epic-spine/SKILL.md.
Use the Bootstrap Map for additional role-specific reads. Foundation and
sibling spines are read-only. Follow this explicitly bound ZMR scope; do not
select unrelated tickets from the global issue list.

Mission and acceptance: <copy the bound issue's concrete mission, required
reads, acceptance cases, reuse sources and expected evidence>.
Inspect current provider-neutral primitives before authoring. PORT means
move proven code and adapt only imports/config; DUPLICATE means copy the
proven unit. BUILD here is a bounded extension of existing primitives after
verifying the capability gap against current code and the ZMR-1 inventory.
Scratch duplication fails review. Preserve source revisions, URLs, Drive
provenance, immutable evidence and exact-entry identity/isolation.

Write product changes only for the bound issue and detailed work to that
issue. Do not edit any spine unless the manager explicitly delegates a narrow
section. Send cross-spine needs to the manager. Do not spawn duplicate ticket
workers or take over manager reviews/integration. Heartbeat every 30 minutes:
lap/state | blocker | ETA. Two consecutive ETA slips require stopping and
reporting options; workers silent past budget may be reassigned.

Respect all Human Gates in this spine. No production deployment, live vault
mutation, credentials/provider change, real billing/sends or public signup
without the exact applicable approval. For a human gate, the entire next
status is BLOCKED ON Jordi: <exact missing decision, options and recommendation>.
Stop the affected work and notify the manager. No adjacent polishing while
parked at that gate. ZMR-9/10 remain deferred until human SHIP acceptance.

Use synthetic fixtures first. Live customer data changes require approved
snapshot, checksum and one restore drill per mechanism; isolated test assets
use snapshot-and-go; docs need no backup ceremony. Run meaningful focused
checks. Full suites run at most once per pinned commit, never for docs-only
movement. Report exact commands, SHA, environment, pass/fail and limitations.

The parent delivery manager owns live acceptance using the explicitly approved
direct MCP surface. Coordinate bounded repairs within the existing production
authorization and rerun affected checks on the actual deployed candidate.
Do not require a new staging environment, chat UI or screenshot checklist. Never claim live proof from merged code or local tests,
or ask Jordi to click anything not exercised on that same candidate.

Terminal handoff: ready for review with PR URL, branch, base/latest SHA,
absolute worktree, acceptance evidence, residual risks and next action; or a
precisely named blocker. Update the bound issue and notify the sole steward.
Do not merge your own PR. Go.
```

### Acceptance repair dispatch bindings — 2026-09-13

Use EpicSpine and the operational preamble above. Ticket workers read Foundation, this bound ZMR spine and their linked issue. Book inactive; /root remains sole spine steward. All three assignments use pinned base 6e0af0c0f93d8320eb83effca519b015ea456a6c, integration target main, dedicated branches/worktrees from the ledger, 90-minute checkpoints, and issue acceptance. Write only bound code/tests and detailed issue evidence. No production, model/provider changes, historical refiling or private user fixture publication. Preserve separately frozen ASR cases from implementation tuning. Handoff requires exact SHA, PR, tests, limitations and next action; do not self-merge. Go.

- ZMR-18 /root/zmr11_worker: exact unique and adjacent-passage source references; ambiguous/wrong-ID references fail closed; shared-passage independent ideas preserved.
- ZMR-19 /root/zmr12_worker: bounded existing statement context, semantic linking and explicit correction support; qualification guards remain effective.
- ZMR-20 /root/zmr_acceptance_design: question-relevant supported answer survives host projection, with current/prior and citation constraints intact.

### Contract repair dispatch bindings — 2026-09-13

Use EpicSpine and the operational preamble above. Root -> ZMR -> linked issue; Book inactive. Parent /root is sole delivery manager/spine steward. All workers use pinned b183806fd7a994eaaa8088ce600319042f2c815e, main integration, ledger worktrees/branches and 90-minute checkpoints. Write bound code/tests and detailed issue handoff only; no self-merge, production action, provider/model change, new storage service or private fixture publication. No paid reruns before review; ASR cases remain untouched. Replay recorded actual failures and generic variants; keep exact source/qualification, current/prior authority and successful sibling independence. Handoff exact SHA/PR/tests/limitations. Go.

- ZMR-21: preserve complete atomic propositions and bounded exact context; known-project uncertainty reaches reconciliation as uncertain knowledge, while ambiguous destination stays pending.
- ZMR-22: prevalidate one complete decision per idea/branch; existing receipt completion suppresses replay even if generated operation wording changes; correction state/history remain distinct.
- ZMR-23: model selects host-owned support IDs in the existing final completion; host validates and renders canonical facts/history or complete raw reports. Internal selection JSON must not leak into user streaming. No widening synonym lists or new judge service.
