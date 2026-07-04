# EPIC 0 · THE STORY — public positioning, website, launch materials

Owner: **Story-Fable** (planner, since 2026-07-04 per [HANDOVER-EPIC0.md](HANDOVER-EPIC0.md)) ·
Parent: [LAUNCH-CONTROL.md](LAUNCH-CONTROL.md) · Story spine: launch deck V5 → V6 (E0-2)
**Exit criterion: launch materials ready to publish the day Epic 1's soak passes and the flagship
loop is live. Draft everything; publish nothing before both gates.**

Status: 🟡 OPEN — E0-1 drafted below, SD-1 (the hero line) with Jordi.

## Contract

The ten rules of [HANDOVER-EPIC2.md](HANDOVER-EPIC2.md) §THE DOCUMENT FLOW bind this track
identically. One living doc (this one). Receipts on every claim. Story decisions are minted as
**SD-n** (namespaced so they never collide with the shared D-series, which is at D-6 on the Epic-2
track). No code, no pricing numbers (Product-Fable's), no engineering (stability-Fable's). Jordi is
the only router between tracks.

**Git note (honest):** this planner's sandbox cannot push (network-blocked) — commits land locally
on Jordi's machine; Jordi pushes, or a runner lands them via PR. Same adaptation the stability track
adopted 2026-07-04.

## The nine settled decisions (inherited — build ON them, never relitigate)

1. **The council metaphor holds.** One central mind architecturally; the council is the org chart —
   each governor keeps identity, authority, personality. "You're talking to one of the guys."
2. **A loop is a lane file.** Committed, human-readable: schedule, mission, tools, budget, throttle,
   escalation. Change it = a git commit. Your automation is a file you own, not a black box.
3. **Enable once, then it runs.** Guardrails, not supervision: throttles, spend caps, quiet hours,
   budgets that kill runaways, escalation only when judgment is needed.
4. **Two modes, one team:** talk to it (one-off ask → done-with-receipt) and standing loops. The
   bridge sentence — "make this a daily thing" — graduates an ask into a lane. Product moment.
5. **The flagship loop:** memory-fed public presence — researcher mines vault+web → proposes posts
   citing your memory → throttled queue → poster publishes → replier engages grounded → distiller
   files audience signal back. The loop learns. (diy-target deck, loops section.)
6. **Receipts are a feature.** Every claim carries a URL/commit; 23 honesty tests, append-only
   public scoreboard. We test our agent for LYING, in public. Trust story competitors can't fake.
7. **Memory remains the moat.** Your vault, your git, citations, smarter with tenure. The loops are
   what the memory is FOR.
8. **Hosted is the push; open source is the proof.** D-1: managed single-tenant, exact dogfood
   image. Self-host = credibility + funnel. The site sells hosted.
9. **Dogfood is the marketing.** Customer #0 is Zenod running Zenod's public presence; the growth
   chart is the sales page.

## Tickets

| ID | Deliverable | Acceptance criteria | State |
|---|---|---|---|
| **E0-1** | The narrative — one page | Arc memory→team→loops on one page; a one-liner; three headlines; resolves the tension (V5's "your memory and your team" grows to carry "works while you sleep" without losing the memory moat); Jordi settles SD-1 | 🟡 DRAFT v1 below — SD-1 with Jordi |
| **E0-2** | Positioning deck V6 | HTML deck in docs/, same craft as V5; keeps council+memory spine; loop as the payoff; hosted as the CTA; zero peer-chatter implications (council-v2 KEEP/DELETE columns respected); Jordi review → replaces V5 as "the story" reference in LAUNCH-CONTROL (Epic-0 row only) | ⚪ blocked on E0-1/SD-1 |
| **E0-3** | Website content map | Page-by-page copy plan for zenod.dev selling hosted: hero, the team, the flagship loop walked through, trust/receipts (public test board as proof), open-source page, pricing placeholder (copy only, no numbers); every page has purpose + copy + CTA; consistent with D-4 (QR pairing at launch) and D-5 (prepaid credits) states | ⚪ blocked on E0-1 |
| **E0-4** | Launch materials | Drafts exist for: announcement post; the "we test our agent for lying" essay (grounded in CANONICAL-TESTS + real scoreboard receipts); demo script for the flagship loop (maps to the REAL loop only — receipts culture applies to marketing) | ⚪ blocked on E0-1 |

**Publish gates (both required, non-negotiable):** Epic 1 soak complete · flagship loop live as
customer #0. Until then: drafts only.

## SD decisions

**SD-1 · The hero line — OPEN (with Jordi, 2026-07-04).** V5 leads "It's your memory and your
team." The product became loops. The question is what the first sentence a stranger reads now
promises. Options framed in E0-1 below; Jordi's taste decides. Everything downstream (V6 hero
plate, site hero, announcement lede) inherits this.

---

## E0-1 · The narrative (draft v1 — one page)

**The arc in one breath.** You centralized your context and gave it an owner. You appointed one
owner per dimension of your life, so ten agents can't wreck what one keeps. Now that team runs
standing loops — real work that happens while you sleep, fed by a memory that gets smarter every
cycle. We run it for you; the code is open so you never have to trust us.

**Act 1 · Memory — the moat (unchanged, repositioned).** Better context → better decisions, and
your context is mineable. Today you are the context bus: re-teaching every agent, ferrying context
between sessions that evaporate. The move: centralize your context in one vault — plain markdown,
your git, every fact a commit — and give it an owner. This was V5's whole story and it stays true.
What changes is its role in the story: **memory stops being the product and becomes the fuel.** The
loops are what the memory is for.

**Act 2 · Team — the order.** Some dimensions of your life need exactly one owner. Three agents
writing your memory is a junk drawer; three voices posting for you is no voice at all. So: one
librarian (Zenod, the only writer to your vault), one planner (Archus, the only door to your
backlog), one commander (Epaminon, who hires the harnesses), one guard (Phylax, the only agent
allowed to interrupt you), one herald (Callisthenes, the only holder of your outbound keys). You
don't get a seat at the Council — you run it. Wherever consistency is the value, appoint a single
owner; train him once; everyone else goes through him.

**Act 3 · Loops — the payoff (new).** Ask the Council for something and it comes back done, with a
receipt. Then say the magic sentence — *"make this a daily thing"* — and the ask graduates into a
standing loop. A loop is a thing you can hold: a lane file in your git — schedule, mission, allowed
tools, budget, throttle, escalation rules. Change it = a commit. Enable it once and it runs: no
per-item approvals, because safety is guardrails, not supervision — throttles, spend caps, quiet
hours, budgets that kill runaways, a guard who rings you only when judgment is needed. The flagship:
your public presence, run by the team — a researcher that mines your vault and proposes posts each
citing your memory, a throttled queue, a herald who publishes, a replier grounded in what you
actually know, a distiller who files what the audience taught you back into memory. The loop
learns. Your voice compounds while you sleep.

**The trust chapter · receipts.** No claim without evidence: every post, ticket, and memory carries
a URL or commit. And we hold ourselves to it in public — a canonical board of honesty tests that
tries to catch our own agent lying, scoreboard append-only, failures visible forever. Nobody else
in the category can say this, because nobody else runs it.

**The push · hosted.** Sign in, connect your repo, and we run your Council — the exact image we run
on ourselves. Your vault never lives with us; leave anytime and everything comes with you, history
included. Open source is the proof. Hosted is the product.

**Three headlines** (the site's three beats):
1. *"A team that knows everything you've told it."* — memory + council
2. *"Enable once. It runs while you sleep."* — loops
3. *"We test our agent for lying — in public."* — receipts/trust

**The one-liner — SD-1, four candidates:**
- **(A) Extend V5:** "It's your memory, your team — and it works while you sleep." *(memory-first;
  safest continuity; loop is a coda)*
- **(B) Loop-first:** "A team that knows you, working while you sleep." *(leads with the payoff;
  memory becomes the reason it's good, not the headline)*
- **(C) Ownership edge:** "Your automation is not a black box. It's a file you own." *(sharpest
  differentiation vs the agent-slop wave; asks more of the reader)*
- **(D) Evolve the mine:** "Own the mine. Now it runs itself." *(keeps V5's mining thesis as canon;
  terse; requires the reader to have met the mine)*

**Versus the category** (the answer we give when they ask): Postiz schedules your posts. Zenod is
the team that knows your company and posts for you — and shows you the receipts.

---

## Append zone (dated, role-tagged, append-only)

### 2026-07-04 · [planner/Story-Fable] Track opened
- HANDOVER-EPIC0.md recovered from orphaned commit `7232163` (ref lost to host git operations, the
  stability track's known failure mode) → recommitted on main as `8dba381`.
  `diy-target-architecture-deck.html` recovered from orphaned `3b33c72` (same failure) → committed.
- All seven sources read in handover order (V5 deck, diy-target deck, council-v2 deck, user-journeys
  deck, alpha-research deck, vault canon incl. 2026-07-03 Architecture Canon, EPIC-2 doc for D-4/D-5
  consistency).
- This doc created. E0-1 drafted (above). SD-1 put to Jordi as the single taste question.
- ⚠ Commits are LOCAL (sandbox cannot push) — Jordi: `git push origin main` when convenient.
