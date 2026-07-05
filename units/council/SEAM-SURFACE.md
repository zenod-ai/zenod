# The council guy — SEAM SURFACE (ticket W-B)

Conforms to [docs/SEAM-SPEC.md](../../docs/SEAM-SPEC.md) v1. One MCP server over streamable HTTP;
every call carries `Authorization: Bearer <per-unit token>` (§4). `<COUNCIL_NAME>` = RD-2 (OPEN).

Two directions: **EXPOSED** = tools other units (the ring) call ON the council guy. **CONSUMED** =
tools the council guy calls on Zenod / Archus / Epaminon (he holds those three unit tokens, nothing
else).

---

## EXPOSED — the ring calls these on the council guy

### `chat_with_<COUNCIL_NAME>` — the chat entry (LONG tool, §2)

The single conversational door. The ring's router (default route) forwards a user turn here.

- **Input:** `{ text: string, conversationKey?: string, origin_ticket_id?: string }`
  (`origin_ticket_id` = the ring mailbox entry id, so the whole turn traces end-to-end.)
- **Class: LONG** — a turn may run a multi-minute LLM loop (memory reads, an Epaminon dispatch). It
  MUST NOT hold the wire. Returns immediately:
  ```json
  { "ticket_id": "council-<uuid>", "status": "accepted", "origin_ticket_id": "<ring-mailbox-id>" }
  ```
- **Completion event** (same `ticket_id`) carries the terminal reply + any evidence handles the turn
  produced (a Zenod commit SHA it filed, an Epaminon `ticket_id` it dispatched) — or a loud error.
  Grounds SEAM-SPEC items 6/7/8.
  ```json
  { "ticket_id": "council-<uuid>", "state": "done",
    "reply": "Filed. Zenod commit abc1234.",
    "evidence": [ { "kind": "memory_stored", "commitSha": "abc1234", "url": "https://github.com/…" } ] }
  ```
- **Poll (§2, item 8):** `get_<COUNCIL_NAME>_result(ticket_id)` → `queued|running|done|error` with the
  same payload shape.

> Today's analogue: `handleTasking` (engine) surfaced through Zenod-MCP's `ask_brain` (fast) /
> `task_brain` (long, `{ jobId }` polled via `get_task_result`). W-B renames this to the council
> door and makes the LONG form primary so a slow guy never holds the ring's wire (RD-1 call shape).

### `get_<COUNCIL_NAME>_result` — poll (READ tool, §2)

- **Input:** `{ ticket_id: string }`
- **Returns** the job status/result, or an explicit `{ state: "not_found" }` — never a bare "ok".

### Receipt / error rules on this surface

- Any turn that **files memory** returns (in the completion event) a `memory_stored` evidence handle
  carrying Zenod's `commitSha`/`url` — never a silent "noted" (SEAM-SPEC items 3/4).
- Any turn that **dispatches Epaminon** returns a `dispatch_accepted` evidence handle carrying the
  Epaminon `ticket_id` + the `origin_ticket_id` it propagated (items 9–11).
- Forced failure → structured `{ code, message }` with a canonical code (`unauthorized`,
  `not_found`, `invalid_input`, `unavailable`) — item 15.

---

## CONSUMED — the council guy calls these (unit tokens only)

### On **Zenod** (memory owner) — all memory verbs go here over the seam

| Tool (Zenod) | Class | Council guy uses it for | Receipt he relies on |
|---|---|---|---|
| `search_memory` | READ | "what did I say about X" | ranked paths + source URLs, or explicit `none` |
| `get_memory` | READ | read one note | note body + `url`, or `not_found` |
| `store_memory` | LONG | "remember X" / turn-preamble filing | `{ ticket_id }` → completion carries `commitSha` + `url` |
| `get_task_result` | READ | poll a `store_memory` job | job status/result |

> **Turn-preamble read:** at the top of every turn the council guy issues a `search_memory` /
> `get_memory` against Zenod for his **standing directives**, and prepends the returned text to the
> turn. Directives are memory data pulled over the seam — not shipped in the image.

### On **Archus** (backlog owner)

| Tool (Archus) | Class | Council guy uses it for | Receipt |
|---|---|---|---|
| `ask_archus` | LONG | read/curate the backlog by intent | qualified `owner/repo#N` + URL, or loud error |

### On **Epaminon** (executor) — the guy→guy dispatch, a LONG tool (law 2 / RD-3)

`dispatch_epaminon` (over the seam; today `POST /api/exec/enqueue` + the `epaminon.run_*` peer tools):

- **Input:** `{ target?: "owner/repo#N", task: string, origin_ticket_id: string, depth: 0 }`
  - `depth: 0` is the council guy's own depth; Epaminon receives it, runs at **depth 1**, and MUST
    NOT emit its own dispatch (SEAM-SPEC item 10).
  - `origin_ticket_id` = the council guy's `chat_with_*` `ticket_id`, propagated (item 11).
- **Class: LONG** — returns immediately:
  ```json
  { "ticket_id": "exec-<n>", "state": "accepted", "origin_ticket_id": "council-<uuid>" }
  ```
- **Completion event** (same `ticket_id`) carries the terminal execution state + evidence URL (PR /
  commit / artifact) or a loud error. The council guy surfaces it back up its own completion event to
  the ring, attributed.
- **Poll:** `epaminon.execution_status(ticket_id)`.

### ⚠️ SEAM-SPEC gap this surface exposes (flag for W-D / planner)

`origin_ticket_id` and `depth` are **not present in the code today** (grep of `packages/server/src`:
zero hits). The dispatch path (`runtime.ts` `queueExecution` → `POST /api/exec/enqueue`, and the
`epaminon.run_ephemeral_task` peer tool) sends `{ target, title, context }` with **no origin/depth
fields**. Making SEAM-SPEC items 10–11 real requires adding those two fields to the enqueue payload
and to Epaminon's receiver — a coupling-removal ticket, not a rename. Recorded in EXTRACTION-MAP.md.
