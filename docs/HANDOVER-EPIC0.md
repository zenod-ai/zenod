# HANDOVER — EPIC 0: The Story (for Story-Fable)

You are a fresh high-level Fable session. Your single concern: **the public storyline** — positioning,
narrative, website content, launch materials — updated for what the product has become. You write
story and documents; no code, no pricing (Product-Fable owns commerce on the Epic-2 track), no
engineering (stability-Fable owns Epic 1). Jordi is the ONLY router between the three tracks.

**THE CONTRACT (same document flow as every track — binding):** this document is your only source of
tasking until you replace it with your own living epic doc. Work in ONE living document you own
(create `docs/EPIC-0-STORY.md` as your first act). Receipts on everything (drafts committed with
SHAs, decisions recorded once with D-numbers). Every reply you give Jordi ends with either a
deliverable or a verbatim paste block for a worker. Workers append dated receipts to your doc and
hand the pen back. Full protocol reference: the ten rules in `docs/HANDOVER-EPIC2.md` §THE DOCUMENT
FLOW — they bind you identically.

---

## Why Epic 0 exists (the gap you're closing)

The public story (site + `docs/launch-positioning-deck-v5.html`) sells **memory**: "It's your memory
and your team." True, still the moat — but the product has since made the jump to **LOOPS**: standing
autonomous workflows that run while the customer sleeps. None of that is in the public docs. Your job:
one storyline that carries memory → team → loops, aimed at the **hosted** product as the push
(open-source/self-host stays real, but as trust + funnel, not the lead).

## The big decisions you inherit (settled — do not relitigate; build story ON them)

1. **The council metaphor HOLDS as the product story** (Jordi, explicit). Architecturally it became
   one central mind ("the Council") with powerful tools — but each governor keeps identity, authority
   and personality: Zenod the librarian (only writer to your memory), Archus the planner (owns the
   backlog), Callisthenes the voice (only one who posts), Phylax the guard (only one who pings you).
   "You're talking to one of the guys" stays true. A team is an org chart, not a network diagram.
2. **A loop is a thing you can hold: a lane file.** Committed, human-readable config — schedule,
   mission, allowed tools, budget, throttle, escalation rules. Change it = a git commit. This is
   sellable: your automation is not a black box, it's a file you own.
3. **Enable once, then it runs. No per-item approvals.** Safety is GUARDRAILS, not supervision:
   throttles, spend caps, quiet hours, budgets that kill runaways, escalation that rings you only when
   judgment is needed. "You approve once; you can nudge anytime; it goes."
4. **Two modes, one team:** talk to it (one-off asks → done-with-receipt) and standing loops (lanes).
   The bridge: "make this a daily thing" — a repeated ask GRADUATES into a lane. That sentence is a
   product moment; use it.
5. **The flagship loop** (the launch use case): memory-fed public presence — researcher mines your
   vault + the web → proposes posts (each citing your memory) → throttled queue → poster publishes →
   replier engages grounded in memory → distiller feeds audience signal back into memory. The loop
   LEARNS. Diagrammed in `docs/diy-target-architecture-deck.html` slides 5–6.
6. **Receipts are a feature, not hygiene.** No claim without evidence: every post, ticket, memory has
   a URL/commit receipt; the system's own test board (23 honesty tests, append-only scoreboard,
   `docs/CANONICAL-TESTS.md`) catches its own lies before customers see them. This is the trust story
   competitors can't fake — we test our agent for LYING, in public, and publish the scoreboard.
7. **Memory remains the moat** (unchanged from V5): your vault, your git repo, evidence + citations,
   gets smarter with tenure. The loops are what the memory is FOR.
8. **Hosted is the push; open source is the proof.** D-1 (settled): managed single-tenant, the exact
   image we dogfood. Self-host = credibility + funnel. The site sells the hosted product.
9. **Dogfood is the marketing:** customer #0 is Zenod running Zenod's own public presence — the growth
   chart is the sales page ("Zenod sells itself", `docs/user-journeys-deck.html`).

## Your source materials (read in this order)

1. `docs/launch-positioning-deck-v5.html` — the current story (memory/council). Much survives.
2. `docs/diy-target-architecture-deck.html` — the new model + BOTH loops, step by step.
3. `docs/council-v2-model-deck.html` — what changed vs what stays (keep/kill columns).
4. `docs/user-journeys-deck.html` — J1–J12, the loop journeys (already loop-shaped; under-told).
5. `alpha-research-deck.html` — the market: verified demand, agentic-social cluster, memory-moat thesis.
6. Vault canon: `Projects/Zenod/Agent Suite Architecture.md` + the architecture-canon and
   pen-protocol entries in `Log/2026-07-03..04` (via zenod search_memory).
7. `docs/EPIC-2-HOSTED-READINESS.md` — Product-Fable's track (D-4 channel, D-5 metering) — for
   consistency only; commerce is theirs.

## Epic 0 deliverables (propose refinements in your own doc, then execute)

- **E0-1 · The narrative** — one page: the story arc (memory → team → loops), the one-liner, the
  three headlines. The tension to resolve: V5's "It's your memory and your team" must grow to carry
  "…and it works while you sleep" without losing the memory moat.
- **E0-2 · Positioning deck V6** — successor to V5: keep the council + memory spine, add the loop as
  the payoff, hosted as the CTA. (HTML deck in docs/, same craft as V5.)
- **E0-3 · Website content map** — page-by-page copy plan for zenod.dev selling the hosted product:
  hero, the team, the loop (the flagship use case walked through), trust/receipts (the public test
  board as proof), open-source page, pricing placeholder (copy only — numbers are Product-Fable's).
- **E0-4 · Launch materials list** — announcement post, the "we test our agent for lying" essay
  (the canonical-board story is genuinely novel content), demo script for the flagship loop.

Constraint: nothing publishes until Epic 1's soak completes and the flagship loop is live (the demo
must be REAL — receipts culture applies to marketing too). Draft everything; publish nothing.

First move, Story-Fable: read the materials, create `docs/EPIC-0-STORY.md` as your living doc
(contract at top, deliverables as tickets with acceptance criteria, append zone), then bring Jordi
E0-1 — the narrative page — as your first deliverable, with the one question that most needs his
taste. Operate the document flow from your first message.
