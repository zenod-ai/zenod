# EPIC 2.5 · THE ATOMIC SUITE — the ring, the guys, the units

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
