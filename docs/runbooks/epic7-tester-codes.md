# Runbook: tester codes in live Stripe (EPIC-7 T4, T2.2, T10)

Who runs it: the EPIC-7 agent, on VPS1. **Run the live steps only once Jordi has approved ask E7-A6** in [EPIC-7](../EPIC-7-REAL-USER-TEST.md); cite `under E7-A6` in Decisions. Tool: [`scripts/stripe-testers.mjs`](../../scripts/stripe-testers.mjs) (PR #1451). Sandbox proof: [T4 evidence](../evidence/epic7-t4-2026-11-01.md). Live run of §1–§3 (2026-11-01): [T4 live evidence](../evidence/epic7-t4-live-2026-11-01.md). Why a `once` coupon each month: [T2.1](../evidence/epic7-t2-1-2026-11-01.md) and [monthly extension](epic7-tester-monthly-extension.md).

Rules: testers are ordinary Zenod subscribers at €0 and are never charged. One code per person, single use. Unused codes stop working after 14 days. The list of who got which code lives only in the private ledger on VPS1, `/root/.local/state/zenod-testers/live-codes.tsv` (mode 0600). **Never put a code, a tester's name or the ledger into GitHub, a spine, chat or a log.** Never print the key.

## 0. Install (once, on VPS1)

```sh
ssh hetzner_vps_1
SHA=3bb34dc06aa16bb7ad44c9eb40fb0b8330cdf518   # PR #1451 merge, or a later main
mkdir -p /root/zenod-testers
curl -fsSL "https://raw.githubusercontent.com/zenod-ai/zenod/$SHA/scripts/stripe-testers.mjs" -o /root/zenod-testers/stripe-testers.mjs
LIVE=acct_1TpJpc80yG7aohEW   # live Zenod Stripe account; the tool checks the key really belongs to it
T() { node /root/zenod-testers/stripe-testers.mjs "$@" --key-file /etc/alpha9-secrets/zenod-mt/STRIPE_SECRET_KEY; }
T status   # read-only; prints the LIVE banner; expect no rows before setup
```

Every write below carries `--confirm-live $LIVE`. Without it, the tool refuses after one read-only `GET /v1/account`. Sandbox rehearsal: same commands, with `--key-file /etc/alpha9-secrets/phylax/STRIPE_SECRET_KEY` and no `--confirm-live`.

## 1. T4 setup: create the two coupons (once)

```sh
T setup --confirm-live $LIVE
```

Expect:
- `coupon=ZENOD_TESTER_1M name=Zenod tester duration=repeating created=true`
- `coupon=ZENOD_TESTER_NEXT_MONTH_FREE ... duration=once created=true`

Running it again prints `created=false` (idempotent). If a coupon with that id exists on other terms, the tool stops; fix it by hand in the Dashboard.

## 2. T2.2: retire the open free-forever code

The live code `promo_1UFvFG80yG7aohEWCFeuHJId` (coupon `ZENOD_FREEFLOW_100_FOREVER`, unlimited, no expiry) was redeemed 2 times when read on 2026-11-01.

```sh
T retire-code promo_1UFvFG80yG7aohEWCFeuHJId --confirm-live $LIVE
```

Expect `coupon=ZENOD_FREEFLOW_100_FOREVER times_redeemed=2 was_active=true active=false`. Deactivating the code does **not** touch the coupon or the 2 subscriptions that already use it. The sandbox replica proved this: the subscription stayed active, its next renewal was €0, and a new checkout with the code failed with "This promotion code is inactive." Check the 2 subscriptions, read-only:

```sh
cd /root/zenod-testers && node --input-type=module -e '
import { readFileSync } from "node:fs"; import { makeStripe } from "./stripe-testers.mjs";
const S = makeStripe(readFileSync("/etc/alpha9-secrets/zenod-mt/STRIPE_SECRET_KEY", "utf8").trim());
const subs = (await S("GET", "subscriptions", { status: "all", limit: 100, "expand[]": ["data.discounts"] })).data;
for (const s of subs.filter((s) => (s.discounts || []).some((d) => d.coupon?.id === "ZENOD_FREEFLOW_100_FOREVER")))
  console.log(s.id, s.status, (await S("GET", "invoices/upcoming", { subscription: s.id })).total);'
```

Expect 2 lines, `active 0`. Do **not** delete the coupon `ZENOD_FREEFLOW_100_FOREVER`: deleting a coupon also leaves existing discounts in place, but there is no reason to. Rollback: `S("POST", "promotion_codes/promo_1UFvFG80yG7aohEWCFeuHJId", { active: "true" })` with the same snippet.

## 3. Issue one code per tester (T7/T8)

```sh
T issue "<tester label, e.g. first name + initial>" --confirm-live $LIVE
```

The tool prints `code=ZT-XXXXXXXX ... expires=<+14 d>` and appends a row to `/root/.local/state/zenod-testers/live-codes.tsv` (stderr shows the path and `600`). Send the code to the tester privately, using the T5 wording. A second code for the same label needs `--force`; retire the first one (step 6). The tester enters the code at the normal Zenod checkout (`allow_promotion_codes` + `payment_method_collection: if_required`). Total due is €0 and no payment method is asked for.

## 4. Watch (every wake)

```sh
T status
```

For each tester: `code_state` (`open`, `used`, `expired` or `retired`), `redeemed`, `sub_status`, `next_renewal`, `next_invoice` (in cents) and `card_on_file`. A row labelled `(not in ledger)` is a tester subscription with no ledger entry; find out who it is. `card_on_file=yes` means the tester added a card. Under the never-charged rule, any non-zero paid invoice is refunded in full and recorded in Decisions.

## 5. T10: monthly extension (run at every wake, at least daily while testers are live)

```sh
T extend                                   # dry run, renewals within 7 days
T extend --apply --confirm-live $LIVE      # only if the dry run shows "would ..."
```

- `would extend`: the next renewal is not €0 yet. `--apply` puts `ZENOD_TESTER_NEXT_MONTH_FREE` on the subscription (`proration_behavior=none`), then re-reads the upcoming invoice. Expect `action=extended next_invoice_after=0`.
- `would extend + void in_... (900)`: the tester is `past_due` (an extension was missed). `--apply` extends and voids the open renewal invoice. Expect `status_after=active`. Stripe would otherwise retry for about 13 days and then cancel; Zenod has already sent its past-due notice, so tell the tester it is sorted.
- `skip: next invoice already €0` / `skip: not due`: nothing to do. Running `--apply` twice is harmless.
- `--apply` also tags each tester subscription with `zenod_tester=1` metadata. After month 1 the discount is used up, so the tag is how the tool finds them; it is written the first time `--apply` runs.
- Anything that says `NOT €0: check by hand` is stopped on, and fixed using [monthly extension](epic7-tester-monthly-extension.md).

The day after each renewal, `T status` should show `next_invoice=900` again (the `once` coupon has been used up). The next `extend` within 7 days covers it.

## 6. Retire an unused or leaked code

```sh
T retire-code ZT-XXXXXXXX --confirm-live $LIVE
```

Unused codes stop working on their own after 14 days (`code_state=expired`). Retire one early if it went to the wrong person.

## Ending a tester or the test

Tell the tester first, then stop extending them. Remove their row from the private ledger only after the test ends.

## Rollback (all of T4)

Deactivate the tester codes (`retire-code`) and stop running `extend`. The coupons can stay; they do nothing without a code or an operator call. Re-enable the free-forever code as in step 2. Subscriptions already on €0 keep their current discount until it runs out. Then they get Zenod's past-due notice, as for any ordinary user.
