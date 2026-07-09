# EPIC ZERO — OVERSIGHT (the planner at the center)

Owner: **Epic-Zero (Jordi's planning partner)** · Snapshot deck: [`EPIC-ZERO-OVERVIEW.html`](../EPIC-ZERO-OVERVIEW.html)

**The mission.** Launch Herald — which means launching each unit *separately* (Zenod, Callisthenes,
the Ring) as real, self-serve, provisioned products, then assembling Herald on top and pointing
Herald at promoting all of them and itself. This doc is the truth at the center: I read the five
unit docs, hold the whole picture, and tell Jordi the next move. Low-level build lives with the
workers in their own docs.

## Operating model (the flow)

1. **The docs are the truth.** Each unit has one living doc (below). Workers explain themselves
   **additively** in that doc's append zone every iteration. A code commit is NOT "done" — the
   dated doc entry is. (Live example 2026-07-08: Z-9 code landed as `6e967d7`, but the 2.3 doc still
   read "unbuilt" — so it was not done.)
2. **Jordi never copy-pastes between us.** He says "read up," I read the docs, I know where we are.
3. **I signal the next move** in one of five shapes, and hold the high-level conversation with Jordi:

| Signal | Means | Jordi's action |
|---|---|---|
| 🔵 **TEST** | A thing is ready for you to try. I tell you exactly what to expect. | You test it. |
| 🟠 **DECISION** | I need a call only you can make. | You decide. |
| 🔴 **PROBLEM** | A blocker I can't solve (access, keys, an external limit). | You unblock. |
| ⚙️ **ITERATE** | I've left next-iteration instructions in the unit doc. | You tell the worker: "planner left instructions, go next iteration." |
| 🟢 **GREEN** | A unit passed its basic test. Slide 3 turns greener. | Celebrate; move on. |

## The document contract (all comms go through the docs)

The rule for everyone, every time, is one sentence: **"do another iteration on the document."**
Nobody gets bespoke instructions in chat — the instruction lives in the doc.

**Every doc has two zones that never collide:**
- **▶ NEXT ITERATION** — pinned at the TOP, **planner-owned**. The single thing to do now
  (task · acceptance · discipline), or **⏸ HOLD — awaiting <X>** when there's nothing to do. I
  overwrite it each cycle.
- **Append zone** — at the BOTTOM, **worker-owned**. The worker writes a dated handback here
  (what changed · SHA · proven · next) and lands it inline on `main`. That handback is what "done" means.

**The universal order — paste to ANY worker, always identical:**
> Read your document. Do the ▶ NEXT ITERATION block at the top — in your own worktree, editing only
> your unit's files. Append a dated handback to the append zone and land it inline on `main`
> (not a dangling PR). Then stop.

**The git-runner.** The planner can't commit/push from its sandbox, so git & repo ops are their own
worker driven by [`OPS-RUNNER.md`](OPS-RUNNER.md): I queue the git tasks in its ▶ NEXT ITERATION
block; you ping the git-runner with the same universal order. I never ask you to run git by hand.

**The handshake (you ↔ me):** you say *"read up"* → I read every doc, we decide, I write what's
needed → I tell you **"docs are ready — ping <worker(s)>."** You give each the universal order.
That's the entire loop; nothing routes around the documents.

## Standing orders (apply to every unit + worker)

- **SO-1 · Stripe = TEST MODE.** All provisioning funnels are proven in Stripe **test mode** —
  provision exactly as if real, but **no live charges**. This supersedes any "real card / LIVE mode"
  language in the 2.3 / 2.4 / 2.6 exit criteria. The bar is: test-mode checkout → real auto-provision
  → working instance, timed.
- **SO-2 · Worktree discipline.** One worktree per active worker, **named by unit**
  (e.g. `wt/zenod-z9`, `wt/callisthenes-635-636`, `wt/ring-spec`). A worker edits **only** its own
  unit folder + its own doc. Land via PR to `main`. Never edit another unit's files. Stale worktrees
  get pruned (`git worktree prune`) — today there are ~20, most `prunable`.
- **SO-3 · Additive self-explanation.** Every iteration ends with a dated handback in the unit
  doc's append zone: what changed, the receipt (SHA), what's proven, what's next. No silent commits.
- **SO-4 · Self-host but connected like a real user.** Each unit provisions into its own instance
  (Dokploy) with its own setup UI, and I connect to it the way a paying user would.

## Basic tests — the green bar (what "working separately" means)

- **Zenod (memory):** from a fresh chat client, paste the MCP URL → store a fact (commit-SHA receipt
  lands in the repo) → search finds it → `ask_brain` answers **with cited sources**. Plus:
  test-mode pay → provisioned instance in <30 min → dashboard shows consumption.
- **Callisthenes (voice):** unit builds + boots → `tools/list` exposes
  `connect / complete_connect / connections / revoke / usage` → connect X via chat (PIN) → post a
  tweet → **permalink receipt** in the tool result → throttle + drafts-never-send hold → revoke via
  chat. Plus: test-mode pay → provisioned instance with its own setup UI.
- **Ring (gateway = council):** pair WhatsApp → send a message → Ring routes to a connected MCP
  server → **verbatim reply back** → the connect-MCP UI adds a server + its skill → a default route
  is set. Plus: test-mode pay → provisioned "ring cloud" instance with a setup UI.
- **Herald (the guy):** one-button (test-mode) provision → briefing negotiated to approval →
  morning proposals each **citing memory** → approve → posted via Callisthenes with permalink →
  weekly report.

## The units + their docs

| Epic | Unit | Living doc |
|---|---|---|
| 2.3 | Zenod — memory | [`EPIC-2.3-ZENOD-MOVE-0.md`](EPIC-2.3-ZENOD-MOVE-0.md) |
| 2.4 | Callisthenes — voice | [`EPIC-2.4-CALLISTHENES-MOVE-0.md`](EPIC-2.4-CALLISTHENES-MOVE-0.md) |
| 2.5 | The Ring — gateway/council | [`EPIC-2.5-ATOMIC-UNITS.md`](EPIC-2.5-ATOMIC-UNITS.md) |
| 2.6 | Herald Move-0 (nucleus + guy) | [`EPIC-2.6-HERALD-MOVE-0.md`](EPIC-2.6-HERALD-MOVE-0.md) |
| 3 | Multi-tenant chassis replatform | [`EPIC-3.0-CHASSIS-REPLATFORM.md`](EPIC-3.0-CHASSIS-REPLATFORM.md) |
| 4 | Herald — the product | [`EPIC-4-HERALD.md`](EPIC-4-HERALD.md) |

## Moves log (append-only)

### 2026-07-08 · operating model set + first read-up
- **Ring = Council (Jordi's spec call):** the Ring and Council collapse into one instance — a
  gateway *with* an LLM brain that sees all connected MCP tools and routes by mostly passing the
  prompt through. Deletes the separate deterministic-ring / brain-council split. **2.5 was idle since
  07-05 (never dispatched).** Now queued: `EPIC-2.5` ▶ NEXT ITERATION = rewrite the spec (Ring=Council,
  LLM brain + connect-MCP UI + per-server skills + default route), reconcile SEAM-SPEC + exit
  criterion, produce delta + ticket list. **Spec only; build waits until Zenod green + Callisthenes
  funnel.**
- **Zenod / Z-9 — ⚙️ ITERATE:** code landed (`6e967d7`) but not written into the 2.3 doc and not
  tester-verified. Next move: Worker A appends the Z-9 handback; tester verifies against the basic
  test (ask_brain cites sources). Then the funnel legs (test-mode pay → provision → dashboard) per SO-1.
- **Callisthenes — bugs GREEN, product NOT done:** #635 + #636 fixed and merged (`#643`). Unit
  builds + boots; all 5 chat-auth tools live; guardrails green; 57 tests. **Not done:** the live X
  post→permalink (C-6, needs an X test account), and **`#645`** — a real tenant-isolation seam
  (`mcp_token` is caller-asserted, not injected from the bearer) that must land before any paid /
  multi-tenant run. Commercial lanes C-3 (site+checkout) / C-4 (meter) / C-5 (watchdog) still
  blocked on `zenod-ai/cloud` access (+ Stripe, now TEST-mode per SO-1).
  ⚠ Worker routed its handback through PR `#644` (auto-merge armed), NOT inline on main, and local
  is behind origin — so the receipt isn't visible on read-up. → **SO-3 amended:** doc handbacks
  land on `main`; sync local to origin before any read-up.
- **Git note:** the planner sandbox can create files but cannot finalize commits (a stale
  `.git/index.lock` it can't remove; `.git` objects can't be unlinked). Jordi commits each artifact.
