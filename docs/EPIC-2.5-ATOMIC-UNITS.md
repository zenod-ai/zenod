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
| **The Ring** (naming: RD-1) | door | adapters (WhatsApp/Baileys, Telegram, web chat) · media pipeline (voice→transcript, attachments→archive) · conversation mailbox · cheap router · attention rules (committed file) · keyring UI (user auth, OAuth start, MCP token issuance, unit enable/disable) | exists FUSED inside Console — extract |
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
3. **The router is cheap.** Rules/deterministic first (named guy → that guy; memory verbs → Zenod;
   default → the council guy); a small-LLM fallback only for genuinely ambiguous routing (RD-5).
   The router decides WHO gets the ticket. It does not think about the ticket.
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

### Open decisions for the planner to frame with Jordi FIRST (RD series)

- **RD-1 · Ring naming/scope:** is the ring simply *Phylax* (the guard at the one door, both
  directions), or is "ring" the product and Phylax the attention module inside it? One name must
  win before websites (W-G).
- **RD-2 · The council guy's name.** He's the chief of staff — multi-purpose, memory-filing,
  dispatching. Needs a name of his own (the "Council" brand belongs to the old fused story).
- **RD-3 · Guy→guy dispatch law:** recommendation written in law 2; confirm or tighten.
- **RD-4 · Repo split staging.** Decision recorded (separate repos, same org, each independent,
  composable-friendly). Execution options: (a) split now; (b) stage — keep the monorepo two more
  weeks, make each unit independently buildable/publishable (own Dockerfile, own image, no
  cross-imports except a published shared lib), split when the seam spec stabilizes. Staging
  avoids freezing all interfaces on day one of a refactor. Planner frames; Jordi calls.
- **RD-5 · Router intelligence:** rules-only vs rules+small-LLM fallback. Jordi leans cheap.

## Iteration 0 — the lanes (maximize parallelism; one worker owns all, sub-agents per lane)

| ID | Lane | Deliverable + acceptance | Test criteria (tester) |
|---|---|---|---|
| **W-D** | Seam spec (DO FIRST — unblocks all) | `docs/SEAM-SPEC.md`: MCP + receipt profile + conformance checklist; ≤2 pages | checklist applied to one existing unit (Archus) with pass/fail per item |
| **W-A** | Ring extraction | ring container: adapters + media pipeline + mailbox + router(rules-first) + attention-rules file + keyring UI serving; Console's channel/routing code moves here; VERBATIM relay enforced structurally | fresh boot: pair WhatsApp via QR, send "hello", routed to default guy, reply relayed with attribution; a voice note transcribed and routed; zero composition by ring (transcript inspection) |
| **W-B** | Council guy extraction | Console's brain → own container behind MCP shell; provisioned with unit tokens (Zenod/Archus/Epaminon); turn-preamble pattern (reads standing directives from memory each turn) | via ring: "remember X" → Zenod commit SHA cited back; "what did I say about X" → answer with citation; one Epaminon dispatch round-trips with ticket + completion event |
| **W-C** | Zenod standalone | public-seam-only access verified (no private imports from any caller); standalone README + quickstart (MCP endpoint + your repo) | external client (plain MCP, e.g. Claude) does store/search/get against a fresh instance; nothing else can write the repo |
| **W-E** | Fresh-user provisioning | script/runbook: provision ring+council+zenod instance set for a new user <30 min, tokens wired via keyring, no code edits (leverages Epic-2 H-1 work) | tester provisions a user from scratch following ONLY the runbook; E2E smoke: voice note → transcript → filed → cited answer |
| **W-F** | Repo split memo | per RD-4: risk memo + staged plan, unit-by-unit build independence audit | planner review; no execution before RD-4 decided |
| **W-G** | Websites skeleton | one-pagers per unit (static, can lag; blocked on RD-1/RD-2 names) | n/a this iteration |

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

## APPEND ZONE (dated, role-tagged, append-only — receipts or it didn't happen)

### 2026-07-04 · [scribe/Story-Fable] Doc created
- Materializes the 2026-07-04 night design session (Jordi × Story-Fable). Vision, laws, catalog,
  RD decisions, Iteration-0 lanes. Pen hands to Ring-Fable on bootstrap.
