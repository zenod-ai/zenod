# EPIC C · Callisthenes Sprint — duplicate Zenod, swap the middle, sell the mouth

Status: active
Created: 2026-07-11
Updated: 2026-07-11
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-C-CALLISTHENES-SPRINT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Callisthenes delivery manager (bind on dispatch)
Steward since: on dispatch
Last reconciled commit: bind on dispatch
Planner: Jordi + Epic 3.0 planner
Worker: Callisthenes delivery manager + parallel ticket workers
Tester: the delivery manager itself (journey walker)

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Planner | Jordi + Epic 3.0 planner | This spine | Wrote it; every decision pre-answered below. | This document. |
| Epic worker | Callisthenes delivery manager | This spine | MANAGER: mint tickets, dispatch parallel worktree workers, integrate, walk the journey, iterate until SHIP. | The test package. |
| Ticket worker | assigned per ticket | One ticket, own worktree | FIRST ACTION: `git worktree add ../wt-<ticket> -b <branch> main`. Never checkout in the shared clone. Anything marked PORT: move code, adapt only imports/config — a scratch-written line duplicating source is a failing review. | PR + one-line result. |

## Write Scope

Bound spine: `docs/EPIC-C-CALLISTHENES-SPRINT.md`
Active steward: Callisthenes delivery manager

Writable by default:

- The steward reconciles this spine; ticket workers write to their issues.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-Z-NIGHT-SPRINT.md` — the completed Zenod sprint; THE TEMPLATE this epic duplicates.
- `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md` — the working product engine's history (three-input X connect, PIN, C-22 drafts-never-send, throttle, permalink receipts). Product truth lives here and in `units/callisthenes/` code.
- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — D19–D21 laws apply verbatim.
- `docs/EPIC-3.3-CALLISTHENES-MULTITENANT.md` — superseded by this spine.

Cross-spine change rule: read linked spines for context, but record proposed edits here unless explicitly granted write authority for the target spine.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | Product shape, journey, PORT/BUILD markings, pre-made decisions |
| `docs/EPIC-Z-NIGHT-SPRINT.md` + the live zenod unit | The customer-layer template being duplicated |
| `units/callisthenes/` + the deployed x-mcp service | The product engine being ported |
| GitHub issue | One ticket's execution detail |
| Validation evidence | The journey screenshots |

## Mission

Stand up Callisthenes — "one mouth for all your agents" — as the second self-contained unit at `calli.zenod.dev`, by DUPLICATING the working Zenod unit (landing, GitHub sign-in, Stripe subscription, tenant rows, dashboard shell, /mcp plumbing — all just proven in production) and swapping the product middle for the ALREADY-WORKING Callisthenes engine from Epic 2.4 (three-input X connect + PIN, drafts-never-send, throttle, permalink receipts). Nothing is invented. Everything is PORT or DUPLICATE. Done = the customer journey walked clean by the manager in a real browser, then by Jordi.

## Definition Of Done

SHIP — the journey, nothing else counts. The manager walks it in a REAL BROWSER on the LIVE deployment, in a loop (walk → first breakage → fix → deploy → walk again from step 1), until ONE uninterrupted clean pass, screenshots per step:

- [ ] 1. Open `calli.zenod.dev` logged out → a normal landing page: what Callisthenes is ("one mouth for all your agents — your keys, your throttle, receipts for every send"), Get started, Pricing, Sign in. No token field anywhere public.
- [ ] 2. Pricing: exactly three options — Self-hosted (free) / Monthly / Yearly, Stripe TEST.
- [ ] 3. Sign in with GitHub — same account system as Zenod (one identity across units), sign-in returns to the landing showing name + Dashboard link.
- [ ] 4. Subscribe (monthly, TEST card): server-side checkout session with `client_reference_id` = account id → webhook inserts the tenant row in THIS container → land in the dashboard.
- [ ] 5. Dashboard: **MCP URL + token front and center** with copy button and Claude/Codex snippets; Connect X card with the EXISTING three-credential inputs + Authorize + PIN flow; Drafts & receipts panel (read view); throttle state; usage; link back to landing. NO tabs from other units.
- [ ] 6. Connect X through the UI: paste the three app credentials → Authorize → approve on X → enter PIN → "Connected ✓", token pair in per-tenant custody.
- [ ] 7. Agent seam: an MCP client using the minted URL creates a post → held as draft (`[draft_not_approved]`, C-22); draft visible in the dashboard; `approve_send` via MCP posts EXACTLY ONCE → **canonical x.com permalink receipt** in the agent reply and dashboard history; throttle counter increments.
- [ ] 8. Logout/login persists everything. Second tenant provisioned by the manager cannot see the first tenant's connection, drafts, or receipts.
- [ ] 9. Test package: "I manually walked the full journey and it works. URL + screenshots. Now you test." Every element Jordi will click was clicked by the manager in the same deployed build.

HARDEN (after Jordi approves SHIP): dashboard Approve button (SHIP approves via MCP `approve_send` — existing code), Reddit/email connectors, Google sign-in, self-host README polish, retirement of the old x-mcp/callisthenes 2.x service (route to 3.7).

## Non-Goals

- Rewriting the Python engine in Node, or ANY change to send semantics, throttle defaults, C-22 discipline, or the PIN flow — the engine is a working organ; it moves, it does not change.
- New connectors, new UI design, chassis/framework language.
- Touching the live Zenod unit beyond reading its code as the template.

## Current State

Phase: dispatch-ready
Last verified: 2026-07-11
Integration target: main
Fresh base commit: current `main` at dispatch — PIN IT; no rebases until the journey passes (D19c)
Next action: manager pulls main, binds as steward, mints tickets C-S1..C-S5, dispatches wave 1 in parallel worktrees.
Blockers: none — decisions pre-answered below; inputs have absence-rules.

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
| 2 | `docs/EPIC-Z-NIGHT-SPRINT.md` + its ledger/journal | The completed template: how Zenod's customer layer was assembled, what broke, how it was fixed. Copy its answers. | Always |
| 3 | The live zenod unit code (customer layer: `customerAccounts/Billing/Identity/Layer/TenantBinding/TokenVault`, landing serving, dashboard views) | The code being DUPLICATED. | Workers |
| 4 | `units/callisthenes/` (`callisthenes_server.py`, `connect_page.py`, `auth/`, `throttle.py`, `draft_guard.py`) + the deployed x-mcp service | The engine being PORTED. | C-S2/C-S3 workers |
| 5 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` D19–D21 | The conduct laws. | Manager |

## Architecture And Context

Unit shape (per Law 1, "a unit may be a small compose but deploys and sells as one atomic thing"): ONE Dokploy application named `callisthenes`, ONE hostname `calli.zenod.dev`, composed of two services on a private network sharing the unit's fate: (a) **calli-front** — the duplicated Zenod customer layer (Node): landing, pricing, GitHub sign-in, Stripe, tenants table, dashboard, and the public `/mcp` + `/healthz`; it proxies engine calls; (b) **calli-engine** — the existing Python xmcp engine, unchanged in behavior, reached only from the front, holding X custody/throttle/drafts per tenant. If the manager finds it SIMPLER to keep the engine's own `/mcp` surface exposed directly through the front's auth (front resolves tenant, forwards bearer context), that is equally acceptable — simplest wiring wins; what may not change is the outside contract: one hostname, one app, tenant = bearer.

Tickets (every deliverable marked PORT/DUPLICATE per epicspine law #8 — nothing is BUILD):

- **C-S1 · Front duplicate** (DUPLICATE from zenod unit) — copy the customer layer + landing serving into the callisthenes front; swap copy/branding/pricing text; wire its tenants table; Zenod-specific tabs and panels deleted. Same GitHub OAuth app as Zenod (one identity across units); callback additions for calli.zenod.dev if required.
- **C-S2 · Engine port** (PORT from `units/callisthenes/` + deployed x-mcp) — the Python engine as-is: three-input connect + PIN, token custody per tenant (tenant context supplied by the front), throttle, draft_guard, send tools, permalink receipts. Behavior changes = failing review.
- **C-S3 · Dashboard product panels** (PORT `connect_page.py` flows into the dashboard + DUPLICATE Zenod's MCP-first panel) — MCP URL front and center; Connect X card (the existing 3-input + Authorize + PIN screens, tenant-scoped); drafts/receipts read panel; throttle + usage display.
- **C-S4 · Billing + domain** (DUPLICATE Zenod's) — three TEST prices for Callisthenes; webhook → tenant row in this container; Traefik route `calli.zenod.dev` → the unit; guarded cutover with health receipt, same runbook as Z-N5.
- **C-S5 · Journey loop** (manager) — walk SHIP 1–8, fix, re-walk from step 1, one clean pass, screenshots, test package. Includes the two-tenant isolation check (SHIP 8).

Wave 1: C-S1 ∥ C-S2. Wave 2: C-S3, C-S4. Then C-S5. Heartbeat every 30 min: `lap/state | blocker | ETA`. Budget 90 min per ticket; silent past budget = manager reassigns.

## Decisions

Pre-answered; the manager invents nothing:

| Date | Decision | Rule |
|---|---|---|
| 2026-07-11 | Domain | `calli.zenod.dev` (wildcard already resolves; canonical map). One hostname: landing at root, dashboard `/app`, `/mcp`, `/healthz`. No other hostnames, ever. |
| 2026-07-11 | Accounts | Same GitHub OAuth app and account system as Zenod — one identity across units. DUPLICATE the code; share the OAuth app credentials (read from the zenod unit's Dokploy env). If a separate callback URL for calli.zenod.dev must be added to the GitHub OAuth app and the manager cannot, post BLOCKED ON JORDI with the exact URL to paste. |
| 2026-07-11 | Sign-in | GitHub ONLY. No Google, no token-paste on any public route. |
| 2026-07-11 | Pricing | Self-hosted (free) / Monthly / Yearly. TEST prices via Stripe TEST API, sane placeholders. Same Stripe TEST account as Zenod. |
| 2026-07-11 | X credentials for the journey | READ the existing three X app credentials from the deployed callisthenes/x-mcp service's Dokploy env — Jordi's working app, do not create anything on X. The manager's journey laps connect with those creds and Jordi's existing X account flow; test posts are DELETED after the permalink is captured (screenshot first). If creds are unreadable from Dokploy/env, BLOCKED ON JORDI with the exact env var names. |
| 2026-07-11 | Approve path | SHIP approves via the existing MCP `approve_send` (zero new UI). A dashboard Approve button is HARDEN. |
| 2026-07-11 | Engine integrity | Throttle defaults, C-22 drafts-never-send, PIN flow, receipt shapes: UNCHANGED. The engine moves houses; it does not get remodeled. |
| 2026-07-11 | Old services | The 2.x callisthenes/x-mcp deployment keeps running untouched tonight; retirement is a 3.7 wave after Jordi approves SHIP. |
| 2026-07-11 | Conduct kit receipts | Apply the Zenod lesson from tonight BEFORE walking: async tools returning `{jobId}` must have their ticket shape registered with any receipt middleware — do not rediscover the silent_ack bug. |
| 2026-07-11 | Anything unanswered | Simplest option, note it in the journal, keep moving. |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mint | Ticket worker | assign | C-S1 front duplicate (DUPLICATE zenod customer layer + landing) | ready | - | worktree | pinned main | SHIP 1–4 render/flow | - | dispatch | wave 1 |
| mint | Ticket worker | assign | C-S2 engine port (PORT units/callisthenes, behavior frozen) | ready | - | worktree | pinned main | connect/draft/send/receipt work per tenant | - | dispatch | wave 1 |
| mint | Ticket worker | assign | C-S3 dashboard panels (PORT connect_page + DUPLICATE MCP-first panel) | ready | C-S1, C-S2 | worktree | pinned main | SHIP 5–6 | - | dispatch | wave 2 |
| mint | Ticket worker | assign | C-S4 billing + domain (DUPLICATE Z-N3/Z-N5 recipe) | ready | C-S1 | worktree | pinned main | SHIP 2, 4; calli.zenod.dev live, guarded | - | dispatch | wave 2 |
| mint | Epic worker | manager | C-S5 journey loop + two-tenant isolation + test package | ready | C-S1..4 | - | pinned main | SHIP 1–9 | - | dispatch | last |

## Branch And Integration

- Base pinned at dispatch; no rebases until the journey passes (D19c).
- One worktree per worker; shared clone stays on main, read-only; checkout there is a defect.
- Manager integrates passing PRs to main; deploy = rebuild the ONE callisthenes Dokploy app.
- No full workspace suites; targeted tests + the journey are the gates.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| GitHub OAuth callback addition | Jordi | Only if the manager cannot edit the OAuth app | Paste the exact callback URL provided | Everything else |
| X posting from Jordi's account | Jordi | Pre-authorized: journey laps may post and delete test posts using the existing X app/account per the Decisions table | None unless creds unreadable | Everything |
| Anything touching the live Zenod unit or live-paying tenants | Jordi | Should not occur | Do not touch; BLOCKED ON JORDI if unavoidable | All other tickets |

Do not use `human required` as a complete blocker. Blocked = entire status "BLOCKED ON JORDI: <one question>", that thread only.

## Recovery And Takeover

Stale assignment policy: manager reassigns any ticket silent past its 90-minute budget.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | - |

## Planner Queue

- None. The spine is the planner.

## Worker Queue

- Wave 1: C-S1, C-S2 in parallel. Wave 2: C-S3, C-S4. Then C-S5.

## Tester Queue

- C-S5: the manager walks the journey; two-tenant isolation included; nobody asks Jordi to click anything unclicked.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| pending | SHIP journey clean pass | - | calli.zenod.dev live | real browser walk, screenshots per step | pending | test package |

## Handoff Journal

### 2026-07-11 - Planner - Callisthenes sprint spine created

Context: Zenod (EPIC-Z) shipped as the template — landing, GitHub sign-in, Stripe→tenant rows, MCP-first dashboard, one container, journey-proven live at zenod.dev. This spine is the first duplicate-and-adapt: every deliverable is PORT or DUPLICATE, zero BUILD. The engine (2.4) already works in production; the customer layer just proved itself. Known trap pre-answered: the conduct-kit silent_ack receipt bug found on Zenod tonight — register async ticket shapes before walking.
Next: dispatch the manager.
Risks: front↔engine wiring (the only genuinely new seam — keep it the simplest thing that works); GitHub OAuth callback addition may need Jordi's paste; X test posts are real posts (delete after capture).
Links: `docs/EPIC-Z-NIGHT-SPRINT.md`, `units/callisthenes/`, `docs/EPIC-2.4-CALLISTHENES-MOVE-0.md`.

## Open Questions

- None permitted. Anything not answered by the Decisions table: simplest option, journal it, keep moving.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-11 | `docs/EPIC-3.3-CALLISTHENES-MULTITENANT.md` | Mark superseded by this spine. | this spine | manager on bind | proposed |
| 2026-07-11 | `docs/EPIC-3.7-DECOMMISSION-2X.md` | After SHIP approval, unblock the old callisthenes/x-mcp retirement wave (DX-4). | this spine | 3.7 manager | proposed |

## Appendix

Inputs from Jordi (all optional — absence-rules exist): none required. The GitHub OAuth app, Stripe TEST account, and X app credentials are all read from the existing deployed services' Dokploy environments. The only possible ask is pasting one OAuth callback URL if the manager lacks GitHub settings access.
