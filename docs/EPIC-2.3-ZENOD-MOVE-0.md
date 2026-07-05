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

## What this product is (settled — do not relitigate)

Zenod standalone = **one MCP server, one container, the customer's git repo behind it.**
- Access is the public seam only (pure MCP + receipt profile per SEAM-SPEC). Claude/Cursor/any
  client is the brain; Zenod never gets a chat UI.
- Its human surface is a **thin admin page**: connect repo · issue/revoke MCP tokens · health ·
  usage dashboard. The vault browser is Obsidian/GitHub — that's a feature, say it on the page.
- Standalone keyring: local credential store (the locked connections design's standalone mode).
- LLM spend (digest + ask) flows through a **per-tenant OpenRouter/gateway key** — D-5 as decided:
  prepaid credits, gateway balance is truth, soft-warn at threshold, new work blocks politely at
  zero (in-flight lands), top-up restores.

## ZD decisions — planner frames, Jordi calls

- **ZD-1 · The price.** One simple price for Move 0 vs Product-Fable's D-6 tiers. Number is
  Product-Fable's lane — Jordi carries; this epic needs ONE live SKU to ship.
- **ZD-2 · Provisioning mode at launch:** automated behind the Stripe webhook (proven ~1–2 min)
  vs concierge-manual (H-2 allows it). Recommendation: automated — it's already proven, and
  customer #1 should experience the real funnel.
- **ZD-3 · Repo residency:** customer's own GitHub account via GitHub App (recommended — it IS
  the ownership story; auth path per GITHUB-AUTH-DEFINITIVE-RUNBOOK.md) vs hosted-org repo with
  transfer-on-exit. Recommendation: customer's account, day one.
- **ZD-4 · Dashboard scope v0:** usage only (calls, tokens, cost, balance, top-up link). No
  analytics, no memory browser. Recommendation: yes, ruthlessly.

## Iteration 0 — lanes (parallel; sub-agents mandatory)

| ID | Lane | Deliverable + acceptance | Test criteria (tester, fresh evidence) |
|---|---|---|---|
| **Z-1** | Standalone GA (absorbs 2.5's W-C) | `units/zenod/` builds + deploys as one container; public-seam-only verified; stranger-grade README/quickstart (endpoint + repo + token → Claude config) | external plain-MCP client completes store/search/get on a FRESH instance using ONLY the README; any non-seam write path fails loudly |
| **Z-2** | Provision + onboarding | script: container + repo (per ZD-3) + MCP token, emits receipts (container ID, repo URL, token ID); onboarding page: connect GitHub → get token → "paste into Claude" block | tester provisions a fresh user end-to-end from the runbook, timed <30 min; Claude round-trip with commit-SHA receipt |
| **Z-3** | Checkout LIVE | Stripe live-mode SKU (ZD-1) → webhook → Z-2 provisioning; minimal ToS/privacy pages linked (Epic-2 H-11 minimum); Zenod one-pager (copy from Epic 0) | real card completes checkout in prod; subscription visible in Stripe; provisioning fires without human touch (per ZD-2) |
| **Z-4** | Meter + dashboard | per-tenant gateway key wired at provision; usage page on the admin surface: calls · tokens · cost · balance (source: per-call ledger + gateway balance, reconciling); D-5 behaviors: warn at threshold, polite block at zero, top-up restores | tester burns a known amount via scripted `ask` calls; dashboard matches gateway within tolerance; zero-credit block + top-up + resume all receipted |
| **Z-5** | Watchdog + ops | instance-set registered with fleet watchdog at provision (law `3b4da80`); restore-from-repo runbook (the vault IS the backup — prove it) | forced crash-loop on a fresh tenant → operator alert; restore drill: new container + existing repo = memory intact |
| **Z-6** | Customer #1 run | Jordi executes the funnel personally, LIVE card, his Claude, his repo | scored ✅/❌ against the exit criterion, receipts inline (Stripe ID, container ID, commit SHAs, dashboard screenshot) |

Sequencing: Z-1 ∥ Z-3-page ∥ Z-5-runbook immediately; Z-2 needs Z-1; Z-4 needs Z-2; Z-6 last;
tester's stranger-run closes the epic.

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

### 2026-07-05 · [scribe/Story-Fable] Doc created
- Materializes Jordi's Move-0 ask (this morning) on top of: `units/zenod/` scaffold + clean
  cross-import scan (2.5 worker, `629adb2`) · Stripe checkout TEST-live + tenant provision proven
  ~1–2 min + $50 gateway-key pattern (Epic 2, I1-4 CLOSED) · per-call usage ledger
  (usage.sqlite / read_llm_timeline). Pen hands to Zenod-Fable on bootstrap.
