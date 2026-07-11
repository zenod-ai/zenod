# EPIC C · Callisthenes Sprint — duplicate Zenod, swap the middle, sell the mouth

Status: shipped; HARDEN active
Created: 2026-07-11
Updated: 2026-07-11
Repository: `/Users/jordi/Documents/GitHub/zenod`
Primary document: `docs/EPIC-C-CALLISTHENES-SPRINT.md`
GitHub issues: same repository
Integration branch: main
Active spine steward: Callisthenes delivery manager
Steward since: 2026-07-11T01:40:00+02:00
Last reconciled commit: 21623d4
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

- [x] 1. Open `calli.zenod.dev` logged out → a normal landing page: what Callisthenes is ("one mouth for all your agents — your keys, your throttle, receipts for every send"), Get started, Pricing, Sign in. No token field anywhere public.
- [x] 2. Pricing: exactly three options — Self-hosted (free) / Monthly / Yearly, Stripe TEST.
- [x] 3. Sign in with GitHub — same account system as Zenod (one identity across units), sign-in returns to the landing showing name + Dashboard link.
- [x] 4. Subscribe (monthly, TEST card): server-side checkout session with `client_reference_id` = account id → webhook inserts the tenant row in THIS container → land in the dashboard.
- [x] 5. Dashboard: **MCP URL + token front and center** with copy button and Claude/Codex snippets; Connect X card with the EXISTING three-credential inputs + Authorize + PIN flow; Drafts & receipts panel (read view); throttle state; usage; link back to landing. NO tabs from other units.
- [x] 6. Connect X through the UI: paste the three app credentials → Authorize → approve on X → enter PIN → "Connected ✓", token pair in per-tenant custody.
- [x] 7. Agent seam: an MCP client using the minted URL creates a post → held as draft (`[draft_not_approved]`, C-22); draft visible in the dashboard; `approve_send` via MCP posts EXACTLY ONCE → **canonical x.com permalink receipt** in the agent reply and dashboard history; throttle counter increments.
- [x] 8. Logout/login persists everything. Second tenant provisioned by the manager cannot see the first tenant's connection, drafts, or receipts.
- [x] 9. Test package: "I manually walked the full journey and it works. URL + screenshots. Now you test." Every element Jordi will click was clicked by the manager in the same deployed build.

HARDEN (after Jordi approves SHIP): dashboard Approve button (SHIP approves via MCP `approve_send` — existing code), Reddit/email connectors, Google sign-in, self-host README polish, retirement of the old x-mcp/callisthenes 2.x service (route to 3.7).

## Non-Goals

- Rewriting the Python engine in Node, or ANY change to send semantics, throttle defaults, C-22 discipline, or the PIN flow — the engine is a working organ; it moves, it does not change.
- New connectors, new UI design, chassis/framework language.
- Touching the live Zenod unit beyond reading its code as the template.

## Current State

Phase: HARDEN wave 1 complete and live — generic peer readiness handed to Ring; autodeploy bound
Last verified: 2026-07-11T05:12:00+02:00
Integration target: main
Fresh base commit: `28904a1939f0cbfaa2733a525cbb15e244c14b06` — pinned; no rebases until the journey passes (D19c)
Wave 2 base commit: `fcd37f89d0e5c6c514dd115ae3ba3dce135f3eaa` — integrated wave 1, pinned.
Next action: none on Calli; Dokploy drains the queued webhook deploy while Ring consumes the canonical skill and live generic MCP contract through #864.
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
| 2026-07-11 | Generic peer readiness | Calli carries no Ring-specific adapter. It supplies a canonical user-attachable Agent Skills bundle and a truthful generic MCP `tools/list` contract; Ring owns discovery, storage, UI and progressive loading. |
| 2026-07-11 | Behavior freeze remains | Skill/contract work may improve descriptions, schemas and annotations but cannot change draft guard, approval, throttle, PIN, custody, receipt or delete semantics. |

## Issue Ledger

| Issue | Role | Owner / Assignment | Title | Status | Depends On | PR/Branch | Base | Acceptance | Latest Evidence | Last Verified | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [#821](https://github.com/zenod-ai/zenod/issues/821) | Ticket worker | C-S1-worker | C-S1 front duplicate (DUPLICATE zenod customer layer + landing) | done | - | [#826](https://github.com/zenod-ai/zenod/pull/826) / `codex/c-s1-front-duplicate` | `28904a1` | SHIP 1–4 render/flow | CI + targeted checks; merged `34a1398` | 2026-07-11T01:54:00+02:00 | integrated |
| [#823](https://github.com/zenod-ai/zenod/issues/823) | Ticket worker | C-S2-worker | C-S2 engine port (PORT units/callisthenes, behavior frozen) | done | - | [#827](https://github.com/zenod-ai/zenod/pull/827) / `codex/c-s2-engine-port` | `28904a1` | connect/draft/send/receipt work per tenant | CI + 98 tests; merged `fcd37f8` | 2026-07-11T01:54:00+02:00 | integrated |
| [#825](https://github.com/zenod-ai/zenod/issues/825) | Ticket worker | C-S3-worker | C-S3 dashboard panels (PORT connect_page + DUPLICATE MCP-first panel) | done | #821, #823 done | [#830](https://github.com/zenod-ai/zenod/pull/830) / `codex/c-s3-dashboard` | `fcd37f8` | SHIP 5–6 | merged; live browser Connect X + PIN passed | 2026-07-11T03:23:00+02:00 | integrated |
| [#824](https://github.com/zenod-ai/zenod/issues/824) | Ticket worker | C-S4-worker | C-S4 billing + domain (DUPLICATE Z-N3/Z-N5 recipe) | done | #821 done | [#829](https://github.com/zenod-ai/zenod/pull/829) / `codex/c-s4-billing-domain` | `fcd37f8` | SHIP 2, 4; calli.zenod.dev live, guarded | merged; Dokploy API service + Stripe TEST product/prices/webhook live | 2026-07-11T03:23:00+02:00 | integrated |
| [#822](https://github.com/zenod-ai/zenod/issues/822) | Epic worker | Callisthenes delivery manager | C-S5 journey loop + two-tenant isolation + test package | done | #821, #823, #825, #824 | `main` | `28904a1` | SHIP 1–9 | full real-browser journey passed on live `21623d4`; package delivered | 2026-07-11T03:32:00+02:00 | Jordi tests |
| [#866](https://github.com/zenod-ai/zenod/issues/866) | Ticket worker | C-H1-worker | Canonical Calli Agent Skill bundle | done | - | [#867](https://github.com/zenod-ai/zenod/pull/867) / `codex/c-h1-calli-agent-skill` | `6eb80ef` | format-valid attachable skill; exact safe draft→approve→receipt workflow | 21 focused tests + skill validation + CI; merged `f06d0f7` | 2026-07-11T04:45:54+02:00 | Ring #864 consumes artifact |
| [#861](https://github.com/zenod-ai/zenod/issues/861) | Ticket worker | C-H2-worker | Calli MCP contract readiness audit | done | - | [#868](https://github.com/zenod-ai/zenod/pull/868) / `codex/c-h2-calli-mcp-contract` | `6eb80ef` | truthful schemas/descriptions/annotations; behavior unchanged | 627 server tests + typecheck + CI; merged `82977b6` | 2026-07-11T04:45:54+02:00 | integrated |

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
- Approved HARDEN wave: C-H1 ∥ C-H2, then manager integrates and hands exact artifacts to Ring issue #864.

## Tester Queue

- C-S5: the manager walks the journey; two-tenant isolation included; nobody asks Jordi to click anything unclicked.

## Validation Evidence

| Date | Scope | Commit | Environment / Surface | Command / Method | Result | Evidence |
|---|---|---|---|---|---|---|
| 2026-07-11 | Landing, GitHub, Stripe TEST, dashboard, X PIN, held draft | `2cce21c` | calli.zenod.dev live | Chrome real-browser walk | pass | `docs/evidence/callisthenes-ship-2026-07-11/01`–`05` |
| 2026-07-11 | MCP approve exactly once + canonical receipt + delete | `2cce21c` | public `/mcp` + live X | approve, replay, browser permalink, approved deletePosts | pass | `06-x-permalink-receipt.png`, `07-dashboard-receipt.png` |
| 2026-07-11 | Two-tenant isolation | `2cce21c` | public `/mcp` + durable tenant/X custody stores | two independent sessions, cross-credential negative test | pass | `08-two-tenant-isolation.md` |
| 2026-07-11 | Final same-build lap | `21623d4` | calli.zenod.dev + Stripe TEST + X | logout/login, branded paid checkout, held draft, approve replay, live receipt, dashboard history, approved deletion | pass | `02b`, `10`, `11`, `13` screenshots; Stripe event `evt_1Trpl876yJ3p1J6Xcfy1iaf6` |
| 2026-07-11 | Generic peer readiness | `82977b6` | merged `main` | skill validation, focused tests, server typecheck/full suite, CI | pass | PRs #867 and #868; Ring handoff on #858 |
| 2026-07-11 | Generic peer readiness live + autodeploy | `82977b6` live; `78c678b` webhook proof | canonical Dokploy compose at `calli.zenod.dev` | preserved generated compose, rebuilt/recreated only `calli-front`; `/healthz`; authenticated read-only MCP initialize + `tools/list`; repository push webhook | pass / queued | health reports exact SHA; 18 tools and approval contracts verified; GitHub delivery HTTP 200 queued the exact commit in Dokploy; platform queue had 171 waiting, redundant manager probes removed; no tool call/post |

## Handoff Journal

### 2026-07-11T05:02:20+02:00 - Callisthenes delivery manager - Readiness contract live

Context: The canonical Calli compose had auto-deploy enabled but no deployment after the C-H merges, matching the recorded Dokploy branch-webhook mismatch. The manager invoked the Dokploy API, then used the established generated-runtime recovery path: preserved Dokploy's converted compose and tenant volume, synchronized only the merged Calli readiness files, rebuilt and recreated only `calli-front`, and left `calli-engine` untouched. The compose source was then normalized through the Dokploy API to the already-authorized GitHub provider for `zenod-ai/zenod`, branch `main`, push-triggered auto-deploy, with the provider's required idle-ready status. The missing repository push webhook for this compose's Dokploy refresh token was added through the GitHub API; no browser was used.
Evidence: `https://calli.zenod.dev/healthz` reports `status=ok`, `name=callisthenes`, SHA `82977b6bc9d66d934f6d1517753cfee9be64082a`. An authenticated read-only MCP session returned 18 tools; `createPosts` and `deletePosts` advertise destructive/non-idempotent plus explicit approval fields, `approve_send` advertises destructive/idempotent with required exact `channel`/`text`, and `getUsersMe` advertises read-only/idempotent. GitHub delivered the real `main` push to the new hook with HTTP 200, and Dokploy queued commit `78c678b0ed3501fbe0a520c45cb399b2d34b6abf`; the worker was behind a platform-wide queue of 171. Five redundant API verification jobs created during diagnosis were removed, leaving one genuine webhook job. No mutation tool or live post occurred.
Next: Calli has no remaining product work for Ring's generic peer/skill integration; Dokploy drains the proven autodeploy job asynchronously.

### 2026-07-11T04:45:54+02:00 - Callisthenes delivery manager - Generic-peer readiness integrated

Context: C-H1 and C-H2 are merged to `main`. Calli now ships a provider-independent, prose-only Agent Skill at `units/callisthenes/skill/callisthenes/` and truthfully advertises read/write/destructive/exactly-once semantics through `tools/list`; no Ring-specific adapter or peer profile was added, and engine behavior remains frozen.
Evidence: PR #867 merged as `f06d0f7` after 21 focused tests, skill validation, and CI. PR #868 merged as `82977b6` after typecheck, 627 server tests, and CI. The active Ring steward was pinged on #858 with the generic backlog and #864 handoff.
Next: Ring owns discovery, user skill attachment, progressive loading, and auto-refresh. Calli requires no reconnect-side special case.

### 2026-07-11T04:34:35+02:00 - Callisthenes delivery manager - Generic-peer readiness approved and dispatched

Context: Ring's generic MCP/skill work lives in `docs/EPIC-R-RING-SPRINT.md` (#863/#860/#862/#865/#864). Calli's independent responsibility is now explicit: #866 authors the canonical tenant-attachable Agent Skills bundle; #861 audits the advertised MCP contract. Neither ticket may add Ring-specific code or alter shipped send behavior.
Assignments: C-H1-worker / `codex/c-h1-calli-agent-skill` / `../wt-c-h1`; C-H2-worker / `codex/c-h2-calli-mcp-contract` / `../wt-c-h2`; both pinned to `2fe2289aa2028ec70ff2a77c6be5af635d235c6f`.
Next: integrate reviewed passing Calli artifacts, validate against tools/list without sending, notify Ring #864.

### 2026-07-11T03:32:00+02:00 - Callisthenes delivery manager - SHIP passed on final build

Context: One same-build real-browser lap passed on live `21623d4`: logged-out landing and pricing; GitHub sign-in; branded Callisthenes Stripe TEST monthly subscription (paid/complete with `client_reference_id=github-63050995`); dashboard; persisted `Connected ✓ @CryptoEsp`; held MCP draft; exactly-once approval replay returning `https://x.com/i/web/status/2075755544816595012`; receipt visible on X and in the dashboard; approved deletion; logout; GitHub login; persisted connection/drafts/receipts. The separately provisioned second tenant remained isolated. All test posts were deleted after permalink capture.
Evidence: `docs/evidence/callisthenes-ship-2026-07-11/`, with final-build evidence in `02b`, `10`, `11`, `13` and the sanitized isolation receipt in `08-two-tenant-isolation.md`. Dashboard screenshots that displayed the tenant credential were deliberately excluded; that token was rotated after the walk and its X custody file migrated to the replacement tenant hash.
Next: Jordi tests. Do not start HARDEN or retire the old 2.x service before approval.

### 2026-07-11T03:23:00+02:00 - Callisthenes delivery manager - Live C-S5 journey converged

Context: C-S3/C-S4 merged and the new Dokploy compose was created and bound to this repository through the Dokploy API with auto-deploy enabled. Dokploy accepted deploy/redeploy requests but its source webhook reported `Branch Not Match`; the manager preserved the API-owned compose and synchronized/recreated its generated runtime directly. Stripe TEST now has a Callisthenes product, monthly/yearly prices, and a calli webhook. The real Chrome journey passed landing, GitHub, checkout, dashboard, three-input X authorization + PIN, draft hold, exactly-once `approve_send`, canonical receipt, approved deletion, and two-tenant isolation. The only new front↔engine defect was a duplicated-customer-layer proxy forwarding the caller's stale `Content-Length` after rewriting the approval envelope; `2cce21c` removes that transport header without changing engine/send semantics.
Evidence: `docs/evidence/callisthenes-ship-2026-07-11/`; live receipt `https://x.com/i/web/status/2075749752700837959` was captured and the test post was then deleted.
Next: finish the final navigation-safe logout/login and branded Stripe checkout lap on `a88c010`, mark SHIP, deliver Jordi's test package.

### 2026-07-11T01:54:00+02:00 - Callisthenes delivery manager - Wave 1 integrated; wave 2 dispatched

Context: C-S1 passed CI and merged as `34a1398`; C-S2 passed CI after review closed tenant throttle timing and shared-auth mutation leaks, then merged as `fcd37f8`. Wave 2 is pinned to integrated commit `fcd37f89d0e5c6c514dd115ae3ba3dce135f3eaa` without rebasing the wave-1 workers.
Assignments: C-S3-worker / `codex/c-s3-dashboard` / `../wt-c-s3`; C-S4-worker / `codex/c-s4-billing-domain` / `../wt-c-s4`.
Next: integrate C-S3/C-S4, publish and deploy the one Callisthenes unit without touching the old 2.x services, then start the live C-S5 journey at `https://calli.zenod.dev/`.

### 2026-07-11T01:40:00+02:00 - Callisthenes delivery manager - Steward bound and wave 1 dispatched

Context: stewardship transferred from the planner to the Callisthenes delivery manager before concurrent ticket writing began. `main` and `origin/main` are aligned at pinned base `28904a1939f0cbfaa2733a525cbb15e244c14b06`; the shared checkout's unrelated pre-existing edits to `docs/EPIC-4.0-HERALD.md` and `docs/EPIC-4.2-POC-LOOP-CORE.md` remain untouched. C-S1..C-S5 were minted as issues #821, #823, #825, #824, and #822.
Assignments: C-S1-worker / `codex/c-s1-front-duplicate` / `../wt-c-s1`; C-S2-worker / `codex/c-s2-engine-port` / `../wt-c-s2`.
Next: monitor the 90-minute budgets, integrate passing PRs, dispatch C-S3/C-S4 from the integrated pinned wave-2 base, deploy the one Callisthenes app, then walk C-S5 from the public landing.

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
