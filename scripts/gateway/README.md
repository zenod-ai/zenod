# LLM gateway (the meter) — P0.4

Per-tenant metering + budget enforcement for hosted Zenod. See
[`docs/HOSTED-PLAN-2026-07-02.md`](../../docs/HOSTED-PLAN-2026-07-02.md) (P0.4, epic #448).

## v0: OpenRouter provisioned keys (zero-ops)

Each tenant gets **one OpenRouter provisioned key with a hard credit limit**.
OpenRouter meters spend and stops honoring the key at the cap, so **enforcement
lives outside the tenant container** — a buggy or hacked tenant can't overspend;
the key just 402s. The engine needs **no change**: the tenant runs
`provider=openrouter` with its per-tenant key, which already routes to
`https://openrouter.ai/api/v1`.

### Setup
1. Create a **provisioning key** (not an inference key) at
   <https://openrouter.ai/settings/provisioning-keys>.
2. `export OPENROUTER_PROVISIONING_KEY=sk-or-v1-...`

### Per-tenant lifecycle
```sh
# Mint (prints the key ONCE — paste into the tenant Console's OpenRouter key):
node scripts/gateway/openrouter-key.mjs mint --tenant acme --limit 50

# See every tenant's spend vs cap:
node scripts/gateway/openrouter-key.mjs list

# Top up / suspend / resume (by hash from `list`):
node scripts/gateway/openrouter-key.mjs topup   --hash <hash> --limit 100
node scripts/gateway/openrouter-key.mjs disable  --hash <hash>   # suspend on non-payment
node scripts/gateway/openrouter-key.mjs enable   --hash <hash>
```

`--limit` is the credit cap in USD. Keys are named `zenod-tenant:<name>` so the
tool only ever touches keys it minted.

This is manual/concierge for now. In Phase 1 the **provisioner (T8/#456)** calls
`mint` on signup and `topup`/`disable` from Stripe webhooks; the **console usage
page (T10/T12/#457)** reads spend via the same OpenRouter keys API.

## Later: self-hosted LiteLLM proxy

When the markup margin justifies the ops, swap to a self-hosted LiteLLM proxy
(also OpenAI-compatible, per-key budgets). The tenant then points at the proxy
instead of OpenRouter via the **`ZENOD_LLM_BASE_URL`** hook (an optional base-URL
override on the OpenAI-compatible provider path — added when that path is built;
the same per-key budget model carries over). Until then, v0 above is the meter.
