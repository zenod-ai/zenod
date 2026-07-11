# EPIC 5 · Herald Sprint — duplicate the Ring, give it an agenda

Status: active — dispatch-ready (Jordi, 2026-07-11)
Created: 2026-07-11
Updated: 2026-07-11
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-5-HERALD-SPRINT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Herald delivery manager (bind on dispatch)
Steward since: on dispatch
Last reconciled commit: bind on dispatch
Planner: Jordi + Epic 3.0 planner
Worker: Herald delivery manager + parallel ticket workers
Tester: the delivery manager itself (journey walker)

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Planner | Jordi + Epic 3.0 planner | This spine | Wrote it; every decision pre-answered below. | This document. |
| Epic worker | Herald delivery manager | This spine | MANAGER: mint tickets, dispatch parallel worktree workers, integrate, walk the journey, iterate until SHIP. Stops only at SHIP, a named Human Gate, or budget expiry. | The test package. |
| Ticket worker | assigned per ticket | One ticket, own worktree | FIRST ACTION: `git worktree add ../wt-<ticket> -b <branch> <pinned-base>`. Never checkout in the shared clone. Anything marked PORT/DUPLICATE: move code, adapt only imports/config — a scratch-written line duplicating source is a failing review. | PR + one-line result. |

## Write Scope

Bound spine: `docs/EPIC-5-HERALD-SPRINT.md`
Active steward: Herald delivery manager (on dispatch)

Writable by default:

- The steward reconciles this spine; ticket workers write to their issues.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-R-RING-SPRINT.md` — the shipped Ring; THE UNIT this epic duplicates.
- `docs/EPIC-C-CALLISTHENES-SPRINT.md` — the mouth Herald posts through (via wallet).
- `docs/EPIC-Z-NIGHT-SPRINT.md` — the original template; customer-layer history.
- `docs/EPIC-4.0-HERALD.md` + `docs/EPIC-4.2-POC-LOOP-CORE.md` — DESIGN INHERITANCE ONLY (the five-primitive loop model, D-H1..D-H3). Do NOT execute their child maps, PoCs, or tickets. Leave those documents untouched.
- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — D19–D21 laws apply verbatim.

Cross-spine change rule: read linked spines for context; record proposed edits here. Never edit 4.x documents.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Product shape, journey, PORT/DUPLICATE/BUILD markings, pre-made decisions |
| `docs/EPIC-R-RING-SPRINT.md` + the live ring unit | The agent/chat/wallet/customer layer being duplicated |
| `docs/EPIC-4.0-HERALD.md` §Loop Model | The five-primitive design contract (briefing, boards, lanes, filings, scorecard) — design law, not an execution plan |
| The live calli + zenod units | The wallet downstreams Herald consumes (never modified by this epic) |
| GitHub issue | One ticket's execution detail |
| Validation evidence | The journey screenshots |

## Mission

Stand up Herald — "a council member with an agenda" — as the next self-contained unit at `herald.zenod.dev`, by DUPLICATING the shipped Ring (LLM chat agent + wallet of unit MCP tokens + landing/GitHub sign-in/Stripe/tenants/dashboard) and adding the one genuinely new organ: **the loop**. Herald wakes on a schedule, reads the tenant's memory (wallet → Zenod), proposes posts onto a board — each proposal substantiated with WHY and a memory citation — takes approvals in chat, publishes through the tenant's mouth (wallet → Calli, C-22 drafts-never-send as the safety floor), files the outcome back to memory, and the next wake is visibly shaped by it. The briefing (theme, objectives, cadence, reply policy) is the central document: no briefing ✓, no loop — enforced in the scheduler, not by prompt. Loop machinery is built INSIDE Herald and tested live in the harness (Jordi, 2026-07-11: no standalone engine, no PoC library — that path lost a day once already). Generalization is a later extraction, not a prerequisite.

## Definition Of Done

SHIP — the journey, nothing else counts. The manager walks it in a REAL BROWSER on the LIVE deployment, in a loop (walk → first breakage → fix exactly that → deploy → walk again FROM STEP 1), until ONE uninterrupted clean pass, screenshots per step:

- [ ] 1. Open `herald.zenod.dev` logged out → a normal landing page: what Herald is ("your project's voice, on a loop — it drafts, you approve, it posts, it learns"), Get started, Pricing, Sign in. No token field anywhere public. (DUPLICATE from ring)
- [ ] 2. Pricing: exactly three options — Self-hosted (free) / Monthly / Yearly, Stripe TEST. (DUPLICATE)
- [ ] 3. Sign in with GitHub — same account system as the other units; sign-in returns showing name + Dashboard link. (DUPLICATE)
- [ ] 4. Subscribe (monthly, TEST card): server-side checkout, `client_reference_id` = account id → webhook inserts the tenant row in THIS container → land in the dashboard. (DUPLICATE)
- [ ] 5. Dashboard: Herald's chat front and center (Ring's ported chat); wallet card (add Zenod memory URL+token and Calli mouth URL+token — same wallet UX as Ring, same SSRF rules); **Board panel** (read view: proposed / approved / posted, each item showing its WHY + memory citation + permalink when posted); **Briefing card** showing "no briefing approved — Herald will not loop" until step 6; Herald's own MCP URL + token; usage. NO tabs from other units. (DUPLICATE + board/briefing panels BUILD)
- [ ] 6. Briefing negotiation in chat: Herald interviews for theme, objectives, posting cadence, tone, reply policy; refuses any loop action until the human replies "✓ approve briefing"; on ✓, briefing v1 is committed (versioned row) and filed to the tenant's Zenod memory via the wallet with a commit receipt in chat. (BUILD — conversation state on the ported chat)
- [ ] 7. The wake: the scheduler fires per the briefing cadence (walk uses a "Run now" button on the Board panel — same code path as cron, no simulation); the proposer lane reads memory via the wallet and writes N proposals to the board, EACH carrying a one-line rationale + a citation to the memory page that inspired it. Board panel and chat both show them. No approved briefing → the scheduler visibly refuses (that refusal is part of this step: walk it once before step 6's ✓). (BUILD — the loop organ)
- [ ] 8. Approve in chat: "✓ 1,3" parses; approved items move to approved on the board; rejected/ignored items stay, with the rejection filed to memory via the wallet. (BUILD)
- [ ] 9. Publish: each approved item goes wallet → Calli (draft → `approve_send`, C-22 — Herald never bypasses the mouth's discipline) → **canonical x.com permalink receipt** in chat AND on the board item (state: posted). Test posts deleted after permalink capture, as in EPIC C. (BUILD on existing wallet plumbing — the Calli MCP contract already proven in EPIC R/C)
- [ ] 10. The loop closes: trigger "Run now" again → the new proposals visibly reference the filings from steps 8–9 (e.g. avoid the rejected theme, build on the posted one). Screenshot both boards side by side. (BUILD — this step IS the product)
- [ ] 11. Logout/login persists briefing, board, wallet, receipts. A second tenant provisioned by the manager sees an empty Herald: no briefing, no board items, no wallet entries from tenant one.
- [ ] 12. Test package: "I manually walked the full journey and it works. URL + screenshots. Now you test." Every element Jordi will click was clicked by the manager in the same deployed build.

HARDEN (after Jordi approves SHIP): reply lane (requires X read capability in Calli — a cross-unit ask routed through Jordi, never built by this epic inside Calli's repo without its own ticket), weekly scorecard lane (reads receipts + briefing goals, reports in chat), approve/reject buttons on the Board panel, briefing re-negotiation ("change the briefing" re-enters setup mode), Phylax as a wallet channel (morning-N arrives on WhatsApp), Herald as customer #0 on Zenod's own X account (D-H1 dogfood — Jordi flips it personally), self-host README.

## Non-Goals

- A standalone loop engine, library, PoC, simulator, fake channels, or simulated clocks — test live in the harness (Jordi, 2026-07-11).
- Executing anything from the 4.x child map (4.1–4.6, loop-core PoC). Design inheritance only.
- Editing the 4.x documents.
- Touching the live Ring, Calli, or Zenod units beyond reading their code as templates and calling their public MCP faces as a customer would.
- Reply handling, scorecards, or any X *read* path in SHIP.
- Lane YAML as a user-facing artifact — hosted tenants see the briefing and the board, never config files.

## Current State

Phase: dispatch-ready
Last verified: 2026-07-11
Integration target: main
Fresh base commit: pin current `origin/main` at dispatch and record the SHA here (D19c); no rebases until the journey passes
Next action: Jordi pastes the dispatch prompt (Appendix) to the Herald delivery manager.
Blockers: none. Ring is shipped (the duplicate source), Calli is shipped (the mouth), Zenod is live (the memory). Wallet tokens for the manager's laps are minted from those units' own dashboards during the walk — no input from Jordi required.

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Epic worker | Journey passes clean; test package delivered. | Package posted, or "BLOCKED ON JORDI: <one question>" as entire status. |
| Ticket worker | Ticket done in own worktree, PR opened. | PR + one-line result. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | This spine, top to bottom | Everything is here. | Always |
| 2 | `docs/EPIC-R-RING-SPRINT.md` + its journal | The shipped unit being DUPLICATED: chat, wallet, persona, customer layer — and every trap its journey loop hit. Copy its answers. | Always |
| 3 | The live ring unit code (chat views, wallet store + SSRF validation, persona/console, customer layer) | The code being DUPLICATED. | Workers |
| 4 | `docs/EPIC-4.0-HERALD.md` §Loop Model + §Decisions (D-H1..3) | The five-primitive design contract: briefing, boards, lanes, filings, scorecard. Law for SHAPE; its execution plan is dead — build inside Herald. | H-S2/H-S3/H-S4 workers |
| 5 | `docs/EPIC-C-CALLISTHENES-SPRINT.md` SHIP 7 + Calli's MCP tool surface | The mouth contract: draft → approve_send → permalink. Herald is a CLIENT of this, exactly as an external agent would be. | H-S4 worker |
| 6 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` D19–D21 | The conduct laws. | Manager |

## Architecture And Context

Herald = the Ring's body + an agenda. One container, one hostname (`herald.zenod.dev`), SQLite (WAL + busy_timeout) on `/data`, tenants are rows, tenant = `sha256(bearer)` lookup (#645), per-hop wallet tokens, tenant bearer NEVER passed downstream, wallet URL SSRF rules exactly as EPIC R R-S3.

The one new organ — the loop — lives entirely inside Herald:

- **Scheduler**: in-container cron (node-cron or setInterval-tick, whichever `packages/server` already uses for periodic work — check before adding a dependency), per-tenant cadence read from the briefing, plus a "Run now" trigger from the dashboard that calls the SAME code path. Gate enforced in the scheduler: unapproved briefing → refuse with a logged, chat-visible refusal.
- **Boards**: tenant-scoped SQLite tables (`board_items`: state proposed|approved|posted|rejected, text, rationale, memory_citation, permalink, timestamps). Local-first (simplest thing that ships); FILINGS go to the tenant's Zenod memory via the wallet — memory is the loop's long-term substrate, the board is its working queue.
- **Briefing**: versioned rows (`briefings`: version, content, approved_at); on ✓ also filed to Zenod memory. The briefing is the UI; there is no user-facing YAML.
- **Lanes v0**: two mission prompts (proposer, poster) as code-side prompt templates with the tenant's briefing interpolated — no YAML runtime, no loader, no generic schema. That's HARDEN-or-later extraction territory.

Waves (file-surface disjoint):

- Wave 1: **H-S1** (front duplicate: landing copy, pricing, domain, billing) ∥ **H-S2** (loop organ: scheduler, boards schema, briefing store, gate).
- Wave 2: **H-S3** (briefing setup mode on the ported chat + ✓ parsing + filings) , **H-S4** (proposer/poster lanes through the wallet + Board/Briefing dashboard panels + Run now).
- Then **H-S5** — the journey loop, the manager personally, real browser on the live deployment.

## Decisions (pre-answered — the planner is asleep)

| # | Decision | Answer |
|---|---|---|
| H-D1 | Domain | `herald.zenod.dev`. Traefik entry duplicated from the ring's; new Dokploy app `herald`, same deploy-on-main flow. |
| H-D2 | Duplicate source | The RING, not Zenod. Chat, wallet, persona plumbing, customer layer all come from ring. Falling back to Zenod for any piece ring lacks is allowed; journal it. |
| H-D3 | 4.x relationship | Design inheritance only (five primitives, D-H1..3). Never execute or edit 4.x docs. No standalone engine/PoC — build the loop inside Herald, test live in the harness. |
| H-D4 | LLM key | Same pattern as the ring's console persona: the tenant's model key, entered in dashboard settings (DUPLICATE the ring's keys UX). Manager uses the existing test OpenRouter/Anthropic key — READ it from the ring unit's Dokploy env; never mint, never ask Jordi. |
| H-D5 | Wallet downstreams for the walk | The manager provisions its OWN test tenants on live zenod + calli (TEST-mode Stripe, as in prior sprints), mints their MCP URLs from their dashboards, and adds them to Herald's wallet. X credentials for Calli: READ from the calli/x-mcp Dokploy env as EPIC C did. Test posts deleted after permalink capture. |
| H-D6 | Board storage | Local tenant-scoped SQLite in Herald. NOT memory pages (4.0's idea) — simplest thing that ships. Filings (rejections, post outcomes, lessons) go to Zenod memory via wallet. |
| H-D7 | Scheduler | In-container, per-tenant cadence from briefing; "Run now" button uses the identical code path. No external cron, no new infra. |
| H-D8 | Cadence floor | Minimum interval 15 min in production config; the journey walk uses Run now, never a shortened timer hack. |
| H-D9 | Proposal count | N from briefing, default 3, hard cap 10 per wake. Throttle: max 1 wake per tenant per interval; wake skipped with a chat-visible note if the previous one is still unapproved and the board has ≥ N open proposals (no pile-up). |
| H-D10 | ✓ parsing | "✓ 1,3" / "✓ all" / "✓ 2 + reject the rest" — parse indexes against the CURRENT proposed list, echo back the parsed interpretation before acting ("Approving 1 and 3, rejecting 2 — confirm?" is NOT needed; echo-then-act, receipts prove it). Unparseable → ask once, in chat. |
| H-D11 | Known trap: silent_ack | Register async ticket shapes with the receipt middleware BEFORE walking (the Zenod silent_ack lesson). Every mutating chat action returns a receipt or a loud error — a wake that files nothing and says nothing is a defect. |
| H-D12 | Known trap: wallet SSRF | EPIC R R-S3 rules verbatim: https only, no private/loopback resolution outside the fleet allowlist, downstream tokens in the vault, tenant bearer never forwarded. |
| H-D13 | Herald's own MCP face | Comes with the ring duplicate. v0 tools: `get_board`, `get_briefing`, `propose_now`, `approve_items`. Same tokened-URL auth as every unit. |
| H-D14 | Old EPIC-2.6 / `units/herald/` scaffold | Ignore. Superseded in spirit by this spine; do not build from it, do not edit it. |
| H-D15 | Catch-all | Anything unanswered: simplest option, note it in the journal, keep moving. |

## Issue Ledger

| Issue | Role | Owner | Title | Marking | Status | Depends On | Wave |
|---|---|---|---|---|---|---|---|
| mint | Ticket worker | assign | H-S1 front duplicate (landing, pricing, billing, domain) | DUPLICATE from ring | ready | pinned base | 1 |
| mint | Ticket worker | assign | H-S2 loop organ (scheduler + boards + briefing store + no-briefing-no-fire gate) | BUILD (verified absent everywhere) | ready | pinned base | 1 |
| mint | Ticket worker | assign | H-S3 briefing setup mode + ✓ parsing + filings via wallet | BUILD on PORTed ring chat | ready | H-S1, H-S2 | 2 |
| mint | Ticket worker | assign | H-S4 proposer/poster lanes + Board & Briefing dashboard panels + Run now | BUILD on DUPLICATEd wallet/dashboard | ready | H-S1, H-S2 | 2 |
| mint | Epic worker | manager | H-S5 journey loop (browser, live) + test package | — | ready | H-S1..4 | last |

Budgets: 90 min per ticket; manager reassigns anything silent past budget. Heartbeat every 30 min: `lap/state | blocker | ETA`.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| SHIP approval | Jordi | Test package delivered | Jordi walks the identical journey and approves | Nothing in HARDEN |
| HARDEN reply lane | Jordi | After SHIP approval | Jordi routes the X-read ask to Calli's track | All other HARDEN items |
| Customer #0 flip (D-H1 dogfood) | Jordi personally | HARDEN, his call | Jordi connects Zenod's own X account and approves the first real morning-N | Everything else |

Blocked protocol: the worker's ENTIRE next message is `BLOCKED ON JORDI: <one question + options + recommendation>` and that thread stops.

## Recovery And Takeover

Stale policy: the manager reassigns any ticket silent past its budget. Record takeovers here with commit + time.

## Open Questions

None permitted. Anything that surfaces: H-D15 — simplest option, journal it, keep moving.

## Validation Evidence

| Date | Scope | Commit | Surface | Method | Result | Evidence |
|---|---|---|---|---|---|---|
| - | - | - | - | - | - | journey screenshots land here |

## Handoff Journal

### 2026-07-11 — Planner — Spine authored

Context: Jordi called Herald ready post-Ring/Calli SHIP. Settled in session: duplicate the Ring; half-loop SHIP (replies/scorecard = HARDEN); approvals in chat + board read-view; 4.x left untouched as design inheritance; NO standalone loop engine — build inside Herald, test live (the PoC path previously lost a day). Loop model inherited from EPIC-4.0 §Loop Model verbatim as shape-law.
Next: dispatch (Appendix prompt).

## Appendix — Dispatch Prompt (paste-ready)

> You are the **Herald delivery manager**. Bind to `docs/EPIC-5-HERALD-SPRINT.md` in `/Users/jordi/Documents/GitHub/zenod` and read it top to bottom — every decision is pre-answered in its Decisions table; stopping to ask anything answerable from the spine is a defect. Pin `origin/main` as your base commit and record it in Current State.
>
> Mission: stand up Herald at `herald.zenod.dev` by DUPLICATING the shipped Ring (chat agent, wallet, customer layer) and building the one new organ inside it: the loop — briefing ✓ in chat, scheduled wakes that propose substantiated posts onto a board, chat approvals, publishing through the tenant's Calli via the wallet with permalink receipts, filings to Zenod memory, and the next wake visibly shaped by them. No standalone engine, no simulators — the live harness is the test bed. Anything marked DUPLICATE/PORT moves — scratch-writing it is a failing review.
>
> Operate the dialect: workers' FIRST ACTION is `git worktree add ../wt-<ticket> -b <branch> <pinned-base>`; waves as ledgered (H-S1 ∥ H-S2, then H-S3 + H-S4, then H-S5 — yours personally, real browser, live deployment, walk → fix → deploy → walk from step 1 until one clean pass with screenshots); 90-min budgets; 30-min heartbeats; blocked → your ENTIRE message is `BLOCKED ON JORDI: …`. Known traps are pre-answered: silent_ack receipts (H-D11), wallet SSRF (H-D12), credentials READ from existing Dokploy envs (H-D4/H-D5), test posts deleted after permalink capture. Never hand Jordi a click you haven't clicked.
>
> Done = the test package: "I manually walked the full journey and it works. URL + screenshots. Now you test." Go.
