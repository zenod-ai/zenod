# Herald — SEAM-SURFACE (the guy's front door + the two seams it consumes)

Herald's public surface, conformant to [../../docs/SEAM-SPEC.md](../../docs/SEAM-SPEC.md).
Herald is BOTH an MCP **server** (its front door — what the ring/BYO-ring/Console calls)
and an MCP **client** to exactly two peers (memory + mouth). Every caller reaches Herald
only through the server tools below; Herald reaches the world only through the two peer
seams below. No unit imports Herald internals, and Herald imports no unit's internals.

Auth (front door): per-unit bearer token in `Authorization: Bearer <token>`, issued by
the keyring (SEAM-SPEC §4). A self-host instance with no keyring is NOT tokenless: pin
the bearer with `HERALD_API_TOKEN`, or read the auto-generated one printed once to the
boot logs (mirrors Zenod's ZD-9).

> **Blueprint status:** tool names/shapes below are the *intended* Herald surface for
> lane H-2, expressed in the SEAM-SPEC receipt conventions. The container is not built
> yet — this is the contract the code step binds to.

---

## Part 1 — Herald's server tools (the front door)

One MCP server over streamable HTTP at `https://<host>/mcp` (locally
`http://localhost:8090/mcp`). This is what a ring nucleus (H-1), a BYO-ring, or a Console
calls to talk to the guy.

### `talk_to_herald` — LONG (the practice conversation)
The main conversational turn: the customer's verbatim, attributed message (relayed by
the ring) goes in; Herald runs its brain — **turn preamble first** (reads briefing +
standing directives from the memory seam, see Part 2) — and drives whichever flow the
message belongs to (briefing negotiation or reacting to proposals).

- **Input:** `{ message: string, from?: string }` (`from` = the attributed principal id
  the ring passes; Herald never fabricates it).
- **Class:** LONG (LLM loop + seam reads/writes). Returns `{ jobId }` (status `queued`);
  poll `get_task_result`.
- **Receipt (on `done`):** the chat reply text, plus any structured side effects that
  turn produced — e.g. `{ briefingCommitted?: {commitSha, githubUrl}, filed?: [...] }`.
  A turn that files a reaction MUST carry the Zenod receipt handle(s); never a bare ack.

### `run_morning_proposals` — LONG (the ritual, also fired in-process)
Compose the morning **N** proposals. Callable on the wire (so a ring/Console can trigger
it) AND fired by Herald's **in-process scheduler** — the proposal queue lives in Zenod
memory pages, NOT in Epaminon/Archus.

- **Input:** `{ count?: number }` (default from the approved briefing's cadence).
- **Receipt:** `{ proposals: Proposal[] }`,
  `Proposal = { n, text, memorySource: { path, githubUrl }, status: "pending" }`.
  **Every proposal MUST carry a non-empty `memorySource`** (a proposal Herald can't
  trace to memory is a conformance failure). Empty is explicit, never a bare "ok".

### `react_to_proposals` — LONG (the ✓ round-trip)
Apply the customer's reaction to a standing proposal set — e.g. **"✓ 1,3 + give me five
more"**. Approvals/rejections are **filed back to the memory seam as commits**; approved
items are handed to the mouth seam (supervised — only on explicit ✓, HD-2); more
proposals are drawn if asked.

- **Input:** `{ approve?: number[], reject?: number[], more?: number }`.
- **Receipt:** `{ filed: [{commitSha, githubUrl}], posted: PostReceipt[], proposals?: Proposal[] }`
  where `PostReceipt = { n, permalink }` comes from Callisthenes. Nothing appears in
  `posted` without a matching approval in this call — **there is no auto-send path**.

### `get_task_result` — FAST (read; poll a LONG job)
- **Input:** `{ jobId: string }`
- **Receipt:** `{ status: "queued"|"running"|"done"|"error"|"interrupted", result?, message? }`
  (SEAM-SPEC items 6–8), identical convention to Zenod's poll tool.

### Errors (loud, structured)
All failures surface as MCP errors with `{ code, message }` and stable codes:
`unauthorized`, `not_found`, `invalid_input`, `unavailable` (e.g. a peer seam
unreachable — surfaced, never swallowed). No success-shaped failures (SEAM-SPEC §5).

---

## Part 2 — the two peer seams Herald consumes (as a client)

Herald reaches the world ONLY through these two conformant seams. Each is a URL + bearer
token injected at provision (never a world key). Both are swappable by config — Herald
depends on the *shape*, not the vendor (README "modularity is config").

### Seam A — memory (a Zenod-conformant unit)
- **Wire:** `ZENOD_MCP_URL` + `ZENOD_MCP_TOKEN`.
- **Surface used** (see [../zenod/SEAM-SURFACE.md](../zenod/SEAM-SURFACE.md)):
  - `search_memory` / `get_memory` / `ask_brain` — the **turn preamble** read: fetch the
    briefing + standing directives every turn, and pull the source behind each proposal.
  - `store_memory` — commit the approved briefing (**memory page one**) and file every
    reaction/lesson back. Receipt: `commitSha` + `githubUrl` (Herald relays it as proof).
- **Authority note:** the memory seam (Zenod) is the one that holds the **repo token**.
  Herald never does — it borrows memory over the wire (law 6b).

### Seam B — mouth (a Callisthenes-conformant unit)
- **Wire:** `CALLISTHENES_MCP_URL` + `CALLISTHENES_MCP_TOKEN`.
- **Surface used** (see `packages/server/src/agent.ts` `OUTBOUND_AGENT`, displayName
  "Callistheness"): `approve_send` — publish an approved post **exactly once** and return
  a verified live permalink. Herald calls it only after the customer's ✓.
- **Authority note:** the mouth seam holds the **outbound/world keys** (X / Reddit /
  email). Herald never does. A post attempt down any other path has no credential and
  fails loudly — there is no second door.

---

## The invariant that defines Herald
Herald is a **pure guy**: two tokens in (memory, mouth), a front door out, nothing owned.
- No repo token → memory is a seam (Zenod's authority).
- No world keys → sending is a seam (Callisthenes' authority), always ✓-gated (HD-2).
- No router/classifier/attention/keyring here → those are the 2.7 nucleus, not Herald.
