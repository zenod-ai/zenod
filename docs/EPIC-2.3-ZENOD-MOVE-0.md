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
framed options; ZD-7/ZD-8 called post-handback). Do not relitigate without new evidence.

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
checked ONLY with a same-line receipt (URL/SHA/ID). **States as of 2026-07-05 post-cycle-1
audit:** static/authoring work receipted green (worker entries + planner audit, APPEND ZONE);
every runtime/LIVE/infra item BLOCKED-on-environment → cycle 2 (Block C).

### Z-1 · Standalone GA (absorbs 2.5's W-C) — GREEN-static · runtime BLOCKED-env → cycle 2

Deliverable: `units/zenod/` builds and deploys as ONE container exposing ONE MCP endpoint,
SEAM-SPEC-conformant, with a stranger-grade README/quickstart.

Acceptance:
- [ ] Image builds + deploys via the SANCTIONED production path — Dokploy API (per Jordi
      2026-07-05: test on the production path, never local Docker); the deployed instance serves
      `tools/list`/`tools/call` over streamable HTTPS at `/mcp`. (Local `docker build` from
      `units/zenod/` remains the SELF-HOST story only — proven by the tester's clean-VM run.)
      **BLOCKED-env cycles 1–2 → cycle 2 retry via Dokploy.**
- [x] *(static)* SEAM-SPEC v1 checklist passes item-by-item, spec UNEDITED — 16/16 scored with
      file:line evidence, audited by planner. Receipt: [worker/Z-1] APPEND entry + `4610fb9`.
      Live transcripts ride the docker item above.
- [x] Public-seam-only: repo token read in exactly ONE place (`runtime.ts:296-299`, planner
      re-verified 2026-07-05); no non-MCP write path on the public surface.
- [x] README/quickstart stranger-grade: tokenless-claim trap found + fixed (`GET /api/token`
      step, README:67 + SEAM-SURFACE:9). Receipts: `4610fb9` + PR #600 (`a86bd8b`).
      (Voice pass = Epic 0 via Jordi; content correctness done here.)

Test criteria (tester, fresh evidence): an EXTERNAL plain-MCP client (not our code) completes
store → search → get on a FRESH instance using ONLY the README; commit-SHA + GitHub-URL receipts
verified in the vault repo; a deliberate non-seam write attempt fails loudly; SEAM-SPEC scored
line-by-line. Passing this ALSO satisfies 2.5's RD-4 split-trigger evidence and Epic 0's SD-6 gate.

### Z-2 · Provision + setup UI — OPEN · blocked by Z-1 runtime · standalone path COMMISSIONED 2026-07-05

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

### Z-3 · Website + checkout LIVE — page GREEN-draft · checkout BLOCKED-credentials → cycle 2

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

### Z-4 · Meter + dashboard — OPEN · blocked by Z-2 · ZD-5 decided: bundled prepaid credits

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

### Z-5 · Watchdog + ops — authored GREEN · live drills BLOCKED-infra → cycle 2 / tester

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

### PRE-FLIGHT (Jordi, in the dispatch terminal) — Block C may be pasted ONLY on `PREFLIGHT PASS`

Added 2026-07-05 after two dispatches burned on missing environment: the prose gate is now
executable. Run this; every ❌ line names its own fix; re-run until PASS.

```bash
echo "— Epic 2.3 cycle-2 preflight (SELF-SOURCING; production path) —"; ok=1
# 1 · Dokploy — key auto-sourced: env → ~/.dokploy_api_key → Keychain. Never pasted by hand.
DKEY="${DOKPLOY_API_KEY:-$(cat "$HOME/.dokploy_api_key" 2>/dev/null)}"
DKEY="${DKEY:-$(security find-generic-password -s DOKPLOY_API_KEY -w 2>/dev/null)}"
DKEY="${DKEY:-$(security find-generic-password -s dokploy -w 2>/dev/null)}"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -H "x-api-key: $DKEY" \
  "${DOKPLOY_URL:-https://dokploy.polyqu.com}/api/project.all")
if [ "$code" = 200 ]; then echo "1 Dokploy               ✅ project.all → 200"
else echo "1 Dokploy               ❌ HTTP ${code:-none} (000=URL/network · 401/403=key rejected · empty key = not found in env/~/.dokploy_api_key/Keychain)"; ok=0; fi
# 2 · zenod-ai/cloud — auto-clones if missing
[ -d "$HOME/Documents/GitHub/cloud/.git" ] || gh repo clone zenod-ai/cloud "$HOME/Documents/GitHub/cloud" >/dev/null 2>&1
[ -d "$HOME/Documents/GitHub/cloud/.git" ] && echo "2 zenod-ai/cloud        ✅ checked out" \
  || { echo "2 zenod-ai/cloud        ❌ auto-clone failed — check gh auth status"; ok=0; }
# 3 · LIVE Stripe key — env → ~/.stripe_live_key → Keychain (restricted rk_live_ accepted)
SKEY="${STRIPE_SECRET_KEY:-$(cat "$HOME/.stripe_live_key" 2>/dev/null)}"
SKEY="${SKEY:-$(security find-generic-password -s STRIPE_LIVE_KEY -w 2>/dev/null)}"
case "$SKEY" in sk_live_*|rk_live_*) echo "3 LIVE Stripe key       ✅";; \
  *) echo "3 LIVE Stripe key       ❌ store it ONCE: security add-generic-password -s STRIPE_LIVE_KEY -a stripe -w 'rk_live_…'"; ok=0;; esac
[ $ok = 1 ] && { export DOKPLOY_API_KEY="$DKEY" STRIPE_SECRET_KEY="$SKEY"; \
  echo "PREFLIGHT PASS — keys exported into THIS shell; paste Block C here"; } \
  || echo "PREFLIGHT FAIL — fix ❌ lines, run again"
```

### Block C · WORKER cycle 2 — paste ONLY after PREFLIGHT PASS (Dokploy deploy path · `zenod-ai/cloud` checkout · LIVE Stripe key — production path, no local Docker)

```
You are the Zenod Move-0 WORKER, cycle 2. Mission doc: docs/EPIC-2.3-ZENOD-MOVE-0.md in
zenod-ai/zenod — read it top to bottom; tickets Z-1..Z-5 as updated 2026-07-05 bind you,
including the v0 surface spec (Zenod is purely an MCP server; self-host = terminal + your
chat client, NO UI; cloud handoff = ONE tokened URL per ZD-8; the cloud UI is a separate
multi-product surface in zenod-ai/cloud with optional OAuth buttons). You hold the pen on
the APPEND ZONE only; planner sections are read-only.

ENVIRONMENT PRECONDITIONS — verify FIRST, one receipt each; any missing → write BLOCKED,
stop that lane, spend nothing on it: (1) Dokploy API alive (DOKPLOY_API_KEY;
project.all → 200 — the sanctioned automated deploy path, no manual VPS ops, no local
Docker); (2) zenod-ai/cloud checkout present; (3) LIVE Stripe key. Cycles 1–2 died on
missing environment — do not zombie into it.

GIT DISCIPLINE (cycle-1 collision on a shared branch, receipted): fresh branch off latest
origin/main named epic23-c2-<lane>; never reuse a shared branch; push early; if the tree
shifts under you, re-fetch and verify your commits landed (git branch -r --contains <sha>).

LANES, dependency order — fan out where parallel:
- Z-1 runtime — ON THE PRODUCTION PATH, not local (Jordi, 2026-07-05): deploy a fresh
  instance via the Dokploy API (per units/PROVISIONING-RUNBOOK.md; Dokploy's build IS the
  build receipt); then against the deployed HTTPS /mcp: live tools/list transcript;
  401-without-bearer transcript; forced-error transcript; external plain-MCP client
  completes store/search/get from the README alone. Local docker build is NOT required —
  the self-host story is proven by the tester's clean-VM run, never the worker's laptop.
  Closes Z-1.
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

### 2026-07-05 · [planner/Zenod-Fable] Preflight made SELF-SOURCING (Jordi: "I'm giving you that key every few hours")
- A VALID Dokploy key failed check 1 because the gate only read `$DOKPLOY_API_KEY` from the
  shell while the key lives in `~/.dokploy_api_key`/Keychain — the gate demanded hand-feeding.
  Rewritten: keys auto-sourced (env → file → Keychain), probe prints the real HTTP code
  (401 ≠ missing ≠ network), `zenod-ai/cloud` auto-clones, and on PASS the keys are exported
  into the dispatch shell so the Block-C worker inherits them. Nobody pastes keys again.
- Rule-6 fold: a gate that needs hand-fed secrets fails exactly when attention is lowest —
  gates must source their own inputs from the sanctioned stores (I2-7).

### 2026-07-05 · [planner/Zenod-Fable] Course correction (Jordi): test on the PRODUCTION path — local Docker dropped from the gate
- Jordi: "why local Docker? why not test closest to production?" — right. The sanctioned deploy
  path is the Dokploy API (manual VPS ops forbidden) and the exit criterion is PRODUCTION
  instances; local `docker build` was cycle-1's environment assumption promoted into the gate
  uncritically. Unforced planner error, reversed: Z-1 runtime evidence = deploy a fresh instance
  via Dokploy + transcripts against the deployed HTTPS `/mcp`; Dokploy's build IS the build
  receipt. Local Docker survives only where it belongs — the self-host stranger test on the
  tester's clean VM (Z-2 test criteria, unchanged).
- PRE-FLIGHT reduced to 3 checks (Dokploy alive · `zenod-ai/cloud` checkout · LIVE Stripe key);
  Block C preconditions + Z-1 lane + Z-1 acceptance rewritten to the production path. Rule-6
  fold: if the gate demands something production doesn't, the gate is wrong.

### 2026-07-05 · [planner/Zenod-Fable] Correction: deploy-path var name (vault memory + Epic-2 receipts)
- PRE-FLIGHT check 2 used an invented name (`DOKPLOY_TOKEN`). Canonical per Epic-2 I2-7
  (`EPIC-2-HOSTED-READINESS.md:794`): **`DOKPLOY_API_KEY`** — operator store is the Keychain,
  read commands in `zenod-ai/cloud` docs/PROVISIONING.md; **B-6 CLOSED 2026-07-04** with the key
  verified live (`project.all` → 200). Dokploy URL: `dokploy.polyqu.com` (vault:
  `Notes/Alpha9 Dokploy VPS.md`). Check 2 rewritten: correct name (legacy fallback), URL
  default, and a FUNCTIONAL probe — a present-but-dead key (401) fails the gate (B-6 lesson).
  Block C precondition (2) reworded to match.

### 2026-07-05 · [planner/Zenod-Fable] Cycle-2 audit PASSED (honest-BLOCKED) · executable PRE-FLIGHT gate added
- **Audit of HANDBACK-c2: verified.** PR #602 (`6559e03`, auto-merge pending) sits on the correct
  base (`02d832c`); all four precondition verdicts carry receipts; worker spent nothing on blocked
  lanes and attempted no forbidden VPS/Stripe workarounds. Correct execution of Block C's gate —
  no reds to map. Z-1..Z-5 unchanged from post-cycle-1 states.
- **THE blocker is the dispatch environment, Jordi-personal to provision:** Docker Desktop up ·
  `DOKPLOY_URL`/`DOKPLOY_TOKEN` (the sanctioned automated deploy path; manual VPS ops stay
  forbidden) · `zenod-ai/cloud` cloned · LIVE Stripe key in env.
- **Rule-6 fold:** a prose entry gate was skipped on two consecutive dispatches → gate is now
  EXECUTABLE (PRE-FLIGHT script above Block C). Dispatch rule from here: Block C is pasted only
  after `PREFLIGHT PASS` in the same terminal. A third gateless dispatch is prevented, not
  requested.

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
