# Runbook: extend a tester's free month (EPIC-7)

> **Since 2026-11-11 (EPIC-26 S5 round 3, Jordi's E26-A7 answer):** no free month is extended by itself and nobody
> extends every tester. Each tester gets one free month; six days before it ends, zenod-mt sets it to end and alerts the
> team (`[ops-alert] tester free_time_ending` with that tester's usage). Extending is the team's call, one tester and one
> month at a time: the **One more free month** button on [cloud.zenod.dev/admin/testers](https://cloud.zenod.dev/admin/testers#free-time).
> The steps below stay as the fallback; `stripe-testers.mjs extend` now marks what it extends so the job leaves it alone.

Who runs it: the EPIC-7 Delivery Manager, every month while the testers are testing (from [T10](../EPIC-7-REAL-USER-TEST.md)). Proof that it works: [T2.1 evidence](../evidence/epic7-t2-1-2026-11-01.md).

**Tool (T4):** `stripe-testers.mjs extend` does every step below for all testers, including recovering a lapse. See [epic7-tester-codes.md](epic7-tester-codes.md) §5. The manual commands below remain the fallback.

Jordi's rules: testers are never charged. Their free month is extended month by month while they test. Nobody is cut off without warning. There is no tester mode in code: a tester is an ordinary Zenod subscriber whose price happens to be €0.

## The one thing to know

Extend with a **`once` 100% coupon** (it makes the next renewal invoice €0, whenever it is applied). **Never re-apply the 1-month repeating checkout coupon.** Stripe treats re-applying the coupon that is already on the subscription as a no-op: the discount end does not move, so the next renewal bills €9 + VAT. The sandbox proved this ([same-coupon-reapply](../evidence/epic7-t2-1-sandbox/same-coupon-reapply.out.txt)).

## Setup (once, live; T4 owns it)

- Live coupon `ZENOD_TESTER_NEXT_MONTH_FREE`: `percent_off=100`, `duration=once`, no promotion code (it is never typed by a user; only the operator applies it through the API). Creating it is a live Stripe change, so it rides with T4's live-coupon ask.
- Keep the tester list (email → Stripe subscription id) in the EPIC-7 T10 row or a linked page. Never store keys there.

## Key handling

Run these on VPS1 (from VPS3: `ssh hetzner_vps_1`). The key never appears on screen:

```sh
K=$(sudo cat /etc/alpha9-secrets/zenod-mt/STRIPE_SECRET_KEY)   # live; for rehearsal use a sk_test_ key
S() { curl -sS -u "$K:" -H 'Stripe-Version: 2025-02-24.acacia' "$@"; }
```

## Every month, per tester

Do this any time after the tester's last renewal and at least one day before `current_period_end`. The safest moment is right after you verify the previous renewal (step 3), so each month is covered a whole period ahead.

1. Extend:
   ```sh
   S https://api.stripe.com/v1/subscriptions/$SUB -d 'discounts[0][coupon]=ZENOD_TESTER_NEXT_MONTH_FREE' -d proration_behavior=none \
     | python3 -c 'import json,sys;s=json.load(sys.stdin);print(s["status"],(s.get("discount") or {}).get("coupon",{}).get("id"),s["current_period_end"])'
   ```
   Expect `active ZENOD_TESTER_NEXT_MONTH_FREE <period end>`. Applying it twice in the same period is harmless (proven).
2. Check that the next invoice is €0:
   ```sh
   S "https://api.stripe.com/v1/invoices/upcoming?subscription=$SUB" | python3 -c 'import json,sys;i=json.load(sys.stdin);print(i["total"],i["currency"])'
   ```
   Expect `0 eur`.
3. The day after renewal, verify that the latest invoice is `0 paid` and the subscription is `active`, then go back to step 1 for the next month.

## Every wake: catch a lapse

```sh
S 'https://api.stripe.com/v1/subscriptions?status=past_due&limit=100' \
  | python3 -c 'import json,sys;[print(s["id"],s["metadata"].get("product"),s["latest_invoice"]) for s in json.load(sys.stdin)["data"]]'
```

If a tester's subscription is `past_due` (an extension was missed), recover it the same day. Stripe retries the card for about 13 days and then cancels (live 2026-08: finalized 08-05, canceled 08-19, reason `payment_failed`):

```sh
S https://api.stripe.com/v1/subscriptions/$SUB -d 'discounts[0][coupon]=ZENOD_TESTER_NEXT_MONTH_FREE' -d proration_behavior=none
S -X POST https://api.stripe.com/v1/invoices/$OPEN_INVOICE/void
```

The subscription goes back to `active`, and the next renewal is €0 (proven: [recover-once](../evidence/epic7-t2-1-sandbox/recover-once.json)). Zenod will already have sent the tester the "renewal could not be charged" WhatsApp notice. Tell them it is sorted.

If a tester added a card and paid, refund that invoice in full. That is the never-charged rule; record it in EPIC-7 Decisions.

## Ending a tester

Tell them first, in person or on WhatsApp. Then either stop extending (they get Zenod's past-due notice at renewal and the suspension notice about 13 days later, before access stops), or cancel at period end through the API. Zenod's notices are a backstop, not the announcement.

## What Zenod does on its own (code, PR #1447)

- Renewal fails, so the subscription is `past_due`: the tenant stays active, and the user gets one WhatsApp (else Telegram) notice that the renewal could not be charged, with the console link.
- Stripe cancels or marks it unpaid: the user gets one notice that the subscription ended, sent **before** the tenant and the Phylax binding are suspended.
- The notices need the Phylax build that has `phylax_management_v1_account_notice` deployed. Until then the call fails, is logged, and nothing else changes.
