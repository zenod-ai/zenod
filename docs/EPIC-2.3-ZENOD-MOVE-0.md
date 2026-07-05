# EPIC 2.3 · ZENOD MOVE 0 — the first paid product: Zenod standalone

Owner: **Zenod-Fable** (planner; fresh session) · Parent: [LAUNCH-CONTROL.md](LAUNCH-CONTROL.md)
Origin: Jordi, 2026-07-05 — "I become a Zenod customer, point my Claude at it, production,
standalone container, paying, my consumption on a dashboard."
Siblings: consumes [EPIC-2.5-ATOMIC-UNITS.md](EPIC-2.5-ATOMIC-UNITS.md) (SEAM-SPEC, `units/zenod/`
scaffold — W-C ownership TRANSFERS here, see Boundaries) and
[EPIC-2-HOSTED-READINESS.md](EPIC-2-HOSTED-READINESS.md) (checkout, provisioning, D-5 metering).

**EXIT CRITERION (verbatim from Jordi, sharpened to testable):**
Jordi signs up as **customer #1 with a real card in LIVE mode**, receives a production standalone
Zenod instance (own container, own repo, own MCP token), pastes the MCP config into **his own
Claude**, and store / search / ask work against production with commit-SHA receipts landing in
**his** repo. A logged-in **dashboard shows his consumption** (calls · tokens · cost) sourced from
his per-tenant gateway key, reconciling with the gateway balance (D-5: gateway is truth). The
instance is registered with the fleet watchdog. A tester then repeats the entire funnel as a
stranger, using only the public pages.

## Roles & document flow (binding)

The ten rules of HANDOVER-EPIC2 §THE DOCUMENT FLOW apply. Planner (Zenod-Fable) owns this doc and
ticket states; worker executes with dated receipts in the APPEND ZONE; tester verifies with fresh
evidence, tester ≠ fixer. Budgets on every dispatch. **Worker: the lanes are parallel by design —
fan out sub-agents, one per lane, receipts from each.**

## What this product is (settled — do not relitigate; expanded per Jordi 2026-07-05)

**"Your personal wiki brain."** Zenod standalone = one MCP server, one container, the customer's
git repo behind it. Plain markdown; every AI you use reads and writes it through one librarian.
- **Two ways to have it, one public website:** self-host (open source, terminal quickstart —
  instructions on the site, no UI required) or **hosted at €5/month** (ZD-1 DECIDED) with
  self-serve signup. The platform is multi-user in the SaaS sense: anyone signs up, everyone gets
  their own brain (tenancy model per ZD-6).
- Access is the public seam only (pure MCP + receipt profile per SEAM-SPEC). Claude/Cursor/any
  client is the brain; Zenod never gets a chat UI.
- **Hosted gets a setup UI** (the admin surface, wizard-shaped): connect/scaffold GitHub repo →
  issue MCP token → "paste this into Claude" → done. Plus: health, token management, usage
  dashboard. Self-host gets the same result via terminal + docs. The vault browser is
  Obsidian/GitHub — that's a feature, say it on the page.
- Standalone keyring: local credential store (the locked connections design's standalone mode).
- LLM spend (digest + ask) is metered per user from the per-call ledger; key model per ZD-5;
  the dashboard shows calls · tokens · cost either way.

## ZD decisions — planner frames, Jordi calls

Status 2026-07-05 (Zenod-Fable): ZD-1..ZD-6 ALL DECIDED (Jordi, same day, via planner's framed
options). ZD-7 minted from the ZD-5 call — framed, NON-BLOCKING. Do not relitigate without new
evidence.

- **ZD-1 · Price — DECIDED 2026-07-05 (Jordi): hosted €5/month.** Move 0 ships ONE simple SKU.
  (Jordi carries the number to Product-Fable so D-6 tiering stays coherent.) Consequence: at €5,
  LLM spend cannot be bundled uncapped — forced ZD-5.

- **ZD-2 · Provisioning mode — DECIDED 2026-07-05 (Jordi): automated behind the Stripe webhook.**
  Proven ~1–2 min (Epic 2, I1-4); customer #1 experiences the real funnel; the tester's
  stranger-run needs it anyway. Concierge-manual (H-2) rejected. Releases: Z-3 checkout wiring,
  Z-2 trigger path.

- **ZD-3 · Repo residency — DECIDED 2026-07-05 (Jordi): customer's own GitHub account via
  GitHub App, day one** (auth per GITHUB-AUTH-DEFINITIVE-RUNBOOK.md). It IS the ownership story
  ("your repo, your memory, leave anytime"); no transfer machinery, ever. Hosted-org +
  transfer-on-exit rejected.

- **ZD-5 · LLM key model at €5 — DECIDED 2026-07-05 (Jordi): bundled prepaid credits.**
  Epic-2 D-5 machinery reused; gateway balance is truth; warn at threshold, polite block at
  zero, top-up restores. Planner had recommended BYO OpenRouter key; Jordi called credits —
  recorded, honest board, not relitigated. Consequences: per-tenant gateway key minted at
  provision (standalone keyring holds it); NO key step in the wizard; dashboard gains
  balance + top-up (folds into ZD-4); spawns ZD-7 (starter-credit number).

- **ZD-6 · Tenancy at €5 — DECIDED 2026-07-05 (Jordi): instance-per-user, fully automated.**
  Law-7-consistent; reuses proven provisioning; watchdog per instance; fine to ~100 users on
  current infra. Multi-tenant remains the designated FIRST sanctioned law-7 exception, triggered
  by ops load only, never speculation. Setup UI still built so a future switch is invisible.

- **ZD-4 · Dashboard scope v0 — usage + balance: calls · tokens · cost · balance · top-up link**
  (balance/top-up per ZD-5). No analytics, no memory browser. Adopted unless Jordi objects
  before Z-4 starts.

- **ZD-7 · Starter-credit allotment at signup — AWAITING JORDI, NON-BLOCKING (config value).**
  €5/month buys hosting + how much included LLM credit at signup?
  (a) **Small starter grant** (enough for first-session digest + ask) then self-serve top-up —
  recommended: the funnel works out of the box; liability bounded. (b) Zero grant, top-up
  required before first `ask` — simplest, but customer #1's first minute hits a paywall.
  The number is pricing → travels to Product-Fable via Jordi alongside ZD-1. Worker builds the
  grant as a CONFIG VALUE and does not invent the number; Z-6 cannot RUN until it is set.

## Iteration 0 — tickets (lanes parallel; worker MUST fan out sub-agents, one per lane)

Sequencing: **Z-1 ∥ Z-3-page ∥ Z-5-runbook start immediately**; Z-2 needs Z-1 green; Z-4 needs
Z-2; Z-6 last (Jordi in person); tester's stranger-run closes the epic. All tickets OPEN,
unstarted, 2026-07-05. Acceptance boxes may be checked ONLY with a same-line receipt (URL/SHA/ID).

### Z-1 · Standalone GA (absorbs 2.5's W-C) — OPEN · starts NOW

Deliverable: `units/zenod/` builds and deploys as ONE container exposing ONE MCP endpoint,
SEAM-SPEC-conformant, with a stranger-grade README/quickstart.

Acceptance:
- [ ] `docker build` + run from `units/zenod/` (root image + `AGENT=zenod` until the repo split
      fires) → container serves `tools/list`/`tools/call` over streamable HTTP at `/mcp`.
- [ ] SEAM-SPEC v1 checklist passes item-by-item, spec UNEDITED: mutating tools return evidence
      handles (ID/URL/SHA); reads return data or explicit `none`; failures error loudly with
      stable `code`; long tools return `{ticket_id}` + a poll tool exists.
- [ ] Public-seam-only: the repo token lives ONLY inside Zenod; no non-MCP write path exists.
- [ ] README/quickstart is stranger-grade: endpoint + repo + token → Claude MCP config, zero
      suite/console knowledge assumed. (Voice pass = Epic 0 via Jordi; content correctness = here.)

Test criteria (tester, fresh evidence): an EXTERNAL plain-MCP client (not our code) completes
store → search → get on a FRESH instance using ONLY the README; commit-SHA + GitHub-URL receipts
verified in the vault repo; a deliberate non-seam write attempt fails loudly; SEAM-SPEC scored
line-by-line. Passing this ALSO satisfies 2.5's RD-4 split-trigger evidence and Epic 0's SD-6 gate.

### Z-2 · Provision + setup UI — OPEN · blocked by Z-1 · ZD-2/3/5/6 decided

Deliverable: one provisioning script + the hosted setup wizard + self-host terminal quickstart.

Acceptance:
- [ ] Script provisions one instance per user (ZD-6): container + repo in the CUSTOMER's GitHub
      account via GitHub App (ZD-3, runbook path) + minted MCP token + per-tenant gateway key in
      the standalone keyring (ZD-5); emits receipts (container ID, repo URL, token ID, gateway
      key ID); idempotent on retry; fired by the Stripe webhook (ZD-2).
- [ ] Wizard (admin surface): connect/scaffold GitHub repo → token issued → "paste this into
      Claude" block → done screen. NO LLM-key step (ZD-5: gateway key is minted at provision,
      invisible to the user). Health + token management pages exist. No chat UI anywhere.
- [ ] Self-host: terminal quickstart in public docs reaches the same end state (endpoint + repo +
      token → Claude config) with no UI.

Test criteria: tester provisions a fresh user end-to-end via the WIZARD, timed, <30 min bar;
separately completes self-host from docs alone on a clean VM; Claude round-trip with commit-SHA
receipt on BOTH paths.

### Z-3 · Website + checkout LIVE — OPEN · page starts NOW; checkout wiring needs the Z-2 webhook target

Deliverable: public Zenod website — pitch, both paths, LIVE €5/mo checkout, legal minimum.

Acceptance:
- [ ] Page live: "your personal wiki brain" pitch; self-host path (docs) AND hosted path visible;
      "vault browser is Obsidian/GitHub" stated as a feature. Copy ships as functional DRAFT
      flagged `[DRAFT — Epic 0 voice pending]`; final voice lands via Jordi (Epic 0 owns it).
- [ ] Stripe LIVE SKU €5/month; checkout → webhook → Z-2 provisioning fires without human touch
      (ZD-2).
- [ ] Minimal ToS/privacy linked (Epic-2 H-11 minimum).

Test criteria: a real card completes €5 checkout in prod; subscription visible in Stripe;
provisioning fires without human touch; self-host instructions pass a cold read by a stranger.

### Z-4 · Meter + dashboard — OPEN · blocked by Z-2 · ZD-5 decided: bundled prepaid credits

Deliverable: per-tenant metering wired at provision; usage page on the admin surface.

Acceptance:
- [ ] Per-tenant gateway key wired at provision, held in the standalone keyring (ZD-5).
- [ ] Usage page shows calls · tokens · cost · balance from the per-call ledger (usage.sqlite /
      read_llm_timeline), reconciling with the gateway balance (D-5: gateway is truth); top-up
      link present (ZD-4).
- [ ] D-5 behaviors: warn at threshold, polite block at zero, top-up restores. Starter grant
      wired as a config value (number pending ZD-7).

Test criteria: tester burns a known amount via scripted `ask` calls; dashboard matches the
gateway within tolerance (exact call count; tokens/cost within provider-reported values);
zero-credit block + top-up + resume all receipted.

### Z-5 · Watchdog + ops — OPEN · runbook starts NOW

Deliverable: fleet-watchdog registration at provision (law `3b4da80`) + restore-from-repo runbook.

Acceptance:
- [ ] Every provisioned instance auto-registers with the fleet watchdog; deregistration on
      teardown.
- [ ] Runbook: restore-from-repo, step-by-step with receipts required at each step — the vault IS
      the backup, proven, not asserted.

Test criteria: forced crash-loop on a fresh tenant → operator alert received (receipt: alert +
timestamp); restore drill per runbook — new container + existing repo → store/search/get return
pre-crash memories with the same commit SHAs.

### Z-6 · Customer #1 run — OPEN · LAST · Jordi in person, not the worker

Deliverable: Jordi executes the funnel personally — LIVE card, his Claude, his repo, his dashboard.
Worker's obligation: leave Z-1..Z-5 green and a one-page Z-6 checklist ready.

Acceptance = the EXIT CRITERION above, verbatim, with receipts inline: Stripe subscription ID,
container ID, repo URL, commit SHAs from his Claude session, dashboard screenshot, watchdog
registration entry.

Test criteria: tester scores ✅/❌ against the exit criterion, then repeats the ENTIRE funnel as a
stranger using only the public pages — that run closes the epic.

## Boundaries

- **↔ Epic 2.5 (Ring-Fable):** W-C ownership transfers HERE (Jordi carries the notice; 2.5's
  Iteration-1 order drops W-C from its critical path — ring/council carve continues unblocked;
  SEAM-SPEC remains 2.5's artifact and Z-1 must conform to it unedited, which ALSO satisfies
  2.5's RD-4 split-trigger evidence). No ring, no council, no channel anywhere in this epic.
- **↔ Epic 2 (Product-Fable):** checkout/provisioning/meter machinery is REUSED, not rebuilt;
  pricing number (ZD-1) is theirs via Jordi; this epic's Zenod SKU becomes the first LIVE product
  in their shop.
- **↔ Epic 0 (Story-Fable):** Zenod one-pager + README voice = Epic 0 deliverable (SD-6: the
  movement may launch when Z-1's stranger-test passes); Herald marketing stays behind the
  original gates.
- **Standing-order note:** 2026-07-04's "all other work pauses" amends to: 2.5 (ring/council
  carve) + 2.3 (this) are the two active build lanes — requires Jordi's confirmation on
  LAUNCH-CONTROL (Jordi's pen).
- Jordi is the only router between tracks.

## Dispatch blocks (verbatim — Jordi pastes; planner never dispatches through the pipeline)

### Block A · WORKER — paste when Jordi green-lights Iteration 0

```
You are the Zenod Move-0 WORKER. Your mission doc is docs/EPIC-2.3-ZENOD-MOVE-0.md in
zenod-ai/zenod. Read it top to bottom before anything else — tickets Z-1..Z-5 with their
acceptance criteria bind you. You hold the pen on that doc's APPEND ZONE only; planner
sections are read-only to you.

FAN-OUT IS REQUIRED, NOT OPTIONAL:
- Spawn parallel sub-agents, one per lane. NOW: Z-1 (standalone GA), Z-3 (website + LIVE
  checkout), Z-5 (watchdog + restore runbook) run in parallel from your first turn.
- Z-2 (provision + wizard) starts the moment Z-1 is green; Z-4 (meter + dashboard) the
  moment Z-2 provisions. Z-6 is NOT yours — it is Jordi in person; you leave Z-1..Z-5
  green plus a one-page Z-6 checklist ready.
- You verify each sub-agent's receipts before relaying them — verify, don't trust.

DECIDED — do not relitigate: ZD-1 €5/month, one SKU. ZD-2 automated Stripe-webhook
provisioning. ZD-3 customer's own GitHub via GitHub App (GITHUB-AUTH-DEFINITIVE-RUNBOOK.md).
ZD-5 bundled prepaid credits — D-5 machinery, gateway balance is truth, warn/block/top-up;
per-tenant gateway key minted at provision; NO key step in the wizard. ZD-6
instance-per-user. ZD-7 (starter-credit number) pending — build it as a config value; do
not invent the number.

CONSTRAINTS: public seam ONLY — docs/SEAM-SPEC.md binds, UNEDITED. No chat UI on Zenod,
ever. Website copy ships as functional draft flagged [DRAFT — Epic 0 voice pending]; final
voice lands via Jordi. No ring, no council, no channel anywhere in this epic. REUSE Epic-2
machinery (Stripe checkout, provisioning, per-call ledger, gateway keys, watchdog) — never
rebuild it.

RECEIPTS: every claim of state gets a dated, role-tagged entry in the APPEND ZONE, same
turn, with URL/SHA/ID — tag [worker/Z-n]. A report without receipts is not a report.
Acceptance boxes are checked ONLY with a same-line receipt.

BUDGET: 1 working day wall-clock, 80 agent-turns total, ≤20 per sub-agent. A blocked lane
(credential missing, dependency red, spec ambiguous) → write BLOCKED + the exact blocker in
the APPEND ZONE and stop that lane honestly. Never zombie, never fake-green. When Z-1..Z-5
are receipted green or blocked-honest, write a HANDBACK entry summarizing every lane's
state and stop. The pen returns to Zenod-Fable on HANDBACK.
```

### Block B · TESTER — paste only after worker HANDBACK + Z-6 receipted

```
You are the Zenod Move-0 TESTER. Preconditions: the worker has written HANDBACK in the
APPEND ZONE of docs/EPIC-2.3-ZENOD-MOVE-0.md (zenod-ai/zenod) AND Z-6 (Jordi's customer-#1
run) is receipted. Read the doc top to bottom; the "Test criteria" lines of Z-1..Z-6 are
your script. You are NOT the fixer: you never patch, reconfigure, or retry-until-green.
You score, you map, you hand back. Fresh evidence only — never reuse the worker's receipts.

RUN 1 — the stranger funnel, public pages ONLY:
1. Start at the public website as a stranger: no repo access, no internal docs, no asking
   anyone anything.
2. Hosted path: €5 LIVE checkout with a real card → wizard (connect GitHub → token → paste
   block) → paste into a fresh Claude → store / search / ask against production → verify
   commit-SHA receipts land in YOUR repo → dashboard shows YOUR calls · tokens · cost ·
   balance. Time the wizard leg; <30 min is the bar.
3. Self-host path: clean VM, public docs only → same Claude round-trip with commit receipt.

RUN 2 — ticket-by-ticket: score EVERY Z-1..Z-6 test criterion ✅/❌ with fresh evidence.
Includes: external plain-MCP client from the README alone; a deliberate non-seam write
fails loudly; SEAM-SPEC line-by-line; forced crash-loop → operator alert; restore drill
(new container + existing repo = memory intact, same SHAs); metering burn test — a known
number of scripted `ask` calls reconciles with dashboard and gateway balance; zero-credit
block → top-up → resume, all receipted.

SCORING: every criterion gets ✅/❌ in the APPEND ZONE, tagged [tester], each with its
evidence (URL/SHA/screenshot/timing). Every ❌ maps to EXACTLY ONE ticket ID with a
one-line repro. Anything surprising — silent ack, lying summary, magic words required —
becomes a proposed new test criterion in your entry (Jordi's standing rule).

BUDGET: 4 hours, 30 turns, €5 + fees + one credit top-up on a live card (expensed; planner
reconciles in Stripe after scoring). If the funnel blocks you cold, that IS the result —
score ❌, receipt it, stop. Never fix, never zombie. Pen returns to Zenod-Fable with your
scorecard.
```

## APPEND ZONE (dated, role-tagged, append-only — receipts or it didn't happen)

### 2026-07-05 · [planner/Zenod-Fable] Bootstrap: pen taken, decisions called, iteration armed
- Pen taken from Story-Fable per doc-created entry below. ZD-2/3/5/6 framed with options +
  recommendations and put to Jordi same-day; Jordi called all four (receipts: the DECIDED lines
  in the ZD section above, this doc). ZD-2a automated webhook · ZD-3a customer's GitHub ·
  **ZD-5b bundled prepaid credits (against planner recommendation — recorded honestly)** ·
  ZD-6a instance-per-user. ZD-7 minted (starter-credit number), awaiting Jordi, non-blocking.
- Z-1..Z-6 refined from lanes into tickets with binary acceptance + tester criteria (sections
  above). All OPEN, unstarted — no fake-green.
- Dispatch blocks A (worker, fan-out mandatory, budget 1 day/80 turns) and B (tester ≠ fixer,
  post-HANDBACK + Z-6, budget 4 h/30 turns) written above; handed to Jordi verbatim for manual
  dispatch per DOCUMENT FLOW rule 2c.

### 2026-07-05 · [scribe/Story-Fable] Spec expanded per Jordi (same morning)
- Jordi: public website · self-host + hosted €5/month (ZD-1 DECIDED) · multi-user self-serve ·
  setup UI in cloud, terminal path for self-host · "your personal wiki brain." ZD-5 (LLM key
  model) and ZD-6 (tenancy at €5) minted with recommendations; Z-2/Z-3 lanes upgraded
  accordingly. Zenod-Fable frames ZD-2/3/5/6 for Jordi as its first move.

### 2026-07-05 · [scribe/Story-Fable] Doc created
- Materializes Jordi's Move-0 ask (this morning) on top of: `units/zenod/` scaffold + clean
  cross-import scan (2.5 worker, `629adb2`) · Stripe checkout TEST-live + tenant provision proven
  ~1–2 min + $50 gateway-key pattern (Epic 2, I1-4 CLOSED) · per-call usage ledger
  (usage.sqlite / read_llm_timeline). Pen hands to Zenod-Fable on bootstrap.

### 2026-07-05 · [worker/Z-1] Standalone GA — SEAM-SPEC conformance GREEN-static; runtime BLOCKED (no Docker daemon)
Fan-out sub-agent ran a line-by-line SEAM-SPEC v1 audit against real source (spec UNEDITED). All 16
checklist items scored with file:line evidence; verified by me on the two load-bearing claims
(token auto-mint `packages/server/src/settings.ts:115`, auth guard `packages/server/src/auth.ts:47-50`,
`/api/token` route `packages/server/src/app.ts:1693`).
- **Items 1–5 (transport + receipt profile): PASS-static.** Single `/mcp` streamable-HTTP transport
  (`app.ts:2029/2198`, `mcp.ts:313`); `store_memory` returns `commitSha`+`githubUrls`
  (`mcp.ts:267-275,690`), `create_issue`/`edit` return `issueUrl` (`mcp.ts:911,932`); `search_memory`
  empty → explicit `"No memories match…"`+`hits:[]` (`mcp.ts:625-627`); `get_memory` unknown → loud
  `not_found` (`ops/get.ts:8,18,32`).
- **Items 6–8 (long/poll): PASS-static.** LONG tools return `{jobId}` immediately, polled via
  `get_task_result` (`mcp.ts:678-680,768-812`). Field name is `jobId` not spec's `ticket_id` — a
  documented naming variance, not a violation. No push-event bus; poll is the correlation mechanism.
- **Items 9–11 (dispatch): N/A** — standalone memory unit exposes no guy→guy dispatch on its surface.
- **Items 12–14 (auth): PASS-static.** `requireMcpAuth` 401s on missing/invalid bearer
  (`auth.ts:75-89`), `timingSafeEqual`+non-empty guard (`auth.ts:47-56`), no world/OAuth key on the
  agent→unit surface (repo token is a vault credential, not a bearer).
- **Items 15–16 (error + stranger): PASS-static.** Structured `{code,message}` (`toolOutput.ts:27-32`,
  `NoteNotFoundError`); public tool surface names zero suite-internal types.
- **Public-seam-only: CONFIRMED** — the repo (vault) token is read in exactly ONE place,
  `Runtime.getRepo()` at `packages/server/src/runtime.ts:296-297`, sole constructor of `VaultRepo`.
  No non-MCP write path to the vault on the public surface.
- **[x] README/quickstart stranger-grade** — content-correctness fixed here. Found + fixed a real
  stranger trap: a self-host instance is NOT tokenless (auto-mints `api_token` on first boot,
  `settings.ts:115`), so `/mcp` always needs the bearer; the docs claimed tokenless. Corrected
  `units/zenod/README.md` (added "Get your token from `GET /api/token`" step) and
  `units/zenod/SEAM-SURFACE.md:9`. Receipts: commit `4610fb9` (README) + the HANDBACK commit below
  (SEAM-SURFACE). Env vars/port/health/tool-names all verified matching source (`settings.ts:73-77`,
  `main.ts:10-11`, `app.ts:151`).
- **[ ] `docker build`+run serves `tools/list` at `/mcp`** — **BLOCKED-on-environment:** the Docker
  daemon is not running in this session, so build/run and a live `tools/list`/401/forced-error
  transcript could not be executed. GREEN by code inspection, NOT executed. This is the tester's live
  evidence (RUN 2, external plain-MCP client) and/or a re-run with Docker up.

### 2026-07-05 · [worker/Z-3] Website functional-draft GREEN; LIVE checkout BLOCKED-on-credentials
- **[x] Page live: pitch + both paths + Obsidian/GitHub feature + `[DRAFT]` flag** —
  `sites/zenod/index.html` (184L) rebuilt: "Your personal wiki brain" hero, self-host (terminal
  quickstart, links `units/zenod`) AND hosted €5/mo paths, the required feature line "Your vault
  browser is Obsidian or GitHub… clone it and leave anytime", `[DRAFT — Epic 0 voice pending]`
  banner + per-section chips, NO chat UI/surface. Self-contained: 0 CDN refs (grep verified), inline
  CSS, emoji favicon. Receipt: commit `4610fb9`, `sites/zenod/index.html`.
- **[x] Minimal ToS/privacy linked** — Epic-2 H-11 DRAFT minimum copied to `sites/zenod/legal/`
  (terms 84L, privacy 81L) so the site is self-resolving; originals untouched. Receipt: `4610fb9`.
- **[ ] Stripe LIVE €5/mo SKU; checkout → webhook → Z-2 provisioning without human touch** —
  **BLOCKED-on-credentials.** No LIVE Stripe key (MCP unauthenticated in this session), no LIVE
  price/Checkout URL, and the cloud control plane is the separate private repo `zenod-ai/cloud`
  (not in this checkout). Not faked: the site CTA is a labeled placeholder
  (`href="#"` + a `TODO Z-3` comment naming the exact wiring), and the full plan +
  every blocked credential/access is documented in **`docs/Z-3-CHECKOUT-WIRING.md`** (7 steps, 8
  BLOCKED-needs). Also depends on Z-2 provisioning being live.

### 2026-07-05 · [worker/Z-5] Watchdog gap found+specified; restore runbook GREEN; live drills BLOCKED-on-infra
- **Registration finding (verified):** the fleet watchdog is **static-list, not discovery-based** —
  it only watches the containers/URLs in `ZENOD_WATCHDOG_CONTAINERS`/`ZENOD_WATCHDOG_HEALTH_URLS`
  (`scripts/watchdog/zenod-watchdog.sh:32-33`), never enumerates `docker ps`. Provisioning had NO
  watchdog step and teardown only deleted the Dokploy project → **a new tenant crash-looping pages
  no one.** Real gap.
- **[x] auto-register at provision / deregister at teardown — wiring authored** (spec GREEN, live
  BLOCKED): added **step 4b (register)** + **teardown deregister** to `units/PROVISIONING-RUNBOOK.md`,
  both citing law `3b4da80`; the fix is a safe config-list append (watchdog already skips absent
  containers, `zenod-watchdog.sh:129`, so stale entries can't false-page — no script change needed).
  Receipt: commit `4610fb9`, `units/PROVISIONING-RUNBOOK.md:75-102`. **Caveat for planner:**
  PROVISIONING-RUNBOOK is an Epic-2.5 (W-E) artifact; this additive edit needs 2.5 ratification.
- **[x] restore-from-repo runbook with receipts** — `docs/Z-5-RESTORE-FROM-REPO-RUNBOOK.md` (176L):
  Part A (register/deregister/crash-loop alert drill), Part B (baseline SHA → simulate total loss →
  rebuild from repo → same-SHA proof → store/search round-trip). EVERY step carries an explicit
  `Receipt:` line; the vault-is-the-backup claim is provable, not asserted. Receipt: `4610fb9`.
- **[ ] live crash-loop→alert + restore drill — BLOCKED-on-infra:** requires the VPS/operator; receipt
  slots are left empty (no fabricated drill). This is the tester's / operator's execution.

### 2026-07-05 · [worker/HANDBACK] Iteration 0 — pen returns to Zenod-Fable
Fan-out ran: three parallel sub-agents (Z-1 audit, Z-3 site, Z-5 watchdog+runbook), one turn, receipts
above verified by me before relay. Net lane states:

| Lane | Static/authoring | Blocked (and why) |
|---|---|---|
| **Z-1** | SEAM-SPEC 16/16 scored, seam-only confirmed, README stranger-trap fixed | `docker build`+run + live transcripts — **no Docker daemon this session** |
| **Z-3** | site draft + legal + checkout-wiring doc | LIVE Stripe SKU/checkout — **no LIVE keys; `zenod-ai/cloud` private, out of checkout** |
| **Z-5** | watchdog gap found+wired, restore runbook complete | live crash-loop + restore drill — **no VPS/infra** |
| **Z-2** | *not started* | **blocked by Z-1 runtime-green** (which is env-blocked) **+ needs a NEW thinner standalone-provisioning path** — the existing tenant stack provisions the full suite WITH a chat UI, which this epic forbids (see Z-6 checklist note) |
| **Z-4** | *not started* | blocked by Z-2 provisioning (per sequencing) |
| **Z-6** | one-page checklist READY (`docs/Z-6-CUSTOMER-1-CHECKLIST.md`) | Jordi in person; gated on Z-1..Z-5 live + **ZD-7 starter-credit number still unset (config value)** |

**Honest bottom line:** every lane that could be advanced WITHOUT a running container, LIVE payment
credentials, or VPS access was advanced to receipted-green-static; every lane that needs those is
BLOCKED with the exact blocker named — no fake-green, no zombie. The three environment blockers
(Docker daemon down · LIVE Stripe + private cloud repo · VPS access) are what stand between here and a
tester-runnable funnel; none are solvable from this worker session. **Planner asks:** (1) ratify the
Epic-2.5 PROVISIONING-RUNBOOK edit; (2) commission Z-2's standalone-provisioning path (distinct from
the full-suite tenant stack); (3) set ZD-7. Pen returned to Zenod-Fable.
Receipts: prior commit `4610fb9` (deliverables) + this HANDBACK commit (SEAM-SURFACE fix + append).
