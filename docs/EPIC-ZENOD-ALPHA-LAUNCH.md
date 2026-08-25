# EPIC: Zenod Alpha Launch

Status: active
Created: 2026-08-16
Updated: 2026-08-25
Repository: `zenod-ai/zenod`
Primary document: `docs/EPIC-ZENOD-ALPHA-LAUNCH.md`
GitHub issues: `https://github.com/zenod-ai/zenod/issues`
Integration branch: `main`
Active spine steward: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)
Steward since: 2026-08-16 17:07 CEST
Last reconciled commit: `963b7cf` plus current spine working tree
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

Phase: final Zenod hosted/open-source product, portal, operator console, and two-service topology at Jordi sign-off
Last verified: 2026-08-25 CEST
Integration target: `main`
Fresh base commit: `963b7cf` on `main`
Next action: Jordi reviews the final revision of `docs/evidence/zenod-whatsapp-public-beta-2026-08-25/index.html` and approves or revises the complete beta product: €9/month plus VAT, managed AI usage included without a customer-visible dollar entitlement, hosted WhatsApp through the existing hidden Phylax service, open-source Telegram without the managed WhatsApp card, one capability-driven UI codebase, and a protected Zenod operator console. After sign-off, the delivery manager creates the smallest dependency-ordered implementation batch.
Blockers: only final product sign-off remains. The artifact now states that “Zenod Channels” is the current Phylax runtime/service/volume/session—not new infrastructure; customers see usage percentage/state/reset only; provider names, raw units, costs, caps, models, and keys are operator-only; hosted and open source share UI code but expose different capabilities. Production mutation, live billing drill, signup opening, WhatsApp-session change, and external promotion remain separate later approvals.

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
| 9 | `docs/evidence/zenod-whatsapp-public-beta-2026-08-25/index.html` | Current 48-hour WhatsApp audit, deployed topology, Zenod-only packaging recommendation, UI mockups, final code iteration, and production plan. | Planner / ZAL-3 / ZAL-4 |

## Architecture And Context

Current `main` already contains the production-readiness implementation merged through PRs #1053–#1057. It adds fail-closed public signup, recurring billing/customer portal handling, accurate hosted/legal disclosures, atomic customer persistence, security headers, dependency remediation, and a Swarm-safe cold backup/isolated restore runbook. This is code readiness, not proof that the production gates have been executed.

The core memory wedge is also real: WhatsApp voice notes are captured, transcribed, immutably anchored, structurally searchable newest-first, and exactly retrievable by evidence ref. July/August evidence proves those primitives. The 2026-08-15 report says a broader recent-conversation answer was still wrong, so alpha acceptance must test the synthesized conversation experience, not only the storage primitives.

The 2026-08-25 production audit found a product/runtime split that explains recent weirdness: the live Zenod number sends voice and media directly from Phylax to Zenod, while ordinary text is bound to `chat_with_ring` and passes through Ring's generic router/reply gate. Jordi clarified the intended product boundary: customers buy and use Zenod only; WhatsApp is a Zenod access channel; Phylax is an internal transport implementation detail; Ring is a separate product and is not in the Zenod phone path. The approval artifact recommends retaining separate internal Zenod/channel containers for failure isolation while presenting one Zenod account, UI, subscription, and activation journey.

The repository's global issue list is not the alpha board. It contains many historical, superseded, blocked, or test-only issues. Only the issues linked in this spine's active Issue Ledger are dispatchable by the Zenod Alpha delivery manager.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-08-16 | Make trustworthy alpha launch the immediate milestone. | The working memory loop should reach real users before the larger execution product expands scope. | `docs/EPIC-0-FOUNDATION-SPINE.md` and `^e-063285` |
| 2026-08-16 | Treat this child spine's linked issue ledger as the only active alpha dispatch board. | The repository-wide open issue list is too stale and heterogeneous for safe automatic selection. | GitHub issue reconciliation on 2026-08-16 |
| 2026-08-16 | Dispatch ZAL-1 and ZAL-2 as the first parallel batch. | One establishes current launch truth; the other resolves the known trust regression. Their initial file surfaces and acceptance are independent. | Issue contracts below |
| 2026-08-16 | Keep store-only alpha launch separate from the proposed store+execute product epic. | Stored transcript content cannot become implicit repo mutation authority, and the larger UX/pricing/authority design should not delay the core memory launch. | `^e-5c1e43` and Foundation decision log |
| 2026-08-16 | Keep public paid signup fail-closed until production evidence and approval are current. | Merged code is not deployed/operational proof; billing, restore, legal profile, and real-card journeys carry production risk. | `docs/PRODUCTION-READINESS.md` |
| 2026-08-20 | Require unit economics and an explicit usage contract before Jordi chooses the alpha offer. | A price without included workload, limit behavior, model-cost exposure, or a BYOK alternative is not a complete or safely promotable contract. | [#1069](https://github.com/zenod-ai/zenod/issues/1069) and Jordi's 2026-08-20 direction |
| 2026-08-25 | Package WhatsApp as Zenod access, not as a separate Phylax product; exclude Ring from the Zenod phone path. | The simple product is one memory agent on every channel. Separate customer products, credentials, tool bindings, and generic multi-agent routing create onboarding complexity and false/misleading replies. The channel runtime may remain a separate internal container for operational isolation. | Jordi's 2026-08-25 direction and `docs/evidence/zenod-whatsapp-public-beta-2026-08-25/index.html` |
| 2026-08-25 | Approve the Zenod product boundary: hosted includes WhatsApp; Phylax is completely hidden; Ring is absent; MCP remains a customer-facing connection surface. | Customers buy one memory product and may use WhatsApp or connect the same tenant memory to their own MCP harness. Internal service boundaries must not become customer setup work. | Jordi's review of the 2026-08-25 HTML artifact |
| 2026-08-25 | “Zenod Channels” is the existing Phylax service in a hidden operational role, not a new service or rewrite. | Preserve the current Phylax code, container/service, persistent volume, WhatsApp session, journal, retries, and owner pairing controls. Only its separate customer-product surface disappears; Zenod's Channels tab calls it privately. | Jordi's final-iteration clarification and repository/runtime audit |
| 2026-08-25 | Hide provider economics from hosted customers; expose only included-usage percentage, state, and reset. | The €9 product includes managed usage. OpenRouter, models, raw tokens/audio minutes, dollar spend, and the adjustable internal cap belong in the protected owner console, not the customer contract or portal. | Jordi's final-iteration clarification |
| 2026-08-25 | Hosted and open-source Zenod share one runtime and web-UI codebase with explicit capabilities. | Hosted exposes managed AI, billing, percentage-only usage, Telegram, and WhatsApp. Self-host exposes local setup, provider/model controls, raw diagnostic usage, and Telegram, while hiding the managed WhatsApp activation journey. | Current customer-auth/setup-wizard code plus Jordi's product direction |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#1058](https://github.com/zenod-ai/zenod/issues/1058) | Ticket worker | ZAL-1-readiness-audit-worker | ZAL-1 · Reconcile alpha-launch truth and readiness matrix | done | - | [merged PR #1066](https://github.com/zenod-ai/zenod/pull/1066) / `main` | `7454715` | Evidence matrix and smallest ordered backlog are committed; no production mutation. | [Terminal handoff](https://github.com/zenod-ai/zenod/issues/1058#issuecomment-5309945858); artifact `601d3a6`; CI green; merged as `e478965`; issue closed. | 2026-08-17 00:37 CEST | None. |
| [#1059](https://github.com/zenod-ai/zenod/issues/1059) | Ticket worker | ZAL-2-recent-recap-worker | ZAL-2 · Reproduce and repair the incorrect recent-conversation recap | testing / acceptance superseded for Zenod phone | approved direct Zenod deployment/replay | [merged PR #1067](https://github.com/zenod-ai/zenod/pull/1067) / `main` | `7454715` | Exact interaction is reproduced and fixed with regression, or current pass is proved with full trace; no production deploy. | [Manager review](https://github.com/zenod-ai/zenod/issues/1059#issuecomment-5310028378); exact evidence and Ring-side fix `8811326`; 2026-08-25 decision removes Ring from the Zenod phone acceptance path. | 2026-08-25 CEST | Preserve the merged Ring fix for Ring; close Zenod acceptance with a direct Phylax-to-Zenod replay on the version-coherent candidate. |
| [#1060](https://github.com/zenod-ai/zenod/issues/1060) | Planner | ZAL-3-offer-decision-planner | ZAL-3 · Frame the alpha offer and WhatsApp boundary for decision | final product sign-off | Jordi approves or revises the complete €9 Zenod beta product | [merged PR #1068](https://github.com/zenod-ai/zenod/pull/1068) plus [ZAL-3E PR #1071](https://github.com/zenod-ai/zenod/pull/1071) / `main` | `0bb5b3d` | Truthful offer, usage economics, Zenod-only WhatsApp boundary, customer journey, editions, operator surface, and exact Jordi decision are recorded. | Final artifact makes Phylax identity explicit, hides dollar economics from customers, adds the owner console, and maps the hosted/self-host capability split on one UI codebase. | 2026-08-25 CEST | Jordi signs off the final artifact or names one remaining product assumption to revise. |
| [#1069](https://github.com/zenod-ai/zenod/issues/1069) | Ticket worker / analyst | ZAL-3E-unit-economics-worker | ZAL-3E · Define alpha usage limits, BYOK pricing, and unit economics | done | current provider/payment/hosting evidence | [merged PR #1071](https://github.com/zenod-ai/zenod/pull/1071) / `main` | `130a2720` | Reproducible margin and break-even analysis defines platform-funded and BYOK prices, included usage, limit behavior, sensitivity, and one recommendation without changing live systems. | [Manager acceptance](https://github.com/zenod-ai/zenod/issues/1069#issuecomment-5358203918); artifact `d4dfc18`; CI green; merged as `131b80c`; issue closed. | 2026-08-20 17:41 CEST | None; consume through #1060 human gate. |
| [#1061](https://github.com/zenod-ai/zenod/issues/1061) | Epic worker / operator | unassigned | ZAL-4 · Execute the fail-closed production-readiness gate | blocked | [#1058](https://github.com/zenod-ai/zenod/issues/1058), [#1059](https://github.com/zenod-ai/zenod/issues/1059), [#1060](https://github.com/zenod-ai/zenod/issues/1060), [#1069](https://github.com/zenod-ai/zenod/issues/1069), production approval | `codex/zal-4-production-gate` | `1a39166` | Every runbook check has current evidence; signup remains closed until exact approval, then opens and verifies or rolls back safely. | `docs/PRODUCTION-READINESS.md`; public signup disabled pending evidence. | 2026-08-20 17:12 CEST | Prepare read-only packet; wait for approved priced usage contract and exact production/real-card/signup approval. |
| [#1062](https://github.com/zenod-ai/zenod/issues/1062) | Tester | unassigned | ZAL-5 · Stranger alpha onboarding and memory acceptance | waiting | [#1061](https://github.com/zenod-ai/zenod/issues/1061) | `codex/zal-5-stranger-acceptance` | `1a39166` | One uninterrupted public-page → onboarding → MCP memory journey passes on the named deployed SHA; approved WhatsApp promise is included if applicable. | Existing founder/live component evidence only. | 2026-08-16 17:07 CEST | Dispatch after production gate passes. |
| [#1063](https://github.com/zenod-ai/zenod/issues/1063) | Planner / outbound drafter | unassigned | ZAL-6 · Draft the first proof-led alpha invitation | waiting | [#1060](https://github.com/zenod-ai/zenod/issues/1060), [#1069](https://github.com/zenod-ai/zenod/issues/1069); may run beside [#1061](https://github.com/zenod-ai/zenod/issues/1061) | `codex/zal-6-alpha-invitation` | `1a39166` | Exact Reddit/X options and landing target match proved capabilities; nothing is published. | Promotion requested in `^e-5c1e43`. | 2026-08-20 17:12 CEST | Draft only after the priced offer is approved; request exact-content approval before posting. |

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
| Final Zenod beta product | Jordi | Product boundary, editions, UI, operator surface, deployment, and economics are explicit | Reply `APPROVE FINAL ZENOD BETA PRODUCT` to approve one €9/month plus VAT hosted plan with managed AI usage and WhatsApp included; customer usage shown only as percentage/state/reset; hidden adjustable operator caps with no overage and queued raw evidence at the limit; existing Phylax retained privately as Zenod's channel runtime; Ring absent; MCP first-class; free open source with self-managed provider controls and supported Telegram but no managed WhatsApp card; no alpha annual plan. Or name one assumption to revise. | Read-only checks, local validation, and draft-only prep. |
| Production deployment and configuration | Jordi | ZAL-4 preflight ready | Approve exact immutable image, Dokploy target, redacted env-key change set, and rollback plan. | Read-only checks and local validation. |
| Live billing drill | Jordi | Closed signup deploy is healthy | Approve one exact real-card drill at the approved hosted-beta price and intended refund/cancellation handling. | Non-financial readiness checks. |
| Open public signup | Jordi | All production evidence is current | Approve setting `ZENOD_PUBLIC_PAID_SIGNUP=1` on the named SHA/environment. | Closed alpha testing. |
| External promotion | Jordi | ZAL-6 exact draft and target ready | Approve the exact final text and destination. | Research and drafts only. |

## Recovery And Takeover

Stale assignment policy: verify issue, branch, PR, latest commit, evidence, blocker, and next action before takeover; preserve old history and record the new identity/base.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| [#1058](https://github.com/zenod-ai/zenod/issues/1058) | ZAL-1-readiness-audit-worker processes interrupted by transport | ZAL-1-readiness-audit-worker / resume-main process | `7454715` | Partial read-only checkpoint only; independently reverify. | 2026-08-16 23:56 CEST |
| [#1059](https://github.com/zenod-ai/zenod/issues/1059) | ZAL-2-recent-recap-worker processes interrupted by transport | ZAL-2-recent-recap-worker / resume-main process | `7454715` | Partial read-only checkpoint only; exact bad answer/replay/fix still unverified. | 2026-08-16 23:56 CEST |

## Planner Queue

- Present the final 2026-08-25 product/deployment/portal/operator/edition artifact; preserve the single final-product sign-off gate.
- After approval, create the smallest dependency-ordered final-iteration batch for Zenod-integrated channel UI/onboarding, automatic private tenant binding, direct Zenod routing, the audited reliability remediations, managed credential/allowance enforcement, and version-coherent acceptance.
- Keep ZAL-4 fail-closed until every named production approval is explicit.
- Draft the separate voice-note-to-Codex child epic after the alpha offer is accepted; it is not part of this board.

## Worker Queue

- No ticket worker is active while the complete Zenod beta product awaits Jordi's final sign-off or revision.
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
| 2026-08-20 | ZAL-3E usage, BYOK, and unit economics | `d4dfc18` merged as `131b80c` | Repository, redacted aggregate live production state, and current primary-source provider/payment/hosting prices | Independent repo/live and market-cost audits; reproducible Node model; invariant/link/diff checks; PR CI; manager review | pass for analysis acceptance; exact economics contract awaits Jordi approval; managed inference remains implementation-blocked | `docs/evidence/zenod-alpha-unit-economics-2026-08-20/README.md`; [PR #1071](https://github.com/zenod-ai/zenod/pull/1071) |
| 2026-08-25 | Zenod WhatsApp audit and final public-beta product/deployment proposal | working tree from `963b7cf` | Production Phylax/Ring/Zenod read-only stores and service metadata; repository customer/admin/edition code; OpenRouter primary pricing; standalone HTML | Reconciled 10 interactions; live bindings; current three/proposed two services; Phylax identity; hosted/self-host UI seam; owner-only admin boundary; tenant usage/voice cost; rendered portal/operator mockups | final product packet ready for Jordi sign-off; no production, billing, session, signup, or route mutation | `docs/evidence/zenod-whatsapp-public-beta-2026-08-25/index.html` |
| 2026-08-01 | Typed recent-memory retrieval | `d4eaac4` deployed at time of proof | Zenod MT MCP | newest-first structural `search_memory` plus exact evidence-ref `get_memory` | pass | `docs/evidence/generic-entry-retrieval-2026-08-01/` |
| 2026-08-16 | Child spine structure | working tree from `1a39166` | local | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-ZENOD-ALPHA-LAUNCH.md` | pending final issue links | this file |

## Handoff Journal

### 2026-08-25 - Epic worker - Final Phylax identity, editions, hidden usage, and owner console revision

Context: Jordi clarified the remaining product seams. “Zenod Channels” must not become a new service: it is exactly the current Phylax runtime, service/container, persistent volume, WhatsApp session, journal, retries, and owner pairing boundary, with its separate customer-product UI removed and its tenant activation controls presented inside Zenod. Hosted customers paying €9 see only included-usage percentage, state, and reset; OpenRouter, model routing, raw tokens/audio minutes, dollars, and the adjustable internal cap are operator-only. Hosted and open source reuse one Zenod runtime/UI codebase with explicit capabilities: hosted has GitHub/Stripe, managed AI, percentage-only usage, Telegram, WhatsApp, and Account; self-host has local setup, customer-owned provider/model controls, raw diagnostics, Telegram, and no managed WhatsApp activation. Repository review confirms the current web app already switches between GitHub customer-auth and the local setup wizard; customer usage currently exposes provider dollars and therefore needs a hosted presentation layer; Phylax already protects its pairing screen at owner-only `/admin`; OpenRouter child-key listing/metering and a manual capped-key script exist but automatic checkout provisioning and the unified owner console remain implementation work.

Next: Jordi signs off the complete artifact with `APPROVE FINAL ZENOD BETA PRODUCT` or names one remaining assumption. The delivery manager then creates the smallest implementation batch for capability-driven portal presentation, Zenod Channels UI/private Phylax API, direct Zenod routing, managed key/cap automation, protected owner console, audited reliability fixes, and version-coherent acceptance. Production and commercial action gates remain closed.

Risks: the internal $2 launch default remains based on founder usage and must be adjustable/reconciled; it is not customer-facing entitlement copy. The existing Phylax full-customer unit must be reduced carefully without resetting the live session or deleting its data/diagnostics. Hosted raw-cost hiding must not reduce operator observability or self-host diagnostics. The shared WhatsApp Web transport remains capped-beta infrastructure.

Assignment identity: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: `main` at `963b7cf`; final artifact and spine revision in current working tree

Last verified: 2026-08-25 CEST

### 2026-08-25 - Epic worker - Product boundary approved; usage and literal VPS/portal packet revised

Context: Jordi accepted the simple product direction: hosted Zenod includes WhatsApp; Phylax is completely hidden and may be commercialized separately later; Ring is absent from Zenod; MCP remains fundamental and the hosted portal must show ready-to-copy client connection details. Read-only production evidence showed the prior calendar week used 55,734 recorded LLM token units over six calls for a $0.044 ledger estimate. The rolling seven days used 215,309 LLM token units over 20 calls for $0.180, plus one 50.54-minute Voxtral transcription at OpenRouter's published $0.003/minute, for about $0.332 total or a $1.44 monthly pace. Current OpenRouter pricing independently reconciles the LLM ledger within about one percent. The artifact now distinguishes access versus billable tokens, proposes a shared $2/month hosted allowance, maps the existing portal, adds complete MCP/channels/settings mockups, and states the literal current three-service versus proposed two-service VPS topology. Both public Zenod hosts currently resolve to the same Zenod MT service/SHA; active LLM and transcription inference run at OpenRouter, not on the VPS.

Next: Jordi approves or revises the proposed €9/month plus VAT and shared $2/month provider allowance. Once approved, the delivery manager creates the smallest dependency-ordered final-iteration issue batch. Production, billing, session, signup, and publication gates remain closed.

Risks: the $2 allowance is based on one founder trace, not a customer distribution. The hard-cap design must preserve/queue raw evidence rather than lose captures. ChatGPT subscriptions cannot fund API calls under current OpenAI billing; hosted Zenod therefore needs its managed provider account for launch. The current shared-number WhatsApp Web adapter remains capped-beta infrastructure, not an uncapped SLA surface.

Assignment identity: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: `main` at `b8cae8c`; revised artifact and spine in current working tree

Last verified: 2026-08-25 CEST

### 2026-08-25 - Epic worker - Zenod-only WhatsApp product and final-iteration proposal ready

Context: Jordi clarified that the sellable product is Zenod alone. WhatsApp is access to Zenod, not a separate Phylax product; the current Phylax runtime may remain as a hidden operational container; Ring is a separate legacy/multi-agent product and is excluded from the Zenod phone path. A read-only 48-hour production audit found 10 inbound WhatsApp messages, six affected by failures or misleading results, and confirmed the live split binding: voice/media direct to Zenod, text to Ring. The durable HTML artifact records current/proposed deployment, customer journeys, UI mockups, one recommended package, the final code iteration, remediation list, DevOps sequence, rollback, and release acceptance.

Next: Jordi approves the recommended Zenod Hosted beta package or names the price, included-channel, managed/BYOK, open-source support, provider/capacity, or onboarding assumption to revise. After approval, create and dispatch the smallest dependency-ordered final-iteration issue batch. Do not deploy, mutate the WhatsApp session, charge, open signup, delete legacy functionality, or publish before its separate named gate.

Risks: the recommended €9 price includes WhatsApp but the earlier economics excluded speech-to-text, so its final allowance/cap must be recalculated before checkout implementation. The current shared-number transport is an unofficial WhatsApp Web adapter and is suitable only for a capped beta with no uptime SLA; uncapped/general availability should use the official Meta Cloud API behind the same internal seam. Existing live images are not version-coherent.

Assignment identity: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: `main` at `7a6efbc`; artifact and spine in current working tree

Last verified: 2026-08-25 CEST

### 2026-08-20 - Epic worker - ZAL-3E accepted; exact economics contract at human gate

Context: ZAL-3E reconciled the implemented BYOK path, absence of live managed funding/caps, one redacted 30-day founder usage trace, current OpenRouter/Stripe/Hetzner assumptions, and a reproducible sensitivity model. Independent audits and manager review found no blocker; PR #1071 passed CI and merged as `131b80c`. The recommended contract is managed €5/month or €50/year plus applicable VAT with a locked model set, $0.50 monthly provider cap, 80% warning, 100% hard stop, UTC reset, and no overage/fallback; BYOK is €4/month plus VAT with no included AI spend and no alpha annual plan.

Next: Jordi replies `APPROVE ECONOMICS CONTRACT` or names the price, allowance, tax treatment, infrastructure allocation, or support assumption to revise. Approval authorizes creation/dispatch of implementation tickets and offer-copy preparation only; it does not authorize credentials, Stripe mutation, deployment, publication, or signup.

Risks: production today is BYOK-capable but not managed-inference-capable. The one usage trace is founder dogfood, not a customer distribution, and excludes speech-to-text. The base model retains only about €1.13/month managed contribution at cap, €0.55 annual-equivalent, and €0.62 BYOK after €1 allocated infrastructure and €2 support; average support beyond roughly five to seven minutes removes margin.

Assignment identity: Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: ZAL-3E `d4dfc18`; integrated `main` `131b80c`; steward branch `codex/alpha-economics-decision-gate`

Last verified: 2026-08-20 17:41 CEST

Links:

- https://github.com/zenod-ai/zenod/pull/1071
- https://github.com/zenod-ai/zenod/issues/1069#issuecomment-5358203918
- `docs/evidence/zenod-alpha-unit-economics-2026-08-20/README.md`

### 2026-08-20 - Epic worker - ZAL-3E economics prerequisite dispatched

Context: Jordi rejected a price-only offer choice and required evidence for what €5/month or €50/year includes, the usage limit and limit behavior, margin across usage levels, and a separately priced customer-supplied model-credential path. The delivery manager created [#1069](https://github.com/zenod-ai/zenod/issues/1069), bound one ticket worker to an isolated branch/worktree from exact `main` `130a2720`, and dispatched independent repository/production and primary-source cost checks. The original ZAL-3 A/B/C gate is superseded until this evidence is reconciled.

Next: review #1069's reproducible artifact and assumptions, reconcile any blocking findings, then restate one exact platform-funded and BYOK offer for Jordi's decision. Do not change public prices, Stripe, production, signup, credentials, or customer data during the analysis.

Risks: the repository has per-provider key settings and usage ledgers, but customer-facing hosted BYOK availability, current hard-cap enforcement, true production usage distribution, tax treatment, payment fees, and shared-infrastructure allocation must be proved rather than inferred. Consumer AI subscriptions must not be represented as API billing unless a provider officially supports that use.

Assignment identity: Zenod Alpha delivery manager (`Jordi + current bound Codex task`); ZAL-3E-unit-economics-worker

Branch / latest commit: steward `codex/alpha-launch-economics-control`; worker `codex/zal-3e-unit-economics` from `130a2720`

Last verified: 2026-08-20 17:12 CEST

Links:

- https://github.com/zenod-ai/zenod/issues/1069
- `docs/evidence/zenod-alpha-offer-decision-2026-08-17/README.md`

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

- Is the complete Zenod beta product approved: €9/month plus VAT; managed AI usage included and shown to customers only as percentage/state/reset; hidden adjustable operator cap with queued raw evidence/no overage; hosted WhatsApp through the existing private Phylax service; Ring absent; MCP first-class; one capability-driven UI codebase; and free self-host with provider controls plus supported Telegram but no managed WhatsApp activation card? Owner: Jordi. Needed by: ZAL-3 final sign-off.
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
