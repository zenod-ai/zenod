# EPIC Z · Zenod Night Sprint — the complete atomic unit, testable by Jordi in the morning

Status: active
Created: 2026-07-11
Updated: 2026-07-11
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-Z-NIGHT-SPRINT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Night-sprint delivery manager (bind on dispatch)
Steward since: on dispatch
Last reconciled commit: bind on dispatch
Planner: Jordi + Epic 3.0 planner
Worker: Night-sprint delivery manager + parallel ticket workers
Tester: the delivery manager itself (journey walker)

## Role Bindings

| Identity | Assignment Identity | Bound Issue / Scope | Authority | Handoff |
|---|---|---|---|---|
| Planner | Jordi + Epic 3.0 planner | This spine | Wrote it; asleep during execution; every decision needed is pre-answered below. | This document. |
| Epic worker | Night-sprint delivery manager | This spine | MANAGER: mint the 6 tickets, dispatch workers in parallel worktrees, integrate, walk the journey, iterate until SHIP. | Morning package. |
| Ticket worker | assigned per ticket | One ticket, own worktree | FIRST ACTION: `git worktree add ../wt-<ticket> -b <branch> main`. Never checkout in the shared clone. | PR + one-line result. |

## Write Scope

Bound spine: `docs/EPIC-Z-NIGHT-SPRINT.md`
Active steward: Night-sprint delivery manager

Writable by default:

- The steward reconciles this spine; ticket workers write to their issues.
- Explicit narrow delegation: none.

Read-only linked spines:

- `docs/EPIC-3.2-ZENOD-MULTITENANT.md` — superseded by this spine; its deployed work is this sprint's starting material.
- `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` — D19–D21 laws apply verbatim (worktrees, heartbeats, shout-your-gates, one world, journey-first, never-ask-Jordi-to-click-the-unclicked).

Cross-spine change rule: none needed tonight; note anything for the morning in the Handoff Journal.

Stewardship transfer rule: record outgoing steward, incoming steward, absolute time, current commit, and next action before concurrent writing begins.

## Authority By Artifact

| Artifact | Authoritative For |
|---|---|
| This EpicSpine | The product shape, the journey, every pre-made decision |
| GitHub issue | One ticket's execution detail |
| Branch / PR / code | What exists |
| Validation evidence | The journey screenshots |

## Mission

Ship Zenod as ONE self-contained container that is the entire business: public landing page (the entry point), pricing, sign-in, Stripe subscription, customer dashboard, MCP endpoint. By morning, Jordi opens the landing page as a stranger and completes the whole customer journey himself. No chassis language, no framework work, no transcription — pure Zenod: connect your vault, get your MCP URL, see your credit.

## Definition Of Done

SHIP — the journey, nothing else counts. The manager walks it in a REAL BROWSER on the LIVE deployment, in a loop (walk → first breakage → fix → deploy → walk again from step 1), until ONE uninterrupted clean pass, screenshots per step:

- [ ] 1. Open the product domain logged out → a NORMAL LANDING PAGE: what Zenod is, "Get started", "Pricing", "Sign in". No console, no token field anywhere public.
- [ ] 2. Pricing page: exactly three options — Self-hosted (free, links to README/one-liner), Monthly, Yearly. Stripe TEST for the paid two.
- [ ] 3. Sign in with GitHub — the ONLY sign-in method tonight, and it already works on the deployed pilot; reuse that exact flow. Signing in returns you to the landing page, now showing your name + a "Dashboard" link. Registration IS sign-in. No Google button anywhere (future thing, not tonight).
- [ ] 4. Subscribe (monthly, TEST card): checkout session created server-side with `client_reference_id` = account id; webhook inserts the tenant row bound to that account; return lands in the dashboard.
- [ ] 5. Dashboard (`/app` or app subdomain, with a clear link back to the landing): MCP URL + token FRONT AND CENTER with copy button and Claude/Codex snippets; Connect-your-vault (GitHub repo authorize + pick — repo identity may differ from login identity); credit/usage; settings. Tabs REMOVED for Zenod: Transcription, WhatsApp, Telegram, Ring — gone, not hidden behind flags that might flip back.
- [ ] 6. Connect a test vault repo through the UI; MCP `initialize` + one tool call against the minted URL succeeds.
- [ ] 7. Log out, log back in: everything persists. An unsubscribed signed-in account sees the dashboard replaced by an upgrade prompt.
- [ ] 8. Morning package posted: "I walked the full journey myself and it works" + landing URL + per-step screenshots. Every element Jordi will click was clicked by the manager in the same deployed build.

HARDEN (not tonight): Google sign-in (future, by explicit Jordi decision 2026-07-11), transcription relocation to Phylax, old-tenant migration, mind.zenod.dev/cloud cleanup beyond what step 5 requires, self-host README polish.

## Non-Goals

- Anything chassis/framework/SEAM/spec-shaped. The unit is the unit.
- Callisthenes, Ring, Phylax, Epaminon.
- Transcription in any form (parked for Phylax; remove its tab).
- Full workspace test suites (targeted tests only; the journey is the gate).

## Current State

Phase: dispatch-ready
Last verified: 2026-07-11
Integration target: main
Fresh base commit: current `main` at dispatch — PIN IT; no rebases until the journey passes (D19c)
Next action: manager pulls main, binds as steward, mints tickets Z-N1..Z-N6, dispatches Z-N1/Z-N2/Z-N4 in parallel worktrees immediately.
Blockers: none — every decision is pre-answered below. Inputs from Jordi are non-blocking (decision rules given).

## Role Goals

| Identity | Goal | Terminal State |
|---|---|---|
| Epic worker | The journey passes clean; morning package delivered. | Package posted, or "BLOCKED ON JORDI: <one question>" as entire status. |
| Ticket worker | Ticket done in own worktree, PR opened. | PR + one-line result. |

## Bootstrap Map

Read in this order:

| Priority | Link | Why It Matters | When To Read |
|---|---|---|---|
| 1 | This spine, top to bottom | Everything is here. | Always |
| 2 | `apps/site/` | The EXISTING landing page to serve from the container. | Z-N1 worker |
| 3 | The deployed 3.2 pilot (Dokploy app + `packages/server`, `apps/web`) | The working multi-tenant Zenod this sprint reshapes. | All |
| 4 | `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` D19–D21 only | The conduct laws. | Manager |

## Architecture And Context

Starting material (all EXISTS and is deployed): multi-tenant Zenod container live with tenants table, GitHub sign-in, Stripe TEST checkout inserting tenant rows, working console (chat/vault/keys/costs), MCP tokened URLs, `apps/site` landing page (currently a separate nginx container). Tonight is ASSEMBLY AND REMOVAL: put the landing in front, wire sign-in and pricing into it, make the dashboard Zenod-only with the MCP URL first, kill the public token login, one domain family.

Tickets (parallel where no file overlap; each in own worktree):

- **Z-N1 · Landing + pricing** — serve `apps/site` from the Zenod container as `/` of the product domain; add Pricing page (3 options); Sign-in buttons; header shows session state. Surface: static site + routing.
- **Z-N2 · Auth** — GitHub OAuth ONLY (reuse the pilot's already-working flow — do not rebuild it, re-point it) → account + session; sign-in returns to landing; public token/password login removed from every public route (self-host admin path may remain behind `/admin` only). No Google anything. Surface: auth routes + landing header.
- **Z-N3 · Billing** (after Z-N2) — Pricing → server-side Stripe TEST checkout (`client_reference_id`), webhook → tenant row bound to account, success → dashboard, unsubscribed accounts → upgrade prompt. Surface: billing routes.
- **Z-N4 · Dashboard** — reshape `/app`: MCP URL + snippets first; vault connect; credit; settings; DELETE Transcription/WhatsApp/Telegram/Ring tabs and their nav entries for the zenod unit; back-link to landing. Surface: `apps/web` views.
- **Z-N5 · Domain** — one domain family per the Inputs decision rule; landing at root, dashboard at `/app` (or `app.` subdomain), `/mcp` on the same host; re-mint MCP URLs on the canonical host; 301 the old hostname. Surface: proxy/Dokploy config.
- **Z-N6 · Journey loop** (manager, after integration) — walk, fix, re-walk to one clean pass; screenshots; morning package.

Parallel wave 1: Z-N1 ∥ Z-N2 ∥ Z-N4. Wave 2: Z-N3, Z-N5. Then Z-N6 loop. Heartbeat every 30 min: `lap/state | blocker | ETA`. Budget per ticket: 90 min, then report state.

## Decisions

Every decision pre-answered; the manager invents nothing:

| Date | Decision | Rule |
|---|---|---|
| 2026-07-11 | Domain | If `zenod.dev` DNS is confirmed pointed at the VPS by dispatch time (see Inputs), use it: landing `zenod.dev`, dashboard `zenod.dev/app` (or `app.zenod.dev` if routing is simpler), MCP `zenod.dev/mcp/<token>`. If NOT confirmed: build everything on `zenod.zenod.dev` with identical structure and leave a one-line domain-swap note; do not stall. |
| 2026-07-11 | Sign-in method | GitHub ONLY, by Jordi's explicit decision. The flow already works on the deployed pilot — reuse it, don't rebuild it. Google is a future HARDEN item; no Google button, no Google code tonight. |
| 2026-07-11 | Pricing | Self-hosted (free) / Monthly / Yearly. No pay-as-you-go. TEST prices: create via Stripe TEST API if none exist, any sane placeholder amounts. |
| 2026-07-11 | Identity binding | Checkout sessions server-side only, `client_reference_id` = account id. Never email matching. Anonymous buy click → sign-in first → straight into checkout. |
| 2026-07-11 | Auth planes | Humans: OAuth sign-in only. Tokens: agent credential only, shown inside the dashboard. Public token login is deleted. |
| 2026-07-11 | Transcription | Out of Zenod. Remove the tab. Code may remain dormant; no surface. |
| 2026-07-11 | Existing pilot tenants | Leave untouched; they keep working. No migration tonight. |
| 2026-07-11 | Chassis | The word does not appear in any ticket. Zenod's internal plumbing is Zenod's. |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mint | Ticket worker | assign | Z-N1 landing + pricing served from the container | ready | - | worktree | pinned main | Journey steps 1–2 render | - | dispatch | dispatch wave 1 |
| mint | Ticket worker | assign | Z-N2 OAuth sign-in (GitHub, +Google per rule); kill public token login | ready | - | worktree | pinned main | Journey step 3; no public token field | - | dispatch | dispatch wave 1 |
| mint | Ticket worker | assign | Z-N4 dashboard reshape: MCP-first, vault, credit; delete non-Zenod tabs | ready | - | worktree | pinned main | Journey step 5 | - | dispatch | dispatch wave 1 |
| mint | Ticket worker | assign | Z-N3 Stripe subscribe → tenant row → dashboard; upgrade prompt | ready | Z-N2 | worktree | pinned main | Journey steps 4, 7b | - | dispatch | wave 2 |
| mint | Ticket worker | assign | Z-N5 one domain family; re-mint MCP URLs; 301 old host | ready | domain rule | worktree | pinned main | One host serves 1–7 | - | dispatch | wave 2 |
| mint | Epic worker | manager | Z-N6 journey loop to one clean pass + morning package | ready | Z-N1..5 | - | pinned main | SHIP items 1–8 | - | dispatch | last |

## Branch And Integration

- Base pinned at dispatch; no rebases until the journey passes (D19c).
- One worktree per worker (`git worktree add ../wt-<ticket> -b <branch> <pinned-main>`); the shared clone stays on main, read-only. Checkout in the shared clone is a defect.
- Manager integrates PRs to main as tickets land; deploy = Dokploy rebuild of the ONE Zenod app.
- Full test suites are not run tonight; targeted tests + the journey are the gates.

## Human Gates

| Gate | Human Owner | Trigger | Exact Approval / Input Required | What May Continue |
|---|---|---|---|---|
| Inputs (non-blocking) | Jordi | Before sleeping, ideally | See Inputs Needed below; decision rules cover absence | Everything |
| Anything touching the live-paying 2.x tenant | Jordi | Should not occur tonight | Do not touch it; if unavoidable, BLOCKED ON JORDI | All other tickets |

Do not use `human required` as a complete blocker. If genuinely stuck: entire status = "BLOCKED ON JORDI: <one question>" and stop that thread only.

## Recovery And Takeover

Stale assignment policy: manager reassigns any ticket silent past its 90-minute budget.

| Issue | Previous Assignment | Takeover Assignment | Starting Commit | Unverified Work | Recorded At |
|---|---|---|---|---|---|
| none | - | - | - | - | - |

## Planner Queue

- None. Planner is asleep. The spine is the planner.

## Worker Queue

- Wave 1: Z-N1, Z-N2, Z-N4 in parallel. Wave 2: Z-N3, Z-N5. Then Z-N6.

## Tester Queue

- Z-N6: the manager walks the journey; nobody asks Jordi to click anything unclicked.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| pending | SHIP journey clean pass | - | live product domain | real browser walk, screenshots per step | pending | morning package |

## Handoff Journal

### 2026-07-11 - Planner - Night sprint spine created

Context: 24 hours of process failure distilled into this shape: one self-contained Zenod (landing = entry point, pricing 3 options, OAuth sign-in, Stripe → tenant row, MCP-first dashboard, vault connect), journey as the only DoD, all decisions pre-made, parallel worktrees, budgets, heartbeats. Chassis dissolved into Zenod; 3.1 closed; 3.2 superseded by this spine.
Next: dispatch the manager.
Risks: the GitHub OAuth callback URL must match the chosen domain — Z-N2 handles it per the domain rule, or posts BLOCKED ON JORDI with the exact URL to paste. Sign-in is GitHub-only by Jordi's decision (2026-07-11); Google is future.
Links: `docs/EPIC-3.0-CHASSIS-REPLATFORM.md` (D19–D21), `apps/site/`, deployed pilot.

## Open Questions

- None permitted tonight. Anything not answered by the Decisions table defaults to: simplest option, note it in the journal, keep moving.

## Proposed Cross-Spine Updates

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-11 | `docs/EPIC-3.2-ZENOD-MULTITENANT.md` | Mark superseded by this spine. | this spine | morning | proposed |

## Appendix

Inputs Needed from Jordi (post as a comment on the manager's thread before sleeping; all have absence-rules, none block):

1. **zenod.dev DNS**: confirm it points (or will point) at the VPS/proxy. Absent → sprint builds on `zenod.zenod.dev`, swap later.
2. **GitHub OAuth app**: already works on the pilot — the only sign-in method tonight. If the domain changes, the manager updates its callback URL; if it lacks permission to, it posts BLOCKED ON JORDI with the exact URL to paste into the GitHub OAuth app settings.
3. Stripe TEST: already working from the pilot. Nothing needed.
4. OpenRouter key: NOT needed for SHIP (no model-dependent step in the journey). You'll paste it in the Keys tab in the morning if you want to chat/ingest with the model.
5. Google sign-in: NOT tonight, by decision. Future HARDEN item; creds will be provided when it's scheduled.
