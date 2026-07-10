# EPIC 4.0 · HERALD — root spine: the loop, generalized

Status: active
Created: 2026-07-10
Updated: 2026-07-10
Repository: `zenod-ai/zenod` (engine) + `herald-brain` (config, per D-H3)
Primary document: `docs/EPIC-4.0-HERALD.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Epic 0 worker for 4.0 (Jordi + current bound Fable session)
Steward since: 2026-07-10 03:58 CEST
Last reconciled commit: `468095d`
Planner: Jordi + Fable
Worker: unassigned (per child epic)
Tester: unassigned (per child epic)

> **Supersedes `docs/EPIC-4-HERALD.md` (decided 2026-07-10, Jordi).** This spine absorbs its
> decisions (D-H1..D-H3) and maps its tickets (H3-1..H3-5) into child epics below. The old doc
> remains as historical record; a pointer note for its append zone is proposed in
> Proposed Cross-Spine Updates (Jordi commits it — this steward does not edit that doc).

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Jordi + bound Fable session | Herald root scope (4.x) | Steward this spine, child-spine map, rollups, decisions; draft child spines; propose (never edit) changes to linked spines. | Root state current, children mapped, next human decision explicit. |
| Planner | same as Epic 0 worker | 4.x decomposition | Shape child scopes and acceptance; no implementation. | Coherent child map + dispatch-ready child spines. |
| Epic worker | unassigned | one child spine (4.1–4.6) | Delivery lead + steward of that child spine only. | Child spine current, ready for test or blocked precisely. |
| Ticket worker | unassigned | one GitHub issue | Execute issue branch; write handoff to issue. | PR, commit, evidence, blocker, next action in issue. |
| Tester | unassigned | issue/PR/milestone | Validate exact commit; never fixes. | Pass/fail with receipts. |

## Write Scope

Bound spine: `docs/EPIC-4.0-HERALD.md`
Active steward: Epic 0 worker for 4.0

Writable by default:

- The active steward reconciles and commits this spine.
- Child epic workers steward their own child spine; they write rollup-relevant changes back here via handoff, not directly.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-4-HERALD.md` — superseded predecessor (history, D-H decisions origin).
- `docs/EPIC-2.6-HERALD-MOVE-0.md` — Herald commercial packaging: ring nucleus, buy button, provisioning. Sibling, not child.
- `docs/EPIC-0-FOUNDATION-SPINE.md` — project root.
- `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` — the mouth; posting dependency.
- `docs/EPIC-2.3-ZENOD-MOVE-0.md` — memory unit + funnel machinery.

Cross-spine change rule: record proposed edits in Proposed Cross-Spine Updates; Jordi is the only router between tracks.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This spine | Herald intent, loop model, child-spine map, cross-child decisions, rollup state |
| Child spine (4.1–4.6) | Its own scope, ticket ledger, validation evidence |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Implementation that actually exists |
| `EPIC-2.6-HERALD-MOVE-0.md` | Nucleus, buy button, provisioning stack |
| `EPIC-0-FOUNDATION-SPINE.md` | Project direction and operating model |

## Mission

Herald is the first product on the engine: a project-voice agent running a **loop** — briefing-governed,
human-gated, self-measuring — over a real channel, as customer #0 on his own metered instance.
Epic 4 delivers the loop machinery *generically* (any loop expressible as briefing + boards + lanes,
zero engine changes) and Herald's posting loop *specifically* (the proof and the demo). Exit: the
wheel demonstrably turning — briefing negotiated to ✓, morning-N proposed with citations, approved
posts published with receipts, replies handled by policy, feedback filed, ≥1 weekly scorecard with
goal numbers — demo-able to a stranger.

## The Loop Model (settled 2026-07-10 — the design contract for all children)

Five primitives. The generality test for any new loop type: *can it be expressed with these five
and zero engine changes?*

1. **Briefing** — the contract: directives (style, periodicity, channels, length, reply cadence,
   reply policy all/few/most), metric definitions, goals (metric + target delta), benchmarks.
   Memory page one. **Structural rule: no lane fires without an approved briefing** — enforced in
   the loader, not by prompt.
2. **Boards** — named queues with states (e.g. proposed → approved → posted), stored as memory
   pages with frontmatter. Boards are how stages hand off without knowing about each other.
3. **Lanes** — YAML per H3-2 schema (`enabled`, `trigger`, `mission`, `model`, `toolbelt`,
   `budget`, `throttle`, `escalation`) extended with `reads`/`writes` (boards + briefing) and
   `approval: all|few|none` (where the human ✓ sits). Triggers: cron or board-event. Toolbelt and
   budget enforced at the gateway.
4. **Filings** — every lane files feedback, lessons, and snapshots to memory; the propose lane
   reads them next cycle. This closes the loop. No special mechanism — it is just memory.
5. **Scorecard** — a lane like any other: periodic, reads snapshots + briefing goals, reports
   to the human in chat.

**The briefing is the UI; YAML is compiled output.** Setup mode is a conversation state: the agent
refuses practice until briefing ✓; "change the briefing" re-enters negotiation; ✓ commits a new
briefing version and the agent regenerates its lane YAML. Hosted customers never see YAML;
self-hosters get the files.

**Two-layer law (inherited, binding on every child):** ENGINE (`zenod-ai/zenod`, open source) vs
CONFIG (`herald-brain`). Every ticket declares its layer. Engine tickets must be generic loop
primitives, never Herald features. Never fork the engine. Parked: N agents = N configs on one
engine — block nothing, build nothing for it yet.

## Definition Of Done

- [ ] Loop machinery generic: a second loop type (not Herald's) is expressible as briefing + boards + lane YAML with zero engine changes (paper exercise receipted in 4.2).
- [ ] Herald's briefing negotiated with Jordi to ✓ APPROVED and committed as memory page one.
- [ ] Morning-N arrives via chat, each proposal citing its memory source; "✓ 1,3 + N more" parses; reactions file to memory and visibly influence the next morning.
- [ ] Approved posts publish through Callisthenes with permalink receipts; unapproved never send.
- [ ] Replies handled per briefing reply policy, grounded in repo + memory; lessons filed.
- [ ] ≥1 weekly scorecard with goal numbers reconciling against receipts.
- [ ] Herald live as customer #0 on Zenod's own account (D-H1), on his own metered instance, first clean week receipted (H3-5 criteria).

## Non-Goals

- Ring nucleus, buy button, provisioning stack, pricing — owned by `EPIC-2.6`.
- Metering machinery — Epic 2's D-5 seam; we consume, never build.
- New UI — v0 is chat (WhatsApp); no settings screen, no board web UI.
- Multi-agent cookie-cutter tooling (N configs) — design-compatible, not built.
- Keyring/classifier/attention/council — 2.7 territory.

## Child-Spine Map (Cut A: by loop anatomy, decided 2026-07-10)

| Child | Layer | Scope | Absorbs | Status | Spine |
|---|---|---|---|---|---|
| 4.1 Briefing & setup mode | engine + config | Briefing schema (directives, metrics, goals, benchmarks); setup-mode conversation flow; ✓ versioning; no-briefing-no-fire enforcement hook | H3-3 AC1 | draft — spine not yet spawned | tbd `docs/EPIC-4.1-BRIEFING.md` |
| 4.2 Lane runtime | engine | `lanes/` dir, YAML schema, loader + validation, deterministic scheduler, gateway-enforced toolbelt/budget, escalation; generality paper test | H3-2 (all ACs) | draft | tbd `docs/EPIC-4.2-LANE-RUNTIME.md` |
| 4.3 Boards & approval | engine | Board primitive (memory pages + states), board-event triggers, `approval` policy field, ✓-parsing ("✓ 1,3 + five more") | H3-3 AC4 | draft | tbd `docs/EPIC-4.3-BOARDS.md` |
| 4.4 Herald's lanes | config | Four mission prompts (proposer / poster / replier / distiller), lane files with guardrails (pace, never-list, sour-thread ✋), reply grounding via repo + memory | H3-3 AC2-3,5 | draft | tbd `docs/EPIC-4.4-HERALD-LANES.md` |
| 4.5 Scorecard | engine + config | X engagement reading, post log, snapshot lane, weekly report lane | H3-4 (all ACs) | draft | tbd `docs/EPIC-4.5-SCORECARD.md` |
| 4.6 Instance & go-live | ops | Herald's independent instance (image, vault, channel, meter identity), provisioning recipe, dry-run, Jordi flips live, first clean week | H3-1 + H3-5 | draft | tbd `docs/EPIC-4.6-GO-LIVE.md` |

Dependency order: 4.2 is the engine critical path; 4.1 and 4.6-instance can start in parallel;
4.3 rides on 4.2; 4.4 needs 4.1+4.2+4.3; 4.5 needs 4.4 posting; 4.6-flip is last and Jordi's.
4.4 posting additionally blocks on Callisthenes (2.4 C-1) being tester-green — same gate as 2.6's H-4.

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | This spine §Loop Model + §Child-Spine Map | The design contract and the decomposition | Always |
| 2 | `docs/EPIC-4-HERALD.md` | Superseded predecessor: D-H decisions, H3 ticket detail, engine-state verification | Always |
| 3 | `docs/HANDOVER-I9.md` Part 2 (§7–10, B1–B4) | Lane YAML schema and runtime design | 4.2 / 4.3 workers |
| 4 | `docs/loop-product-promo-v4.html` | Product story; briefing card rows | 4.1 / 4.4 workers |
| 5 | `docs/EPIC-2.6-HERALD-MOVE-0.md` | Sibling: nucleus, buy button, `units/herald/` scaffold | When touching container/seams |
| 6 | `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` | Posting dependency and its C-1 gate | 4.4 / 4.5 workers, tester |

## Current State

Phase: planning
Last verified: 2026-07-10 03:58 CEST
Integration target: main
Fresh base commit: `468095d`
Next action: dispatch the loop-core PoC worker (`docs/EPIC-4.2-POC-LOOP-CORE.md`); spawn 4.1/4.2 spines with the PoC as 4.2's first installment.
Blockers: none at root level. 4.4 posting pre-blocked on 2.4 C-1 tester-green (2 reds as of 2026-07-08: #635 build, #636 chat-auth).

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-04 | D-H1 · Herald v0 runs Zenod's own account — customer #0 dogfood | Real audience → real metrics; demo material | `EPIC-4-HERALD.md` §DECISIONS |
| 2026-07-04 | D-H2 · Post sooner; soak-reset risk explicitly accepted by Jordi | Jordi's call, recorded against recommendation; dry-run-first + Jordi-flips remain mandatory | `EPIC-4-HERALD.md` §DECISIONS |
| 2026-07-04 | D-H3 · Herald's vault = fresh repo `herald-brain` | Cookie-cutter proof; clean meter/credential separation | `EPIC-4-HERALD.md` §DECISIONS |
| 2026-07-10 | D-4.0-1 · Loop model = five primitives (briefing, boards, lanes, filings, scorecard); generality test = zero engine changes for a new loop type | One engine, any loop | This spine §Loop Model |
| 2026-07-10 | D-4.0-2 · The briefing is the UI; lane YAML is compiled output; setup mode is a conversation state gated on ✓ | No settings screen in v0; hosted users never see YAML | This spine §Loop Model |
| 2026-07-10 | D-4.0-3 · Decomposition = Cut A (by loop anatomy) with the two-layer law as a per-ticket invariant | Demoable increments + never-fork discipline at ticket level | Session 2026-07-10 |
| 2026-07-10 | D-4.0-4 · This spine supersedes `EPIC-4-HERALD.md`, absorbing D-H1..3 and mapping H3-1..5 into children | Single authoritative Herald root in EpicSpine format | Jordi, session 2026-07-10 |
| 2026-07-10 | D-4.0-5 · PoC-first: build loop-core as a pure library with four ports (Memory/Agent/Channel/Clock) in `spikes/loop-core/`, LLM via plain script, fake channel, simulated clock; lift core into 4.2 unchanged, integration = adapter swaps | Prove loop mechanics + generality without deployment machinery; de-risk 4.2 | `docs/EPIC-4.2-POC-LOOP-CORE.md` |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | Planner | Epic 0 worker 4.0 | Spawn 4.2 lane-runtime child spine | draft | D-4.0-3, loop-core PoC | - | `468095d` | Child spine exists, validated, worker-bindable | - | 2026-07-10 03:58 CEST | Draft with Jordi |
| draft | Ticket worker | unassigned | loop-core PoC per `EPIC-4.2-POC-LOOP-CORE.md` | draft | D-4.0-5 | - | `468095d` | Spec's 7 ACs, incl. config-only newsletter loop + zero-imports-outside-ports lint | - | 2026-07-10 04:15 CEST | Dispatch a worker (spike branch) |
| draft | Planner | Epic 0 worker 4.0 | Spawn 4.1 briefing child spine | draft | D-4.0-3 | - | `468095d` | Child spine exists, validated, worker-bindable | - | 2026-07-10 03:58 CEST | Draft with Jordi |

Ticket-level ledgers live in child spines once spawned; this root ledger tracks only root-scope work.

## Branch And Integration

- Default integration branch: `main` (zenod); `herald-brain` main for config once it exists.
- One ticket worker per dedicated branch; concurrent workers in separate worktrees.
- Engine PRs ride normal CI; during any active soak, deploys ride C-23/C-07a spot-checks (inherited soak rule).
- Gates: review (PR open, checks green) → testing (exact commit in named surface) → done (acceptance passed, evidence linked, spine reconciled).

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Briefing approval | Jordi | 4.1 negotiation complete | ✓ APPROVED on briefing v1 (becomes memory page one) | Engine work (4.2, 4.3) |
| Lane enablement | Jordi | Any lane file with `enabled: true` | Explicit per-lane enable (enable-once + guardrails; no per-item approvals) | Everything else |
| Go-live flip | Jordi personally | Dry-run day clean (4.6) | Single config change, receipted with date/SHA | Nothing downstream until flipped |
| Cross-track asks | Jordi | Any requirement on Epic 2 / 2.4 / 2.6 | Jordi routes; children write requirements here, never cross lanes | Independent child work |
| Post approvals (steady state) | Jordi / customer | Every morning-N until unattended soak passes | ✓ selection in chat (supervised per HD-2) | Proposal generation |

## Recovery And Takeover

Stale assignment policy: a root-scope assignment untouched for 7 days may be marked superseded and re-dispatched; preserve history and record the takeover.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | - |

## Planner Queue

- Spawn 4.2 and 4.1 child spines (next session).
- 4.3 open design question: board = one memory page per item vs one page per board with item list — decide in 4.3 spine, constraint: board-event triggers must be cheap to detect.
- Pick the second loop type for the 4.2 generality paper test (candidates: newsletter loop, inbox-triage loop).
- Confirm with Jordi where 2.6's H-2 (Herald guy container scaffold in `units/herald/`) hands over to 4.x: proposal — 2.6 owns the container shell + seams; 4.x owns everything the container *does* (briefing, lanes, practice).

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| - | - | - | - | - | - | none yet at root level |

## Open Questions

- Board storage shape (see Planner Queue). Owner: 4.3 planner. Needed by: 4.3 spawn.
- Does the briefing schema need per-lane overrides (e.g. reply policy differing per channel)? Owner: 4.1 planner. Needed by: 4.1 acceptance freeze.
- Handover boundary with 2.6 H-2 (see Planner Queue). Owner: Jordi. Needed by: 4.4 spawn.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-4-HERALD.md` | Append-zone note: "2026-07-10 · Jordi · Superseded by `docs/EPIC-4.0-HERALD.md` (D-4.0-4). D-H1..3 absorbed; H3-1..5 mapped to children 4.1–4.6. This doc is historical record; no new tickets here." | This spine | Jordi | proposed |
| 2026-07-10 | `docs/EPIC-0-FOUNDATION-SPINE.md` | Add `docs/EPIC-4.0-HERALD.md` to read-only linked spines / child map, replacing or alongside the 2.6 Herald link | This spine | Foundation steward | proposed |

## Handoff Journal

### 2026-07-10 - Epic 0 worker (Fable session) - Root spine created

Context: Session with Jordi generalized the Herald loop into the five-primitive model (§Loop Model),
settled Cut A decomposition with the two-layer invariant, and decided supersession of
`EPIC-4-HERALD.md`. Engine gap verified against `EPIC-4-HERALD.md` append zone: no `lanes/` runtime
exists; `parseRunBudget` present in `scripts/backlog-monitor.mjs`.
Next: spawn 4.1 + 4.2 child spines; Jordi commits the two proposed cross-spine notes.
Risks: overlap ambiguity with 2.6 H-2 until the handover boundary question is answered; 4.4 posting
gated on 2.4 C-1.
Assignment identity: Jordi + bound Fable session (this conversation).
Branch / latest commit: main / `468095d` (doc-only change, uncommitted).
Last verified: 2026-07-10 03:58 CEST.
Links: `docs/EPIC-4-HERALD.md`, `docs/EPIC-2.6-HERALD-MOVE-0.md`, `docs/HANDOVER-I9.md` Part 2 (lane schema B1–B4).

## Appendix

- Loop anatomy diagram produced in session 2026-07-10 (chat); reproduce into a doc if needed.
- Loop-type generality worked examples (from session): newsletter loop (weekly propose-1 → approval → send → open-rate snapshot), inbox-triage loop (event-triggered classify → reply drafts → ✓ → send). Both expressible with the five primitives.
