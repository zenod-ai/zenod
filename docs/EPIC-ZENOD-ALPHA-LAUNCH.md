# EPIC: Zenod Alpha Launch

Status: active
Created: 2026-08-16
Updated: 2026-08-16
Repository: `zenod-ai/zenod`
Primary document: `docs/EPIC-ZENOD-ALPHA-LAUNCH.md`
GitHub issues: `https://github.com/zenod-ai/zenod/issues`
Integration branch: `main`
Active spine steward: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)
Steward since: 2026-08-16 17:07 CEST
Last reconciled commit: `1a39166bc252cf9a0f6b0a1482ab33e4c388c80e` plus current spine working tree
Planner: Jordi + Zenod Alpha delivery manager
Worker: unassigned
Tester: unassigned

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Project/root coordination | Read this child spine; own project direction and cross-epic rollup in `docs/EPIC-0-FOUNDATION-SPINE.md`. | Root rollup and cross-spine decisions current. |
| Planner | Zenod Alpha delivery manager | Alpha scope and issue board | Steward this spine, maintain acceptance and dependencies, create/update issues, dispatch ready work. | Executable board or exact human decision required. |
| Epic worker | Zenod Alpha delivery manager | Full accepted alpha epic | Act as delivery manager; dispatch ticket workers, reconcile results, maintain this spine, and loop to tester/human acceptance. | Alpha ready for human test or blocked on a named gate. |
| Ticket worker | one stable assignment per issue | One GitHub issue | Work only the bound issue in its dedicated branch/worktree; write detail and handoff to the issue, not this spine. | PR/branch, latest commit, evidence, risk, terminal state, and next action in the issue. |
| Tester | one stable assignment per acceptance issue | Exact commit and named surface | Validate and report; no implementation changes unless explicitly reassigned. | Pass/fail evidence, tested SHA/environment, residual risk, and steward notification. |

## Write Scope

Bound spine: `docs/EPIC-ZENOD-ALPHA-LAUNCH.md`
Active steward: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Writable by default:

- The active delivery manager reconciles and commits this spine.
- Ticket workers and testers write detailed progress and structured handoffs to their assigned GitHub issue.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-0-FOUNDATION-SPINE.md` — root/project direction and cross-epic health.
- `docs/EPIC-MECHANICAL-CAPTURE.md` — voice capture and grounded-recall implementation history.
- `docs/EPIC-2.3-ZENOD-MOVE-0.md` — historical standalone/hosted launch execution.
- `docs/EPIC-0-STORY.md` — public positioning and launch story.

Cross-spine change rule: read linked spines for context, but record proposed edits here and notify their steward unless explicit authority is granted.

Stewardship transfer rule: record the outgoing steward, incoming steward, absolute time, current commit, and next action before another agent writes this spine.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Alpha-launch intent, scope, acceptance, dependencies, decisions, and rollup state |
| GitHub issue | Detailed execution state for one alpha ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |
| `docs/EPIC-0-FOUNDATION-SPINE.md` | Project direction and child-spine relationship |
| `docs/PRODUCTION-READINESS.md` | Current operational gate and exact production evidence procedure |

## Mission

Bring Zenod from a working founder workflow to a trustworthy alpha product: a new user can discover the real offer, onboard through the supported path, use the core memory loop, receive grounded evidence-backed answers, manage billing when applicable, and get honest support. Keep the future voice-note-to-Codex execution lane separate from this launch gate.

## Definition Of Done

- [ ] One evidence-backed current-state matrix reconciles `main`, the deployed immutable SHA, production configuration, landing/legal pages, checkout, onboarding, MCP memory journeys, backup/restore, support, and known defects.
- [ ] The 2026-08-15 incorrect “what have we been talking about recently?” interaction is reproduced against the current deployed surface, diagnosed, and either fixed with a pinned regression or closed with exact evidence that current behavior passes.
- [ ] Jordi approves one explicit alpha offer: hosted/self-hosted boundaries, price, whether WhatsApp is included in the launch promise, onboarding path, and support expectation.
- [ ] Every required item in `docs/PRODUCTION-READINESS.md` is green with current evidence; public paid signup remains fail-closed until the named production gate is approved and passed.
- [ ] A tester completes one uninterrupted stranger journey from public page through onboarding to a working MCP store/search/get/ask loop, billing portal where applicable, tenant isolation checks, and any approved WhatsApp promise.
- [ ] The first alpha invitation/promotion draft names only capabilities proved by the accepted journey; nothing public is posted without exact-content approval.
- [ ] The spine, GitHub issue board, PRs, evidence, owner, blockers, and single next action agree so a fresh delivery manager can continue without chat history.

## Non-Goals

- Building the voice-note-to-Codex execution lane; that is a proposed follow-on child epic.
- Closing or cleaning the repository's entire historical issue backlog.
- Shipping every deferred Zenod, Ring, Phylax, Callisthenes, or Epaminon feature.
- Public posting, production deployment, real-card charging, or opening signup without the named human gate.

## Current State

Phase: planning and first dispatch-ready audit batch
Last verified: 2026-08-16 17:07 CEST
Integration target: `main`
Fresh base commit: `1a39166bc252cf9a0f6b0a1482ab33e4c388c80e`
Next action: dispatch ZAL-1 and ZAL-2 in parallel; the delivery manager reconciles both handoffs before presenting the package decision and production execution batch.
Blockers: production mutation, live billing drill, signup opening, final alpha package, WhatsApp launch promise, and external promotion require Jordi's named approvals; none blocks the first read-only/branch-isolated batch.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Epic 0 worker | Keep this alpha epic aligned with project direction. | Root rollup current or cross-epic decision required. |
| Planner | Keep a small executable board with explicit dependencies. | Ready work dispatched or named decision required. |
| Epic worker | Deliver the alpha milestone through issue/subagent loops. | Ready for Jordi's acceptance or blocked on a named gate. |
| Ticket worker | Complete one bound alpha issue. | Review/testing or blocked with exact required input. |
| Tester | Prove the accepted alpha journey. | Pass/fail with exact SHA and evidence. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docs/EPIC-ZENOD-ALPHA-LAUNCH.md` | Current intent, state, issue ledger, dependencies, gates, and next action. | Always |
| 2 | `docs/PRODUCTION-READINESS.md` | Current operational and billing gate; exact production evidence procedure. | Always |
| 3 | `docs/EPIC-0-FOUNDATION-SPINE.md` | Root direction, voice-note evidence, execution-lane separation, and cross-spine authority. | Planner / epic worker |
| 4 | `docs/EPIC-MECHANICAL-CAPTURE.md` | Proven capture/retrieval behavior and exact recent-conversation repair history. | ZAL-2 / tester |
| 5 | `docs/evidence/generic-entry-retrieval-2026-08-01/README.md` | Exact typed recent-memory retrieval proof. | ZAL-2 / tester |
| 6 | `docs/ROADMAP.md` | Current hosted/self-hosted product split and milestone history. | ZAL-1 / ZAL-3 |
| 7 | [`Log/2026-08-15.md#^e-5c1e43`](https://github.com/AlfaBlok/obsidian-brain/blob/c18c1f92cbd26ce5a12518f9c7af7c59ff5eb928/Log/2026-08-15.md#L21) | Voice-note product direction and promotion intent. | Planner |
| 8 | [`Log/2026-08-15.md#^e-063285`](https://github.com/AlfaBlok/obsidian-brain/blob/a58d731c33000a780f4bd94bbe02b0432e2282db/Log/2026-08-15.md#L27) | Reported recent-recap failure and launch-readiness milestone. | ZAL-2 / tester |

## Architecture And Context

Current `main` already contains the production-readiness implementation merged through PRs #1053–#1057. It adds fail-closed public signup, recurring billing/customer portal handling, accurate hosted/legal disclosures, atomic customer persistence, security headers, dependency remediation, and a Swarm-safe cold backup/isolated restore runbook. This is code readiness, not proof that the production gates have been executed.

The core memory wedge is also real: WhatsApp voice notes are captured, transcribed, immutably anchored, structurally searchable newest-first, and exactly retrievable by evidence ref. July/August evidence proves those primitives. The 2026-08-15 report says a broader recent-conversation answer was still wrong, so alpha acceptance must test the synthesized conversation experience, not only the storage primitives.

The repository's global issue list is not the alpha board. It contains many historical, superseded, blocked, or test-only issues. Only the issues linked in this spine's active Issue Ledger are dispatchable by the Zenod Alpha delivery manager.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-08-16 | Make trustworthy alpha launch the immediate milestone. | The working memory loop should reach real users before the larger execution product expands scope. | `docs/EPIC-0-FOUNDATION-SPINE.md` and `^e-063285` |
| 2026-08-16 | Treat this child spine's linked issue ledger as the only active alpha dispatch board. | The repository-wide open issue list is too stale and heterogeneous for safe automatic selection. | GitHub issue reconciliation on 2026-08-16 |
| 2026-08-16 | Dispatch ZAL-1 and ZAL-2 as the first parallel batch. | One establishes current launch truth; the other resolves the known trust regression. Their initial file surfaces and acceptance are independent. | Issue contracts below |
| 2026-08-16 | Keep store-only alpha launch separate from the proposed store+execute product epic. | Stored transcript content cannot become implicit repo mutation authority, and the larger UX/pricing/authority design should not delay the core memory launch. | `^e-5c1e43` and Foundation decision log |
| 2026-08-16 | Keep public paid signup fail-closed until production evidence and approval are current. | Merged code is not deployed/operational proof; billing, restore, legal profile, and real-card journeys carry production risk. | `docs/PRODUCTION-READINESS.md` |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#1058](https://github.com/zenod-ai/zenod/issues/1058) | Ticket worker | unassigned | ZAL-1 · Reconcile alpha-launch truth and readiness matrix | ready | - | `codex/zal-1-readiness-audit` | `1a39166` | Evidence matrix and smallest ordered backlog are committed; no production mutation. | PRs #1053–#1057 merged; runbook exists. | 2026-08-16 17:07 CEST | Dispatch in isolated worktree. |
| [#1059](https://github.com/zenod-ai/zenod/issues/1059) | Ticket worker | unassigned | ZAL-2 · Reproduce and repair the incorrect recent-conversation recap | ready | - | `codex/zal-2-recent-recap` | `1a39166` | Exact interaction is reproduced and fixed with regression, or current pass is proved with full trace; no production deploy. | `^e-063285`; exact memory entries are retrievable. | 2026-08-16 17:07 CEST | Dispatch in isolated worktree. |
| [#1060](https://github.com/zenod-ai/zenod/issues/1060) | Planner | unassigned | ZAL-3 · Frame the alpha offer and WhatsApp boundary for decision | waiting | [#1058](https://github.com/zenod-ai/zenod/issues/1058) | `codex/zal-3-offer-decision` | `1a39166` | 2–3 truthful options, recommendation, promise matrix, and exact Jordi decision are recorded. | Hosted €5/month and self-host split exist; WhatsApp promise unresolved. | 2026-08-16 17:07 CEST | Start after ZAL-1 handoff. |
| [#1061](https://github.com/zenod-ai/zenod/issues/1061) | Epic worker / operator | unassigned | ZAL-4 · Execute the fail-closed production-readiness gate | blocked | [#1058](https://github.com/zenod-ai/zenod/issues/1058), [#1059](https://github.com/zenod-ai/zenod/issues/1059), [#1060](https://github.com/zenod-ai/zenod/issues/1060), production approval | `codex/zal-4-production-gate` | `1a39166` | Every runbook check has current evidence; signup remains closed until exact approval, then opens and verifies or rolls back safely. | `docs/PRODUCTION-READINESS.md`; public signup disabled pending evidence. | 2026-08-16 17:07 CEST | Prepare read-only packet; request exact production/real-card/signup approval. |
| [#1062](https://github.com/zenod-ai/zenod/issues/1062) | Tester | unassigned | ZAL-5 · Stranger alpha onboarding and memory acceptance | waiting | [#1061](https://github.com/zenod-ai/zenod/issues/1061) | `codex/zal-5-stranger-acceptance` | `1a39166` | One uninterrupted public-page → onboarding → MCP memory journey passes on the named deployed SHA; approved WhatsApp promise is included if applicable. | Existing founder/live component evidence only. | 2026-08-16 17:07 CEST | Dispatch after production gate passes. |
| [#1063](https://github.com/zenod-ai/zenod/issues/1063) | Planner / outbound drafter | unassigned | ZAL-6 · Draft the first proof-led alpha invitation | waiting | [#1060](https://github.com/zenod-ai/zenod/issues/1060); may run beside [#1061](https://github.com/zenod-ai/zenod/issues/1061) | `codex/zal-6-alpha-invitation` | `1a39166` | Exact Reddit/X options and landing target match proved capabilities; nothing is published. | Promotion requested in `^e-5c1e43`. | 2026-08-16 17:07 CEST | Draft after offer decision; request exact-content approval before posting. |

## Branch And Integration

- Default integration branch: `main`.
- One ticket worker = one linked issue = one dedicated `codex/zal-*` branch.
- Concurrent workers use separate worktrees based on the ledger's fresh base; never switch branches in the delivery manager's shared worktree.
- Each dispatch records assignment identity, worktree, base commit, integration target, expected validation, and last verified time in the issue and ledger.
- Ticket workers write detailed work and handoffs to GitHub. Only the active delivery manager reconciles this spine.
- `review`: implementation/artifact complete, PR open, required automated checks passing.
- `testing`: exact commit available on a named surface and acceptance validation active.
- `done`: acceptance passed, evidence and residual risk linked, issue and spine reconciled.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Alpha offer and WhatsApp promise | Jordi | ZAL-3 decision packet ready | Approve exact hosted/self-hosted offer, price, WhatsApp inclusion, onboarding, and support promise. | ZAL-1/ZAL-2 and draft-only prep. |
| Production deployment and configuration | Jordi | ZAL-4 preflight ready | Approve exact immutable image, Dokploy target, redacted env-key change set, and rollback plan. | Read-only checks and local validation. |
| Live billing drill | Jordi | Closed signup deploy is healthy | Approve one exact real-card €5 drill and intended refund/cancellation handling. | Non-financial readiness checks. |
| Open public signup | Jordi | All production evidence is current | Approve setting `ZENOD_PUBLIC_PAID_SIGNUP=1` on the named SHA/environment. | Closed alpha testing. |
| External promotion | Jordi | ZAL-6 exact draft and target ready | Approve the exact final text and destination. | Research and drafts only. |

## Recovery And Takeover

Stale assignment policy: verify issue, branch, PR, latest commit, evidence, blocker, and next action before takeover; preserve old history and record the new identity/base.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | `1a39166` | none | 2026-08-16 17:07 CEST |

## Planner Queue

- Dispatch ZAL-1 and ZAL-2 as the only initial parallel batch.
- Reconcile their GitHub handoffs into Current State, Issue Ledger, Validation Evidence, and Handoff Journal.
- Present the ZAL-3 decision packet to Jordi; do not let a worker silently decide the launch promise.
- Keep ZAL-4 fail-closed until every named production approval is explicit.
- Draft the separate voice-note-to-Codex child epic after the alpha offer is accepted; it is not part of this board.

## Worker Queue

- ZAL-1 and ZAL-2 only until their handoffs are reconciled.
- ZAL-4 may prepare a read-only preflight packet while blocked, but may not deploy, charge, or open signup.

## Tester Queue

- ZAL-2 pins the reported recap failure before alpha acceptance.
- ZAL-5 owns the final stranger journey on one exact deployed SHA.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-08-16 | Production-readiness implementation | `1a39166` | GitHub `main` | PRs #1053–#1057; repository runbook and merged test evidence | code-ready; operational gate pending | `docs/PRODUCTION-READINESS.md` |
| 2026-08-01 | Typed recent-memory retrieval | `d4eaac4` deployed at time of proof | Zenod MT MCP | newest-first structural `search_memory` plus exact evidence-ref `get_memory` | pass | `docs/evidence/generic-entry-retrieval-2026-08-01/` |
| 2026-08-16 | Child spine structure | working tree from `1a39166` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-ZENOD-ALPHA-LAUNCH.md` | pending final issue links | this file |

## Handoff Journal

### 2026-08-16 - Epic worker - Alpha delivery surface created

Context: The root voice-note update established the desired product direction, but GitHub still exposed roughly one hundred heterogeneous open issues and no linked alpha ticket. A fresh agent could orient from the Foundation spine but could not safely choose work.

Next: validate and publish the control-plane docs. After they land on `main`, the delivery manager may dispatch [ZAL-1 #1058](https://github.com/zenod-ai/zenod/issues/1058) and [ZAL-2 #1059](https://github.com/zenod-ai/zenod/issues/1059) on the command “continue.”

Risks: many repository issues are stale or historical; do not infer alpha priority from global issue recency. Production readiness code is merged, but deployment, restore, live billing, and signup evidence remain separate facts.

Assignment identity: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: `codex/alpha-launch-control` from `1a39166` plus current spine working tree

Last verified: 2026-08-16 17:07 CEST

Links:

- `docs/EPIC-0-FOUNDATION-SPINE.md`
- `docs/PRODUCTION-READINESS.md`
- `docs/EPIC-MECHANICAL-CAPTURE.md`
- https://github.com/zenod-ai/zenod/issues/1058
- https://github.com/zenod-ai/zenod/issues/1059
- https://github.com/zenod-ai/zenod/issues/1060
- https://github.com/zenod-ai/zenod/issues/1061
- https://github.com/zenod-ai/zenod/issues/1062
- https://github.com/zenod-ai/zenod/issues/1063

## Open Questions

- Which exact WhatsApp capability, if any, is part of the first public alpha offer? Owner: Jordi. Needed by: ZAL-3 decision.
- Is the first public promotion an alpha invitation, build-in-public proof, or product-learning post? Owner: Jordi. Needed by: ZAL-6 approval.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-08-16 | `docs/EPIC-0-FOUNDATION-SPINE.md` | Link this child as the active Zenod alpha delivery surface and replace draft launch rows with this board. | This spine and linked GitHub issues. | Epic 0 Foundation planner | proposed |
| 2026-08-16 | `docs/EPIC-MECHANICAL-CAPTURE.md` | Add ZAL-2 result only if the exact recent-recap replay changes grounded-recall acceptance or evidence. | ZAL-2 issue handoff. | Mechanical Capture steward | proposed |
| 2026-08-16 | `docs/EPIC-0-STORY.md` | Consume the approved ZAL-3 promise and ZAL-5 evidence for public copy; do not claim the future execution lane. | ZAL-3/ZAL-5. | Story planner | proposed |

## Appendix

Fresh-manager command contract:

- “Continue” means: open this spine, assume Zenod Alpha delivery-manager role, reconcile linked issues/PRs/current `main`, and execute the single `Next action` without changing product gates.
- “Work on ZAL-N” means: bind one ticket worker to that linked issue using its recorded branch/base/reads/acceptance/handoff; remain the spine steward and delivery manager.
- “What are we working on?” means: report Current State, active issue owners, blockers, human gates, and the next dispatchable item from this spine only.
