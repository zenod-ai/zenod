# D-2 Execution-Substrate Bake-Off Spike

Greenfield spike for decision **D-2** (execution substrate). **Touches no production
code** — everything lives under this directory. Closes the D-2 bake-off:
[zenod-ai/zenod#500](https://github.com/zenod-ai/zenod/issues/500) · central
[AlfaBlok/obsidian-brain#250](https://github.com/AlfaBlok/obsidian-brain/issues/250).

## What this is
ONE identical acceptance harness (six tests, from the Eve research doc §6) run against
three candidate substrates:

- **A — Vercel Eve** (`candidate-a-eve/`) — DNF in this sandbox (needs Postgres + Docker self-host; beta version-pinning). See `NOTES.md`.
- **B — Flue** (`candidate-b-flue/`) — DNF in this sandbox (durable sessions off-Cloudflare are unproven; no Workers runtime here). See `NOTES.md`.
- **C — DIY** (`candidate-c-diy/`) — **PASSES all six**, offline, ~200 LOC substrate + ~100 LOC harness. AI SDK (already in prod here) + a DIY durable event-log standing in for the Workflow SDK / Temporal + our runner + external authority receipt.

## The verdict
**`COMPARISON.md`** is the single required deliverable doc: per-test matrix, honest ops
notes (version pain / self-host truth / LOC), and the recommendation — **ship candidate C**,
keep the receipt/authority gate and MCP units outside the substrate, re-test Eve/Flue on real
infra before promoting either.

## Run it
```bash
cd candidate-c-diy
node --test src/harness.test.mjs   # 6/6 pass, no API key needed
node src/crash-recovery-demo.mjs   # narrated cross-process crash + durable resume
```

The harness uses a deterministic offline model so it is hermetic. Set `ANTHROPIC_API_KEY`
and `npm i` (optionalDependencies: `ai`, `@ai-sdk/anthropic`) to exercise the real AI SDK path.
```
