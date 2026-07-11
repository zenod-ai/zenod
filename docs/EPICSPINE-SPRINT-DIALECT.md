# The Sprint Dialect — EpicSpine v2, as evolved under fire (2026-07-10/11)

Audience: the EpicSpine skill agent. Purpose: fold this dialect into `SKILL.md`, the templates, and the validator of `AlfaBlok/epicspine-skill`. This document is the complete specification; issues #3–#8 in that repo are the ticket-level breakdown of the same content. Exemplar spines (read them — they are the dialect in practice): `docs/EPIC-Z-NIGHT-SPRINT.md` (the archetype, completed successfully overnight), `docs/EPIC-C-CALLISTHENES-SPRINT.md`, `docs/EPIC-R-RING-SPRINT.md`, `docs/EPIC-P-PHYLAX-SPRINT.md` (a gated spine). Anti-exemplars (what v1 produced): `docs/EPIC-3.1-MCP-CHASSIS.md`, `docs/EPIC-3.2-ZENOD-MULTITENANT.md` — structurally valid, operationally catastrophic (~24 lost hours; postmortem in EPIC-3.0 decisions D19–D21 and issues #5/#6).

## Why the dialect exists — the failure it answers

EpicSpine v1 let a planner write a spine that was complete, valid, and disastrous: a Definition of Done shaped as an exhaustive property checklist; autonomy granted without time bounds; no rule that the human ever touches anything early; no rule pointing workers at existing code. Result, observed live: goal-seeking agents spent a full day producing 1,100+ green tests, security fixes, and evidence documents while the product owner could not open a single URL — and roughly a third of the work re-implemented code that already ran in production in a sibling repo. The dialect is the set of laws that made that failure structurally impossible, then delivered four product units in ~48 hours with the same workers.

The core inversion: **v1 spines specify a perfect end state and trust agents to pursue it. v2 spines specify a bounded, observable, human-verifiable increment and make everything else illegal.** A spine is a budget, not a wish list.

## The laws of the dialect

### 1. The journey IS the Definition of Done (supersedes property checklists)

The DoD has exactly two tiers:

- **SHIP** — one numbered customer journey (5–12 steps), walked by the epic worker itself in a REAL browser on the LIVE deployment, in a loop: walk → first breakage → fix exactly that → deploy → walk again FROM STEP 1 — until one uninterrupted clean pass, with a screenshot per step. Then the human walks the identical journey. SHIP's terminal artifact is the **test package**: "I manually walked the full journey and it works. URL + screenshots. Now you test."
- **HARDEN** — everything else, listed explicitly, and only startable after the human approves SHIP.

Rules attached: unit/integration test suites are supporting material, never the definition of done — full suites run at most once per frozen commit and never re-run for docs-only movement ("one world": the worker's test pass and the human's hand test happen on the same live surface, never a parallel local harness). Rationale: 1,100 green tests coexisted with a blank settings page and a broken checkout that the human found in sixty seconds of ordinary clicking; agents verify their list, humans walk the path — so force the agent to walk the path. (Issues #5, #7.)

### 2. Never ask the human to click the unclicked

Every element in any script or package handed to the human must have been exercised by the worker in that same deployed build. The handover sentence must be literally true. Violation observed: a click script whose step 4 opened a page its author had never opened; the page was blank. (Issue #7.)

### 3. PORT / DUPLICATE / BUILD markings on every deliverable (port-first)

Before authoring, the planner inventories ALL repos and running services the human operates for existing implementations. Every DoD item and ticket is marked `PORT from <repo>/<path>` (move code, adapt only imports/config), `DUPLICATE from <working unit>` (copy a proven component wholesale), or `BUILD (verified absent everywhere)`. An unmarked item is invalid. A worker who scratch-writes something marked PORT/DUPLICATE fails review — stated in the ticket-worker role binding itself. Best case observed: entire spines where nothing is BUILD. Failure it answers: a working login/billing layer existed in a sibling private repo the whole time; spines described the *behavior* instead of pointing at the *implementation*, so workers rebuilt it with new bugs. (Issue #8.)

### 4. Pre-answered Decisions table (the planner is asleep)

The spine carries a Decisions table answering every choice the manager could face — domain, credentials (with the exact location to READ them from existing deployments, never re-created, never requested from the human), pricing, sequencing, known-trap warnings from previous sprints — each with an absence-rule so missing input never stalls work. Closing clause, verbatim from the exemplars: *"Anything unanswered: simplest option, note it in the journal, keep moving."* The Open Questions section becomes: *"None permitted."* The spine replaces the planner at 3 a.m.

### 5. Shout your gates

Blocked on a human decision → the worker's ENTIRE next message is `BLOCKED ON JORDI: <one question + options + recommendation>` and that thread stops. Polishing adjacent work while parked at a human gate is a named defect. Failure it answers: a finished pilot sat silently behind an approval gate for hours while its worker kept hardening. Correspondingly, `human required` may never be a vague blocker — Human Gates rows name the owner, trigger, and the exact input. (Issue #5.)

### 6. Bounded, observable autonomy

- **Heartbeat**: every 30 minutes, one line — `lap/state | blocker | ETA`. Two consecutive ETA slips = stop and report options.
- **Budgets**: every ticket carries a time box (90 min default); the manager reassigns any ticket silent past budget (this replaces stale-assignment vagueness in Recovery And Takeover).
- **First touchable milestone**: work is sequenced so something the human can open exists as early as possible; hardening runs BEHIND a demo, never instead of one. Banned phrase: "no human in the loop." (Issue #5.)

### 7. Branch isolation (anti-ransom) + base pinning

- FIRST ACTION of every worker, stated in its role binding: `git worktree add ../wt-<ticket> -b <branch> <pinned-base>`. Running `git checkout`/`git switch` in the shared clone is a defect equal to editing another agent's spine — one worker's checkout silently moves every desktop agent sharing the clone ("branch ransom", observed). (Issue #3.)
- The base commit is PINNED at dispatch and recorded in Current State; no rebases until the journey passes. Waves that integrate re-pin explicitly ("Wave 2 base commit: <sha> — integrated wave 1, pinned"). Full gates run at most once per pinned base; two rebase-and-reprove laps force escalation to the planner; provider epics quiesce merges touching a consumer's surface while a pinned proof is in flight. Failure it answers: three "definitive" pilot branches, each re-running a full proof against a moved base. (Issue #5.)

### 8. Waves, not free-for-all

Tickets are grouped into explicit parallel waves chosen by file-surface disjointness (wave 1 tickets touch different directories), listed in Architecture And Context: "Wave 1: A ∥ B. Wave 2: C, D. Then the journey loop." The journey loop is always the last ticket and always belongs to the manager personally.

### 9. Manager mandate + prompts as artifacts

The epic worker is a MANAGER: mints tickets, dispatches parallel worktree workers, integrates PRs, deploys, walks the journey, iterates — stopping only at SHIP, a named Human Gate, or budget expiry. Stopping to ask anything answerable from the spine is a defect. The planner's highest-leverage output is the **paste-ready dispatch prompt** (bootstrap prompt) containing: bind instruction, spine path, the one-paragraph mission, the standard operational preamble (worktree law, heartbeat, BLOCKED-ON protocol, unclicked rule, PORT law), and "Go." Prompts live with the spine, versioned, not in chat history. (Issue #4.)

### 10. Proportional ceremony

Safety requirements scale with risk class: live customer data = full ceremony (snapshot, checksum, restore drill — drill proven ONCE per mechanism per epic, not per item); dead/test/reversible assets = snapshot-and-go; docs = none. Failure it answers: hours of surgical ceremony performed on confirmed-dead test containers. (Issue #6.)

### 11. Supersession hygiene + gated spines

When a spine replaces another, the old spine's `Status:` line is rewritten in place: `SUPERSEDED by <path> — do not execute from this document` (or CLOSED/ON-HOLD variants), so a cold agent bootstrapping from any stale document is redirected in its first ten lines. Spines may be authored `Status: pending — DISPATCH ONLY AFTER <condition>` with the gate named in Current State (see EPIC-P), letting the planner pre-write dependent epics without risking premature dispatch.

### 12. Numbered decisions + canonical artifacts (parent-spine features)

Parent/program spines carry decisions with stable IDs (D1…Dn) that child spines and dispatch prompts cite as law ("parent D19c applies"). A parent spine may declare a CANONICAL artifact (a deck, a spec) with an owner and change rule, so shared pictures have a steward like spines do. (Issue proposed in the #3–#8 set.)

### 13. Cross-sprint trap propagation

When a sprint discovers a bug class, the NEXT sprint's Decisions table pre-answers it (e.g., "Conduct kit: register async ticket shapes with receipt middleware BEFORE walking — the silent_ack lesson"). The dialect treats each sprint's journal as the next sprint's vaccination record.

## Template deltas (mechanical summary for the template/validator work)

| v1 section | v2 change |
|---|---|
| Definition Of Done | MUST be two-tier SHIP (numbered journey, walk-loop clause, test-package clause) + HARDEN. Validator warns on flat checklists. |
| Role Bindings | Ticket-worker row MUST contain the worktree first-action and the PORT-review rule. Epic-worker row MUST contain the manager mandate. |
| Current State | MUST record the pinned base commit ("pinned; no rebases until the journey passes") and per-wave re-pins. Gated spines name their dispatch condition here. |
| Decisions | New REQUIRED section: pre-answered table + the "simplest option, journal it, keep moving" catch-all. |
| Issue Ledger | Each row carries wave membership and PORT/DUPLICATE/BUILD marking (in the title or a column). |
| Human Gates | Every row names owner, trigger, exact input; blocked protocol stated. |
| Recovery And Takeover | Stale policy = "manager reassigns any ticket silent past its budget." |
| Open Questions | "None permitted" is the healthy state; questions belong in Decisions with absence-rules. |
| Status line | Supersession/gating vocabulary (SUPERSEDED/CLOSED/ON HOLD/pending-gated) is part of the contract. |
| Appendix | Inputs-from-human list where every item has an absence-rule; the dispatch prompt may live here. |

## Results, for the CHANGELOG

Under v1 authoring: ~24 hours, zero human-testable output, one architecture crisis. Under the dialect: Zenod shipped overnight (landing → GitHub sign-in → Stripe → dashboard → MCP, live, journey-proven), Callisthenes reached wave 2 within ~2 hours of dispatch with all tickets banking to main every few minutes, and the Ring/Phylax spines were authored dispatch-ready in one pass each. Same workers, same models, different documents. The dialect is the difference.
