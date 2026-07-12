# EPIC Z · Zenod Night Sprint — the complete atomic unit, testable by Jordi in the morning

Status: shipped
Created: 2026-07-11
Updated: 2026-07-12
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-Z-NIGHT-SPRINT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Night-sprint delivery manager (bind on dispatch)
Steward since: 2026-07-10T20:19:03+02:00
Last reconciled commit: `6f72b26775d51f3e51165379446ce13435ad1c1a`
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

- [x] 1. Open the product domain logged out → a NORMAL LANDING PAGE: what Zenod is, "Get started", "Pricing", "Sign in". No console, no token field anywhere public.
- [x] 2. Pricing page: exactly three options — Self-hosted (free, links to README/one-liner), Monthly, Yearly. Stripe TEST for the paid two.
- [x] 3. Sign in with GitHub — the ONLY sign-in method tonight, and it already works on the deployed pilot; reuse that exact flow. Signing in returns you to the landing page, now showing your name + a "Dashboard" link. Registration IS sign-in. No Google button anywhere (future thing, not tonight).
- [x] 4. Subscribe (monthly, TEST card): checkout session created server-side with `client_reference_id` = account id; webhook inserts the tenant row bound to that account; return lands in the dashboard.
- [x] 5. Dashboard (`/app` or app subdomain, with a clear link back to the landing): MCP URL + token FRONT AND CENTER with copy button and Claude/Codex snippets; Connect-your-vault (GitHub repo authorize + pick — repo identity may differ from login identity); credit/usage; settings. Tabs REMOVED for Zenod: Transcription, WhatsApp, Telegram, Ring — gone, not hidden behind flags that might flip back.
- [x] 6. Connect a test vault repo through the UI; MCP `initialize` + one tool call against the minted URL succeeds.
- [x] 7. Log out, log back in: everything persists. An unsubscribed signed-in account sees the dashboard replaced by an upgrade prompt.
- [x] 8. Morning package posted: "I walked the full journey myself and it works" + landing URL + per-step screenshots. Every element Jordi will click was clicked by the manager in the same deployed build.

HARDEN (not tonight): Google sign-in (future, by explicit Jordi decision 2026-07-11), transcription relocation to Phylax, old-tenant migration, mind.zenod.dev/cloud cleanup beyond what step 5 requires, self-host README polish.

## Non-Goals

- Anything chassis/framework/SEAM/spec-shaped. The unit is the unit.
- Callisthenes, Ring, Phylax, Epaminon.
- Transcription in any form (parked for Phylax; remove its tab).
- Full workspace test suites (targeted tests only; the journey is the gate).

## Current State

Phase: shipped; canonical Zenod Agent Skill v1.0.0 advertised and live-imported by Ring
Last verified: 2026-07-12T01:58:31+02:00
Integration target: main
Live Zenod MT artifact: `ghcr.io/zenod-ai/zenod:sha-e7dc215` (`e7dc215a566189c317a68533a7006c6d8a5b2d8f`)
Wave 1 base commit: `2632e8f68122a7e05a178020bb0601813de36704` — pinned; no rebases were performed (D19c)
Wave 2 base commit: `43a38a0b551e13d9205455bf09e740fa745799b9` — integrated wave 1, pinned
Next action: keep the shipped journey and advertised skill contract stable; plan Iteration 2 for the two untargeted memory-test failures and separately service [#835](https://github.com/zenod-ai/zenod/issues/835).
Blockers: none — every decision is pre-answered below. Inputs from Jordi are non-blocking (decision rules given).

## Steward Commentary And Reasoning

Reconciled 2026-07-12 against `main` at `6f72b26` and live `cloud.zenod.dev` health at exact SHA `e7dc215a566189c317a68533a7006c6d8a5b2d8f`.

- **What changed:** Zenod now owns and publishes the canonical `zenod@1.0.0` Agent Skill as a three-file same-origin bundle. Ring can discover and attach it automatically for an existing Zenod peer, while the tenant can still replace or detach it.
- **Why it was added:** an MCP catalog can describe callable operations, but it cannot carry the durable product-level workflow for storing, retrieving, citing, and verifying memory. The skill supplies that operating guidance without duplicating tools or changing their schemas.
- **Why the skill is not authoritative:** live MCP discovery remains the source of truth for tool existence and input schemas. Skill prose is untrusted advisory content, cannot authorize mutations, cannot prove that a write happened, and cannot make scripts executable.
- **Why auto-import is constrained:** same-origin, redirect-free, bounded bundles avoid turning connection into an arbitrary fetch surface. A persisted detach opt-out preserves user control and prevents a refresh from silently undoing an explicit choice.
- **Current assessment:** the implementation is additive and correctly separated from Zenod's memory runtime. No Zenod code or deployment after `e7dc215` changes this contract; later related work is Ring-side reply and catalog hardening.

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
| 2026-07-11 | Published Agent Skill | Zenod owns canonical `zenod@1.0.0` guidance under `units/zenod/skill/zenod/`. Its D16 well-known card advertises a same-origin, redirect-free, size-bounded bundle. Hosts may import it as untrusted progressive guidance; live `tools/list` remains authoritative and scripts remain inert. |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#802](https://github.com/zenod-ai/zenod/issues/802) | Ticket worker | Z-N1-takeover / Hegel | Z-N1 landing + pricing served from the container | done | - | [#810](https://github.com/zenod-ai/zenod/pull/810) / `codex/z-n1-landing-pricing` | `2632e8f` | Journey steps 1–2 render | targeted tests/build/typecheck; merged `43a38a0` | 2026-07-10T21:12:00+02:00 | integrated |
| [#806](https://github.com/zenod-ai/zenod/issues/806) | Ticket worker | Z-N2-worker / Feynman | Z-N2 total cloud customer-layer transplant | done | - | [#809](https://github.com/zenod-ai/zenod/pull/809) / `codex/z-n2-auth-transplant` | `2632e8f` | Auth/accounts/billing/UI/metering ported; four corpses excluded | 43 targeted tests + builds; merged `b248687` | 2026-07-10T21:11:00+02:00 | integrated |
| [#801](https://github.com/zenod-ai/zenod/issues/801) | Ticket worker | Z-N4-worker / Arendt | Z-N4 dashboard reshape: MCP-first, vault, credit; delete non-Zenod tabs | done | - | [#808](https://github.com/zenod-ai/zenod/pull/808) / `codex/z-n4-dashboard` | `2632e8f` | Journey step 5 | 5 tests + build/browser checks; merged `f5c2cf0` | 2026-07-10T21:04:00+02:00 | integrated |
| [#804](https://github.com/zenod-ai/zenod/issues/804) | Ticket worker | Z-N3-worker / Archimedes | Z-N3 adapt transplanted Stripe billing to local tenant rows | done | [#806](https://github.com/zenod-ai/zenod/issues/806) done | [#813](https://github.com/zenod-ai/zenod/pull/813) / `codex/z-n3-billing` | `43a38a0` | Journey steps 4, 7b | merged `1e76bde`; live TEST checkout inserted tenant | 2026-07-10T23:16:00+02:00 | integrated |
| [#803](https://github.com/zenod-ai/zenod/issues/803) | Ticket worker | Z-N5-worker / Turing | Z-N5 one domain family; re-mint MCP URLs; 301 mind host | done | domain rule resolved | [#812](https://github.com/zenod-ai/zenod/pull/812) / `codex/z-n5-domain` | `43a38a0` | One container serves 1–7; cloud runs nothing | cloud canonical; retired hosts 404; mind path-preserving 301 | 2026-07-10T23:16:00+02:00 | integrated |
| [#805](https://github.com/zenod-ai/zenod/issues/805) | Epic worker | Night-sprint delivery manager | Z-N6 journey loop to one clean pass + morning package | done | Z-N3, Z-N5 | [#814](https://github.com/zenod-ai/zenod/pull/814), [#815](https://github.com/zenod-ai/zenod/pull/815), [#816](https://github.com/zenod-ai/zenod/pull/816), [#817](https://github.com/zenod-ai/zenod/pull/817) | `43a38a0` | SHIP items 1–8 | uninterrupted Chrome pass on `35f7cd8`; seven screenshots; MCP initialize + tool call | 2026-07-10T23:16:00+02:00 | morning package |
| [#828](https://github.com/zenod-ai/zenod/pull/828) | Ticket worker | Async receipt fix | Preserve accepted receipts for async MCP tools | done | shipped MT | [#828](https://github.com/zenod-ai/zenod/pull/828) | `6708d5f` | `store_memory`/`ingest_memory`/`task_brain`/`run_task` return accepted ticket contracts | merged `95f9370`; live `F5 banana receipt-fix` stored once and found | 2026-07-11T02:05:00+02:00 | integrated |
| [#831](https://github.com/zenod-ai/zenod/issues/831) | Tester | Iteration 1 steward | Human-like Zenod MT memory acceptance battery | testing | shipped MT | reports [#832](https://github.com/zenod-ai/zenod/issues/832), [#833](https://github.com/zenod-ai/zenod/issues/833), [#834](https://github.com/zenod-ai/zenod/issues/834) | `95f9370` | write, narrow/broad recall, synthesis, correction, distractors, unknowns, citations | baseline 12 PASS / 5 FAIL; targeted remediation 3/3 PASS on `6352ee1` | 2026-07-11T03:03:00+02:00 | Iteration 2 for two residual failures |
| [#832](https://github.com/zenod-ai/zenod/issues/832) | Tester | Harvey | L1 durable write + narrow retrieval | test complete / open | #831 | evidence comment | `95f9370` | receipt, terminal write, exact/narrow retrieval, readback, once-only | core 6/6; supplemental multi-term ranking failed, then passed after #843 | 2026-07-11T03:03:00+02:00 | close with parent or carry to Iteration 2 |
| [#833](https://github.com/zenod-ai/zenod/issues/833) | Tester | Bohr | L2 paraphrase, broad recall, synthesis | partial / open | #831 | evidence comment | `95f9370` | human narrow + broad, marker scope, synthesis | baseline 2/5; human narrow and broad grounding targets now pass; marker-scoped broad isolation remains unrerun | 2026-07-11T03:03:00+02:00 | Iteration 2 marker-isolation replay |
| [#834](https://github.com/zenod-ai/zenod/issues/834) | Tester | Arendt | L3 correction, distractor, unknown, citations | partial / open | #831 | evidence comment | `95f9370` | correction, near-match, unknown honesty, citation dereference | 4/5; response completeness still omitted requested `Amber-902` | 2026-07-11T03:03:00+02:00 | Iteration 2 completeness replay |
| [#835](https://github.com/zenod-ai/zenod/issues/835) | Ticket worker | unassigned | Zenod MT `create_issue` generic `tool_error` | proposed / open | - | - | live MT | create issue or return structured permission/config error | reproduced; `gh` fallback used for test backlog | 2026-07-11T00:14:00+02:00 | assign independently |
| [#843](https://github.com/zenod-ai/zenod/issues/843) | Ticket worker | Kant | Boost exact phrase + all-term deterministic ranking | done | #832 | [#846](https://github.com/zenod-ai/zenod/pull/846) | `0bbd045` | exact/multi-term fixture ranks first | merged `dbdd1c8`; live replay rank 1 on `6352ee1` | 2026-07-11T03:03:00+02:00 | closed |
| [#844](https://github.com/zenod-ai/zenod/issues/844) | Ticket worker | Lovelace | Retry before `ask_brain` concludes absent | done | #833 | [#847](https://github.com/zenod-ai/zenod/pull/847) | `0bbd045` | human narrow recall finds explicitly requested synthetic evidence | merged `49afb56`; live answer returned 14 days + LumenCell 42 | 2026-07-11T03:03:00+02:00 | closed |
| [#845](https://github.com/zenod-ai/zenod/issues/845) | Ticket worker | Popper | Reject out-of-scope literals + invalid citations | done | #833 | [#848](https://github.com/zenod-ai/zenod/pull/848) | `0bbd045` | broad replay has no neighboring literal or invalid anchor | merged `abc2657`; live scoped broad replay passed | 2026-07-11T03:03:00+02:00 | closed |
| [#892](https://github.com/zenod-ai/zenod/issues/892) | Ticket worker | Zenod skill steward | Advertise canonical Zenod skill and auto-attach in Ring | done | Ring skill store/runtime | [#893](https://github.com/zenod-ai/zenod/pull/893) / `codex/zenod-advertised-skill` | `e5387eb` | public canonical bundle; same-origin auto-import; manual detach authority; progressive load | merged/deployed `e7dc215`; browser card + audited `load_peer_skill` pass | 2026-07-11T14:35:28+02:00 | closed |

## Branch And Integration

- Base pinned at dispatch; no rebases until the journey passes (D19c).
- One worktree per worker (`git worktree add ../wt-<ticket> -b <branch> <pinned-main>`); the shared clone stays on main, read-only. Checkout in the shared clone is a defect.
- Manager integrates PRs to main as tickets land; deploy = Dokploy rebuild of the ONE Zenod app.
- Full test suites are not run tonight; targeted tests + the journey are the gates.
- Post-ship memory remediation exception: combined build + full workspace suite + main CI + published-image boot smoke passed before deploying `sha-6352ee1`.

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
| [#802](https://github.com/zenod-ai/zenod/issues/802) | Z-N1-worker / Jason | Z-N1-takeover / Hegel | `2632e8f` | landing/static-routing worktree changes | 2026-07-10T21:03:00+02:00 |

## Planner Queue

- Iteration 2: isolate the two remaining Iteration 1 failures without reopening the three green targets: marker-scoped broad isolation ([#833](https://github.com/zenod-ai/zenod/issues/833)) and response completeness ([#834](https://github.com/zenod-ai/zenod/issues/834)).
- Service the independent backlog-write tooling defect [#835](https://github.com/zenod-ai/zenod/issues/835).

## Worker Queue

- Original night-sprint waves are complete.
- No active remediation worker. #843/#844/#845 are merged, deployed, live-retested, and closed.

## Tester Queue

- Original Z-N6 browser journey is complete.
- Iteration 2 should rerun only the two residual memory behaviors, then update #831's aggregate score.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-10 | SHIP journey clean pass | `35f7cd8` | `zenod.dev` + `cloud.zenod.dev` | Chrome stranger journey, Stripe TEST card, existing GitHub App repo picker, MCP JSON-RPC, logout/login | PASS | `docs/evidence/night-sprint-2026-07-10/` |
| 2026-07-11 | Async MCP accepted receipt | `95f9370` | live `cloud.zenod.dev/mcp` | `store_memory` -> accepted ticket -> terminal receipt -> `search_memory("F5 banana receipt-fix 95f9370")` | PASS | ticket `d24c9345-68db-4a04-b646-dad1b9db0aa0`; `Log/2026-07-11.md#^e-2c5f8d`; vault commit `e92cd157` |
| 2026-07-11 | Memory acceptance Iteration 1 baseline | `95f9370` | live Zenod MT MCP | three parallel human-like lanes: write/read, narrow/broad/synthesis, correction/distractor/unknown/citations | 12 PASS / 5 FAIL | [#831 summary](https://github.com/zenod-ai/zenod/issues/831#issuecomment-4940697880), [#832](https://github.com/zenod-ai/zenod/issues/832), [#833](https://github.com/zenod-ai/zenod/issues/833), [#834](https://github.com/zenod-ai/zenod/issues/834) |
| 2026-07-11 | Memory acceptance targeted remediation | `6352ee1` | live `cloud.zenod.dev/mcp`; image `sha-6352ee1` | combined build/full suite; main CI; image boot smoke; exact replay of multi-term search, human narrow recall, human broad grounding | 3/3 PASS | [#831 remediation summary](https://github.com/zenod-ai/zenod/issues/831#issuecomment-4940865726), [#843](https://github.com/zenod-ai/zenod/issues/843#issuecomment-4940862444), [#844](https://github.com/zenod-ai/zenod/issues/844#issuecomment-4940863414), [#845](https://github.com/zenod-ai/zenod/issues/845#issuecomment-4940864648) |
| 2026-07-11 | Published Zenod Agent Skill | `e7dc215` | live `cloud.zenod.dev` + `ring.zenod.dev` | public card/bundle curl; signed-in Chrome Ring reload; external Ring MCP chat; service log audit | PASS: `zenod@1.0.0`, 3 inert files, auto-attached; `load_peer_skill` executed | `docs/evidence/ring-zenod-skill-2026-07-11/zenod-auto-attached.png`; correlation `test_abdfd93795ad4ff1a6fac8ebc8c16ca6` |
| 2026-07-12 | Latest-state reconciliation | `e7dc215` | cloud.zenod.dev live | exact `/api/health` SHA plus relevant-path history from `e7dc215` to `main` | PASS: service healthy; no later Zenod runtime or skill-contract change found | Health returned `e7dc215a566189c317a68533a7006c6d8a5b2d8f`; Ring-only hardening is summarized in the linked Ring spine |

## Handoff Journal

### 2026-07-12T01:58:31+02:00 - Spine steward - Latest state and reasoning reconciled

Context: `cloud.zenod.dev` remains healthy on exact SHA `e7dc215a566189c317a68533a7006c6d8a5b2d8f`. Repository history after that release contains no later change to Zenod's runtime or canonical skill contract; the subsequent relevant changes are Ring-side catalog, intent, approval, and receipt hardening. The current-state rollup, reconciliation base, validation table, and steward commentary now say this explicitly.
Reasoning: Zenod should own durable memory behavior and portable operating guidance, while a consuming host owns discovery, routing, authorization, and receipt enforcement. Keeping that boundary avoids coupling Zenod to Ring and prevents skill text from becoming executable authority.
Next: retain `e7dc215` as the current validated Zenod artifact until a Zenod-specific release is deployed and walked; the open memory Iteration 2 items and #835 remain separate backlog rather than implied completed work.

### 2026-07-11T14:35:28+02:00 - Zenod skill steward - Canonical skill advertised to Ring

Context: [#893](https://github.com/zenod-ai/zenod/pull/893) merged and the published `sha-e7dc215` image passed its boot smoke. The same immutable image is live on `cloud.zenod.dev` and `ring.zenod.dev`; both health endpoints report `e7dc215a566189c317a68533a7006c6d8a5b2d8f`. Zenod now publishes a D16 card plus a same-origin three-file `zenod@1.0.0` bundle. Ring imported it for the existing saved Zenod peer without reconnecting. The signed-in My Units surface shows the skill, and an external Ring MCP chat invoked `load_peer_skill`, returning `zenod 1.0.0 false`; service correlation `test_abdfd93795ad4ff1a6fac8ebc8c16ca6` records the loader start/end and successful completion.
Next: treat the skill as untrusted guidance and keep live MCP discovery authoritative; manual replace/detach remains the tenant override.

### 2026-07-11T03:03:00+02:00 - Night-sprint delivery manager - Memory Iteration 1 reconciled

Baseline: [#831](https://github.com/zenod-ai/zenod/issues/831) ran 17 human-like live MCP checks across three isolated lanes and scored 12 PASS / 5 FAIL. The suite covered accepted/terminal writes, exact and natural-language retrieval, broad and cross-memory synthesis, corrections, near-match distractors, unknown-answer honesty, citation dereference, and once-only evidence. The result itself was stored through Zenod at `Log/2026-07-11.md#^e-9ab29c` (vault commit `aa615d3`). The product's own `create_issue` path returned a generic `tool_error`; [#835](https://github.com/zenod-ai/zenod/issues/835) tracks that independent defect.

Remediation: [#843](https://github.com/zenod-ai/zenod/issues/843), [#844](https://github.com/zenod-ai/zenod/issues/844), and [#845](https://github.com/zenod-ai/zenod/issues/845) were dispatched in parallel worktrees and merged through [#846](https://github.com/zenod-ai/zenod/pull/846), [#847](https://github.com/zenod-ai/zenod/pull/847), and [#848](https://github.com/zenod-ai/zenod/pull/848). Production now runs immutable image `sha-6352ee1`; Dokploy's desired image and the converged Swarm service match revision `6352ee18059e525818829f754f2a557a1023b56d`. Combined build, full workspace tests, main CI, and the image boot smoke passed.

Live retest: the exact multi-term `LANTERN-48271 observatory access code` fixture ranks first; the human Aurora Kestrel narrow question returns `14 days` and `LumenCell 42` while labeling them synthetic; the scoped broad Aurora Kestrel answer contains the requested L2 facts without neighboring markers, `Cobalt-471`, or the invalid `^e-06cada` anchor. Targeted result: 3/3 PASS. Two baseline failures were deliberately outside this fix batch and remain for Iteration 2: marker-scoped broad isolation and answer completeness for the `Amber-902` distractor prompt.

Next: keep `sha-6352ee1` as the validated Zenod MT memory baseline; plan the two residual Iteration 2 checks and service #835 independently.

### 2026-07-10T23:16:00+02:00 - Night-sprint delivery manager - SHIP journey clean

Deployed: `35f7cd8cb300b772e5ffca6dec70d37eef5752c1` on the one `zenod-mt` service with the existing `/data` volume. `zenod.dev` serves the public landing/pricing; `cloud.zenod.dev` serves GitHub auth, checkout, dashboard, and MCP. `mind.zenod.dev` is a path-preserving 301; `cloud-test.zenod.dev` and `zenod.zenod.dev` return 404; both old cloud composes are stopped with records/volumes retained for rollback.
Journey: one uninterrupted Chrome pass opened the logged-out landing, verified exactly three plans, signed in through the existing GitHub OAuth app, completed a monthly Stripe TEST subscription, landed in the MCP-first dashboard, selected and cloned `AlfaBlok/zenod-cloud-test-vault-4ptjqj` through the transplanted existing GitHub App, completed MCP `initialize` plus a successful tool call, logged out to the GitHub-only login page, and logged back in with the same token/vault persisted.
Evidence: `docs/evidence/night-sprint-2026-07-10/`. The bearer credential visible in screenshots was rotated after capture and proved invalid; the replacement credential passed initialize/tool-call smoke and is not recorded.
Next: Jordi starts at `https://zenod.dev/` and tests the same journey.

### 2026-07-10T21:13:00+02:00 - Night-sprint delivery manager - Wave 1 integrated; wave 2 dispatched

Context: Z-N4 merged as `f5c2cf0`, Z-N2 as `b248687`, and Z-N1 as `43a38a0`. Z-N1 was recovered in-place after worker model capacity; no work was discarded. Wave 2 launched from integrated commit `43a38a0b551e13d9205455bf09e740fa745799b9`.
External state: the existing OAuth app remains app `3718758` / client `Ov23lihBhL9ceTqYWKSP`, renamed `Zenod Cloud`; its registered callback is now `https://cloud.zenod.dev/auth/github/callback`. `cloud-test.zenod.dev` is retired. Stripe TEST product `prod_UrSJ9kf45jilIE` uses monthly `price_1TrjPC76yJ3p1J6XqXl1QwN8` and yearly `price_1TrjPD76yJ3p1J6XZGkcIQ56`.
Assignments: Z-N3-worker / Archimedes / `codex/z-n3-billing`; Z-N5-worker / Turing / `codex/z-n5-domain`.
Next: integrate Z-N3/Z-N5, publish the immutable image, cut over the recorded Dokploy target, then start Z-N6 from the public landing.

### 2026-07-10T20:35:35+02:00 - Night-sprint delivery manager - Wave 1 dispatched

Context: all six issues were reconciled to the final total-cloud-transplant scope. Z-N1, Z-N2, and Z-N4 launched in isolated worktrees from pinned base `2632e8f68122a7e05a178020bb0601813de36704`. The dirty local cloud checkout was preserved; Z-N2 reads a clean detached source worktree at cloud commit `6bdb318`.
Assignments: Z-N1-worker / Jason / `codex/z-n1-landing-pricing`; Z-N2-worker / Feynman / `codex/z-n2-auth-transplant`; Z-N4-worker / Arendt / `codex/z-n4-dashboard`.
Next: monitor 90-minute budgets, integrate passing PRs, dispatch Z-N3/Z-N5, deploy, then run the Z-N6 live-browser loop.

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
