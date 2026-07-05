# EPIC 0 · THE STORY — public positioning, website, launch materials

> **2026-07-05 · Jordi steer (voice note `AC35AB1B`).** Zenod = the open-source memory layer / framework / harness (expandable with extensions, build loops on top; usable per-project = "hire a team for a repo"). **Herald** = a product built ON TOP of Zenod — a Zenod instance with built-in loops (UI ≈ chat + voice via WhatsApp), **Epic 3**. **Launch BOTH** (the open-source Zenod repo AND Herald), market Herald, and "hire Herald for itself" → two customers to begin with. **Multi-tenant:** Jordi runs one Zenod instance for himself (self-hosting → migrate to the **TestCo** tenant) PLUS a new **Herald** instance; one phone number with per-instance WhatsApp routing (chosen at WhatsApp-connect time in the UI), a separate Telegram bot per instance; one user across tenants. Full note filed in the brain: [Log/2026-07-05.md#^e-1b73f7](https://github.com/AlfaBlok/obsidian-brain/blob/main/Log/2026-07-05.md).

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
| **E0-1** | The narrative — one page | v2 per SD-0: TWO-STORY structure — (a) the loop product's page (project memory + objective + the loop, machinery hidden, service CTA) as commercial lead; (b) Zenod-the-framework as movement/trust layer beneath. One-liner + headlines per story; names pending SD-2 | 🟡 v1 below (pre-SD-0, kept as record) — v2 next, needs SD-2 |
| **E0-2** | Positioning deck V6 | HTML deck in docs/, same craft as V5; keeps council+memory spine; loop as the payoff; hosted as the CTA; zero peer-chatter implications (council-v2 KEEP/DELETE columns respected); Jordi review → replaces V5 as "the story" reference in LAUNCH-CONTROL (Epic-0 row only) | ⚪ blocked on E0-1/SD-1 |
| **E0-3** | Website content map | Page-by-page copy plan for zenod.dev selling hosted: hero, the team, the flagship loop walked through, trust/receipts (public test board as proof), open-source page, pricing placeholder (copy only, no numbers); every page has purpose + copy + CTA; consistent with D-4 (QR pairing at launch) and D-5 (prepaid credits) states | ⚪ blocked on E0-1 |
| **E0-4** | Launch materials | Drafts exist for: announcement post; the "we test our agent for lying" essay (grounded in CANONICAL-TESTS + real scoreboard receipts); demo script for the flagship loop (maps to the REAL loop only — receipts culture applies to marketing) | ⚪ blocked on E0-1 |

**Publish gates (both required, non-negotiable):** Epic 1 soak complete · flagship loop live as
customer #0. Until then: drafts only.

## SD decisions

**SD-0 · Story architecture: is the social operation Zenod, or its own name? — OPEN (Jordi,
2026-07-04, voice).** Jordi's frame: memory at the center (the context), loops around it as the
next big idea — confirmed. But the posting operation raised the real question: is it Zenod itself,
or "an entire new product that uses Zenod under the cover" (white-label: roles + loops pre-designed,
sold as an operation)? Three candidate architectures:
- **(A) One product, flagship loop.** Zenod is the product; the posting operation is the flagship
  lane. One brand; dogfood proof accrues to the main name; landing page must sell substrate AND
  outcome at once.
- **(B) Two layers, two names.** Zenod = substrate (memory + council, open source). The social
  operation = a separately named product "powered by Zenod," sold as an outcome at agency pricing.
  Crisp message per audience; two brands to feed; platformizes before first dollar.
- **(C) One name, named operations.** Zenod ships "operations" — pre-designed bundles of roles +
  loops (the Presence operation; the Project council). One brand, but the buyable thing is a named
  configuration with its own page and outcome pricing. White-label becomes a later enterprise
  motion, not a launch brand split.
Cross-track tension to resolve inside this decision: Epic-2's settled launch SKU is the
**three-role project council** (EPIC-2 doc, Jordi 2026-07-03) while this track's inherited flagship
loop is the **public-presence operation** (decision 5). Both real; the story must pick which one a
stranger meets first.

**DECIDED 2026-07-04 (Jordi, voice): B — radically simplified. Sell the loop as its own branded
service.** His words: "the loop has its own image and it's pre-configured and it does one thing,
and we sell the loop — and its memory … we can say it uses Zenod technology, but that's kind of
incidental … I just want to sell this service … Zenod is more like a movement, your own memory —
maybe Zenod is more like a framework, and it allows you to create loops which can be sold and
branded." Constituent calls inside the decision:
- **The product is THE LOOP, undiluted:** memory + objective → miner proposes posts → poster
  publishes → replier reads replies, replies, files feedback → results compared against the
  objective.
- **Project-centered, not person-centered:** one repo = the PROJECT's memory; authentication is the
  project's accounts. This product promotes a project. (Zenod-the-movement stays about YOUR
  memory — do not betray that.)
- **Service-first:** hosted, sold as a service. Self-host is not this product's pitch.
- **Machinery hidden:** the buyer sees a chat (train the memory by talking / voice notes) and a
  backlog/queue UI, nothing else. Models, lanes, council internals pre-configured and invisible.
- **Speed:** go out with it in parallel to the product finishing.
Consequence for the nine inherited decisions: none are broken — decisions 1–7 describe the
machinery UNDER the loop product; 8–9 now apply to the loop product's brand, and Zenod's own site
carries the movement/framework story separately.

**SD-1 · The hero line — RESCOPED by SD-0.** Two hero lines now needed: the loop product's
(commercial lead) and Zenod-the-framework's (movement). Both pending SD-2.

**SD-2 · The loop product's name — OPEN (with Jordi).** SD-0 requires "its own image." Naming
direction: the category screams AI/agents; the buyable outcome is RHYTHM — a steady, on-message
public heartbeat for a project, grounded in its memory. Candidates in play (chat, 2026-07-04):
Drumbeat · Herald · Beacon · Chronicle. Steer pending.

**SD-4 · The seam is MCP — DECIDED 2026-07-04 (chat, affirmed by use).** Herald consumes Zenod
only through the public MCP protocol — no private APIs. Zenod launches standalone as "an MCP
server for project memory"; Herald is its first public customer. Two products, two brands, one
protocol seam, one image (the factory rule holds: no second codebase).

**SD-5 · The ring — CONVERGING (Jordi vision, 2026-07-04 late).** The personal front door as its
own mini-product: ONE channel connection (Baileys = one number), holding four jobs — the channel
gateway, the keyring/auth UI (apps authenticated once, possibly other vendors'), routing (smart
fan-OUT, hand-the-chat-to-a-guy), and attention rules (trained standing orders; Phylax absorbed
into the ring). Fan-IN is verbatim relay with attribution ("Herald says: …") — the ring never
composes, summarizes, or acks on a guy's behalf. Hosted Herald = a ring permanently handed to
Herald; personal = your ring fronting many guys. Constitution + council placement in chat
2026-07-04; pending Jordi confirmation.

## Cross-track requirements (Jordi carries; rule 10)

- **→ Epic 2 (Product-Fable):** SD-0 reframes the sellable unit as the branded loop service
  (project-centered, presence loop). Their settled SKU language ("three-role project council") and
  the D-6 three-tier pricing page may need re-aiming at the loop product. Not mine to decide —
  needs a Fable-table alignment pass.
- **→ Stability track:** transcription quality is now DOUBLY product-critical — the loop product's
  primary input is voice ("you train the memory by talking") and Jordi reports transcripts are
  consistently wrong ("it never gets it right"). Per the standing rule (unexpected behavior → test
  list): needs a canonical test + ticket on the engine board. Raised by Jordi 2026-07-04, receipted
  here.

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
### 2026-07-04 · [planner/Story-Fable] Promo iterations v0→v2; SD-3 one-agent framing; new journeys minted
- **SD-3 (decided by Jordi steer, session):** buyer-facing, Herald is ONE agent — one guy, memory +
  goal + tools + practice. The council/team story stays internal and on the Zenod movement side.
  Roster/"more guys" and "we test him for lying" cut from the promo (essay survives at E0-4 for the
  builder audience). Zenod appears by name once, as the open memory engine (SD-0 "incidental"
  clause amended: visible, not hidden — reversal receipted in chat).
- Promo sketches committed: v0 `eab360d` (pre-dates SHA note: v0 at `496e922` amended to exclude
  another session's staged engine files), v1 `eab360d`, **v2 `78484ce`** — memory-first arc:
  hero carries the full sentence (Jordi), memory/practice as separate concepts, negotiated-briefing
  + daily-proposals chat vignettes, market slide late, goal-centered orbit.
- **New product journeys derived from story work (route to Product-Fable / user-journeys):**
  (a) **Negotiated briefing** — onboarding produces a briefing doc (state of affairs + goal +
  contract) iterated until human approval; work starts only on approved briefing; briefing = first
  memory page. (b) **Daily proposals ritual** — scheduled run proposes N posts/day from memory,
  each citing sources; human reactions (approve/comment/"five more") are filed as memory and shape
  the next batch. Jordi's pricing signal ($100 feels like a steal → likely underpriced for a
  "hire") also routed via chat; number is Product-Fable's.

### 2026-07-04 · [planner/Story-Fable] SD-0 DECIDED — the loop is its own branded service
- Jordi (voice): sell the loop, pre-configured, one thing, project-centered (project repo memory,
  project accounts); "uses Zenod technology" incidental; service-first; machinery hidden (chat +
  backlog UI only); speed — go out in parallel. Zenod stays the movement/framework. Recorded in
  SD-0 above with his words. SD-1 rescoped (two hero lines), SD-2 (naming) opened.
- Cross-track requirements section added: Epic-2 SKU alignment + transcription-quality engine
  ticket. Jordi routes both.
- Git state note: a runner rebased this track's first four commits onto origin/main and pushed
  (now live as `4681aab`/`beed3cf`/`2333ed7`/`82ae6b5` — verified via raw.githubusercontent) but
  the SD-0-opened commit `9800209` was dropped by the same reset — recovered via cherry-pick as
  `266e99b`. This entry's commit is again LOCAL until pushed.

### 2026-07-04 · [planner/Story-Fable] SD-1 parked; SD-0 opened from Jordi's steer
- Jordi (voice, via SD-1 prompt): memory at the center + loops around it confirmed as the two
  pillars; wants checkpoints-and-steering over polished outcomes; raised the real question — is the
  social operation Zenod or a new name ("white label Zenod, build an agent loop on top … it becomes
  an operation")? Minted as SD-0 (three architectures framed above). SD-1 parked behind it.
- Flagged cross-track tension inside SD-0: Epic-2 launch SKU (project council) vs Epic-0 flagship
  loop (public presence) — which does a stranger meet first.

### 2026-07-04 · [planner/Story-Fable] Git-risk receipt
- ⚠ Commits are LOCAL (sandbox cannot push) — and the risk is LIVE, not theoretical: between this
  track's first two commits, another session ran `git reset --hard origin/main` (reflog HEAD@{1})
  and wiped them from the branch; recovered via cherry-pick as `6e7be22` + `67c85c5`, doc at
  `e9ad820` (this entry's own commit follows it). **Jordi: `git push origin main` ASAP** — until pushed, every local commit on
  this shared working copy can be silently reset away by any other session syncing to origin.
