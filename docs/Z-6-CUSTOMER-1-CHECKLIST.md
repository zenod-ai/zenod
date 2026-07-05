# Z-6 · Customer #1 run — one-page checklist (Jordi, in person)

Owner of the RUN: **Jordi** (not the worker). Parent: [EPIC-2.3-ZENOD-MOVE-0.md](EPIC-2.3-ZENOD-MOVE-0.md).
Worker's obligation is to leave Z-1..Z-5 green-or-blocked-honest and this checklist ready — it does
NOT assert Z-6 is executable today. See the worker HANDBACK entry in the epic's APPEND ZONE for the
lanes that are BLOCKED and therefore gate this run.

This is the EXIT CRITERION turned into a do-list. Jordi runs it once, in person, with a real card in
LIVE mode, against **his own** Claude and **his own** repo. Each step names the exact receipt to
paste back into the epic's APPEND ZONE (tag `[Z-6/jordi]`).

## Preconditions (must ALL be green before starting — worker verifies in HANDBACK)

- [ ] **Z-1** standalone Zenod serves `/mcp` in production (SEAM-SPEC-conformant). Receipt: live URL + `tools/list`.
- [ ] **Z-2** standalone provisioning fires from the Stripe webhook: one box + repo (customer's GitHub via GitHub App) + MCP token + per-tenant gateway key. Receipt: provisioning script + a dry provision.
- [ ] **Z-3** LIVE €5/mo Stripe SKU + public site with checkout button wired to the webhook target.
- [ ] **Z-4** per-tenant meter + logged-in usage dashboard (calls · tokens · cost · balance · top-up).
- [ ] **Z-5** watchdog auto-registers the new instance; restore-from-repo runbook exists.
- [ ] **ZD-7** starter-credit number is SET as the config value (Z-6 cannot RUN until it is — do not invent it).

## The run (Jordi) — each line ends in a receipt

1. **Sign up + pay.** From the public site → hosted €5/month → real card, **LIVE mode**, complete checkout.
   Receipt: Stripe **subscription ID** + the LIVE charge.
2. **Provisioning fires (no human touch).** The webhook triggers Z-2; wait ~1–2 min.
   Receipt: **container ID** + **repo URL** (in *your* GitHub account, created via the GitHub App) + **MCP token ID** + **gateway key ID**.
3. **Wizard.** Log into the setup UI → connect/scaffold the GitHub repo → token issued → copy the "paste this into Claude" block. (No LLM-key step — the gateway key is minted at provision.)
   Receipt: the paste block (endpoint + token, token value redacted) + timing of the wizard leg (<30 min bar).
4. **Point YOUR Claude at it.** Paste the MCP config into your own Claude; run `tools/list`.
   Receipt: the tool list from your Claude session (screenshot/transcript).
5. **Store / search / ask against production.** `store_memory` a real fact → poll → get the commit; `search_memory` finds it; `ask_brain` answers with citations.
   Receipt: the **commit SHA(s)** + **GitHub URL(s)** from *your* Claude session, opened in *your* repo.
6. **Dashboard shows YOUR consumption.** Log into the dashboard.
   Receipt: **screenshot** of calls · tokens · cost · balance, reconciling with the gateway balance (D-5: gateway is truth).
7. **Watchdog registration.** Confirm the new instance is in the fleet watchdog.
   Receipt: the **watchdog registration entry** (name + timestamp).

## Done = the exit criterion, receipted

All seven receipts pasted into the APPEND ZONE under `[Z-6/jordi]`. Then the epic hands to the
TESTER (Dispatch block B), who scores ✅/❌ against the exit criterion and repeats the ENTIRE funnel
as a stranger using only the public pages — that stranger-run closes the epic.

## Note on topology (worker, 2026-07-05)

The existing [../units/PROVISIONING-RUNBOOK.md](../units/PROVISIONING-RUNBOOK.md) provisions the FULL
suite (console + council + phylax + channel, 6 containers, a chat UI). Epic 2.3 forbids ring/council/
channel and any chat UI, and Z-1 is a **standalone single Zenod box**. So Z-6 depends on Z-2 building
a NEW, thinner standalone-provisioning path (one Zenod container, own repo via GitHub App, MCP token,
gateway key) — it does NOT reuse the full-suite tenant stack unchanged. This is flagged for the
planner in the HANDBACK.

## Final funnel shape (cycle 3, 2026-07-05)

The topology gap above is RESOLVED — the thin standalone path is built and proven. The final funnel:
**LIVE €5/mo checkout (Stripe Payment Link)** → **webhook → T8 auto-provision** (`provision-standalone.mjs`,
enable with `ZENOD_AUTO_PROVISION=1`) → **cloud wizard** (GitHub App connect, ZD-3) → **done screen = ONE
tokened MCP URL** (ZD-8, "treat like a password") → paste into your Claude → **usage dashboard**
(calls·tokens·cost·balance, gateway-truth) → registered with the **cloud-fed watchdog** (ZD-10).
Self-host skips all UI: set `ZENOD_API_TOKEN` (ZD-9) + `VAULT_REPO`/`GITHUB_TOKEN`/LLM key, done.
Before running Z-6, apply the three config asks in the cycle-3 HANDBACK (GitHub App creds · `WATCHDOG_TOKEN`
· `ZENOD_AUTO_PROVISION`). Step receipts 1–7 above are unchanged.
