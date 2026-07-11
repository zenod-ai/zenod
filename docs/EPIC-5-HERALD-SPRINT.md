# EPIC 5 · Herald Sprint — duplicate the Ring, give it an agenda

Status: active — H-S5 paused during final live walk (Jordi, 2026-07-11)
Created: 2026-07-11
Updated: 2026-07-12
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-5-HERALD-SPRINT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Herald delivery manager
Steward since: 2026-07-11T19:50:29+02:00
Last reconciled commit: `17e3f30319371fbc4750c8790ff4ce1f45377dea`
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

Phase: planner review — PR-5.1 plus proposed repair backlog before H-S5 resumes
Last verified: 2026-07-12T01:55:51+02:00
Integration target: main
Fresh base commit: `bf366b5939492af1417814bfae1daf30006b3cf4` — pinned from `origin/main` at dispatch (D19c); no rebases until the journey passes
Live deployment: `https://herald.zenod.dev/` is serving exact commit `17e3f30319371fbc4750c8790ff4ce1f45377dea`; CI and image publication passed.
Paused point: tenant one is paid and authenticated; the duplicated wallet contains live Zenod + Calli tenants; Calli is connected to `@ZenodAgent`; the corrected active test model key is stored; Herald loop/chat state was reset for the final uninterrupted lap. The final lap had re-verified the logged-out landing and GitHub return and was entering the dashboard when Jordi paused it. Existing screenshots cover steps 1–7, but they are partial-lap evidence and do not yet constitute SHIP.
Next action: planner reviews PR-5.1 and the H-S6–H-S9 backlog below. If accepted, the manager mints the draft GitHub issues, pins fresh `origin/main`, dispatches the repair waves, integrates and deploys one exact SHA, passes the pre-test gate, then restarts H-S5 at step 1. Do not resume from the paused browser step because Definition Of Done requires a clean pass from step 1.
Blockers: H-S5 is intentionally held at the PR-5.1 planner gate because the live test revealed a product-identity and authority divergence. No credential or infrastructure input is required.

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

## Planner Review Queue

### PR-5.1 — One Herald, one personality, one authority

Status: proposed by Jordi from first-setup live testing on 2026-07-12; planner acceptance required before implementation.

Evidence: `/Users/jordi/.codex/attachments/0ebd2a14-d6fa-4aea-be10-613c7bee6f50/pasted-text.txt`. The briefing interview and exact ✓ filing worked, but the subsequent generic chat produced uncited, non-board drafts, invented an unsupported `✓ approve post` command, and then the authoritative board parser correctly reported that no proposals existed.

Proposed identity invariant:

- There is exactly one visible personality and operational authority: **Herald**. The user is talking to him at all times.
- Ring is implementation provenance only — the shipped body duplicated to create Herald. Ring/Council must not appear as a second persona, product layer, or user-facing concept inside Herald.
- Herald is himself an MCP server that Ring or any other authorized agent may call. He is also a specialized Ring-like agent with extended capacity around one domain's goals, state, and tools.
- Herald is pre-wired/configured with the downstream MCP servers required by his domain. For SHIP those are Zenod (memory) and Calli (publishing), reached through tenant-scoped wallet custody.

Proposed topology:

```text
User chat ───────────────┐
                        ▼
Ring or another agent ─▶ Herald MCP / Herald personality
                              │
                              ├── approved briefing + objectives
                              ├── current board + approvals + receipts
                              ├── recent filings/outcomes
                              ├── Zenod MCP (memory)
                              └── Calli MCP (publishing)
```

Proposed turn contract:

1. Every chat and MCP turn is handled as Herald, with no generic Ring/Council fallback personality.
2. Before answering or acting, Herald is grounded in the approved briefing and current operational state: board items, approvals, recent filings, and posting receipts. He is "obsessed with the briefing and current state."
3. Natural-language requests and explicit controls are two entrances to the same authoritative lanes. "Show me proposed posts" must create/read real numbered board items through the same proposer path as Run now; it must never emit disposable chat-only drafts.
4. Every proposed post remains governed by the briefing and carries its WHY plus a Zenod memory citation. Herald must not invent product claims merely because they sound persuasive.
5. Feedback such as "dial down the slang" must become durable iteration state — a rejection/lesson filing and, where the planner permits, a briefing refinement — so the next wake is visibly shaped by it.
6. Publishing language must resolve against real board state. Herald never invents approval syntax. He asks for the supported current-list selection (`✓ 1`, `✓ 1,3`, `✓ all`) and uses `publish approved` only after items are actually approved.
7. All mutation replies stay in Herald's voice while returning authoritative receipts or a clear human explanation. Internal phrases such as "verified same-turn mutation receipt" are not customer copy.
8. Reply policy may be captured as part of the briefing, but SHIP must state that automated X replies are not active until the HARDEN reply lane exists. PR-5.1 does not pull that lane into SHIP.

Proposed UI/copy consequences:

- Remove inherited copy such as "Talk to your brain" and "Wire the Council to your agents."
- Present the wallet as Herald's connected tools/capabilities, not a Council roster.
- Board and chat are two views of the same Herald state, never parallel realities.

Planner decision requested: accept this invariant as a correction to H-D2/H-D13's product interpretation and add its turn contract to SHIP acceptance. Recommendation: **accept**; it narrows authority and removes an observed split-brain behavior without changing the existing Zenod, Calli, board, scheduler, or tenant architecture.

### Proposed backlog and path to the next test phase

These are draft tickets until the planner accepts PR-5.1. After acceptance the manager creates the GitHub issues, records exact branches/bases, and dispatches in the waves below.

| Draft | Title | Scope | Depends On | Acceptance Gate | Wave |
|---|---|---|---|---|---|
| H-S6 | One-Herald state kernel | Server-side identity/authority repair. Remove the generic post-briefing fallback as an independent personality; assemble approved briefing, current board, recent filings and receipts as Herald's mandatory turn state for chat and MCP; keep deterministic mutation receipts behind Herald's single voice. | PR-5.1 | Every post-briefing turn is handled as Herald and can name the current briefing/board state; no generic Ring/Council persona can emit domain output outside Herald authority. | R1 |
| H-S7 | Authoritative natural-language loop control | Route natural requests into existing lanes: show/propose → the real proposer/board; numbered approvals → current board parser; feedback → rejection/lesson filing that shapes the next wake; send/publish → actual approved board state and Calli. Prevent invented approval commands and chat-only drafts. | H-S6 | Jordi's transcript can be replayed through chat: proposed copy exists as cited board rows, feedback is durable, unsupported `✓ approve post` is never suggested, and publishing cannot occur without real board approval. | R2 |
| H-S8 | Herald-only product language | Remove inherited "Council" / "Talk to your brain" language; present wallet peers as Herald's connected tools/capabilities; make chat, briefing and board read as one agent's state; disclose that reply policy is recorded while automated X replies remain HARDEN. | PR-5.1 | No Ring/Council/second-persona product copy remains on Herald surfaces; the dashboard makes one Herald and one state model obvious. | R1 |
| H-S9 | Transcript-derived contract and integration gate | Add regression tests from Jordi's first-setup evidence across briefing, natural proposal request, style feedback, approval guidance and publish intent. Assert citations/WHY, board persistence, memory receipts, unsupported-feature disclosure and zero off-board mutations. Run full server/web/build validation. | H-S6, H-S7, H-S8 | Automated replay passes; 100% of domain proposals are authoritative board rows; every mutation has a receipt or clear Herald-voice error; full relevant CI is green. | R3 |

Dispatch sequence:

1. **Planner gate:** accept/amend/reject PR-5.1 and this backlog. No code work begins before acceptance because this changes SHIP identity/acceptance.
2. **Pin:** fetch `origin/main`, record one fresh base SHA, and create H-S6–H-S9 GitHub issues with dedicated worktrees/branches.
3. **Wave R1:** H-S6 ∥ H-S8. Their file surfaces are expected to be server runtime/chat versus Herald web copy/components.
4. **Wave R2:** H-S7 on the integrated R1 commit. This is sequenced after H-S6 so natural intent cannot recreate a second authority path.
5. **Wave R3:** H-S9 tests the integrated behavior using Jordi's transcript as the contract fixture; fix/retest until green.
6. **Pre-test gate:** merge to `main`; CI + image publication pass; deploy one exact SHA; `/api/health` matches; live tenant wallet/model/Calli connectivity passes; reset only Herald test loop/chat state; recapture or redact any evidence containing token-bearing URLs.
7. **Next test phase:** set H-S5 back to `testing` and restart the complete real-browser journey at step 1. A test phase may not begin earlier.

Entry criteria for the next H-S5 test phase:

- PR-5.1 accepted and reflected as a final decision/acceptance update.
- H-S6–H-S9 issues are done and integrated.
- Transcript-derived regression is green on the deployed SHA.
- Natural "show me posts" creates real cited board items; feedback persists; publish intent resolves against real approvals.
- Herald UI and replies contain no visible Ring/Council second personality.
- Live Zenod and Calli wallet catalogs, model key, X connection, and exact deployment SHA are verified.

Waves (file-surface disjoint):

- Wave 1: **H-S1** (front duplicate: landing copy, pricing, domain, billing) ∥ **H-S2** (loop organ: scheduler, boards schema, briefing store, gate).
- Wave 2: **H-S3** (briefing setup mode on the ported chat + ✓ parsing + filings) , **H-S4** (proposer/poster lanes through the wallet + Board/Briefing dashboard panels + Run now).
- Then **H-S5** — the journey loop, the manager personally, real browser on the live deployment.

## Decisions

Pre-answered — the planner is asleep.

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

| Issue | Role | Owner / Assignment | Title | Marking | Status | Depends On | Wave | PR/Branch | Base | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [#897](https://github.com/zenod-ai/zenod/issues/897) | Ticket worker | H-S1-worker | H-S1 front duplicate (landing, pricing, billing, domain) | DUPLICATE from ring | done | pinned base | 1 | [#900](https://github.com/zenod-ai/zenod/pull/900) / `codex/h-s1-front-duplicate` | `bf366b5` | CI + manager review; merged `f7b10b0` | 2026-07-11T20:07:57+02:00 | integrated |
| [#895](https://github.com/zenod-ai/zenod/issues/895) | Ticket worker | H-S2-worker | H-S2 loop organ (scheduler + boards + briefing store + no-briefing-no-fire gate) | BUILD (verified absent everywhere) | done | pinned base | 1 | [#901](https://github.com/zenod-ai/zenod/pull/901) / `codex/h-s2-loop-organ` | `bf366b5` | 685 server tests + manager integration tests; merged `cfc13e2` | 2026-07-11T20:07:57+02:00 | integrated |
| [#898](https://github.com/zenod-ai/zenod/issues/898) | Ticket worker | H-S3-worker | H-S3 briefing setup mode + ✓ parsing + filings via wallet | BUILD on PORTed ring chat | done | H-S1, H-S2 | 2 | [#902](https://github.com/zenod-ai/zenod/pull/902) / `codex/h-s3-briefing-chat` | `cfc13e2` | CI + 13 focused tests; merged `ea005cb` | 2026-07-11T20:42:28+02:00 | integrated |
| [#899](https://github.com/zenod-ai/zenod/issues/899) | Ticket worker | H-S4-worker | H-S4 proposer/poster lanes + Board & Briefing dashboard panels + Run now | BUILD on DUPLICATEd wallet/dashboard | done | H-S1, H-S2 | 2 | [#903](https://github.com/zenod-ai/zenod/pull/903) / `codex/h-s4-loop-lanes-dashboard` | `cfc13e2` | CI + 699 server tests + web/build/typecheck; merged `7d9dad1`; chat seam fixed `0820167` | 2026-07-11T20:42:28+02:00 | integrated |
| [#896](https://github.com/zenod-ai/zenod/issues/896) | Epic worker / tester | Herald delivery manager | H-S5 journey loop (browser, live) + test package | — | planner review | H-S1..4 + PR-5.1 | last | `main` | `17e3f30` live | first-setup transcript proves briefing receipt but exposes chat/board split personality and authority | 2026-07-12T01:54:37+02:00 | planner reviews PR-5.1; accepted refinement becomes a bounded fix ticket before H-S5 restarts |
| draft H-S6 | Ticket worker | unassigned | One-Herald state kernel | BUILD repair | planner review | PR-5.1 | R1 | branch/worktree after approval | fresh pinned `origin/main` after approval | first-setup transcript | 2026-07-12T01:55:51+02:00 | planner accepts backlog, then manager mints issue and dispatches |
| draft H-S7 | Ticket worker | unassigned | Authoritative natural-language loop control | BUILD repair | planner review | H-S6 | R2 | branch/worktree after approval | integrated R1 commit | first-setup transcript | 2026-07-12T01:55:51+02:00 | dispatch only after H-S6 integrates |
| draft H-S8 | Ticket worker | unassigned | Herald-only product language | PORT cleanup + BUILD | planner review | PR-5.1 | R1 | branch/worktree after approval | fresh pinned `origin/main` after approval | live dashboard copy | 2026-07-12T01:55:51+02:00 | planner accepts backlog, then manager mints issue and dispatches |
| draft H-S9 | Tester / ticket worker | unassigned | Transcript-derived contract and integration gate | TEST + bounded fixes | planner review | H-S6, H-S7, H-S8 | R3 | branch/worktree after approval | integrated R2 commit | Jordi transcript contract | 2026-07-12T01:55:51+02:00 | dispatch after repair integration; green is required before H-S5 |

Budgets: 90 min per ticket; manager reassigns anything silent past budget. Heartbeat every 30 min: `lap/state | blocker | ETA`.

## Branch And Integration

- Integration target: protected `main`; dispatch base `bf366b5939492af1417814bfae1daf30006b3cf4` is frozen until the journey passes.
- Every ticket worker uses its dedicated branch and worktree; the shared checkout remains the steward's integration surface.
- The manager reviews and integrates passing Wave 1 work, pins the resulting exact commit for Wave 2, then integrates H-S3/H-S4 and freezes one exact live journey commit.
- No rebases during a pinned wave. Targeted tests precede integration; the full acceptance test runs only on the live Herald deployment per D19–D21.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| PR-5.1 Herald identity + repair backlog | Epic 5 planner | First-setup transcript shows generic chat and authoritative board diverge | Accept, amend, or reject the one-Herald invariant, turn contract, H-S6–H-S9 backlog, and next-test entry criteria | Issue minting and repair dispatch; H-S5 remains held until the pre-test gate passes |
| SHIP approval | Jordi | Test package delivered | Jordi walks the identical journey and approves | Nothing in HARDEN |
| HARDEN reply lane | Jordi | After SHIP approval | Jordi routes the X-read ask to Calli's track | All other HARDEN items |
| Customer #0 flip (D-H1 dogfood) | Jordi personally | HARDEN, his call | Jordi connects Zenod's own X account and approves the first real morning-N | Everything else |

Blocked protocol: the worker's ENTIRE next message is `BLOCKED ON JORDI: <one question + options + recommendation>` and that thread stops.

## Recovery And Takeover

Stale policy: the manager reassigns any ticket silent past its budget. Record takeovers here with commit + time.

## Open Questions

PR-5.1 only: does the planner accept the one-Herald identity invariant, its eight-part turn contract, the H-S6–H-S9 backlog, and the listed next-test entry criteria as SHIP acceptance? Recommendation: accept. Anything else that surfaces follows H-D15.

## Validation Evidence

| Date | Scope | Commit | Surface | Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-11 | Integrated Herald implementation + H-S5 retry fix | `17e3f30319371fbc4750c8790ff4ce1f45377dea` | local + GitHub Actions | 709 server tests, server typecheck, CI, runtime image boot smoke and publish | pass | [CI](https://github.com/zenod-ai/zenod/actions/runs/29165148248), [image](https://github.com/zenod-ai/zenod/actions/runs/29165148267) |
| 2026-07-11 | Live deployment identity | `17e3f30319371fbc4750c8790ff4ce1f45377dea` | `https://herald.zenod.dev/` | `/api/health` exact-SHA check | pass | live endpoint |
| 2026-07-11 | H-S5 partial browser laps | `17e3f30319371fbc4750c8790ff4ce1f45377dea` | live Chrome session | landing, pricing, GitHub, Stripe TEST, dashboard/wallet, no-briefing refusal, briefing + Zenod commit receipt | partial — not SHIP; final uninterrupted pass still required | local-only `docs/evidence/herald-ship-2026-07-11/`; redact credential-bearing wallet URLs before committing any image |

## Handoff Journal

### 2026-07-12T01:54:37+02:00 — Herald delivery manager — first-setup evidence routed to planner

Context: Jordi's first-setup transcript proves that briefing capture, exact approval, versioning, Zenod filing, and commit receipts work. It also proves a deeper divergence: after approval, inherited generic chat generated uncited posts that never entered the board, accepted style feedback without durable state, invented a `✓ approve post` command, and spoke as though a separate Calli-routing assistant existed. The real board parser then correctly refused because no authoritative proposals existed.

Proposed correction PR-5.1 is recorded above for planner review: one Herald personality and authority; Ring as code provenance only; Herald as a specialized MCP server callable by Ring; every turn grounded in briefing/current state; natural chat and buttons using the same authoritative lanes; no chat-only drafts or invented mutations; inherited Council/brain copy removed. The reply lane remains HARDEN. Draft backlog H-S6–H-S9 and an explicit pre-test gate now carry this correction through server authority, natural-language control, UI identity, transcript regression, integration and deployment before H-S5 can return to `testing`.

Next: planner accepts/amends/rejects PR-5.1. On acceptance, mint one bounded repair ticket, deploy it, and restart H-S5 from step 1.

### 2026-07-11T21:47:58+02:00 — Herald delivery manager — H-S5 paused by Jordi

Context: Herald is live at `https://herald.zenod.dev/` on exact commit `17e3f30319371fbc4750c8790ff4ce1f45377dea`; both CI and runtime image publication passed. Dokploy was provisioned as app `herald` with persistent `herald-data`; platform queue starvation prevented the normal first deployment record, so the manager recovered the one Herald Swarm service without touching other services. The published image tag is the workflow's short-SHA form (`sha-17e3f30`).

Live laps exposed two bounded defects/states. First, a retried exact `✓ approve briefing` could fall through to proposal approval after the asynchronous Zenod filing completed. Commit `17e3f30` makes that retry idempotent and adds regression coverage; the full server suite passed 709/709. Second, the first imported Ring credential was initially the whole custody envelope and, after extracting its value correctly, OpenRouter reported that key's total limit was exhausted. The manager corrected the shape, then used H-D15 to rotate Herald to the already-custodied active test OpenRouter key used by the live Zenod tenant. No key was minted and no credential was requested from Jordi.

Verified live before pause: logged-out landing; three-option pricing; GitHub return; Stripe TEST monthly checkout; duplicated chat/wallet/customer dashboard; live Zenod and Calli wallet catalogs; Calli connected to `@ZenodAgent`; loud scheduler refusal before briefing; five-field briefing interview; exact ✓ approval; Zenod evidence/page/commit receipt. Screenshots `01`–`07` exist locally under `docs/evidence/herald-ship-2026-07-11/`, but they span partial laps and are not the Definition Of Done package. They remain uncommitted because the wallet screenshot exposes a token-bearing MCP URL and must be redacted or recaptured before publication. For the final lap the manager reset tenant-one Herald loop/chat state while preserving the paid account, wallet, and corrected model key. The lap had reached the authenticated return and dashboard transition when Jordi requested a pause.

Next: on explicit resume, start again from step 1 and complete one uninterrupted steps 1–12 pass. Remaining proof is live substantiated proposals, `✓ 1,3`, separate `publish approved`, Calli permalink receipts, deletion of test posts, shaped next wake, persistence, second-tenant isolation, and the final test package.

### 2026-07-11T20:42:28+02:00 — Herald delivery manager — Wave 2 integrated; H-S5 frozen

Context: H-S3 passed CI and merged as `ea005cb`, adding the ported chat's briefing interview, exact ✓ gate, current-list approval parser, and verified Zenod filing seam. H-S4 passed CI and merged as `7d9dad1`, adding the cited proposer, C-22 poster, Board/Briefing dashboard, Run now, and four Herald MCP tools. Manager integration commit `082016755403f2efcbd8d9995bec732ba05be406` binds those seams into the duplicated chat without replacing its normal path and preserves a visible approved state until the exact `publish approved` command. Integrated validation: server typecheck; 26 Herald loop/chat/lane/unit tests; 28 web tests; server, web, and Herald-site production builds. Changed web files pass focused ESLint; the workspace-wide web lint remains red only on pre-existing settings-file rules outside this epic's diff.
Decision under H-D15: SHIP step 9's simplest explicit chat phrase is `publish approved`; it invokes the poster-only path after step 8's `✓` decision so the approved board state remains observable before publication.
Next: deploy frozen `0820167` to the one Herald app, then manager performs H-S5 on the live public surface, fixing only the first breakage per lap and restarting at step 1.

### 2026-07-11T20:07:57+02:00 — Herald delivery manager — Wave 1 integrated; Wave 2 pinned

Context: H-S1 duplicated the shipped Ring body with provenance recorded in [#900](https://github.com/zenod-ai/zenod/pull/900); CI passed and it merged as `f7b10b0`. H-S2 added the in-unit tenant loop store and shared scheduled/Run-now path; its 685-test server pass and CI passed. The manager resolved the only overlap—additive `packages/server/src/index.ts` exports—without rebasing, then ran typecheck plus 24 integrated Herald/wallet tests and merged as `cfc13e2eed1c4cefb069e76d6334d3ddc8ca9e3f`.
Assignments: H-S3-worker / `codex/h-s3-briefing-chat` / `../wt-h-s3`; H-S4-worker / `codex/h-s4-loop-lanes-dashboard` / `../wt-h-s4`; both pinned to integrated Wave 1 commit `cfc13e2eed1c4cefb069e76d6334d3ddc8ca9e3f`.
Next: dispatch H-S3/H-S4, integrate reviewed passing work, freeze the exact live build, then execute H-S5 personally from `https://herald.zenod.dev/`.

### 2026-07-11T19:50:29+02:00 — Herald delivery manager — Steward bound and base pinned

Context: stewardship transferred from the planner to the Herald delivery manager before concurrent ticket work. `main` and freshly fetched `origin/main` are aligned at pinned base `bf366b5939492af1417814bfae1daf30006b3cf4`; the shared checkout was clean. Linked Ring, Calli, chassis, and 4.x design spines remain read-only. Wave 1 will dispatch H-S1 and H-S2 into dedicated worktrees from this exact base.
Issues: H-S1 [#897](https://github.com/zenod-ai/zenod/issues/897), H-S2 [#895](https://github.com/zenod-ai/zenod/issues/895), H-S3 [#898](https://github.com/zenod-ai/zenod/issues/898), H-S4 [#899](https://github.com/zenod-ai/zenod/issues/899), H-S5 [#896](https://github.com/zenod-ai/zenod/issues/896).
Next: dispatch H-S1 and H-S2 with worktree creation as each worker's first action; monitor 30-minute heartbeats and 90-minute budgets.

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
