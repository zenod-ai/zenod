# D-2 Execution-Substrate Bake-Off — Comparison & Recommendation

**Issue:** [zenod-ai/zenod#500](https://github.com/zenod-ai/zenod/issues/500) · central [AlfaBlok/obsidian-brain#250](https://github.com/AlfaBlok/obsidian-brain/issues/250)
**Closes decision:** D-2 (execution substrate) in `docs/LAUNCH-CONTROL.md`
**Grounded in:** `Projects/Zenod/Vercel Eve as Execution Substrate (D-2).md` §6 (the acceptance harness) and `Projects/Zenod/Multi-Agent Orchestration Landscape (D-2).md` (Option C = harness + Temporal + SDK subagents + hard budgets, the standing default).
**Spike location:** `spikes/d2-execution-substrate/` (greenfield — **no production code touched**).
**Date:** 2026-07-03

> **This doc should be mirrored into the brain** (`Projects/Zenod/...`) by the human/controller — this worker runs against `zenod-ai/zenod` and cannot write the `AlfaBlok/obsidian-brain` vault. The canonical copy lives in this spike dir until then.

---

## 0. TL;DR recommendation

**Adopt candidate C (DIY: AI SDK + a standalone durable-execution SDK + our runner) as the D-2 substrate, keeping the authority/receipt gate and the MCP units outside it. Do NOT migrate the product runtime onto Eve or Flue yet.**

The bake-off ran ONE identical 6-test acceptance harness (from the Eve research doc §6). Only candidate C could be executed end-to-end **in this sandbox** (no Docker / Postgres / Cloudflare host is available here), and it **passes all six tests** with ~200 LOC of substrate code + ~100 LOC of harness. Eve (A) and Flue (B) are **DNF in this environment** — not because the frameworks are bad, but because both require self-host infrastructure the sandbox cannot provide, and their durability stories are exactly the beta-version-pinned / off-Cloudflare open questions the research already flagged. C is "collect the pieces we know work," and they work.

This is consistent with, and now backed by running code for, the standing Option-C recommendation from the landscape doc.

---

## 1. The acceptance harness (identical for all candidates)

From `Vercel Eve as Execution Substrate (D-2).md` §6:

1. **Ephemeral executor** completes generate → act → summarize on one representative task.
2. **Crash-recovery:** kill the process mid-turn; the session resumes from durable state and completes.
3. **MCP interop:** an existing Zenod MCP tool (`search_memory`) is called from inside the candidate's tool layer.
4. **Hard budget:** a per-run budget ceiling terminates a deliberately runaway run.
5. **Authority receipt** is emitted unchanged, **outside** the framework.
6. **Honest ops notes:** version pain, self-host truth, LOC written.

---

## 2. Per-test results matrix

| # | Acceptance test | **A. Vercel Eve** | **B. Flue** | **C. DIY (AI SDK + durable SDK + runner)** |
|---|---|---|---|---|
| 1 | generate→act→summarize | DNF¹ | DNF² | **PASS** — `harness.test.mjs` test 1 |
| 2 | crash-recovery from durable state | DNF¹ | DNF² | **PASS** — real cross-process kill (exit 137) + resume; ≥1 step replayed, not redone |
| 3 | Zenod `search_memory` from tool layer | DNF¹ | DNF² | **PASS** — MCP tool invoked with spy transport asserting the call |
| 4 | hard budget ceiling terminates runaway | DNF¹ | DNF² | **PASS** — run terminates the moment spend crosses the ceiling |
| 5 | authority receipt emitted outside framework | DNF¹ | DNF² | **PASS** — receipt module has zero import of the executor; refuses to verify a no-evidence "success" |
| 6 | honest ops notes | see §4 | see §4 | see §4 |

¹ **Eve DNF (infra-gated):** self-host requires a Postgres Workflow "world" + Docker sandbox (the `vercel-labs/steve` pattern). This sandbox has **no Docker and no Postgres**, and the durability layer's npm `latest` is **version-incompatible** — see §4.
² **Flue DNF (infra-gated + open question):** Flue's durable sessions are Cloudflare-Durable-Objects-first; running them off-Cloudflare (custom store / Durable Streams) is Flue's **key unproven question**, and no Cloudflare/Workers runtime is available in this sandbox — see §4.

> **DNF is a kill-criteria outcome, not a defect verdict.** Per the issue's kill criteria (">~1 day fighting versions/incompatibilities → record DNF with evidence and move on"), A and B are recorded DNF **in this environment**. A follow-up spike on a real VPS (Docker+Postgres for Eve; a Cloudflare Worker or a proven custom store for Flue) is the only way to move them past test 1. This bake-off does not claim they *cannot* pass — it shows C already does, cheaply, with no such infra.

---

## 3. Substrate-axis comparison (from the research, confirmed against npm 2026-07-03)

| Axis | A. Vercel Eve | B. Flue | C. DIY (AI SDK + durable SDK + runner) |
|---|---|---|---|
| License | Apache-2.0 (`eve`) | Apache-2.0 (`flue`) | AI SDK (Apache-2.0) + our code + chosen durable SDK (Workflow SDK / Temporal, both open) |
| Version maturity | `eve@0.19.0`, ~3 wks, **beta** | `flue@0.2.6`, pre-1.0 | AI SDK `ai@7.0.14` **already in prod** here (`packages/core/src/llm/aisdk.ts`) |
| Durable sessions self-host | Yes but beta-pinned (Postgres world) | **Open question** off-Cloudflare | Yes — pick Workflow SDK **or** Temporal (GA, self-host-mature) |
| Sandbox | Vercel Sandbox → Docker self-host | Cloudflare-oriented | **Our existing runner** (`Dockerfile.agent-runner`, `docker-compose.runner.yml`) |
| MCP interop | tools/connections | `connectMcpServer` | Plain tool layer calling our Console/Zenod gateway (proven here) |
| Lock-in | ergonomic-to-Vercel, all replaceable | ergonomic-to-Cloudflare | **lowest — we own every seam** |
| Biggest risk | too young; beta churn; version-fragile self-host | durable-off-Cloudflare unproven; youngest | we assemble/own the glue (but every piece is known-good) |

---

## 4. Honest ops notes (test 6)

**Version pain (empirically confirmed via `npm view`, 2026-07-03):**
- **Eve:** `eve@0.19.0`. The durability dep `@workflow/world-postgres` npm **`latest` is `4.2.0`**, but Eve/`steve` require the **`5.0.0-beta.19`** line — the `latest` tag "fails mid-run" (research doc §1). Self-hosting Eve today = hand-aligning `eve` + `@workflow/world-postgres@5.0.0-beta.x` + `workflow@4.5.0` + `ai@7.0.0-canary.x`. This is exactly the ">1 day fighting versions" kill-trigger.
- **Flue:** `flue@0.2.6` — pre-1.0, youngest of the three; the `@withastro/flue` scope does not exist on npm (package is unscoped `flue`), and off-Cloudflare durable sessions have no shipped, documented store.
- **DIY:** `ai@7.0.14` + `@ai-sdk/anthropic@4.0.7` are **stable and already a production dependency** in this monorepo. Zero new version-alignment risk on the LLM pillar; the durability pillar is a deliberate, swappable choice (Workflow SDK today, Temporal if we want GA durability).

**Self-host truth:**
- **Eve** self-hosts (proven once by `vercel-labs/steve`: Postgres world + Docker sandbox + direct Anthropic, zero Vercel infra) — but it is a 7-star PoC on pinned betas, "portable in principle, proven once, not yet turnkey."
- **Flue** self-hosts to Node/Docker for the *agent loop*, but **durable sessions off Cloudflare are Flue's open question** — the one thing D-2 most needs proven is the one thing least proven.
- **DIY** is self-host by construction: it is our existing runner + the AI SDK we already run + an open durable-execution SDK. Nothing depends on a managed cloud.

**LOC written (candidate C, this spike):**
- Substrate (durable log, budget, receipt, model adapter, tools, executor, worker): **~208 non-comment LOC** across `src/*.mjs`.
- Acceptance harness: **~100 LOC** (`src/harness.test.mjs`).
- The DIY durability primitive (`durable.mjs`) is **~40 non-comment LOC** — proof that the "durable, replayable, at-least-once step" contract is small to own when the substrate underneath (Workflow SDK / Temporal / even fsync'd JSONL for the spike) is doing the heavy lifting.

**Recommendation:** ship **C**. Keep the receipt/authority discipline and MCP units *outside* whatever substrate wins (they are a correctness layer stronger than anything the frameworks bundle). Re-run this identical harness against Eve on a real VPS (Docker+Postgres) at Eve's 1.0/GA, and against Flue once it ships a proven off-Cloudflare durable store — promote either only if it clears all six tests with less ops risk than C. Until then, C is the substrate with running, tested evidence.

---

## 5. How to reproduce

```bash
cd spikes/d2-execution-substrate/candidate-c-diy
node --test src/harness.test.mjs      # all 6 acceptance tests (offline, no API key)
node src/crash-recovery-demo.mjs      # narrated cross-process crash + resume
# optional real-LLM path: set ANTHROPIC_API_KEY and `npm i` (optionalDependencies)
```

Eve/Flow reproduction prerequisites (NOT runnable in this sandbox) are in
`candidate-a-eve/NOTES.md` and `candidate-b-flue/NOTES.md`.
