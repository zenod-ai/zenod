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

Phase: offer decision packet integrated; blocked on Jordi's exact contract choice
Last verified: 2026-08-17 00:55 CEST
Integration target: `main`
Fresh base commit: `e091eb2a9153eee50165f7a888ec51c8346dab1e` on `main`
Next action: Jordi replies `APPROVE A`, `APPROVE B`, or `APPROVE C` using the integrated ZAL-3 definitions; the delivery manager then closes ZAL-3 and shapes ZAL-4/ZAL-5/ZAL-6 to that exact contract.
Blockers: the exact first-alpha offer/WhatsApp contract requires Jordi's choice. Production mutation, live billing drill, signup opening, any WhatsApp-session change, and external promotion remain separate later approvals.

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
| [#1058](https://github.com/zenod-ai/zenod/issues/1058) | Ticket worker | ZAL-1-readiness-audit-worker | ZAL-1 · Reconcile alpha-launch truth and readiness matrix | done | - | [merged PR #1066](https://github.com/zenod-ai/zenod/pull/1066) / `main` | `7454715` | Evidence matrix and smallest ordered backlog are committed; no production mutation. | [Terminal handoff](https://github.com/zenod-ai/zenod/issues/1058#issuecomment-5309945858); artifact `601d3a6`; CI green; merged as `e478965`; issue closed. | 2026-08-17 00:37 CEST | None. |
| [#1059](https://github.com/zenod-ai/zenod/issues/1059) | Ticket worker | ZAL-2-recent-recap-worker | ZAL-2 · Reproduce and repair the incorrect recent-conversation recap | testing | approved Ring deployment/replay | [merged PR #1067](https://github.com/zenod-ai/zenod/pull/1067) / `main` | `7454715` | Exact interaction is reproduced and fixed with regression, or current pass is proved with full trace; no production deploy. | [Manager review](https://github.com/zenod-ai/zenod/issues/1059#issuecomment-5310028378); exact evidence and fix `8811326`; CI/review green; merged as `0bb5b3d`. | 2026-08-17 00:37 CEST | Under ZAL-4 approval, deploy named Ring image and replay exact trace before closing. |
| [#1060](https://github.com/zenod-ai/zenod/issues/1060) | Planner | ZAL-3-offer-decision-planner | ZAL-3 · Frame the alpha offer and WhatsApp boundary for decision | decision-ready / human gate | Jordi contract choice | [merged PR #1068](https://github.com/zenod-ai/zenod/pull/1068) / `main` | `0bb5b3d` | 2–3 truthful options, recommendation, promise matrix, and exact Jordi decision are recorded. | [Manager acceptance](https://github.com/zenod-ai/zenod/issues/1060#issuecomment-5310093149); artifact `5d7dbd4`; CI green; merged as `e091eb2`. | 2026-08-17 00:55 CEST | Jordi replies `APPROVE A`, `APPROVE B`, or `APPROVE C`; then reconcile downstream scope. |
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
| [#1058](https://github.com/zenod-ai/zenod/issues/1058) | ZAL-1-readiness-audit-worker processes interrupted by transport | ZAL-1-readiness-audit-worker / resume-main process | `7454715` | Partial read-only checkpoint only; independently reverify. | 2026-08-16 23:56 CEST |
| [#1059](https://github.com/zenod-ai/zenod/issues/1059) | ZAL-2-recent-recap-worker processes interrupted by transport | ZAL-2-recent-recap-worker / resume-main process | `7454715` | Partial read-only checkpoint only; exact bad answer/replay/fix still unverified. | 2026-08-16 23:56 CEST |

## Planner Queue

- Dispatch ZAL-1 and ZAL-2 as the only initial parallel batch.
- Reconcile their GitHub handoffs into Current State, Issue Ledger, Validation Evidence, and Handoff Journal.
- Present the ZAL-3 decision packet to Jordi; do not let a worker silently decide the launch promise.
- Keep ZAL-4 fail-closed until every named production approval is explicit.
- Draft the separate voice-note-to-Codex child epic after the alpha offer is accepted; it is not part of this board.

## Worker Queue

- ZAL-1 and ZAL-2 remain the only batch; both stable assignments are active in refreshed isolated worktrees.
- ZAL-4 may prepare a read-only preflight packet while blocked, but may not deploy, charge, or open signup.

## Tester Queue

- ZAL-2 pins the reported recap failure before alpha acceptance.
- ZAL-5 owns the final stranger journey on one exact deployed SHA.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-08-16 | Production-readiness implementation | `1a39166` | GitHub `main` | PRs #1053–#1057; repository runbook and merged test evidence | code-ready; operational gate pending | `docs/PRODUCTION-READINESS.md` |
| 2026-08-17 | ZAL-1 alpha readiness truth audit | `601d3a6` merged as `e478965` | Repository, public edge, and read-only VPS/Docker metadata | Direct surface checks, backup metadata, focused suites, link/diff/secret checks, and PR CI | pass for audit acceptance; launch remains gated 10/13 | `docs/evidence/zenod-alpha-readiness-2026-08-16/README.md`; [PR #1066](https://github.com/zenod-ai/zenod/pull/1066) |
| 2026-08-17 | ZAL-2 recap failure boundary and branch fix | `8811326` merged as `0bb5b3d` | Preserved Ring audit state, deployed replay, live Zenod reads, local/CI | Exact interaction recovery, isolated replay, vault immutability, structural refs, focused 17/17, full 904-server suite, typecheck, reviewer | pass for integration; post-deploy model behavior remains testing | `docs/evidence/zal-2-recent-recap-2026-08-17/README.md`; [PR #1067](https://github.com/zenod-ai/zenod/pull/1067) |
| 2026-08-17 | ZAL-3 first-alpha offer decision packet | `5d7dbd4` merged as `e091eb2` | Repository and rechecked public promise/status surfaces | Three exact contracts, promise matrix, one recommendation, safe-work boundary, exact Jordi choice, link/diff checks, PR CI | decision-ready; no option approved | `docs/evidence/zenod-alpha-offer-decision-2026-08-17/README.md`; [PR #1068](https://github.com/zenod-ai/zenod/pull/1068) |
| 2026-08-01 | Typed recent-memory retrieval | `d4eaac4` deployed at time of proof | Zenod MT MCP | newest-first structural `search_memory` plus exact evidence-ref `get_memory` | pass | `docs/evidence/generic-entry-retrieval-2026-08-01/` |
| 2026-08-16 | Child spine structure | working tree from `1a39166` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-ZENOD-ALPHA-LAUNCH.md` | pending final issue links | this file |

## Handoff Journal

### 2026-08-17 - Epic worker - ZAL-3 decision packet integrated; human gate reached

Context: ZAL-3 reconciled the accepted readiness and recap evidence into three exact first-alpha contracts and recommended Option A. The manager verified that the packet preserves Jordi's decision authority and all later action-specific gates. PR #1068 passed CI and merged as `e091eb2`; no offer was approved by the merge.

Next: Jordi replies exactly `APPROVE A`, `APPROVE B`, or `APPROVE C` as defined in `docs/evidence/zenod-alpha-offer-decision-2026-08-17/README.md`. Any mixed or modified contract must be restated before downstream work treats it as accepted.

Risks: Option A still requires the Zenod production gate and stranger journey; Option B changes the critical path to unproved clean-host self-host onboarding; Option C expands the launch to coordinated Zenod/Ring/Phylax proof and manual WhatsApp capacity. No deploy, billing, signup, session, or publication gate is approved.

Assignment identity: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: ZAL-3 `5d7dbd4`; integrated `main` `e091eb2`; steward branch `codex/alpha-launch-resume`

Last verified: 2026-08-17 00:55 CEST

Links:

- https://github.com/zenod-ai/zenod/pull/1068
- https://github.com/zenod-ai/zenod/issues/1060#issuecomment-5310076257
- https://github.com/zenod-ai/zenod/issues/1060#issuecomment-5310093149
- `docs/evidence/zenod-alpha-offer-decision-2026-08-17/README.md`

### 2026-08-17 - Epic worker - ZAL-2 repair integrated; live replay retained

Context: ZAL-2 recovered the exact bad interaction, reproduced it on the named deployed Ring/Zenod/Phylax SHAs, proved direct Zenod structural recall and unchanged vault state, and added a narrow Ring grounding contract plus catalog regression. The manager reran focused tests and an independent reviewer found no blocker. PR #1067 merged as `0bb5b3d`.

Next: dispatch ZAL-3 from the accepted readiness matrix. Keep #1059 open in `testing`; ZAL-4's approved deployment/test packet must replay the exact prompt and prove `search_memory` → exact `get_memory`, expected citations/grounded answer, no mutation-status prose, and unchanged vault HEAD before closure.

Risks: prompt and catalog tests do not deterministically prove deployed model tool selection. No production deploy was authorized or performed. The alpha offer and WhatsApp boundary still require Jordi's decision before ZAL-4 execution.

Assignment identity: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: ZAL-2 `8811326`; integrated `main` `0bb5b3d`; steward branch `codex/alpha-launch-resume`

Last verified: 2026-08-17 00:37 CEST

Links:

- https://github.com/zenod-ai/zenod/pull/1067
- https://github.com/zenod-ai/zenod/issues/1059#issuecomment-5309964822
- https://github.com/zenod-ai/zenod/issues/1059#issuecomment-5310028378
- `docs/evidence/zal-2-recent-recap-2026-08-17/README.md`

### 2026-08-17 - Epic worker - ZAL-1 readiness audit accepted and integrated

Context: The delivery manager independently reviewed the complete readiness artifact and terminal issue handoff. PR #1066 was mergeable with green CI and merged to `main` as `e478965`. The accepted matrix proves production Zenod `7365dbc`, fail-closed readiness at 10/13, and the exact operational gaps without treating merged code as live proof.

Next: finish and review ZAL-2. Once the recap fix is integrated, dispatch ZAL-3 using the accepted matrix, including the unverified rollback digest/availability, missing linked restore/off-host-copy proof, three readiness failures, and live authenticated/isolation evidence gaps.

Risks: launch is not accepted. `legal_version`, `stripe_profile`, and `live_billing_journey` remain red; rollback availability is unknown; current live authenticated memory/two-tenant proof remains pending; all human gates remain closed.

Assignment identity: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: ZAL-1 `601d3a6`; integrated `main` `e478965`; steward branch `codex/alpha-launch-resume`

Last verified: 2026-08-17 00:17 CEST

Links:

- https://github.com/zenod-ai/zenod/pull/1066
- https://github.com/zenod-ai/zenod/issues/1058#issuecomment-5309945858
- `docs/evidence/zenod-alpha-readiness-2026-08-16/README.md`

### 2026-08-16 - Epic worker - Control plane merged and stable assignments resumed

Context: PR #1064 passed CI and merged to `main` as `7454715`. The manager fast-forwarded both clean dedicated worker branches to that exact commit, pushed them, updated the bound issues from blocked to active, and launched fresh processes under the existing stable assignment identities. Earlier checkpoints remain evidence leads, not accepted proof.

Next: review and reconcile the terminal ZAL-1/ZAL-2 issue and PR handoffs. Do not advance ZAL-3 or ZAL-4 until their dependencies are satisfied.

Risks: sub-agent transport previously disconnected repeatedly. If it recurs, preserve any new branch/issue evidence and name the exact latest commit instead of resetting the assignments. Human production and public-promise gates are unchanged.

Assignment identity: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: `codex/alpha-launch-resume` from `7454715`; worker branches start at `7454715`

Last verified: 2026-08-16 23:56 CEST

Links:

- https://github.com/zenod-ai/zenod/pull/1064
- https://github.com/zenod-ai/zenod/issues/1058#issuecomment-5309874908
- https://github.com/zenod-ai/zenod/issues/1059#issuecomment-5309875002

### 2026-08-16 - Epic worker - First batch runtime-blocked after three attempts

Context: Both stable ticket assignments were launched in isolated worktrees. The initial processes and one same-process retry disconnected before substantive progress. Fresh takeover processes completed required reads and useful read-only investigation checkpoints, then also disconnected before writing, committing, opening PRs, or completing acceptance. The manager verified both worktrees remain clean at `f1c5949` and recorded the partial checkpoints in the bound issues.

Next: when the Codex sub-agent transport is available, bind fresh processes to the existing ZAL-1/ZAL-2 assignment identities and worktrees. Consume and independently recheck the issue checkpoints, then complete their original acceptance and terminal handoffs. Do not dispatch ZAL-3 or ZAL-4 first.

Risks: ZAL-1's production/readiness observations are worker-reported and not yet converted into a validated artifact. ZAL-2 has not recovered the exact bad answer, completed the controlled replay, proved read-side immutability, or established a regression/fix boundary. No issue PR exists.

Assignment identity: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: `codex/alpha-launch-control` at `dee9c7e` plus this blocker reconciliation; worker branches clean at `f1c5949`

Last verified: 2026-08-16 23:42 CEST

Links:

- https://github.com/zenod-ai/zenod/issues/1058#issuecomment-5309823141
- https://github.com/zenod-ai/zenod/issues/1059#issuecomment-5309823218

### 2026-08-16 - Epic worker - First batch dispatched

Context: The user issued the repository-level command “continue.” The delivery manager reconciled the cold-start entrypoint, control-plane PR #1064, linked issue bodies, and the common control-plane base. CI for PR #1064 is green and both ready tickets have been bound to isolated workers.

Next: remain the sole child-spine steward; review and reconcile the terminal handoffs from ZAL-1 and ZAL-2 before advancing any package or production-gated work.

Risks: PR #1064 remains draft and the two workers branch from its exact head, `f1c5949`; their PRs therefore depend on the control-plane context being integrated or carried forward. No production, billing, signup, WhatsApp-session, or external-promotion permission has been granted.

Assignment identity: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: `codex/alpha-launch-control` at `f1c5949` plus this dispatch reconciliation

Last verified: 2026-08-16 17:22 CEST

Links:

- https://github.com/zenod-ai/zenod/pull/1064
- https://github.com/zenod-ai/zenod/issues/1058#issuecomment-5308162752
- https://github.com/zenod-ai/zenod/issues/1059#issuecomment-5308162806

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
