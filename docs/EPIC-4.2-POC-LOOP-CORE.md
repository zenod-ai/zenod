# SPEC · loop-core PoC — loop mechanics outside the harness

Parent: [EPIC-4.0-HERALD.md](EPIC-4.0-HERALD.md) (child 4.2 pre-work / spike)
Created: 2026-07-10 · Status: spec, not started
Home: `spikes/loop-core/` (TypeScript — same language as the engine so the core moves over verbatim)

## Why

Test the five loop primitives (briefing, boards, lanes, filings, scorecard) end to end with an LLM
in a plain script — no containers, no WhatsApp, no Stripe, no Zenod/Callisthenes deployments, no
durable executor. Prove the mechanics and the generality claim cheaply, then lift the core into the
engine unchanged.

## The one design rule

**`loop-core` is a pure library. All I/O goes through four ports.** The PoC and the engine are two
sets of adapters around the same core. If the core ever imports a network client, filesystem call,
or timer directly, the spike has failed its purpose.

```
loop-core (pure)                     ports                PoC adapter              engine adapter (later)
─ briefing store + ✓ versioning                                                    
─ board load/transition/query        Memory  get/put/list  markdown files in dir   Zenod unit (MCP seam)
─ lane loader + YAML validation      Agent   runMission()  direct Claude API call  guy container / durable executor
─ scheduler tick (cron + board-      Channel send/fetch    fake-X: timeline.md +   Callisthenes unit (MCP seam)
  event triggers)                                          seeded reply files
─ no-briefing-no-fire gate           Clock   now()/tick()  simulated time (fast-   real cron
─ toolbelt/budget check at dispatch                        forward a week in min)
─ filings (feedback/snapshot pages)
```

## PoC shape

- One repo dir, `spikes/loop-core/`: `core/` (the library), `adapters/poc/`, `cli.ts`, `loops/` (config).
- **LLM**: direct Anthropic API call from the Agent adapter. Toolbelt enforced by the adapter: it
  only *exposes* the lane's allowlisted tools to the model — same contract the gateway will enforce
  in the engine. Budget = max turns + token cap per mission.
- **Memory**: a folder of markdown pages with frontmatter (looks like a vault — deliberately).
  Briefing is `memory/briefing.md` with `approved: true|false` + version.
- **Boards**: `memory/boards/proposals.md`, `approved.md`, `posted.md` — items as frontmatter blocks
  with ids and states.
- **Channel (fake X)**: posting appends to `world/timeline.md` (permalink = anchor). Replies are
  seeded by dropping files into `world/replies/` (manually or by a fixture script), so the reply
  lane has something real to chew on.
- **Human gate**: CLI. Setup mode = interactive chat in the terminal negotiating the briefing to ✓.
  Approvals = `✓ 1,3 + 2 more` typed at the prompt (reuses the same parser 4.3 will need).
- **Clock**: simulated. `cli.ts run --days 7` fast-forwards, firing each lane's cron in order;
  `--step` mode advances one tick at a time for debugging.

## Loops to run (the point of the exercise)

1. **Herald posting loop** (`loops/herald/`): briefing + four lanes — propose (daily, N proposals
   citing memory sources), publish (hourly, drains approved board), reply (board-event on new
   replies, applies reply policy, files lessons), scorecard (weekly, goals vs snapshots).
2. **Newsletter loop** (`loops/newsletter/`): the generality test — weekly propose-1-draft,
   approval, send, open-rate snapshot (faked). **Acceptance: zero changes to `core/` or
   `adapters/`, config only.** This receipts the 4.0 Definition-of-Done generality item.

## Acceptance criteria

1. Malformed lane YAML rejected with named errors; unknown toolbelt entries rejected at load (H3-2 AC1 shape).
2. No lane fires without `approved: true` briefing; flipping approval off mid-run halts the next tick (receipt: run log).
3. Simulated week of the Herald loop: briefing negotiated to ✓ in terminal → morning-N with citations → CLI approval → fake-posts with permalink anchors → seeded replies answered per policy → feedback filings visible as memory diffs → scorecard message with numbers reconciling against the timeline.
4. Unapproved item never reaches `timeline.md` (absence receipt).
5. A lane attempting an off-allowlist tool is blocked by the Agent adapter with a receipt (H3-2 AC3 shape, adapter-level).
6. Newsletter loop runs with config-only changes (criterion above).
7. `core/` has zero imports outside the four ports (enforced by a lint/test, not by review).

## Integration path (what "then integrate" concretely means)

- `core/` moves into the engine as the lane runtime — this *is* 4.2's deliverable, pre-validated.
- Adapter swaps: Memory→Zenod seam, Channel→Callisthenes seam, Agent→durable executor + gateway,
  Clock→cron. Each swap is one adapter file; core untouched.
- The one thing the PoC cannot prove: **gateway-level** toolbelt enforcement (PoC enforces in the
  adapter). 4.2 keeps its own AC for that — the interface is identical, the enforcement point moves.
- The CLI setup-mode conversation and ✓-parser become 4.1/4.3 seed code (channel-agnostic by
  construction: they talk through the ports too).

## Out of scope

Real X, WhatsApp, containers, metering, provisioning, persistence beyond files, parallelism,
recovery semantics of the durable executor. Nothing here ships to a customer.

## Budget

One worker, single spike branch, ~2–3 sessions. Stop-honestly rule applies: if the core/port
separation is fighting the repo's existing types, stop and report rather than force it.
