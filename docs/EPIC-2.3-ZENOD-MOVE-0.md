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

Status 2026-07-05 (Zenod-Fable): ZD-1 DECIDED. ZD-2/3/5/6 framed below and put to Jordi —
they gate the SHAPE of Z-2/Z-3-checkout/Z-4 but do NOT gate the immediate starts
(Z-1, Z-3-page, Z-5-runbook). ZD-4 carries a standing recommendation; silence = adopt.

- **ZD-1 · Price — DECIDED 2026-07-05 (Jordi): hosted €5/month.** Move 0 ships ONE simple SKU.
  (Jordi carries the number to Product-Fable so D-6 tiering stays coherent.) Consequence: at €5,
  LLM spend cannot be bundled uncapped — forces ZD-5.

- **ZD-2 · Provisioning mode at launch — AWAITING JORDI.**
  (a) **Automated behind the Stripe webhook** — already proven ~1–2 min (Epic 2, I1-4); customer
  #1 experiences the real funnel; the tester's stranger-run needs it anyway. **Recommended.**
  (b) Concierge-manual (H-2 allows it) — buys nothing since automation is proven; would
  invalidate Z-3's "provisioning fires without human touch" test.
  Gates: Z-3 checkout wiring, Z-2 trigger path.

- **ZD-3 · Repo residency — AWAITING JORDI.**
  (a) **Customer's own GitHub account via GitHub App** (auth per
  GITHUB-AUTH-DEFINITIVE-RUNBOOK.md) — it IS the ownership story ("your repo, your memory, leave
  anytime"); no transfer machinery, ever. **Recommended, day one.**
  (b) Hosted-org repo + transfer-on-exit — weaker story, extra machinery, deferred liability.
  Gates: Z-2 provisioning script + the wizard's "connect GitHub" step.

- **ZD-5 · LLM key model at €5 — AWAITING JORDI.**
  (a) **BYO OpenRouter key** — user pastes their key in the wizard; €5 covers hosting only; we
  meter from the per-call ledger and display calls · tokens · cost; zero billing machinery beyond
  the Stripe sub; bounded liability; "monitor my usage as user 1" works identically.
  Key-exhausted = loud error + dashboard notice (their balance, not ours). **Recommended for
  Move 0.** (b) Bundled prepaid credits (Epic-2 D-5 machinery, gateway balance as truth) —
  fast-follow once BYO proves demand, or for users who won't get a key.
  Gates: Z-4 dashboard scope (usage-only vs balance + top-up), the wizard's key step.

- **ZD-6 · Tenancy at €5 — AWAITING JORDI.**
  (a) **Instance-per-user, fully automated** — law-7-consistent; reuses the proven provisioning;
  watchdog per instance; fine to ~100 users on current infra. **Recommended for Move 0.**
  (b) Multi-tenant Zenod service — better unit economics at scale; designated the FIRST
  sanctioned law-7 exception, triggered by ops load, not speculation. Either way the setup UI is
  built so the switch would be invisible to users.
  Gates: Z-2 provisioning target, Z-5 watchdog registration shape.

- **ZD-4 · Dashboard scope v0: usage only** — calls · tokens · cost (+ balance/top-up link only
  if ZD-5b). No analytics, no memory browser. Recommendation stands, ruthlessly; adopted unless
  Jordi objects before Z-4 starts.

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

### Z-2 · Provision + setup UI — OPEN · blocked by Z-1 · shaped by ZD-2/3/6

Deliverable: one provisioning script + the hosted setup wizard + self-host terminal quickstart.

Acceptance:
- [ ] Script provisions per ZD-6: container + customer repo per ZD-3 + minted MCP token; emits
      receipts (container ID, repo URL, token ID); idempotent on retry; fires per ZD-2.
- [ ] Wizard (admin surface): connect/scaffold GitHub repo → LLM key step per ZD-5 → token issued
      → "paste this into Claude" block → done screen. Health + token management pages exist.
      No chat UI anywhere.
- [ ] Self-host: terminal quickstart in public docs reaches the same end state (endpoint + repo +
      token → Claude config) with no UI.

Test criteria: tester provisions a fresh user end-to-end via the WIZARD, timed, <30 min bar;
separately completes self-host from docs alone on a clean VM; Claude round-trip with commit-SHA
receipt on BOTH paths.

### Z-3 · Website + checkout LIVE — OPEN · page starts NOW; checkout wiring needs ZD-2 + Z-2 target

Deliverable: public Zenod website — pitch, both paths, LIVE €5/mo checkout, legal minimum.

Acceptance:
- [ ] Page live: "your personal wiki brain" pitch; self-host path (docs) AND hosted path visible;
      "vault browser is Obsidian/GitHub" stated as a feature. Copy ships as functional DRAFT
      flagged `[DRAFT — Epic 0 voice pending]`; final voice lands via Jordi (Epic 0 owns it).
- [ ] Stripe LIVE SKU €5/month; checkout → webhook → Z-2 provisioning fires per ZD-2.
- [ ] Minimal ToS/privacy linked (Epic-2 H-11 minimum).

Test criteria: a real card completes €5 checkout in prod; subscription visible in Stripe;
provisioning fires without human touch; self-host instructions pass a cold read by a stranger.

### Z-4 · Meter + dashboard — OPEN · blocked by Z-2 · shaped by ZD-5 (scope per ZD-4: usage only)

Deliverable: per-tenant metering wired at provision; usage page on the admin surface.

Acceptance:
- [ ] Per-tenant key wired at provision (BYO key stored in standalone keyring if ZD-5a;
      per-tenant gateway key if ZD-5b).
- [ ] Usage page shows calls · tokens · cost from the per-call ledger (usage.sqlite /
      read_llm_timeline), reconciling with the source of truth (gateway balance if ZD-5b).
- [ ] Exhaustion behavior: ZD-5a → key-dead is a loud, attributable error + dashboard notice;
      ZD-5b → D-5 behaviors: warn at threshold, polite block at zero, top-up restores.

Test criteria: tester burns a known amount via scripted `ask` calls; dashboard matches
ledger/gateway (exact call count; tokens/cost within provider-reported values); exhaustion +
recovery receipted end to end.

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

## APPEND ZONE (dated, role-tagged, append-only — receipts or it didn't happen)

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
