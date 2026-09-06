# EPIC 0 · Foundation Spine — operating behavior and document-centered delivery

Status: active
Created: 2026-07-09
Updated: 2026-08-27
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-0-FOUNDATION-SPINE.md`
Spine ID: Foundation
Spine Type: root
Root spine: self
Parent spine: none
Additional root rationale: n/a
Integration branch: `main`
Active spine steward: Epic 0 Foundation planner (`Jordi + current bound Codex task`)
Steward since: 2026-07-09 19:55 CEST
Last reconciled commit: `73e309adda4d04c5ea58f2ec4dc114143731ed1c` on `main`; the ZAL-22 production receipt remains the deployed rollback/behavior baseline
Planner: Jordi + Codex
Worker: unassigned
Tester: unassigned

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Epic 0 Foundation planner | Foundation/root scope | Steward this root spine, maintain project operating decisions, child-spine map, rollups, and public package state. | Root state reconciled, child work routed, next human decision explicit. |
| Planner | Epic 0 Foundation planner | Foundation rollout | Shape acceptance, backlog, authority rules, and initial dispatch; no implementation by default. | Executable ledger, decisions, and dispatch state. |
| Epic worker | unassigned | Future child-spine retrofit | Act as delivery lead inside accepted child scope and steward that child spine. | Child spine, issue board, integration state, and test handoff current. |
| Ticket worker | unassigned | Future GitHub issue | Execute one dedicated issue branch and write a structured issue handoff. | PR, latest commit, evidence, blocker, and next action in the issue. |
| Tester | unassigned | Future cold-start validation issue | Validate exact commit and bootstrap behavior; write issue evidence. | Commit, environment, pass/fail, residual risk, and steward notification. |

## Write Scope

Bound spine: `docs/EPIC-0-FOUNDATION-SPINE.md`
Active steward: Epic 0 Foundation planner (`Jordi + current bound Codex task`)

Writable by default:

- The active steward reconciles and commits this spine.
- Ticket workers and testers write detailed execution and validation state to their assigned GitHub issue, then notify the steward.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-0-STORY.md` — public story and launch materials.
- `docs/EPIC-2.3-ZENOD-MOVE-0.md` — Zenod product execution.
- `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` — Callisthenes execution.
- `docs/EPIC-2.5-ATOMIC-UNITS.md` — Ring / atomic units execution.
- `docs/EPIC-2.6-HERALD-MOVE-0.md` — Herald execution.
- `docs/EPIC-2.9-EPAMINON-MOVE-0.md` — Epaminon executor-unit execution.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record the outgoing steward, incoming steward, absolute time, current commit, and next action before another agent begins writing this spine.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This Foundation spine | EpicSpine intent, operating decisions, rollout acceptance, and project-level state |
| GitHub issue | Detailed execution state for one rollout ticket |
| Branch / PR / code | The implementation and public skill package that actually exist |
| Validation evidence | What passed or failed for an exact version in a named environment |
| Child spine | Its own implementation state, ticket ledger, local decisions, and acceptance evidence |

## Mission

Set the foundational operating behavior for Zenod's AI-assisted development system: every major body of work has an EpicSpine; agents bootstrap from the document first; GitHub issues are the execution board; workers and testers write back narrowly; parent spines coordinate without mutating child spines by default.

## Definition Of Done

- [x] EpicSpine skill is installed, valid, and documented as the default operating pattern.
- [x] EpicSpine deck exists for onboarding humans and agents to the pattern.
- [x] Write-scope rules are captured: read broadly, write narrowly; cross-spine changes are proposed, not silently applied.
- [x] Planner backlog and parallel dispatch flow is captured in the skill.
- [x] Goal-seeking persistence is captured: workers continue until ready for testing or blocked; testers continue through bounded fix loops or escalate major decisions.
- [x] Public-repo Milestone 0 exists: README lands EpicSpine and a standalone HTML deck explains the root concept.
- [x] Branch/worktree integration discipline is captured: ticket workers isolate work, merge ready-for-test changes to the integration branch frequently, and keep new-agent bases fresh.
- [x] Authority, single-steward, protected integration gates, human gates, and recovery/takeover rules are encoded in the skill and reusable templates.
- [x] A deterministic local spine validator checks the required operating structure.
- [ ] At least one real epic uses the EpicSpine pattern with a bound spine, issue ledger, and handoff journal.
- [ ] GitHub issues exist for any remaining rollout work needed to make this behavior standard.

## Non-Goals

- Rewriting child epic docs directly from this spine.
- Owning public positioning copy; that remains `docs/EPIC-0-STORY.md`.
- Replacing GitHub issues; issues remain the execution board.
- Defining every future agent role in full detail.

## Current State

Phase: Integrated-independent source architecture and phase-1 release packet complete; commercial config approval pending before backup/deploy gates
Last verified: 2026-08-27 23:12 CEST
Integration target: `main`
Fresh base commit: `73e309adda4d04c5ea58f2ec4dc114143731ed1c` on `main`; the signup-closed `a6fbe8f` production candidate remains the current rollback/behavior baseline
Active child spine: `docs/EPIC-P-PHYLAX-SPRINT.md`
Next action: Jordi approves or replaces the recommended allowance/tariff values in the exact #1112 release packet; then request Gate A fresh backups only. Closed deploy, real sends, billing and signup remain separate later gates.
Blockers: no architecture or source blocker is open. Exact production allowance/tariff values are the single current human input. Production backup/deploy, real channel sends, live billing and public signup remain named later gates. Public signup stays closed.

## Spine Map

New release registration (2026-09-06); existing child relationships remain recorded in the Bootstrap Map and child-spine routing table. ZMR has separate user-authorized delivery scope; this registration does not replace the Phylax delivery cursor above.

| Spine ID | Relationship | Spine | Purpose | Status | Health / Blocker | Latest Evidence | Last Rolled Up | Next Action |
|---|---|---|---|---|---|---|---|---|
| ZMR | child | [Memory Reliability](EPIC-ZENOD-MEMORY-RELIABILITY.md) | Complete passage/date-range recall, focused topic filing, and current-versus-historical answers. | active — release validation | ZMR-delivery-manager coordinates; Public392d058 live; ZMR-8 bounded filing/recall fixes active. | [September review](planning/zenod-memory-reliability-review.md); [#1199 merged](https://github.com/zenod-ai/zenod/pull/1199) | 2026-09-06 21:08 CEST | Fix live filing/recall failures and rerun direct MCP acceptance. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `skills/epic-spine/SKILL.md` | Canonical agent instructions for EpicSpine behavior. | Always |
| 2 | `skills/epic-spine/references/operating-model.md` | Detailed write-scope, GitHub issue board, and dispatch model. | Planner |
| 3 | `skills/epic-spine/assets/epic-spine-template.md` | Template for new spine documents. | Planner |
| 4 | `skills/epic-spine/assets/github-issue-template.md` | Template for GitHub execution tickets. | Planner |
| 5 | `docs/epic-spine-deck.html` | Human onboarding deck for the pattern. | Always |
| 6 | `docs/EPIC-0-STORY.md` | Existing Epic 0 story spine; read-only from this track. | When routing story/launch consequences |
| 7 | [`Log/2026-08-15.md#^e-5c1e43`](https://github.com/AlfaBlok/obsidian-brain/blob/c18c1f92cbd26ce5a12518f9c7af7c59ff5eb928/Log/2026-08-15.md#L21) | Product-direction voice note: alpha launch, promotion, and the memory + execution lane. | Alpha-launch or voice-execution planning |
| 8 | [`Log/2026-08-15.md#^e-063285`](https://github.com/AlfaBlok/obsidian-brain/blob/a58d731c33000a780f4bd94bbe02b0432e2282db/Log/2026-08-15.md#L27) | Readiness voice note: incorrect recent recap, launch milestone, backlog, and reporting loop. | Readiness audit and regression planning |
| 9 | `docs/EPIC-P-PHYLAX-SPRINT.md` | Active final-push delivery surface, frozen architecture, dependency-ordered issue board and human gates. | Any current Zenod/Phylax final-push work |
| 10 | `docs/EPIC-ZENOD-ALPHA-LAUNCH.md` | Historical alpha-launch decisions, deployed-candidate evidence and public-readiness context. | When a current issue links back to prior launch evidence |

## Architecture And Context

EpicSpine is the document-centered operating model for the repo. It combines:

- A living epic document as the bootstrap artifact and durable memory.
- GitHub issues as bounded planner, worker, and tester tickets.
- A write-scope boundary so agents edit only the spine they are bound to.
- A backlog/dispatch loop so planners can create issues and launch parallel workers safely.
- Handoff and validation evidence so future agents can resume without relying on chat history.
- One active steward per spine so parallel agents cannot race on mission, acceptance, state, or the issue ledger.
- Dedicated ticket branches plus separate worktrees for concurrent filesystem isolation.
- Explicit review, testing, and done gates tied to exact commits and environments.
- Resumable assignments with stable identities, latest verified state, and takeover records.

Epic 0 Foundation is a meta-spine. It coordinates operating behavior across child epics, but it should not edit child epic implementation details unless explicitly delegated.

### 2026-08-16 project-direction rollup

Two long Zenod voice notes captured on 2026-08-15 establish the next planning horizon. The immediate milestone is **alpha-launch readiness**: a new user can discover Zenod, onboard, use the core memory loop, and receive grounded answers and receipts. The longer product direction is a **memory + execution lane**: a voice note can remain memory-only or, after explicit user choice and project binding, start a Codex run against a named repo and EpicSpine and return a phone-friendly artifact.

The voice notes are evidence and intent, not a prose dump to duplicate here. Their durable consequences are:

- Preserve the working wedge: WhatsApp voice-note capture, transcription, immutable evidence, search, and retrieval already work and are part of Jordi's real workflow.
- Treat the incorrect answer to “what have we been talking about recently?” as the first alpha-readiness regression. Recent-activity answers must be grounded in exact conversation/memory evidence, not reconstructed from vague model context.
- Make **alpha user onboarded and core loop trustworthy** the next milestone. Promotion can begin before every future feature exists, but the website and posts must describe only the package and onboarding path that actually work.
- Keep **store only** and **store + execute** as explicit user choices. Stored artifact content is not authority to execute; execution requires a current-turn choice plus a confirmed repo and bound spine when those are not already unambiguous.
- A project execution must load the root/child spine, reconcile current state, apply the new voice-note update, execute only ready in-scope work, and return a compact request/action/blocker/next-turn report. HTML is the preferred rich artifact when the result warrants one; the phone reply must remain concise and link to it.

### Child-spine routing from this update

| Concern | Existing authority / proposed home | Root rollup state | Next routing action |
|---|---|---|---|
| Integrated-independent Zenod/Phylax final push | `docs/EPIC-P-PHYLAX-SPRINT.md` | Active child spine; source architecture and phase-1 release packet complete; separate immutable Zenod/Phylax images published from exact main; production untouched. | Approve or replace the recommended allowance/tariff values, then request Gate A backups only; keep deploy, real sends, billing and signup separately gated. |
| Zenod alpha launch history | `docs/EPIC-ZENOD-ALPHA-LAUNCH.md` | Prior offer, readiness and deployment evidence remains authoritative for its completed tickets and current #1061 gate, but it is no longer the dispatch board. | Read only unless the active Phylax spine routes a specific gate or evidence correction. |
| Voice capture and grounded recall | `docs/EPIC-MECHANICAL-CAPTURE.md` | Capture/transcription/retrieval has strong July evidence; the new recent-recap failure is a fresh acceptance gap. | Reproduce the exact interaction and add it to the canonical journey suite before declaring alpha-ready. |
| Voice note → Codex execution | Proposed child epic | Direction is clear; UX, authority, project disambiguation, delivery surface, and pricing are not settled. | Draft a child spine after the immediate readiness audit; do not silently fold it into the memory-only launch gate. |
| Public story and promotion | `docs/EPIC-0-STORY.md` | Reddit/X promotion is desired now, but current packaging and funnel truth are not reconciled. | Produce a small launch-message backlog after the product/SKU decision; external posting remains approval-gated. |

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-09 | Name the pattern EpicSpine. | Short conversational name; machine skill remains `epic-spine`. | `skills/epic-spine/SKILL.md` |
| 2026-07-09 | Install the skill from the repo copy via symlink. | Keeps the local install and source-controlled skill in sync. | `/Users/jordi/.codex/skills/epic-spine` |
| 2026-07-09 | Use read broadly, write narrowly as the default write-scope rule. | Prevents parent, sibling, or worker agents from racing on each other's spines. | `skills/epic-spine/SKILL.md` |
| 2026-07-09 | Use GitHub issues as the execution board, not the source of truth. | Issues are good tickets; the spine carries the full epic memory and acceptance target. | `skills/epic-spine/references/operating-model.md` |
| 2026-07-09 | Bind agents to goal-seeking role identities. | Workers should keep implementing until ready for testing or precisely blocked; testers should keep validating through bounded fix loops unless a larger planner decision is needed. | `skills/epic-spine/SKILL.md` |
| 2026-07-09 | Split worker into epic worker and ticket worker. | An epic worker owns delivery through GitHub issue/subagent loops and writes clean state to the bound spine; ticket workers own assigned issues and write deep detail there. | `skills/epic-spine/SKILL.md` |
| 2026-07-09 | Define Epic 0 worker as project/root spine owner. | Each project can have an Epic 0 spine that keeps the full picture, reads all child spines, spins out child EpicSpines, and binds child workers while preserving project thrust. | `skills/epic-spine/SKILL.md` |
| 2026-07-09 | Public-repo Milestone 0 is README plus HTML deck. | Before packaging or registering the skill, EpicSpine needs a small public landing repo that explains why it exists, Epic 0, role binding, clean spines, GitHub issue discipline, and goal-seeking agents. | `docs/epicspine-public-repo/README.md` |
| 2026-07-09 | Use isolated worker branches/worktrees and frequent integration. | Parallel ticket workers need isolated execution, but `main` should stay the fresh ready-for-test base for deployment, human testing, and future agents. | `skills/epic-spine/references/operating-model.md` |
| 2026-07-09 | Use artifact-specific authority and one active steward per spine. | The spine owns intent and coordination, issues own ticket detail, code owns implementation facts, and tests own proof; one steward reconciles them without concurrent document races. | `skills/epic-spine/SKILL.md` |
| 2026-07-09 | Treat an epic worker as the delivery lead inside accepted scope. | The epic worker may create and dispatch tickets, reconcile integration, and steward the child spine without silently becoming the product planner. | `skills/epic-spine/references/operating-model.md` |
| 2026-07-09 | Use dedicated branches, optional per-agent worktrees, protected integration gates, and recorded test commits. | Worktrees isolate files but do not replace branches; frequent integration must still require review/checks and reproducible validation. | `skills/epic-spine/references/operating-model.md` |
| 2026-07-09 | Make assignments resumable and human gates precise. | A stalled agent can be replaced safely only when owner, commits, evidence, blocker, next action, and required human decision are explicit. | `skills/epic-spine/assets/epic-spine-template.md` |
| 2026-08-16 | Use alpha-user launch readiness as Zenod's next milestone. | The immediate outcome is a discoverable, onboardable, trustworthy core memory product, not completion of every future execution feature. | [`^e-063285`](https://github.com/AlfaBlok/obsidian-brain/blob/a58d731c33000a780f4bd94bbe02b0432e2282db/Log/2026-08-15.md#L27) |
| 2026-08-16 | Treat memory + execution as the strategic product direction, with an explicit store-only / store-and-execute choice. | Voice capture is already useful; binding it to a configured Codex harness, repo, and spine closes the loop from intent to work without making every capture executable authority. | [`^e-5c1e43`](https://github.com/AlfaBlok/obsidian-brain/blob/c18c1f92cbd26ce5a12518f9c7af7c59ff5eb928/Log/2026-08-15.md#L21) |
| 2026-08-16 | Keep the launch-readiness backlog separate from the future execution-lane backlog. | Grounded recall, packaging, onboarding, website truth, and alpha support must be made shippable now; repo/spine selection, execution authority, Codex reportback, and artifact hosting form a distinct larger epic. | 2026-08-15 voice-note pair and this rollup |
| 2026-08-20 | Treat priced usage economics as a prerequisite to the Zenod Alpha offer decision. | A monthly or annual price is incomplete until included workload, limit behavior, cost exposure, BYOK treatment, and break-even margins are explicit. | [ZAL-3E #1069](https://github.com/zenod-ai/zenod/issues/1069) and the active child spine |
| 2026-08-25 | Approve one Zenod Hosted plan at €9/month plus VAT with managed usage and WhatsApp included. | The simplest sellable product is Zenod itself across MCP, Telegram, and Hosted WhatsApp; provider economics and the hidden Phylax service remain operator concerns. | Binding child-spine product decision and `docs/evidence/zenod-whatsapp-public-beta-2026-08-25/ui-contract.html` |
| 2026-08-26 | Do not deploy the locally proved candidate until its legacy €5/month and €50/year contract is corrected. | Read-only preflight showed code/product/legal/readiness drift despite the functional candidate passing local acceptance. A code-only correction is safer than deploying twice or misrepresenting the approved offer. | [ZAL-4 #1061](https://github.com/zenod-ai/zenod/issues/1061), [PR #1089](https://github.com/zenod-ai/zenod/pull/1089), and [ZAL-18 #1090](https://github.com/zenod-ai/zenod/issues/1090) |
| 2026-08-27 | Lock Zenod/PM plus Phylax as integrated UX over independent services. | Product backends own customer identity, subscription and memory; Phylax independently owns WhatsApp/Telegram transport, raw staging, STT, delivery and its own cost ledger. A narrow tenant-scoped control/data seam lets one browser experience manage both without moving credentials or sessions. Standalone Phylax reuses the same core with a different allowance issuer. | `docs/EPIC-P-PHYLAX-SPRINT.md` and `docs/evidence/zenod-phylax-integrated-independent-2026-08-27/index.html` |
| 2026-08-27 | Treat tenant credentials and direct MCP tokens as durable data, never deployment state. | Code/image/config rollout must not rotate, migrate, reinterpret or replace customer tokens, Google credentials or channel sessions. The ZAL-22 rollout preserved them and proved the pre-existing direct MCP URL and Google/WhatsApp connections after both restarts. | [PR #1098](https://github.com/zenod-ai/zenod/pull/1098) and `docs/evidence/zenod-zal22-production-rollout-2026-08-27/README.md` |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `docs/EPIC-P-PHYLAX-SPRINT.md` | Epic worker | `/root` final-push delivery manager | Deliver frozen integrated-independent architecture | active / wave 6 config gate | #1103–#1111 and #1119 integrated; #1112 phase 1 complete; then gated backup/deploy/journey and #1061 | [#1103](https://github.com/zenod-ai/zenod/issues/1103)–[#1112](https://github.com/zenod-ai/zenod/issues/1112), [#1119](https://github.com/zenod-ai/zenod/issues/1119) | `73e309a` | Separate product/Phylax artifacts and islands; stable auth; issuer-neutral Phylax ledger; tenant-safe management MCP; Zenod BFF; reusable UI/standalone; no-loss migration; three-island proof; exact release acceptance. | #1112 phase 1 PASS: full validation/security, immutable paired images, live read-only continuity, backup/rollout/rollback packet; production untouched. | 2026-08-27 23:12 CEST | Obtain exact allowance/tariff approval; then request Gate A backups only. Do not combine deploy, real sends, billing or signup gates. |
| `docs/EPIC-ZENOD-ALPHA-LAUNCH.md` | Historical child / gate source | Zenod Alpha delivery manager | Preserve prior alpha evidence and #1061 gate | read-only / superseded for dispatch | active Phylax child, #1112 | prior ZAL PRs | `a6fbe8f` | Prior offer/readiness/deployment evidence remains available without competing issue selection. | Signup-closed candidate deployed; #1061 remains 11/13 and linked from the active child. | 2026-08-27 14:40 CEST | No dispatch; follow active child. |
| draft | Planner | Epic 0 Foundation planner | Create Foundation Epic GitHub issues | ready | - | - | `8658d72` | Issues exist for rollout work and link back to this spine. | This spine created 2026-07-09. | 2026-07-09 19:55 CEST | Create GitHub issues and update this row. |
| draft | Epic worker | unassigned | Apply EpicSpine to one real child epic | ready | Foundation issues created | - | `8658d72` | One child epic has explicit authority, stewardship, issue ledger, and handoff journal aligned to the skill. | Candidate child spines listed above. | 2026-07-09 19:55 CEST | Choose child epic and dispatch worker. |
| draft | Tester | unassigned | Validate bootstrap from a cold start | ready | Child epic applied | - | `8658d72` | Fresh agent can read the target spine and report authority, current state, active issues, blockers, and next action without chat history. | Skill validator passes. | 2026-07-09 19:55 CEST | Run cold-start test after child epic update. |
| draft | Planner | Epic 0 Foundation planner | Decide relationship between Foundation and Story Epic 0 | done | - | - | `8658d72` | `EPIC-0-STORY.md` remains story-owned, or is explicitly nested under this foundation spine. | 2026-07-09 decision: Foundation is the meta Epic 0; Story is a child/sibling story spine. | 2026-07-09 19:55 CEST | None. |
| `docs/EPIC-2.9-EPAMINON-MOVE-0.md` | Planner | Epic 0 Foundation planner | Spin out Epaminon executor-unit spine | draft | Foundation routing decision | - | `8658d72` | Non-ambiguous child spine exists and states current Epaminon facts, gaps, issue ledger, and next planner action. | Draft spine created 2026-07-09. | 2026-07-09 19:55 CEST | Review scope, then create GitHub issues if accepted. |
| [#1](https://github.com/AlfaBlok/epicspine-skill/issues/1) | Epic 0 worker | Epic 0 Foundation planner | Public EpicSpine authority and recovery protocol | done | - | [PR #2](https://github.com/AlfaBlok/epicspine-skill/pull/2) / `main` | `d72279f` | Public skill, templates, README, deck, and validator encode authority, stewardship, integration gates, human gates, and takeover behavior. | PR #2 merged as `3ab84fa`; issue #1 closed; Pages build completed; validation passed. | 2026-07-09 20:05 CEST | None. |

## Branch And Integration

- Default integration branch: protected `main`.
- Worker isolation: one ticket worker per dedicated branch; concurrent workers use separate worktrees.
- Dispatch records include branch, base commit, integration target, owner, and latest verified time.
- `review` means implementation complete, PR open, and required automated checks passing.
- `testing` means the exact commit is available on a named test surface and acceptance validation is in progress.
- `done` means acceptance passed, evidence linked, residual risk recorded, and the spine reconciled.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Product intent or acceptance change | Jordi | Proposed behavior changes the EpicSpine contract or rollout acceptance | Approve the revised intent or criteria | Documentation and validation inside existing scope |
| Public release or registry submission | Jordi | Publishing beyond the existing AlfaBlok GitHub repository and Pages site | Approve target registry and release posture | Local package, README, deck, and repository updates |
| Destructive, privileged, or irreversible action | Jordi | Credentials, deletion, production mutation, or irreversible external action is required | Approve the exact action and target | Read-only investigation and reversible preparation |
| Alpha package and public promise | Jordi | Satisfied 2026-08-25 through the binding product/UI review | Approved: one €9/month plus VAT Zenod Hosted plan with managed usage and WhatsApp included; provider economics hidden; Phylax is the existing private Channels service; Ring absent from Zenod; MCP first-class; self-host remains free/BYO/Telegram. | Local implementation and validation inside this contract; production, billing, credentials, sessions, signup, and promotion remain separately gated. |
| External promotion | Jordi | A Reddit/X/email draft is ready | Approve the exact final content and destination | Research, strategy, and drafts |
| Voice-triggered execution authority | Jordi | The proposed execution child spine is ready to move beyond design | Approve the store+execute interaction, repo/spine confirmation rule, pricing posture, and mutation gates | Read-only design and local prototypes |

## Recovery And Takeover

Stale assignment policy: no automatic timeout. Before takeover, verify the issue, branch, PR, latest commit, evidence, blocker, and next action; mark the previous assignment superseded and record the new starting commit.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | 2026-07-09 19:55 CEST |

## Planner Queue

- Treat `docs/EPIC-P-PHYLAX-SPRINT.md` as the sole active final-push delivery board; do not select work from the global open-issue list or the historical alpha spine.
- On “continue,” execute the active child spine's single next action and remain the delivery manager/spine steward.
- Preserve the approved one-plan €9 Zenod contract. Route [#1090](https://github.com/zenod-ai/zenod/issues/1090) as the smallest correction before refreshing the production candidate; do not reopen product economics or deploy the legacy-priced image.
- Create the separate voice-note-to-Codex child EpicSpine only after the alpha offer is accepted.
- Create GitHub issues for the draft ledger rows.
- Treat `EPIC-0-FOUNDATION-SPINE.md` as the meta Epic 0 spine; `EPIC-0-STORY.md` is story-owned and read-only unless explicitly delegated.
- Identify the first child epic to retrofit with explicit Write Scope.
- Add a short reference from relevant handover docs to EpicSpine once the pattern is proven.
- Review the Epaminon 2.9 draft spine and decide whether to dispatch planner tickets.
- Review `docs/epicspine-public-repo/` as the seed for the future public EpicSpine repo.

## Worker Queue

- Final-push work is dispatchable only from `docs/EPIC-P-PHYLAX-SPRINT.md`; #1112 phase 1 is complete on exact `main` `73e309a`. The current human input is the allowance/tariff configuration; backup, deploy, real sends, billing and signup retain separate gates.
- Add explicit Write Scope to the chosen child epic spine.
- Ensure its Issue Ledger links to GitHub issues or marks drafts clearly.
- Add Handoff Journal and Proposed Cross-Spine Updates sections if missing.

## Tester Queue

- Replay “what have we been talking about recently?” using the exact 2026-08-15 conversation evidence and preserve the full tool/result trace.
- Re-run the smallest alpha core loop: long voice note → terminal receipt → exact transcript retrieval → grounded recent recap → no read-side mutation.
- Cold-start an agent with only the chosen spine and ask it to orient.
- Verify it does not edit read-only linked spines.
- Verify it proposes cross-spine changes in the bound spine instead.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-09 | EpicSpine skill validation | working tree from `8658d72` | local canonical skill | `/tmp/codex-epic-spine-validate/bin/python /Users/jordi/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/jordi/Documents/GitHub/zenod/skills/epic-spine` | pass | `Skill is valid!` |
| 2026-07-09 | EpicSpine deck compatibility check | working tree from `8658d72` | local file | HTML parser verified `docs/epic-spine-deck.html` title and redirect wrapper. | pass | `docs/epic-spine-deck.html` |
| 2026-07-09 | Public-repo deck structural check | `d72279f` | GitHub Pages | HTML parser verified `docs/epicspine-public-repo/index.html` title, twelve slides, progress, counter, and controls; compatibility redirect checked. | pass | `docs/epicspine-public-repo/index.html` |
| 2026-07-09 | Authority protocol skill validation | working tree from `8658d72` | canonical and public skill copies | Official `quick_validate.py` run against both packages. | pass | `Skill is valid!` for both copies. |
| 2026-07-09 | Foundation spine structural contract | working tree from `8658d72` | local Foundation spine | `python3 skills/epic-spine/scripts/validate_spine.py --strict docs/EPIC-0-FOUNDATION-SPINE.md` | pass | `OK` |
| 2026-07-09 | EpicSpine validator executable | `3ab84fa` | public package | Python compilation and template validation; template emitted only expected unresolved-placeholder warnings. | pass | `skill/epic-spine/scripts/validate_spine.py` |
| 2026-07-09 | Updated public deck structure | `3ab84fa` | public package | HTML parser verified title, fourteen slides, progress, counter, and previous/next controls. | pass | `docs/epicspine-public-repo/index.html` |
| 2026-07-09 | Public integration | `3ab84fa` | GitHub `main` | Issue #1, dedicated branch, PR #2, mergeability check, and merge to `main`. | pass | https://github.com/AlfaBlok/epicspine-skill/pull/2 |
| 2026-07-09 | Public Pages deployment and visual QA | `3ab84fa` | GitHub Pages | Pages build returned `built`; live deck rendered 14 slides with working navigation, no console warnings/errors, no desktop overflow at 1280x720, and no horizontal mobile overflow at 390x844. | pass | https://alfablok.github.io/epicspine-skill/ |

## Handoff Journal

### 2026-08-27 - Epic 0 worker - ZPF-10 phase-1 release packet complete; exact config decision next

Action: reconciled exact `main` `73e309a`, successful CI/publish, separate immutable Zenod and Phylax OCI indexes, full local/CI/image/security evidence, and fresh read-only production continuity/rollback inspection. Added the durable [ZPF-10 release gate packet](./evidence/zpf-10-release-gate-2026-08-27/README.md). Production remains untouched and signup closed.

Evidence: [CI 33116222429](https://github.com/zenod-ai/zenod/actions/runs/33116222429), [publish 33116222471](https://github.com/zenod-ai/zenod/actions/runs/33116222471), [issue #1112](https://github.com/zenod-ai/zenod/issues/1112), and the release packet. Candidate images are Zenod OCI index `a25a84c1...` and dedicated Phylax OCI index `929b4b5c...`; normal rollback remains live universal index `9308e5e...` with both volumes preserved.

Next action: Jordi approves or replaces the recommended production values `3000000 / 1000000 / 1000000 / tariff-v1` and explicit private `phylax-runtime-v1` 1/1/1 pins. That approval authorizes configuration finalization only. The next requested operational gate is fresh backups only; closed deployment, real channel sends, billing and signup stay separate.

Assignment identity: `/root` final-push delivery manager and sole root/child spine steward

Branch / latest commit: `main` `73e309adda4d04c5ea58f2ec4dc114143731ed1c`; control branch `codex/zpf-control-phase1-gate`

Last verified: 2026-08-27 23:12 CEST

### 2026-08-27 - Epic 0 worker - Zenod signup-closed production candidate ready for founder voice acceptance

Action: reconciled the integrated-but-independent Phylax decision, merged and published the final ZAL-22 correction, verified fresh restored/encrypted backups for both production volumes, and deployed exact OCI index `9308e5e...` to public Zenod first and private Phylax second. Existing direct MCP, signed Channels, tenant Drive, €9 site/Terms, exact health SHA and fresh logs pass. No customer token, Google credential, channel session or volume changed.

Evidence: merged [PR #1101](https://github.com/zenod-ai/zenod/pull/1101), CI `33033764333`, publish `33033978660`, and `docs/evidence/zenod-zal22-production-rollout-2026-08-27/README.md`.

Next action: Jordi runs three overlapping voice notes against the existing WhatsApp/Drive/MCP tenant. Then the alpha child closes the bounded Phylax allowance/customer-usage truth and the separate Stripe profile/live-card/public-signup gates. Public signup remains `0`.

Assignment identity: Epic 0 Foundation planner and Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: production `main` `a6fbe8f`; receipt branch `codex/zal22-production-receipt`

Last verified: 2026-08-27 CEST

### 2026-08-26 - Epic 0 worker - Candidate publication blocked by GitHub Actions outage

Action: monitored the repository's standard immutable-image publish for reviewed runtime `ba5e9c1`. Run `32983888246` was canceled after 15 minutes because no hosted runner acquired it; it ran zero steps and pushed no image. Approved one exact retry of that existing non-deploying workflow, but GitHub's official Actions component is in `major_outage` and the retry remains queued. GHCR `sha-ba5e9c1` is absent, so ZAL-4 cannot truthfully refresh or name a deployable candidate.

Evidence: [publish run 32983888246](https://github.com/zenod-ai/zenod/actions/runs/32983888246), empty runner/step metadata, GitHub Actions component status, and read-only GHCR tag lookup. Live Dokploy state and production configuration are unchanged.

Next action: after GitHub Actions recovers, consume the already-approved retry. On success, record its real OCI/amd64 digest and resume ZAL-4 read-only. On another terminal failure, require a new explicit rerun decision. No production, backup, credential/config, provider, channel, billing, or signup action may proceed.

Assignment identity: Epic 0 Foundation planner (`Jordi + current bound Codex task`); Zenod Alpha delivery manager; ZAL-4-production-readiness-operator

Branch / latest commit: control `main` `046ff07`; runtime merge `ba5e9c1`; publish run `32983888246`

Last verified: 2026-08-26 CEST

### 2026-08-26 - Epic 0 worker - Single €9 contract integrated; immutable candidate refresh next

Action: accepted ZAL-18 after an initial clean-CI head was returned for one reviewer-found retired-alias defect. The corrected head rejects `starter`, `pro`, and `yearly` for new Zenod checkout before Stripe while preserving historical yearly accounts and non-Zenod aliases/yearly checkout. PR #1091 merged as `ba5e9c1`; issue #1090 is complete. Site, Hosted Account, Terms, checkout, and readiness now agree on one €9/month plus VAT contract with managed usage and WhatsApp included.

Evidence: exact-head clean CI, two independent review passes, and merged-main validation: 42 shared billing/readiness tests, site 7/7, web 72/72, all-workspace typecheck, and diff check. No Stripe, Dokploy, configuration, credential, channel, billing, signup, backup, or production mutation occurred.

Next action: consume the repository's normal automatic main image publication read-only and refresh the ZAL-4 packet with its exact immutable digest and corrected product/legal/readiness truth. Stop before any backup quiesce, credential/token creation, environment change, deploy, provider reconciliation, OAuth grant, channel send, real-card billing, or signup action.

Assignment identity: Epic 0 Foundation planner (`Jordi + current bound Codex task`); Zenod Alpha delivery manager; ZAL-4-production-readiness-operator

Branch / latest commit: `main` at `ba5e9c1`; ZAL-4 docs branch to be refreshed only after the automatic digest is terminal

Last verified: 2026-08-26 CEST

### 2026-08-26 - Epic 0 worker - Read-only preflight integrated; single-price correction dispatched

Action: accepted corrected ZAL-4 documentation PR #1089 and merged it as `19be22b`. The packet authorizes no external mutation and proves candidate `91b4e7d` must not deploy because Zenod's public site, Hosted Account, Terms, checkout, and readiness contract still present the superseded €5/month and €50/year offer. Jordi's binding product decision is already one €9/month plus VAT Hosted plan with managed usage and WhatsApp included. Created [ZAL-18 #1090](https://github.com/zenod-ai/zenod/issues/1090) as the narrow reuse-first correction.

Evidence: [ZAL-4 durable packet](./evidence/zenod-production-readiness-preflight-2026-08-26/README.md), corrected [PR #1089](https://github.com/zenod-ai/zenod/pull/1089), and independent exact-head review. Production remains unchanged, signup false, and readiness 503.

Next action: implement and review ZAL-18 from exact `main` `19be22b`, preserving historical subscriptions and all shared billing functionality. Do not create or select a Stripe price, deploy, alter configuration, charge a card, or open signup. After integration, publish a fresh immutable image and refresh the read-only packet only under the later named gates.

Assignment identity: Epic 0 Foundation planner (`Jordi + current bound Codex task`); Zenod Alpha delivery manager; ZAL-18-single-price-contract-worker

Branch / latest commit: `main` at `19be22b`; worker branch `codex/zal-18-single-price-contract`

Last verified: 2026-08-26 CEST

### 2026-08-20 - Epic 0 worker - Zenod Alpha economics integrated; human gate ready

Action: accepted and integrated ZAL-3E's reproducible usage/BYOK economics as `131b80c`. The active child now recommends managed €5/month or €50/year plus VAT with a locked model set, $0.50 monthly provider cap, 80% warning, 100% hard stop, UTC reset, and no overage/fallback; BYOK €4/month plus VAT with no included AI spend and no alpha annual plan. No commercial choice or live action was approved by the evidence merge.

Evidence: [PR #1071](https://github.com/zenod-ai/zenod/pull/1071) passed CI at exact ticket head `d4dfc18`; independent repo/live and current primary-source cost audits, calculation invariants, link/diff checks, and manager review passed. Production remains BYOK-capable but lacks the managed platform credential, automatic monthly child keys, entitlements/model lock, fail-closed stop UX, and reconciliation needed for the managed promise.

Next action: Jordi replies `APPROVE ECONOMICS CONTRACT` or names the assumption to revise. Approval permits backlog implementation and offer-copy preparation only; credentials, Stripe mutation, deployment, publication, and signup retain their own gates.

Assignment identity: Epic 0 Foundation planner (`Jordi + current bound Codex task`); Zenod Alpha delivery manager

Branch / latest commit: ZAL-3E `d4dfc18`; integrated `main` `131b80c`; steward `codex/alpha-economics-decision-gate`

Last verified: 2026-08-20 17:41 CEST

### 2026-08-20 - Epic 0 worker - Zenod Alpha economics prerequisite activated

Action: reconciled Jordi's requirement that the first-alpha offer define included usage, limit behavior, unit economics across consumption levels, and a separately priced customer-supplied model-credential path before any final offer choice. The active child delivery manager created [ZAL-3E #1069](https://github.com/zenod-ai/zenod/issues/1069), dispatched an isolated ticket worker from exact `main` `130a2720`, and marked the original bare A/B/C gate superseded pending the analysis.

Evidence: the repository exposes tenant provider-key and durable usage-metering surfaces, but their hosted customer usability, enforced caps, actual production distribution, and current cost assumptions still require review. No product, production, Stripe, credential, signup, customer-data, or public-pricing change occurred.

Next action: review and reconcile #1069 into the active child spine, then present Jordi with one exact platform-funded and BYOK offer contract including allowance, limit behavior, price, and margin sensitivity.

Assignment identity: Epic 0 Foundation planner (`Jordi + current bound Codex task`); Zenod Alpha delivery manager; ZAL-3E-unit-economics-worker

Branch / latest commit: steward `codex/alpha-launch-economics-control`; worker `codex/zal-3e-unit-economics` from `130a2720`

Last verified: 2026-08-20 17:12 CEST

### 2026-07-09 - Planner - Foundation spine created

Context: This conversation produced the EpicSpine skill, local installation, onboarding deck, write-scope rule, and GitHub issue board / parallel dispatch flow.

Next: Create GitHub issues for the draft ledger and use this spine as the bound document for Foundation rollout.

Risks: Existing `docs/EPIC-0-STORY.md` already uses the Epic 0 number for public story work. Avoid silently merging scopes; record an explicit parent/child or sibling relationship.

Links:

- `skills/epic-spine/SKILL.md`
- `docs/epic-spine-deck.html`
- `docs/EPIC-0-STORY.md`

### 2026-07-09 - Planner - Goal-seeking posture added

Context: Jordi clarified that role-bound agents should work toward completion, not one-shot responses. Workers should keep pushing until their issue is ready for testing or blocked by a precise required input. Testers should continue until acceptance passes, an evidenced failure requires planner judgment, or a bounded fix loop succeeds.

Next: Future worker/tester dispatch prompts should include role, bound spine, bound issue, and terminal state.

Risks: Tester self-fix must stay bounded. Product, architecture, acceptance, cross-spine, or broad refactor changes still return to the planner.

Links:

- `skills/epic-spine/SKILL.md`
- `skills/epic-spine/references/operating-model.md`

### 2026-07-09 - Planner - Epic worker role clarified

Context: Jordi clarified that a worker bound to an epic can also be a manager of execution: own the delivery goal, create GitHub issues, dispatch subagents, and loop until the epic is ready for human testing or blocked.

Next: Use "epic worker" for this coordinator role and "ticket worker" for a subagent assigned to one GitHub issue.

Risks: Epic workers must not become planners by stealth. They may execute within existing scope, but product intent, acceptance changes, cross-spine authority, and major decisions still return to planner/user.

Links:

- `skills/epic-spine/SKILL.md`
- `skills/epic-spine/references/operating-model.md`

### 2026-07-09 - Planner - Epic 0 worker role added

Context: Jordi clarified that each project can have an Epic 0 spine that holds the whole context together. An Epic 0 worker reads all child spines, keeps the full picture and state, expands the project thrust into child EpicSpines, and binds other workers to those child spines.

Next: Treat `docs/EPIC-0-FOUNDATION-SPINE.md` as the root spine for this operating-system track unless Jordi chooses a different project root.

Risks: The Epic 0 worker should not mutate child implementation detail by default. It writes rollups, dependencies, child-spine map, decisions needed, and next actions into the root spine.

Links:

- `skills/epic-spine/SKILL.md`
- `skills/epic-spine/references/operating-model.md`

### 2026-07-09 - Epic 0 worker - Public-repo Milestone 0 seed created

Context: Jordi clarified that EpicSpine should become a public repo and eventually be registered/distributed. Milestone 0 is intentionally barebones: a README that lands the concept and an HTML page/deck inside the repo.

Next: Public repo is created. Next milestone is to package/register the skill and add examples.

Risks: Do not overpackage before the core language lands. The next milestone can add installable skill packaging, examples, and registry work.

Links:

- `docs/epicspine-public-repo/README.md`
- `docs/epicspine-public-repo/index.html`
- `docs/epic-spine-deck.html`
- https://github.com/AlfaBlok/epicspine-skill
- https://alfablok.github.io/epicspine-skill/

### 2026-07-09 - Epic 0 worker - Branch/worktree integration discipline added

Context: Jordi clarified that ticket workers should use separate branches or worktrees, while completed ready-for-test work should merge back to `main` frequently. This keeps deployment/testing and future agent bootstraps on the freshest integrated base.

Next: Child spines should declare their integration branch, and GitHub issue templates should name the branch/worktree and merge/PR status.

Risks: Long-lived unmerged branches become hidden project state. If work cannot merge, the issue and spine must state branch, PR, blocker, owner, and next action.

Links:

- `skills/epic-spine/SKILL.md`
- `skills/epic-spine/references/operating-model.md`
- https://github.com/AlfaBlok/epicspine-skill/commit/d72279f

### 2026-07-09 - Planner - Epic 0 meta binding clarified; Epaminon child spine spun out

Context: Jordi clarified that Epic 0, for EpicSpine purposes, is the meta epic that holds the
other epics together. The existing `EPIC-0-STORY.md` remains the public story/launch spine, but
Foundation is the coordinating spine agents should mean when they say "Epic 0 meta."

Next: Review the new Epaminon 2.9 spine, then create GitHub issue rows if its scope is accepted.

Risks: Avoid using 2.7 because existing docs use 2.7 for full Ring scope. Avoid 2.8 until its
meaning is deliberately assigned. Epaminon is therefore numbered 2.9 for now.

Links:

- `docs/EPIC-2.9-EPAMINON-MOVE-0.md`
- `docs/EPAMINON-ARCHUS-PROTOCOL.md`
- `docker-compose.epaminon.yml`

### 2026-07-09 - Epic 0 worker - Authority and recovery protocol published

Context: The skill now assigns authority by artifact, names one active steward per spine, treats the epic worker as the delivery lead inside accepted scope, requires one dedicated branch per ticket plus separate worktrees for concurrent agents, and defines review/testing/done gates tied to exact commits and environments. Human gates and assignment takeover are now explicit and a local validator checks the document contract.

Next: Use the revised template and validator when retrofitting the first real child epic, then create the remaining Foundation rollout issues.

Risks: The validator checks local Markdown structure and recorded evidence; it does not verify remote GitHub issue state. Mobile slides intentionally scroll vertically when their content exceeds the viewport.

Assignment identity: Epic 0 Foundation planner (`Jordi + current bound Codex task`)

Branch / latest commit: `codex/authority-contracts` merged through PR #2 as `3ab84fa`

Last verified: 2026-07-09 20:05 CEST

Links:

- https://github.com/AlfaBlok/epicspine-skill/issues/1
- https://github.com/AlfaBlok/epicspine-skill/pull/2
- `skills/epic-spine/scripts/validate_spine.py`

### 2026-08-16 - Epic 0 worker - Zenod voice-note direction ingested

Context: Jordi asked the bound Codex task to retrieve the recent long Zenod voice notes from Zenod MT, integrate their durable meaning into this repo's spine, and confirm the resulting direction and next steps. The two exact evidence entries were captured through WhatsApp at 2026-08-15 23:50 and 23:55 CEST. They describe a working voice-memory habit, a bad recent-conversation answer, alpha-launch readiness as the immediate milestone, promotion urgency, and a future voice-note-to-Codex lane bound to a repo and EpicSpine.

Durable interpretation: the immediate launch gate is a trustworthy memory product for alpha users. The memory + execution lane is the strategic expansion, not a prerequisite to claim that the core memory loop is alpha-ready. A voice note may carry instructions, but its stored transcript is evidence, not standing authority to mutate a repo; store+execute must be an explicit current-turn choice with project binding.

Request disposition:

| Request found in the notes | Disposition in this reconciliation |
|---|---|
| Preserve the notes in the repo's canonical state | Done: exact immutable refs are in the Bootstrap Map, decisions, child-spine rollup, and this handoff. |
| Clarify what Zenod is trying to launch | Done at milestone level: alpha onboarding + trustworthy core memory loop. Exact SKU/WhatsApp packaging remains a named human gate. |
| Explain the strange “what have we been talking about recently?” answer | Not diagnosed yet: promoted to the first readiness replay with exact evidence and deployed-SHA requirements. |
| Produce a coherent backlog | Done as draft root ledger rows; issue creation and implementation remain gated on the evidence audit and Jordi's package decision. |
| Start promotion | Routed to Story/promotion as draft-only work after the public promise is truthful; nothing has been posted. |
| Build voice-note → Codex execution | Routed to a proposed child epic after alpha-readiness scope is accepted. |
| Return clear execution feedback and rich artifacts | Added to the execution-lane acceptance direction: request/action/blocker/next-turn summary, with linked HTML for substantial output. |

Next: perform the read-only readiness audit and exact recap replay, then return a small ordered backlog and the product/SKU decision options to Jordi before dispatching implementation.

Risks: existing launch documents contain substantial July state and may be stale relative to the current runtime. The working tree was already dirty with unrelated untracked artifacts, so this reconciliation changed only the bound Foundation spine.

Assignment identity: Epic 0 Foundation planner (`Jordi + current bound Codex task`)

Branch / latest commit: `capture-first-live-evidence` at `529ee7a` plus this uncommitted spine update

Evidence:

- [`Log/2026-08-15.md#^e-5c1e43`](https://github.com/AlfaBlok/obsidian-brain/blob/c18c1f92cbd26ce5a12518f9c7af7c59ff5eb928/Log/2026-08-15.md#L21)
- [`Log/2026-08-15.md#^e-063285`](https://github.com/AlfaBlok/obsidian-brain/blob/a58d731c33000a780f4bd94bbe02b0432e2282db/Log/2026-08-15.md#L27)
- `docs/EPIC-MECHANICAL-CAPTURE.md`
- `docs/EPIC-2.3-ZENOD-MOVE-0.md`

### 2026-08-16 - Epic 0 worker - Alpha board made dispatchable

Context: A cold-start audit showed that the Foundation spine could orient a manager but GitHub could not safely drive execution. The repository had roughly one hundred heterogeneous open issues, while the new alpha work existed only as root-level draft rows. Current `main` was also nineteen commits ahead of the local capture branch and already contained production-readiness implementation through PRs #1053–#1057.

Action: created `docs/EPIC-ZENOD-ALPHA-LAUNCH.md` as the active child delivery surface and materialized six bounded GitHub issues. [ZAL-1 #1058](https://github.com/zenod-ai/zenod/issues/1058) and [ZAL-2 #1059](https://github.com/zenod-ai/zenod/issues/1059) are the only initial `ready` batch. [#1060](https://github.com/zenod-ai/zenod/issues/1060)–[#1063](https://github.com/zenod-ai/zenod/issues/1063) encode dependencies and named product, production, financial, signup, and promotion gates. No worker was launched and no production or external-posting action occurred.

Delivery-manager contract: a fresh task receiving “continue” opens the child spine, reconciles its linked issues and latest `main`, dispatches #1058/#1059 into separate issue branches/worktrees, and remains the sole spine steward. Ticket workers write deep detail and handoffs to GitHub; the delivery manager alone updates the child spine and rolls durable state up here.

Next: land the two control-plane spine files. Then “continue” is an execution command, not another process-design conversation.

Risks: global GitHub issue state remains intentionally unclean; it is not the alpha board. Only the child spine's linked ledger is selectable.

Assignment identity: Epic 0 Foundation planner / Zenod Alpha delivery manager (`Jordi + current bound Codex task`)

Branch / latest commit: `codex/alpha-launch-control` from `1a39166` plus the validated control-plane changes

Last verified: 2026-08-16 17:07 CEST

Links:

- `docs/EPIC-ZENOD-ALPHA-LAUNCH.md`
- https://github.com/zenod-ai/zenod/issues/1058
- https://github.com/zenod-ai/zenod/issues/1059
- https://github.com/zenod-ai/zenod/issues/1060
- https://github.com/zenod-ai/zenod/issues/1061
- https://github.com/zenod-ai/zenod/issues/1062
- https://github.com/zenod-ai/zenod/issues/1063

## Open Questions

- Should `docs/EPIC-2.9-EPAMINON-MOVE-0.md` remain 2.9 permanently, or be renumbered after the Ring numbering settles?
- Which child epic should be the first real retrofit target?
- Should future agents treat "epicspine Epic 0" as Foundation by default, Story by default, or require disambiguation? Current answer: Foundation by default for meta/coordination; Story only when explicitly about public positioning or launch copy.
- What is the one alpha offer: memory-only hosted Zenod, self-hosted Zenod, hosted Zenod with WhatsApp transport, or an explicitly tiered combination?
- Which onboarding path and price can the public site truthfully promise after the current runtime/Stripe audit?
- For store+execute, when may recent context select the repo/spine automatically, and when must the phone UI ask for confirmation?
- Is the first promotion target a product-learning Reddit post, an alpha-user invitation, or a build-in-public demonstration of the working voice-memory loop?

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-09 | `docs/EPIC-0-STORY.md` | Add a read-only link to Foundation if Jordi confirms Story is a child/sibling of Foundation. | This spine and existing story scope differ. | Epic 0 Story planner | proposed |
| 2026-07-09 | `docs/EPIC-2.9-EPAMINON-MOVE-0.md` | Review and accept/adjust the new Epaminon executor-unit spine; then mint GitHub execution issues. | Epaminon exists as a headless internal MCP/server but lacks unit product spine. | Epic 0 Foundation planner | proposed |
| 2026-08-16 | `docs/EPIC-2.3-ZENOD-MOVE-0.md` | Reconcile the current runtime, funnel, billing, website, onboarding, and memory acceptance against the alpha-launch milestone; retire stale claims instead of appending another historical layer blindly. | Voice-note pair plus current repo/runtime audit to be run. | Zenod alpha-launch spine steward | proposed |
| 2026-08-16 | `docs/EPIC-MECHANICAL-CAPTURE.md` | Add the exact incorrect recent-conversation interaction as a launch-gating grounded-recap journey after reproducing it against the deployed SHA. | `^e-063285` reports the failure after successful voice capture. | Mechanical Capture steward/tester | proposed |
| 2026-08-16 | `docs/EPIC-0-STORY.md` | Reframe the first public story around the proven voice-memory wedge and alpha invitation; defer claims about store+execute until its child epic passes acceptance. | `^e-5c1e43` asks to begin Reddit/X promotion while also exposing packaging ambiguity. | Epic 0 Story planner | proposed |
| 2026-08-16 | new child spine | Create the voice-note-to-Codex execution epic: explicit store+execute selection, repo/spine binding, harness, authority, reportback, HTML hosting, and commercial boundary. | `^e-5c1e43` | Epic 0 Foundation planner after Jordi's scope approval | proposed |

## Appendix

Related artifacts:

- `skills/epic-spine/`
- `docs/epic-spine-deck.html`
- `/Users/jordi/.codex/skills/epic-spine`
