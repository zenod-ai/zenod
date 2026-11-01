# Web3 / Venice angle — brainstorm (2026-11-01)

Epic: [EPIC-8](../EPIC-8-WEB3-VENICE-RESEARCH.md). Origin: Jordi's voice notes of 2026-08-27 ("we should say we use Venice … it's our router … migration lane", obsidian-brain `Log/2026-08-27.md`) and 2026-06-11 (operators paid in crypto, revenue contract, shared treasury, `Log/2026-06-11.md`). No written Venice analysis was found in the repo, issues, PRs or the brain vault; the 2026-08-27 lane was noted but never started.

## 1. How private is the inference hop today?

Hosted Zenod sends every LLM call through one platform OpenRouter key (D30) and sets OpenRouter's `user` field to the **tenant id** on every call (`packages/server/src/settings.ts:227`).

- The router does not see a name or phone number. It does see a **stable pseudonym** linking all of one user's calls, and the **prompt content**, which is that person's life (addresses, insurance, health, plans). Content identifies people better than metadata does: pseudonymous is not anonymous.
- OpenRouter forwards to the upstream model (Anthropic, OpenAI, Google …). Their retention rules apply unless zero-data-retention routing is enforced.
- Venice changes only this hop. Zenod's server, WhatsApp/Meta and the vault host still see what they see today. The honest claim is "no-log inference + memory in a repo you own", **not** "nobody can see it".
- Venice tiers ([docs](https://docs.venice.ai/overview/guides/openai-migration)): **Private** = open-weight models Venice hosts itself, zero retention. **Anonymized** = proxied Claude/GPT with identifying metadata stripped, but the upstream still sees the content. Only Private earns the strong claim, so the deciding question is whether the librarian works well enough on open-weight models (run it through `scripts/memory-eval`).

## 2. Engineering cost of Venice

- Chat calls: **small**. Venice is OpenAI Chat-Completions compatible (`https://api.venice.ai/api/v1`). `packages/core/src/llm/aisdk.ts:78` already has an `OPENAI_COMPATIBLE_BASE_URLS` map (openrouter, groq). Adding `venice` is one entry plus the `Provider` type.
- Everything around the call: **medium**. Platform mode is OpenRouter-shaped: `usage.cost` and generation ids for metering (`customerMetering.ts` calls the OpenRouter keys API), transcription posts to OpenRouter's audio endpoint (`transcribe.ts:178`), and the model catalog is read from OpenRouter (`openrouterModels.ts`, `runtime.ts:2469`). Venice cost has to be computed from token counts, and transcription needs a Venice (or separate) path.
- A practical option is hybrid: Venice for the librarian (classify/compose/answer, the calls that touch memory) and keep the rest as it is until it is proven.

## 3. Crypto payments and tokens: four layers, cheapest first

| Layer | What the user sees | Effort | Notes |
|---|---|---|---|
| L0 Pay with crypto | stablecoin (USDC) checkout next to the card | low | Check whether our Stripe account can take stablecoin payments, else Coinbase Commerce. Live billing has never run (ZAL A5), so this comes after A5. |
| L1 Wallet login | "Sign in with Ethereum" (MetaMask) instead of email | medium | WhatsApp still needs a phone number, which defeats anonymity. **Telegram** (already a Zenod source) + wallet login is the web3-native pseudonymous path. |
| L2 Your tokens power your memory | holders who stake VVV get DIEM (each staked DIEM = $1/day of Venice API credit, [docs](https://docs.venice.ai/overview/vvv-diem)) and plug their own Venice key into Zenod | medium | The strongest web3 story: "your stake pays for your second brain". It **reverses part of D30** (platform key only, tenant keys ignored), so it needs a scoped exception. |
| L2b Zenod holds DIEM | Zenod stakes DIEM to cover platform inference as a fixed daily budget | finance | A treasury and cost-structure play, not a feature. Worth costing once per-tenant spend is known (D30 metering). |
| L3 Own-your-memory | the vault is a git repo of markdown; optionally mirrored, encrypted, to IPFS/Arweave | low–medium | Possibly the decentralisation claim that is **already true**. Confirm who owns the repo for hosted tenants before saying it. |
| L4 Protocol | open-source, operators paid in crypto, revenue contract, treasury, agent-governed repo (06-11 vision) | large | Horizon only. It competes with milestone A for attention. |

Not recommended: launching a Zenod token. It brings regulatory exposure and distraction, and a web3 audience distrusts it by default.

## 4. Web 2.5 positioning (draft for the video)

"Web2 by default, web3 if you want it": the same product, with crypto as optional rails rather than a requirement.

- Line: *A second brain you talk to on WhatsApp/Telegram. It writes to a repo you own, thinks through Venice so no one keeps your prompts, and you can pay in crypto or with your own Venice stake.*
- True **today**: memory as plain files in a repo, MCP access from any agent, WhatsApp. Not true today: Venice, crypto payments, wallet login.
- For the video, either (a) promo what is live and point web3 viewers to a waitlist for the "private mode", or (b) ship L0 + Venice-for-librarian first and claim them. The deciding factor is the video date (ask E8-A1).

## Open questions

See EPIC-8 Waiting on (E8-A1..A3).
