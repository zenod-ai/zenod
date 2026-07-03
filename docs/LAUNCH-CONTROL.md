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
7. **Where documents live: the brain.** Council documents (this one, the epics, decisions) belong in a
   `Council/` folder in the memory vault (AlfaBlok/obsidian-brain) — one consistent home, minable over
   time. Docs hold ideas and plans; some lines mint GitHub tickets; tickets always link back to their
   doc. Working copies sit in zenod/docs while Fable lacks direct vault hands; every iteration close
   mirrors them to `Council/` (mirroring is item 5 of the iteration-7 dispatch).

**Platform decisions:**

- **D-1 Hosting shape — DECIDED 2026-07-03 (Jordi): managed single-tenant.** One container per
  customer, the exact image we dogfood. Self-host stays as funnel, not product. Epic 2 unblocked.
- **D-2 Frameworks — research ticket FILED:**
  [AlfaBlok/obsidian-brain#244](https://github.com/AlfaBlok/obsidian-brain/issues/244) — what exists for
  multi-agent orchestration with evidence-based handovers; how you'd build the Zenod mini-loop from
  scratch today; is the current code salvageable; recommendation with trade-offs. Decision lands here
  when the research doc is back.

---

## The board (Fable updates; append-only history at the bottom)

| # | Epic | State | Exit criterion |
|---|------|-------|----------------|
| 1 | System Stability | 🔴 ACTIVE — iteration 7 | CANONICAL-TESTS board green ×2 consecutive builds |
| 2 | Hosted Readiness | 🟡 SCOPING | First paying customer live (Jordi = customer #0 doesn't count) |

**Now:** Epic 1, tickets S-0…S-3 (see epic). Nothing in Epic 2 may consume executor capacity while an
Epic 1 P0 is open, except D-1 (a conversation, not code).

## Operating protocol

- Jordi ↔ Fable: this document, high level. Voice notes land here as decisions/tickets, never as prose dumps.
- Fable → Archus: tickets minted from the epics, verbatim acceptance criteria.
- Epaminon workers: report deliverable URLs against tickets; comment on the epic doc, never fork a new one.
- Tester: after every deploy touching Console/outbound/execution/memory, run CANONICAL-TESTS, append scoreboard.
- Cadence: Fable reviews after each scoreboard append; rewrites the board above; flags decisions to Jordi.

## History

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
