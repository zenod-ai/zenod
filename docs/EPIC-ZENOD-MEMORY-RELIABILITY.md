# EPIC: Zenod Memory Reliability

Status: active
Created: 2026-09-06
Updated: 2026-09-06
Repository: zenod-ai/zenod
Primary document: docs/EPIC-ZENOD-MEMORY-RELIABILITY.md
Spine ID: ZMR
Spine Type: branch
Root spine: [Foundation](EPIC-0-FOUNDATION-SPINE.md)
Parent spine: [Foundation](EPIC-0-FOUNDATION-SPINE.md)
Additional root rationale: n/a
GitHub issues: https://github.com/zenod-ai/zenod/issues/1188
Integration branch: main
Active spine steward: ZMR-delivery-manager (parent task /root)
Steward since: 2026-09-06 00:19 CEST (2026-09-05 22:19 UTC)
Last reconciled commit: c5da66f00ec6125e7e6f268d0d49291ac6ee8502 deployed public Zenod at 22:36:24 UTC; evidence-only main updates separate
Planner: Jordi + ZMR-release-planner
Worker: /root/zmr_8_chat_review — verified facts on ordinary reads; /root/zmr_deploy_audit — sole production operator
Tester: parent direct live MCP acceptance; independent agent review

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Planner | ZMR-release-planner (handed off 2026-09-06 Europe/Paris) | Release planning | Planning complete; stewardship transferred to ZMR-delivery-manager. | Connected epic and dependency-ordered backlog. |
| Epic worker | ZMR-delivery-manager (parent task /root) | ZMR release | MANAGER: dispatch bounded ticket subagents after control-plane integration, coordinate/report to Jordi, reconcile dependencies, integrate reviewed work, and personally walk acceptance after deployment approval. | Exact candidate, evidence, human test package. |
| Ticket worker | unassigned | One ZMR issue | FIRST ACTION: git worktree add dedicated worktree from pinned SHA; never checkout/switch shared clone. Inspect reuse sources first; scratch duplication fails review. | Issue handoff with PR, SHA, evidence, blocker, next action. |
| Tester | unassigned | ZMR-8 | Validate exact candidate; write detailed evidence to issue. | Pass/fail and human test package. |

## Write Scope

Bound spine: docs/EPIC-ZENOD-MEMORY-RELIABILITY.md
Active steward: ZMR-delivery-manager (parent task /root)

The user requested this new release epic and backlog, then explicitly authorized delivery management and ticket subagents on 2026-09-06. ZMR-delivery-manager is the sole steward and remains primarily available for coordination and reporting. Ticket execution proceeds in dependency order after control-plane integration; ZMR-9/10 remain deferred until human SHIP acceptance. Parent edits are limited to lineage metadata and a compact new-child rollup. Existing Phylax delivery and Alpha launch state, gates and linked issues remain read-only. No sibling implementation ownership is transferred. Record outgoing/incoming steward, absolute time, base and next action at handoff. Book binding: inactive.

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

Latest verification (2026-09-06 23:33 UTC): **4c6ca14aaf2d83ef0330e894627d44cba320fec3 is live; upgrade acceptance is NOT finalized.** Actual task, OCI and health match immutable image sha256:589b51d86b9e3cc4cd1e23392d99fc493615dc18118198cd62045bd441d66885. Queue empty; unrelated triggers disabled; configuration, volume and private Phylax preserved. Three fresh boundary recalls passed 2/3: one skipped the current fact page and answered from older architecture notes. Worker /root/zmr_8_chat_review is investigating source selection; no further image switch requested. This receipt supersedes the historical c5da66f cursor below. See [exact evidence](evidence/zmr-live-4c6ca14/README.md).

Phase: c5da66f live; filing retest passed; ordinary-page fact recall repair active
Last verified: 2026-09-07 00:17 CEST
Integration target: main
Fresh base commit: 392d058a599bdf5fc69d17157282b8f9154dcf28; repaired customer chat, explicitly repinned for ZMR-8
Pinned-base rule: pin reconciled main at dispatch; pinned, no rebases until that wave's journey passes; re-pin after integrated waves.
Dispatch condition: ZMR-1–7 integrated; ZMR-8 local validation authorized; live deployment retains exact human gates.
Next action: expose existing verified facts during ordinary meaning-page reads; review and test the bounded change, then repeat the deployment-boundary recall on its actual deployed version.
Blockers: open-ended boundary recall selected obsolete body text despite correct new memoryFacts; verified facts require separate read_facts today. Raw evidence and successful filing are verified.

## Execution Cursor

Latest receipt: `c5da66f00ec6125e7e6f268d0d49291ac6ee8502` live at 22:36:24.878 UTC, image `sha256:d1b4b7448f9e681ef750710a6fd11d2f7368fe6dc717a35e0f1f60ad2f76561d`, actual OCI/task/health and preservation checks pass. Job `31c1d895-d5bb-4b06-9129-65bf9b109796` filed the exact repository boundary to Projects/Zenod.md (revision c906053f), one topic and zero uncertainty/pending. Natural recall audit `test_86c1f595cebc4d9ea46822a0bb9031b0` nevertheless returned obsolete Herald scope from old body text. Five correct new frontmatter memoryFacts verified; worker is reusing verified-fact projection on ordinary unpinned page reads. See `docs/evidence/zmr-live-c5da66f/`.

Prior repair receipt: `56c815f38aab6790b8afc165a8001e8fc0b5732b` verified by actual task/OCI/health, immutable image `ghcr.io/zenod-ai/zenod@sha256:4baf0239c48c0aba3acbab797d3ba441c5f10bee2bc1c82a1f5bb388a623e342`; queue empty after job 10083. Jordi authorized clearing the backlog: our main merges had triggered legacy sibling autoDeploy builds with no path filters. Four triggers paused with private backups; ten unrelated pending jobs removed, running services/data preserved. See the deployments leaf. MCP recall `test_867984e3691a49ae932909e3cf4488aa` recovered the saved preferences but mislabelled input channel and made an unqualified absence claim; stress log read `test_47ee05569fe44dfeac6cf123827a2d85` returned partial coverage. Filing job `02ee721e-8c9c-4be7-9e07-ca00e440f114` saved intact at revision `415b42a92d16b846ad5175c065e2e3260391d8ab` with classification_unavailable. Metered calls show an initial success followed by optional fallback failures; worker confirmed this discards the valid first result. No provider/schema change is needed for the assigned correction.

Historical queued repair receipt (completed at 22:15:07.905 UTC): reviewed/CI-green PRs #1219 and #1220 merged; candidate `56c815f38aab6790b8afc165a8001e8fc0b5732b`, published image `ghcr.io/zenod-ai/zenod@sha256:4baf0239c48c0aba3acbab797d3ba441c5f10bee2bc1c82a1f5bb388a623e342`. Dokploy desired configuration is updated, but actual production remains `392d058`. HTTP 200 acknowledged enqueue; deployment history shows worker-started records only. Read-only BullMQ inspection confirmed the requests waiting. Only duplicate jobs 10084/10085/10086 were removed through Job.remove after exact app/state checks; 10083 retained. No forced Swarm update, shared service restart or speculative endpoint correction. If undoing before execution, first cancel exact pending candidate job 10083 after checking app/state, otherwise it may execute after rollback.


Last attempted: deploy tested public candidate with preserved config and verified recovery, then test real MCP capture and recall.
Result: c5da66f is live, queue empty, runtime/data preserved. New boundary filed successfully at c906053f; ordinary recall selected obsolete body text instead of correct saved facts. Retrieval correction assigned.
Execution status: active
Waiting on: /root/zmr_8_chat_review bounded ordinary-page retrieval fix; sole operator /root/zmr_deploy_audit owns subsequent image switch; parent runs MCP
Approved work: this production upgrade, bounded live memory tests and fixes, and reusable undo procedure are explicitly authorized. Preserve data/configuration; no provider overhaul, billing/signup change or destructive restore. Human SHIP acceptance remains separate.
Next action: expose existing verified facts during ordinary meaning-page reads; review and test the bounded change, then repeat the deployment-boundary recall on its actual deployed version.





## Bootstrap Map

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

## Issue Ledger

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

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Deploy candidate | Jordi | Candidate passes local acceptance | Exact immutable image/targets/config delta, verified backup/restore and rollback under existing readiness rules | Local fixtures and review |
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
| 2026-09-06 | Prior review | ca39aa9 local | local checkout | npm run test -w zenod -- test/memoryEntries.test.ts test/aisdk-retrieval-retry.test.ts test/engine.test.ts | 60 tests passed; not release acceptance | [Review](planning/zenod-memory-reliability-review.md) |
| 2026-09-06 | Release planning | working tree | local documents / GitHub | validate_spine.py --strict on ZMR; issue-body/link reconciliation | ZMR passes strict validation; #1188 tracker and #1189–#1198 created and linked | This task |
| 2026-09-06 | Parent graph | working tree | Foundation + ZMR | validate_spine.py --graph | ZMR has no errors/warnings and reciprocal registration resolves; whole-family validation fails on Foundation's pre-existing missing Execution Cursor and legacy Decisions columns | Parent migration deferred to Foundation steward |
| 2026-09-06 | Control-plane integration | base fb8b07c5910b3424c4a15da4e1cfaa920cee4e22 | isolated worktree / local documents | Shared updated validator: strict ZMR and Foundation+ZMR graph; git diff --check | ZMR strict and reciprocal graph checks pass; Foundation retains 11 pre-existing structural errors and 27 v2 warnings | No product or deployed behavior validated |

## Handoff Journal

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
