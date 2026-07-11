# EPIC 4.2 · loop-core PoC — loop mechanics outside the harness

Parent: [EPIC-4.0-HERALD.md](EPIC-4.0-HERALD.md)
Status: active
Created: 2026-07-10
Updated: 2026-07-11
Repository: `zenod-ai/zenod`
Primary document: `docs/EPIC-4.2-POC-LOOP-CORE.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: 4.2 delivery manager (current Codex session)
Steward since: 2026-07-10 22:32 CEST
Last reconciled commit: `99700d0`
Planner: Jordi + 4.0 steward
Worker: unassigned
Tester: unassigned
Home: `spikes/loop-core/` (TypeScript — same language as the engine so the core moves over verbatim)

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Epic 0 worker | Jordi + 4.0 steward | `docs/EPIC-4.0-HERALD.md` | Own parent rollup, cross-child decisions, and child-spine map. | Parent state current; cross-spine decisions routed. |
| Planner | Jordi + 4.0 steward | Accepted 4.2 PoC scope | Product/scope acceptance and cross-spine decisions. | Accepted scope and human gates clear. |
| Epic worker | 4.2 delivery manager (current Codex session) | This spine and the loop-core PoC | Act as delivery lead and spine steward; create/update issues within accepted scope, dispatch ticket workers, reconcile branch/PR/evidence state. | Spine ledger, dispatch state, blockers, tested commit/environment, next action. |
| Ticket worker | unassigned | loop-core PoC implementation | Execute dedicated branch, keep detailed logs in issue/PR, no parent-spine edits. | PR/branch, latest commit, validation notes, blocker, next action in issue/PR. |
| Tester | unassigned | PoC acceptance and import-purity proof | Validate exact commit against this spine; do not change implementation behavior unless reassigned. | Commit, environment, commands, results, residual risk. |
| Reviewer | unassigned | 4.2 design and implementation | Read and report findings; no mutation unless promoted. | Findings and proposed next actions. |

## Write Scope

Bound spine: `docs/EPIC-4.2-POC-LOOP-CORE.md`
Active steward: 4.2 delivery manager (current Codex session)

Writable by default:

- The active steward reconciles this spine: current state, issue ledger, decisions, validation evidence, blocker state, and handoff journal.
- Ticket workers write detailed execution state to their assigned GitHub issue or PR, then request steward reconciliation.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-4.0-HERALD.md` — parent Herald root spine.
- `docs/EPIC-4-HERALD.md` — superseded predecessor and H3 ticket history.
- `docs/HANDOVER-I9.md` — Part 2 lane foundation context.
- `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` — later posting dependency, not used by this PoC.
- `docs/EPIC-2.3-ZENOD-MOVE-0.md` — later memory adapter dependency, not used by this PoC.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless Jordi or the target steward explicitly grants write authority for that spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | 4.2 PoC intent, scope, acceptance, delivery state, issue ledger, and validation evidence |
| `docs/EPIC-4.0-HERALD.md` | Parent Herald intent, child-spine relationships, cross-child decisions, and rollup state |
| GitHub issue | Detailed execution state for one ticket |
| Branch / PR / code | Implementation that actually exists |
| Validation evidence | What passed or failed for an exact commit in a named environment |

## Mission

Build a controlled, repeatable TypeScript rig in `spikes/loop-core/` that compiles versioned briefing fixtures into inspectable lane YAML, validates them, and runs briefing, boards, lanes, filings, and scorecard end to end through four ports (`Memory`, `Agent`, `Channel`, `Clock`). Core acceptance uses deterministic adapters and replayable fixtures. The PoC must prove the mechanics and generality claim cheaply, then provide a core that can move into the engine unchanged while engine adapters swap in later.

## Definition Of Done

- [ ] Malformed lane YAML is rejected with named errors; unknown toolbelt entries are rejected at load (H3-2 AC1 shape).
- [ ] A versioned setup fixture compiles into inspectable lane YAML, then validates and executes; golden YAML and run-trace snapshots prove identical output and state transitions across repeated clean runs.
- [ ] No lane fires without `approved: true` briefing; flipping approval off mid-run halts the next tick with a run-log receipt.
- [ ] Simulated week of the Herald loop runs: briefing negotiated to approved in terminal, morning-N proposals cite memory sources, CLI approval selects items, fake posts receive permalink anchors, seeded replies are answered per policy, feedback filings appear as memory diffs, and scorecard numbers reconcile against the timeline.
- [ ] An unapproved item never reaches `timeline.md`, with an absence receipt.
- [ ] A lane attempting an off-allowlist tool is blocked by the Agent adapter with a receipt (H3-2 AC3 shape, adapter-level).
- [ ] Newsletter loop runs with config-only changes: zero changes to `core/` or `adapters/` after the Herald loop works.
- [ ] `core/` has zero imports outside the four ports, enforced by a lint/test.

Core acceptance runs offline with a scripted Agent, fixed Clock, resettable fixtures, and golden snapshots. A live Anthropic adapter run is optional integration evidence and cannot gate acceptance.

## Non-Goals

- Real X, WhatsApp, containers, metering, provisioning, production persistence, parallelism, or durable-executor recovery semantics.
- Gateway-level toolbelt enforcement. The PoC enforces toolbelt restrictions in the Agent adapter; 4.2 engine integration later moves the enforcement point to the gateway with the same interface.
- Herald-specific product configuration beyond the minimal sample loop needed to prove the generic runtime.
- General 4.1 setup-mode product work. This PoC owns only the smallest briefing-to-YAML compiler needed for end-to-end testing and hands it to 4.1 as seed code.
- Editing parent, sibling, or Epic 2 spines from this 4.2 delivery role.

## Current State

Phase: planning
Last verified: 2026-07-10 22:32 CEST
Integration target: main
Fresh base commit: `99700d0`
Next action: create/confirm the implementation ticket, create dedicated branch `codex/epic-4.2-loop-core-poc`, then dispatch the loop-core PoC worker.
Blockers: none for PoC planning. No LLM credential is required for acceptance; live Anthropic evidence is optional and separately gated.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Epic 0 worker | Keep the 4.x child-spine system coherent. | Parent rollup updated or cross-spine decision routed. |
| Planner | Keep 4.2 scope accepted and executable. | Scope stable, human gates clear, no unowned acceptance criteria. |
| Epic worker | Deliver the scoped 4.2 PoC through issue/subagent loop. | Ready for tester handoff, ready for human test, or blocked with precise required input. |
| Ticket worker | Implement the loop-core PoC. | PR/branch ready for testing or blocked with required input. |
| Tester | Prove pass/fail against the seven DoD criteria. | Acceptance passed, evidenced failure, or planner decision required. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | `docs/EPIC-4.2-POC-LOOP-CORE.md` | Bound 4.2 scope, acceptance, ledger, and delivery state | Always |
| 2 | `docs/EPIC-4.0-HERALD.md` | Parent loop model, child decomposition, human gates, and rollup rules | Always |
| 3 | `docs/HANDOVER-I9.md` Part 2 (§7–10, B1–B4) | Original lane YAML/runtime design: schema, scheduler, toolbelt/budget, escalation | Worker |
| 4 | `docs/EPIC-4-HERALD.md` | Historical H3 ticket acceptance and decisions D-H1..D-H3 | Planner / reviewer |
| 5 | `skills/epic-spine/scripts/validate_spine.py` | Structural validation for this spine | Steward |

## Architecture And Context

### One Design Rule

`loop-core` is a pure library. All I/O goes through four ports. The PoC and the engine are two adapter sets around the same core. If the core imports a network client, filesystem call, or timer directly, the spike has failed its purpose.

```text
loop-core (pure)                     ports                PoC adapter              engine adapter (later)
- briefing store + versioning
- board load/transition/query        Memory  get/put/list  markdown files in dir   Zenod unit (MCP seam)
- briefing-to-YAML compiler
- lane loader + YAML validation      Agent   runMission()  scripted fake (core)    guy container / durable executor
- scheduler tick (cron + board-      Channel send/fetch    fake-X: timeline.md +   Callisthenes unit (MCP seam)
  event triggers)                                          seeded reply files
- no-briefing-no-fire gate           Clock   now()/tick()  simulated time          real cron
- toolbelt/budget check at dispatch
- filings (feedback/snapshot pages)
```

### PoC Shape

- One repo dir, `spikes/loop-core/`: `core/` (the library), `adapters/poc/`, `cli.ts`, `loops/` (config).
- Agent: a scripted fake is the core acceptance adapter. A direct Anthropic adapter may provide optional integration evidence. Both enforce the lane's allowlisted tools and budget contract at the adapter boundary.
- Memory: a folder of markdown pages with frontmatter. Briefing is `memory/briefing.md` with `approved: true|false` and version.
- Boards: `memory/boards/proposals.md`, `approved.md`, `posted.md`; items as frontmatter blocks with ids and states.
- Channel (fake X): posting appends to `world/timeline.md` and returns anchor permalinks. Replies are seeded by dropping files into `world/replies/`.
- Human gate: CLI setup mode negotiates the briefing to approved. Approvals such as `✓ 1,3 + 2 more` are parsed at the prompt and reused later by 4.3.
- Clock: simulated. `cli.ts run --days 7` fast-forwards and fires lane cron in order; `--step` advances one tick for debugging.
- Replay: each scenario starts from a clean versioned fixture and writes generated YAML, run trace, state transitions, receipts, and final files for golden comparison.

### Loops To Run

1. Herald posting loop (`loops/herald/`): briefing + four lanes — propose (daily, N proposals citing memory sources), publish (hourly, drains approved board), reply (board-event on new replies, applies reply policy, files lessons), scorecard (weekly, goals vs snapshots).
2. Newsletter loop (`loops/newsletter/`): weekly propose-1-draft, approval, send, open-rate snapshot (faked). Acceptance: zero changes to `core/` or `adapters/`, config only.

### Integration Path

- `core/` moves into the engine as the lane runtime.
- Adapter swaps: Memory to Zenod seam, Channel to Callisthenes seam, Agent to durable executor plus gateway, Clock to cron. Each swap is one adapter file; core remains untouched.
- The CLI setup-mode conversation and approval parser become 4.1/4.3 seed code because they talk through ports.
- The minimal briefing-to-YAML compiler is explicitly 4.1 seed code, not a general setup-mode implementation owned by 4.2.

## Decisions

| Date | Decision | Rationale | Evidence |
|---|---|---|---|
| 2026-07-10 | D-4.2-1 · Start with a PoC outside the harness in `spikes/loop-core/` | Prove mechanics and generality without deployment, container, WhatsApp, or engine runtime noise | This spine; `docs/EPIC-4.0-HERALD.md` D-4.0-5 |
| 2026-07-10 | D-4.2-2 · `loop-core` is pure TypeScript with four ports: Memory, Agent, Channel, Clock | Keeps the core portable into the engine and makes adapter swaps explicit | This spine §Architecture And Context |
| 2026-07-10 | D-4.2-3 · Newsletter loop is the generality receipt | It is meaningfully not Herald while still expressible with briefing, boards, lanes, filings, and scorecard | This spine §Definition Of Done |
| 2026-07-11 | D-4.2-4 · Core acceptance is deterministic compile-and-replay; live LLM evidence is optional | Proves the full `briefing → YAML → runtime` model repeatedly without credentials or model variance; the minimal compiler is handed to 4.1 as seed code | Parent D-4.0-6; this spine §Definition Of Done |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| draft | Ticket worker | unassigned | Implement loop-core PoC in `spikes/loop-core/` | draft | D-4.2-1, D-4.2-2, D-4.2-4 | proposed `codex/epic-4.2-loop-core-poc` | pending refresh | All eight Definition Of Done criteria pass with receipts | - | 2026-07-11 00:20 CEST | Refresh base, create/confirm GitHub issue and branch, then dispatch worker |
| draft | Tester | unassigned | Validate loop-core PoC acceptance | draft | implementation ticket ready for test | - | pending refresh | Independent pass/fail against eight DoD criteria, including deterministic replay and import-purity test | - | 2026-07-11 00:20 CEST | Dispatch after implementation PR is ready |

## Branch And Integration

- Default integration branch: `main`.
- Proposed implementation branch: `codex/epic-4.2-loop-core-poc`.
- Worker isolation: one ticket worker for the PoC branch. If follow-up tickets split out later, concurrent workers use separate worktrees.
- Dispatch record must include branch, base commit, integration target, owner, latest verified time, and whether live LLM credentials were used.
- Review gate: implementation complete, PR open, and required automated checks passing.
- Testing gate: exact commit available locally or in PR; seven acceptance criteria validated with command receipts and output artifacts.
- Done gate: acceptance passed, evidence linked, residual risk recorded, and this spine reconciled.
- Integration rule: merge only after the tester records exact commit, environment, commands, and result.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Scope change | Jordi / 4.0 planner | Worker discovers a need to change the five-primitives model, ports, or DoD | Explicit approval in this spine or parent | Implementation within current scope may continue if separable |
| Live LLM credential use | Jordi | Worker wants to run direct Anthropic adapter live instead of fake-agent tests | Confirm credential availability and acceptable spend | Deterministic fake-agent implementation and tests |
| Engine integration | Jordi / 4.0 planner | PoC passes and worker proposes moving `core/` into engine runtime | Approval of follow-up child/ticket boundary | PoC documentation and tester handoff |

## Recovery And Takeover

Stale assignment policy: if the implementation assignment is untouched for 7 days or lacks branch/PR evidence after dispatch, the delivery manager may mark it superseded and re-dispatch from the latest `main`.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | - |

## Planner Queue

- Confirm whether to create a GitHub issue now or keep the implementation ticket as a draft row until branch work begins.
- After PoC evidence exists, propose the follow-up engine-integration child/ticket boundary to the 4.0 steward.

## Worker Queue

- Create `spikes/loop-core/` with `core/`, `adapters/poc/`, `loops/herald/`, `loops/newsletter/`, and `cli.ts`.
- Implement the minimal versioned briefing-to-YAML compiler as 4.1 seed code.
- Implement lane YAML schema, loader, validation errors, toolbelt validation, and budget/throttle shape.
- Implement pure scheduler, briefing approval gate, board transitions, filings, scorecard, and fake channel.
- Add import-purity lint/test proving `core/` has no direct I/O imports outside the four ports.
- Add clean-reset fixtures and golden generated-YAML/run-trace snapshots for repeatable Herald and newsletter runs.
- Add run-log receipts for the Herald week, unapproved-absence test, off-toolbelt block, and newsletter config-only run.

## Tester Queue

- Run structural spine validation.
- Run repository test suite relevant to the spike.
- Run PoC CLI/tests for all eight Definition Of Done criteria.
- Run each golden scenario twice from clean state and prove generated YAML, transitions, receipts, and final files are identical.
- Inspect generated `timeline.md`, board pages, filings, run logs, and scorecard output.
- Confirm newsletter acceptance by verifying no changes to `core/` or `adapters/` are needed after the Herald loop works.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | 4.2 delivery binding | `99700d0` | local repo | Read spine, parent, and Handover I9; checked for existing loop-core/lanes artifacts | pass | No existing `spikes/loop-core/` or `lanes/` artifacts found |

## Handoff Journal

### 2026-07-10 - 4.2 delivery manager - Stewardship binding established

Context: Jordi bound the current Codex session as delivery manager after asking to inspect spine 4.2. The existing 4.2 artifact was a focused PoC spec, while the parent 4.0 root listed 4.2 as draft and the PoC as the next dispatch item.
Next: create/confirm implementation issue, create dedicated branch `codex/epic-4.2-loop-core-poc`, dispatch worker, then reconcile branch/PR/evidence into this spine.
Risks: live LLM credential/spend expectations are not yet settled; deterministic fake-agent testing can cover most acceptance before live adapter runs. The current file is untracked in git and parent 4.0 has local modifications, so branch/commit hygiene needs attention before dispatch.
Assignment identity: 4.2 delivery manager (current Codex session).
Branch / latest commit: main / `99700d0` observed HEAD.
Last verified: 2026-07-10 22:32 CEST.
Links: `docs/EPIC-4.0-HERALD.md`, `docs/HANDOVER-I9.md`, `docs/EPIC-4-HERALD.md`.

## Open Questions

- Should the implementation ticket be created in GitHub immediately, or kept as a draft ledger row until the branch is cut? Owner: 4.2 delivery manager. Needed by: dispatch.
- Should the eventual engine integration be a continuation of this spine or a separate `docs/EPIC-4.2-LANE-RUNTIME.md` child after PoC pass? Owner: Jordi / 4.0 steward. Needed by: post-PoC planning.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-10 | `docs/EPIC-4.0-HERALD.md` | Replace the 4.2 child-spine row's `tbd docs/EPIC-4.2-LANE-RUNTIME.md` with this active PoC spine as the current 4.2 delivery surface, or explicitly distinguish PoC spine from later lane-runtime integration spine. | This spine | 4.0 steward / Jordi | proposed |

## Appendix

- Parent root current state at binding time: `docs/EPIC-4.0-HERALD.md` says next action is to dispatch the loop-core PoC worker and spawn 4.1/4.2 spines with the PoC as 4.2's first installment.
- Handover I9 Part 2 B1-B4 source acceptance: lane YAML schema (`enabled`, `trigger`, `mission`, `model`, `toolbelt`, `budget`, `throttle`, `escalation`), deterministic scheduler, gateway-enforced toolbelt/budget, escalation wiring, and live lane enablement discipline.
