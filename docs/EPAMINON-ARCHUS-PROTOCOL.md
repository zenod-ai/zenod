# Epaminon ↔ Archus — the execution protocol (handoff for the Archus builder)

**Status:** design settled 2026-06-17 with Jordi. This is the contract for how the
**executor** (Epaminon) and the **backlog guardian** (Archus) talk. Written to be
implemented cold. Companion to [SUITE-AGENT-PATTERN.md](./SUITE-AGENT-PATTERN.md).

## The one idea that makes it cheap
**A state report is a FACT, not a request.** Facts don't need interpretation, so they
take a **deterministic, no-LLM lane**. The *only* exchange between these two agents that
needs reasoning is **unblocking** — that's the single place an LLM (and tokens) is spent.
Everything else is a tiny set of fixed, schema'd, idempotent messages. They are **not**
chatty and never free-form.

## Ownership (no overlap)
- **Archus** is the SOLE writer of the central backlog (`AlfaBlok/obsidian-brain`),
  **including a new ticket class: the execution ticket.** Minting one = the act of
  queuing. Maintaining its run-state = also Archus (on Epaminon's structured reports).
- **Epaminon** owns **no repo** (he guards the *activity* of executing, like Outbound
  guards sending — `needsRepo: false`). His "queue" is just the set of open execution
  tickets. He runs them, fans them in, and **reports facts up to Archus**; he never
  writes GitHub himself.
- **Codex workers** write the **target repo** (code + PR). Detailed progress lives on the
  PR — it is NOT reported to Archus.

## The execution ticket
A GitHub issue in the central backlog (`obsidian-brain`), distinguished by a class label
`type:execution`. Archus owns the row.

- **Links to** the real work: the target backlog ticket `owner/repo#N` (the only home of
  the actual ticket — the execution ticket REFERENCES it, never copies it).
- **Carries** the run context Archus already has: objective, scope, done-condition.
- **State** is one label from a fixed enum (own namespace, so it never collides with
  backlog `status:` labels):

```
exec:queued      Archus minted it; in Epaminon's queue; waiting for a concurrency slot
exec:running     Epaminon launched a worker; in progress
exec:needs-review an outward/irreversible outcome (a PR to merge, a tweet/email to send) awaiting human content-approval
exec:approved    human approved the content; cleared to ship (Archus-written, see approve_execution)
exec:blocked     worker hit a blocker Epaminon could not auto-resolve
exec:done        merged / completed
exec:failed      execution failed (rolled back / abandoned)
```

**Two writers, made explicit:** **Archus** writes `exec:queued` (at mint) and `exec:approved`
(on human content-approval); **Epaminon** writes `running`, `needs-review`, `done`, `blocked`,
`failed`. No other overlap.

Legal transitions:
`queued→running` (Ep), `running→needs-review` (Ep, outward outcome) **or** `running→done`
(Ep, internal artifact), `needs-review→approved` (**Archus**, on human approval),
`approved→done` (Ep, after Outbound sends / runner merges), `running→blocked` (Ep),
`blocked→running` (Ep, after advisory unblock), `*→failed` (Ep; a blocked ticket that gets
rescoped goes `→failed` and Archus re-mints a fresh exec). Epaminon reports its edges once.

## One harness, generalist executor, outcome-based gate
The executor is **one harness — Codex with the generalist suite MCP toolset** (code + X +
memory + email via the Console gateway), not a code-only worker. There are no execution
"kinds"; only the **outcome** varies: a PR, a tweet, a filed note. **Epaminon decides the
gate from the outcome** — *outward/irreversible* (merge a PR, send a tweet/email) →
`exec:needs-review` for human content-approval (preserving Outbound's confirm-before-send);
*internal artifact* (file a note) → `exec:done` autonomously. Archus just applies the state
Epaminon reports. See [ARCHUS-TWO-TIER-PLAN.md](./ARCHUS-TWO-TIER-PLAN.md) for the Archus half.

## The protocol — four messages, two lanes

### Lane 1 — deterministic (no LLM, the 99% path)
**`epaminon.enqueue_execution`** — Archus → Epaminon, when Archus mints an execution ticket.
```
{ execution_id: string, target: "owner/repo#N", context: string }
```
Epaminon adds it to his queue and returns immediately. No LLM.

**`epaminon.approve_execution`** — Archus → Epaminon, when the human approves an outward
outcome at `exec:needs-review`. Archus flips the ticket to `exec:approved` AND dispatches
this (the flip alone is not a trigger — Epaminon never scans labels).
```
{ execution_id: string, final_content?: string }   // final_content = the human's edited text, if changed
```
Epaminon routes it: a tweet/email → **Outbound** (send the pre-approved content), a PR →
the **runner** (merge on green). Then Epaminon reports `apply_execution_event(done, evidence_url)`.
No LLM.

**`archus.apply_execution_event`** — Epaminon → Archus, on every state transition.
```
{ execution_id: string,
  state: "running"|"needs-review"|"blocked"|"done"|"failed",
  evidence_url?: string,   // the PR/commit URL when there is one
  note?: string }          // one short line, optional (e.g. "blocked: missing API choice")
```
Archus applies it to the execution ticket **mechanically** — set the `exec:` label, append
the evidence_url — **with no LLM**. Idempotent: re-sending the same state is a no-op.
This is a *trusted, structured write* mapping to Archus's deterministic CRUD; the brain is
bypassed because there is nothing to interpret.

### Lane 2 — judgment (LLM, rare)
**`chat_with_archus`** — Epaminon → Archus, ONLY to unblock.
```
"Execution of owner/repo#N is blocked: <blocker summary>. You wrote this ticket —
 do you have the missing answer, or should it be rescoped/deferred?"
```
Archus reasons with his brain (he authored the ticket, so he often has the answer) and
replies with guidance or a rescope. Epaminon then resumes (→ `running`) or marks it
`blocked`/`failed`. **This is the only token-spending exchange between them.**

## Communication guidelines (keep it lean)
1. **Report on transitions only** — one `apply_execution_event` per state edge. Never
   stream progress; never narrate. Continuous progress lives on the PR (Codex's job).
2. **Structured, not conversational.** Use the deterministic tools for everything
   mechanical. `chat_with_archus` is reserved for the unblock judgment — nothing else.
3. **Idempotent + id-keyed.** Every message carries `execution_id`; retries and duplicate
   states are safe no-ops. Survives restarts without double-counting.
4. **No back-chatter.** Archus does not ask Epaminon open-ended questions, and Epaminon
   does not explain himself — facts in, facts out.
5. **One blocker, one ask.** Batch a block into a single `chat_with_archus` call with the
   full context; do not ping-pong.

## Who does what to build it

**Archus builder (your side):**
- Add the `type:execution` ticket class + the `exec:` state-label namespace.
- **Mint + dispatch:** when a human approves a backlog ticket to run (via `ask_archus` /
  the queue intent), Archus checks readiness, creates the execution ticket (`exec:queued`,
  linked to `owner/repo#N`, with context), then calls `epaminon.enqueue_execution`.
  (So "run owner/repo#N" is fielded by **Archus**, not Epaminon — queuing is a curation
  decision.)
- Expose **`apply_execution_event`** as a deterministic, schema-validated tool (NO LLM)
  that writes the execution ticket. Callable by Epaminon over the mesh.
- **Approval dispatch:** on human content-approval at `needs-review`, flip the ticket to
  `exec:approved` AND call **`epaminon.approve_execution`** `{ execution_id, final_content? }`.
- Keep the unblock path on `chat_with_archus` (brain).

**Epaminon side (tracked separately):**
- `needsRepo: false`; drop all backlog-write tools. Expose **`enqueue_execution`** +
  **`approve_execution`** (receive Archus dispatches) and `execution_status` (human read).
- Loop: pull from queue under a concurrency limit → launch the runner/Codex → on each edge
  call `apply_execution_event` → outward outcome → `needs-review`; on `approve_execution`,
  route to **Outbound** (send) or the **runner** (merge) then report `done` → fan-in/integrate
  in order → on a blocker, try context first, then one `chat_with_archus` unblock call.
- The runner stops scanning/owning the queue; it just runs the ticket Epaminon hands it and
  reports back to Epaminon.

## Auth — identity-gated, not just token-valid
All four deterministic tools live on the **internal `/mcp` only — never republished on the
public Console gateway** (so a fan-out Codex worker holding the Console token cannot reach
them). Gating is to the **counterparty's identity**, not mere network reach or a valid token:
`apply_execution_event` / unblock accept **only Epaminon**; `enqueue_execution` /
`approve_execution` accept **only Archus**. Mechanism: the **Console (c1) cross-provisions
the Archus↔Epaminon lane at enable time** — each side holds the other's lane secret/token and
checks it. **This is a Console-builder action** (neither agent can do it alone) and must be
owned explicitly.

## Downstream owners this creates
- **Console builder:** cross-provision the Archus↔Epaminon lane secret at enable time (auth above).
- **Outbound builder:** accept a **pre-approved send** — in the autonomous path the human's
  approval came through Archus (`approve_execution`), so Outbound ships the approved content
  **without re-asking**; its interactive confirm-before-send stays for *direct chat* only.

## Sequence (happy path)
```
Human → Archus:        run owner/repo#5
Archus:                mint exec ticket E (exec:queued, →#5, context)
Archus → Epaminon:     enqueue_execution(E, owner/repo#5, context)      [deterministic]
Epaminon:              slot free → launch Codex on owner/repo
Epaminon → Archus:     apply_execution_event(E, running)                 [deterministic]
Codex:                 opens PR on owner/repo
Epaminon → Archus:     apply_execution_event(E, needs-review, pr_url)    [deterministic]
Human → Archus:        approves the content
Archus:                flip exec:approved
Archus → Epaminon:     approve_execution(E, final_content?)              [deterministic]
Epaminon:              route → runner merges PR on green (a tweet would go → Outbound)
Epaminon → Archus:     apply_execution_event(E, done, evidence_url)      [deterministic]
Archus:                reflects outcome onto work ticket #5
```
An *internal* artifact (file a note) skips the approval leg: `running → done` autonomously.
Only a block inserts one `chat_with_archus` (LLM) call; the happy path spends zero tokens
between the two agents.
