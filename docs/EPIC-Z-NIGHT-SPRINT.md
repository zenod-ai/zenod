# EPIC Z · Zenod Night Sprint — the complete atomic unit, testable by Jordi in the morning

Status: active
Created: 2026-07-11
Updated: 2026-07-11
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-Z-NIGHT-SPRINT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Night-sprint delivery manager (bind on dispatch)
Steward since: 2026-07-10T20:19:03+02:00
Last reconciled commit: 2962ab90617534db64264fb976498be6e50f16ab
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

Phase: minting
Last verified: 2026-07-10T20:19:03+02:00
Integration target: main
Fresh base commit: `2962ab90617534db64264fb976498be6e50f16ab` — pinned; no rebases until the journey passes (D19c)
Next action: manager mints tickets Z-N1..Z-N6, then dispatches Z-N1/Z-N2/Z-N4 in parallel worktrees immediately.
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
- **Z-N2 · CLOUD TRANSPLANT (Jordi, final): port the ENTIRE working customer layer from `zenod-ai/cloud` into the Zenod container** — not just auth. Everything that made cloud.zenod.dev work moves in as-is, adapting only imports/config: GitHub OAuth sign-in + session issuing + the login page with the Zenod guy picture; the account model; checkout/`create-checkout-session` + the Stripe webhook; the account/console UI pages; metering/balance display. Same OAuth app, same client id + secret (read from the cloud app's Dokploy env), same registered callbacks — which keep working because Traefik re-points `cloud.zenod.dev` at the Zenod container (Z-N5). EXCLUDED — do not port, these are the 2.x corpses this epic kills: the per-tenant Dokploy provisioner, watchdog registration, claim-link flow, and per-tenant DNS minting; where the old code called the provisioner, the new code inserts a tenant row in the SAME container. Any customer-layer line written from scratch that duplicates a line in `zenod-ai/cloud` is waste. Public token/password login removed from every public route (self-host admin may remain behind `/admin` only). No Google. Surface: auth + accounts + billing + account UI.
- **Z-N3 · Billing wiring** (after Z-N2) — the checkout + webhook code arrives WITH the Z-N2 transplant; this ticket only adapts it: three prices (self-hosted free / monthly / yearly), `client_reference_id` = account id, webhook's old provisioner call replaced by a tenant-row insert in this same container, success → dashboard, unsubscribed accounts → upgrade prompt. Surface: ported billing routes.
- **Z-N4 · Dashboard** — reshape `/app`: MCP URL + snippets first; vault connect; credit; settings; DELETE Transcription/WhatsApp/Telegram/Ring tabs and their nav entries for the zenod unit; back-link to landing. Surface: `apps/web` views.
- **Z-N5 · Domain** — Traefik re-points `cloud.zenod.dev` at the ZENOD CONTAINER (the old cloud service is retired from that hostname; Jordi authorized full overwrite). Landing at `zenod.dev` root if DNS confirmed, else at `cloud.zenod.dev` root; dashboard `/app`; `/mcp` same host; direct visit to `cloud.zenod.dev` = the ported login page. Re-mint MCP URLs on the canonical host; 301 `mind.zenod.dev`. `zenod.zenod.dev` is banned. Surface: proxy/Dokploy config.
- **Z-N6 · Journey loop** (manager, after integration) — walk, fix, re-walk to one clean pass; screenshots; morning package.

Parallel wave 1: Z-N1 ∥ Z-N2 ∥ Z-N4. Wave 2: Z-N3, Z-N5. Then Z-N6 loop. Heartbeat every 30 min: `lap/state | blocker | ETA`. Budget per ticket: 90 min, then report state.

## Decisions

Every decision pre-answered; the manager invents nothing:

| Date | Decision | Rule |
|---|---|---|
| 2026-07-11 | Domain (Jordi, final) | `zenod.zenod.dev` is BANNED — never use it, never mint anything on it. Layout: landing on `zenod.dev` if its DNS is confirmed; **`cloud.zenod.dev` is the auth + app host** — it already exists, is live ("Zenod Console" login page), holds the REGISTERED GitHub OAuth callback URLs, and may be FULLY OVERWRITTEN. If `zenod.dev` DNS is not ready, the landing also goes on `cloud.zenod.dev` root; do not stall. Direct visit to `cloud.zenod.dev` without passing the landing = the pure login page, reusing the existing design with the Zenod guy picture (it exists today — reuse, don't redesign). |
| 2026-07-11 | Credentials (Jordi, final — TAKE FROM THE WORKING PLATFORM, create NOTHING new) | Jordi will not re-provide or re-create any GitHub credential. (a) GitHub SIGN-IN OAuth app: already working on cloud.zenod.dev — its client id + secret are in the existing cloud service's environment (Dokploy env of the cloud/webhook application; source `zenod-ai/cloud` `services/webhook`, `docker-compose.cloud.yml`). Read them from Dokploy and reuse the SAME OAuth app — its callback URL already points at cloud.zenod.dev, which is exactly why cloud.zenod.dev is the auth host. (b) GitHub REPO access (vault connect): the existing GitHub App flow in `packages/server/src/githubLinks.ts` (`/api/github/app/start|callback|setup`) with its stored app credentials on the working platform's `/data`/settings — reuse it unchanged for repo selection. Verification is one command from the VPS: request the sign-in URL and read `client_id` + `redirect_uri` off the GitHub authorize redirect. If any credential is genuinely unreadable from Dokploy/env/data, that is the ONLY permitted "BLOCKED ON JORDI" on this topic — with the exact env var name needed. THE METHOD IS TRANSPLANT: the login code itself moves from `zenod-ai/cloud` into the Zenod container (Z-N2), which then serves cloud.zenod.dev directly — one container holds landing, login, billing, dashboard, MCP. Nothing auth-related is written from scratch tonight. |
| 2026-07-11 | Sign-in method | GitHub ONLY, by Jordi's explicit decision. The flow already works on the deployed pilot — reuse it, don't rebuild it. Google is a future HARDEN item; no Google button, no Google code tonight. |
| 2026-07-11 | Pricing | Self-hosted (free) / Monthly / Yearly. No pay-as-you-go. TEST prices: create via Stripe TEST API if none exist, any sane placeholder amounts. |
| 2026-07-11 | Identity binding | Checkout sessions server-side only, `client_reference_id` = account id. Never email matching. Anonymous buy click → sign-in first → straight into checkout. |
| 2026-07-11 | Auth planes | Humans: OAuth sign-in only. Tokens: agent credential only, shown inside the dashboard. Public token login is deleted. |
| 2026-07-11 | Transcription | Out of Zenod. Remove the tab. Code may remain dormant; no surface. |
| 2026-07-11 | Existing pilot tenants | Leave untouched; they keep working. No migration tonight. |
| 2026-07-11 | Chassis | The word does not appear in any ticket. Zenod's internal plumbing is Zenod's. |
| 2026-07-11 | Full cloud transplant (Jordi, final) | The ENTIRE working customer layer of `zenod-ai/cloud` (auth, accounts, checkout, Stripe webhook, account UI, metering) is PORTED into the Zenod container. Excluded corpses: Dokploy per-tenant provisioner, watchdog registration, claim links, per-tenant DNS — replaced by a tenant-row insert in the same container. The MCP server itself was never in cloud; it is already this container. After this port, `zenod-ai/cloud` runs nothing. |

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

### 2026-07-10T20:19:03+02:00 - Night-sprint delivery manager - Steward bound

Context: stewardship transferred from the planner to the Night-sprint delivery manager before concurrent ticket writing began. Main and origin/main were clean and aligned after pull.
Current commit: `2962ab90617534db64264fb976498be6e50f16ab`.
Next: mint Z-N1..Z-N6, create pinned worktrees for wave 1, and dispatch Z-N1/Z-N2/Z-N4.

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

1. **zenod.dev DNS**: confirm it points (or will point) at the VPS/proxy. Absent → landing goes on `cloud.zenod.dev` root, swap later. (`zenod.zenod.dev` is banned.)
2. **GitHub OAuth app**: REUSE the existing app already working on cloud.zenod.dev — creds in the cloud service's Dokploy env (see Credentials decision). Its callback already points at cloud.zenod.dev, so keeping auth on cloud.zenod.dev means NO GitHub settings changes at all. Nothing needed from Jordi.
3. Stripe TEST: already working from the pilot. Nothing needed.
4. OpenRouter key: NOT needed for SHIP (no model-dependent step in the journey). You'll paste it in the Keys tab in the morning if you want to chat/ingest with the model.
5. Google sign-in: NOT tonight, by decision. Future HARDEN item; creds will be provided when it's scheduled.
