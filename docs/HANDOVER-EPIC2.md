# HANDOVER — EPIC 2: Productization (for Product-Fable)

You are a fresh high-level Fable session. Your single concern: **turn the working system into a product
that collects money.** You do not touch Epic 1, the lanes, or the stability track — a parallel Fable
session owns those. Jordi routes between the two of you; you never coordinate directly.

**Read first:** `docs/EPIC-2-HOSTED-READINESS.md` (your living document — you own it now) ·
`docs/LAUNCH-CONTROL.md` (shared board — see write rules below) · `docs/launch-positioning-deck-v5.html`
(the story) · `docs/user-journeys-deck.html` (J7–J12) · `docs/HOSTED-PLAN-2026-07-02.md` (prior hosted
thinking) · `alpha-research-deck.html` (market: verified demand, agentic-social cluster, memory moat) ·
`docs/diy-target-architecture-deck.html` + the canon in the vault (`Projects/Zenod/Agent Suite
Architecture.md`) for the machine you're selling.

**Operating protocol (same as the stability track):** high level only — plans, tickets, decisions,
documents; no code. Receipts on everything. One living doc (the Epic 2 doc); workers append receipts to
it; never a new file per run. Workers are dispatched by Jordi pointing a local Claude Code session at
documents you write — do not dispatch through the Zenod pipeline until the stability track says it's
clean.

**Write rules for shared docs:** you own `EPIC-2-HOSTED-READINESS.md` outright. In `LAUNCH-CONTROL.md`
you may edit ONLY the Epic-2 row of the board table and append your own history entries (attributed
"Product-Fable"). Everything else on that page belongs to the stability Fable.

---

## Standing decisions you inherit (do not relitigate)

- **D-1: managed single-tenant.** One container per customer, the EXACT image we dogfood. Self-host
  stays as open-source funnel. Multi-tenant deferred until revenue proves it.
- **The launch SKU:** the memory-fed project council — vault + lanes (posting loop first). The generic
  personal council is a configuration, not the lead product.
- **Engine:** ours (DIY substrate, D-2 closed with bake-off evidence). Eve/Flue revisit at their
  maturity, gated on the canonical suite. Not your concern except: don't build product assumptions that
  contradict "same image everywhere."
- **The dogfood strategy:** Zenod sells itself — customer #0's public loop is the demo, the growth chart
  is the sales page (user-journeys deck, T0).

## Two design decisions Jordi has already framed — formalize these FIRST (D-4, D-5)

**D-4 · Hosted channel topology.** Same image, different pointing: in self-host, your WhatsApp pairs
with YOUR service; in hosted, the customer's WhatsApp pairs with OUR service (their tenant container).
Options to work through: (a) per-tenant pairing session inside the tenant container — identical to
today's mechanism, fastest, but personal-WhatsApp ToS gray zone at commercial scale; (b) WhatsApp
Business API via a BSP (Twilio/Meta) — compliant, per-message cost, template constraints for
business-initiated messages; (c) launch-pragmatic hybrid: (a) for early tenants who bring their own
number, (b) as the paved road later. Deliverable: a one-page decision with cost/compliance/UX table.
Web chat exists as the zero-friction fallback channel either way.

**D-5 · The meter.** Jordi's words: "a transparent switch in the code — if I'm the hoster, I switch it
on and calls are metered." Formalize as a `MeterProvider` seam in the model-call path: self-host default
= no-op (unlimited, local usage ledger only — the ledger ALREADY exists: usage.sqlite, per-call tokens +
cost, `read_llm_timeline`); hosted = credit meter — checks tenant credit before dispatch, decrements on
receipt, soft-warns at threshold, blocks new work at zero (Phylax tells the customer, never silent),
Stripe top-ups credit the balance. Same image, config-flag difference, open source unaffected. Note the
gift from the stability track: per-run budgets (`parseRunBudget`) and the durable ledger are the
enforcement primitives — metering is ledger + gate + billing sync, not new machinery.

## Your first deliverable: the quality backlog (refine into the Epic 2 doc, then mint tickets)

Sequenced to FIRST DOLLAR, not to completeness. Suggested shape — refine, cut, improve:

- **H-0 · Close D-4 + D-5** (the two decisions above). Everything else depends on them.
- **H-1 · Provisioning path** (exists in doc): script that stands up a tenant container + scaffolds the
  vault repo + returns console URL. Concierge-manual is FINE at launch (D-1). Accept: fresh tenant
  end-to-end <30 min, no code edits.
- **H-2 · Checkout**: zenod.dev pricing page + Stripe checkout, one plan, webhook → provisioning queue
  (manual fulfillment OK). Accept: a real card completes checkout in prod; subscription visible;
  provisioning task created.
- **H-3 · BYO credentials onboarding**: GitHub (vault repo via GitHub App), X, per D-4 the channel.
  Accept: non-technical tester connects GitHub + X unaided <20 min.
- **H-4 · Onboarding interview → first backlog** (J9). Accept: fresh tenant reaches a reviewable first
  post backlog in one session.
- **H-5 · Guardrails for strangers**: throttles, quiet hours, spend caps (D-5's meter powers this),
  approval gates. Accept: default tenant cannot exceed N posts/hour or $X/day.
- **H-6 · Public proof**: customer #0's loop in the open; TrustMRR listing at first MRR.
- **H-7 · Metering/credit build** (from D-5). Accept: hosted tenant with $5 credit runs until $0, gets
  warned, gets blocked, tops up, resumes — all receipted.
- **H-8 · Tenant channel build** (from D-4). Accept: a tenant's WhatsApp reaches THEIR council on OUR
  infra, isolated from other tenants.
- **H-9 · The website**: positioning deck V5 → zenod.dev marketing site + docs + pricing. Accept: a
  stranger understands the product and can pay without talking to Jordi.
- **H-10 · Ops minimum**: tenant backup (their vault is their git repo — leverage that), incident
  contact, support inbox. Accept: written runbook, tested restore.
- **H-11 · Legal minimum**: ToS, privacy, data-handling page (the story is GOOD here: the customer owns
  the vault repo). Accept: lawyer-sane pages linked from checkout.

**Exit criterion for Epic 2, unchanged: a stranger pays money and gets a working council attached to
their repo. Jordi is customer #0 and doesn't count.**

## Boundary with the stability track (so the two Fables never collide)

Stability-Fable owns: Epic 1 close, lanes (B1–B4), the canonical board, the engine. You own: everything
above. Shared dependency to WATCH, not build: B4's first live lane is your demo content (H-6). If you
need engine changes (e.g. the MeterProvider seam), write the requirement in your epic doc and Jordi
carries it to the stability track as a ticket — you never dispatch into their lane.

## THE DOCUMENT FLOW — the working method, learned the hard way. Follow it exactly.

This protocol was forged over one long day on the stability track. Every rule below exists because its
absence caused a real failure. It is not style; it is the operating system.

**1 · One living document per concern.** Your epic doc is the single source of truth for Epic 2. You
rewrite its state sections after every review; nobody ever creates a parallel doc, a "notes" file, or a
new file per run. Ideas, decisions, tickets, receipts — they all land in the ONE doc or in things the
doc links to (GitHub tickets, vault pages).

**2 · The cycle:** (a) you plan IN the doc — tickets with acceptance criteria and the test that proves
each; (b) when work is ready, you write a HANDOVER — a self-contained, top-to-bottom executable runbook
(steps, acceptance, receipts required, budgets); (c) **Jordi manually points a worker at it** — you do
NOT dispatch through the Zenod pipeline; (d) the worker executes, appending dated receipt entries
(URLs/SHAs) to the doc's append zone as it goes; (e) worker hands the pen back; (f) you AUDIT the
receipts — verify, don't trust — fold the state into the doc and the board, and plan the next cycle.

**3 · The pen.** One writer per document at a time, handed explicitly. While a worker executes, it holds
the pen on the handover/epic doc and you don't touch it. When it hands back, you hold it. (This applies
to you and the stability Fable too: your epic doc is yours; LAUNCH-CONTROL is shared under the row
rules; their docs are theirs.)

**4 · Receipts or it didn't happen.** Every claim of state — created, posted, merged, deployed, decided —
carries a same-turn URL, SHA, or anchor. A report without receipts is not a report. You hold workers to
this, and you hold YOURSELF to it when reporting to Jordi.

**5 · Tester ≠ fixer.** Whoever verifies never fixes in the same pass. Reds get scored, mapped to
exactly one ticket each, and handed back. (Corollary from last night: live-fire verification catches
what green unit tests miss — a budget-kill bug sailed past 155 green tests and died in one live test.)

**6 · Unexpected behavior → the test list, immediately.** Anything surprising you hit — a silent ack, a
lying summary, a flow that needs magic words — gets recorded as a test/acceptance criterion the moment
you see it (for product concerns, in your epic doc's acceptance criteria; engine concerns go to Jordi
for the canonical board). Jordi's standing rule.

**7 · Decisions get D-numbers, once.** Frame the decision, put the options and your recommendation in
the doc, get Jordi's call, record it as DECIDED with date — then never relitigate without new evidence.
(You inherit D-1/D-2/D-3; you own D-4/D-5 and onward in your domain.)

**8 · Honest board, always.** No fake-green. Unverified things are marked unverified, parked things
parked with the parker's name and date. History sections are append-only — regressions and failures
stay visible forever.

**9 · Budgets on every mission.** Every worker handover states a budget (time/turns) and the instruction
to stop honestly rather than zombie. No exceptions, including docs-only runs.

**10 · Jordi is the only router between tracks.** You never coordinate with the stability Fable
directly, never write in their lane, never dispatch into the shared pipeline. Cross-track needs are
written as requirements in your doc; Jordi carries them.

---

First move, Product-Fable: read the docs listed, then rewrite `EPIC-2-HOSTED-READINESS.md` as YOUR
living document — decisions D-4/D-5 framed for Jordi, backlog refined with acceptance criteria, first
week sequenced to a Stripe checkout that works. Then bring Jordi the one-page plan and the first
decision to make. Operate the document flow above from your first message.
