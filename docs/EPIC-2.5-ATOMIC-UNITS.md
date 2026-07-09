# EPIC 2.5 · THE ATOMIC SUITE — the ring, the guys, the units

> **▶ CURRENT ITERATION (EpicSpine board active, 2026-07-09).**
> **TEST HANDOFF: READY FOR JORDI — 8/8 independent acceptance checks pass on cloud-test tenant
> SHA `cd25678`; see #672.** Production LIVE host rebinding remains a separate human gate.
> Final boundary from Jordi: **Epic 2.5 builds the cloud Ring router/control surface**. It is the
> cloud version of the quasi-working deployed Console/Council experience, but configurable through
> modular MCP servers. **Phylax is one simple channel gateway**: inbound messages go to Ring;
> outbound responses come from Ring; it does not decide, remember, summarize, archive, transcribe,
> or digest. **Zenod 2.3 owns memory media handling**: audio, screenshots/images, PDFs, Drive
> sources/archive, transcription/OCR/extraction, digest, filing, and receipts. Ring routes
> memory-bound things to Zenod's public seam.
> **Hosted/cloud implementation boundary:** `zenod-ai/zenod` is the runtime/product monorepo for
> Ring, Phylax, Zenod, guys, unit images, and in-tenant UI. The private `zenod-ai/cloud` repo is the
> hosted control plane for all cloud products, not only Zenod: public hosted surfaces, Stripe
> checkout/webhooks, deployment requests, tenant registry, Dokploy provisioning, tenant URLs,
> watchdog registration, and success/config landing live there. Epic 2.5's hosted buyer path must
> therefore be delivered across both repos: runtime changes in `zenod`; purchase→cloud deployment
> orchestration in `cloud`.
> **Billing environment rule (Jordi, 2026-07-09):** all Ring Stripe TEST checkout/provisioning
> drills move to `cloud-test.zenod.dev` with `STRIPE_MODE=test`; production customers use
> `cloud.zenod.dev` with `STRIPE_MODE=live`. Do not keep using `cloud.zenod.dev` as the test
> checkout surface once `cloud-test` is bound. Canonical decision: Epic 2 D-6A and Epic 2.3 ZD-12.
> **Active GitHub board:** #665–#672 (R-series ledger below). Dispatch work from the spine first,
> then the issue. Every worker updates this spine with receipts; GitHub issues are executable board
> rows, not the full project memory. — planner/EpicSpine, 2026-07-09

Owner: **Ring-Fable** (planner; fresh session, bootstrapped 2026-07-04 night) · Parent: [LAUNCH-CONTROL.md](LAUNCH-CONTROL.md)
Origin: Jordi × Story-Fable design session 2026-07-04 (SD-4/SD-5 in [EPIC-0-STORY.md](EPIC-0-STORY.md); promo v4 = the product this serves)
**Standing order (Jordi, 2026-07-04): all other build work pauses. This refactor is the only active
lane. Stabilization re-runs from the ground on the new topology afterward.**

**Exit criterion: a fresh user is provisioned from scratch — ring booted (their WhatsApp paired,
web UI up, keyring working) + the council guy connected as the default + Zenod wired — every box
its own container, every call over the public seam, receipts on everything. Then Epic 3 connects
Herald to the ring.**

## Roles & the document flow (binding — the ten rules of HANDOVER-EPIC2 §THE DOCUMENT FLOW apply)

Three roles, ONE document (this one): **planner** (Ring-Fable) writes tickets with acceptance +
test criteria, owns table states, audits receipts; **worker** executes tickets, appends dated
receipts (URL/SHA) to the APPEND ZONE, never self-certifies; **tester** verifies against test
criteria with fresh evidence, appends ✅/❌ scoreboard; tester ≠ fixer. Every entry dated and
role-tagged. Budgets on every dispatch. **Workers: use sub-agents aggressively** — the lanes below
are designed to run in parallel; spawn one sub-agent per lane where dependencies allow, fan results
back, receipts required from every sub-agent.

---

## THE VISION (settled 2026-07-04 — build on it, don't relitigate)

**Every box is one MCP server = one container (a unit may be a small compose, but it deploys and
sells as one atomic thing) = one repo in the zenod-ai org = one website.** Nothing is "one image
with six containers inside." Units combine by calling each other over the seam; that's the only
coupling allowed.

### The catalog

| Unit | Kind | Job | Status today |
|---|---|---|---|
| **The Ring** (RD-1 DECIDED+refined: ring = product; **Phylax** = channel-gateway container inside the ring's compose — own MCP server wrapping Baileys + Telegram, zero intelligence, exposes `send_to_user`/`get_media`) | door | Phylax gateway (inbound = MCP call into ring-core → receipt; outbound = ring-core calls `send_to_user`; web chat served by ring-core UI) · media pipeline (archive raw to Drive FIRST, then transcribe — pluggable STT) · conversation mailbox with provenance · router per amended law 3 · attention rules (committed file) · keyring UI (user auth, OAuth start, MCP token issuance, unit enable/disable; surfaces Phylax pairing) | exists FUSED inside Console — extract |
| **The Council guy** (name: RD-2) | guy | chief of staff; default route when no name matches; general asks → done-with-receipt; files memory via Zenod; dispatches Epaminon | exists as Console's brain — extract |
| **Zenod** | unit | memory owner: ingest/digest, evidence+meaning, citations; the repo behind it | exists — harden as standalone |
| **Archus** | unit | backlog owner | exists |
| **Epaminon** | unit | execution: async tools, ticket + completion event, workers with budgets | exists |
| **Callisthenes** | unit | voice: only user of outbound keys, throttle | exists (outbound/x-mcp) |
| **Herald** | guy | the paid product: smart LLM, reads briefing every turn, runs practices, scorecard | Epic 3 — NOT this epic |

### The laws (answers Jordi extracted tonight — these are the architecture)

1. **The seam is pure, standard MCP.** Nothing custom on the wire. What we add is a house
   convention — the **receipt profile**: every mutating tool returns an ID/URL or errors loudly
   (no silent acks); long-running tools return a ticket, completion arrives as an event. Units
   must conform to join the suite. Write it as a one-page spec + conformance checklist (W-D).
2. **Call shape is a tree, never a mesh.** Requests flow down (ring → guy → units), responses flow
   up the same edges. A guy MAY call another guy, but only as a typed async dispatch
   (ticket + completion event) — never conversational, never sideways, no cycles. It's function
   composition, not agents chatting. The ring relays a guy's answer VERBATIM, attributed
   ("Herald: …") — the ring never composes, summarizes, or acks on anyone's behalf.
3. **The router is cheap.** (Amended per RD-5, DECIDED 2026-07-05.) Deterministic fast path
   (explicit @name → that guy) → otherwise a lightweight LLM **classifier**, enum-constrained to
   a route (guy names, Zenod memory-verbs, default = council guy) — it picks a gate and is
   structurally unable to alter the payload. Every decision logged. Outbound is pure lookup:
   replies exit through the gate they entered (provenance on every mailbox entry). The router
   decides WHO gets the ticket. It does not think about the ticket.
4. **The mailbox lives in the ring** because the ring owns the channel: it serializes YOUR
   conversations (one turn at a time per chat, parallel across chats). Separately, every async
   unit has its own inbox for tickets/events. Two different things; don't conflate them.
5. **Media is pipe-work, not intelligence.** Voice transcription and attachment archiving happen
   in the ring's adapter/media pipeline before routing (raw-archive-first per canon: binary →
   Drive/archive, text → the routed message). Transcription quality is a known standing complaint
   (Jordi) — the pipeline must make STT pluggable, and a transcription-accuracy test enters the
   canonical list.
6. **Auth: three planes.** (a) User→ring: WhatsApp pairing / web login — only the ring
   authenticates the human. (b) System→world: OAuth starts at the keyring UI; tokens live in the
   internal connections vault (no UI, private network, pulled fresh at request time); authority ≠
   storage — only Callisthenes may pull outbound keys, only Zenod the repo token. (c) Agent→unit:
   the keyring UI issues/rotates/revokes per-unit MCP tokens. A guy (Herald, council) is
   provisioned with tokens for exactly the units he may call — he holds unit tokens, never world
   keys. Guys need no UI of their own; the keyring is where they're wired.
7. **Hosting = one instance per user per unit,** wired together at provision time. Hosting 10
   users can mean 10 rings + 10 Zenods + 5 Heralds — whatever each user enabled. No multi-tenant
   units now; the atomicity keeps that option open per-unit later.
8. **One repo per unit, same org; one website per unit.** (Execution staged via RD-4 — the split
   has real cost; see decision.)

## RD DECISIONS — framed 2026-07-05 [planner/Ring-Fable] · Jordi calls; each then recorded DECIDED with date

### RD-1 · Ring naming/scope — blocks W-G; Epic 0 consumes the name
Grounding: today's deployed Phylax (docker-compose.phylax.yml) is the headless inbound-notification
gatekeeper — exactly the attention module, one direction only.

| Option | Meaning | For | Against |
|---|---|---|---|
| **(a) Phylax = the whole door** | The ring unit ships as **Phylax**; attention rules become a module inside it; today's headless phylax container is absorbed during W-A | One name, one story — "the guard at the one door, both directions"; the name already lives in the org/infra; strongest website | Existing container repurposed — one-time migration confusion (contained inside W-A) |
| (b) "Ring" = product, Phylax = module inside | Two names for one box | Preserves today's Phylax meaning exactly | "Ring" is generic, unbrandable; two brands for one unit breaks one-unit-one-website |
| (c) Fresh name, retire Phylax | Clean slate | No baggage | Discards the one name that already has a story |

**Recommendation was (a) — overruled. DECIDED 2026-07-05 (Jordi): the Ring is the product;
Phylax is the WhatsApp gateway inside it.** Phylax = an MCP server wrapping the Baileys service,
exposing `send_to_user` etc.; an inbound WhatsApp message is an MCP call Phylax makes into
ring-core. Call shape (planner refinement, confirmed): the inbound call returns a receipt
immediately (message accepted, mailbox ID); the user-visible reply is a separate ring-core →
Phylax `send_to_user` call — slow guys never hold the wire, attention rules may decide not to
reply, proactive sends use the same path. Ring-core stays fully deterministic (rules router,
verbatim relay, no LLM). The ring unit is a small compose (ring-core + gateway adapters), and the
seam runs inside it too: Phylax↔ring-core is itself pure MCP. Today's headless phylax
(attention gatekeeper) is retired as a box; its attention logic moves into ring-core (W-A); the
Phylax NAME moves to the WhatsApp gateway.

**Refined + CLOSED 2026-07-05, iteration 2 (Jordi × planner): Phylax = its own container, NOT its
own product.** Phylax is the channel-gateway box (WhatsApp/Baileys + Telegram) — architecturally
separate (own container, own MCP server, seam-only, own unit folder → future repo) because
Baileys is the flakiest, most ToS-exposed component we run: isolating it means WhatsApp breakage,
upgrades, or a later BSP swap (Epic-2 D-4) never touch the ring's mailbox. But it deploys INSIDE
the Ring's compose and sells as part of the Ring (vision: a unit may be a small compose) — no
extra provisioning humps, ONE user-facing UI.
- **Auth chain:** user ↔ Phylax: WhatsApp QR / Telegram pairing, session state in Phylax's
  volume; Phylax serves its pairing screen, the ring's keyring UI surfaces/links it (one place).
  Phylax ↔ ring-core: keyring-issued MCP tokens auto-wired at provision. Ring ↔ Drive
  (archive/backup): OAuth at keyring. Ring ↔ STT: vault key.
- **Media flow (Phylax has zero intelligence, both directions):** inbound
  `message_received(channel, chat_id, text | media_id+meta)` → receipt; ring pulls bytes via
  `phylax.get_media(media_id)` (small voice notes may inline), **archives raw to Drive FIRST,
  then transcribes (pluggable STT), then routes on the transcript**. Images/attachments: same —
  archive, extract text if any, route.
- **Outbound is a lookup, not a decision:** every mailbox entry carries provenance
  (channel, chat_id); a guy's reply exits through the SAME gateway/chat it entered. Proactive
  sends (events) go to the channel the attention rules name. The ring never composes: unclear
  intent routes to the default guy, who asks the user — clarification is a guy's job.

### RD-2 · The council guy's name — blocks W-G; Epic 0 consumes the name
Constraint: "Council" belongs to the old fused story. The job: chief of staff — default route,
general asks → done-with-receipt, files memory via Zenod, dispatches Epaminon.

| Candidate | Why | Risk |
|---|---|---|
| **Mentor** | THE Greek steward — the man Odysseus left running his household; the myth IS the job description; instantly explicable | Common English word — weaker trademark, but on-theme with Archus/Epaminon/Callisthenes/Phylax |
| Nestor | Famed counselor of the Greeks; "council" resonance | An advice-giver, not an operator — he talks, our guy does |
| Chiron | Mentor of heroes | Trainer connotation, not steward |

**Recommendation: Mentor.**

### RD-3 · Guy→guy dispatch law — confirm law 2
**Recommendation: confirm as written, plus two tightenings:** (i) **dispatch depth ≤ 1** — a
dispatched guy may not dispatch another guy (kills chains/cycles structurally, not by convention);
(ii) every dispatch ticket **carries the originating ticket ID** so receipts trace end-to-end.
If confirmed, both become conformance items in SEAM-SPEC (W-D).

**DECIDED 2026-07-05 (Jordi): confirmed, with both tightenings.** Canonical example: ring →
council; council dispatches Herald (depth 1); Herald answers the council's ticket — final, Herald
dispatches no one; council answers the ring. Both rules go into SEAM-SPEC as conformance items.

### RD-4 · Repo split staging — gates W-F execution
| Option | For | Against |
|---|---|---|
| (a) Split now | Forces seam purity immediately; repos/websites real from day 1 | Freezes every interface on day one of a refactor; ~6× CI/publish plumbing while code is still moving; cross-repo PR storms |
| **(b) Staged** | Monorepo ≤2 more weeks; each unit made independently buildable/publishable NOW (own Dockerfile, own image, no cross-imports except a published shared lib); split when the seam spec proves stable | Requires discipline against import leaks — the W-F audit polices it |

**Recommendation: (b), with a hard split trigger: SEAM-SPEC v1 passes the tester on ≥2 units
without spec edits.** W-F delivers the per-unit audit; no split execution before this call.

**DECIDED 2026-07-05 (Jordi): (b) staged — monorepo now** ("we don't even have a product yet"),
with two additions: (i) **restructure the folders NOW** — one clearly distinct top-level folder
per unit, each with its own Dockerfile/compose/build, no cross-imports except the published
shared lib, so the eventual split is a `git filter-repo`, not a refactor; (ii) **the websites and
names launch independently NOW**, all pointing at the monorepo. Discipline enforced by the W-F
audit. Split trigger stands as recommended. W-F upgraded from memo to memo + restructure
execution.

### RD-5 · Router intelligence
| Option | For | Against |
|---|---|---|
| **(a) Rules-only** | named guy → that guy; memory verbs → Zenod path; everything else → the council guy. Unroutable impossible by construction (default exists). Deterministic, free, instant. Every routing decision logged + misroute counter | Some ambiguous messages land on the council guy that a smarter router might place better — but the council guy is exactly the "handle the ambiguous" role |
| (b) Rules + small-LLM fallback | Marginally better on ambiguous names | Cost, latency, nondeterminism at the front door; a thinking router violates law 3's spirit |

**Recommendation was (a) — overruled. DECIDED 2026-07-05 (Jordi): (b), with caveats.** Jordi's
reasoning: keyword/regex routing on natural language (especially transcribed voice notes) is
destined to fail; routing adds no intelligence to the content — it picks a gate, nothing more.
The caveats (planner, binding):
- The router LLM is an **enum-constrained classifier**: its output is restricted to a route
  (guy names + Zenod memory-verbs + default). It cannot emit prose — structurally unable to
  change a comma of the payload.
- **Deterministic fast path first:** an explicit "@name" / exact-name prefix skips the LLM.
- Every routing decision **logged** (chosen route + input digest) + misroute counter.
- **Outbound needs no intelligence:** provenance lookup per RD-1 refinement — same gate out as in.
Law 3 amended to match.

## Iteration 0 — tickets (states owned by planner; refined 2026-07-05 [planner/Ring-Fable])

| ID | Lane | State (post-audit 2026-07-05, planner) | Depends on | Budget |
|---|---|---|---|---|
| W-D | Seam spec | **DELIVERED** (`f7b3560`, 16 items — audited) → awaiting tester | — | — |
| W-F | Unit folders + split-readiness | **DELIVERED** (`212d791` — audited) → awaiting tester fresh-clone builds | — | — |
| W-A | Ring extraction (ring-core + Phylax) | **PARTIAL** — blueprint + `units/ring/` scaffold (`9615d5e`); physical carve → Iteration 1 | Iteration 1 | — |
| W-B | Council guy extraction | **PARTIAL** — blueprint + `units/council/` scaffold (`7ea673e`); carve → Iteration 1 | Iteration 1; RD-2 for final naming | — |
| W-C | Zenod standalone | **PARTIAL** — blueprint + `units/zenod/` (`629adb2`), cross-import scan clean (audited); carve → Iteration 1 | Iteration 1 | — |
| W-E | Fresh-user provisioning | **DELIVERED-THEN-AMENDED** — runbook + dry run (`8045ae9`) predates the watchdog law (`3b4da80`); watchdog gap = W-J | W-J for watchdog items | — |
| W-G | Websites skeleton | **DELIVERED** minus council page (`fc1ba86`; RD-2) | RD-2 for that page | — |
| **W-H** | Dispatch tracing: `origin_ticket_id` + depth ≤1 | **READY** (new — worker finding, audited: 0 hits in source) | — | ≤3h |
| **W-I** | Engine genericization → publishable shared lib | **READY** (new — worker finding, audited: 18 domain refs in `core/src/engine/engine.ts`) | — | ≤4h |
| **W-J** | Watchdog registration in provisioning (the law) | **READY** (new — folds `3b4da80`) | fleet watchdog exists (Epic-1 C-24 machinery) | ≤3h |

### W-D · Seam spec — DO FIRST; unblocks W-A/W-B/W-C
**Deliverable:** `docs/SEAM-SPEC.md`, ≤2 pages: transport (pure standard MCP over streamable HTTP;
nothing custom on the wire) · **receipt profile** (every mutating tool returns an ID/URL/SHA or
errors loudly — a silent ack is nonconformant; long-running tools return `{ticket_id}`, completion
arrives as an event carrying the same `ticket_id`) · auth plane (per-unit bearer token issued by
the keyring) · **conformance checklist** of binary pass/fail items. Include RD-3 tightenings if
confirmed (depth ≤1, originating-ticket-ID propagation).
**Acceptance:** ≤2 pages · checklist ≥10 binary items spanning transport/receipts/tickets/errors/
auth · references zero zenod-internal types — a stranger with only an MCP SDK could conform.
**Test criteria:** tester applies the checklist to Archus as-is; pass/fail per item with tool-call
transcript evidence; demonstrates ≥1 real receipt and ≥1 loud-error case.

### W-A · Ring extraction
**Scope (per RD-1 DECIDED + refined):** the Ring unit = one small compose of TWO boxes.
**Phylax** (own container, own unit folder): channel gateway wrapping Baileys (WhatsApp) +
Telegram, zero intelligence, session state in its own volume, serves its pairing/QR screen;
exposes `send_to_user`, `get_media`; inbound = `message_received(channel, chat_id, text |
media_id)` MCP call into ring-core, receipted immediately.
**ring-core** (deterministic): conversation mailbox with provenance (channel, chat_id),
serializing per chat / parallel across chats · router per amended law 3 (fast path @name →
enum-constrained small-LLM classifier; decisions logged; misroute counter) · attention rules from
a committed file — absorbs today's headless phylax logic · verbatim relay · media pipeline
(pull bytes via `get_media`, **archive raw to Drive FIRST, then transcribe** — pluggable STT —
then route on transcript) · keyring UI: user auth, OAuth start, MCP token issue/rotate/revoke,
unit enable/disable, surfaces Phylax pairing · web chat served here.
Console's channel/routing code MOVES here. Out of scope: any brain/guy logic (W-B).
**Acceptance:** builds + deploys as one compose unit · all conversation I/O enters/exits ONLY
through Phylax or the web chat · Phylax↔ring-core and ring→guys/units traffic is W-D-conformant
MCP · inbound calls return receipts, never block on a guy's turn · the relay path structurally
contains no text-generation call · the router classifier's output type is a route enum (cannot
emit prose) · replies exit via provenance lookup — same gate in, same gate out · keyring UI
issues a working per-unit token and unit disable actually refuses calls.
**Test criteria:** fresh boot → pair WhatsApp via QR (reached from keyring UI) · "hello" →
routed to default guy → reply relayed with "Name: …" attribution on WhatsApp · voice note →
raw file in Drive archive BEFORE routing → transcript routed; a voice note naming a guy routes
to that guy · reply to a web-chat message arrives in web chat, not WhatsApp · transcript
inspection: zero ring-composed text · disable a unit in keyring → its calls refused ·
routing log shows one entry per message.

### W-B · Council guy extraction
**Scope:** Console's brain → own container behind an MCP shell; provisioned via keyring with unit
tokens (Zenod/Archus/Epaminon) ONLY — holds no world keys, no channel/adapter code; turn-preamble
pattern (reads standing directives from memory each turn).
**Acceptance:** only ingress = seam MCP · memory verbs go through Zenod over the seam · Epaminon
dispatch = typed ticket + completion event per W-D · container image contains no adapter code.
**Test criteria (via ring):** "remember X" → reply cites Zenod commit SHA · "what did I say about
X" → answer with citation · one Epaminon dispatch round-trips: ticket receipt, then completion
event surfaces back through the ring, attributed.

### W-C · Zenod standalone
**Acceptance:** no caller imports Zenod internals (cross-import scan clean) · access = public seam
only · standalone README + quickstart (MCP endpoint + your repo) a stranger can follow · only
Zenod holds the repo token.
**Test criteria:** external plain-MCP client (e.g. Claude) does store/search/get against a FRESH
instance using only the README · any attempt to write the repo from another path fails loudly.

### W-E · Fresh-user provisioning
**Scope:** script/runbook standing up the ring+council+Zenod instance-set for a new user, tokens
wired via keyring, no code edits; leverages Epic-2 H-1.
**Acceptance:** runbook is self-contained top-to-bottom · target <30 min · provisioning emits
receipts (container IDs, token IDs, repo URL). Worker delivers the runbook and ONE dry run with
receipts — the verdict run belongs to the tester.
**Test criteria:** tester provisions a fresh user following ONLY the runbook, timed · E2E smoke:
voice note → transcript → filed via council → "what did I say" → cited answer. This IS the epic's
exit criterion.

### W-F · Unit folder restructure + split-readiness (upgraded per RD-4 DECIDED)
**Deliverable:** (1) monorepo restructured: one clearly distinct top-level folder per unit
(ring-core, phylax, council guy, zenod, archus, epaminon, callisthenes), each with its own
Dockerfile + compose + independent build; shared code only via the published shared lib;
(2) cross-import audit: per unit, blocking imports named, removal mapped to a ticket;
(3) split plan with the RD-4 trigger (SEAM-SPEC v1 passes tester on ≥2 units without edits) —
so the eventual split is a `git filter-repo`, not a refactor.
**Acceptance:** repo tree shows the per-unit folders · each unit's image builds from its folder
alone · cross-import scan clean OR every exception listed with its removal ticket.
**Test criteria:** tester builds every unit image independently from a fresh clone; scan re-run.
NO repo split before the RD-4 trigger fires.

### W-G · Websites skeleton
**Per RD-4 DECIDED: sites and names launch independently NOW, all pointing at the monorepo.**
Static one-pager per unit: Ring (Phylax featured as its gateway, not a separate product), Zenod,
Archus, Epaminon, Callisthenes. Council guy's page BLOCKED on RD-2 only. Content may lag. No
tester criteria this iteration.

### W-H · Dispatch tracing: `origin_ticket_id` + depth ≤1 (minted 2026-07-05 from worker finding)
**Why:** RD-3's tightenings are LAW and SEAM-SPEC items 10/11 — but audited at **0 hits** in
source. Every dispatch in the live path today would fail conformance.
**Deliverable:** the dispatch path (engine/Epaminon/Archus ticket flow) carries
`origin_ticket_id` end-to-end and enforces depth ≤1 (a dispatched unit refuses to emit a further
dispatch, loudly).
**Acceptance:** grep shows the field in the ticket schema + both enforcement points · a depth-2
attempt errors loudly with a structured code.
**Test criteria:** SEAM-SPEC items 10/11 pass against Epaminon; forced depth-2 dispatch returns
the structured refusal, transcript attached.

### W-I · Engine genericization → publishable shared lib (minted 2026-07-05 from worker finding)
**Why:** the RD-4 staged split allows cross-unit code ONLY via a published shared lib —
but `core/src/engine/engine.ts` hard-references whatsapp/telegram/backlog/notification
(audited: 18 refs). As-is it can't be the shared lib; this blocks the split.
**Deliverable:** domain refs extracted behind interfaces/adapters; engine package builds with
zero channel/domain imports; publishable as the shared lib named in units/README.
**Acceptance:** `grep -cE "whatsapp|telegram|backlog|notification" core/src/engine/engine.ts`
= 0 · engine package builds standalone · existing Console behavior unchanged (canonical smoke).
**Test criteria:** tester re-runs the grep + standalone build on fresh clone; Console smoke green.

### W-J · Watchdog registration in provisioning (minted 2026-07-05; folds law `3b4da80`)
**Why:** LAW (Jordi, via stability-Fable): "no instance without its watchdog." W-E's runbook
(`8045ae9`) predates the law and lacks fleet-watchdog registration.
**Deliverable:** provisioning registers every container of the instance-set with the fleet
watchdog (fleet-level C-24 machinery: crash-loop / disk / dead-endpoint / dark-stack → operator
alert); runbook amended; provisioning receipt includes the monitoring registration.
**Acceptance:** a provisioned tenant's containers appear in fleet-watchdog coverage; the receipt
shows the registration.
**Test criteria:** provision fresh tenant → containers visible in watchdog · force one
crash-loop on the fresh tenant → operator alert arrives (mirrors Epic-1 C-24 live-fire).

## Iteration 1 — the carve (sketched 2026-07-05 post-audit; dispatched after tester results)

The worker's deferral of the physical W-A/W-B/W-C carve was RIGHT for the wrong reason: RD-4
gates the *repo* split, not the in-repo carve — but parallel sub-agents blindly carving ONE fused
core against the live product would have broken it. Iteration 1 does the carve **serialized**, on
the blueprints: order **W-I → W-H → W-A (ring-core + Phylax) → W-B (needs ring for via-ring
tests) → W-C → W-E re-run + W-J**. Iteration-1 exit = the epic's exit criterion (fresh user on
the NEW topology, watchdog included), run by the tester. RD-4's repo-split trigger is evaluated
from the tester's W-D scoreboard (spec unedited across ≥2 units).

**Iteration 0 exit = the epic's exit criterion run by the TESTER on a fresh user, all receipts in
this doc.** Canonical tests: after exit, the stability suite re-baselines on the new topology
(fresh-user setup test joins the canonical list; transcription accuracy joins the list).

## Boundaries

- **Epic 0 (Story-Fable)** continues on positioning/promo; consumes RD-1/RD-2 names; does not build.
- **Epic 2 (Product-Fable)** machinery (Stripe, credits/meter D-5, provisioning) is INPUT to W-E;
  commerce stays theirs; meter attaches to guy LLM keys per tenant.
- **Epic 3 (Herald)** starts only after this epic's exit: Herald = new guy container + briefing
  pack + practices, connected to an already-working ring. Weekend dogfood (supervised posting via
  existing fused Console) may run in parallel — it does not touch this lane.
- Jordi is the only router between tracks. LAUNCH-CONTROL board update is Jordi's (or via
  stability-Fable's pen) — this doc does not edit that page.

## HANDOVER — ITERATION 0 (written 2026-07-05 [planner/Ring-Fable]; Jordi dispatches manually)

### Dispatch block A — the worker (paste verbatim into a fresh local session)

```
You are Worker-1 of EPIC 2.5 Iteration 0. Repo: zenod-ai/zenod.
Read docs/EPIC-2.5-ATOMIC-UNITS.md top to bottom — the only source of truth. The ten rules of
docs/HANDOVER-EPIC2.md §THE DOCUMENT FLOW bind you. You hold the pen on the APPEND ZONE only;
never edit tickets, states, laws, or decisions.

Mission: execute Iteration-0 tickets W-D, W-A, W-B, W-C, W-E, W-F, W-G (for W-G: all pages
except the council guy's while RD-2 is undecided — skip that page and note the block).

Order: W-D first, alone, to completion — SEAM-SPEC gates everything. W-F and W-G may start in
parallel with W-D. Then you MUST fan out parallel sub-agents, one per lane: W-A, W-B, W-C.
W-E starts only when W-A/W-B/W-C hand back. Parallelism is mandatory, not optional: use the
workflow feature / agent teams if your harness supports them, otherwise the Task tool — either
way the lanes run CONCURRENTLY, and a lane may split further (e.g. W-A into ring-core + Phylax
sub-lanes) when its internal seams allow. Every sub-agent gets its ticket text, its budget from
the ticket table, and the receipt rule below; results fan back to you.

Receipts: every sub-agent appends dated, role-tagged entries ([worker/W-x] YYYY-MM-DD) to the
APPEND ZONE as it goes — commit SHAs, URLs, container IDs, transcript paths. No receipt = it
didn't happen. Never self-certify acceptance: write what you did plus evidence; the tester
scores it. Anything surprising you hit → record it as a proposed test criterion in your entry.

Do NOT run the fresh-user E2E verdict yourself — that is the tester's. W-E delivers a runbook
plus one receipted dry run, not a verdict.

Budget: one working day wall-clock this session; per-lane budgets in the ticket table. If
blocked (missing decision, access, failing dependency), append a dated BLOCKED entry naming
exactly what you need and stop honestly. Never zombie.

Hand back: final APPEND ZONE entry "[worker] Iteration-0 hand-back" — per-ticket status
(done/partial/blocked) with pointers to receipts. Then stop; the pen returns to Ring-Fable.
```

### Dispatch block B — the tester (rescoped 2026-07-05 post-audit; dispatch now)

```
You are Tester-1 of EPIC 2.5 Iteration 0. Repo: zenod-ai/zenod. Precondition: the APPEND ZONE
of docs/EPIC-2.5-ATOMIC-UNITS.md contains "[worker] Iteration-0 hand-back". If absent, stop.

Read that doc top to bottom; docs/HANDOVER-EPIC2.md §THE DOCUMENT FLOW binds you. You are the
tester, NOT the fixer: change no code, no config, no doc content except your own APPEND ZONE
entries. Every red is scored, mapped to exactly one ticket ID, and handed back — you fix nothing.
Verify with FRESH evidence — reproduce; never reuse worker receipts as proof.

Scope (post-audit — extraction was staged, so test what EXISTS, honestly):
1. W-D: apply the 16-item SEAM-SPEC conformance checklist to BOTH Archus and Epaminon (two
   units — this also evaluates the RD-4 split trigger). Pass/fail per item per unit with
   tool-call transcripts. Items 10/11 are expected-red today → map those ❌ to W-H (known gap);
   any OTHER red maps to its own finding.
2. W-F: on a FRESH clone, build each unit image independently from its folder; re-run the
   cross-import scan. Pass/fail per unit.
3. W-E (the exit dry-run, on the CURRENT fused tenant stack): provision a brand-new tenant
   following ONLY units/PROVISIONING-RUNBOOK.md — no help, no code edits, timed (<30 min
   target). Then E2E: pair WhatsApp → "hello" → attributed reply · voice note → transcript →
   filed via the council brain → "what did I say about it" → answer with Zenod citation · one
   Epaminon dispatch round-trips ticket + completion event. Watchdog items (containers visible
   in fleet watchdog; forced crash-loop on the fresh tenant → operator alert) are expected-red
   → map to W-J.
4. W-A/W-B/W-C: do NOT fake-run container tests that need the carve. Score each NOT-TESTABLE
   (carve staged to Iteration 1), and instead VERIFY their blueprints' checkable claims
   (extraction maps reference real files; scaffolds build if they claim to).

Append one dated scoreboard entry ([tester] YYYY-MM-DD): one ✅/❌/NOT-TESTABLE line per test
criterion, evidence link on every line, every ❌ mapped to exactly one ticket ID. Surprises
become proposed test-list entries in your notes.

Budget: 4h. If the W-E runbook blocks you >30 min, that IS a result — score W-E ❌ with the
blocking step named, and continue with whatever else is testable. Stop honestly. Never zombie.
```

## APPEND ZONE (dated, role-tagged, append-only — receipts or it didn't happen)

### 2026-07-04 · [scribe/Story-Fable] Doc created
- Materializes the 2026-07-04 night design session (Jordi × Story-Fable). Vision, laws, catalog,
  RD decisions, Iteration-0 lanes. Pen hands to Ring-Fable on bootstrap.

### 2026-07-05 · [planner/Ring-Fable] RD framing + tickets + handover
- RD-1..RD-5 framed with options + recommendations (§RD DECISIONS) — awaiting Jordi's calls.
  Recommendations: RD-1 (a) Phylax = the whole door · RD-2 Mentor · RD-3 confirm + two
  tightenings · RD-4 (b) staged split with hard trigger · RD-5 (a) rules-only.
- Iteration 0 refined into tickets with states, dependencies, budgets, acceptance + test
  criteria (§Iteration 0). W-D first; W-F parallel; W-A/W-B/W-C fan out after W-D; W-E last;
  W-G blocked on RD-1/RD-2.
- §HANDOVER — ITERATION 0 written: dispatch block A (worker) + B (tester). Worker can start
  before RD calls land (only W-G is name-blocked). Pen stays with Ring-Fable until Jordi
  dispatches the worker.

### 2026-07-05 · [planner/Ring-Fable] RD-1 DECIDED (Jordi, same day)
- **Ring = the product; Phylax = the WhatsApp gateway adapter inside it** (MCP server wrapping
  Baileys, exposes `send_to_user` etc.; inbound WhatsApp message = MCP call from Phylax into
  ring-core). Planner refinement confirmed into the call shape: inbound returns a receipt
  immediately; reply is a separate ring-core → Phylax `send_to_user` call. Catalog row, RD-1
  section, and W-A/W-G tickets updated to match. Old headless-phylax box retires; its attention
  logic moves to ring-core; the name moves to the gateway.
- Still awaiting calls: **RD-2** (council guy's name — rec: Mentor), **RD-3** (confirm law 2 +
  two tightenings), **RD-4** (split staging — rec: staged), **RD-5** (router — rec: rules-only).

### 2026-07-05 · [planner/Ring-Fable] Iteration 2 with Jordi — RD-1 refined+closed; RD-3/4/5 DECIDED
- **RD-1 refined (closed):** Phylax = own container, NOT own product — channel gateway
  (WhatsApp/Baileys + Telegram) inside the Ring's compose; pairing surfaced via keyring UI; auth
  chain user↔Phylax↔ring↔Drive/STT; transcription lives in ring-core (archive raw FIRST, then
  transcribe, then route); outbound = provenance lookup, same gate out as in; clarification is
  the default guy's job, never the ring's. §RD-1, catalog, W-A rewritten to match.
- **RD-3 DECIDED:** law 2 confirmed + depth ≤1 + originating-ticket-ID. Into SEAM-SPEC (W-D).
- **RD-4 DECIDED:** staged — monorepo now; per-unit top-level folders + independent builds NOW;
  websites/names launch NOW pointing at the monorepo; split at the trigger. W-F upgraded to
  restructure execution (READY, ≤4h).
- **RD-5 DECIDED (overrules rec):** enum-constrained small-LLM classifier by default, @name fast
  path, all decisions logged, outbound deterministic. Law 3 amended.
- **RD-2 remains the only open decision** (council guy's name; rec: Mentor). Blocks only his
  website page. Dispatch block A updated: W-G in scope minus that page; workflow/agent-teams
  parallelism made explicit.

### 2026-07-05 · [worker/W-D] SEAM-SPEC v1 delivered — gate lands
- Deliverable: [docs/SEAM-SPEC.md](SEAM-SPEC.md) · commit `f7b3560`.
- ≤2 pages · **16 binary conformance items** spanning transport (1–2), receipts (3–5), tickets
  (6–8), dispatch/RD-3 (9–11), auth (12–14), errors (15), stranger-readability (16) — exceeds the
  ≥10 acceptance bar.
- RD-3 tightenings folded in: dispatch depth ≤1 (item 10), `origin_ticket_id` propagation (item 11).
- Grounded, not invented: the receipt profile promotes the repo's lived pattern (mutating tools
  return `evidence[]` with `_created/_sent/_stored` handles carrying url/commitSha; long tools
  `task_brain`/`run_task`/`store_memory` enqueue a job id polled via `get_task_result`).
- References zero zenod-internal types (item 16 self-applies). Split trigger (RD-4) explicitly
  coupled: no physical split until SEAM-SPEC passes tester on ≥2 units.
- Handoff to tester: apply items 1–16 to Archus as-is (W-D test criteria) — worker does NOT
  self-certify; ≥1 real receipt + ≥1 loud-error case required in the transcript.
- **Proposed test criterion (surprise/rule 6):** some existing Console tools return `text`-only
  replies on mutating paths (candidate silent-ack sites) — the tester should spot-check items 3/4
  against the live Console tool surface, not only Archus.
- W-D COMPLETE. W-A/W-B/W-C unblocked; fanning out sub-agents next.

### 2026-07-05 · [worker/W-G] Website skeletons — 5 units, council page blocked
- Deliverable: `sites/` — 5 self-contained one-pagers · commit `fc1ba86`.
- Pages: [ring](../sites/ring/index.html) (Phylax featured as its gateway, no separate page per
  RD-1), [zenod](../sites/zenod/index.html), [archus](../sites/archus/index.html),
  [epaminon](../sites/epaminon/index.html), [callisthenes](../sites/callisthenes/index.html) +
  [sites/README.md](../sites/README.md).
- Each: no external CDNs, inline CSS, responsive, emoji favicon; footers point at the monorepo
  (RD-4). apps/site untouched.
- **Blocked (correct):** council-guy page NOT created — RD-2 (name) undecided; noted in
  sites/README.md. Herald skipped (Epic 3). W-G done modulo the RD-2 block.

### 2026-07-05 · [worker/W-F] Repo-split memo + build-independence audit
- Deliverables: [docs/EPIC-2.5-REPO-SPLIT-MEMO.md](EPIC-2.5-REPO-SPLIT-MEMO.md) + [units/README.md](../units/README.md)
  (target layout, filter-repo doctrine) · commit `212d791`.
- **Per-unit buildable-today verdict: ALL NO.** Root cause verified: one image / one
  `@zenod/server` / one `Runtime`, switched at boot by `AGENT` env
  (`main.ts:23 resolveAgent` — confirmed). Every `docker-compose.<unit>.yml` builds the same root
  Dockerfile. Carve difficulty: Callisthenes EASY, Archus/Epaminon/Zenod MEDIUM, Ring/Council HARD.
- Top-3 blocking cross-imports (the shared shell): `runtime.ts:38/40/41` god-Runtime unconditional
  builders; `settings.ts:Settings` ambient store; `app.ts:35`/`mcp.ts` single HTTP+MCP shell.
- **Good-news finding:** inter-unit calls are ALREADY pure MCP-over-HTTP
  (`peerClient.ts:StreamableHTTPClientTransport`) — the seam is real; the carve is
  shell-decomposition, not spaghetti-untangling. Split gates G0–G5 dated off the RD-4 trigger; no
  carve before G1.
- **Proposed follow-up (surprise/rule 6, outside W-F's pen):** `packages/core/engine.ts` is not
  domain-generic (hard-refs whatsapp/telegram/backlog/notification) → blocks publishing it as the
  shared lib; needs its own ticket for planner.

### 2026-07-05 · [worker/W-B] Council-guy extraction blueprint + scaffold
- Deliverable: `units/council/` (README, SEAM-SURFACE, EXTRACTION-MAP, Dockerfile+compose stubs)
  · commit `7ea673e`.
- Brain core mapped file-level: `engine/engine.ts` (createEngine/handleTasking/chat) MOVE;
  `taskingPolicy.ts`/`replyGate.ts`/`approvalTokens.ts` MOVE; `runtime.ts` = **the fusion point**
  (createEngine fused with WhatsApp/Telegram gateways) SPLIT; `mcp.ts` SPLIT (Zenod memory tools
  STAY, `ask_brain`/`task_brain` door MOVES).
- Cross-imports named: brain→adapters via `runtime.ts` (WhatsAppGateway/Store, TelegramGateway);
  brain→Zenod internals via `engine/engine.ts` importing `vault/*`,`ops/*`,`git/*` (verified
  present at lines 28–36) — each must become a `callPeer(zenod,…)` seam call.
- **Proposed test criterion (surprise/rule 6, verified):** RD-3 items 10–11 are UNIMPLEMENTED in
  code — `origin_ticket_id`/`depth` have **0 hits** in `packages/server/src` (I re-confirmed);
  `runtime.ts:queueExecution` + `POST /api/exec/enqueue` send `{target,title,context}` only.
  SEAM-SPEC items 10/11 will FAIL against the live dispatch path today. Flag for planner.
- RD-2 block: `<COUNCIL_NAME>` marks every substitution site; `AGENT=council` currently falls
  through `resolveAgent` to default (no `COUNCIL_AGENT` yet). Blueprint only; no code unfused.

### 2026-07-05 · [worker/W-A] Ring extraction blueprint + scaffold
- Deliverable: `units/ring/` (README, SEAM-SURFACE per SEAM-SPEC, EXTRACTION-MAP, Dockerfile+compose
  stubs) · commit `9615d5e`.
- Top moves mapped: `whatsappStore.ts` (839 LOC) → ring-core mailbox (generalize to
  (channel,chat_id)); `whatsappGateway.ts` (1272) SPLIT Baileys→phylax / relay+transcribe→ring-core;
  `notifierTools.ts`+`notificationBus.ts` → attention rules as committed file;
  `transcribe/channelAudio/voiceArchive/drive` → media pipeline WHOLE; `oauth/auth/settings` →
  keyring UI (world keys must exit settings into the vault, law 6b).
- THE blocker verified: `whatsappGateway.ts:14 import {BrainEngine} from "zenod"` →
  `engine.handleTasking` (:818 etc.) — gateways call the brain **in-process**; web+mesh chat doors
  (`app.ts:1837/2071`) do the same.
- **Structural finding (surprise/rule 6):** there is NO standalone router/mailbox today — the fused
  `engine/engine.ts` IS the de-facto router+brain (what W-B extracts). Ring-core's
  enum-classifier router (RD-5) + decision log + committed-rules attention module are **NET-NEW**,
  not a move. Real work item for the physical carve.
- Blueprint only; zero fused code moved; live Console still builds.

### 2026-07-05 · [worker/W-C] Zenod standalone blueprint + scaffold
- Deliverable: `units/zenod/` (stranger-followable README quickstart, SEAM-SURFACE, EXTRACTION-MAP
  with cross-import scan + token audit, Dockerfile+compose stubs) · commit `629adb2`.
- **Cross-import scan CLEAN (W-C's key acceptance signal, VERIFIED):** no caller imports Zenod
  internals by deep path — `from "zenod/…"` = 0 hits in real source (the only grep hits are W-C's
  own doc quoting the command; I re-ran and confirmed). Every consumer goes through the `zenod`
  package barrel (`core/src/index.ts`), mostly `import type` — 18 files listed in EXTRACTION-MAP §C.
- **Token audit VERIFIED:** vault repo token read ONLY at `runtime.ts:293 getRepo()` →
  `settings.get("vault_repo")`+`settings.get("github_token")` → `VaultRepo` (sole memory-repo
  writer). Other `github_token` reads (`executionLane.ts:51` Epaminon PRs, `runtime.ts:876`/
  `backlog.ts` Archus backlog) are DIFFERENT repos/authority — the fused single-token overload is
  exactly what the split resolves. Confirmed: a vault write from another path has no credential →
  fails loudly (satisfies W-C's second test criterion by construction).
- Core moves: `engine/engine.ts`,`ops/*`,`vault/*`,`git/vaultRepo.ts`,`git/queue.ts` MOVE-WHOLE;
  `mcp.ts`/`runtime.ts`/`settings.ts`/`agent.ts` SPLIT (memory handlers + getRepo + ZENOD_AGENT are
  Zenod's). Blueprint only; live Console buildable.

### 2026-07-05 · [worker] Fan-out complete — W-A/W-B/W-C handed back; W-E starting
- All three extraction lanes returned grounded, spot-checked blueprints + `units/<unit>/` scaffolds.
  Convergent finding across W-A/W-B/W-F: the fused `packages/core/src/engine/engine.ts` + the
  `AGENT`-switched single `Runtime`/image is THE shell to decompose; the inter-unit seam is already
  pure MCP-over-HTTP (`peerClient.ts`), so the carve is shell-decomposition, not untangling.
- Two convergent surprises promoted to proposed test criteria (for planner/tester): (1) RD-3
  `origin_ticket_id`/`depth` unimplemented in the live dispatch path → SEAM-SPEC items 10/11 fail
  today; (2) `core/engine.ts` not domain-generic → blocks shared-lib publication, needs its own
  ticket. W-E now proceeds against the CURRENT working topology.

### 2026-07-05 · [worker/W-E] Fresh-user provisioning runbook + dry-run receipt
- Deliverable: [units/PROVISIONING-RUNBOOK.md](../units/PROVISIONING-RUNBOOK.md) · commit `8045ae9`.
- Self-contained top-to-bottom, 7 steps, receipt named on every step (tenant name → Dokploy service
  ID → env → 6 container IDs + TLS URL → minted token IDs + Console api_token → Phylax bridge →
  channel handle + vault repo URL). Target < 30 min. Leverages Epic-2 H-1 concierge path
  (`docker-compose.tenant.yml`, I1-4 PASS).
- CURRENT topology (fused `AGENT`-switched stack) is the live path; **[TARGET]** deltas for the
  atomic ring+council+zenod split are marked but staged (physical extraction not yet done).
- **Dry run (worker, receipted, NOT the verdict):**
  `docker compose -f docker-compose.tenant.yml config --services` (ZENOD_IMAGE_TAG=latest,
  TENANT_NAME=dryrun) → **exit 0**, resolves 6 services — validates the compose/env step without any
  outward/VPS action.
- **Deliberately left to tester (honest):** the live Dokploy provision, the < 30 min timing, and the
  E2E smoke (voice → transcript → filed via council → cited answer + one Epaminon round-trip). Those
  are the tester's verdict run per Dispatch block B (blocked here on Dokploy access + Jordi's
  no-manual-deploy rule).

### 2026-07-05 · [worker] Iteration-0 hand-back
Pen returns to Ring-Fable. Per-ticket status with receipt pointers:

| Ticket | Status | Receipt |
|---|---|---|
| **W-D** Seam spec | **DONE** | [SEAM-SPEC.md](SEAM-SPEC.md) · `f7b3560` · 16 binary items |
| **W-F** Repo-split memo + audit | **DONE** | [EPIC-2.5-REPO-SPLIT-MEMO.md](EPIC-2.5-REPO-SPLIT-MEMO.md) + [units/README.md](../units/README.md) · `212d791` |
| **W-A** Ring extraction | **PARTIAL** (blueprint + `units/ring/` scaffold; physical carve staged per RD-4) | `9615d5e` |
| **W-B** Council extraction | **PARTIAL** (blueprint + `units/council/` scaffold; RD-2 name blocks final wiring) | `7ea673e` |
| **W-C** Zenod standalone | **PARTIAL** (blueprint + `units/zenod/` scaffold; cross-import scan CLEAN, token audit done) | `629adb2` |
| **W-E** Provisioning | **DONE** (runbook + dry run); live verdict = tester | `8045ae9` |
| **W-G** Websites | **DONE** except council page (RD-2-blocked) | `fc1ba86` |

**Why W-A/W-B/W-C are PARTIAL, honestly:** the three lanes all carve from ONE fused Console; a blind
parallel physical extraction would break the live product, and RD-4's split trigger (SEAM-SPEC
passes tester on ≥2 units) has NOT fired — so I am not authorized to execute the physical split this
iteration. Each lane delivered the hard, grounded, spot-checked prerequisite: file-level extraction
maps + seam surfaces + unit scaffolds, so the eventual split is a `git filter-repo`, not a discovery
refactor. Live Console remains buildable (only new `units/` + `sites/` files added; zero fused code
moved).

**For the planner (Ring-Fable) — items needing decisions/tickets:**
1. **RD-2** (council guy's name) still open — blocks W-B final wiring + the council website page.
2. **New ticket proposed:** implement RD-3 `origin_ticket_id` + dispatch `depth` — 0 hits in the
   live dispatch path today; SEAM-SPEC items 10/11 will FAIL against Archus/Epaminon as-is.
3. **New ticket proposed:** make `packages/core/src/engine/engine.ts` domain-generic (it hard-refs
   whatsapp/telegram/backlog/notification) — blocks publishing it as the shared lib the split needs.
4. Physical extraction (W-A/W-B/W-C code carve) is READY to schedule once the split trigger fires;
   the maps make it mechanical, ordered by W-F carve-difficulty (Callisthenes → Archus/Epaminon/
   Zenod → Ring/Council).

Tester (Dispatch block B) may now run: W-D checklist vs Archus, and the W-E fresh-user E2E.
Worker stops here.

### 2026-07-05 · [cross-track/stability-Fable, on Jordi's direct order] W-E amended — the watchdog law
- Jordi's directive (routed via the stability table): **"no instance without its watchdog"** added to
  W-E as LAW — provisioning includes fleet-monitoring registration; a tenant without active monitoring
  is not provisioned. Rationale: Epic 1's operational lessons (silent 3,348× crash-loop, disk-full
  outage #570, C-24 live-fire) multiply by the fleet under one-instance-per-user-per-unit — the
  machinery must exist ONCE at fleet level, provisioned WITH each tenant, not rediscovered at
  customer #10. W-E scope/acceptance/test criteria updated in place (attributed inline).
- Ring-Fable owns folding this into W-E's dispatch; no other ticket touched. Pen returned.

### 2026-07-05 · [planner/Ring-Fable] Worker-1 hand-back AUDITED — receipts verified, states folded
- **Verified against the repo (fresh greps/log, not worker claims):** all 7 lane commits on
  origin/main (`f7b3560`, `fc1ba86`, `7ea673e`, `212d791`, `9615d5e`, `629adb2`, `8045ae9`,
  receipts `1aebbd5`; push range confirmed) · SEAM-SPEC has exactly 16 binary items incl. RD-3's
  10/11 · `units/` + `sites/` trees exist as claimed, council page absent (RD-2) ·
  `origin_ticket_id`: **0 hits in source — finding confirmed** · `engine.ts`: **18 domain refs —
  finding confirmed** · whisper-lane isolation claim consistent (`45ca19a` separate, exempt).
- **States folded** (ticket table): W-D/W-F/W-G DELIVERED awaiting tester · W-A/W-B/W-C PARTIAL
  (blueprints + scaffolds; carve → Iteration 1) · W-E DELIVERED-THEN-AMENDED (runbook predates
  watchdog law `3b4da80` — gap minted as W-J, not fake-green).
- **New tickets minted:** W-H (dispatch tracing — items 10/11), W-I (engine genericization —
  split blocker), W-J (watchdog registration — the law). Iteration 1 sketched: serialized carve
  W-I → W-H → W-A → W-B → W-C → W-E+W-J re-run; exit = epic exit on new topology.
- **Honesty note on the worker's deferral:** right call, wrong citation — RD-4 gates the REPO
  split, not the in-repo carve. The real reason stands: parallel sub-agents can't safely carve
  one fused core against the live product. Recorded so the law stays clean.
- Dispatch block B rescoped to what exists (Archus AND Epaminon for the RD-4 trigger; W-A/B/C
  scored NOT-TESTABLE, no fake runs; expected-reds pre-mapped to W-H/W-J). **Tester can dispatch
  now.** RD-2 remains the only open decision.

### 2026-07-05 · [planner/Ring-Fable] INCIDENT — two pens, one working tree (recorded per rule 8; stays visible)
- Sequence: planner audit edits sat uncommitted in the shared working tree · stability-Fable's
  session stashed them to commit the watchdog law (`3b4da80`) · planner committed the doc from
  the stash-clobbered tree → `195c9b2` **silently reverted the law and carried none of the
  audit** · the later `stash pop` conflicted in the APPEND ZONE. Caught by same-turn
  verification of the commit diff (+5/−22 shape); resolved by keeping BOTH entries; this commit
  restores law + audit. `195c9b2` stays in history as the regression it is.
- **Guardrail (binding addendum to rule 3):** the pen covers the WORKING TREE, not just the doc.
  Before any commit touching a shared doc, a session must check `git status` for foreign
  stashes/locks/unmerged paths and verify the staged diff shape matches its own edits. A commit
  whose diff removes text you didn't remove = STOP, investigate.
- Cross-track note for Jordi to route: doc-truth will be synced to main; the whisper branch
  remains the whisper lane's.

### 2026-07-08 · [planner/Ring-Fable] PIVOT (Jordi): collapse Ring + Council → ONE brain-gateway · DELTA + fresh tickets · AWAITING JORDI (RP-1..RP-5)

Jordi's call, this session: **collapse the Ring and the Council into ONE instance — a channel
gateway WITH an LLM brain that sees every connected MCP tool and routes by mostly passing the
prompt through.** The deterministic-ring / brain-council split is deleted. The "guys" and "units"
(Zenod, Archus, Epaminon, Callisthenes, Herald) become **MCP servers you connect through a UI,
each carrying a skill that teaches the brain when to use it.** Ambiguous messages follow a
configurable **default route**; a named guy ("for Herald") is a near-verbatim pass-through tool
call with minimal thinking. This entry is the delta + a fresh ticket list — **no code yet, spec
only**. The planner sections above are LEFT INTACT and marked superseded below; they are rewritten
in place only after Jordi confirms RP-1..RP-5 (guardrail: no destructive rewrite of settled
sections before the call).

#### A · DELTA vs current docs (what changes)

**Laws (§THE laws):**
- **Law 3 (router is cheap / enum-constrained classifier) — DELETED & REPLACED.** There is no
  separate router box and no enum gate. The brain-gateway *is* the router: it reads the inbound
  message with all connected MCP tools + their skills in context and calls the right tool. Routing
  = tool-selection by the brain. Still logged (chosen tool + input digest + misroute counter).
- **Law 2 (tree not mesh; the ring relays VERBATIM, never composes/summarizes/acks) — AMENDED.**
  KEPT: call shape stays a tree (brain → tool/guy → sub-units), **dispatch depth ≤ 1**, no sideways
  guy↔guy chatter, provenance-based outbound (same channel out as in). DROPPED: "the front door
  never composes." The brain-gateway composes/thinks by design — that IS the collapse. Verbatim
  relay survives only as a *per-connection option* (RP-5), e.g. for Herald's voice.
- **Law 5 (media = pipe-work), Law 6 (auth three planes) — substantively unchanged.** Law 6c
  "agent→unit MCP tokens issued by the keyring" is reframed as "credentials for each connected MCP
  server, managed in the connect-UI." Google Drive graduates from backup-sink to a first-class
  channel/source (see requirement a).

**Catalog (§The catalog):**
- **The Ring row — REDEFINED.** Ring = Phylax gateway (WhatsApp + Telegram) **+ Google Drive
  channel + the LLM brain + the MCP-connect UI + the default-route setting**. It is the door AND
  the chief-of-staff in one instance.
- **The Council guy row — DELETED.** Its job (default route, general asks → done-with-receipt,
  files memory via Zenod, dispatches Epaminon) is absorbed into the Ring's brain.
- Zenod / Archus / Epaminon / Callisthenes / Herald — unchanged as boxes, but **reframed as
  connected MCP servers with skills**, not hardwired routes.

**RD decisions:**
- **RD-2 (council guy's name) — WITHDRAWN** (no separate council; the only thing it still blocked,
  the council website page in W-G, is withdrawn with it).
- **RD-5 (enum-constrained classifier router) — SUPERSEDED** by the brain-gateway model.
- **RD-3 (dispatch depth ≤ 1 + origin_ticket_id) — SURVIVES** unchanged (good conformance; W-H).
- **RD-1 (Phylax gateway inside the Ring's compose) — SURVIVES**, extended: Phylax fronts the
  brain now, and Drive joins as a channel. **RD-4 (staged repo split) — SURVIVES.**

**Tickets:**
- **W-A (ring extraction) — REDEFINED** into N-1 (extract ring-core AS the brain-gateway; do NOT
  split the brain out). **W-B (council extraction) — DELETED, merged into N-1.**
- **W-H (dispatch tracing), W-I (engine genericization), W-J (watchdog), W-C (Zenod standalone,
  already shipped via Epic 2.3), W-F (folder restructure) — SURVIVE.** W-G loses its council page.

**SEAM-SPEC (docs/SEAM-SPEC.md) — MINIMAL change (the wire is still pure MCP; connected servers
still conform).** Only edit needed, deferred to the build ticket N-8: §3 example line "Ring =
ring-core + Phylax gateway" → "Ring = brain-gateway + Phylax + Drive." The conformance checklist
is untouched — the connect-UI skill lives *inside* the Ring, never on the wire.

#### B · NEW DECISIONS NEEDING JORDI (RP-1..RP-5 — planner frames, Jordi calls)

- **RP-1 · Where the brain lives vs Phylax.** (a) brain inside ring-core (one container) + Phylax
  gateway container, one compose — **recommended, matches "one instance"**; (b) brain its own
  container. Rec **(a)**.
- **RP-2 · Skill format for a connected MCP server.** Each connection carries a "when to use me"
  skill injected into the brain's system prompt. (a) a short natural-language description block per
  connection — **recommended, ship now**; (b) a structured skill file (triggers + examples + tool
  hints); (c) auto-generated from the server's `tools/list`. Rec **(a) now, (b) as a later
  upgrade**; always seed (a) from (c) as a default the user edits.
- **RP-3 · Default route for ambiguous messages (requirement c).** (a) the brain answers directly
  (it is the chief-of-staff) — **recommended default**; (b) forward to a configurable named
  connected server; (c) ask the user to clarify. Rec: **ship (a) as the default but make it a
  SETTING that can be pointed at (b) or (c)** — that setting IS requirement (c).
- **RP-4 · Named pass-through fidelity (requirement d).** "for Herald" / "@Herald" → (a)
  deterministic prefix match bypasses brain deliberation and forwards the message near-verbatim to
  that server's primary tool, minimal thinking — **recommended**; (b) the brain always mediates.
  Rec **(a)** (keeps the one cheap deterministic fast-path from old Law 3, now as a passthrough).
- **RP-5 · Compose-vs-relay of a tool's answer.** Old law = verbatim; new brain may compose. (a)
  brain composes/summarizes freely; (b) always verbatim + attribution; (c) **per-connection
  setting** (verbatim for voice-guys like Herald, composed for utility tools). Rec **(c)**.

#### C · FRESH TICKET LIST — Iteration 0, new topology (states = SUPERSEDED 2026-07-09 by §D R-series board)

| ID | Lane | Deliverable | Depends | Budget |
|---|---|---|---|---|
| **N-1** | Brain-gateway core | ring-core hosts the LLM brain; every inbound channel message → one brain turn with all connected tools + skills in context; enum-classifier deleted; routing = tool-selection, logged + misroute counter. Absorbs old W-A + W-B. | W-I, RP-1/RP-5 | ≤6h |
| **N-2** | Connect-a-server UI + skill store | UI to add/remove/enable/disable an MCP server (endpoint URL + bearer + display name), attach its skill ("when to use"), persisted in the keyring; skills injected into the brain's system prompt each turn. | N-1, RP-2 | ≤5h |
| **N-3** | Default-route setting | config for ambiguous messages: brain-direct \| named-server \| clarify (RP-3); surfaced in the connect-UI; logged on every fallback. | N-1, RP-3 | ≤2h |
| **N-4** | Named pass-through fast path | "for <name>" / "@name" → near-verbatim forward to that connection's primary tool, minimal deliberation (RP-4); unknown name → default route (N-3). | N-1, N-2, RP-4 | ≤2h |
| **N-5** | Channels: WhatsApp + Telegram + Google Drive | Phylax fronts WA+TG (RD-1 retained); Drive as an ingest channel/source; archive-raw-FIRST-then-transcribe media pipeline retained (Law 5); provenance on every mailbox entry. | N-1 | ≤4h |
| **N-6** | Compose/relay policy | per-connection verbatim-vs-composed flag (RP-5); Herald-style guys relayed with attribution, utility tools composed. | N-1, N-2, RP-5 | ≤2h |
| **N-7** | Provisioning + watchdog (new topology) | provision ONE brain-gateway + Phylax + wired default connections; folds W-E runbook + W-J watchdog law into the collapsed shape; receipts on every container + connection. | N-1..N-6, W-J | ≤4h |
| **N-8** | Docs + SEAM-SPEC delta apply | after RP calls: rewrite the epic laws/catalog/RD in place, retire Council/RD-2/RD-5 text, apply the one SEAM-SPEC §3 wording edit. | RP-1..RP-5 called | ≤2h |
| **W-H** | Dispatch tracing (carried) | `origin_ticket_id` + depth ≤1 — unchanged, still LAW. | — | ≤3h |
| **W-I** | Engine genericization (carried) | shared-lib engine, zero channel/domain imports — still the split blocker + N-1 prerequisite. | — | ≤4h |

**Ticket acceptance/test sketches (full acceptance written at dispatch, post-RP):**
- **N-1:** a channel message with 3+ connected servers → the brain calls exactly the right tool; a
  memory ask → Zenod tool; routing log shows one decision/message; NO enum-classifier code path
  remains (grep). Test: 5 scripted messages route correctly with transcripts.
- **N-2:** add a server in the UI with a skill → it appears in the brain's tool set next turn;
  disable it → its tool refuses/vanishes; skill text demonstrably changes routing. Test: connect a
  dummy MCP echo server, prove skill-driven selection, then disable and prove it's gone.
- **N-3:** flip the default-route setting → an ambiguous message lands where the setting says.
- **N-4:** "for Herald: draft a tweet" → Herald's tool called with the message near-verbatim, no
  brain rewrite; "@zenod what did I say" → Zenod tool. Test: transcript shows minimal-thinking path.
- **N-5:** voice note on WhatsApp → raw archived to Drive BEFORE routing → transcript routed; a
  file dropped in the Drive channel → ingested; reply exits the same channel it entered.

**Proposed new canonical test criteria (surprises worth locking):** (1) "no orphaned enum-router
code" grep gate on N-1 — the old router must be *deleted*, not dormant; (2) a connected-server
skill must measurably change routing (N-2) — otherwise skills are decorative; (3) the default-route
setting must be exercised in both directions (N-3).

**HANDBACK to Jordi.** Deliverable is the delta (§A) + the five decisions to call (§B) + the fresh
ticket list (§C). No code written. Next action is Jordi's: call RP-1..RP-5 (and confirm Council is
withdrawn). On the calls, N-8 rewrites the sections above in place and Iteration 0 dispatches
N-1..N-7 (order: W-I → N-1 → N-2/N-5 parallel → N-3/N-4/N-6 → N-7). Pen holds with Ring-Fable.

#### D · FINAL BACKLOG LEDGER — EpicSpine board (2026-07-09, after Jordi media-boundary call)

**Final architecture boundary.**
- **Ring (Epic 2.5):** cloud router/control surface, borrowing the useful behavior from the
  deployed Console/Council path. Owns channel/product UI, connected-server registry, skill text,
  route/default policy, relay policy, settings links, route logs, mailbox/provenance, and the
  hosted purchase→config entry point.
- **Phylax (Epic 2.5):** one simple gateway. Inbound → Ring. Outbound ← Ring. It exposes channel
  health, delivery receipts, provider/session status, allowed-sender/group controls, and media
  handles. It does **not** decide, summarize, remember, archive, transcribe, OCR, digest, or file.
- **Zenod (Epic 2.3):** memory intake. Callers pass Zenod the thing that should become memory:
  text, audio, screenshots/images, PDFs, Drive files, or media handles. Zenod archives raw
  evidence, extracts/transcribes/OCRs, digests, files meaning, and returns receipts.
- **Connected products:** each guy/product owns its own cloud settings page. Ring shows status,
  route/relay policy, skill text, health/test-call, and a **settings link**.

**Hosted repo boundary (clarified by Jordi, 2026-07-09).**
- `zenod-ai/zenod` remains the runtime/product repo: Ring and Phylax code, in-tenant settings UI,
  unit surfaces, public product-site assets where already present, compose templates, and tests.
- `zenod-ai/cloud` is the private hosted control-plane repo for **all** cloud products. It should
  host the cloud versions of Ring/Phylax, Zenod, Herald, Callisthenes, Archus, Epaminon as hosted
  SKUs or tenant templates where applicable.
- Therefore #671 is not a pure `zenod` ticket. The acceptance path is cross-repo:
  public hosted Ring surface → Stripe test buy → cloud deployment request → tenant stack provision
  with watchdog/meter/tokens → success landing in the Ring config UI → Phylax/channel setup → use.
  The cloud repo owns checkout/provisioning/tenant registry; the zenod repo owns the runtime that
  the provisioned tenant runs.
- **Billing env rule:** Stripe TEST buy/provisioning for Ring should target `cloud-test.zenod.dev`
  once it is bound; `cloud.zenod.dev` is the LIVE customer surface. Existing 2026-07-09 receipts
  against `cloud.zenod.dev` are pre-split smoke receipts and should not be treated as the durable
  test endpoint. See Epic 2 D-6A and Epic 2.3 ZD-12.

**Issue ledger (GitHub issues are the board; this spine remains source of truth).**

| Issue | Role | Title | Status | Depends On | PR/Branch | Acceptance | Latest Evidence | Next Action |
|---|---|---|---|---|---|---|---|---|
| [#665](https://github.com/zenod-ai/zenod/issues/665) | Planner | R-0 spine/spec reconcile to final Ring/Phylax/Zenod boundary | patch ready for review | — | local spine edit | Spine no longer assigns Drive/media/transcription to Ring in active state; R-series ledger is canonical; cross-spine updates proposed | 2026-07-09 planner: current-state note + R-series ledger + worker dispatch receipts | Review alongside worker patches |
| [#666](https://github.com/zenod-ai/zenod/issues/666) | Worker | R-1 Ring router core — cloud Console/Council behavior with modular MCP servers | patch ready for tester | #665 | local patch | Route general turns, memory/media to Zenod, named pass-through, disabled server refusal, same-channel provenance | 2026-07-09 worker: `npm run test -w @zenod/server -- ringRouter.test.ts`; `npm run typecheck -w @zenod/server`; no Ring-owned Drive/archive/transcription/OCR grep passed | Wire router core into live runtime/Phylax/web path |
| [#667](https://github.com/zenod-ai/zenod/issues/667) | Worker | R-2 Phylax gateway — inbound to Ring, outbound from Ring, no memory logic | patch ready for tester | #665 | local patch | Inbound/outbound seam receipts; cloud vs self-host channel modes; no memory/archive/transcription ownership | 2026-07-09 worker: `npm run typecheck -w @zenod/server`; `npm run test -w @zenod/server -- phylaxGateway.test.ts whatsapp.test.ts`; no-memory grep passed | Tester/reviewer should wire this seam into the live MCP server/router path |
| [#668](https://github.com/zenod-ai/zenod/issues/668) | Worker | R-3 Ring cloud UI — router control surface with settings links | patch ready for tester | #665 | local patch | Ring UI has channels, connected servers, routing, inbox, billing/logs; each guy row links to its own settings | 2026-07-09 worker: `npm --workspace apps/web run build`; focused eslint passed; full lint blocked by pre-existing `KeysTab.tsx` hook lint | Capture UI screenshots after local server/API fixture is available |
| [#669](https://github.com/zenod-ai/zenod/issues/669) | Worker | R-4 Phylax channel UI — provider, delivery log, media handoff | patch ready for tester | #665 | local patch | Channel-health screen; managed-cloud vs self-host mode; media handoff says Zenod owns ingest | 2026-07-09 worker: `npm run build -w web` passed | Tester/reviewer should run UI capture against live config |
| [#670](https://github.com/zenod-ai/zenod/issues/670) | Worker | Epic 2.3 / 2.5 seam: Zenod first-class media ingest | patch ready for tester | Epic 2.3 planner acceptance | commits `c360f0d`, `4125f7f` | Zenod exposes media ingest/digest seam for audio/screenshots/PDFs/Drive and returns raw/extracted/digest/commit receipts | 2026-07-09 worker: `npm --prefix packages/server test -- taskJobMediaIngestArchive.test.ts`; `npm --prefix packages/server test -- mcp.test.ts -t "ingest_memory"`; `npm --prefix packages/server test -- mcp.test.ts`; `npm --prefix packages/server run build` | Live hosted audio+screenshot tenant verification remains |
| [#671](https://github.com/zenod-ai/zenod/issues/671) | Planner/parent | R-5 cloud purchase → deployed Ring config UI | decomposed/running | #665 #666 #667 #668 | cross-repo: `zenod-ai/zenod` + `zenod-ai/cloud` | Stripe→deployment→Ring config UI with tokens, watchdog, meter, default connections | 2026-07-09 decomposed into #674-#679 and #681 after hosted/cloud/public-site boundary clarification | Coordinate child tickets until ready for tester |
| [#674](https://github.com/zenod-ai/zenod/issues/674) | Worker | R-5A Ring hosted checkout/status in `zenod-ai/cloud` | deployed smoke green pre-payment | #671 | `zenod-ai/cloud` PR [#49](https://github.com/zenod-ai/cloud/pull/49) | `/buy/ring`, `unit=ring` Checkout metadata, webhook queue/account persistence, Ring status/setup landing | 2026-07-09: pre-split `https://cloud.zenod.dev/buy/ring` returned 303 to Stripe TEST Checkout; `/api/ring/status?session_id=cs_test_...` returned `payment_pending` for `unit=ring`; future TEST receipts should move to `cloud-test.zenod.dev` per Epic 2 D-6A / 2.3 ZD-12 | Needs completed Stripe TEST checkout receipt on `cloud-test.zenod.dev` once bound |
| [#675](https://github.com/zenod-ai/zenod/issues/675) | Worker | R-5B Ring hosted provisioner + watchdog receipts | patch ready for review | #671 #674 | `zenod-ai/cloud` PR [#49](https://github.com/zenod-ai/cloud/pull/49) | `provision-ring.mjs`, tenant URL/config URL/token/compose/watchdog receipts, loud failure path | 2026-07-09: `node --check scripts/provision-ring.mjs`; `node scripts/provision-ring.mjs --name ringdry --dry-run`; webhook typecheck/build; cloud branch deployed manually to Dokploy compose `17QoMFRgvmZ0Y2n19DINT` | Needs post-payment live provision receipt |
| [#676](https://github.com/zenod-ai/zenod/issues/676) | Worker | R-5C hosted Ring config UI in cloud control plane | patch ready for review | #671 #674 #677 | `zenod-ai/cloud` | Buyer lands in cloud Ring config UI; Phylax/channel status; connected products with settings links; honest placeholders | 2026-07-09: cloud console build; webhook typecheck/build after `/api/console/ring` coordinator bridge | Needs integration review; authenticated screenshot pending |
| [#677](https://github.com/zenod-ai/zenod/issues/677) | Worker | R-5D tenant runtime APIs for hosted Ring/Phylax config | patch ready for review | #666 #667 #668 #669 | `zenod-ai/zenod` | Token-gated Ring/Phylax status/config APIs for the cloud UI; no Ring-owned media ingest | 2026-07-09: `npm run test -w @zenod/server -- ringRouter.test.ts phylaxGateway.test.ts`; `npm run typecheck -w @zenod/server` | Needs integration review; managed-cloud WhatsApp provider send adapter still absent |
| [#678](https://github.com/zenod-ai/zenod/issues/678) | Worker | R-5E Ring public hosted landing page + self-host distinction | patch ready for review | #671 #674 | `zenod-ai/zenod` PR [#680](https://github.com/zenod-ai/zenod/pull/680) | Public Ring page points to cloud buy route, explains hosted vs self-host, no cloud QR promise | 2026-07-09: `python3` html parser; worker Nokogiri HTML5 parse; `git diff --check`; targeted content checks | Content ready; public site deployment tracked by #681 |
| [#679](https://github.com/zenod-ai/zenod/issues/679) | Coordinator | R-5F integration branch, cloud deploy, Stripe TEST Ring smoke | red on tenant provisioning | #674 #675 #676 #677 #678 #681 | `zenod-ai/zenod` PR [#680](https://github.com/zenod-ai/zenod/pull/680) + `zenod-ai/cloud` PR [#49](https://github.com/zenod-ai/cloud/pull/49) | Deployable branches/PRs; `PRICE_RING`; `cloud-test` Stripe TEST smoke or exact blocker; live switch remains `cloud.zenod.dev` with `STRIPE_MODE=live` | 2026-07-09: pre-split public Ring -> Stripe TEST paid; cloud status paid+queued; tenant deployment failed with no containers | #691 owns provisioning/runtime-image blocker |
| [#681](https://github.com/zenod-ai/zenod/issues/681) | Worker | R-5G public Ring website front door deployment | live/identity verified | #678 #679 | host-aware Nginx from PR [#696](https://github.com/zenod-ai/zenod/pull/696); Dokploy app branch `codex/epic25-ring-hosted` | `ring.zenod.dev` serves Ring page and TEST CTA reaches `cloud-test` checkout; `zenod.dev` remains Zenod | 2026-07-09 correction after Jordi screenshot: HTTP 200 had served Zenod on both hosts; stale Dokploy build context lacked Nginx host config. Rebuilt image now returns Ring title/copy/CTA on Ring host and Zenod title on Zenod host | Future tests must assert page identity and CTA, not only HTTP status |
| [#691](https://github.com/zenod-ai/zenod/issues/691) | Worker | R-5H Ring tenant provisioning deploy + runtime image blocker | review/testing | #679 #681 | PR [#695](https://github.com/zenod-ai/zenod/pull/695) merged into PR [#680](https://github.com/zenod-ai/zenod/pull/680); immutable image `sha-7db473c` | Paid Ring checkout reaches running tenant with config URL, Phylax URL, token receipt, compose id, watchdog target | 2026-07-09: PR #680 CI green; branch publisher emitted immutable `sha-7db473c`; cloud-test paid tenant runs all six services and health SHA matches `7db473c...` | Runtime/image blocker cleared; hosted entry acceptance moved to #698 |
| [#693](https://github.com/zenod-ai/zenod/issues/693) | Worker | R-5I move Ring TEST checkout/provisioning to `cloud-test` | review/testing | #674 #679 | cloud PR [#50](https://github.com/zenod-ai/cloud/pull/50), commit `34d26a7`; public site merged through PR [#696](https://github.com/zenod-ai/zenod/pull/696) | `cloud-test.zenod.dev` serves TEST Ring checkout/status; `cloud.zenod.dev` remains LIVE-only; public test CTA reaches cloud-test | 2026-07-09: `cloud-test` TEST checkout completed, paid/queued/running status green; public CTA green; legacy `cloud.zenod.dev` still reaches a separate TEST-configured service | Test lane accepted; production hostname needs separate LIVE service/human gate |
| [#698](https://github.com/zenod-ai/zenod/issues/698) | Worker | R-5J hosted Ring entry bypasses Zenod self-hosted wizard | review/browser green | #691 #693 | runtime PR [#699](https://github.com/zenod-ai/zenod/pull/699) + cloud PR [#51](https://github.com/zenod-ai/cloud/pull/51), both integrated into epic branches | Paid hosted buyer lands directly on authenticated Ring/Phylax config; self-hosted first-run remains unchanged | 2026-07-09: paid tenant upgraded to SHA `cd25678`; signed one-time cloud entry opens Ring control surface; Phylax entry shows managed channels and zero QR text; runtime/cloud tests green | Final independent scoreboard in #672 |
| [#672](https://github.com/zenod-ai/zenod/issues/672) | Tester | R-T tester battery for Ring, Phylax, Zenod handoff, cloud deploy | **fresh no-touch E2E PASS — ready for Jordi test** | #666 #667 #668 #669 #670 #674 #675 #676 #677 #678 #679 #681 #691 #693 #698 | fresh session `cs_test_a1jx...`; tenant `r-ringnotouch20260709-wl3hhm`; runtime SHA `cd25678` | Public button → Stripe TEST payment → automatic deploy → Ring settings → managed Phylax settings; every red maps to follow-up | 2026-07-09 correction after Jordi found a failed purchase: fixed first-deploy API and stale duplicate cloud-test source; repeated full journey with a new paid session and clicked both settings links | Jordi runs experiential test; keep LIVE rebinding and live-media drill as named residuals |

**Parallel dispatch plan.**
- First worker batch completed local patches for **#666 Ring router core**, **#667 Phylax gateway**,
  **#668 Ring UI**, **#669 Phylax UI**, and **#670 Zenod media seam**; those rows are ready for
  review/integration.
- R-5 child batch status: **#674 cloud checkout/status**, **#675 Ring provisioner/watchdog**,
  **#676 hosted Ring config UI**, **#677 tenant runtime APIs**, and **#678 public Ring landing
  page** are patch-ready. The cloud buy route is now live in TEST mode, but the completed-payment
  provisioning smoke is still pending.
- Active integration lane: **#679**. Branches: `codex/epic25-ring-hosted` in `zenod-ai/zenod`
  and `codex/epic25-ring-cloud` in `zenod-ai/cloud`; PRs are
  [zenod #680](https://github.com/zenod-ai/zenod/pull/680) and
  [cloud #49](https://github.com/zenod-ai/cloud/pull/49).
- Public-front-door lane **#681** regressed to nginx 404 after its ad hoc Traefik route disappeared.
  Worker Carson owns a durable Dokploy-backed restore and the cloud-test CTA.
- Tenant provisioning lane **#691** recovered the paid tenant; the remaining work is PR #680 CI
  and a Ring-capable runtime image. Worker Euclid owns that isolated fix.
- Billing-lane correction **#693** is active with worker Mill: Ring TEST acceptance moves to
  `cloud-test.zenod.dev`; `cloud.zenod.dev` remains LIVE-only.
- Hold **#672 tester** until #691 supplies the Ring runtime commit/image and #693 supplies the
  cloud-test checkout receipts.
- Browser acceptance exposed **#698**, now fixed and green on tenant SHA `cd25678`: Ring and Phylax
  use signed one-time cloud entry links, self-host setup remains disabled only in hosted Ring mode,
  and managed Phylax shows no QR flow. **#672 final tester is dispatched.**

**Proposed cross-spine updates.**

| Date | Target Spine | Proposed Change | Evidence | Suggested Owner | Status |
|---|---|---|---|---|---|
| 2026-07-09 | [EPIC-2.3-ZENOD-MOVE-0.md](EPIC-2.3-ZENOD-MOVE-0.md) | Record Zenod as owner of memory media ingest: audio, screenshots/images, PDFs, Drive sources/archive, transcription/OCR/extraction, digest, filing, receipts. Link #670. | Jordi call in this thread; `units/zenod/SEAM-SURFACE.md` already names ingest/digest | Zenod-Fable | proposed |
| 2026-07-09 | [EPIC-0-STORY.md](EPIC-0-STORY.md) | Story language: Zenod is the memory intake philosophy, not just text memory; you pass it the thing that wants to become memory. | Jordi call in this thread | Story-Fable | proposed |

### 2026-07-09 · [planner/EpicSpine] Final boundary folded + GitHub board minted (#665–#672)

Current-state top note rewritten to the final boundary: Epic 2.5 = cloud Ring router/control
surface; Phylax = simple channel gateway; Zenod 2.3 = memory media ingest owner. The July 8
N-series list is explicitly superseded by the R-series board above. GitHub issues minted as the
execution board:

| Issue | Purpose |
|---|---|
| [#665](https://github.com/zenod-ai/zenod/issues/665) | R-0 spine/spec reconciliation |
| [#666](https://github.com/zenod-ai/zenod/issues/666) | R-1 Ring router core |
| [#667](https://github.com/zenod-ai/zenod/issues/667) | R-2 Phylax gateway |
| [#668](https://github.com/zenod-ai/zenod/issues/668) | R-3 Ring cloud UI |
| [#669](https://github.com/zenod-ai/zenod/issues/669) | R-4 Phylax channel UI |
| [#670](https://github.com/zenod-ai/zenod/issues/670) | Cross-spine Zenod media ingest seam |
| [#671](https://github.com/zenod-ai/zenod/issues/671) | R-5 cloud purchase→deployment→config UI |
| [#672](https://github.com/zenod-ai/zenod/issues/672) | R-T tester battery |

Parallel dispatch authorized for #666/#667/#668/#669/#670 after #665's spine reconciliation;
#671 waits for contracts; #672 waits for worker outputs. Dispatch receipts:

| Issue | Worker |
|---|---|
| [#666](https://github.com/zenod-ai/zenod/issues/666) | Gibbs (`019f4756-1565-7d62-85e1-a0a856c8acf5`) |
| [#667](https://github.com/zenod-ai/zenod/issues/667) | Godel (`019f4756-3e13-7d42-aff2-7f25dedfde03`) |
| [#668](https://github.com/zenod-ai/zenod/issues/668) | Anscombe (`019f4756-6390-7e23-938c-fdf7d5c0ad1e`) |
| [#669](https://github.com/zenod-ai/zenod/issues/669) | Locke (`019f4756-8e22-7c11-889c-8654e1a4e207`) |
| [#670](https://github.com/zenod-ai/zenod/issues/670) | Confucius (`019f4756-b896-7c50-8070-60917d07bb36`) |

The deck
[EPIC-2.5-RING-SPEC-DECK.html](EPIC-2.5-RING-SPEC-DECK.html) is a discussion artifact, not the
source of truth. Pen stays with EpicSpine planner until worker handoffs land.

### 2026-07-09 · [planner/EpicSpine] R-5 decomposed and cloud/control-plane workers dispatched

Jordi clarified the durable hosted pattern: the open runtime repo is the self-hostable product/API,
and the private `zenod-ai/cloud` repo is the hosted control plane that buys, deploys, meters,
watches, and configures customer instances. #671 is therefore a cross-repo parent, not one
implementation ticket. It was decomposed into four executable child issues:

| Issue | Worker | Write Scope |
|---|---|---|
| [#674](https://github.com/zenod-ai/zenod/issues/674) | Dalton (`019f4778-066e-70c2-9c6e-b2597bb63dbb`) | Cloud webhook checkout/status/account/queue config for `unit=ring` |
| [#675](https://github.com/zenod-ai/zenod/issues/675) | Dirac (`019f4778-8b4e-7f30-a247-f5f9fbf0b77b`) | Cloud `provision-ring.mjs` and Dockerfile spawn support |
| [#676](https://github.com/zenod-ai/zenod/issues/676) | Kierkegaard (`019f4778-b9af-7fc0-bf26-b79c9c7531d0`) | Cloud console hosted Ring config UI |
| [#677](https://github.com/zenod-ai/zenod/issues/677) | Curie (`019f4778-ec27-7d03-84a2-43e4bc7d9165`) | Tenant-side Ring/Phylax status/config APIs in `zenod-ai/zenod` |
| [#678](https://github.com/zenod-ai/zenod/issues/678) | Ohm (`019f477c-949b-79c1-9c9d-9c8f203f772d`) | Public Ring hosted landing page and self-host distinction |

Coordinator note: workers were told not to edit this spine directly to avoid parallel doc
conflicts; the coordinator will fold handoffs back here and update issue states.

### 2026-07-09 · [coordinator/R-5A-R-5B] #674/#675 integrated to patch-ready

#674 added Ring as a hosted cloud checkout/status unit in `zenod-ai/cloud`: `PRICE_RING`,
`/buy/ring`, JSON checkout support for `unit=ring`, Checkout metadata, webhook queue/account
persistence, Ring success/setup redirects, `/api/ring/status`, and `/ring/status`. #675 added
`scripts/provision-ring.mjs` and Dockerfile spawn support. The provisioner uses the proven
deployable fused tenant stack as hosted Ring v0 and explicitly reports that
`units/ring/docker-compose.ring.yml` remains a blueprint, not the deployed template.

Coordinator follow-up folded the two lanes together: `PRICE_RING` now passes through
`docker-compose.cloud.yml`, and `autoProvision` dispatches `unit=ring` to `provision-ring.mjs`.
Receipts:
- `npm run typecheck` in `/Users/jordi/Documents/GitHub/cloud/services/webhook` -> pass.
- `npm run build` in `/Users/jordi/Documents/GitHub/cloud/services/webhook` -> pass.
- `node --check scripts/provision-ring.mjs` -> pass.
- `node scripts/provision-ring.mjs --name ringdry --dry-run` -> pass, emitting Ring URL, Config
  URL, MCP/API token, compose, and watchdog target receipts.
- `git diff --check` on the touched cloud files -> pass.

Residual: no live Stripe Ring test session or live Dokploy Ring deployment was executed in this
pass; the current fused runtime does not yet enforce the generated Ring token until #677/template
follow-up lands.

### 2026-07-09 · [coordinator/R-5C-R-5E] #676/#678 integrated to patch-ready

#676 added the hosted Ring config surface in `zenod-ai/cloud/services/console`: route `/ring`,
provision/tenant URL display, Phylax cloud-vs-self-host channel states, connected product rows
with settings links, route policy, Zenod media ownership, watchdog/meter summaries, and receipt
empty states. Coordinator added `/api/console/ring` in the cloud webhook so the UI has a real
cloud-owned backend route now, and can later prefer tenant `/api/ring/status` when #677 lands.

#678 updated `sites/ring/index.html`: primary CTA points to the cloud Ring buy route; copy
explains hosted vs self-host; cloud WhatsApp uses managed provider/business-number connection;
QR pairing is scoped to self-host/dev; Ring/Phylax/Zenod boundaries and connected-product
settings links are explicit.

Receipts:
- `npm run build` in `/Users/jordi/Documents/GitHub/cloud/services/console` -> pass.
- `npm run typecheck && npm run build` in `/Users/jordi/Documents/GitHub/cloud/services/webhook`
  -> pass after `/api/console/ring`.
- `python3` `html.parser` on `sites/ring/index.html` -> pass.
- `git diff --check` on touched cloud and Ring-site files -> pass.

Residual: authenticated cloud UI screenshot not captured; `cloud.zenod.dev/buy/ring` still needs
deployment plus `PRICE_RING`; #677 remains the active runtime API lane.

### 2026-07-09 · [coordinator/R-5D] #677 tenant runtime APIs patch-ready

#677 added tenant-side APIs in `zenod-ai/zenod` for the hosted cloud control plane:
`GET /api/ring/status`, `PUT /api/ring/config`, `POST /api/ring/route-test`,
`GET /api/phylax/status`, `PUT /api/phylax/config`, `POST /api/phylax/test-send`, and
`POST /api/phylax/delivery-status`. They use the existing `/api/*` bearer-token gate.

The payloads expose Ring identity, tenant metadata, connected products without leaking tokens,
default/Zenod route policy, route logs, health, Phylax provider/channel/allowlist/delivery state,
and the Zenod-owned media handoff. Test-send and route-test return real receipts when configured
and explicit errors when no live provider/peer is wired.

Receipts:
- `npm run test -w @zenod/server -- ringRouter.test.ts phylaxGateway.test.ts` -> pass.
- `npm run typecheck -w @zenod/server` -> pass.

Residual: managed-cloud WhatsApp delivery is not wired to a real provider adapter yet; route tests
need cloud-provided connected-product endpoint/token config for live MCP success receipts.

### 2026-07-09 · [coordinator/R-5F] Local integration validation passed; deploy/test lane opened

#679 opened as the final bridge from patch-ready to Jordi-testable. Dedicated branches created:
`codex/epic25-ring-hosted` in `zenod-ai/zenod` and `codex/epic25-ring-cloud` in
`zenod-ai/cloud`.

Local validation bundle:
- `npm run test -w @zenod/server -- ringRouter.test.ts phylaxGateway.test.ts whatsapp.test.ts`
  -> pass, 42 tests.
- `npm run typecheck -w @zenod/server` -> pass.
- `npm --workspace apps/web run build` -> pass.
- `npm run typecheck && npm run build` in `/Users/jordi/Documents/GitHub/cloud/services/webhook`
  -> pass.
- `npm run build` in `/Users/jordi/Documents/GitHub/cloud/services/console` -> pass.
- `python3` `html.parser` on `sites/ring/index.html` and `docs/EPIC-2.5-RING-SPEC-DECK.html`
  -> pass.
- `node --check /Users/jordi/Documents/GitHub/cloud/scripts/provision-ring.mjs` -> pass.
- `node /Users/jordi/Documents/GitHub/cloud/scripts/provision-ring.mjs --name ringdry --dry-run`
  -> pass, emits Ring URL, Config URL, MCP/API token, compose, and watchdog target.

Remaining before #672 tester dispatch: push/PR or otherwise deploy the cloud branch, configure
`PRICE_RING` in the cloud-test environment, run a Stripe TEST checkout against
`https://cloud-test.zenod.dev/buy/ring` once bound, and capture the status/config landing receipts.

### 2026-07-09 · [coordinator/R-5F-R-5G] Cloud buy route live; public Ring site deployment split out

PRs are open for the integrated patch set:
- `zenod-ai/zenod` PR [#680](https://github.com/zenod-ai/zenod/pull/680) from
  `codex/epic25-ring-hosted`.
- `zenod-ai/cloud` PR [#49](https://github.com/zenod-ai/cloud/pull/49) from
  `codex/epic25-ring-cloud`.

Cloud deploy receipt: `zenod-ai/cloud` branch `codex/epic25-ring-cloud` at commit `2178215` was
manually deployed to Dokploy compose `17QoMFRgvmZ0Y2n19DINT` after the Dokploy compose redeploy
API left the old route live. `PRICE_RING` is configured in the VPS/cloud environment as Stripe
TEST price `price_1TrKAF76yJ3p1J6XPWCmyDJG`.

Live smoke receipts:
- Pre-split `GET https://cloud.zenod.dev/healthz` -> HTTP 200, `{"ok":true}`.
- Pre-split `GET https://cloud.zenod.dev/buy/ring` -> HTTP 303 to Stripe TEST Checkout (`cs_test_...`).
- Pre-split `GET https://cloud.zenod.dev/api/ring/status?session_id=cs_test_...` -> `ok: true`,
  `unit: "ring"`, `status: "payment_pending"`, `paid: false`, `queued: false`.

Post-decision correction: future Stripe TEST Ring receipts belong on `cloud-test.zenod.dev`
(`STRIPE_MODE=test`), while `cloud.zenod.dev` is reserved for LIVE Stripe (`STRIPE_MODE=live`).
This follows Epic 2 D-6A and Epic 2.3 ZD-12.

### 2026-07-09 · [planner/cloud-billing] Ring adopts cloud-test for Stripe TEST

Cross-epic billing note folded after Jordi's decision: Ring/R-5 workers should run Stripe TEST
checkout and disposable provisioning on `cloud-test.zenod.dev`, not the live customer Cloud host.
`cloud.zenod.dev` remains the LIVE Stripe target. Existing smoke receipts against
`cloud.zenod.dev` are retained as pre-split evidence only. `cloud-test.zenod.dev` is now bound and
smoke-green: `/healthz` reports `{"ok":true,"stripe_mode":"test"}` and `/buy/ring` returns 303 to
Stripe `cs_test_...`. The next #674/#679/#672 receipts should use `cloud-test` for paid test drills.

Authority: canonical billing decision lives in Epic 2 D-6A and Epic 2.3 ZD-12; this spine consumes
that shared hosted-control-plane rule for Ring.

Updated live public-site receipt: #681 is now live/needs-review. `https://ring.zenod.dev/`
returns 200 with the Ring page; its CTA points to `https://cloud.zenod.dev/buy/ring`, which
returns 303 to Stripe TEST Checkout. Commit `4256612` updates `apps/site/Dockerfile` so the
main site image can serve `/ring/index.html`; the current live route was added through
SSH/Traefik dynamic config, so Dokploy route durability remains a review item.

Remaining before #672 tester dispatch:
- Resolve #691 so a paid Ring checkout produces a running tenant, or record the exact
  infrastructure/runtime-image blocker.
- Update #672 with the exact public URL, checkout session, status URL, tenant/config URL, and
  known red items.

### 2026-07-09 · [coordinator/R-5F-R-5H] Public/payment green; tenant provisioning red

Additional cloud commits on `zenod-ai/cloud` PR [#49](https://github.com/zenod-ai/cloud/pull/49):
`49c961b` adds Ring status reconciliation for paid sessions whose webhook/queue write is absent;
`3846e58` changes the Ring provisioner from Dokploy `compose.deploy` to `compose.redeploy` per
`docs/DOKPLOY-DEPLOY.md`.

End-to-end smoke on the pre-split TEST cloud route:
- Public page: `GET https://ring.zenod.dev/` -> HTTP 200.
- Buy route: `GET https://cloud.zenod.dev/buy/ring` -> HTTP 303 to Stripe TEST Checkout.
- Completed Stripe TEST checkout: `cs_test_a1ExWtiUgXZ2KcoPaCtEhC8R8bYTYyWy1mUFJ3x45z7MeiEdSnKK8uIw3s`,
  synthetic email `ring-test-20260709@zenod.dev`.
- Cloud status after reconciliation: paid true, queued true, then failed with a recoverable
  provisioning error.

Provisioning blocker isolated into
[#691](https://github.com/zenod-ai/zenod/issues/691): the Ring provisioner created Dokploy compose
`qvxRcJxBvWqYp-AYPLS3t` / appName `compose-parse-mobile-port-nz5tru` for
`r-ringtest20260709-8uiw3s.zenod.dev`, but no tenant containers were created. `compose.deploy`
returned 200/no-op; `compose.redeploy` hung and still left composeStatus `idle`. A second blocker
must also be resolved before "ready to test use/config": the tenant template pulls
`ghcr.io/zenod-ai/zenod:latest`, while the Epic 2.5 Ring runtime/API/UI changes live on
`zenod-ai/zenod` PR [#680](https://github.com/zenod-ai/zenod/pull/680) and need a published
Ring-capable image/tag or merge.

Worker Bohr (`019f47c4-4ec4-7b02-b3c2-54723c9d66aa`) is dispatched on #691. Tester #672 remains
draft/blocked until #691 returns a running tenant or exact unrecoverable blocker.

### 2026-07-09 · [worker/R-3] #668 Ring cloud UI control surface patch ready

Implemented a Ring-mode control surface in `apps/web/src/components/ring-control-surface.tsx`
and mounted it from `apps/web/src/views/settings/ConnectionsTab.tsx` when `/api/agent` reports a
vaultless Console/Ring identity. The surface covers channel status, connected product rows, skill
text, relay policy, endpoint/token status, health links, synthetic route-test calls, route-log
receipts from `/api/test/chat`, billing/config entry points, and outward settings links derived
from each connected peer endpoint. In Ring mode, the Google Drive connector is hidden from the
Ring Connections tab so Drive archive/transcription does not appear Ring-owned; the surface states
that Zenod owns memory plus media ingest.

Validation receipts:
- `npm --workspace apps/web run build` passed.
- `npx eslint apps/web/src/components/ring-control-surface.tsx apps/web/src/views/settings/ConnectionsTab.tsx` passed.
- `npm --workspace apps/web run lint` still fails on pre-existing `apps/web/src/views/settings/KeysTab.tsx:145` (`react-hooks/set-state-in-effect`), outside #668 scope.
- Screenshot attempt: built assets served through a local mock API on `127.0.0.1:4177`; in-app browser tab attach timed out twice, and local Playwright is not installed (`ERR_MODULE_NOT_FOUND`), so screenshot evidence was not feasible in this workspace.

Residual UX/API questions for planner/router-core follow-up: the UI derives settings/health links
from peer MCP URLs until the cloud controller exposes canonical per-product settings URLs; route
logs currently use the existing synthetic chat audit endpoint until #666 lands first-class Ring
router decision logs.

### 2026-07-09 · [worker/Locke] #669 Phylax channel UI patch ready

Patch scope: `apps/web/src/components/whatsapp-connect.tsx` and
`apps/web/src/components/telegram-connect.tsx` only. Existing channel cards now present Phylax as
the gateway: inbound to Ring, outbound from Ring, no memory/archive/transcription/digest logic.
WhatsApp distinguishes managed-cloud mode from current self-host/dev QR mode, shows provider/session
health, existing outbound/inbound audit counts, last outbound status, allowed senders/groups, media
handoff to Zenod, and a channel test send through existing `/api/notify` with
`surface: "whatsapp"`. Telegram has the equivalent provider/session shell, Ring handoff, Zenod media
handoff, allowed sender controls, explicit delivery-log gap, and `surface: "telegram"` test send.

Validation receipt: `npm run build -w web` passed on 2026-07-09. Screenshot not captured in this
worker pass because no live web server/API fixture was started; tester should capture desktop/mobile
with configured channel status.

Open risks: managed-cloud WhatsApp provider/webhook fields are UI-only until the Phylax gateway
contract exposes them; Telegram has no live delivery receipt feed yet, so the UI states that gap and
only records the latest test-send result in component state. The current backend still contains
legacy WhatsApp media processing paths; this UI states the target Epic 2.5 boundary that Zenod owns
memory media ingest.

### 2026-07-09 · [worker/Godel] #667 Phylax gateway seam patch ready

Patch scope: `packages/server/src/phylaxGateway.ts`,
`packages/server/src/whatsappConfig.ts`, `packages/server/src/whatsappGateway.ts`,
`packages/server/src/settings.ts`, `packages/server/src/app.ts`,
`packages/server/test/phylaxGateway.test.ts`, and
`packages/server/test/whatsapp.test.ts`. Added a focused Phylax seam module for inbound
`receiveInbound` → Ring receipt, outbound `sendToUser` / `sendTestMessage` delivery receipts,
`getMedia` handles, delivery status, allowlist/group enforcement, and explicit cloud vs
self-host/dev pairing status. Existing WhatsApp config/status now exposes provider mode, cloud
provider/webhook/phone-number/status, and test recipient; QR pairing remains self-host/dev only.

Validation receipts: `npm run typecheck -w @zenod/server` passed; `npm run test -w @zenod/server
-- phylaxGateway.test.ts whatsapp.test.ts` passed (27 tests). No-memory grep passed with no
matches:
`rg -n "from \"zenod\"|from './(voiceArchive|channelAudio|drive|ingest|artifact|transcribe)|from \"\\./(voiceArchive|channelAudio|drive|ingest|artifact|transcribe)|storeMemory|digest|archiveVoice|archiveImage|transcribe" packages/server/src/phylaxGateway.ts packages/server/test/phylaxGateway.test.ts`.

Open risks: the new seam is a testable contract module and config/status surface, not yet mounted
as a live MCP endpoint or wired into the Ring router worker's mailbox. The legacy fused
`whatsappGateway.ts` still contains current media/tasking behavior for the existing product; this
patch does not move or delete that logic to avoid colliding with Ring router, Ring UI, Phylax UI,
and Zenod media workers.

### 2026-07-09 · [worker/Gibbs] #666 Ring router core patch ready

Patch scope: `packages/server/src/ringRouter.ts` and
`packages/server/test/ringRouter.test.ts`. Added a focused `RingRouterCore` with connected MCP
server registry metadata, mailbox/provenance entries, route logs with input digest/chosen
server/status, named pass-through, Zenod memory/media routing, disabled-server refusal,
same-channel outbound envelopes, and injected MCP caller. The router sends memory-bound media to
Zenod's seam and does not implement Drive/archive/transcription/OCR itself.

Validation receipts: `npm run test -w @zenod/server -- ringRouter.test.ts` passed (7 tests);
`npm run typecheck -w @zenod/server` passed; `rg -n "drive|archive|transcri|ocr|whisper|groq|google"
packages/server/src/ringRouter.ts -S` returned no matches.

Open risks: the router core is not yet wired into `runtime.ts`, Phylax ingress, or web chat; route
logs and mailbox are in-memory for this slice. If an enum-constrained LLM classifier remains
desired, it should be added behind this route-selection boundary rather than replacing it.

### 2026-07-09 · [worker/Confucius] #670 Zenod media ingest seam patch ready (cross-spine)

Patch scope lives primarily in Epic 2.3 / Zenod: commits `c360f0d` (media memory ingest
integration) and `4125f7f` (Epic 2.3 seam handoff docs) on the current branch. Changed code spans
`packages/server/src/taskJobQueue.ts`, `taskJobStore.ts`, `mcp.ts`, `mcpToolSchemas.ts`,
`artifactArchive.ts`, `artifactExtraction.ts`, `driveTools.ts`, `ingestQueue.ts`,
`ingestStore.ts`, and `settings.ts`, with tests `artifactArchive.test.ts`, `drive.test.ts`,
`mcp.test.ts`, and `taskJobMediaIngestArchive.test.ts`. Docs updated:
[EPIC-2.3-ZENOD-MOVE-0.md](EPIC-2.3-ZENOD-MOVE-0.md),
[../units/zenod/README.md](../units/zenod/README.md), and
[../units/zenod/SEAM-SURFACE.md](../units/zenod/SEAM-SURFACE.md).

Validation receipts: `npm --prefix packages/server test -- taskJobMediaIngestArchive.test.ts`
passed; `npm --prefix packages/server test -- mcp.test.ts -t "ingest_memory"` passed;
`npm --prefix packages/server test -- mcp.test.ts` passed; `npm --prefix packages/server run build`
passed. Issue [#670](https://github.com/zenod-ai/zenod/issues/670) is already
`status:needs-review`.

Open risks for Epic 2.5 integration: live hosted verification still needs audio + screenshot
through a real tenant, then `search_memory` / `ask_brain` citation checks. Scanned/no-text PDF OCR
is still a loud follow-up; embedded-text PDF is covered. Ring must pass `artifactUrl`, `data:`
bytes, or a Zenod-configured Drive ref; bare `ring://media/...` handles still return
`media_ingest_processor_unavailable` until Zenod has a resolver.

### 2026-07-09 · [epic-worker/Epic-2.5] Runtime recovery reconciled; cloud-test lane dispatched

Bohr recovered the paid Ring tenant for session `cs_test_a1Ex...`: Dokploy compose
`qvxRcJxBvWqYp-AYPLS3t` is running, the tenant health endpoint is green, and the cloud buyer status
is `running` with config and Phylax URLs. This proves the deployment mechanism after changing the
provisioner from Dokploy `compose.deploy` to `compose.redeploy`. It does not close hosted runtime
acceptance because the tenant still runs stale GHCR `latest` at SHA `d8f158e`; PR #680 currently
fails CI on duplicate helper declarations in `packages/server/src/settings.ts`.

Issue [#693](https://github.com/zenod-ai/zenod/issues/693) now owns the missing billing-environment
delivery work. Worker Euclid (`019f4805-a08a-7803-bb83-f181b6ea3880`) owns #691's PR #680 CI and
Ring-image readiness on an isolated branch. Worker Mill (`019f4805-a030-7a42-a322-2abe49ece7be`)
owns #693's `cloud-test.zenod.dev` Ring checkout/status path and test CTA. Tester #672 remains held
until both lanes return exact commit and environment receipts.

Fresh coordinator verification at 2026-07-09 19:57 Europe/Paris found
`https://cloud-test.zenod.dev/healthz` green with `stripe_mode:test` and
`https://cloud-test.zenod.dev/buy/ring` redirecting to `cs_test_...`. The same check found
`https://ring.zenod.dev/` regressed to nginx 404. Worker Carson
(`019f4807-0c36-76a0-ac33-7d50a7e38ba7`) was dispatched on #681 to restore the public site through
durable deployment configuration and point its TEST CTA at `cloud-test`.

### 2026-07-09 · [epic-worker/browser-acceptance] Cloud-test paid Ring runs; hosted entry fails

Fresh Stripe TEST purchase `cs_test_a1fba6...` completed on `cloud-test.zenod.dev` for
`ring-cloud-test-20260709@zenod.dev`. The recovered Dokploy tenant
`r-ringcloudtest2026070-yfnwxy.zenod.dev` runs all six services from immutable image
`ghcr.io/zenod-ai/zenod:sha-7db473c`; `/api/health` reports exact SHA
`7db473c1960a69777cd79c85b3cc45662996f1c8`. Cloud status is `running`, paid and queued, with
Ring and Phylax links. `ring.zenod.dev` is again HTTP 200 and its TEST CTA reaches cloud-test.

The browser then found a new red acceptance item: both hosted configuration links enter the generic
Zenod first-run wizard headed "Set up your self-hosted memory agent" and require creation of an
admin password. Issue [#698](https://github.com/zenod-ai/zenod/issues/698) owns the fix. Worker
Rawls (`019f4823-8c1f-73f3-acaa-c752123e6e09`) is dispatched; tester #672 remains held until a
hosted tenant opens the actual Ring and managed-cloud Phylax screens without weakening auth.

### 2026-07-09 · [epic-worker/browser-acceptance] Hosted Ring and Phylax entry green

Runtime PR [#699](https://github.com/zenod-ai/zenod/pull/699) and cloud PR
[#51](https://github.com/zenod-ai/cloud/pull/51) were integrated into the Epic 2.5 branches. The
paid cloud-test tenant was upgraded to immutable `sha-cd25678`; health reports exact SHA
`cd2567812f7e0aa5a205d62ff2485cd053cce9cc` and `ZENOD_HOSTED_MODE=ring` is set only for the hosted
Console service. Cloud status now emits short-lived signed entry links instead of raw tenant hash
links. Browser verification passed: Ring entry opened the authenticated Ring control surface on
Connections, Phylax entry opened `#phylax-channels`, the managed-cloud card was present, and QR
pairing text was absent. Tester Plato (`019f4835-7074-77c0-90d0-e0d4097fed75`) is dispatched on
[#672](https://github.com/zenod-ai/zenod/issues/672) for the final independent scoreboard.

### 2026-07-09 · [tester/Plato] Final Epic 2.5 scoreboard 8/8 PASS

Tester Plato returned **READY-FOR-JORDI-TEST** against paid cloud-test session `cs_test_a1fba6...`,
tenant `r-ringcloudtest2026070-yfnwxy.zenod.dev`, exact runtime SHA
`cd2567812f7e0aa5a205d62ff2485cd053cce9cc`, and immutable image `sha-cd25678`. The independent
scoreboard passed public Ring/TEST checkout, paid/running buyer status, authenticated Ring entry,
managed Phylax entry without QR, outward product-settings ownership, exact image/SHA across all six
tenant services, Zenod-owned media boundary using #670 receipts, and cloud-test billing mode.

Residuals are explicit rather than hidden: no fresh live audio/image upload was performed in this
tester pass; the tenant has zero configured connected products, so external settings navigation is
proved by controls/copy rather than a configured target; PR #680 and cloud PR #50 remain open at the
exact deployed/tested heads. Production `cloud.zenod.dev` still reports TEST mode and must be rebound
to a separately configured `STRIPE_MODE=live` service, or removed until that service exists, before
LIVE acceptance. This production action is a human gate and was not required for the cloud-test
handoff.

### 2026-07-09 · [epic-worker/correction] Ring public identity false-positive fixed

Jordi's browser screenshot proved `ring.zenod.dev` was serving the Zenod librarian page despite
the final tester's HTTP-200 result. Root cause: the Dokploy `zenod-site` application owns both
`zenod.dev` and `ring.zenod.dev`; its source branch had been deleted and the fallback image used
default Nginx, so both hosts returned `/index.html`. The application now targets durable branch
`codex/epic25-ring-hosted`, and its generated build context was refreshed with the reviewed
host-aware `apps/site/nginx.conf`, Dockerfile, and Ring page from PR #696 before redeployment.

Fresh content assertions now pass: `ring.zenod.dev` returns title "The Ring - hosted router for your
AI suite", visible Ring copy, and CTA `https://cloud-test.zenod.dev/buy/ring`; `zenod.dev` continues
to return the Zenod librarian title. #681 and #672 record the correction. Acceptance is tightened:
public-site tests must assert product identity and destination URL, never HTTP 200 alone.

### 2026-07-09 · [epic-worker/correction] Fresh no-touch buyer journey rerun end to end

Jordi completed a new Stripe TEST purchase and showed a real `Provisioner exited 1` page, proving
the prior scoreboard had reused a recovered tenant instead of validating a new no-touch deployment.
The root provisioning defect was deterministic: `provision-ring.mjs` called Dokploy
`compose.redeploy` for a newly created compose, but that operation assumes the source checkout
already exists. Ring now uses `compose.deploy` for the first deployment, matching the working
standalone Zenod provisioner. Cloud-test also pins `RING_BRANCH=codex/epic25-ring-hosted` and
`RING_IMAGE_TAG=sha-cd25678`, so fresh tenants receive the hosted compose contract and exact tested
runtime.

A second infrastructure conflict caused fixes to appear and then revert: a temporary
`/tmp/zenod-cloud-test-*` Compose directory and Dokploy's durable
`/etc/dokploy/compose/zenod-cloud-test` directory shared the same project/container name. The
Dokploy-owned source was refreshed with the cloud-test branch and its image was pinned to
`zenod-cloud-test-webhook:epic25-94b417e`. Four checks over five minutes confirmed the same container
creation time/image and authenticated `/ring/enter` route remained present.

Fresh no-touch receipt: from `ring.zenod.dev`, the agent clicked **Buy hosted Ring**, completed
Stripe TEST session `cs_test_a1jx...`, observed all four status steps green without concierge repair,
opened tenant `r-ringnotouch20260709-wl3hhm.zenod.dev/#ring-router-products` with the Ring control
surface and no self-host wizard, then opened `#phylax-channels` with the managed-cloud card and zero
QR text. Jordi's failed session `cs_test_a1KZ...` was separately upgraded and reconciled to
`running`; its Chrome status page is left open on the repaired result.
