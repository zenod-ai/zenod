# SEAM-SPEC v1 — the wire contract every Atomic-Suite unit conforms to

Owner: Epic 2.5 ([EPIC-2.5-ATOMIC-UNITS.md](EPIC-2.5-ATOMIC-UNITS.md), ticket W-D). Status: v1,
2026-07-05. Binds every unit in the catalog (Ring/Phylax, the council guy, Zenod, Archus,
Epaminon, Callisthenes, Herald). A unit that fails any binary item below is **nonconformant** and
may not join the suite.

This is a stranger-readable contract: it names no zenod-internal type. A developer with only an
MCP SDK and this page can build a conformant unit.

---

## 1 · Transport (law 1 — the seam is pure, standard MCP)

- Every unit exposes exactly **one MCP server** over **streamable HTTP** (the `@modelcontextprotocol`
  standard transport). Nothing custom rides the wire — no bespoke framing, no side channels.
- Callers reach a unit at a single base URL (`https://<unit>.<host>/mcp`) and speak vanilla MCP:
  `tools/list`, `tools/call`. No unit requires a caller to know anything beyond MCP + this page.
- A unit MAY internally be a small compose (e.g. the Ring = ring-core + Phylax gateway), but it
  presents **one** MCP endpoint per addressable box, and the internal boxes talk the same MCP
  (Phylax↔ring-core is itself pure MCP).

## 2 · The receipt profile (law 1 — the house convention)

Two tool classes; every tool declares which it is.

**Fast tools** (return within the call):
- A **mutating** fast tool MUST return, in its result, at least one concrete evidence handle:
  an **ID, URL, or SHA** naming the thing it created/changed. A result that mutated state but
  carries no handle is a **silent ack** and is nonconformant.
- A **read** fast tool returns the data, or an empty-but-explicit result (e.g. `none`), never a
  bare success.
- On failure a tool **errors loudly**: a structured error carrying a stable `code` and a human
  `message`. Swallowing an error into a cheerful text reply is nonconformant.

**Long tools** (work exceeds one call — LLM loops, git commits, container runs, external jobs):
- Return immediately with `{ ticket_id }` (an accepted-receipt). They MUST NOT hold the wire.
- Completion arrives later as an **event** carrying the **same `ticket_id`** plus the terminal
  evidence handle (URL/SHA/ID) or a loud error. The caller correlates by `ticket_id`.
- A poll tool (`get_*_result(ticket_id)`) MUST exist so a caller can pull status without waiting
  for the event.

Grounding (already true in this repo, not invented here): mutating tools return `evidence[]`
objects whose kinds end in `_created/_updated/_closed/_sent/_stored` carrying `url`/`commitSha`;
long tools (`task_brain`, `run_task`, `store_memory`) enqueue a job and return its id, polled via
`get_task_result`. SEAM-SPEC promotes that lived pattern to a binding contract.

## 3 · Tickets & dispatch (laws 2 & RD-3 — the tree, never a mesh)

- Calls form a **tree**: requests flow down (ring → guy → units), responses up the same edges.
  No cycles, no sideways conversational calls.
- A guy MAY dispatch another guy, but only as a **typed async dispatch** (a long tool per §2):
  ticket + completion event, never a conversational call.
- **Dispatch depth ≤ 1** (RD-3): a dispatched guy MUST NOT dispatch a third guy. A unit that
  receives a dispatch ticket and emits its own dispatch ticket is nonconformant.
- **Originating-ticket-ID propagation** (RD-3): every dispatch ticket carries the `origin_ticket_id`
  of the request that caused it, so a completion event traces end-to-end. A dispatch ticket with no
  origin field (when one exists upstream) is nonconformant.

## 4 · Auth (law 6c — agent→unit plane)

- Every call carries a **per-unit bearer token** in the standard `Authorization: Bearer <token>`
  header. The token is issued, rotated, and revoked by the keyring; the unit validates it and
  rejects (loud `unauthorized` error) anything else.
- A unit holds **only** the tokens for the units it may call — never world/OAuth keys (those live
  in the vault, pulled at request time by the one authorized unit; see law 6b).
- Enable/disable is enforced at the token: a disabled unit's token is revoked and its endpoint
  **refuses** calls (loud error), not silently 200s.

## 5 · Errors (makes §2 "loud" testable)

- Every error is a structured object: `{ code: string, message: string }`, `code` stable and
  machine-checkable. HTTP/transport failures surface as MCP errors, not swallowed.
- The four canonical codes a conformant unit uses where applicable: `unauthorized`,
  `not_found`, `invalid_input`, `unavailable`. Units MAY add their own; they MUST NOT return
  success on failure.

---

## CONFORMANCE CHECKLIST (binary — each is pass/fail with a tool-call transcript)

A tester applies these to a running unit. Every item is yes/no; evidence is a captured
`tools/call` request+response.

1. **[transport]** Unit exposes a single MCP-over-streamable-HTTP endpoint; `tools/list` succeeds
   with a vanilla MCP client and no custom headers beyond `Authorization`.
2. **[transport]** No tool requires a caller to send a non-standard/bespoke payload envelope.
3. **[receipt]** Every mutating fast tool returns ≥1 evidence handle (ID/URL/SHA) in its result.
4. **[receipt]** No mutating tool returns a bare success/ack with no handle (no silent ack).
5. **[receipt]** Every read tool returns data or an explicit empty marker, never a bare "ok".
6. **[ticket]** Every long tool returns `{ ticket_id }` immediately and does not block the wire
   past a short bound.
7. **[ticket]** A completion event for that work carries the **same** `ticket_id` + terminal
   evidence handle (or loud error).
8. **[ticket]** A poll tool exists that returns the status/result for a given `ticket_id`.
9. **[dispatch]** A guy→guy dispatch is a long tool (ticket+event), never a blocking conversational
   call.
10. **[dispatch]** Depth ≤ 1: a dispatched unit does not itself emit a dispatch ticket.
11. **[dispatch]** Every dispatch ticket carries `origin_ticket_id` tracing to the upstream request.
12. **[auth]** A call with no/invalid bearer token is refused with a loud `unauthorized` error.
13. **[auth]** A disabled unit refuses calls loudly (does not silently succeed).
14. **[auth]** The unit holds no world/OAuth keys in its own config surface (agent→unit tokens only).
15. **[error]** A forced failure returns a structured `{code,message}`, not a success-shaped reply.
16. **[stranger]** The unit's public surface references zero suite-internal types; a plain MCP
    client (e.g. Claude with only the endpoint + token) can drive it from `tools/list` alone.

**v1 pass bar (tester, W-D test criteria):** apply items 1–16 to **Archus** as-is; record pass/fail
per item with a tool-call transcript; demonstrate ≥1 real receipt (item 3) and ≥1 loud-error case
(item 12 or 15). Items that don't apply to a read-only unit (6–8, 9–11) are marked N/A, not failed.

**RD-4 split trigger couples to this doc:** the physical repo split executes only once SEAM-SPEC v1
passes the tester on **≥2 units without spec edits**. Until then units stay in the monorepo,
restructured per-unit (W-F) but not split.
