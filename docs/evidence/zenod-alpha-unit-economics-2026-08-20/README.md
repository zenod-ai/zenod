# Zenod alpha unit economics and offer contract

**Issue:** [ZAL-3E #1069](https://github.com/zenod-ai/zenod/issues/1069)

**Evidence date:** 2026-08-20

**Repository base:** `130a2720dcdd78577bf7458c323f2da770c57922`

**Production observation:** Zenod deployment label `sha-7365dbc`; read-only aggregate inspection on 2026-08-20

**State:** analysis complete; the managed offer is **not launch-ready**; one commercial decision gate remains

## Decision summary

Recommend this exact alpha offer:

| Offer | Price | AI usage | Model choice | Alpha stop behavior |
|---|---:|---|---|---|
| Managed | **€5/month or €50/year, plus applicable VAT** | **$0.50 of provider spend per tenant per month** | Zenod's locked budget-model set | warn at $0.40; hard stop at $0.50; no overage, top-up, or paid-model fallback |
| BYOK | **€4/month, plus applicable VAT** | no Zenod-funded AI spend; provider bills the customer | customer's OpenRouter, Anthropic, OpenAI, or Groq API key | provider/customer budget applies; Zenod does not promise an AI allowance |
| Self-hosted | €0 to Zenod | customer-funded | customer-managed | customer-managed |

Defer a BYOK annual price during alpha. A nominal €40/year version is positive in the base model, but its support headroom is thinner and there is no evidence yet that annual prepayment improves retention enough to justify the discount.

The **fastest truthful launch surface is BYOK**: tenant API-key custody and settings are already customer-usable. The managed offer cannot launch truthfully until a platform credential, automatically provisioned per-tenant monthly caps, fail-closed enforcement, and customer-facing allowance state exist.

This is contribution-margin analysis, not company profit. It excludes product development, general SRE, legal/accounting, founder overhead, acquisition cost, refunds, disputes, and profit tax.

## What exists now

| Capability | Implemented truth at base | Commercial implication |
|---|---|---|
| Tenant BYOK | Settings accept Anthropic, OpenAI, OpenRouter, and Groq keys; secrets are tenant-bound ([settings](../../../packages/server/src/settings.ts#L20-L145), [customer UI](../../../apps/web/src/views/settings/KeysTab.tsx#L53-L123)). | Technically usable now. There is no separate BYOK price/tier yet. |
| Provider/default models | Unconfigured runtime defaults to Anthropic ([provider selection](../../../packages/server/src/settings.ts#L590-L599)). OpenRouter defaults are `deepseek/deepseek-chat` for ask/classify and `google/gemini-3.1-flash-lite` for vision; settings can override them ([defaults](../../../packages/core/src/llm/aisdk.ts#L117-L133), [custom model UI](../../../apps/web/src/views/settings/KeysTab.tsx#L119-L199)). | The managed proposal deliberately selects OpenRouter and requires a locked allowlist. Today's arbitrary model field can make the usable allowance unpredictable. |
| Local LLM ledger | Every provider call records operation, model, token classes, and estimated cost in a durable SQLite ledger ([usage store](../../../packages/server/src/usageStore.ts#L5-L64), [schema/write](../../../packages/server/src/usageStore.ts#L135-L206)). | Useful analytics, but not authoritative billing enforcement. |
| OpenRouter key meter | Code can read provisioned-key balance if `OPENROUTER_PROVISIONING_KEY` exists ([customer metering](../../../packages/server/src/customerMetering.ts#L24-L91)). | Live Zenod has no provisioning key, so this returns no gateway truth. |
| Tenant request quota | Chassis quota counts cumulative MCP/API request units ([quota check](../../../packages/mcp-chassis/src/usage.ts#L183-L198), [request gate](../../../packages/mcp-chassis/src/index.ts#L1630-L1648)). | It is not monthly model spend and does not implement the proposed allowance. All live tenant quota fields were `NULL`. |
| Manual capped keys | The gateway CLI can mint a key with a USD limit ([gateway script](../../../scripts/gateway/openrouter-key.mjs#L1-L30), [mint](../../../scripts/gateway/openrouter-key.mjs#L89-L106)). | Manual only; it omits `limit_reset: "monthly"` and is not wired to checkout, suspension, or tenant settings. |
| Checkout plans | Billing supports only `monthly` and `yearly` prices ([billing config](../../../packages/server/src/customerBilling.ts#L33-L80)); completion provisions a tenant/token but no provider key or quota ([tenant binding](../../../packages/server/src/customerTenantBinding.ts#L59-L90)). | No managed/BYOK distinction and no included-usage contract exist today. |

The local estimator is stale: its generic DeepSeek row is `$0.20/M` input and `$0.80/M` output ([pricing table](../../../packages/server/src/usageStore.ts#L21-L46)), versus the current selected OpenRouter endpoint used here at `$0.2574/M` and `$1.0287/M`. That is about a **28.7% undercount** before cache effects. Unknown models record tokens at cost zero, another reason local estimated dollars cannot enforce a hard budget.

## Redacted production evidence

The inspection read aggregate tenant rows, runtime setting presence/defaults, process environment variable **names/presence only**, container resources, and the token ledger. It did not read or export prompts, answers, note content, customer identifiers, raw tokens, or secret values.

### Hosted state

- Deployed Zenod build label: `sha-7365dbc`.
- 8 tenant rows: 3 `pilot`, 3 `starter`, 2 `monthly`; all 8 have quota `NULL`.
- 6 runtime settings databases: 3 have no provider key, 2 use OpenRouter defaults, and 1 uses custom OpenRouter Grok/MiniMax models. Present keys are encrypted tenant secrets.
- Live environment has no platform OpenRouter/Anthropic/OpenAI/Groq inference key, no `OPENROUTER_PROVISIONING_KEY`, and no configured daily budget.
- Therefore production today is **hosted application + tenant BYOK**, not managed inference.

### Thirty-day token ledger

Read-only window: `2026-07-21T15:14:39.715Z` through `2026-08-20T15:14:39.715Z`. One anonymous ledger was active; six other ledgers were zero.

| Aggregate | Value |
|---|---:|
| Calls | 278 |
| Input tokens | 1,932,123 |
| Output tokens | 401,571 |
| Cached-input tokens | 208,832 |
| Cache-creation tokens | 0 |
| Total recorded token units | 2,542,526 |
| Local estimated cost | $2.37008735 |

| Model family | Calls | Local estimated cost |
|---|---:|---:|
| Grok | 171 | $1.981318 |
| MiniMax | 92 | $0.377523 |
| Gemini | 15 | $0.011246 |

The recorded operation mix was 86 classify calls, 127 compose calls, 44 answer calls, 6 backlog extractions, and 15 image descriptions. It implies 1.4767 compose calls and 0.0698 backlog extractions per stored item. The calculation script uses the observed token shape but re-prices text work to the proposed managed DeepSeek default and images to the proposed Gemini default.

The point-in-time extraction used Node's read-only `DatabaseSync` against each deployed `usage.sqlite`, constrained by the exact timestamp window, with `COUNT(*)` and `SUM(...)` over token columns and `GROUP BY operation/model`. Tenant state was counted/grouped without selecting identifiers; environment inspection compared variable names to a provider/budget allowlist and never printed values. The raw production databases are intentionally not copied into this artifact.

This is one founder/internal dogfood sample, not a customer distribution. Token and call counts are reliable; the stored dollar estimate is directional because the local price table is stale. Speech-to-text is omitted because voice/WhatsApp is outside the first alpha offer. The active-day median, p90, and maximum local estimates were $0.0697, $0.1912, and $0.3526 respectively; they must not be extrapolated as customer percentiles.

## Current source prices and assumptions

Sources were retrieved on 2026-08-20.

| Input | Base assumption | Source / treatment |
|---|---:|---|
| DeepSeek text | $0.2574/M input, $1.0287/M output, 0.1 cache discount | [OpenRouter model pricing](https://openrouter.ai/deepseek/deepseek-chat/pricing) and [endpoint API](https://openrouter.ai/api/v1/models/deepseek/deepseek-chat/endpoints); selected cheapest current endpoint. Routing or price changes require re-running this gate. |
| Gemini vision | $0.25/M input, $1.50/M output, $0.025/M cached input | [OpenRouter endpoint API](https://openrouter.ai/api/v1/models/google/gemini-3.1-flash-lite-preview/endpoints); current Google endpoint. |
| OpenRouter funding | 5.5% | [OpenRouter pricing](https://openrouter.ai/pricing) and [FAQ](https://openrouter.ai/docs/faq). Model assumes pooled platform funding; the $0.80 minimum funding fee must not be incurred as a separate monthly top-up per tenant. |
| FX | €1 = $1.1567 | [ECB exchange-rate reference](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/html/index.en.html), rate used from 2026-08-14. |
| EEA card processing | 1.5% + €0.25 | [Stripe Spain pricing](https://stripe.com/es/pricing). Non-EEA/premium-card mixes cost more. |
| Stripe Billing | 0.7% | [Stripe Billing pricing](https://stripe.com/es/billing/pricing). |
| Stripe Tax | 0.5% where registered | [Stripe Tax pricing](https://stripe.com/en-es/tax/pricing). Conservatively included on every modeled charge. |
| Spanish standard VAT | 21% | [Agencia Tributaria](https://sede.agenciatributaria.gob.es/Sede/iva/calculo-iva-repercutido-clientes/tipos-impositivos-iva.html). Recommended prices are plus applicable VAT; VAT-inclusive downside is also shown. |
| Shared infrastructure | €15.59/month replacement envelope | CX33 €8.49 ex VAT from [Hetzner adjustment table](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/), IPv4 €0.50 from [server overview](https://docs.hetzner.com/cloud/servers/overview/), and 150 GB volume at €0.044/GB (€6.60) from [block storage](https://www.hetzner.com/cloud/block-storage/). |
| Per-active-tenant infrastructure | €1.00 base; €0.25–€1.50 sensitivity | Managerial allocation of shared compute (€0.65) and storage/backup (€0.35), not measured incremental cost. |
| Support | €2.00/month = 4 minutes at €30/hour | Conservative explicit reserve; sensitivity at 0, 2, 5, and 10 minutes. |

## Reproducible calculation

For plan price `P`, cadence `m` months, Spanish B2C VAT `v = 0.21`, provider spend `S`, FX `x`, and a managed hard cap `L = $0.50`:

```text
customer collection/month = P × (1 + v) / m                 # recommended plus-VAT offer
net revenue/month         = P / m
payment stack/month       = (P × (1 + v) × (1.5% + 0.7% + 0.5%) + €0.25) / m
managed model cost/month  = min(S, L) × (1 + 5.5%) / x
contribution/month        = net revenue - payment stack - infrastructure - support - model cost
```

For a VAT-inclusive advertised price, net revenue is `P / (1 + v) / m`, and fees apply to `P`. For eligible reverse-charge/no-VAT collection, net revenue is `P / m` and fees apply to `P`.

Run:

```bash
node docs/evidence/zenod-alpha-unit-economics-2026-08-20/model.mjs --check
node docs/evidence/zenod-alpha-unit-economics-2026-08-20/model.mjs
```

The first command checks fixed reference outputs and cap invariants; the second prints all assumptions, action costs, scenarios, plan margins, and sensitivities as JSON.

## Usage scenarios

An illustrative “store” includes one classify call, the observed 1.4767 compose calls, and the observed 0.0698 backlog-extraction calls. An “ask” is one answer call; a tool-using answer can perform up to the configured model-step budget and therefore vary materially. Image description is priced with the Gemini vision default.

| Scenario | Stores | Asks | Images | Provider spend | Operator cash after funding/FX, uncapped | Result under managed contract |
|---|---:|---:|---:|---:|---:|---|
| Light | 10 | 10 | 0 | $0.1197 | €0.1092 | below cap |
| Typical | 30 | 20 | 5 | $0.3331 | €0.3038 | below cap |
| Illustrative allowance | 40 | 25 | 5 | $0.4384 | €0.3999 | below cap with ~12% spend buffer |
| Founder-equivalent shape | 86 | 44 | 15 | $0.9168 | €0.8362 | stops at $0.50, about 55% through this repriced shape |
| Heavy | 100 | 100 | 20 | $1.2078 | €1.1016 | stops at $0.50 |
| Abuse | 500 | 500 | 100 | $6.0388 | €5.5078 | stops at $0.50 |

At current DeepSeek rates, a $0.50 cap corresponds to roughly **1.21M–1.49M combined text-token equivalents**, depending on whether output is 20% or 10% of the mix. The observed workload shape re-prices to about $0.917 before funding ($0.967 funded, €0.836). These are explanatory equivalents, not a contractual token grant: the **USD provider-spend cap is authoritative** because output share, images, tool steps, routing, and model prices vary.

## Contribution margin

Base tables assume: prices **plus 21% VAT**, EEA card, Billing and Tax fees, €1 infrastructure allocation, €2 support reserve, and the managed cap working. “At/after cap” means the customer receives no further managed model calls that month; it does not mean abuse usage is fulfilled for €0.50.

| Plan / scenario | Net revenue | Payment stack | Infra | Support | Model | Contribution/month |
|---|---:|---:|---:|---:|---:|---:|
| Managed €5 monthly, light | €5.000 | €0.413 | €1.000 | €2.000 | €0.109 | **€1.477** |
| Managed €5 monthly, typical | €5.000 | €0.413 | €1.000 | €2.000 | €0.304 | **€1.283** |
| Managed €5 monthly, illustrative allowance | €5.000 | €0.413 | €1.000 | €2.000 | €0.400 | **€1.187** |
| Managed €5 monthly, at/after cap | €5.000 | €0.413 | €1.000 | €2.000 | €0.456 | **€1.131** |
| Managed €50 annual, typical monthly equivalent | €4.167 | €0.157 | €1.000 | €2.000 | €0.304 | **€0.706** |
| Managed €50 annual, at/after cap monthly equivalent | €4.167 | €0.157 | €1.000 | €2.000 | €0.456 | **€0.554** |
| BYOK €4 monthly | €4.000 | €0.381 | €1.000 | €2.000 | €0.000 | **€0.619** |
| BYOK €40 annual candidate, monthly equivalent | €3.333 | €0.130 | €1.000 | €2.000 | €0.000 | **€0.204** |

Without a hard stop, abuse becomes loss-making: managed-monthly contribution falls from €1.131 capped to about **−€3.921** at the abuse shape; managed-annual falls from €0.554 to about **−€4.498**. The positive heavy/abuse capped row is therefore an enforcement claim, not merely a pricing assumption.

### Sensitivity and break-even

| Change from base | Managed monthly, illustrative allowance | Managed annual, illustrative allowance | BYOK monthly |
|---|---:|---:|---:|
| Infrastructure €0.25 | €1.937 | €1.360 | €1.369 |
| Infrastructure €1.00 | €1.187 | €0.610 | €0.619 |
| Infrastructure €1.50 | €0.687 | €0.110 | €0.119 |

At typical use, contribution by average support time is:

| Support time at €30/hour | Managed monthly | Managed annual | BYOK monthly |
|---|---:|---:|---:|
| 0 minutes | €3.283 | €2.706 | €2.619 |
| 2 minutes | €2.283 | €1.706 | €1.619 |
| 5 minutes | €0.783 | €0.206 | €0.119 |
| 10 minutes | −€1.717 | −€2.294 | −€2.381 |

The exact typical-use support break-even is about **6.57 minutes/month** for managed monthly, **5.41 minutes/month** for managed annual, and **5.24 minutes/month** for BYOK monthly. This is the dominant early-alpha risk: model cost is bounded; founder support is not.

If advertised prices must include 21% VAT instead, typical contribution falls to **€0.443** managed monthly, **€0.006** managed annual, and **−€0.052** BYOK monthly. A €3 VAT-inclusive BYOK price loses about €0.85/month at the base support and infrastructure assumptions, so it is not recommended.

If Zenod alone had to recover the entire €15.59 shared infrastructure envelope, with base support included, approximate subscriber break-even is 8 managed-monthly customers at the illustrative allowance, 10 managed-annual customers, or 10 BYOK-monthly customers. This fixed-host view is deliberately conservative because the host is shared; the €1 allocation becomes fully funded at about 16 active tenants.

## Exact managed allowance and stop contract

The public offer should describe a limited monthly managed-AI allowance and give the 40 stores + 25 asks + 5 images bundle only as an example. The enforceable contract must be:

1. Provision one OpenRouter child key per managed tenant with `limit: 0.50` and `limit_reset: "monthly"` ([key API](https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key)). Surface the provider's reset timestamp in UTC; do not maintain a competing local reset clock.
2. Lock managed tenants to the costed DeepSeek text and Gemini vision model set. A provider/rate change reopens this economics gate.
3. Warn the customer once provider usage reaches `$0.40` (80%). At `$0.50` (100%), reject new model-backed work before calling the provider; the provider key limit remains the external backstop.
4. Hard-stop model-backed store/classify/compose, ask/answer, backlog extraction, and image-description calls with a clear “monthly AI allowance used; resets at … UTC” response. Search, get/read, export, settings, billing, and account access continue.
5. No automatic overage, silent fallback, credit top-up, negative balance, or cross-tenant pooled inference key. If provider balance truth is unavailable, managed model calls fail closed. Billing suspension disables the child key.
6. Voice, WhatsApp, and speech-to-text are outside this alpha contract. Add them only after separate metering and cost evidence.

Provider accounting can lag or round at the final request, so preflight plus an external capped key are both required. Reconcile authoritative provider usage to the local token ledger; local unknown-model cost must never be interpreted as zero for enforcement.

## BYOK contract

BYOK customers pay Zenod for hosting, updates, storage/backup allocation, and the customer surface. They supply a dedicated API key and pay their provider directly. The product already supports OpenRouter, Anthropic, OpenAI, and Groq key fields.

[OpenRouter BYOK](https://openrouter.ai/docs/guides/overview/auth/byok) is a separate OpenRouter feature; Zenod's simplest alpha path is for the customer to paste their own OpenRouter key directly. If a customer instead supplies an Anthropic/OpenAI/Groq key, the corresponding provider bills them.

A consumer subscription is not an API credential. In particular, ChatGPT and the OpenAI API have separate billing ([OpenAI account billing guidance](https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform)). Zenod does not accept a ChatGPT or Claude subscription login today; it requires one of the API keys exposed in settings. Offer copy should say “bring a provider API key,” not “use your AI subscription.”

## Implemented-state gaps and proposed backlog

1. **Managed credential and custody:** create the platform OpenRouter funding/provisioning account under a production human gate; define rotation, minimum pooled top-up, and incident ownership.
2. **Automatic key lifecycle:** on managed checkout, mint a tenant key with `$0.50` and monthly reset, seed it through tenant-bound secret custody, persist only its safe identifier, and disable it on pause/cancel.
3. **Plan separation:** add explicit `managed` and `byok` entitlements and Stripe prices. BYOK must not receive a platform key; managed tenants must not select arbitrary paid models.
4. **Fail-closed enforcement and UX:** preflight authoritative provider balance, warn at 80%, stop at 100%, show reset time and usage, and keep deterministic operations available. Do not reuse the cumulative chassis request quota as dollar enforcement.
5. **Reconciliation:** update/fetch model rates, price cache classes correctly, treat unknown models as unpriced/error rather than $0, and compare provider key usage with the local ledger. Add boundary, reset, provider-outage, concurrency, and suspension tests.
6. **Offer and payment proof:** publish exact allowance/BYOK copy only after the gate, configure test prices, run real-card/tax/refund/portal evidence under the existing human gates, and complete the stranger journey before public signup.
7. **Later channels:** price and meter speech-to-text/voice separately before adding them to a paid allowance.

Until items 1–5 pass, the managed plan must not be advertised as providing included AI usage. BYOK still needs items 3, 6, and the recorded alpha-launch human gates before public launch, but it does not depend on platform inference custody.

## One decision gate

**Gate ZAL-3E — `APPROVE ECONOMICS CONTRACT`:** approve managed **€5/month or €50/year plus applicable VAT**, locked managed defaults, **$0.50 provider spend per tenant per month**, warning at 80%, hard stop at 100%, UTC reset, and no overage/fallback; approve BYOK **€4/month plus applicable VAT**, customer API key, no included AI spend, and no BYOK annual plan during alpha.

Passing this gate authorizes backlog implementation and offer-copy preparation only. It does **not** authorize production credentials, live Stripe mutation, deployment, public pricing publication, or opening public signup; those remain separate recorded human gates in the active spine.
