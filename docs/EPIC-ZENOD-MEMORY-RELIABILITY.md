# EPIC: Zenod Memory Reliability

Status: pending — DISPATCH ONLY AFTER control-plane integration into main
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
Steward since: 2026-09-06 Europe/Paris
Last reconciled commit: fb8b07c5910b3424c4a15da4e1cfaa920cee4e22 (control-plane base; product baseline pending ZMR-1)
Planner: Jordi + ZMR-release-planner
Worker: unassigned
Tester: unassigned

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

SHIP — one end-to-end journey on an isolated test tenant of the exact approved LIVE candidate, in a real browser using existing customer chat and vault surfaces. Reuse existing components; BUILD means a bounded extension where the reviewed implementation lacks the behavior, subject to ZMR-1 current-main verification.

- [ ] 1. Open the existing customer surface and capture a synthetic long, multi-topic memory; wait for the terminal receipt and open its evidence. BUILD extension of existing store/chat surfaces.
- [ ] 2. Inspect filing: clear subjects reach focused meaning pages; only the ambiguous topic is marked uncertain; raw content remains intact. BUILD extension of existing classifier/composer.
- [ ] 3. Ask for a detail beyond character 8000 in a long daily log and open the exact cited passage with no neighboring-entry leakage. BUILD extension of existing read tools.
- [ ] 4. Ask for all captures in an older bounded date range within a seeded 650+ entry test vault; traverse coverage and reconcile exact expected refs/counts. BUILD extension of existing structural search.
- [ ] 5. Supply an explicit correction, then ask what is true now and what was true before; both answers cite the appropriate evidence. BUILD extension of existing meaning/ask pipeline.
- [ ] 6. Ask a paraphrase and an unsupported question; recover the supported fact and admit the unknown, with zero fabricated supporting evidence. BUILD extension of existing search/grounding.
- [ ] 7. Test package: operator records “I manually walked the full journey and it works” only after a clean pass, with live URL, immutable SHA, one screenshot per step, source refs, rollback and remaining risks. “Now you test.” Jordi walks the same candidate.

The manager walks to the first breakage, repairs that failure, obtains required deploy approval, and restarts at step 1. Automated tests support this journey; they do not replace it. Production approval is never implied by this contract.

Mandatory supporting gates: 100% deterministic pagination/identity/isolation cases pass; every fixed SHIP answer is correct and evidence-supported in three independent conversations; no false exhaustive claims or unsupported current-state claims in the fixed cases. Freeze ground truth before tuning. Report held-out retrieval recall, answer correctness, abstention, citation support, p50/p95 latency and costs separately, including any regressions. These are targets, not achieved results.

HARDEN — deferred until Jordi accepts SHIP:

- ZMR-9: evaluate hybrid retrieval and reranking against the frozen baseline before adopting it.
- ZMR-10: approved-plan maintenance for historical uncertain filings, duplicate pages and oversized summaries.
- Bulk historical backfill, automatic restructuring and any new paid embedding service are outside SHIP.

## Non-Goals

Replacing Markdown/Git, rebuilding the portal or transport, executing tasks from stored memories, inventing a new pricing plan, opening signup, bulk reorganizing the live vault, or declaring historical defects live without current evidence.

## Current State

Phase: implementation authorized; control-plane integration pending
Last verified: 2026-09-06 Europe/Paris
Integration target: main
Fresh base commit: review ca39aa968cc8560925d027c74c28b742a3aa8805; remote main observed fb8b07c5910b3424c4a15da4e1cfaa920cee4e22
Pinned-base rule: pin reconciled main at dispatch; pinned, no rebases until that wave's journey passes; re-pin after integrated waves.
Dispatch condition: user implementation/subagent authorization received 2026-09-06; integrate control-plane files into main before dispatching ZMR-1. Later tickets retain ledger dependencies.
Next action: merge the reviewed control-plane PR, then dispatch ZMR-1 from that exact merged main base.
Blockers: control-plane PR must merge before ticket dispatch; historical review checkout is older than current main and deployment has not been reverified.

## Execution Cursor

Last attempted: reconcile planning documents with current main and transfer delivery stewardship after the user authorized implementation and subagents on 2026-09-06.
Result: scoped control-plane integration prepared from fb8b07c5910b3424c4a15da4e1cfaa920cee4e22; original dependencies and human SHIP/production gates retained.
Execution status: ready for control-plane review and integration
Waiting on: merged control-plane base; no ticket worker active
Approved work: delivery coordination, issue/PR handoffs, bounded ticket implementation and synthetic/local validation in dependency order after control-plane integration. Deployment, live mutations and human SHIP acceptance retain their named gates.
Next action: merge the reviewed control-plane PR, then dispatch ZMR-1 from that exact merged main base.

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

Current-main trap for ZMR-1: open #1160 is superseded by completed [#1171](https://github.com/zenod-ai/zenod/issues/1171), merged at d77ea431. Provider-neutral engine/search/get/evidence capabilities already exist on this base; preserve source revisions, source URLs and Drive provenance when extending retrieval. Reconcile this against current code before proposing replacement primitives.

Known traps: whole-file search versus prefix reads; limit-before-filter; one confidence across topics; unbounded summaries; citation existence mistaken for entailment; old reports mistaken for current verification. See the review and individual tickets.

Wave 1: ZMR-1 runnable baseline. Wave 2: ZMR-2 and ZMR-3 have related core evidence surfaces and therefore run sequentially unless the manager proves disjoint ownership. Wave 3: ZMR-4; wave 4: ZMR-5; wave 5: ZMR-6; wave 6: ZMR-7; wave 7: ZMR-8 then manager journey. No automatic parallel dispatch.

During active execution, heartbeat every 30 min: `lap/state | blocker | ETA`; two consecutive ETA slips trigger a scope/status review. This document creates no automation.
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

ZMR-1 is ready after control-plane integration; ZMR-2–8 remain dependency-gated. ZMR-9/10 remain deferred until human SHIP acceptance. Dependencies refer to ZMR IDs resolved to GitHub links in each issue. Detailed acceptance lives in issues; this ledger owns scope and dependency rollup.

| Issue | Wave | Method | Budget | Role | Owner / Assignment | Title | Status | Depends On | Worktree | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [ZMR-1 #1189](https://github.com/zenod-ai/zenod/issues/1189) | 1 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | unassigned | Establish the runnable memory-recall baseline demo | ready after control-plane merge | none | ../wt-zmr-1 at dispatch | codex/zmr-1 | pin at dispatch | Review only | 2026-09-06 | Run baseline when bound |
| [ZMR-2 #1190](https://github.com/zenod-ai/zenod/issues/1190) | 2 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | unassigned | Retrieve answer-bearing passages beyond the note prefix | proposed | ZMR-1 | ../wt-zmr-2 at dispatch | codex/zmr-2 | pin at dispatch | Review only | 2026-09-06 | Wait for dependencies |
| [ZMR-3 #1191](https://github.com/zenod-ai/zenod/issues/1191) | 2 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | unassigned | Make historical entry search complete and paginated | proposed | ZMR-1 | ../wt-zmr-3 at dispatch | codex/zmr-3 | pin at dispatch | Review only | 2026-09-06 | Wait for dependencies |
| [ZMR-4 #1192](https://github.com/zenod-ai/zenod/issues/1192) | 3 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | unassigned | Give ask_brain typed retrieval and explicit coverage | proposed | ZMR-2, ZMR-3 | ../wt-zmr-4 at dispatch | codex/zmr-4 | pin at dispatch | Review only | 2026-09-06 | Wait for dependencies |
| [ZMR-5 #1193](https://github.com/zenod-ai/zenod/issues/1193) | 4 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | unassigned | File multi-topic memories with per-topic confidence | proposed | ZMR-1, ZMR-4 | ../wt-zmr-5 at dispatch | codex/zmr-5 | pin at dispatch | Review only | 2026-09-06 | Wait for dependencies |
| [ZMR-6 #1194](https://github.com/zenod-ai/zenod/issues/1194) | 5 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | unassigned | Keep meaning notes focused and summaries bounded | proposed | ZMR-5 | ../wt-zmr-6 at dispatch | codex/zmr-6 | pin at dispatch | Review only | 2026-09-06 | Wait for dependencies |
| [ZMR-7 #1195](https://github.com/zenod-ai/zenod/issues/1195) | 6 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Ticket worker | unassigned | Distinguish current facts, corrections and historical evidence | proposed | ZMR-4, ZMR-6 | ../wt-zmr-7 at dispatch | codex/zmr-7 | pin at dispatch | Review only | 2026-09-06 | Wait for dependencies |
| [ZMR-8 #1196](https://github.com/zenod-ai/zenod/issues/1196) | 7 | BUILD extension; reuse ticket inventory | 90 min checkpoint | Tester | unassigned | Prove the Memory Reliability release journey | proposed | ZMR-2, ZMR-3, ZMR-4, ZMR-5, ZMR-6, ZMR-7 | ../wt-zmr-8 at dispatch | codex/zmr-8 | pin at dispatch | Review only | 2026-09-06 | Wait for dependencies |
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

No active assignments. The manager reassigns workers silent past budget after inspecting their issue/branch evidence. Preserve previous identity/history; record incoming owner, exact SHA, unverified work and next action before resuming. Ninety minutes is a checkpoint, not a completion claim.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-09-06 | Prior review | ca39aa9 local | local checkout | npm run test -w zenod -- test/memoryEntries.test.ts test/aisdk-retrieval-retry.test.ts test/engine.test.ts | 60 tests passed; not release acceptance | [Review](planning/zenod-memory-reliability-review.md) |
| 2026-09-06 | Release planning | working tree | local documents / GitHub | validate_spine.py --strict on ZMR; issue-body/link reconciliation | ZMR passes strict validation; #1188 tracker and #1189–#1198 created and linked | This task |
| 2026-09-06 | Parent graph | working tree | Foundation + ZMR | validate_spine.py --graph | ZMR has no errors/warnings and reciprocal registration resolves; whole-family validation fails on Foundation's pre-existing missing Execution Cursor and legacy Decisions columns | Parent migration deferred to Foundation steward |

| 2026-09-06 | Control-plane integration | base fb8b07c5910b3424c4a15da4e1cfaa920cee4e22 | isolated worktree / local documents | Shared updated validator: strict ZMR and Foundation+ZMR graph; git diff --check | ZMR strict and reciprocal graph checks pass; Foundation retains 11 pre-existing structural errors and 27 v2 warnings | No product or deployed behavior validated |

## Handoff Journal

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

Outgoing steward: ZMR-release-planner. Incoming steward: ZMR-delivery-manager (parent task /root). Transfer recorded: 2026-09-06 Europe/Paris. Control-plane base: fb8b07c5910b3424c4a15da4e1cfaa920cee4e22.
User authorized the parent to lead and discuss work with ticket subagents while remaining primarily available for coordination and reporting. The control-plane worker has narrow document integration authority only; it launches no ticket workers and does not merge its PR.
Next: manager reviews and merges control-plane changes, records the merged SHA, then dispatches ZMR-1. No ticket assignment exists yet. Dependencies, deferred ZMR-9/10 scope, deployment approval and human SHIP gates remain unchanged.

## Open Questions

None permitted as silent blockers. Decisions provide defaults; materially new scope or live approvals use Human Gates.

## Proposed Cross-Spine Updates

Foundation receives atomic child registration only. Alpha's current status and priority remain untouched; its steward should consume any overlap findings from ZMR-1.

## Appendix

Human inputs and absence rule: semantic version/date follow existing release practice; absent input uses the working title and no deadline. Production approval absent means remain local/closed and report the exact gate.

### Worker Dispatch Prompts

At dispatch the manager prepends the current `skills/epic-spine/assets/dispatch-prompt-preamble.md`, substitutes the bound issue, branch, absolute worktree and pinned SHA, and records the completed prompt in the issue:

“Use EpicSpine. Identity: ticket worker. Bound spine: docs/EPIC-ZENOD-MEMORY-RELIABILITY.md. Assignment: ZMR-N. Steward: current recorded ZMR manager. Mission and acceptance: bound GitHub issue. First action: create the dedicated worktree from the recorded base; never switch the shared clone. Write detailed evidence to the issue, not sibling/parent spines. Respect all Human Gates. Terminal state: review with PR/evidence or a precisely named blocker. Go.”
