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
- **Hosted gets a setup UI** (the CLOUD surface, wizard-shaped — see v0 surface spec below):
  connect/scaffold GitHub repo →
  issue MCP token → "paste this into Claude" → done. Plus: health, token management, usage
  dashboard. Self-host gets the same result via terminal + docs. The vault browser is
  Obsidian/GitHub — that's a feature, say it on the page.
- Standalone keyring: local credential store (the locked connections design's standalone mode).
- LLM spend (digest + ask) is metered per user from the per-call ledger; key model per ZD-5;
  the dashboard shows calls · tokens · cost either way.
- **v0 surface spec (Jordi, 2026-07-05 post-handback — settled):** Zenod v0 is PURELY an MCP
  server; the customer's chat client IS the whole interface — auth and daily use ride the MCP
  connection. **Self-host: no UI at all** — terminal + docs + your chat client; the server
  exposes `/mcp` plus bare utility routes (health, `GET /api/token`). **Cloud handoff = ONE
  URL:** signup ends with a single MCP endpoint URL you paste into Claude (auth shape per ZD-8).
  **The cloud UI is a NEW, separate surface** living in the private control plane
  (`zenod-ai/cloud`), not in this repo — multi-product by design, to be reused well beyond
  Zenod. It carries the OAuth buttons (GitHub connect etc.) and the dashboard: there as the
  convenience path, never required — everything needed to run your brain arrives with the URL.

## ZD decisions — planner frames, Jordi calls

Status 2026-07-05 (Zenod-Fable): **ZD-1..ZD-8 ALL DECIDED** (Jordi, same day, via planner's
framed options; ZD-7/ZD-8 called post-handback). **ZD-9/ZD-10 minted from cycle-2 live findings,
AWAITING JORDI (plain-chat answer; the interactive ask tool is failing)** — Block D carries the
recommended options as provisional defaults unless Jordi overrides before dispatch. Do not
relitigate decided items without new evidence.

- **ZD-9 · Self-host token story — AWAITING JORDI.** Cycle-2 finding: `/api/token` is auth-gated,
  so the README's "curl your token" is circular on a deployed instance.
  (a) **`ZENOD_API_TOKEN` env-seed** — self-hoster sets their own token next to
  VAULT_REPO/GITHUB_TOKEN; if unset, the auto-minted token prints ONCE to boot logs. No new
  endpoint; mirrors ZD-8's provisioner-set token. **Recommended; Block D default.**
  (b) Print-at-boot only. (c) Ungate `/api/token` on localhost — adds an unauthenticated path to
  the seam, disfavored. README + SEAM-SURFACE correction rides the call.

- **ZD-10 · Watchdog registration path — AWAITING JORDI.** Cycle-2 finding: the fleet watchdog is
  a host systemd timer; workers cannot shell the VPS (standing rule).
  (a) **Cloud-fed list, one-time bootstrap** — Jordi makes ONE sanctioned host change (watchdog
  reads its container/URL list from a file/endpoint the cloud service maintains); provision and
  teardown then update it via API forever, law-`3b4da80`-automated. **Recommended; Block D
  default — worker prepares everything, hands Jordi a single bootstrap command.**
  (b) Containerize the watchdog (Docker-socket discovery) — clean but unbudgeted build.
  (c) Manual per-tenant registration — doesn't scale; crash-loop gap stays open.

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

- **ZD-7 · Starter-credit allotment — DECIDED 2026-07-05 (Jordi): €2 grant at signup**, then
  self-serve top-up. Funnel works out of the box; exposure capped at €2/signup. (Planner had
  recommended €1 — recorded.) Wired as a CONFIG VALUE in the Z-2 provisioning path; the number
  travels to Product-Fable via Jordi alongside ZD-1. Z-6 is no longer gated on this.

- **ZD-8 · Cloud handoff auth shape — DECIDED 2026-07-05 (Jordi): tokened URL, one paste.**
  Minted from Jordi's v0 surface refinement ("you just get a URL"). The MCP URL embeds the
  secret (e.g. `https://<tenant>.<host>/mcp/<token>`); pasting ONE thing into Claude completes
  setup. Rotation/revocation from the cloud UI mints a new URL. Trade-off accepted and owned:
  the URL IS the credential — our surfaces never log it in plaintext, and the done screen says
  "treat this like a password." URL + separate bearer rejected for funnel friction; the header
  path (`GET /api/token` → `Authorization: Bearer`) remains the self-host mechanism.

## Iteration 0 — tickets (lanes parallel; worker MUST fan out sub-agents, one per lane)

Sequencing: **Z-1 ∥ Z-3-page ∥ Z-5-runbook start immediately**; Z-2 needs Z-1 green; Z-4 needs
Z-2; Z-6 last (Jordi in person); tester's stranger-run closes the epic. Acceptance boxes may be
checked ONLY with a same-line receipt (URL/SHA/ID). **States as of 2026-07-05 post-cycle-2
audit:** Z-1 RUNTIME GREEN on production (tester pending) · Z-3 wired LIVE (T8 pending) ·
Z-2/Z-4 mechanism/substrate proven, front-end unbuilt · Z-5 gated on ZD-10 · Z-6 gated on the
rest. Cycle 3 = Block D.

### Z-1 · Standalone GA (absorbs 2.5's W-C) — ✅ RUNTIME GREEN 2026-07-05 (cycle 2) · tester's fresh evidence pending · README item REOPENED (ZD-9)

Deliverable: `units/zenod/` builds and deploys as ONE container exposing ONE MCP endpoint,
SEAM-SPEC-conformant, with a stranger-grade README/quickstart.

Acceptance:
- [x] Builds + deploys on the SANCTIONED production path (Dokploy API — per Jordi 2026-07-05:
      never local Docker; Dokploy's build IS the build receipt) and serves `tools/list`/
      `tools/call` over streamable HTTPS at `/mcp` — **cycle-2 receipts:** `z-z1smoke.zenod.dev`
      live round trip, 14 tools, 401-without-bearer + forced-error transcripts, real commit
      `33776374` in `zenod-ai/z1-smoke-vault`, PR #603 (merged). (Local `docker build` remains
      the SELF-HOST story, proven by the tester's clean-VM run.)
- [x] *(static)* SEAM-SPEC v1 checklist passes item-by-item, spec UNEDITED — 16/16 scored with
      file:line evidence, audited by planner. Receipt: [worker/Z-1] APPEND entry + `4610fb9`;
      live transcripts now captured (cycle 2).
- [x] Public-seam-only: repo token read in exactly ONE place (`runtime.ts:296-299`, planner
      re-verified 2026-07-05); no non-MCP write path on the public surface.
- [ ] **REOPENED 2026-07-05 (cycle-2 finding 2, honest board):** README/quickstart
      stranger-grade. The `GET /api/token` step added after cycle 1 is itself unreachable on a
      deployed instance (`/api/*` globally auth-gated — token needs the token). Fix rides ZD-9;
      README + SEAM-SURFACE correction due in cycle 3. Prior receipts: `4610fb9`, PR #600.

Test criteria (tester, fresh evidence): an EXTERNAL plain-MCP client (not our code) completes
store → search → get on a FRESH instance using ONLY the README; commit-SHA + GitHub-URL receipts
verified in the vault repo; a deliberate non-seam write attempt fails loudly; SEAM-SPEC scored
line-by-line. Passing this ALSO satisfies 2.5's RD-4 split-trigger evidence and Epic 0's SD-6 gate.

### Z-2 · Provision + setup UI — ◐ mechanism PROVEN + CODIFIED (cycle 2: `zenod-ai/cloud#1` `provision-standalone.mjs`, deploy → `/api/provision` → tokened URL, €2 grant) · wizard + GitHub App + T8 auto-provision = cycle 3

Deliverable: a **NEW thin standalone-provisioning path** + the cloud setup wizard + self-host
terminal quickstart. **NOT the existing tenant stack** — that provisions the full suite WITH a
chat UI, which this epic forbids (worker finding, HANDBACK 2026-07-05; commissioning is the
planner's answer to that ask).

Acceptance:
- [ ] NEW standalone provisioning script (thin: container + repo + token + key, nothing else):
      one instance per user (ZD-6); repo in the CUSTOMER's GitHub account via GitHub App (ZD-3,
      runbook path); minted MCP token; per-tenant gateway key in the standalone keyring (ZD-5)
      carrying the €2 starter grant (ZD-7) as a config value; emits receipts (container ID, repo
      URL, token ID, gateway key ID); idempotent on retry; fired by the Stripe webhook (ZD-2).
- [ ] Signup ends in **ONE tokened MCP URL (ZD-8)** — the "paste this into Claude" block IS that
      URL; nothing else is required to use your brain.
- [ ] Wizard lives on the CLOUD surface (private `zenod-ai/cloud`, the new multi-product surface
      per the v0 surface spec): connect/scaffold GitHub → done screen showing the URL. OAuth
      buttons present but OPTIONAL. NO LLM-key step (ZD-5). Health + token management
      (mint/rotate/revoke → new URL) pages exist. No chat UI anywhere.
- [ ] Self-host: terminal quickstart in public docs reaches the same end state with NO UI — pure
      MCP + terminal per the v0 surface spec (`GET /api/token` → bearer).

Test criteria: tester provisions a fresh user end-to-end via the WIZARD, timed, <30 min bar, and
the wizard leg ends in a single copy-paste (the URL); separately completes self-host from docs
alone on a clean VM; Claude round-trip with commit-SHA receipt on BOTH paths.

### Z-3 · Website + checkout LIVE — ✅ WIRED LIVE 2026-07-05 (cycle 2) · "no human touch" pending T8

State: LIVE SKU `prod_UpYtFTErYgQal7` / `price_1Tptlw…` (€5/mo) · Payment Link active+livemode,
site CTA wired (PR #605) · webhook `we_1Tptly…` → `cloud.zenod.dev/webhook` enabled, signing
secret wired, unsigned POST → 400 (receipts: [worker/Z-3] RESOLVED entry, PR #606). Remaining
gap: checkout → webhook → queue is automated; **queue → provision (T8) is still concierge** —
the "fires without human touch" acceptance stays open until T8 lands (cycle 3).

Deliverable: public Zenod website — pitch, both paths, LIVE €5/mo checkout, legal minimum.

Acceptance:
- [x] Page draft: "your personal wiki brain" pitch; self-host AND hosted paths;
      "vault browser is Obsidian/GitHub" feature line; `[DRAFT — Epic 0 voice pending]` flags;
      0 CDN refs (planner re-verified). Receipt: `sites/zenod/index.html`, `4610fb9`.
      Final voice lands via Jordi (Epic 0 owns it).
- [ ] Stripe LIVE SKU €5/month; checkout → webhook → Z-2 provisioning fires without human touch
      (ZD-2). **BLOCKED-credentials cycle 1 (no LIVE key; `zenod-ai/cloud` private) → cycle 2;
      plan receipted in `docs/Z-3-CHECKOUT-WIRING.md`.**
- [x] Minimal ToS/privacy linked (Epic-2 H-11 minimum) — `sites/zenod/legal/`. Receipt: `4610fb9`.

Test criteria: a real card completes €5 checkout in prod; subscription visible in Stripe;
provisioning fires without human touch; self-host instructions pass a cold read by a stranger.

### Z-4 · Meter + dashboard — ◐ substrate LIVE (cycle 2: per-tenant $2-capped gateway key minted at provision; `read_llm_timeline` on the surface) · dashboard UI = cycle 3

Deliverable: per-tenant metering wired at provision; usage page on the CLOUD surface
(`zenod-ai/cloud`, per the v0 surface spec).

Acceptance:
- [ ] Per-tenant gateway key wired at provision, held in the standalone keyring (ZD-5).
- [ ] Usage page shows calls · tokens · cost · balance from the per-call ledger (usage.sqlite /
      read_llm_timeline), reconciling with the gateway balance (D-5: gateway is truth); top-up
      link present (ZD-4).
- [ ] D-5 behaviors: warn at threshold, polite block at zero, top-up restores. Starter grant
      wired as a config value, set to €2 (ZD-7 DECIDED).

Test criteria: tester burns a known amount via scripted `ask` calls; dashboard matches the
gateway within tolerance (exact call count; tokens/cost within provider-reported values);
zero-credit block + top-up + resume all receipted.

### Z-5 · Watchdog + ops — authored GREEN · live registration gated on ZD-10 (watchdog = host systemd timer; workers can't shell the VPS)

Deliverable: fleet-watchdog registration at provision (law `3b4da80`) + restore-from-repo runbook.

Acceptance:
- [x] *(authored; live wiring rides cycle 2)* Auto-register at provision / deregister at teardown
      — real gap found (watchdog is static-list; new tenants were invisible) and wired as
      PROVISIONING-RUNBOOK step 4b + teardown deregister. Receipt: `4610fb9`,
      `units/PROVISIONING-RUNBOOK.md:75-102`. **Cross-epic edit RATIFIED by Jordi 2026-07-05;
      Jordi carries the notice to Ring-Fable (2.5) — rule-10 routing.**
- [x] Runbook: restore-from-repo, step-by-step, every step with an explicit `Receipt:` slot —
      `docs/Z-5-RESTORE-FROM-REPO-RUNBOOK.md`. Receipt: `4610fb9`. Drill slots deliberately
      EMPTY until executed live (no fabricated drills).

Test criteria: forced crash-loop on a fresh tenant → operator alert received (receipt: alert +
timestamp); restore drill per runbook — new container + existing repo → store/search/get return
pre-crash memories with the same commit SHAs.

### Z-6 · Customer #1 run — OPEN · LAST · Jordi in person, not the worker · checklist READY

Deliverable: Jordi executes the funnel personally — LIVE card, his Claude, his repo, his dashboard.
Worker's obligation: leave Z-1..Z-5 green and a one-page Z-6 checklist ready — checklist done:
`docs/Z-6-CUSTOMER-1-CHECKLIST.md` (`4610fb9`); ZD-7 gate cleared (€2 set); still gated on
Z-1..Z-5 going live in cycle 2.

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

### Block A · WORKER — EXECUTED 2026-07-05 (cycle 1; HANDBACK in APPEND ZONE) · kept for the record

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

### Block D · WORKER cycle 3 — the funnel front-end. Jordi's only action; worker runs STEP 0 itself.

```
You are the Zenod Move-0 WORKER, cycle 3. Mission doc: docs/EPIC-2.3-ZENOD-MOVE-0.md in
zenod-ai/zenod — read it top to bottom; tickets as updated post-cycle-2 bind you. You hold
the pen on the APPEND ZONE only; planner sections are read-only.

STEP 0 — credential gate, VERBATIM, before anything else. Sources = the I2-7 operator
store by its receipted names. NEVER ask Jordi for a key; never print one.
  DKEY="${DOKPLOY_API_KEY:-$(security find-generic-password -s alpha9-dokploy-api-key -a jordi -w 2>/dev/null)}"
  test "$(curl -s -o /dev/null -w '%{http_code}' -m 10 -H "x-api-key: $DKEY" \
    "${DOKPLOY_URL:-https://dokploy.polyqu.com}/api/project.all")" = 200        # Dokploy alive
  OKEY="${OPENROUTER_PROVISIONING_KEY:-$(security find-generic-password -s alpha9-openrouter-provisioning-key -a jordi -w 2>/dev/null)}"
  test -n "$OKEY"                                                               # gateway keys (ZD-5/7)
  test -d "$HOME/Documents/GitHub/cloud/.git" || gh repo clone zenod-ai/cloud "$HOME/Documents/GitHub/cloud"
  SKEY="${STRIPE_SECRET_KEY:-$(security find-generic-password -s alpha9-stripe-live-key -a jordi -w 2>/dev/null)}"
  test "$(curl -s -o /dev/null -w '%{http_code}' -m 10 -u "$SKEY:" \
    https://api.stripe.com/v1/account)" = 200   # LIVE probe, NOT prefix match (cycle-2 finding 1)
Any check fails → dependent lanes BLOCKED with the failing line as receipt; no zombie.

DECIDED: ZD-1..ZD-8 (see ZD section). ZD-9/ZD-10 are AWAITING JORDI with Block-D defaults:
ZD-9 = ZENOD_API_TOKEN env-seed (+ print-once-at-boot when unset); ZD-10 = cloud-fed
watchdog list with a one-time Jordi bootstrap. If the doc records a different call before
you start, THAT wins.

LANES (fan out where parallel; all on the production path, no local Docker):
- T8 auto-provision (closes Z-3's "no human touch"): webhook queue task →
  provision-standalone.mjs (cloud#1) → instance + tokened URL (ZD-8), €2 grant (ZD-7).
- Z-2 wizard on the cloud surface: post-checkout page → connect GitHub (App per ZD-3;
  OAuth creds alpha9-github-oauth-client-id/-secret per Epic-2 B-9) → repo in the
  CUSTOMER's account → done screen = the ONE URL ("treat it like a password"). OAuth
  buttons optional; no LLM-key step; no chat UI. Health + token mint/rotate/revoke pages.
- Z-4 dashboard on the cloud surface: calls · tokens · cost · balance (per-call ledger,
  reconciling with gateway balance — D-5: gateway is truth) · top-up link · warn at
  threshold / polite block at zero / top-up restores.
- ZD-9 fix: implement the token story per the call (default env-seed); correct README +
  SEAM-SURFACE; kill the circular /api/token instruction.
- Z-5 per ZD-10 default: build the cloud-fed list end (provision/teardown update it);
  prepare the host side and HAND JORDI ONE bootstrap command — never shell the VPS.
- Update docs/Z-6-CUSTOMER-1-CHECKLIST.md to the final funnel shape.

GIT DISCIPLINE (two receipted auto-merge races): fresh branch off LATEST origin/main per
lane (epic23-c3-<lane>); push early; verify every commit with git branch -r --contains;
NEVER edit planner sections (two regressions receipted).

RECEIPTS: dated [worker/<lane>] APPEND-ZONE entries, same turn, URL/SHA/ID/transcript.
Teardown any smoke instances at handback; keep immutable receipts.

BUDGET: 1 working day, 100 turns total, ≤25 per sub-agent. Blocked → BLOCKED + exact
blocker, stop that lane honestly. Never zombie, never fake-green. HANDBACK entry with
every lane's state when done or exhausted. Pen returns to Zenod-Fable.
```

### Block C · WORKER cycle 2 — EXECUTED 2026-07-05 (two dispatches: env-gate BLOCKED hand-back, then the real run: Z-1 runtime GREEN, Z-3 wired LIVE). Kept for the record.

```
You are the Zenod Move-0 WORKER, cycle 2. Mission doc: docs/EPIC-2.3-ZENOD-MOVE-0.md in
zenod-ai/zenod — read it top to bottom; tickets Z-1..Z-5 as updated 2026-07-05 bind you,
including the v0 surface spec (Zenod is purely an MCP server; self-host = terminal + your
chat client, NO UI; cloud handoff = ONE tokened URL per ZD-8; the cloud UI is a separate
multi-product surface in zenod-ai/cloud with optional OAuth buttons). You hold the pen on
the APPEND ZONE only; planner sections are read-only.

ENVIRONMENT PRECONDITIONS — verify FIRST, one receipt each; any missing → write BLOCKED,
stop that lane, spend nothing on it: (1) Docker daemon responds; (2) VPS/operator access;
(3) zenod-ai/cloud checkout present; (4) LIVE Stripe key. Cycle 1 died on exactly these —
do not zombie into them.

GIT DISCIPLINE (cycle-1 collision on a shared branch, receipted): fresh branch off latest
origin/main named epic23-c2-<lane>; never reuse a shared branch; push early; if the tree
shifts under you, re-fetch and verify your commits landed (git branch -r --contains <sha>).

LANES, dependency order — fan out where parallel:
- Z-1 runtime: docker build + run; live tools/list transcript; 401-without-bearer
  transcript; forced-error transcript; external plain-MCP client completes
  store/search/get from the README alone. Closes Z-1.
- Z-2 (after Z-1): the NEW thin standalone provisioning path per the ticket — container +
  customer-repo (GitHub App) + MCP token + gateway key carrying the €2 starter grant
  (ZD-7), webhook-fired, receipts emitted; wizard on the cloud surface ending in ONE
  tokened URL (ZD-8); OAuth buttons optional; self-host quickstart re-verified. NOT the
  full-suite tenant stack.
- Z-3 checkout: LIVE €5/mo SKU per docs/Z-3-CHECKOUT-WIRING.md; checkout → webhook → Z-2
  fires with no human touch.
- Z-4 (after Z-2): meter + dashboard per ticket — calls · tokens · cost · balance on the
  cloud surface, gateway reconciliation, warn/block/top-up.
- Z-5 live: register real tenants with the watchdog. Leave the crash-loop + restore DRILLS
  to the tester (fresh evidence) — make them runnable; do not pre-run them as proof.
- Z-6 stays Jordi's. Update docs/Z-6-CUSTOMER-1-CHECKLIST.md if the funnel shape changed.

CONSTRAINTS unchanged: SEAM-SPEC UNEDITED; no chat UI on Zenod, ever; Epic 0 owns site
voice ([DRAFT] flags stay); no ring/council/channel; REUSE Epic-2 machinery. ZD-1..ZD-8
all DECIDED — do not relitigate.

RECEIPTS: dated [worker/Z-n] entries in the APPEND ZONE, same turn, URL/SHA/ID/transcript.
Acceptance boxes checked only with a same-line receipt.

BUDGET: 1 working day wall-clock, 100 agent-turns total, ≤25 per sub-agent. Blocked →
BLOCKED + exact blocker, stop that lane honestly. Never zombie, never fake-green. On
completion or honest exhaustion: HANDBACK entry with every lane's state. Pen returns to
Zenod-Fable.
```

## APPEND ZONE (dated, role-tagged, append-only — receipts or it didn't happen)

### 2026-07-05 · [planner/Zenod-Fable] Cycle-2 + Z-3 audit PASSED · sections reconstructed after a second regression · ZD-9/ZD-10 framed · Block D armed
- **Audit PASSED (verify-don't-trust).** Z-1 RUNTIME GREEN receipts verified: PR #603 + #604
  MERGED to main (`8504435` confirmed via github), real commit `33776374` in
  `zenod-ai/z1-smoke-vault`, teardown corroborated (health probe returns nothing). Z-3 RESOLVED
  verified: LIVE SKU/Payment-Link/webhook receipts in [worker/Z-3] entry; PRs #605/#606
  auto-merge pending CI; `cloud#1` (thin provisioner) accepted on the worker's receipt — cloud
  repo not readable from the planner sandbox, tester re-verifies. The three cycle-2 findings are
  real and actioned: (1) gate Stripe check → LIVE `/v1/account` probe (now embedded in Block D's
  STEP 0); (2) `/api/token` circularity → ZD-9 minted, Z-1's README acceptance box REOPENED
  (honest board); (3) Dokploy env/redeploy quirks → codified in `provision-standalone.mjs`.
- **Second planner-section regression (rule 8, recorded):** the STEP-0 gate section, Block-C
  rewrites, and four planner APPEND entries (cycle-2-blocked audit; production-path course
  correction; self-sourcing gate; alpha9-* names fold) were lost from main lineage during the
  #602→#606 auto-merge races — content survives in git history (commits `ab6e100`, `7ad0dcb`,
  `b02a91e` on merged PRs). Operationally superseded by this entry + Block D. New working rule:
  the planner lands its own PR immediately after each fold instead of riding worker branches.
- **Decisions:** ZD-9 (self-host token) + ZD-10 (watchdog registration) framed in the ZD section,
  AWAITING JORDI by plain chat (the interactive ask tool crashed twice mid-answer). Block D
  carries the recommended options as explicit provisional defaults.
- **Cycle 3 armed (Block D):** T8 auto-provision · cloud wizard (GitHub App, ZD-3) · Z-4
  dashboard · ZD-9 fix + README/SEAM-SURFACE correction · Z-5 cloud-fed list with one-command
  Jordi bootstrap. After its HANDBACK: Z-6 (Jordi, real €5 charge) → Block B tester closes.

### 2026-07-05 · [planner/Zenod-Fable] Cycle-1 audit PASSED · ZD-7/ZD-8 DECIDED · v0 surface spec folded · cycle 2 armed
- **Audit (verify-don't-trust) of the worker HANDBACK: PASSED.** PR #600 MERGED to main
  (`a86bd8b`, 1 check passed, branch deleted — github.com/zenod-ai/zenod/pull/600). Planner
  spot-checks this session: `runtime.ts:296-299` single repo-token read confirmed;
  `sites/zenod/index.html` 0 CDN refs + `[DRAFT — Epic 0 voice pending]` present;
  `units/zenod/README.md:67` `/api/token` step present; `SEAM-SURFACE.md:9` corrected; Z-5
  runbook, Z-3 wiring doc, Z-6 checklist on disk. Blocked lanes verified environment-blocked,
  not work-blocked. No fake-green found. Ticket sections updated to post-audit states.
- **Jordi (same day, post-handback):** v0 surface spec settled (pure MCP server; self-host =
  terminal + chat only, NO UI; cloud = ONE URL; cloud UI = new multi-product surface in
  `zenod-ai/cloud`, OAuth buttons optional) — folded into "What this product is" and Z-2/Z-4.
  **ZD-7 DECIDED: €2 starter grant** (planner recommended €1 — recorded). **ZD-8 minted +
  DECIDED: tokened URL, one paste.** **PROVISIONING-RUNBOOK watchdog edit RATIFIED**; Jordi
  carries the notice to Ring-Fable (2.5) per rule 10.
- **Worker asks answered:** (1) ratified, above; (2) Z-2 standalone-provisioning path
  COMMISSIONED — ticket rewritten (thin path, NOT the full-suite tenant stack); (3) ZD-7 set.
- **Cycle 2 armed:** Block C written with hard environment preconditions (Docker · VPS ·
  `zenod-ai/cloud` · LIVE Stripe) — cycle 1's three blockers become cycle 2's entry gate — plus
  git discipline after the shared-branch collision (#599 stomped the HANDBACK; recovered in
  #600). Block B (tester) unchanged, still gated on HANDBACK-c2 + Z-6.

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

### 2026-07-05 · [worker/HANDBACK-c2] Cycle 2 — environment gate FAILED on all 4 preconditions; every lane BLOCKED-env, no zombie
Block C mandates verifying the four hard environment preconditions FIRST and stopping any lane whose
precondition is missing, spending nothing on it. I verified all four in this session before touching a
lane. **All four are MISSING** — this environment does not meet Block C's own entry condition ("paste
ONLY into an environment with Docker UP · VPS · cloud checkout · LIVE Stripe").

| # | Precondition | Verdict | Receipt (this session, 2026-07-05) |
|---|---|---|---|
| 1 | Docker daemon responds | ❌ MISSING | `docker version` → `Cannot connect to the Docker daemon at unix:///Users/jordi/.docker/run/docker.sock` (identical to cycle 1) |
| 2 | VPS / operator access | ❌ MISSING | no `DOKPLOY_TOKEN` in env; no zenod/alpha9 ssh host alias; and Jordi's standing rule forbids manual VPS/`docker exec`/SSH ops regardless — no sanctioned operator path in this session |
| 3 | `zenod-ai/cloud` checkout present | ❌ MISSING | no working checkout (`../cloud`, `~/Documents/GitHub/cloud` both absent); `gh repo view zenod-ai/cloud` resolves it PRIVATE but it is not checked out here, and the cloud wizard/dashboard (Z-2/Z-4) live there |
| 4 | LIVE Stripe key | ❌ MISSING | no `STRIPE_*` env var; no `stripe` CLI; Stripe MCP unauthenticated (OAuth not completable in a non-interactive session) |

**Per-lane consequence (dependency order), each stopped honestly:**
- **Z-1 runtime** (docker build+run, live `tools/list`/401/forced-error transcripts, external plain-MCP
  client round-trip): needs **P1 Docker** → **BLOCKED-env.** Z-1 stays GREEN-static (cycle-1 audit,
  `4610fb9`/#600); the runtime box is un-checkable here. Cannot close Z-1.
- **Z-2** (thin standalone provisioning path; cloud wizard → tokened URL): gated on Z-1-runtime-green
  **+ P2 VPS + P3 cloud checkout + P4 Stripe webhook source** → **BLOCKED-env.** The commissioned path
  is understood and ticketed; it is not authored/verified here because live firing (webhook → container
  + GitHub-App repo + gateway key with €2 grant) cannot be exercised without P1–P4, and the wizard
  belongs in `zenod-ai/cloud` which is not checked out.
- **Z-3 checkout** (LIVE €5/mo SKU → webhook → Z-2): needs **P4 LIVE Stripe + P3 cloud** → **BLOCKED-env.**
  Plan remains `docs/Z-3-CHECKOUT-WIRING.md`; site draft stays GREEN.
- **Z-4** (meter + dashboard on the cloud surface): gated on Z-2 (blocked) **+ P3 cloud** → **BLOCKED-env.**
- **Z-5 live** (register real tenants with the watchdog): needs **P2 VPS + real tenants from Z-2** →
  **BLOCKED-env.** Wiring + runbook stay GREEN (`4610fb9`); drills correctly left to the tester.
- **Z-6**: unchanged — Jordi in person; funnel shape unchanged this cycle, so
  `docs/Z-6-CUSTOMER-1-CHECKLIST.md` needs no edit.

**Honest bottom line:** cycle 2 is the LIVE-execution cycle and this environment supplies none of the
four things it needs to execute. I did not zombie into them, did not fake-green, and did not perform
forbidden manual VPS/Stripe workarounds. Nothing to re-author: cycle 1 already produced every
environment-independent artifact. **The correct next step is not another worker turn — it is provisioning
the environment.** Re-dispatch Block C only into a session/host that actually has: Docker daemon UP, a
sanctioned VPS/operator path (or the deploy done via push-to-main autodeploy per standing rule), the
`zenod-ai/cloud` repo checked out, and a LIVE Stripe key. Until then Z-1..Z-5 remain at their post-cycle-1
states (static/authored GREEN; runtime/live BLOCKED-env). Pen returns to Zenod-Fable.
Receipt: this HANDBACK commit on branch `epic23-c2-handback` (off `origin/main` `02d832c`).

### 2026-07-05 · [worker/Z-1] cycle-2 RUNTIME GREEN — standalone Zenod LIVE on the production path, full round trip verified
Supersedes the preconditions-missing HANDBACK-c2 above: this run was re-dispatched WITH the STEP-0
credential gate, which passed on the operator store (Dokploy 200 · OpenRouter `/keys` 200 · `zenod-ai/cloud`
cloned). Z-1 is now CLOSED on the production path.

**Deploy (Dokploy API = the build receipt):** authored a NEW thin standalone compose
`docker-compose.zenod-standalone.yml` (ONE public `/mcp` box, ghcr image, no UI, no council — NOT the
full-suite tenant stack), branch `epic23-c2-z1`. Deployed via the Dokploy API (compose.create →
compose.update git-source+env → domain.create → compose.deploy). Receipts: composeId
`u_GpsvbfIwZfBK0zB-yzE`; domain `https://z-z1smoke.zenod.dev`; deployment status `done`; `GET /api/health`
→ 200 (`{"status":"ok","name":"zenod","sha":"01911338…"}`).

**Provisioning proven (this IS the ZD-8 shape):** the box boots await-provision and idle; the provisioner
`POST /api/provision` mints the MCP token (a value we choose) + pushes config (provider=openrouter +
per-tenant gateway key, vault_repo, github_token) → `{"ok":true,"configured":true}` HTTP 200. This is the
thin Z-2 mechanism, exercised end-to-end by hand.

**Live MCP transcripts against production `https://z-z1smoke.zenod.dev/mcp` (plain JSON-RPC / curl):**
- [x] `tools/list` → 14 tools incl. `store_memory, search_memory, get_memory, ask_brain, get_task_result`
      (serverInfo `zenod-mcp-server`).
- [x] **401 without bearer** — `initialize` with no `Authorization` → HTTP 401 `{"error":"unauthorized"}`
      (SEAM-SPEC item 12, live).
- [x] **store → poll → search round trip:** `store_memory` → `{jobId:36e8e09e…}` → `get_task_result` →
      `done` with **`commitSha 33776374c5589d8abe54c7673f81be0306b6321d`** + githubUrls in the vault repo;
      `search_memory "insurance renewal"` → 3 hits with GitHub URLs. **Commit verified in the repo:**
      `gh api repos/zenod-ai/z1-smoke-vault/commits/33776374…` → "memory: Record home insurance renewal
      date"; `Areas/Insurance.md` (845 B) present. Real git commit in a real GitHub repo — the receipt is
      the SHA.
- [x] **forced error** — `get_memory "Areas/DoesNotExist.md"` → `isError:true`, text "note not found"
      (SEAM-SPEC item 15, live loud error).

**Two runtime-only bugs found (invisible to cycle-1's static audit — the value of running it live):**
1. **`GET /api/token` is auth-gated** (`app.ts:219` `app.use("/api/*", requireAuth)` covers it). So the
   self-host README's "curl `/api/token` to read your token" is unreachable — a stranger self-hosting
   (ZENOD_AWAIT_PROVISION=0) gets an auto-minted token they CANNOT read, and `/mcp` always needs it. The
   working path is the provisioner setting a known token via `/api/provision` (cloud/ZD-8). **Proposed fix
   (planner):** either ungate `/api/token` when no admin password is set, OR print the token to stdout at
   first boot, OR add a `ZENOD_API_TOKEN` env seed so self-host controls it. README/SEAM-SURFACE need a
   correction pass once the mechanism is chosen — flagging, not unilaterally editing code late in budget.
2. **Dokploy env box ≠ container env.** The env box only feeds compose `${VAR}` interpolation; a var reaches
   the container ONLY if the compose lists it under `environment:`. First deploy silently ran unconfigured
   because the standalone compose didn't map the vars. Fixed in `docker-compose.zenod-standalone.yml`
   (maps `ZENOD_AWAIT_PROVISION/VAULT_REPO/GITHUB_TOKEN/ZENOD_PROVIDER/OPENROUTER_API_KEY`, matching the
   proven `&agent-env` anchor in `docker-compose.tenant.yml`). Also: `compose.redeploy` reused a stale git
   clone — `compose.deploy` forced the fresh commit. Both are real gotchas for the Z-2 provisioner script.

Receipts committed on branch `epic23-c2-z1` (compose files); credentials never printed/committed. NOTE: the
`z1smoke` box holds a broad `gho_` vault token in its env for the smoke — it will be TORN DOWN at handback
(compose.delete + OR smoke keys revoked); the vault repo `zenod-ai/z1-smoke-vault` + commit `33776374` are
left as the immutable receipt.

### 2026-07-05 · [worker/Z-3] cycle-2 LIVE checkout — BLOCKED: the credential gate false-greened a placeholder key
The STEP-0 gate reported Stripe ✅, but that check is **prefix-only** (`case "$SKEY" in rk_live_*`). The
Keychain item `alpha9-stripe-live-key` holds a **placeholder**, not a real key: value is `rk_live_…_KEY`
(len 38, last4 `_KEY`); `GET https://api.stripe.com/v1/account` → **401 Invalid API Key** (verified twice,
no secret echoed). So Z-3 cannot create the LIVE SKU. **Gate bug to fix (planner):** the gate must actually
call `/v1/account` (like it curls Dokploy `/project.all`), not just match a prefix — otherwise it green-lights
a fake. What IS confirmed without the key (Z-3 sub-agent): the cloud webhook is LIVE — `GET
https://cloud.zenod.dev/healthz` → `{"ok":true}`, `POST /webhook` unsigned → 400 (signature check reached),
so the Stripe webhook target is `https://cloud.zenod.dev/webhook` (event `checkout.session.completed`), and
the site CTA is a one-line swap once a Payment Link exists. **BLOCKED-needs:** a real LIVE key stored ONCE —
`security add-generic-password -U -s alpha9-stripe-live-key -a jordi -w 'rk_live_…'`.

### 2026-07-05 · [worker/Z-2] cycle-2 — thin standalone provisioner CODIFIED (mechanism proven); wizard/App/webhook remain
The thin path the ticket commissioned is proven and codified. The whole deploy→provision→tokened-URL
mechanism was exercised end-to-end by hand for Z-1 (z-z1smoke), then written up as a reusable script.
- [x] *(mechanism proven + codified)* NEW thin provisioner: `zenod-ai/cloud` `scripts/provision-standalone.mjs`
      (PR zenod-ai/cloud#1). Mints per-tenant OpenRouter gateway key with the **€2 grant (ZD-7)** as a config
      value (`--grant 2`); ensures the vault repo; Dokploy API create→update(git+env)→domain→**deploy**;
      waits health; `POST /api/provision` mints the MCP token + pushes config; prints the ONE tokened URL
      (ZD-8). Emits receipts (composeId, repo URL, gateway-key id). Depends on
      `docker-compose.zenod-standalone.yml` landing on `main` (PR #603).
- [ ] **Wizard on the cloud surface** (connect/scaffold GitHub → done screen with the URL; OAuth buttons
      optional; token mint/rotate/revoke): NOT built — a real front-end build in `zenod-ai/cloud`. NEXT.
- [ ] **Customer's-own-GitHub via the GitHub App (ZD-3):** the script uses the operator token as the working
      default today; the per-customer App-installation-token path is the remaining piece (rides the wizard's
      GitHub OAuth button). NEXT.
- [ ] **Webhook-fired (ZD-2):** blocked behind Z-3's LIVE Stripe key; the target URL is confirmed
      (`cloud.zenod.dev/webhook`), the queue path exists (`cloud` `services/webhook`).
- [x] **Self-host quickstart re-verified — and a bug found:** the v0 "no UI, curl `/api/token`" self-host
      path is **broken** because `/api/token` is auth-gated (see Z-1 finding #1). Provision-path works; pure
      self-host token-read needs the fix. Flagged, not silently passed.

### 2026-07-05 · [worker/Z-4 + Z-5] cycle-2 states
- **Z-4 (meter + dashboard):** the metering substrate is LIVE and correct — the z1smoke instance runs on a
  per-tenant OpenRouter gateway key with a hard $2 cap (gateway-is-truth, D-5/ZD-5), minted at provision, and
  `read_llm_timeline` is in the tool surface. The **usage dashboard is a cloud-surface UI build** (calls ·
  tokens · cost · balance · top-up) that does not exist yet — same NEXT bucket as the Z-2 wizard. Not faked.
- **Z-5 (live watchdog registration):** **BLOCKED-on-host-shell.** The watchdog is a *host* systemd timer
  reading `/etc/zenod-watchdog.env` (`scripts/watchdog/zenod-watchdog.sh:24-33`) — it lives OUTSIDE Dokploy,
  so registering a new tenant means editing a host file, which the Dokploy API cannot do and Jordi's standing
  rule forbids by hand. The runbook wiring (cycle-1) stands; the live register step needs an operator with
  host access (or moving the watched-list into a Dokploy-managed surface — a design note for the planner).

### 2026-07-05 · [worker/HANDBACK-c2] Cycle 2 EXECUTED — Z-1 runtime GREEN; honest map of the rest
Credential gate passed on the operator store (Dokploy 200 · OpenRouter `/keys` 200 · cloud cloned · Stripe
**false-green**, see Z-3). Real production work happened this cycle — the epic's central claim is now proven.

| Lane | Cycle-2 state | Receipt |
|---|---|---|
| **Z-1** | ✅ **RUNTIME GREEN** — standalone Zenod live, `/mcp` round trip, real commit | `z-z1smoke.zenod.dev`, commit `33776374` in `zenod-ai/z1-smoke-vault`, PR #603 |
| **Z-2** | ◐ mechanism **proven + codified**; wizard/App/webhook remain | cloud#1 `provision-standalone.mjs` |
| **Z-3** | ⛔ BLOCKED — Stripe key is a placeholder (gate bug) | `/v1/account` 401; webhook target `cloud.zenod.dev/webhook` confirmed |
| **Z-4** | ◐ metering substrate live ($2 gateway key); dashboard UI = NEXT | gateway key `zenod-tenant:z1smoke`, `read_llm_timeline` in surface |
| **Z-5** | ⛔ BLOCKED-on-host-shell (watchdog is a host systemd timer) | `zenod-watchdog.sh:24-33` |
| **Z-6** | Jordi's; funnel shape confirmed (provision → tokened URL) | checklist updated |

**Three findings for the planner (each a real bug the live run surfaced):**
1. **Gate Stripe check is prefix-only → false-green.** Make it call `/v1/account` (2-line fix); it currently
   passes `rk_live_…_KEY`. This is why cycle-2 thought it had 4/4 but really had 3/4.
2. **`/api/token` is auth-gated** → the self-host "curl your token" story is broken; needs ungate-when-no-password
   / print-at-boot / `ZENOD_API_TOKEN` seed. README + SEAM-SURFACE correction pending the choice.
3. **Dokploy env box ≠ container env** unless the compose maps `${VAR}`; `compose.redeploy` reuses stale
   clones (use `compose.deploy`). Baked into `provision-standalone.mjs` so the Z-2 path doesn't re-hit them.

**NEXT (not blocked, just unbuilt — a cloud-surface front-end cycle):** the wizard + usage dashboard in
`zenod-ai/cloud` (Z-2 wizard, Z-4 dashboard), the GitHub-App per-customer repo (ZD-3). **Truly blocked:** Z-3
(real Stripe key) and Z-5 live (host shell for the watchdog).

**Teardown done at handback:** the `z1smoke` compose is deleted (removes the operator `gho_` token from the
cloud env) and its OR smoke keys revoked; the vault repo + commit `33776374` are kept as the immutable Z-1
receipt. Pen returns to Zenod-Fable.

### 2026-07-05 · [worker/Z-3] RESOLVED — LIVE €5/mo checkout wired (Jordi loaded the real Stripe key)
Supersedes the Z-3 BLOCKED entry above: Jordi stored the real LIVE secret key into
`alpha9-stripe-live-key`; the gate now validates properly — `GET /v1/account` → **200**, account
`acct_1TpJpc80yG7aohEW`, livemode, country ES (not just a prefix match this time).
- [x] **LIVE €5/month SKU** — product `prod_UpYtFTErYgQal7`, price `price_1Tptlw80yG7aohEWL9X4zqMI`
      (unit_amount 500, EUR, recurring monthly, livemode).
- [x] **Payment Link (the site CTA target)** — `plink_1Tptlx80yG7aohEWDMhQYOWJ` →
      `https://buy.stripe.com/3cIdR3bSLgyL7yi89HbAs01` (active, livemode). Site CTA wired: PR #605
      (`sites/zenod/index.html`, `href="#"` → the Payment Link).
- [x] **Webhook endpoint** — `we_1Tptly80yG7aohEWcS5P2H22` → `https://cloud.zenod.dev/webhook`, event
      `checkout.session.completed`, status **enabled**. Signing secret wired into the `zenod-cloud`
      Dokploy compose (`17QoMFRg…`): swapped ONLY the `STRIPE_WEBHOOK_SECRET` line (11-line env block
      preserved), redeploy `done`, `healthz {"ok":true}`, unsigned POST still `400` (guard intact).
- [~] **checkout → webhook → Z-2 without human touch (ZD-2):** PARTIAL. Checkout → webhook → **queue
      task** is automated (the webhook verifies + records); but **queue → provision is still concierge**
      — the auto-provisioner (cloud `services/webhook`, "Phase 1 provisioner / T8" per
      `cloud/docs/PROVISIONING.md`) is NOT built, so an operator still runs `provision-standalone.mjs`.
      True zero-touch needs T8 + the wizard. This is the honest remaining gap on the €-path; the real
      €5 charge is the tester's / Z-6's run (I created no charge).

**Z-3 net:** the LIVE SKU + Payment Link + site CTA + registered/secret-wired webhook are all GREEN and
verified; only the queue→provision automation (T8) remains for full no-touch. Receipts above are all LIVE
Stripe object ids + the site PR. No secrets committed or printed. Pen returns to Zenod-Fable.

### 2026-07-05 · [worker/HANDBACK-c3] Cycle 3 — the funnel front-end, fanned out 5 ways in isolated worktrees
Credential gate passed 4/4 (Dokploy 200 · OpenRouter present · cloud cloned · **Stripe LIVE `/v1/account`
200** — the cycle-2 prefix-only bug is fixed in the gate). Per the planner's parallelization amendment:
five lanes, one sub-agent each, **git-worktree isolation** (no shared trees — the cycle-1/2 collision class
is now structurally impossible), cloud PRs integrated by me **sequentially with rebased deltas**.

| Lane | State | Receipt |
|---|---|---|
| **ZD-9** (token) | ✅ GREEN | `ZENOD_API_TOKEN` seed + print-once; README/SEAM-SURFACE fixed; **vitest 3/3** (pin/auto-mint+print/await). zenod **PR #608 merged**. Closes Z-1's reopened README box + the circular-`/api/token` trap. |
| **T8** (auto-provision) | ✅ merged | webhook `checkout.session.completed` → fires `provision-standalone.mjs` (opt-in `ZENOD_AUTO_PROVISION`, best-effort; queue stays fallback). cloud **#3 merged**. Closes Z-3 "no human touch" **once enabled** — real proof is the tester's live checkout. |
| **Z-2 wizard** | ✅ merged, ⚠ gated | full **GitHub App** path (JWT RS256 → installation token → repo in the CUSTOMER's account, ZD-3) written + tsc-clean, **runtime-gated on missing creds** (`alpha9-github-app-*` absent → `503`, operator-org fallback preserved). cloud **#4 merged** (superseded #2). Done screen = the ONE tokened URL (ZD-8). |
| **Z-4 dashboard** | ✅ merged | gateway-truth **balance + D-5 states LIVE**; **per-call calls·tokens·cost** wired to instance `GET /api/usage` (bearer-authed), live once `mcp_token` stored — degrades honestly otherwise. cloud **#7 merged** (rebased; superseded #5). |
| **ZD-10 watchdog** | ✅ merged | `GET /watchdog/targets` (token-gated, `?format=env`) derived from accounts with a `tenant_slug`; provision registers the target; **`cloud/docs/WATCHDOG-CLOUD-FED.md`** has the ONE host bootstrap command. cloud **#8 merged** (rebased; superseded #6). |

Integration: cloud `main` compiles clean (`tsc --noEmit` exit 0 at `ca5850f`). Merge order followed the
amendment (#1 provisioner → #3 t8 → #4 wizard → #7 dash → #8 wdog), each rebased as a pure delta to dodge
the squash-merge conflicts; combined #2/#5/#6 closed as superseded. Worktrees pruned. No smoke instances.

**Three config asks for Jordi (each turns a gated feature LIVE — no code change):**
1. **GitHub App creds** (activates ZD-3 repo-in-customer-account; else operator-org fallback):
   `security add-generic-password -U -s alpha9-github-app-id -a jordi -w '<id>'` + `-s alpha9-github-app-private-key`
   (the PEM) + `-s alpha9-github-app-slug`, then set `ZENOD_GITHUB_APP_ID/_PRIVATE_KEY/_SLUG` on `zenod-cloud`.
2. **`WATCHDOG_TOKEN`** on `zenod-cloud` env (else `/watchdog/targets` 503s), then run the ONE bootstrap
   command in `cloud/docs/WATCHDOG-CLOUD-FED.md` on the host (installs a 5-min sync timer → `/etc/zenod-watchdog.env`).
3. **`ZENOD_AUTO_PROVISION=1`** on `zenod-cloud` to turn T8 on (after one supervised run).

**Two honest follow-ups (flagged, not hidden):** (a) the provisioner must persist the instance bearer as
`account.mcp_token` at provision so per-call detail lights up without a manual rotate; (b) the ZD-10 target
container name uses the full-suite pattern — point it at the standalone `zenod-<slug>` (health URL is already
correct, the load-bearing check).

**Net:** the whole funnel now exists on the production path — LIVE checkout (c2) → auto-provision (T8) →
wizard (GitHub App, ZD-3) → tokened URL (ZD-8) → dashboard (calls·tokens·cost·balance) → cloud-fed watchdog
(ZD-10) → self-host token pinning (ZD-9). What remains is **config, not code** (3 asks) plus the tester's
live funnel run and Jordi's Z-6 customer-#1 run. Pen returns to Zenod-Fable.

### 2026-07-05 · [worker/HANDBACK-c4] Cycle 4 micro-patch — 3 green, 1 gated on a single click; Z-6 = NO-GO→GO on one action
Gate 4/4 (Dokploy 200 · OpenRouter · cloud · **Stripe LIVE /v1/account 200**). Four tickets, worktree/branch-per-ticket, sequential merges.

| Ticket | State | Receipt |
|---|---|---|
| **Z-2b** provisioner persists mcp_token | ✅ merged | cloud **#10** — T8 `autoProvision` parses the provisioner's MCP url+bearer and `upsertAccount(sessionId,{mcp_token,…})`; dashboard per-call renders with no manual rotate. tsc 0. |
| **Z-5b** standalone container name | ✅ merged | cloud **#9** — `/watchdog/targets` emits `zenod-<slug>` (matches the standalone `container_name`), health URL unchanged. tsc 0. |
| **Z-5c** watchdog token + feed | ✅ merged + VERIFIED | token generated + stored (Keychain `alpha9-watchdog-token`, acct jordi = its receipted home); found the compose didn't map the var (cloud **#11** adds `WATCHDOG_TOKEN`/App-creds/`AUTO_PROVISION` passthroughs); set on `zenod-cloud` via Dokploy, redeployed. **Probe: `GET /watchdog/targets` (bearer) → 200** (core fleet, 0 tenants yet); no-bearer → 401; healthz ok. |
| **Z-2c** App creds reconciliation | ◑ recovered, PEM-gated | `zenod-t3` **App ID 4063939 · slug zenod-t3 · installation 140570361** recovered via the org installations API and **set in the cloud env** (ZENOD_GITHUB_APP_ID/_SLUG). **PEM is unrecoverable from here** — GitHub private keys are download-once; the June PEM lives only in c1's connections sqlite (no export endpoint; `/api/connections` returns token/clients/grants, not the key; VPS shell forbidden) and is in no Dokploy env / disk / Keychain. Per the ticket's sanctioned fallback → **one regenerate click** (non-destructive; adds a key, old ones keep working). |

**Config verification (read-only):** watchdog → 200 (above). App path → still 503 (PEM pending, expected). **`ZENOD_AUTO_PROVISION` = unset → OFF (confirmed).**

**Z-6 GO/NO-GO: NO-GO → GO on ONE Jordi action** (the zenod-t3 PEM). Everything else is green/wired: standalone provisioning, tokened URL, dashboard+persisted token, LIVE checkout, watchdog feeding, self-host token. The App path (ZD-3 repo-in-customer-account) is the only gate, and it needs exactly one regenerate.

**PASTE-LINE 1 — watchdog host bootstrap (ssh into the VPS as root, paste once; installs a 5-min sync timer, the ONLY host action ZD-10 needs):**
```bash
# see the fully-substituted block printed in the worker's chat receipt (contains the read-only watchdog token, also in Keychain alpha9-watchdog-token)
# source: cloud/docs/WATCHDOG-CLOUD-FED.md, TOKEN substituted
```

**PASTE-LINE 2 — flip T8 to no-touch at Z-6 GO (run on your Mac; sets ZENOD_AUTO_PROVISION=1 + redeploys):**
```bash
DKEY=$(security find-generic-password -s alpha9-dokploy-api-key -a jordi -w); CID=17QoMFRgvmZ0Y2n19DINT; A=https://dokploy.polyqu.com/api; E=$(curl -s "$A/compose.one?composeId=$CID" -H "x-api-key: $DKEY" | python3 -c 'import sys,json;e=[l for l in json.load(sys.stdin)["env"].splitlines() if not l.startswith("ZENOD_AUTO_PROVISION=")]+["ZENOD_AUTO_PROVISION=1"];print(chr(10).join(e))'); curl -s -X POST "$A/compose.update" -H "x-api-key: $DKEY" -H "Content-Type: application/json" -d "$(ENVV="$E" python3 -c 'import os,json;print(json.dumps({"composeId":"17QoMFRgvmZ0Y2n19DINT","env":os.environ["ENVV"]}))')" >/dev/null; curl -s -X POST "$A/compose.deploy" -H "x-api-key: $DKEY" -H "Content-Type: application/json" -d '{"composeId":"17QoMFRgvmZ0Y2n19DINT"}' >/dev/null; echo flipped
```

**Z-2c regenerate (the one click, then one paste):** open **https://github.com/organizations/zenod-ai/settings/apps/zenod-t3** → "Private keys" → **Generate a private key** (downloads a .pem). Then paste on your Mac:
```bash
PEM=$(cat ~/Downloads/zenod-t3.*.private-key.pem); security add-generic-password -U -s alpha9-github-app-private-key -a jordi -w "$PEM"; DKEY=$(security find-generic-password -s alpha9-dokploy-api-key -a jordi -w); CID=17QoMFRgvmZ0Y2n19DINT; A=https://dokploy.polyqu.com/api; E=$(PEM="$PEM" curl -s "$A/compose.one?composeId=$CID" -H "x-api-key: $DKEY" | PEM="$PEM" python3 -c 'import sys,json,os;e=[l for l in json.load(sys.stdin)["env"].splitlines() if not l.startswith("ZENOD_GITHUB_APP_PRIVATE_KEY=")]+["ZENOD_GITHUB_APP_PRIVATE_KEY="+os.environ["PEM"].replace(chr(10),"\\n")];print(chr(10).join(e))'); curl -s -X POST "$A/compose.update" -H "x-api-key: $DKEY" -H "Content-Type: application/json" -d "$(ENVV="$E" python3 -c 'import os,json;print(json.dumps({"composeId":"17QoMFRgvmZ0Y2n19DINT","env":os.environ["ENVV"]}))')" >/dev/null; curl -s -X POST "$A/compose.deploy" -H "x-api-key: $DKEY" -H "Content-Type: application/json" -d '{"composeId":"17QoMFRgvmZ0Y2n19DINT"}' >/dev/null; echo "App PEM wired + redeploying — ZD-3 goes live in ~1 min"
```
After that paste, the wizard App path goes non-503 and **Z-6 is GO**. Pen returns to Zenod-Fable.

### 2026-07-05 · [worker/HANDBACK-c5] Cycle 5 — front door + login chain; incident (Dokploy disk) resolved mid-cycle
Gate 4/4 after recovery (Dokploy was down mid-cycle — see incident below). Findings from Jordi's first minute + ZD-11.

- **[worker/F-1] LIVE €5/mo front-door CTA — GREEN (deploys on merge).** `apps/site` (the live zenod.dev, push-deploy) gets a **primary "Get hosted — €5/month"** button → the LIVE Payment Link `https://buy.stripe.com/3cIdR3bSLgyL7yi89HbAs01`. I set the Payment Link's `after_completion` → **redirect to `cloud.zenod.dev/success.html?session_id={CHECKOUT_SESSION_ID}`** (livemode, active) so checkout routes into the claim→wizard chain. New copy flagged `[DRAFT — Epic 0 voice pending]`; Epic-0 voice untouched. `sites/zenod/index.html` marked `SUPERSEDED-BY-apps/site` (kept, not deleted). tsc 0. PR **#611** (auto-merge → autodeploys zenod.dev). **Finding for planner:** the site's existing tier section (**$29/$79/$499**) links to `cloud.zenod.dev/buy`, which returns a **`cs_test_` TEST-mode** checkout — stale D-6 tiering, contradicts the €5 single-SKU (ZD-1). Needs Epic-0/planner reconciliation (a voice/product edit, out of "add a CTA" scope).
- **[worker/F-2] Dashboard enabled — GREEN.** `docker-compose.cloud.yml:32` already maps `OPENROUTER_PROVISIONING_KEY`; Jordi's env value + a fresh redeploy → **`GET /dashboard?session_id=…` = 200 rendering "Usage/balance"** (no more "OPENROUTER_PROVISIONING_KEY unset" banner). Customer path renders; operator view still needs `DASHBOARD_TOKEN` (not customer-facing).
- **[worker/F-3] Login/claim chain (ZD-11) — GREEN, deployed.** I3-1 IS in prod. Read-only, no charge: `success.html?session` 200 → `claim?session` 200 ("Claim your workspace") → `auth/github?session` **302 → github.com/login/oauth** (real client_id `Ov23lizBi8b1YuT7c3CN`, redirect `cloud.zenod.dev/auth/github/callback`, scope `read:user user:email`, state bound to the checkout session) → wizard/dashboard behind the same login. Every hop renders.
- **[worker/F-4] Seam sweep — GREEN.** `grep -rEi 'sk_live|rk_live|whsec|ghp_|sk-or-|dokploy|WATCHDOG_TOKEN|OPENROUTER|private_key|password' apps/site sites/zenod` → NO real secrets. Only: the ONE allowed public Payment Link; self-host doc placeholders (`ghp_…`, `sk-ant-…` in a copy-paste snippet); `App.tsx` doc text "Bearer <token from settings>"; privacy.html naming OpenRouter/Dokploy as sub-processors (intended public disclosure). Cloud-only logic stays in `zenod-ai/cloud`.

**CLICK-PATH (read-only, no payment):** zenod.dev 200 · LIVE €5 Payment Link 200 · success 200 · claim 200 · auth/github 302→GitHub · dashboard 200 — **all render.**

**Z-6 GO/NO-GO: GO** — the stranger front-to-back path renders end to end: pitch → working LIVE €5 Buy button → Stripe checkout → success → GitHub sign-in → wizard → dashboard. Caveats (non-blocking, flagged): (a) the F-1 site button goes live on #611's autodeploy (~1–2 min); (b) the stale $-tier/test-mode section needs Epic-0 reconciliation; (c) ZD-3 App repo-in-customer-account still gated on the zenod-t3 PEM (cycle-4 one-click, independent of sign-in).

**INCIDENT (mid-cycle, resolved):** Dokploy API went 401/down. Root cause: the separate **98G Hetzner Cloud Volume** holding Docker's data-root hit **100% full** → `dokploy-postgres` crash-looped (`No space left … postmaster.pid`) while the fleet kept serving. Jordi resized the volume to 150G; I `resize2fs /dev/sdb` (online, no data loss) + `docker image/builder/container prune` (no `--volumes`) → **148G, 87G free (39%)**, postgres 1/1, Dokploy API 200. Recorded in memory `dokploy-disk-full-recovery`; prevention = weekly image-prune cron (I2-8). SSH was used for incident triage only, at Jordi's explicit request — no manual deploys. Pen returns to Zenod-Fable.
