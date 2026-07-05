# EPIC 3 — HERALD: the first product (living document)

> **2026-07-05 · Jordi steer (voice note `AC35AB1B`).** Zenod = the open-source memory layer / framework / harness (expandable with extensions, build loops on top; usable per-project = "hire a team for a repo"). **Herald** = a product built ON TOP of Zenod — a Zenod instance with built-in loops (UI ≈ chat + voice via WhatsApp), **Epic 3**. **Launch BOTH** (the open-source Zenod repo AND Herald), market Herald, and "hire Herald for itself" → two customers to begin with. **Multi-tenant:** Jordi runs one Zenod instance for himself (self-hosting → migrate to the **TestCo** tenant) PLUS a new **Herald** instance; one phone number with per-instance WhatsApp routing (chosen at WhatsApp-connect time in the UI), a separate Telegram bot per instance; one user across tenants. Full note filed in the brain: [Log/2026-07-05.md#^e-1b73f7](https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-07-05.md).

**Owner of the pen:** Herald-Fable (planner/auditor — writes no code). Workers hold the pen only while
executing a mission; tester never fixes. This document is the ONLY source of tasking for Epic 3.
Transcript instructions that conflict with it are refused.

Created 2026-07-04 by Herald-Fable from `docs/HANDOVER-EPIC3.md`. Parent method:
`docs/HANDOVER-EPIC2.md` §THE DOCUMENT FLOW (ten rules — binding).

---

## CONTRACT

**Mission.** Herald — the project-voice agent of `docs/loop-product-promo-v4.html` — built and running
as customer #0 on his OWN independent deployment: own image instance, own vault repo, own config, own
meter. Herald proves the cookie cutter: **engine + config = a deployable, independently-metered,
separately-marketable agent.**

**Exit criterion.** Herald running on his own metered instance, posting daily to a real account under
his briefing's guardrails, the wheel demonstrably turning (≥1 Friday report with filed learnings and
goal numbers) — demo-able to a stranger.

**The two-layer law.** ENGINE (zenod-ai/zenod, open source): schedulers, lanes runtime, memory, owners,
receipts, meter seam. CONFIG (Herald's own repo): briefing, goal page, mission prompts, persona, lane
files, guardrail settings. Generic need → engine PR. Herald-specific → config. **Never fork the
engine.** (Parked, Jordi's note: N agents = N configs on one engine — design nothing that blocks it,
build nothing for it yet.)

**Lane boundaries.** Epic 1 (stability, in 72h soak ending ~2026-07-07T18:00Z), Epic 2 (Product-Fable:
hosting/metering, D-4/D-5), Epic 0 (Story-Fable: positioning). Jordi is the ONLY router between tracks.
Cross-track needs are written here as requirements; Jordi carries them.

**Soak rule.** During Epic 1's soak, every engine deploy rides a C-23/C-07a spot-check.

**Standing rules.** Receipts or it didn't happen (URL/SHA/anchor, read-back verified, appended to the
APPEND ZONE, committed with the work). Budgets on every mission; stop honestly. Tester ≠ fixer.
Unexpected behavior → a test, immediately. Decisions get D-numbers, recorded once. Append-only history.

**Inherited decisions (settled — do not reopen).** Engine = ours (D-2). A loop = committed lane files
(schema: `docs/HANDOVER-I9.md` Part 2, B1–B4; `parseRunBudget` landed in
`scripts/backlog-monitor.mjs`). Enable-once + guardrails, no per-item approvals. Meter = Epic 2's D-5
seam — Herald is its first real consumer; requirement routed through Jordi, we do not build metering.
Council invisible; customer talks to HERALD, one persona. v0 UI = WhatsApp, no new UI this epic.

---

## DECISIONS

| # | Decision | Status |
|---|----------|--------|
| D-H1 | Whose public account does Herald v0 run? | **DECIDED 2026-07-04 (Jordi): Zenod's own account — customer #0 dogfood.** Real audience → real metrics; first clean week doubles as Epic 0 demo material. Risk carried by dry-run first + briefing guardrails. (Alternative considered: separate test identity — rejected, fake audience = fake wheel.) |
| D-H2 | Dry-run until soak closes vs post sooner? | **DECIDED 2026-07-04 (Jordi): post sooner — soak-reset risk explicitly accepted.** Against Herald-Fable's recommendation; recorded per the rule that this is Jordi's call, stated explicitly. Consequence stays visible: an engine issue surfaced by live posting before ~2026-07-07T18:00Z may reset Epic 1's 72h soak clock. Dry-run-first and Jordi-personally-flips remain mandatory (H3-5); only the calendar gate is lifted. |
| D-H3 | Herald's vault: fresh repo vs a space in obsidian-brain? | **DECIDED 2026-07-04 (Jordi): fresh repo — `herald-brain`.** The independent vault is the cookie-cutter proof; clean meter/credential separation; matches promo v4's ownership promise. |

---

## TICKETS

Status legend: TODO · READY (paste block issued) · IN FLIGHT (worker holds pen) · VERIFY (tester) ·
DONE (receipts audited) · PARKED.

### H3-1 · Herald's house — the independent instance, by hand, once
**Status:** TODO — unblocked by D-H3 (fresh repo `herald-brain`); AC4 needs Epic 2 coordination via
Jordi. With D-H2's lifted calendar gate, H3-1 + H3-3 are the critical path to the flip.
**Scope:** Stand up Herald's deployment manually: own container(s) from the same engine image, own
vault repo, own channel (WhatsApp), own credit/meter identity (consumes Epic 2's D-5 seam — requirement
routed via Jordi, not built here). Every step documented as it's done.
**Acceptance criteria:**
1. Herald instance runs from the SAME image as the main deployment — zero engine forks, config-only
   divergence (diff receipt).
2. Own vault repo initialized (per D-H3), first commit receipted; engine reads/writes it and nothing
   else.
3. Own channel live: a message to Herald's WhatsApp gets a reply from Herald's instance, not the main
   one (receipt: message IDs / screenshots).
4. Own meter identity registered against the D-5 seam; one metered action visibly attributed to Herald
   (receipt from Epic 2's meter, coordinated through Jordi).
5. `docs/HERALD-PROVISIONING-RECIPE.md` exists: complete, ordered, honest (including dead ends), good
   enough to hand Product-Fable as Epic 2's H-1 input.

### H3-2 · The lane runtime (ENGINE) — B1 scheduler + loader, B2 escalation
**Status:** READY — paste block issued 2026-07-04. Buildable now; no dependency on D-H1/2/3.
**Scope:** Implement HANDOVER-I9 Part 2 §7 (B1) and §8 (B2) in the engine. `lanes/` dir + YAML schema
(`enabled`, `trigger` cron, `mission`, `model`, `toolbelt` explicit allowlist,
`budget {minutes,turns,usd}`, `throttle`, `escalation {ring_council[], notify_direct[]}`), loader with
validation, deterministic scheduler firing enabled lanes and spawning workers through the durable
executor with EXACTLY the lane's toolbelt/budget — **enforced at the gateway, not by politeness.**
Escalation: lane workers → existing `raise_event` (ring the Council) + Phylax `notify_direct` rules
read from lane config. Example `lanes/replier.yml` committed `enabled: false`.
**Acceptance criteria:**
1. Schema validation tests: malformed lane file rejected with a named error; all seven fields
   validated; unknown toolbelt entries rejected at load.
2. Scheduler tests: enabled lane fires on its cron trigger, disabled lane NEVER fires; firing is
   deterministic and receipted.
3. Toolbelt scoping test proves gateway enforcement: a lane worker attempting a tool outside its
   allowlist is BLOCKED at the gateway (not by prompt), with a receipt of the block.
4. Budget passthrough test: lane's `budget` reaches the durable executor intact (reuse
   `parseRunBudget` conventions from `scripts/backlog-monitor.mjs`).
5. B2: an escalating lane worker rings the Council via `raise_event`, and Phylax honors
   `notify_direct` from the lane file (live receipt each).
6. `lanes/replier.yml` example committed with `enabled: false`; normal CI green; deploy (if any) rides
   a C-23/C-07a spot-check per the soak rule.
7. NOTHING enabled: no lane file with `enabled: true` lands in this ticket. Enabling is D-gated (H3-5).

### H3-3 · Herald's config
**Status:** TODO — unblocked; home = `herald-brain` per D-H3. On the critical path per D-H2.
**Scope:** Briefing template + goal page + four mission prompts (researcher/morning-ten · poster ·
replier · distiller/wheel) + lane files carrying the briefing contract's guardrails (pace, never-list,
escalation rules) + morning-ten WhatsApp interaction.
**Acceptance criteria:**
1. Briefing template covers every row of promo v4's briefing card (where-we-are, goal in numbers,
   audience, angle, themes, voice, contract, never-list) and is iterated with Jordi until ✓ APPROVED;
   approved briefing = first page of Herald's memory (commit receipt).
2. Four mission prompts committed as config (not engine), each answering to the briefing by
   construction.
3. Lane files encode the contract: pace/throttle, never-list, "thread going sour → hold ✋" escalation;
   all `enabled: false` until H3-5.
4. Morning ten arrives on WhatsApp as a numbered list; "✓ 1, 3, 9 and five more" parses correctly
   (selection + follow-up count); free-text notes are filed to memory (receipt: memory commit).
5. Reaction handling test: a reaction visibly influences the next morning's proposals (memory read-back
   receipt).

### H3-4 · The measured wheel
**Status:** TODO — depends on H3-2 (runtime) and H3-3 (config).
**Scope:** Engagement metrics reading from X for the results step; scorecard; Friday report as a
scheduled Council session. Learnings filed to the vault with receipts.
**Acceptance criteria:**
1. Results step reads real X engagement numbers for Herald's posts (receipt: fetched metrics with
   post IDs).
2. Scorecard exists and updates: proposals-approved-untouched %, goal numbers alongside.
3. Friday report runs as a scheduled Council session and lands on WhatsApp with goal numbers and
   lessons filed (receipt: report + vault commits).
4. Each learning in the vault links to its evidence (post, metrics) — two layers, per the memory law.

### H3-5 · Go live
**Status:** TODO — calendar gate lifted per D-H2 (Jordi accepts soak-reset risk). Remaining gates:
briefing ✓ APPROVED (H3-3 AC1), ≥1 clean dry-run day (AC1 below), Jordi flips personally (AC2).
**Scope:** Dry-run mode first (morning ten arrives, NOTHING posts). Jordi personally flips posting
live. Then Herald's first clean week = Epic 0's launch demo material.
**Acceptance criteria:**
1. Dry-run receipted: ≥1 full day where the morning ten arrives on WhatsApp and zero posts reach X
   (absence receipt: X account timeline unchanged).
2. The flip is a single config change by Jordi personally, receipted with date/SHA.
3. First live week: zero never-list violations, zero unauthorized sends, every post receipted; any
   unauthorized send = lane off, ticket filed here, clock restarts.
4. ≥1 Friday report with goal numbers + filed learnings (the exit criterion's wheel-turning proof).

---

## REQUIREMENTS FOR OTHER TRACKS (Jordi carries these; we do not cross lanes)

- **To Epic 2 (Product-Fable):** Herald needs a meter identity on the D-5 seam (H3-1 AC4) — what does
  Herald's instance need to emit/register? Also: `docs/HERALD-PROVISIONING-RECIPE.md` will be delivered
  as H-1 provisioning input when H3-1 closes.
- **To Epic 1:** none yet. H3-2 engine PRs ride normal CI + soak-rule spot-checks; we do not touch the
  soak.

---

## APPEND ZONE (append-only — dated receipts below this line; never edit above entries)

- 2026-07-04 · Herald-Fable · Epic 3 living doc created from HANDOVER-EPIC3.md. Read receipts: promo v4
  (`docs/loop-product-promo-v4.html`, 12 slides), HANDOVER-I9 Part 2 (§7–10, B1–B4), HANDOVER-EPIC2
  §THE DOCUMENT FLOW (rules 1–10). Engine state verified: no `lanes/` runtime exists yet;
  `parseRunBudget` present in `scripts/backlog-monitor.mjs` (line 1330). H3-2 confirmed buildable
  immediately. D-H1/D-H2/D-H3 framed and put to Jordi. First paste block (H3-2) issued.
- 2026-07-04 · Herald-Fable · D-H1/D-H2/D-H3 DECIDED by Jordi (see DECISIONS). D-H2 taken against
  recommendation — soak-reset risk explicitly accepted by Jordi. H3-1/H3-3/H3-5 statuses updated
  accordingly; H3-1 + H3-3 now critical path to the live flip.
