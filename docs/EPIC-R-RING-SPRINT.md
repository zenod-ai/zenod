# EPIC R · Ring Sprint — duplicate Zenod, the middle is the Council

Status: active
Created: 2026-07-11
Updated: 2026-07-11
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-R-RING-SPRINT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Ring delivery manager
Steward since: 2026-07-11T02:20:29+02:00
Last reconciled commit: `fcac83ff27e04b60b19a3cfae0ff62bf8f0f5a92`
Planner: Jordi + Epic 3.0 planner
Worker: Ring delivery manager + parallel ticket workers
Tester: the delivery manager itself (journey walker)

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Planner | Jordi + Epic 3.0 planner | This spine | Wrote it; every decision pre-answered below. | This document. |
| Epic worker | Ring delivery manager | This spine | MANAGER: mint tickets, dispatch parallel worktree workers, integrate, walk the journey, iterate until SHIP. | The test package. |
| Ticket worker | assigned per ticket | One ticket, own worktree | FIRST ACTION: `git worktree add ../wt-<ticket> -b <branch> main`. Never checkout in the shared clone. PORT/DUPLICATE means move code, adapt only imports/config — a scratch-written duplicate line is a failing review. | PR + one-line result. |

## Write Scope

Bound spine: `docs/EPIC-R-RING-SPRINT.md`
Active steward: Ring delivery manager

Writable by default:

- The steward reconciles this spine; ticket workers write to their issues.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-Z-NIGHT-SPRINT.md` — the completed Zenod template.
- `docs/EPIC-C-CALLISTHENES-SPRINT.md` — the first duplicate; copy its answers where they apply.
- `docs/EPIC-P-PHYLAX-SPRINT.md` — depends on THIS epic's MCP face; do not block on it.
- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — D14/D15/D16/D19–D21 apply verbatim.
- `docs/EPIC-3.4-RING-MULTITENANT.md` — superseded by this spine.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Product shape, journey, PORT/DUPLICATE markings, pre-made decisions |
| The live zenod unit + `docs/EPIC-Z-NIGHT-SPRINT.md` | The customer-layer template being duplicated |
| `apps/web/src/views/ChatTab.tsx`, the console persona, `peer-agents.tsx` + `/api/peers` `/api/team/*` | The product middle being ported/evolved |
| GitHub issue | One ticket's execution detail |
| Validation evidence | The journey screenshots |

## Mission

Stand up the Ring — the front door: a web chat with your own Council, wired to your other units — as the next self-contained unit at `ring.zenod.dev`. DUPLICATE the proven Zenod customer layer (landing, GitHub sign-in, Stripe, tenants, dashboard shell). The product middle is code that already lives in this codebase: the Council web chat (`ChatTab` — streaming, markdown, tool testing), the console persona brain, and the wallet (an evolution of the existing peers/team surface: which units this tenant's council holds MCP URL+token for). Per D14 the Ring owns ZERO channel code — webchat is its only channel at SHIP; WhatsApp arrives later via Phylax calling the Ring's own MCP face. Done = the journey walked clean by the manager, then Jordi.

## Definition Of Done

SHIP — the journey, walked in a REAL BROWSER on the LIVE deployment, loop until ONE uninterrupted clean pass, screenshots per step:

- [ ] 1. Open `ring.zenod.dev` logged out → normal landing: what the Ring is ("your council — one chat, wired to all your agents"), Get started, Pricing, Sign in. No public token field. (DUPLICATE)
- [ ] 2. Pricing: Self-hosted (free) / Monthly / Yearly, Stripe TEST. (DUPLICATE)
- [ ] 3. Sign in with GitHub — same account system as Zenod/Callisthenes, one identity across units. (DUPLICATE)
- [ ] 4. Subscribe (TEST card) → `client_reference_id` binding → tenant row in THIS container → land in the dashboard. (DUPLICATE)
- [ ] 5. Dashboard: the COUNCIL CHAT front and center (ported ChatTab); **My Units wallet** panel (add a unit by pasting its MCP URL + token; status per unit); **Keys** (tenant's OpenRouter key via UI — never env); the Ring's own MCP URL + token with copy button (this is what Phylax and external agents will call); usage; back-link to landing. No channel tabs, no other units' panels. (PORT ChatTab + persona; EVOLVE peers→wallet; DUPLICATE the rest)
- [ ] 6. Enter OpenRouter key → chat answers as the council. (PORT — existing chat path)
- [ ] 7. Wallet: paste the tenant's own Zenod MCP URL + token → unit shows connected. Tell the council "remember this: the ring is alive" → council routes to that Zenod → the Zenod commit receipt appears in the chat reply. THE golden-path moment. (PORT peer-call machinery)
- [ ] 8. The Ring's MCP FACE works: an external MCP client `initialize`s against the tenant's Ring URL and one chat tool call gets a council reply — this is the exact contract Phylax will consume. (PORT — existing /mcp plumbing)
- [ ] 9. Logout/login persists chat wallet keys; second tenant sees none of the first tenant's wallet, chat history, or keys.
- [ ] 10. Test package: "I manually walked the full journey and it works. URL + screenshots. Now you test."

HARDEN (after Jordi approves SHIP): multiple units in the wallet exercised end-to-end (Callisthenes drafting via the council), skill auto-import from unit manifests (D16), routing rules UI, Google sign-in, standing-directives panel.

## Non-Goals

- ANY channel code (D14 — Phylax's job). Webchat is the only channel at SHIP.
- New chat UI design — ChatTab moves as-is.
- Suite composition, Herald, machine tenants.
- Touching live Zenod/Callisthenes units beyond reading code as template.

## Current State

Phase: R-S5 authorized live receipt diagnosis lap
Last verified: 2026-07-11T04:38:00+02:00
Integration target: main
Fresh base commit: `fcac83ff27e04b60b19a3cfae0ff62bf8f0f5a92` — PINNED; no rebases until the journey passes (D19c)
Next action: diagnose from live durable audit/job evidence, land only the smallest receipt-contract fix, then rerun SHIP 7 on one exact build.
Blockers: none — Jordi authorized the focused SHIP 7 diagnosis/fix lap.

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
| 2 | `docs/EPIC-Z-NIGHT-SPRINT.md` + `docs/EPIC-C-CALLISTHENES-SPRINT.md` (ledgers/journals) | The template and the first duplicate — copy their answers. | Always |
| 3 | Live zenod unit customer-layer code | Being DUPLICATED. | R-S1 worker |
| 4 | `apps/web/src/views/ChatTab.tsx`, console persona in `packages/server/src/agent.ts`, `peer-agents.tsx`, `/api/peers`, `/api/team/*`, `peerClient.ts` | Being PORTED/EVOLVED. | R-S2/R-S3 workers |
| 5 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` D14/D15/D16/D19–D21 | The laws. | Manager |

## Architecture And Context

One Dokploy application `ring`, one hostname `ring.zenod.dev`, one container. Tickets:

- **R-S1 · Front duplicate** (DUPLICATE) — Zenod customer layer + landing, Ring branding/pricing copy, its own tenants table.
- **R-S2 · Council middle** (PORT) — ChatTab as the dashboard centerpiece; console-persona chat path tenant-scoped; per-tenant OpenRouter key via Keys (existing pattern); per-tenant chat history on the tenant storage.
- **R-S3 · Wallet** (EVOLVE peers/team surface — the ONE genuinely new-ish seam, flagged: budget 90 min, escalate rather than invent) — per-tenant list of {unit name, MCP URL, token(vault), status}; council brain gets the wallet as its tool surface (the existing peer-call machinery pointed at wallet entries). SECURITY (2026 MCP-gateway guidance): validate wallet URLs — https only, hostname must not resolve to private/loopback ranges except the unit fleet's own allowlist (SSRF guard); downstream tokens live in the vault and the tenant's Ring bearer is NEVER passed through to units (per-hop, audience-bound credentials — already the design, now stated as a check).
- **R-S4 · Billing + domain** (DUPLICATE Z-N3/Z-N5/C-S4 recipe) — three TEST prices; webhook → tenant row; Traefik `ring.zenod.dev`; guarded cutover.
- **R-S5 · Journey loop** (manager) — SHIP 1–10 including the MCP-face check (step 8) that Phylax depends on.

Wave 1: R-S1 ∥ R-S2. Wave 2: R-S3, R-S4. Then R-S5. Heartbeat 30 min: `lap/state | blocker | ETA`. 90-min ticket budgets; silence past budget = reassign.

## Decisions

| Date | Decision | Rule |
|---|---|---|
| 2026-07-11 | Domain | `ring.zenod.dev`. Landing at root, dashboard `/app`, `/mcp`, `/healthz`. |
| 2026-07-11 | Accounts | Same GitHub OAuth app + account system as Zenod (DUPLICATE; creds from the zenod unit's Dokploy env). Callback addition if needed → BLOCKED ON JORDI with the exact URL. GitHub only. |
| 2026-07-11 | SHIP scope | Chat + wallet + ONE wired unit (the tenant's Zenod) with one routed action returning a receipt (SHIP 7). Chat-only is NOT ship. (Jordi 2026-07-11.) |
| 2026-07-11 | Channels | NONE in the Ring (D14). Webchat only. Phylax integrates later by calling the Ring's MCP face — which is why SHIP 8 exists. |
| 2026-07-11 | LLM key | Per tenant, entered via the Keys UI. Never injected. Manager's laps use the capped TEST OpenRouter key entered through the UI. |
| 2026-07-11 | Pricing | Self-hosted (free) / Monthly / Yearly, Stripe TEST, same account. |
| 2026-07-11 | Conduct kit | Register async ticket shapes with any receipt middleware BEFORE walking (the Zenod silent_ack lesson). |
| 2026-07-11 | Anything unanswered | Simplest option, journal it, keep moving. |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#837](https://github.com/zenod-ai/zenod/issues/837) | Ticket worker | R-S1-worker | R-S1 front duplicate (landing, auth, tenants) | done | - | [#841](https://github.com/zenod-ai/zenod/pull/841) / `codex/r-s1-front-duplicate` | `fcac83f` | SHIP 1–4 | CI green; merged `0bbd045` | 2026-07-11T02:33:31+02:00 | integrated |
| [#836](https://github.com/zenod-ai/zenod/issues/836) | Ticket worker | R-S2-worker | R-S2 council middle (ChatTab + persona + Keys, tenant-scoped) | done | - | [#842](https://github.com/zenod-ai/zenod/pull/842) / `codex/r-s2-council-middle` | `fcac83f` | SHIP 5–6 | CI green; Ring namespace fix; merged `4ed9440` | 2026-07-11T02:33:31+02:00 | integrated |
| [#838](https://github.com/zenod-ai/zenod/issues/838) | Ticket worker | R-S3-worker | R-S3 wallet (peers surface → per-tenant unit wallet) | done | #837, #836 done | [#850](https://github.com/zenod-ai/zenod/pull/850) / `codex/r-s3-wallet` | `4ed9440` | SHIP 7 | CI green; 46 focused tests; merged `9e5862c` | 2026-07-11T02:46:31+02:00 | integrated |
| [#839](https://github.com/zenod-ai/zenod/issues/839) | Ticket worker | R-S4-worker | R-S4 billing + domain (duplicate recipe) | done | #837 done | [#849](https://github.com/zenod-ai/zenod/pull/849) / `codex/r-s4-billing-domain` | `4ed9440` | SHIP 2, 4 live | CI green; guarded runbook/script; merged `6352ee1` | 2026-07-11T02:46:31+02:00 | integrated; manager cutover |
| [#840](https://github.com/zenod-ai/zenod/issues/840) | Epic worker | Ring delivery manager | R-S5 journey loop + MCP-face check + isolation + package | blocked | #837, #836, #838, #839 done | `main` / manager journey; fixes [#852](https://github.com/zenod-ai/zenod/pull/852), [#853](https://github.com/zenod-ai/zenod/pull/853), [#856](https://github.com/zenod-ai/zenod/pull/856), [#857](https://github.com/zenod-ai/zenod/pull/857) | `a729d08` live | SHIP 1–10 | 1–6 pass; 7 wallet pass/receipt timeout; 8 external chat pass; 9 persistence+isolation pass | 2026-07-11T04:31:00+02:00 | BLOCKED ON JORDI: another focused lap or stop |
| [#854](https://github.com/zenod-ai/zenod/issues/854) | Ticket worker | R-S5a-worker | Surface downstream Zenod commit receipt in Council chat | done (code) | #840 | [#856](https://github.com/zenod-ai/zenod/pull/856) / `codex/r-s5a-zenod-receipt` | `527023c` | SHIP 7 receipt within 180s | CI + review pass; live still times out | 2026-07-11T04:31:00+02:00 | epic blocker remains |
| [#855](https://github.com/zenod-ai/zenod/issues/855) | Ticket worker | R-S5b-worker | Make `chat_with_ring` satisfy conduct-kit receipt gate | done | #840 | [#857](https://github.com/zenod-ai/zenod/pull/857) / `codex/r-s5b-mcp-receipt` | `527023c` | SHIP 8 external chat reply | live HTTP 200 + Council reply + `chat_audit` evidence | 2026-07-11T04:31:00+02:00 | integrated |
| [#858](https://github.com/zenod-ai/zenod/issues/858) | Ticket worker | R-S5c-worker | Diagnose and close live Zenod receipt timeout | in progress | #840, #854 | `codex/r-s5c-live-receipt` / `../wt-r-s5c` | `de327ac` | exact SHIP 7 receipt within 180s | focused lap authorized | 2026-07-11T04:38:00+02:00 | live evidence diagnosis, smallest fix, PR |

## Branch And Integration

- Base pinned at dispatch; no rebases until the journey passes (D19c).
- One worktree per worker; shared clone read-only on main.
- Manager integrates passing PRs; deploy = rebuild the ONE ring app. Targeted tests + journey only.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| GitHub OAuth callback addition | Jordi | Only if manager can't edit the app | Paste the exact URL | Everything else |
| Anything touching live Zenod/Callisthenes/paying tenants | Jordi | Should not occur | BLOCKED ON JORDI | All else |

## Recovery And Takeover

Stale assignment policy: manager reassigns any ticket silent past its 90-minute budget.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | - |

## Planner Queue

- None. The spine is the planner.

## Worker Queue

- Wave 1: R-S1, R-S2. Wave 2: R-S3, R-S4. Then R-S5.

## Tester Queue

- R-S5 includes SHIP 8 (MCP face) — the contract Phylax consumes next.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-11 | SHIP live gate | `fde458f` | ring.zenod.dev live | real Chrome walk, external MCP client, two bearer-authenticated tenants | BLOCKED: SHIP 7 receipt missing after 180s; SHIP 8 mutating call `silent_ack`; all other gates pass | `docs/evidence/ring-ship-2026-07-11/TEST-PACKAGE.md` |
| 2026-07-11 | Authorized receipt fix lap | `a729d08` | ring.zenod.dev live | real Chrome SHIP 7–9, external MCP chat, two bearer-authenticated tenants | BLOCKED: SHIP 7 still lacks commit receipt; SHIP 8–9 pass | `docs/evidence/ring-ship-2026-07-11/11`–`14`; `TEST-PACKAGE.md` |

## Handoff Journal

### 2026-07-11T04:38:00+02:00 - Ring delivery manager - Focused SHIP 7 diagnosis lap authorized

Context: Jordi authorized continuation after the `a729d08` live receipt timeout. #858 is pinned to `de327ac` in `codex/r-s5c-live-receipt` / `../wt-r-s5c`. This lap begins from the live Ring/Zenod durable audit and job records; code changes are limited to the smallest proven receipt-contract correction.
Next: reproduce the precise live failure, merge only reviewed passing code, deploy one exact SHA, and rerun the exact SHIP 7 browser phrase.

### 2026-07-11T04:31:00+02:00 - Ring delivery manager - Authorized lap consumed; SHIP 7 remains blocked

Context: PRs #856/#857 passed CI and independent review, including per-poll wallet SSRF revalidation, then merged into frozen build `a729d08`. The isolated Ring app was guardedly deployed and exact-SHA health passed. On that same live build, external MCP initialize + `chat_with_ring` returned HTTP 200, a non-error Council reply, and durable `chat_audit` evidence; logout/login retained chat, wallet, and masked OpenRouter settings; a newly provisioned second bearer tenant could not read the first tenant's peers or key settings.
Blocker: the exact SHIP 7 phrase routed to connected Zenod and held the UI for the complete polling window, then returned only “queued … I'll confirm once it's filed,” with no commit SHA/URL. The one additional lap Jordi authorized is exhausted.
Evidence: `docs/evidence/ring-ship-2026-07-11/11-authorized-lap-receipt-timeout.png` through `14-authorized-lap-isolation-alpha.png` and updated `TEST-PACKAGE.md`.
Next: BLOCKED ON JORDI — authorize another focused diagnosis/fix lap for SHIP 7, or stop Ring SHIP.

### 2026-07-11T04:10:00+02:00 - Ring delivery manager - One additional receipt fix lap authorized

Context: Jordi answered “go for it,” authorizing exactly the requested additional lap without changing acceptance or broader scope. The manager split the two independent receipt seams into #854 (`codex/r-s5a-zenod-receipt`, `../wt-r-s5a`) and #855 (`codex/r-s5b-mcp-receipt`, `../wt-r-s5b`), both pinned to `527023c` and dispatched in parallel.
Next: merge only targeted passing fixes, deploy one frozen exact SHA, and rerun SHIP 7–10 on `ring.zenod.dev`.

### 2026-07-11T04:01:00+02:00 - Ring delivery manager - Live gate frozen; final fix budget exhausted

Context: Final live image `fde458f` passed CI, published, and was guardedly deployed to the isolated Ring application. The manager completed GitHub OAuth, Stripe TEST checkout, dashboard, a $1-capped OpenRouter key entered and tested through the UI, Zenod wallet connection, external MCP initialize/read, logout/login persistence, and live bearer-scoped two-tenant isolation. The dashboard and tenant state persist on Ring's `/data`; existing Zenod and Callisthenes services were not redeployed.
Blocker: `remember this: the ring is alive` routed to Zenod and stayed at “Saving to Zenod’s memory” without a commit receipt after 180 seconds. External `chat_with_ring` reached Ring but the receipt middleware returned `silent_ack` because its successful mutating result had no `evidence[]`; initialize and `read_llm_timeline` passed. D19's final allowed fix lap is exhausted.
Evidence: `docs/evidence/ring-ship-2026-07-11/TEST-PACKAGE.md` and screenshots `01`–`10`.
Next: BLOCKED ON JORDI — authorize exactly one additional fix lap for these two receipt-path seams, then rerun only SHIP 7–10 and freeze a new exact SHA.

### 2026-07-11T02:46:31+02:00 - Ring delivery manager - Wave 2 integrated; R-S5 frozen

Context: R-S4 passed CI and merged as `6352ee1`; R-S3 stayed within its hard budget, passed CI after scoping terminal receipt polling to Ring wallet peers, and merged as `9e5862c`. The live baseline still serves only the old Ring static root; `/app`, `/healthz`, and `/mcp` are 404, so no prior deployment is being mistaken for SHIP.
Frozen test commit: `9e5862ced52d5b7dd7abcde69f51ee4003d8cdb7`. One full live gate will run on its immutable image per D19c/D21.
Next: create the empty Ring Dokploy application, execute the guarded cutover without mutating existing units, then run the browser/MCP/two-tenant journey and package screenshots.

### 2026-07-11T02:33:31+02:00 - Ring delivery manager - Wave 1 integrated; wave 2 dispatched

Context: R-S1 passed CI and merged as `0bbd045`; R-S2 passed CI and merged as `4ed9440` after manager review caught and closed a customer-layer namespace seam so Ring accounts, checkout URLs, OAuth callback, and storage use `ring` / `ring.zenod.dev`. Wave 2 is pinned to integrated commit `4ed94400f1bbdd9cb8252def2b72b2614ee3a354` without rebasing wave 1.
Assignments: R-S3-worker / `codex/r-s3-wallet` / `../wt-r-s3` with the hard 90-minute escalate-not-invent budget; R-S4-worker / `codex/r-s4-billing-domain` / `../wt-r-s4`.
Next: integrate R-S3/R-S4, publish and deploy the one Ring unit without touching live Zenod/Callisthenes services, then start the R-S5 live journey at `https://ring.zenod.dev/`.

### 2026-07-11T02:20:29+02:00 - Ring delivery manager - Steward bound and wave 1 dispatched

Context: stewardship transferred from the planner to the Ring delivery manager before concurrent ticket work. `main` and `origin/main` are aligned at pinned base `fcac83ff27e04b60b19a3cfae0ff62bf8f0f5a92`; the shared checkout's unrelated pre-existing edits to `docs/EPIC-4.0-HERALD.md` and `docs/EPIC-4.2-POC-LOOP-CORE.md` remain untouched. R-S1..R-S5 were minted as issues #837, #836, #838, #839, and #840.
Assignments: R-S1-worker / `codex/r-s1-front-duplicate` / `../wt-r-s1`; R-S2-worker / `codex/r-s2-council-middle` / `../wt-r-s2`.
Next: monitor the 90-minute budgets, integrate passing PRs, dispatch R-S3/R-S4 from the integrated wave-2 base, deploy the one Ring app, then walk R-S5 from `https://ring.zenod.dev/`.

### 2026-07-11 - Planner - Ring sprint spine created

Context: Third unit on the duplicate-and-adapt recipe. The one new-ish seam is the wallet (R-S3, evolving the existing peers surface) — flagged with a hard budget and escalation rule. SHIP 8 (MCP face) deliberately included because EPIC-P (Phylax) forwards inbound WhatsApp to exactly that contract.
Next: dispatch the manager.
Risks: wallet seam; per-tenant chat-history storage paths.
Links: `docs/EPIC-Z-NIGHT-SPRINT.md`, `docs/EPIC-C-CALLISTHENES-SPRINT.md`, `docs/EPIC-P-PHYLAX-SPRINT.md`.

## Open Questions

- None permitted. Decisions table or simplest option + journal.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-11 | `docs/EPIC-3.4-RING-MULTITENANT.md` | Mark superseded by this spine. | this spine | manager on bind | proposed |
| 2026-07-11 | `docs/EPIC-P-PHYLAX-SPRINT.md` | Notify on SHIP approval — unblocks Phylax dispatch. | this spine | manager | proposed |

## Appendix

Inputs from Jordi: none required. OAuth/Stripe creds read from existing Dokploy envs; the manager's journey uses the capped TEST OpenRouter key via the Keys UI.
