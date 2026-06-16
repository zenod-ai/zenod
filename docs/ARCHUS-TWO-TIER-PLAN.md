# Archus — the two-tier backlog + execution plan (Archus builder's side)

**Status:** design settled with Jordi 2026-06-17; written to be implemented cold and
cross-checked with the Epaminon builder before either side starts. This is the **Archus
half** of [EPAMINON-ARCHUS-PROTOCOL.md](./EPAMINON-ARCHUS-PROTOCOL.md) (the shared
contract) and a companion to [SUITE-AGENT-PATTERN.md](./SUITE-AGENT-PATTERN.md). The
Epaminon builder writes the mirror half; when both green-light, both build.

---

## Part 1 — How it's supposed to work

### One harness, generalist tools (no "kinds")
Everything on the execution queue is run by **the same executor — Codex** — with the
**suite's MCP tools**: a code checkout *and* the X MCP, memory (Zenod), email, etc. So:
- "fix a bug" = Codex with the repo → a PR,
- "post a tweet" = Codex with the X MCP → a posted tweet,
- "research and file X" = Codex with memory → a filed artifact.

There is **no separate harness and no execution "kind."** Archus shapes a good execution
ticket; Codex pursues the goal with whatever tools it needs. The only thing that varies is
the **outcome**: some integrate into a codebase (a PR to merge), most don't (a tweet, an
email, a filed artifact). The enabler is that the executor holds the X/email/memory MCPs
*itself*.

### The two tiers
- **Work tickets** — the thing to do. **Code work lives in its code repo** (`owner/repo#N`);
  **non-code work** (a tweet, an action with no repo) lives in **central**
  (`AlfaBlok/obsidian-brain`). One home, qualified `owner/repo#N` IDs, references-not-copies.
- **Execution tickets** — always in **central**, class label `type:execution`. Minting one
  **is** the act of queuing. It REFERENCES its work ticket (`target`), carries the run
  context, and holds run-state in an `exec:` label. Archus owns this row.

### Central backlog = what's on our plate now
Central (`obsidian-brain`) is **current, specific goals — days-scale**, not the long-term
plan. Big themes / strategy live in **memory notes**, not the backlog. Light structure via
**naming** (e.g. `M1·P1`, `M1·P2` for milestone phases) — not deep recursion. Single
backlog, filtered cleanly by labels; we don't split repos. Keeping execution tickets here,
next to Archus, is what lets us see at a glance *what's running / stuck / done* without
digging through every repo.

### The human gate = outward/irreversible outcome (not harness type)
- **Outward / irreversible** (merge a PR, **send a tweet**, send an email): the worker
  produces the artifact/draft → `exec:needs-review` → **the human approves the actual
  content** → it ships. (You approved the *goal* at queue time; you approve the *content*
  before it goes out — same as approving a PR's diff, and it preserves Outbound's
  confirm-before-send.)
- **Internal artifact** (file a note, a research doc): completes autonomously → `exec:done`.

Whether to gate is decided **Epaminon-side** from the worker's outcome; Archus just applies
the reported state.

### Where Epaminon reads from (the crux)
Epaminon does **not** scan the backlog. He reads from the **execution tickets Archus
dispatches** to him. "Run `owner/repo#N`" is fielded by **Archus** — queuing is a curation
decision — who checks readiness, mints the exec ticket, and hands Epaminon a dispatch.

---

## Part 2 — What Archus will build (this side)

1. **Execution-ticket class + state labels.** A `type:execution` label and the `exec:`
   state namespace (own namespace, never collides with `status:` backlog labels):
   `exec:queued · exec:running · exec:needs-review · exec:approved · exec:blocked · exec:done · exec:failed`.
   **Two writers:** Archus sets `exec:queued` (at mint) and `exec:approved` (on human go —
   see the ship seam); Epaminon *reports* `running/needs-review/blocked/done/failed` via
   `apply_execution_event`.

2. **Ticket shaping (mostly already built — keep/extend).** Work tickets are runnable
   (objective, scope, done-condition; files for code work); ask ONE clarifying question
   when not runnable; one-home; qualified IDs; dedup-before-create. Non-code goals get a
   central work ticket with the goal + context.

3. **Mint + dispatch** (the new core). On an approved "run `<work-ticket>`" intent (via
   `ask_archus` / a queue intent):
   - check the work ticket is ready,
   - create the execution ticket in central: `type:execution`, `exec:queued`, a link to the
     `target` work ticket, and the run context (objective/scope/done-condition + the goal),
   - call **`epaminon.enqueue_execution`** (deterministic) with `{ execution_id, target,
     context }`.

4. **`apply_execution_event`** — expose a **deterministic, schema-validated, NO-LLM** tool
   Epaminon calls on every state edge: `{ execution_id, state, evidence_url?, note? }`.
   Archus mechanically sets the `exec:` label and appends the evidence_url (idempotent;
   re-sending a state is a no-op). The brain is bypassed — a state report is a fact.

5. **Reflect the outcome** onto the work ticket when the execution finishes
   (`exec:done`/`exec:failed`), with the evidence_url.

6. **Unblock lane (already have it).** Epaminon → `chat_with_archus` only to unblock; Archus
   reasons (he authored the ticket) and replies with an answer or a rescope. The single
   token-spending exchange.

---

## Part 3 — The interface Epaminon must match (the handshake)

| Message | Direction | Lane | Shape |
|---|---|---|---|
| `enqueue_execution` | Archus → Epaminon | deterministic | `{ execution_id, target:"owner/repo#N", context }` |
| `apply_execution_event` | Epaminon → Archus | deterministic | `{ execution_id, state, evidence_url?, note? }` |
| **`approve_execution`** (NEW) | Archus → Epaminon | deterministic | `{ execution_id, final_content? }` |
| `chat_with_archus` (unblock) | Epaminon → Archus | LLM (rare) | one blocker, full context, one ask |

`state ∈ {running, needs-review, blocked, done, failed}` reported by Epaminon; Archus sets
`queued` (mint) and `approved` (human go). Legal transitions: `queued→running`,
`running→needs-review`, `needs-review→approved` (Archus, on approval), `approved→done`,
`running→done` (internal artifact, no gate), `running→blocked`, `blocked→running`, `*→failed`.
Report once per edge; never stream.

**Epaminon-side expectations Archus relies on (the other half confirms these):**
- `needsRepo: false`; owns no repo; pulls from the dispatched queue under a concurrency cap.
- Launches **Codex with the generalist suite MCP toolset** (code + X + memory + email), not a
  code-only worker — this is what makes non-code goals run.
- Decides the gate from the outcome: outward/irreversible → `needs-review`; internal artifact
  → `done`. Sets `needs-review` when there is something for the human to approve (a PR to
  merge, a draft to send).
- Reports facts up via `apply_execution_event`; never writes GitHub itself; detailed progress
  lives on the PR (code) or is summarized in the evidence_url/note (non-code).

---

## Part 4 — Seams resolved (2026-06-17 cross-check)

**1. Shipping an outward outcome (the gap).**
- (a) Add **`exec:approved`** between `needs-review` and `done` — set by **Archus** on the
  human's go (the only `exec` state Archus writes besides `queued`). It gives the at-a-glance
  "approved, shipping now" vs "still awaiting."
- (b) **Outbound performs the send** (tweet/email); the **runner merges** a PR on green. In
  the autonomous execution path the **human-approval-through-Archus IS Outbound's
  confirm-before-send** — Outbound ships the pre-approved content without re-asking (its
  interactive confirm is for direct chat). Epaminon hands Outbound the approved content.
- (c) Human approves in chat → Archus flips `needs-review → approved` **and** dispatches the
  new **`approve_execution { execution_id, final_content? }`** to Epaminon (since Epaminon
  doesn't scan labels, the flip alone isn't a trigger — the dispatch is). Epaminon then routes
  to Outbound (send) or the runner (merge), and reports `apply_execution_event(done, url)`.
  `final_content` carries the human's edit if the draft changed.

**2. One ticket or two for no-code goals → TWO.** A central **work ticket** (the durable
goal, re-runnable, the audit home) + a separate **execution ticket** referencing it. Both in
central, but kept distinct so reflect-outcome and multi-attempt audit stay clean.

**3. Unblock = advisory.** `chat_with_archus` returns guidance Epaminon feeds the **resumed
worker** (same exec ticket → `running`). A genuine **rescope** is not advice: Archus edits the
**work ticket** and **re-mints a fresh execution ticket** (new `enqueue_execution`); the
blocked one goes `→ failed`.

**4. Auth — confirmed, with the mechanism.** `enqueue_execution`, `apply_execution_event`, and
`approve_execution` live ONLY on the agents' **internal `/mcp`** (dokploy-network) and are
**never republished on the public Console gateway**. Gating is to the **counterparty's
identity**, not just network reach or the agent's own token: the **Console cross-provisions**
Archus↔Epaminon (each holds the other's token / a lane secret) so Archus accepts
`apply_execution_event`/`approve_execution` traffic *only from Epaminon* — otherwise a fan-out
Codex worker with network access and a stray token could forge `done`. → **Console-builder
action:** add cross-provisioning of the Archus↔Epaminon lane at enable time.

## Green-light
✅ Core model (Parts 1–3) and seams 1–3 settled. Open for the Epaminon builder to confirm:
the **`approve_execution`** addition to the handshake, and the **cross-provisioned auth** (#4).
When both confirm, Archus builds Part 2 and Epaminon builds his half against Part 3.
