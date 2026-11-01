# tester-watch (EPIC-7 T6)

One read-only view of every EPIC-7 tester, run on VPS1. Spine: [EPIC-7](../../docs/EPIC-7-REAL-USER-TEST.md) row T6.

```
ssh hetzner_vps_1 tester-watch            # table
ssh hetzner_vps_1 tester-watch --json     # JSON, one object per tester
ssh hetzner_vps_1 tester-watch --check    # daily T10 hook: ALERT lines, exit 0 quiet / 1 alerts / 2 cannot read
ssh hetzner_vps_1 tester-watch --redact   # masks emails, ids, Google ids, codes (for evidence pages)
```

Install or update (root, from a checkout of `main` on VPS1): `sudo bash scripts/tester-watch/install.sh`.
It installs `/usr/local/lib/zenod-tester-watch/tester_watch.py` and the `/usr/local/bin/tester-watch` wrapper (re-runs itself with `sudo -n`).

## Who is a tester

T4's private ledger, `/home/t3agent/.local/state/zenod-testers/live-codes.tsv` (`scripts/stripe-testers.mjs issue <label>` appends `label code promotion_code created expires`). Override with `--testers FILE`, `TESTER_WATCH_TESTERS` or `ZENOD_TESTERS_LEDGER_DIR`. A row matches an account by promotion code (or its `promo_` id), account/tenant/user id or email. Codes not redeemed yet show as `not signed up` with the code's state. With no ledger, every live account with a tenant is shown (`--all` forces that; canceled accounts are left out).

## Columns and sources (all read-only)

| Column | Source |
|---|---|
| identity, signup | `zenod-mt-data/customer-identities.json` (Google subject + email), `customer-accounts.json` (checkout time, local status) |
| stripe, renews, next inv, discount, card | Stripe live: subscription (+ discounts, promotion code, customer), payment methods, `invoices/create_preview` (a preview, creates nothing). Key read from the running zenod-mt container, never printed |
| whatsapp | `zenod-phylax-adapter.sqlite` binding state; `phylax-data/phylax-tenant-settings.json` phone `verified`/`pending`/`none` (the number itself is never read out) |
| last Saved, 7d saves | Phylax `phylax-capture-jobs.sqlite` (done `store_memory`/`ingest_memory` with a Saved/Captured receipt); `all` = the T2.5 capture index, tenant `tasks.sqlite` (`store`, `media_ingest`, no selftest) |
| AI $ mtd | tenant `usage.sqlite`, the same sum as `runtime.ts monthToDateSpendUsd`; cap = `ZENOD_TENANT_MONTHLY_ALLOWANCE_USD` on zenod-mt, "no cap set" while unset (ask E7-A2) |
| units | Phylax `phylax_allowance_period_totals.used_units` for the binding's period, % of `ZENOD_PHYLAX_ALLOWANCE_UNITS` |
| errors | failed captures (tasks + Phylax), cap hits (AI-allowance receipts, paused Phylax paid work, `[llm.allowance.exceeded]` log lines), failed billing notices (zenod-mt log), first line of recent job errors with URLs removed |

## `--check` alerts (one line each, `ALERT <tester>: ...`)

- subscription `past_due` / `unpaid` / `canceled` (or the local account suspended/canceled)
- renewal within 5 days (`--renewal-days`) and the next invoice is not €0: apply the monthly extension (T2.1 / T4 `extend`)
- AI or Phylax usage at ≥ 80% (`--cap-pct`) of the cap
- failed captures, cap hits or failed billing notices in the last 24 h (`--window-hours`)
- a Stripe read failure (exit 2)
