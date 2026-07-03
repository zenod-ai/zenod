# LAUNCH CONTROL — the one document

Owner: **Fable** (high-level only). Everything tracked to launch lives here or in the two epics below.
This is the living document. Executors and testers append to the epics; Fable owns this page and
rewrites the state after every review. One document per concern — never a new file per run.

- **Epic 1 — [System Stability](EPIC-1-SYSTEM-STABILITY.md)** · trumps everything
- **Epic 2 — [Hosted Product Readiness](EPIC-2-HOSTED-READINESS.md)** · starts in parallel, ships second

---

## Step 0 · The platform model (decided, unless Jordi overrides)

1. **One owner per dimension.** Memory → Zenod. Backlog → Archus. Execution dispatch → Epaminon.
   Attention → Phylax. Public voice → Callisthenes. Nobody bypasses an owner. Consistency IS the value.
2. **Thin router, smart brain.** The Console routes and reports; it does not reason hard. Heavy judgment
   goes to the most capable model (Fable, high settings) at the planning/review layer, cheap models do
   bounded work. The router makes no assessments — it moves points between owners.
3. **One living doc per iteration — and the three-role loop is a configuration, not the platform.**
   The discipline stays: tickets + acceptance criteria + the proving test in ONE doc that planner,
   executor, and tester all write into; doc returns to the planner → next iteration; no doc sprawl.
   But planner→executor→tester is just one council configuration — one user journey, and the shape of
   the launch product. The generic council (voice notes, ad-hoc Epaminon runs, memory Q&A) is not
   replaced by it; councils can also be project-scoped (memory about a project, not a person).
4. **Evidence or it didn't happen.** Every state claim carries a same-turn receipt (URL, commit, anchor).
   Structurally enforced (reply-gate), not requested. This is already live and proven (iteration 6).
5. **Human-readable surface.** Jordi sees links and plain language. Raw errors, correlation IDs, and
   vendor noise stay in operator logs. Council-internal detail stays at the council table.
6. **Deterministic plumbing over vibes.** Auto-merge on green CI. Approval is state (a standing token),
   not vocabulary. Runs have budgets; a run that produces nothing verifiable fails loudly and early.
7. **No magic words.** Routing, guards, and approvals are semantic or stateful — never regex/keyword
   matches on the user's phrasing. If intent is unclear, ask once, honestly. (Hard rule, Jordi 2026-07-03.)
8. **Where documents live: the brain.** Council documents (this one, the epics, decisions) belong in a
   `Council/` folder in the memory vault (AlfaBlok/obsidian-brain) — one consistent home, minable over
   time. Docs hold ideas and plans; some lines mint GitHub tickets; tickets always link back to their
   doc. Working copies sit in zenod/docs while Fable lacks direct vault hands; every iteration close
   mirrors them to `Council/` (mirroring is item 5 of the iteration-7 dispatch).

**Platform decisions:**

- **D-1 Hosting shape — DECIDED 2026-07-03 (Jordi): managed single-tenant.** One container per
  customer, the exact image we dogfood. Self-host stays as funnel, not product. Epic 2 unblocked.
- **D-2 Frameworks — research DELIVERED**
  ([doc in the brain](https://github.com/AlfaBlok/obsidian-brain/blob/main/Projects/Zenod/Multi-Agent%20Orchestration%20Landscape%20(D-2).md),
  [#244](https://github.com/AlfaBlok/obsidian-brain/issues/244)). Verdict: **salvage, don't restart** —
  the governed memory + receipt/authority discipline is the moat; coordination plumbing is commodity;
  the two hard gaps (worker observability, hard budget enforcement) are already tickets S-1/S-7.
  **Pattern adopted as doctrine, vendor deferred:** orchestrator + isolated sub-agents (call/return,
  summaries back, no peer-to-peer chatter) for WORK; single-writer owners for STATE. Runtime substrate
  decision goes to a bounded post-Epic-1 spike — candidates: **Vercel Eve** (durable Workflow sessions,
  subagents, channels, Agent Runs observability, model-agnostic via AI Gateway; we already run Vercel's
  AI SDK in `packages/core/src/llm/aisdk.ts`), **Temporal**, **Claude Agent SDK**. No orchestrator-SDK
  marriage mid-stabilization; Eve's self-host story to be verified in the spike, not assumed.
  **Update — Eve research DELIVERED**
  ([doc](https://github.com/AlfaBlok/obsidian-brain/blob/main/Projects/Zenod/Vercel%20Eve%20as%20Execution%20Substrate%20(D-2).md),
  [#248](https://github.com/AlfaBlok/obsidian-brain/issues/248)): Apache-2.0; lock-in ergonomic not
  architectural; self-host durability proven (steve PoC, zero Vercel infra) but beta-version-fragile;
  v0.19.0, ~3 weeks old, no production users. **Verdict: defer migration; bounded self-host-first spike
  (ephemeral-executor lane only, kill criteria → harness+Temporal).**
- **D-3 Greenfield timing — OPEN (Jordi leaning: yes, as part of the refactor).** Do we start the new
  engine as a fresh repo/deployment and put Jordi on it as customer #0 from day one? Fable's framing:
  the D-2 spike IS the greenfield, right-sized — a tiny eve `agent/` project talking to the EXISTING
  brain and MCP units; if it passes its kill criteria it becomes the hosted product's seed (Epic 2 H-1)
  and lanes migrate incrementally; no big-bang fork, old engine serves until the new one earns traffic.
  Decision closes after the spike. Model reframe recorded in
  [council-v2-model-deck.html](council-v2-model-deck.html): sub-agents = tools with judgment (workers);
  governors = single-writer authorities (owners); council survives as the org chart; living doc promoted
  to THE state artifact; peer-to-peer work chatter deleted. Stabilization does NOT stop — Epic 1 hardens
  the keep-layer and the canonical suite is the acceptance suite for any new engine.

---

## The board (Fable updates; append-only history at the bottom)

| # | Epic | State | Exit criterion |
|---|------|-------|----------------|
| 1 | System Stability | 🔴 ACTIVE — iteration 7 | CANONICAL-TESTS board green ×2 consecutive builds |
| 2 | Hosted Readiness | 🟡 SCOPING | First paying customer live (Jordi = customer #0 doesn't count) |

**⏸ DISPATCH FREEZE (Jordi, 2026-07-03 ~21:45):** no new tickets or dispatches until direction is
clarified at the Fable table. In-flight runs land; nothing new starts.

**D-2 CLOSED (2026-07-03 night, Fable recommendation pending Jordi's confirmation): Path A.**
Bake-off cancelled by Jordi (right call — over-scoped; judgment over existing evidence sufficed).
Decision: fix the topology IN PLACE — iteration 8 = collapse council peer lanes into typed
receipt-or-error gateways (S-8/PR #499 is the first half), one reasoning brain (Console), governor
LLM judgment only where taste is the product (filing/drafting/ticket-writing), and adopt
`@workflow/world-postgres` (standalone open-source Workflow SDK, steve-proven) under the executor
lane for durability. No framework adoption now: today's forensic showed the 406-turn death was a
receipt false-negative, not an engine failure, and every observed red except durability has a merged
fix. **Eve is deferred, not rejected:** revisit at eve 1.0/GA as the candidate tenant image for
Epic 2, with CANONICAL-TESTS as the acceptance bar. steve = reference implementation, not fork base.
Rationale in full: Fable table, 2026-07-03 night session.
**CONFIRMED by the bake-off spike** (zenod#500 / PR #501, merged):
[spikes/d2-execution-substrate/COMPARISON.md](../spikes/d2-execution-substrate/COMPARISON.md) —
candidate C (AI SDK + durable SDK + our runner) passed all 6 acceptance tests (~208 LOC substrate;
durable-replay primitive ~40 LOC; real cross-process crash-resume; budget kill; receipts outside the
framework). Eve/Flue: DNF, infra-gated + empirically confirmed version fragility (Eve durability dep
requires a hand-pinned beta line; Flue 0.2.6, no shipped off-Cloudflare durable store). Standing order:
re-run the identical harness vs Eve at 1.0/GA and vs Flue when an off-Cloudflare store ships; promote
only on a clean 6/6 with less ops risk than C. Spike modules (durable/budget/receipt) = reference
implementations for iteration 8's executor graft. Meta-finding for S-8's family: the deliverable
landed on zenod#500/PR#501 while the master ticket obsidian-brain#250 carried no link — cross-repo
receipt linking is a gap.

**Now (2026-07-03 late):** Epic 1: S-0 ✅ · #486 (S-3) + #493 (S-4/5/6) merged · S-1 re-dispatched
(`direct-1783107468359`; first run killed by deploy restart — the durable-execution argument making
itself) · S-2 forensic running (`direct-1783107479331`) · S-8 running (`direct-1783107490565`) ·
S-9 partially live (auto-merge), renderer half unverified · S-7 held until S-1 lands (same code area) ·
**Test phase: canonical board run C-01…C-20 dispatched** (`ephemeral-1783107516255`; tester is a
separate worker — Fable only audits). D-2: **bake-off spike running**
([obsidian-brain#250](https://github.com/AlfaBlok/obsidian-brain/issues/250),
`direct-1783107501717`): Eve vs **Flue** (withastro/flue — Apache-2.0, harness-first, runtime-agnostic,
skills/AGENTS.md-native, MCP + WhatsApp channel ecosystem, but experimental + Node sessions in-memory
by default) vs **DIY** (AI SDK + standalone Workflow SDK + our runner). Winner closes D-2.

## Operating protocol

- Jordi ↔ Fable: this document, high level. Voice notes land here as decisions/tickets, never as prose dumps.
- Fable → Archus: tickets minted from the epics, verbatim acceptance criteria.
- Epaminon workers: report deliverable URLs against tickets; comment on the epic doc, never fork a new one.
- Tester: after every deploy touching Console/outbound/execution/memory, run CANONICAL-TESTS, append scoreboard.
- Cadence: Fable reviews after each scoreboard append; rewrites the board above; flags decisions to Jordi.

## History (newest last)

- **2026-07-03** · Doc created from Jordi's 17:28 voice note + iteration 2–6 record. Iteration 6 signed
  off fabrication as structurally solved (reply-gate). Canonical board at `4550d11`: 8✅/2🟡/5❌.
  P-batch fix worker died unverifiable (406 turns/45 min) — made worker observability S-1 and budgets
  S-7 first-class tickets. Stability declared the only active epic.
- **2026-07-03 · Jordi review.** Three-role loop reframed: one configuration/journey (the launch product
  shape), not the platform. Docs' permanent home: brain `Council/` folder. D-1 DECIDED: managed
  single-tenant. D-2 research ticket filed at last:
  [obsidian-brain#244](https://github.com/AlfaBlok/obsidian-brain/issues/244). Iteration-7 master ticket:
  [obsidian-brain#245](https://github.com/AlfaBlok/obsidian-brain/issues/245) — first run of the
  Fable→Epaminon pattern (one dispatch, worker owns the whole backlog with sub-agents). Live finding
  while filing: the `create_issue` MCP tool silently no-ops (router acks, nothing lands) — the explicit
  `archus_request_backlog_action` gateway works; silent-ack bug noted for the epic's scope.
- **2026-07-03 · Dogfood findings promoted straight to tests** (Jordi's standing rule: unexpected
  behavior → test list, immediately). Silent-ack backlog writes → **C-18** + ticket **S-8**; magic-word
  gating banned → **C-19** + doctrine point 7. Diagnosis of "why is filing one ticket complex": three
  overlapping front doors, one of which acks without delivering — no council bypass happened, all lanes
  ARE council lanes; the council needs ONE door with receipt-or-error semantics. Fable's role restated:
  high-level controller only — plans, tickets, tests, decisions; no code, no fixes; manual steps are
  requested from Jordi explicitly.
- **2026-07-03 · evening.** S-0 canary ✅ within budget — `claude-opus-4-8`/low is fine; the 406-turn
  death was not model config ("Deliverables: none" render bug sighted a 3rd time → S-9). Parallel lanes:
  P-batch merged as zenod#486 (S-3 content, deploying, unscored until a board run); F-batch (S-4/5/6) in
  flight; auto-merge behavior live (C-20). Dispatched: S-1 (zenod#488, `direct-1783105328881`) and the
  Eve substrate research (obsidian-brain#248, `direct-1783105324065`). D-2 sharpened: for WORK,
  sub-agents are tools of one owning agent (call/return, results fan back to a single context owner);
  for STATE, governors are single-writer services. Eve = leading substrate candidate pending #248.
